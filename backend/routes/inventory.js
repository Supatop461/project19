// backend/routes/inventory.js
/**
 * Inventory Router
 *
 * CHANGELOG
 * - 2025-10-10: (hotfix) กัน 500 เมื่อไม่มี view v_variant_stock_cost:
 *      • GET /api/inventory?scope=variant: ถ้าไม่พบวิว → fallback ไปใช้
 *        v_product_variants_live_stock (ถ้ามี) หรือ SUM(inventory_moves) (ถ้าไม่มี)
 *      • ครอบคลุมทั้งชื่อคอลัมน์ stock/stock_qty ใน v_product_variants_live_stock
 *      • เพิ่ม helper getVariantStock(), getProductStockSum() ใช้ใน ensure/put/patch
 *      • scope=product: ถ้าไม่มี live-stock view → รวมสต๊อกจาก inventory_moves
 * - 2025-10-10: (hotfix2) dynamic join column สำหรับ v_product_variants_live_stock
 *      • รองรับคีย์ในวิว: product_variant_id | variant_id | pv_id | id
 * - 2025-10-09: เพิ่ม /search/items และ /variants/ensure + FIFO issue/sale/adjust
 */

const express = require('express');

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();
const mustStaff = [requireAuth, requireRole(['admin', 'staff'])];

console.log('▶ inventory router LOADED');
router.get('/_ping', (_req, res) => res.json({ ok: true }));

/* 🔒 no-store ป้องกัน cache */
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader?.('ETag');
  res.removeHeader?.('Last-Modified');
  next();
});

/* ---------- helpers ---------- */
const toInt = (x, d = NaN) => {
  const n = Number.parseInt(String(x ?? '').trim(), 10);
  return Number.isFinite(n) ? n : d;
};

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
async function pickFirstExistingColumn(table, candidates) {
  const t = String(table || '').replace(/^public\./, '');
  for (const c of candidates) {
    if (await hasColumn(t, c)) return c;
  }
  return null;
}
async function getClient() {
  if (typeof db.getClient === 'function') return db.getClient();
  if (db.pool?.connect) return db.pool.connect();
  if (db._pool?.connect) return db._pool.connect();
  return { query: (...a) => db.query(...a), release: () => {} };
}

/** read stock of a single variant from best available source */
async function getVariantStock(variantId) {
  if (!Number.isInteger(variantId)) return 0;

  const liveView = 'v_product_variants_live_stock';
  const hasLive = await hasTable(liveView);
  if (hasLive) {
    const stockCol = (await pickFirstExistingColumn(liveView, ['stock', 'stock_qty'])) || null;
    const keyCol   = (await pickFirstExistingColumn(liveView, ['product_variant_id', 'variant_id', 'pv_id', 'id'])) || null;
    if (stockCol && keyCol) {
      const r = await db.query(
        `SELECT COALESCE(${stockCol},0)::int AS s
         FROM ${liveView}
         WHERE ${keyCol}=$1 LIMIT 1`,
        [variantId]
      );
      if (r.rows.length) return r.rows[0].s || 0;
    }
  }
  const r2 = await db.query(
    `SELECT COALESCE(SUM(change_qty),0)::int AS s
     FROM inventory_moves WHERE product_variant_id=$1`,
    [variantId]
  );
  return r2.rows[0]?.s || 0;
}

/** read sum stock of a product (sum of its variants) */
async function getProductStockSum(productId) {
  if (!Number.isInteger(productId)) return 0;

  const liveView = 'v_product_variants_live_stock';
  const hasLive = await hasTable(liveView);
  if (hasLive) {
    const stockCol = (await pickFirstExistingColumn(liveView, ['stock', 'stock_qty'])) || null;
    if (stockCol) {
      const r = await db.query(
        `SELECT COALESCE(SUM(${stockCol}),0)::int AS s
         FROM ${liveView} WHERE product_id=$1`,
        [productId]
      );
      return r.rows[0]?.s || 0;
    }
  }
  const r2 = await db.query(
    `SELECT COALESCE(SUM(m.change_qty),0)::int AS s
     FROM inventory_moves m
     JOIN product_variants v ON v.variant_id = m.product_variant_id
     WHERE v.product_id=$1`,
    [productId]
  );
  return r2.rows[0]?.s || 0;
}

/* =========================================================
 * NEW: GET /api/inventory/search/items
 *  - รวมจาก product_variants (มี SKU) + products ยังไม่มี variant
 *  - mode=out → เฉพาะ stock > 0
 * ========================================================= */
router.get('/search/items', ...mustStaff, async (req, res, next) => {
  try {
    const qRaw  = String(req.query.q || '').trim();
    if (!qRaw) return res.json([]);
    const q     = `%${qRaw}%`;
    const mode  = String(req.query.mode || 'in').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);

    const hasCostView     = await hasTable('v_variant_stock_cost');
    const hasActiveCol    = await hasColumn('product_variants', 'is_active');
    const hasArchivedProd = await hasColumn('products', 'is_archived');

    const notArchivedProd = hasArchivedProd ? `COALESCE(p.is_archived,FALSE)=FALSE AND ` : ``;
    const activeVariant   = hasActiveCol ? `COALESCE(v.is_active,TRUE)=TRUE AND ` : ``;

    // ---------- 1) variants ----------
    const varSql = hasCostView ? `
      SELECT
        v.variant_id, v.sku,
        COALESCE(vsc.stock,0)::int AS stock_qty,
        p.product_id, p.product_name,
        vsc.selling_price::numeric(10,2) AS selling_price,
        vsc.avg_cost::numeric(10,2) AS avg_cost
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN v_variant_stock_cost vsc ON vsc.variant_id = v.variant_id
      WHERE ${notArchivedProd}${activeVariant}
        (p.product_name ILIKE $1 OR v.sku ILIKE $1 OR COALESCE(p.description,'') ILIKE $1)
        ${mode === 'out' ? 'AND COALESCE(vsc.stock,0) > 0' : ''}
      ORDER BY p.product_id DESC, v.variant_id DESC
      LIMIT $2
    ` : `
      SELECT
        v.variant_id, v.sku,
        COALESCE(st.stock_qty,0)::int AS stock_qty,
        p.product_id, p.product_name,
        NULL::numeric AS selling_price,
        NULL::numeric AS avg_cost
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(m.change_qty),0) AS stock_qty
        FROM inventory_moves m
        WHERE m.product_variant_id = v.variant_id
      ) st ON TRUE
      WHERE ${notArchivedProd}${activeVariant}
        (p.product_name ILIKE $1 OR v.sku ILIKE $1 OR COALESCE(p.description,'') ILIKE $1)
        ${mode === 'out' ? 'AND COALESCE(st.stock_qty,0) > 0' : ''}
      ORDER BY p.product_id DESC, v.variant_id DESC
      LIMIT $2
    `;
    const { rows: varRows } = await db.query(varSql, [q, limit]);

    // ---------- 2) products w/o variant (only when mode !== out) ----------
    let prodRows = [];
    if (mode !== 'out') {
      const prodSql = `
        SELECT p.product_id, p.product_name
        FROM products p
        LEFT JOIN product_variants v ON v.product_id = p.product_id
        WHERE ${notArchivedProd}
          v.product_id IS NULL
          AND (p.product_name ILIKE $1 OR COALESCE(p.description,'') ILIKE $1)
        ORDER BY p.product_id DESC
        LIMIT $2
      `;
      const { rows } = await db.query(prodSql, [q, limit]);
      prodRows = rows;
    }

    // ---------- 3) merge ----------
    const variants = varRows.map(r => ({
      kind: 'variant',
      product_id: r.product_id,
      product_name: r.product_name,
      variant_id: r.variant_id,
      sku: r.sku,
      stock_qty: Number(r.stock_qty || 0),
      selling_price: r.selling_price ?? null,
      avg_cost: r.avg_cost ?? null,
      label: `${r.product_name} (${r.sku})`,
    }));
    const products = prodRows.map(r => ({
      kind: 'product',
      product_id: r.product_id,
      product_name: r.product_name,
      variant_id: null,
      sku: null,
      stock_qty: 0,
      selling_price: null,
      avg_cost: null,
      label: `${r.product_name} (ยังไม่มี SKU)`,
    }));

    const all = (mode === 'out') ? variants : [...variants, ...products];
    res.json(all.slice(0, limit));
  } catch (err) { next(err); }
});

/* =========================================================
 * NEW: POST /api/inventory/variants/ensure
 * ========================================================= */
router.post('/variants/ensure', ...mustStaff, async (req, res, next) => {
  const client = await getClient();
  try {
    const pid = toInt(req.body?.product_id);
    if (!Number.isInteger(pid) || pid <= 0) {
      return res.status(400).json({ error: 'product_id required (integer)' });
    }

    const hasActiveCol = await hasColumn('product_variants', 'is_active');

    // verify product
    const p = await db.query(`SELECT product_id, product_name FROM products WHERE product_id=$1`, [pid]);
    if (!p.rows.length) return res.status(404).json({ error: 'product not found' });

    await client.query('BEGIN');

    // existing variant → return first (active first if column exists)
    const exist = await client.query(`
      SELECT variant_id, sku FROM product_variants
      WHERE product_id=$1 ${hasActiveCol ? 'AND COALESCE(is_active,TRUE)=TRUE' : ''}
      ORDER BY variant_id ASC
      LIMIT 1
    `, [pid]);

    if (exist.rows.length) {
      await client.query('COMMIT');
      const stockQty = await getVariantStock(exist.rows[0].variant_id);
      return res.json({
        variant_id: exist.rows[0].variant_id,
        sku: exist.rows[0].sku,
        product_id: pid,
        product_name: p.rows[0]?.product_name || null,
        stock_qty: stockQty,
      });
    }

    // create new
    const base = `P${pid}`;
    const candidates = [`${base}-000`];
    for (let i = 1; i <= 50; i++) candidates.push(`${base}-${String(i).padStart(3,'0')}`);

    let created = null;
    for (const sku of candidates) {
      try {
        const cols = ['product_id','sku'].concat(hasActiveCol ? ['is_active'] : []);
        const vals = [pid, sku].concat(hasActiveCol ? [true] : []);
        const ret = (await client.query(
          `INSERT INTO product_variants (${cols.join(',')})
           VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
           RETURNING variant_id, sku`,
          vals
        )).rows[0];
        created = ret;
        break;
      } catch (e) {
        // unique violation → try next
      }
    }
    if (!created) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'cannot generate unique SKU' });
    }

    await client.query('COMMIT');

    const stockQty = await getVariantStock(created.variant_id);
    res.json({
      variant_id: created.variant_id,
      sku: created.sku,
      product_id: pid,
      product_name: p.rows[0]?.product_name || null,
      stock_qty: stockQty,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  } finally {
    client.release?.();
  }
});

/* =========================================================
 * SEARCH (เดิม): GET /api/inventory/search?q=&mode=
 * ========================================================= */
router.get('/search', ...mustStaff, async (req, res, next) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    if (!qRaw) return res.json([]);
    const q = `%${qRaw}%`;
    const mode = String(req.query.mode || 'in').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);

    const hasCostView     = await hasTable('v_variant_stock_cost');
    const hasActiveCol    = await hasColumn('product_variants', 'is_active');
    const hasArchivedProd = await hasColumn('products', 'is_archived');

    const notArchivedProd = hasArchivedProd ? `COALESCE(p.is_archived,FALSE)=FALSE AND ` : ``;
    const activeVariant   = hasActiveCol ? `v.is_active=TRUE AND ` : ``;

    const stockFilterView    = (mode === 'out') ? `AND COALESCE(vsc.stock,0) > 0` : ``;
    const stockFilterLateral = (mode === 'out') ? `AND COALESCE(st.stock_qty,0) > 0` : ``;

    const sql = hasCostView ? `
      SELECT
        v.variant_id, v.sku,
        COALESCE(vsc.stock,0)::int AS stock,
        p.product_id, p.product_name,
        vsc.selling_price, vsc.avg_cost
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN v_variant_stock_cost vsc ON vsc.variant_id = v.variant_id
      WHERE ${notArchivedProd}${activeVariant}
        (p.product_name ILIKE $1 OR v.sku ILIKE $1 OR COALESCE(p.description,'') ILIKE $1)
        ${stockFilterView}
      ORDER BY p.product_id DESC, v.variant_id DESC
      LIMIT $2
    ` : `
      SELECT
        v.variant_id, v.sku,
        COALESCE(st.stock_qty,0)::int AS stock,
        p.product_id, p.product_name,
        NULL::numeric AS selling_price,
        NULL::numeric AS avg_cost
      FROM product_variants v
      JOIN products p ON p.product_id = v.product_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(m.change_qty),0) AS stock_qty
        FROM inventory_moves m
        WHERE m.product_variant_id = v.variant_id
      ) st ON TRUE
      WHERE ${notArchivedProd}${activeVariant}
        (p.product_name ILIKE $1 OR v.sku ILIKE $1 OR COALESCE(p.description,'') ILIKE $1)
        ${stockFilterLateral}
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
  } catch (err) { next(err); }
});

/* ---------- FIFO core ---------- */
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
  const hasRefOrder  = await hasColumn('inventory_moves', 'ref_order_detail_id');
  const hasCreatedAt = await hasColumn('inventory_moves', 'created_at');

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

    if (hasRefOrder)  { cols.push('ref_order_detail_id'); vals.push(ref_order_detail_id); }
    if (hasCreatedBy) { cols.push('created_by');         vals.push(createdBy); }

    const returning = hasCreatedAt ? 'RETURNING move_id, created_at' : 'RETURNING move_id';
    const move = (await client.query(
      `INSERT INTO inventory_moves (${cols.join(',')})
       VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
       ${returning}`,
      vals
    )).rows[0];

    allocations.push({
      lot_id: lot.lot_id,
      allocated_qty: canTake,
      unit_cost: lot.cost_per_unit,
      move_id: move.move_id,
      move_at: hasCreatedAt ? move.created_at : new Date()
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
 * READ: GET /api/inventory?scope=product|variant
 * ========================================================= */
router.get('/', ...mustStaff, async (req, res) => {
  try {
    const { search = '', limit = 20, offset = 0, order = 'low_stock', scope = 'product' } = req.query;

    const lim = Math.min(Math.max(parseInt(limit || 20, 10), 1), 100);
    const off = Math.max(parseInt(offset || 0, 10), 0);

    const useLiveView = await hasTable('v_product_variants_live_stock');
    const liveStockCol = useLiveView ? (await pickFirstExistingColumn('v_product_variants_live_stock', ['stock', 'stock_qty'])) : null;
    const liveKeyCol   = useLiveView ? (await pickFirstExistingColumn('v_product_variants_live_stock', ['product_variant_id','variant_id','pv_id','id'])) : null;

    if (String(scope).toLowerCase() === 'variant') {
      const hasCostView = await hasTable('v_variant_stock_cost');

      // เงื่อนไขค้นหา (ใช้ชื่อ/sku/variant_name ถ้ามี)
      const params = [];
      const where = [];
      const q = String(search).trim();

      if (hasCostView && q) {
        // ใช้วิว cost ได้ → concat ตามคอลัมน์ที่มี
        const hasProdName  = await hasColumn('v_variant_stock_cost', 'product_name');
        const hasProdTitle = await hasColumn('v_variant_stock_cost', 'product_title');
        const hasVarName   = await hasColumn('v_variant_stock_cost', 'variant_name');
        const hasSku       = await hasColumn('v_variant_stock_cost', 'sku');
        const searchableCols = []
          .concat(hasProdName  ? [`COALESCE(vsc.product_name,'')`] : [])
          .concat(hasProdTitle ? [`COALESCE(vsc.product_title,'')`] : [])
          .concat(hasVarName   ? [`COALESCE(vsc.variant_name,'')`] : [])
          .concat(hasSku       ? [`COALESCE(vsc.sku,'')`] : []);
        if (searchableCols.length) {
          params.push(`%${q}%`);
          where.push(`( ${searchableCols.join(` || ' ' || `)} ILIKE $${params.length} )`);
        }
      }

      let orderBy = '1';
      if (hasCostView) {
        orderBy = {
          low_stock:  'COALESCE(vsc.stock,0) ASC, vsc.variant_id ASC',
          newest:     'vsc.product_id DESC, vsc.variant_id ASC',
          name_asc:   'COALESCE(vsc.product_name, vsc.product_title, vsc.variant_name, vsc.sku) ASC, vsc.variant_id ASC',
          name_desc:  'COALESCE(vsc.product_name, vsc.product_title, vsc.variant_name, vsc.sku) DESC, vsc.variant_id ASC',
          price_asc:  'vsc.selling_price ASC NULLS LAST, vsc.variant_id ASC',
          price_desc: 'vsc.selling_price DESC NULLS LAST, vsc.variant_id ASC',
        }[String(order).toLowerCase()] || 'vsc.variant_id ASC';
      } else if (useLiveView && liveStockCol) {
        orderBy = (String(order).toLowerCase() === 'name_asc')
          ? 'p.product_name ASC, pv.variant_id ASC'
          : (String(order).toLowerCase() === 'name_desc')
          ? 'p.product_name DESC, pv.variant_id ASC'
          : `COALESCE(ls.${liveStockCol},0) ASC, pv.variant_id ASC`;
      } else {
        orderBy = (String(order).toLowerCase() === 'name_asc')
          ? 'p.product_name ASC, pv.variant_id ASC'
          : (String(order).toLowerCase() === 'name_desc')
          ? 'p.product_name DESC, pv.variant_id ASC'
          : 'pv.variant_id ASC';
      }

      let rows = [];
      let total = 0;

      if (hasCostView) {
        // มีวิว cost → ใช้ได้เต็ม
        const sql = `
          SELECT
            vsc.variant_id, vsc.product_id, vsc.sku,
            COALESCE(vsc.product_name, vsc.product_title, vsc.variant_name, vsc.sku) AS product_name,
            COALESCE(vsc.stock,0)::int AS stock,
            vsc.selling_price::numeric(10,2) AS selling_price,
            vsc.avg_cost::numeric(10,2) AS avg_cost
          FROM v_variant_stock_cost vsc
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
          ORDER BY ${orderBy}
          LIMIT $${params.push(lim)} OFFSET $${params.push(off)}
        `;
        const { rows: a } = await db.query(sql, params);
        rows = a;
        const cntSql = `
          SELECT COUNT(*)::int AS total FROM v_variant_stock_cost vsc
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        `;
        const { rows: cnt } = await db.query(cntSql, params.slice(0, params.length - 2));
        total = cnt[0]?.total ?? rows.length;
      } else if (useLiveView && liveStockCol) {
        // ไม่มี cost view → ใช้ live stock + join products (dynamic key)
        const p = [];
        const cond = [];
        if (q) {
          p.push(`%${q}%`, `%${q}%`);
          cond.push(`(p.product_name ILIKE $${p.length - 1} OR pv.sku ILIKE $${p.length})`);
        }
        // ถ้าไม่มี keyCol ในวิว ให้ตัด fallback เป็น lateral (ด้านล่าง else)
        if (liveKeyCol) {
          const sql = `
            SELECT
              pv.variant_id, pv.product_id, pv.sku,
              p.product_name,
              COALESCE(ls.${liveStockCol},0)::int AS stock,
              NULL::numeric AS selling_price,
              NULL::numeric AS avg_cost
            FROM product_variants pv
            JOIN products p ON p.product_id = pv.product_id
            LEFT JOIN v_product_variants_live_stock ls ON ls.${liveKeyCol} = pv.variant_id
            ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
            ORDER BY ${orderBy}
            LIMIT ${lim} OFFSET ${off}
          `;
          const { rows: a } = await db.query(sql, p);
          rows = a;

          const cntSql = `
            SELECT COUNT(*)::int AS total
            FROM product_variants pv
            JOIN products p ON p.product_id = pv.product_id
            ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
          `;
          const { rows: cnt } = await db.query(cntSql, p);
          total = cnt[0]?.total ?? rows.length;
        } else {
          // ไม่มี key ในวิว → ใช้ lateral sum แทน
          const sql = `
            SELECT
              pv.variant_id, pv.product_id, pv.sku,
              p.product_name,
              COALESCE(st.stock_qty,0)::int AS stock,
              NULL::numeric AS selling_price,
              NULL::numeric AS avg_cost
            FROM product_variants pv
            JOIN products p ON p.product_id = pv.product_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(m.change_qty),0) AS stock_qty
              FROM inventory_moves m
              WHERE m.product_variant_id = pv.variant_id
            ) st ON TRUE
            ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
            ORDER BY ${String(order).toLowerCase() === 'name_asc'
              ? 'p.product_name ASC, pv.variant_id ASC'
              : String(order).toLowerCase() === 'name_desc'
              ? 'p.product_name DESC, pv.variant_id ASC'
              : 'st.stock_qty ASC, pv.variant_id ASC'}
            LIMIT ${lim} OFFSET ${off}
          `;
          const { rows: a } = await db.query(sql, p);
          rows = a;

          const cntSql = `
            SELECT COUNT(*)::int AS total
            FROM product_variants pv
            JOIN products p ON p.product_id = pv.product_id
            ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
          `;
          const { rows: cnt } = await db.query(cntSql, p);
          total = cnt[0]?.total ?? rows.length;
        }
      } else {
        // ไม่มีทั้ง cost view และ live view → คำนวณจาก inventory_moves แบบ LATERAL
        const p = [];
        const cond = [];
        if (q) {
          p.push(`%${q}%`, `%${q}%`);
          cond.push(`(p.product_name ILIKE $${p.length - 1} OR pv.sku ILIKE $${p.length})`);
        }
        const sql = `
          SELECT
            pv.variant_id, pv.product_id, pv.sku,
            p.product_name,
            COALESCE(st.stock_qty,0)::int AS stock,
            NULL::numeric AS selling_price,
            NULL::numeric AS avg_cost
          FROM product_variants pv
          JOIN products p ON p.product_id = pv.product_id
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(m.change_qty),0) AS stock_qty
            FROM inventory_moves m
            WHERE m.product_variant_id = pv.variant_id
          ) st ON TRUE
          ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
          ORDER BY ${String(order).toLowerCase() === 'name_asc'
            ? 'p.product_name ASC, pv.variant_id ASC'
            : String(order).toLowerCase() === 'name_desc'
            ? 'p.product_name DESC, pv.variant_id ASC'
            : 'st.stock_qty ASC, pv.variant_id ASC'}
          LIMIT ${lim} OFFSET ${off}
        `;
        const { rows: a } = await db.query(sql, p);
        rows = a;

        const cntSql = `
          SELECT COUNT(*)::int AS total
          FROM product_variants pv
          JOIN products p ON p.product_id = pv.product_id
          ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
        `;
        const { rows: cnt } = await db.query(cntSql, p);
        total = cnt[0]?.total ?? rows.length;
      }

      return res.json({
        items: rows.map(r => ({
          variant_id: r.variant_id,
          product_id: r.product_id,
          sku: r.sku,
          product_name: r.product_name,
          stock: r.stock,
          selling_price: r.selling_price,
          avg_cost: r.avg_cost,
        })),
        total
      });
    }

    // ---------- scope=product ----------
    const params = [];
    const where = [];
    if (String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      params.push(q, q);
      where.push(`(p.product_name ILIKE $${params.length - 1} OR p.description ILIKE $${params.length})`);
    }

    // สร้าง stockExpr ตามแหล่งข้อมูลที่มี
    let stockExpr = '0::int';
    if (useLiveView && liveStockCol) {
      stockExpr = `(SELECT COALESCE(SUM(v.${liveStockCol}),0)::int FROM v_product_variants_live_stock v WHERE v.product_id = p.product_id)`;
    } else {
      stockExpr = `(
        SELECT COALESCE(SUM(m.change_qty),0)::int
        FROM inventory_moves m
        JOIN product_variants vv ON vv.variant_id = m.product_variant_id
        WHERE vv.product_id = p.product_id
      )`;
    }

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
 * WRITE endpoints
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

    await client.query(`
      INSERT INTO inventory_moves (${cols.join(',')})
      VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})
    `, vals);

    await client.query('COMMIT');
    res.json({ lot });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    next(e);
  } finally {
    client.release?.();
  }
});

router.post('/issue', ...mustStaff, async (req, res) => {
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
    console.error('issue error:', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
  } finally {
    client.release?.();
  }
});

router.post('/sale', ...mustStaff, async (req, res) => {
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
    console.error('sale error:', e);
    res.status(e.status || 500).json({ error: e.message || 'Server error' });
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

    const current = await getVariantStock(variantId);
    const delta = target - current;
    if (delta === 0) {
      return res.json({ ok: true, product_id: productId, variant_id: variantId, variant_stock: target });
    }

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

    const variantStock = await getVariantStock(variantId);
    const productSum = await getProductStockSum(productId);

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

    if (variant_id) { p.push(Number(variant_id)); cond.push(`m.product_variant_id = $${p.length}`); }
    if (type)      { p.push(String(type).toUpperCase()); cond.push(`m.move_type = $${p.length}`); }
    if (from)      { p.push(from);  cond.push(`m.created_at >= $${p.length}`); }
    if (to)        { p.push(to);    cond.push(`m.created_at <  $${p.length}`); }
    if (String(q).trim()) {
      p.push(`%${String(q).trim()}%`);
      cond.push(`(p.product_name ILIKE $${p.length} OR pv.sku ILIKE $${p.length})`);
    }

    const sql = `
      SELECT
        m.move_id, m.product_id, m.product_variant_id, m.move_type,
        m.change_qty, m.unit_cost, m.lot_id, m.ref_order_detail_id,
        m.note, m.created_at, pv.sku, p.product_name
      FROM inventory_moves m
      LEFT JOIN product_variants pv ON pv.variant_id = m.product_variant_id
      LEFT JOIN products p ON p.product_id = m.product_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY m.created_at DESC, m.move_id DESC
      LIMIT ${Math.min(Number(limit) || 200, 1000)}
    `;
    const { rows } = await db.query(sql, p);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
