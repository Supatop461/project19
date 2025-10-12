// src/components/VariantPicker.jsx
import React, { useEffect, useRef, useState } from "react";
import { searchItems, ensureVariant } from "../lib/api";

export default function VariantPicker({
  onChange,                          // (variant) => void
  placeholder = "พิมพ์ชื่อสินค้า หรือ SKU เพื่อค้นหา",
  autoFocus = false,
  mode = "in",                       // "in" = ไม่กรองสต๊อก, "out" = ต้องมีสต๊อก > 0
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false); // กำลัง ensureVariant
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef(null);
  const timer = useRef(null);

  // ปิด dropdown เมื่อคลิกนอกกล่อง
  useEffect(() => {
    const onDoc = (e) => {
      if (!boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // debounce 300ms แล้วค่อยยิงค้นหาไป /api/inventory/search/items
  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) { setItems([]); setOpen(false); return; }

    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchItems(q.trim(), { mode, limit: 20 });
        setItems(Array.isArray(rows) ? rows : []);
        setOpen(true);
        setHighlight(-1);
      } catch (e) {
        console.error("VariantPicker search error:", e);
        setItems([]);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer.current);
  }, [q, mode]);

  const getStock = (it) => Number(it?.stock ?? it?.stock_qty ?? 0);

  const asDisplay = (it) => {
    const name = it?.product_name || "";
    const sku = it?.sku ? ` (${it.sku})` : "";
    return (name + sku).trim();
  };

  const choose = async (it) => {
    try {
      if (!it) return;
      // ถ้าเป็นสินค้า “ยังไม่มี SKU” -> ensureVariant ก่อน
      if (it.kind === "product") {
        setCreating(true);
        const v = await ensureVariant(it.product_id);
        // ทำให้หน้าจอเห็นเป็น variant ปกติ
        const normalized = {
          kind: "variant",
          product_id: v.product_id,
          product_name: v.product_name,
          variant_id: v.variant_id,
          sku: v.sku,
          stock: Number(v.stock ?? v.stock_qty ?? 0),
        };
        setQ(asDisplay(normalized));
        setOpen(false);
        onChange && onChange(normalized);
      } else {
        const normalized = {
          kind: "variant",
          product_id: it.product_id,
          product_name: it.product_name,
          variant_id: it.variant_id,
          sku: it.sku,
          stock: getStock(it),
        };
        setQ(asDisplay(normalized));
        setOpen(false);
        onChange && onChange(normalized);
      }
    } catch (e) {
      console.error("VariantPicker ensureVariant error:", e);
      // เงียบ ๆ ไว้ก่อน ให้ผู้ใช้ลองใหม่/พิมพ์ใหม่
    } finally {
      setCreating(false);
    }
  };

  const onKeyDown = async (e) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(items.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (highlight >= 0 && items[highlight]) {
        e.preventDefault();
        await choose(items[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <label className="block text-sm">ค้นหาสินค้า / SKU</label>
      <input
        className="border rounded px-3 py-2 w-full"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (items.length > 0) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={creating}
      />
      {open && (
        <div className="absolute z-50 mt-1 bg-white border rounded shadow w-full max-h-80 overflow-auto">
          {loading && <div className="p-2 text-sm text-gray-500">กำลังค้นหา…</div>}
          {creating && <div className="p-2 text-sm text-blue-600">กำลังสร้าง SKU ให้อัตโนมัติ…</div>}
          {!loading && !creating && items.length === 0 && (
            <div className="p-2 text-sm text-gray-500">ไม่พบรายการ</div>
          )}
          {!loading && !creating && items.map((it, idx) => {
            const key = `${it.kind === "variant" ? "v" : "p"}-${it.variant_id || it.product_id}`;
            const stock = getStock(it);
            return (
              <button
                key={key}
                className={`w-full text-left p-2 hover:bg-gray-100 ${idx === highlight ? "bg-gray-100" : ""}`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                type="button"
              >
                <div className="text-sm font-medium flex items-center gap-2">
                  <span>{it.product_name}</span>
                  {it.sku ? <span className="text-gray-600">({it.sku})</span> : null}
                  {it.kind === "product" ? (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">ยังไม่มี SKU</span>
                  ) : null}
                </div>
                <div className="text-xs text-gray-600">
                  คงคลัง: {Number(stock).toLocaleString("th-TH")}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
