// backend/routes/adminOrders.js
// Admin Orders Router — paginated list + flexible columns

const express = require('express');
const router = express.Router();
const db = require('../db'); // ต้องมีโมดูล db ที่ export { query }

let detected = null;
async function detectColumns() {
  if (detected) return detected;

  async function has(col) {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='orders' AND column_name=$1
       LIMIT 1`,
      [col]
    );
    return rows.length > 0;
  }

  const idCol      = (await has('order_id')) ? 'order_id' : (await has('id')) ? 'id' : null;
  const userCol    = (await has('user_id')) ? 'user_id' : (await has('customer_id')) ? 'customer_id' : null;
  const totalCol   = (await has('grand_total')) ? 'grand_total'
                   : (await has('total')) ? 'total'
                   : (await has('total_price')) ? 'total_price' : null;
  const shipCol    = (await has('shipping_fee')) ? 'shipping_fee'
                   : (await has('shipping_cost')) ? 'shipping_cost' : null;
  const priceCol   = (await has('total_price')) ? 'total_price'
                   : (await has('subtotal')) ? 'subtotal' : null;
  const statusCol  = (await has('status')) ? 'status'
                   : (await has('order_status_id')) ? 'order_status_id' : null;
  const slipCol    = (await has('payment_slip_url')) ? 'payment_slip_url'
                   : (await has('slip_url')) ? 'slip_url' : null;
  const createdCol = (await has('created_at')) ? 'created_at'
                   : (await has('createdAt')) ? 'createdAt' : null;
  const updatedCol = (await has('updated_at')) ? 'updated_at'
                   : (await has('updatedAt')) ? 'updatedAt' : null;

  detected = { idCol, userCol, totalCol, shipCol, priceCol, statusCol, slipCol, createdCol, updatedCol };
  return detected;
}

router.get('/', async (req, res) => {
  try {
    if (!db) return res.json({ items: [], total: 0, limit: 20, offset: 0 });

    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const q      = (req.query.q || '').trim();
    const status = (req.query.status || '').trim();

    const cols = await detectColumns();

    const selectCols = [
      cols.idCol      ? `${cols.idCol} AS order_id` : 'NULL::int AS order_id',
      cols.userCol    ? `${cols.userCol} AS user_id` : 'NULL::int AS user_id',
      cols.priceCol   ? `${cols.priceCol} AS total_price` : 'NULL::numeric AS total_price',
      cols.shipCol    ? `${cols.shipCol} AS shipping_fee` : 'NULL::numeric AS shipping_fee',
      cols.totalCol   ? `${cols.totalCol} AS grand_total` : 'NULL::numeric AS grand_total',
      cols.statusCol  ? `${cols.statusCol} AS status` : 'NULL::text AS status',
      cols.slipCol    ? `${cols.slipCol} AS payment_slip_url` : 'NULL::text AS payment_slip_url',
      cols.createdCol ? `${cols.createdCol} AS created_at` : 'NULL::timestamptz AS created_at',
      cols.updatedCol ? `${cols.updatedCol} AS updated_at` : 'NULL::timestamptz AS updated_at',
    ].join(', ');

    const whereParts = [];
    const params = [];

    if (q && cols.idCol)     { params.push(`%${q}%`); whereParts.push(`CAST(${cols.idCol} AS TEXT) ILIKE $${params.length}`); }
    if (q && cols.statusCol) { params.push(`%${q}%`); whereParts.push(`${cols.statusCol} ILIKE $${params.length}`); }
    if (status && cols.statusCol) { params.push(status); whereParts.push(`${cols.statusCol} = $${params.length}`); }

    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' OR ')}` : '';

    const orderBy = cols.updatedCol ? `${cols.updatedCol} DESC NULLS LAST`
                 : cols.createdCol ? `${cols.createdCol} DESC NULLS LAST`
                 : cols.idCol ? `${cols.idCol} DESC` : '1';

    const { rows: cnt } = await db.query(`SELECT COUNT(*)::int AS n FROM orders ${whereSql}`, params);
    const total = cnt?.[0]?.n || 0;

    params.push(limit);
    params.push(offset);

    const { rows } = await db.query(
      `SELECT ${selectCols}
       FROM orders
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );

    res.json({ items: rows, total, limit, offset });
  } catch (err) {
    console.error('adminOrders GET / error:', err);
    res.status(500).json({ message: 'internal_error' });
  }
});

module.exports = router;
