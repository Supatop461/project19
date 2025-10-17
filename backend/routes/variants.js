// backend/routes/variants.js
// หน้าที่:
// - READ/CRUD options & values (ทนสคีมาต่างกันเล็กน้อย; มี option_position/value_position ก็ใช้, ไม่มีก็ข้าม)
// - READ/CRUD variants + generate combos (ตรวจคอลัมน์ price/stock/image แบบไดนามิก)
// - resolve-variant สำหรับ PDP/Cart (กัน option/value ข้ามสินค้า + คืนรูปจาก variant เองถ้ามี, รองรับ view)
// - โหมดเร็ว upsert-single (รองรับทั้งแบบ body {product_id, options:[{name,value}]} และ path :id + details)
// - โหมดดีบัก: GET /api/variants/_ping

const express = require('express');
const router = express.Router();

// ✅ db: รองรับทั้ง ../db และ ../db/db
let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

// ✅ auth: ถ้าไม่มี middleware/auth ให้ fallback no-op (กันแครช)
const { requireAuth, requireRole } = (() => {
  try {
    return require('../middleware/auth');
  } catch {
    return {
      requireAuth: (_req, _res, next) => next(),
      requireRole: () => (_req, _res, next) => next(),
    };
  }
})();

const mustAdmin = [requireAuth, requireRole(['admin'])];
const isDev = process.env.NODE_ENV !== 'production';

/* -------------------- helpers -------------------- */
const toInt = (x) => Number.parseInt(x, 10);
const toIntArray = (arr) =>
  Array.isArray(arr) ? arr.map((n) => Number(n)).filter(Number.isInteger) : null;

async function hasTable(table) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return !!rows[0]?.ok;
}

async function hasColumn(table, col) {
  const { rows } = await db.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name=$2
    LIMIT 1
  `,
    [table, col]
  );
  return rows.length > 0;
}

// ✅ helper: VIEW ?
async function hasView(viewName) {
  const { rows } = await db.query(
    `
    SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name=$1
    LIMIT 1
  `,
    [viewName]
  );
  return rows.length > 0;
}

async function getClient() {
  if (typeof db.getClient === 'function') return db.getClient();
  if (db.pool?.connect) return db.pool.connect();
  if (db._pool?.connect) return db._pool.connect();
  return { query: (...a) => db.query(...a), release: () => {} };
}

// เลือกคอลัมน์สำคัญใน product_variants ตามสคีมาที่มีจริง
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
  const imageCol = (await hasColumn('product_variants', 'image_url')) ? 'image_url' : null;

  return { stockCol, priceCol, activeCol, imageCol };
}

// ✅ เลือก base price ของ "สินค้าแม่" จากคอลัมน์ที่มีจริง (เรียงลำดับความสำคัญ)
async function pickProductBasePriceParts() {
  const parts = [];
  if (await hasColumn('products', 'cost_price')) parts.push('p.cost_price');
  if (await hasColumn('products', 'price')) parts.push('p.price');
  if (await hasColumn('products', 'selling_price')) parts.push('p.selling_price');

  if (!parts.length) return { expr: 'NULL', groupBy: null };
  if (parts.length === 1) return { expr: parts[0], groupBy: parts[0] };
  const expr = `COALESCE(${parts.join(', ')})`;
  return { expr, groupBy: parts.join(', ') };
}

/* -------------------- debug -------------------- */
router.get('/_ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));


/* =========================================================
 * OPTIONS & VALUES (READ)
 * GET /api/variants/products/:product_id/options          (alias)
 * GET /api/products/:product_id/options                   (base)
 * ========================================================= */
router.get(['/products/:product_id/options','/variants/products/:product_id/options'], async (req, res) => {
  try {
    const productId = toInt(req.params.product_id);
    if (!Number.isInteger(productId)) {
      return res.status(400).json({ message: 'Invalid product_id' });
    }

    const hasPO = await hasTable('product_options');
    const hasPOV = await hasTable('product_option_values');
    if (!hasPO || !hasPOV) return res.json([]);

    const hasOptionPos = await hasColumn('product_options', 'option_position');
    const hasValuePos = await hasColumn('product_option_values', 'value_position');

    const orderOpt = hasOptionPos ? 'o.option_position' : 'o.option_id';
    const orderVal = hasValuePos ? 'v.value_position' : 'v.value_id';

    const { rows } = await db.query(
      `
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
    `,
      [productId]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /products/:product_id/options error:', err);
    res.status(500).json({
      message: 'Failed to get options',
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

/* =========================================================
 * OPTION VALUES (flat list) for a product
 * GET /api/variants/products/:product_id/option-values    (alias)
 * GET /api/products/:product_id/option-values             (base)
 * ========================================================= */
router.get(['/products/:product_id/option-values','/variants/products/:product_id/option-values'], async (req, res) => {
  try {
    const productId = toInt(req.params.product_id);
    if (!Number.isInteger(productId)) return res.status(400).json({ message: 'Invalid product_id' });

    const hasPO = await hasTable('product_options');
    const hasPOV = await hasTable('product_option_values');
    if (!hasPO || !hasPOV) return res.json([]);

    const hasValuePos = await hasColumn('product_option_values', 'value_position');

    const { rows } = await db.query(
      `
      SELECT v.value_id, v.option_id, v.value_name, ${hasValuePos ? 'v.value_position' : 'NULL::int AS value_position'}
      FROM product_option_values v
      JOIN product_options o ON o.option_id = v.option_id
      WHERE o.product_id = $1
      ORDER BY v.option_id ASC, ${hasValuePos ? 'COALESCE(v.value_position,0), v.value_id' : 'v.value_id'} ASC
      `,
      [productId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET option-values(flat) error:', err);
    res.status(500).json({ message: 'Failed to get option values' });
  }
});

/* =========================================================
 * VARIANT VALUES (mapping variant_id -> option_id/value_id)
 * GET /api/variants/products/:product_id/variant-values   (alias)
 * GET /api/products/:product_id/variant-values            (base)
 * ========================================================= */
router.get(['/products/:product_id/variant-values','/variants/products/:product_id/variant-values'], async (req, res) => {
  try {
    const productId = toInt(req.params.product_id);
    if (!Number.isInteger(productId)) return res.status(400).json({ message: 'Invalid product_id' });

    const hasPVV = await hasTable('product_variant_values');
    const hasPV = await hasTable('product_variants');
    if (!hasPV || !hasPVV) return res.json([]);

    const { rows } = await db.query(
      `
      SELECT pvv.variant_id, pvv.option_id, pvv.value_id
      FROM product_variant_values pvv
      JOIN product_variants pv ON pv.variant_id = pvv.variant_id
      WHERE pv.product_id = $1
      ORDER BY pvv.variant_id ASC, pvv.option_id ASC
      `,
      [productId]
    );
    res.json(rows);
  } catch (err) {
    console.error('GET variant-values mapping error:', err);
    res.status(500).json({ message: 'Failed to get variant values' });
  }
});
/* =========================================================
 * OPTIONS & VALUES (WRITE) — admin only
 * ========================================================= */
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
      const r = await db.query(
        `
        INSERT INTO product_options (product_id, option_name, option_position)
        VALUES ($1,$2,$3)
        RETURNING option_id, option_name, option_position
      `,
        [productId, name, Number(option_position) || 1]
      );
      row = r.rows[0];
    } else {
      const r = await db.query(
        `
        INSERT INTO product_options (product_id, option_name)
        VALUES ($1,$2)
        RETURNING option_id, option_name
      `,
        [productId, name]
      );
      row = { ...r.rows[0], option_position: null };
    }
    res.status(201).json(row);
  } catch (err) {
    console.error('POST option error:', err);
    if (err.code === '23505') {
      return res.status(409).json({
        message: 'Option name already exists',
        ...(isDev ? { details: err.detail } : {}),
      });
    }
    res.status(400).json({
      message: 'Failed to create option',
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

router.put('/options/:option_id', ...mustAdmin, async (req, res) => {
  try {
    const optionId = toInt(req.params.option_id);
    const { option_name = null, option_position = null } = req.body || {};
    const hasOptionPos = await hasColumn('product_options', 'option_position');

    let r;
    if (hasOptionPos) {
      r = await db.query(
        `
        UPDATE product_options
           SET option_name = COALESCE($1, option_name),
               option_position = COALESCE($2, option_position)
         WHERE option_id = $3
         RETURNING option_id, option_name, option_position
      `,
        [option_name, option_position, optionId]
      );
    } else {
      r = await db.query(
        `
        UPDATE product_options
           SET option_name = COALESCE($1, option_name)
         WHERE option_id = $2
         RETURNING option_id, option_name, NULL::int AS option_position
      `,
        [option_name, optionId]
      );
    }
    if (!r.rows[0]) return res.status(404).json({ message: 'Option not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PUT option error:', err);
    res.status(400).json({
      message: 'Failed to update option',
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

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
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

router.post('/options/:option_id/values', ...mustAdmin, async (req, res) => {
  try {
    const optionId = toInt(req.params.option_id);
    const { value_name, value_position = 1 } = req.body || {};
    const name = (value_name && String(value_name).trim()) || null;
    if (!name) return res.status(400).json({ message: 'value_name required' });

    const hasValuePos = await hasColumn('product_option_values', 'value_position');

    let row;
    if (hasValuePos) {
      const r = await db.query(
        `
        INSERT INTO product_option_values (option_id, value_name, value_position)
        VALUES ($1,$2,$3)
        RETURNING value_id, value_name, value_position
      `,
        [optionId, name, Number(value_position) || 1]
      );
      row = r.rows[0];
    } else {
      const r = await db.query(
        `
        INSERT INTO product_option_values (option_id, value_name)
        VALUES ($1,$2)
        RETURNING value_id, value_name
      `,
        [optionId, name]
      );
      row = { ...r.rows[0], value_position: null };
    }
    res.status(201).json(row);
  } catch (err) {
    console.error('POST value error:', err);
    res.status(400).json({
      message: 'Failed to create value',
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

router.put('/values/:value_id', ...mustAdmin, async (req, res) => {
  try {
    const valueId = toInt(req.params.value_id);
    const { value_name = null, value_position = null } = req.body || {};
    const hasValuePos = await hasColumn('product_option_values', 'value_position');

    let r;
    if (hasValuePos) {
      r = await db.query(
        `
        UPDATE product_option_values
           SET value_name = COALESCE($1, value_name),
               value_position = COALESCE($2, value_position)
         WHERE value_id = $3
         RETURNING value_id, value_name, value_position
      `,
        [value_name, value_position, valueId]
      );
    } else {
      r = await db.query(
        `
        UPDATE product_option_values
           SET value_name = COALESCE($1, value_name)
         WHERE value_id = $2
         RETURNING value_id, value_name, NULL::int AS value_position
      `,
        [value_name, valueId]
      );
    }
    if (!r.rows[0]) return res.status(404).json({ message: 'Value not found' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('PUT value error:', err);
    res.status(400).json({
      message: 'Failed to update value',
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

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
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

/* =========================================================
 * VARIANTS (READ) — ใช้ VIEW live stock เป็นทางหลัก
 * GET /api/variants/product/:id?active=1
 * ========================================================= */
router.get(['/product/:id','/variants/product/:id'], async (req, res) => {
  try {
    const productId = toInt(req.params.id);
    if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product id' });
    const onlyActive = String(req.query.active ?? '1') === '1';

    const { expr: baseExpr, groupBy: baseGroupBy } = await pickProductBasePriceParts();

    // (1) ใช้ VIEW live stock ถ้ามี
    if (await hasView('v_product_variants_live_stock')) {
      const { rows } = await db.query(
        `
        SELECT
          lv.variant_id,
          lv.product_id,
          lv.sku,
          COALESCE(lv.price_override, ${baseExpr}) AS final_price,
          lv.stock::int                          AS stock,
          COALESCE(lv.is_active, TRUE)           AS is_active,
          lv.image_url,
          NULL::text                             AS fingerprint,
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
        GROUP BY lv.variant_id, lv.product_id, lv.sku, lv.price_override, lv.stock, lv.is_active, lv.image_url${baseGroupBy ? `, ${baseGroupBy}` : ''}
        ORDER BY lv.variant_id ASC
      `,
        [productId]
      );
      return res.json(rows);
    }

    // (2) รองรับ v_product_variants_expanded ถ้ามี
    if (await hasView('v_product_variants_expanded')) {
      const hasImg = await hasColumn('product_variants', 'image_url');
      const { rows } = await db.query(
        `
        SELECT ve.variant_id, ve.product_id, ve.sku, ve.final_price, ve.stock, ve.fingerprint, ve.is_active, ve.combo,
               ${hasImg ? 'pv.image_url' : 'NULL'} AS image_url
        FROM v_product_variants_expanded ve
        ${hasImg ? 'LEFT JOIN product_variants pv ON pv.variant_id = ve.variant_id' : ''}
        WHERE ve.product_id = $1
          ${onlyActive ? 'AND ve.is_active = TRUE' : ''}
        ORDER BY ve.variant_id ASC
      `,
        [productId]
      );
      return res.json(rows);
    }

    // (3) fallback: ตารางจริง
    const { stockCol, priceCol, activeCol, imageCol } = await pickVariantCols();
    // ถ้าไม่มีคอลัมน์ stock_* ในตาราง ให้ลองรวมจาก inventory_moves เป็นสต็อกปัจจุบัน
    let stockExpr = stockCol ? `v.${stockCol}` : null;
    let invJoin = '';
    if (!stockExpr && (await hasTable('inventory_moves'))) {
      invJoin = `LEFT JOIN (
        SELECT variant_id, SUM(CASE WHEN move_type='in' THEN qty WHEN move_type='out' THEN -qty ELSE COALESCE(qty,0) END) AS mv_stock
        FROM inventory_moves GROUP BY variant_id
      ) mv ON mv.variant_id = v.variant_id`;
      stockExpr = 'COALESCE(mv.mv_stock,0)';
    }
    if (!stockExpr) stockExpr = '0';
    const finalPriceExpr = priceCol ? `v.${priceCol}` : baseExpr;
    const isActiveExpr = activeCol ? `v.${activeCol}` : `TRUE`;

    const { rows } = await db.query(
      `
      SELECT
        v.variant_id,
        v.product_id,
        v.sku,
        COALESCE(${finalPriceExpr}, ${baseExpr}) AS final_price,
        ${stockExpr}::int AS stock,
        ${isActiveExpr}  AS is_active,
        ${imageCol ? `v.${imageCol}` : 'NULL'} AS image_url,
        NULL::text AS fingerprint,
        COALESCE(
          json_agg(
            json_build_object('option_id', pvv.option_id, 'value_id', pvv.value_id)
            ORDER BY pvv.option_id
          ) FILTER (WHERE pvv.option_id IS NOT NULL),
          '[]'
        ) AS combo
      FROM product_variants v ${invJoin}
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN product_variant_values pvv ON pvv.variant_id = v.variant_id
      WHERE v.product_id = $1
        ${onlyActive ? `AND COALESCE(${isActiveExpr}, TRUE) = TRUE` : ''}
      GROUP BY v.variant_id, v.product_id, v.sku, ${finalPriceExpr}, ${stockExpr}, ${isActiveExpr}${imageCol ? `, v.${imageCol}` : ''}${baseGroupBy ? `, ${baseGroupBy}` : ''}
      ORDER BY v.variant_id ASC
    `,
      [productId]
    );

    res.json(rows);
  } catch (err) {
    console.error('GET /variants/product/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch variants' });
  }
});

/* =========================================================
 * VARIANTS (WRITE) — admin only
 * ========================================================= */
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
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  } finally {
    client.release?.();
  }
});

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

    if (sku !== undefined)                   { sets.push(`sku = COALESCE($${i++}, sku)`);                   vals.push(sku); }
    if (priceCol && price !== undefined)     { sets.push(`${priceCol} = COALESCE($${i++}, ${priceCol})`);   vals.push(Math.max(0, Number(price) || 0)); }
    if (stockCol && stock_qty !== undefined) { sets.push(`${stockCol} = COALESCE($${i++}, ${stockCol})`);   vals.push(Math.max(0, Number(stock_qty) || 0)); }
    if (activeCol && is_active !== undefined){ sets.push(`${activeCol} = COALESCE($${i++}, ${activeCol})`); vals.push(!!is_active); }
    if (imageCol && image_url !== undefined) { sets.push(`${imageCol} = COALESCE($${i++}, ${imageCol})`);   vals.push(image_url || null); }

    if (!sets.length) sets.push('sku = sku'); // no-op

    vals.push(variantId);
    const r = await client.query(
      `
      UPDATE product_variants
         SET ${sets.join(', ')}
       WHERE variant_id = $${i}
       RETURNING variant_id, product_id, sku,
         ${priceCol ? `${priceCol} AS price` : 'NULL::numeric AS price'},
         ${stockCol ? `${stockCol} AS stock_qty` : 'NULL::int AS stock_qty'},
         ${activeCol ? `${activeCol} AS is_active` : 'TRUE AS is_active'},
         ${imageCol ? `${imageCol} AS image_url` : 'NULL AS image_url'}
    `,
      vals
    );

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
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  } finally {
    client.release?.();
  }
});

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
      ...(isDev ? { details: err.message, code: err.code } : {}),
    });
  }
});

/* =========================================================
 * QUICK MODE: UPSERT SINGLE VARIANT (รองรับ 2 รูปแบบ)
 * - POST /api/variants/upsert-single
 *     body: { product_id, options:[{name,value}], sku, price, images:[], videos:[] }
 * - POST /api/variants/products/:id/upsert-single
 *     body: { details:[{name,value}], sku, price, images:[], videos:[] }
 * ========================================================= */
async function getOrCreateOption(client, productId, optionName) {
  const { rows } = await client.query(
    `SELECT option_id FROM product_options
     WHERE product_id=$1 AND option_name=$2
     ORDER BY option_id LIMIT 1`,
    [productId, optionName]
  );
  if (rows.length) return rows[0].option_id;

  const { rows: ins } = await client.query(
    `INSERT INTO product_options (product_id, option_name)
     VALUES ($1,$2) RETURNING option_id`,
    [productId, optionName]
  );
  return ins[0].option_id;
}
async function getOrCreateValue(client, optionId, valueName) {
  const { rows } = await client.query(
    `SELECT value_id FROM product_option_values
     WHERE option_id=$1 AND value_name=$2
     ORDER BY value_id LIMIT 1`,
    [optionId, valueName]
  );
  if (rows.length) return rows[0].value_id;

  const { rows: ins } = await client.query(
    `INSERT INTO product_option_values (option_id, value_name)
     VALUES ($1,$2) RETURNING value_id`,
    [optionId, valueName]
  );
  return ins[0].value_id;
}

async function findVariantByPairs(client, productId, pairs) {
  if (!pairs?.length) return null;
  const valuesPlaceholders = pairs.map((_, i) => `($${i * 2 + 2}::int, $${i * 2 + 3}::int)`).join(', ');
  const params = [productId];
  for (const p of pairs) params.push(p.option_id, p.value_id);
  params.push(pairs.length);

  const sql = `
    WITH pairs(option_id, value_id) AS (VALUES ${valuesPlaceholders})
    SELECT v.variant_id
    FROM product_variants v
    LEFT JOIN product_variant_values pvv ON pvv.variant_id = v.variant_id
    WHERE v.product_id = $1
    GROUP BY v.variant_id
    HAVING
      SUM(CASE WHEN (pvv.option_id, pvv.value_id) IN (SELECT option_id, value_id FROM pairs) THEN 1 ELSE 0 END) = $${params.length}
      AND COUNT(*) = $${params.length}
    LIMIT 1
  `;
  const { rows } = await client.query(sql, params);
  return rows[0]?.variant_id ?? null;
}

async function upsertSingleHandler(req, res) {
  // รองรับ product_id จาก path params หรือ body
  const productId = req.params.id ? toInt(req.params.id) : toInt(req.body.product_id);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'INVALID_PRODUCT_ID' });

  // รับได้ทั้ง details (เดิม) หรือ options (ใหม่จาก FE)
  let details = Array.isArray(req.body.details)
    ? req.body.details
    : Array.isArray(req.body.options)
    ? req.body.options
    : [];

  let { sku = null, price = null, images = [], videos = [] } = req.body || {};

  // กรองรายละเอียด 1–3 ช่อง
  const clean = [];
  for (const d of details) {
    const n = String(d?.name || '').trim();
    const v = String(d?.value || '').trim();
    if (n && v) clean.push({ name: n, value: v });
    if (clean.length >= 3) break;
  }
  if (!clean.length) return res.status(400).json({ error: 'NEED_AT_LEAST_ONE_DETAIL' });

  // images อนุโลมทั้ง array ของ url string หรือ object {url}
  images = Array.isArray(images)
    ? images.map((x) => (typeof x === 'string' ? x : x?.url)).filter(Boolean)
    : [];

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1) upsert options & values
    const pairs = [];
    for (const d of clean) {
      const optionId = await getOrCreateOption(client, productId, d.name);
      const valueId = await getOrCreateValue(client, optionId, d.value);
      pairs.push({ option_id: optionId, value_id: valueId });
    }

    // 2) หา variant ที่ตรงกับชุด pairs ทั้งหมด
    const foundVariantId = await findVariantByPairs(client, productId, pairs);

    // 2.1 เช็ค SKU ซ้ำภายในสินค้านี้
    if (sku && sku.trim()) {
      const { rows: dupe } = await client.query(
        `SELECT variant_id FROM product_variants WHERE product_id=$1 AND sku=$2`,
        [productId, sku.trim()]
      );
      if (dupe.length && (!foundVariantId || dupe[0].variant_id !== foundVariantId)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'SKU_DUPLICATE_IN_PRODUCT' });
        }
    }

    const { priceCol, imageCol } = await pickVariantCols();

    // 3) อัปเดตถ้ามีอยู่แล้ว ไม่งั้นสร้างใหม่
    let variantId;
    if (foundVariantId) {
      variantId = foundVariantId;
      const sets = [];
      const vals = [];
      let i = 1;

      sets.push(`sku = COALESCE($${i++}, sku)`); vals.push(sku ? sku.trim() : null);
      if (priceCol) { sets.push(`${priceCol} = COALESCE($${i++}, ${priceCol})`); vals.push(price === null ? null : Math.max(0, Number(price) || 0)); }
      if (imageCol && images?.length) { sets.push(`${imageCol} = $${i++}`); vals.push(images[0]); }

      if (!sets.length) sets.push('sku = sku');
      vals.push(variantId);

      await client.query(`UPDATE product_variants SET ${sets.join(', ')} WHERE variant_id=$${i}`, vals);
    } else {
      const cols = ['product_id', 'sku'];
      const vals = [productId, sku ? sku.trim() : null];
      if (priceCol) { cols.push(priceCol); vals.push(price === null ? null : Math.max(0, Number(price) || 0)); }
      if (imageCol && images?.length) { cols.push(imageCol); vals.push(images[0]); }

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const { rows: vIns } = await client.query(
        `INSERT INTO product_variants (${cols.join(', ')}) VALUES (${placeholders}) RETURNING variant_id`,
        vals
      );
      variantId = vIns[0].variant_id;

      // map pairs
      for (const p of pairs) {
        await client.query(
          `INSERT INTO product_variant_values (variant_id, option_id, value_id)
           VALUES ($1,$2,$3)
           ON CONFLICT (variant_id, option_id) DO UPDATE SET value_id = EXCLUDED.value_id`,
          [variantId, p.option_id, p.value_id]
        );
      }
    }

    // 4) บันทึกสื่อเข้าตาราง product_images (ถ้ามี)
    const hasImagesTable = await hasTable('product_images');
    if (hasImagesTable) {
      const hasUrl = await hasColumn('product_images', 'url');
      const hasProductId = await hasColumn('product_images', 'product_id');
      const hasVariantId = await hasColumn('product_images', 'variant_id');
      const hasPrimary = await hasColumn('product_images', 'is_primary');
      const hasPosition = await hasColumn('product_images', 'position');

      if (hasUrl && hasProductId) {
        let pos = 1;
        for (const u of images || []) {
          const cols = ['url', 'product_id'];
          const vals = [u, productId];
          if (hasVariantId) { cols.push('variant_id'); vals.push(variantId); }
          if (hasPrimary)   { cols.push('is_primary'); vals.push(pos === 1); }
          if (hasPosition)  { cols.push('position');   vals.push(pos); }

          // 🩹 FIX: ถ้าตารางมี unique ให้มี primary ได้รูปเดียว/สินค้า → เคลียร์ตัวเดิมก่อน
          if (hasPrimary && pos === 1) {
            try {
              await client.query(`UPDATE product_images SET is_primary = FALSE WHERE product_id = $1 AND is_primary = TRUE`, [productId]);
            } catch (e) {
              // ignore
            }
          }

          const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
          try {
            await client.query(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${ph})`, vals);
          } catch (err) {
            // ถ้ายังชน unique ให้ downgrade แถวแรกเป็น non-primary แล้วลองใหม่
            if (hasPrimary && pos === 1) {
              const idx = cols.indexOf('is_primary');
              if (idx !== -1) vals[idx] = false;
              await client.query(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${ph})`, vals);
            } else {
              throw err;
            }
          }
          pos++;
        }
      }
    }

    await client.query('COMMIT');
    return res.json({ ok: true, product_id: productId, variant_id: variantId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('upsert-single error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  } finally {
    // @ts-ignore
    req?.client?.release?.();
  }
}

// ทั้งสองเส้นทางใช้ handler เดียวกัน
router.post(['/upsert-single', '/products/:id/upsert-single'], ...mustAdmin, upsertSingleHandler);

/* =========================================================
 * GENERATE (หลายแถว / Cartesian) — admin only
 * - POST /api/admin/products/:productId/variants/generate     ← ใช้จาก FE ปุ่ม "บันทึกทั้งหมด"
 * - POST /api/variants/products/:product_id/variants/generate ← alias
 * ========================================================= */
router.post(['/:productId/variants/generate', '/products/:product_id/variants/generate'], ...mustAdmin, async (req, res) => {
  const productId = toInt(req.params.productId || req.params.product_id);
  if (!Number.isInteger(productId)) return res.status(400).json({ message: 'Invalid product id' });

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 1) ตรวจว่าสินค้ามีอยู่จริง
    const exist = await client.query('SELECT 1 FROM products WHERE product_id=$1 LIMIT 1', [productId]);
    if (!exist.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Product not found' });
    }

    // 2) helper สำหรับแต่ละแถว
    async function upsertByDetails(row) {
      const details = Array.isArray(row?.details) ? row.details : [];
      const clean = [];
      for (const d of details) {
        const n = String(d?.name || '').trim();
        const v = String(d?.value || '').trim();
        if (n && v) clean.push({ name: n, value: v });
        if (clean.length >= 3) break;
      }
      if (!clean.length) return null;

      // upsert option/value → pairs
      const pairs = [];
      for (const d of clean) {
        const optId = await getOrCreateOption(client, productId, d.name);
        const valId = await getOrCreateValue(client, optId, d.value);
        pairs.push({ option_id: optId, value_id: valId });
      }

      // หา variant เดิม
      let variantId = await findVariantByPairs(client, productId, pairs);

      // กัน SKU ซ้ำ
      const sku = row?.sku ? String(row.sku).trim() : null;
      if (sku) {
        const { rows: dupe } = await client.query(
          `SELECT variant_id FROM product_variants WHERE product_id=$1 AND sku=$2`,
          [productId, sku]
        );
        if (dupe.length && (!variantId || dupe[0].variant_id !== variantId)) {
          return { error: 'SKU_DUPLICATE_IN_PRODUCT', skip: true };
        }
      }

      const { priceCol, activeCol, imageCol } = await pickVariantCols();

      // อัปเดต/สร้าง
      if (variantId) {
        const sets = [];
        const vals = [];
        let i = 1;

        if (sku !== null) { sets.push(`sku = COALESCE($${i++}, sku)`); vals.push(sku); }
        if (priceCol && row.price !== undefined) { sets.push(`${priceCol} = COALESCE($${i++}, ${priceCol})`); vals.push(row.price === null ? null : Math.max(0, Number(row.price) || 0)); }
        if (activeCol && row.is_active !== undefined) { sets.push(`${activeCol} = COALESCE($${i++}, ${activeCol})`); vals.push(!!row.is_active); }
        if (imageCol && row.image_url !== undefined) { sets.push(`${imageCol} = COALESCE($${i++}, ${imageCol})`); vals.push(row.image_url || null); }
        if (!sets.length) sets.push('sku = sku');

        vals.push(variantId);
        await client.query(`UPDATE product_variants SET ${sets.join(', ')} WHERE variant_id=$${i}`, vals);
      } else {
        const cols = ['product_id'];
        const vals = [productId];

        cols.push('sku'); vals.push(sku);

        if (priceCol) { cols.push(priceCol); vals.push(row.price === null ? null : Math.max(0, Number(row.price) || 0)); }
        if (activeCol) { cols.push(activeCol); vals.push(row.is_active === undefined ? true : !!row.is_active); }
        if (imageCol)  { cols.push(imageCol);  vals.push(row.image_url || null); }

        const { rows: vIns } = await client.query(
          `INSERT INTO product_variants (${cols.join(', ')}) VALUES (${cols.map((_,i)=>`$${i+1}`).join(', ')}) RETURNING variant_id`,
          vals
        );
        variantId = vIns[0].variant_id;

        for (const p of pairs) {
          await client.query(
            `INSERT INTO product_variant_values (variant_id, option_id, value_id)
             VALUES ($1,$2,$3)
             ON CONFLICT (variant_id, option_id) DO UPDATE SET value_id = EXCLUDED.value_id`,
            [variantId, p.option_id, p.value_id]
          );
        }
      }

      // product_images (optional)
      if (row.image_url && (await hasTable('product_images'))) {
        const hasUrl = await hasColumn('product_images', 'url');
        const hasVariantId = await hasColumn('product_images', 'variant_id');
        const hasProductId = await hasColumn('product_images', 'product_id');
        const hasPrimary = await hasColumn('product_images', 'is_primary');

        if (hasUrl && hasProductId) {
          // ถ้าตารางบังคับ primary ต่อ product มีได้รูปเดียว ให้เคลียร์ก่อน
          if (hasPrimary) {
            try { await client.query('UPDATE product_images SET is_primary = FALSE WHERE product_id = $1 AND is_primary = TRUE', [productId]); } catch {}
          }
          const cols = ['url', 'product_id'];
          const vals = [row.image_url, productId];
          if (hasVariantId) { cols.push('variant_id'); vals.push(variantId); }
          if (hasPrimary)  { cols.push('is_primary'); vals.push(true); }

          const ph = cols.map((_,i)=>`$${i+1}`).join(', ');
          try {
            await client.query(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${ph})`, vals);
          } catch (e) {
            if (hasPrimary) { // downgrade ถ้ายังชน
              const idx = cols.indexOf('is_primary');
              if (idx !== -1) vals[idx] = false;
              await client.query(`INSERT INTO product_images (${cols.join(', ')}) VALUES (${ph})`, vals);
            } else { throw e; }
          }
        }
      }

      return { ok: true, variant_id: variantId };
    }

    let skipped = 0;

    // 3) rows → ทำตามแถว
    if (Array.isArray(req.body?.rows) && req.body.rows.length) {
      for (const r of req.body.rows) {
        const out = await upsertByDetails(r);
        if (out?.skip) skipped++;
      }
      await client.query('COMMIT');
      return res.json({ ok: true, product_id: productId, skipped });
    }

    // 4) options → generate Cartesian
    if (Array.isArray(req.body?.options) && req.body.options.length) {
      const opts = req.body.options
        .map(o => ({ name: String(o?.name || '').trim(), values: (o?.values || []).map(v => String(v).trim()).filter(Boolean) }))
        .filter(o => o.name && o.values.length);

      if (!opts.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Invalid options' });
      }

      // คูณชุด
      let combos = [[]];
      for (const o of opts) {
        const next = [];
        for (const c of combos) {
          for (const v of o.values) {
            next.push([...c, { name: o.name, value: v }]);
          }
        }
        combos = next;
      }

      for (const details of combos) {
        await upsertByDetails({ details });
      }

      await client.query('COMMIT');
      return res.json({ ok: true, product_id: productId, total: combos.length });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, product_id: productId, note: 'nothing to do' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('GENERATE variants error:', err);
    return res.status(500).json({ message: 'Failed to generate variants', ...(isDev ? { details: err.message, code: err.code } : {}) });
  } finally {
    client.release?.();
  }
});

/* =========================================================
 * RESOLVE VARIANT (PDP/Cart)
 * POST /api/variants/products/:id/resolve-variant
 * body: { optionIds:[...], valueIds:[...] }
 * ========================================================= */
router.post('/products/:id/resolve-variant', async (req, res) => {
  try {
    const productId = toInt(req.params.id);
    if (!Number.isInteger(productId)) return res.status(400).json({ error: 'bad params: productId' });

    let { optionIds = [], valueIds = [] } = req.body || {};
    optionIds = toIntArray(optionIds);
    valueIds = toIntArray(valueIds);
    if (!optionIds || !valueIds || optionIds.length !== valueIds.length) {
      return res.status(400).json({ error: 'bad params: optionIds/valueIds' });
    }

    const { expr: baseExpr, groupBy: baseGroupBy } = await pickProductBasePriceParts();
    const hasLiveView = await hasView('v_product_variants_live_stock');
    const hasImgView = await hasView('v_variant_images');

    if (optionIds.length === 0) {
      if (!hasLiveView) {
        // fallback: ไม่มี view live
        const { rows: r0 } = await db.query(
          `
          SELECT
            v.variant_id,
            v.sku,
            COALESCE(v.price_override, ${baseExpr}) AS price,
            ${hasImgView ? 'COALESCE(v.image_url, img.display_url, p.image_url)' : 'COALESCE(v.image_url, p.image_url)'} AS image,
            COALESCE(v.stock_qty, v.stock, 0)::int AS stock_qty
          FROM product_variants v
          JOIN products p ON p.product_id = v.product_id
          ${hasImgView ? 'LEFT JOIN v_variant_images img ON img.variant_id = v.variant_id' : ''}
          WHERE v.product_id = $1 AND COALESCE(v.is_active, TRUE) = TRUE
          ORDER BY v.variant_id ASC
          LIMIT 1
        `,
          [productId]
        );
        if (!r0.length) return res.status(404).json({ error: 'variant not found' });
        return res.json(r0[0]);
      }

      const r0 = await db.query(
        `
        SELECT
          lv.variant_id,
          lv.sku,
          COALESCE(lv.price_override, ${baseExpr}) AS price,
          ${hasImgView ? 'COALESCE(lv.image_url, img.display_url, p.image_url)' : 'COALESCE(lv.image_url, p.image_url)'} AS image,
          lv.stock::int AS stock_qty
        FROM v_product_variants_live_stock lv
        JOIN products p ON p.product_id = lv.product_id
        ${hasImgView ? 'LEFT JOIN v_variant_images img ON img.variant_id = lv.variant_id' : ''}
        WHERE lv.product_id = $1 AND COALESCE(lv.is_active, TRUE) = TRUE
        ORDER BY lv.variant_id ASC
        LIMIT 1
      `,
        [productId]
      );
      if (!r0.rows.length) return res.status(404).json({ error: 'variant not found' });
      return res.json(r0.rows[0]);
    }

    const baseSQL = hasLiveView
      ? `
      SELECT
        pv.variant_id,
        pv.sku,
        COALESCE(lv.price_override, ${baseExpr}) AS price,
        ${hasImgView ? 'COALESCE(lv.image_url, img.display_url, p.image_url)' : 'COALESCE(lv.image_url, p.image_url)'} AS image,
        lv.stock::int AS stock_qty
      FROM product_variants pv
      JOIN products p ON p.product_id = pv.product_id
      JOIN v_product_variants_live_stock lv ON lv.variant_id = pv.variant_id
    `
      : `
      SELECT
        pv.variant_id,
        pv.sku,
        COALESCE(pv.price_override, ${baseExpr}) AS price,
        ${hasImgView ? 'COALESCE(pv.image_url, img.display_url, p.image_url)' : 'COALESCE(pv.image_url, p.image_url)'} AS image,
        COALESCE(pv.stock_qty, pv.stock, 0)::int AS stock_qty
      FROM product_variants pv
      JOIN products p ON p.product_id = pv.product_id
    `;

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
      ${baseSQL}
      JOIN product_variant_values pvv ON pvv.variant_id = pv.variant_id
      ${hasImgView ? 'LEFT JOIN v_variant_images img ON img.variant_id = pv.variant_id' : ''}
      WHERE pv.product_id = $1 AND COALESCE(${hasLiveView ? 'lv.is_active' : 'pv.is_active'}, TRUE) = TRUE
      GROUP BY pv.variant_id, pv.sku, ${hasLiveView ? `lv.price_override, lv.image_url, lv.stock` : `pv.price_override, pv.image_url, pv.stock, pv.stock_qty`}${hasImgView ? ', img.display_url' : ''}${baseGroupBy ? `, ${baseGroupBy}` : ''}, p.image_url
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

/* =========================================================
 * ALIAS (อ่าน variants ตาม product_id โดยตรง)
 * ========================================================= */

async function queryAliasItems(productId) {
  // ใช้ live view ถ้ามี, ไม่งั้น fallback ตารางจริง
  if (await hasView('v_product_variants_live_stock')) {
    const { rows } = await db.query(
      `
      SELECT
        lv.variant_id, lv.product_id, lv.sku,
        COALESCE(lv.price_override, 0) AS price,
        lv.stock::int                   AS stock,
        COALESCE(lv.is_active, TRUE)    AS is_active,
        COALESCE(lv.image_url, '')      AS image_url
      FROM v_product_variants_live_stock lv
      WHERE lv.product_id = $1
      ORDER BY lv.variant_id ASC
    `,
      [productId]
    );
    return rows;
  }

  const { rows } = await db.query(
    `
    SELECT
      v.variant_id, v.product_id, v.sku,
      COALESCE(v.price_override, v.price, 0) AS price,
      COALESCE(v.stock_qty, v.stock, 0)::int AS stock,
      COALESCE(v.is_active, TRUE)            AS is_active,
      COALESCE(v.image_url, '')              AS image_url
    FROM product_variants v
    WHERE v.product_id = $1
    ORDER BY v.variant_id ASC
  `,
    [productId]
  );
  return rows;
}

// GET /api/variants/by-product/:productId
router.get(['/by-product/:productId','/variants/by-product/:productId'], ...mustAdmin, async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product id' });
  try {
    const items = await queryAliasItems(productId);
    return res.json({ items });
  } catch (err) {
    console.error('GET /variants/by-product/:id error', err);
    return res.status(500).json({ error: 'Failed to load variants' });
  }
});

// GET /api/variants?product_id=XX
router.get(['/', '/variants'], ...mustAdmin, async (req, res) => {
  const productId = parseInt(req.query.product_id, 10);
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'product_id required' });
  try {
    const items = await queryAliasItems(productId);
    return res.json({ items });
  } catch (err) {
    console.error('GET /variants?product_id error', err);
    return res.status(500).json({ error: 'Failed to load variants' });
  }
});


/* =========================================================
 * UPDATE STOCKS (batch) — admin only
 * body: { items: [{ variant_id, stock }] }
 * ========================================================= */
router.post('/update-stocks', ...mustAdmin, async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.json({ ok: true, updated: 0 });
    const { stockCol } = await pickVariantCols();
    if (!stockCol) return res.status(400).json({ message: 'No stock column in product_variants' });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      let updated = 0;
      for (const it of items) {
        const vid = Number.parseInt(String(it?.variant_id ?? ''), 10);
        if (!Number.isFinite(vid)) continue;
        const s = Math.max(0, Number(it?.stock) || 0);
        const r = await client.query(`UPDATE product_variants SET ${stockCol} = $1 WHERE variant_id = $2`, [s, vid]);
        updated += r.rowCount || 0;
      }
      await client.query('COMMIT');
      res.json({ ok: true, updated });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } catch (err) {
    console.error('POST /api/variants/update-stocks error:', err);
    res.status(500).json({ message: 'Failed to update stocks', ...(isDev ? { details: err.message, code: err.code } : {}) });
  }
});
module.exports = router;


/* =========================================================
 * UPSERT BATCH of variants for a product
 * POST /api/variants/upsert-batch
 * body: { product_id, rows: [{variant_id?, sku?, price?, image_url?, details:[{name,value}] }] }
 *  - Creates/updates product_variants
 *  - Ensures product_variant_values mapping by option name -> value (create option/value if missing)
 *  - Safely links/creates product_images with NULL position to avoid uq_product_image_position conflicts
 * ========================================================= */
router.post('/upsert-batch', async (req, res) => {
  const { product_id, rows } = req.body || {};
  const productId = toInt(product_id);
  if (!Number.isInteger(productId) || !Array.isArray(rows)) {
    return res.status(400).json({ message: 'product_id and rows[] required' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Helpers
    const hasPVid = await hasColumn('product_variants', 'variant_id');
    const hasPVPrice = await hasColumn('product_variants', 'price');
    const hasPVPriceOverride = await hasColumn('product_variants', 'price_override');
    const colVid = hasPVid ? 'variant_id' : 'product_variant_id';
    const colPrice = hasPVPrice ? 'price' : (hasPVPriceOverride ? 'price_override' : null);

    const fetchOptionId = async (name) => {
      if (!name) return null;
      const q1 = await client.query('SELECT option_id FROM product_options WHERE product_id=$1 AND option_name=$2 LIMIT 1', [productId, name]);
      if (q1.rows[0]?.option_id) return q1.rows[0].option_id;
      const ins = await client.query('INSERT INTO product_options(product_id, option_name) VALUES ($1,$2) RETURNING option_id', [productId, name]);
      return ins.rows[0].option_id;
    };

    const fetchValueId = async (option_id, value_name) => {
      if (!option_id || !value_name) return null;
      const q1 = await client.query('SELECT value_id FROM product_option_values WHERE option_id=$1 AND value_name=$2 LIMIT 1', [option_id, value_name]);
      if (q1.rows[0]?.value_id) return q1.rows[0].value_id;
      const ins = await client.query('INSERT INTO product_option_values(option_id, value_name) VALUES ($1,$2) RETURNING value_id', [option_id, value_name]);
      return ins.rows[0].value_id;
    };

    const upsertVariant = async (r) => {
      const sku = (r.sku || '').trim() || null;
      const price = Number.isFinite(Number(r.price)) ? Number(r.price) : null;
      let image_url = r.image_url || r.image || null;
      // create/update variant
      if (r.variant_id) {
        const sets = [];
        const vals = [];
        let idx = 1;
        if (sku !== null) { sets.push(`sku=$${idx++}`); vals.push(sku); }
        if (colPrice && price !== null) { sets.push(`${colPrice}=$${idx++}`); vals.push(price); }
        if (r.image_url !== undefined || r.image !== undefined) { sets.push(`image_url=$${idx++}`); vals.push(image_url); }
        vals.push(r.variant_id);
        if (sets.length) {
          await client.query(`UPDATE product_variants SET ${sets.join(',')} WHERE ${colVid}=$${idx}`, vals);
        }
        return r.variant_id;
      } else {
        const cols = ['product_id']; const ph = ['$1']; const vals = [productId];
        let x = 2;
        if (sku !== null) { cols.push('sku'); ph.push(`$${x}`); vals.push(sku); x++; }
        if (colPrice && price !== null) { cols.push(colPrice); ph.push(`$${x}`); vals.push(price); x++; }
        if (image_url !== null) { cols.push('image_url'); ph.push(`$${x}`); vals.push(image_url); x++; }
        const ins = await client.query(`INSERT INTO product_variants(${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING ${colVid} AS variant_id`, vals);
        return ins.rows[0].variant_id;
      }
    };

    const ensureMapping = async (variant_id, details) => {
      if (!Array.isArray(details) || !details.length) return;
      for (const d of details) {
        const name = (d?.name || '').trim(); const val = (d?.value || '').trim();
        if (!name || !val) continue;
        const optId = await fetchOptionId(name);
        const valId = await fetchValueId(optId, val);
        const exists = await client.query(
          'SELECT 1 FROM product_variant_values WHERE variant_id=$1 AND option_id=$2 LIMIT 1',
          [variant_id, optId]
        );
        if (exists.rowCount) {
          await client.query('UPDATE product_variant_values SET value_id=$1 WHERE variant_id=$2 AND option_id=$3', [valId, variant_id, optId]);
        } else {
          await client.query('INSERT INTO product_variant_values(variant_id, option_id, value_id) VALUES ($1,$2,$3)', [variant_id, optId, valId]);
        }
      }
    };

    const attachImage = async (variant_id, url) => {
      if (!url) return;
      // strategy: insert if not exists (product_id + url), always set variant_id, and set position=NULL to dodge unique constraint
      const q = await client.query('SELECT 1 FROM product_images WHERE product_id=$1 AND url=$2 LIMIT 1', [productId, url]);
      if (q.rowCount === 0) {
        await client.query('INSERT INTO product_images(product_id, variant_id, url, position) VALUES ($1,$2,$3,NULL)', [productId, variant_id, url]);
      } else {
        // ensure not violating uq on (product_id, coalesce(variant_id,-1), position): set position=NULL when changing variant_id
        await client.query('UPDATE product_images SET variant_id=$1, position=NULL WHERE product_id=$2 AND url=$3', [variant_id, productId, url]);
      }
    };

    const outIds = [];
    for (const r of rows) {
      const vid = await upsertVariant(r);
      await ensureMapping(vid, r.details || []);
      if (r.image_url || r.image) await attachImage(vid, r.image_url || r.image);
      outIds.push(vid);
    }

    await client.query('COMMIT');
    res.json({ ok: true, variant_ids: outIds });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    console.error('UPSERT-BATCH error:', err);
    res.status(500).json({ message: 'UPSERT failed', detail: String(err?.message || err) });
  } finally {
    client.release();
  }
});

/* =========================================================
 * DELETE BATCH of variants
 * body: { variant_ids: [] }
 * Also nulls product_images.variant_id with position=NULL to avoid unique constraint clashes.
 * ========================================================= */
router.post('/delete-batch', async (req, res) => {
  const { variant_ids } = req.body || {};
  const ids = Array.isArray(variant_ids) ? variant_ids.map((x)=>parseInt(x,10)).filter(Number.isInteger) : [];
  if (!ids.length) return res.json({ ok: true, deleted: 0 });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // detach images first
    await client.query('UPDATE product_images SET variant_id=NULL, position=NULL WHERE variant_id = ANY($1)', [ids]);
    // delete mappings
    await client.query('DELETE FROM product_variant_values WHERE variant_id = ANY($1)', [ids]);
    // delete variants
    const r = await client.query('DELETE FROM product_variants WHERE variant_id = ANY($1)', [ids]);

    await client.query('COMMIT');
    res.json({ ok: true, deleted: r.rowCount });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_e) {}
    console.error('DELETE-BATCH error:', err);
    res.status(500).json({ message: 'DELETE failed', detail: String(err?.message || err) });
  } finally {
    client.release();
  }
});
