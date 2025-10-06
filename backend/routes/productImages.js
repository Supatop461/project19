// backend/routes/productImages.js
const express = require('express');
const router = express.Router();
const db = require('../db'); // ใช้รูปแบบเดียวกับไฟล์อื่น ๆ ในโปรเจกต์

const asInt = (v) => (v === null || v === undefined || v === '' ? null : parseInt(v, 10));

/** (optional) ping route ไว้เช็คว่า router ถูก mount แล้ว */
router.get('/__product-images-ping', (_req, res) => res.json({ ok: true, where: 'productImages' }));

/* ----------------------------- Helpers ----------------------------- */
function normalizeImagePayload(it) {
  if (!it || typeof it !== 'object') return null;
  const url = (it.url || it.image_url || '').trim();
  if (!url) return null;
  return {
    url,
    alt_text: it.alt_text ?? it.alt ?? null,
    is_primary: !!it.is_primary,
    position: Number.isFinite(+it.position) ? asInt(it.position) : null,
    variant_id: (it.variant_id === undefined || it.variant_id === null) ? null : asInt(it.variant_id),
  };
}

async function productExists(productId) {
  const q = await db.query(`SELECT 1 FROM products WHERE product_id = $1`, [productId]);
  return q.rowCount > 0;
}

async function clearPrimaryInScope(productId, variantId) {
  if (variantId === null) {
    await db.query(
      `UPDATE product_images SET is_primary = FALSE WHERE product_id = $1 AND variant_id IS NULL`,
      [productId]
    );
  } else {
    await db.query(
      `UPDATE product_images SET is_primary = FALSE WHERE product_id = $1 AND variant_id = $2`,
      [productId, variantId]
    );
  }
}

/* ----------------------------- GET: list images ----------------------------- */
/**
 * GET /api/products/:productId/images
 * คืนรายการรูปของสินค้านั้น ๆ เรียงตามรูปหลัก > position > image_id
 */
router.get('/products/:productId/images', async (req, res) => {
  const productId = asInt(req.params.productId);
  if (!productId) return res.status(400).json({ error: 'productId invalid' });

  try {
    const { rows } = await db.query(
      `
      SELECT
        image_id AS id,
        product_id,
        variant_id,
        url,
        alt_text,
        is_primary,
        position,
        created_at
      FROM product_images
      WHERE product_id = $1
      ORDER BY is_primary DESC, position ASC, image_id ASC
      `,
      [productId]
    );
    res.json({ product_id: productId, images: rows });
  } catch (err) {
    console.error('GET images error', err);
    res.status(500).json({ error: 'failed_to_fetch_images' });
  }
});

/* ----------------------------- POST: bulk add ----------------------------- */
/**
 * POST /api/products/:productId/images
 * body.images = [{ url, alt_text?, is_primary?, variant_id?, position? }, ...]
 * - รองรับ position (ถ้าไม่ส่งจะต่อท้ายจาก max(position)+1)
 * - ถ้ามี is_primary = true จะเคลียร์รูปหลักเดิมใน "scope (variant) เดียวกัน"
 * - ใช้ Transaction
 */
router.post('/products/:productId/images', async (req, res) => {
  const productId = asInt(req.params.productId);
  const images = Array.isArray(req.body?.images) ? req.body.images : [];
  if (!productId) return res.status(400).json({ error: 'productId invalid' });
  if (images.length === 0) return res.status(400).json({ error: 'images array required' });

  try {
    if (!(await productExists(productId))) {
      return res.status(404).json({ error: 'product_not_found' });
    }

    await db.query('BEGIN');

    // basePos = ต่อท้ายอัตโนมัติสำหรับภาพที่ไม่ระบุ position
    const posQ = await db.query(
      `SELECT COALESCE(MAX(position), 0) AS max_pos FROM product_images WHERE product_id = $1`,
      [productId]
    );
    let basePos = Number(posQ.rows[0]?.max_pos || 0);

    // เตรียม clear รูปหลักแยกตาม scope variant
    const scopesToClear = new Set();
    for (const raw of images) {
      if (raw?.is_primary === true) {
        const k = (raw.variant_id === undefined || raw.variant_id === null) ? 'null' : String(asInt(raw.variant_id));
        scopesToClear.add(k);
      }
    }
    for (const k of scopesToClear) {
      if (k === 'null') await clearPrimaryInScope(productId, null);
      else await clearPrimaryInScope(productId, asInt(k));
    }

    const inserted = [];
    for (const raw of images) {
      const img = normalizeImagePayload(raw);
      if (!img) {
        await db.query('ROLLBACK');
        return res.status(400).json({ error: 'Each image must have non-empty url' });
      }

      let pos = img.position;
      if (!(Number.isInteger(pos) && pos > 0)) {
        pos = basePos + 1;
      }
      if (pos > basePos) basePos = pos;

      const ins = await db.query(
        `
        INSERT INTO product_images
          (product_id, variant_id, url, alt_text, is_primary, position)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING image_id AS id, product_id, variant_id, url, alt_text, is_primary, position, created_at
        `,
        [productId, img.variant_id, img.url, img.alt_text, img.is_primary, pos]
      );
      inserted.push(ins.rows[0]);
    }

    await db.query('COMMIT');
    res.status(201).json({ product_id: productId, inserted });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('POST images error', err);
    res.status(500).json({ error: 'failed_to_insert_images' });
  }
});

/* ----------------------------- POST: single add (fallback) ----------------------------- */
/**
 * POST /api/product-images
 * body = { product_id, url, alt_text?, is_primary?, variant_id?, position? }
 * - ใช้ตอน bulk มีปัญหา/เรียกเป็นรูป ๆ
 */
router.post('/product-images', async (req, res) => {
  const b = req.body || {};
  const productId = asInt(b.product_id);
  if (!productId) return res.status(400).json({ error: 'product_id invalid' });
  const img = normalizeImagePayload(b);
  if (!img) return res.status(400).json({ error: 'url required' });

  try {
    if (!(await productExists(productId))) {
      return res.status(404).json({ error: 'product_not_found' });
    }

    await db.query('BEGIN');

    if (img.is_primary === true) {
      await clearPrimaryInScope(productId, img.variant_id);
    }

    let pos = img.position;
    if (!(Number.isInteger(pos) && pos > 0)) {
      const posQ = await db.query(
        `SELECT COALESCE(MAX(position), 0) AS max_pos FROM product_images WHERE product_id = $1`,
        [productId]
      );
      pos = Number(posQ.rows[0]?.max_pos || 0) + 1;
    }

    const ins = await db.query(
      `INSERT INTO product_images (product_id, variant_id, url, alt_text, is_primary, position)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING image_id AS id, product_id, variant_id, url, alt_text, is_primary, position, created_at`,
      [productId, img.variant_id, img.url, img.alt_text, img.is_primary, pos]
    );

    await db.query('COMMIT');
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('POST /product-images error', err);
    res.status(500).json({ error: 'failed_to_insert_single' });
  }
});

/* ----------------------------- PATCH: reorder ----------------------------- */
/**
 * PATCH /api/products/:productId/images/reorder
 * body.order = [{ id: image_id, position: number }, ...]
 * เทคนิคสองเฟสกันชนค่า position (ถ้ามี unique/constraint): set ชั่วคราว -> set ตำแหน่งจริง
 */
router.patch('/products/:productId/images/reorder', async (req, res) => {
  const productId = asInt(req.params.productId);
  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  if (!productId) return res.status(400).json({ error: 'productId invalid' });
  if (order.length === 0) return res.status(400).json({ error: 'order array required' });

  try {
    await db.query('BEGIN');

    // เฟสชั่วคราว
    let i = 1;
    for (const r of order) {
      const imgId = asInt(r.id);
      if (!imgId) continue;
      await db.query(
        `UPDATE product_images SET position = $1 WHERE image_id = $2 AND product_id = $3`,
        [100000 + i, imgId, productId]
      );
      i++;
    }

    // เฟส set ตำแหน่งจริง
    for (const r of order) {
      const imgId = asInt(r.id);
      const pos = asInt(r.position);
      if (!imgId || pos === null) continue;
      await db.query(
        `UPDATE product_images SET position = $1 WHERE image_id = $2 AND product_id = $3`,
        [pos, imgId, productId]
      );
    }

    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('PATCH reorder error', err);
    res.status(500).json({ error: 'failed_to_reorder' });
  }
});

/* ----------------------------- PATCH: set primary ----------------------------- */
/**
 * PATCH /api/products/:productId/images/:imageId/primary
 * ตั้งรูปหลัก (เคลียร์รูปหลักเดิมใน scope เดียวกันให้อัตโนมัติ)
 */
router.patch('/products/:productId/images/:imageId/primary', async (req, res) => {
  const productId = asInt(req.params.productId);
  const imageId = asInt(req.params.imageId);
  if (!productId || !imageId) return res.status(400).json({ error: 'invalid params' });

  try {
    await db.query('BEGIN');

    const { rows: cur } = await db.query(
      `SELECT product_id, variant_id FROM product_images WHERE image_id = $1 AND product_id = $2`,
      [imageId, productId]
    );
    if (!cur.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'image_not_found' });
    }
    const variantId = cur[0].variant_id;

    await clearPrimaryInScope(productId, variantId);
    const { rowCount } = await db.query(
      `UPDATE product_images SET is_primary = TRUE WHERE image_id = $1 AND product_id = $2`,
      [imageId, productId]
    );

    await db.query('COMMIT');
    if (!rowCount) return res.status(404).json({ error: 'image_not_found' });
    res.json({ ok: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('PATCH primary error', err);
    res.status(500).json({ error: 'failed_to_set_primary' });
  }
});

/* ----------------------------- DELETE: remove image ----------------------------- */
/**
 * DELETE /api/products/:productId/images/:imageId
 * ลบรูปภาพ
 */
router.delete('/products/:productId/images/:imageId', async (req, res) => {
  const productId = asInt(req.params.productId);
  const imageId = asInt(req.params.imageId);
  if (!productId || !imageId) return res.status(400).json({ error: 'invalid params' });

  try {
    const { rowCount } = await db.query(
      `DELETE FROM product_images WHERE image_id = $1 AND product_id = $2`,
      [imageId, productId]
    );
    if (!rowCount) return res.status(404).json({ error: 'image_not_found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE image error', err);
    res.status(500).json({ error: 'failed_to_delete' });
  }
});

module.exports = router;
