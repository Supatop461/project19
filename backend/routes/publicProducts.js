// backend/routes/publicProducts.js
const express = require('express');

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

const router = express.Router();
console.log('▶ publicProducts router LOADED');
router.get('/_ping', (_req, res) => res.json({ ok: true }));

/* ----------------- helpers ----------------- */
function toInt(v, def = 0, min = -2147483648, max = 2147483647) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows[0]?.ok;
}
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}

/**
 * เลือกคอลัมน์ dynamic ตามสคีมา:
 * - publishedCol: products.published | products.is_published (default TRUE)
 * - archivedFilter: WHERE … (รองรับ is_archived | archived_at)
 */
async function getSchemaFlags() {
  const hasPublished  = await hasColumn('products', 'published');
  const hasIsPubProd  = await hasColumn('products', 'is_published');
  const publishedCol  = hasPublished ? 'COALESCE(p.published, TRUE)'
                     : hasIsPubProd ? 'COALESCE(p.is_published, TRUE)'
                     : 'TRUE';

  const hasIsArchived = await hasColumn('products', 'is_archived');
  const hasArchivedAt = await hasColumn('products', 'archived_at');

  const archivedFilter = hasIsArchived
    ? 'COALESCE(p.is_archived,FALSE) = FALSE'
    : hasArchivedAt
      ? 'p.archived_at IS NULL'
      : 'TRUE';

  // categories/subcategories publishing
  const catPub  = (await hasColumn('product_categories','is_published')) ? 'COALESCE(c.is_published,TRUE) = TRUE' : 'TRUE';
  const subPub  = (await hasColumn('subcategories','is_published'))     ? 'COALESCE(sc.is_published,TRUE) = TRUE' : 'TRUE';

  const hasImageUrl = await hasColumn('products','image_url');

  return { publishedCol, archivedFilter, catPub, subPub, hasImageUrl };
}

/**
 * ORDER BY
 */
function buildSort(sort, { alias = 'p', useView = false, soldCol = 'sold_qty' } = {}) {
  const priceCol = useView ? 'min_price' : `${alias}.selling_price`;
  switch (String(sort || '').toLowerCase()) {
    case 'popular':    return `${soldCol} DESC NULLS LAST, ${alias}.product_id DESC`;
    case 'newest':     return `${alias}.product_id DESC`;
    case 'price_asc':  return `${priceCol} ASC NULLS LAST, ${alias}.product_id DESC`;
    case 'price_desc': return `${priceCol} DESC NULLS LAST, ${alias}.product_id DESC`;
    case 'name_asc':   return `${alias}.product_name ASC, ${alias}.product_id DESC`;
    case 'name_desc':  return `${alias}.product_name DESC, ${alias}.product_id DESC`;
    default:           return `${alias}.product_id DESC`;
  }
}

/* =========================================================
 * GET /api/products
 * query: featured, category_id, subcategory_id, q, sort, limit, offset, include_archived
 * ========================================================= */
router.get('/', async (req, res) => {
  try {
    const {
      featured,
      category_id,
      subcategory_id,
      q,
      sort = 'newest',
      limit = 12,
      offset = 0,
      include_archived,
    } = req.query || {};

    const lim = toInt(limit, 12, 1, 100);
    const off = toInt(offset, 0, 0, 100000);

    const includeArchived =
      String(include_archived).toLowerCase() === '1' ||
      String(include_archived).toLowerCase() === 'true';

    const { publishedCol, archivedFilter, catPub, subPub, hasImageUrl } = await getSchemaFlags();

    const where = [];
    const params = [];

    // ซ่อนสินค้า archived (ถ้าไม่ขอ)
    if (!includeArchived) {
      where.push(archivedFilter);
    }
    // เฉพาะสินค้าที่เผยแพร่
    where.push(`${publishedCol} = TRUE`);

    if (category_id) {
      params.push(String(category_id));
      where.push(`p.category_id = $${params.length}`);
    }
    if (subcategory_id) {
      params.push(String(subcategory_id));
      where.push(`p.subcategory_id = $${params.length}`);
    }
    if (q && String(q).trim() !== '') {
      const qq = `%${String(q).trim()}%`;
      params.push(qq, qq);
      where.push(`(p.product_name ILIKE $${params.length - 1} OR p.description ILIKE $${params.length})`);
    }

    const useView  = await hasTable('v_product_variants_live_stock');
    const hasFinal = useView && await hasColumn('v_product_variants_live_stock', 'final_price');

    const priceExpr = useView
      ? (hasFinal ? 'MIN(COALESCE(v.price_override, v.final_price))'
                  : 'MIN(v.price_override)')
      : 'p.selling_price';

    const stockExpr = useView ? 'COALESCE(SUM(v.stock),0)::int' : '0::int';

    // cover image (fallback ถ้าไม่มี p.image_url)
    const coverJoin = hasImageUrl ? `
      LEFT JOIN LATERAL (
        SELECT MIN(pi.url) AS cover_url
        FROM product_images pi
        WHERE pi.product_id = p.product_id
      ) cv ON TRUE
    ` : ''; // เราจะใช้ cv.cover_url ต่อให้มี image_url เพื่อ fallback

    // ต้องการ popular/featured?
    const wantFeatured = String(featured).toLowerCase() === '1' || String(featured).toLowerCase() === 'true';
    const wantPopular  = String(sort || '').toLowerCase() === 'popular' || wantFeatured;

    const baseSelect = `
      SELECT
        p.product_id, p.product_name, p.description,
        ${hasImageUrl ? 'COALESCE(NULLIF(p.image_url, \'\'), cv.cover_url) AS image_url' : 'cv.cover_url AS image_url'},
        p.category_id, c.category_name,
        p.subcategory_id, sc.subcategory_name,
        ${priceExpr}::numeric AS min_price,
        ${stockExpr} AS stock
      FROM products p
      ${useView ? 'LEFT JOIN v_product_variants_live_stock v ON v.product_id = p.product_id' : ''}
      ${coverJoin}
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories sc     ON sc.subcategory_id = p.subcategory_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        AND (${catPub})
        AND (${subPub})
      GROUP BY
        p.product_id, p.product_name, p.description,
        ${hasImageUrl ? 'p.image_url, cv.cover_url' : 'cv.cover_url'},
        p.category_id, c.category_name, p.subcategory_id, sc.subcategory_name
    `;

    let sql, listParams;

    if (wantPopular) {
      // เติมยอดขาย
      const soldCTE = `
        WITH sold AS (
          SELECT od.product_id, COALESCE(SUM(od.quantity), 0)::int AS sold_qty
          FROM order_details od
          LEFT JOIN orders o ON o.order_id = od.order_id
          WHERE o.order_status_id IN ('o1', 'o2')  -- ปรับตามสถานะที่ถือว่า "ขายสำเร็จ" ของโปรเจกต์คุณ
          GROUP BY od.product_id
        )
      `;
      sql = `
        ${soldCTE}
        SELECT x.*, COALESCE(s.sold_qty, 0) AS sold_qty
        FROM (
          ${baseSelect}
        ) x
        LEFT JOIN sold s ON s.product_id = x.product_id
        ORDER BY ${buildSort('popular', { alias: 'x', useView: useView, soldCol: 'COALESCE(s.sold_qty, 0)' })}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      listParams = [...params, lim, off];
    } else {
      sql = `
        ${baseSelect}
        ORDER BY ${buildSort(sort, { alias: 'p', useView: useView })}
        LIMIT $${params.push(lim)} OFFSET $${params.push(off)}
      `;
      listParams = params;
    }

    const { rows } = await db.query(sql, listParams);
    res.json(rows);
  } catch (err) {
    console.error('public products list error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* =========================================================
 * GET /api/products/best-sellers
 * ========================================================= */
router.get('/best-sellers', async (req, res) => {
  try {
    const lim = toInt(req.query.limit, 8, 1, 50);

    const useView  = await hasTable('v_product_variants_live_stock');
    const hasFinal = useView && await hasColumn('v_product_variants_live_stock', 'final_price');
    const { publishedCol, archivedFilter, catPub, subPub, hasImageUrl } = await getSchemaFlags();

    const priceExpr = useView
      ? (hasFinal ? 'MIN(COALESCE(v.price_override, v.final_price))'
                  : 'MIN(v.price_override)')
      : 'p.selling_price';
    const stockExpr = useView ? 'COALESCE(SUM(v.stock),0)::int' : '0::int';

    const coverJoin = `
      LEFT JOIN LATERAL (
        SELECT MIN(pi.url) AS cover_url
        FROM product_images pi
        WHERE pi.product_id = p.product_id
      ) cv ON TRUE
    `;

    const sql = `
      WITH sold AS (
        SELECT od.product_id, COALESCE(SUM(od.quantity), 0)::int AS sold_qty
        FROM order_details od
        LEFT JOIN orders o ON o.order_id = od.order_id
        WHERE o.order_status_id IN ('o1', 'o2')
        GROUP BY od.product_id
      )
      SELECT
        p.product_id, p.product_name, p.description,
        ${hasImageUrl ? 'COALESCE(NULLIF(p.image_url, \'\'), cv.cover_url) AS image_url' : 'cv.cover_url AS image_url'},
        p.category_id, c.category_name,
        p.subcategory_id, sc.subcategory_name,
        ${priceExpr}::numeric AS min_price,
        ${stockExpr} AS stock,
        COALESCE(s.sold_qty, 0) AS sold_qty
      FROM products p
      ${useView ? 'LEFT JOIN v_product_variants_live_stock v ON v.product_id = p.product_id' : ''}
      LEFT JOIN sold s               ON s.product_id = p.product_id
      ${coverJoin}
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories sc     ON sc.subcategory_id = p.subcategory_id
      WHERE (${publishedCol} = TRUE)
        AND (${archivedFilter})
        AND (${catPub})
        AND (${subPub})
      GROUP BY
        p.product_id, p.product_name, p.description,
        ${hasImageUrl ? 'p.image_url, cv.cover_url' : 'cv.cover_url'},
        p.category_id, c.category_name, p.subcategory_id, sc.subcategory_name, s.sold_qty
      ORDER BY COALESCE(s.sold_qty, 0) DESC, p.product_id DESC
      LIMIT $1
    `;
    const { rows } = await db.query(sql, [lim]);
    res.json(rows);
  } catch (err) {
    console.error('public products best-sellers error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* =========================================================
 * GET /api/products/:productId
 * ========================================================= */
router.get('/:productId', async (req, res) => {
  try {
    const productId = toInt(req.params.productId);
    if (!Number.isInteger(productId)) return res.status(400).json({ error: 'invalid productId' });

    const { publishedCol, archivedFilter, hasImageUrl } = await getSchemaFlags();

    // รายการสินค้า (ต้องเผยแพร่ + ไม่ archived)
    const p = (await db.query(
      `
      SELECT
        p.product_id, p.product_name, p.description,
        ${hasImageUrl ? 'p.image_url' : 'NULL::text AS image_url'},
        p.category_id, p.subcategory_id, p.selling_price
      FROM products p
      WHERE p.product_id = $1
        AND (${publishedCol} = TRUE)
        AND (${archivedFilter})
      `,
      [productId]
    )).rows[0];
    if (!p) return res.status(404).json({ error: 'product not found' });

    // cover fallback
    if (!p.image_url) {
      const cv = await db.query(`
        SELECT MIN(url) AS cover_url FROM product_images WHERE product_id = $1
      `, [productId]);
      p.image_url = cv.rows[0]?.cover_url || null;
    }

    const useView = await hasTable('v_product_variants_live_stock');
    let variants = [];
    if (useView) {
      const hasFinal = await hasColumn('v_product_variants_live_stock', 'final_price');
      variants = (await db.query(`
        SELECT variant_id, product_id, sku,
               ${hasFinal ? 'COALESCE(price_override, final_price)' : 'price_override'} AS price,
               COALESCE(stock,0)::int AS stock
        FROM v_product_variants_live_stock
        WHERE product_id = $1
        ORDER BY variant_id ASC
      `, [productId])).rows;
    } else {
      variants = (await db.query(`
        SELECT variant_id, product_id, sku, NULL::numeric AS price, 0::int AS stock
        FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_id ASC
      `, [productId])).rows;
    }

    res.json({ ...p, variants });
  } catch (err) {
    console.error('public product detail error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


/* ============================ ALL PRODUCTS ============================ */
router.get('/all', async (req, res) => {
  try {
    const pageSize = parseInt(req.query.limit || req.query.per_page || req.query.pageSize || req.query.top || 30);
    const page = Math.max(1, parseInt(req.query.page || 1));
    const offset = (page - 1) * pageSize;

    const sql = `
      SELECT
        p.product_id, p.product_name, p.description,
        COALESCE(NULLIF(p.image_url, ''), cv.cover_url) AS image_url,
        p.category_id, c.category_name,
        p.subcategory_id, sc.subcategory_name,
        MIN(v.price_override)::numeric AS min_price,
        COALESCE(SUM(v.stock),0)::int AS stock
      FROM products p
      LEFT JOIN v_product_variants_live_stock v ON v.product_id = p.product_id
      LEFT JOIN LATERAL (
        SELECT MIN(pi.url) AS cover_url
        FROM product_images pi
        WHERE pi.product_id = p.product_id
      ) cv ON TRUE
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories sc     ON sc.subcategory_id = p.subcategory_id
      WHERE COALESCE(p.is_archived,FALSE) = FALSE
        AND COALESCE(p.is_published, TRUE) = TRUE
        AND (COALESCE(c.is_published,TRUE) = TRUE)
        AND (COALESCE(sc.is_published,TRUE) = TRUE)
      GROUP BY
        p.product_id, p.product_name, p.description,
        p.image_url, cv.cover_url,
        p.category_id, c.category_name, p.subcategory_id, sc.subcategory_name
      ORDER BY p.product_id DESC
      LIMIT $1 OFFSET $2
    `;

    const { rows } = await db.query(sql, [pageSize, offset]);
    res.json({ page, pageSize, items: rows });
  } catch (e) {
    console.error('GET /api/products/all error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
