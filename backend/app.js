// backend/app.js
// หน้าที่: ประกอบ Express app, ผูกเส้นทางทั้งหมด, และป้องกัน /api/admin ด้วย JWT + role

const express = require('express');
const cors = require('cors');
const app = express();

console.log('>>> USING app.js (inventory debug) <<<'); // DEBUG: ให้รู้ว่าไฟล์นี้รันจริง

// ---------- Core Middlewares ----------
app.use(cors());
app.use(express.json());

// ---------- Routes (import) ----------
const authRoutes           = require('./routes/auth');            // public
const adminProductRoutes   = require('./routes/adminProducts');   // admin/staff only
const adminVariantsRoutes  = require('./routes/adminVariants');   // admin/staff only
const adminUnitsRoutes     = require('./routes/adminUnits');      // units
const adminSizeUnitsRoutes = require('./routes/adminSizeUnits');  // size-units
const ordersRouter         = require('./routes/orders');          // admin/staff only
const inventoryRoutes      = require('./routes/inventory');       // ✅ inventory

// ---------- Auth middlewares ----------
const { requireAuth, requireRole } = require('./middleware/auth');
const guardAdmin = [requireAuth, requireRole(['admin', 'staff'])];

// ---------- 1) Public auth endpoints ----------
app.use('/api/auth', authRoutes);

// ---------- 2) Admin area (ต้องมี token + role: admin/staff) ----------
app.use('/api/admin', guardAdmin, adminProductRoutes);   // /api/admin/products...
app.use('/api/admin', guardAdmin, adminVariantsRoutes);  // /api/admin/variants...

// หน่วยสินค้า / หน่วยขนาด (admin)
app.use('/api/admin/units',       guardAdmin, adminUnitsRoutes);
app.use('/api/admin/size-units',  guardAdmin, adminSizeUnitsRoutes);
app.use('/api/admin/sizes',       guardAdmin, adminSizeUnitsRoutes); // alias admin อีกเส้น

// ---------- 3) Aliases (เพื่อความเข้ากันได้กับฟรอนต์เดิม) ----------
// หมายเหตุ: alias เหล่านี้ "ไม่ใส่ guard" เพื่อให้ดึง options/list ได้ง่ายจากฟอร์ม
// ถ้าต้องการล็อกให้เข้มขึ้น ให้ย้ายสองบรรทัดนี้ไปอยู่หลัง guardAdmin
app.use('/api/units',      adminUnitsRoutes);
app.use('/api/size-units', adminSizeUnitsRoutes);
app.use('/api/sizes',      adminSizeUnitsRoutes);

// ---------- 4) Inventory ----------
app.use('/api/inventory', inventoryRoutes);

// ---------- 5) Orders (ต้องล็อกอิน + มี role) ----------
app.use('/api/orders', guardAdmin, ordersRouter);

// ---------- 6) Healthcheck / Debug ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/inventory/ping-app', (_req, res) => res.json({ ok: true, where: 'app.js' }));

// ---------- 7) 404 handler (ต้องอยู่ท้ายสุดเสมอ) ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = app;
