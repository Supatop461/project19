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
const authRoutes          = require('./routes/auth');            // public
const adminProductRoutes  = require('./routes/adminProducts');   // admin/staff only
const adminVariantsRoutes = require('./routes/adminVariants');   // admin/staff only
const ordersRouter        = require('./routes/orders');          // admin/staff only
const inventoryRoutes     = require('./routes/inventory');       // ✅ inventory
const requireAuth = require('./middleware/auth');
// ---------- Auth middlewares ----------
const { requireAuth, requireRole } = require('./middleware/auth');
const guardAdmin = [requireAuth, requireRole(['admin', 'staff'])];

// ---------- 1) Public auth endpoints ----------
app.use('/api/auth', authRoutes);

// ---------- 2) Admin area (ต้องมี token + role: admin/staff) ----------
app.use('/api/admin', guardAdmin, adminProductRoutes);
app.use('/api/admin', guardAdmin, adminVariantsRoutes);

// ---------- 3) Inventory (เริ่มให้ทดสอบง่าย ๆ ก่อน ไม่ใส่ guard; ถ้าพร้อมค่อยเปิด guardAdmin) ----------
app.use('/api/inventory', inventoryRoutes);

// ---------- 4) Orders ----------
app.use('/api/orders', guardAdmin, ordersRouter);

// ---------- 5) Healthcheck ----------
app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---------- 6) DEBUG: ping จาก app.js (ต้องตอบได้) ----------
app.get('/api/inventory/ping-app', (req, res) => res.json({ ok: true, where: 'app.js' }));

// ---------- 7) 404 handler (ต้องอยู่ท้ายสุดเสมอ) ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use('/api/orders', requireAuth, ordersRouter);

module.exports = app;
