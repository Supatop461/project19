// backend/routes/variants.js
// หน้าที่:
// - READ/CRUD options & values (ทนสคีมาต่างกันเล็กน้อย; มี option_position/value_position ก็ใช้, ไม่มีก็ข้าม)
// - READ/CRUD variants + generate combos (ตรวจคอลัมน์ price/stock/image แบบไดนามิก)
// - resolve-variant สำหรับ PDP/Cart (กัน option/value ข้ามสินค้า + คืนรูปจาก variant เองถ้ามี, รองรับ view)
// - โหมดดีบัก: GET /api/variants/_ping

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const mustAdmin = [requireAuth, requireRole(['admin'])];
const isDev = process.env.NODE_ENV !== 'production';

/* -------------------- helpers -------------------- */
const toInt = (x) => Number.parseInt(x, 10);
const toIntArray = (arr) =>
  Array.isArray(arr) ? arr.map(n => Number(n)).filter(Number.isInteger) : null;

async function hasTable(table) {
  const { rows } = await db.query(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    [`public.${table}`]
  );
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

// ✅ helper ใหม่: เช็คว่ามี VIEW ไหม
async function hasView(viewName) {
  const { rows } = await db.query(`
    SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `, [viewName]);
  return rows.length > 0;
}

async function getClient() {
  if (typeof db.getClient === 'function') return db.getClient();
  if (db.pool?.connect) return db.pool.connect();
  if (db._pool?.connect) return db._pool.connect();
  return { query: (...a) => db.query(...a), release: () => {} };
}

// แยกชื่อคอลัมน์สำคัญใน product_variants ตามที่มีจริงในสคีมา
// - stock: stock_qty | stock | null
// - price: price_override | price | null
// - active: is_active | null
// - image: image_url | null
async function pickVariantCols() {
  const stockCol = (await hasColumn('product_variants', 'stock_qty'))
    ? 'stock_qty'
    : (await hasColumn('product_variants', 'stock'))
      ? 'stock'
      : null;

  const priceCol = (await hasColumn('product_variants', 'price_override'))
    ? 'price_override'
    : (await hasColumn('product_variants', 'price'))
      ? 'price'
      : null;

  const activeCol = (await hasColumn('product_variants', 'is_active')) ? 'is_active' : null;
  const imageCol  = (await hasColumn('product_variants', 'image_url')) ? 'image_url' : null;

  return { stockCol, priceCol, activeCol, imageCol };
}

/* -------------------- debug -------------------- */
router.get('/_ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

/* =========================================================
 * OPTIONS & VALUES (READ)
 * GET /api/variants/products/:product_id/options
 * ========================================================= */
router.get('/products/:product_id/options', async (req, res) => {
  try {
    const productId = toInt(req.params.product_id);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ message: 'Invalid product_id' });
    }

    const hasPO  = await hasTable('product_options');
    const hasPOV = await hasTable('product_option_values');
    if (!hasPO || !hasPOV) return res.json([]);

    const hasOptionPos = await hasColumn('product_options', 'option_position');
    const hasValuePos  = await hasColumn('product_option_values', 'value_position');

    const orderOpt = hasOptionPos ? 'o.option_position' : 'o.option_id';
    const orderVal = hasValuePos  ? 'v.value_position'  : 'v.value_id';

    const { rows } = await db.query(`
      SELECT
        o.option_id,
        o.option_name,
        ${hasOptionPos ? 'o.option_position' : 'NULL::int AS option_position'},
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'value_id', v.value_id,
              'value_name', v.value_name,
              'value_position', ${hasValuePos ? 'v.value_position' : 'NULL'}
            )
            ORDER BY ${orderVal}
          ) FILTER (WHERE v.value_id IS NOT NULL),
          '[]'
        ) AS values
      FROM product_options o
      LEFT JOIN product_option_values v ON v.option_id = o.option_id
      WHERE o.product_id = $1
      GROUP BY o.option_id
      ORDER BY ${orderOpt} ASC
    `, [productId]);

    res.json(rows);
  } catch (err) {
    console.error('GET /products/:product_id/options error:', err);
    res.status(500).json({
      message: 'Failed to get options',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

/* =========================================================
 * OPTIONS & VALUES (WRITE) — admin only
 * ========================================================= */
// POST /api/variants/products/:product_id/options
router.post('/products/:product_id/options', ...mustAdmin, async (req, res) => {
  try {
    const productId = toInt(req.params.product_id);
    const { option_name = null, option_position = 1 } = req.body || {};
    if (!Number.isInteger(productId)) return res.status(400).json({ message: 'Invalid product_id' });

    const exist = await db.query('SELECT 1 FROM products WHERE product_id=$1 LIMIT 1', [productId]);
    if (!exist.rows.length) return res.status(404).json({ message: 'Product not found' });

    const name = (option_name && String(option_name).trim()) || 'ข้อมูลอื่นๆ';
    const hasOptionPos = await hasColumn('product_options', 'option_position');

    let row;
    if (hasOptionPos) {
      const r = await db.query(`
        INSERT INTO product_options (product_id, option_name, option_position)
        VALUES ($1,$2,$3)
        RETURNING option_id, option_name, option_position
      `, [productId, name, Number(option_position) || 1]);
      row = r.rows[0];
    } else {
      const r = await db.query(`
        INSERT INTO product_options (product_id, option_name)
        VALUES ($1,$2)
        RETURNING option_id, option_name
      `, [productId, name]);
      row = { ...r.rows[0], option_position: null };
    }
    res.status(201).json(row);
  } catch (err) {
    console.error('POST option error:', err);
    if (err.code === '23505') {
      return res.status(409).json({
        message: 'Option name already exists',
        ...(isDev ? { details: err.detail } : {})
      });
    }
    res.status(400).json({
      message: 'Failed to create option',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

// PUT /api/variants/options/:option_id
router.put('/options/:option_id', ...mustAdmin, async (req, res) => {
  try {
    const optionId = toInt(req.params.option_id);
    const { option_name = null, option_position = null } = req.body || {};
    const hasOptionPos = await hasColumn('product_options', 'option_position');

    let r;
    if (hasOptionPos) {
      r = await db.query(`
        UPDATE product_options
           SET option_name = COALESCE($1, option_name),
               option_position = COALESCE($2, option_position)
         WHERE option_id = $3
         RETURNING option_id, option_name, option_position
      `, [option_name, option_position, optionId]);
    } else {
      r = await db.query(`
        UPDATE product_options
           SET option_name = COALESCE($1, option_name)
         WHERE option_id = $2
         RETURNING option_id, option_name, NULL::int AS option_position
      `, [option_name, optionId]);
    }
    if (!r.rows[0]) return res.status(404).json({ message: 'Option not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PUT option error:', err);
    res.status(400).json({
      message: 'Failed to update option',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

// DELETE /api/variants/options/:option_id
router.delete('/options/:option_id', ...mustAdmin, async (req, res) => {
  try {
    const optionId = toInt(req.params.option_id);
    const { rowCount } = await db.query(`DELETE FROM product_options WHERE option_id=$1`, [optionId]);
    if (!rowCount) return res.status(404).json({ message: 'Option not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE option error:', err);
    res.status(400).json({
      message: 'Failed to delete option',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

// POST /api/variants/options/:option_id/values
router.post('/options/:option_id/values', ...mustAdmin, async (req, res) => {
  try {
    const optionId = toInt(req.params.option_id);
    const { value_name, value_position = 1 } = req.body || {};
    const name = (value_name && String(value_name).trim()) || null;
    if (!name) return res.status(400).json({ message: 'value_name required' });

    const hasValuePos = await hasColumn('product_option_values', 'value_position');

    let row;
    if (hasValuePos) {
      const r = await db.query(`
        INSERT INTO product_option_values (option_id, value_name, value_position)
        VALUES ($1,$2,$3)
        RETURNING value_id, value_name, value_position
      `, [optionId, name, Number(value_position) || 1]);
      row = r.rows[0];
    } else {
      const r = await db.query(`
        INSERT INTO product_option_values (option_id, value_name)
        VALUES ($1,$2)
        RETURNING value_id, value_name
      `, [optionId, name]);
      row = { ...r.rows[0], value_position: null };
    }
    res.status(201).json(row);
  } catch (err) {
    console.error('POST value error:', err);
    res.status(400).json({
      message: 'Failed to create value',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

// PUT /api/variants/values/:value_id
router.put('/values/:value_id', ...mustAdmin, async (req, res) => {
  try {
    const valueId = toInt(req.params.value_id);
    const { value_name = null, value_position = null } = req.body || {};
    const hasValuePos = await hasColumn('product_option_values', 'value_position');

    let r;
    if (hasValuePos) {
      r = await db.query(`
        UPDATE product_option_values
           SET value_name = COALESCE($1, value_name),
               value_position = COALESCE($2, value_position)
         WHERE value_id = $3
         RETURNING value_id, value_name, value_position
      `, [value_name, value_position, valueId]);
    } else {
      r = await db.query(`
        UPDATE product_option_values
           SET value_name = COALESCE($1, value_name)
         WHERE value_id = $2
         RETURNING value_id, value_name, NULL::int AS value_position
      `, [value_name, valueId]);
    }
    if (!r.rows[0]) return res.status(404).json({ message: 'Value not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PUT value error:', err);
    res.status(400).json({
      message: 'Failed to update value',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

// DELETE /api/variants/values/:value_id
router.delete('/values/:value_id', ...mustAdmin, async (req, res) => {
  try {
    const valueId = toInt(req.params.value_id);
    const { rowCount } = await db.query(`DELETE FROM product_option_values WHERE value_id=$1`, [valueId]);
    if (!rowCount) return res.status(404).json({ message: 'Value not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE value error:', err);
    res.status(400).json({
      message: 'Failed to delete value',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

/* =========================================================
 * VARIANTS (READ) — ใช้ VIEW live stock เป็นทางหลัก
 * GET /api/variants/product/:id?active=1
 * ========================================================= */
router.get('/product/:id', async (req, res) => {
  try {
    const productId = toInt(req.params.id);
    if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product id' });
    const onlyActive = String(req.query.active ?? '1') === '1';

    // (1) ถ้ามี VIEW live stock → ใช้โดยตรง
    if (await hasView('v_product_variants_live_stock')) {
      const { rows } = await db.query(`
        SELECT
          lv.variant_id,
          lv.product_id,
          lv.sku,
          COALESCE(lv.price_override, p.cost_price) AS final_price,
          lv.stock::int                         AS stock,
          COALESCE(lv.is_active, TRUE)          AS is_active,
          lv.image_url,
          NULL::text                            AS fingerprint,
          COALESCE(
            json_agg(
              json_build_object('option_id', pvv.option_id, 'value_id', pvv.value_id)
              ORDER BY pvv.option_id
            ) FILTER (WHERE pvv.option_id IS NOT NULL),
            '[]'
          ) AS combo
        FROM v_product_variants_live_stock lv
        JOIN products p ON p.product_id = lv.product_id
        LEFT JOIN product_variant_values pvv ON pvv.variant_id = lv.variant_id
        WHERE lv.product_id = $1
          ${onlyActive ? 'AND COALESCE(lv.is_active, TRUE) = TRUE' : ''}
        GROUP BY lv.variant_id, lv.product_id, lv.sku, lv.price_override, lv.stock, lv.is_active, lv.image_url, p.cost_price
        ORDER BY lv.variant_id ASC
      `, [productId]);
      return res.json(rows);
    }

    // (2) รองรับ v_product_variants_expanded ถ้ามี
    if (await hasView('v_product_variants_expanded')) {
      const hasImg = await hasColumn('product_variants', 'image_url');
      const { rows } = await db.query(`
        SELECT ve.variant_id, ve.product_id, ve.sku, ve.final_price, ve.stock, ve.fingerprint, ve.is_active, ve.combo,
               ${hasImg ? 'pv.image_url' : 'NULL'} AS image_url
        FROM v_product_variants_expanded ve
        ${hasImg ? 'LEFT JOIN product_variants pv ON pv.variant_id = ve.variant_id' : ''}
        WHERE ve.product_id = $1
          ${onlyActive ? 'AND ve.is_active = TRUE' : ''}
        ORDER BY ve.variant_id ASC
      `, [productId]);
      return res.json(rows);
    }

    // (3) fallback: ตารางจริง
    const { stockCol, priceCol, imageCol } = await pickVariantCols();
    const stockExpr = stockCol ? `v.${stockCol}` : `0`;
    const priceExpr = priceCol ? `v.${priceCol}` : `p.cost_price`;

    const { rows } = await db.query(`
      SELECT
        v.variant_id,
        v.product_id,
        v.sku,
        COALESCE(${priceExpr}, p.cost_price) AS final_price,
        ${stockExpr}::int AS stock,
        v.is_active,
        ${imageCol ? `v.${imageCol}` : 'NULL'} AS image_url,
        NULL::text AS fingerprint,
        COALESCE(json_agg(json_build_object(
          'option_id', pvv.option_id,
          'value_id', pvv.value_id
        ) ORDER BY pvv.option_id)
          FILTER (WHERE pvv.option_id IS NOT NULL), '[]') AS combo
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN product_variant_values pvv ON pvv.variant_id = v.variant_id
      WHERE v.product_id = $1
        ${onlyActive ? 'AND COALESCE(v.is_active, TRUE) = TRUE' : ''}
      GROUP BY v.variant_id, v.product_id, v.sku, ${priceExpr}, p.cost_price, ${stockExpr}, v.is_active ${imageCol ? `, v.${imageCol}` : ''}
      ORDER BY v.variant_id ASC
    `, [productId]);

    res.json(rows);
  } catch (err) {
    console.error('GET /variants/product/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
});

/* =========================================================
 * VARIANTS (WRITE) — admin only
 * ========================================================= */
// POST /api/variants/products/:product_id/variants
router.post('/products/:product_id/variants', ...mustAdmin, async (req, res) => {
  const productId = toInt(req.params.product_id);
  const { sku, price = 0, stock_qty = 0, is_active = true, image_url = null, option_values = [] } = req.body || {};
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const exist = await client.query('SELECT 1 FROM products WHERE product_id=$1 LIMIT 1', [productId]);
    if (!exist.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Product not found' });
    }

    const { stockCol, priceCol, activeCol, imageCol } = await pickVariantCols();

    const cols = ['product_id', 'sku'];
    const vals = [productId, (sku || '').trim()];
    if (priceCol)  { cols.push(priceCol);  vals.push(Math.max(0, Number(price) || 0)); }
    if (stockCol)  { cols.push(stockCol);  vals.push(Math.max(0, Number(stock_qty) || 0)); }
    if (activeCol) { cols.push(activeCol); vals.push(!!is_active); }
    if (imageCol)  { cols.push(imageCol);  vals.push(image_url || null); }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const returning = `
      RETURNING variant_id, product_id, sku,
        ${priceCol ? `${priceCol} AS price` : 'NULL::numeric AS price'},
        ${stockCol ? `${stockCol} AS stock_qty` : 'NULL::int AS stock_qty'},
        ${activeCol ? `${activeCol} AS is_active` : 'TRUE AS is_active'},
        ${imageCol ? `${imageCol} AS image_url` : 'NULL AS image_url'}
    `;

    const ins = await client.query(
      `INSERT INTO product_variants (${cols.join(', ')}) VALUES (${placeholders}) ${returning}`,
      vals
    );
    const variant = ins.rows[0];

    // bind option/value
    if (Array.isArray(option_values)) {
      for (const ov of option_values) {
        await client.query(
          `INSERT INTO product_variant_values (variant_id, option_id, value_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (variant_id, option_id) DO UPDATE SET value_id = EXCLUDED.value_id`,
          [variant.variant_id, Number(ov.option_id), Number(ov.value_id)]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(variant);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST variant error:', err);
    res.status(400).json({
      message: 'Failed to create variant',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  } finally {
    client.release?.();
  }
});

// PUT /api/variants/:variant_id
router.put('/:variant_id', ...mustAdmin, async (req, res) => {
  const variantId = toInt(req.params.variant_id);
  const { sku, price, stock_qty, is_active, image_url, option_values } = req.body || {};
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { stockCol, priceCol, activeCol, imageCol } = await pickVariantCols();
    const sets = [];
    const vals = [];
    let i = 1;

    if (sku !== undefined)                   { sets.push(`sku = COALESCE($${i++}, sku)`);              vals.push(sku); }
    if (priceCol && price !== undefined)     { sets.push(`${priceCol} = COALESCE($${i++}, ${priceCol})`); vals.push(Math.max(0, Number(price) || 0)); }
    if (stockCol && stock_qty !== undefined) { sets.push(`${stockCol} = COALESCE($${i++}, ${stockCol})`); vals.push(Math.max(0, Number(stock_qty) || 0)); }
    if (activeCol && is_active !== undefined){ sets.push(`${activeCol} = COALESCE($${i++}, ${activeCol})`); vals.push(!!is_active); }
    if (imageCol && image_url !== undefined) { sets.push(`${imageCol} = COALESCE($${i++}, ${imageCol})`); vals.push(image_url || null); }

    if (!sets.length) sets.push('sku = sku'); // no-op

    vals.push(variantId);
    const r = await client.query(`
      UPDATE product_variants
         SET ${sets.join(', ')}
       WHERE variant_id = $${i}
       RETURNING variant_id, product_id, sku,
         ${priceCol ? `${priceCol} AS price` : 'NULL::numeric AS price'},
         ${stockCol ? `${stockCol} AS stock_qty` : 'NULL::int AS stock_qty'},
         ${activeCol ? `${activeCol} AS is_active` : 'TRUE AS is_active'},
         ${imageCol ? `${imageCol} AS image_url` : 'NULL AS image_url'}
    `, vals);

    if (!r.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Variant not found' });
    }

    if (Array.isArray(option_values)) {
      for (const ov of option_values) {
        await client.query(
          `INSERT INTO product_variant_values (variant_id, option_id, value_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (variant_id, option_id) DO UPDATE SET value_id = EXCLUDED.value_id`,
          [variantId, Number(ov.option_id), Number(ov.value_id)]
        );
      }
    }

    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT variant error:', err);
    res.status(400).json({
      message: 'Failed to update variant',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  } finally {
    client.release?.();
  }
});

// DELETE /api/variants/:variant_id
router.delete('/:variant_id', ...mustAdmin, async (req, res) => {
  try {
    const variantId = toInt(req.params.variant_id);
    const { rowCount } = await db.query(`DELETE FROM product_variants WHERE variant_id=$1`, [variantId]);
    if (!rowCount) return res.status(404).json({ message: 'Variant not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE variant error:', err);
    res.status(400).json({
      message: 'Failed to delete variant',
      ...(isDev ? { details: err.message, code: err.code } : {})
    });
  }
});

/* =========================================================
 * RESOLVE VARIANT (PDP/Cart) — ใช้ VIEW live stock
 * POST /api/variants/products/:id/resolve-variant
 * body: { optionIds:[...], valueIds:[...] }
 * ========================================================= */
router.post('/products/:id/resolve-variant', async (req, res) => {
  try {
    const productId = toInt(req.params.id);
    if (!Number.isInteger(productId)) return res.status(400).json({ error: 'bad params: productId' });

    let { optionIds = [], valueIds = [] } = req.body || {};
    optionIds = toIntArray(optionIds);
    valueIds  = toIntArray(valueIds);
    if (!optionIds || !valueIds || optionIds.length !== valueIds.length) {
      return res.status(400).json({ error: 'bad params: optionIds/valueIds' });
    }

    const hasImgView = await hasView('v_variant_images');

    // (A) ไม่มีตัวเลือก → คืนตัวแรกที่ active (อ่าน stock/price/image จาก VIEW)
    if (optionIds.length === 0) {
      const sqlDefault = `
        SELECT
          lv.variant_id,
          lv.sku,
          COALESCE(lv.price_override, p.cost_price) AS price,
          ${hasImgView ? 'COALESCE(lv.image_url, img.display_url, p.image_url)' : 'COALESCE(lv.image_url, p.image_url)'} AS image,
          lv.stock::int AS stock_qty
        FROM v_product_variants_live_stock lv
        JOIN products p ON p.product_id = lv.product_id
        ${hasImgView ? 'LEFT JOIN v_variant_images img ON img.variant_id = lv.variant_id' : ''}
        WHERE lv.product_id = $1 AND COALESCE(lv.is_active, TRUE) = TRUE
        ORDER BY lv.variant_id ASC
        LIMIT 1
      `;
      const r0 = await db.query(sqlDefault, [productId]);
      if (!r0.rows.length) return res.status(404).json({ error: 'variant not found' });
      return res.json(r0.rows[0]);
    }

    // (B) มีตัวเลือก → แมตช์เต็มชุด + อ่านข้อมูลสุดท้ายจาก VIEW
    const sql = `
      WITH chosen AS (
        SELECT DISTINCT x.option_id::int AS option_id, x.value_id::int AS value_id
        FROM unnest($2::int[], $3::int[]) AS x(option_id, value_id)
      ),
      valid_pairs AS (
        SELECT c.option_id, c.value_id
        FROM chosen c
        JOIN product_options o       ON o.option_id = c.option_id AND o.product_id = $1
        JOIN product_option_values v ON v.value_id  = c.value_id  AND v.option_id = o.option_id
      )
      SELECT
        pv.variant_id,
        pv.sku,
        COALESCE(lv.price_override, p.cost_price) AS price,
        ${hasImgView ? 'COALESCE(lv.image_url, img.display_url, p.image_url)' : 'COALESCE(lv.image_url, p.image_url)'} AS image,
        lv.stock::int AS stock_qty
      FROM product_variants pv
      JOIN products p ON p.product_id = pv.product_id
      JOIN v_product_variants_live_stock lv ON lv.variant_id = pv.variant_id
      JOIN product_variant_values pvv ON pvv.variant_id = pv.variant_id
      JOIN valid_pairs vp ON vp.option_id = pvv.option_id AND vp.value_id = pvv.value_id
      ${hasImgView ? 'LEFT JOIN v_variant_images img ON img.variant_id = pv.variant_id' : ''}
      WHERE pv.product_id = $1 AND COALESCE(lv.is_active, TRUE) = TRUE
      GROUP BY pv.variant_id, pv.sku, p.cost_price, lv.price_override, lv.image_url, lv.stock ${hasImgView ? ', img.display_url' : ''}, p.image_url
      HAVING COUNT(*) = (SELECT COUNT(*) FROM valid_pairs)
      LIMIT 1;
    `;
    const { rows } = await db.query(sql, [productId, optionIds, valueIds]);
    if (!rows.length) return res.status(404).json({ error: 'variant not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('resolve-variant error', err);
    res.status(500).json({ error: 'server error' });
  }
});

module.exports = router;

/* -------------------- Manual test (แนะนำ) --------------------
1) GET /api/variants/product/23?active=1
   - ดูว่าฟิลด์ stock มาจาก VIEW (เช็คกับ SELECT * FROM v_product_variants_live_stock WHERE product_id=23)

2) POST /api/variants/products/23/resolve-variant
   body: { "optionIds": [], "valueIds": [] }
   - stock_qty ต้องตรงกับ VIEW เช่นกัน

3) ทำ movement (IN/OUT) แล้วเรียก 1) และ 2) ซ้ำ → ตัวเลขต้องขยับทันที
---------------------------------------------------------------- */
