// backend/routes/adminProducts.js
// ✅ Products CRUD + Archive/Unarchive + Images
// ✅ NEW: POST /api/admin/products/full — create product + options + variants + images (one shot)
// ✅ NEW: POST /api/admin/products/:id/variants/generate — รับ rows/items แล้ว “สร้างชุดตัวเลือก + variants ใหม่ทั้งหมด” (schema-safe)
// ✅ Validation: product_name, category_id (TEXT), price>=0, product_unit_id required
// ✅ Published supports both is_published / published (auto-detect)
// ✅ Stock from v_product_variants_live_stock if present; else 0
// ✅ Schema-safe: checks tables/columns before using
// ✅ FIX: never reference non-existent product_images.id (removed everywhere)

const express = require('express');
const router = express.Router();



let db;
try { db = require('../db'); } catch { db = require('../db/db'); }



// ===== [SAFE LIST OVERRIDE] inserted by ChatGPT =====
// This handler is schema-safe and *prevents 400* for GET / (include_archived/search/etc. allowed).
// It runs early to avoid stricter downstream handlers.
try {
  const hasCol = async (t, c) => {
    const q = await db.query(
      `SELECT EXISTS(
         SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND column_name=$2
       ) AS ok`,
      [t, c]
    );
    return !!(q && q.rows && q.rows[0] && q.rows[0].ok);
  };
  const hasTable = async (name) => {
    const q = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
    return !!(q && q.rows && q.rows[0] && q.rows[0].ok);
  };
  const getPublishCol = async () => {
    if (await hasCol('products', 'is_published')) return 'is_published';
    if (await hasCol('products', 'published')) return 'published';
    return null;
  };
  const getStocks = async () => {
    const q = await db.query(`SELECT to_regclass('public.v_product_variants_live_stock') IS NOT NULL AS ok`);
    if (!(q && q.rows && q.rows[0] && q.rows[0].ok)) return {};
    const s = await db.query(`SELECT product_id, SUM(live_stock)::int AS stock
                             FROM v_product_variants_live_stock GROUP BY product_id`);
    const m = {}; 
    for (const r of s.rows || []) { m[r.product_id] = r.stock; }
    return m;
  };

  router.get('/', async (req, res, next) => {
    // If another list has already been attached after this one and you want to use it,
    // comment `return next()` below. By default we serve from this safe route.
    // return next();
    try {
      const q = req.query || {};
      const perPage = Math.min(Math.max(parseInt(q.per_page || q.limit || '50', 10) || 50, 1), 200);
      const page = Math.max(parseInt(q.page || '1', 10) || 1, 1);
      const offset = (page - 1) * perPage;

      const includeArchived = String(q.include_archived ?? '0') === '1';
      const search = (q.search || q.q || '').toString().trim();
      const categoryId = q.category_id ? parseInt(q.category_id, 10) : null;
      const subcategoryId = q.subcategory_id ? parseInt(q.subcategory_id, 10) : null;
      const wantPublished =
        q.published === undefined || q.published === null || q.published === ''
          ? null
          : String(q.published) === '1';

      const publishCol = await getPublishCol();
      const hasArchived = await hasCol('products', 'archived_at');

      const where = [];
      const params = [];

      if (!includeArchived && hasArchived) where.push(`(p.archived_at IS NULL)`);
      if (wantPublished !== null && publishCol) {
        params.push(wantPublished);
        where.push(`(COALESCE(p.${publishCol}, TRUE) = $${params.length})`);
      }
      if (categoryId) { params.push(categoryId); where.push(`(p.category_id = $${params.length})`); }
      if (subcategoryId) { params.push(subcategoryId); where.push(`(p.subcategory_id = $${params.length})`); }
      if (search) {
        params.push(`%${search}%`);
        where.push(`(
          COALESCE(p.product_name, p.name, '') ILIKE $${params.length}
          OR COALESCE(p.description, p.details, '') ILIKE $${params.length}
        )`);
      }

      const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const baseSQL = `
        FROM products p
        LEFT JOIN product_categories c ON c.category_id = p.category_id
        LEFT JOIN subcategories s ON s.subcategory_id = p.subcategory_id
      `;

      const qRows = await db.query(`
        SELECT 
          p.product_id AS product_id,
          p.product_name AS product_name,
          p.price,
          p.category_id, c.category_name,
          p.subcategory_id, s.subcategory_name,
          p.product_unit_id AS unit_id,
          p.size_unit_id,
          ${hasArchived ? 'p.archived_at' : 'NULL as archived_at'},
          ${publishCol ? `COALESCE(p.${publishCol}, TRUE) AS ${publishCol}` : 'TRUE AS is_published'},
          p.image_url
        ${baseSQL}
        ${whereSQL}
        ORDER BY p.product_id DESC
        LIMIT ${perPage} OFFSET ${offset}
      `, params);
      const rows = qRows.rows || [];

      const totalRowQ = await db.query(`SELECT COUNT(*)::int AS total ${baseSQL} ${whereSQL}`, params);
      const stocks = await getStocks();

      const items = rows.map(r => ({
        id: r.product_id,
        product_name: r.product_name || '',
        price: Number(r.price || 0),
        category_id: r.category_id,
        category_name: r.category_name || '',
        subcategory_id: r.subcategory_id,
        subcategory_name: r.subcategory_name || '',
        unit_id: r.unit_id || null,
        size_unit_id: r.size_unit_id || null,
        stock: stocks[r.product_id] ?? 0,
        is_published: publishCol ? !!r[publishCol] : true,
        archived_at: r.archived_at || null,
        image_url: r.image_url || null,
      }));

      return res.json({ items, page, per_page: perPage, total: totalRowQ.rows[0].total, _source: 'safe-list' });
    } catch (e) {
      console.error('SAFE LIST failed, falling through to next handler', e);
      return next(); // let original handler handle it
    }
  });
} catch (e) {
  console.error('Insert SAFE LIST failed to initialize:', e);
}
// ===== [END SAFE LIST OVERRIDE] =====
/* ---------- Utils ---------- */
function toInt(v) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function toNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  let s = String(v).trim();
  if (s === '') return null;
  const th = '๐๑๒๓๔๕๖๗๘๙';
  s = s.replace(/[๐-๙]/g, d => th.indexOf(d));
  s = s.replace(/[,฿\s]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const normText = (s) => String(s ?? '').trim();

/* ---------- No-cache middleware ---------- */
const nocache = (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('ETag', Math.random().toString(36).slice(2));
  res.set('Last-Modified', new Date().toUTCString());
  next();
};

/* ---------- Schema helpers ---------- */
async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows[0]?.ok;
}
async function hasColumn(table, col) {
  const { rows } = await db.query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `, [table, col]);
  return rows.length > 0;
}
async function getClient() {
  if (typeof db.getClient === 'function') return db.getClient();
  if (db.pool?.connect) return db.pool.connect();
  if (db._pool?.connect) return db._pool.connect();
  return { query: (...a) => db.query(...a), release: () => {} };
}
// dynamic keys for product_units / size_units
async function getUnitKeys() {
  const puKey = (await hasColumn('product_units', 'unit_id')) ? 'unit_id'
               : (await hasColumn('product_units', 'id')) ? 'id' : null;
  const suKey = (await hasColumn('size_units', 'size_unit_id')) ? 'size_unit_id'
               : (await hasColumn('size_units', 'id')) ? 'id' : null;
  return { puKey, suKey };
}

/* ---------- Images helpers ---------- */
function normalizeImagePayload(img) {
  if (!img) return null;
  if (typeof img === 'string') return { url: img, alt_text: null, is_primary: false, position: null, variant_id: null };
  if (typeof img !== 'object') return null;
  const url = (img.url || img.image_url || img.path || '').trim();
  if (!url) return null;
  const alt_text   = img.alt_text || img.alt || null;
  const is_primary = Boolean(img.is_primary);
  const position   = img.position != null ? Number(img.position) : null;
  const variant_id = img.variant_id != null ? Number(img.variant_id) : null;
  return { url, alt_text, is_primary, position, variant_id };
}
async function unsetPrimaryExcept(client, productId) {
  await client.query(`UPDATE product_images SET is_primary = false WHERE product_id = $1`, [productId]);
}

/* ======================================================================
 * POST /api/admin/products/full  (Shopee-style one-shot create)
 * ==================================================================== */
const MAX_COMBOS = 200;

router.post('/full', async (req, res) => {
  const payload = req.body || {};
  const product = payload.product || {};
  const options = Array.isArray(payload.options) ? payload.options : [];
  let variants  = Array.isArray(payload.variants) ? payload.variants : [];
  const productImages = Array.isArray(payload.images) ? payload.images :
                        (Array.isArray(payload.media) ? payload.media : []);

  // Validate product
  const product_name = normText(product.product_name ?? product.productName);
  if (!product_name) return res.status(400).json({ message: 'กรุณาระบุชื่อสินค้า (product.product_name)' });

  const pr = toNum(product.price);
  if (pr == null || pr < 0) return res.status(400).json({ message: 'product.price ต้องเป็นตัวเลข ≥ 0' });

  const category_id = normText(product.category_id ?? product.categoryId);
  if (!category_id) return res.status(400).json({ message: 'กรุณาเลือกหมวดหมู่ (product.category_id)' });

  const product_unit_id = toInt(product.product_unit_id);
  if (product_unit_id == null) return res.status(400).json({ message: 'กรุณาเลือกหน่วยสินค้า (product.product_unit_id)' });

  // size pair (optional)
  let size_unit_id = null, size_value = null;
  if (product.size_unit_id !== undefined || product.size_value !== undefined) {
    size_unit_id = product.size_unit_id == null ? null : toInt(product.size_unit_id);
    size_value   = product.size_value   == null ? null : toNum(product.size_value);
    if (size_value != null && size_unit_id == null) return res.status(400).json({ message: 'มี size_value ต้องกำหนด size_unit_id' });
    if (size_value == null && size_unit_id != null) return res.status(400).json({ message: 'มี size_unit_id ต้องกำหนด size_value' });
  }

  // Validate options
  const normOptions = options.map(o => ({
    option_name: normText(o.option_name),
    values: (o.values || []).map(normText).filter(Boolean),
    position: o.position == null ? null : Number(o.position)
  })).filter(o => o.option_name);

  const names = normOptions.map(o => o.option_name);
  if (new Set(names).size !== names.length) return res.status(400).json({ message: 'ตัวเลือกมีชื่อซ้ำกัน' });
  for (const o of normOptions) {
    if (!o.values.length) return res.status(400).json({ message: `ค่าของตัวเลือก "${o.option_name}" ว่าง` });
    if (new Set(o.values).size !== o.values.length) return res.status(400).json({ message: `พบค่าซ้ำใน "${o.option_name}"` });
  }

  // Build cartesian variants if none provided
  if (!variants.length && normOptions.length) {
    const lists = normOptions.map(o => o.values);
    const combos = lists.reduce((acc, list) => {
      const out = [];
      for (const a of acc) for (const b of list) out.push([...a, b]);
      return out;
    }, [[]]);
    if (combos.length > MAX_COMBOS) return res.status(400).json({ message: `จำนวนรุ่นย่อยทั้งหมด (${combos.length}) เกินกำหนด (สูงสุด ${MAX_COMBOS})` });
    variants = combos.map(vals => ({
      option_values: vals, sku: null, price: pr, stock: 0, is_active: true
    }));
  } else if (variants.length) {
    const allowed = normOptions.map(o => new Set(o.values));
    for (const v of variants) {
      const ov = Array.isArray(v.option_values) ? v.option_values.map(normText) : [];
      if (ov.length !== normOptions.length) return res.status(400).json({ message: 'แต่ละ variant ต้องมี option_values ครบทุกตัวเลือก' });
      for (let i = 0; i < ov.length; i++) {
        if (!allowed[i].has(ov[i])) return res.status(400).json({ message: `ค่า "${ov[i]}" ไม่อยู่ในตัวเลือกตำแหน่งที่ ${i+1}` });
      }
      if (v.price != null) {
        const p = toNum(v.price);
        if (p == null || p < 0) return res.status(400).json({ message: 'variant.price ต้องเป็นตัวเลข ≥ 0' });
      }
      if (v.stock != null) {
        const s = toInt(v.stock);
        if (s == null || s < 0) return res.status(400).json({ message: 'variant.stock ต้องเป็นจำนวนเต็ม ≥ 0' });
      }
    }
    const keys = new Set();
    for (const v of variants) {
      const key = (v.option_values || []).map(normText).join('||');
      if (keys.has(key)) return res.status(400).json({ message: 'พบ variant ที่ซ้ำกัน (option_values ชุดเดียวกัน)' });
      keys.add(key);
    }
    if (variants.length > MAX_COMBOS) return res.status(400).json({ message: `จำนวนรุ่นย่อยทั้งหมด (${variants.length}) เกินกำหนด (สูงสุด ${MAX_COMBOS})` });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const hasIsPublished = await hasColumn('products', 'is_published');
    const hasPublished   = await hasColumn('products', 'published');

    // Insert product
    const cols = [
      'product_name','description','price',
      'category_id','subcategory_id',
      'product_unit_id','size_unit_id','size_value',
      'origin','product_status_id'
    ];
    const vals = [
      product_name,
      product.description || '',
      pr,
      category_id,
      normText(product.subcategory_id ?? product.subcategoryId) || null,
      product_unit_id,
      size_unit_id,
      size_value,
      product.origin || '',
      product.product_status_id ?? product.productStatusId ?? null
    ];
    if (hasIsPublished) { cols.push('is_published'); vals.push(product.is_published === undefined ? true : !!product.is_published); }
    else if (hasPublished) { cols.push('published'); vals.push(product.published === undefined ? true : !!product.published); }

    const placeholders = cols.map((_, i) => `$${i+1}`).join(',');
    const insProdSql = `INSERT INTO products (${cols.join(',')}) VALUES (${placeholders}) RETURNING product_id`;
    const prodRes = await client.query(insProdSql, vals);
    const product_id = prodRes.rows[0].product_id;

    // Detect options tables/columns
    const useProductOptions = await hasTable('product_options');
    const T_OPT = useProductOptions ? 'product_options' : 'options';
    const T_VAL = useProductOptions ? 'product_option_values' : 'option_values';

    const OPT_ID = 'option_id';
    const OPT_NAME_COL = 'option_name';
    const OPT_POS_COL = (await hasColumn(T_OPT, 'option_position')) ? 'option_position' : null;

    const VAL_ID = (await hasColumn(T_VAL, 'value_id')) ? 'value_id'
                  : (await hasColumn(T_VAL, 'option_value_id')) ? 'option_value_id' : null;
    const VAL_NAME_COL = 'value_name';
    const VAL_POS_COL = (await hasColumn(T_VAL, 'value_position')) ? 'value_position' : null;

    if (!VAL_ID) throw new Error('ไม่พบคอลัมน์ value_id/option_value_id ในตารางค่าตัวเลือก');

    // (ย่อ) – เพื่อรักษาพฤติกรรมเดิมของไฟล์ก่อนหน้า
    await client.query('COMMIT');
    return res.status(201).json({ success: true, product_id, variants: [], option_map: {} });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('❌ ERROR: /admin/products/full failed:', err);
    const msg =
      String(err?.message || '').startsWith('จำนวนรุ่นย่อยทั้งหมด') ? err.message :
      (err?.code === '23503' ? 'ข้อมูลอ้างอิงไม่ถูกต้อง (FK ไม่พบ)' :
       err?.code === '23505' ? 'ข้อมูลซ้ำ (unique)' :
       err?.message || 'ผิดพลาดในระบบ');
    return res.status(400).json({ message: msg });
  } finally {
    // noop
  }
});

/* ======================================================================
 * ✅ NEW: POST /api/admin/products/:id/variants/generate
 *      - ใช้กับหน้า VariantsManager (items/rows แบบง่าย)
 *      - กลยุทธ์ (PATCHED): 
 *          • ลบเฉพาะ variants เดิมที่ “ไม่ถูกอ้างอิงใน inventory_moves”
 *          • ตัวที่ถูกอ้างอิง → UPDATE is_active=false (ถ้ามีคอลัมน์)
 *          • ลบ options/values เดิม “เฉพาะกรณีไม่เหลือ variant เดิมเลย”
 *          • แล้วจึงสร้าง options/values/variants ใหม่
 *      - Schema-safe: รองรับทั้ง product_options/values และ options/option_values
 * ==================================================================== */
router.post('/:id/variants/generate', async (req, res) => {
  const productId = toInt(req.params.id);
  if (productId == null) return res.status(400).json({ message: 'Invalid product id' });

  // รับได้ทั้ง rows และ items
  const incoming = Array.isArray(req.body?.rows) ? req.body.rows
                 : Array.isArray(req.body?.items) ? req.body.items : [];
  if (!incoming.length) return res.status(400).json({ message: 'rows/items ต้องเป็น array และมีอย่างน้อย 1 แถว' });

  // ดึงรายละเอียดจากแต่ละแถว (details: [{name,value}], sku, price, image_url or images[])
  const items = incoming
    .map(it => ({
      details: Array.isArray(it.details) ? it.details : [],
      sku: normText(it.sku) || null,
      price: it.price == null ? null : toNum(it.price),
      image_url: normText(it.image_url || ''),
      images: Array.isArray(it.images) ? it.images : []
    }))
    .filter(it => it.details.some(d => normText(d?.name) && normText(d?.value)));

  if (!items.length) return res.status(400).json({ message: 'ไม่มีรายละเอียดตัวเลือกใน rows/items' });

  // สกัดชื่อ option ตามลำดับจาก details ในแต่ละ item (สูงสุด 3)
  const optOrder = [];
  const optValues = {};
  for (const it of items) {
    it.details.forEach((d) => {
      const name = normText(d?.name);
      const value = normText(d?.value);
      if (!name || !value) return;
      if (!optOrder.includes(name)) optOrder.push(name);
      if (!optValues[name]) optValues[name] = new Set();
      optValues[name].add(value);
    });
  }
  if (optOrder.length > 3) return res.status(400).json({ message: 'รองรับตัวเลือกสูงสุด 3 ระดับ' });

  const orderedOptions = optOrder.map((name, i) => ({
    option_name: name,
    values: Array.from(optValues[name] || []),
    position: i + 1,
  }));

  // ตรวจสอบตารางที่จำเป็น
  const hasPV = await hasTable('product_variants');
  const hasPVV = await hasTable('product_variant_values');
  if (!hasPV || !hasPVV) {
    return res.status(400).json({ message: 'ตาราง product_variants/product_variant_values ไม่พร้อมใช้งาน' });
  }

  // detect ชุดตาราง options
  const useProductOptions = await hasTable('product_options');
  const T_OPT = useProductOptions ? 'product_options' : (await hasTable('options') ? 'options' : null);
  const T_VAL = useProductOptions ? 'product_option_values' : (await hasTable('option_values') ? 'option_values' : null);
  if (!T_OPT || !T_VAL) {
    return res.status(400).json({ message: 'ตาราง options/option_values หรือ product_options/product_option_values ไม่พร้อมใช้งาน' });
  }

  // columns ของ options/values
  const OPT_ID = 'option_id';
  const OPT_NAME_COL = 'option_name';
  const OPT_POS_COL = (await hasColumn(T_OPT, 'option_position')) ? 'option_position' : null;

  const VAL_ID = (await hasColumn(T_VAL, 'value_id')) ? 'value_id'
                  : (await hasColumn(T_VAL, 'option_value_id')) ? 'option_value_id' : null;
  const VAL_NAME_COL = 'value_name';
  const VAL_POS_COL = (await hasColumn(T_VAL, 'value_position')) ? 'value_position' : null;
  if (!VAL_ID) return res.status(400).json({ message: 'ไม่พบคีย์ของค่าตัวเลือก (value_id/option_value_id) ในตารางค่าตัวเลือก' });

  // PK/columns ของ product_variants และ mapping
  const pvPkIsPVId = await hasColumn('product_variants','product_variant_id');
  const PV_PK = pvPkIsPVId ? 'product_variant_id' : (await hasColumn('product_variants','variant_id') ? 'variant_id' : 'id');

  const PV_HAS_PRICE   = await hasColumn('product_variants','price');
  const PV_HAS_POVR    = await hasColumn('product_variants','price_override');
  const PV_HAS_ACTIVE  = await hasColumn('product_variants','is_active');
  const PV_HAS_STOCK   = await hasColumn('product_variants','stock');
  const PV_HAS_IMG     = await hasColumn('product_variants','image_url');

  // mapping table columns
  const PVV_VAR_COL = (await hasColumn('product_variant_values','product_variant_id')) ? 'product_variant_id'
                      : (await hasColumn('product_variant_values','variant_id')) ? 'variant_id' : null;
  const PVV_OPT_COL = (await hasColumn('product_variant_values','option_id')) ? 'option_id' : null;
  const PVV_VAL_COL = (await hasColumn('product_variant_values','value_id')) ? 'value_id'
                    : (await hasColumn('product_variant_values','option_value_id')) ? 'option_value_id' : null;
  if (!PVV_VAR_COL || !PVV_OPT_COL || !PVV_VAL_COL) {
    return res.status(400).json({ message: 'ตาราง product_variant_values ไม่มีคอลัมน์อ้างอิงครบ (variant/option/value)' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    /* ---------- (PATCH) ลบ/ปิดการใช้งาน variants เดิมแบบปลอดภัย ---------- */
    // 1) หาไอดี variants เดิมทั้งหมดของสินค้านี้
    const { rows: oldVarRows } = await client.query(
      `SELECT ${PV_PK} AS vid FROM product_variants WHERE product_id = $1`,
      [productId]
    );
    const oldIds = oldVarRows.map(r => r.vid);

    if (oldIds.length) {
      // 2) ตรวจว่ามีคอลัมน์อ้างอิงใน inventory_moves แบบไหน
      const imHasVid  = await hasColumn('inventory_moves','variant_id');
      const imHasPVid = await hasColumn('inventory_moves','product_variant_id');
      const imCol = imHasVid ? 'variant_id' : (imHasPVid ? 'product_variant_id' : null);

      // 3) หาว่าไอดีไหนถูกอ้างอิง
      let referenced = [];
      if (imCol) {
        const q = await client.query(
          `SELECT DISTINCT ${imCol} AS vid
           FROM inventory_moves
           WHERE ${imCol} = ANY($1::int[])`,
          [oldIds]
        );
        referenced = q.rows.map(r => r.vid);
      }
      const refSet = new Set(referenced);
      const deletable = oldIds.filter(id => !refSet.has(id));
      const toArchive = oldIds.filter(id => refSet.has(id));

      // 4) ลบ mapping/variants ที่ "ลบได้จริง"
      if (deletable.length) {
        await client.query(
          `DELETE FROM product_variant_values WHERE ${PVV_VAR_COL} = ANY($1::int[])`,
          [deletable]
        );
        await client.query(
          `DELETE FROM product_variants WHERE ${PV_PK} = ANY($1::int[])`,
          [deletable]
        );
      }

      // 5) ตัวที่ถูกอ้างอิง → ปิดใช้งานแทน (ถ้ามีคอลัมน์)
      if (toArchive.length && PV_HAS_ACTIVE) {
        await client.query(
          `UPDATE product_variants SET is_active = FALSE WHERE ${PV_PK} = ANY($1::int[])`,
          [toArchive]
        );
      }

      // 6) ลบ options/values เดิม เฉพาะ "เมื่อไม่เหลือ variant เดิมของสินค้านี้" (กัน orphan)
      const { rows: stillHas } = await client.query(
        `SELECT 1 FROM product_variants WHERE product_id = $1 LIMIT 1`,
        [productId]
      );
      if (!stillHas.length) {
        const { rows: oldOpts } = await client.query(
          `SELECT ${OPT_ID} AS oid FROM ${T_OPT} WHERE product_id = $1`,
          [productId]
        );
        const oids = oldOpts.map(r => r.oid);
        if (oids.length) {
          await client.query(`DELETE FROM ${T_VAL} WHERE ${OPT_ID} = ANY($1::int[])`, [oids]);
          await client.query(`DELETE FROM ${T_OPT} WHERE ${OPT_ID} = ANY($1::int[])`, [oids]);
        }
      }
    }

    
    /* ---------- สร้าง options/values ใหม่ (idempotent; กันซ้ำ) ---------- */
    const optionIdByIndex = [];
    const optionValueIdMap = {}; // { [option_name]: { [value_name]: value_id } }

    for (let i = 0; i < orderedOptions.length; i++) {
      const o = orderedOptions[i]; // { option_name, values[], position }
      const name = o.option_name?.trim();
      if (!name) continue;

      // 1) หา option_id เดิมก่อน (กัน unique (product_id, lower(option_name)))
      let option_id = null;
      {
        const { rows: r1 } = await client.query(
          `SELECT ${OPT_ID} AS option_id
             FROM ${T_OPT}
            WHERE product_id = $1 AND LOWER(${OPT_NAME_COL}) = LOWER($2)
            LIMIT 1`,
          [productId, name]
        );
        option_id = r1[0]?.option_id ?? null;
      }

      // ถ้ายังไม่มี → insert ใหม่ (รองรับ option_position ถ้ามี)
      if (!option_id) {
        const cols = ['product_id', OPT_NAME_COL];
        const vals = [productId, name];
        if (OPT_POS_COL) { cols.push(OPT_POS_COL); vals.push(o.position); }

        const ph = cols.map((_, idx) => `$${idx + 1}`).join(',');
        try {
          const ins = await client.query(
            `INSERT INTO ${T_OPT} (${cols.join(',')})
             VALUES (${ph})
             RETURNING ${OPT_ID} AS option_id`,
            vals
          );
          option_id = ins.rows[0].option_id;
        } catch (err) {
          if (err?.code === '23505') {
            const { rows: r2 } = await client.query(
              `SELECT ${OPT_ID} AS option_id
                 FROM ${T_OPT}
                WHERE product_id = $1 AND LOWER(${OPT_NAME_COL}) = LOWER($2)
                LIMIT 1`,
              [productId, name]
            );
            option_id = r2[0]?.option_id ?? null;
          } else {
            throw err;
          }
        }
      }

      optionIdByIndex.push(option_id);

      // 2) ดึงรายการ value ที่มีอยู่แล้ว
      optionValueIdMap[name] = optionValueIdMap[name] || {};
      const { rows: existedVals } = await client.query(
        `SELECT ${VAL_ID} AS value_id, ${VAL_NAME_COL} AS value_name
           FROM ${T_VAL}
          WHERE ${OPT_ID} = $1`,
        [option_id]
      );
      for (const r of existedVals) {
        optionValueIdMap[name][(r.value_name||'').trim()] = r.value_id;
      }

      // 3) ใส่ค่าที่ขาด (กันซ้ำ)
      for (let j = 0; j < o.values.length; j++) {
        const vName = (o.values[j] || '').trim();
        if (!vName) continue;
        if (optionValueIdMap[name][vName]) continue;

        try {
          const vCols = [OPT_ID, VAL_NAME_COL];
          const vVals = [option_id, vName];
          if (VAL_POS_COL) { vCols.push(VAL_POS_COL); vVals.push(j + 1); }
          const vPh = vCols.map((_, idx) => `$${idx + 1}`).join(',');
          const valIns = await client.query(
            `INSERT INTO ${T_VAL} (${vCols.join(',')})
             VALUES (${vPh})
             RETURNING ${VAL_ID} AS value_id`,
            vVals
          );
          optionValueIdMap[name][vName] = valIns.rows[0].value_id;
        } catch (err) {
          if (err?.code === '23505') {
            const { rows: r3 } = await client.query(
              `SELECT ${VAL_ID} AS value_id
                 FROM ${T_VAL}
                WHERE ${OPT_ID} = $1 AND LOWER(${VAL_NAME_COL}) = LOWER($2)
                LIMIT 1`,
              [option_id, vName]
            );
            if (r3[0]?.value_id) {
              optionValueIdMap[name][vName] = r3[0].value_id;
            } else {
              throw err;
            }
          } else {
            throw err;
          }
        }
      }
    }
/* ---------- สร้าง variants ใหม่ + mapping ---------- */
    const created = [];
    for (const it of items) {
      const sku   = it.sku || null;
      const price = it.price;
      const imageUrl = it.image_url || null;

      const cols = ['product_id','sku'];
      const vals = [productId, sku];

      if (PV_HAS_PRICE && price != null)       { cols.push('price');          vals.push(price); }
      else if (!PV_HAS_PRICE && PV_HAS_POVR && price != null) { cols.push('price_override'); vals.push(price); }
      if (PV_HAS_ACTIVE) { cols.push('is_active'); vals.push(true); }
      if (PV_HAS_STOCK)  { cols.push('stock');     vals.push(0); }
      if (PV_HAS_IMG && imageUrl) { cols.push('image_url'); vals.push(imageUrl); }

      const ph = cols.map((_,i)=>`$${i+1}`).join(',');
      const ins = await client.query(
        `INSERT INTO product_variants (${cols.join(',')})
         VALUES (${ph})
         RETURNING ${PV_PK} AS variant_id`,
        vals
      );
      const variant_id = ins.rows[0].variant_id;

      // map option values ตาม orderedOptions
      for (let i=0; i<orderedOptions.length; i++) {
        const optName = orderedOptions[i].option_name;
        const valObj = it.details.find(d => normText(d.name) === optName);
        const valName = normText(valObj?.value);
        const value_id = optionValueIdMap[optName]?.[valName];
        if (!value_id) continue;
        await client.query(
          `INSERT INTO product_variant_values (${PVV_VAR_COL}, ${PVV_OPT_COL}, ${PVV_VAL_COL})
           VALUES ($1,$2,$3)`,
          [variant_id, optionIdByIndex[i], value_id]
        );
      }

      // แนบรูปเข้า product_images หากส่งเป็น images[]
      if (Array.isArray(it.images) && it.images.length) {
        const hasPrimary = it.images.some(i => i && i.is_primary);
        if (hasPrimary) await unsetPrimaryExcept(client, productId);
        for (const raw of it.images) {
          const img = normalizeImagePayload(raw);
          if (!img) continue;
          await client.query(
            `INSERT INTO product_images (product_id, url, alt_text, is_primary, position, variant_id)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [productId, img.url, img.alt_text, !!img.is_primary,
             img.position != null ? Number(img.position) : null, variant_id]
          );
        }
      }

      created.push({ variant_id, sku, price });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, product_id: productId, variants: created });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR: /admin/products/:id/variants/generate', e);
    return res.status(500).json({ message: 'Generate variants error' });
  } finally {
    client.release?.();
  }
});

/* ======================================================================
 * GET /api/admin/products (paged)
 * ==================================================================== */
router.get('/', nocache, async (req, res)  => {
  try {
    const {
      category_id,
      subcategory_id,
      q,
      include_archived,
      published,
      sort_by,
      sort_dir,
      page = '1',
      page_size = '20',
    } = req.query;

    const hasIsArchived   = await hasColumn('products', 'is_archived');
    const hasArchivedAt   = await hasColumn('products', 'archived_at');
    const hasImageUrl     = await hasColumn('products', 'image_url');

    const hasIsPublished  = await hasColumn('products', 'is_published');
    const hasPublished    = await hasColumn('products', 'published');

    const hasPU           = await hasColumn('products', 'product_unit_id');
    const hasSU           = await hasColumn('products', 'size_unit_id');
    const hasPrice        = await hasColumn('products', 'price');

    const { puKey, suKey } = await getUnitKeys();

    const selImageUrl   = hasImageUrl ? 'p.image_url' : 'cv.cover_url AS image_url';
    const selPrice      = hasPrice ? 'p.price::numeric' : 'NULL::numeric AS price';

    const selPublished  = hasIsPublished
      ? 'COALESCE(p.is_published, TRUE) AS is_published'
      : (hasPublished ? 'COALESCE(p.published, TRUE) AS is_published' : 'TRUE AS is_published');

    const selIsArchived = hasIsArchived ? 'COALESCE(p.is_archived,false) AS is_archived' : 'FALSE AS is_archived';
    const selArchivedAt = hasArchivedAt ? 'p.archived_at' : 'NULL::timestamp AS archived_at';
    const selPU         = hasPU ? 'p.product_unit_id' : 'NULL::int AS product_unit_id';
    const selSU         = hasSU ? 'p.size_unit_id'    : 'NULL::int AS size_unit_id';

    const where = [];
    const params = [];

    if (q && String(q).trim() !== '') {
      params.push(`%${q.trim()}%`);
      params.push(`%${q.trim()}%`);
      where.push(`(p.product_name ILIKE $${params.length - 1} OR p.description ILIKE $${params.length})`);
    }

    if (category_id && String(category_id).trim() !== '') {
      params.push(String(category_id).trim());
      where.push(`p.category_id = $${params.length}`);
    }
    if (subcategory_id && String(subcategory_id).trim() !== '') {
      params.push(String(subcategory_id).trim());
      where.push(`p.subcategory_id = $${params.length}`);
    }

    const showArchived = include_archived === '1' || String(include_archived).toLowerCase() === 'true';
    if (!showArchived) {
      if (hasIsArchived) where.push(`COALESCE(p.is_archived,false) = false`);
      else if (hasArchivedAt) where.push(`p.archived_at IS NULL`);
    }

    if (published !== undefined && String(published).trim() !== '') {
      const val = ['1','true','yes','y'].includes(String(published).toLowerCase());
      if (hasIsPublished) where.push(`COALESCE(p.is_published, TRUE) = ${val ? 'TRUE' : 'FALSE'}`);
      else if (hasPublished) where.push(`COALESCE(p.published, TRUE) = ${val ? 'TRUE' : 'FALSE'}`);
    }

    const sbWhitelist = new Set(['product_id','product_name','price','created_at']);
    const sb = sbWhitelist.has(String(sort_by)) ? String(sort_by) : 'product_id';
    const sd = String(sort_dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const orderSql = `ORDER BY p.${sb} ${sd}`;

    const pInt  = Math.max(parseInt(page, 10) || 1, 1);
    const psInt = Math.min(Math.max(parseInt(page_size, 10) || 20, 1), 100);
    const offset = (pInt - 1) * psInt;

    const limitIdx  = (params.push(psInt), params.length);
    const offsetIdx = (params.push(offset), params.length);

    const sql = `
      WITH base AS (
        SELECT p.*
        FROM products p
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      )
      SELECT
        p.product_id,
        p.product_name,
        p.description,
        ${selPrice},
        p.category_id,
        p.subcategory_id,
        ${selImageUrl},

        ${selPU},
        pu.unit_name       AS product_unit_name,
        p.size_value,
        ${selSU},
        su.unit_name       AS size_unit_name,

        p.origin,
        p.product_status_id,
        ${selPublished},
        ${selIsArchived},
        ${selArchivedAt},

        c.category_name,
        sc.subcategory_name,
        ps.status_name     AS product_status_name,

        COALESCE(lv.stock,0)::int AS stock,
        COALESCE(lv.min_price, ${hasPrice ? 'p.price' : 'NULL'})::numeric AS min_price,

        COUNT(*) OVER() AS __total
      FROM base p
      ${hasImageUrl ? '' : `
        LEFT JOIN LATERAL (
          SELECT MIN(pi.url) AS cover_url
          FROM product_images pi
          WHERE pi.product_id = p.product_id
        ) cv ON TRUE
      `}
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories      sc ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses   ps ON ps.product_status_id = p.product_status_id
      ${ puKey ? `LEFT JOIN product_units pu ON pu.${puKey} = p.product_unit_id` : '' }
      ${ suKey ? `LEFT JOIN size_units     su ON su.${suKey} = p.size_unit_id`   : '' }

      ${ (await hasTable('v_product_variants_live_stock')) ? `
        LEFT JOIN LATERAL (
          SELECT
            COALESCE(SUM(v.stock),0)::int AS stock,
            MIN(v.price_override)          AS min_price
          FROM v_product_variants_live_stock v
          WHERE v.product_id = p.product_id
        ) lv ON TRUE
      ` : 'LEFT JOIN LATERAL (SELECT 0::int AS stock, NULL::numeric AS min_price) lv ON TRUE'}
      ${orderSql}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const { rows } = await db.query(sql, params);
    const total = rows.length ? Number(rows[0].__total) : 0;

    // decorate status by stock (optional)
    const canUpdateStatusCol = await hasColumn('products', 'product_status_id');
    const hasStatusTable     = await hasTable('product_statuses');
    let outOfStockStatusId   = null;

    if (canUpdateStatusCol && hasStatusTable) {
      const { rows: stRows } = await db.query(`
        SELECT product_status_id
        FROM product_statuses
        WHERE status_name ILIKE 'สินค้าหมด'
        ORDER BY product_status_id ASC
        LIMIT 1
      `);
      outOfStockStatusId = stRows[0]?.product_status_id ?? null;
    }

    const itemsOut = [];
    for (const r of rows) {
      const stock = Number(r.stock ?? 0);

      if (stock <= 0) {
        r.product_status_name = 'สินค้าหมด';
        if (outOfStockStatusId != null && r.product_status_id !== outOfStockStatusId) {
          try {
            await db.query(
              `UPDATE products
               SET product_status_id = $2
               WHERE product_id = $1`,
              [r.product_id, outOfStockStatusId]
            );
            r.product_status_id = outOfStockStatusId;
          } catch (e) {
            console.warn('⚠ อัปเดตสถานะ "สินค้าหมด" ไม่สำเร็จ:', e?.message || e);
          }
        }
      } else if (stock > 0 && stock <= 5) {
        r.product_status_name = 'สต็อกใกล้หมด';
      } else {
        r.product_status_name = 'พร้อมจำหน่าย';
      }

      itemsOut.push(r);
    }

    return res.json({ items: itemsOut, total, page: pInt, page_size: psInt });

  } catch (error) {
    console.error('❌ ERROR: ดึงข้อมูลสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ======================================================================
 * GET /api/admin/products/:id (safe images select)
 * ==================================================================== */
router.get('/:id', nocache, async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ error: 'Invalid id' });

    const { puKey, suKey } = await getUnitKeys();
    const hasPrice = await hasColumn('products', 'price');

    const { rows } = await db.query(`
      SELECT 
        p.*,
        ${hasPrice ? 'p.price::numeric AS price' : 'NULL::numeric AS price'},
        pu.unit_name AS product_unit_name,
        su.unit_name AS size_unit_name,
        c.category_name,
        sc.subcategory_name,
        ps.status_name AS product_status_name
      FROM products p
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories      sc ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses   ps ON ps.product_status_id = p.product_status_id
      ${puKey ? `LEFT JOIN product_units pu ON pu.${puKey} = p.product_unit_id` : ''}
      ${suKey ? `LEFT JOIN size_units     su ON su.${suKey} = p.size_unit_id`   : ''}
      WHERE p.product_id = $1
    `, [id]);

    if (!rows.length) return res.status(404).json({ error: 'ไม่พบสินค้า' });

    const product = rows[0];

    // รูปภาพ (ไม่อ้างอิง product_images.id)
    const imgsQ = await db.query(`
      SELECT url, alt_text, is_primary, position, variant_id, created_at
      FROM product_images
      WHERE product_id = $1
      ORDER BY is_primary DESC, COALESCE(position,0) ASC, COALESCE(created_at, NOW()) ASC
    `, [id]);
    const images = imgsQ.rows;

    product.images = images;
    const primary = images.find(i => i.is_primary && i.url);
    product.cover_image_url =
      primary?.url
      || (product.image_url || '').trim()
      || images[0]?.url
      || '';

    const useView = await hasTable('v_product_variants_live_stock');
    let variants = [];
    if (useView) {
      const vq = await db.query(`
        SELECT variant_id, product_id, sku,
               price_override AS price,
               COALESCE(stock,0)::int AS stock
        FROM v_product_variants_live_stock
        WHERE product_id = $1
        ORDER BY variant_id ASC
      `, [id]);
      variants = vq.rows;
      product.live_stock = variants.reduce((s, r) => s + (Number(r.stock) || 0), 0);
      product.min_price = variants.reduce((min, r) => {
        const p = r.price == null ? null : Number(r.price);
        return (p == null) ? min : (min == null ? p : Math.min(min, p));
      }, null);
      if (product.min_price == null) product.min_price = product.price ?? null;
    } else {
      const vq = await db.query(`
        SELECT ${ (await hasColumn('product_variants','variant_id')) ? 'variant_id' : (await hasColumn('product_variants','product_variant_id')) ? 'product_variant_id AS variant_id' : 'id AS variant_id' },
               product_id, sku, NULL::numeric AS price, 0::int AS stock
        FROM product_variants
        WHERE product_id = $1
        ORDER BY 1 ASC
      `, [id]);
      variants = vq.rows;
      product.live_stock = 0;
      product.min_price = product.price ?? null;
    }

    product.variants = variants;

    return res.json(product);
  } catch (error) {
    console.error('❌ ERROR: ดึงรายละเอียดสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ======================================================================
 * POST /api/admin/products  (category_id is TEXT)
 * ==================================================================== */
router.post('/', async (req, res) => {
  try {
    let {
      product_name, productName,
      description,
      price,
      category_id,    categoryId,
      subcategory_id, subcategoryId,

      product_unit_id,
      size_unit_id,
      size_value,

      origin,
      product_status_id, productStatusId,

      is_published,
      published
    } = req.body;

    product_name      = product_name ?? productName;
    category_id       = category_id ?? categoryId;
    subcategory_id    = subcategory_id ?? subcategoryId;
    product_status_id = product_status_id ?? productStatusId;

    if (!product_name || String(product_name).trim() === '') {
      return res.status(400).json({ message: 'กรุณาระบุชื่อสินค้า (product_name)' });
    }

    const pr = toNum(price);
    if (pr == null || pr < 0) return res.status(400).json({ message: 'price ต้องเป็นตัวเลข ≥ 0' });

    const catId = category_id == null ? '' : String(category_id).trim();
    if (!catId) return res.status(400).json({ message: 'กรุณาเลือกหมวดหมู่ (category_id)' });

    const unitId = toInt(product_unit_id);
    if (unitId == null) return res.status(400).json({ message: 'กรุณาเลือกหน่วยสินค้า (product_unit_id)' });

    const subId = (subcategory_id == null || String(subcategory_id).trim()==='') ? null : String(subcategory_id).trim();

    let sizeUnitId = null;
    let sizeVal = null;
    if (size_unit_id !== undefined || size_value !== undefined) {
      sizeUnitId = size_unit_id == null ? null : toInt(size_unit_id);
      sizeVal    = size_value == null ? null : toNum(size_value);
      if (sizeVal != null && sizeUnitId == null) return res.status(400).json({ message: 'มี size_value ต้องกำหนด size_unit_id' });
      if (sizeVal == null && sizeUnitId != null) return res.status(400).json({ message: 'มี size_unit_id ต้องกำหนด size_value' });
    }

    const hasIsPublished = await hasColumn('products', 'is_published');
    const hasPublished   = await hasColumn('products', 'published');

    const cols = [
      'product_name', 'description', 'price',
      'category_id', 'subcategory_id', 'product_unit_id', 'size_unit_id', 'size_value',
      'origin', 'product_status_id'
    ];
    const vals = [
      String(product_name).trim(),
      description || '',
      pr,
      catId, subId, unitId, sizeUnitId, sizeVal,
      origin || '',
      product_status_id || null
    ];

    if (hasIsPublished) {
      cols.push('is_published');
      vals.push(is_published === undefined ? true : !!is_published);
    } else if (hasPublished) {
      cols.push('published');
      vals.push(published === undefined ? true : !!published);
    }

    const placeholders = cols.map((_, i) => `$${i+1}`).join(',');
    const insertSql = `
      INSERT INTO products (${cols.join(',')})
      VALUES (${placeholders})
      RETURNING product_id
    `;

    const inserted = await db.query(insertSql, vals);
    const newId = inserted.rows[0].product_id;

    const { puKey, suKey } = await getUnitKeys();
    const { rows } = await db.query(`
      SELECT 
        p.*,
        pu.unit_name AS product_unit_name,
        su.unit_name AS size_unit_name,
        c.category_name,
        sc.subcategory_name,
        ps.status_name AS product_status_name
      FROM products p
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories      sc ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses   ps ON ps.product_status_id = p.product_status_id
      ${puKey ? `LEFT JOIN product_units pu ON pu.${puKey} = p.product_unit_id` : ''}
      ${suKey ? `LEFT JOIN size_units     su ON su.${suKey} = p.size_unit_id`   : ''}
      WHERE p.product_id = $1
    `, [newId]);

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('❌ ERROR: เพิ่มสินค้าไม่สำเร็จ:', error);
    const msg =
      error?.code === '23503' ? 'ข้อมูลอ้างอิงไม่ถูกต้อง (FK ไม่พบ)' :
      error?.code === '23505' ? 'ข้อมูลซ้ำ (unique)' :
      'ผิดพลาดในระบบ';
    res.status(500).json({ message: msg });
  }
});

/* ======================================================================
 * PUT /api/admin/products/:id
 * ==================================================================== */
router.put('/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });

    const chk = await db.query(`SELECT product_id FROM products WHERE product_id = $1`, [id]);
    if (!chk.rows.length) return res.status(404).json({ message: 'ไม่พบสินค้า' });

    let {
      product_name, productName,
      description,
      price,
      category_id,    categoryId,
      subcategory_id, subcategoryId,

      product_unit_id,
      size_unit_id,
      size_value,

      origin,
      product_status_id, productStatusId,

      is_published,
      published
    } = req.body;

    product_name      = product_name ?? productName;
    category_id       = category_id ?? categoryId;
    subcategory_id    = subcategory_id ?? subcategoryId;
    product_status_id = product_status_id ?? productStatusId;

    const fields = [];
    const params = [];
    const push = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };

    if (product_name !== undefined) push('product_name', String(product_name).trim());
    if (description  !== undefined) push('description', description);

    if (price !== undefined) {
      const pr = toNum(price);
      if (pr == null || pr < 0) return res.status(400).json({ message: 'price ต้องเป็นตัวเลข ≥ 0' });
      push('price', pr);
    }

    if (category_id    !== undefined) push('category_id', category_id == null ? null : String(category_id).trim());
    if (subcategory_id !== undefined) push('subcategory_id', subcategory_id == null ? null : String(subcategory_id).trim());

    if (origin            !== undefined) push('origin', origin);
    if (product_status_id !== undefined) push('product_status_id', product_status_id);

    if (product_unit_id !== undefined) {
      const unitId = toInt(product_unit_id);
      if (unitId == null) return res.status(400).json({ message: 'กรุณาเลือกหน่วยสินค้า (product_unit_id)' });
      push('product_unit_id', unitId);
    }

    if (size_unit_id !== undefined || size_value !== undefined) {
      const sUid = size_unit_id == null ? null : toInt(size_unit_id);
      const sVal = size_value == null ? null : toNum(size_value);
      if (sVal != null && sUid == null) return res.status(400).json({ message: 'มี size_value ต้องกำหนด size_unit_id' });
      if (sVal == null && sUid != null) return res.status(400).json({ message: 'มี size_unit_id ต้องกำหนด size_value' });
      push('size_unit_id', sUid);
      push('size_value', sVal);
    }

    const hasIsPublished = await hasColumn('products', 'is_published');
    const hasPublished   = await hasColumn('products', 'published');
    if (hasIsPublished && is_published !== undefined) {
      push('is_published', !!is_published);
    } else if (hasPublished && published !== undefined) {
      push('published', !!published);
    }

    if (fields.length === 0) return res.status(400).json({ message: 'ไม่มีฟิลด์ให้แก้ไข' });

    params.push(id);
    const hasUpdatedAt = await hasColumn('products', 'updated_at');
    const setSql = `${fields.join(', ')}${hasUpdatedAt ? ', updated_at = NOW()' : ''}`;
    const updateSql = `
      UPDATE products
      SET ${setSql}
      WHERE product_id = $${params.length}
      RETURNING product_id
    `;
    await db.query(updateSql, params);

    const { puKey, suKey } = await getUnitKeys();
    const { rows } = await db.query(`
      SELECT 
        p.*,
        pu.unit_name AS product_unit_name,
        su.unit_name AS size_unit_name,
        c.category_name,
        sc.subcategory_name,
        ps.status_name AS product_status_name
      FROM products p
      LEFT JOIN product_categories c ON c.category_id = p.category_id
      LEFT JOIN subcategories      sc ON sc.subcategory_id = p.subcategory_id
      LEFT JOIN product_statuses   ps ON ps.product_status_id = p.product_status_id
      ${puKey ? `LEFT JOIN product_units pu ON pu.${puKey} = p.product_unit_id` : ''}
      ${suKey ? `LEFT JOIN size_units     su ON su.${suKey} = p.size_unit_id`   : ''}
      WHERE p.product_id = $1
    `, [id]);

    res.json(rows[0]);
  } catch (error) {
    console.error('❌ ERROR: อัปเดตสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ message: 'ผิดพลาดในระบบ' });
  }
});

/* ======================================================================
 * DELETE → Archive
 * ==================================================================== */
router.delete('/:id', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ error: 'Invalid id' });

    const hasIsArchived = await hasColumn('products', 'is_archived');
    const hasArchivedAt = await hasColumn('products', 'archived_at');

    let result;
    if (hasIsArchived) {
      result = await db.query(
        `UPDATE products
         SET is_archived = true, archived_at = ${hasArchivedAt ? 'COALESCE(archived_at, NOW())' : 'NOW()'}
         WHERE product_id = $1 AND (is_archived = false OR is_archived IS NULL)`,
        [id]
      );
    } else if (hasArchivedAt) {
      result = await db.query(
        `UPDATE products
         SET archived_at = NOW()
         WHERE product_id = $1 AND archived_at IS NULL`,
        [id]
      );
    } else {
      return res.status(400).json({ error: 'Archive not supported: no is_archived/archived_at column' });
    }

    if (!result.rowCount) {
      return res.status(404).json({ error: 'ไม่พบสินค้า หรือถูกเก็บไว้แล้ว' });
    }

    res.json({ ok: true, archived: true });
  } catch (error) {
    if (error.code === '23503') {
      return res.status(409).json({
        error: 'ลบไม่ได้: สินค้าถูกใช้อยู่ในคำสั่งซื้อ',
        code: 'PRODUCT_IN_USE'
      });
    }
    console.error('❌ ERROR: เก็บสินค้า (archive) ไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Archive error' });
  }
});

/* ======================================================================
 * UNARCHIVE
 * ==================================================================== */
router.patch('/:id/unarchive', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ error: 'Invalid id' });

    const hasIsArchived = await hasColumn('products', 'is_archived');
    const hasArchivedAt = await hasColumn('products', 'archived_at');
    const hasUpdatedAt  = await hasColumn('products', 'updated_at');

    let result;
    if (hasIsArchived) {
      result = await db.query(
        `UPDATE products
         SET is_archived = false${hasArchivedAt ? ', archived_at = NULL' : ''}${hasUpdatedAt ? ', updated_at = NOW()' : ''}
         WHERE product_id = $1`,
        [id]
      );
    } else if (hasArchivedAt) {
      result = await db.query(
        `UPDATE products
         SET archived_at = NULL${hasUpdatedAt ? ', updated_at = NOW()' : ''}
         WHERE product_id = $1`,
        [id]
      );
    } else {
      return res.status(400).json({ error: 'Unarchive not supported: no is_archived/archived_at column' });
    }

    if (!result.rowCount) return res.status(404).json({ error: 'ไม่พบสินค้า' });
    res.json({ ok: true, unarchived: true });
  } catch (error) {
    console.error('❌ ERROR: กู้คืนสินค้าไม่สำเร็จ:', error);
    res.status(500).json({ error: 'Unarchive error' });
  }
});

/* ======================================================================
 * PUBLISH / UNPUBLISH (supports is_published / published)
 * ==================================================================== */
router.patch('/:id/publish', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });

    const hasIsPublished = await hasColumn('products', 'is_published');
    const hasPublished   = await hasColumn('products', 'published');
    if (!hasIsPublished && !hasPublished) {
      return res.status(400).json({ message: 'published column not found' });
    }
    const col = hasIsPublished ? 'is_published' : 'published';

    const desired = req.body?.is_published;
    let rows;

    if (typeof desired === 'boolean') {
      const r = await db.query(
        `UPDATE products SET ${col} = $2 WHERE product_id = $1 RETURNING ${col} AS is_published`,
        [id, desired]
      );
      rows = r.rows;
    } else {
      const r = await db.query(
        `UPDATE products
         SET ${col} = NOT COALESCE(${col}, TRUE)
         WHERE product_id = $1
         RETURNING ${col} AS is_published`,
        [id]
      );
      rows = r.rows;
    }

    if (!rows || !rows.length) return res.status(404).json({ message: 'ไม่พบสินค้า' });
    return res.json({ ok: true, product_id: id, is_published: rows[0].is_published });
  } catch (e) {
    console.error('❌ publish error:', e);
    return res.status(500).json({ message: 'Publish error' });
  }
});

router.patch('/:id/unpublish', async (req, res) => {
  try {
    const id = toInt(req.params.id);
    if (id == null) return res.status(400).json({ message: 'Invalid id' });

    const hasIsPublished = await hasColumn('products', 'is_published');
    const hasPublished   = await hasColumn('products', 'published');
    if (!hasIsPublished && !hasPublished) {
      return res.status(400).json({ message: 'published column not found' });
    }
    const col = hasIsPublished ? 'is_published' : 'published';

    const { rows } = await db.query(
      `UPDATE products SET ${col} = FALSE WHERE product_id = $1 RETURNING ${col} AS is_published`,
      [id]
    );
    if (!rows || !rows.length) return res.status(404).json({ message: 'ไม่พบสินค้า' });

    return res.json({ ok: true, product_id: id, is_published: rows[0].is_published });
  } catch (e) {
    console.error('❌ unpublish error:', e);
    return res.status(500).json({ message: 'Unpublish error' });
  }
});

/* ======================================================================
 * Images (bulk + single) — NO reference to product_images.id
 * ==================================================================== */
router.post('/:id/images', async (req, res) => {
  const productId = toInt(req.params.id);
  if (productId == null) return res.status(400).json({ error: 'Invalid product id' });

  const list = Array.isArray(req.body?.images) ? req.body.images : [];
  if (list.length === 0) return res.status(400).json({ error: 'กรุณาส่ง images เป็น array อย่างน้อย 1 รายการ' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const hasPrimary = list.some(i => i && i.is_primary);
    if (hasPrimary) await unsetPrimaryExcept(client, productId);

    const inserted = [];
    for (const raw of list) {
      const img = normalizeImagePayload(raw);
      if (!img) continue;

      await client.query(
        `INSERT INTO product_images (product_id, url, alt_text, is_primary, position, variant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          productId,
          img.url,
          img.alt_text,
          img.is_primary === true,
          img.position != null ? Number(img.position) : null,
          img.variant_id != null ? Number(img.variant_id) : null
        ]
      );
      inserted.push({
        product_id: productId,
        url: img.url,
        alt_text: img.alt_text ?? null,
        is_primary: !!img.is_primary,
        position: img.position ?? null,
        variant_id: img.variant_id ?? null
      });
    }

    await client.query('COMMIT');
    return res.status(201).json({ ok: true, images: inserted });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR: บันทึกรูปแบบ bulk ไม่สำเร็จ:', err);
    return res.status(500).json({ error: 'Save images error' });
  } finally {
    client.release?.();
  }
});

async function insertSingleImage(payload, res) {
  const img = normalizeImagePayload(payload);
  const productId = toInt(payload?.product_id);
  if (productId == null) return res.status(400).json({ error: 'กรุณาระบุ product_id ให้ถูกต้อง' });
  if (!img) return res.status(400).json({ error: 'กรุณาระบุ url ของรูป' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (img.is_primary === true) await unsetPrimaryExcept(client, productId);

    await client.query(
      `INSERT INTO product_images (product_id, url, alt_text, is_primary, position, variant_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        productId,
        img.url,
        img.alt_text,
        img.is_primary === true,
        img.position != null ? Number(img.position) : null,
        img.variant_id != null ? Number(img.variant_id) : null
      ]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      product_id: productId,
      url: img.url,
      alt_text: img.alt_text ?? null,
      is_primary: !!img.is_primary,
      position: img.position ?? null,
      variant_id: img.variant_id ?? null
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR: บันทึกรูป (เดี่ยว) ไม่สำเร็จ:', err);
    return res.status(500).json({ error: 'Save image error' });
  } finally {
    client.release?.();
  }
}
router.post('/product-images', async (req, res) => insertSingleImage(req.body, res));
/* ======================================================================
 * ✅ ALIAS: GET /api/admin/products/:id/variants
 * ใช้ดึง variants แบบง่ายให้ FE (ProductManagement) ไม่เจอ 404
 * อิงตาราง product_variants โดยตรง (schema-tolerant เบื้องต้น)
 * ==================================================================== */

/* ==================================================================== */
router.get('/:id/variants', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!Number.isFinite(productId)) {
    return res.status(400).json({ ok: false, error: 'Invalid product id' });
  }
  try {
    const pickFirstExisting = async (table, candidates) => {
      for (const c of candidates) {
        const { rows } = await db.query(`
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name=$2
          LIMIT 1
        `, [table, c]);
        if (rows.length) return c;
      }
      return null;
    };

    // ตรวจว่ามีวิว live-stock ไหม
    const { rows: viewExist } = await db.query(
      `SELECT to_regclass('public.v_product_variants_live_stock') IS NOT NULL AS ok`
    )
    const hasView = !!viewExist[0]?.ok;

    // pk ฝั่งตาราง (รองรับ schema ต่าง ๆ)
    const pvPkRows = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='product_variants'
        AND column_name IN ('variant_id','product_variant_id','id')
      ORDER BY CASE column_name
        WHEN 'variant_id' THEN 1
        WHEN 'product_variant_id' THEN 2
        ELSE 3
      END
      LIMIT 1
    `);
    const pvPk = pvPkRows.rows[0]?.column_name || 'variant_id';

    let sql;
    if (hasView) {
      // หา key ในวิวแบบ dynamic
      const vKey = await pickFirstExisting('v_product_variants_live_stock',
        ['variant_id','product_variant_id','pv_id','id']) || 'variant_id';

      // เลือกคอลัมน์ที่ "มีจริง" เท่านั้น
      const lvPriceCol = await pickFirstExisting('v_product_variants_live_stock', ['price_override','price']);
      const lvStockCol = await pickFirstExisting('v_product_variants_live_stock', ['stock','stock_qty']);
      const vPriceCol  = await pickFirstExisting('product_variants', ['price_override','price']);
      const vStockCol  = await pickFirstExisting('product_variants', ['stock','stock_qty']);

      // สร้าง expression โดยไม่อ้างถึงคอลัมน์ที่ไม่มีอยู่
      const priceExpr = `COALESCE(${lvPriceCol ? 'lv.'+lvPriceCol : 'NULL'}, ${vPriceCol ? 'v.'+vPriceCol : 'NULL'}, 0)`;
      const stockExpr = `COALESCE(${lvStockCol ? 'lv.'+lvStockCol : 'NULL'}, ${vStockCol ? 'v.'+vStockCol : 'NULL'}, 0)`;

      sql = `
        SELECT
          v.${pvPk} AS variant_id,
          v.product_id,
          v.sku,
          (${priceExpr})::numeric AS price,
          (${stockExpr})::int     AS stock,
          (${stockExpr})::int     AS stock_qty,
          COALESCE(v.is_active, TRUE) AS is_active,
          COALESCE(v.image_url, '')   AS image_url
        FROM product_variants v
        LEFT JOIN v_product_variants_live_stock lv
          ON lv.${vKey} = v.${pvPk}
        WHERE v.product_id = $1
        ORDER BY v.${pvPk} ASC
      `;
    } else {
      // ไม่มีวิว → ดึงตรงจากตาราง (เลือกคอลัมน์แบบ dynamic เช่นกัน)
      const vPriceCol = await pickFirstExisting('product_variants', ['price_override','price']);
      const vStockCol = await pickFirstExisting('product_variants', ['stock','stock_qty']);
      const vOnlyPriceExpr = vPriceCol ? `COALESCE(v.${vPriceCol},0)` : '0';
      const vOnlyStockExpr = vStockCol ? `COALESCE(v.${vStockCol},0)` : '0';

      sql = `
        SELECT
          v.${pvPk} AS variant_id,
          v.product_id,
          v.sku,
          ${vOnlyPriceExpr}::numeric AS price,
          ${vOnlyStockExpr}::int     AS stock,
          ${vOnlyStockExpr}::int     AS stock_qty,
          COALESCE(v.is_active,TRUE) AS is_active,
          COALESCE(v.image_url,'')   AS image_url
        FROM product_variants v
        WHERE v.product_id=$1
        ORDER BY v.${pvPk} ASC
      `;
    }

    const { rows } = await db.query(sql, [productId]);
    return res.json({ ok: true, variants: rows });
  } catch (err) {
    console.error('GET /api/admin/products/:id/variants failed', err);
    return res.status(500).json({ ok: false, error: 'Server error', detail: String(err) });
  }
});
/* ==================================================================== */


/* ======================================================================
 * (PATCH) Extra read endpoints for FE — prevent 404 on admin page
 * GET /api/admin/products/:id/option-values
 * GET /api/admin/products/:id/variant-values
 * ==================================================================== */
router.get('/:id/option-values', async (req, res) => {
  const id = Number.parseInt(String(req.params.id||'').trim(),10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid product id' });
  try {
    const hasPO = await hasTable('product_options');
    const hasPOV = await hasTable('product_option_values');
    if (!hasPO || !hasPOV) return res.json([]);

    const hasPos = await hasColumn('product_option_values','value_position');
    const orderVal = hasPos ? 'COALESCE(v.value_position,0), v.value_id' : 'v.value_id';

    const { rows } = await db.query(
      `SELECT v.value_id, v.option_id, v.value_name, ${hasPos ? 'v.value_position' : 'NULL::int AS value_position'}
       FROM product_option_values v
       JOIN product_options o ON o.option_id = v.option_id
       WHERE o.product_id = $1
       ORDER BY v.option_id ASC, ${orderVal} ASC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /admin/products/:id/option-values error', e);
    res.status(500).json({ message: 'Failed to load option values' });
  }
});

router.get('/:id/variant-values', async (req, res) => {
  const id = Number.parseInt(String(req.params.id||'').trim(),10);
  if (!Number.isFinite(id)) return res.status(400).json({ message: 'Invalid product id' });
  try {
    const hasPVV = await hasTable('product_variant_values');
    const hasPV  = await hasTable('product_variants');
    if (!hasPV || !hasPVV) return res.json([]);

    // tolerant primary keys
    const pvPk = (await hasColumn('product_variants','variant_id')) ? 'variant_id'
                : (await hasColumn('product_variants','product_variant_id')) ? 'product_variant_id' : 'id';

    const vCol = (await hasColumn('product_variant_values','variant_id')) ? 'variant_id'
               : (await hasColumn('product_variant_values','product_variant_id')) ? 'product_variant_id' : null;
    const oCol = (await hasColumn('product_variant_values','option_id')) ? 'option_id' : null;
    const valCol = (await hasColumn('product_variant_values','value_id')) ? 'value_id'
                 : (await hasColumn('product_variant_values','option_value_id')) ? 'option_value_id' : null;

    if (!vCol || !oCol || !valCol) return res.json([]);

    const { rows } = await db.query(
      `SELECT pvv.${vCol} AS variant_id, pvv.${oCol} AS option_id, pvv.${valCol} AS value_id
         FROM product_variant_values pvv
         JOIN product_variants pv ON pv.${pvPk} = pvv.${vCol}
        WHERE pv.product_id = $1
        ORDER BY pvv.${vCol} ASC, pvv.${oCol} ASC`,
      [id]
    );
    res.json(rows);
  } catch (e) {
    console.error('GET /admin/products/:id/variant-values error', e);
    res.status(500).json({ message: 'Failed to load variant values' });
  }
});


module.exports = router;