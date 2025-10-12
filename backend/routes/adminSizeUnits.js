// backend/routes/adminSizeUnits.js
// ✅ ใช้กับหน้า AdminSizes.js
//    - PATCH /api/admin/size-units/__probe__/publish
//    - PATCH /api/admin/size-units/:code/publish   (body: { is_published: true|false })
//    - (แถม) GET /api/admin/size-units, /options, POST/PUT/DELETE by id — เผื่อใช้งานภายใน

const express = require('express');
const router = express.Router();

const db = require('../db');

/* ---------- utils ---------- */
const nocache = (_req, res, next) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma','no-cache'); res.set('Expires','0');
  res.set('ETag', Math.random().toString(36).slice(2));
  res.set('Last-Modified', new Date().toUTCString());
  next();
};
const asStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const toCode = (v) => asStr(v).toUpperCase().replace(/\s+/g,'_');
const toBool = (v, d=true) => {
  if (v === true || v === false) return v;
  const s = String(v ?? '').toLowerCase();
  if (['1','true','t','yes','y'].includes(s)) return true;
  if (['0','false','f','no','n'].includes(s)) return false;
  return d;
};
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

/* ---------- LIST (admin view optional) ---------- */
router.get('/', nocache, async (req, res) => {
  try {
    const { q, only_visible } = req.query;
    const hasCode    = await hasColumn('size_units', 'code');
    const hasActive  = await hasColumn('size_units', 'is_active');
    const hasVisible = await hasColumn('size_units', 'is_visible');
    const hasDesc    = await hasColumn('size_units', 'description');

    const where = []; const params = [];
    if (asStr(q)) {
      params.push(`%${asStr(q)}%`);
      const p = `$${params.length}`;
      where.push(`(${hasCode ? `code ILIKE ${p}` : 'FALSE'} OR unit_name ILIKE ${p})`);
    }
    if (only_visible === '1' && hasVisible) {
      where.push(`COALESCE(is_visible,true)=true`);
    }

    const sql = `
      SELECT
        ${await hasColumn('size_units','size_unit_id') ? 'size_unit_id' : 'COALESCE(id, 0) AS size_unit_id'},
        ${hasCode ? 'code' : 'NULL::text AS code'},
        unit_name,
        ${hasDesc ? 'description' : 'NULL::text AS description'},
        ${hasActive  ? 'COALESCE(is_active,  true) AS is_active'  : 'TRUE  AS is_active'},
        ${hasVisible ? 'COALESCE(is_visible, true) AS is_visible' : 'TRUE  AS is_visible'},
        ${await hasColumn('size_units','is_published') ? 'COALESCE(is_published,true) AS is_published' : 'TRUE AS is_published'}
      FROM size_units
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY unit_name, 1
    `;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('size_units list error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- OPTIONS (dropdown optional) ---------- */
router.get('/options', nocache, async (_req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${await hasColumn('size_units','size_unit_id') ? 'size_unit_id' : 'COALESCE(id,0)'} AS id,
             unit_name AS name
      FROM size_units
      WHERE COALESCE(is_active,true)=true AND COALESCE(is_visible,true)=true
      ORDER BY unit_name, 1
    `);
    res.json(rows);
  } catch (e) {
    console.error('size_units options error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- CREATE (optional admin) ---------- */
router.post('/', async (req, res) => {
  try {
    const { code, unit_name, description = null, is_active = true, is_visible = true } = req.body || {};
    if (!asStr(unit_name)) return res.status(400).json({ message: 'กรุณาระบุชื่อหน่วย (unit_name)' });

    const hasCode    = await hasColumn('size_units', 'code');
    const hasActive  = await hasColumn('size_units', 'is_active');
    const hasVisible = await hasColumn('size_units', 'is_visible');
    const hasDesc    = await hasColumn('size_units', 'description');

    const cols = ['unit_name']; const vals = [asStr(unit_name)];
    if (hasCode)    { cols.push('code');        vals.push(asStr(code) || null); }
    if (hasDesc)    { cols.push('description'); vals.push(asStr(description) || null); }
    if (hasActive)  { cols.push('is_active');   vals.push(!!is_active); }
    if (hasVisible) { cols.push('is_visible');  vals.push(!!is_visible); }

    const ph = cols.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO size_units (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('create size_unit error', e);
    res.status(500).json({ error: 'create_error' });
  }
});

/* ---------- UPDATE (optional admin) ---------- */
router.put('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'invalid id' });

    const hasCode    = await hasColumn('size_units', 'code');
    const hasActive  = await hasColumn('size_units', 'is_active');
    const hasVisible = await hasColumn('size_units', 'is_visible');
    const hasDesc    = await hasColumn('size_units', 'description');

    const fields = []; const params = [];
    const push = (c, v) => { params.push(v); fields.push(`${c}=$${params.length}`); };

    if (req.body.unit_name !== undefined)                 push('unit_name', asStr(req.body.unit_name) || null);
    if (hasCode    && req.body.code !== undefined)        push('code', asStr(req.body.code) || null);
    if (hasDesc    && req.body.description !== undefined) push('description', asStr(req.body.description) || null);
    if (hasActive  && req.body.is_active !== undefined)   push('is_active', !!req.body.is_active);
    if (hasVisible && req.body.is_visible !== undefined)  push('is_visible', !!req.body.is_visible);

    if (!fields.length) return res.status(400).json({ message: 'ไม่มีฟิลด์ให้แก้ไข' });

    params.push(id);
    const { rows } = await db.query(
      `UPDATE size_units SET ${fields.join(', ')} WHERE ${await hasColumn('size_units','size_unit_id') ? 'size_unit_id' : 'id'}=$${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ message: 'ไม่พบหน่วย' });
    res.json(rows[0]);
  } catch (e) {
    console.error('update size_unit error', e);
    res.status(500).json({ error: 'update_error' });
  }
});

/* ---------- DELETE (soft) (optional admin) ---------- */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'invalid id' });

    const hasVisible = await hasColumn('size_units', 'is_visible');
    const hasActive  = await hasColumn('size_units', 'is_active');
    const idCol = await hasColumn('size_units','size_unit_id') ? 'size_unit_id' : 'id';

    if (hasVisible)      await db.query(`UPDATE size_units SET is_visible=false WHERE ${idCol}=$1`, [id]);
    else if (hasActive)  await db.query(`UPDATE size_units SET is_active=false  WHERE ${idCol}=$1`, [id]);
    else                 await db.query(`DELETE FROM size_units WHERE ${idCol}=$1`, [id]);

    res.json({ ok: true });
  } catch (e) {
    console.error('delete size_unit error', e);
    res.status(500).json({ error: 'delete_error' });
  }
});

/* ---------- PUBLISH (ใช้กับฟร้อนท์) ---------- */
// Probe: PATCH /api/admin/size-units/__probe__/publish
router.patch('/__probe__/publish', (_req, res) => {
  res.json({ ok: true, probe: true });
});

// Toggle by code: PATCH /api/admin/size-units/:code/publish  { is_published: true|false }
router.patch('/:code/publish', async (req, res) => {
  try {
    const code = toCode(req.params.code);
    if (!code) return res.status(400).json({ message: 'invalid code' });

    const hasIsPublished = await hasColumn('size_units', 'is_published');
    if (!hasIsPublished) return res.status(400).json({ message: 'missing column is_published' });

    const is_published = toBool(req.body?.is_published, true);

    const { rows } = await db.query(
      `UPDATE size_units SET is_published=$1 WHERE code=$2
       RETURNING id, code, unit_name, description, is_published`,
      [is_published, code]
    );
    if (!rows[0]) return res.status(404).json({ message: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('publish size_unit error', e);
    res.status(500).json({ error: 'publish_error' });
  }
});

module.exports = router;
