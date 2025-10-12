// backend/routes/adminUnits.js
// ✅ Units API (public list + admin CRUD) — รองรับ schema product_units และตอบ JSON ที่หน้าเว็บต้องการ

const express = require('express');
const router = express.Router();

// ใช้ ../db ตัวเดียว
let db;
try { db = require('../db'); } catch { db = require('../db/db'); }

// auth (มีค่อยใช้, ไม่มีไม่บังคับ)
let requireAuth = (_req, _res, next) => next();
let requireRole = () => (_req, _res, next) => next();
try {
  const m = require('../middleware/auth');
  requireAuth = m.requireAuth || requireAuth;
  requireRole = m.requireRole || requireRole;
} catch {}

console.log('▶ adminUnits router LOADED');

/* -------------------- helpers -------------------- */
async function hasTable(name) {
  const { rows } = await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${name}`]);
  return !!rows?.[0]?.ok;
}
async function hasCol(table, col) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`,
    [table, col]
  );
  return rows.length > 0;
}
async function pickCol(table, cands) { for (const c of cands) if (await hasCol(table,c)) return c; return null; }

const asStr  = (v)=> (v==null ? '' : String(v).trim());
const toBool = (v,d=null)=> v===undefined?d:(v===true||v===1||v==='1'||String(v).toLowerCase()==='true');
const toArrStr = (x)=> Array.isArray(x)? x.map(String) : null;

/* -------------------- resolve columns -------------------- */
async function resolveUnitColumns() {
  const table = 'product_units';
  if (!(await hasTable(table))) { const e=new Error('ไม่พบตาราง product_units'); e.status=500; throw e; }

  const textKeys=[]; for (const c of ['code','unit_code']) if(await hasCol(table,c)) textKeys.push(c);
  const idKeys=[]; for (const c of ['id','unit_id','uid']) if(await hasCol(table,c)) idKeys.push(c);

  const nameCol = await pickCol(table, ['unit_name','name','label','title']);
  const descCol = await pickCol(table, ['description','desc','details','remark']);
  const pubCol  = await hasCol(table,'is_published') ? 'is_published' : null;
  const catIdCol  = await hasCol(table,'category_id')  ? 'category_id'  : null;
  const catIdsCol = await hasCol(table,'category_ids') ? 'category_ids' : null;

  if (!textKeys.length && !idKeys.length) { const e=new Error('ไม่พบคีย์หลัก (code/unit_code หรือ id/unit_id/uid)'); e.status=500; throw e; }
  if (!nameCol) { const e=new Error('ไม่พบคอลัมน์ชื่อหน่วย (unit_name/name/label/title)'); e.status=500; throw e; }

  return { table, textKeys, idKeys, nameCol, descCol, pubCol, catIdCol, catIdsCol };
}

function buildWhereByCodeOrId(keyParam, cfg, startIndex=1) {
  const p = asStr(keyParam);
  const params=[]; const conds=[];
  for (const col of cfg.textKeys) { params.push(p); conds.push(`LOWER(BTRIM(${col}::text))=LOWER(BTRIM($${startIndex+params.length-1}::text))`); }
  const asNum = Number(p);
  if (Number.isFinite(asNum)) for (const col of cfg.idKeys) { params.push(asNum); conds.push(`${col}=$${startIndex+params.length-1}`); }
  return { sql: conds.length?`(${conds.join(' OR ')})`:'FALSE', params };
}

function mapRow(r,cfg){
  const code = cfg.textKeys.length ? asStr(r[cfg.textKeys[0]]) : asStr(r[cfg.idKeys[0]]);
  const out = {
    code,
    unit_name: asStr(r[cfg.nameCol]),
    description: cfg.descCol ? asStr(r[cfg.descCol]) : '',
    is_published: cfg.pubCol ? !!r[cfg.pubCol] : true,
    category_id: cfg.catIdCol ? (r[cfg.catIdCol] ?? null) : null,
  };
  if (cfg.catIdsCol) out.category_ids = r[cfg.catIdsCol] ?? null;
  return out;
}

/* -------------------- list (public + alias) -------------------- */
async function listUnits(req,res,next){
  try{
    const cfg = await resolveUnitColumns();
    const q = asStr(req.query.q||'');
    const onlyVisible = toBool(req.query.only_visible,null);
    const published   = toBool(req.query.published,null);
    const onlyPub = (onlyVisible===true) ? true : (published===true ? true : false);

    const where=[]; const params=[];
    if(q){
      params.push(`%${q}%`);
      const p=`$${params.length}`;
      const likes=[];
      if(cfg.textKeys.length) likes.push(`${cfg.textKeys[0]} ILIKE ${p}`);
      likes.push(`${cfg.nameCol} ILIKE ${p}`);
      if(cfg.descCol) likes.push(`${cfg.descCol} ILIKE ${p}`);
      where.push(`(${likes.join(' OR ')})`);
    }
    if(onlyPub && cfg.pubCol) where.push(`${cfg.pubCol}=TRUE`);
    const whereSql = where.length?`WHERE ${where.join(' AND ')}`:'';

    const order2 = cfg.idKeys[0] || cfg.textKeys[0] || cfg.nameCol;
    const { rows } = await db.query(
      `SELECT * FROM ${cfg.table} ${whereSql} ORDER BY ${cfg.nameCol} NULLS LAST, ${order2}`,
      params
    );
    const items = rows.map(r=>mapRow(r,cfg));

    // ✅ รองรับทั้งรูปแบบ object และ array ตามที่หน้าเว็บคาด
    if (req.query.raw === '1') return res.json(items);
    return res.json({ ok: true, success: true, data: items, rows: items, items, total: items.length });
  }catch(err){ console.error('❌ listUnits:', err.message); next(err); }
}

router.get('/units', listUnits);
router.get('/admin/units', listUnits);

/* -------------------- create -------------------- */
router.post('/admin/units', requireAuth, requireRole(['admin','staff']), async (req,res,next)=>{
  try{
    const cfg = await resolveUnitColumns();
    if(!cfg.textKeys.length) return res.status(400).json({ error:'ตารางนี้ไม่มีคีย์ข้อความ (code/unit_code)' });

    const code = asStr(req.body.code).toLowerCase();
    const unit_name = asStr(req.body.unit_name || req.body.name || '');
    const description = asStr(req.body.description || '');
    const is_published = toBool(req.body.is_published,true);
    const category_id  = (req.body.category_id !== undefined) ? req.body.category_id : null;
    const category_ids = toArrStr(req.body.category_ids);

    if(!code) return res.status(400).json({ error:'ต้องระบุ code' });
    if(!/^[a-z][a-z0-9_-]*$/i.test(code)) return res.status(400).json({ error:'รูปแบบ code ไม่ถูกต้อง' });
    if(!unit_name) return res.status(400).json({ error:'ต้องระบุ unit_name' });

    const dupWhere = cfg.textKeys.map(c=>`LOWER(BTRIM(${c}::text))=LOWER(BTRIM($1::text))`).join(' OR ');
    const dup = await db.query(`SELECT 1 FROM ${cfg.table} WHERE ${dupWhere} LIMIT 1`, [code]);
    if(dup.rowCount) return res.status(409).json({ error:'DUPLICATE_CODE', code });

    const cols=[cfg.textKeys[0], cfg.nameCol]; const args=[code, unit_name];
    if(cfg.descCol){ cols.push(cfg.descCol); args.push(description); }
    if(cfg.pubCol){ cols.push(cfg.pubCol); args.push(!!is_published); }
    if(cfg.catIdCol){ cols.push(cfg.catIdCol); args.push(category_id); }
    if(cfg.catIdsCol){ cols.push(cfg.catIdsCol); args.push(category_ids ? JSON.stringify(category_ids) : null); }

    const ph=cols.map((_,i)=>`$${i+1}`);
    const { rows } = await db.query(
      `INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${ph.join(',')}) RETURNING *`,
      args
    );
    const item = mapRow(rows[0],cfg);
    return res.status(201).json({ ok:true, success:true, data:item });
  }catch(err){ console.error('❌ create unit:', err.message); next(err); }
});

/* -------------------- update -------------------- */
router.put('/admin/units/:code', requireAuth, requireRole(['admin','staff']), async (req,res,next)=>{
  try{
    const cfg = await resolveUnitColumns();
    const keyParam = asStr(req.params.code);
    const fnd = buildWhereByCodeOrId(keyParam,cfg,1);
    const cur = await db.query(`SELECT * FROM ${cfg.table} WHERE ${fnd.sql} LIMIT 1`, fnd.params);
    if(!cur.rowCount) return res.status(404).json({ error:'ไม่พบหน่วย' });

    const unit_name    = (req.body.unit_name !== undefined)    ? asStr(req.body.unit_name) : undefined;
    const description  = (req.body.description !== undefined)  ? asStr(req.body.description) : undefined;
    const is_published = (req.body.is_published !== undefined) ? toBool(req.body.is_published) : undefined;
    const category_id  = (req.body.category_id !== undefined)  ? req.body.category_id : undefined;
    const category_ids = (req.body.category_ids !== undefined) ? toArrStr(req.body.category_ids) : undefined;

    const newCodeRaw = (req.body.code !== undefined) ? asStr(req.body.code) : undefined;
    const newCode = newCodeRaw !== undefined ? newCodeRaw.toLowerCase() : undefined;

    const sets=[]; const args=[];
    if(unit_name !== undefined){ sets.push(`${cfg.nameCol}=$${sets.length+1}`); args.push(unit_name); }
    if(cfg.descCol && description !== undefined){ sets.push(`${cfg.descCol}=$${sets.length+1}`); args.push(description); }
    if(cfg.pubCol && is_published !== undefined){ sets.push(`${cfg.pubCol}=$${sets.length+1}`); args.push(!!is_published); }
    if(cfg.catIdCol && category_id !== undefined){ sets.push(`${cfg.catIdCol}=$${sets.length+1}`); args.push(category_id); }
    if(cfg.catIdsCol && category_ids !== undefined){ sets.push(`${cfg.catIdsCol}=$${sets.length+1}`); args.push(category_ids ? JSON.stringify(category_ids) : null); }

    if(newCode !== undefined){
      if(!cfg.textKeys.length) return res.status(400).json({ error:'ตารางนี้ไม่รองรับการแก้ไข code' });
      if(!newCode) return res.status(400).json({ error:'code ใหม่ว่างเปล่า' });
      if(!/^[a-z][a-z0-9_-]*$/i.test(newCode)) return res.status(400).json({ error:'รูปแบบ code ใหม่ไม่ถูกต้อง' });

      const dupConds = cfg.textKeys.map(c=>`LOWER(BTRIM(${c}::text))=LOWER(BTRIM($1::text))`).join(' OR ');
      const whereOld = buildWhereByCodeOrId(keyParam,cfg,2);
      const dup = await db.query(
        `SELECT 1 FROM ${cfg.table} WHERE (${dupConds}) AND NOT (${whereOld.sql}) LIMIT 1`,
        [newCode, ...whereOld.params]
      );
      if(dup.rowCount) return res.status(409).json({ error:'DUPLICATE_CODE', code:newCode });

      sets.push(`${cfg.textKeys[0]}=$${sets.length+1}`);
      args.push(newCode);
    }

    if(!sets.length) return res.status(400).json({ error:'ไม่มีข้อมูลที่จะแก้ไข' });

    const whereUpd = buildWhereByCodeOrId(keyParam,cfg,args.length+1);
    await db.query(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE ${whereUpd.sql}`, [...args, ...whereUpd.params]);
    return res.json({ ok:true, success:true });
  }catch(err){ console.error('❌ update unit:', err.message); next(err); }
});

/* -------------------- delete -------------------- */
router.delete('/admin/units/:code', requireAuth, requireRole(['admin','staff']), async (req,res,next)=>{
  try{
    const cfg = await resolveUnitColumns();
    const keyParam = asStr(req.params.code);
    const whereDel = buildWhereByCodeOrId(keyParam,cfg,1);
    const { rowCount } = await db.query(`DELETE FROM ${cfg.table} WHERE ${whereDel.sql}`, whereDel.params);
    if(!rowCount) return res.status(404).json({ error:'ไม่พบหน่วย' });
    return res.json({ ok:true, success:true });
  }catch(err){ console.error('❌ delete unit:', err.message); next(err); }
});

module.exports = router;
