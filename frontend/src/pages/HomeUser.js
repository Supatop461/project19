// FRONTEND: src/pages/HomeUser.js — Single-Box Search (keyword + category triggers)
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./HomeUser.css";
import { api, path, mediaSrc } from "../lib/api";
import { addItem as addToCart } from "../lib/cart";

/* ---------------- Helpers ---------------- */
const toArray = (d) =>
  Array.isArray(d)
    ? d
    : Array.isArray(d?.items)
    ? d.items
    : Array.isArray(d?.data?.items)
    ? d.data.items
    : Array.isArray(d?.data)
    ? d.data
    : [];

const normalizeProduct = (p, idx) => {
  const imgPath = p.image_url || p.cover_url || p.image || (Array.isArray(p.images) ? p.images[0] : "");
  const img = mediaSrc(imgPath);
  const price = Number(p.min_price ?? p.selling_price ?? p.price ?? p.unit_price ?? p.product_price ?? 0) || 0;

  const cid = p.category_id ?? p.categoryId ?? p.cat_id ?? p.category ?? "";
  const sid = p.subcategory_id ?? p.subCategoryId ?? p.subcat_id ?? p.subcategory ?? "";
  const cName = p.category_name ?? p.categoryName ?? p.category ?? "";
  const sName = p.subcategory_name ?? p.subCategoryName ?? p.subcategory ?? "";

  return {
    id: p.product_id ?? p.id ?? `p-${idx}`,
    name: p.product_name ?? p.title ?? p.name_th ?? p.name ?? "",
    price,
    img,
    category_id: String(cid || ""),
    subcategory_id: String(sid || ""),
    category_name: String(cName || ""),
    subcategory_name: String(sName || ""),
  };
};

async function fetchWithCount(url, want) {
  const sets = [{ limit: want }, { take: want }, { per_page: want }, { pageSize: want }, { top: want }, {}];
  for (const ps of sets) {
    try {
      const r = await api.get(path(url), { params: { ...ps, _: Date.now() } });
      const arr = toArray(r);
      if (arr.length) return arr;
    } catch {}
  }
  return [];
}

/* ---------- debounce (live suggest) ---------- */
const useDebounce = (value, delay = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

/* ---------- Variant fetch (lazy + robust) ---------- */
const variantCache = new Map();
async function loadVariantBrief(productId) {
  if (!productId) return { hasVariants: false, variantCount: 0, options: [], variants: [] };
  const pid = String(productId);
  if (variantCache.has(pid)) return variantCache.get(pid);

  let options = [];
  let variants = [];

  const tries = [
    [`/products/${pid}/variants`, {}],
    [`/api/products/${pid}/variants`, {}],
    [`/products/${pid}`, {}],
    [`/api/products/${pid}`, {}],
  ];

  for (const [ep, params] of tries) {
    try {
      const { data } = await api.get(path(ep), { params: { ...params, _: Date.now() } });

      const list = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : null;
      if (Array.isArray(list) && list.length) {
        variants = list.map((v, i) => ({
          id: v.variant_id ?? v.id ?? `v-${pid}-${i}`,
          sku: v.sku ?? v.code ?? "",
          price: Number(v.price_override ?? v.selling_price ?? v.price ?? 0) || 0,
          stock: Number(v.stock ?? v.stock_qty ?? v.qty ?? v.onhand ?? 0) || 0,
          label:
            v.sku_label ??
            v.variant_label ??
            [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(" / "),
        }));
        break;
      }

      if (data && typeof data === "object") {
        const embedded =
          (Array.isArray(data.variants) && data.variants) ||
          (Array.isArray(data.data?.variants) && data.data.variants) ||
          (Array.isArray(data.product?.variants) && data.product.variants) ||
          (Array.isArray(data.items) && data.items?.[0]?.variants);

        if (embedded && embedded.length) {
          variants = embedded.map((v, i) => ({
            id: v.variant_id ?? v.id ?? `v-${pid}-${i}`,
            sku: v.sku ?? v.code ?? "",
            price: Number(v.price_override ?? v.selling_price ?? v.price ?? 0) || 0,
            stock: Number(v.stock ?? v.stock_qty ?? v.qty ?? v.onhand ?? 0) || 0,
            label:
              v.sku_label ??
              v.variant_label ??
              [v.option1_value, v.option2_value, v.option3_value].filter(Boolean).join(" / "),
          }));
          const optSrc = data.options || data.product?.options || data.data?.options || data.option_groups || [];
          if (Array.isArray(optSrc) && optSrc.length) {
            options = optSrc.map((o, i) => ({
              name: o.option_name ?? o.name ?? `Option ${i + 1}`,
              values:
                toArray(o.values)?.map((x) => x?.value ?? x) ??
                [o.value1, o.value2, o.value3].filter(Boolean),
            }));
          }
          break;
        }

        const optList =
          (Array.isArray(data.options) && data.options) ||
          (Array.isArray(data.data?.options) && data.data.options);
        if (Array.isArray(optList) && optList.length) {
          options = optList.map((o, i) => ({
            name: o.option_name ?? o.name ?? `Option ${i + 1}`,
            values:
              toArray(o.values)?.map((x) => x?.value ?? x) ??
              [o.value1, o.value2, o.value3].filter(Boolean),
          }));
        }
      }
    } catch {}
  }

  const brief = {
    hasVariants: !!(variants.length || options.some((x) => (x.values || []).length)),
    variantCount: variants.length,
    options,
    variants,
  };
  variantCache.set(pid, brief);
  return brief;
}

/* ---------- Server search (multi-endpoint) ---------- */
async function serverSearch(mode, value, want = 100) {
  const tryList = [];
  if (mode === "keyword") {
    tryList.push(["/products/search", { q: value, limit: want }]);
    tryList.push(["/api/products/search", { q: value, limit: want }]);
    tryList.push(["/products", { q: value, limit: want }]);
    tryList.push(["/api/products", { q: value, limit: want }]);
    tryList.push(["/products", { keyword: value, limit: want }]);
    tryList.push(["/api/products", { keyword: value, limit: want }]);
    tryList.push(["/products", { search: value, limit: want }]);
    tryList.push(["/api/products", { search: value, limit: want }]);
  } else if (mode === "category") {
    tryList.push(["/products", { category_id: value, limit: want }]);
    tryList.push(["/api/products", { category_id: value, limit: want }]);
    tryList.push(["/products/by-category", { id: value, limit: want }]);
    tryList.push(["/api/products/by-category", { id: value, limit: want }]);
  } else if (mode === "subcategory") {
    tryList.push(["/products", { subcategory_id: value, limit: want }]);
    tryList.push(["/api/products", { subcategory_id: value, limit: want }]);
    tryList.push(["/products/by-subcategory", { id: value, limit: want }]);
    tryList.push(["/api/products/by-subcategory", { id: value, limit: want }]);
  }

  for (const [ep, params] of tryList) {
    try {
      const r = await api.get(path(ep), { params: { ...params, _: Date.now() } });
      const arr = toArray(r);
      if (arr.length) return arr;
    } catch {}
  }
  return [];
}

/* ---------- Product card ---------- */
const ProductCard = ({ p }) => {
  const [brief, setBrief] = useState({ hasVariants: false, variantCount: 0, options: [], variants: [] });
  const [hasVarKnown, setHasVarKnown] = useState(false);
  const [hasVar, setHasVar] = useState(false);
  const [openPicker, setOpenPicker] = useState(false);
  const [picking, setPicking] = useState(false);

  const probe = async () => {
    if (hasVarKnown) return;
    setPicking(true);
    try {
      const b = await loadVariantBrief(p.id);
      setBrief(b);
      setHasVar(b.hasVariants);
      setHasVarKnown(true);
    } finally {
      setPicking(false);
    }
  };

  const openAndLoad = async () => {
    if (!hasVarKnown) await probe();
    if (!hasVar) return;
    setOpenPicker((v) => !v);
  };

  const showMiniList = brief.variantCount > 0 && brief.variantCount <= 12;

  const onAddVariant = (v) => {
    const price = Number(v.price || p.price || 0) || 0;
    const item = {
      ...p,
      variant_id: v.id,
      sku: v.sku,
      price,
      name: v.label ? `${p.name} — ${v.label}` : p.name,
      stock: v.stock ?? undefined,
    };
    addToCart(item);
  };

  return (
    <div className="product-card" onMouseEnter={probe} onFocus={probe}>
      <Link to={`/products/${p.id}`} className="thumb-wrap">
        {p.img ? <img src={p.img} alt={p.name} /> : <div className="noimg">ไม่มีรูป</div>}
        {hasVarKnown && hasVar && <span className="var-badge">มีตัวเลือก</span>}
      </Link>

      <h3><Link to={`/products/${p.id}`}>{p.name}</Link></h3>
      <p>{p.price ? `${p.price.toLocaleString()} บาท` : "— บาท"}</p>

      <div className="var-actions">
        <button className="btn-add" type="button" onClick={() => addToCart(p)}>+ เพิ่มลงตะกร้า</button>
        {hasVarKnown && hasVar && (
          <button className="btn-choose" type="button" onClick={openAndLoad}>
            {openPicker ? "ซ่อนตัวเลือก" : "เลือกตัวเลือก"}
          </button>
        )}
      </div>

      {openPicker && hasVar && (
        <div className="var-panel">
          {picking && <div className="var-loading">กำลังดึงตัวเลือก…</div>}

          {!picking && brief.options?.length > 0 && (
            <div className="var-options">
              {brief.options.slice(0, 2).map((o, i) => (
                <div className="var-opt" key={i}>
                  <div className="var-opt-name">{o.name}</div>
                  <div className="var-opt-values">
                    {(o.values || []).slice(0, 6).map((val, idx) => (
                      <span className="chip" key={idx}>{String(val)}</span>
                    ))}
                    {(o.values || []).length > 6 && <span className="chip muted">+{o.values.length - 6} …</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!picking && showMiniList && (
            <div className="var-list">
              {brief.variants.map((v) => (
                <div className="var-item" key={v.id}>
                  <div className="var-label">
                    <div className="l1">{v.label || v.sku || "ตัวเลือก"}</div>
                    <div className="l2">
                      {v.price ? `฿${Number(v.price).toLocaleString()}` : "—"}
                      {typeof v.stock === "number" ? ` • คงเหลือ ${v.stock}` : ""}
                    </div>
                  </div>
                  <button
                    className="btn-add-variant"
                    type="button"
                    disabled={typeof v.stock === "number" && v.stock <= 0}
                    onClick={() => onAddVariant(v)}
                  >
                    เพิ่ม
                  </button>
                </div>
              ))}
            </div>
          )}

          {!picking && !showMiniList && (
            <div className="var-foot">
              <Link className="btn-detail wide" to={`/products/${p.id}`}>ไปหน้าเลือกตัวเลือกทั้งหมด</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ---------------- Page ---------------- */
export default function HomeUser() {
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState({ cat: true, sub: true, best: true, all: true, search: false });
  const [err, setErr] = useState({ cat: "", sub: "", best: "", all: "", search: "" });

  // Single-box search state
  const [keyword, setKeyword] = useState("");

  // Live suggestions
  const dq = useDebounce(keyword, 250);
  const [sugs, setSugs] = useState([]);
  const [openSugs, setOpenSugs] = useState(false);
  const [sugPage, setSugPage] = useState(0);
  const [sugHasMore, setSugHasMore] = useState(false);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugActive, setSugActive] = useState(-1);
  const sugWrapRef = useRef(null);
  const sugListRef = useRef(null);
  const inputRef = useRef(null);

  // Category popover
  const [openCatId, setOpenCatId] = useState(null);
  const popWrapRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (sugWrapRef.current && !sugWrapRef.current.contains(e.target)) setOpenSugs(false);
      if (popWrapRef.current && !popWrapRef.current.contains(e.target)) setOpenCatId(null);
    };
    const onKey = (e) => { if (e.key === "Escape") { setOpenSugs(false); setOpenCatId(null); } };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  /* ---------- Loaders ---------- */
  useEffect(() => {
    (async () => {
      try {
        let res = null;
        try { res = await api.get(path("/categories"), { params: { status: "active", _: Date.now() } }); }
        catch {
          try { res = await api.get(path("/categories"), { params: { published: 1, _: Date.now() } }); }
          catch { res = await api.get(path("/categories"), { params: { _: Date.now() } }); }
        }
        const raw = toArray(res).map((c, idx) => {
          const cid = c.category_id ?? c.id ?? c.code ?? c.slug ?? `cat-${idx}`;
          const name = c.category_name ?? c.name_th ?? c.name ?? "";
          const enforced = String(cid) === "ro1" ? "plants" : String(cid) === "ro2" ? "tools" : null;
          const slug = enforced ?? String(c.slug || cid).toLowerCase();
          const img = c.image_url || c.image || c.cover || c.thumbnail || "";
          return { id: String(cid), slug, name, image: img ? mediaSrc(img) : "" };
        }).filter((x) => x.id && x.name);
        const order = ["plants", "tools"];
        raw.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
        setCategories(raw);
      } catch { setErr((e) => ({ ...e, cat: "โหลดหมวดหมู่ไม่สำเร็จ" })); }
      finally { setLoading((s) => ({ ...s, cat: false })); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get(path("/subcategories"), { params: { _: Date.now() } });
        const list = toArray(res).map((s, i) => ({
          id: String(s.subcategory_id ?? s.id ?? s.code ?? `sub-${i}`),
          name: s.subcategory_name ?? s.name_th ?? s.name ?? "",
          category_id: String(s.category_id ?? s.cat_id ?? s.category ?? ""),
        })).filter((x) => x.id && x.name);
        setSubcategories(list);
      } catch { setSubcategories([]); }
      finally { setLoading((s) => ({ ...s, sub: false })); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading((s) => ({ ...s, best: true }));
        const endpoints = ["/products/best-sellers", "/products?sort=popular", "/products?featured=1", "/products"];
        let bag = [];
        for (const ep of endpoints) {
          const got = await fetchWithCount(ep, 12);
          if (got.length) bag = bag.concat(got);
          if (bag.length >= 12) break;
        }
        const list = bag.map((p, i) => normalizeProduct(p, i)).filter((x) => x.id && x.name);
        setBestSellers(list.slice(0, 8));
        if (!list.length) setErr((e) => ({ ...e, best: "ยังไม่มีรายการขายดีหรือ API ไม่ส่งข้อมูล" }));
      } catch {
        setBestSellers([]); setErr((e) => ({ ...e, best: "โหลดสินค้าขายดีไม่สำเร็จ" }));
      } finally { setLoading((s) => ({ ...s, best: false })); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading((s) => ({ ...s, all: true }));
        const got = await fetchWithCount("/products", 100);
        const seen = new Set();
        const list = got.map((p, i) => normalizeProduct(p, i))
          .filter((x) => x.id && x.name && !seen.has(x.id) && seen.add(x.id));
        list.sort((a, b) => {
          const ai = Number(a.id), bi = Number(b.id);
          if (Number.isFinite(ai) && Number.isFinite(bi)) return bi - ai;
          return 0;
        });
        setAllProducts(list);
        if (!list.length) setErr((e) => ({ ...e, all: "ยังไม่มีสินค้าในระบบหรือ API ไม่ส่งข้อมูล" }));
      } catch {
        setAllProducts([]); setErr((e) => ({ ...e, all: "โหลดสินค้าทั้งหมดไม่สำเร็จ" }));
      } finally { setLoading((s) => ({ ...s, all: false })); }
    })();
  }, []);

  /* ---------- Client filter (fallback) ---------- */
  const clientFilter = useMemo(() => {
    return {
      keyword: (val) => {
        const q = String(val || "").toLowerCase();
        if (!q) return [];
        return allProducts.filter(
          (p) => p.name.toLowerCase().includes(q) || String(p.id).toLowerCase().includes(q)
        );
      },
      category: (cid) => allProducts.filter((p) => p.category_id === String(cid)),
      subcategory: (sid) => allProducts.filter((p) => p.subcategory_id === String(sid)),
    };
  }, [allProducts]);

  /* ---------- Search Runners ---------- */
  const runKeywordSearch = async (q) => {
    setSearchResults(null);
    setErr((x) => ({ ...x, search: "" }));
    setLoading((s) => ({ ...s, search: true }));
    try {
      const srv = await serverSearch("keyword", q, 100);
      const raw = srv.length ? srv : clientFilter.keyword(q);
      const list = raw.map((p, i) => normalizeProduct(p, i)).filter((x) => x.id && x.name);
      setSearchResults(list);
      if (!list.length) setErr((x) => ({ ...x, search: "ไม่พบผลลัพธ์ที่ตรงกับเงื่อนไข" }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setErr((x) => ({ ...x, search: "ค้นหาไม่สำเร็จ" }));
      setSearchResults([]);
    } finally {
      setLoading((s) => ({ ...s, search: false }));
    }
  };

  const runCategorySearch = async (cid) => {
    setSearchResults(null);
    setErr((x) => ({ ...x, search: "" }));
    setLoading((s) => ({ ...s, search: true }));
    try {
      const srv = await serverSearch("category", cid, 100);
      const raw = srv.length ? srv : clientFilter.category(cid);
      const list = raw.map((p, i) => normalizeProduct(p, i)).filter((x) => x.id && x.name);
      setSearchResults(list);
    } catch {
      setSearchResults(clientFilter.category(cid));
    } finally {
      setLoading((s) => ({ ...s, search: false }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const runSubcategorySearch = async (sid) => {
    setSearchResults(null);
    setErr((x) => ({ ...x, search: "" }));
    setLoading((s) => ({ ...s, search: true }));
    try {
      const srv = await serverSearch("subcategory", sid, 100);
      const raw = srv.length ? srv : clientFilter.subcategory(sid);
      const list = raw.map((p, i) => normalizeProduct(p, i)).filter((x) => x.id && x.name);
      setSearchResults(list);
    } catch {
      setSearchResults(clientFilter.subcategory(sid));
    } finally {
      setLoading((s) => ({ ...s, search: false }));
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  /* ---------- Single input: submit = keyword search ---------- */
  const onSearchSubmit = async (e) => {
    e?.preventDefault?.();
    setOpenSugs(false);
    setOpenCatId(null);
    const q = (keyword || "").trim();
    await runKeywordSearch(q);
  };

  /* ---------- Live suggestions (always for keyword input) ---------- */
  const fetchSugs = async ({ reset = false } = {}) => {
    const q = dq.trim();
    if (q.length < 2) {
      setSugs([]); setSugHasMore(false); setSugPage(0); setSugActive(-1);
      setOpenSugs(false);
      return;
    }

    const limit = 8;
    const page = reset ? 0 : sugPage;
    const offset = page * limit;

    const endpoints = ["/api/products", "/products"];
    const paramSets = [
      { search: q, limit, offset },
      { q, limit, offset },
      { keyword: q, limit, offset },
      { search: q, page: page + 1, per_page: limit },
    ];

    setSugLoading(true);
    for (const ep of endpoints) {
      for (const params of paramSets) {
        try {
          const { data } = await api.get(path(ep), { params });
          const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
          const items = rows.map((p, i) => normalizeProduct(p, offset + i));
          if (items.length) {
            setSugs((old) => (reset ? items : [...old, ...items]));
            setSugHasMore(items.length >= limit);
            if (reset) setSugPage(0);
            setOpenSugs(document.activeElement === inputRef.current && items.length > 0);
            setSugLoading(false);
            return;
          }
        } catch {}
      }
    }

    setSugHasMore(false);
    if (reset) setSugs([]);
    setSugActive(-1);
    setOpenSugs(false);
    setSugLoading(false);
  };

  useEffect(() => {
    setSugPage(0);
    fetchSugs({ reset: true }).finally(() => setSugLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const onSugScroll = (e) => {
    const el = e.currentTarget;
    if (!sugHasMore || sugLoading) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 10;
    if (nearBottom) {
      setSugLoading(true);
      setSugPage((p) => p + 1);
    }
  };

  useEffect(() => {
    if (sugPage > 0) fetchSugs().finally(() => setSugLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugPage]);

  const pickSuggest = (p) => {
    setKeyword(p.name || "");
    setOpenSugs(false);
    runKeywordSearch(p.name || "");
  };

  const onKeyDown = (e) => {
    if (!openSugs || !sugs.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugActive((i) => Math.min(i + 1, sugs.length - 1));
      queueMicrotask(() => {
        const el = sugListRef.current?.querySelector(
          `[data-idx="${Math.min(sugActive + 1, sugs.length - 1)}"]`
        );
        el?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugActive((i) => Math.max(i - 1, 0));
      queueMicrotask(() => {
        const el = sugListRef.current?.querySelector(
          `[data-idx="${Math.max(sugActive - 1, 0)}"]`
        );
        el?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "Enter") {
      if (sugActive >= 0 && sugActive < sugs.length) {
        e.preventDefault();
        pickSuggest(sugs[sugActive]);
      }
    } else if (e.key === "Escape") {
      setOpenSugs(false);
    }
  };

  const listToShow = searchResults ?? allProducts;

  // ---------- Quick actions from category cards ----------
  const searchByCategory = async (categoryId) => { setOpenCatId(null); await runCategorySearch(String(categoryId)); };
  const searchBySubcategory = async (subId) => { setOpenCatId(null); await runSubcategorySearch(String(subId)); };

  return (
    <div className="home-container">
      {/* Search — single input */}
      <form className="search-bar card" onSubmit={onSearchSubmit}>
        <div className="filters-row search-centered">
          <label className="grow" ref={sugWrapRef}>
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="🔍 พิมพ์ชื่อสินค้า เช่น กุหลาบ กระบองเพชร ดินปลูก... (หรือกดเลือกหมวดหมู่ด้านล่าง)"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onFocus={() => sugs.length && setOpenSugs(true)}
              onBlur={() => setTimeout(() => setOpenSugs(false), 120)}
              onKeyDown={onKeyDown}
            />
            {openSugs && (
              <div className="live-suggest" ref={sugListRef} onScroll={onSugScroll}>
                {sugs.map((p, idx) => (
                  <button
                    key={p.id}
                    data-idx={idx}
                    type="button"
                    className={`live-suggest-item${idx === sugActive ? " active" : ""}`}
                    onMouseEnter={() => setSugActive(idx)}
                    onClick={() => pickSuggest(p)}
                  >
                    <span className="s-name">{p.name}</span>
                    <span className="s-price">
                      {p.price ? `฿${p.price.toLocaleString()}` : "—"}
                    </span>
                  </button>
                ))}
                {sugLoading && <div className="live-suggest-loading">กำลังโหลด…</div>}
                {!sugHasMore && !sugs.length && (
                  <div className="live-suggest-empty">ไม่พบคำที่ใกล้เคียง</div>
                )}
              </div>
            )}
          </label>

          <button className="btn-search improved" type="submit" disabled={loading.search}>
            {loading.search ? "🔎 กำลังค้นหา..." : "ค้นหา"}
          </button>
        </div>

        {!!err.search && <div className="info-inline warn">{err.search}</div>}
      </form>

      {/* Type Explorer (Plants / Tools) — click to open popover then search */}
      <section className="type-explorer">
        <div className="type-grid" ref={popWrapRef}>
          {categories
            .filter((c) => ["plants", "tools"].includes(String(c.slug).toLowerCase()))
            .map((c) => {
              const subs = subcategories.filter((s) => s.category_id === c.id);
              const chips = subs.slice(0, 6);

              return (
                <div key={c.id} className={`type-card-wrap ${openCatId === c.id ? "active" : ""}`}>
                  <button
                    type="button"
                    className="type-card-btn"
                    onClick={() => setOpenCatId((v) => (v === c.id ? null : c.id))}
                    aria-expanded={openCatId === c.id}
                    aria-controls={`cat-pop-${c.id}`}
                  >
                    <div className="type-card">
                      {c.image ? <img src={c.image} alt={c.name} /> : <div className="noimg">—</div>}
                      <h3>{c.name}</h3>
                      <div className="chips">
                        {chips.length ? (
                          chips.map((s) => <span key={s.id} className="chip">{s.name}</span>)
                        ) : (
                          <span className="chip muted">ยังไม่มีประเภท</span>
                        )}
                      </div>
                      <div className="type-meta">{subs.length} ประเภทย่อย</div>
                    </div>
                  </button>

                  {openCatId === c.id && (
                    <div id={`cat-pop-${c.id}`} className="cat-popover">
                      <div className="cat-pop-head">
                        <div className="ttl">ค้นหาใน {c.name}</div>
                        <button type="button" className="x" aria-label="Close" onClick={() => setOpenCatId(null)}>
                          ✕
                        </button>
                      </div>

                      <div className="cat-pop-actions">
                        <button type="button" className="act all" onClick={() => searchByCategory(c.id)}>
                          ดูทั้งหมดในหมวดนี้
                        </button>
                      </div>

                      <div className="cat-pop-list">
                        {subs.length ? (
                          subs.map((s) => (
                            <button
                              type="button"
                              key={s.id}
                              className="cat-pop-item"
                              onClick={() => searchBySubcategory(s.id)}
                            >
                              <span className="name">{s.name}</span>
                              <span className="go">ค้นหา</span>
                            </button>
                          ))
                        ) : (
                          <div className="cat-pop-empty">ยังไม่มีหมวดย่อย</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </section>

      {/* Best sellers — hide when searching */}
      {!searchResults && (
        <section className="best-sellers">
          <h2>🌟 สินค้าขายดี</h2>
          {loading.best ? (
            <div className="info-inline">กำลังโหลด…</div>
          ) : bestSellers.length ? (
            <div className="product-grid fullwidth">
              {bestSellers.map((item) => <ProductCard key={item.id} p={item} />)}
            </div>
          ) : (
            <div className="info-inline">{err.best || "ไม่มีข้อมูลขายดี"}</div>
          )}
        </section>
      )}

      {/* Results / All */}
      <section className="all-products">
        <h2>{searchResults ? "🔎 ผลการค้นหา" : "🛒 สินค้าทั้งหมด"}</h2>
        {(loading.all && !searchResults) || loading.search ? (
          <div className="info-inline">กำลังโหลด…</div>
        ) : ((searchResults ?? allProducts).length ? (
          <div className="product-grid fullwidth">
            {(searchResults ?? allProducts).map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        ) : (
          <div className="info-inline">{(searchResults && err.search) || err.all || "ไม่พบสินค้า"}</div>
        ))}
      </section>
    </div>
  );
}
