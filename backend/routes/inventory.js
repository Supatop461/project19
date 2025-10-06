// backend/routes/inventory.js
const express = require('express');

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();
const mustStaff = [requireAuth, requireRole(['admin', 'staff'])];

console.log('▶ inventory router LOADED');
router.get('/_ping', (_req, res) => res.json({ ok: true }));

/* 🔒 no-store ป้องกัน 304/cache สำหรับทุก endpoint ใต้ /api/inventory */
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader?.('ETag');
  res.removeHeader?.('Last-Modified');
  next();
});

/* ----------------- helpers ----------------- */
const toInt = (x) => Number.parseInt(x, 10);

async function hasTable(table) {
  const { rows } = await db.query(
    `SELECT to_regclass($1) IS NOT NULL AS ok`,
    [`public.${table}`]
  );
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
async function getClient() {
  if (typeof db.getClient === 'function') return db.getClient();
  if (db.pool?.connect) return db.pool.connect();
  if (db._pool?.connect) return db._pool.connect();
  return { query: (...a) => db.query(...a), release: () => {} };
}

/* =========================================================
 * SEARCH: ค้นหา Variant สำหรับ IN/OUT — GET /api/inventory/search?q=&mode=
 * ========================================================= */
router.get('/search', ...mustStaff, async (req, res, next) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    if (!qRaw) return res.json([]);
    const q = `%${qRaw}%`;
    const mode = String(req.query.mode || 'in').toLowerCase(); // default IN
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);

    const hasCostView = await hasTable('v_variant_stock_cost');

    const sql = hasCostView ? `
      SELECT
        v.variant_id,
        v.sku,
        COALESCE(vsc.stock, 0)::int AS stock,
        p.product_id,
        p.product_name,
        vsc.selling_price,
        vsc.avg_cost
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN v_variant_stock_cost vsc ON vsc.variant_id = v.variant_id
      WHERE v.is_active = TRUE
        AND (p.product_name ILIKE $1 OR v.sku ILIKE $1)
        ${mode === 'out' ? 'AND COALESCE(vsc.stock,0) > 0' : ''}
      ORDER BY p.product_id DESC, v.variant_id DESC
      LIMIT $2
    ` : `
      SELECT
        v.variant_id,
        v.sku,
        COALESCE(v.stock, 0)::int AS stock,
        p.product_id,
        p.product_name,
        NULL::numeric AS selling_price,
        NULL::numeric AS avg_cost
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      WHERE v.is_active = TRUE
        AND (p.product_name ILIKE $1 OR v.sku ILIKE $1)
        ${mode === 'out' ? 'AND COALESCE(v.stock,0) > 0' : ''}
      ORDER BY p.product_id DESC, v.variant_id DESC
      LIMIT $2
    `;

    const { rows } = await db.query(sql, [q, limit]);

    res.json(rows.map(r => ({
      variant_id: r.variant_id,
      sku: r.sku,
      stock: r.stock,
      product_id: r.product_id,
      product_name: r.product_name,
      selling_price: r.selling_price ?? null,
      avg_cost: r.avg_cost ?? null,
      label: `${r.product_name} (${r.sku})`,
    })));
  } catch (err) {
    next(err);
  }
});

/* ---------- FIFO core (คงเดิม) ---------- */
async function fifoIssue(client, {
  variantId,
  requestQty,
  note = null,
  ref_order_detail_id = null,
  createdBy = 'system'
}) {
  const v = (await client.query(
    `SELECT variant_id, product_id FROM product_variants WHERE variant_id=$1`,
    [variantId]
  )).rows[0];
  if (!v) {
    const err = new Error('variant not found');
    err.status = 404;
    throw err;
  }

  const hasCreatedBy = await hasColumn('inventory_moves', 'created_by');
  const hasRefOrder = await hasColumn('inventory_moves', 'ref_order_detail_id');

  const lotsRs = await client.query(`
    SELECT lot_id, qty_available, cost_per_unit
    FROM product_lots
    WHERE product_variant_id = $1 AND qty_available > 0
    ORDER BY received_at ASC, lot_id ASC
    FOR UPDATE
  `, [variantId]);

  const totalAvailable = lotsRs.rows.reduce((s, r) => s + Number(r.qty_available || 0), 0);
  if (totalAvailable < requestQty) {
    const err = new Error('Insufficient stock');
    err.status = 400;
    err.payload = {
      product_id: v.product_id,
      product_variant_id: v.variant_id,
      requested: requestQty,
      available: totalAvailable
    };
    throw err;
  }

  let remaining = requestQty;
  const allocations = [];

  for (const lot of lotsRs.rows) {
    if (remaining <= 0) break;
    const canTake = Math.min(remaining, Number(lot.qty_available));
    if (canTake <= 0) continue;

    await client.query(
      `UPDATE product_lots SET qty_available = qty_available - $1 WHERE lot_id = $2`,
      [canTake, lot.lot_id]
    );

    const cols = ['product_id','product_variant_id','move_type','change_qty','unit_cost','lot_id','note'];
    const vals = [v.product_id, v.variant_id, 'OUT', -canTake, lot.cost_per_unit, lot.lot_id, note];

    if (hasRefOrder) { cols.push('ref_order_detail_id'); vals.push(ref_order_detail_id); }
    if (hasCreatedBy) { cols.push('created_by'); vals.push(createdBy); }

    const move = (await client.query(
      `INSERT INTO inventory_moves (${cols.join(',')})
       VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
       RETURNING move_id, created_at`,
      vals
    )).rows[0];

    allocations.push({
      lot_id: lot.lot_id,
      allocated_qty: canTake,
      unit_cost: lot.cost_per_unit,
      move_id: move.move_id,
      move_at: move.created_at
    });

    remaining -= canTake;
  }

  if (remaining > 0) {
    const err = new Error('Concurrent stock change detected');
    err.status = 409;
    err.payload = {
      product_id: v.product_id,
      product_variant_id: v.variant_id,
      requested: requestQty,
      allocated: requestQty - remaining
    };
    throw err;
  }

  return {
    product_id: v.product_id,
    product_variant_id: v.variant_id,
    totalAllocated: allocations.reduce((s,a)=>s+a.allocated_qty,0),
    allocations
  };
}

/* =========================================================
 * READ: GET /api/inventory?scope=product|variant&search=&order=
 * ========================================================= */
router.get('/', ...mustStaff, async (req, res) => {
  try {
    const {
      search = '',
      limit = 20,
      offset = 0,
      order = 'low_stock',
      scope = 'product',
    } = req.query;

    const lim = Math.min(Math.max(parseInt(limit || 20, 10), 1), 100);
    const off = Math.max(parseInt(offset || 0, 10), 0);

    const useView = await hasTable('v_product_variants_live_stock');

    // ------------ scope = variant ------------
    if (String(scope).toLowerCase() === 'variant') {
      const hasCostView = await hasTable('v_variant_stock_cost');
      if (!hasCostView) {
        return res.status(500).json({ error: 'v_variant_stock_cost view not found' });
      }

      // ✅ ตรวจว่ามีคอลัมน์ใดบ้างใน view แล้วประกอบ WHERE ให้ค้นหาครอบคลุม
      const hasProdName  = await hasColumn('v_variant_stock_cost', 'product_name');
      const hasProdTitle = await hasColumn('v_variant_stock_cost', 'product_title');
      const hasVarName   = await hasColumn('v_variant_stock_cost', 'variant_name');
      const hasSku       = await hasColumn('v_variant_stock_cost', 'sku');

      const searchableCols = []
        .concat(hasProdName  ? [`COALESCE(vsc.product_name,'')`] : [])
        .concat(hasProdTitle ? [`COALESCE(vsc.product_title,'')`] : [])
        .concat(hasVarName   ? [`COALESCE(vsc.variant_name,'')`] : [])
        .concat(hasSku       ? [`COALESCE(vsc.sku,'')`] : []);

      const params = [];
      const where = [];

      if (String(search).trim() && searchableCols.length) {
        const concatExpr = searchableCols.join(` || ' ' || `);
        params.push(`%${String(search).trim()}%`);
        where.push(`(${concatExpr} ILIKE $${params.length})`);
      }

      const orderBy = {
        low_stock:  'vsc.stock ASC, vsc.variant_id ASC',
        newest:     'vsc.product_id DESC, vsc.variant_id ASC',
        name_asc:   (hasProdName ? 'vsc.product_name' : hasProdTitle ? 'vsc.product_title' : hasVarName ? 'vsc.variant_name' : 'vsc.variant_id') + ' ASC, vsc.variant_id ASC',
        name_desc:  (hasProdName ? 'vsc.product_name' : hasProdTitle ? 'vsc.product_title' : hasVarName ? 'vsc.variant_name' : 'vsc.variant_id') + ' DESC, vsc.variant_id ASC',
        price_asc:  'vsc.selling_price ASC NULLS LAST, vsc.variant_id ASC',
        price_desc: 'vsc.selling_price DESC NULLS LAST, vsc.variant_id ASC',
      }[String(order).toLowerCase()] || 'vsc.variant_id ASC';

      const sql = `
        SELECT
          vsc.variant_id,
          vsc.product_id,
          vsc.sku,
          vsc.product_name,
          ${hasProdTitle ? 'vsc.product_title,' : 'NULL::text AS product_title,'}
          ${hasVarName   ? 'vsc.variant_name,' : 'NULL::text AS variant_name,'}
          COALESCE(vsc.stock,0)::int        AS stock,
          vsc.selling_price::numeric(10,2)  AS selling_price,
          vsc.avg_cost::numeric(10,2)       AS avg_cost
        FROM v_variant_stock_cost vsc
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY ${orderBy}
        LIMIT $${params.push(lim)} OFFSET $${params.push(off)}
      `;
      const { rows } = await db.query(sql, params);

      const countSql = `
        SELECT COUNT(*)::int AS total
        FROM v_variant_stock_cost vsc
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      `;
      const { rows: cnt } = await db.query(countSql, params.slice(0, params.length - 2));

      return res.json({
        items: rows.map(r => ({
          variant_id: r.variant_id,
          product_id: r.product_id,
          sku: r.sku,
          product_name: r.product_name || r.product_title || r.variant_name || r.sku,
          stock: r.stock,
          selling_price: r.selling_price,
          avg_cost: r.avg_cost,
        })),
        total: cnt[0]?.total ?? rows.length
      });
    }

    // ------------ scope = product (default) ------------
    const params = [];
    const where = [];
    if (String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      params.push(q, q);
      where.push(`(p.product_name ILIKE $${params.length - 1} OR p.description ILIKE $${params.length})`);
    }

    const stockExpr = useView
      ? `(SELECT COALESCE(SUM(v.stock),0)::int FROM v_product_variants_live_stock v WHERE v.product_id = p.product_id)`
      : `COALESCE(p.stock,0)::int`;

    const orderBy = {
      low_stock: `${stockExpr} ASC, p.product_id DESC`,
      newest: 'p.product_id DESC',
      name_asc: 'p.product_name ASC, p.product_id DESC',
      name_desc: 'p.product_name DESC, p.product_id DESC',
    }[String(order).toLowerCase()] || 'p.product_id DESC';

    const hasCat = await hasTable('product_categories');
    const hasSub = await hasTable('subcategories');

    const sql = `
      SELECT
        p.product_id, p.product_name, p.selling_price, p.image_url,
        ${stockExpr} AS stock,
        ${hasCat ? 'p.category_id, c.category_name,' : 'NULL::int AS category_id, NULL::text AS category_name,'}
        ${hasSub ? 'p.subcategory_id, sc.subcategory_name' : 'NULL::int AS subcategory_id, NULL::text AS subcategory_name'}
      FROM products p
      ${hasCat ? 'LEFT JOIN product_categories c ON c.category_id = p.category_id' : ''}
      ${hasSub ? 'LEFT JOIN subcategories sc ON sc.subcategory_id = p.subcategory_id' : ''}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ${orderBy}
      LIMIT $${params.push(lim)} OFFSET $${params.push(off)}
    `;
    const { rows } = await db.query(sql, params);

    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM products p
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    `;
    const { rows: cnt } = await db.query(countSql, params.slice(0, params.length - 2));
    res.json({ items: rows, total: cnt[0]?.total ?? rows.length });
  } catch (err) {
    console.error('inventory GET error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* =========================================================
 * WRITE endpoints (receive/issue/sale/adjust) — คงเดิม
 * ========================================================= */
router.post('/receive', ...mustStaff, async (req, res, next) => {
  const client = await getClient();
  try {
    const { variant_id, qty, unit_cost, received_at = null, note = null } = req.body || {};

    const variantId = toInt(variant_id);
    const q = Number(qty);
    const cost = Number(unit_cost);

    if (!Number.isInteger(variantId) || !Number.isFinite(q) || !Number.isFinite(cost)) {
      return res.status(400).json({ error: 'variant_id, qty, unit_cost required' });
    }

    const v = (await db.query(
      `SELECT variant_id, product_id FROM product_variants WHERE variant_id=$1`,
      [variantId]
    )).rows[0];
    if (!v) return res.status(404).json({ error: 'variant not found' });

    await client.query('BEGIN');

    const lot = (await client.query(`
      INSERT INTO product_lots (product_id, product_variant_id, qty_initial, qty_available, cost_per_unit, received_at, note)
      VALUES ($1,$2,$3,$3,$4, COALESCE($5, NOW()), $6)
      RETURNING lot_id
    `, [v.product_id, v.variant_id, q, cost, received_at, note])).rows[0];

    const hasCreatedBy = await hasColumn('inventory_moves', 'created_by');
    const cols = ['product_id','product_variant_id','move_type','change_qty','unit_cost','lot_id','note'];
    const vals = [v.product_id, v.variant_id, 'IN', q, cost, lot.lot_id, note];
    if (hasCreatedBy) { cols.push('created_by'); vals.push(req.user?.username || req.user?.user_id || 'system'); }

    const move = (await client.query(`
      INSERT INTO inventory_moves (${cols.join(',')})
      VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
      RETURNING *
    `, vals)).rows[0];

    await client.query('COMMIT');
    res.json({ lot, move });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  } finally {
    client.release?.();
  }
});

router.post('/issue', ...mustStaff, async (req, res, next) => {
  const client = await getClient();
  try {
    const { variant_id, qty, note = null, ref_order_detail_id = null } = req.body || {};
    const variantId = toInt(variant_id);
    const requestQty = toInt(qty);

    if (!Number.isInteger(variantId) || !Number.isInteger(requestQty) || requestQty <= 0) {
      return res.status(400).json({ error: 'variant_id and positive integer qty required' });
    }

    await client.query('BEGIN');
    const out = await fifoIssue(client, {
      variantId,
      requestQty,
      note,
      ref_order_detail_id,
      createdBy: (req.user?.username || req.user?.user_id || 'system')
    });
    await client.query('COMMIT');

    res.json({
      ok: true,
      product_id: out.product_id,
      product_variant_id: out.product_variant_id,
      requested: requestQty,
      total_allocated: out.totalAllocated,
      allocations: out.allocations
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    const code = e.status || 500;
    const payload = e.payload ? { error: e.message, ...e.payload } : { error: e.message || 'Server error' };
    res.status(code).json(payload);
  } finally {
    client.release?.();
  }
});

router.post('/sale', ...mustStaff, async (req, res, next) => {
  const client = await getClient();
  try {
    const { order_id = null, items = [], note = null } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items required' });
    }

    for (const it of items) {
      if (!Number.isInteger(toInt(it?.variant_id)) || !Number.isInteger(toInt(it?.qty)) || toInt(it?.qty) <= 0) {
        return res.status(400).json({ error: 'each item requires positive integer variant_id & qty' });
      }
    }

    const createdBy = (req.user?.username || req.user?.user_id || 'system');
    await client.query('BEGIN');

    const results = [];
    for (const it of items) {
      const out = await fifoIssue(client, {
        variantId: toInt(it.variant_id),
        requestQty: toInt(it.qty),
        note: it.note ?? note,
        ref_order_detail_id: it.ref_order_detail_id ?? null,
        createdBy
      });
      results.push({
        variant_id: out.product_variant_id,
        product_id: out.product_id,
        total_allocated: out.totalAllocated,
        allocations: out.allocations
      });
    }

    await client.query('COMMIT');
    res.json({ ok: true, order_id, results });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    const code = e.status || 500;
    const payload = e.payload ? { error: e.message, ...e.payload } : { error: e.message || 'Server error' };
    res.status(code).json(payload);
  } finally {
    client.release?.();
  }
});

router.post('/adjust', ...mustStaff, async (req, res, next) => {
  try {
    const { variant_id, delta, note = null } = req.body || {};
    const r = await db.query(`SELECT product_id FROM product_variants WHERE variant_id=$1`, [Number(variant_id)]);
    if (!r.rows.length) return res.status(404).json({ error: 'variant not found' });
    const product_id = r.rows[0].product_id;

    const hasCreatedBy = await hasColumn('inventory_moves', 'created_by');
    const cols = ['product_id','product_variant_id','move_type','change_qty','unit_cost','note'];
    const vals = [product_id, Number(variant_id), 'ADJ', Number(delta), null, note];
    if (hasCreatedBy) { cols.push('created_by'); vals.push(req.user?.username || req.user?.user_id || 'system'); }

    const ins = await db.query(`
      INSERT INTO inventory_moves (${cols.join(',')})
      VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
      RETURNING *
    `, vals);

    res.json(ins.rows[0]);
  } catch (e) { next(e); }
});

router.put('/:productId', ...mustStaff, async (req, res) => {
  const client = await getClient();
  try {
    const productId = toInt(req.params.productId);
    const variantId = toInt(req.body?.variant_id);
    const target = toInt(req.body?.stock);
    const note = (req.body?.note ?? 'set stock');

    if (!Number.isInteger(productId) || !Number.isInteger(variantId)) {
      return res.status(400).json({ error: 'productId & variant_id are required (integer)' });
    }
    if (!Number.isInteger(target) || target < 0) {
      return res.status(400).json({ error: 'stock must be integer >= 0' });
    }

    const useView = await hasTable('v_product_variants_live_stock');
    if (!useView) return res.status(500).json({ error: 'stock view not found' });

    const cur = await db.query(`
      SELECT COALESCE(stock,0)::int AS stock
      FROM v_product_variants_live_stock
      WHERE product_id=$1 AND variant_id=$2
      LIMIT 1
    `, [productId, variantId]);
    const current = cur.rows[0]?.stock ?? 0;
    const delta = target - current;
    if (delta === 0) return res.json({ ok: true, product_id: productId, variant_id: variantId, variant_stock: target });

    await client.query('BEGIN');

    const hasCreatedBy = await hasColumn('inventory_moves', 'created_by');
    const cols = ['product_id','product_variant_id','move_type','change_qty','unit_cost','note'];
    const vals = [productId, variantId, 'ADJ', delta, null, note];
    if (hasCreatedBy) { cols.push('created_by'); vals.push(req.user?.username || req.user?.user_id || 'system'); }

    await client.query(
      `INSERT INTO inventory_moves (${cols.join(',')})
       VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})`,
      vals
    );

    await client.query('COMMIT');
    res.json({ ok: true, product_id: productId, variant_id: variantId, variant_stock: target });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('inventory set (ADJ) error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release?.();
  }
});

router.patch('/:productId/adjust', ...mustStaff, async (req, res) => {
  const client = await getClient();
  try {
    const productId = toInt(req.params.productId);
    const variantId = toInt(req.body?.variant_id);
    const delta = toInt(req.body?.delta);
    const note = (req.body?.note ?? null);

    if (!Number.isInteger(productId) || !Number.isInteger(variantId)) {
      return res.status(400).json({ error: 'productId & variant_id are required (integer)' });
    }
    if (!Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ error: 'delta must be a non-zero integer' });
    }

    await client.query('BEGIN');

    const v = await client.query(`
      SELECT variant_id, product_id FROM product_variants WHERE variant_id=$1
    `, [variantId]);
    if (!v.rows.length || v.rows[0].product_id !== productId) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'variant not found for this product' });
    }

    const hasCreatedBy = await hasColumn('inventory_moves', 'created_by');
    const cols = ['product_id','product_variant_id','move_type','change_qty','unit_cost','note'];
    const vals = [productId, variantId, 'ADJ', delta, null, note];
    if (hasCreatedBy) { cols.push('created_by'); vals.push(req.user?.username || req.user?.user_id || 'system'); }

    await client.query(
      `INSERT INTO inventory_moves (${cols.join(',')})
       VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})`,
      vals
    );

    await client.query('COMMIT');

    const useView = await hasTable('v_product_variants_live_stock');
    let variantStock = null, productSum = null;
    if (useView) {
      const r1 = await db.query(`
        SELECT COALESCE(stock,0)::int AS stock
        FROM v_product_variants_live_stock
        WHERE product_id=$1 AND variant_id=$2
        LIMIT 1
      `, [productId, variantId]);
      variantStock = r1.rows[0]?.stock ?? 0;

      const r2 = await db.query(`
        SELECT COALESCE(SUM(stock),0)::int AS sum_stock
        FROM v_product_variants_live_stock
        WHERE product_id=$1
      `, [productId]);
      productSum = r2.rows[0]?.sum_stock ?? 0;
    }

    res.json({ ok: true, product_id: productId, variant_id: variantId, variant_stock: variantStock, product_stock_sum: productSum });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('inventory adjust (ADJ) error:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release?.();
  }
});

/* =========================================================
 * READ: ประวัติการเคลื่อนไหว — GET /api/inventory/moves
 * ========================================================= */
router.get('/moves', ...mustStaff, async (req, res, next) => {
  try {
    const { variant_id, type, from, to, q = '', limit = 200 } = req.query;

    const cond = [];
    const p = [];

    if (variant_id) {
      p.push(Number(variant_id));
      cond.push(`m.product_variant_id = $${p.length}`);
    }
    if (type) {
      p.push(String(type).toUpperCase());
      cond.push(`m.move_type = $${p.length}`);
    }
    if (from) {
      p.push(from);
      cond.push(`m.created_at >= $${p.length}`);
    }
    if (to) {
      p.push(to);
      cond.push(`m.created_at < $${p.length}`);
    }
    if (String(q).trim()) {
      p.push(`%${String(q).trim()}%`);
      cond.push(`(p.product_name ILIKE $${p.length} OR pv.sku ILIKE $${p.length})`);
    }

    const sql = `
      SELECT
        m.move_id,
        m.product_id,
        m.product_variant_id,
        m.move_type,
        m.change_qty,
        m.unit_cost,
        m.lot_id,
        m.ref_order_detail_id,
        m.note,
        m.created_at,
        pv.sku,
        p.product_name
      FROM inventory_moves m
      LEFT JOIN product_variants pv
             ON pv.variant_id = m.product_variant_id
      LEFT JOIN products p
             ON p.product_id = m.product_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY m.created_at DESC, m.move_id DESC
      LIMIT ${Math.min(Number(limit) || 200, 1000)}
    `;

    const { rows } = await db.query(sql, p);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
