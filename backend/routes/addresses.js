// backend/routes/addresses.js
// ✅ CRUD ที่อยู่ผู้ใช้ + default (atomic transaction) + backfill จาก users.address
// ✅ รองรับทั้ง req.user.sub และ req.user.user_id (กันเคส middleware ต่างกัน)
// ✅ รองรับทั้ง db.getClient() และ db.pool.connect() (ถ้าไม่มี getClient)


const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
console.log('▶ addresses router LOADED');


 // [HELPER] auth & db client

function getUid(req) {
  const u = req.user || {};
  return u.sub ?? u.user_id ?? u.id ?? null;a
}

async function getClientSafe() {
  if (typeof db.getClient === 'function') return await db.getClient();
  if (db.pool && typeof db.pool.connect === 'function') return await db.pool.connect();
  // fallback แบบ no-transaction (ใช้ตัว db ตรง ๆ)
  return {
    query: db.query.bind(db),
    release() {},
    __noTxn: true,
  };
}

/* =========================================================
  // [HELPER] sanitize & coercion
 * =======================================================*/
const san = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const boolOrNull = (v) => (v === true ? true : v === false ? false : null);
const normCountry = (v) => (san(v) || 'TH').toUpperCase().slice(0, 2);

/* =========================================================
 * [HELPER] Query ร่วมใช้
 * =======================================================*/
async function listAddressesByUser(userId) {
  const { rows } = await db.query(
    `SELECT address_id, user_id, label, recipient_name, phone,
            line1, line2, subdistrict, district, province,
            postal_code, country, is_default, created_at
       FROM user_addresses
      WHERE user_id = $1
      ORDER BY is_default DESC, address_id DESC`,
    [userId]
  );
  return rows;
}

/* =========================================================
 * [BACKFILL] users.address → user_addresses เมื่อยังไม่มีรายการ
 * =======================================================*/
async function backfillFromUsersIfEmpty(userId) {
  const client = await getClientSafe();
  const useTxn = !client.__noTxn;
  try {
    if (useTxn) await client.query('BEGIN');

    const { rows: cnt } = await client.query(
      `SELECT COUNT(*)::int AS c FROM user_addresses WHERE user_id = $1`,
      [userId]
    );
    if (cnt[0].c > 0) {
      if (useTxn) await client.query('COMMIT');
      return;
    }

    const { rows: u } = await client.query(
      `SELECT phone_number, email, address
         FROM users
        WHERE user_id = $1
        LIMIT 1`,
      [userId]
    );
    const row = u[0];
    const rawAddr = san(row?.address);
    if (!row || !rawAddr) {
      if (useTxn) await client.query('COMMIT');
      return;
    }

    const zipMatch = rawAddr.match(/(\d{5})\s*$/);
    const zipcode = zipMatch ? zipMatch[1] : null;

    await client.query(
      `INSERT INTO user_addresses
        (user_id, label, recipient_name, phone,
         line1, line2, subdistrict, district, province,
         postal_code, country, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, TRUE)`,
      [
        userId,
        'ที่อยู่จากโปรไฟล์',
        null,
        san(row.phone_number),
        rawAddr,
        null, null, null, null,
        zipcode,
        'TH',
      ]
    );

    if (useTxn) await client.query('COMMIT');
  } catch (e) {
    if (useTxn) await client.query('ROLLBACK');
    console.error('addresses backfill error:', e);
  } finally {
    client.release && client.release();
  }
}

/* =========================================================
 * [DEBUG]
 * =======================================================*/
router.get('/_debug', (req, res) => {
  res.json({ ok: true, at: '/api/addresses', user: req.user || null });
});

/* =========================================================
 * [LIST] GET /api/addresses
 * =======================================================*/
router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const rows = await listAddressesByUser(uid);
    res.json(rows);
  } catch (e) {
    console.error('addresses list error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* =========================================================
 * [LIST+BACKFILL] GET /api/addresses/me
 * =======================================================*/
router.get('/me', requireAuth, async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    await backfillFromUsersIfEmpty(uid);
    const rows = await listAddressesByUser(uid);
    res.json(rows);
  } catch (e) {
    console.error('addresses me error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* =========================================================
 * [GET DEFAULT] GET /api/addresses/default
 * =======================================================*/
router.get('/default', requireAuth, async (req, res) => {
  try {
    const uid = getUid(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { rows } = await db.query(
      `SELECT address_id, user_id, label, recipient_name, phone,
              line1, line2, subdistrict, district, province,
              postal_code, country, is_default, created_at
         FROM user_addresses
        WHERE user_id = $1 AND is_default = TRUE
        LIMIT 1`,
      [uid]
    );
    res.json(rows[0] || null);
  } catch (e) {
    console.error('addresses default error:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

/* =========================================================
 * [CREATE] POST /api/addresses
 * =======================================================*/
router.post('/', requireAuth, async (req, res) => {
  const uid = getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const payload = {
    label:         san(req.body?.label),
    recipient_name:san(req.body?.recipient_name),
    phone:         san(req.body?.phone),
    line1:         san(req.body?.line1),
    line2:         san(req.body?.line2),
    subdistrict:   san(req.body?.subdistrict),
    district:      san(req.body?.district),
    province:      san(req.body?.province),
    postal_code:   san(req.body?.postal_code),
    country:       normCountry(req.body?.country),
    is_default:    req.body?.is_default === true,
  };

  if (!payload.line1) return res.status(400).json({ error: 'line1 required' });

  const client = await getClientSafe();
  const useTxn = !client.__noTxn;
  try {
    if (useTxn) await client.query('BEGIN');

    const { rows: cnt } = await client.query(
      `SELECT COUNT(*)::int AS c FROM user_addresses WHERE user_id = $1`,
      [uid]
    );
    const isFirst = cnt[0].c === 0;
    const makeDefault = payload.is_default || isFirst;

    if (makeDefault) {
      await client.query(
        `UPDATE user_addresses SET is_default = FALSE
          WHERE user_id = $1 AND is_default = TRUE`,
        [uid]
      );
    }

    const { rows } = await client.query(
      `INSERT INTO user_addresses
        (user_id, label, recipient_name, phone, line1, line2,
         subdistrict, district, province, postal_code, country, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        uid,
        payload.label, payload.recipient_name, payload.phone,
        payload.line1, payload.line2,
        payload.subdistrict, payload.district, payload.province,
        payload.postal_code, payload.country,
        makeDefault,
      ]
    );

    if (useTxn) await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    if (useTxn) await client.query('ROLLBACK');
    console.error('addresses create error:', e);
    if (e.code === '23505') return res.status(409).json({ error: 'Default address already exists' });
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release && client.release();
  }
});

/* =========================================================
 * [UPDATE] PUT /api/addresses/:id
 * =======================================================*/
router.put('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const uid = getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  console.log('[PUT /addresses/:id]', { uid, id, body: req.body });

  const P = {
    label:          san(req.body?.label),
    recipient_name: san(req.body?.recipient_name),
    phone:          san(req.body?.phone),
    line1:          san(req.body?.line1),
    line2:          san(req.body?.line2),
    subdistrict:    san(req.body?.subdistrict),
    district:       san(req.body?.district),
    province:       san(req.body?.province),
    postal_code:    san(req.body?.postal_code),
    country:        req.body?.country === undefined ? null : normCountry(req.body?.country),
    is_default:     boolOrNull(req.body?.is_default),
  };

  const client = await getClientSafe();
  const useTxn = !client.__noTxn;
  try {
    if (useTxn) await client.query('BEGIN');

    const { rows: owned } = await client.query(
      `SELECT is_default FROM user_addresses
        WHERE address_id = $1 AND user_id = $2`,
      [id, uid]
    );
    if (!owned[0]) {
      if (useTxn) await client.query('ROLLBACK');
      // ใช้ 404 แทน 403 เพื่อไม่เปิดเผยการมีอยู่ของ resource
      return res.status(404).json({ error: 'Not found' });
    }

    if (P.is_default === true) {
      await client.query(
        `UPDATE user_addresses SET is_default = FALSE
          WHERE user_id = $1 AND is_default = TRUE`,
        [uid]
      );
    }

    const { rows } = await client.query(
      `UPDATE user_addresses
         SET label          = COALESCE($1, label),
             recipient_name = COALESCE($2, recipient_name),
             phone          = COALESCE($3, phone),
             line1          = COALESCE($4, line1),
             line2          = COALESCE($5, line2),
             subdistrict    = COALESCE($6, subdistrict),
             district       = COALESCE($7, district),
             province       = COALESCE($8, province),
             postal_code    = COALESCE($9, postal_code),
             country        = COALESCE($10, country),
             is_default     = COALESCE($11, is_default)
       WHERE address_id = $12 AND user_id = $13
       RETURNING *`,
      [
        P.label, P.recipient_name, P.phone,
        P.line1, P.line2,
        P.subdistrict, P.district, P.province,
        P.postal_code, P.country,
        P.is_default,
        id, uid,
      ]
    );

    if (useTxn) await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    if (useTxn) await client.query('ROLLBACK');
    console.error('addresses update error:', e);
    if (e.code === '23505') return res.status(409).json({ error: 'Default address already exists' });
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release && client.release();
  }
});

/* =========================================================
 * [SET DEFAULT] PATCH /api/addresses/:id/default
 * =======================================================*/
router.patch('/:id/default', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const uid = getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  console.log('[PATCH /addresses/:id/default]', { uid, id });

  const client = await getClientSafe();
  const useTxn = !client.__noTxn;
  try {
    if (useTxn) await client.query('BEGIN');

    const { rows: owned } = await client.query(
      `SELECT 1 FROM user_addresses WHERE address_id = $1 AND user_id = $2`,
      [id, uid]
    );
    if (!owned.length) {
      if (useTxn) await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }

    await client.query(
      `UPDATE user_addresses SET is_default = FALSE
        WHERE user_id = $1 AND is_default = TRUE`,
      [uid]
    );
    const { rows } = await client.query(
      `UPDATE user_addresses
          SET is_default = TRUE
        WHERE address_id = $1 AND user_id = $2
        RETURNING *`,
      [id, uid]
    );

    if (useTxn) await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    if (useTxn) await client.query('ROLLBACK');
    console.error('addresses set default error:', e);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release && client.release();
  }
});

/* =========================================================
 * [DELETE] DELETE /api/addresses/:id
 * =======================================================*/
router.delete('/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  const uid = getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  console.log('[DELETE /addresses/:id]', { uid, id });

  const client = await getClientSafe();
  const useTxn = !client.__noTxn;
  try {
    if (useTxn) await client.query('BEGIN');

    const { rows: before } = await client.query(
      `SELECT is_default FROM user_addresses
        WHERE address_id = $1 AND user_id = $2`,
      [id, uid]
    );
    if (!before[0]) {
      if (useTxn) await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Not found' });
    }
    const wasDefault = !!before[0].is_default;

    await client.query(
      `DELETE FROM user_addresses WHERE address_id = $1 AND user_id = $2`,
      [id, uid]
    );

    if (wasDefault) {
      const { rows: remain } = await client.query(
        `SELECT address_id
           FROM user_addresses
          WHERE user_id = $1
          ORDER BY address_id DESC
          LIMIT 1`,
        [uid]
      );
      if (remain[0]) {
        await client.query(
          `UPDATE user_addresses
              SET is_default = TRUE
            WHERE address_id = $1 AND user_id = $2`,
          [remain[0].address_id, uid]
        );
      }
    }

    if (useTxn) await client.query('COMMIT');
    res.status(204).send();
  } catch (e) {
    if (useTxn) await client.query('ROLLBACK');
    console.error('addresses delete error:', e);
    res.status(500).json({ error: 'Database error' });
  } finally {
    client.release && client.release();
  }
});

module.exports = router;





// ✅ CRUD ที่อยู่ผู้ใช้ + default (atomic transaction) + backfill จาก users.address
// ✅ รองรับทั้ง req.user.sub และ req.user.user_id (กันเคส middleware ต่างกัน)
// ✅ รองรับทั้ง db.getClient() และ db.pool.connect() (ถ้าไม่มี getClient)
