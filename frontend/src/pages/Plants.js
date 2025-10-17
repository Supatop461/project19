// src/pages/Tools.js
import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import "./Tools.css";

// ใช้ตัวช่วยเรียก API กลางของโปรเจกต์ (มีแนบ token ให้อัตโนมัติ)
import { api, mediaSrc } from "../lib/api";

export default function Tools() {
  // รหัสหมวดหลัก "อุปกรณ์เพาะปลูก" ในระบบ (เคยใช้คำว่า tools)
  const ROOT_CODE = "tools";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rootCat, setRootCat] = useState(null);       // หมวดหลัก (อุปกรณ์)
  const [subcats, setSubcats] = useState([]);         // หมวดย่อยจากฐานข้อมูล

  // แปลงรูปภาพจาก path ใน DB -> URL เสิร์ฟจาก backend (/uploads/...)
  const imgOrFallback = (row) => {
    const src =
      row?.image_url ||
      row?.icon_url ||
      row?.thumbnail_url ||
      row?.thumb_url ||
      "";
    const url = mediaSrc ? mediaSrc(src) : src;
    return url && String(url).trim()
      ? url
      : process.env.PUBLIC_URL + "/logo.png";
  };

  // ลิงก์ไปยังหน้ารายการสินค้า ตามหมวดย่อย
  const buildLink = (s) =>
    `/products?category=${encodeURIComponent(ROOT_CODE)}&sub=${encodeURIComponent(s)}`;

  useEffect(() => {
    let isMounted = true;

    async function fetchAll() {
      setLoading(true);
      setErr("");
      try {
        // 1) หา "อุปกรณ์" (root category) จาก DB
        //    พยายามหลายรูปแบบ เพื่อรองรับสคีมาที่ต่างกัน
        const tryGetRoot = async () => {
          // a) /api/categories?code=tools
          let { data } = await api.get("/categories", { params: { code: ROOT_CODE } });
          if (Array.isArray(data) && data.length) return data[0];

          // b) /api/categories?slug=tools
          ({ data } = await api.get("/categories", { params: { slug: ROOT_CODE } }));
          if (Array.isArray(data) && data.length) return data[0];

          // c) /api/categories?name=อุปกรณ์เพาะปลูก
          ({ data } = await api.get("/categories", { params: { name: "อุปกรณ์เพาะปลูก" } }));
          if (Array.isArray(data) && data.length) return data[0];

          // d) ถ้าดึงไม่ได้จริง ๆ ให้โยน error เพื่อให้ขึ้นข้อความว่าง
          throw new Error("ไม่พบหมวดหลัก 'อุปกรณ์เพาะปลูก'");
        };

        const root = await tryGetRoot();

        // 2) ดึงหมวดย่อยของ root
        const tryGetSubcats = async () => {
          // A) /api/subcategories?category_id=ID
          let { data } = await api.get("/subcategories", { params: { category_id: root.id || root.category_id } });
          if (Array.isArray(data) && data.length) return data;

          // B) /api/categories/:id/subcategories
          try {
            ({ data } = await api.get(`/categories/${root.id || root.category_id}/subcategories`));
            if (Array.isArray(data) && data.length) return data;
          } catch {}

          // C) /api/subcategories?category=tools
          ({ data } = await api.get("/subcategories", { params: { category: ROOT_CODE } }));
          if (Array.isArray(data) && data.length) return data;

          // D) เผื่อบางสคีมาเก็บ subcat ปนใน categories (parent_id)
          ({ data } = await api.get("/categories", { params: { parent_id: root.id || root.category_id } }));
          if (Array.isArray(data) && data.length) return data;

          return [];
        };

        const subs = await tryGetSubcats();

        if (!isMounted) return;

        setRootCat(root);
        // ทำให้มี key สำคัญครบ: slug/code/id/name และรูปภาพ
        const normalized = subs.map((s) => ({
          id: s.id ?? s.subcategory_id ?? s.category_id ?? s.code ?? s.slug ?? s.name,
          slug: s.slug ?? s.code ?? String(s.id ?? s.subcategory_id ?? s.category_id ?? "").toLowerCase(),
          name: s.name ?? s.subcategory_name ?? s.category_name ?? "",
          img: imgOrFallback(s),
        }));

        // กันซ้ำตาม id/slug
        const uniq = [];
        const seen = new Set();
        for (const x of normalized) {
          const k = String(x.id ?? x.slug);
          if (!seen.has(k)) {
            uniq.push(x);
            seen.add(k);
          }
        }

        setSubcats(uniq);
        setLoading(false);
      } catch (e) {
        if (!isMounted) return;
        setErr(e?.message || "โหลดข้อมูลไม่สำเร็จ");
        setLoading(false);
      }
    }

    fetchAll();
    return () => { isMounted = false; };
  }, []);

  const title = useMemo(() => {
    const nm =
      rootCat?.name ||
      rootCat?.category_name ||
      "อุปกรณ์เพาะปลูก";
    return nm;
  }, [rootCat]);

  return (
    <div className="plants-page">
      {/* breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/" className="crumb">หน้าแรก</Link>
        <span className="sep">›</span>
        <span className="crumb current">{title}</span>
      </nav>

      {/* hero */}
      <header className="plants-hero">
        <h1>เลือกหมวดย่อยของ <span className="hl">{title}</span></h1>
        <p className="sub">เลือกหมวดอุปกรณ์เพื่อดูรายการสินค้าที่เกี่ยวข้อง</p>
      </header>

      {/* states */}
      {loading && <p style={{ opacity: 0.7 }}>กำลังโหลดหมวดหมู่ย่อย...</p>}
      {!loading && err && (
        <p style={{ color: "#ef4444" }}>
          ไม่สามารถโหลดหมวดหมู่ได้: {err}
        </p>
      )}
      {!loading && !err && subcats.length === 0 && (
        <p style={{ opacity: 0.7 }}>
          ยังไม่มีหมวดหมู่ย่อยสำหรับ “{title}”
        </p>
      )}

      {/* cards */}
      {!loading && !err && subcats.length > 0 && (
        <section className="plants-categories">
          {subcats.map((c) => (
            <Link
              key={c.id || c.slug}
              to={buildLink(c.slug)}
              className="plant-card"
              aria-label={c.name}
            >
              <div className="thumb">
                <img
                  src={c.img}
                  alt={c.name}
                  onError={(e) => (e.currentTarget.src = process.env.PUBLIC_URL + "/logo.png")}
                />
              </div>
              <div className="meta">
                <p className="p-name">{c.name}</p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
