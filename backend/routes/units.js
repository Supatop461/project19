// backend/routes/units.js
const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

console.log('▶ units router LOADED');

/* ---------- cache control ---------- */
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache'); res.set('Expires', '0');
  res.removeHeader?.('ETag'); res.removeHeader?.('Last-Modified');
  next();
});

/* ---------- helpers ---------- */
async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) AS reg`, [table]);
  return !!rows?.[0]?.reg;
}
async function hasCol(table, col) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return rows.length > 0;
}

/* =======================================================================
   GET /api/units
   - รองรับ q, published(1|0|all), limit, offset
   - คืนข้อมูลหน่วย + category_ids (array) + categories (json array) ถ้ามีตารางกลาง
======================================================================= */
router.get('/', async (req, res) => {
  try {
    const T = 'product_units';
    if (!(await hasTable(T))) return res.json([]);

    // params
    const qParam       = String(req.query.q ?? '').trim();
    const publishedArg = String(req.query.published ?? 'all').toLowerCase(); // 1|0|all
    const limit        = Math.min(parseInt(req.query.limit  ?? '500', 10) || 50, 1000);
    const offset       = Math.max(parseInt(req.query.offset ?? '0',   10) || 0, 0);

    // columns
    const hasId      = await hasCol(T, 'unit_id');
    const hasIdAlt   = await hasCol(T, 'id');
    const hasName    = await hasCol(T, 'unit_name');
    const hasDesc    = await hasCol(T, 'description');
    const hasCode    = await hasCol(T, 'code');
    const hasCat     = await hasCol(T, 'category_id'); // legacy single
    const hasPub     = await hasCol(T, 'is_published');
    const hasActive  = await hasCol(T, 'is_active');
    const hasVisible = await hasCol(T, 'is_visible');
    const hasCreated = await hasCol(T, 'created_at');
    const hasUpdated = await hasCol(T, 'updated_at');

    // m2m tables
    const hasPUC     = await hasTable('product_unit_categories');
    const hasPCat    = await hasTable('product_categories');

    // SELECT base parts
    const parts = [];
    // PK/ID as unit_id
    if (hasId) parts.push('unit_id AS unit_id');
    else if (hasIdAlt) parts.push('id AS unit_id');
    else parts.push('NULL::int AS unit_id');

    parts.push(hasName ? 'unit_name' : 'NULL::text AS unit_name');
    parts.push(hasDesc ? 'description' : 'NULL::text AS description');
    parts.push(hasCode ? 'code' : 'NULL::text AS code');

    // legacy single category column (ยังคืนไว้เพื่อ compat)
    parts.push(hasCat ? 'category_id' : 'NULL::text AS category_id');

    parts.push(hasActive  ? 'COALESCE(is_active,  TRUE) AS is_active'  : 'TRUE AS is_active');
    parts.push(hasVisible ? 'COALESCE(is_visible, TRUE) AS is_visible' : 'TRUE AS is_visible');
    parts.push(hasPub     ? 'COALESCE(is_published, TRUE) AS is_published' : 'TRUE AS is_published');
    parts.push(hasCreated ? 'created_at' : 'NULL::timestamptz AS created_at');
    parts.push(hasUpdated ? 'updated_at' : 'NULL::timestamptz AS updated_at');

    // WHERE
    const conds = [];
    const vals  = [];
    if (qParam) {
      vals.push(`%${qParam}%`);
      const p = `$${vals.length}`;
      if (hasName && hasCode) conds.push(`(unit_name ILIKE ${p} OR code ILIKE ${p})`);
      else if (hasName)       conds.push(`unit_name ILIKE ${p}`);
      else if (hasCode)       conds.push(`code ILIKE ${p}`);
    }
    if (hasPub) {
      if (publishedArg === '1' || publishedArg === 'true') {
        vals.push(true);  conds.push(`COALESCE(is_published, TRUE) = $${vals.length}`);
      } else if (publishedArg === '0' || publishedArg === 'false' || publishedArg === 'hidden') {
        vals.push(false); conds.push(`COALESCE(is_published, TRUE) = $${vals.length}`);
      }
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    // ORDER BY
    const idCol = hasId ? 'unit_id' : (hasIdAlt ? 'id' : '1');
    const orderBy = hasName ? `unit_name NULLS LAST, ${idCol}` :
                    hasCode ? `code, ${idCol}` : idCol;

    // LIMIT/OFFSET
    vals.push(limit, offset);

    // ---------- ใช้ CTE base แล้วค่อยดึง categories แบบ subquery เพื่อเลี่ยง GROUP BY dynamic ----------
    // NOTE: ถ้าไม่มี unit_id (ระบบเก่ามาก) จะคืน category_ids=[]/categories=[] อัตโนมัติ
    const baseSQL = `
      WITH base AS (
        SELECT ${parts.join(', ')}
        FROM ${T}
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${vals.length - 1} OFFSET $${vals.length}
      )
      SELECT
        b.*,
        ${hasPUC && hasId ? `
          COALESCE((
            SELECT array_agg(uc.category_id ORDER BY uc.category_id)
            FROM product_unit_categories uc
            WHERE uc.unit_id = b.unit_id
          ), ARRAY[]::text[])
        ` : `ARRAY[]::text[]`} AS category_ids,
        ${hasPUC && hasId ? `
          COALESCE((
            SELECT json_agg(json_build_object('category_id', uc.category_id, 'category_name', pc.category_name) ORDER BY uc.category_id)
            FROM product_unit_categories uc
            ${hasPCat ? `LEFT JOIN product_categories pc ON pc.category_id = uc.category_id` : `LEFT JOIN LATERAL (SELECT NULL::text AS category_name) pc ON TRUE`}
            WHERE uc.unit_id = b.unit_id
          ), '[]'::json)
        ` : `'[]'::json`} AS categories
      FROM base b
    `;

    const { rows } = await db.query(baseSQL, vals);
    res.json(rows || []);
  } catch (err) {
    console.error('Error GET /api/units', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
