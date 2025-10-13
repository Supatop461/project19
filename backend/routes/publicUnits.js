// backend/routes/publicUnits.js
// ✅ Public Units — /api/units , /api/units/options
// - รองรับ schema ยืดหยุ่น (id | unit_id, unit_name | name)
// - รวม category_ids (array) จาก product_unit_categories ถ้ามี
// - กรองเฉพาะที่เผยแพร่/แสดงผลได้

const express = require('express');
const router = express.Router();
let db; try { db = require('../db'); } catch { db = require('../db/db'); }

const nocache = (_req, res, next) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma','no-cache'); res.set('Expires','0');
  next();
};

async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows?.[0]?.ok;
}
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

async function resolveUnitKeys() {
  const hasUnitId = await hasColumn('product_units','unit_id');
  const hasId     = await hasColumn('product_units','id');

  const hasCode   = await hasColumn('product_units','code');
  const hasUCode  = await hasColumn('product_units','unit_code');

  const nameCol   = (await hasColumn('product_units','unit_name')) ? 'unit_name'
                    : (await hasColumn('product_units','name'))     ? 'name' : null;

  const descCol   = (await hasColumn('product_units','description')) ? 'description' : null;

  const pubCol    = (await hasColumn('product_units','is_published')) ? 'is_published'
                    : (await hasColumn('product_units','published'))   ? 'published' : null;
  const visCol    = (await hasColumn('product_units','is_visible')) ? 'is_visible' : null;
  const actCol    = (await hasColumn('product_units','is_active'))  ? 'is_active'  : null;

  const catIdCol  = (await hasColumn('product_units','category_id'))  ? 'category_id'  : null;

  return {
    idCol:  hasUnitId ? 'unit_id' : (hasId ? 'id' : null),
    codeCol: hasCode ? 'code' : (hasUCode ? 'unit_code' : null),
    nameCol, descCol, pubCol, visCol, actCol, catIdCol
  };
}

async function buildCategoryAggFragment(idCol) {
  const hasPUC = await hasTable('product_unit_categories');
  if (!hasPUC || !idCol) return { join: '', sel: `NULL::text[] AS category_ids` };

  const join = `
    LEFT JOIN LATERAL (
      SELECT ARRAY_AGG(puc.category_id::text ORDER BY puc.category_id) AS category_ids
      FROM product_unit_categories puc
      WHERE puc.unit_id = pu.${idCol}
    ) _puc ON TRUE
  `;
  return { join, sel: `COALESCE(_puc.category_ids, ARRAY[]::text[]) AS category_ids` };
}

/* ---------- LIST (public) ---------- */
router.get('/units', nocache, async (req, res) => {
  try {
    const { q } = req.query;
    const K = await resolveUnitKeys();

    const cols = [];
    if (K.idCol)   cols.push(`pu.${K.idCol} AS ${K.idCol}`);
    if (K.codeCol) cols.push(`pu.${K.codeCol} AS code`);
    cols.push(K.nameCol ? `pu.${K.nameCol} AS unit_name` : `''::text AS unit_name`);
    if (K.descCol) cols.push(`pu.${K.descCol} AS description`);
    if (K.catIdCol) cols.push(`pu.${K.catIdCol} AS category_id`);

    const catAgg = await buildCategoryAggFragment(K.idCol);
    cols.push(catAgg.sel);

    const where = [];
    const params = [];

    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      const p = `$${params.length}`;
      if (K.codeCol && K.nameCol) where.push(`(${K.codeCol} ILIKE ${p} OR ${K.nameCol} ILIKE ${p})`);
      else if (K.nameCol)         where.push(`${K.nameCol} ILIKE ${p}`);
      else if (K.codeCol)         where.push(`${K.codeCol} ILIKE ${p}`);
    }
    if (K.visCol) where.push(`COALESCE(pu.${K.visCol}, TRUE) = TRUE`);
    if (K.actCol) where.push(`COALESCE(pu.${K.actCol}, TRUE) = TRUE`);
    if (K.pubCol) where.push(`COALESCE(pu.${K.pubCol}, TRUE) = TRUE`);

    const sql = `
      SELECT ${cols.join(', ')}
      FROM product_units pu
      ${catAgg.join}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY pu.${K.nameCol || K.codeCol || K.idCol} NULLS LAST, pu.${K.idCol || K.codeCol || '1'}
    `;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('public product_units list error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- OPTIONS (dropdown) ---------- */
router.get('/units/options', nocache, async (_req, res) => {
  try {
    const K = await resolveUnitKeys();
    const idSel   = K.idCol ? `pu.${K.idCol}` : `NULL::int`;
    const nameSel = K.nameCol ? `pu.${K.nameCol}` : (K.codeCol ? `pu.${K.codeCol}` : `''::text`);

    const conds = [];
    if (K.visCol) conds.push(`COALESCE(pu.${K.visCol}, TRUE)=TRUE`);
    if (K.actCol) conds.push(`COALESCE(pu.${K.actCol}, TRUE)=TRUE`);
    if (K.pubCol) conds.push(`COALESCE(pu.${K.pubCol}, TRUE)=TRUE`);

    const { rows } = await db.query(`
      SELECT ${idSel} AS id, ${nameSel} AS name
      FROM product_units pu
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY ${K.nameCol || K.codeCol || K.idCol}, ${K.idCol || K.codeCol || '1'}
    `);
    res.json(rows);
  } catch (e) {
    console.error('public product_units options error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

console.log('▶ publicUnits router LOADED');
module.exports = router;
