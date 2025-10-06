// routes/adminSubcategories.js
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * PATCH /api/admin/subcategories/:id/publish
 * - ถ้า body มี { is_published: true/false } → เซ็ตตามนั้น
 * - ถ้าไม่ส่ง → toggle
 * ต้องมีคอลัมน์ใน subcategories: is_published BOOLEAN, published_at TIMESTAMP, updated_at TIMESTAMP
 */
router.patch('/subcategories/:id/publish', async (req, res) => {
  try {
    const id = String(req.params.id); // เช่น 'po2'

    const cur = await db.query(
      `SELECT is_published FROM subcategories WHERE subcategory_id = $1 LIMIT 1`,
      [id]
    );
    if (!cur.rows.length) return res.status(404).json({ error: 'ไม่พบหมวดย่อย' });

    const nextVal = (typeof req.body?.is_published === 'boolean')
      ? req.body.is_published
      : !cur.rows[0].is_published;

    const { rows } = await db.query(
      `UPDATE subcategories
         SET is_published = $1,
             published_at = CASE WHEN $1 THEN NOW() ELSE published_at END,
             updated_at   = NOW()
       WHERE subcategory_id = $2
       RETURNING subcategory_id, is_published, published_at`,
      [nextVal, id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Publish subcategory error:', err);
    res.status(500).json({ error: 'Publish subcategory error' });
  }
});

module.exports = router;
