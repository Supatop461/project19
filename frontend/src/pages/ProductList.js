// src/pages/ProductList.js
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useSearchParams, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { addItem } from "../lib/cart";
import ProductCard from "../components/ProductCard";

/** ===================== API BASE (no import.meta) ===================== */
const pickApiBase = () => {
  const fromAxios = (axios.defaults && axios.defaults.baseURL) || "";
  if (fromAxios) return fromAxios;
  const fromCRA = process.env.REACT_APP_API_BASE;
  if (fromCRA) return fromCRA;
  return "http://localhost:3001";
};
const API_BASE = pickApiBase();

export default function ProductList() {
  const [searchParams] = useSearchParams();
  const category = (searchParams.get("category") || "").toLowerCase();
  const sub = (searchParams.get("sub") || "").toLowerCase();
  const page = parseInt(searchParams.get("page") || "1", 10);

  const [products, setProducts] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");

  const axiosClient = useMemo(() => {
    const token = localStorage.getItem("token") || "";
    return axios.create({
      baseURL: API_BASE,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 10000,
    });
  }, []);

  const apiPath = (p) =>
    String(API_BASE || "").replace(/\/+$/, "").endsWith("/api") ? p : "/api" + p;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    (async () => {
      const params = { page, page_size: 24 };
      if (category) params.category = category;
      if (sub) params.sub = sub;

      const endpoints = ["/products", "/public/products", "/shop/products"];
      let got = null;

      for (const ep of endpoints) {
        try {
          const r = await axiosClient.get(apiPath(ep), { params, signal: controller.signal });
          const payload = r.data;
          const items =
            payload?.items ||
            payload?.data ||
            (Array.isArray(payload) ? payload : []) ||
            [];
          got = items;
          break;
        } catch (e) {
          if (e?.response?.status && e.response.status !== 404) {
            setError(e?.response?.data?.message || e.message);
            break;
          }
        }
      }

      if (got) setProducts(got);
      else if (!error) setError("ไม่พบ endpoint สำหรับดึงสินค้า (/api/products)");
    })()
      .catch((e) => setError(e?.message || "เกิดข้อผิดพลาด"))
      .finally(() => setLoading(false));

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, sub, page]);

  const title =
    category === "plants"
      ? `ต้นไม้${sub ? " • " + subLabel(sub) : ""}`
      : category === "tools"
      ? `อุปกรณ์เพาะปลูก${sub ? " • " + subLabel(sub) : ""}`
      : "รายการสินค้าทั้งหมด";

  // 🟢 ฟังก์ชันเพิ่มลงตะกร้า
  function handleAddToCart(p) {
    addItem(
      {
        id: p.id || p.product_id,
        name: p.name || p.product_name || "สินค้า",
        price: p.price || p.selling_price || p.sale_price || 0,
        img:
          p.cover_image_url ||
          p.image_url ||
          p.image ||
          (Array.isArray(p.images) ? p.images[0] : "") ||
          "/logo.png",
      },
      1
    );
    toast.success(`เพิ่ม “${p.name || p.product_name || "สินค้า"}” ลงตะกร้าแล้ว`);
  }

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "16px" }}>
      {/* breadcrumb ง่าย ๆ */}
      <div style={{ marginBottom: 8, color: "#6b7280" }}>
        <Link to="/" style={{ color: "#6b7280", textDecoration: "none" }}>
          หน้าแรก
        </Link>{" "}
        ›{" "}
        <span style={{ color: "#111827" }}>
          {category ? (category === "plants" ? "ต้นไม้" : "อุปกรณ์เพาะปลูก") : "สินค้า"}
          {sub ? " › " + subLabel(sub) : ""}
        </span>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 10 }}>{title}</h1>

      {loading && <div>กำลังโหลดสินค้า…</div>}
      {error && !loading && (
        <div style={{ color: "#b91c1c", marginBottom: 10 }}>เกิดข้อผิดพลาด: {error}</div>
      )}

      {!loading && !error && (
        <>
          {products.length === 0 ? (
            <div style={{ color: "#6b7280" }}>ไม่พบสินค้าในหมวดนี้</div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 12,
              }}
            >
              {products.map((p) => (
                <ProductCard
                  key={p.id || p.product_id}
                  product={p}
                  onAddToCart={() => handleAddToCart(p)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// label ไทยของ sub
function subLabel(s) {
  switch (s) {
    case "fruit": return "ไม้ผล";
    case "ornamental": return "ไม้ดอก/ประดับ";
    case "herb": return "ไม้สมุนไพร";
    case "economic": return "ไม้เศรษฐกิจ";
    case "pot": return "กระถาง";
    case "bag": return "ถุงเพาะ";
    case "soil": return "วัสดุปลูก/ปรับปรุงดิน";
    default: return s;
  }
}
