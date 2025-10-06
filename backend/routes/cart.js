// backend/routes/cart.js
const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

const toInt = (v, def = 0, min = 0, max = 2147483647) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
};

async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}
async function hasTable(t) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
  return !!rows[0]?.ok;
}

// สร้าง cart ให้ user ถ้ายังไม่มี
async function getOrCreateCartId(userId) {
  const q1 = await db.query(`SELECT cart_id FROM carts WHERE user_id=$1 ORDER BY cart_id LIMIT 1`, [userId]);
  if (q1.rowCount) return q1.rows[0].cart_id;
  const q2 = await db.query(`INSERT INTO carts (user_id, created_at) VALUES ($1, NOW()) RETURNING cart_id`, [userId]);
  return q2.rows[0].cart_id;
}

// ดึงราคา/สต็อกปัจจุบัน (แบบขั้นต่ำ: ใช้ตาราง products ตรง ๆ; ถ้ามีวิวก็จะใช้วิว)
async function resolveStockPrice({ product_id }) {
  const useView = await hasTable('v_product_variants_live_stock'); // เผื่ออนาคต
  if (useView) {
    const r = await db.query(`
      SELECT COALESCE(SUM(stock),0)::int AS stock, MIN(price_override)::numeric AS price
      FROM v_product_variants_live_stock WHERE product_id=$1
    `, [product_id]);
    if (!r.rowCount) return null;
    return { stock: Number(r.rows[0].stock) || 0, price: r.rows[0].price == null ? null : Number(r.rows[0].price) };
  }

  const hasIsArchived = await hasColumn('products','is_archived');
  const hasArchivedAt = await hasColumn('products','archived_at');
  const hasPublished  = await hasColumn('products','published');
  const hasIsPubProd  = await hasColumn('products','is_published');

  const archivedFilter = hasIsArchived ? 'COALESCE(is_archived,FALSE)=FALSE'
                       : hasArchivedAt ? 'archived_at IS NULL'
                       : 'TRUE';
  const pubCol = hasPublished ? 'COALESCE(published,TRUE)'
              : hasIsPubProd ? 'COALESCE(is_published,TRUE)'
              : 'TRUE';

  const r = await db.query(`
    SELECT selling_price::numeric AS price, COALESCE(stock_quantity,0)::int AS stock
    FROM products p
    WHERE product_id=$1 AND ${archivedFilter} AND ${pubCol}=TRUE
    LIMIT 1
  `, [product_id]);
  if (!r.rowCount) return null;
  return { stock: Number(r.rows[0].stock) || 0, price: r.rows[0].price == null ? null : Number(r.rows[0].price) };
}

/* GET /api/cart */
router.get('/', async (req, res) => {
  try {
    const cartId = await getOrCreateCartId(req.userId);
    const r = await db.query(`
      SELECT ci.item_id, ci.product_id, ci.qty,
             ci.price_at_add::numeric AS price,
             p.product_name,
             COALESCE(NULLIF(p.image_url,''), (SELECT MIN(url) FROM product_images WHERE product_id=p.product_id)) AS image_url
      FROM cart_items ci
      JOIN carts c ON c.cart_id=ci.cart_id
      JOIN products p ON p.product_id=ci.product_id
      WHERE c.cart_id=$1 AND c.user_id=$2
      ORDER BY ci.item_id
    `, [cartId, req.userId]);

    const items = r.rows.map(x => ({
      item_id: x.item_id,
      product_id: x.product_id,
      qty: Number(x.qty) || 0,
      price: x.price == null ? 0 : Number(x.price),
      product_name: x.product_name,
      image_url: x.image_url,
      line_total: (x.price == null ? 0 : Number(x.price)) * (Number(x.qty) || 0),
    }));

    const total_qty = items.reduce((s, i) => s + i.qty, 0);
    const total_amount = items.reduce((s, i) => s + i.line_total, 0);

    res.json({ cart_id: cartId, items, total_qty, total_amount });
  } catch (e) {
    console.error('cart get error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

/* POST /api/cart/items  { product_id, qty } */
router.post('/items', async (req, res) => {
  try {
    const product_id = toInt(req.body.product_id, NaN);
    let qty = toInt(req.body.qty, 1, 1, 999999);
    if (!Number.isFinite(product_id)) return res.status(400).json({ message: 'product_id ไม่ถูกต้อง' });

    const info = await resolveStockPrice({ product_id });
    if (!info) return res.status(404).json({ message: 'ไม่พบสินค้า' });
    if (info.stock <= 0) return res.status(400).json({ message: 'สินค้าหมดสต็อก' });

    const cartId = await getOrCreateCartId(req.userId);

    // ถ้ามีอยู่แล้วให้รวมจำนวน
    const ex = await db.query(`
      SELECT item_id, qty FROM cart_items WHERE cart_id=$1 AND product_id=$2 LIMIT 1
    `, [cartId, product_id]);

    if (ex.rowCount) {
      const newQty = Number(ex.rows[0].qty) + qty;
      if (newQty > info.stock) return res.status(400).json({ message: 'จำนวนเกินสต็อกที่มี' });
      await db.query(`UPDATE cart_items SET qty=$1, updated_at=NOW() WHERE item_id=$2`, [newQty, ex.rows[0].item_id]);
    } else {
      if (qty > info.stock) return res.status(400).json({ message: 'จำนวนเกินสต็อกที่มี' });
      await db.query(`
        INSERT INTO cart_items (cart_id, product_id, qty, price_at_add, created_at, updated_at)
        VALUES ($1,$2,$3,$4,NOW(),NOW())
      `, [cartId, product_id, qty, info.price]);
    }

    // ตอบกลับตะกร้าปัจจุบัน
    const items = (await db.query(`
      SELECT item_id, product_id, qty, price_at_add::numeric AS price
      FROM cart_items WHERE cart_id=$1 ORDER BY item_id
    `, [cartId])).rows;
    const total_qty = items.reduce((s, i) => s + (Number(i.qty)||0), 0);
    const total_amount = items.reduce((s, i) => s + (Number(i.qty)||0) * (i.price==null?0:Number(i.price)), 0);
    res.status(201).json({ ok: true, total_qty, total_amount });
  } catch (e) {
    console.error('cart add error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

/* PATCH /api/cart/items/:itemId  { qty }  (qty=0 = ลบ) */
router.patch('/items/:itemId', async (req, res) => {
  try {
    const itemId = toInt(req.params.itemId, NaN);
    let qty = toInt(req.body.qty, NaN, 0, 999999);
    if (!Number.isFinite(itemId) || !Number.isFinite(qty)) return res.status(400).json({ message: 'ข้อมูลไม่ถูกต้อง' });

    const item = (await db.query(`
      SELECT ci.item_id, ci.qty, ci.product_id, c.user_id, ci.cart_id
      FROM cart_items ci JOIN carts c ON c.cart_id=ci.cart_id
      WHERE ci.item_id=$1
    `, [itemId])).rows[0];
    if (!item || String(item.user_id) !== String(req.userId)) return res.status(404).json({ message: 'ไม่พบรายการในตะกร้า' });

    if (qty === 0) {
      await db.query(`DELETE FROM cart_items WHERE item_id=$1`, [itemId]);
      return res.json({ ok: true, removed: true });
    }

    const info = await resolveStockPrice({ product_id: item.product_id });
    if (!info) return res.status(404).json({ message: 'ไม่พบสินค้า' });
    if (qty > info.stock) return res.status(400).json({ message: 'จำนวนเกินสต็อกที่มี' });

    await db.query(`UPDATE cart_items SET qty=$1, updated_at=NOW() WHERE item_id=$2`, [qty, itemId]);
    res.json({ ok: true, qty });
  } catch (e) {
    console.error('cart update error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

/* DELETE /api/cart/items/:itemId */
router.delete('/items/:itemId', async (req, res) => {
  try {
    const itemId = toInt(req.params.itemId, NaN);
    const row = (await db.query(`
      DELETE FROM cart_items USING carts
      WHERE cart_items.cart_id=carts.cart_id AND carts.user_id=$1 AND cart_items.item_id=$2
      RETURNING cart_items.item_id
    `, [req.userId, itemId])).rows[0];
    if (!row) return res.status(404).json({ message: 'ไม่พบรายการในตะกร้า' });
    res.json({ ok: true, removed: true });
  } catch (e) {
    console.error('cart delete error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
