// backend/routes/adminUnits.js
// Admin endpoints สำหรับจัดการ "หน่วยสินค้า" ในตาราง product_units
// ใช้คู่กับ server.js ที่ mount ไว้ที่: /api/admin/units
// - LIST:     GET    /api/admin/units?q=&only_visible=1
// - OPTIONS:  GET    /api/admin/units/options
// - CREATE:   POST   /api/admin/units
// - UPDATE:   PUT    /api/admin/units/:id
// - DELETE:   DELETE /api/admin/units/:id        (soft delete ถ้ามีคอลัมน์ is_visible/is_active)
// - PUBLISH:  PATCH  /api/admin/units/:id/publish
// - UNPUB:    PATCH  /api/admin/units/:id/unpublish
// - PROBE:    PATCH  /api/admin/units/__probe__/publish

const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

/* ---------- utils ---------- */
const nocache = (_req, res, next) => {
  res.set('Cache-Control','no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma','no-cache'); res.set('Expires','0');
  res.set('ETag', Math.random().toString(36).slice(2));
  res.set('Last-Modified', new Date().toUTCString());
  next();
};

async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

/* ---------- LIST ---------- */
// GET /api/admin/units?q=&only_visible=1
router.get('/', nocache, async (req, res) => {
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
      // ถ้ามี code ค่อยค้นด้วย code, ถ้าไม่มีก็ค้นเฉพาะ unit_name
      if (hasCode && hasName) where.push(`(code ILIKE ${p} OR unit_name ILIKE ${p})`);
      else if (hasName)        where.push(`unit_name ILIKE ${p}`);
      else if (hasCode)        where.push(`code ILIKE ${p}`);
    }
    if (only_visible === '1' && hasVisible) where.push(`COALESCE(is_visible,true)=true`);

    const sql = `
      SELECT
        unit_id,
        ${hasCode   ? 'code' : 'NULL::text AS code'},
        ${hasName   ? 'unit_name' : 'NULL::text AS unit_name'},
        ${hasDesc   ? 'description' : 'NULL::text AS description'},
        ${hasCatId  ? 'category_id' : 'NULL::text AS category_id'},
        ${hasPub    ? 'COALESCE(is_published,true) AS is_published' : 'TRUE AS is_published'},
        ${hasActive ? 'COALESCE(is_active,true) AS is_active' : 'TRUE AS is_active'},
        ${hasVisible? 'COALESCE(is_visible,true) AS is_visible' : 'TRUE AS is_visible'}
      FROM product_units
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY unit_name NULLS LAST, unit_id
    `;
    const { rows } = await db.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('product_units list error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- OPTIONS (dropdown) ---------- */
// GET /api/admin/units/options
router.get('/options', nocache, async (_req, res) => {
  try {
    const hasVisible = await hasColumn('product_units', 'is_visible');
    const hasActive  = await hasColumn('product_units', 'is_active');
    const hasName    = await hasColumn('product_units', 'unit_name');

    const visibleCond = hasVisible ? 'COALESCE(is_visible,true)=true' : 'TRUE';
    const activeCond  = hasActive  ? 'COALESCE(is_active,true)=true'  : 'TRUE';

    const { rows } = await db.query(`
      SELECT unit_id AS id, ${hasName ? 'unit_name' : 'code'} AS name
      FROM product_units
      WHERE ${visibleCond} AND ${activeCond}
      ORDER BY ${hasName ? 'unit_name' : 'code'}, unit_id
    `);
    res.json(rows);
  } catch (e) {
    console.error('product_units options error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

/* ---------- CREATE ---------- */
// POST /api/admin/units
router.post('/', async (req, res) => {
  try {
    const {
      code = null,
      unit_name,
      description = null,
      category_id = null,
      is_active = true,
      is_visible = true,
      is_published = true,
    } = req.body || {};

    if (!unit_name?.trim()) {
      return res.status(400).json({ message: 'กรุณาระบุชื่อหน่วย (unit_name)' });
    }

    const hasCode     = await hasColumn('product_units', 'code');
    const hasDesc     = await hasColumn('product_units', 'description');
    const hasCatId    = await hasColumn('product_units', 'category_id');
    const hasActive   = await hasColumn('product_units', 'is_active');
    const hasVisible  = await hasColumn('product_units', 'is_visible');
    const hasPub      = await hasColumn('product_units', 'is_published');

    const cols = ['unit_name']; const vals = [unit_name.trim()];
    if (hasCode)     { cols.push('code');         vals.push(code ?? null); }
    if (hasDesc)     { cols.push('description');  vals.push(description); }
    if (hasCatId)    { cols.push('category_id');  vals.push(category_id); }
    if (hasActive)   { cols.push('is_active');    vals.push(!!is_active); }
    if (hasVisible)  { cols.push('is_visible');   vals.push(!!is_visible); }
    if (hasPub)      { cols.push('is_published'); vals.push(!!is_published); }

    const ph = cols.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO product_units (${cols.join(',')}) VALUES (${ph}) RETURNING *`, vals
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('create product_unit error', e);
    res.status(500).json({ error: 'create_error' });
  }
});

/* ---------- UPDATE ---------- */
// PUT /api/admin/units/:id
router.put('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'invalid id' });

    const hasCode     = await hasColumn('product_units', 'code');
    const hasDesc     = await hasColumn('product_units', 'description');
    const hasCatId    = await hasColumn('product_units', 'category_id');
    const hasActive   = await hasColumn('product_units', 'is_active');
    const hasVisible  = await hasColumn('product_units', 'is_visible');
    const hasPub      = await hasColumn('product_units', 'is_published');

    const fields = []; const params = [];
    const push = (c, v) => { params.push(v); fields.push(`${c}=$${params.length}`); };

    if (req.body.unit_name !== undefined)                 push('unit_name', req.body.unit_name?.trim() || null);
    if (hasCode     && req.body.code !== undefined)       push('code', req.body.code || null);
    if (hasDesc     && req.body.description !== undefined)push('description', req.body.description ?? null);
    if (hasCatId    && req.body.category_id !== undefined)push('category_id', req.body.category_id ?? null);
    if (hasActive   && req.body.is_active !== undefined)  push('is_active', !!req.body.is_active);
    if (hasVisible  && req.body.is_visible !== undefined) push('is_visible', !!req.body.is_visible);
    if (hasPub      && req.body.is_published !== undefined) push('is_published', !!req.body.is_published);

    if (!fields.length) return res.status(400).json({ message: 'ไม่มีฟิลด์ให้แก้ไข' });

    params.push(id);
    const { rows } = await db.query(
      `UPDATE product_units SET ${fields.join(', ')} WHERE unit_id=$${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ message: 'ไม่พบหน่วยสินค้า' });
    res.json(rows[0]);
  } catch (e) {
    console.error('update product_unit error', e);
    res.status(500).json({ error: 'update_error' });
  }
});

/* ---------- DELETE (soft) ---------- */
// DELETE /api/admin/units/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'invalid id' });

    const hasVisible = await hasColumn('product_units','is_visible');
    const hasActive  = await hasColumn('product_units','is_active');

    if (hasVisible)      await db.query(`UPDATE product_units SET is_visible=false WHERE unit_id=$1`, [id]);
    else if (hasActive)  await db.query(`UPDATE product_units SET is_active=false  WHERE unit_id=$1`, [id]);
    else                 await db.query(`DELETE FROM product_units WHERE unit_id=$1`, [id]);

    res.json({ ok:true });
  } catch (e) {
    console.error('delete product_unit error', e);
    res.status(500).json({ error: 'delete_error' });
  }
});

/* ---------- PUBLISH/UNPUBLISH + PROBE ---------- */
// PATCH /api/admin/units/__probe__/publish
router.patch('/__probe__/publish', (_req, res) => {
  res.json({ ok: true, probe: true });
});

// PATCH /api/admin/units/:id/publish
router.patch('/:id/publish', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'invalid id' });

    const hasVisible = await hasColumn('product_units','is_visible');
    const hasActive  = await hasColumn('product_units','is_active');
    const hasPub     = await hasColumn('product_units','is_published');

    // เปิดให้มองเห็น + active + (ถ้ามี) published
    const updates = [];
    const params = [];
    if (hasVisible) { updates.push(`is_visible=true`); }
    if (hasActive)  { updates.push(`is_active=true`); }
    if (hasPub)     { updates.push(`is_published=true`); }
    params.push(id);

    const sql = `UPDATE product_units SET ${updates.join(', ')} WHERE unit_id=$1 RETURNING *`;
    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ message: 'ไม่พบหน่วยสินค้า' });

    res.json({ ok:true, published:true, row: rows[0] });
  } catch (e) {
    console.error('publish product_unit error', e);
    res.status(500).json({ error: 'publish_error' });
  }
});

// PATCH /api/admin/units/:id/unpublish
router.patch('/:id/unpublish', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: 'invalid id' });

    const hasVisible = await hasColumn('product_units','is_visible');
    const hasActive  = await hasColumn('product_units','is_active');
    const hasPub     = await hasColumn('product_units','is_published');

    // ซ่อน (ถ้ามี is_visible), ปิด active (ถ้ามี), และ (ถ้ามี) unpublish
    const updates = [];
    const params = [];
    if (hasVisible) { updates.push(`is_visible=false`); }
    if (hasActive)  { updates.push(`is_active=false`); }
    if (hasPub)     { updates.push(`is_published=false`); }
    params.push(id);

    const sql = `UPDATE product_units SET ${updates.join(', ')} WHERE unit_id=$1 RETURNING *`;
    const { rows } = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ message: 'ไม่พบหน่วยสินค้า' });

    res.json({ ok:true, published:false, row: rows[0] });
  } catch (e) {
    console.error('unpublish product_unit error', e);
    res.status(500).json({ error: 'unpublish_error' });
  }
});

module.exports = router;
