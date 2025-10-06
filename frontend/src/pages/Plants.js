// src/pages/Plants.js
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import "./Plants.css";

/** category_id ของหมวดหลัก "ต้นไม้" */
const PLANTS_CATEGORY_ID = "ro1";

/** ทำ URL รูปให้ absolute (ตัด /api ออกให้เอง) */
const apiBase = axios.defaults.baseURL || process.env.REACT_APP_API_BASE || "http://localhost:3001/api";
const originBase = (() => {
  try {
    const u = new URL(apiBase);
    return u.origin + (u.pathname.replace(/\/api\/?$/, "") || "");
  } catch {
    return "http://localhost:3001";
  }
})();
const resolveUrl = (u) => {
  if (!u) return "";
  const s = String(u);
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("blob:")) return s;
  if (s.startsWith("/")) return `${originBase}${s}`;
  return s;
};

export default function Plants() {
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  /** รูปสำรองตาม id (เผื่อยังไม่มีรูปใน DB) */
  const fallbackImages = useMemo(
    () => ({
      po1: process.env.PUBLIC_URL + "/lamyai.jpg",     // ไม้ผล
      po2: process.env.PUBLIC_URL + "/tonmai.jpg",     // ไม้ดอก/ประดับ
      po3: process.env.PUBLIC_URL + "/p2.png",         // ไม้เศรษฐกิจ
      po4: process.env.PUBLIC_URL + "/payanaka1.jpg",  // ไม้สมุนไพร
    }),
    []
  );

  // ปลายทางเมื่อคลิกหมวดย่อย → ไปหน้ารวมสินค้าของหมวดต้นไม้ + ระบุ subcategory
  const buildLink = (slug) =>
    `/products?category=${encodeURIComponent("plants")}&subcategory=${encodeURIComponent(slug)}`;

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        // ✅ ใช้ /api/lookups (มีจริง) แล้วกรอง subcategories ตาม ro1
        const r = await axios.get("/api/lookups", { params: { published: 1, _: Date.now() } });
        const subs = Array.isArray(r?.data?.subcategories) ? r.data.subcategories : [];
        const rows = subs
          .filter((x) => String(x.category_id) === PLANTS_CATEGORY_ID)
          .map((x) => ({
            slug: String(x.subcategory_id),
            name: String(x.subcategory_name || "-"),
            desc: "",
            img: resolveUrl(x.image_url || ""),
          }));
        if (!off) setCats(rows);
      } catch (e) {
        if (!off) setErr(e?.response?.data?.message || e.message || "โหลดหมวดย่อยไม่สำเร็จ");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, []);

  const placeholders = useMemo(() => Array.from({ length: 4 }), []);

  return (
    <div className="plants-page">
      {/* breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/" className="crumb">หน้าแรก</Link>
        <span className="sep">›</span>
        <span className="crumb current">ต้นไม้</span>
      </nav>

      {/* ปุ่มกลับหน้าแรก */}
      <div className="topbar">
        <Link to="/" className="back-btn" aria-label="กลับหน้าแรก">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="back-icon">
            <path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          กลับหน้าแรก
        </Link>
      </div>

      {/* hero */}
      <header className="plants-hero">
        <h1>เลือกหมวดย่อยของ <span className="hl">ต้นไม้</span></h1>
        <p className="sub">เลือกประเภทที่ต้องการ เพื่อดูรายการสินค้าเฉพาะหมวดนั้น ๆ</p>
      </header>

      {err && <div className="note-error">{err}</div>}

      {/* cards/grid */}
      <section className="plants-categories">
        {loading
          ? placeholders.map((_, i) => (
              <div className="plant-card skel" key={`skel-${i}`}>
                <div className="thumb shine" />
                <div className="meta">
                  <div className="line shine" style={{ width: "60%", height: 16 }} />
                  <div className="line shine" style={{ width: "80%", height: 12, marginTop: 6 }} />
                </div>
              </div>
            ))
          : cats.map((c) => {
              const imgSrc = c.img || fallbackImages[c.slug] || (process.env.PUBLIC_URL + "/placeholder.jpg");
              return (
                <Link to={buildLink(c.slug)} className="plant-card" key={c.slug} aria-label={c.name}>
                  <div className="thumb">
                    <img
                      src={imgSrc}
                      alt={c.name}
                      onError={(e) => (e.currentTarget.src = process.env.PUBLIC_URL + "/logo.png")}
                    />
                  </div>
                  <div className="meta">
                    <p className="p-name">{c.name}</p>
                    <p className="p-desc">{c.desc}</p>
                  </div>
                </Link>
              );
            })}
      </section>
    </div>
  );
}
