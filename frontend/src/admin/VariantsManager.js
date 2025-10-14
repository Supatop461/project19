// src/admin/VariantsManager.js
// ======================================================================
// VariantsManager — แบบง่าย (ไม่แปลงไทยเป็นอังกฤษ)
// - ตัวเลือก 1–3 (เพิ่มด้วย Enter)
// - ตารางคอมโบ + อัปโหลดรูปต่อแถว (พรีวิวทันที)
// - บันทึกทั้งหมด -> POST /admin/products/:id/variants/generate
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

const pickStr = (...xs) => xs.find((v) => typeof v === "string" && v.trim())?.trim() || "";
const rand2 = () => String(Math.floor(Math.random() * 99) + 1).padStart(2, "0");

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

/* ====================================================================== */
export default function VariantsManager() {
  const { id, productId: pid } = useParams();
  const productId = Number(id || pid);

  // product for header + SKU
  const [product, setProduct] = useState(null);

  // option names
  const [opt1Name, setOpt1Name] = useState("สี");
  const [opt2Name, setOpt2Name] = useState("ขนาด");
  const [opt3Name, setOpt3Name] = useState("");

  // option values
  const [opt1Values, setOpt1Values] = useState([]);
  const [opt2Values, setOpt2Values] = useState([]);
  const [opt3Values, setOpt3Values] = useState([]);

  // combos
  const [rows, setRows] = useState([]);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  /* ---------- Load product (ชื่อ/โค้ด) ---------- */
  const loadProduct = useCallback(async () => {
    let p = null;
    try {
      const r = await api.get(path(`/admin/products/${productId}`));
      p = normalizeProduct(r?.data);
    } catch {}
    if (!p) {
      try {
        const r = await api.get(path(`/products/${productId}`));
        p = normalizeProduct(r?.data);
      } catch {}
    }
    if (!p) {
      try {
        const r = await api.get(path(`/admin/products`), { params: { include_archived: 1 } });
        const arr = Array.isArray(r?.data?.items) ? r.data.items : (Array.isArray(r?.data) ? r.data : []);
        p = (arr || []).find((x) => Number(x.product_id) === productId) || null;
      } catch {}
    }
    setProduct(p || null);
  }, [productId]);

  useEffect(() => { loadProduct(); }, [loadProduct]);

  const productName = useMemo(
    () => pickStr(product?.product_name, product?.name, product?.title),
    [product]
  );
  const productCode = useMemo(
    () => pickStr(product?.product_code, product?.code, `P${productId}`),
    [product, productId]
  );

  /* ---------- Rebuild combos when values change ---------- */
  useEffect(() => {
    const v1 = opt1Values.length ? opt1Values : [null];
    const v2 = opt2Values.length ? opt2Values : [null];
    const v3 = opt3Values.length ? opt3Values : [null];
    const combos = [];
    for (const a of v1) for (const b of v2) for (const c of v3) {
      combos.push({ opt1: a, opt2: b, opt3: c, price: "", sku: "", image: null });
    }
    setRows(combos);
  }, [opt1Values, opt2Values, opt3Values]);

  /* ---------- chip helpers ---------- */
  const addTag = (list, setList, txt) => {
    const v = String(txt || "").trim();
    if (!v) return;
    if (!list.some((x) => x === v)) setList([...list, v]);
  };
  const removeTag = (list, setList, idx) => setList(list.filter((_, i) => i !== idx));

  /* ---------- per-row upload ---------- */
  const onUploadRowImage = async (file, idx) => {
    if (!file) return;

    const tempUrl = URL.createObjectURL(file);
    setRows((prev) => {
      const a = [...prev];
      a[idx] = { ...a[idx], image: tempUrl, __temp: true };
      return a;
    });

    try {
      const serverUrl = await tryUpload(file);
      setRows((prev) => {
        const a = [...prev];
        a[idx] = { ...a[idx], image: serverUrl, __temp: false };
        return a;
      });
    } catch (e) {
      setRows((prev) => {
        const a = [...prev];
        a[idx] = { ...a[idx], image: null, __temp: false };
        return a;
      });
      alert(e?.message || "Upload failed");
    } finally {
      setTimeout(() => URL.revokeObjectURL(tempUrl), 2500);
    }
  };

  /* ---------- Auto SKU (ไม่แปลงภาษา) ---------- */
  const autoSku = () => {
    const base = productCode || `P${productId}`;
    setRows((prev) =>
      prev.map((r) => {
        const parts = [base, r.opt1, r.opt2, r.opt3].filter(Boolean);
        return { ...r, sku: parts.join("-") + "-" + rand2() };
      })
    );
  };

  /* ---------- Save batch ---------- */
  const saveAll = async () => {
    setSaving(true);
    try {
      // กรองเฉพาะแถวที่มีรายละเอียดอย่างน้อย 1 ช่อง (กันเคส null,null,null)
      const effective = rows.filter((r) => r.opt1 || r.opt2 || r.opt3);

      const payloadRows = effective.map((r) => ({
        details: [
          r.opt1 ? { name: opt1Name, value: r.opt1 } : null,
          r.opt2 ? { name: opt2Name, value: r.opt2 } : null,
          r.opt3 && opt3Name ? { name: opt3Name, value: r.opt3 } : null,
        ].filter(Boolean),
        sku: r.sku || null,
        price: r.price !== "" ? Number(r.price) : null,
        image_url: r.image || null, // ✅ backend handler อ่าน image_url
      }));

      if (!payloadRows.length) {
        alert("ยังไม่มีแถวที่มีรายละเอียดสำหรับบันทึก");
        setSaving(false);
        return;
      }

      // ✅ ใช้ key "rows" ให้ตรง backend (เดิมใช้ items → 404/400)
      const res = await api.post(
        path(`/admin/products/${productId}/variants/generate`),
        { rows: payloadRows },
        { headers: authHeader() }
      );

      setMsg("✅ Saved");
      setTimeout(() => setMsg(""), 1800);

      // (ออปชั่น) ถ้าต้องการ รีเฟรชข้อมูล variants อีกครั้งค่อยเพิ่มโหลดหลังบ้านมาตรงนี้
      // await loadSomething(); 
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || "❌ Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="vm-page">
      {/* Header */}
      <div className="vm-header">
        <div className="vm-title">
          <div className="vm-product-name">{productName || `#${productId}`}</div>
          <div className="vm-product-code">{productCode}</div>
        </div>
        <Link to="/admin" className="vm-back">← กลับ</Link>
      </div>

      {msg && <div className="vm-msg">{msg}</div>}

      {/* Options */}
      <div className="vm-options">
        {/* option 1 */}
        <div className="vm-opt">
          <label>ตัวเลือกที่ 1</label>
          <input value={opt1Name} onChange={(e) => setOpt1Name(e.target.value)} />
          <div className="vm-chips">
            {opt1Values.map((v, i) => (
              <span key={i} className="vm-chip">
                {v}
                <button onClick={() => removeTag(opt1Values, setOpt1Values, i)}>×</button>
              </span>
            ))}
            <input
              placeholder="พิมพ์แล้ว Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(opt1Values, setOpt1Values, e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>
        </div>

        {/* option 2 */}
        <div className="vm-opt">
          <label>ตัวเลือกที่ 2 (ถ้ามี)</label>
          <input value={opt2Name} onChange={(e) => setOpt2Name(e.target.value)} />
          <div className="vm-chips">
            {opt2Values.map((v, i) => (
              <span key={i} className="vm-chip">
                {v}
                <button onClick={() => removeTag(opt2Values, setOpt2Values, i)}>×</button>
              </span>
            ))}
            <input
              placeholder="พิมพ์แล้ว Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(opt2Values, setOpt2Values, e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
            />
          </div>
        </div>

        {/* option 3 */}
        <div className="vm-opt">
          <label>ตัวเลือกที่ 3 (ถ้ามี)</label>
          <input
            value={opt3Name}
            onChange={(e) => setOpt3Name(e.target.value)}
            placeholder="เช่น วัสดุ / รุ่น"
          />
          <div className="vm-chips">
            {opt3Values.map((v, i) => (
              <span key={i} className="vm-chip">
                {v}
                <button onClick={() => removeTag(opt3Values, setOpt3Values, i)}>×</button>
              </span>
            ))}
            <input
              placeholder="พิมพ์แล้ว Enter"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(opt3Values, setOpt3Values, e.currentTarget.value);
                  e.currentTarget.value = "";
                }
              }}
            />
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
                      +
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => onUploadRowImage(e.target.files?.[0], i)}
                      />
                    </label>
                  )}
                </td>
                <td>{r.opt1 || "-"}</td>
                <td>{r.opt2 || "-"}</td>
                <td>{r.opt3 || "-"}</td>
                <td>
                  <input
                    type="number"
                    min="0"
                    placeholder="ไม่ระบุ"
                    value={r.price}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) => {
                        const a = [...prev];
                        a[i] = { ...a[i], price: v };
                        return a;
                      });
                    }}
                  />
                </td>
                <td>
                  <input
                    placeholder="SKU"
                    value={r.sku}
                    onChange={(e) => {
                      const v = e.target.value;
                      setRows((prev) => {
                        const a = [...prev];
                        a[i] = { ...a[i], sku: v };
                        return a;
                      });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div className="vm-actions">
        <button className="btn" onClick={autoSku} disabled={saving}>
          เติม SKU อัตโนมัติ
        </button>
        <button className="btn-primary" onClick={saveAll} disabled={saving}>
          {saving ? "กำลังบันทึก…" : "บันทึกทั้งหมด"}
        </button>
      </div>

      {/* Notes */}
      <div className="vm-hint">
        <p>• Enter เพื่อเพิ่มค่า (เพิ่มได้หลายค่า)</p>
        <p>• สต็อกจะอิงจากคลังจริง (ไม่ต้องกรอกที่นี่)</p>
      </div>
    </div>
  );
}
