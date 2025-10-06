// backend/routes/auth.js
// ใช้ร่วมกับ server.js: app.use('/api/auth', router)

const express = require('express');
const db = require('../db');
const { requireAuth, signToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

let bcrypt;
try { bcrypt = require('bcrypt'); } catch { try { bcrypt = require('bcryptjs'); } catch { bcrypt = null; } }

const router = express.Router();
console.log('▶ auth router LOADED');

/* ============== Role helpers ============== */
function normalizeRole(role_id) {
  const x = String(role_id || '').toLowerCase().trim();
  if (['admin','administrator','superadmin','owner','root','a1'].includes(x) || x.startsWith('admin')) return 'admin';
  if (['staff','operator','manager','editor','s1'].includes(x)) return 'staff';
  return 'customer';
}

/* DEBUG */
router.get('/_debug', (_req, res) => res.json({ ok: true, at: '/api/auth' }));

/* ============== REGISTER ============== */
router.post(
  '/register',
  [
    body('first_name').trim().notEmpty().withMessage('กรอกชื่อ'),
    body('last_name').trim().notEmpty().withMessage('กรอกนามสกุล'),
    body('email').isEmail().withMessage('อีเมลไม่ถูกต้อง').normalizeEmail(),
    body('username').trim().isLength({ min: 3 }).withMessage('username ต้อง ≥ 3 ตัวอักษร')
      .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('ใช้ได้เฉพาะ a-z, 0-9, _ . -'),
    body('password').isLength({ min: 8 }).withMessage('รหัสผ่าน ≥ 8 ตัวอักษร'),
    body('confirm_password').custom((v, { req }) => { if (v !== req.body.password) throw new Error('ยืนยันรหัสผ่านไม่ตรง'); return true; }),
    body('phone_number').optional({ nullable: true }).isLength({ min: 6 }).withMessage('เบอร์ไม่ถูกต้อง'),
    body('address').optional({ nullable: true }).isLength({ max: 500 }).withMessage('ที่อยู่ยาวเกินไป'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const first_name   = (req.body.first_name || '').trim();
      const last_name    = (req.body.last_name  || '').trim();
      const email        = (req.body.email      || '').trim().toLowerCase();
      const username     = (req.body.username   || '').trim();
      const password     = (req.body.password   || '').toString();
      const phone_number = (req.body.phone_number || null);
      const address      = (req.body.address || null);

      const dupEmail = await db.query('SELECT 1 FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1', [email]);
      if (dupEmail.rows.length) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });

      const dupUser = await db.query('SELECT 1 FROM users WHERE username=$1 LIMIT 1', [username]);
      if (dupUser.rows.length) return res.status(409).json({ error: 'Username นี้ถูกใช้งานแล้ว' });

      if (!bcrypt) return res.status(500).json({ error: 'bcrypt module not available' });
      const password_hash = await bcrypt.hash(password, 12);
      const role_id = 'customer';

      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const { rows } = await client.query(
          `INSERT INTO users
             (first_name, last_name, username, email, phone_number, registration_date, role_id, password_hash)
           VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,$6,$7)
           RETURNING user_id, first_name, last_name, username, email, phone_number, role_id`,
          [first_name, last_name, username, email, phone_number || null, role_id, password_hash]
        );
        const user = rows[0];

        if (user && address && String(address).trim()) {
          await client.query(
            `INSERT INTO user_addresses
               (user_id, label, recipient_name, phone, line1, line2, subdistrict, district, province, postal_code, country, is_default)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, TRUE)`,
            [
              user.user_id,
              'ที่อยู่จากสมัครสมาชิก',
              `${first_name} ${last_name}`.trim() || null,
              phone_number || null,
              address,
              null, null, null, null,
              extractPostcode(address),
              'TH',
            ]
          );
        }

        await client.query('COMMIT');

        const token = signToken(user);
        const role = normalizeRole(user.role_id);
        return res.status(201).json({ token, role, user: { ...user, role } });
      } catch (txErr) {
        await client.query('ROLLBACK');
        console.error('❌ REGISTER TX ERROR:', txErr);
        return res.status(500).json({ error: 'Server error' });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('❌ REGISTER ERROR:', err);
      return res.status(500).json({ error: 'Server error' });
    }
  }
);

/* ============== LOGIN ============== */
// รองรับ: { email_or_username, password }  (จาก frontend)
// ก็ยังรองรับ { email | username | id, password } ได้เช่นกัน
router.post('/login', async (req, res) => {
  let { email_or_username, email, username, id, password } = req.body || {};
  password = (password || '').toString();
  const identRaw = (email_or_username || email || username || id || '').toString().trim();

  if (!identRaw || !password) {
    return res.status(400).json({ error: 'email_or_username และ password จำเป็น' });
  }

  try {
    let whereSql = 'LOWER(email)=LOWER($1) OR LOWER(username)=LOWER($1)';
    const params = [identRaw];
    if (/^\d+$/.test(identRaw)) { whereSql += ' OR user_id=$2'; params.push(Number(identRaw)); }

    const { rows } = await db.query(
      `SELECT user_id, first_name, last_name, username, email, role_id,
              password_hash, password, phone_number
         FROM users
        WHERE ${whereSql}
        LIMIT 1`,
      params
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const u = rows[0];

    let ok = false;
    if (u.password_hash && bcrypt) {
      ok = await bcrypt.compare(password, u.password_hash);
    } else if (u.password) {
      ok = (u.password === password);
      if (ok && bcrypt) {
        const newHash = await bcrypt.hash(password, 12);
        await db.query(`UPDATE users SET password_hash=$1, password=NULL WHERE user_id=$2`, [newHash, u.user_id]);
        u.password_hash = newHash;
      }
    } else {
      ok = false;
    }

    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(u);
    const role = normalizeRole(u.role_id);
    return res.json({
      token,
      role,
      user: {
        user_id: u.user_id,
        email: u.email,
        username: u.username,
        full_name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        role,
      },
    });
  } catch (e) {
    console.error('❌ LOGIN ERROR:', e);
    return res.status(500).json({ error: 'Database error' });
  }
});

/* ============== ME ============== */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT user_id, first_name, last_name, username, email, role_id, phone_number
         FROM users
        WHERE user_id = $1
        LIMIT 1`,
      [req.user.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const u = rows[0];
    const role = normalizeRole(u.role_id);

    res.json({
      role,
      user: {
        user_id: u.user_id,
        email: u.email,
        username: u.username,
        full_name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
        phone_number: u.phone_number || null,
        role,
      },
    });
  } catch (e) {
    console.error('❌ ME ERROR:', e);
    return res.status(500).json({ error: 'Database error' });
  }
});

/* ============== Utils ============== */
function extractPostcode(str) {
  if (!str) return null;
  const m = String(str).match(/(\d{5})\s*$/);
  return m ? m[1] : null;
}

module.exports = router;
