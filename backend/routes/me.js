// backend/routes/me.js
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

/* ---------- DB import ---------- */
let pool;
try { pool = require('../db'); }
catch { pool = require('../db/db'); }

/* ---------- Auth middleware ---------- */
let requireAuth;
try { ({ requireAuth } = require('../middleware/auth')); }
catch { ({ requireAuth } = require('../middleware/authMiddleware')); }

/* ---------- helpers ---------- */
function joinName(first, last) {
  return [first, last].filter(Boolean).join(' ').trim();
}
function splitFullname(fullname) {
  if (!fullname) return { first: null, last: null };
  const parts = String(fullname).trim().split(/\s+/);
  const first = parts.shift() || null;
  const last = parts.length ? parts.join(' ') : null;
  return { first, last };
}
function getUserIdFromReq(req) {
  return (
    req.user?.id ??
    req.user?.user_id ??
    req.user?.uid ??
    req.user?.sub ??
    req.userId ??
    req.auth?.id ??
    req.auth?.user_id ??
    null
  );
}
function getUserIdFromTokenHeader(req) {
  const hdr = req.headers?.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.decode(token); // decode เฉย ๆ ไม่ verify
    return payload?.id ?? payload?.user_id ?? payload?.uid ?? payload?.sub ?? null;
  } catch {
    return null;
  }
}

/* ---------- debug ---------- */
router.get('/me/debug', (req, res) => {
  const hdr = req.headers?.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const decoded = token ? jwt.decode(token) : null;
  res.json({
    note: 'debug endpoint',
    authHeaderPresent: Boolean(token),
    req_user: req.user || null,
    parsedUserId_fromReq: getUserIdFromReq(req),
    decoded_payload: decoded,
    parsedUserId_fromToken: decoded
      ? (decoded.id || decoded.user_id || decoded.uid || decoded.sub || null)
      : null,
  });
});

/* ========== GET /api/me ========== */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req) ?? getUserIdFromTokenHeader(req);
    if (!userId) return res.status(401).json({ message: 'invalid token: no user id' });

    const sql = `
      SELECT user_id, username, email,
             first_name, last_name, phone_number, role_id,
             avatar_url
      FROM users
      WHERE user_id = $1
    `;
    const { rows } = await pool.query(sql, [userId]);
    if (!rows.length) return res.status(404).json({ message: 'not found' });

    const u = rows[0];
    const fullname = joinName(u.first_name, u.last_name) || u.username || '';

    return res.json({
      id: u.user_id,
      email: u.email || '',
      fullname,
      phone: u.phone_number || '',
      avatar_url: u.avatar_url || null,
      role: u.role_id || 'customer',
    });
  } catch (err) {
    console.error('GET /api/me error:', err);
    return res.status(500).json({ message: 'internal error' });
  }
});

/* ========== PUT /api/me ========== */
/* body: { fullname?, phone?, avatar_url? } */
router.put('/me', requireAuth, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req) ?? getUserIdFromTokenHeader(req);
    if (!userId) return res.status(401).json({ message: 'invalid token: no user id' });

    const { fullname = null, phone = null, avatar_url = null } = req.body || {};
    const { first, last } = splitFullname(fullname);

    const sql = `
      UPDATE users
         SET first_name   = COALESCE($2, first_name),
             last_name    = COALESCE($3, last_name),
             phone_number = COALESCE($4, phone_number),
             avatar_url   = COALESCE($5, avatar_url),
             updated_at   = NOW()
       WHERE user_id = $1
   RETURNING user_id, email, first_name, last_name, phone_number, role_id, avatar_url
    `;
    const { rows } = await pool.query(sql, [userId, first, last, phone, avatar_url]);
    if (!rows.length) return res.status(404).json({ message: 'not found' });

    const u = rows[0];
    return res.json({
      id: u.user_id,
      email: u.email || '',
      fullname: joinName(u.first_name, u.last_name) || '',
      phone: u.phone_number || '',
      avatar_url: u.avatar_url || null,
      role: u.role_id || 'customer',
    });
  } catch (err) {
    console.error('PUT /api/me error:', err);
    return res.status(500).json({ message: 'internal error' });
  }
});

module.exports = router;
