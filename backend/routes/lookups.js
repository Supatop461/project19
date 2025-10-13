// backend/routes/lookups.js
// ✅ ส่ง lookups สำหรับหน้าแอดมิน: categories / subcategories / product_units / size_units / order_statuses
// - รองรับ schema ยืดหยุ่น (id | unit_id, unit_name | name)
// - ไม่ยุ่งกับตารางกลาง (พอสำหรับ dropdown/lookup)

const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}
async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows?.[0]?.ok;
}
function boolFilter(col, wantTrue) {
  if (!wantTrue) return '1=1';
  return `COALESCE(${col}, TRUE) = TRUE`;
}

/* ---------- Product Categories ---------- */
async function getProductCategories() {
  const hasIsPub = await hasColumn('product_categories', 'is_published');
  const cols = [
    'category_id',
    'category_name',
    'image_url',
    hasIsPub ? 'COALESCE(is_published, TRUE) AS is_published' : 'TRUE AS is_published'
  ].join(', ');
  const sql = `
    SELECT ${cols}
    FROM product_categories
    ORDER BY category_name ASC, category_id ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

/* ---------- Subcategories ---------- */
async function getSubcategories(wantPublished) {
  const hasIsPub = await hasColumn('subcategories', 'is_published');
  const cols = [
    'subcategory_id',
    'category_id',
    'subcategory_name',
    'image_url',
    hasIsPub ? 'COALESCE(is_published, TRUE) AS is_published' : 'TRUE AS is_published'
  ].join(', ');
  const where = hasIsPub ? `WHERE ${boolFilter('is_published', wantPublished)}` : '';
  const sql = `
    SELECT ${cols}
    FROM subcategories
    ${where}
    ORDER BY subcategory_name ASC, subcategory_id ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

/* ---------- Units (generic for product_units & size_units) ---------- */
async function getUnits(table, idAlias, wantPublished) {
  if (!(await hasTable(table))) return [];

  const hasUnitId = await hasColumn(table, 'unit_id');
  const hasId     = await hasColumn(table, 'id');
  const idCol     = hasUnitId ? 'unit_id' : (hasId ? 'id' : null);

  const hasUName  = await hasColumn(table, 'unit_name');
  const hasName   = await hasColumn(table, 'name');
  const nameCol   = hasUName ? 'unit_name' : (hasName ? 'name' : null);

  const hasIsPub  = await hasColumn(table, 'is_published');

  const cols = [
    idCol ? `${idCol} AS ${idAlias}` : `NULL::int AS ${idAlias}`,
    nameCol ? `${nameCol} AS unit_name` : `''::text AS unit_name`,
    hasIsPub ? 'COALESCE(is_published, TRUE) AS is_published' : 'TRUE AS is_published'
  ].join(', ');

  const where = hasIsPub ? `WHERE ${boolFilter('is_published', wantPublished)}` : '';
  const sql = `
    SELECT ${cols}
    FROM ${table}
    ${where}
    ORDER BY ${nameCol || idCol || '1'} ASC, ${idCol || '1'} ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

/* ---------- Order Statuses ---------- */
async function getOrderStatuses(wantActive) {
  const hasStatusName = await hasColumn('order_statuses', 'status_name');
  const hasName       = await hasColumn('order_statuses', 'name');
  const hasIsActive   = await hasColumn('order_statuses', 'is_active');

  const statusLabel = hasStatusName
    ? 'status_name'
    : (hasName ? 'name AS status_name' : `'Status' AS status_name`);

  const cols = [
    'order_status_id AS status_code',
    statusLabel,
    hasIsActive ? 'COALESCE(is_active, TRUE) AS is_active' : 'TRUE AS is_active'
  ].join(', ');

  const where = hasIsActive ? `WHERE ${boolFilter('is_active', wantActive)}` : '';
  const sql = `
    SELECT ${cols}
    FROM order_statuses
    ${where}
    ORDER BY order_status_id ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

/* ---------- Route ---------- */
router.get('/lookups', async (req, res) => {
  // กัน cache
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  try {
    const wantPublished = req.query.published === '1' || req.query.published === 'true';

    const [
      product_categories,
      subcategories,
      product_units,
      size_units,
      order_statuses
    ] = await Promise.all([
      getProductCategories(),
      getSubcategories(wantPublished),
      getUnits('product_units', 'unit_id', wantPublished),
      getUnits('size_units',    'size_unit_id', wantPublished),
      getOrderStatuses(wantPublished)
    ]);

    res.json({
      ok: true,
      product_categories,
      subcategories,
      product_units,
      size_units,
      order_statuses,
    });
  } catch (e) {
    console.error('[lookups] error:', e);
    res.status(500).json({ ok: false, message: 'Lookups fetch error' });
  }
});

module.exports = router;
