// backend/middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET  || 'dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || JWT_SECRET === 'dev-secret')) {
  throw new Error('JWT_SECRET must be set in production');
}

// ✅ ใช้มาตรฐาน: admin / customer
const roleMap = { 1: 'admin', 2: 'customer' };
const normalizeRole = (r) => String(r || '').toLowerCase();

/** ตรวจ Bearer token แล้วแปะ payload เข้า req.user (มี log ช่วยสืบ) */
function requireAuth(req, res, next) {
  const h = (req.headers.authorization || '').trim();
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    console.warn('[AUTH FAIL:NO TOKEN]', req.method, req.originalUrl);
    return res.status(401).json({ message: 'Token required' });
  }

  try {
    const token = m[1].trim();
    const payload = jwt.verify(token, JWT_SECRET);

    // ทำให้ role เป็นมาตรฐานเดียวกัน
    const role = normalizeRole(payload.role);

    req.user = {
      ...payload,
      sub: String(payload.sub || ''),   // user_id ในรูป string
      user_id: payload.sub,
      role,                             // => 'customer' | 'admin'
      role_id: payload.role_id || null,
      email: payload.email || null,
      name: payload.name || null,
    };

    req.userId = req.user.sub;
    req.userRole = role;
    res.locals.user = req.user;

    console.log('[AUTH OK]', {
      m: req.method,
      url: req.originalUrl,
      uid: req.user?.user_id,
      role: req.userRole
    });

    next();
  } catch (err) {
    const code = err?.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
    console.warn('[AUTH FAIL:VERIFY]', req.method, req.originalUrl, code);
    return res.status(401).json({ message: 'Invalid or expired token', code });
  }
}

/** บังคับบทบาท (มี log ช่วยสืบ) */
function requireRole(roles = []) {
  const allow = (Array.isArray(roles) ? roles : [roles]).map(normalizeRole);
  return (req, res, next) => {
    if (!req.user) {
      console.warn('[ROLE FAIL:NO USER]', req.method, req.originalUrl, { allow });
      return res.status(401).json({ message: 'Token required' });
    }
    if (allow.length === 0) return next();
    const ok = allow.includes(req.userRole);
    console.log('[ROLE CHECK]', {
      m: req.method,
      url: req.originalUrl,
      allow,
      userRole: req.userRole,
      ok
    });
    if (ok) return next();
    return res.status(403).json({ message: 'Forbidden: insufficient role' });
  };
}

/** ออก JWT ตอนล็อกอิน */
function signToken(userRow) {
  // ✅ map เป็น customer แทน user
  const roleValue = roleMap[userRow.role_id] || userRow.role_id || userRow.role || 'customer';
  const payload = {
    sub:   String(userRow.user_id),
    email: userRow.email,
    role:  normalizeRole(roleValue), // => 'admin' | 'customer'
    name:  `${userRow.first_name || ''} ${userRow.last_name || ''}`.trim(),
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

const requireAdmin = [requireAuth, requireRole(['admin'])];

module.exports = { requireAuth, requireRole, requireAdmin, signToken };
