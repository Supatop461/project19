// backend/routes/orders.js
// Minimal Order routes — tailored for your schema (order_statuses has order_status_id: pending|o1|o2|completed)

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

// ---- db loader (support ../db and ../db/db) ----
let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

// ---- auth middleware (fallback no-op if missing) ----
const { requireAuth, requireRole } = (() => {
  try {
    return require('../middleware/auth');
  } catch {
    return {
      requireAuth: (_req, _res, next) => next(),
      requireRole: (_role) => (_req, _res, next) => next(),
    };
  }
})();

// ---- helpers ----
async function hasColumn(table, col) {
  const sql = `
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `;
  const { rows } = await db.query(sql, [table, col]);
  return rows.length > 0;
}
function num(n, d = 0) { const v = Number(n); return Number.isFinite(v) ? v : d; }

// ---- upload (slips) ----
const SLIP_DIR = path.join(process.cwd(), 'uploads', 'slips');
fs.mkdirSync(SLIP_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SLIP_DIR),
  filename: (_req, file, cb) => {
    const ext = (file.originalname || '').split('.').pop() || 'jpg';
    cb(null, `slip_${Date.now()}.${ext}`);
  },
});
const upload = multer({ storage });

// ===================================================================
// POST /api/orders  (create)
// body: { address: object|string, items:[{variantId, quantity, price}], shipping_fee }
// NOTE: รอบแรกยอมรับราคาและ qty จาก client เพื่อความเร็ว (อัปเกรดภายหลังได้)
// ===================================================================
router.post('/api/orders', requireAuth, async (req, res) => {
  const userId = req.user?.user_id || req.user?.id || null;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const { address, items, shipping_fee } = req.body || {};
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return res.status(400).json({ message: 'No items' });

    // columns in orders (dynamic)
    const hasStatusText   = await hasColumn('orders', 'status');               // text
    const hasStatusId     = await hasColumn('orders', 'order_status_id');      // FK to order_statuses
    const hasSlip         = await hasColumn('orders', 'payment_slip_url');     // text
    const hasAddress      = await hasColumn('orders', 'address');              // text/jsonb
    const hasGrandTotal   = await hasColumn('orders', 'grand_total');
    const hasShippingFee  = await hasColumn('orders', 'shipping_fee');
    const hasTotalPrice   = await hasColumn('orders', 'total_price');
    const hasUpdatedAt    = await hasColumn('orders', 'updated_at');
    const hasCreatedAt    = await hasColumn('orders', 'created_at');

    // sum
    let total = 0;
    const safe = arr.map(x => {
      const q = Math.max(1, num(x.quantity, 1));
      const p = Math.max(0, num(x.price, 0));
      total += q * p;
      return {
        variant_id: x.variantId ?? x.variant_id,
        quantity: q,
        price: p,
        subtotal: q * p,
      };
    });
    const ship = Math.max(0, num(shipping_fee, 0));
    const grand = total + ship;

    // build INSERT orders
    const cols = ['user_id'];
    const vals = [userId];

    if (hasTotalPrice)   { cols.push('total_price');   vals.push(total); }
    if (hasShippingFee)  { cols.push('shipping_fee');  vals.push(ship); }
    if (hasGrandTotal)   { cols.push('grand_total');   vals.push(grand); }

    if (hasAddress) {
      cols.push('address');
      vals.push(typeof address === 'object' ? JSON.stringify(address) : String(address || ''));
    }
    if (hasSlip)         { cols.push('payment_slip_url'); vals.push(null); }
    if (hasStatusText)   { cols.push('status'); vals.push('pending'); }
    if (hasStatusId)     { cols.push('order_status_id'); vals.push('pending'); } // ← ใช้ id ตรง schema คุณ
    if (hasCreatedAt)    { cols.push('created_at'); vals.push(new Date()); }
    if (hasUpdatedAt)    { cols.push('updated_at'); vals.push(new Date()); }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sqlOrder = `INSERT INTO orders (${cols.join(', ')}) VALUES (${placeholders}) RETURNING order_id`;
    const { rows: orows } = await db.query(sqlOrder, vals);
    const orderId = orows[0].order_id;

    // INSERT order_details (product_variant_id, quantity, price, subtotal)
    // หมายเหตุ: ใน DB ของคุณชื่อคอลัมน์คือ order_details.product_variant_id
    const itemSQL = `
      INSERT INTO order_details (order_id, product_variant_id, quantity, price, subtotal)
      VALUES ($1, $2, $3, $4, $5)
    `;
    for (const it of safe) {
      await db.query(itemSQL, [orderId, it.variant_id, it.quantity, it.price, it.subtotal]);
    }

    return res.json({ order_id: orderId, status_id: 'pending', total_price: total, shipping_fee: ship, grand_total: grand });
  } catch (err) {
    console.error('create order error:', err);
    return res.status(500).json({ message: 'Create order failed' });
  }
});

// ===================================================================
// POST /api/orders/:id/slip  (upload payment slip)
// form-data: slip=<file>
// ===================================================================
router.post('/api/orders/:id/slip', requireAuth, upload.single('slip'), async (req, res) => {
  const orderId = req.params.id;
  const f = req.file;
  if (!f) return res.status(400).json({ message: 'No file' });

  try {
    const hasSlip = await hasColumn('orders', 'payment_slip_url');
    if (!hasSlip) return res.status(400).json({ message: 'orders.payment_slip_url missing' });

    const rel = `/uploads/slips/${f.filename}`;
    const hasUpdatedAt = await hasColumn('orders', 'updated_at');

    const vals = [rel, orderId];
    let sql = `UPDATE orders SET payment_slip_url=$1 WHERE order_id=$2`;
    if (hasUpdatedAt) {
      sql = `UPDATE orders SET payment_slip_url=$1, updated_at=$3 WHERE order_id=$2`;
      vals.push(new Date());
    }
    await db.query(sql, vals);
    return res.json({ ok: true, payment_slip_url: rel });
  } catch (err) {
    console.error('upload slip error:', err);
    return res.status(500).json({ message: 'Upload failed' });
  }
});

// ===================================================================
// GET /api/orders/me  (list my orders)
// ===================================================================
router.get('/api/orders/me', requireAuth, async (req, res) => {
  const userId = req.user?.user_id || req.user?.id || null;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const sql = `
      SELECT
        o.order_id, o.user_id,
        o.total_price, o.shipping_fee, o.grand_total,
        o.payment_slip_url, o.status, o.order_status_id,
        o.created_at, o.updated_at,
        COALESCE(json_agg(json_build_object(
          'product_variant_id', d.product_variant_id,
          'quantity', d.quantity,
          'price', d.price,
          'subtotal', d.subtotal
        ) ORDER BY d.product_variant_id)
        FILTER (WHERE d.product_variant_id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_details d ON d.order_id = o.order_id
      WHERE o.user_id = $1
      GROUP BY o.order_id
      ORDER BY o.order_id DESC
      LIMIT 200
    `;
    const { rows } = await db.query(sql, [userId]);
    return res.json(rows);
  } catch (err) {
    console.error('get my orders error:', err);
    return res.status(500).json({ message: 'Failed' });
  }
});

// ===================================================================
// GET /api/admin/orders  (admin list)
// ===================================================================
router.get('/api/admin/orders', requireRole('admin'), async (_req, res) => {
  try {
    const sql = `
      SELECT
        o.order_id, o.user_id,
        o.total_price, o.shipping_fee, o.grand_total,
        o.payment_slip_url, o.status, o.order_status_id,
        o.created_at, o.updated_at,
        COALESCE(json_agg(json_build_object(
          'product_variant_id', d.product_variant_id,
          'quantity', d.quantity,
          'price', d.price,
          'subtotal', d.subtotal
        ) ORDER BY d.product_variant_id)
        FILTER (WHERE d.product_variant_id IS NOT NULL), '[]') AS items
      FROM orders o
      LEFT JOIN order_details d ON d.order_id = o.order_id
      GROUP BY o.order_id
      ORDER BY o.order_id DESC
      LIMIT 500
    `;
    const { rows } = await db.query(sql);
    return res.json(rows);
  } catch (err) {
    console.error('admin list orders error:', err);
    return res.status(500).json({ message: 'Failed' });
  }
});

// ===================================================================
// PUT /api/admin/orders/:id/status  (admin update status)
// body: { order_status_id: "o1" }   ← ใช้ id ตามตารางคุณ
// ===================================================================
router.put('/api/admin/orders/:id/status', requireRole('admin'), async (req, res) => {
  const orderId = req.params.id;
  const { order_status_id } = req.body || {};
  if (!order_status_id) return res.status(400).json({ message: 'Missing order_status_id' });

  try {
    const hasStatusText = await hasColumn('orders', 'status');
    const hasStatusId   = await hasColumn('orders', 'order_status_id');
    const hasUpdatedAt  = await hasColumn('orders', 'updated_at');

    const vals = [order_status_id, orderId];
    let setSql = '';

    if (hasStatusId)   setSql += (setSql ? ', ' : '') + `order_status_id=$1`;
    if (hasStatusText) setSql += (setSql ? ', ' : '') + `status=$1`; // ถ้าคุณอยาก map ชื่อไทยภายหลังค่อยอัปเกรด
    let sql = `UPDATE orders SET ${setSql} WHERE order_id=$2`;

    if (hasUpdatedAt) {
      vals.push(new Date());
      sql = `UPDATE orders SET ${setSql}, updated_at=$3 WHERE order_id=$2`;
    }

    await db.query(sql, vals);
    return res.json({ ok: true });
  } catch (err) {
    console.error('admin update status error:', err);
    return res.status(500).json({ message: 'Failed' });
  }
});

module.exports = router;
