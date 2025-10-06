// backend/routes/categories.js
// ✅ CRUD ประเภทสินค้า (product_categories) + รองรับ image_url

const express = require('express');
const router = express.Router();
const db = require('../db');

// ---------------------------------------------------------------------
// Helper: gen category_id → ro1, ro2, ...
// ---------------------------------------------------------------------
async function genCategoryId() {
  const sql = `
    SELECT COALESCE(MAX(CAST(SUBSTRING(category_id FROM 3) AS INTEGER)), 0) AS maxnum
    FROM product_categories
    WHERE category_id ~ '^ro[0-9]+$'
  `;
  const { rows } = await db.query(sql);
  const next = (rows[0]?.maxnum || 0) + 1;
  return 'ro' + next;
}

// ---------------------------------------------------------------------
// GET: ดึงประเภททั้งหมด
// ---------------------------------------------------------------------
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT category_id, category_name, image_url
       FROM product_categories
       ORDER BY category_name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error('❌ Category GET error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------------------------------------------------------------------
// POST: เพิ่มประเภทใหม่
// body: { category_name, category_id?, image_url? }
// ---------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    let { category_id, category_name, image_url } = req.body;

    if (!category_name || !category_name.trim()) {
      return res.status(400).json({ error: 'category_name จำเป็น' });
    }

    // gen id ถ้าไม่ส่ง
    const id = category_id?.trim() || await genCategoryId();

    // กันซ้ำ
    const dup = await db.query('SELECT 1 FROM product_categories WHERE category_id=$1', [id]);
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: `category_id "${id}" ถูกใช้แล้ว` });
    }

    // normalize image_url
    image_url = image_url?.trim() || null;

    const ins = await db.query(
      `INSERT INTO product_categories (category_id, category_name, image_url)
       VALUES ($1, $2, $3)
       RETURNING category_id, category_name, image_url`,
      [id, category_name.trim(), image_url]
    );

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error('❌ Category POST error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------------------------------------------------------------------
// PUT: แก้ไขชื่อ/รูป
// body: { category_name?, image_url? }
// ---------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let { category_name, image_url } = req.body;

    if (!category_name && typeof image_url === 'undefined') {
      return res.status(400).json({ error: 'ต้องระบุ category_name หรือ image_url อย่างน้อย 1 อย่าง' });
    }

    const sets = [];
    const vals = [];
    let i = 1;

    if (category_name !== undefined) {
      const nameTrim = category_name.trim();
      if (!nameTrim) return res.status(400).json({ error: 'category_name ห้ามว่าง' });
      sets.push(`category_name=$${i++}`);
      vals.push(nameTrim);
    }

    if (image_url !== undefined) {
      const urlTrim = image_url?.trim() || null;
      if (urlTrim === null) {
        sets.push(`image_url=NULL`);
      } else {
        sets.push(`image_url=$${i++}`);
        vals.push(urlTrim);
      }
    }

    vals.push(id);

    const sql = `
      UPDATE product_categories
      SET ${sets.join(', ')}
      WHERE category_id=$${i}
      RETURNING category_id, category_name, image_url
    `;
    const up = await db.query(sql, vals);
    if (up.rowCount === 0) return res.status(404).json({ error: 'ไม่พบ category_id นี้' });

    res.json(up.rows[0]);
  } catch (err) {
    console.error('❌ Category PUT error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------------------------------------------------------------------
// DELETE: ลบ (กันลบถ้ามีการอ้างอิง)
// ---------------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // กันลบถ้ามี subcategories
    const subRef = await db.query('SELECT 1 FROM subcategories WHERE category_id=$1 LIMIT 1', [id]);
    if (subRef.rowCount > 0) {
      return res.status(400).json({ error: 'ลบไม่ได้: มีหมวดย่อยอ้างอิงอยู่' });
    }

    // กันลบถ้ามี products
    const prodRef = await db.query('SELECT 1 FROM products WHERE category_id=$1 LIMIT 1', [id]);
    if (prodRef.rowCount > 0) {
      return res.status(400).json({ error: 'ลบไม่ได้: มีสินค้าอ้างอิงอยู่' });
    }

    const del = await db.query('DELETE FROM product_categories WHERE category_id=$1', [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: 'ไม่พบ category_id นี้' });

    res.json({ message: 'ลบประเภทเรียบร้อย' });
  } catch (err) {
    console.error('❌ Category DELETE error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
