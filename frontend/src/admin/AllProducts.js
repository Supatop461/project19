// src/pages/AllProducts.js
import React, { useEffect, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import "./all-products.css";
import { api, path } from "../lib/api";

/* ===== Helpers ===== */
const asStr = (v) => (v === null || v === undefined) ? "" : String(v);
const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s฿ ]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/* ===== Flexible fetchers ===== */
function pickArrayLike(res) {
  // ✅ FIX: บางกรณี res = data แล้ว → รองรับทั้ง 2 ชั้น
  const data = res?.data ?? res;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.result)) return data.result;
  if (data?.success && Array.isArray(data?.payload)) return data.payload;
  if (data?.success && Array.isArray(data?.data?.rows)) return data.data.rows;
  if (data?.ok && Array.isArray(data?.data)) return data.data;
  return null;
}

async function fetchProductsFlex(params = {}) {
  const qs = new URLSearchParams(params);
  const candidates = [
    `/api/admin/products?${qs}`,
    `/api/products?${qs}`,
    `/api/public/products?${qs}`,
  ];
  for (const url of candidates) {
    try {
      const res = await api.get(url);
      const arr = pickArrayLike(res);
      if (arr) return arr;
    } catch (err) {
      console.warn(`fetch fail: ${url}`, err);
    }
  }
  console.warn("⚠️ no product array found");
  return [];
}

async function fetchCategoriesFlex() {
  const candidates = [
    "/api/categories?published=1",
    "/api/categories",
    "/api/admin/categories",
    "/api/public/categories"
  ];
  for (const url of candidates) {
    try {
      const res = await api.get(url);
      const arr = pickArrayLike(res);
      if (arr) return arr;
    } catch (err) {
      console.warn(`fetch cats fail: ${url}`, err);
    }
  }
  console.warn("⚠️ no category array found");
  return [];
}

/* ===== Normalizers ===== */
function normalizeProduct(p) {
  const id = p.id ?? p.product_id ?? null;
  const name = p.name ?? p.product_name ?? "ไม่ระบุชื่อ";
  const image = p.image_url ?? p.cover_url ?? (p.images?.[0]?.url || p.images?.[0]) ?? null;
  const variants = p.variants ?? [];
  const price = toNum(p.price);
  const stock = toNum(p.stock);

  let vMin = null, vMax = null, vStock = 0;
  if (Array.isArray(variants) && variants.length) {
    for (const v of variants) {
      const vp = toNum(v.price);
      const vs = toNum(v.stock);
      if (vp !== null) {
        vMin = (vMin === null) ? vp : Math.min(vMin, vp);
        vMax = (vMax === null) ? vp : Math.max(vMax, vp);
      }
      if (vs !== null) vStock += vs;
    }
  }
  const priceMin = vMin ?? price;
  const priceMax = vMax ?? price;
  const totalStock = (Array.isArray(variants) && variants.length) ? vStock : (stock ?? 0);

  return {
    id,
    name,
    image,
    priceMin,
    priceMax,
    totalStock,
    variants
  };
}

/* ===== Main Page ===== */
export default function AllProducts() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    console.log("📡 Loading products...");
    const raw = await fetchProductsFlex({});
    console.log("✅ Products fetched:", raw.length);
    const mapped = raw.map(normalizeProduct);
    setItems(mapped);
    const cats = await fetchCategoriesFlex();
    setCategories(cats);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="all-products-page">
      <h1>สินค้าทั้งหมด</h1>
      {loading && <p>⏳ กำลังโหลด...</p>}
      {!loading && !items.length && <p>ไม่พบรายการสินค้า</p>}
      <div className="grid">
        {items.map((p) => (
          <div key={p.id} className="card">
            <img src={p.image ? path(p.image) : "/no-image.png"} alt={p.name} />
            <div className="info">
              <h3>{p.name}</h3>
              <p>
                ราคา: {p.priceMin === p.priceMax
                  ? `฿${p.priceMin ?? "-"}`
                  : `฿${p.priceMin} - ฿${p.priceMax}`}<br/>
                สต็อก: {p.totalStock}
              </p>
             <Link to={`/admin/products/detail/${p.id ?? p.product_id}`} className="btn">ดูรายละเอียด</Link>

            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
