// backend/db.js
// ✅ PostgreSQL Singleton Pool + Type parsers + Query/Tx helpers (พร้อมวางทับ)

require('dotenv').config();
const { Pool, types } = require('pg');

/* ---------- Type parsers ---------- */
// NUMERIC(1700) -> number (ระวังค่ามากๆเรื่อง precision)
types.setTypeParser(1700, v => (v == null ? null : parseFloat(v)));
// BIGINT(int8, OID=20) -> number (ต้องไม่เกิน Number.MAX_SAFE_INTEGER)
types.setTypeParser(20, v => (v == null ? null : parseInt(v, 10)));
// ถ้าต้องการ Date object: uncomment ด้านล่าง
// types.setTypeParser(1184, v => (v == null ? null : new Date(v)));

/* ---------- Build config ---------- */
const cfg = {
  host:     process.env.PGHOST     || 'localhost',
  port:     parseInt(process.env.PGPORT || '5433', 10),
  user:     process.env.PGUSER     || 'postgres',
  password: process.env.PGPASSWORD, // ไม่ทำ fallback เพื่อความปลอดภัย
  database: process.env.PGDATABASE || 'project19',
  max: parseInt(process.env.PGPOOL_MAX || '10', 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT || '5000', 10),
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
  application_name: process.env.PG_APPNAME || 'project19-api',
};

/* ---------- Singleton Pool (กันสร้างซ้ำเวลามี require หลายรอบ) ---------- */
if (!global.__PRACHMAEJO_PGPOOL__) {
  global.__PRACHMAEJO_PGPOOL__ = new Pool(cfg);
}
const pool = global.__PRACHMAEJO_PGPOOL__;

/* ---------- Safety & Diagnostics ---------- */
pool.on('error', err => {
  console.error('PG pool error:', err);
});
const DEBUG = /^(1|true)$/i.test(process.env.DEBUG_SQL || '');
const SLOW_MS = parseInt(process.env.DEBUG_SQL_SLOW_MS || '250', 10);

function ensureAlive() {
  if (pool.ended) {
    // ชี้นำชัดๆ เพื่อไม่ให้ dev สับสน
    throw new Error('PG pool was ended earlier. Please kill old process on :3001 and restart the backend.');
  }
}

/* ---------- Query helpers ---------- */
async function query(text, params) {
  ensureAlive();
  if (DEBUG) console.log('SQL >', text, params ?? '');
  const t0 = Date.now();
  const res = await pool.query(text, params);
  const dt = Date.now() - t0;
  if (dt >= SLOW_MS) {
    console.log(`SQL (slow ${dt}ms) >`, (text || '').split('\n')[0], params ?? '');
  }
  return res;
}

async function getClient() {
  ensureAlive();
  const client = await pool.connect();
  if (process.env.PG_STATEMENT_TIMEOUT_MS) {
    await client.query(`SET statement_timeout = ${parseInt(process.env.PG_STATEMENT_TIMEOUT_MS, 10)}`);
  }
  if (process.env.PG_IDLE_IN_TX_TIMEOUT_MS) {
    await client.query(`SET idle_in_transaction_session_timeout = ${parseInt(process.env.PG_IDLE_IN_TX_TIMEOUT_MS, 10)}`);
  }
  return client;
}

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

/* ---------- Graceful close (สมัครแค่ครั้งเดียว) ---------- */
if (!global.__PRACHMAEJO_PGPOOL_SIG__) {
  global.__PRACHMAEJO_PGPOOL_SIG__ = true;

  async function closePool() {
    if (!pool.ended) {
      await pool.end();
    }
  }

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, async () => {
      try { await closePool(); } finally { process.exit(0); }
    });
  }

  module.exports.closePool = closePool;
}

/* ---------- Exports ---------- */
module.exports.query     = query;
module.exports.getClient = getClient;
module.exports.runTx     = runTx;
module.exports.pool      = pool;
