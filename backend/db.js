// backend/db.js
// หน้าที่: เชื่อม PostgreSQL + กำหนด type parser + helper สำหรับ query/transaction

require('dotenv').config();
const { Pool, types } = require('pg');

/* ---------- Type parsers ---------- */
// NUMERIC(1700) -> number (ระวังความแม่นยำในค่าที่ใหญ่มาก)
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));
// BIGINT(int8, OID=20) -> number (ต้องไม่เกิน Number.MAX_SAFE_INTEGER)
types.setTypeParser(20, v => (v == null ? null : parseInt(v, 10)));
// ถ้าต้องการให้เป็น Date object ให้ uncomment
// types.setTypeParser(1184, v => (v == null ? null : new Date(v)));

const pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5433', 10),
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD,             // ไม่ทำ fallback เพื่อความปลอดภัย
  database: process.env.PGDATABASE || 'project19',
  max: parseInt(process.env.PGPOOL_MAX || '10', 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  application_name: process.env.PG_APPNAME || 'project19-api',
});

/* ---------- Safety & Diagnostics ---------- */
pool.on('error', err => {
  console.error('PG pool error:', err);
});

const DEBUG = /^(1|true)$/i.test(process.env.DEBUG_SQL || '');
const SLOW_MS = parseInt(process.env.DEBUG_SQL_SLOW_MS || '250', 10);

// ใช้ยิง SQL ปกติ (เปิด log ได้ด้วย DEBUG_SQL)
async function query(text, params) {
  if (DEBUG) console.log('SQL >', text, params ?? '');
  const t0 = Date.now();
  const res = await pool.query(text, params);
  const dt = Date.now() - t0;
  if (dt >= SLOW_MS) {
    console.log(`SQL (slow ${dt}ms) >`, text.split('\n')[0], params ?? '');
  }
  return res;
}

// ใช้ทำทรานแซกชันแบบ manual (BEGIN/COMMIT/ROLLBACK)
async function getClient() {
  const client = await pool.connect();
  // ตั้งค่าเสริมต่อ connection (ถ้าต้องการ)
  if (process.env.PG_STATEMENT_TIMEOUT_MS) {
    await client.query(`SET statement_timeout = ${parseInt(process.env.PG_STATEMENT_TIMEOUT_MS, 10)}`);
  }
  if (process.env.PG_IDLE_IN_TX_TIMEOUT_MS) {
    await client.query(`SET idle_in_transaction_session_timeout = ${parseInt(process.env.PG_IDLE_IN_TX_TIMEOUT_MS, 10)}`);
  }
  return client;
}

// ทรานแซกชันแบบฟังก์ชันสั้นๆ
async function runTx(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// ปิด pool อย่างเรียบร้อย (ใช้ตอนปิดเซิร์ฟเวอร์/รันเทสต์)
async function closePool() {
  await pool.end();
}

// ปิด pool เมื่อได้รับสัญญาณจากระบบ
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    try { await closePool(); } finally { process.exit(0); }
  });
}

module.exports = {
  query,       // ยิง SQL ง่ายๆ
  getClient,   // ใช้ทรานแซกชันแบบ manual
  runTx,       // ทรานแซกชันแบบฟังก์ชันสั้นๆ
  closePool,   // ปิด pool
  pool,        // export ไว้กรณีใช้งานขั้นสูง
};
