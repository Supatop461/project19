// backend/server.js
// 🌿 Project19 Backend — Hardened server (safe requires + stable mounts)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('etag', false); // ปิด ETag กัน 304

/* ───────────── helpers ───────────── */
function tryRequire(p) {
  try { return require(p); } catch (e) { console.warn('⛔ SKIP require:', p, '-', e.code || e.message); return null; }
}
function mount(name, paths, router, ...guards) {
  if (!router) return;
  const arr = Array.isArray(paths) ? paths : [paths];
  app.use(arr, ...guards.filter(Boolean), router);
  console.log(`▶ ${name} router LOADED ->`, arr.join(', '));
}

/* ───────────── auth (safe default) ───────────── */
let requireAuth = (_req, _res, next) => next();
let requireRole  = () => (_req, _res, next) => next();
{
  const m = tryRequire('./middleware/auth');
  if (m) {
    requireAuth = m.requireAuth || requireAuth;
    requireRole = m.requireRole  || requireRole;
  }
}

/* ───────────── security & perf ───────────── */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/* ───────────── CORS ───────────── */
const rawOrigins =
  process.env.FRONTEND_ORIGIN ||
  'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000,http://127.0.0.1:5500';
const allowlist = rawOrigins.split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowlist.includes('*') || allowlist.includes(origin)) return cb(null, true);
    const err = new Error(`Not allowed by CORS: ${origin}`);
    err.status = 403;
    return cb(err, false);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* ───────────── body parser ───────────── */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/* ───────────── API cache headers ───────────── */
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.removeHeader?.('ETag');
    res.removeHeader?.('Last-Modified');
  }
  next();
});

/* ───────────── request debug ───────────── */
app.use((req, _res, next) => { console.log('>>>', req.method, req.originalUrl); next(); });

/* ───────────── health/root ───────────── */
app.get('/', (_req, res) => res.send('🌱 Plant Shop API is running...'));
app.get('/_health', (_req, res) => res.json({ ok: true, at: 'server.js', ts: Date.now() }));

/* ───────────── static uploads ───────────── */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: '1h' }));

/* ───────────── rate limit (login) ───────────── */
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

/* ───────────── require routers (safe) ───────────── */
const productStatusRoutes  = tryRequire('./routes/productStatus');
const adminProductRoutes   = tryRequire('./routes/adminProducts');
const adminVariantsRoutes  = tryRequire('./routes/adminVariants');
const uploadsRoutes        = tryRequire('./routes/uploads');
const categoryRoutes       = tryRequire('./routes/categories');
const orderRoutes          = tryRequire('./routes/orders');
const authRoutes           = tryRequire('./routes/auth');
const addressesRoutes      = tryRequire('./routes/addresses');
const variantRoutes        = tryRequire('./routes/variants');
const publicProductsRoutes = tryRequire('./routes/publicProducts');
const inventoryRoutes      = tryRequire('./routes/inventory');
const productImagesRoutes  = tryRequire('./routes/productImages');
const adminSubcatRoutes    = tryRequire('./routes/adminSubcategories');
const subcategoryRoutes    = tryRequire('./routes/subcategories');
const lookupsRouter        = tryRequire('./routes/lookups');
const dashboardRoutes      = tryRequire('./routes/dashboard');
const cartRoutes           = tryRequire('./routes/cart');
const analyticsRoutes      = tryRequire('./routes/analytics');
const adminUnitsRouter     = tryRequire('./routes/adminUnits');     // ✅
const publicUnitsRouter    = tryRequire('./routes/publicUnits');    // ✅
const sizeUnitsRouter      = tryRequire('./routes/sizeUnits');
const adminSizeUnitsRouter = tryRequire('./routes/adminSizeUnits');
const meRoutes             = tryRequire('./routes/me');

/* ───────────── public mounts ───────────── */
mount('auth',            ['/api/auth', '/auth'], authRoutes);
mount('me',              '/api/me', meRoutes);
mount('categories',      ['/api/categories', '/categories'], categoryRoutes);
mount('subcategories',   ['/api/subcategories', '/subcategories'], subcategoryRoutes);
mount('publicProducts',  '/api/products', publicProductsRoutes);
mount('publicUnits',     '/api', publicUnitsRouter);   // มี GET /api/units
mount('lookups',         '/api', lookupsRouter);

/* ───────────── admin/protected mounts ───────────── */
mount('adminUnits',      '/api', adminUnitsRouter);    // ควรรองรับทั้ง /api/units และ /api/admin/units ภายในไฟล์นี้
mount('sizeUnits',       '/api/size-units', sizeUnitsRouter);
mount('adminSizeUnits',  ['/api/admin/size-units','/api/admin/sizes'], adminSizeUnitsRouter, requireAuth, requireRole(['admin']));
mount('adminProducts',   ['/api/admin/products','/admin/products'], adminProductRoutes, requireAuth, requireRole(['admin']));
mount('adminVariants',   ['/api/admin/variants','/admin/variants'], adminVariantsRoutes, requireAuth, requireRole(['admin']));
mount('adminSubcats',    ['/api/admin/subcategories','/admin/subcategories'], adminSubcatRoutes, requireAuth, requireRole(['admin']));
mount('productStatus',   ['/api/product-status','/product-status'], productStatusRoutes, requireAuth, requireRole(['admin']));

/* ───────────── uploads/images guard ───────────── */
function pathStartsWith(p, prefix) { return p === prefix || p.startsWith(prefix + '/'); }
function lockAdminWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (pathStartsWith(req.baseUrl + req.path, '/api/upload'))  return next();
  if (pathStartsWith(req.baseUrl + req.path, '/api/uploads')) return next();
  return requireAuth(req, res, () => requireRole(['admin'])(req, res, next));
}
if (productImagesRoutes) {
  app.use(['/api/upload', '/api/uploads'], (req,res,next)=>lockAdminWrites(req,res,next), productImagesRoutes);
}

/* ───────────── protected mounts ───────────── */
mount('variants',   '/api/variants', variantRoutes, requireAuth);
mount('uploads',    ['/api/uploads','/api/upload','/upload'], uploadsRoutes, requireAuth);
mount('addresses',  ['/api/addresses','/addresses'], addressesRoutes, requireAuth);
mount('user-addresses', ['/api/user-addresses','/user-addresses'], addressesRoutes, requireAuth);
mount('orders',     ['/api/orders','/orders'], orderRoutes, requireAuth);
mount('inventory',  '/api/inventory', inventoryRoutes, requireAuth);
mount('cart',       '/api/cart', cartRoutes, requireAuth);
mount('analytics',  '/api/analytics', analyticsRoutes, requireAuth);
mount('dashboard',  '/api/dashboard', dashboardRoutes, requireAuth);

/* ───────────── route map debug ───────────── */
app.get('/_routes', (_req, res) => {
  const list = [];
  (app._router.stack || []).forEach((s) => {
    if (s.route && s.route.path) {
      const methods = Object.keys(s.route.methods).join(',').toUpperCase();
      list.push(`${methods.padEnd(10)} ${s.route.path}`);
    } else if (s.name === 'router' && s.regexp) {
      list.push(`ROUTER ${s.regexp}`);
    }
  });
  res.type('text').send(list.join('\n'));
});

/* ───────────── shim: orders/new-count ───────────── */
const db = tryRequire('./db');
app.get('/api/orders/new-count', async (_req, res) => {
  if (!db) return res.json({ count: 0 });
  try {
    const { rows } = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM orders
      WHERE (status IS NULL OR status IN ('new','pending','unpaid'))
    `).catch(() => ({ rows: [{ count: 0 }] }));
    res.json({ count: rows?.[0]?.count ?? 0 });
  } catch {
    res.json({ count: 0 });
  }
});

/* ───────────── errors ───────────── */
app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err);
  const isDev = process.env.NODE_ENV !== 'production';
  const payload = { message: 'Server error' };
  if (isDev && err?.message) payload.details = err.message;
  if (isDev && err?.code) payload.code = err.code;
  res.status(err.status || 500).json(payload);
});

/* ───────────── start ───────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📁 Static uploads at /uploads -> ${uploadsDir}`);
  console.log(`🔓 CORS allowlist: ${allowlist.join(', ')}`);
});
