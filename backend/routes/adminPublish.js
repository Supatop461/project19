// backend/routes/adminPublish.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// TODO: ใส่ middleware ตรวจสิทธิ์แอดมินจริงของคุณ
const mustBeAdmin = (_req, _res, next) => next();

/** ================== CATEGORIES ================== */
// PATCH /api/admin/categories/:id/publish   Body: { is_published: true|false }
router.patch('/categories/:id/publish', mustBeAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_published } = req.body;
  const sql = `
    UPDATE product_categories
       SET is_published = $1,
           published_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END
     WHERE category_id = $2
     RETURNING category_id, category_name, is_published, published_at
  `;
  try {
    const { rows } = await db.query(sql, [!!is_published, id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ category_id นี้' });
    res.json(rows[0]);
  } catch (e) {
    console.error('categories publish error:', e);
    res.status(500).json({ error: 'อัปเดตสถานะเผยแพร่ (category) ไม่สำเร็จ' });
  }
});

/** ================== SUBCATEGORIES ================== */
// PATCH /api/admin/subcategories/:id/publish   Body: { is_published: true|false }
router.patch('/subcategories/:id/publish', mustBeAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_published } = req.body;
  const sql = `
    UPDATE subcategories
       SET is_published = $1,
           published_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END
     WHERE subcategory_id = $2
     RETURNING subcategory_id, subcategory_name, is_published, published_at
  `;
  try {
    const { rows } = await db.query(sql, [!!is_published, id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ subcategory_id นี้' });
    res.json(rows[0]);
  } catch (e) {
    console.error('subcategories publish error:', e);
    res.status(500).json({ error: 'อัปเดตสถานะเผยแพร่ (subcategory) ไม่สำเร็จ' });
  }
});

/** ================== PRODUCTS ================== */
// PATCH /api/admin/products/:id/publish   Body: { is_published: true|false }
router.patch('/products/:id/publish', mustBeAdmin, async (req, res) => {
  const { id } = req.params;
  const { is_published } = req.body;
  const sql = `
    UPDATE products
       SET is_published = $1,
           published_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END
     WHERE product_id = $2
     RETURNING product_id, product_name, is_published, published_at
  `;
  try {
    const { rows } = await db.query(sql, [!!is_published, id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ product_id นี้' });
    res.json(rows[0]);
  } catch (e) {
    console.error('products publish error:', e);
    res.status(500).json({ error: 'อัปเดตสถานะเผยแพร่ (product) ไม่สำเร็จ' });
  }
});

module.exports = router;
