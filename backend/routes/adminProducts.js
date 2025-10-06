// backend/routes/adminProducts.js
// ✅ Products CRUD + Archive/Unarchive + Images
// ✅ Validation โมดูล 2: product_name, category_id (TEXT), price>=0, stock>=0, product_unit_id ต้องมี
// ✅ รองรับ published (ถ้าตารางมีคอลัมน์นี้) + publish/unpublish
// ✅ ไม่แก้ schema — ตรวจคอลัมน์แบบไดนามิกก่อนใช้

const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

/* ---------- Utils ---------- */
function toInt(v) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (s === '') return null;
  const th = '๐๑๒๓๔๕๖๗๘๙';
  s = s.replace(/[๐-๙]/g, d => th.indexOf(d));
  s = s.replace(/[,฿\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SORT_WHITELIST = new Set([
  'product_id', 'product_name', 'selling_price', 'stock_quantity', 'created_at'
]);

/* ---------- No-cache middleware (อัปเดตเฉพาะบล็อกนี้) ---------- */
const nocache = (_req, res, next) => {
  // กัน cache ทุกชั้น
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  // ป้องกัน 304 จาก ETag/If-None-Match: ให้ ETag ไม่คงที่
  // (ใช้ค่าสุ่มสั้น ๆ ต่างกันทุกครั้ง)
  res.set('ETag', Math.random().toString(36).slice(2));

  // ป้องกัน 304 จาก If-Modified-Since: อัปเดตให้เป็นเวลาตอนนี้เสมอ
  res.set('Last-Modified', new Date().toUTCString());

  next();
};

/* ---------- Column/Schema helpers ---------- */
async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows[0]?.ok;
}
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

/* ──────────────────────────────────────────────────────────────
 * GET /api/admin/products
 * ──────────────────────────────────────────────────────────── */
router.get('/', nocache, async (req, res)  => {
  try {
    const {
      category_id,
      subcategory_id,
      q,
      include_archived,
      published,
      sort_by,
      sort_dir,
      page = '1',
      page_size = '20',
    } = req.query;

    const hasIsArchived  = await hasColumn('products', 'is_archived');
    const hasArchivedAt  = await hasColumn('products', 'archived_at');
    const hasImageUrl    = await hasColumn('products', 'image_url');
    const hasPublished   = await hasColumn('products', 'published');
    const hasPU          = await hasColumn('products', 'product_unit_id');
    const hasSU          = await hasColumn('products', 'size_unit_id');
    const useView        = await hasTable('v_product_variants_live_stock');

    const selImageUrl   = hasImageUrl ? 'p.image_url' : 'cv.cover_url AS image_url';
    const selPublished  = hasPublished ? 'p.published' : 'TRUE AS published';
    const selIsArchived = hasIsArchived ? 'COALESCE(p.is_archived,false) AS is_archived' : 'NULL::boolean AS is_archived';
    const selArchivedAt = hasArchivedAt ? 'p.archived_at' : 'NULL::timestamp AS archived_at';
    const selPU         = hasPU ? 'p.product_unit_id' : 'NULL::int AS product_unit_id';
    const selSU         = hasSU ? 'p.size_unit_id'    : 'NULL::int AS size_unit_id';

    const where = [];
    const params = [];

    if (q && String(q).trim() !== '') {
      params.push(`%${q.trim()}%`);
      params.push(`%${q.trim()}%`);
      where.push(`(p.product_name ILIKE $${params.length - 1} OR p.description ILIKE $${params.length})`);
    }

    // 🔁 TEXT matching for category_id / subcategory_id
    if (category_id && String(category_id).trim() !== '') {
      params.push(String(category_id).trim());
      where.push(`p.category_id = $${params.length}`);
    }
    if (subcategory_id && String(subcategory_id).trim() !== '') {
      params.push(String(subcategory_id).trim());
      where.push(`p.subcategory_id = $${params.length}`);
    }

    const showArchived = include_archived === '1' || String(include_archived).toLowerCase() === 'true';
    if (!showArchived) {
      if (hasIsArchived) where.push(`COALESCE(p.is_archived,false) = false`);
      else if (hasArchivedAt) where.push(`p.archived_at IS NULL`);
    }

    if (hasPublished && published !== undefined && String(published).trim() !== '') {
      const val = ['1','true','yes','y'].includes(String(published).toLowerCase());
      where.push(`COALESCE(p.published, TRUE) = ${val ? 'TRUE' : 'FALSE'}`);
    }

    const sb = SORT_WHITELIST.has(String(sort_by)) ? String(sort_by) : 'product_id';
    const sd = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderSql = `ORDER BY p.${sb} ${sd}`;

    const pInt = Math.max(parseInt(page, 10) || 1, 1);
    const psInt = Math.min(Math.max(parseInt(page_size, 10) || 20, 1), 100);
    const offset = (pInt - 1) * psInt;

    params.push(psInt, offset);
    const limitIdx  = params.length - 1;
    const offsetIdx = params.length;

    const sql = `
      WITH base AS (
        SELECT p.*
        FROM products p
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      )
      SELECT
        p.product_id,
        p.product_name,
        p.description,
        p.selling_price,
        p.cost_price,
        p.stock_quantity,
        p.category_id,
        p.subcategory_id,
        ${selImageUrl},

        ${selPU},
        pu.unit_name       AS product_unit_name,
        p.size_value,
        ${selSU},
        su.unit_name       AS size_unit_name,

        p.origin,
        p.product_status_id,
        ${selPublished},
        ${selIsArchived},
        ${selArchivedAt},

        c.category_name,
        sc.subcategory_name,
        ps.status_name     AS product_status_name,

        COALESCE(lv.live_stock,0)::int AS live_stock,
        ${useView ? 'COALESCE(lv.min_price, p.selling_price)::numeric' : 'p.selling_price::numeric'} AS min_price,

        COUNT(*) OVER() AS __total
      FROM base p
      ${hasImageUrl ? '' : `
        LEFT JOIN LATERAL (
          SELECT MIN(pi.url) AS cover_url
          FROM product_images pi
          WHERE pi.product_id = p.product_id
        ) cv ON TRUE
      `}
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories sc     ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses ps  ON ps.product_status_id = p.product_status_id
      LEFT JOIN product_units pu     ON pu.id = p.product_unit_id
      LEFT JOIN size_units    su     ON su.id = p.size_unit_id
      ${useView ? `
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(v.stock),0)::int AS live_stock,
            MIN(v.price_override) AS min_price
          FROM v_product_variants_live_stock v
          WHERE v.product_id = p.product_id
        ) lv ON TRUE
      ` : ''}
      ${orderSql}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const { rows } = await db.query(sql, params);
    const total = rows.length ? Number(rows[0].__total) : 0;
    const items = rows.map(({ __total, ...rest }) => rest);
    res.json({ items, total, page: pInt, page_size: psInt });
  } catch (error) {
    console.error('❌ ERROR: ดึงข้อมูลสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * GET /api/admin/products/:id
 * ──────────────────────────────────────────────────────────── */
router.get('/:id', nocache, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ error: 'Invalid id' });

    const { rows } = await db.query(
      `
      SELECT 
        p.*,
        pu.unit_name AS product_unit_name,
        su.unit_name AS size_unit_name,
        c.category_name,
        sc.subcategory_name,
        ps.status_name AS product_status_name
      FROM products p
      LEFT JOIN product_categories c   ON c.category_id = p.category_id
      LEFT JOIN subcategories sc       ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses ps    ON ps.product_status_id = p.product_status_id
      LEFT JOIN product_units pu       ON pu.id = p.product_unit_id
      LEFT JOIN size_units su          ON su.id = p.size_unit_id
      WHERE p.product_id = $1
      `,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบสินค้า' });

    const product = rows[0];

    const imgsQ = await db.query(
      `
      SELECT
        id, url, alt_text, is_primary, position, variant_id, created_at
      FROM product_images
      WHERE product_id = $1
      ORDER BY is_primary DESC, position ASC, id ASC
      `,
      [id]
    );
    const images = imgsQ.rows;

    product.images = images;
    const primary = images.find(i => i.is_primary && i.url);
    product.cover_image_url =
      primary?.url
      || (product.image_url || '').trim()
      || images[0]?.url
      || '';

    const useView = await hasTable('v_product_variants_live_stock');
    let variants = [];
    if (useView) {
      const hasFinal = await hasColumn('v_product_variants_live_stock', 'final_price');
      const priceExpr = hasFinal ? 'COALESCE(final_price, price_override)' : 'price_override';
      const vq = await db.query(`
        SELECT variant_id, product_id, sku,
               ${priceExpr} AS price,
               COALESCE(stock,0)::int AS stock
        FROM v_product_variants_live_stock
        WHERE product_id = $1
        ORDER BY variant_id ASC
      `, [id]);
      variants = vq.rows;
      product.live_stock = variants.reduce((s, r) => s + (Number(r.stock) || 0), 0);
      product.min_price = variants.reduce((min, r) => {
        const p = r.price == null ? null : Number(r.price);
        return (p == null) ? min : (min == null ? p : Math.min(min, p));
      }, null);
      if (product.min_price == null) product.min_price = product.selling_price;
    } else {
      const vq = await db.query(`
        SELECT variant_id, product_id, sku, NULL::numeric AS price, 0::int AS stock
        FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_id ASC
      `, [id]);
      variants = vq.rows;
      product.live_stock = 0;
      product.min_price = product.selling_price;
    }

    product.variants = variants;

    return res.json(product);
  } catch (error) {
    console.error('❌ ERROR: ดึงรายละเอียดสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * POST /api/admin/products  (รับ category_id เป็น TEXT)
 * ──────────────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    let {
      product_name, productName,
      description,
      selling_price,  sellingPrice,
      cost_price,     costPrice,
      stock_quantity, stockQuantity,
      category_id,    categoryId,
      subcategory_id, subcategoryId,

      product_unit_id,
      size_unit_id,
      size_value,

      origin,
      product_status_id, productStatusId,

      published
    } = req.body;

    product_name      = product_name ?? productName;
    selling_price     = selling_price ?? sellingPrice;
    cost_price        = cost_price ?? costPrice;
    stock_quantity    = stock_quantity ?? stockQuantity;
    category_id       = category_id ?? categoryId;
    subcategory_id    = subcategory_id ?? subcategoryId;
    product_status_id = product_status_id ?? productStatusId;

    if (!product_name || String(product_name).trim() === '') {
      return res.status(400).json({ message: 'กรุณาระบุชื่อสินค้า (product_name)' });
    }

    const sp = toNum(selling_price) ?? 0;
    const cp = toNum(cost_price) ?? 0;
    const sq = toInt(stock_quantity) ?? 0;
    const catId = category_id == null ? '' : String(category_id).trim();

    if (!catId) {
      return res.status(400).json({ message: 'กรุณาเลือกหมวดหมู่ (category_id)' });
    }
    if (sp < 0) return res.status(400).json({ message: 'selling_price ต้อง ≥ 0' });
    if (cp < 0) return res.status(400).json({ message: 'cost_price ต้อง ≥ 0' });
    if (!Number.isInteger(sq) || sq < 0) return res.status(400).json({ message: 'stock_quantity ต้องเป็นจำนวนเต็ม ≥ 0' });

    // subcategory เป็น TEXT ด้วย (ถ้ามี)
    const subId = (subcategory_id == null || String(subcategory_id).trim()==='') ? null : String(subcategory_id).trim();

    const unitId = toInt(product_unit_id);
    if (unitId == null) {
      return res.status(400).json({ message: 'กรุณาเลือกหน่วยสินค้า (product_unit_id)' });
    }

    let sizeUnitId = null;
    let sizeVal = null;
    if (size_unit_id !== undefined || size_value !== undefined) {
      sizeUnitId = size_unit_id == null ? null : toInt(size_unit_id);
      sizeVal    = size_value == null ? null : toNum(size_value);
      if (sizeVal != null && sizeUnitId == null) {
        return res.status(400).json({ message: 'มี size_value ต้องกำหนด size_unit_id' });
      }
      if (sizeVal == null && sizeUnitId != null) {
        return res.status(400).json({ message: 'มี size_unit_id ต้องกำหนด size_value' });
      }
    }

    const hasPublished = await hasColumn('products', 'published');

    const insertSql = `
      INSERT INTO products (
        product_name, description, selling_price, cost_price, stock_quantity,
        category_id, subcategory_id,
        product_unit_id, size_unit_id, size_value,
        origin, product_status_id
        ${hasPublished ? ', published' : ''}
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12${hasPublished ? ',$13' : ''})
      RETURNING product_id
    `;

    const vals = [
      String(product_name).trim(),
      description || '',
      sp, cp, sq,
      catId, subId,
      unitId, sizeUnitId, sizeVal,
      origin || '',
      product_status_id || null
    ];
    if (hasPublished) vals.push(published === undefined ? true : !!published);

    const inserted = await db.query(insertSql, vals);
    const newId = inserted.rows[0].product_id;

    const { rows } = await db.query(
      `
      SELECT 
        p.*,
        pu.unit_name AS product_unit_name,
        su.unit_name AS size_unit_name,
        c.category_name,
        sc.subcategory_name,
        ps.status_name AS product_status_name
      FROM products p
      LEFT JOIN product_categories c   ON c.category_id = p.category_id
      LEFT JOIN subcategories sc       ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses ps    ON ps.product_status_id = p.product_status_id
      LEFT JOIN product_units pu       ON pu.id = p.product_unit_id
      LEFT JOIN size_units su          ON su.id = p.size_unit_id
      WHERE p.product_id = $1
      `,
      [newId]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('❌ ERROR: เพิ่มสินค้าไม่สำเร็จ:', error);
    const msg =
      error?.code === '23503' ? 'ข้อมูลอ้างอิงไม่ถูกต้อง (FK ไม่พบ)' :
      error?.code === '23505' ? 'ข้อมูลซ้ำ (unique)' :
      'ผิดพลาดในระบบ';
    res.status(500).json({ message: msg });
  }
});

/* ──────────────────────────────────────────────────────────────
 * PUT /api/admin/products/:id  (category_id/subcategory_id = TEXT)
 * ──────────────────────────────────────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });

    const chk = await db.query(`SELECT product_id FROM products WHERE product_id = $1`, [id]);
    if (!chk.rows.length) return res.status(404).json({ message: 'ไม่พบสินค้า' });

    let {
      product_name, productName,
      description,
      selling_price,  sellingPrice,
      cost_price,     costPrice,
      stock_quantity, stockQuantity,
      category_id,    categoryId,
      subcategory_id, subcategoryId,

      product_unit_id,
      size_unit_id,
      size_value,

      origin,
      product_status_id, productStatusId,

      published
    } = req.body;

    product_name      = product_name ?? productName;
    selling_price     = selling_price ?? sellingPrice;
    cost_price        = cost_price ?? costPrice;
    stock_quantity    = stock_quantity ?? stockQuantity;
    category_id       = category_id ?? categoryId;
    subcategory_id    = subcategory_id ?? subcategoryId;
    product_status_id = product_status_id ?? productStatusId;

    const fields = [];
    const params = [];

    const push = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };
    const pushNumGE0 = (col, val, isInt = false) => {
      if (val === undefined) return;
      const n = isInt ? toInt(val) : toNum(val);
      if (n == null) return push(col, null);
      if (isInt && !Number.isInteger(n)) throw new Error(`${col} ต้องเป็นจำนวนเต็ม`);
      if (Number(n) < 0) throw new Error(`${col} ต้อง ≥ 0`);
      push(col, n);
    };

    if (product_name !== undefined) push('product_name', String(product_name).trim());
    if (description  !== undefined) push('description', description);
    pushNumGE0('selling_price', selling_price);
    pushNumGE0('cost_price',    cost_price);
    pushNumGE0('stock_quantity', stock_quantity, true);

    // 🔁 TEXT
    if (category_id    !== undefined) push('category_id', category_id == null ? null : String(category_id).trim());
    if (subcategory_id !== undefined) push('subcategory_id', subcategory_id == null ? null : String(subcategory_id).trim());

    if (origin         !== undefined) push('origin', origin);
    if (product_status_id !== undefined) push('product_status_id', product_status_id);

    // product_unit_id (เลข)
    if (product_unit_id !== undefined) {
      const unitId = toInt(product_unit_id);
      if (unitId == null) return res.status(400).json({ message: 'กรุณาเลือกหน่วยสินค้า (product_unit_id)' });
      push('product_unit_id', unitId);
    }

    // size pair
    if (size_unit_id !== undefined || size_value !== undefined) {
      const sUid = size_unit_id == null ? null : toInt(size_unit_id);
      const sVal = size_value == null ? null : toNum(size_value);
      if (sVal != null && sUid == null) return res.status(400).json({ message: 'มี size_value ต้องกำหนด size_unit_id' });
      if (sVal == null && sUid != null) return res.status(400).json({ message: 'มี size_unit_id ต้องกำหนด size_value' });
      push('size_unit_id', sUid);
      push('size_value', sVal);
    }

    const hasPublished = await hasColumn('products', 'published');
    if (hasPublished && published !== undefined) {
      push('published', !!published);
    }

    if (fields.length === 0) return res.status(400).json({ message: 'ไม่มีฟิลด์ให้แก้ไข' });

    params.push(id);
    const hasUpdatedAt = await hasColumn('products', 'updated_at');
    const setSql = `${fields.join(', ')}${hasUpdatedAt ? ', updated_at = NOW()' : ''}`;
    const updateSql = `
      UPDATE products
      SET ${setSql}
      WHERE product_id = $${params.length}
      RETURNING product_id
    `;
    await db.query(updateSql, params);

    const { rows } = await db.query(
      `
      SELECT 
        p.*,
        pu.unit_name AS product_unit_name,
        su.unit_name AS size_unit_name,
        c.category_name,
        sc.subcategory_name,
        ps.status_name AS product_status_name
      FROM products p
      LEFT JOIN product_categories c   ON c.category_id = p.category_id
      LEFT JOIN subcategories sc       ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses ps    ON ps.product_status_id = p.product_status_id
      LEFT JOIN product_units pu       ON pu.id = p.product_unit_id
      LEFT JOIN size_units su          ON su.id = p.size_unit_id
      WHERE p.product_id = $1
      `,
      [id]
    );

    res.json(rows[0]);
  } catch (error) {
    const msg = String(error.message || '');
    if (msg.includes('≥ 0') || msg.includes('จำนวนเต็ม') || msg.startsWith('กรุณา')) {
      return res.status(400).json({ message: msg });
    }
    console.error('❌ ERROR: อัปเดตสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ message: 'ผิดพลาดในระบบ' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * DELETE → Archive
 * ──────────────────────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ error: 'Invalid id' });

    const hasIsArchived = await hasColumn('products', 'is_archived');
    const hasArchivedAt = await hasColumn('products', 'archived_at');

    let result;
    if (hasIsArchived) {
      result = await db.query(
        `UPDATE products
         SET is_archived = true, archived_at = ${hasArchivedAt ? 'COALESCE(archived_at, NOW())' : 'NOW()'}
         WHERE product_id = $1 AND (is_archived = false OR is_archived IS NULL)`,
        [id]
      );
    } else if (hasArchivedAt) {
      result = await db.query(
        `UPDATE products
         SET archived_at = NOW()
         WHERE product_id = $1 AND archived_at IS NULL`,
        [id]
      );
    } else {
      return res.status(400).json({ error: 'Archive not supported: no is_archived/archived_at column' });
    }

    if (!result.rowCount) {
      return res.status(404).json({ error: 'ไม่พบสินค้า หรือถูกเก็บไว้แล้ว' });
    }

    res.json({ ok: true, archived: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'ลบไม่ได้: สินค้าถูกใช้อยู่ในคำสั่งซื้อ',
        code: 'PRODUCT_IN_USE'
      });
    }
    console.error('❌ ERROR: เก็บสินค้า (archive) ไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Archive error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * UNARCHIVE
 * ──────────────────────────────────────────────────────────── */
router.patch('/:id/unarchive', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ error: 'Invalid id' });

    const hasIsArchived = await hasColumn('products', 'is_archived');
    const hasArchivedAt = await hasColumn('products', 'archived_at');
    const hasUpdatedAt  = await hasColumn('products', 'updated_at');

    let result;
    if (hasIsArchived) {
      result = await db.query(
        `UPDATE products
         SET is_archived = false${hasArchivedAt ? ', archived_at = NULL' : ''}${hasUpdatedAt ? ', updated_at = NOW()' : ''}
         WHERE product_id = $1`,
        [id]
      );
    } else if (hasArchivedAt) {
      result = await db.query(
        `UPDATE products
         SET archived_at = NULL${hasUpdatedAt ? ', updated_at = NOW()' : ''}
         WHERE product_id = $1`,
        [id]
      );
    } else {
      return res.status(400).json({ error: 'Unarchive not supported: no is_archived/archived_at column' });
    }

    if (!result.rowCount) return res.status(404).json({ error: 'ไม่พบสินค้า' });
    res.json({ ok: true, unarchived: true });
  } catch (error) {
    console.error('❌ ERROR: กู้คืนสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Unarchive error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * PUBLISH / UNPUBLISH (ถ้ามีคอลัมน์ published)
 * ──────────────────────────────────────────────────────────── */
router.patch('/:id/publish', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });
    const hasPub = await hasColumn('products', 'published');
    if (!hasPub) return res.status(400).json({ message: 'published column not found' });
    await db.query(`UPDATE products SET published = TRUE WHERE product_id = $1`, [id]);
    res.json({ ok: true, published: true });
  } catch (e) {
    console.error('❌ publish error:', e);
    res.status(500).json({ message: 'Publish error' });
  }
});
router.patch('/:id/unpublish', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });
    const hasPub = await hasColumn('products', 'published');
    if (!hasPub) return res.status(400).json({ message: 'published column not found' });
    await db.query(`UPDATE products SET published = FALSE WHERE product_id = $1`, [id]);
    res.json({ ok: true, published: false });
  } catch (e) {
    console.error('❌ unpublish error:', e);
    res.status(500).json({ message: 'Unpublish error' });
  }
});

/* ──────────────────────────────────────────────────────────────
 * รูปสินค้าหลายรูป / เดี่ยว
 * ──────────────────────────────────────────────────────────── */
function normalizeImagePayload(img) {
  if (!img || typeof img !== 'object') return null;
  const url = (img.url || img.image_url || '').trim();
  if (!url) return null;
  const alt_text = (img.alt_text || img.alt || null);
  const is_primary = Boolean(img.is_primary);
  const position = img.position != null ? Number(img.position) : null;
  const variant_id = img.variant_id != null ? Number(img.variant_id) : null;
  return { url, alt_text, is_primary, position, variant_id };
}
async function unsetPrimaryExcept(client, productId) {
  await client.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1`, [productId]);
}

router.post('/:id/images', async (req, res) => {
  const productId = toInt(req.params.id);
  if (productId == null) return res.status(400).json({ error: 'Invalid product id' });

  const list = Array.isArray(req.body?.images) ? req.body.images : [];
  if (list.length === 0) return res.status(400).json({ error: 'กรุณาส่ง images เป็น array อย่างน้อย 1 รายการ' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const hasPrimary = list.some(i => i && i.is_primary);
    if (hasPrimary) await unsetPrimaryExcept(client, productId);

    const inserted = [];
    for (const raw of list) {
      const img = normalizeImagePayload(raw);
      if (!img) continue;

      const q = `
        INSERT INTO product_images (product_id, url, alt_text, is_primary, position, variant_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, product_id, url, alt_text, is_primary, position, variant_id, created_at
      `;
      const params = [
        productId,
        img.url,
        img.alt_text,
        img.is_primary === true,
        img.position != null ? Number(img.position) : null,
        img.variant_id != null ? Number(img.variant_id) : null
      ];
      const { rows } = await client.query(q, params);
      inserted.push(rows[0]);
    }

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, images: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR: บันทึกรูปแบบ bulk ไม่สำเร็จ:', err);
    return res.status(500).json({ error: 'Save images error' });
  } finally {
    client.release();
  }
});

async function insertSingleImage(payload, res) {
  const img = normalizeImagePayload(payload);
  const productId = toInt(payload?.product_id);
  if (productId == null) return res.status(400).json({ error: 'กรุณาระบุ product_id ให้ถูกต้อง' });
  if (!img) return res.status(400).json({ error: 'กรุณาระบุ url ของรูป' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (img.is_primary === true) await unsetPrimaryExcept(client, productId);

    const q = `
      INSERT INTO product_images (product_id, url, alt_text, is_primary, position, variant_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, product_id, url, alt_text, is_primary, position, variant_id, created_at
    `;
    const params = [
      productId,
      img.url,
      img.alt_text,
      img.is_primary === true,
      img.position != null ? Number(img.position) : null,
      img.variant_id != null ? Number(img.variant_id) : null
    ];
    const { rows } = await client.query(q, params);

    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR: บันทึกรูป (เดี่ยว) ไม่สำเร็จ:', err);
    return res.status(500).json({ error: 'Save image error' });
  } finally {
    client.release();
  }
}
router.post('/product-images', async (req, res) => insertSingleImage(req.body, res));
router.post('/../product-images', async (req, res) => insertSingleImage(req.body, res));

module.exports = router;
