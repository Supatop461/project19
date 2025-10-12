// backend/server.js
// 🌿 Project19 Backend — Stable build (11 Oct refined)
// ใช้โครงสร้างเดิม 100% + เพิ่มความเรียบร้อย log และปรับ Units ให้เข้ากับชุดปัจจุบัน

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireRole } = require('./middleware/auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('etag', false); // 🔴 ปิด ETag ป้องกัน 304-cache

/* ───────────────────────── Security ───────────────────────── */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/* ───────────────────────── CORS ───────────────────────────── */
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

/* ───────────────────────── Body Parser ────────────────────── */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((err, _req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ message: 'Invalid JSON body' });
  }
  next(err);
});

/* ───────────────────────── Cache Control ───────────────────── */
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

/* ───────────────────────── Debug Request ───────────────────── */
app.use((req, _res, next) => {
  console.log('>>>', req.method, req.originalUrl);
  next();
});

/* ───────────────────────── Health & Root ───────────────────── */
app.get('/', (_req, res) => res.send('🌱 Plant Shop API is running...'));
app.get('/_health', (_req, res) => res.json({ ok: true, at: 'server.js', ts: Date.now() }));

/* ───────────────────────── Uploads (static) ─────────────────── */
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir, { maxAge: '1h' }));

/* ───────────────────────── Imports ─────────────────────────── */
const productStatusRoutes  = require('./routes/productStatus');
const adminProductRoutes   = require('./routes/adminProducts');
const adminVariantsRoutes  = require('./routes/adminVariants');
const uploadsRoutes        = require('./routes/uploads');
const categoryRoutes       = require('./routes/categories');
const orderRoutes          = require('./routes/orders');
const authRoutes           = require('./routes/auth');
const addressesRoutes      = require('./routes/addresses');
const variantRoutes        = require('./routes/variants');
const publicProductsRoutes = require('./routes/publicProducts');
const inventoryRoutes      = require('./routes/inventory');
const productImagesRoutes  = require('./routes/productImages');
const adminSubcatRoutes    = require('./routes/adminSubcategories');
const subcategoryRoutes    = require('./routes/subcategories');
const lookupsRouter        = require('./routes/lookups');
const dashboardRoutes      = require('./routes/dashboard');
const cartRoutes           = require('./routes/cart');
const analyticsRoutes      = require('./routes/analytics');
const adminUnitsRouter     = require('./routes/adminUnits');   // ✅ หน่วยสินค้า
const publicUnitsRouter    = require('./routes/publicUnits');  // ✅ หน่วยสินค้า (public)
const sizeUnitsRouter      = require('./routes/sizeUnits');
const adminSizeUnitsRouter = require('./routes/adminSizeUnits');
const meRoutes             = require('./routes/me');

/* ───────────────────────── Rate Limit ───────────────────────── */
app.use('/api/auth/login', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

/* ───────────────────────── Public Routes ───────────────────── */
app.use(['/api/auth', '/auth'], authRoutes);
app.use('/api/me', meRoutes);
app.use(['/api/categories', '/categories'], categoryRoutes);
app.use(['/api/subcategories', '/subcategories'], subcategoryRoutes);
app.use('/api/products', publicProductsRoutes);
app.use('/api', publicUnitsRouter); // 🔹 เพิ่ม publicUnits
app.use('/api', lookupsRouter);

/* ───────────────────────── Admin Routes ────────────────────── */
app.use('/api', adminUnitsRouter);
app.use('/api/size-units', sizeUnitsRouter);
app.use(['/api/admin/size-units', '/api/admin/sizes'], requireAuth, requireRole(['admin']), adminSizeUnitsRouter);
app.use(['/api/admin/products', '/admin/products'], requireAuth, requireRole(['admin']), adminProductRoutes);
app.use(['/api/admin/variants', '/admin/variants'], requireAuth, requireRole(['admin']), adminVariantsRoutes);
app.use(['/api/admin/subcategories', '/admin/subcategories'], requireAuth, requireRole(['admin']), adminSubcatRoutes);
app.use(['/api/product-status', '/product-status'], requireAuth, requireRole(['admin']), productStatusRoutes);

/* ───────────────────────── Upload/Images Guard ─────────────── */
const pathStartsWith = (p, prefix) => p === prefix || p.startsWith(prefix + '/');
function lockAdminWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (pathStartsWith(req.baseUrl + req.path, '/api/upload'))  return next();
  if (pathStartsWith(req.baseUrl + req.path, '/api/uploads')) return next();
  return requireAuth(req, res, () => requireRole(['admin'])(req, res, next));
}
app.use(['/api/upload', '/api/uploads'], (req, res, next) => lockAdminWrites(req, res, next), productImagesRoutes);

/* ───────────────────────── Protected Routes ────────────────── */
app.use('/api/variants', requireAuth, variantRoutes);
app.use(['/api/uploads', '/api/upload', '/upload'], requireAuth, uploadsRoutes);
app.use(['/api/addresses', '/addresses'], requireAuth, addressesRoutes);
app.use(['/api/user-addresses', '/user-addresses'], requireAuth, addressesRoutes);
app.use(['/api/orders', '/orders'], requireAuth, orderRoutes);
app.use('/api/inventory', requireAuth, inventoryRoutes);
app.use('/api/cart', requireAuth, cartRoutes);
app.use('/api/analytics', requireAuth, analyticsRoutes);
app.use('/api/dashboard', requireAuth, dashboardRoutes);

/* ───────────────────────── Route Map Debug ─────────────────── */
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
/* ───────────────────────── Shim: orders/new-count ───────────── */
try {
  const db = require('./db');
  app.get('/api/orders/new-count', async (_req, res) => {
    try {
      // ถ้ามีคอลัมน์ created_at/status ใช้คิวรีนี้, ถ้าไม่มีจะ fallback เป็น 0
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
} catch {
  // กรณีไม่มี ./db ก็คืน 0 ไปก่อน
  app.get('/api/orders/new-count', (_req, res) => res.json({ count: 0 }));
}

/* ───────────────────────── Error Handler ───────────────────── */
app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('💥 Unhandled error:', err);
  const isDev = process.env.NODE_ENV !== 'production';
  const payload = { message: 'Server error' };
  if (isDev && err?.message) payload.details = err.message;
  if (isDev && err?.code) payload.code = err.code;
  res.status(err.status || 500).json(payload);
});

/* ───────────────────────── Start Server ────────────────────── */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`📁 Static uploads at /uploads -> ${uploadsDir}`);
  console.log(`🔓 CORS allowlist: ${allowlist.join(', ')}`);
});
