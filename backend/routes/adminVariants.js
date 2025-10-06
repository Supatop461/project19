// backend/routes/adminVariants.js
// หน้าที่: จัดการตัวเลือก/ค่า (options/values) และตัวแปรย่อยของสินค้า (variants)

const express = require('express');                 // ใช้สร้าง router
const db = require('../db');                        // โมดูลเชื่อมต่อ Postgres (มี pool/query)
const router = express.Router();                    // สร้าง router สำหรับไฟล์นี้

/* ---------- helper: ตรวจว่าตารางครบไหม ---------- */
async function _checkSchema(client) {               // ตรวจมีตารางที่ต้องใช้ครบหรือยัง
  const q = await client.query(`
    SELECT
      to_regclass('public.product_options')        AS product_options,
      to_regclass('public.product_option_values')  AS product_option_values,
      to_regclass('public.product_variants')       AS product_variants,
      to_regclass('public.product_variant_values') AS product_variant_values
  `);
  const row = q.rows[0];                            // ผลลัพธ์ 1 แถว มีคอลัมน์ละชื่อโต๊ะ/NULL
  return Object.entries(row)                        // แปลงเป็นคู่ [ชื่อคอลัมน์, ค่า]
    .filter(([, v]) => v === null)                  // เก็บเฉพาะโต๊ะที่ยังไม่มี (ค่าเป็น null)
    .map(([k]) => k);                               // คืนชื่อโต๊ะที่ขาด
}

/* ---------- helpers เพิ่มเติม ---------- */
async function getOptionsWithValues(productId, client) {
  // ดึงรายการ option ของสินค้านี้ + ค่า (values) ของแต่ละ option
  const opts = await client.query(
    `SELECT option_id, option_name
       FROM product_options
      WHERE product_id = $1
      ORDER BY option_id`,
    [productId]
  );
  const optionIds = opts.rows.map(o => o.option_id);

  let vals = [];
  if (optionIds.length) {
    const r = await client.query(
      `SELECT value_id, option_id, value_name
         FROM product_option_values
        WHERE option_id = ANY($1::int[])
        ORDER BY option_id, value_id`,
      [optionIds]
    );
    vals = r.rows;
  }
  const byOption = new Map(opts.rows.map(o => [o.option_id, []])); // group values ตาม option
  for (const v of vals) byOption.get(v.option_id).push(v);
  return opts.rows.map(o => ({ ...o, values: byOption.get(o.option_id) }));
}

function buildSignature(values) {
  // สร้างลายเซ็นของคอมโบค่าใน variant เช่น "1:3|2:5" ใช้กันคอมโบซ้ำ
  if (!values?.length) return '';
  return values
    .slice()
    .sort((a, b) => Number(a.option_id) - Number(b.option_id))
    .map(x => `${Number(x.option_id)}:${Number(x.value_id)}`)
    .join('|');
}

async function getVariantSignatures(productId, client) {
  // โหลดลายเซ็นของ variants ที่มีอยู่แล้วทั้งสินค้า เพื่อตรวจชนซ้ำ
  const r = await client.query(
    `SELECT v.variant_id,
            COALESCE(string_agg(vv.option_id::text || ':' || vv.value_id::text,
                                '|' ORDER BY vv.option_id), '') AS sig
       FROM product_variants v
  LEFT JOIN product_variant_values vv ON vv.variant_id = v.variant_id
      WHERE v.product_id = $1
      GROUP BY v.variant_id`,
    [productId]
  );
  const map = new Map();
  for (const row of r.rows) map.set(row.sig, row.variant_id); // key=sig, val=variant_id
  return map;
}

async function assertValidPairs(productId, values, client) {
  // ตรวจ 3 อย่าง: 1) ห้าม option_id ซ้ำ  2) option_id ต้องเป็นของ product นี้  3) (option_id,value_id) ต้องมีจริง
  if (!values?.length) return;

  const seen = new Set();
  for (const { option_id } of values) {
    const k = Number(option_id);
    if (seen.has(k)) throw new Error('Duplicate option_id in values');
    seen.add(k);
  }

  const optIds = values.map(v => Number(v.option_id));
  const valIds = values.map(v => Number(v.value_id));

  const optOk = await client.query(
    `SELECT option_id
       FROM product_options
      WHERE product_id = $1 AND option_id = ANY($2::int[])`,
    [productId, optIds]
  );
  if (optOk.rowCount !== optIds.length)
    throw new Error('Some option_id does not belong to this product');

  const pairOk = await client.query(
    `SELECT COUNT(*)::int AS c
       FROM UNNEST($1::int[], $2::int[]) AS i(option_id, value_id)
       JOIN product_option_values pov
         ON pov.option_id = i.option_id AND pov.value_id = i.value_id`,
    [optIds, valIds]
  );
  if ((pairOk.rows?.[0]?.c || 0) !== values.length)
    throw new Error('Some (option_id,value_id) pairs are invalid');
}

/* ============================================================
   GET meta: product + options + values + variants(+combos)
   GET /api/admin/products/:productId/variants
   ============================================================ */
router.get('/products/:productId/variants', async (req, res) => {
  const { productId } = req.params;                 // รับ productId จาก URL
  const client = await db.pool.connect();           // ขอ client จาก pool
  try {
    const missing = await _checkSchema(client);     // ตรวจสคีมาที่จำเป็น
    if (missing.length) {
      return res.status(500).json({
        error: 'Schema missing',
        missing_tables: missing,
        fix: 'สร้างตาราง product_options, product_option_values, product_variants, product_variant_values ให้ครบ'
      });
    }

    const p = await client.query(                   // ตรวจว่าสินค้ามีอยู่จริง
      'SELECT product_id, product_name FROM products WHERE product_id = $1 LIMIT 1',
      [productId]
    );
    if (!p.rows.length) return res.status(404).json({ error: 'Product not found' });

    const options = await getOptionsWithValues(productId, client); // โหลด options + values

    const v = await client.query(                   // โหลด variants ของสินค้านี้
      `SELECT variant_id, product_id, sku, price_override, stock
         FROM product_variants
        WHERE product_id = $1
        ORDER BY variant_id`,
      [productId]
    );
    const variants = v.rows;

    let maps = [];
    if (variants.length) {                          // โหลด mapping (ค่าแต่ละ option ที่ผูกกับแต่ละ variant)
      const ids = variants.map(x => x.variant_id);
      const mq = await client.query(
        `SELECT vv.variant_id, vv.option_id, vv.value_id,
                o.option_name, v.value_name
           FROM product_variant_values vv
           JOIN product_options o       ON o.option_id = vv.option_id
           JOIN product_option_values v ON v.value_id = vv.value_id
          WHERE vv.variant_id = ANY($1::int[])
          ORDER BY vv.variant_id, vv.option_id`,
        [ids]
      );
      maps = mq.rows;
    }

    const variantsOut = variants.map(s => ({        // ประกอบผลลัพธ์ให้ฝั่ง UI ใช้งานง่าย
      ...s,
      combos: maps
        .filter(m => m.variant_id === s.variant_id)
        .map(m => ({
          option_id: m.option_id,
          value_id : m.value_id,
          option_name: m.option_name,
          value_name : m.value_name
        }))
    }));

    res.json({ product: p.rows[0], options, variants: variantsOut }); // ส่ง meta ครบชุด
  } catch (e) {
    console.error('GET variants error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  } finally {
    client.release();                                // คืน client ไม่ว่าจะสำเร็จ/พัง
  }
});

/* ========================= OPTIONS ========================= */
// POST /api/admin/products/:productId/options  { option_name? }
router.post('/products/:productId/options', async (req, res) => {
  const { productId } = req.params;                 // id ของสินค้า
  let { option_name } = req.body || {};             // ชื่อ option (อาจว่าง)

  try {
    // ถ้าไม่ส่งชื่อ → ตั้งเป็น "ข้อมูลอื่นๆ N" อัตโนมัติ
    if (!option_name || !option_name.trim()) {
      const c = await db.query(
        'SELECT COUNT(*)::int AS c FROM product_options WHERE product_id=$1',
        [productId]
      );
      const n = (c.rows?.[0]?.c || 0) + 1;
      option_name = `ข้อมูลอื่นๆ ${n}`;
    }

    const { rows } = await db.query(
      `INSERT INTO product_options (product_id, option_name)
       VALUES ($1, $2)
       RETURNING option_id, product_id, option_name`,
      [productId, option_name.trim()]
    );
    res.status(201).json(rows[0]);                  // คืน option ที่สร้าง
  } catch (e) {
    console.error('add option error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  }
});

// 🔧 NEW: เปลี่ยนชื่อ option ภายหลัง (รองรับฟลโอว์ “สร้างว่างไว้ก่อน”)
// PUT /api/admin/products/:productId/options/:optionId
router.put('/products/:productId/options/:optionId', async (req, res) => {
  const { productId, optionId } = req.params;
  const { option_name } = req.body || {};
  if (!option_name?.trim())
    return res.status(400).json({ error: 'option_name required' });

  try {
    const r = await db.query(
      `UPDATE product_options
          SET option_name = $1
        WHERE option_id = $2 AND product_id = $3
        RETURNING option_id, product_id, option_name`,
      [option_name.trim(), optionId, productId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Option not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505')                         // unique_violation (ชื่อชนในสินค้าตัวเดียวกัน)
      return res.status(409).json({ error: 'Option name already exists for this product' });
    console.error('rename option error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  }
});

// POST /api/admin/options/:option_id/values  { value_name }
router.post('/options/:option_id/values', async (req, res) => {
  const { option_id } = req.params;                 // id ของ option
  let { value_name } = req.body || {};              // ชื่อ value (ยอมให้เว้นว่างแล้วตั้งชื่อให้เอง)

  try {
    // 🔧 ปล่อยว่างได้ → ระบบตั้งชื่ออัตโนมัติ "ค่าอื่นๆ N" ตามจำนวนปัจจุบันของ option นี้
    if (!value_name || !value_name.trim()) {
      const c = await db.query(
        'SELECT COUNT(*)::int AS c FROM product_option_values WHERE option_id=$1',
        [option_id]
      );
      value_name = `ค่าอื่นๆ ${(c.rows?.[0]?.c || 0) + 1}`;
    }

    const { rows } = await db.query(
      `INSERT INTO product_option_values (option_id, value_name)
       VALUES ($1, $2)
       RETURNING value_id, option_id, value_name`,
      [option_id, value_name.trim()]
    );
    res.status(201).json(rows[0]);                  // คืน value ที่สร้าง
  } catch (e) {
    if (e.code === '23505')                         // unique_violation (ชื่อชนใน option เดียวกัน)
      return res.status(409).json({ error: 'Value name already exists for this option' });
    console.error('add value error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  }
});

// 🔧 NEW: เปลี่ยนชื่อ value ภายหลัง
// PUT /api/admin/values/:valueId
router.put('/values/:valueId', async (req, res) => {
  const { valueId } = req.params;                   // id ของ value
  const { value_name } = req.body || {};
  if (!value_name?.trim())
    return res.status(400).json({ error: 'value_name required' });

  try {
    const r = await db.query(
      `UPDATE product_option_values
          SET value_name = $1
        WHERE value_id = $2
        RETURNING value_id, option_id, value_name`,
      [value_name.trim(), valueId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Value not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505')                         // unique_violation (ชื่อชนใน option เดียวกัน)
      return res.status(409).json({ error: 'Value name already exists for this option' });
    console.error('rename value error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  }
});

// DELETE /api/admin/options/:option_id
router.delete('/options/:option_id', async (req, res) => {
  const client = await db.pool.connect();           // ใช้ทรานแซกชันเพราะลบหลายตาราง
  try {
    const { option_id } = req.params;
    await client.query('BEGIN');
    await client.query('DELETE FROM product_variant_values WHERE option_id = $1', [option_id]); // ลบ mapping ที่อ้าง option นี้
    await client.query('DELETE FROM product_option_values  WHERE option_id = $1', [option_id]); // ลบ values ทั้งหมดของ option
    const r = await client.query('DELETE FROM product_options       WHERE option_id = $1', [option_id]); // ลบ option เอง
    await client.query('COMMIT');
    res.json({ ok: true, deleted: r.rowCount });    // แจ้งจำนวนที่ลบ
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('delete option error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  } finally {
    client.release();
  }
});

// DELETE /api/admin/values/:value_id
router.delete('/values/:value_id', async (req, res) => {
  const { value_id } = req.params;                  // id ของ value
  try {
    // ถ้ายังถูกใช้ใน variant ใดอยู่ ให้ตอบ 409
    const used = await db.query('SELECT 1 FROM product_variant_values WHERE value_id = $1 LIMIT 1', [value_id]);
    if (used.rows.length) return res.status(409).json({ error: 'Value is used by some variant' });

    const r = await db.query('DELETE FROM product_option_values WHERE value_id = $1', [value_id]);
    res.json({ ok: true, deleted: r.rowCount });
  } catch (e) {
    console.error('delete value error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  }
});

/* ========================= VARIANTS ========================= */
// POST /api/admin/products/:productId/variants
// body: { sku?, price_override?, stock?, values?: [{option_id, value_id}, ...] }
router.post('/products/:productId/variants', async (req, res) => {
  const { productId } = req.params;                 // id สินค้า
  let { sku, price_override, stock, values } = req.body || {}; // payload ที่ส่งมา
  price_override = (price_override === null || price_override === '') ? null : Number(price_override); // null ได้
  stock = Number.isFinite(Number(stock)) ? Number(stock) : 0;   // แปลงเป็น number
  values = Array.isArray(values) ? values : [];                  // อนุญาตให้ว่าง (variant ไม่มีคอมโบ)

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1) ตรวจความถูกต้องของ pairs (ห้าม option_id ซ้ำ และคู่ต้องมีจริง)
    await assertValidPairs(productId, values, client);

    // 2) สร้างลายเซ็นของคอมโบที่กำลังจะใช้
    const sig = buildSignature(values);

    // 3) ถ้ามี sku ที่ซ้ำใน product เดียวกัน → ไปโหมดอัปเดตแทน
    let theVar = null;
    if (sku) {
      const existed = await client.query(
        `SELECT * FROM product_variants WHERE product_id = $1 AND sku = $2 LIMIT 1`,
        [productId, sku]
      );
      if (existed.rows.length) theVar = existed.rows[0];
    }

    // 4) กันคอมโบซ้ำ (ชนกับ variant อื่นที่ลายเซ็นเดียวกัน)
    const sigMap = await getVariantSignatures(productId, client);
    const conflict = sigMap.get(sig);
    if (conflict && (!theVar || conflict !== theVar.variant_id)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Duplicate variant combination (conflict with variant_id=${conflict})` });
    }

    // 5) สร้างใหม่หรืออัปเดต
    if (!theVar) {
      const ins = await client.query(
        `INSERT INTO product_variants (product_id, sku, price_override, stock)
         VALUES ($1, $2, $3, $4)
         RETURNING variant_id, product_id, sku, price_override, stock`,
        [productId, sku || null, price_override, stock]
      );
      theVar = ins.rows[0];
    } else {
      const upd = await client.query(
        `UPDATE product_variants
            SET price_override = $1, stock = $2
          WHERE variant_id = $3
          RETURNING variant_id, product_id, sku, price_override, stock`,
        [price_override, stock, theVar.variant_id]
      );
      theVar = upd.rows[0];
      await client.query('DELETE FROM product_variant_values WHERE variant_id = $1', [theVar.variant_id]); // เคลียร์ mapping เดิมถ้ามี
    }

    // 6) ใส่ mapping เฉพาะกรณีมี values
    for (const { option_id, value_id } of values) {
      await client.query(
        `INSERT INTO product_variant_values (variant_id, option_id, value_id)
         VALUES ($1, $2, $3)`,
        [theVar.variant_id, Number(option_id), Number(value_id)]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ variant: theVar });      // ตอบกลับ variant ที่ได้
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create/update variant error:', e);
    const status = /duplicate|conflict/i.test(String(e.message)) ? 409 : 500;
    res.status(status).json({ error: e.message || 'Database error', code: e.code });
  } finally {
    client.release();
  }
});

// PUT /api/admin/variants/:variantId  body: { sku?, price_override?, stock? }
router.put('/variants/:variantId', async (req, res) => {
  const { variantId } = req.params;                 // id ของ variant ที่จะแก้
  const patch = {};                                  // เก็บคอลัมน์ที่มีส่งมา
  if (Object.prototype.hasOwnProperty.call(req.body, 'sku'))            patch.sku = req.body.sku ?? null;
  if (Object.prototype.hasOwnProperty.call(req.body, 'price_override')) patch.price_override = (req.body.price_override === '' ? null : Number(req.body.price_override));
  if (Object.prototype.hasOwnProperty.call(req.body, 'stock'))          patch.stock = Number(req.body.stock);

  if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' }); // ไม่มีอะไรให้แก้

  const sets = [];
  const vals = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {     // ประกอบประโยค UPDATE แบบไดนามิก
    sets.push(`${k} = $${i++}`);
    vals.push(v);
  }
  vals.push(variantId);                              // พารามิเตอร์สุดท้ายคือ variantId

  try {
    const sql = `UPDATE product_variants SET ${sets.join(', ')} WHERE variant_id = $${i} RETURNING *`;
    const { rows } = await db.query(sql, vals);
    if (!rows.length) return res.status(404).json({ error: 'Variant not found' });
    res.json(rows[0]);                               // คืนแถวที่อัปเดตแล้ว
  } catch (e) {
    console.error('update variant error:', e);
    const status = e?.code === '23505' ? 409 : 500;  // 23505 = unique_violation (เช่น sku ซ้ำ)
    res.status(status).json({ error: e.message || 'Database error', code: e.code });
  }
});

// DELETE /api/admin/variants/:variantId
router.delete('/variants/:variantId', async (req, res) => {
  const { variantId } = req.params;                 // id variant ที่จะลบ
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM product_variant_values WHERE variant_id = $1', [variantId]); // ลบ mapping ก่อน
    const r = await client.query('DELETE FROM product_variants WHERE variant_id = $1', [variantId]); // แล้วค่อยลบ variant
    await client.query('COMMIT');
    if (!r.rowCount) return res.status(404).json({ error: 'Variant not found' });
    res.json({ ok: true, deleted: r.rowCount });    // แจ้งจำนวนที่ลบ
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('delete variant error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  } finally {
    client.release();
  }
});

/* ---------------------- (อ็อปชัน) Generate ทุกคอมโบ ---------------------- */
// POST /api/admin/products/:productId/variants/generate
// body: { base_price?, base_stock?, sku_prefix? } → สร้าง variant ครบทุกคอมโบของ options/values ที่มี (ข้ามคอมโบที่มีแล้ว)
router.post('/products/:productId/variants/generate', async (req, res) => {
  const { productId } = req.params;
  const { base_price = null, base_stock = 0, sku_prefix = 'V' } = req.body || {};
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const options = await getOptionsWithValues(productId, client); // โหลด options+values
    if (!options.length) throw new Error('No options defined for this product');
    for (const o of options) if (!o.values.length) throw new Error(`Option "${o.option_name}" has no values`);

    // เตรียมชุดคอมโบทุกตัว
    const valueSets = options.map(o => o.values.map(v => ({ option_id: o.option_id, value_id: v.value_id })));
    const combos = valueSets.reduce((acc, cur) => {               // cartesian แบบ inline (เลี่ยง import เพิ่ม)
      const out = [];
      for (const a of acc) for (const c of cur) out.push([...a, c]);
      return out;
    }, [[]]);

    const sigMap = await getVariantSignatures(productId, client); // ลายเซ็นที่มีแล้ว
    let seq = 1;
    const created = [];

    for (const combo of combos) {
      await assertValidPairs(productId, combo, client);           // เผื่อกรณีข้อมูลเพี้ยน
      const sig = buildSignature(combo);
      if (sigMap.has(sig)) continue;                              // ข้ามคอมโบที่มีแล้ว

      // หา sku ที่ไม่ซ้ำ
      let sku = `P${productId}-${sku_prefix}${seq}`;
      let tries = 0;
      while (tries < 5) {
        const chk = await client.query(
          'SELECT 1 FROM product_variants WHERE product_id = $1 AND sku = $2 LIMIT 1',
          [productId, sku]
        );
        if (!chk.rowCount) break;
        seq++;
        sku = `P${productId}-${sku_prefix}${seq}`;
        tries++;
      }

      const rVar = await client.query(
        `INSERT INTO product_variants (product_id, sku, price_override, stock)
         VALUES ($1, $2, $3, $4)
         RETURNING variant_id, sku`,
        [productId, sku, base_price, base_stock]
      );
      const variantId = rVar.rows[0].variant_id;

      for (const { option_id, value_id } of combo) {
        await client.query(
          `INSERT INTO product_variant_values (variant_id, option_id, value_id)
           VALUES ($1, $2, $3)`,
          [variantId, option_id, value_id]
        );
      }

      created.push({ variant_id: variantId, sku });
      sigMap.set(sig, variantId);
      seq++;
    }

    await client.query('COMMIT');
    res.status(201).json({ created_count: created.length, created });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('generate variants error:', e);
    res.status(500).json({ error: e.message || 'Database error', code: e.code });
  } finally {
    client.release();
  }
});

module.exports = router;                            // export router ใช้ใน server.js
