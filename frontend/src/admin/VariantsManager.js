// src/admin/VariantsManager.js
// ======================================================================
// VariantsManager (DB-aware, resilient) — โหลดข้อมูลครบแม้ไม่มี compat endpoints
// - ใช้ /api/variants/product/:id เป็นแหล่งหลัก (อ่าน combo เพื่อถอด mapping option/value ได้)
// - ใช้ /api/variants/products/:id/options เป็นแหล่งหลักของ options + values (flatten เป็น value list ให้เอง)
// - ถ้า endpoint เก่า ๆ 404 ก็ยังแสดงครบและบันทึกได้
// ======================================================================

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, path, mediaSrc } from "../lib/api";
import "./VariantsManager.css";

/* ---------- Helpers ---------- */
const authHeader = () => {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const uniq = (arr) => Array.from(new Set(arr.filter((x) => x !== null && x !== undefined && String(x).trim() !== ""))).sort(byKey);
const pickStr = (...xs) => xs.find((v) => typeof v === "string" && v.trim())?.trim() || "";
const rand2 = () => String(Math.floor(Math.random() * 99) + 1).padStart(2, "0");
const keyOf = (r) => [r.opt1 || "", r.opt2 || "", r.opt3 || ""].join("␟");

/* ---------- Upload ---------- */
const extractUrl = (data) => {
  if (!data) return null;
  if (typeof data === "string") return data;
  const direct =
    data.url || data.path || data.imageUrl || data.Location || data.location ||
    data.file?.url || data.file?.path || data.data?.url || data.data?.path || data.data?.imageUrl;
  if (direct) return direct;
  try {
    const flat = JSON.stringify(data);
    const m = flat.match(/"([^"]+\.(?:png|jpe?g|webp|gif))"/i);
    return m ? m[1] : null;
  } catch { return null; }
};

const tryUpload = async (file) => {
  const fd = new FormData();
  fd.append("file", file);
  const res = await api.post(path("/upload"), fd, {
    headers: { ...authHeader(), "Content-Type": "multipart/form-data" },
  });
  const url = extractUrl(res?.data);
  if (!url) throw new Error("UPLOAD_OK_BUT_NO_URL");
  return url;
};

/* ---------- Normalize product ---------- */
const normalizeProduct = (raw) => {
  if (!raw) return null;
  const d = raw.data || raw.item || raw.product || raw.result || raw;
  return d || null;
};

/* ---------- Option + value helpers ---------- */
const normOptionRows = (rows) => {
  const out = [];
  for (const r of rows || []) {
    const id = r.option_id ?? r.id ?? r.opt_id;
    const name = pickStr(r.option_name, r.name, r.label);
    if (id != null) out.push({ option_id: Number(id), option_name: name || "", values: Array.isArray(r.values) ? r.values : [] });
  }
  return out;
};

const normValueRows = (rows) => {
  const out = [];
  for (const r of rows || []) {
    const id = r.value_id ?? r.id;
    const optionId = r.option_id ?? r.opt_id;
    const name = pickStr(r.value_name, r.name, r.label, r.value);
    if (id != null) out.push({ value_id: Number(id), option_id: Number(optionId ?? 0), value_name: name || "" });
  }
  return out;
};

const normVariantValues = (rows) => {
  const out = [];
  for (const r of rows || []) {
    const vid = r.variant_id ?? r.product_variant_id ?? r.id;
    const oid = r.option_id ?? r.opt_id;
    const val = r.value_id ?? r.val_id ?? r.value;
    if (vid != null && oid != null) out.push({ variant_id: Number(vid), option_id: Number(oid), value_id: val != null ? Number(val) : null });
  }
  return out;
};

/* ---------- Parse helpers ---------- */
function parseFromOptionText(optionText) {
  const res = { names: ["", "", ""], values: ["", "", ""] };
  const s = String(optionText || "").trim();
  if (!s) return res;
  const parts = s.split("|").map((x) => x.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(3, parts.length); i++) {
    const p = parts[i]; const j = p.indexOf(":");
    if (j >= 0) { res.names[i] = p.slice(0, j).trim(); res.values[i] = p.slice(j + 1).trim(); }
    else { res.values[i] = p; }
  }
  return res;
}
const firstNonEmpty = (...xs) => xs.find((x) => x !== undefined && x !== null && String(x).trim())?.toString().trim() || "";

/* ---------- Variant normalize (base) ---------- */
const normVariantBase = (v) => {
  if (!v) return null;
  const price = v.price ?? v.unit_price ?? v.sale_price ?? v.price_override ?? "";
  const sku = firstNonEmpty(v.sku, v.SKU, v.code);
  const image = firstNonEmpty(v.image_url, v.image, v.imageUrl, v.variant_image);
  return {
    variant_id: v.variant_id ?? v.id ?? v.product_variant_id ?? null,
    sku,
    price: typeof price === "number" ? String(price) : String(price || ""),
    image: image || null,
    option_text: firstNonEmpty(v.option_text, v.options_text, ""),
    combo: Array.isArray(v.combo) ? v.combo : [], // keep for fallback
    opt1_name: firstNonEmpty(v.opt1_name, v.option1_name, v.name1, v.option1, ""),
    opt2_name: firstNonEmpty(v.opt2_name, v.option2_name, v.name2, v.option2, ""),
    opt3_name: firstNonEmpty(v.opt3_name, v.option3_name, v.name3, v.option3, ""),
    opt1: firstNonEmpty(v.option1_value, v.opt1, v.value1, v.color, ""),
    opt2: firstNonEmpty(v.option2_value, v.opt2, v.value2, v.size, ""),
    opt3: firstNonEmpty(v.option3_value, v.opt3, v.value3, v.material, ""),
  };
};

/* ====================================================================== */
export default function VariantsManager() {
  const { id, productId: pid } = useParams();
  const productId = Number(id || pid);

  const [product, setProduct] = useState(null);

  // ชื่อหัวคอลัมน์
  const [opt1Name, setOpt1Name] = useState("ตัวเลือก 1");
  const [opt2Name, setOpt2Name] = useState("ตัวเลือก 2");
  const [opt3Name, setOpt3Name] = useState("ตัวเลือก 3");

  // chips
  const [opt1Values, setOpt1Values] = useState([]);
  const [opt2Values, setOpt2Values] = useState([]);
  const [opt3Values, setOpt3Values] = useState([]);

  // แถว
  const [rows, setRows] = useState([]);
  const [deletedIds, setDeletedIds] = useState([]);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  /* ---------- Load product ---------- */
  const loadProduct = useCallback(async () => {
    if (!productId) return;
    let p = null;
    try {
      const r = await api.get(path(`/admin/products/${productId}`));
      p = normalizeProduct(r?.data);
    } catch {}
    if (!p) { try { const r = await api.get(path(`/products/${productId}`)); p = normalizeProduct(r?.data); } catch {} }
    setProduct(p || null);
  }, [productId]);

  /* ---------- Load variants + options/values ---------- */
  const loadAll = useCallback(async () => {
    if (!productId) return;

    // 1) โหลด variants พื้นฐาน
    let variants = [];
    let variantsRaw = [];
    const endpoints = [
      path(`/api/variants/product/${productId}`),
      path(`/api/variants/by-product/${productId}`),
      path(`/api/variants?product_id=${productId}`),
      path(`/admin/products/${productId}/variants`),
      path(`/products/${productId}/variants`),
    ];
    for (const url of endpoints) {
      try {
        const r = await api.get(url, { headers: authHeader() });
        const arr = r?.data?.items || r?.data?.rows || r?.data || [];
        if (Array.isArray(arr) && arr.length) {
          variantsRaw = arr;
          variants = arr.map(normVariantBase);
          break;
        }
      } catch {}
    }

    // 2) โหลด product_options (+ values)
    let optionsList = [];
    let optionsRaw = [];
    const optionEndpoints = [
      path(`/api/variants/products/${productId}/options`),
      path(`/admin/products/${productId}/options`),
      path(`/products/${productId}/options`),
      path(`/api/products/${productId}/options`),
      path(`/api/product_options?product_id=${productId}`),
    ];
    for (const url of optionEndpoints) {
      try {
        const r = await api.get(url, { headers: authHeader() });
        const arr = r?.data?.items || r?.data?.rows || r?.data || [];
        if (Array.isArray(arr) && arr.length) { optionsRaw = arr; optionsList = normOptionRows(arr); break; }
      } catch {}
    }
    const optionNameById = new Map(optionsList.map((o) => [o.option_id, o.option_name]));

    // 3) โหลด option_values (flatten from options หาก endpoint ตรงไม่มี)
    let optionValues = [];
    const valueEndpoints = [
      path(`/api/variants/products/${productId}/option-values`),
      path(`/api/product_option_values?product_id=${productId}`),
      path(`/admin/products/${productId}/option-values`),
      path(`/products/${productId}/option-values`),
    ];
    for (const url of valueEndpoints) {
      try {
        const r = await api.get(url, { headers: authHeader() });
        const arr = r?.data?.items || r?.data?.rows || r?.data || [];
        if (Array.isArray(arr) && arr.length) { optionValues = normValueRows(arr); break; }
      } catch {}
    }
    if (!optionValues.length && Array.isArray(optionsRaw) && optionsRaw.length) {
      // flatten from optionsRaw.values
      const flat = [];
      for (const o of optionsRaw) {
        const option_id = o.option_id ?? o.id ?? o.opt_id;
        if (Array.isArray(o.values)) {
          for (const v of o.values) {
            flat.push({ value_id: v.value_id ?? v.id, option_id, value_name: pickStr(v.value_name, v.name, v.label, v.value) });
          }
        }
      }
      optionValues = normValueRows(flat);
    }
    const valueNameById = new Map(optionValues.map((v) => [v.value_id, v.value_name]));

    // 4) โหลด product_variant_values หรือถอดจาก combo ใน variants
    let variantValues = [];
    const pvEndpoints = [
      path(`/api/product_variant_values?product_id=${productId}`),
      path(`/admin/products/${productId}/variant-values`),
      path(`/products/${productId}/variant-values`),
    ];
    for (const url of pvEndpoints) {
      try {
        const r = await api.get(url, { headers: authHeader() });
        const arr = r?.data?.items || r?.data?.rows || r?.data || [];
        if (Array.isArray(arr) && arr.length) { variantValues = normVariantValues(arr); break; }
      } catch {}
    }
    if (!variantValues.length && Array.isArray(variantsRaw) && variantsRaw.length) {
      // derive from combo in variantsRaw
      const flat = [];
      for (const v of variantsRaw) {
        const vid = v.variant_id ?? v.id ?? v.product_variant_id;
        if (!vid) continue;
        const combo = Array.isArray(v.combo) ? v.combo : [];
        for (const c of combo) {
          const option_id = c.option_id ?? c.opt_id;
          const value_id = c.value_id ?? c.val_id ?? c.value;
          if (option_id != null && value_id != null) {
            flat.push({ variant_id: vid, option_id, value_id });
          }
        }
      }
      variantValues = normVariantValues(flat);
    }

    // 5) รวมข้อมูล
    const sortedOptionIds = Array.from(optionNameById.keys()).sort((a,b)=>a-b).slice(0,3);
    if (sortedOptionIds[0]) setOpt1Name(optionNameById.get(sortedOptionIds[0]) || "ตัวเลือก 1");
    if (sortedOptionIds[1]) setOpt2Name(optionNameById.get(sortedOptionIds[1]) || "ตัวเลือก 2");
    if (sortedOptionIds[2]) setOpt3Name(optionNameById.get(sortedOptionIds[2]) || "");

    const groupByVariant = new Map();
    for (const r of variantValues) {
      if (!groupByVariant.has(r.variant_id)) groupByVariant.set(r.variant_id, []);
      groupByVariant.get(r.variant_id).push(r);
    }

    const mapIdx = new Map(sortedOptionIds.map((id, i) => [id, i+1]));

    const rowsBuilt = (variants || []).map((b) => {
      const vs = groupByVariant.get(Number(b.variant_id)) || [];
      const obj = { ...b };
      for (const v of vs) {
        const idx = mapIdx.get(Number(v.option_id));
        const valName = v.value_id != null ? valueNameById.get(Number(v.value_id)) : "";
        if (idx === 1) obj.opt1 = valName || obj.opt1;
        if (idx === 2) obj.opt2 = valName || obj.opt2;
        if (idx === 3) obj.opt3 = valName || obj.opt3;
      }
      if (!obj.opt1 && !obj.opt2 && !obj.opt3 && b.option_text) {
        const p = parseFromOptionText(b.option_text);
        obj.opt1 = p.values[0] || obj.opt1;
        obj.opt2 = p.values[1] || obj.opt2;
        obj.opt3 = p.values[2] || obj.opt3;
      }
      return {
        __existing: true,
        variant_id: obj.variant_id,
        opt1: obj.opt1 || "",
        opt2: obj.opt2 || "",
        opt3: obj.opt3 || "",
        price: obj.price ?? "",
        sku: obj.sku || "",
        image: obj.image || null,
        opt1_name: opt1Name, opt2_name: opt2Name, opt3_name: opt3Name,
      };
    });

    // เติม chips เริ่มต้น
    setRows(rowsBuilt);
    setOpt1Values(uniq(rowsBuilt.map(r=>r.opt1)));
    setOpt2Values(uniq(rowsBuilt.map(r=>r.opt2)));
    setOpt3Values(uniq(rowsBuilt.map(r=>r.opt3)));
    setDeletedIds([]);
  }, [productId]);

  useEffect(() => { loadProduct(); loadAll(); }, [loadProduct, loadAll]);

  const productName = useMemo(() => pickStr(product?.product_name, product?.name, product?.title), [product]);
  const productCode = useMemo(() => pickStr(product?.product_code, product?.code, `P${productId}`), [product, productId]);

  /* ---------- chips merge generate ---------- */
  const mergeGenerate = useCallback(() => {
    const v1 = opt1Values.length ? opt1Values : [""];
    const v2 = opt2Values.length ? opt2Values : [""];
    const v3 = opt3Values.length ? opt3Values : [""];
    const should = new Map();
    for (const a of v1) for (const b of v2) for (const c of v3) {
      should.set(keyOf({ opt1:a||"", opt2:b||"", opt3:c||"" }), { opt1:a||"", opt2:b||"", opt3:c||"" });
    }
    const cur = new Map(rows.map((r) => [keyOf(r), r]));
    const next = [];
    for (const [k, want] of should.entries()) {
      if (cur.has(k)) next.push({ ...cur.get(k) });
      else next.push({ __existing:false, variant_id:null, opt1:want.opt1, opt2:want.opt2, opt3:want.opt3, price:"", sku:"", image:null, opt1_name:opt1Name, opt2_name:opt2Name, opt3_name:opt3Name });
    }
    setRows(next);
  }, [rows, opt1Values, opt2Values, opt3Values, opt1Name, opt2Name, opt3Name]);
  useEffect(() => { mergeGenerate(); }, [opt1Values, opt2Values, opt3Values]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- chips add/remove ---------- */
  const addTag = (list, setList, txt) => {
    const v = String(txt || "").trim();
    if (!v) return;
    if (!list.includes(v)) setList(uniq([...list, v]));
  };
  const removeTag = (list, setList, idx) => {
    const v = list[idx];
    setList(list.filter((_, i) => i !== idx));
    setRows((prev) => prev.filter((r) => r[`opt${setList === setOpt1Values ? 1 : setList === setOpt2Values ? 2 : 3}`] !== v));
  };

  /* ---------- per-row upload ---------- */
  const onUploadRowImage = async (file, idx) => {
    if (!file) return;
    const tempUrl = URL.createObjectURL(file);
    setRows((prev) => { const a = [...prev]; a[idx] = { ...a[idx], image: tempUrl, __temp: true }; return a; });
    try {
      const serverUrl = await tryUpload(file);
      setRows((prev) => { const a = [...prev]; a[idx] = { ...a[idx], image: serverUrl, __temp: false }; return a; });
    } catch (e) {
      setRows((prev) => { const a = [...prev]; a[idx] = { ...a[idx], image: null, __temp: false }; return a; });
      alert(e?.message || "Upload failed");
    } finally { setTimeout(() => URL.revokeObjectURL(tempUrl), 2500); }
  };

  const onDeleteRow = (i) => {
    setRows((prev) => {
      const r = prev[i];
      if (r?.variant_id) setDeletedIds((ids) => uniq([...ids, r.variant_id]));
      const a = [...prev]; a.splice(i, 1); return a;
    });
  };

  /* ---------- Auto SKU ---------- */
  const autoSku = () => {
    const base = productCode || `P${productId}`;
    setRows((prev) =>
      prev.map((r) => {
        const parts = [base, r.opt1, r.opt2, r.opt3].filter((x) => String(x || "").trim() !== "");
        return { ...r, sku: parts.join("-") + "-" + rand2() };
      })
    );
  };

  /* ---------- Save ---------- */
  const saveAll = async () => {
    setSaving(true);
    try {
      const payloadRows = rows.map((r) => ({
        variant_id: r.variant_id || null,
        details: [
          r.opt1 ? { name: opt1Name, value: r.opt1 } : null,
          r.opt2 ? { name: opt2Name, value: r.opt2 } : null,
          r.opt3 && (opt3Name || r.opt3) ? { name: opt3Name || "ตัวเลือก 3", value: r.opt3 } : null,
        ].filter(Boolean),
        sku: r.sku || null,
        price: r.price !== "" ? Number(r.price) : null,
        image_url: r.image || null,
      }));

      if (deletedIds.length) {
        try { await api.post(path(`/api/variants/delete-batch`), { variant_ids: deletedIds }, { headers: authHeader() }); } catch {}
        try { await api.delete(path(`/admin/products/${productId}/variants`), { data: { variant_ids: deletedIds }, headers: authHeader() }); } catch {}
      }

      let done = false;
      try { await api.post(path(`/api/variants/upsert-batch`), { product_id: productId, rows: payloadRows }, { headers: authHeader() }); done = true; } catch {}
      if (!done) { try { await api.put(path(`/admin/products/${productId}/variants`), { rows: payloadRows }, { headers: authHeader() }); done = true; } catch {} }
      if (!done) { try { await api.post(path(`/admin/products/${productId}/variants/save`), { rows: payloadRows }, { headers: authHeader() }); done = true; } catch {} }
      if (!done) { try { await api.post(path(`/api/variants/${productId}/variants/generate`), { rows: payloadRows }, { headers: authHeader() }); done = true; } catch {} }
      if (!done) { await api.post(path(`/admin/products/${productId}/variants/generate`), { rows: payloadRows }, { headers: authHeader() }); }

      setMsg("✅ บันทึกแล้ว");
      setTimeout(() => setMsg(""), 1800);
      await loadAll();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || "❌ Save failed");
    } finally { setSaving(false); }
  };

  return (
    <div className="vm-page">
      {/* Header */}
      <div className="vm-header">
        <div className="vm-title">
          <div className="vm-product-name">{pickStr(product?.product_name, product?.name, product?.title) || `#${productId}`}</div>
          <div className="vm-product-code">{pickStr(product?.product_code, product?.code, `P${productId}`)}</div>
        </div>
        <Link to="/admin/products" className="vm-back">← กลับไปหน้าสินค้า</Link>
      </div>

      {msg && <div className="vm-msg">{msg}</div>}

      {/* Options (ชื่อ + chips) */}
      <div className="vm-options" style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"16px"}}>
        <div className="vm-opt">
          <label>ชื่อตัวเลือก 1</label>
          <input value={opt1Name} onChange={(e) => setOpt1Name(e.target.value)} placeholder="เช่น สูตร" />
          <div className="vm-chips" style={{marginTop:8}}>
            {opt1Values.map((v, i) => (
              <span key={i} className="vm-chip">{v}<button onClick={() => removeTag(opt1Values, setOpt1Values, i)}>×</button></span>
            ))}
            <input placeholder="เช่น ทั่วไป แล้ว Enter" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(opt1Values, setOpt1Values, e.currentTarget.value); e.currentTarget.value = ""; } }} />
          </div>
        </div>
        <div className="vm-opt">
          <label>ชื่อตัวเลือก 2 (ถ้ามี)</label>
          <input value={opt2Name} onChange={(e) => setOpt2Name(e.target.value)} placeholder="เช่น ขนาด" />
          <div className="vm-chips" style={{marginTop:8}}>
            {opt2Values.map((v, i) => (
              <span key={i} className="vm-chip">{v}<button onClick={() => removeTag(opt2Values, setOpt2Values, i)}>×</button></span>
            ))}
            <input placeholder="เช่น M / 6 นิ้ว แล้ว Enter" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(opt2Values, setOpt2Values, e.currentTarget.value); e.currentTarget.value = ""; } }} />
          </div>
        </div>
        <div className="vm-opt">
          <label>ชื่อตัวเลือก 3 (ถ้ามี)</label>
          <input value={opt3Name} onChange={(e) => setOpt3Name(e.target.value)} placeholder="เช่น วัสดุ" />
          <div className="vm-chips" style={{marginTop:8}}>
            {opt3Values.map((v, i) => (
              <span key={i} className="vm-chip">{v}<button onClick={() => removeTag(opt3Values, setOpt3Values, i)}>×</button></span>
            ))}
            <input placeholder="เช่น เซรามิก แล้ว Enter" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(opt3Values, setOpt3Values, e.currentTarget.value); e.currentTarget.value = ""; } }} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="vm-table-wrap">
        <table className="vm-table">
          <thead>
            <tr>
              <th>รูปภาพ</th>
              <th>{opt1Name || "ตัวเลือก 1"}</th>
              <th>{opt2Name || "ตัวเลือก 2"}</th>
              <th>{opt3Name || "ตัวเลือก 3"}</th>
              <th>ราคา</th>
              <th>SKU</th>
              <th>ลบ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.image ? (
                    <img src={mediaSrc(r.image)} alt="" className="vm-thumb" />
                  ) : (
                    <label className="vm-upload">
                      <span>+</span>
                      <input type="file" accept="image/*" onChange={(e) => onUploadRowImage(e.target.files?.[0], i)} />
                    </label>
                  )}
                </td>
                <td>{r.opt1 || "-"}</td>
                <td>{r.opt2 || "-"}</td>
                <td>{r.opt3 || "-"}</td>
                <td>
                  <input type="number" min="0" placeholder="ไม่ระบุ" value={r.price} onChange={(e) => {
                    const v = e.target.value;
                    setRows((prev) => { const a = [...prev]; a[i] = { ...a[i], price: v }; return a; });
                  }} />
                </td>
                <td>
                  <input placeholder="SKU" value={r.sku} onChange={(e) => {
                    const v = e.target.value;
                    setRows((prev) => { const a = [...prev]; a[i] = { ...a[i], sku: v }; return a; });
                  }} />
                </td>
                <td><button className="btn" onClick={() => onDeleteRow(i)} title="ลบแถว">🗑️</button></td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: 16 }}>
                  เพิ่มค่าในกล่องด้านบน (พิมพ์แล้วกด Enter) เพื่อสร้างชุดตัวเลือก แล้วกด “บันทึกทั้งหมด”
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div className="vm-actions">
        <button className="btn" onClick={autoSku} disabled={saving}>✨ เติม SKU อัตโนมัติ</button>
        <button className="btn-primary" onClick={saveAll} disabled={saving}>{saving ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}</button>
      </div>

      <div className="vm-hint">เมื่อเพิ่มเสร็จ ให้กด “บันทึก” ด้านบน เพื่อบันทึกตัวเลือกทั้งหมดพร้อมสินค้า</div>
    </div>
  );
}
