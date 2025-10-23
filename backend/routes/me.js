const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

let pool;
try { pool = require('../db'); } catch { pool = require('../db/db'); }

const { requireAuth, requireRole } = require('../middleware/auth');

function joinName(f, l) { return [f, l].filter(Boolean).join(' '); }
function splitFullname(name) {
  if (!name) return { first: null, last: null };
  const parts = name.split(/\s+/);
  return { first: parts.shift() || null, last: parts.join(' ') || null };
}
function getUserId(req) {
  return req.user?.user_id ?? req.user?.id ?? req.user?.uid ?? null;
}

/* ========== GET /api/me ========== */
router.get('/me', requireAuth, requireRole(['admin','customer','user']), async (req, res) => {
  try {
    const id = getUserId(req);
    const sql = `
      SELECT user_id, username, email, first_name, last_name, phone_number, role_id, avatar_url
      FROM users WHERE user_id = $1
    `;
    const { rows } = await pool.query(sql, [id]);
    if (!rows.length) return res.status(404).json({ message: 'not found' });
    const u = rows[0];
    res.json({
      id: u.user_id,
      fullname: joinName(u.first_name, u.last_name),
      email: u.email,
      phone: u.phone_number,
      avatar_url: u.avatar_url,
      role: u.role_id === 1 ? 'admin' : 'user'
    });
  } catch (err) {
    console.error('GET /me error:', err);
    res.status(500).json({ message: 'internal error' });
  }
});

/* ========== PUT /api/me ========== */
router.put('/me', requireAuth, requireRole(['admin','customer','user']), async (req, res) => {
  try {
    const id = getUserId(req);
    const { fullname, phone, avatar_url } = req.body;
    const { first, last } = splitFullname(fullname);
    const sql = `
      UPDATE users
      SET first_name = COALESCE($2, first_name),
          last_name  = COALESCE($3, last_name),
          phone_number = COALESCE($4, phone_number),
          avatar_url = COALESCE($5, avatar_url),
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, first_name, last_name, phone_number, avatar_url, role_id
    `;
    const { rows } = await pool.query(sql, [id, first, last, phone, avatar_url]);
    res.json({
      id: rows[0].user_id,
      fullname: joinName(rows[0].first_name, rows[0].last_name),
      phone: rows[0].phone_number,
      avatar_url: rows[0].avatar_url,
      role: rows[0].role_id === 1 ? 'admin' : 'user'
    });
  } catch (err) {
    console.error('PUT /me error:', err);
    res.status(500).json({ message: 'internal error' });
  }
});

module.exports = router;
