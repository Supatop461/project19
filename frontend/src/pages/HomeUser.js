// FRONTEND: src/pages/HomeUser.js — Live suggestions (infinite scroll + keyboard) + search เดิม
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
    name: p.product_name ?? p.name_th ?? p.name ?? p.title ?? "",
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

async function serverSearch(mode, value, want = 100) {
  const tryList = [];
  if (mode === "keyword") {
    tryList.push(["/products/search", { q: value, limit: want }]);
    tryList.push(["/products", { q: value, limit: want }]);
    tryList.push(["/products", { keyword: value, limit: want }]);
    tryList.push(["/products", { search: value, limit: want }]);
  } else if (mode === "category") {
    tryList.push(["/products", { category_id: value, limit: want }]);
    tryList.push(["/products/by-category", { id: value, limit: want }]);
  } else if (mode === "subcategory") {
    tryList.push(["/products", { subcategory_id: value, limit: want }]);
    tryList.push(["/products/by-subcategory", { id: value, limit: want }]);
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

/* ---------- debounce (live suggest) ---------- */
const useDebounce = (value, delay = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

/* ---------- Product card ---------- */
const ProductCard = ({ p }) => (
  <div className="product-card">
    <Link to={`/products/${p.id}`}>
      {p.img ? <img src={p.img} alt={p.name} /> : <div className="noimg">ไม่มีรูป</div>}
    </Link>
    <h3><Link to={`/products/${p.id}`}>{p.name}</Link></h3>
    <p>{p.price ? `${p.price.toLocaleString()} บาท` : "— บาท"}</p>
    <button className="btn-add" onClick={() => addToCart(p)}>+ เพิ่มลงตะกร้า</button>
  </div>
);

/* ---------------- Page ---------------- */
export default function HomeUser() {
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [loading, setLoading] = useState({ cat: true, sub: true, best: true, all: true, search: false });
  const [err, setErr] = useState({ cat: "", sub: "", best: "", all: "", search: "" });

  // Search state
  const [mode, setMode] = useState("keyword"); // "keyword" | "category" | "subcategory"
  const [keyword, setKeyword] = useState("");
  const [catValue, setCatValue] = useState("");
  const [subValue, setSubValue] = useState("");

  // Live suggestions + pagination + keyboard
  const dq = useDebounce(keyword, 250);
  const [sugs, setSugs] = useState([]);
  const [openSugs, setOpenSugs] = useState(false);
  const [sugPage, setSugPage] = useState(0);
  const [sugHasMore, setSugHasMore] = useState(false);
  const [sugLoading, setSugLoading] = useState(false);
  const [sugActive, setSugActive] = useState(-1); // index for keyboard
  const sugWrapRef = useRef(null);
  const sugListRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (sugWrapRef.current && !sugWrapRef.current.contains(e.target)) setOpenSugs(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
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

  /* ---------- Search ---------- */
  const clientFilter = useMemo(() => {
    return (mode, value) => {
      if (!value) return [];
      const val = String(value).toLowerCase();
      if (mode === "keyword") {
        return allProducts.filter(
          (p) => p.name.toLowerCase().includes(val) || String(p.id).toLowerCase().includes(val)
        );
      }
      if (mode === "category") {
        return allProducts.filter(
          (p) => p.category_id.toLowerCase() === val || p.category_name.toLowerCase() === val
        );
      }
      if (mode === "subcategory") {
        return allProducts.filter(
          (p) => p.subcategory_id.toLowerCase() === val || p.subcategory_name.toLowerCase() === val
        );
      }
      return [];
    };
  }, [allProducts]);

  const onSearch = async (e) => {
    e?.preventDefault?.();
    setSearchResults(null);
    setErr((x) => ({ ...x, search: "" }));
    setLoading((s) => ({ ...s, search: true }));
    try {
      let val = "";
      if (mode === "keyword") val = keyword.trim();
      if (mode === "category") val = catValue;
      if (mode === "subcategory") val = subValue;
      if (!val) { setSearchResults([]); return; }

      const srv = await serverSearch(mode, val, 100);
      const list = (srv.length ? srv : clientFilter(mode, val))
        .map((p, i) => normalizeProduct(p, i))
        .filter((x) => x.id && x.name);

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

  /* ---------- Live suggestions: fetch + paginate ---------- */
  const fetchSugs = async ({ reset = false } = {}) => {
    if (mode !== "keyword") return;
    const q = dq.trim();
    if (q.length < 2) {
      setSugs([]); setSugHasMore(false); setSugPage(0); setSugActive(-1);
      return;
    }

    const limit = 8;
    const page = reset ? 0 : sugPage;
    const offset = page * limit;

    // รองรับทั้ง limit/offset, page/per_page
    const paramSets = [
      { search: q, limit, offset },
      { q, limit, offset },
      { keyword: q, limit, offset },
      { search: q, page: page + 1, per_page: limit },
    ];

    setSugLoading(true);
    for (const params of paramSets) {
      try {
        const { data } = await api.get(path("/api/products"), { params });
        const rows = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : [];
        const items = rows.map((p, i) => normalizeProduct(p, offset + i));
        if (items.length) {
          setSugs((old) => (reset ? items : [...old, ...items]));
          setSugHasMore(items.length >= limit);
          if (reset) setSugPage(0);
          return;
        }
      } catch {}
    }
    // ไม่มีข้อมูล
    setSugHasMore(false);
    if (reset) setSugs([]);
    setSugActive(-1);
    setSugLoading(false);
  };

  // trigger เมื่อ keyword เปลี่ยน
  useEffect(() => {
    if (mode !== "keyword") { setSugs([]); return; }
    setOpenSugs(true);
    setSugPage(0);
    fetchSugs({ reset: true }).finally(() => setSugLoading(false));
  }, [dq, mode]);

  // scroll โหลดเพิ่ม
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
    if (sugPage > 0) {
      fetchSugs().finally(() => setSugLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sugPage]);

  const pickSuggest = (p) => {
    setKeyword(p.name || "");
    setOpenSugs(false);
    onSearch();
  };

  // keyboard navigation
  const onKeyDown = (e) => {
    if (!openSugs || !sugs.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSugActive((i) => Math.min(i + 1, sugs.length - 1));
      // auto-scroll item into view
      queueMicrotask(() => {
        const el = sugListRef.current?.querySelector(`[data-idx="${Math.min(sugActive + 1, sugs.length - 1)}"]`);
        el?.scrollIntoView({ block: "nearest" });
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSugActive((i) => Math.max(i - 1, 0));
      queueMicrotask(() => {
        const el = sugListRef.current?.querySelector(`[data-idx="${Math.max(sugActive - 1, 0)}"]`);
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

  return (
    <div className="home-container">
      {/* Search */}
      <form className="search-bar card" onSubmit={onSearch}>
        <div className="filters-row">
          <label>
            โหมดค้นหา
            <select
              value={mode}
              onChange={(e) => { setMode(e.target.value); setErr((x) => ({ ...x, search: "" })); }}
            >
              <option value="keyword">คีย์เวิร์ด</option>
              <option value="category">หมวดหมู่</option>
              <option value="subcategory">หมวดหมู่ย่อย</option>
            </select>
          </label>

          <label className="grow" ref={sugWrapRef}>
            คำค้นหา
            <input
              type="text"
              placeholder="เช่น กุหลาบ กระบองเพชร ดินปลูก…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onFocus={() => sugs.length && setOpenSugs(true)}
              onKeyDown={onKeyDown}
            />
            {openSugs && (
              <div
                className="live-suggest"
                ref={sugListRef}
                onScroll={onSugScroll}
              >
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
                    <span className="s-price">{p.price ? `฿${p.price.toLocaleString()}` : "—"}</span>
                  </button>
                ))}
                {sugLoading && <div className="live-suggest-loading">กำลังโหลด…</div>}
                {!sugHasMore && !sugs.length && <div className="live-suggest-empty">ไม่พบคำที่ใกล้เคียง</div>}
              </div>
            )}
          </label>

          <button className="btn-search" type="submit" disabled={loading.search}>
            <span className="btn-ico">🔎</span>
            {loading.search ? "กำลังค้นหา…" : "ค้นหา"}
          </button>
        </div>
        {!!err.search && <div className="info-inline warn">{err.search}</div>}
      </form>

      {/* Type Explorer */}
      <section className="type-explorer">
        <div className="type-grid">
          {categories
            .filter((c) => ["plants", "tools"].includes(String(c.slug).toLowerCase()))
            .map((c) => {
              const subs = subcategories.filter((s) => s.category_id === c.id);
              const chips = subs.slice(0, 6);
              const to = c.slug === "plants" ? "/plants" : c.slug === "tools" ? "/tools" : `/category/${c.id}`;

              return (
                <Link key={c.id} className="type-card" to={to}>
                  {c.image ? <img src={c.image} alt={c.name} /> : <div className="noimg">—</div>}
                  <h3>{c.name}</h3>
                  <div className="chips">
                    {chips.length ? (
                      chips.map((s) => (
                        <span
                          key={s.id}
                          className="chip"
                          onClick={(e) => {
                            e.preventDefault();
                            setMode("subcategory");
                            setSubValue(s.id);
                            onSearch();
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          {s.name}
                        </span>
                      ))
                    ) : (
                      <span className="chip muted">ยังไม่มีประเภท</span>
                    )}
                  </div>
                  <div className="type-meta">{subs.length} ประเภทย่อย</div>
                </Link>
              );
            })}
        </div>
      </section>

      {/* Best sellers */}
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

      {/* ไม่ใส่ Footer ในหน้านี้ เพื่อกันซ้อน */}
    </div>
  );
}
