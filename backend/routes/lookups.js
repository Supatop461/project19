// backend/routes/lookups.js
// ส่ง lookups สำหรับหน้าแอดมิน (categories / subcategories / product_units / size_units / order_statuses)
// ไม่แก้ schema — ตรวจคอลัมน์ก่อน แล้วประกอบ SQL ให้เหมาะกับแต่ละฐานข้อมูล

const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

/* ---------- helpers ---------- */
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

function boolFilter(col, wantTrue) {
  if (!wantTrue) return '1=1';
  return `COALESCE(${col}, TRUE) = TRUE`;
}

/* ---------- queries (compose by schema) ---------- */
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

async function getUnits(table, idAlias, wantPublished) {
  const hasIsPub = await hasColumn(table, 'is_published');
  const cols = [
    'id AS ' + idAlias,
    'unit_name',
    hasIsPub ? 'COALESCE(is_published, TRUE) AS is_published' : 'TRUE AS is_published'
  ].join(', ');
  const where = hasIsPub ? `WHERE ${boolFilter('is_published', wantPublished)}` : '';
  const sql = `
    SELECT ${cols}
    FROM ${table}
    ${where}
    ORDER BY unit_name ASC, id ASC
  `;
  const { rows } = await db.query(sql);
  return rows;
}

async function getOrderStatuses(wantActive) {
  const hasStatusName = await hasColumn('order_statuses', 'status_name');
  const hasName       = await hasColumn('order_statuses', 'name');
  const hasIsActive   = await hasColumn('order_statuses', 'is_active');

  // map ชื่อคอลัมน์สถานะให้เหลือชื่อเดียวคือ status_name
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

/* ---------- route ---------- */
router.get('/lookups', async (req, res) => {
  // 🔒 กัน cache: บังคับให้ดึงข้อมูลใหม่ทุกครั้ง (แก้ปัญหา 304/Not Modified)
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
      getUnits('size_units', 'size_unit_id', wantPublished),
      getOrderStatuses(wantPublished) // ใช้ตัวเดียวเป็น active filter
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
