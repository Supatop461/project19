// src/components/ProductCard.js
import React from "react";
import toast from "react-hot-toast";
import { addItem } from "../lib/cart";

export default function ProductCard({ product }) {
  const handleAddToCart = () => {
    addItem(
      {
        id: product.id || product.product_id,
        name: product.name || product.product_name || "สินค้า",
        price: product.price || product.selling_price || product.sale_price || 0,
        img:
          product.cover_image_url ||
          product.image_url ||
          product.image ||
          (Array.isArray(product.images) ? product.images[0] : "") ||
          "/logo.png",
      },
      1
    );
    toast.success(`เพิ่ม “${product.name || product.product_name || "สินค้า"}” ลงตะกร้าแล้ว`);
  };

  return (
    <div
      key={product.id || product.product_id}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <img
        src={
          product.cover_image_url ||
          product.image_url ||
          product.image ||
          (Array.isArray(product.images) ? product.images[0] : "") ||
          "/logo.png"
        }
        alt={product.name || product.product_name || "สินค้า"}
        style={{
          width: "100%",
          height: 140,
          objectFit: "cover",
          background: "#f9fafb",
        }}
        onError={(e) => (e.currentTarget.src = "/logo.png")}
      />
      <div style={{ padding: 10, flexGrow: 1 }}>
        <div
          title={product.name || product.product_name}
          style={{
            fontWeight: 600,
            color: "#111827",
            marginBottom: 6,
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {product.name || product.product_name || "สินค้า"}
        </div>
        <div style={{ color: "#047857", fontWeight: 700, marginBottom: 8 }}>
          {new Intl.NumberFormat("th-TH", {
            style: "currency",
            currency: "THB",
          }).format(Number(product.price || product.selling_price || product.sale_price || 0))}
        </div>
        {/* ปุ่มเพิ่มลงตะกร้า */}
        <button
          onClick={handleAddToCart}
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #16a34a",
            background: "#16a34a",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          เพิ่มลงตะกร้า
        </button>
      </div>
    </div>
  );
}
