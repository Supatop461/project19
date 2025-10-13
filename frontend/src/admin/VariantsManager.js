// src/admin/VariantsManager.js
// ======================================================================
// Variants — แบบใช้งานง่าย: ใส่รายละเอียด 1–3 ช่อง, อัปโหลดสื่อ, ตั้งราคา/สต็อก, บันทึก
// - คำสั้น ไม่เยิ่นเย้อ
// - ตัด "เปิดขาย" ออก (is_active ไม่ให้ผู้ใช้ยุ่งในหน้านี้)
// - พรีวิวสื่อด้วย URL เต็ม (prefix API_ORIGIN)
// - ตารางแก้ไขแถว: คงเฉพาะที่จำเป็น (SKU/คอมโบ/ราคา/สต็อก/จัดการ)
// ======================================================================

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, path } from "../lib/api";

const MAX_VARIANT_IMAGES = 9;
const MAX_VARIANT_VIDEOS = 3;

/* ================== helpers / env ================== */
const authHeader = () => {
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const alnumUpper = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const firstNonEmpty = (...arr) => arr.find((v) => typeof v === "string" && v.trim())?.trim() || "";
const rand2 = () => String(Math.floor(Math.random() * 99) + 1).padStart(2, "0");
const basename = (u = "") => {
  try {
    const p = new URL(u, window.location.origin).pathname;
    return (p.split("/").pop() || "").split("?")[0] || u;
  } catch {
    return (u.split("?")[0].split("/").pop() || u);
  }
};

// baseURL → origin ของ backend
const API_ORIGIN = (() => {
  try { return new URL(api?.defaults?.baseURL || "/", window.location.href).origin; }
  catch { return ""; }
})();

// URL ให้ดูได้จริงบนเบราเซอร์
const absMediaUrl = (u) => {
  if (!u) return u;
  const s = String(u).replace(/\\/g, "/");
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/uploads")) return API_ORIGIN + s;
  if (s.startsWith("uploads/")) return API_ORIGIN + "/" + s;
  return s;
};

/* ================== SKU helpers ================== */
const shortFromName = (name, fb) => {
  const cleaned = alnumUpper(name);
  return cleaned ? cleaned.slice(0, 3) : (fb || "PRD");
};
const shortFromOptionText = (text) => {
  if (!text) return "";
  let t = String(text).trim();
  const num = t.match(/(\d+(?:[.,]\d+)?)/)?.[1] || "";
  const unit = t.replace(num, "").trim().toLowerCase();
  const norm = num.replace(",", ".").replace(/\.0+$/, "");
  if (num) {
    if (/ก|กรัม|g\b/.test(unit)) return `${norm}G`;
    if (/กก|กิโล|kg\b/.test(unit)) return `${norm}KG`;
    if (/ลิตร|liter|litre|l\b/.test(unit)) return `${norm}L`;
    if (/มล|ml\b/.test(unit)) return `${norm}ML`;
    if (/ซม|cm\b/.test(unit)) return `${norm}CM`;
    if (/มม|mm\b/.test(unit)) return `${norm}MM`;
    if (/นิ้ว|inch|in\b/.test(unit)) return `${norm}IN`;
  }
  return alnumUpper(t).slice(0, 6);
};

/* ================== Upload helpers ================== */
const UPLOAD_PATHS = ["/upload", "/uploads", "/admin/upload", "/admin/uploads", "/images/upload"];
const UPLOAD_FIELDS = ["file", "image", "photo"];

async function tryUpload(file) {
  for (const pth of UPLOAD_PATHS) {
    for (const field of UPLOAD_FIELDS) {
      try {
        const fd = new FormData();
        fd.append(field, file);
        const { data } = await api.post(path(pth), fd, {
          headers: { ...authHeader(), "Content-Type": "multipart/form-data" },
        });
        const url =
          (typeof data === "string" && data) ||
          data?.url || data?.Location || data?.path || data?.imageUrl || data?.location || null;
        if (url) return url;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404 || status === 400) continue;
        continue;
      }
    }
  }
  throw new Error("UPLOAD_ENDPOINT_NOT_FOUND");
}
async function uploadMany(files) {
  const out = [];
  for (const f of files) {
    const url = await tryUpload(f);
    if (url) out.push(url);
  }
  return out;
}

/* ================== normalize product payload ================== */
const normalizeProduct = (raw) => {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] || null;
  const inner = raw.data || raw.product || raw.item || raw.result || null;
  return (inner && typeof inner === "object") ? inner : raw;
};

/* ================== โหมดเร็ว: 1–3 รายการ → 1 Variant ================== */
function QuickVariantForm({ productId, onDone }) {
  const [rows, setRows] = useState([{ name: "", value: "" }]); // เริ่ม 1 แถว
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState(0);

  const [images, setImages] = useState([]);
  const [videos, setVideos] = useState([]);
  const imgRef = useRef(null);
  const vidRef = useRef(null);

  const makeSku = () => {
    const head = `P${productId}`;
    const txt = (rows[0]?.value || rows[0]?.name || "").trim();
    const shortTxt = shortFromOptionText(txt) || "OTR";
    const tail = String(Math.floor(Math.random() * 9999)).padStart(4, "0");
    return [head, shortTxt, tail].join("-");
  };
  const randomSku = () => setSku(makeSku());

  const addRow = () => { if (rows.length < 3) setRows([...rows, { name: "", value: "" }]); };
  const removeRow = (i) => {
    const next = rows.slice(); next.splice(i, 1);
    if (!next.length) next.push({ name: "", value: "" }); setRows(next);
  };
  const setRow = (i, field, v) => {
    const next = rows.slice(); next[i] = { ...next[i], [field]: v }; setRows(next);
  };

  const onUploadImgs = async (files) => {
    const arr = Array.from(files || []); if (!arr.length) return;
    const urls = await uploadMany(arr); setImages((s) => [...s, ...urls]);
  };
  const onUploadVids = async (files) => {
    const arr = Array.from(files || []); if (!arr.length) return;
    const urls = await uploadMany(arr); setVideos((s) => [...s, ...urls]);
  };

  const submit = async () => {
    const details = rows
      .map((r) => ({ name: (r.name || "").trim(), value: (r.value || "").trim() }))
      .filter((r) => r.name && r.value)
      .slice(0, 3);

    if (!details.length) { alert("กรอกอย่างน้อย 1 รายการ"); return; }

    const payload = {
      details,
      sku: (sku || "").trim() || null,
      price: price === "" ? null : Number(price),
      stock: Number.isFinite(Number(stock)) ? Number(stock) : 0,
      images, videos,
    };

    try {
      await api.post(path(`/variants/products/${productId}/upsert-single`), payload, { headers: authHeader() });
      onDone?.(); alert("บันทึกแล้ว");
      // reset ต้องการค่อยเปิดใช้
      // setRows([{ name: "", value: "" }]); setSku(""); setPrice(""); setStock(0); setImages([]); setVideos([]);
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.error || "บันทึกไม่สำเร็จ");
    }
  };

  return (
    <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>เพิ่มเร็ว (1–3 รายการ)</h3>

      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <input
            placeholder={`ชื่อ #${i + 1} (เช่น ขนาด, สี)`}
            value={r.name}
            onChange={(e) => setRow(i, "name", e.target.value)}
          />
          <input
            placeholder={`ค่า #${i + 1} (เช่น 150, แดง)`}
            value={r.value}
            onChange={(e) => setRow(i, "value", e.target.value)}
          />
          <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1}>ลบ</button>
        </div>
      ))}

      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={addRow} disabled={rows.length >= 3}>+ เพิ่ม</button>
        <span style={{ marginLeft: 8, color: "#667085" }}>สูงสุด 3 รายการ</span>
      </div>

      {/* สื่อ */}
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <label style={{ fontWeight: 600 }}>สื่อ</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="file" accept="image/*" multiple ref={imgRef} style={{ display: "none" }}
              onChange={async (e) => { try { await onUploadImgs(e.target.files); } finally { e.target.value = ""; }}} />
            <button type="button" onClick={() => imgRef.current?.click()}>เลือกรูป…</button>
            <small style={{ color: "#6b6b6b" }}>(อัปโหลดพร้อมบันทึก)</small>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="file" accept="video/*" multiple ref={vidRef} style={{ display: "none" }}
              onChange={async (e) => { try { await onUploadVids(e.target.files); } finally { e.target.value = ""; }}} />
            <button type="button" onClick={() => vidRef.current?.click()}>เลือกวิดีโอ…</button>
          </div>
        </div>

        {(images.length > 0 || videos.length > 0) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {images.map((u, i) => (
              <span key={"img"+i} style={{ border: "1px solid #e5e7eb", borderRadius: 999, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                🖼️ {basename(u)} <button onClick={() => setImages((s)=>s.filter((_,idx)=>idx!==i))}>✕</button>
              </span>
            ))}
            {videos.map((u, i) => (
              <span key={"vid"+i} style={{ border: "1px solid #e5e7eb", borderRadius: 999, padding: "4px 8px", display: "inline-flex", alignItems: "center", gap: 6 }}>
                🎞️ {basename(u)} <button onClick={() => setVideos((s)=>s.filter((_,idx)=>idx!==i))}>✕</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* SKU + ราคา + สต็อก */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.8fr 0.8fr", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input placeholder="SKU (เว้นว่างได้)" value={sku} onChange={(e) => setSku(e.target.value)} />
          <button type="button" onClick={randomSku}>สุ่ม SKU</button>
        </div>
        <input placeholder="ราคา" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        <input placeholder="สต็อก" type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} />
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" onClick={submit} style={{ fontWeight: 700 }}>บันทึก</button>
      </div>
    </section>
  );
}


/* ================== component ================== */
export default function VariantsManager() {
  const { productId: pidParam, id: idParam } = useParams();
  const productId = Number(pidParam || idParam);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const [product, setProduct] = useState(null);
  const [options, setOptions] = useState([]);
  const [variants, setVariants] = useState([]);

  const [draft, setDraft] = useState({
    sku: "", price: "", stock_qty: "",
    images: [], videos: [], values: {}, textInputs: {},
  });

  const [skuPrefix, setSkuPrefix] = useState(`P${productId}`);
  const [genPrice, setGenPrice] = useState(0);
  const [genStock, setGenStock] = useState(0);

  const addImageRef = useRef(null);
  const addVideoRef = useRef(null);

  const boom = useCallback((e, fb = "มีข้อผิดพลาด") => {
    const m =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      (e?.message === "UPLOAD_ENDPOINT_NOT_FOUND"
        ? "ไม่พบจุดอัปโหลด (ลอง /upload หรือ /uploads ที่ backend)"
        : e?.message) ||
      fb;
    setError(m);
    console.error(fb, e);
  }, []);

  /* ---------- โหลดข้อมูล ---------- */
  const normalizeProductWrap = (raw) => normalizeProduct(raw);
  const load = useCallback(async () => {
    setLoading(true); setError(""); setMsg("");
    try {
      // product (ลองหลาย endpoint)
      let prod = null;
      try { prod = normalizeProductWrap((await api.get(path(`/admin/products/${productId}`)))?.data); } catch {}
      if (!prod) { try { prod = normalizeProductWrap((await api.get(path(`/products/${productId}`)))?.data); } catch {} }
      if (!prod) {
        try {
          const r = await api.get(path(`/admin/products`), { params: { include_archived: 1 } });
          const arr = Array.isArray(r?.data?.items) ? r.data.items : (Array.isArray(r?.data) ? r.data : []);
          prod = (arr || []).find((x) => Number(x.product_id) === productId) || null;
        } catch {}
      }
      setProduct(prod);

      // options / variants
      let opts = [], vars = [];
      try { const r1 = await api.get(path(`/variants/products/${productId}/options`)); opts = Array.isArray(r1?.data) ? r1.data : []; } catch {}
      try { const r2 = await api.get(path(`/variants/product/${productId}?active=1`)); vars = Array.isArray(r2?.data) ? r2.data : []; } catch {}
      setOptions(opts); setVariants(vars);
    } catch (e) {
      boom(e, "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [productId, boom]);

  useEffect(() => { load(); }, [load]);

  /* ---------- maps/labels ---------- */
  const optIndexById = useMemo(() => {
    const m = new Map(); options.forEach((o, i) => m.set(o.option_id, i)); return m;
  }, [options]);

  const valNameById = useMemo(() => {
    const m = new Map(); options.forEach((o) => (o.values || []).forEach((v) => m.set(v.value_id, v.value_name))); return m;
  }, [options]);

  const comboText = useCallback((row) => {
    const list = row.combo || row.combos || [];
    if (!list.length) return "—";
    return list.map((c) => {
      const idx = optIndexById.get(c.option_id) ?? 0;
      return `รายละเอียด ${idx + 1}: ${valNameById.get(c.value_id) ?? c.value_id}`;
    }).join(" • ");
  }, [optIndexById, valNameById]);

  /* ---------- SKU suggestion ---------- */
  const buildSkuSuggestion = useCallback(() => {
    const pidPart = String(productId);
    const prodCodeRaw = product?.code || product?.product_code || product?.sku_prefix || product?.product_name || product?.name || "";
    const prodCode = shortFromName(prodCodeRaw, `PD${pidPart}`).padEnd(3, "X");

    const firstOptId = Object.keys(draft.textInputs || {})[0];
    const typed = firstOptId ? draft.textInputs[firstOptId] : "";
    let valueShort = shortFromOptionText(typed);
    if (!valueShort) {
      const chosen = Object.entries(draft.values || [])[0];
      if (chosen) {
        const [, valId] = chosen;
        const valName = valNameById.get(Number(valId));
        valueShort = shortFromOptionText(valName);
      }
    }
    const tail = rand2();
    const parts = [`P${pidPart}`, prodCode];
    if (valueShort) parts.push(valueShort);
    parts.push(tail);
    return parts.filter(Boolean).join("-");
  }, [product, draft.textInputs, draft.values, valNameById, productId]);

  /* ---------- พิมพ์ค่า → สร้าง value อัตโนมัติ ---------- */
  const chooseOrCreateValue = useCallback(async (option, typed) => {
    const text = (typed || "").trim();
    const oid = option.option_id;
    setDraft((s) => ({ ...s, textInputs: { ...s.textInputs, [oid]: text } }));

    if (!text) { setDraft((s) => ({ ...s, values: { ...s.values, [oid]: "" } })); return; }
    const exists = (option.values || []).find((v) => (v.value_name || "").toLowerCase() === text.toLowerCase());
    if (exists) { setDraft((s) => ({ ...s, values: { ...s.values, [oid]: exists.value_id } })); return; }

    try {
      await api.post(path(`/variants/options/${oid}/values`), { value_name: text }, { headers: authHeader() });
      await load();
      const found = [...valNameById.entries()].find(([, name]) => (name || "").toLowerCase() === text.toLowerCase());
      if (found) {
        const value_id = found[0];
        setDraft((s) => ({ ...s, values: { ...s.values, [oid]: value_id }, textInputs: { ...s.textInputs, [oid]: text } }));
      }
    } catch (e) { boom(e, "เพิ่มค่าไม่สำเร็จ"); }
  }, [boom, load, valNameById]);

  /* ---------- actions: create/update/delete ---------- */
  const createVariant = useCallback(async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      const option_values = Object.entries(draft.values)
        .map(([oid, vid]) => ({ option_id: Number(oid), value_id: Number(vid) }))
        .filter((v) => v.value_id);

      const finalSku = (draft.sku || "").trim() || buildSkuSuggestion();

      await api.post(path(`/variants/products/${productId}/variants`), {
        sku: finalSku,
        price: draft.price === "" ? 0 : Math.max(0, Number(draft.price || 0)),
        stock_qty: Math.max(0, Number(draft.stock_qty || 0)),
        image_url: draft.images[0] || null,
        images: draft.images,
        videos: draft.videos,
        is_active: true, // ตรึงให้เปิดขายเสมอในทาง backend
        option_values,
      }, { headers: authHeader() });

      setDraft({ sku: "", price: "", stock_qty: "", images: [], videos: [], values: {}, textInputs: {} });
      await load();
      setMsg("บันทึกแล้ว");
    } catch (e) {
      boom(e, "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [draft, productId, load, boom, buildSkuSuggestion]);

  const updateVariant = useCallback(async (variant_id, patch) => {
    setBusy(true); setError(""); setMsg("");
    try {
      const body = {};
      if ("price" in patch) body.price = patch.price === "" ? null : Math.max(0, Number(patch.price || 0));
      if ("stock_qty" in patch) body.stock_qty = Math.max(0, Number(patch.stock_qty || 0));
      if ("sku" in patch) body.sku = patch.sku?.trim() || buildSkuSuggestion();
      if ("images" in patch) { body.image_url = patch.images?.[0] || null; body.images = patch.images; }
      if ("videos" in patch) { body.videos = patch.videos; }

      await api.put(path(`/variants/${variant_id}`), body, { headers: authHeader() });
      await load();
      setMsg("บันทึกแล้ว");
    } catch (e) {
      boom(e, "อัปเดตไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [boom, load, buildSkuSuggestion]);

  const deleteVariant = useCallback(async (variant_id) => {
    if (!window.confirm("ลบรายการนี้?")) return;
    setBusy(true);
    try { await api.delete(path(`/variants/${variant_id}`), { headers: authHeader() }); await load(); setMsg("ลบแล้ว"); }
    catch (e) { boom(e, "ลบไม่สำเร็จ"); }
    finally { setBusy(false); }
  }, [boom, load]);

  const generateCombos = useCallback(async () => {
    setBusy(true); setError(""); setMsg("");
    try {
      await api.post(path(`/variants/products/${productId}/variants/generate`), {
        sku_prefix: (skuPrefix || "").trim() || `P${productId}`,
        price: Math.max(0, Number(genPrice || 0)),
        stock_qty: Math.max(0, Number(genStock || 0)),
      }, { headers: authHeader() });
      await load();
      setMsg("สร้างแล้ว");
    } catch (e) { boom(e, "สร้างไม่สำเร็จ"); }
    finally { setBusy(false); }
  }, [productId, skuPrefix, genPrice, genStock, boom, load]);

  /* ================== render ================== */
  if (loading) return <div style={{ padding: 16 }}>กำลังโหลด…</div>;

  const productName = firstNonEmpty(
    product?.product_name, product?.name, product?.product_title, product?.title,
    product?.name_th, product?.title_th, product?.product_name_th
  );
  const productCode = firstNonEmpty(product?.code, product?.product_code, product?.sku_prefix, product?.sku, product?.barcode) || `P${productId}`;

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>
          ตัวเลือก/Variants — <span style={{ color: "#111827", fontWeight: 800, fontSize: 22 }}>
            {productName || `#${productId}`}
          </span>
          <span style={{ marginLeft: 10, color: "#065f46", fontWeight: 800, fontSize: 18 }}>· {productCode}</span>
        </h2>
        <Link to="/admin" style={{ marginLeft: "auto" }}>← กลับ</Link>
      </div>

      {(error || msg) && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {error && <div style={{ color: "#fff", background: "#d33", padding: "8px 12px", borderRadius: 8 }}>{error}</div>}
          {msg && <div style={{ color: "#fff", background: "green", padding: "8px 12px", borderRadius: 8 }}>{msg}</div>}
        </div>
      )}

      {/* เพิ่มเร็ว */}
      <QuickVariantForm productId={productId} onDone={load} />

      {/* เพิ่มแบบ/ตัวเลือก (เต็ม) */}
      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>เพิ่มแบบ/ตัวเลือก</h3>

        <div style={{ display: "grid", gap: 10, maxWidth: 860 }}>
          {/* SKU */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder="SKU (เว้นว่างให้สุ่มได้)"
                value={draft.sku}
                onChange={(e) => setDraft((s) => ({ ...s, sku: e.target.value }))}
                disabled={busy}
                style={{ flex: "1 1 280px" }}
              />
              <button type="button" onClick={() => setDraft((s) => ({ ...s, sku: buildSkuSuggestion() }))} disabled={busy}>
                สุ่ม SKU
              </button>
            </div>
            <small style={{ color: "#6b6b6b" }}>โครง: P+รหัสสินค้า+ค่าตัวเลือก+เลขสุ่ม เช่น P{productId}-PCH-500G-07</small>
          </div>

          {/* สื่อ */}
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ fontWeight: 600 }}>สื่อ</label>

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {/* รูป */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={() => addImageRef.current?.click()} disabled={busy}>เลือกรูป…</button>
                <small style={{ color: "#6b6b6b" }}>(สูงสุด {MAX_VARIANT_IMAGES})</small>
                <input
                  type="file" accept="image/*" ref={addImageRef} multiple style={{ display: "none" }}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []); if (!files.length) return;
                    if (files.some((f) => !f.type.startsWith("image/"))) { setError("อนุญาตเฉพาะรูปภาพ"); e.target.value = ""; return; }
                    setBusy(true);
                    try {
                      const remain = Math.max(0, MAX_VARIANT_IMAGES - draft.images.length);
                      const slice = files.slice(0, remain);
                      const urls = await uploadMany(slice);
                      setDraft((s) => ({ ...s, images: [...s.images, ...urls] }));
                      setMsg("อัปโหลดรูปแล้ว");
                    } catch (err) { boom(err, "อัปโหลดรูปไม่สำเร็จ"); }
                    finally { setBusy(false); e.target.value = ""; }
                  }}
                />
              </div>

              {/* วิดีโอ */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={() => addVideoRef.current?.click()} disabled={busy}>เลือกวิดีโอ…</button>
                <small style={{ color: "#6b6b6b" }}>(สูงสุด {MAX_VARIANT_VIDEOS})</small>
                <input
                  type="file" accept="video/*" ref={addVideoRef} multiple style={{ display: "none" }}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files || []); if (!files.length) return;
                    setBusy(true);
                    try {
                      const remain = Math.max(0, MAX_VARIANT_VIDEOS - draft.videos.length);
                      const slice = files.slice(0, remain);
                      const urls = await uploadMany(slice);
                      setDraft((s) => ({ ...s, videos: [...s.videos, ...urls] }));
                      setMsg("อัปโหลดวิดีโอแล้ว");
                    } catch (err) { boom(err, "อัปโหลดวิดีโอไม่สำเร็จ"); }
                    finally { setBusy(false); e.target.value = ""; }
                  }}
                />
              </div>
            </div>

            {/* รายการสื่อ */}
            {(draft.images.length > 0 || draft.videos.length > 0) && (
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {draft.images.map((u, i) => (
                    <span key={"img" + i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 999 }}>
                      🖼️ {basename(u)}
                      <button type="button" onClick={() => setDraft((s) => ({ ...s, images: s.images.filter((_, idx) => idx !== i) }))} style={{ marginLeft: 4 }}>✕</button>
                    </span>
                  ))}
                  {draft.videos.map((u, i) => (
                    <span key={"vid" + i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 999 }}>
                      🎞️ {basename(u)}
                      <button type="button" onClick={() => setDraft((s) => ({ ...s, videos: s.videos.filter((_, idx) => idx !== i) }))} style={{ marginLeft: 4 }}>✕</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* พรีวิวรูป */}
            {draft.images.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
                {draft.images.map((u, i) => (
                  <div key={u + i} style={{ position: "relative" }}>
                    <img
                      src={absMediaUrl(u)}
                      alt="preview"
                      style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: 8, border: "1px solid #eee" }}
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                    <button type="button" onClick={() => setDraft((s) => ({ ...s, images: s.images.filter((_, idx) => idx !== i) }))} style={{ position: "absolute", top: 4, right: 4 }}>✕</button>
                    {i === 0 && (
                      <div style={{ position: "absolute", left: 6, bottom: 6, background: "#0008", color: "#fff", fontSize: 12, padding: "2px 6px", borderRadius: 6 }}>
                        รูปหลัก
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* พรีวิววิดีโอ */}
            {draft.videos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
                {draft.videos.map((u, i) => (
                  <div key={u + i} style={{ position: "relative" }}>
                    <video src={absMediaUrl(u)} style={{ width: "100%", aspectRatio: "16/9", borderRadius: 8, border: "1px solid #eee" }} controls />
                    <button type="button" onClick={() => setDraft((s) => ({ ...s, videos: s.videos.filter((_, idx) => idx !== i) }))} style={{ position: "absolute", top: 4, right: 4 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* รายละเอียด N */}
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          {options.map((opt, idx) => (
            <div key={opt.option_id} style={{ display: "grid", gap: 6 }}>
              <label style={{ fontWeight: 600 }}>รายละเอียด {idx + 1}</label>
              <input
                list={`opt-${opt.option_id}-list`}
                placeholder="พิมพ์หรือเลือกแล้วกด Enter/คลิกออก"
                value={draft.textInputs[opt.option_id] ?? ""}
                onChange={(e) => setDraft((s) => ({ ...s, textInputs: { ...s.textInputs, [opt.option_id]: e.target.value } }))}
                onBlur={(e) => chooseOrCreateValue(opt, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chooseOrCreateValue(opt, e.currentTarget.value); } }}
                disabled={busy}
              />
              <datalist id={`opt-${opt.option_id}-list`}>
                {(opt.values || []).map((v) => <option key={v.value_id} value={v.value_name} />)}
              </datalist>
              <small style={{ color: "#666" }}>ว่างได้ • ถ้าเป็นค่าใหม่ ระบบจะสร้างให้</small>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <input type="number" min={0} placeholder="ราคา" value={draft.price} onChange={(e) => setDraft((s) => ({ ...s, price: e.target.value }))} disabled={busy} style={{ maxWidth: 220 }} />
          <input type="number" min={0} placeholder="สต็อก" value={draft.stock_qty} onChange={(e) => setDraft((s) => ({ ...s, stock_qty: e.target.value }))} disabled={busy} style={{ maxWidth: 140 }} />
          <button onClick={createVariant} disabled={busy} style={{ fontWeight: 700 }}>บันทึก</button>
        </div>
      </section>

      {/* สร้างทั้งหมด */}
      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>สร้างทั้งหมด</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label>SKU prefix</label>
          <input value={skuPrefix} onChange={(e) => setSkuPrefix(e.target.value)} disabled={busy} />
          <label>ราคาเริ่ม</label>
          <input type="number" min={0} value={genPrice} onChange={(e) => setGenPrice(e.target.value)} disabled={busy} style={{ maxWidth: 160 }} />
          <label>สต็อกเริ่ม</label>
          <input type="number" min={0} value={genStock} onChange={(e) => setGenStock(e.target.value)} disabled={busy} style={{ maxWidth: 160 }} />
          <button onClick={generateCombos} disabled={busy}>สร้าง</button>
        </div>
        <div style={{ color: "#6b6b6b", marginTop: 6, fontSize: 14 }}>ข้ามรายการที่ซ้ำ</div>
      </section>

      {/* ตาราง */}
      <section style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>รายการแบบ/ตัวเลือก</h3>
        <VariantsTable rows={variants} comboText={comboText} onSave={updateVariant} onDelete={deleteVariant} busy={busy} />
      </section>
    </div>
  );
}

/* ================== table ================== */
function VariantsTable({ rows, comboText, onSave, onDelete, busy }) {
  return (
    <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          <th align="left">#</th>
          <th align="left">สื่อ</th>
          <th align="left">SKU</th>
          <th align="left">คอมโบ</th>
          <th align="right">ราคา</th>
          <th align="right">สต็อก</th>
          <th>จัดการ</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={7} align="center"><em>ยังไม่มี Variant</em></td></tr>
        )}
        {rows.map((r, i) => (
          <VariantRow key={r.variant_id} idx={i + 1} row={r} comboText={comboText} onSave={onSave} onDelete={onDelete} busy={busy} />
        ))}
      </tbody>
    </table>
  );
}

function VariantRow({ idx, row, comboText, onSave, onDelete, busy }) {
  const [sku, setSku] = useState(row.sku || "");
  const [price, setPrice] = useState(row.final_price ?? row.price ?? "");
  const [stock, setStock] = useState(row.stock ?? row.stock_qty ?? 0);

  const initImages = row.images || row.image_urls || (row.image_url ? [row.image_url] : []);
  const initVideos = row.videos || row.video_urls || [];
  const [images, setImages] = useState(Array.isArray(initImages) ? initImages : []);
  const [videos, setVideos] = useState(Array.isArray(initVideos) ? initVideos : []);

  const imgFileRef = useRef(null);
  const vidFileRef = useRef(null);

  return (
    <tr style={{ borderTop: "1px solid #eee" }}>
      <td>{idx}</td>
      <td>
        <div style={{ display: "grid", gap: 6 }}>
          {/* รูปทั้งหมด */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {images.length === 0 && <div style={{ width: 48, height: 48, border: "1px dashed #ccc", borderRadius: 6 }} />}
            {images.map((u, j) => (
              <div key={u + j} style={{ position: "relative" }}>
                <img
                  src={absMediaUrl(u)}
                  alt="thumb"
                  style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid #eee" }}
                  onError={(e) => (e.currentTarget.style.display = "none")}
                />
                <button type="button" onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== j))} style={{ position: "absolute", top: 2, right: 2, fontSize: 12, lineHeight: 1 }}>
                  ✕
                </button>
                {j === 0 && (
                  <div style={{ position: "absolute", left: 4, bottom: 4, background: "#0008", color: "#fff", fontSize: 10, padding: "1px 4px", borderRadius: 4 }}>
                    รูปหลัก
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* วิดีโอ */}
          {videos.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {videos.map((u, i) => (
                <div key={u + i} style={{ position: "relative" }}>
                  <video src={absMediaUrl(u)} style={{ width: 80, height: 48, borderRadius: 6, border: "1px solid #eee" }} muted controls />
                  <button type="button" onClick={() => setVideos((prev) => prev.filter((_, idx) => idx !== i))} style={{ position: "absolute", top: 2, right: 2, fontSize: 12, lineHeight: 1 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ปุ่มอัปโหลดสื่อเพิ่ม */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="file" accept="image/*" ref={imgFileRef} multiple style={{ display: "none" }}
              onChange={async (e) => {
                const files = Array.from(e.target.files || []); if (!files.length) return;
                try {
                  const remain = Math.max(0, MAX_VARIANT_IMAGES - images.length);
                  const slice = files.slice(0, remain);
                  const urls = await uploadMany(slice);
                  setImages((prev) => [...prev, ...urls]);
                } finally { e.target.value = ""; }
              }}
            />
            <button type="button" onClick={() => imgFileRef.current?.click()} disabled={busy}>อัปโหลดรูป…</button>

            <input
              type="file" accept="video/*" ref={vidFileRef} multiple style={{ display: "none" }}
              onChange={async (e) => {
                const files = Array.from(e.target.files || []); if (!files.length) return;
                try {
                  const remain = Math.max(0, MAX_VARIANT_VIDEOS - videos.length);
                  const slice = files.slice(0, remain);
                  const urls = await uploadMany(slice);
                  setVideos((prev) => [...prev, ...urls]);
                } finally { e.target.value = ""; }
              }}
            />
            <button type="button" onClick={() => vidFileRef.current?.click()} disabled={busy}>อัปโหลดวิดีโอ…</button>
          </div>
        </div>
      </td>

      <td><input value={sku} onChange={(e) => setSku(e.target.value)} style={{ width: 180 }} /></td>
      <td>{comboText(row)}</td>
      <td align="right"><input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 120, textAlign: "right" }} /></td>
      <td align="right"><input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} style={{ width: 100, textAlign: "right" }} /></td>
      <td>
        <button onClick={() => onSave(row.variant_id, { sku, price, stock_qty: stock, images, videos })} disabled={busy} style={{ fontWeight: 700 }}>
          บันทึก
        </button>
        <button onClick={() => onDelete(row.variant_id)} disabled={busy} style={{ marginLeft: 8 }}>
          ลบ
        </button>
      </td>
    </tr>
  );
}
