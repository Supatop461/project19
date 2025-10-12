// backend/routes/unitsRouter.js
// UNITSv2 — robust router (code/unit_code + id/unit_id/uid) + categories 3 แบบ

const express = require('express');
const router = express.Router();

let db; try { db = require('../db'); } catch { db = require('../db/db'); }

// auth (optional-safe)
let requireAuth = (_req, _res, next) => next();
let requireRole  = () => (_req, _res, next) => next();
try {
  const m = require('../middleware/auth');
  requireAuth = m.requireAuth || requireAuth;
  requireRole = m.requireRole || requireRole;
} catch {}

const asStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const log = (...xs) => console.log('[UNITSv2]', ...xs);

/* ─ helpers: table/column ─ */
async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows?.[0]?.ok;
}
async function hasColumn(table, column) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}
async function pickExistingColumn(table, candidates) {
  for (const c of candidates) { // eslint-disable-line no-restricted-syntax
    // eslint-disable-next-line no-await-in-loop
    if (await hasColumn(table, c)) return c;
  }
  return null;
}

/* ─ resolve columns ─ */
async function resolveUnitColumns() {
  const table = 'product_units';
  if (!(await hasTable(table))) throw new Error('ไม่พบตาราง product_units');

  const textKeyCols = (await Promise.all(['code','unit_code'].map(async c => (await hasColumn(table,c)) ? c : null))).filter(Boolean);
  const idKeyCols   = (await Promise.all(['id','unit_id','uid'].map(async c => (await hasColumn(table,c)) ? c : null))).filter(Boolean);
  const nameCol  = await pickExistingColumn(table, ['unit_name','name','label','title']);
  const descCol  = await pickExistingColumn(table, ['description','desc','details','remark']);
  const catIdCol = await pickExistingColumn(table, ['category_id']);
  const catIdsCol= await pickExistingColumn(table, ['category_ids']);

  if (!textKeyCols.length && !idKeyCols.length) throw new Error('ไม่พบคีย์ (code/unit_code หรือ id/unit_id/uid)');
  if (!nameCol) throw new Error('ไม่พบคอลัมน์ชื่อหน่วย (unit_name/name/label/title)');

  log('CFG', { textKeyCols, idKeyCols, nameCol, descCol, catIdCol, catIdsCol });
  return { table, textKeyCols, idKeyCols, nameCol, descCol, catIdCol, catIdsCol };
}

/* ─ where builder ─ */
function whereByKey(param, cfg, startIndex = 1) {
  const p = asStr(param);
  const params = [];
  const conds = [];
  for (const col of cfg.textKeyCols) { params.push(p); conds.push(`LOWER(${col})=LOWER($${startIndex+params.length-1})`); }
  const n = Number(p);
  if (Number.isFinite(n)) for (const col of cfg.idKeyCols) { params.push(n); conds.push(`${col}=$${startIndex+params.length-1}`); }
  const sql = conds.length ? `(${conds.join(' OR ')})` : 'FALSE';
  log('WHERE', { p, sql, params });
  return { sql, params };
}

/* ─ category helpers ─ */
async function getCategoryIds(key, cfg) {
  const where = whereByKey(key, cfg, 1);
  if (cfg.catIdsCol) {
    const { rows } = await db.query(`SELECT ${cfg.catIdsCol} AS arr FROM ${cfg.table} WHERE ${where.sql} LIMIT 1`, where.params);
    const a = rows[0]?.arr;
    if (Array.isArray(a)) return a.map(String);
    if (a !== undefined && a !== null) { try { const p = JSON.parse(a); if (Array.isArray(p)) return p.map(String); } catch {} }
  }
  if (cfg.catIdCol) {
    const { rows } = await db.query(`SELECT ${cfg.catIdCol} AS cid FROM ${cfg.table} WHERE ${where.sql} LIMIT 1`, where.params);
    if (rows[0]?.cid) return [String(rows[0].cid)];
  }
  if (await hasTable('product_unit_categories')) {
    const unitCodeCol = (await hasColumn('product_unit_categories','unit_code')) ? 'unit_code'
                      : (await hasColumn('product_unit_categories','code')) ? 'code'
                      : (await hasColumn('product_unit_categories','unit_id')) ? 'unit_id'
                      : null;
    const pucCatCol  = (await hasColumn('product_unit_categories','category_id')) ? 'category_id' : null;
    if (unitCodeCol && pucCatCol) {
      const isNum = Number.isFinite(Number(key));
      const keyVal = isNum ? Number(key) : asStr(key);
      const wherePUC = isNum ? `${unitCodeCol}=$1` : `LOWER(${unitCodeCol})=LOWER($1)`;
      const { rows } = await db.query(`SELECT ${pucCatCol} AS cid FROM product_unit_categories WHERE ${wherePUC}`, [keyVal]);
      return rows.map(r => String(r.cid)).filter(Boolean);
    }
  }
  return [];
}
async function writeJsonCatIds(key, cfg, ids) {
  if (!cfg.catIdsCol) return false;
  const where = whereByKey(key, cfg, 2);
  await db.query(`UPDATE ${cfg.table} SET ${cfg.catIdsCol}=$1 WHERE ${where.sql}`, [JSON.stringify(ids||[]), ...where.params]);
  return true;
}
async function writeSingleCatId(key, cfg, ids) {
  if (!cfg.catIdCol) return false;
  const single = Array.isArray(ids) && ids.length ? ids[0] : null;
  const where = whereByKey(key, cfg, 2);
  await db.query(`UPDATE ${cfg.table} SET ${cfg.catIdCol}=$1 WHERE ${where.sql}`, [single, ...where.params]);
  return true;
}
async function replaceMapTable(key, cfg, ids) {
  if (!(await hasTable('product_unit_categories'))) return false;
  const unitCodeCol = (await hasColumn('product_unit_categories','unit_code')) ? 'unit_code'
                    : (await hasColumn('product_unit_categories','code')) ? 'code'
                    : (await hasColumn('product_unit_categories','unit_id')) ? 'unit_id'
                    : null;
  const pucCatCol = (await hasColumn('product_unit_categories','category_id')) ? 'category_id' : null;
  if (!unitCodeCol || !pucCatCol) return false;
  const isNum = Number.isFinite(Number(key));
  const keyVal = isNum ? Number(key) : asStr(key);
  const wherePUC = isNum ? `${unitCodeCol}=$1` : `LOWER(${unitCodeCol})=LOWER($1)`;
  await db.query(`DELETE FROM product_unit_categories WHERE ${wherePUC}`, [keyVal]);
  for (const cid of (ids||[])) { // eslint-disable-line no-restricted-syntax
    // eslint-disable-next-line no-await-in-loop
    await db.query(`INSERT INTO product_unit_categories (${unitCodeCol},${pucCatCol}) VALUES ($1,$2)`, [keyVal, cid]);
  }
  return true;
}

/* ─ normalize ─ */
async function toUnitRow(row, cfg) {
  const keyCol = cfg.textKeyCols[0] || cfg.idKeyCols[0];
  const code = asStr(row[keyCol]);
  const unit_name = asStr(row[cfg.nameCol]);
  const description = cfg.descCol ? asStr(row[cfg.descCol]) : '';
  const category_ids = await getCategoryIds(code, cfg);
  return { code, unit_name, description, category_ids };
}

/* ─ whoami ─ */
router.get('/units/_whoami', (_req, res) => res.json({ who: 'UNITSv2' }));
router.get('/_ping_units', (_req, res) => res.json({ ok: true, who: 'UNITSv2' }));

/* ─ GET list ─ */
router.get('/units', async (_req, res) => {
  try {
    const cfg = await resolveUnitColumns();
    const order2 = cfg.idKeyCols[0] || cfg.textKeyCols[0];
    const { rows } = await db.query(`SELECT * FROM ${cfg.table} ORDER BY ${cfg.nameCol} NULLS LAST, ${order2}`);
    const out = [];
    for (const r of rows) out.push(await toUnitRow(r, cfg)); // eslint-disable-line no-await-in-loop
    res.json(out);
  } catch (err) {
    console.error('[UNITSv2] GET /units error:', err);
    res.status(500).json({ error: err.message || 'ไม่สามารถดึงข้อมูลหน่วยได้' });
  }
});

/* ─ POST create ─ */
router.post('/admin/units', requireAuth, requireRole(['admin','staff']), async (req, res) => {
  try {
    const cfg = await resolveUnitColumns();
    const code = asStr(req.body.code).toLowerCase();
    const unit_name = asStr(req.body.unit_name);
    const description = asStr(req.body.description);
    const category_ids = Array.from(new Set((req.body.category_ids||[]).map(String).filter(Boolean)));

    if (!code) return res.status(400).json({ error: 'ต้องระบุ code' });
    if (!/^[a-z0-9_]+$/i.test(code)) return res.status(400).json({ error: 'code ต้องเป็น a-z0-9_ เท่านั้น' });
    if (!unit_name) return res.status(400).json({ error: 'ต้องระบุ unit_name' });

    if (cfg.textKeyCols.length) {
      const whereTxt = cfg.textKeyCols.map(c => `LOWER(${c})=LOWER($1)`).join(' OR ');
      const dup = await db.query(`SELECT 1 FROM ${cfg.table} WHERE ${whereTxt} LIMIT 1`, [code]);
      if (dup.rowCount) return res.status(400).json({ error: `code "${code}" มีอยู่แล้ว` });
    }

    const keyCol = cfg.textKeyCols[0] || cfg.idKeyCols[0];
    const cols = [keyCol, cfg.nameCol].filter(Boolean);
    const vals = [code, unit_name];
    if (cfg.descCol) { cols.push(cfg.descCol); vals.push(description); }
    const placeholders = cols.map((_, i) => `$${i+1}`);
    await db.query(`INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals);

    if (category_ids.length) {
      const w1 = await writeJsonCatIds(code, cfg, category_ids);
      const w2 = await writeSingleCatId(code, cfg, category_ids);
      if (!w1 && !w2) await replaceMapTable(code, cfg, category_ids);
    }

    res.json({ ok: true, code, who: 'UNITSv2' });
  } catch (err) {
    console.error('[UNITSv2] POST /admin/units error:', err);
    res.status(500).json({ error: err.message || 'บันทึกหน่วยไม่สำเร็จ' });
  }
});

/* ─ PUT update ─ */
router.put('/admin/units/:code', requireAuth, requireRole(['admin','staff']), async (req, res) => {
  try {
    const cfg = await resolveUnitColumns();
    const keyParam = asStr(req.params.code);
    log('PUT key=', keyParam);

    const find = whereByKey(keyParam, cfg, 1);
    const exists = await db.query(`SELECT * FROM ${cfg.table} WHERE ${find.sql} LIMIT 1`, find.params);
    log('FOUND=', exists.rowCount);
    if (!exists.rowCount) return res.status(404).json({ error: 'ไม่พบหน่วย' });

    const unit_name = (req.body.unit_name !== undefined) ? asStr(req.body.unit_name) : null;
    const description = (req.body.description !== undefined) ? asStr(req.body.description) : null;
    const category_ids = Array.isArray(req.body.category_ids)
      ? Array.from(new Set(req.body.category_ids.map(String).filter(Boolean)))
      : null;

    const sets = [];
    const vals = [];
    if (unit_name !== null) { sets.push(`${cfg.nameCol}=$${sets.length+1}`); vals.push(unit_name); }
    if (description !== null && cfg.descCol) { sets.push(`${cfg.descCol}=$${sets.length+1}`); vals.push(description); }

    if (sets.length) {
      const upd = whereByKey(keyParam, cfg, vals.length + 1);
      log('UPDATE sets=', sets, 'params=', [...vals, ...upd.params]);
      await db.query(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE ${upd.sql}`, [...vals, ...upd.params]);
    }

    if (category_ids) {
      const w1 = await writeJsonCatIds(keyParam, cfg, category_ids);
      const w2 = await writeSingleCatId(keyParam, cfg, category_ids);
      if (!w1 && !w2) await replaceMapTable(keyParam, cfg, category_ids);
    }

    res.json({ ok: true, who: 'UNITSv2' });
  } catch (err) {
    console.error('[UNITSv2] PUT /admin/units/:code error:', err);
    res.status(500).json({ error: err.message || 'แก้ไขหน่วยไม่สำเร็จ' });
  }
});

/* ─ DELETE ─ */
router.delete('/admin/units/:code', requireAuth, requireRole(['admin','staff']), async (req, res) => {
  try {
    const cfg = await resolveUnitColumns();
    const keyParam = asStr(req.params.code);

    if (await hasTable('product_unit_categories')) {
      const unitCodeCol = (await hasColumn('product_unit_categories','unit_code')) ? 'unit_code'
                        : (await hasColumn('product_unit_categories','code')) ? 'code'
                        : (await hasColumn('product_unit_categories','unit_id')) ? 'unit_id'
                        : null;
      if (unitCodeCol) {
        const isNum = Number.isFinite(Number(keyParam));
        const wherePUC = isNum ? `${unitCodeCol}=$1` : `LOWER(${unitCodeCol})=LOWER($1)`;
        await db.query(`DELETE FROM product_unit_categories WHERE ${wherePUC}`, [isNum ? Number(keyParam) : keyParam]);
      }
    }

    const del = whereByKey(keyParam, cfg, 1);
    const r = await db.query(`DELETE FROM ${cfg.table} WHERE ${del.sql}`, del.params);
    if (!r.rowCount) return res.status(404).json({ error: 'ไม่พบหน่วย' });

    res.json({ ok: true, who: 'UNITSv2' });
  } catch (err) {
    console.error('[UNITSv2] DELETE /admin/units/:code error:', err);
    res.status(500).json({ error: err.message || 'ลบหน่วยไม่สำเร็จ' });
  }
});

console.log('▶ units router LOADED (UNITSv2)');
module.exports = router;
