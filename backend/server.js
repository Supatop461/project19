// backend/server.js — Fixed: duplicate /api/me route removed

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
app.set('etag', false);

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

/* ───────────── cache headers ───────────── */
app.use((req, res, next) => {
  if (req.originalUrl.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use((req, _res, next) => { console.log('>>>', req.method, req.originalUrl); next(); });

app.get('/', (_req, res) => res.send('🌱 Plant Shop API is running...'));

/* ───────────── static uploads ───────────── */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads',     express.static(uploadsDir, { maxAge: '1h' }));
app.use('/api/uploads', express.static(uploadsDir, { maxAge: '1h' }));

/* ───────────── rate limit (login) ───────────── */
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

/* ───────────── require routers ───────────── */
const authRoutes           = tryRequire('./routes/auth');
const meRoutes             = tryRequire('./routes/me');
const categoryRoutes       = tryRequire('./routes/categories');
const subcategoryRoutes    = tryRequire('./routes/subcategories');
const publicProductsRoutes = tryRequire('./routes/publicProducts');
const publicUnitsRouter    = tryRequire('./routes/publicUnits');
const lookupsRouter        = tryRequire('./routes/lookups');
const adminUnitsRouter     = tryRequire('./routes/adminUnits');
const adminUsersRouter     = tryRequire('./routes/adminUsers');
const adminProductsRoutes  = tryRequire('./routes/adminProducts');
const adminVariantsRoutes  = tryRequire('./routes/adminVariants');
const adminSubcatRoutes    = tryRequire('./routes/adminSubcategories');
const productStatusRoutes  = tryRequire('./routes/productStatus');
const adminOrdersRoutes    = tryRequire('./routes/adminOrders');
const uploadsRoutes        = tryRequire('./routes/uploads');
const addressesRoutes      = tryRequire('./routes/addresses');
const variantRoutes        = tryRequire('./routes/variants');
const inventoryRoutes      = tryRequire('./routes/inventory');
const dashboardRoutes      = tryRequire('./routes/dashboard');
const cartRoutes           = tryRequire('./routes/cart');
const analyticsRoutes      = tryRequire('./routes/analytics');
const sizeUnitsRouter      = tryRequire('./routes/sizeUnits');
const adminSizeUnitsRouter = tryRequire('./routes/adminSizeUnits');

/* ───────────── PUBLIC mounts ───────────── */
mount('auth', ['/api/auth', '/auth'], authRoutes);
// ✅ โหลด me หลัง auth (เพื่อ override /me เก่าจาก auth.js)
mount('me', '/api/me', meRoutes, requireAuth, requireRole(['admin','customer','user']));
mount('categories', ['/api/categories', '/categories'], categoryRoutes);
mount('subcategories', ['/api/subcategories', '/subcategories'], subcategoryRoutes);
mount('publicProducts', '/api/products', publicProductsRoutes);
mount('publicUnits', '/api', publicUnitsRouter);
mount('lookups', '/api', lookupsRouter);

/* ───────────── ADMIN mounts ───────────── */
mount('adminUnits', '/api', adminUnitsRouter);
mount('adminUsers', '/api', adminUsersRouter, requireAuth, requireRole(['admin']));
mount('adminProducts', ['/api/admin/products','/admin/products'], adminProductsRoutes, requireAuth, requireRole(['admin']));
mount('adminVariants', ['/api/admin/variants','/admin/variants'], adminVariantsRoutes, requireAuth, requireRole(['admin']));
mount('adminSubcats', ['/api/admin/subcategories','/admin/subcategories'], adminSubcatRoutes, requireAuth, requireRole(['admin']));
mount('adminOrders', ['/api/admin/orders','/admin/orders'], adminOrdersRoutes, requireAuth, requireRole(['admin']));
mount('productStatus', ['/api/product-status','/product-status'], productStatusRoutes, requireAuth, requireRole(['admin']));
mount('sizeUnits', '/api/size-units', sizeUnitsRouter);
mount('adminSizeUnits', ['/api/admin/size-units','/api/admin/sizes'], adminSizeUnitsRouter, requireAuth, requireRole(['admin']));

/* ───────────── USER mounts ───────────── */
mount('uploads', ['/api/uploads','/api/upload','/upload'], uploadsRoutes, requireAuth);
mount('addresses', ['/api/addresses','/addresses'], addressesRoutes, requireAuth);
mount('variants', '/api/variants', variantRoutes);
mount('inventory', '/api/inventory', inventoryRoutes, requireAuth);
mount('cart', '/api/cart', cartRoutes, requireAuth);
mount('analytics', '/api/analytics', analyticsRoutes, requireAuth);
mount('dashboard', '/api/dashboard', dashboardRoutes, requireAuth);

/* ───────────── error handlers ───────────── */
app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err);
  res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

/* ───────────── start ───────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Uploads at /uploads`);
});
