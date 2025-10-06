// routes/users.js
// ✨ ผู้ดูแลจัดการผู้ใช้: list + เปลี่ยนบทบาทรายคน

const express = require('express');
const router = express.Router();
const db = require('../../db');

// Helper: เพจจิ้ง
function toPosInt(v, d){ const n=parseInt(v,10); return Number.isFinite(n)&&n>0?n:d; }

// ---------- GET /api/users?role_id=&q=&page=&pageSize= ----------
/*
  - กรองตาม role_id ได้
  - ค้นหากลาง ๆ (email/username/ชื่อ) ด้วย q
*/
router.get('/', async (req, res) => {
  const page = toPosInt(req.query.page, 1);
  const pageSize = Math.min(toPosInt(req.query.pageSize, 20), 100);
  const offset = (page - 1) * pageSize;

  const { role_id, q } = req.query;
  const where=[], params=[];

  if (role_id){ params.push(role_id); where.push(`u.role_id = $${params.length}`); }
  if (q){
    params.push(`%${q}%`,`%${q}%`,`%${q}%`);
    const a=params.length-2,b=params.length-1,c=params.length;
    where.push(`(LOWER(u.email) LIKE LOWER($${a}) OR LOWER(u.username) LIKE LOWER($${b}) OR LOWER(CONCAT(u.first_name,' ',u.last_name)) LIKE LOWER($${c}))`);
  }
  const whereSql = where.length?`WHERE ${where.join(' AND ')}`:'';

  try {
    const { rows: c } = await db.query(`SELECT COUNT(*)::int AS total FROM users u ${whereSql}`, params);
    const total = c[0].total;

    const { rows } = await db.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.username, u.email, u.role_id,
              r.name_role
       FROM users u
       LEFT JOIN roles r ON r.role_id=u.role_id
       ${whereSql}
       ORDER BY u.user_id
       LIMIT $${params.length+1} OFFSET $${params.length+2}`,
      [...params, pageSize, offset]
    );
    res.json({ page, pageSize, total, rows });
  } catch (e) {
    console.error('list users error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- PUT /api/users/:id/role  { role_id } ----------
/*
  เปลี่ยนบทบาทผู้ใช้รายคน (เช็คว่าบทบาทปลายทางมีจริง)
*/
router.put('/:id/role', async (req, res) => {
  const id = parseInt(req.params.id,10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const role_id = (req.body?.role_id ?? '').toString().trim().toLowerCase();
  if (!role_id) return res.status(400).json({ error: 'role_id required' });

  try {
    const { rowCount: exists } = await db.query(`SELECT 1 FROM roles WHERE role_id=$1`, [role_id]);
    if (!exists) return res.status(400).json({ error: 'role not found' });

    const { rows, rowCount } = await db.query(
      `UPDATE users SET role_id=$1 WHERE user_id=$2
       RETURNING user_id, email, username, role_id`,
      [role_id, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found' });

    res.json({ ok:true, user: rows[0] });
  } catch (e) {
    console.error('update user role error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
