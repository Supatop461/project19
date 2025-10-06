// src/components/VariantPicker.jsx
import React, { useEffect, useRef, useState } from "react";
import { searchVariants } from "../lib/api";

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

  // debounce 300ms แล้วค่อยยิงค้นหาไป /api/inventory/search
  useEffect(() => {
    clearTimeout(timer.current);
    if (!q.trim()) { setItems([]); setOpen(false); return; }

    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchVariants(q.trim(), { mode, limit: 20 });
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

  const choose = (it) => {
    const display = `${it.product_name || ""}${it.sku ? ` (${it.sku})` : ""}`;
    setQ(display.trim());
    setOpen(false);
    onChange && onChange(it);
  };

  const onKeyDown = (e) => {
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
        choose(items[highlight]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const money = (n) =>
    new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" })
      .format(Number(n || 0));

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
      />
      {open && (
        <div className="absolute z-50 mt-1 bg-white border rounded shadow w-full max-h-80 overflow-auto">
          {loading && <div className="p-2 text-sm text-gray-500">กำลังค้นหา…</div>}
          {!loading && items.length === 0 && (
            <div className="p-2 text-sm text-gray-500">ไม่พบรายการ</div>
          )}
          {!loading && items.map((it, idx) => {
            const price = it.selling_price ?? it.price ?? null;
            return (
              <button
                key={it.variant_id}
                className={`w-full text-left p-2 hover:bg-gray-100 ${idx === highlight ? "bg-gray-100" : ""}`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                type="button"
              >
                <div className="text-sm font-medium">
                  {it.product_name} {it.sku ? <span className="text-gray-600">({it.sku})</span> : null}
                </div>
                <div className="text-xs text-gray-600">
                  คงคลัง: {Number(it.stock || 0).toLocaleString("th-TH")}
                  {price != null ? ` • ${money(price)}` : ""}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
