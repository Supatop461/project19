// routes/subcategories.js
// ✅ CRUD หมวดหมู่ย่อย + image_url
// ✅ ลูกค้าเห็นเฉพาะที่เผยแพร่
// ✅ แอดมินใช้ ?scope=admin หรือ ?include_hidden=1 เพื่อเห็นทั้งหมด

const express = require('express');
const router = express.Router();
const db = require('../db');

// ---------- Helper: gen id ----------
async function genSubId() {
  const sql = `
    SELECT COALESCE(MAX(CAST(SUBSTRING(subcategory_id FROM 3) AS INTEGER)), 0) AS maxnum
    FROM subcategories
    WHERE subcategory_id ~ '^po[0-9]+$'
  `;
  const { rows } = await db.query(sql);
  const next = (rows[0].maxnum || 0) + 1;
  return 'po' + next;
}

// ---------- GET: list ----------
router.get('/', async (req, res) => {
  try {
    const { category_id, q, scope, include_hidden } = req.query;
    const isAdmin = scope === 'admin' || include_hidden == '1';

    const where = [];
    const vals = [];
    let i = 1;

    if (category_id?.trim()) {
      where.push(`sc.category_id = $${i++}`);
      vals.push(category_id.trim());
    }
    if (q?.trim()) {
      where.push(`(sc.subcategory_name ILIKE $${i})`);
      vals.push(`%${q.trim()}%`);
      i++;
    }

    // Admin: เห็นทั้งหมด ไม่บังคับ is_published
    // Public: ต้องเผยแพร่ทั้ง subcategory และ category
    const baseSelect = `
      SELECT
        sc.subcategory_id,
        sc.subcategory_name,
        sc.category_id,
        sc.image_url,
        sc.is_published,
        c.category_name,
        c.is_published AS category_published
      FROM subcategories sc
      LEFT JOIN product_categories c
        ON c.category_id = sc.category_id
    `;

    const sql = isAdmin
      ? `
        ${baseSelect}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY sc.subcategory_name ASC
      `
      : `
        ${baseSelect}
        WHERE sc.is_published = true
          AND c.is_published = true
          ${where.length ? 'AND ' + where.join(' AND ') : ''}
        ORDER BY sc.subcategory_name ASC
      `;

    const { rows } = await db.query(sql, vals);
    res.json(rows);
  } catch (error) {
    console.error('❌ Subcategory GET error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- POST ----------
router.post('/', async (req, res) => {
  try {
    const { subcategory_id, subcategory_name, category_id, image_url } = req.body;
    if (!subcategory_name?.trim() || !category_id?.trim()) {
      return res.status(400).json({ error: 'กรุณาระบุ subcategory_name และ category_id' });
    }

    const cat = await db.query('SELECT 1 FROM product_categories WHERE category_id=$1', [category_id.trim()]);
    if (cat.rowCount === 0) {
      return res.status(400).json({ error: 'category_id ไม่ถูกต้อง (ไม่มีประเภทนี้)' });
    }

    let id = subcategory_id?.trim();
    if (!id) id = await genSubId();

    const dup = await db.query('SELECT 1 FROM subcategories WHERE subcategory_id=$1', [id]);
    if (dup.rowCount > 0) {
      return res.status(409).json({ error: `subcategory_id "${id}" ถูกใช้แล้ว` });
    }

    const insert = await db.query(
      `INSERT INTO subcategories (subcategory_id, subcategory_name, category_id, image_url)
       VALUES ($1, $2, $3, $4)
       RETURNING subcategory_id, subcategory_name, category_id, image_url, is_published`,
      [id, subcategory_name.trim(), category_id.trim(), image_url?.trim() || null]
    );

    res.status(201).json(insert.rows[0]);
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'category_id ไม่ถูกต้อง (FK constraint)' });
    }
    if (error.code === '23505') {
      return res.status(409).json({ error: 'subcategory_id ซ้ำ (PK constraint)' });
    }
    console.error('❌ Subcategory POST error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- PUT ----------
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { subcategory_name, category_id } = req.body;
    const hasImageKey = Object.prototype.hasOwnProperty.call(req.body, 'image_url');
    const image_url = hasImageKey ? req.body.image_url : undefined;

    if (!subcategory_name?.trim() && !category_id?.trim() && typeof image_url === 'undefined') {
      return res.status(400).json({ error: 'กรุณาระบุฟิลด์ที่จะอัปเดตอย่างน้อย 1 อย่าง' });
    }

    if (category_id?.trim()) {
      const cat = await db.query('SELECT 1 FROM product_categories WHERE category_id=$1', [category_id.trim()]);
      if (cat.rowCount === 0) {
        return res.status(400).json({ error: 'category_id ใหม่ไม่ถูกต้อง (ไม่มีประเภทนี้)' });
      }
    }

    const sets = [];
    const vals = [];
    let i = 1;

    if (subcategory_name?.trim()) {
      sets.push(`subcategory_name=$${i++}`);
      vals.push(subcategory_name.trim());
    }
    if (category_id?.trim()) {
      sets.push(`category_id=$${i++}`);
      vals.push(category_id.trim());
    }
    if (typeof image_url !== 'undefined') {
      if (image_url === null || (typeof image_url === 'string' && image_url.trim() === '')) {
        sets.push(`image_url = NULL`);
      } else {
        sets.push(`image_url=$${i++}`);
        vals.push(String(image_url).trim());
      }
    }

    vals.push(id);

    const sql = `
      UPDATE subcategories
      SET ${sets.join(', ')}
      WHERE subcategory_id=$${i}
      RETURNING subcategory_id, subcategory_name, category_id, image_url, is_published
    `;

    const up = await db.query(sql, vals);
    if (up.rowCount === 0) return res.status(404).json({ error: 'ไม่พบ subcategory_id นี้' });

    res.json(up.rows[0]);
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'category_id ใหม่ไม่ถูกต้อง (FK constraint)' });
    }
    console.error('❌ Subcategory PUT error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- DELETE ----------
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const ref = await db.query('SELECT 1 FROM products WHERE subcategory_id=$1 LIMIT 1', [id]);
    if (ref.rowCount > 0) {
      return res.status(400).json({ error: 'ลบไม่ได้: มีสินค้าอ้างอิงอยู่' });
    }

    const del = await db.query('DELETE FROM subcategories WHERE subcategory_id=$1', [id]);
    if (del.rowCount === 0) return res.status(404).json({ error: 'ไม่พบ subcategory_id นี้' });

    res.json({ message: 'ลบหมวดหมู่ย่อยเรียบร้อย' });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({ error: 'ลบไม่ได้: ติดข้อจำกัดอ้างอิง (FK constraint)' });
    }
    console.error('❌ Subcategory DELETE error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ---------- (แนะนำ) PATCH: toggle publish สำหรับแอดมิน ----------
router.patch('/admin/:id/publish', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_published } = req.body;
    const { rows } = await db.query(
      `UPDATE subcategories
       SET is_published = $1
       WHERE subcategory_id = $2
       RETURNING subcategory_id, subcategory_name, category_id, image_url, is_published`,
      [!!is_published, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'ไม่พบ subcategory_id นี้' });
    res.json(rows[0]);
  } catch (error) {
    console.error('❌ Subcategory PUBLISH error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
