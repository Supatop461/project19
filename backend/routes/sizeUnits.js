// backend/routes/sizeUnits.js
// ✅ CRUD สำหรับตาราง size_units (public/admin ใช้ร่วมกัน) — ไม่ใส่ path ซ้ำใน route
//    * ไฟล์นี้ถูก mount ที่ /api/size-units แล้ว: ใช้ '/', '/:code' เท่านั้น

const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

/* ---------- utils ---------- */
const asStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const toCode = (v) => asStr(v).toUpperCase().replace(/\s+/g, '_');
const toBool = (v, d = true) => {
  if (v === true || v === false) return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['1','true','t','yes','y'].includes(s)) return true;
  if (['0','false','f','no','n'].includes(s)) return false;
  return d;
};
async function hasTable(t) {
  const { rows } = await db.query(`SELECT to_regclass($1) AS t`, [t]);
  return !!rows?.[0]?.t;
}

/* ---------- guards & cache ---------- */
router.use(async (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  if (!(await hasTable('size_units'))) return res.status(500).json({ error: 'missing table: size_units' });
  next();
});

/* ---------- LIST: GET /  ?q=...&published=1|0|all&limit=&offset=  ---------- */
router.get('/', async (req, res) => {
  try {
    const q = asStr(req.query.q);
    const published = asStr(req.query.published || 'all').toLowerCase();
    const limit  = Math.min(parseInt(req.query.limit || '500', 10) || 50, 1000);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

    const conds = [];
    const vals = [];

    if (q) {
      vals.push(`%${q}%`);
      conds.push(`(code ILIKE $${vals.length} OR unit_name ILIKE $${vals.length})`);
    }
    if (['1','true'].includes(published)) {
      vals.push(true); conds.push(`COALESCE(is_published, TRUE) = $${vals.length}`);
    } else if (['0','false','hidden'].includes(published)) {
      vals.push(false); conds.push(`COALESCE(is_published, TRUE) = $${vals.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    vals.push(limit, offset);

    const sql = `
      SELECT id, code, unit_name, description, is_published, created_at, updated_at
      FROM size_units
      ${where}
      ORDER BY COALESCE(code,''), id
      LIMIT $${vals.length-1} OFFSET $${vals.length}
    `;
    const { rows } = await db.query(sql, vals);
    res.json(rows || []);
  } catch (err) {
    console.error('Error GET /api/size-units', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- CREATE: POST /  ---------- */
router.post('/', async (req, res) => {
  try {
    let { code, unit_name, description, is_published } = req.body || {};
    code = toCode(code);
    unit_name = asStr(unit_name);
    description = asStr(description) || unit_name || null;
    is_published = toBool(is_published, true);

    if (!code) return res.status(400).json({ error: 'code required' });
    if (!unit_name) return res.status(400).json({ error: 'unit_name required' });

    const dup = await db.query(`SELECT 1 FROM size_units WHERE code=$1 LIMIT 1`, [code]);
    if (dup.rowCount) return res.status(409).json({ error: 'code exists' });

    const { rows } = await db.query(
      `INSERT INTO size_units (code, unit_name, description, is_published)
       VALUES ($1,$2,$3,$4)
       RETURNING id, code, unit_name, description, is_published, created_at, updated_at`,
      [code, unit_name, description, is_published]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error POST /api/size-units', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- UPDATE: PUT /:code  (อนุญาตแก้ code ได้) ---------- */
router.put('/:code', async (req, res) => {
  try {
    const codeParam = toCode(req.params.code);
    if (!codeParam) return res.status(400).json({ error: 'code param required' });

    const fields = [];
    const vals = [];
    const push = (c, v) => { vals.push(v); fields.push(`${c}=$${vals.length}`); };

    if (req.body.code !== undefined) {
      const newCode = toCode(req.body.code);
      if (!newCode) return res.status(400).json({ error: 'code cannot be empty' });
      const dup = await db.query(`SELECT 1 FROM size_units WHERE code=$1 AND code<>$2 LIMIT 1`, [newCode, codeParam]);
      if (dup.rowCount) return res.status(409).json({ error: 'code exists' });
      push('code', newCode);
    }
    if (req.body.unit_name !== undefined) push('unit_name', asStr(req.body.unit_name) || null);
    if (req.body.description !== undefined) push('description', asStr(req.body.description) || null);
    if (req.body.is_published !== undefined) push('is_published', toBool(req.body.is_published, true));

    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });

    vals.push(codeParam);
    const { rows } = await db.query(
      `UPDATE size_units SET ${fields.join(', ')}, updated_at = NOW()
       WHERE code=$${vals.length}
       RETURNING id, code, unit_name, description, is_published, created_at, updated_at`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('Error PUT /api/size-units/:code', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- DELETE: DELETE /:code ---------- */
router.delete('/:code', async (req, res) => {
  try {
    const code = toCode(req.params.code);
    if (!code) return res.status(400).json({ error: 'code param required' });
    const { rowCount } = await db.query(`DELETE FROM size_units WHERE code=$1`, [code]);
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error DELETE /api/size-units/:code', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

module.exports = router;
