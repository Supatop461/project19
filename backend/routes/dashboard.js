// backend/routes/dashboard.js
const express = require('express');

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

const router = express.Router();
console.log('▶ dashboard router LOADED');
router.get('/_ping', (_req, res) => res.json({ ok: true }));

/* ----------------- helpers ----------------- */
function parseISODate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
function whereBetween(col, fromISO, toISO) {
  const cond = [];
  const params = [];
  if (fromISO) { params.push(fromISO); cond.push(`${col} >= $${params.length}`); }
  if (toISO)   { params.push(toISO);   cond.push(`${col} <  $${params.length}`); }
  return { sql: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params };
}
function ok(res, data) { return res.json(data); }
function err(res, e, fallback = []) {
  console.error('[dashboard]', e?.message || e);
  return res.status(200).json(fallback);
}

/* อนุโลมคอลัมน์ archived หลายแบบ */
async function archivedFilterSQL() {
  const hasIsArchived = await hasColumn('products','is_archived');
  const hasArchivedAt = await hasColumn('products','archived_at');
  return hasIsArchived ? 'COALESCE(p.is_archived, FALSE) = FALSE'
       : hasArchivedAt ? 'p.archived_at IS NULL'
       : 'TRUE';
}

/* ----------------- dynamic columns/tables ----------------- */
async function resolveOrderDateCol() {
  if (await hasColumn('orders', 'order_date')) return 'order_date';
  if (await hasColumn('orders', 'created_at')) return 'created_at';
  return 'created_at';
}
async function resolveOrderStatusNameCol() {
  if (await hasColumn('order_statuses', 'order_status_name')) return 'order_status_name';
  if (await hasColumn('order_statuses', 'name')) return 'name';
  return 'name';
}
async function resolveOrderItemTable() {
  if (await hasTable('order_details')) return 'order_details';
  if (await hasTable('order_items')) return 'order_items';
  return null;
}
async function resolveProductCategoryTable() {
  if (await hasTable('product_categories')) return 'product_categories';
  if (await hasTable('categories')) return 'categories';
  return null;
}
async function resolveAddressTable() {
  const candidates = ['addresses', 'user_addresses', 'shipping_addresses', 'customer_addresses'];
  for (const t of candidates) if (await hasTable(t)) return t;
  return null;
}
async function resolveAddressProvinceCol(addressTable) {
  if (!addressTable) return null;
  if (await hasColumn(addressTable, 'province')) return 'province';
  if (await hasColumn(addressTable, 'province_name')) return 'province_name';
  if (await hasColumn(addressTable, 'state')) return 'state';
  return null;
}
async function resolveVariantPK() {
  const vTable = (await hasTable('product_variants')) ? 'product_variants'
               : (await hasTable('variants')) ? 'variants' : null;
  if (!vTable) return { table: null, pk: null, productIdCol: null };
  const pkCandidates = ['product_variant_id', 'variant_id', 'sku_id', 'id'];
  let pk = null;
  for (const c of pkCandidates) if (await hasColumn(vTable, c)) { pk = c; break; }
  const productIdCandidates = ['product_id', 'parent_product_id'];
  let productIdCol = null;
  for (const c of productIdCandidates) if (await hasColumn(vTable, c)) { productIdCol = c; break; }
  return { table: vTable, pk, productIdCol };
}

/* ---------- Category/Subcategory resolvers ---------- */
async function resolveSubcategoryTable() {
  const candidates = [
    'product_subcategories','subcategories','product_subcategory','subcategory'
  ];
  for (const t of candidates) if (await hasTable(t)) return t;
  return null;
}
async function resolveCategoryNameCol(categoryTable) {
  if (!categoryTable) return null;
  return (await hasColumn(categoryTable, 'category_name')) ? 'category_name'
       : (await hasColumn(categoryTable, 'name')) ? 'name'
       : (await hasColumn(categoryTable, 'title')) ? 'title'
       : 'name';
}
async function resolveSubcategoryNameCol(subcatTable) {
  if (!subcatTable) return null;
  return (await hasColumn(subcatTable, 'subcategory_name')) ? 'subcategory_name'
       : (await hasColumn(subcatTable, 'sub_category_name')) ? 'sub_category_name'
       : (await hasColumn(subcatTable, 'name')) ? 'name'
       : (await hasColumn(subcatTable, 'title')) ? 'title'
       : 'name';
}
/* parent col ใน categories สำหรับโครงสร้างลำดับชั้น */
async function resolveCategoryParentCol(categoryTable) {
  if (!categoryTable) return null;
  const candidates = ['parent_id','parent_category_id'];
  for (const c of candidates) if (await hasColumn(categoryTable, c)) return c;
  return null;
}
/* FK จาก products → subcategory */
async function resolveProductsSubcatFK() {
  const candidates = ['subcategory_id','sub_category_id','product_subcategory_id','subcat_id'];
  for (const c of candidates) if (await hasColumn('products', c)) return c;
  return null;
}
/* text col ใน products ที่เก็บชื่อหมวดย่อย */
async function resolveProductTextSubcatCol() {
  const candidates = ['subcategory','sub_category','subcategory_name','subcat_name'];
  for (const c of candidates) if (await hasColumn('products', c)) return c;
  return null;
}

/* ======================== summary ======================== */
router.get('/summary', async (req, res) => {
  try {
    const fromISO = parseISODate(req.query.from);
    const toISO = parseISODate(req.query.to);
    const orderDateCol = await resolveOrderDateCol();
    const w = whereBetween(`o.${orderDateCol}`, fromISO, toISO);

    const addrTable = await resolveAddressTable();

    const [pcount, ucount, ocount, acount, sales] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS c FROM products WHERE COALESCE(is_archived,false)=false`),
      db.query(`SELECT COUNT(*)::int AS c FROM users`),
      db.query(`SELECT COUNT(*)::int AS c FROM orders o ${w.sql}`, w.params),
      addrTable ? db.query(`SELECT COUNT(*)::int AS c FROM ${addrTable}`) : Promise.resolve({ rows:[{ c:0 }] }),
      db.query(`
        SELECT COALESCE(SUM(COALESCE(o.total_amount,0)),0)::float8 AS total
        FROM orders o ${w.sql}
      `, w.params),
    ]);

    return ok(res, {
      products: pcount.rows[0]?.c ?? 0,
      users: ucount.rows[0]?.c ?? 0,
      orders: ocount.rows[0]?.c ?? 0,
      addresses: acount.rows[0]?.c ?? 0,
      total_sales: Number(sales.rows[0]?.total ?? 0)
    });
  } catch (e) { return err(res, e, { products:0, users:0, orders:0, addresses:0, total_sales:0 }); }
});

/* ======================== sales-by-month ======================== */
router.get('/sales-by-month', async (req, res) => {
  try {
    const fromISO = parseISODate(req.query.from);
    const toISO = parseISODate(req.query.to);
    const orderDateCol = await resolveOrderDateCol();
    const w = whereBetween(orderDateCol, fromISO, toISO);

    const { rows } = await db.query(`
      SELECT TO_CHAR(${orderDateCol}, 'YYYY-MM') AS month,
             SUM(COALESCE(total_amount,0))::float8 AS total
      FROM orders
      ${w.sql}
      GROUP BY 1
      ORDER BY 1
    `, w.params);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ======================== orders-by-status ======================== */
router.get('/orders-by-status', async (req, res) => {
  try {
    const fromISO = parseISODate(req.query.from);
    const toISO = parseISODate(req.query.to);
    const orderDateCol = await resolveOrderDateCol();
    const statusNameCol = await resolveOrderStatusNameCol();
    const w = whereBetween(`o.${orderDateCol}`, fromISO, toISO);

    const { rows } = await db.query(`
      SELECT COALESCE(s.${statusNameCol}, s.order_status_id::text) AS status_name,
             COUNT(*)::int AS count
      FROM orders o
      LEFT JOIN order_statuses s ON o.order_status_id = s.order_status_id
      ${w.sql}
      GROUP BY 1
      ORDER BY 2 DESC
    `, w.params);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ======================== customers-by-province ======================== */
router.get('/customers-by-province', async (_req, res) => {
  try {
    const addrTable = await resolveAddressTable();
    if (!addrTable) return ok(res, []);
    const provinceCol = await resolveAddressProvinceCol(addrTable);
    const hasUserId = await hasColumn(addrTable, 'user_id');
    const userKey = hasUserId ? 'user_id' : 'address_id';

    const { rows } = await db.query(`
      SELECT ${provinceCol ? `COALESCE(${provinceCol}, 'ไม่ระบุ')` : `'ไม่ระบุ'`} AS province,
             COUNT(DISTINCT ${userKey})::int AS count
      FROM ${addrTable}
      GROUP BY 1
      ORDER BY count DESC, province ASC
      LIMIT 10
    `);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ======================== top-categories-by-purchased ======================== */
router.get('/top-categories-by-purchased', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10), 20));
    const fromISO = parseISODate(req.query.from);
    const toISO = parseISODate(req.query.to);
    const orderDateCol = await resolveOrderDateCol();
    const w = whereBetween(`o.${orderDateCol}`, fromISO, toISO);

    const orderItemTable = await resolveOrderItemTable();
    const categoryTable = await resolveProductCategoryTable();
    const { table: variantTable, pk: variantPK, productIdCol } = await resolveVariantPK();
    if (!orderItemTable || !categoryTable || !variantTable || !variantPK || !productIdCol) return ok(res, []);

    const categoryNameCol = (await hasColumn(categoryTable, 'category_name')) ? 'category_name' : 'name';

    const oiSkuCandidates = ['sku_id', 'variant_id', 'product_variant_id', 'sku'];
    let oiSkuCol = null;
    for (const c of oiSkuCandidates) { if (await hasColumn(orderItemTable, c)) { oiSkuCol = c; break; } }
    if (!oiSkuCol) return ok(res, []);

    const { rows } = await db.query(`
      SELECT c.${categoryNameCol} AS category_name,
             COALESCE(SUM(oi.quantity),0)::int AS qty
      FROM ${orderItemTable} oi
      JOIN orders o ON oi.order_id = o.order_id
      JOIN ${variantTable} v ON oi.${oiSkuCol} = v.${variantPK}
      JOIN products p ON v.${productIdCol} = p.product_id
      LEFT JOIN ${categoryTable} c ON p.category_id = c.category_id
      ${w.sql}
      GROUP BY 1
      ORDER BY qty DESC NULLS LAST, category_name ASC
      LIMIT $${w.params.length + 1}
    `, [...w.params, limit]);

    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ======================== product-count-by-category ======================== */
/* ใช้ตารางหมวดเป็นฐาน + LEFT JOIN products เพื่อให้แสดงหมวดที่ยังไม่มีสินค้า */
router.get('/product-count-by-category', async (_req, res) => {
  try {
    const categoryTable = await resolveProductCategoryTable();
    if (!categoryTable) return ok(res, []);
    const categoryNameCol = (await hasColumn(categoryTable, 'category_name')) ? 'category_name' : 'name';
    const archivedFilter = await archivedFilterSQL();

    const { rows } = await db.query(`
      SELECT
        COALESCE(c.${categoryNameCol}, 'ไม่ระบุ') AS category_name,
        COUNT(p.product_id)::int AS products
      FROM ${categoryTable} c
      LEFT JOIN products p
        ON p.category_id = c.category_id
       AND ${archivedFilter}
      GROUP BY c.category_id, c.${categoryNameCol}
      ORDER BY products DESC, category_name ASC
    `);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ======================== product-count-by-subcategory ======================== */
/* รองรับ limit (ดีฟอลต์ 12) และกรอง archived แบบยืดหยุ่น */
router.get('/product-count-by-subcategory', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '12', 10), 50));

    const categoryTable = await resolveProductCategoryTable();
    const catNameCol = await resolveCategoryNameCol(categoryTable);

    const subcatTable = await resolveSubcategoryTable();
    const prodSubFk  = await resolveProductsSubcatFK();
    const parentCol  = await resolveCategoryParentCol(categoryTable);
    const textSubCol = await resolveProductTextSubcatCol();

    const archivedFilter = await archivedFilterSQL();

    if (subcatTable && prodSubFk) {
      const subNameCol = await resolveSubcategoryNameCol(subcatTable);
      console.log('▶ using: SUBCATEGORY TABLE + FK', { subcatTable, prodSubFk, subNameCol });
      const { rows } = await db.query(`
        SELECT
          ${categoryTable ? `COALESCE(c.${catNameCol}, 'ไม่ระบุ')` : `'ไม่ระบุ'`} AS category_name,
          COALESCE(sc.${subNameCol}, 'ไม่ระบุ') AS subcategory_name,
          COUNT(p.product_id)::int AS products
        FROM products p
        ${categoryTable ? `LEFT JOIN ${categoryTable} c ON p.category_id = c.category_id` : ''}
        LEFT JOIN ${subcatTable} sc ON p.${prodSubFk} = sc.subcategory_id
        WHERE ${archivedFilter}
        GROUP BY 1,2
        ORDER BY products DESC, category_name ASC, subcategory_name ASC
        LIMIT $1
      `, [limit]);
      return ok(res, rows);
    }

    if (categoryTable && parentCol) {
      console.log('▶ using: CATEGORY HIERARCHY', { categoryTable, parentCol });
      const { rows } = await db.query(`
        SELECT
          COALESCE(c.${catNameCol}, 'ไม่ระบุ') AS category_name,     -- parent
          COALESCE(sc.${catNameCol}, 'ไม่ระบุ') AS subcategory_name,  -- child
          COUNT(p.product_id)::int AS products
        FROM products p
        LEFT JOIN ${categoryTable} sc ON p.category_id = sc.category_id
        LEFT JOIN ${categoryTable} c  ON sc.${parentCol} = c.category_id
        WHERE ${archivedFilter}
        GROUP BY 1,2
        ORDER BY products DESC, category_name ASC, subcategory_name ASC
        LIMIT $1
      `, [limit]);
      return ok(res, rows);
    }

    if (textSubCol) {
      console.log('▶ using: PRODUCTS TEXT COL', { textSubCol });
      const { rows } = await db.query(`
        SELECT
          ${categoryTable ? `COALESCE(c.${catNameCol}, 'ไม่ระบุ')` : `'ไม่ระบุ'`} AS category_name,
          COALESCE(p.${textSubCol}, 'ไม่ระบุ') AS subcategory_name,
          COUNT(p.product_id)::int AS products
        FROM products p
        ${categoryTable ? `LEFT JOIN ${categoryTable} c ON p.category_id = c.category_id` : ''}
        WHERE ${archivedFilter}
        GROUP BY 1,2
        ORDER BY products DESC, category_name ASC, subcategory_name ASC
        LIMIT $1
      `, [limit]);
      return ok(res, rows);
    }

    console.log('▶ using: NO SUBCATEGORY FOUND (return empty)');
    return ok(res, []);
  } catch (e) { return err(res, e, []); }
});

/* ======================== category-subcategory-breakdown ======================== */
router.get('/category-subcategory-breakdown', async (_req, res) => {
  try {
    const categoryTable = await resolveProductCategoryTable();
    const catNameCol = await resolveCategoryNameCol(categoryTable);

    const subcatTable = await resolveSubcategoryTable();
    const prodSubFk  = await resolveProductsSubcatFK();
    const parentCol  = await resolveCategoryParentCol(categoryTable);
    const textSubCol = await resolveProductTextSubcatCol();

    const archivedFilter = await archivedFilterSQL();

    if (subcatTable && prodSubFk) {
      console.log('▶ breakdown: SUBCATEGORY TABLE + FK', { subcatTable, prodSubFk });
      const subNameCol = await resolveSubcategoryNameCol(subcatTable);
      const { rows } = await db.query(`
        SELECT
          ${categoryTable ? `COALESCE(c.${catNameCol}, 'ไม่ระบุ')` : `'ไม่ระบุ'`} AS category_name,
          COALESCE(sc.${subNameCol}, 'ไม่ระบุ') AS subcategory_name,
          COUNT(p.product_id)::int AS products
        FROM products p
        ${categoryTable ? `LEFT JOIN ${categoryTable} c ON p.category_id = c.category_id` : ''}
        LEFT JOIN ${subcatTable} sc ON p.${prodSubFk} = sc.subcategory_id
        WHERE ${archivedFilter}
        GROUP BY 1,2
        ORDER BY category_name ASC, products DESC, subcategory_name ASC
      `);
      return ok(res, rows);
    }

    if (categoryTable && parentCol) {
      console.log('▶ breakdown: CATEGORY HIERARCHY', { categoryTable, parentCol });
      const { rows } = await db.query(`
        SELECT
          COALESCE(c.${catNameCol}, 'ไม่ระบุ') AS category_name,     -- parent
          COALESCE(sc.${catNameCol}, 'ไม่ระบุ') AS subcategory_name,  -- child
          COUNT(p.product_id)::int AS products
        FROM products p
        LEFT JOIN ${categoryTable} sc ON p.category_id = sc.category_id
        LEFT JOIN ${categoryTable} c  ON sc.${parentCol} = c.category_id
        WHERE ${archivedFilter}
        GROUP BY 1,2
        ORDER BY category_name ASC, products DESC, subcategory_name ASC
      `);
      return ok(res, rows);
    }

    if (textSubCol) {
      console.log('▶ breakdown: PRODUCTS TEXT COL', { textSubCol });
      const { rows } = await db.query(`
        SELECT
          ${categoryTable ? `COALESCE(c.${catNameCol}, 'ไม่ระบุ')` : `'ไม่ระบุ'`} AS category_name,
          COALESCE(p.${textSubCol}, 'ไม่ระบุ') AS subcategory_name,
          COUNT(p.product_id)::int AS products
        FROM products p
        ${categoryTable ? `LEFT JOIN ${categoryTable} c ON p.category_id = c.category_id` : ''}
        WHERE ${archivedFilter}
        GROUP BY 1,2
        ORDER BY category_name ASC, products DESC, subcategory_name ASC
      `);
      return ok(res, rows);
    }

    console.log('▶ breakdown: FALLBACK single bucket');
    const { rows } = await db.query(`
      SELECT 'ไม่ระบุ' AS category_name, 'ไม่ระบุ' AS subcategory_name,
             COUNT(product_id)::int AS products
      FROM products
      WHERE COALESCE(is_archived,false)=false
    `);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ======================== recent orders/products/addresses ======================== */
router.get('/recent-orders', async (_req, res) => {
  try {
    const orderDateCol = await resolveOrderDateCol();
    const statusNameCol = await resolveOrderStatusNameCol();
    const { rows } = await db.query(`
      SELECT o.order_id, u.email AS email, o.${orderDateCol} AS order_date,
             COALESCE(o.total_amount,0)::float8 AS total_amount,
             COALESCE(s.${statusNameCol}, s.order_status_id::text) AS status_name
      FROM orders o
      LEFT JOIN users u ON u.user_id = o.user_id
      LEFT JOIN order_statuses s ON s.order_status_id = o.order_status_id
      ORDER BY o.${orderDateCol} DESC, o.order_id DESC
      LIMIT 10
    `);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

router.get('/recent-products', async (_req, res) => {
  try {
    const dateCol = (await hasColumn('products', 'created_at')) ? 'created_at' : 'product_id';
    const nameCol = (await hasColumn('products', 'product_name')) ? 'product_name' : 'name';
    const categoryTable = await resolveProductCategoryTable();
    const categoryNameCol = categoryTable
      ? ((await hasColumn(categoryTable, 'category_name')) ? 'category_name' : 'name')
      : null;

    const { rows } = await db.query(`
      SELECT p.product_id,
             p.${nameCol} AS product_name,
             ${categoryTable ? `c.${categoryNameCol}` : `NULL`} AS category_name,
             ${dateCol === 'created_at' ? `p.created_at` : 'NULL'} AS created_at
      FROM products p
      ${categoryTable ? `LEFT JOIN ${categoryTable} c ON p.category_id = c.category_id` : ''}
      ORDER BY ${dateCol} DESC
      LIMIT 10
    `);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

router.get('/recent-addresses', async (_req, res) => {
  try {
    const addrTable = await resolveAddressTable();
    if (!addrTable) return ok(res, []);
    const dateCol = (await hasColumn(addrTable, 'created_at')) ? 'created_at' : 'address_id';
    const provinceCol = await resolveAddressProvinceCol(addrTable);
    const hasUserId = await hasColumn(addrTable, 'user_id');

    const { rows } = await db.query(`
      SELECT a.address_id,
             ${hasUserId ? 'a.user_id' : 'NULL'} AS user_id,
             ${provinceCol ? `COALESCE(a.${provinceCol}, 'ไม่ระบุ')` : `'ไม่ระบุ'`} AS province,
             ${dateCol === 'created_at' ? `a.created_at` : 'NULL'} AS created_at,
             ${hasUserId ? 'u.email' : 'NULL'} AS email,
             ${await hasColumn(addrTable, 'recipient_name') ? 'a.recipient_name' : 'NULL'} AS recipient_name
      FROM ${addrTable} a
      ${hasUserId ? 'LEFT JOIN users u ON u.user_id = a.user_id' : ''}
      ORDER BY ${dateCol === 'created_at' ? `a.created_at DESC` : `a.address_id DESC`}
      LIMIT 10
    `);
    return ok(res, rows);
  } catch (e) { return err(res, e, []); }
});

/* ----------------- extra helpers ----------------- */
async function resolveCreatedAtCol(table) {
  if (!table) return null;
  const candidates = ['created_at', 'createdAt', 'created_on', 'createdOn', 'created'];
  for (const c of candidates) if (await hasColumn(table, c)) return c;
  return null;
}

/* ======================== add-to-cart-trend ======================== */
router.get('/add-to-cart-trend', async (req, res) => {
  try {
    const fromISO = parseISODate(req.query.from);
    const toISO   = parseISODate(req.query.to);
    const days    = Math.min(Math.max(parseInt(req.query.days || '14', 10), 1), 90);

    const hasCartItems = await hasTable('cart_items');
    if (!hasCartItems) return ok(res, []);

    const ciDateCol = await resolveCreatedAtCol('cart_items');
    if (!ciDateCol) {
      return ok(res, []);
    }

    const hasCarts = await hasTable('carts');
    let rows;

    if (fromISO || toISO) {
      const w = whereBetween(`ci.${ciDateCol}`, fromISO, toISO);
      const sql = `
        SELECT DATE(ci.${ciDateCol}) AS day, COUNT(*)::int AS add_events
        FROM cart_items ci
        ${hasCarts ? 'JOIN carts ca ON ca.cart_id = ci.cart_id' : ''}
        ${w.sql}
        GROUP BY 1
        ORDER BY 1
      `;
      ({ rows } = await db.query(sql, w.params));
    } else {
      const sql = `
        SELECT DATE(ci.${ciDateCol}) AS day, COUNT(*)::int AS add_events
        FROM cart_items ci
        ${hasCarts ? 'JOIN carts ca ON ca.cart_id = ci.cart_id' : ''}
        WHERE ci.${ciDateCol} >= NOW() - INTERVAL '${days} days'
        GROUP BY 1
        ORDER BY 1
      `;
      ({ rows } = await db.query(sql));
    }

    return ok(res, rows);
  } catch (e) {
    return err(res, e, []);
  }
});

/* ======================== published-share ======================== */
router.get('/published-share', async (_req, res) => {
  try {
    const hasPublished = await hasColumn('products', 'published');
    const hasIsPub    = await hasColumn('products', 'is_published');
    const col = hasPublished ? 'published' : (hasIsPub ? 'is_published' : null);

    const sql = col
      ? `
        SELECT
          CASE WHEN COALESCE(p.${col}, TRUE)=TRUE THEN 'Published' ELSE 'Unpublished' END AS status,
          COUNT(*)::int AS cnt
        FROM products p
        WHERE COALESCE(p.is_archived, FALSE) = FALSE
        GROUP BY 1
        ORDER BY cnt DESC, status ASC
      `
      : `
        SELECT 'Published' AS status, COUNT(*)::int AS cnt
        FROM products p
        WHERE COALESCE(p.is_archived, FALSE) = FALSE
        ORDER BY cnt DESC, status ASC
      `;

    const { rows } = await db.query(sql);
    return ok(res, rows);
  } catch (e) {
    return err(res, e, []);
  }
});

module.exports = router;
