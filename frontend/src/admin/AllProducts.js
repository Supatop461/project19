import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* ===== Flexible fetchers ===== */
async function fetchProductsFlex(params = {}) {
  const qs = new URLSearchParams(params);
  const candidates = [
    `/api/products?${qs}`,
    `/api/admin/products?${qs}`,
    `/api/public/products?${qs}`,
  ];
  for (const url of candidates) {
    try {
      const res = await api.get(url);
      if (Array.isArray(res)) return res;
      if (Array.isArray(res?.items)) return res.items;
      if (Array.isArray(res?.data)) return res.data;
    } catch {}
  }
  return [];
}

async function fetchCategoriesFlex() {
  const candidates = [
    "/api/categories?published=1",
    "/api/categories",
    "/api/admin/categories",
  ];
  for (const url of candidates) {
    try {
      const res = await api.get(url);
      if (Array.isArray(res)) return res;
      if (Array.isArray(res?.items)) return res.items;
      if (Array.isArray(res?.data)) return res.data;
    } catch {}
  }
  return [];
}

/* ===== Normalizers ===== */
function normalizeProduct(p) {
  const id   = p.id ?? p.product_id ?? p.ProductID ?? p.code ?? p.slug ?? null;
  const code = p.code ?? p.product_code ?? p.sku ?? p.slug ?? (id ? `P-${id}` : "");
  const name = p.name ?? p.title ?? p.product_name ?? "ไม่ระบุชื่อ";
  const desc = p.description ?? p.desc ?? "";
  const image = p.image_url ?? p.thumbnail_url ?? p.cover_url ?? (p.images?.[0]?.url || p.images?.[0]) ?? null;
  const images = Array.isArray(p.images) ? p.images : (image ? [image] : []);
  const published = !!(p.is_published ?? p.published ?? p.status?.toString().toLowerCase().includes("publish"));
  const categories = p.categories ?? p.category_ids ?? p.category ?? [];
  const variants = p.variants ?? p.product_variants ?? [];
  const price = toNum(p.price);
  const stock = toNum(p.stock);

  let vMin = null, vMax = null, vStock = 0;
  if (Array.isArray(variants) && variants.length) {
    for (const v of variants) {
      const vp = toNum(v.price ?? v.sale_price ?? v.base_price ?? v.Price);
      const vs = toNum(v.stock ?? v.qty ?? v.Stock);
      if (vp !== null) {
        vMin = (vMin === null) ? vp : Math.min(vMin, vp);
        vMax = (vMax === null) ? vp : Math.max(vMax, vp);
      }
      if (vs !== null) vStock += vs;
    }
  }
  const priceMin = vMin ?? (price ?? null);
  const priceMax = vMax ?? (price ?? null);
  const totalStock = (Array.isArray(variants) && variants.length) ? vStock : (stock ?? 0);

  return {
    raw: p,
    id, code, name, desc,
    image, images,
    published, categories,
    variants: Array.isArray(variants) ? variants : [],
    priceMin, priceMax, totalStock,
    updated_at: p.updated_at ?? p.updatedAt ?? p.modified_at ?? p.ModifiedAt ?? null,
    created_at: p.created_at ?? p.createdAt ?? p.CreatedAt ?? null
  };
}

function normalizeVariant(prod, v) {
  const vid = v.id ?? v.variant_id ?? v.sku_id ?? v.code ?? v.SKU ?? null;
  const sku = v.sku ?? v.SKU ?? v.code ?? (vid ? `V-${vid}` : "");
  const price = toNum(v.price ?? v.sale_price ?? v.base_price ?? v.Price);
  const stock = toNum(v.stock ?? v.qty ?? v.Stock);
  const img   = v.image_url ?? v.thumbnail_url ?? v.image ?? null;

  // ชื่อ option อาจเก็บต่างรูปแบบ
  const opt1n = v.option1_name ?? v.option1Label ?? v.option1 ?? "ตัวเลือก 1";
  const opt2n = v.option2_name ?? v.option2Label ?? v.option2 ?? "ตัวเลือก 2";
  const opt3n = v.option3_name ?? v.option3Label ?? v.option3 ?? "ตัวเลือก 3";
  const opt1v = v.option1_value ?? v.value1 ?? v.Option1 ?? v.attr1 ?? v.Color ?? "";
  const opt2v = v.option2_value ?? v.value2 ?? v.Option2 ?? v.attr2 ?? v.Size  ?? "";
  const opt3v = v.option3_value ?? v.value3 ?? v.Option3 ?? v.attr3 ?? "";

  const opts = [opt1v, opt2v, opt3v].filter(Boolean).join(" / ");

  return {
    product_id: prod.id,
    product_code: prod.code,
    product_name: prod.name,
    v_id: vid,
    sku,
    options_text: opts,
    price,
    stock,
    image: img || prod.image
  };
}

/* ===== UI atoms ===== */
function Badge({ children, tone="default" }) {
  return <span className={`ap-badge ap-badge-${tone}`}>{children}</span>;
}
function Stat({ label, value }) {
  return (
    <div className="ap-stat">
      <div className="ap-stat-value">{value}</div>
      <div className="ap-stat-label">{label}</div>
    </div>
  );
}
function SkeletonCard() {
  return (
    <div className="ap-card skeleton">
      <div className="ap-thumb sk" />
      <div className="ap-body">
        <div className="sk sk-line" />
        <div className="sk sk-line w60" />
        <div className="ap-row">
          <div className="sk sk-chip" />
          <div className="sk sk-chip" />
        </div>
        <div className="ap-row">
          <div className="sk sk-btn" />
          <div className="sk sk-btn" />
        </div>
      </div>
    </div>
  );
}

/* ===== Main Page ===== */
export default function AllProducts() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);

  // โหมดมุมมอง: products | skus
  const [viewMode, setViewMode] = useState("products");

  // คิวรีสินค้ารวม
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [published, setPublished] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState("updated_desc");

  // คิวรี SKU รวม
  const [qSku, setQSku] = useState("");
  const [stockFilter, setStockFilter] = useState("all"); // all|in|out

  // เพจจิเนชัน
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);

  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const raw = await fetchProductsFlex({});
    const mapped = raw.map(normalizeProduct);
    setItems(mapped);
    const cats = await fetchCategoriesFlex();
    setCategories(cats);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  /* ---------- Products view: filter/sort ---------- */
  const filteredProducts = useMemo(() => {
    let arr = [...items];

    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      arr = arr.filter(p =>
        asStr(p.name).toLowerCase().includes(needle) ||
        asStr(p.code).toLowerCase().includes(needle) ||
        asStr(p.desc).toLowerCase().includes(needle)
      );
    }

    if (cat !== "all") {
      arr = arr.filter(p => {
        const cats = p.categories || [];
        const ids = Array.isArray(cats) ? cats : [cats];
        return ids.map(String).includes(String(cat));
      });
    }

    if (published !== "all") {
      const want = published === "1";
      arr = arr.filter(p => p.published === want);
    }

    const minP = toNum(minPrice);
    const maxP = toNum(maxPrice);
    if (minP !== null) arr = arr.filter(p => (p.priceMin ?? Infinity) >= minP);
    if (maxP !== null) arr = arr.filter(p => (p.priceMax ?? -Infinity) <= maxP);

    switch (sortBy) {
      case "name_asc":  arr.sort((a,b)=>asStr(a.name).localeCompare(asStr(b.name))); break;
      case "name_desc": arr.sort((a,b)=>asStr(b.name).localeCompare(asStr(a.name))); break;
      case "price_asc": arr.sort((a,b)=>(a.priceMin ?? 9e15) - (b.priceMin ?? 9e15)); break;
      case "price_desc":arr.sort((a,b)=>(b.priceMax ?? -1) - (a.priceMax ?? -1)); break;
      case "created_desc": arr.sort((a,b)=>asStr(b.created_at).localeCompare(asStr(a.created_at))); break;
      case "created_asc":  arr.sort((a,b)=>asStr(a.created_at).localeCompare(asStr(b.created_at))); break;
      default: // updated_desc
        arr.sort((a,b)=>asStr(b.updated_at).localeCompare(asStr(a.updated_at)));
    }
    return arr;
  }, [items, q, cat, published, minPrice, maxPrice, sortBy]);

  /* ---------- Flatten SKUs from products ---------- */
  const allSkus = useMemo(() => {
    const rows = [];
    for (const p of items) {
      if (Array.isArray(p.variants) && p.variants.length) {
        for (const v of p.variants) rows.push(normalizeVariant(p, v));
      } else {
        // สินค้าที่ไม่มี variants → ทำเป็น 1 แถวเทียมด้วย code ของสินค้า
        rows.push(normalizeVariant(p, { sku: p.code, price: p.priceMin ?? p.priceMax, stock: p.totalStock }));
      }
    }
    return rows;
  }, [items]);

  const filteredSkus = useMemo(() => {
    let arr = [...allSkus];

    if (qSku.trim()) {
      const needle = qSku.trim().toLowerCase();
      arr = arr.filter(r =>
        asStr(r.sku).toLowerCase().includes(needle) ||
        asStr(r.product_name).toLowerCase().includes(needle) ||
        asStr(r.options_text).toLowerCase().includes(needle)
      );
    }

    if (stockFilter !== "all") {
      arr = arr.filter(r => {
        const s = toNum(r.stock) ?? 0;
        return stockFilter === "in" ? s > 0 : s <= 0;
      });
    }

    return arr;
  }, [allSkus, qSku, stockFilter]);

  /* ---------- Paging ---------- */
  const dataset = viewMode === "products" ? filteredProducts : filteredSkus;
  const total = dataset.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const curPage = clamp(page, 1, totalPages);
  const start = (curPage - 1) * size;
  const pageItems = dataset.slice(start, start + size);

  /* ---------- Reset ---------- */
  const resetProductsFilter = () => {
    setQ(""); setCat("all"); setPublished("all");
    setMinPrice(""); setMaxPrice(""); setSortBy("updated_desc");
    setPage(1);
  };
  const resetSkusFilter = () => {
    setQSku(""); setStockFilter("all"); setPage(1);
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <div className="ap-title">
          <div className="ap-eyebrow">แอดมิน · แค็ตตาล็อก</div>
          <h1>{viewMode === "products" ? "สินค้าทั้งหมด" : "SKU ทั้งหมด"}</h1>
          <div className="ap-sub">
            {viewMode === "products"
              ? "ดูและจัดการสินค้าทุกชิ้นในระบบ"
              : "รายการ SKU/ตัวเลือกทั้งหมดจากทุกสินค้า"}
          </div>
        </div>
        <div className="ap-actions">
          <Link to="/admin/products/new" className="ap-btn ap-btn-primary">+ เพิ่มสินค้าใหม่</Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="ap-toolbar" style={{ gap: 6, alignItems: "center" }}>
        <button
          className={`ap-btn ${viewMode === "products" ? "ap-btn-primary" : ""}`}
          onClick={() => { setViewMode("products"); setPage(1); }}
        >
          สินค้า
        </button>
        <button
          className={`ap-btn ${viewMode === "skus" ? "ap-btn-primary" : ""}`}
          onClick={() => { setViewMode("skus"); setPage(1); }}
        >
          SKU ทั้งหมด
        </button>

        <div className="ap-spacer" />

        <select className="ap-select" value={size} onChange={e=>{ setSize(Number(e.target.value)); setPage(1); }}>
          {[12,20,30,40,60].map(n => <option key={n} value={n}>{n}/หน้า</option>)}
        </select>
      </div>

      {/* Toolbars per mode */}
      {viewMode === "products" ? (
        <div className="ap-toolbar">
          <input
            className="ap-input"
            placeholder="ค้นหาชื่อ / โค้ด / คำอธิบาย…"
            value={q}
            onChange={e => { setQ(e.target.value); setPage(1); }}
          />

          <select className="ap-select" value={cat} onChange={e => { setCat(e.target.value); setPage(1); }}>
            <option value="all">ทุกหมวดหมู่</option>
            {categories.map(c => {
              const id = c.id ?? c.category_id ?? c.code ?? c.slug ?? c.value;
              const name = c.name ?? c.title ?? c.CategoryName ?? c.label ?? `หมวด ${id}`;
              return <option key={String(id)} value={String(id)}>{name}</option>;
            })}
          </select>

          <select className="ap-select" value={published} onChange={e => { setPublished(e.target.value); setPage(1); }}>
            <option value="all">ทุกสถานะ</option>
            <option value="1">เผยแพร่</option>
            <option value="0">ฉบับร่าง</option>
          </select>

          <input className="ap-input w120" placeholder="ราคาเริ่ม ฿" value={minPrice} onChange={e=>{setMinPrice(e.target.value); setPage(1);}}/>
          <input className="ap-input w120" placeholder="ราคาสูงสุด ฿" value={maxPrice} onChange={e=>{setMaxPrice(e.target.value); setPage(1);}}/>

          <select className="ap-select" value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="updated_desc">อัปเดตล่าสุด ↓</option>
            <option value="created_desc">สร้างล่าสุด ↓</option>
            <option value="created_asc">สร้างเก่าสุด ↑</option>
            <option value="name_asc">ชื่อ A–Z</option>
            <option value="name_desc">ชื่อ Z–A</option>
            <option value="price_asc">ราคาต่ำ→สูง</option>
            <option value="price_desc">ราคาสูง→ต่ำ</option>
          </select>

          <button className="ap-btn" onClick={resetProductsFilter}>ล้างตัวกรอง</button>
        </div>
      ) : (
        <div className="ap-toolbar">
          <input
            className="ap-input"
            placeholder="ค้นหา SKU / ชื่อสินค้า / ตัวเลือก…"
            value={qSku}
            onChange={e => { setQSku(e.target.value); setPage(1); }}
          />
          <select className="ap-select" value={stockFilter} onChange={e=>{ setStockFilter(e.target.value); setPage(1); }}>
            <option value="all">สต็อกทั้งหมด</option>
            <option value="in">มีสต็อก</option>
            <option value="out">หมดสต็อก</option>
          </select>
          <button className="ap-btn" onClick={resetSkusFilter}>ล้างตัวกรอง</button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="ap-grid">
          {Array.from({length: 12}).map((_,i)=><SkeletonCard key={i}/>)}
        </div>
      ) : (total === 0) ? (
        <div className="ap-empty">
          <h3>ไม่พบรายการ</h3>
          <p>ลองล้างตัวกรอง หรือเพิ่มสินค้าใหม่</p>
          <Link className="ap-btn ap-btn-primary" to="/admin/products/new">+ เพิ่มสินค้าใหม่</Link>
        </div>
      ) : (
        <>
          <div className="ap-summary">
            <span>{total.toLocaleString()} รายการ</span>
            {viewMode === "products" && q &&   <Badge tone="muted">ค้นหา: “{q}”</Badge>}
            {viewMode === "skus"     && qSku &&<Badge tone="muted">ค้นหา: “{qSku}”</Badge>}
          </div>

          {viewMode === "products" ? (
            <div className="ap-grid">
              {pageItems.map(p => (
                <article key={`${p.id}-${p.code}`} className="ap-card">
                  <div className="ap-thumb">
                    {p.image ? (
                      <img src={path.media(p.image)} alt={p.name} onError={(e)=>{ e.currentTarget.style.display='none'; }} />
                    ) : (
                      <div className="ap-thumb-fallback">{(p.name || "P").slice(0,1)}</div>
                    )}
                    <div className="ap-badges">
                      <Badge tone={p.published ? "success" : "warn"}>{p.published ? "เผยแพร่" : "ฉบับร่าง"}</Badge>
                      {p.totalStock > 0 ? <Badge tone="muted">{p.totalStock} ชิ้น</Badge> : <Badge tone="danger">หมดสต็อก</Badge>}
                    </div>
                  </div>

                  <div className="ap-body">
                    <div className="ap-code">{p.code}</div>
                    <h3 className="ap-name" title={p.name}>{p.name}</h3>
                    {p.desc ? <p className="ap-desc" title={p.desc}>{p.desc}</p> : <p className="ap-desc muted">ไม่มีคำอธิบาย</p>}

                    <div className="ap-stats">
                      <Stat label="ตัวเลือก" value={p.variants.length || 0} />
                      <Stat label="ราคา" value={
                        (p.priceMin !== null && p.priceMax !== null)
                          ? (p.priceMin === p.priceMax ? `฿${p.priceMax}` : `฿${p.priceMin} – ฿${p.priceMax}`)
                          : (p.priceMin !== null ? `เริ่มที่ ฿${p.priceMin}` : "—")
                      } />
                    </div>

                    <div className="ap-row space">
                      <div className="ap-dates">
                        {p.updated_at && <span className="muted">อัปเดต: {new Date(p.updated_at).toLocaleString()}</span>}
                        {!p.updated_at && p.created_at && <span className="muted">สร้าง: {new Date(p.created_at).toLocaleString()}</span>}
                      </div>
                      <div className="ap-cta">
                        <Link className="ap-btn" to={`/admin/products/${p.id ?? p.code}`}>ดูรายละเอียด</Link>
                        <Link className="ap-btn ap-btn-outline" to={`/admin/products/${p.id ?? p.code}/variants`}>ตัวเลือก/Variants</Link>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="ap-card" style={{ overflowX: "auto" }}>
              {/* ตาราง SKU รวม */}
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left" }}>
                    <th style={{ padding: "10px" }}>รูป</th>
                    <th style={{ padding: "10px" }}>สินค้า</th>
                    <th style={{ padding: "10px" }}>SKU</th>
                    <th style={{ padding: "10px" }}>ตัวเลือก</th>
                    <th style={{ padding: "10px" }}>ราคา</th>
                    <th style={{ padding: "10px" }}>สต็อก</th>
                    <th style={{ padding: "10px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((r, i) => (
                    <tr key={`${r.product_id}-${r.sku}-${i}`} style={{ borderTop: "1px solid #e7ece9" }}>
                      <td style={{ padding: "8px" }}>
                        {r.image
                          ? <img src={path.media(r.image)} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
                          : <div style={{ width: 56, height: 56, borderRadius: 8, background:"#f1f5f1" }} />}
                      </td>
                      <td style={{ padding: "8px", minWidth: 220 }}>
                        <div style={{ fontWeight: 700 }}>{r.product_name}</div>
                        <div style={{ fontSize: 12, color: "#667085" }}>{r.product_code}</div>
                      </td>
                      <td style={{ padding: "8px" }}>{r.sku}</td>
                      <td style={{ padding: "8px" }}>{r.options_text || "-"}</td>
                      <td style={{ padding: "8px" }}>{r.price != null ? `฿${r.price}` : "—"}</td>
                      <td style={{ padding: "8px" }}>
                        {r.stock != null ? (
                          Number(r.stock) > 0 ? `${r.stock}` : <span style={{ color:"#991b1b", fontWeight:700 }}>0</span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "8px" }}>
                        <Link className="ap-btn" to={`/admin/products/${r.product_id}`}>ไปที่สินค้า</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="ap-pager">
            <button className="ap-btn" disabled={curPage<=1} onClick={()=>setPage(curPage-1)}>← ก่อนหน้า</button>
            <span className="ap-page-indicator">หน้า {curPage} / {totalPages}</span>
            <button className="ap-btn" disabled={curPage>=totalPages} onClick={()=>setPage(curPage+1)}>ถัดไป →</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ===== Small Badge component (kept in file for simplicity) ===== */
function BadgeTone({ tone="default" }) { return null; } // placeholder to avoid unused export
