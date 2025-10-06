// frontend/src/admin/ProductEditPage.js
import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import ProductImagesPanel from "./ProductImagesPanel";

export default function ProductEditPage() {
  const { id } = useParams();                // /admin/products/:id
  const productId = Number(id);

  const API_BASE = useMemo(
    () => (process.env.REACT_APP_API_BASE || "http://localhost:3001").replace(/\/$/, ""),
    []
  );
  const token = useMemo(() => localStorage.getItem("token"), []);
  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const [meta, setMeta] = useState({ name: "", cover: "" });

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/api/admin/products/${productId}`, {
          headers: { ...authHeaders },
        });
        if (!res.ok) return;
        const p = await res.json();
        if (!ignore) {
          setMeta({
            name: p.product_name || `#${productId}`,
            cover: p.cover_image_url || p.image_url || "",
          });
        }
      } catch (_) {}
    }
    if (productId) load();
    return () => { ignore = true; };
  }, [API_BASE, productId, authHeaders]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Link to="/admin/products" style={{ textDecoration: "none" }}>← กลับรายการสินค้า</Link>
        <h1 style={{ margin: 0, fontSize: 22 }}>แก้ไขสินค้า #{productId} — {meta.name}</h1>
      </div>

      {meta.cover ? (
        <img
          src={meta.cover}
          alt={meta.name}
          style={{ width: 220, height: 140, objectFit: "cover", borderRadius: 8, marginBottom: 16 }}
        />
      ) : null}

      {/* แผงจัดการรูปภาพ */}
      <ProductImagesPanel productId={productId} />
    </div>
  );
}
