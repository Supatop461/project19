const express = require('express');
const router = express.Router();
let db; try { db = require('../db'); } catch { db = require('../db/db'); }

// (ยกมาจากไฟล์ adminUnits: hasColumn + nocache แบบย่อเฉพาะที่ใช้)
const nocache = (_req, res, next) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma','no-cache'); res.set('Expires','0');
  next();
};
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

/* ---------- LIST (public) ---------- */
// GET /api/units?q=&only_visible=1
router.get('/units', nocache, async (req, res) => {
  try {
    const { q, only_visible } = req.query;

    const hasCode     = await hasColumn('product_units', 'code');
    const hasName     = await hasColumn('product_units', 'unit_name');
    const hasDesc     = await hasColumn('product_units', 'description');
    const hasActive   = await hasColumn('product_units', 'is_active');
    const hasVisible  = await hasColumn('product_units', 'is_visible');
    const hasCatId    = await hasColumn('product_units', 'category_id');
    const hasPub      = await hasColumn('product_units', 'is_published');

    const where = [];
    const params = [];

    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      if (hasCode && hasName) where.push(`(code ILIKE ${p} OR unit_name ILIKE ${p})`);
      else if (hasName)        where.push(`unit_name ILIKE ${p}`);
      else if (hasCode)        where.push(`code ILIKE ${p}`);
    }
    // public ควรเห็นเฉพาะของที่ “แสดงผล/เผยแพร่”
    if (hasVisible) where.push(`COALESCE(is_visible,true)=true`);
    if (hasActive)  where.push(`COALESCE(is_active,true)=true`);
    if (hasPub)     where.push(`COALESCE(is_published,true)=true`);

    const sql = `
      SELECT
        unit_id,
        ${hasCode   ? 'code' : 'NULL::text AS code'},
        ${hasName   ? 'unit_name' : 'NULL::text AS unit_name'},
        ${hasDesc   ? 'description' : 'NULL::text AS description'},
        ${hasCatId  ? 'category_id' : 'NULL::text AS category_id'}
      FROM product_units
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY unit_name NULLS LAST, unit_id
    `;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('public product_units list error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- OPTIONS (public dropdown) ---------- */
// GET /api/units/options
router.get('/units/options', nocache, async (_req, res) => {
  try {
    const hasVisible = await hasColumn('product_units', 'is_visible');
    const hasActive  = await hasColumn('product_units', 'is_active');
    const hasName    = await hasColumn('product_units', 'unit_name');

    const conds = [];
    if (hasVisible) conds.push(`COALESCE(is_visible,true)=true`);
    if (hasActive)  conds.push(`COALESCE(is_active,true)=true`);

    const { rows } = await db.query(`
      SELECT unit_id AS id, ${hasName ? 'unit_name' : 'code'} AS name
      FROM product_units
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY ${hasName ? 'unit_name' : 'code'}, unit_id
    `);
    res.json(rows);
  } catch (e) {
    console.error('public product_units options error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

console.log('▶ publicUnits router LOADED');
module.exports = router;
