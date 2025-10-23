// backend/middleware/auth.js
const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET  || 'dev-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || JWT_SECRET === 'dev-secret')) {
  throw new Error('JWT_SECRET must be set in production');
}

/* -------------------------------------------------------------
   Roles:
   - role_id: 1 -> admin
   - role_id: 2 -> customer
   - default  -> user
------------------------------------------------------------- */
const roleMap = { 1: 'admin', 2: 'customer' };

/** Normalize any role input into: 'admin' | 'customer' | 'user' */
function normalizeRole(input) {
  if (input === undefined || input === null || input === '') return 'user';

  // if number-like (1/2 or '1'/'2')
  const n = Number(input);
  if (Number.isFinite(n) && roleMap[n]) return roleMap[n];

  // string-like
  const s = String(input).trim().toLowerCase();
  if (s === '1' || s === '2') return roleMap[Number(s)];
  if (s === 'admin' || s === 'customer' || s === 'user') return s;

  // fallback
  return 'user';
}

/* =============================================================
   requireAuth — Verify Bearer token and attach req.user
============================================================= */
function requireAuth(req, res, next) {
  const h = (req.headers.authorization || '').trim();
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    console.warn('[AUTH FAIL:NO TOKEN]', req.method, req.originalUrl);
    return res.status(401).json({ ok: false, error: 'Token required' });
  }

  try {
    const token = m[1].trim();
    const payload = jwt.verify(token, JWT_SECRET);

    const role = normalizeRole(payload.role ?? payload.role_id);

    const sub = String(payload.sub ?? payload.user_id ?? payload.id ?? '');
    req.user = {
      ...payload,
      sub,
      user_id: payload.user_id ?? payload.id ?? sub,
      role,
      role_id: payload.role_id ?? null,
      email: payload.email ?? null,
      name: payload.name ?? null,
    };

    req.userId = req.user.sub;
    req.userRole = role;
    res.locals.user = req.user;

    console.log('[AUTH OK]', {
      m: req.method,
      url: req.originalUrl,
      uid: req.user?.user_id,
      role: req.userRole,
    });

    next();
  } catch (err) {
    const code = err?.name === 'TokenExpiredError' ? 'token_expired' : 'invalid_token';
    console.warn('[AUTH FAIL:VERIFY]', req.method, req.originalUrl, code);
    return res.status(401).json({ ok: false, error: 'Invalid or expired token', code });
  }
}

/* =============================================================
   requireRole — Gate by roles
   - Usage:
       app.use('/x', requireAuth, requireRole('admin'));
       app.use('/y', requireAuth, requireRole(['admin','customer']));
       app.use('/z', requireAuth, requireRole()); // default: allow all authenticated roles
============================================================= */
function requireRole() {
  // support both: requireRole('admin','customer') and requireRole(['admin','customer'])
  const arg0 = arguments[0];
  const allowRaw = Array.isArray(arg0) ? arg0 : Array.from(arguments);

  // default: allow all known roles
  const allow = (allowRaw.length ? allowRaw : ['admin', 'customer', 'user']).map(normalizeRole);

  return (req, res, next) => {
    if (!req.user) {
      console.warn('[ROLE FAIL:NO USER]', req.method, req.originalUrl, { allow });
      return res.status(401).json({ ok: false, error: 'Token required' });
    }
    const ok = allow.includes(req.userRole);
    console.log('[ROLE CHECK]', {
      m: req.method,
      url: req.originalUrl,
      allow,
      userRole: req.userRole,
      ok,
    });
    if (!ok) return res.status(403).json({ ok: false, error: 'Forbidden' });
    next();
  };
}

/* =============================================================
   signToken — Issue JWT on login
============================================================= */
function signToken(userRow) {
  const roleValue =
    roleMap[userRow.role_id] ||
    normalizeRole(userRow.role) ||
    'user';

  const sub = String(userRow.user_id ?? userRow.id);
  const payload = {
    sub,
    email: userRow.email,
    role: normalizeRole(roleValue),
    name: `${userRow.first_name || ''} ${userRow.last_name || ''}`.trim(),
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

/* =============================================================
   requireAdmin — For admin-only routes
============================================================= */
const requireAdmin = [requireAuth, requireRole('admin')];

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  signToken,
};
