// backend/routes/orders.js
// ======================================================================
// ORDERS ROUTER — resilient to schema differences (2025-10-22)
// - Create order (with optional slip), list my orders
// - Admin list, admin detail, update status, new-count
// - Auto-detect: table/column names (order_items vs order_details, etc.)
// - Use DB transaction for atomic create
// ======================================================================

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const router = express.Router();

let db;
try { db = require("../db"); } catch { db = require("../db/db"); }

// ---- auth middleware (fallback no-op if missing) ----
const { requireAuth, requireRole } = (() => {
  try { return require("../middleware/auth"); }
  catch {
    return {
      requireAuth: (_req, _res, next) => next(),
      requireRole: (_role) => (_req, _res, next) => next(),
    };
  }
})();

// ---- upload config (payment slip) ----
const uploadDir = path.join(__dirname, "../uploads/payments");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

/* ------------------------ Schema helpers ------------------------ */
async function tableExists(table) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1 LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}
async function colExists(table, col) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return rows.length > 0;
}

/** Detect runtime schema mapping */
async function detectSchema() {
  // orders table is assumed to exist
  const ordersTable = "orders";

  // totals
  const totalCol = (await colExists(ordersTable, "total_amount"))
    ? "total_amount"
    : (await colExists(ordersTable, "total_price")) ? "total_price" : null;

  // shipping fee
  const shipCol = (await colExists(ordersTable, "shipping_fee"))
    ? "shipping_fee"
    : (await colExists(ordersTable, "shipping_cost")) ? "shipping_cost" : null;

  // status columns (pick one primary, optionally second)
  const statusIdCol = (await colExists(ordersTable, "order_status_id"))
    ? "order_status_id"
    : (await colExists(ordersTable, "order_status")) ? "order_status" : null;
  const legacyStatusCol = (await colExists(ordersTable, "status")) ? "status" : null;

  // payment slip
  const slipCol = (await colExists(ordersTable, "payment_slip_url"))
    ? "payment_slip_url"
    : (await colExists(ordersTable, "payment_slip")) ? "payment_slip" : null;

  // address linkage (optional)
  const addressCol = (await colExists(ordersTable, "address_id"))
    ? "address_id"
    : (await colExists(ordersTable, "shipping_address_id")) ? "shipping_address_id" : null;

  // note (optional)
  const noteCol = (await colExists(ordersTable, "note")) ? "note" : null;

  // items table detection
  const detailsTable = (await tableExists("order_items"))
    ? "order_items"
    : (await tableExists("order_details")) ? "order_details" : null;

  // items columns
  let variantCol = "product_variant_id";
  if (detailsTable) {
    if (!(await colExists(detailsTable, variantCol))) {
      variantCol = (await colExists(detailsTable, "sku_id")) ? "sku_id" : variantCol;
    }
  }
  const qtyCol = (detailsTable && (await colExists(detailsTable, "quantity"))) ? "quantity" : "qty";
  const priceCol = (detailsTable && (await colExists(detailsTable, "price")))
    ? "price"
    : (detailsTable && (await colExists(detailsTable, "unit_price"))) ? "unit_price" : null;
  const subtotalCol = (detailsTable && (await colExists(detailsTable, "subtotal")))
    ? "subtotal"
    : (detailsTable && (await colExists(detailsTable, "line_total"))) ? "line_total" : null;

  return {
    ordersTable,
    totalCol,
    shipCol,
    statusIdCol,
    legacyStatusCol,
    slipCol,
    addressCol,
    noteCol,
    detailsTable,
    variantCol,
    qtyCol,
    priceCol,
    subtotalCol,
  };
}

/* ======================================================================
   ลูกค้า: POST /api/orders (สร้างคำสั่งซื้อ + แนบสลิป) — atomic
   ====================================================================== */
router.post("/", requireAuth, upload.single("payment_slip"), async (req, res) => {
  const client = await db.getClient ? await db.getClient() : await db.pool.connect();
  try {
    const schema = await detectSchema();
    const { ordersTable, totalCol, shipCol, statusIdCol, legacyStatusCol, slipCol,
            addressCol, noteCol, detailsTable, variantCol, qtyCol, priceCol, subtotalCol } = schema;

    if (!detailsTable) throw new Error("No order items/details table found.");
    if (!totalCol) throw new Error("orders total column not found (total_amount/total_price).");
    if (!shipCol) throw new Error("orders shipping column not found (shipping_fee/shipping_cost).");
    if (!statusIdCol && !legacyStatusCol) throw new Error("No status column (order_status_id/order_status/status).");

    const { user_id } = req.user || {};
    if (!user_id) return res.status(401).json({ ok: false, error: "Unauthenticated" });

    const {
      items = [],
      total_amount,      // may map to total_price
      shipping_fee = 0,  // may map to shipping_cost
      address_id,
      note,
      order_status = "pending", // default incoming desired status
    } = req.body;

    // Prepare insertable fields dynamically
    const cols = ["user_id", totalCol, shipCol];
    const vals = [user_id, total_amount, shipping_fee];
    const placeholders = ["$1", "$2", "$3"];
    let p = 4;

    // slip
    const paymentSlipUrl = req.file ? `/uploads/payments/${req.file.filename}` : null;
    if (slipCol) {
      cols.push(slipCol);
      vals.push(paymentSlipUrl);
      placeholders.push(`$${p++}`);
    }

    // primary status column
    if (statusIdCol) {
      cols.push(statusIdCol);
      vals.push(order_status);     // text or enum/int—DB will validate
      placeholders.push(`$${p++}`);
    }
    // optional legacy status column to keep compatibility
    if (legacyStatusCol) {
      cols.push(legacyStatusCol);
      vals.push("new");
      placeholders.push(`$${p++}`);
    }

    // address
    if (addressCol && (address_id ?? null) !== null) {
      cols.push(addressCol);
      vals.push(address_id);
      placeholders.push(`$${p++}`);
    }

    // note
    if (noteCol && (note ?? null) !== null) {
      cols.push(noteCol);
      vals.push(note);
      placeholders.push(`$${p++}`);
    }

    // Transaction start
    await client.query("BEGIN");

    const insertSql =
      `INSERT INTO ${ordersTable} (${cols.join(",")})
       VALUES (${placeholders.join(",")})
       RETURNING order_id`;
    const { rows } = await client.query(insertSql, vals);
    const orderId = rows[0].order_id;

    // Insert items (batch)
    if (Array.isArray(items) && items.length > 0) {
      // Ensure required columns available
      if (!priceCol) throw new Error(`No price column in ${detailsTable} (expected price or unit_price)`);
      if (!subtotalCol) throw new Error(`No subtotal column in ${detailsTable} (expected subtotal or line_total)`);

      const rowTpl = items
        .map((_x, i) =>
          `($1, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4}, $${i * 4 + 5})`
        )
        .join(",");

      const flat = items.flatMap((x) => [
        x.product_variant_id ?? x.sku_id,
        x.quantity ?? x.qty ?? 1,
        x.price ?? x.unit_price ?? 0,
        x.subtotal ?? x.line_total ?? ((x.price ?? 0) * (x.quantity ?? 1)),
      ]);

      const insertItemsSql =
        `INSERT INTO ${detailsTable}
           (order_id, ${variantCol}, ${qtyCol}, ${priceCol}, ${subtotalCol})
         VALUES ${rowTpl}`;

      await client.query(insertItemsSql, [orderId, ...flat]);
    }

    await client.query("COMMIT");
    res.json({ success: true, order_id: orderId });
  } catch (err) {
    try { await (db.getClient ? db.getClient() : db.pool).query("ROLLBACK"); } catch {}
    console.error("create order error:", err);
    res.status(500).json({ error: "Failed to create order", detail: String(err.message || err) });
  } finally {
    try { client.release(); } catch {}
  }
});

/* ======================================================================
   ลูกค้า: GET /api/orders (ของตัวเอง)
   ====================================================================== */
router.get("/", requireAuth, async (req, res) => {
  try {
    const s = await detectSchema();
    const dtab = s.detailsTable;
    const { user_id } = req.user;

    const sql = `
      SELECT o.*,
        COALESCE(
          json_agg(json_build_object(
            'variant', d.${s.variantCol},
            'quantity', d.${s.qtyCol},
            'price', d.${s.priceCol},
            'subtotal', d.${s.subtotalCol}
          ) ORDER BY d.${s.variantCol})
          FILTER (WHERE d.${s.variantCol} IS NOT NULL), '[]'
        ) AS items
      FROM ${s.ordersTable} o
      LEFT JOIN ${dtab} d ON d.order_id = o.order_id
      WHERE o.user_id = $1
      GROUP BY o.order_id
      ORDER BY o.order_id DESC
    `;
    const { rows } = await db.query(sql, [user_id]);
    res.json(rows);
  } catch (err) {
    console.error("get my orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* ======================================================================
   แอดมิน: GET /api/admin/orders (รวมทุกคำสั่งซื้อ)
   หมายเหตุ: ไว้ในไฟล์เดียวเพื่อให้แน่ใจว่า path ตรงกับฝั่งหน้าเว็บ
   ====================================================================== */
router.get("/admin/orders", requireRole("admin"), async (_req, res) => {
  try {
    const s = await detectSchema();

    const userNameCol = (await colExists("users", "full_name"))
      ? "full_name"
      : (await colExists("users", "name")) ? "name" : "email";

    const sql = `
      SELECT
        o.order_id, o.user_id,
        o.${s.totalCol} AS grand_total,
        ${s.shipCol ? `o.${s.shipCol}` : "0"} AS shipping_fee,
        ${s.slipCol ? `o.${s.slipCol}` : "NULL"} AS payment_slip_url,
        ${s.statusIdCol ? `o.${s.statusIdCol}` : "NULL"} AS order_status,
        ${s.legacyStatusCol ? `o.${s.legacyStatusCol}` : "NULL"} AS status_legacy,
        o.created_at, o.updated_at,
        u.${userNameCol} AS customer_name,
        COALESCE(
          json_agg(json_build_object(
            'variant', d.${s.variantCol},
            'quantity', d.${s.qtyCol},
            'price', d.${s.priceCol},
            'subtotal', d.${s.subtotalCol}
          ) ORDER BY d.${s.variantCol})
          FILTER (WHERE d.${s.variantCol} IS NOT NULL), '[]'
        ) AS items
      FROM ${s.ordersTable} o
      LEFT JOIN users u ON u.user_id = o.user_id
      LEFT JOIN ${s.detailsTable} d ON d.order_id = o.order_id
      GROUP BY o.order_id, u.${userNameCol}
      ORDER BY o.order_id DESC
      LIMIT 500
    `;
    const { rows } = await db.query(sql);
    res.json(rows);
  } catch (err) {
    console.error("admin list orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

/* ======================================================================
   แอดมิน: PUT /api/admin/orders/:id/status
   ====================================================================== */
router.put("/admin/orders/:id/status", requireRole("admin"), async (req, res) => {
  try {
    const s = await detectSchema();
    if (!s.statusIdCol && !s.legacyStatusCol) {
      return res.status(400).json({ error: "No status column to update" });
    }
    const { id } = req.params;
    const { order_status_id, order_status } = req.body;
    const newStatus = order_status_id ?? order_status ?? "paid";

    // prefer statusIdCol then legacy
    const setClause = s.statusIdCol
      ? `${s.statusIdCol} = $1`
      : `${s.legacyStatusCol} = $1`;

    const sql = `
      UPDATE ${s.ordersTable}
      SET ${setClause}, updated_at = NOW()
      WHERE order_id = $2
      RETURNING *
    `;
    const { rows } = await db.query(sql, [newStatus, id]);
    if (!rows.length) return res.status(404).json({ error: "Order not found" });
    res.json({ success: true, order: rows[0] });
  } catch (err) {
    console.error("update order status error:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

/* ======================================================================
   แอดมิน/แดชบอร์ด: GET /api/orders/new-count
   ====================================================================== */
router.get("/new-count", requireRole("admin"), async (_req, res) => {
  try {
    const s = await detectSchema();
    // match a few common "new/pending" states
    const where =
      s.statusIdCol
        ? `(${s.statusIdCol} IS NULL OR ${s.statusIdCol} IN ('new','pending','unpaid', 'awaiting_payment'))`
        : s.legacyStatusCol
          ? `(${s.legacyStatusCol} IS NULL OR ${s.legacyStatusCol} IN ('new','pending','unpaid', 'awaiting_payment'))`
          : `false`;

    const sql = `SELECT COUNT(*)::int AS count FROM ${s.ordersTable} WHERE ${where}`;
    const { rows } = await db.query(sql);
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    console.error("count orders error:", err);
    res.status(500).json({ error: "Failed to count orders" });
  }
});

/* ======================================================================
   แอดมิน: GET /api/admin/orders/:id
   ====================================================================== */
router.get("/admin/orders/:id", requireRole("admin"), async (req, res) => {
  try {
    const s = await detectSchema();
    const userNameCol = (await colExists("users", "full_name"))
      ? "full_name"
      : (await colExists("users", "name")) ? "name" : "email";

    const sql = `
      SELECT o.*, u.${userNameCol} AS customer_name, u.email,
        COALESCE(
          json_agg(json_build_object(
            'variant', d.${s.variantCol},
            'quantity', d.${s.qtyCol},
            'price', d.${s.priceCol},
            'subtotal', d.${s.subtotalCol}
          ) ORDER BY d.${s.variantCol})
          FILTER (WHERE d.${s.variantCol} IS NOT NULL), '[]'
        ) AS items
      FROM ${s.ordersTable} o
      LEFT JOIN users u ON u.user_id = o.user_id
      LEFT JOIN ${s.detailsTable} d ON d.order_id = o.order_id
      WHERE o.order_id = $1
      GROUP BY o.order_id, u.${userNameCol}, u.email
    `;
    const { rows } = await db.query(sql, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Order not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("get order detail error:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

module.exports = router;
