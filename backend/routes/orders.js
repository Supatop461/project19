// backend/routes/orders.js
// API จัดการคำสั่งซื้อ: สร้างบิล, เพิ่มรายการด้วย SKU, ค้นหา/กรอง/เพจจิ้ง,
// รายละเอียด (รวมรูป/ตัวเลือก), อัปเดตสถานะ, อัปเดตเลขพัสดุ, ส่งออก CSV, ส่งเมลแจ้งเตือน
// โน้ต:
// - ใช้ SKU-first: ทุกบรรทัดใน order_details ต้องมี sku_id (= variant_id)
// - ตั้ง UNIQUE(order_id, sku_id) ที่ DB เพื่อให้ upsert รวมบรรทัดเดิมอัตโนมัติ
// - สำหรับรูป: ใช้ v_variant_images เป็นแหล่งจริง ถ้าไม่มี ให้ fallback เป็น products.image_url ระดับ API ฝั่ง variants

const express = require('express');
const router = express.Router();

let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

console.log('▶ orders router LOADED');

const DRAFT_STATUS_ID = process.env.ORDER_STATUS_DRAFT_ID || 'pending';
const PAID_STATUS_ID  = process.env.ORDER_STATUS_PAID_ID  || 'paid';

/* ============================ Mail Setup ============================ */
let mailer;
try { mailer = require('../lib/mailer'); } catch { /* not found yet */ }

const templates = (() => {
  try { return require('../lib/emailTemplates'); }
  catch { return null; }
})();

const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL || 'http://localhost:5173').replace(/\/+$/,'');
const ADMIN_BASE    = (process.env.ADMIN_BASE_URL || `${FRONTEND_BASE}/admin`).replace(/\/+$/,'');
const ADMIN_EMAILS  = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// support both exports: module.exports = { sendMail } or module.exports = fn
const sendMailFn =
  (mailer && typeof mailer.sendMail === 'function') ? (opts) => mailer.sendMail(opts)
  : (typeof mailer === 'function') ? (opts) => mailer(opts)
  : null;

async function trySendMail({ to, subject, html, cc, bcc }) {
  if (!sendMailFn) {
    console.warn('⚠ mailer not available: skip send', { to, subject });
    return { skipped: true };
  }
  try {
    return await sendMailFn({ to, subject, html, cc, bcc });
  } catch (err) {
    console.error('sendMail error:', err);
    return { ok: false, error: String(err) };
  }
}

/* ============================ Helpers ============================ */
// แปลงเป็นจำนวนเต็มบวก (กันค่าพัง ๆ สำหรับเพจจิ้ง)
function toPosInt(val, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}
// หนีอักขระ % _ \ สำหรับ LIKE/ILIKE
function escapeLike(str = '') {
  return String(str).replace(/[\\%_]/g, ch => '\\' + ch);
}
// loopback base URL สำหรับเรียก inventory/sale
function getBaseUrl() {
  const port = process.env.PORT || 3001;
  const base = process.env.API_BASE_URL || `http://localhost:${port}`;
  return base.replace(/\/+$/, '');
}
// ใช้ fetch (Node 18+ มีอยู่แล้ว; ถ้าไม่มีลองโหลด node-fetch)
let _fetch = global.fetch;
if (typeof _fetch !== 'function') {
  try { _fetch = require('node-fetch'); } catch { /* จะ error ตอนเรียกเอง */ }
}
// เช็คว่าเป็นแอดมินไหม
function isAdmin(req) {
  const r = req.user?.role_id || req.user?.role || req.user?.roleId;
  return String(r).toLowerCase() === 'admin';
}
// ดึง user_id จาก token
function getUserId(req) {
  const uid = Number(req.user?.user_id || req.user?.id);
  return Number.isFinite(uid) ? uid : null;
}
// สร้างลิงก์สำหรับลูกค้า/แอดมิน
function buildLinks(order_id) {
  return {
    order_link: `${FRONTEND_BASE}/orders/${order_id}`,
    admin_order_link: `${ADMIN_BASE}/orders/${order_id}`,
  };
}

/* ====== service: คำนวณรวมยอดแล้วเซฟลง orders.total_amount (เพื่อความเร็ว) ====== */
async function recomputeOrderTotal(orderId, clientOrDb = db) {
  const { rows } = await clientOrDb.query(`
    UPDATE orders o
       SET total_amount = COALESCE(src.sum_total, 0),
           updated_at   = NOW()
      FROM (
        SELECT od.order_id, SUM(od.quantity * od.selling_price_at_order_time)::float8 AS sum_total
        FROM order_details od
        WHERE od.order_id = $1
        GROUP BY od.order_id
      ) AS src
     WHERE o.order_id = src.order_id
     RETURNING o.total_amount;
  `, [orderId]);
  return rows[0]?.total_amount ?? 0;
}

/* ============ โหลดข้อมูลสำหรับอีเมล (order + items + user) ============ */
async function loadOrderEmailData(orderId, clientOrDb = db) {
  // order + user
 const orderSql = `
  SELECT
    o.order_id,
    o.user_id,
    o.order_date,
    o.tracking_number,
    o.order_status_id,
    s.order_status_name,
    COALESCE(o.total_amount, SUM(od.quantity * od.selling_price_at_order_time), 0)::float8 AS total_amount,
    u.email AS customer_email,
    -- ใช้ first_name + last_name; ว่างให้ fallback เป็นอีเมล
    COALESCE(
      NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), ''),
      u.email
    ) AS customer_name
  FROM orders o
  JOIN order_statuses s ON s.order_status_id = o.order_status_id
  LEFT JOIN order_details od ON od.order_id = o.order_id
  LEFT JOIN users u ON u.user_id = o.user_id
  WHERE o.order_id = $1
  GROUP BY
    o.order_id, o.user_id, o.order_date, o.tracking_number,
    o.order_status_id, s.order_status_name, o.total_amount,
    u.email, u.first_name, u.last_name
`;


  const orderR = await clientOrDb.query(orderSql, [orderId]);
  if (!orderR.rows.length) return null;

  const itemsSql = `
    SELECT
      od.order_detail_id,
      od.product_id,
      p.product_name AS name,
      od.sku_id                        AS variant_id,
      v.sku,
      od.quantity                      AS qty,
      od.selling_price_at_order_time::float8 AS unit_price,
      (od.quantity * od.selling_price_at_order_time)::float8 AS line_total
    FROM order_details od
    JOIN products p          ON p.product_id = od.product_id
    JOIN product_variants v  ON v.variant_id = od.sku_id
    WHERE od.order_id = $1
    ORDER BY od.order_detail_id
  `;
  const itemsR = await clientOrDb.query(itemsSql, [orderId]);

  const { order_id, order_date, order_status_id, order_status_name, total_amount,
          customer_email, customer_name, tracking_number } = orderR.rows[0];

  const { order_link, admin_order_link } = buildLinks(order_id);

  return {
    order_id,
    order_date,
    status_id: order_status_id,
    status_name: order_status_name,
    total_amount,
    tracking_number,
    customer_email,
    customer_name,
    items: itemsR.rows.map(it => ({
      product_name: it.name,
      qty: it.qty,
      price: it.unit_price
    })),
    order_link,
    admin_order_link
  };
}

/* ============================ Debug ============================= */
router.get('/_debug', (_req, res) => res.json({ ok: true }));

/* ================ สร้างบิล Draft เปล่า ================ */
// POST /api/orders  → { order_id }
// (รองรับ guest: user_id อาจเป็น null; หากอยากบังคับล็อกอิน ให้เช็คและ return 401)
router.post('/', async (req, res) => {
  try {
    const userId = getUserId(req); // ผูกเจ้าของออเดอร์ (อาจเป็น null ถ้า guest)
    const r = await db.query(
      `INSERT INTO orders (user_id, order_status_id, order_date, created_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING order_id`,
      [userId, DRAFT_STATUS_ID]
    );

    const payload = r.rows[0];
    res.status(201).json(payload);

    // ---- Hook Email: ลูกค้า (ยืนยันคำสั่งซื้อ) + แอดมิน (ออเดอร์ใหม่) ----
    // หมายเหตุ: อีเมลนี้จะ total=0 ถ้ายังไม่มี items; ถ้าต้องการยอดจริง ย้าย hook ไปจุด checkout
    if (templates) {
      loadOrderEmailData(payload.order_id)
        .then(data => {
          if (!data) return;

          // ลูกค้า
          if (data.customer_email) {
            const { subject, html } = templates.buildOrderConfirmation({
              order_id: data.order_id,
              order_date: data.order_date,
              total_amount: data.total_amount,
              items: data.items,
              customer_name: data.customer_name,
              order_link: data.order_link
            });
            trySendMail({ to: data.customer_email, subject, html });
          }

          // แอดมิน
          if (ADMIN_EMAILS.length) {
            const { subject, html } = templates.buildNewOrderAdmin({
              order_id: data.order_id,
              customer_name: data.customer_name,
              customer_email: data.customer_email,
              total_amount: data.total_amount,
              admin_order_link: data.admin_order_link
            });
            trySendMail({ to: ADMIN_EMAILS, subject, html });
          }
        })
        .catch(err => console.error('hook email create error:', err));
    }
  } catch (e) {
    console.error('create order error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* =========== เพิ่มรายการลงบิล โดยใช้ variant_id = SKU จริง =========== */
// POST /api/orders/:orderId/items  body: { variant_id, quantity }
router.post('/:orderId(\\d+)/items', async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { variant_id, quantity } = req.body || {};
  if (!Number.isInteger(orderId) || !Number.isInteger(variant_id) || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: 'bad params' });
  }

  // ถ้าไม่ใช่ admin ต้องเป็นเจ้าของออเดอร์
  if (!isAdmin(req)) {
    const uid = getUserId(req);
    const own = await db.query(`SELECT 1 FROM orders WHERE order_id=$1 AND user_id=$2`, [orderId, uid]);
    if (!own.rowCount) return res.status(403).json({ error: 'forbidden' });
  }

  try {
    // ดึง product_id + ราคา ณ ตอนนี้ (SKU override > product price)
    const q = `
      SELECT v.variant_id, v.product_id,
             COALESCE(v.price_override, p.selling_price) AS price
      FROM product_variants v
      JOIN products p USING (product_id)
      WHERE v.variant_id = $1
    `;
    const r1 = await db.query(q, [variant_id]);
    if (!r1.rows.length) return res.status(404).json({ error: 'variant not found' });

    const { product_id, price } = r1.rows[0];

    // รวมบรรทัดเดิมถ้ามี (ต้องมี UNIQUE(order_id, sku_id) ใน DB)
    const upsert = `
      INSERT INTO order_details (order_id, product_id, sku_id, quantity, selling_price_at_order_time)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (order_id, sku_id)
      DO UPDATE SET quantity = order_details.quantity + EXCLUDED.quantity
      RETURNING order_detail_id;
    `;
    const r2 = await db.query(upsert, [orderId, product_id, variant_id, quantity, price]);

    // อัปเดตรวมยอดแบบ persist
    await recomputeOrderTotal(orderId);

    res.status(201).json({ order_detail_id: r2.rows[0].order_detail_id });
  } catch (e) {
    console.error('add item error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ======================== ดึงรายการสถานะ ======================== */
// GET /api/orders/statuses → [{ order_status_id, order_status_name }]
router.get('/statuses', async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT order_status_id, order_status_name
      FROM order_statuses
      ORDER BY order_status_id
    `);
    res.json(r.rows);
  } catch (e) {
    console.error('statuses error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ============================ ส่งออก CSV ============================ */
/*
  วางไว้ "ก่อน" /:id เพื่อไม่ให้คำว่า export ถูกจับเป็น :id
  GET /api/orders/export?status_id=&q=&date_from=&date_to=
  → ส่งกลับ text/csv ตามเงื่อนไขเดียวกับรายการออเดอร์
*/
router.get('/export', async (req, res) => {
  const { status_id, q, date_from, date_to } = req.query;

  const where = [];
  const params = [];

  // ถ้าไม่ใช่ admin เห็นเฉพาะของตัวเอง
  if (!isAdmin(req)) {
    const uid = getUserId(req);
    params.push(uid);
    where.push(`o.user_id = $${params.length}`);
  }

  if (status_id) { params.push(status_id); where.push(`o.order_status_id = $${params.length}`); }
  if (date_from) { params.push(date_from); where.push(`o.order_date >= $${params.length}::date`); }
  if (date_to)   { params.push(date_to);   where.push(`o.order_date < ($${params.length}::date + INTERVAL '1 day')`); }

  if (q) {
    const qTrim = String(q).trim();
    if (/^\d+$/.test(qTrim)) {
      // เลขล้วน → OR (order_id = หรือ user_id =)
      params.push(parseInt(qTrim, 10), parseInt(qTrim, 10));
      const a = params.length - 1, b = params.length;
      where.push(`(o.order_id = $${a} OR o.user_id = $${b})`);
    } else {
      const qEsc = `%${escapeLike(qTrim)}%`;
      params.push(qEsc, qEsc, qEsc);
      const i1 = params.length - 2; // order_id text
      const i2 = params.length - 1; // tracking
      const i3 = params.length;     // user_id text
      where.push(`(
        CAST(o.order_id AS TEXT) ILIKE $${i1} ESCAPE '\\'
        OR COALESCE(o.tracking_number,'') ILIKE $${i2} ESCAPE '\\'
        OR CAST(o.user_id  AS TEXT) ILIKE $${i3} ESCAPE '\\'
      )`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const sql = `
      SELECT
        o.order_id, o.user_id, o.order_date, o.tracking_number,
        o.order_status_id, s.order_status_name,
        COALESCE(o.total_amount, SUM(od.quantity * od.selling_price_at_order_time), 0)::float8 AS total_amount
      FROM orders o
      JOIN order_statuses s ON s.order_status_id = o.order_status_id
      LEFT JOIN order_details od ON od.order_id = o.order_id
      ${whereSql}
      GROUP BY o.order_id, o.user_id, o.order_date, o.tracking_number,
               o.order_status_id, s.order_status_name, o.total_amount
      ORDER BY o.order_date DESC NULLS LAST, o.order_id DESC
    `;
    // จำกัดสูงสุด 50k แถว กัน memory spike
    const { rows } = await db.query(sql + ' LIMIT 50000', params);

    // ---- แปลงเป็น CSV ----
    const header = [
      'order_id','user_id','order_date',
      'order_status_id','order_status_name','tracking_number','total_amount'
    ];
    const esc = v => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.order_id,
        r.user_id,
        r.order_date ? new Date(r.order_date).toISOString() : '',
        r.order_status_id,
        r.order_status_name,
        r.tracking_number || '',
        r.total_amount
      ].map(esc).join(','));
    }

    const csv = lines.join('\n');
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders_${ts}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('export csv error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ================= ค้นหา/กรอง/เพจจิ้งรายการออเดอร์ ================ */
/*
  GET /api/orders?status_id=&q=&date_from=&date_to=&page=&pageSize=
  - q เป็นตัวเลขล้วน -> OR ระหว่าง order_id / user_id (เร็วกว่า ILIKE)
  - q อื่น ๆ -> ILIKE บน tracking_number / order_id (cast) / user_id (cast)
  - date_from/date_to เป็น YYYY-MM-DD (date_to exclusive วันถัดไป)
  → { page, pageSize, total, rows }
*/
router.get('/', async (req, res) => {
  const page = toPosInt(req.query.page, 1);
  const pageSize = Math.min(toPosInt(req.query.pageSize, 20), 100);
  const offset = (page - 1) * pageSize;

  const { status_id, q, date_from, date_to } = req.query;

  const where = [];
  const params = [];

  // ถ้าไม่ใช่ admin เห็นเฉพาะของตัวเอง
  if (!isAdmin(req)) {
    const uid = getUserId(req);
    params.push(uid);
    where.push(`o.user_id = $${params.length}`);
  }

  if (status_id) { params.push(status_id); where.push(`o.order_status_id = $${params.length}`); }
  if (date_from) { params.push(date_from); where.push(`o.order_date >= $${params.length}::date`); }
  if (date_to)   { params.push(date_to);   where.push(`o.order_date < ($${params.length}::date + INTERVAL '1 day')`); }

  if (q) {
    const qTrim = String(q).trim();
    if (/^\d+$/.test(qTrim)) {
      // เลขล้วน → OR (เดิม AND ทำให้ผลแคบเกิน)
      params.push(parseInt(qTrim, 10), parseInt(qTrim, 10));
      const a = params.length - 1, b = params.length;
      where.push(`(o.order_id = $${a} OR o.user_id = $${b})`);
    } else {
      const qEsc = `%${escapeLike(qTrim)}%`;
      params.push(qEsc, qEsc, qEsc);
      const i1 = params.length - 2; // tracking_number
      const i2 = params.length - 1; // order_id text
      const i3 = params.length;     // user_id text
      where.push(`(
        COALESCE(o.tracking_number,'') ILIKE $${i1} ESCAPE '\\'
        OR CAST(o.order_id AS TEXT) ILIKE $${i2} ESCAPE '\\'
        OR CAST(o.user_id  AS TEXT) ILIKE $${i3} ESCAPE '\\'
      )`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const countSql = `SELECT COUNT(*)::int AS total FROM orders o ${whereSql}`;
    const { rows: cntRows } = await db.query(countSql, params);
    const total = cntRows?.[0]?.total ?? 0;

    // คำนวณตำแหน่งพารามิเตอร์ LIMIT/OFFSET ให้ถูกต้อง
    const limitIdx = params.length + 1;
    const offIdx   = params.length + 2;
    const listParams = [...params, pageSize, offset];

    const listSql = `
      SELECT
        o.order_id,
        o.user_id,
        o.order_date,
        o.tracking_number,
        o.order_status_id,
        s.order_status_name,
        COALESCE(o.total_amount, SUM(od.quantity * od.selling_price_at_order_time), 0)::float8 AS total_amount
      FROM orders o
      JOIN order_statuses s ON s.order_status_id = o.order_status_id
      LEFT JOIN order_details od ON od.order_id = o.order_id
      ${whereSql}
      GROUP BY o.order_id, o.user_id, o.order_date, o.tracking_number,
               o.order_status_id, s.order_status_name, o.total_amount
      ORDER BY o.order_date DESC NULLS LAST, o.order_id DESC
      LIMIT $${limitIdx} OFFSET $${offIdx}
    `;
    const { rows } = await db.query(listSql, listParams);

    res.json({ page, pageSize, total, rows });
  } catch (e) {
    console.error('list orders error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ========================= รายละเอียดออเดอร์ ========================= */
// GET /api/orders/:id → { order, items }
// ✅ ปรับ items ให้คืน variant_id/sku/รูป/ตัวเลือก เพื่อให้ UI ใช้งานได้ครบ
router.get('/:id(\\d+)', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    // ถ้าไม่ใช่ admin ต้องเป็นเจ้าของออเดอร์
    if (!isAdmin(req)) {
      const uid = getUserId(req);
      const own = await db.query(`SELECT 1 FROM orders WHERE order_id=$1 AND user_id=$2`, [id, uid]);
      if (!own.rowCount) return res.status(403).json({ error: 'forbidden' });
    }

    const oSql = `
      SELECT
        o.order_id,
        o.user_id,
        o.order_date,
        o.tracking_number,
        o.order_status_id,
        s.order_status_name,
        COALESCE(o.total_amount, SUM(od.quantity * od.selling_price_at_order_time), 0)::float8 AS total_amount
      FROM orders o
      JOIN order_statuses s ON s.order_status_id = o.order_status_id
      LEFT JOIN order_details od ON od.order_id = o.order_id
      WHERE o.order_id = $1
      GROUP BY o.order_id, o.user_id, o.order_date, o.tracking_number,
               o.order_status_id, s.order_status_name, o.total_amount
    `;
    const orderR = await db.query(oSql, [id]);
    if (!orderR.rows.length) return res.status(404).json({ error: 'Order not found' });

    // รายการบรรทัด: รวมข้อมูล SKU + รูป + ตัวเลือก
    const itemsSql = `
      SELECT
        od.order_detail_id,
        od.product_id,
        p.product_name,
        od.sku_id                        AS variant_id,
        v.sku,
        od.quantity,
        od.selling_price_at_order_time::float8 AS price_each,
        (od.quantity * od.selling_price_at_order_time)::float8 AS line_total,
        img.display_url                  AS image,
        COALESCE(STRING_AGG(o.option_name || '=' || ov.value_name, ', ' ORDER BY pvv.option_id), '') AS options
      FROM order_details od
      JOIN products p          ON p.product_id = od.product_id
      JOIN product_variants v  ON v.variant_id = od.sku_id
      LEFT JOIN product_variant_values pvv ON pvv.variant_id = v.variant_id
      LEFT JOIN product_options o          ON o.option_id     = pvv.option_id
      LEFT JOIN product_option_values ov   ON ov.value_id     = pvv.value_id
      LEFT JOIN v_variant_images img       ON img.variant_id  = v.variant_id
      WHERE od.order_id = $1
      GROUP BY od.order_detail_id, od.product_id, p.product_name,
               od.sku_id, v.sku, od.quantity, od.selling_price_at_order_time, img.display_url
      ORDER BY od.order_detail_id
    `;
    const itemsR = await db.query(itemsSql, [id]);

    res.json({ order: orderR.rows[0], items: itemsR.rows });
  } catch (e) {
    console.error('order detail error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ============== ยืนยันชำระเงิน → ตัดสต็อกผ่าน inventory/sale ============== */
// จำกัดสิทธิ์: admin เท่านั้น
router.post('/:orderId(\\d+)/confirm-payment', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'admin only' });

  const orderId = Number.parseInt(req.params.orderId, 10);
  if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'invalid orderId' });

  const client = await (typeof db.getClient === 'function'
    ? db.getClient()
    : db.pool?.connect
      ? db.pool.connect()
      : (() => { throw new Error('No db client connector available'); })());

  try {
    await client.query('BEGIN');

    // 1) ล็อกออเดอร์
    const ord = (await client.query(
      `SELECT order_id, order_status_id FROM orders WHERE order_id=$1 FOR UPDATE`,
      [orderId]
    )).rows[0];
    if (!ord) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'order not found' });
    }
    if (!['pending','paid','processing'].includes(String(ord.order_status_id))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `order is ${ord.order_status_id}, cannot confirm payment` });
    }

    // 2) ดึงรายการ items (sku_id, quantity)
    const items = (await client.query(
      `SELECT od.order_detail_id, od.sku_id AS variant_id, od.quantity AS qty
       FROM order_details od
       WHERE od.order_id = $1`,
      [orderId]
    )).rows.map(r => ({
      ref_order_detail_id: r.order_detail_id,
      variant_id: Number(r.variant_id),
      qty: Number(r.qty)
    }));

    if (!items.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'no order items' });
    }

    // 3) เรียก inventory/sale (atomic)
    if (typeof _fetch !== 'function') {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'fetch not available on this Node runtime' });
    }
    const BASE = getBaseUrl();
    const resp = await _fetch(`${BASE}/api/inventory/sale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, items, note: 'sale from orders' }),
    });

    if (!resp.ok) {
      const detail = await resp.json().catch(()=>({}));
      await client.query('ROLLBACK');
      return res.status(resp.status).json({ error: 'inventory sale failed', detail });
    }

    // 4) ตรวจว่ามีสถานะ PAID_STATUS_ID จริง
    const chk = await client.query(`SELECT 1 FROM order_statuses WHERE order_status_id=$1`, [PAID_STATUS_ID]);
    if (!chk.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `PAID_STATUS_ID (${PAID_STATUS_ID}) not found in order_statuses` });
    }

    // 5) อัปเดตสถานะเป็น PAID
    await client.query(
      `UPDATE orders
         SET order_status_id = $2,
             paid_at = COALESCE(paid_at, NOW()),
             updated_at = NOW()
       WHERE order_id = $1`,
      [orderId, PAID_STATUS_ID]
    );

    await client.query('COMMIT');

    const saleResult = await resp.json().catch(()=>({ ok: true }));
    return res.json({ ok: true, order_id: orderId, inventory: saleResult });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('confirm-payment error:', e);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release?.();
  }
});

/* ======================== อัปเดต “สถานะ” ออเดอร์ ======================== */
// PUT /api/orders/:id/status  { "order_status_id": "o2" } → คืน row พร้อมชื่อสถานะ
// จำกัดสิทธิ์: admin เท่านั้น
router.put('/:id(\\d+)/status', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'admin only' });

  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  const { order_status_id } = req.body || {};
  if (!order_status_id) return res.status(400).json({ error: 'order_status_id required' });

  try {
    const { rowCount: statusExists } = await db.query(
      `SELECT 1 FROM order_statuses WHERE order_status_id = $1`,
      [order_status_id]
    );
    if (!statusExists) return res.status(400).json({ error: 'Invalid order_status_id' });

    const { rows } = await db.query(
      `
      WITH u AS (
        UPDATE orders
        SET order_status_id = $1, updated_at = NOW()
        WHERE order_id = $2
        RETURNING order_id, user_id, order_date, tracking_number, order_status_id
      )
      SELECT
        u.order_id, u.user_id, u.order_date, u.tracking_number,
        u.order_status_id, s.order_status_name
      FROM u
      JOIN order_statuses s ON s.order_status_id = u.order_status_id
      `,
      [order_status_id, id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const row = rows[0];
    res.json({ ok: true, row });

    // ---- Hook Email: ลูกค้า (อัปเดตสถานะ) ----
    if (templates) {
      loadOrderEmailData(id)
        .then(data => {
          if (!data || !data.customer_email) return;
          const { subject, html } = templates.buildOrderStatusUpdated({
            order_id: data.order_id,
            order_date: data.order_date,
            status_name: data.status_name,
            total_amount: data.total_amount,
            items: data.items,
            shipping_carrier: null, // ถ้ามีคอลัมน์ carrier ในอนาคต ค่อย map เติม
            tracking_number: data.tracking_number,
            order_link: data.order_link
          });
          trySendMail({ to: data.customer_email, subject, html });
        })
        .catch(err => console.error('hook email status error:', err));
    }
  } catch (e) {
    console.error('update status error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ====================== อัปเดต “เลขพัสดุ” ออเดอร์ ====================== */
// PUT /api/orders/:id/tracking  { "tracking_number": "TH123..." } → คืน row พร้อมชื่อสถานะ
// จำกัดสิทธิ์: admin เท่านั้น
router.put('/:id(\\d+)/tracking', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'admin only' });

  const id = Number.parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

  let { tracking_number } = req.body || {};
  if (tracking_number === '') tracking_number = null; // ลบค่าได้

  if (tracking_number != null && typeof tracking_number !== 'string') {
    return res.status(400).json({ error: 'tracking_number must be string or null' });
  }

  if (typeof tracking_number === 'string') {
    tracking_number = tracking_number.trim();
    if (tracking_number.length > 64) {
      return res.status(400).json({ error: 'tracking_number too long (max 64 chars)' });
    }
  }

  try {
    const { rows } = await db.query(
      `
      WITH u AS (
        UPDATE orders
        SET tracking_number = $1, updated_at = NOW()
        WHERE order_id = $2
        RETURNING order_id, user_id, order_date, tracking_number, order_status_id
      )
      SELECT
        u.order_id, u.user_id, u.order_date, u.tracking_number,
        u.order_status_id, s.order_status_name
      FROM u
      JOIN order_statuses s ON s.order_status_id = u.order_status_id
      `,
      [tracking_number ?? null, id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Order not found' });
    const row = rows[0];
    res.json({ ok: true, row });

    // ---- Hook Email: ลูกค้า (อัปเดตสถานะ + แจ้งเลขพัสดุ) ----
    if (templates) {
      loadOrderEmailData(id)
        .then(data => {
          if (!data || !data.customer_email) return;
          const { subject, html } = templates.buildOrderStatusUpdated({
            order_id: data.order_id,
            order_date: data.order_date,
            status_name: data.status_name,
            total_amount: data.total_amount,
            items: data.items,
            shipping_carrier: null,
            tracking_number: data.tracking_number, // ล่าสุดหลังอัปเดต
            order_link: data.order_link
          });
          trySendMail({ to: data.customer_email, subject, html });
        })
        .catch(err => console.error('hook email tracking error:', err));
    }
  } catch (e) {
    console.error('update tracking error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* ====================== นับออเดอร์ใหม่ (Badge เมนู) ====================== */
/*
  GET /api/orders/new-count?updated_since=ISO_DATETIME
  - admin: นับทุกออเดอร์
  - user ปกติ: นับเฉพาะของตัวเอง
  - หากส่ง updated_since -> นับออเดอร์ที่มี updated_at > เวลา/หรือเพิ่งสร้าง (validate รูปแบบก่อน)
  - ไม่ส่ง -> นับ "วันนี้" (อิง order_date::date = current_date)
*/
router.get('/new-count', async (req, res) => {
  try {
    const params = [];
    const where = [];

    if (!isAdmin(req)) {
      const uid = getUserId(req);
      params.push(uid);
      where.push(`o.user_id = $${params.length}`);
    }

    const { updated_since } = req.query;
    if (updated_since && !Number.isNaN(Date.parse(updated_since))) {
      params.push(updated_since);
      where.push(`COALESCE(o.updated_at, o.order_date, now()) > $${params.length}::timestamptz`);
    } else {
      where.push(`o.order_date::date = CURRENT_DATE`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sql = `SELECT COUNT(*)::int AS cnt FROM orders o ${whereSql}`;
    const { rows } = await db.query(sql, params);
    res.json({ count: rows?.[0]?.cnt ?? 0 });
  } catch (e) {
    console.error('new-count error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;
