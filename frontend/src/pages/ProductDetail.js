// frontend/src/pages/ProductDetail.js
// หน้าแสดงรายละเอียดสินค้า (ลูกค้า)
// - ดึงสินค้า /api/products/:id  (+ /:id/variants ถ้ามี)
// - รองรับ SKU/ราคา/สต็อคตาม Variant ที่เลือก
// - เข้ากับธีมสีเขียวของโปรเจกต์ (Tailwind)
// - เพิ่มลงตะกร้าผ่าน addItem จาก lib/cart

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, path } from "../lib/api";
import { addItem } from "../lib/cart";

/* -------------------- helpers -------------------- */
const asInt = (v) =>
  v === null || v === undefined || v === "" ? null : parseInt(v, 10);

const fmtBaht = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  try {
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return `${v} บาท`;
  }
};

// แปลงให้เป็น URL สมบูรณ์ กรณี backend ส่งมาเป็น path สั้น ๆ เช่น /uploads/xxx.jpg
const ensureAbsUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  const ORIGIN =
    (path && path.API_ORIGIN) || process.env.REACT_APP_API_ORIGIN || "";
  if (ORIGIN && u.startsWith("/")) return ORIGIN + u;
  return u;
};

// รวมคีย์/ค่า options ของ variant เป็น signature ไว้เทียบ
const optionSignature = (obj) =>
  Object.entries(obj || {})
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("|");

// แปลง variants ให้เป็นรูปแบบเดียวกัน (กันสคีมาต่าง ๆ)
function normalizeVariants(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => ({
    variant_id: asInt(v.variant_id ?? v.id ?? v.product_variant_id),
    sku: String(v.sku ?? v.SKU ?? v.code ?? v.variant_code ?? ""),

    price: Number(
      v.price ?? v.variant_price ?? v.sale_price ?? v.base_price ?? 0
    ),
    stock:
      asInt(
        v.stock ??
          v.qty ??
          v.quantity ??
          v.live_stock ??
          v.on_hand ??
          v.available
      ) ?? 0,

    // options อาจมาเป็น object หรือ array
    options: Array.isArray(v.options)
      ? v.options.reduce((acc, it) => {
          const k = String(it?.name ?? it?.option_name ?? "");
          const val = String(it?.value ?? it?.option_value ?? "");
          if (k) acc[k] = val;
          return acc;
        }, {})
      : typeof v.options === "object" && v.options
      ? v.options
      : {
          ...(v.color ? { สี: v.color } : {}),
          ...(v.size ? { ขนาด: v.size } : {}),
        },

    image_url: ensureAbsUrl(v.image_url ?? v.image ?? v.thumbnail ?? ""),
    is_active: v.is_active ?? v.active ?? true,
  }));
}

// เก็บคีย์ออปชั่นทั้งหมดจาก variants
function collectOptionKeys(vs) {
  const s = new Set();
  (vs || []).forEach((v) => {
    Object.keys(v?.options || {}).forEach((k) => s.add(k));
  });
  return Array.from(s);
}

// ดึงค่าที่ไม่ซ้ำของออปชั่น key นั้น ๆ
function uniqueOptionValues(vs, key) {
  const s = new Set();
  (vs || []).forEach((v) => {
    const val = (v?.options || {})[key];
    if (val !== undefined && val !== null) s.add(String(val));
  });
  return Array.from(s);
}

// หา variant จากออปชั่นที่เลือก (ตรงก่อน, ไม่ตรงค่อยหา best match)
function findVariantByOptions(vs, chosen) {
  if (!vs?.length) return null;
  const sig = optionSignature(chosen || {});
  let found =
    vs.find(
      (v) => optionSignature(v.options || {}) === sig && (v.is_active ?? true)
    ) || null;
  if (found) return found;

  // best-match
  let best = null;
  let bestScore = -1;
  for (const v of vs) {
    const keys = Object.keys(v.options || {});
    let score = 0;
    keys.forEach((k) => {
      if ((v.options || {})[k] === (chosen || {})[k]) score += 1;
    });
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

/* -------------------- component -------------------- */
export default function ProductDetail() {
  const { id } = useParams(); // /products/:id

  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);

  // แกลเลอรีรูป
  const [images, setImages] = useState([]);
  const [activeImgIndex, setActiveImgIndex] = useState(0);

  // ตัวเลือก + จำนวน
  const [chosenOptions, setChosenOptions] = useState({});
  const [selectedVariantId, setSelectedVariantId] = useState(null);
  const [qty, setQty] = useState(1);

  // โหลดสินค้า + variants
  useEffect(() => {
    let cancel = false;
    async function load() {
      setLoading(true);
      try {
        // 1) สินค้าตัวแม่
        const res = await api.get(`${path.products}/${id}`);
        if (cancel) return;
        const p = res?.data || res;

        // 2) variants: พยายาม call endpoint แยกก่อน
        let vs = [];
        try {
          const vRes = await api.get(`${path.products}/${id}/variants`);
          vs = normalizeVariants(vRes?.data || vRes);
        } catch {
          vs = normalizeVariants(p?.variants || []);
        }

        // 3) รวมรูปสินค้า (แม่ + จาก variants ถ้ามี)
        const imgs =
          (Array.isArray(p?.images) ? p.images : [])
            .map((it) => ({
              url: ensureAbsUrl(it?.url || it?.image_url || ""),
              alt: it?.alt_text || p?.product_name || "product",
            }))
            .filter((x) => x.url) || [];

        const vImgs = vs
          .map((v) =>
            v.image_url ? { url: v.image_url, alt: v.sku || "variant" } : null
          )
          .filter(Boolean);

        const fullImages =
          imgs.length > 0
            ? imgs.concat(vImgs)
            : (p.image_url || p.thumbnail)
            ? [{ url: ensureAbsUrl(p.image_url || p.thumbnail), alt: p.product_name || "product" }].concat(vImgs)
            : vImgs;

        // 4) สรุปข้อมูล product หลัก
        setProduct({
          product_id: asInt(p.product_id ?? p.id),
          product_name: p.product_name || p.name || "สินค้า",
          description: p.description || p.detail || "",
          price: Number(p.price ?? p.base_price ?? p.sale_price ?? 0),
          stock: asInt(p.stock ?? p.live_stock ?? p.total_stock ?? null), // อาจไม่มี
          image_url: ensureAbsUrl(p.image_url || p.thumbnail || ""),
          category_name: p.category_name || p.category || "",
          is_published: p.is_published ?? p.published ?? true,
        });
        setVariants(vs);
        setImages(fullImages);
        setActiveImgIndex(0);

        // 5) เตรียมตัวเลือกเริ่มต้น (option แรกของแต่ละ key)
        const keys = collectOptionKeys(vs);
        const init = {};
        keys.forEach((k) => {
          const vals = uniqueOptionValues(vs, k);
          if (vals.length) init[k] = vals[0];
        });
        setChosenOptions(init);

        const first = findVariantByOptions(vs, init);
        setSelectedVariantId(first?.variant_id ?? null);
      } catch (err) {
        console.error("Load product failed:", err);
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [id]);

  // keys ของออปชั่น
  const optionKeys = useMemo(() => collectOptionKeys(variants), [variants]);

  // variant ปัจจุบัน (ตามตัวเลือก)
  const currentVariant = useMemo(() => {
    if (!variants.length) return null;
    if (selectedVariantId)
      return variants.find((x) => x.variant_id === selectedVariantId) || null;
    if (optionKeys.length) return findVariantByOptions(variants, chosenOptions);
    return null;
  }, [variants, selectedVariantId, chosenOptions, optionKeys]);

  const priceToShow = currentVariant?.price ?? product?.price ?? 0;
  const skuToShow = currentVariant?.sku || "";
  const stockToShow =
    currentVariant?.stock ??
    (product?.stock !== null && product?.stock !== undefined
      ? product.stock
      : null);

  const mainImage =
    images?.[activeImgIndex]?.url ||
    currentVariant?.image_url ||
    product?.image_url ||
    "";

  /* -------- actions -------- */
  const chooseOption = useCallback(
    (key, val) => {
      const next = { ...chosenOptions, [key]: val };
      setChosenOptions(next);
      const v = findVariantByOptions(variants, next);
      setSelectedVariantId(v?.variant_id ?? null);
    },
    [chosenOptions, variants]
  );

  const onAddToCart = useCallback(() => {
    if (!product) return;
    const pid = product.product_id;
    const vid = currentVariant?.variant_id || null;

    addItem({
      product_id: pid,
      variant_id: vid || undefined,
      name: product.product_name,
      sku: skuToShow || undefined,
      price: priceToShow,
      qty,
      image_url: mainImage,
      options: chosenOptions, // เช่น { สี: "แดง", ขนาด: "L" }
    });

    alert("เพิ่มลงตะกร้าแล้ว");
  }, [
    product,
    currentVariant,
    priceToShow,
    skuToShow,
    qty,
    mainImage,
    chosenOptions,
  ]);

  /* -------------------- UI -------------------- */
  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-4">
        <div className="animate-pulse h-6 w-32 bg-gray-200 rounded mb-4" />
        <div className="grid md:grid-cols-2 gap-6">
          <div className="h-72 bg-gray-200 rounded-2xl" />
          <div>
            <div className="h-5 w-56 bg-gray-200 rounded mb-3" />
            <div className="h-5 w-64 bg-gray-200 rounded mb-3" />
            <div className="h-10 w-40 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <p className="text-red-700">ไม่พบสินค้า</p>
        <Link to="/products" className="text-green-700 underline">
          ย้อนกลับหน้าสินค้า
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6">
      {/* breadcrumb */}
      <nav className="text-sm mb-4 text-gray-600">
        <Link to="/" className="hover:underline">
          หน้าแรก
        </Link>
        <span className="mx-2">/</span>
        <Link to="/products" className="hover:underline">
          สินค้าทั้งหมด
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">{product.product_name}</span>
      </nav>

      <div className="grid md:grid-cols-2 gap-6">
        {/* รูปหลัก + แกลเลอรี */}
        <div>
          {mainImage ? (
            <img
              src={mainImage}
              alt={product.product_name}
              className="w-full aspect-square object-cover rounded-2xl shadow-sm border border-green-100"
            />
          ) : (
            <div className="w-full aspect-square rounded-2xl bg-green-50 border border-green-100 grid place-items-center">
              <span className="text-green-700">ไม่มีรูปภาพ</span>
            </div>
          )}

          {images?.length > 1 && (
            <div className="mt-3 grid grid-cols-5 gap-2">
              {images.map((im, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveImgIndex(idx)}
                  className={[
                    "border rounded-xl overflow-hidden focus:ring-2 focus:ring-green-500",
                    idx === activeImgIndex
                      ? "border-green-500"
                      : "border-green-200 hover:border-green-400",
                  ].join(" ")}
                >
                  <img
                    src={im.url}
                    alt={im.alt || "img"}
                    className="w-full h-20 object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* รายละเอียดสินค้า */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-green-800">
            {product.product_name}
          </h1>

          {/* ราคา / SKU / สต็อค */}
          <div className="mt-3 p-3 bg-green-50 rounded-xl border border-green-100">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xl md:text-2xl font-semibold text-green-700">
                {fmtBaht(priceToShow)}
              </span>
              {skuToShow && (
                <span className="px-2 py-1 text-xs rounded bg-white border border-green-200 text-green-700">
                  SKU: {skuToShow}
                </span>
              )}
              {stockToShow !== null && stockToShow !== undefined && (
                <span className="px-2 py-1 text-xs rounded bg-white border border-green-200 text-green-700">
                  สต็อค: {stockToShow}
                </span>
              )}
            </div>
          </div>

          {/* ตัวเลือกสินค้า */}
          {optionKeys.length > 0 && (
            <div className="mt-4 space-y-3">
              {optionKeys.map((key) => {
                const values = uniqueOptionValues(variants, key);
                const chosen = chosenOptions[key];
                return (
                  <div key={key}>
                    <div className="text-sm text-gray-700 mb-1">{key}</div>
                    <div className="flex flex-wrap gap-2">
                      {values.map((val) => {
                        const active = chosen === val;
                        return (
                          <button
                            key={val}
                            type="button"
                            onClick={() => chooseOption(key, val)}
                            className={[
                              "px-3 py-2 rounded-2xl border text-sm",
                              active
                                ? "bg-green-600 text-white border-green-700"
                                : "bg-white text-green-800 border-green-300 hover:border-green-500",
                            ].join(" ")}
                          >
                            {val}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* จำนวน */}
          <div className="mt-4 flex items-center gap-3">
            <span className="text-sm text-gray-700">จำนวน</span>
            <div className="inline-flex items-center border rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="px-3 py-1 bg-white hover:bg-green-50"
              >
                −
              </button>
              <input
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(Math.max(1, asInt(e.target.value) || 1))}
                className="w-16 text-center py-1 outline-none"
              />
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                className="px-3 py-1 bg-white hover:bg-green-50"
              >
                +
              </button>
            </div>
          </div>

          {/* ปุ่ม */}
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              onClick={onAddToCart}
              disabled={stockToShow !== null && stockToShow !== undefined && stockToShow <= 0}
              className={[
                "px-6 py-3 rounded-2xl shadow-sm",
                stockToShow !== null && stockToShow !== undefined && stockToShow <= 0
                  ? "bg-gray-300 text-gray-600 cursor-not-allowed"
                  : "bg-green-700 text-white hover:bg-green-800",
              ].join(" ")}
            >
              เพิ่มลงตะกร้า
            </button>

            <Link
              to="/cart"
              className="px-6 py-3 rounded-2xl border border-green-300 text-green-800 bg-white hover:bg-green-50"
            >
              ไปตะกร้า
            </Link>
          </div>

          {/* รายละเอียดสินค้า */}
          {product.description && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold text-green-800 mb-2">
                รายละเอียดสินค้า
              </h2>
              <div className="prose prose-sm max-w-none">
                <p className="whitespace-pre-line">{product.description}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* สินค้าที่เกี่ยวข้อง/อื่น ๆ — เว้นไว้เผื่อเพิ่มภายหลัง */}
    </div>
  );
}
