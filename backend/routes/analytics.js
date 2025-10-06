// backend/routes/analytics.js
const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

/* GET /api/analytics/product-category-counts?limit=10 */
router.get('/product-category-counts', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 50);

    const hasIsArchived = await hasColumn('products','is_archived');
    const hasArchivedAt = await hasColumn('products','archived_at');

    const archivedFilter = hasIsArchived ? 'COALESCE(p.is_archived, FALSE) = FALSE'
                        : hasArchivedAt ? 'p.archived_at IS NULL'
                        : 'TRUE';

    const sql = `
      SELECT c.category_name, COUNT(*) AS cnt
      FROM products p
      JOIN product_categories c ON c.category_id = p.category_id
      WHERE ${archivedFilter}
      GROUP BY c.category_name
      ORDER BY cnt DESC
      LIMIT $1
    `;
    const { rows } = await db.query(sql, [limit]);
    res.json(rows);
  } catch (e) {
    console.error('analytics category counts error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

/* GET /api/analytics/add-to-cart-trend?days=14 */
router.get('/add-to-cart-trend', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '14', 10), 1), 90);
    const sql = `
      SELECT DATE(ci.created_at) AS day, COUNT(*) AS add_events
      FROM cart_items ci
      JOIN carts ca ON ca.cart_id = ci.cart_id
      WHERE ci.created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY day
      ORDER BY day
    `;
    const { rows } = await db.query(sql);
    res.json(rows);
  } catch (e) {
    console.error('analytics add-to-cart trend error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

/* (optional) GET /api/analytics/published-share */
router.get('/published-share', async (_req, res) => {
  try {
    const hasPublished = await hasColumn('products','published');
    const hasIsPub    = await hasColumn('products','is_published');
    const col = hasPublished ? 'published' : (hasIsPub ? 'is_published' : null);

    const share = col ? `
      SELECT
        CASE WHEN COALESCE(p.${col}, TRUE)=TRUE THEN 'Published' ELSE 'Unpublished' END AS status,
        COUNT(*) AS cnt
      FROM products p
      WHERE COALESCE(p.is_archived, FALSE) = FALSE
      GROUP BY status
    ` : `
      SELECT 'Published' AS status, COUNT(*) AS cnt FROM products WHERE COALESCE(is_archived, FALSE) = FALSE
    `;
    const { rows } = await db.query(share);
    res.json(rows);
  } catch (e) {
    console.error('analytics published share error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
