// routes/roles.js
// ✨ จัดการบทบาท: list / create / update name / delete (รองรับ reassign ผู้ใช้ก่อนลบ)

const express = require('express');
const router = express.Router();
const db = require('../db');

// -------- Helper: แปลงให้เป็น string safe --------
function str(v) { return (v ?? '').toString().trim(); }

// ---------- GET /api/roles  → รายชื่อบทบาททั้งหมด ----------
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT role_id, name_role FROM roles ORDER BY role_id`
    );
    res.json(rows);
  } catch (e) {
    console.error('list roles error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- POST /api/roles  { role_id, name_role } ----------
/*
  สร้างบทบาทใหม่
  - ป้องกัน id ว่าง/ยาว/ตัวอักษรแปลก ๆ (อนุญาต a-z0-9_-)
*/
router.post('/', async (req, res) => {
  let { role_id, name_role } = req.body || {};
  role_id = str(role_id).toLowerCase();
  name_role = str(name_role);

  if (!role_id || !/^[a-z0-9_-]{2,32}$/.test(role_id)) {
    return res.status(400).json({ error: 'invalid role_id (allowed: a-z0-9_- length 2..32)' });
  }
  if (!name_role) return res.status(400).json({ error: 'name_role required' });

  try {
    const { rows } = await db.query(
      `INSERT INTO roles (role_id, name_role)
       VALUES ($1, $2)
       ON CONFLICT (role_id) DO UPDATE SET name_role = EXCLUDED.name_role
       RETURNING role_id, name_role`,
      [role_id, name_role]
    );
    res.status(201).json({ ok: true, role: rows[0] });
  } catch (e) {
    console.error('create role error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- PUT /api/roles/:id  { name_role } ----------
/*
  แก้ “ชื่อที่แสดง” ของบทบาท (ไม่เปลี่ยน role_id เพื่อเลี่ยงปัญหา FK)
*/
router.put('/:id', async (req, res) => {
  const id = str(req.params.id).toLowerCase();
  const { name_role } = req.body || {};
  if (!name_role) return res.status(400).json({ error: 'name_role required' });

  try {
    const { rowCount, rows } = await db.query(
      `UPDATE roles SET name_role=$1 WHERE role_id=$2
       RETURNING role_id, name_role`,
      [name_role, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Role not found' });
    res.json({ ok: true, role: rows[0] });
  } catch (e) {
    console.error('update role error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- DELETE /api/roles/:id  [?reassign_to=<role_id>] ----------
/*
  ลบบทบาท:
  - ถ้าไม่มีผู้ใช้อ้างอิง → ลบได้เลย
  - ถ้ามีผู้ใช้อ้างอิง:
      * ถ้ามี query reassign_to → โยกผู้ใช้ทั้งหมดไปบทบาทนั้น แล้วค่อยลบ
      * ถ้าไม่ระบุ → 400 (ป้องกันการ orphan ข้อมูล)
  - กันไม่ให้ลบ 'admin'/'user' ง่าย ๆ ถ้าไม่ reassign (ป้องกันระบบพัง)
*/
router.delete('/:id', async (req, res) => {
  const id = str(req.params.id).toLowerCase();
  const reassignTo = req.query.reassign_to ? str(req.query.reassign_to).toLowerCase() : null;

  try {
    // บทบาทมีอยู่ไหม
    const { rowCount: roleExists } = await db.query(`SELECT 1 FROM roles WHERE role_id=$1`, [id]);
    if (!roleExists) return res.status(404).json({ error: 'Role not found' });

    // นับผู้ใช้ที่อ้างอิงบทบาทนี้
    const { rows: cnt } = await db.query(`SELECT COUNT(*)::int AS c FROM users WHERE role_id=$1`, [id]);
    const used = cnt[0].c;

    if (used > 0) {
      if (!reassignTo) {
        return res.status(400).json({ error: `Role in use by ${used} users. Provide ?reassign_to=<role_id>.` });
      }
      // ปลายทางต้องมีจริง และห้ามเป็น id เดิม
      if (reassignTo === id) return res.status(400).json({ error: 'reassign_to must be different role_id' });
      const { rowCount: targetExists } = await db.query(`SELECT 1 FROM roles WHERE role_id=$1`, [reassignTo]);
      if (!targetExists) return res.status(400).json({ error: 'reassign_to role not found' });

      // ทำเป็นทรานแซกชัน: โยกผู้ใช้ → ลบ role
      await db.query('BEGIN');
      await db.query(`UPDATE users SET role_id=$1 WHERE role_id=$2`, [reassignTo, id]);
      await db.query(`DELETE FROM roles WHERE role_id=$1`, [id]);
      await db.query('COMMIT');
      return res.json({ ok: true, moved: used, deleted_role: id, reassign_to: reassignTo });
    }

    // ไม่มีผู้ใช้อ้าง → ลบตรง ๆ
    await db.query(`DELETE FROM roles WHERE role_id=$1`, [id]);
    res.json({ ok: true, deleted_role: id });
  } catch (e) {
    await db.query('ROLLBACK').catch(()=>{});
    console.error('delete role error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
