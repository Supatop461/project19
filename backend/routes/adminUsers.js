// backend/routes/adminUsers.js
// ✅ จัดการผู้ใช้แบบ "Deactivate" แทนการลบ
// ✅ เปลี่ยนบทบาทต้องยืนยันรหัสแอดมินผู้สั่งการ (confirm_password)
// ✅ ห้ามเปลี่ยนสิทธิ์/ปิดใช้งานตัวเอง
// ✅ ต้องคงจำนวน "แอดมินที่ยัง active" ไว้ ≥ 1 คนเสมอ
// ❌ ไม่มี DELETE ผู้ใช้

const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

const { requireAuth, requireRole } = (() => {
  try { return require('../middleware/auth'); }
  catch { return { requireAuth: (_r,_s,n)=>n, requireRole: ()=>(_r,_s,n)=>n }; }
})();
const mustAdmin = [requireAuth, requireRole(['admin'])];

/* ---------- helpers ---------- */
async function resolveUserPK() { return 'user_id'; }

function currentAdminId(req) {
  return (
    req.user?.id ??
    req.user?.user_id ??
    req.auth?.id ??
    req.auth?.user_id ??
    null
  );
}

async function getUserById(id) {
  const pk = await resolveUserPK();
  const { rows } = await db.query(
    `SELECT ${pk} AS id, username, email, first_name, last_name, phone_number, role_id, COALESCE(is_active, TRUE) AS is_active
     FROM users WHERE ${pk} = $1 LIMIT 1`,
    [id]
  );
  return rows?.[0] || null;
}

async function countActiveAdmins() {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c
     FROM users
     WHERE role_id = 'admin' AND COALESCE(is_active, TRUE) = TRUE`
  );
  return rows?.[0]?.c ?? 0;
}

async function listUsers({ q, role, status }) {
  const where = [];
  const params = [];

  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push(`(u.username ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 1})`);
    params.push(like);
  }
  if (role && role !== 'all') {
    where.push(`u.role_id = $${params.length + 1}`);
    params.push(role);
  }
  if (status && status !== 'all') {
    if (status === 'active') where.push(`COALESCE(u.is_active, TRUE) = TRUE`);
    if (status === 'inactive') where.push(`COALESCE(u.is_active, TRUE) = FALSE`);
  }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT 
      u.user_id AS id,
      u.first_name, u.last_name, u.username, u.email, u.phone_number,
      u.role_id,
      COALESCE(u.is_active, TRUE) AS is_active,
      r.name_role AS role_name
    FROM users u
    LEFT JOIN roles r ON r.role_id = u.role_id
    ${whereSQL}
    ORDER BY u.user_id ASC
  `;
  const { rows } = await db.query(sql, params);

  return rows.map(r => ({
    id: r.id,
    username: r.username,
    email: r.email,
    name: [r.first_name, r.last_name].filter(Boolean).join(' ') || '-',
    phone: r.phone_number,
    role: r.role_id,
    role_name: r.role_name,
    is_admin: r.role_id === 'admin',
    is_active: !!r.is_active,
  }));
}

async function setRole(userId, make) {
  if (!['admin', 'user'].includes(make)) throw new Error(`invalid role: ${make}`);
  await db.query(`UPDATE users SET role_id = $1 WHERE user_id = $2`, [make, userId]);
}

async function setActive(userId, active) {
  await db.query(`UPDATE users SET is_active = $1 WHERE user_id = $2`, [!!active, userId]);
}

async function fetchPasswordHash(userId) {
  const pk = await resolveUserPK();
  const { rows } = await db.query(
    `SELECT password_hash FROM users WHERE ${pk} = $1 LIMIT 1`,
    [userId]
  );
  return rows?.[0]?.password_hash || null;
}

/* ---------- routes ---------- */

// ใครล็อกอินอยู่ (เพื่อกันปุ่มตัวเอง)
router.get('/admin/me', mustAdmin, async (req, res) => {
  return res.json({ id: currentAdminId(req), role: 'admin' });
});

// รายชื่อผู้ใช้
router.get('/admin/users', mustAdmin, async (req, res) => {
  try {
    const { q = '', role = 'all', status = 'all' } = req.query || {};
    const items = await listUsers({ q, role, status });
    res.json({ items, total: items.length });
  } catch (e) {
    console.error('GET /admin/users error:', e);
    res.status(500).json({ error: 'failed_to_list_users', detail: e.message });
  }
});

// เปลี่ยนบทบาท (ต้องยืนยันรหัสผ่านแอดมินผู้สั่งการ)
router.patch('/admin/users/:id/role', mustAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { make, confirm_password } = req.body || {};

    if (!['admin', 'user'].includes(make)) {
      return res.status(400).json({ error: 'invalid_make', hint: "make must be 'admin' or 'user'" });
    }
    if (!confirm_password || String(confirm_password).length < 1) {
      return res.status(400).json({ error: 'missing_confirm_password', hint: 'ต้องกรอกรหัสผ่านยืนยัน' });
    }

    const adminId = currentAdminId(req);
    if (!adminId) return res.status(401).json({ error: 'unauthorized' });

    const hash = await fetchPasswordHash(adminId);
    if (!hash) return res.status(403).json({ error: 'no_password_set' });

    const ok = await bcrypt.compare(String(confirm_password), String(hash));
    if (!ok) return res.status(403).json({ error: 'invalid_password', message: 'รหัสผ่านยืนยันไม่ถูกต้อง' });

    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: 'user_not_found' });

    // ห้ามเปลี่ยนสิทธิ์ตัวเอง
    if (String(adminId) === String(id)) {
      return res.status(403).json({ error: 'cannot_change_self', message: 'ห้ามเปลี่ยนสิทธิ์ของบัญชีที่กำลังล็อกอิน' });
    }

    // ต้องเหลือแอดมินที่ active ≥ 1
    if (target.role_id === 'admin' && make === 'user' && target.is_active) {
      const c = await countActiveAdmins();
      if (c <= 1) {
        return res.status(409).json({ error: 'must_keep_one_admin', message: 'ต้องมีแอดมินที่ยังใช้งานอยู่ อย่างน้อย 1 คนเสมอ' });
      }
    }

    await setRole(id, make);
    const [updated] = (await listUsers({ q: '', role: 'all', status: 'all' }))
      .filter(u => String(u.id) === String(id));
    res.json({ ok: true, user: updated });
  } catch (e) {
    console.error('PATCH /admin/users/:id/role error:', e);
    res.status(500).json({ error: 'failed_to_update_role', detail: e.message });
  }
});

// เปิด/ปิดการใช้งาน (Deactivate) — ต้องยืนยันรหัสแอดมินผู้สั่งการ
router.patch('/admin/users/:id/active', mustAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { active, confirm_password } = req.body || {};
    const toActive = !!active;

    if (typeof active === 'undefined') {
      return res.status(400).json({ error: 'missing_active_flag', hint: 'active must be true/false' });
    }
    if (!confirm_password || String(confirm_password).length < 1) {
      return res.status(400).json({ error: 'missing_confirm_password', hint: 'ต้องกรอกรหัสผ่านยืนยัน' });
    }

    const adminId = currentAdminId(req);
    if (!adminId) return res.status(401).json({ error: 'unauthorized' });

    const hash = await fetchPasswordHash(adminId);
    if (!hash) return res.status(403).json({ error: 'no_password_set' });

    const ok = await bcrypt.compare(String(confirm_password), String(hash));
    if (!ok) return res.status(403).json({ error: 'invalid_password', message: 'รหัสผ่านยืนยันไม่ถูกต้อง' });

    const target = await getUserById(id);
    if (!target) return res.status(404).json({ error: 'user_not_found' });

    // ห้ามปิดใช้งานตัวเอง
    if (!toActive && String(adminId) === String(id)) {
      return res.status(403).json({ error: 'cannot_deactivate_self', message: 'ห้ามปิดการใช้งานบัญชีที่กำลังล็อกอิน' });
    }

    // ถ้าปิดใช้งานแอดมิน ต้องเหลือแอดมินที่ active ≥ 1
    if (!toActive && target.role_id === 'admin' && target.is_active) {
      const c = await countActiveAdmins();
      if (c <= 1) {
        return res.status(409).json({ error: 'must_keep_one_admin', message: 'ต้องมีแอดมินที่ยังใช้งานอยู่ อย่างน้อย 1 คนเสมอ' });
      }
    }

    await setActive(id, toActive);
    const [updated] = (await listUsers({ q: '', role: 'all', status: 'all' }))
      .filter(u => String(u.id) === String(id));
    res.json({ ok: true, user: updated });
  } catch (e) {
    console.error('PATCH /admin/users/:id/active error:', e);
    res.status(500).json({ error: 'failed_to_update_active', detail: e.message });
  }
});

console.log('▶ adminUsers router LOADED');
module.exports = router;
