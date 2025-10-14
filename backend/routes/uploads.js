// backend/routes/uploads.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const router = express.Router();

/* ================== Upload dir ================== */
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ================== Multer config ================== */
const imageMimes = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'image/gif', 'image/svg+xml', 'image/avif',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    const base = (path.basename(file.originalname || 'upload', ext) || 'upload')
      .replace(/[^\w.\-]+/g, '_'); // ปลอดภัยในชื่อไฟล์
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 20 }, // 10MB/ไฟล์, สูงสุด 20 ไฟล์
  fileFilter: (_req, file, cb) => {
    if (imageMimes.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Only image files are allowed'), { status: 415 }));
  },
});

/* ================== Helpers ================== */
function fileListToResponse(files) {
  return (files || []).map((f) => ({
    filename: f.originalname,
    saved_as: f.filename,
    url: `/uploads/${f.filename}`,   // << เก็บลง DB ใช้ path นี้
    size: f.size,
    mime: f.mimetype,
  }));
}

/* ================== Routes ================== */

// health check
router.get('/__ping', (_req, res) => res.json({ ok: true, where: 'uploads' }));

// อัปโหลดหลายไฟล์: POST /api/uploads  | และรองรับ /upload เนื่องจากถูก mount ไว้หลาย base
router.post('/', (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) {
      const status = err.status || (err.code?.startsWith('LIMIT') ? 413 : 400);
      return res.status(status).json({ error: err.message || 'Upload error' });
    }
    const files = fileListToResponse(req.files);
    if (!files.length) return res.status(400).json({ error: 'No file uploaded' });

    // หากอัปโหลด 1 ไฟล์ ให้ตอบซ้ำชั้นบนด้วย เพื่อความสะดวกของ frontend
    if (files.length === 1) {
      const one = files[0];
      return res.json({
        ok: true,
        url: one.url,              // << ใช้ตัวนี้ใน frontend ได้เลย
        file: one,
        files,
      });
    }
    return res.json({ ok: true, files });
  });
});

// อวาตาร์: POST /api/uploads/avatar (field: file)
router.post('/avatar', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.status || (err.code?.startsWith('LIMIT') ? 413 : 400);
      return res.status(status).json({ error: err.message || 'Upload error' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    return res.json({ ok: true, url: `/uploads/${req.file.filename}` });
  });
});

// รูปหมวดหลัก: POST /api/uploads/category-image (field: file)
router.post('/category-image', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.status || (err.code?.startsWith('LIMIT') ? 413 : 400);
      return res.status(status).json({ error: err.message || 'Upload error' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    return res.json({ ok: true, url: `/uploads/${req.file.filename}` });
  });
});

// รูปหมวดย่อย: POST /api/uploads/subcategory-image (field: file)
router.post('/subcategory-image', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const status = err.status || (err.code?.startsWith('LIMIT') ? 413 : 400);
      return res.status(status).json({ error: err.message || 'Upload error' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    return res.json({ ok: true, url: `/uploads/${req.file.filename}` });
  });
});

module.exports = router;
