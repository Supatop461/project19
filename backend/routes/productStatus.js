const express = require('express');
const router = express.Router();
const db = require('../db');

/* ---------- กันแคชเฉพาะ endpoint นี้ ---------- */
const nocache = (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // กัน 304 จาก If-None-Match / If-Modified-Since
  res.set('ETag', Math.random().toString(36).slice(2));
  res.set('Last-Modified', new Date().toUTCString());
  next();
};

router.get('/', nocache, async (req, res) => {
  try {
    const sql = `
      SELECT 
        product_status_id AS "ProductStatusID",
        status_name       AS "StatusName"
      FROM public.product_statuses
      ORDER BY product_status_id
    `;
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ ดึงสถานะสินค้าไม่สำเร็จ:', err); // log ทั้งก้อน
    // เปิดเผย error ให้ client ชั่วคราวเพื่อดีบัก
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
