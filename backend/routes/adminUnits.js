// backend/routes/adminUnits.js
// ✅ Units API — list (รวม category_ids), CRUD, toggle publish
// ✅ รองรับตารางกลาง product_unit_categories (many-to-many)

const express = require('express');
const router = express.Router();

let db; try { db = require('../db'); } catch { db = require('../db/db'); }

// auth (optional)
let requireAuth = (_req, _res, next) => next();
let requireRole = () => (_req, _res, next) => next();
try {
  const m = require('../middleware/auth');
  requireAuth = m.requireAuth || requireAuth;
  requireRole = m.requireRole || requireRole;
} catch {}

async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows?.[0]?.ok;
}
async function hasCol(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

// ตรวจ schema แบบยืดหยุ่น
async function resolveUnitKeys() {
  const hasUnitId = await hasCol('product_units','unit_id');
  const hasId     = await hasCol('product_units','id');

  const hasCode   = await hasCol('product_units','code');
  const hasUCode  = await hasCol('product_units','unit_code');

  const nameCol   = (await hasCol('product_units','unit_name')) ? 'unit_name'
                    : (await hasCol('product_units','name'))     ? 'name' : null;

  const descCol   = (await hasCol('product_units','description')) ? 'description' : null;

  const pubCol    = (await hasCol('product_units','is_published')) ? 'is_published'
                    : (await hasCol('product_units','published'))   ? 'published' : null;
  const visCol    = (await hasCol('product_units','is_visible')) ? 'is_visible' : null;
  const actCol    = (await hasCol('product_units','is_active'))  ? 'is_active'  : null;

  const catIdCol  = (await hasCol('product_units','category_id'))  ? 'category_id'  : null;
  const catIdsCol = (await hasCol('product_units','category_ids')) ? 'category_ids' : null;

  return {
    idCols: [hasUnitId ? 'unit_id' : null, hasId ? 'id' : null].filter(Boolean),
    codeCols: [hasCode ? 'code' : null, hasUCode ? 'unit_code' : null].filter(Boolean),
    nameCol, descCol, pubCol, visCol, actCol, catIdCol, catIdsCol
  };
}
const isIntLike = (s) => /^-?\d+$/.test(String(s || '').trim());

// ---------- helpers: category mapping ----------
async function syncUnitCategoriesIfAny(unitId, categoryIds = []) {
  const hasPUC = await hasTable('product_unit_categories');
  if (!hasPUC) return;

  const ids = Array.from(new Set((categoryIds || []).map(String).filter(Boolean)));
  await db.query(`DELETE FROM product_unit_categories WHERE unit_id = $1`, [unitId]);
  if (ids.length) {
    const values = ids.map((_, i) => `($1, $${i + 2})`).join(', ');
    await db.query(
      `INSERT INTO product_unit_categories (unit_id, category_id) VALUES ${values}`,
      [unitId, ...ids]
    );
  }
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

// ---------- list (public/admin shared) ----------
async function listUnitsHandler(req, res) {
  try {
    if (!(await hasTable('product_units'))) return res.json([]);

    const K = await resolveUnitKeys();
    const idCol   = K.idCols[0] || null;
    const codeCol = K.codeCols[0] || null;

    const cols = [];
    if (idCol)   cols.push(`pu.${idCol} AS ${idCol}`);
    if (codeCol) cols.push(`pu.${codeCol} AS ${codeCol}`);
    cols.push(K.nameCol ? `pu.${K.nameCol} AS unit_name` : `''::text AS unit_name`);
    if (K.descCol) cols.push(`pu.${K.descCol} AS description`);
    if (K.catIdCol)  cols.push(`pu.${K.catIdCol} AS category_id`);
    if (K.pubCol) cols.push(`COALESCE(pu.${K.pubCol}, TRUE) AS is_published`);
    if (K.visCol) cols.push(`COALESCE(pu.${K.visCol}, TRUE) AS is_visible`);
    if (K.actCol) cols.push(`COALESCE(pu.${K.actCol}, TRUE) AS is_active`);

    const catAgg = await buildCategoryAggFragment(idCol);
    cols.push(catAgg.sel);

    const onlyVisible = req.query.only_visible === '1' || req.query.visible === '1';
    const where = [];
    if (onlyVisible) {
      if (K.visCol) where.push(`COALESCE(pu.${K.visCol}, TRUE) = TRUE`);
      else if (K.pubCol) where.push(`COALESCE(pu.${K.pubCol}, TRUE) = TRUE`);
      else if (K.actCol) where.push(`COALESCE(pu.${K.actCol}, TRUE) = TRUE`);
    }

    const sql = `
      SELECT ${cols.join(', ')}
      FROM product_units pu
      ${catAgg.join}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY 1 ASC
    `;
    const { rows } = await db.query(sql);

    const items = rows.map(r => ({
      ...r,
      code: codeCol ? (r[codeCol] ?? r.code) : (r.code ?? null),
      unit_id: idCol ? r[idCol] : (r.unit_id ?? r.id ?? null),
      category_ids: Array.isArray(r.category_ids) ? r.category_ids : (r.category_id ? [String(r.category_id)] : []),
    }));

    if (req.query.debug === '1') {
      return res.json({
        keys: K,
        onlyVisible,
        sql: sql.replace(/\s+/g,' ').trim(),
        count: items.length,
        sample: items.slice(0,5),
      });
    }
    res.json(items);
  } catch (e) {
    console.error('❌ list units error:', e);
    res.status(500).json({ message: 'List units error' });
  }
}

// ---------- build WHERE by key ----------
async function buildWhereByKey(key, startIndex = 0) {
  const K = await resolveUnitKeys();
  const params = [];
  const ors = [];

  if (isIntLike(key) && K.idCols.length) {
    params.push(parseInt(key, 10));
    const p = `$${startIndex + params.length}`;
    ors.push(...K.idCols.map(c => `pu.${c} = ${p}`));
  }
  const keyTxt = String(key).trim().toLowerCase();
  if (K.codeCols.length) {
    params.push(keyTxt);
    const p = `$${startIndex + params.length}`;
    ors.push(...K.codeCols.map(c => `LOWER(pu.${c}) = ${p}`));
  }

  if (!ors.length) return null;
  return { where: `(${ors.join(' OR ')})`, params };
}

// ---------- create ----------
router.post('/admin/units', async (req, res) => {
  try {
    if (!(await hasTable('product_units'))) return res.status(400).json({ message: 'product_units not found' });
    const K = await resolveUnitKeys();
    if (!K.nameCol) return res.status(400).json({ message: 'unit_name column not found' });

    let { code, unit_name, description, category_id, category_ids, is_published } = req.body || {};
    code = (code ?? '').trim().toLowerCase();
    unit_name = (unit_name ?? '').trim();
    if (!code || !unit_name) return res.status(400).json({ message: 'กรอก code และ unit_name ให้ครบ' });

    const cols = [K.nameCol]; const vals = [unit_name]; const phs = ['$1']; let i = 1;
    if (K.codeCols.length) { i++; cols.push(K.codeCols[0]); vals.push(code); phs.push(`$${i}`); }
    if (K.descCol)         { i++; cols.push(K.descCol);     vals.push(description ?? null); phs.push(`$${i}`); }
    if (K.catIdCol)        { i++; cols.push(K.catIdCol);    vals.push(category_id ?? null); phs.push(`$${i}`); }
    if (K.catIdsCol)       { i++; cols.push(K.catIdsCol);   vals.push(Array.isArray(category_ids) ? category_ids : null); phs.push(`$${i}`); }
    if (K.pubCol)          { i++; cols.push(K.pubCol);      vals.push(is_published === undefined ? true : !!is_published); phs.push(`$${i}`); }
    if (K.visCol)          { i++; cols.push(K.visCol);      vals.push(true); phs.push(`$${i}`); }

    const { rows } = await db.query(
      `INSERT INTO product_units (${cols.join(',')}) VALUES (${phs.join(',')}) RETURNING *`,
      vals
    );
    const row = rows[0];

    // sync ตารางกลาง
    const idCol = (K.idCols[0] || 'id');
    const unitId = row[idCol] ?? row.unit_id ?? row.id;
    await syncUnitCategoriesIfAny(unitId, Array.isArray(category_ids) ? category_ids : (category_id ? [category_id] : []));

    res.status(201).json(row);
  } catch (e) {
    console.error('❌ create unit error:', e);
    const msg = e?.code === '23505' ? 'ข้อมูลซ้ำ (unique)' : 'Create unit error';
    res.status(500).json({ message: msg });
  }
});

// ---------- update ----------
router.put('/admin/units/:key', async (req, res) => {
  try {
    if (!(await hasTable('product_units'))) return res.status(400).json({ message: 'product_units not found' });

    const K = await resolveUnitKeys();
    const sets = [];
    const vals = [];
    let i = 0;

    // ห้ามใส่ alias pu. ใน SET
    const push = (col, v) => { i++; sets.push(`${col} = $${i}`); vals.push(v); };

    const { code, unit_name, description, category_id, category_ids, is_published } = (req.body || {});
    if (unit_name !== undefined && K.nameCol)     push(`${K.nameCol}`, (unit_name ?? '').trim());
    if (code !== undefined && K.codeCols.length)  push(`${K.codeCols[0]}`, String(code || '').toLowerCase());
    if (description !== undefined && K.descCol)   push(`${K.descCol}`, description ?? null);
    if (category_id !== undefined && K.catIdCol)  push(`${K.catIdCol}`, category_id ?? null);
    if (K.catIdsCol && category_ids !== undefined)push(`${K.catIdsCol}`, Array.isArray(category_ids) ? category_ids : null);
    if (is_published !== undefined && K.pubCol)   push(`${K.pubCol}`, !!is_published);

    if (!sets.length && category_ids === undefined) return res.status(400).json({ message: 'ไม่มีฟิลด์ให้แก้ไข' });

    const match = await buildWhereByKey(req.params.key, i);
    if (!match) return res.status(400).json({ message: 'Invalid key' });

    let row;
    if (sets.length) {
      const { rows } = await db.query(`
        UPDATE product_units pu
        SET ${sets.join(', ')}
        WHERE ${match.where}
        RETURNING *
      `, [...vals, ...match.params]);
      if (!rows.length) return res.status(404).json({ message: 'ไม่พบหน่วย' });
      row = rows[0];
    } else {
      const { rows } = await db.query(`
        SELECT * FROM product_units pu
        WHERE ${match.where}
        LIMIT 1
      `, match.params);
      if (!rows.length) return res.status(404).json({ message: 'ไม่พบหน่วย' });
      row = rows[0];
    }

    // sync ตารางกลางจาก category_ids (ถ้ามี)
    if (category_ids !== undefined) {
      const idCol = (K.idCols[0] || 'id');
      const unitId = row[idCol] ?? row.unit_id ?? row.id;
      await syncUnitCategoriesIfAny(unitId, Array.isArray(category_ids) ? category_ids : []);
    }

    res.json(row);
  } catch (e) {
    console.error('❌ update unit error:', e);
    const msg = e?.code === '23505' ? 'ข้อมูลซ้ำ (unique)' : 'Update unit error';
    res.status(500).json({ message: msg });
  }
});

// ---------- delete (ลบ mapping ด้วย) ----------
router.delete('/admin/units/:key', async (req, res) => {
  try {
    if (!(await hasTable('product_units'))) return res.status(400).json({ message: 'product_units not found' });

    const pre = await buildWhereByKey(req.params.key, 0);
    if (!pre) return res.status(400).json({ message: 'Invalid key' });
    const { rows: found } = await db.query(`SELECT * FROM product_units pu WHERE ${pre.where} LIMIT 1`, pre.params);
    if (!found.length) return res.status(404).json({ message: 'ไม่พบหน่วย' });

    const K = await resolveUnitKeys();
    const idCol = (K.idCols[0] || 'id');
    const unitId = found[0][idCol] ?? found[0].unit_id ?? found[0].id;

    const hasPUC = await hasTable('product_unit_categories');
    if (hasPUC) await db.query(`DELETE FROM product_unit_categories WHERE unit_id = $1`, [unitId]);

    const r = await db.query(`
      DELETE FROM product_units pu
      WHERE ${pre.where}
      RETURNING 1
    `, pre.params);

    if (!r.rowCount) return res.status(404).json({ message: 'ไม่พบหน่วย' });
    res.json({ ok: true });
  } catch (e) {
    console.error('❌ delete unit error:', e);
    res.status(500).json({ message: 'Delete unit error' });
  }
});

// ---------- aliases ----------
router.get(['/units','/admin/units'], listUnitsHandler);

module.exports = router;
