// src/pages/HomeUser.js
// แก้ไขให้ภาพไม่ 404 (ใช้ mediaSrc) และให้ราคามาครบ (fallback จาก min_price → selling_price → price)
// เพิ่มแถบค้นหา (คีย์เวิร์ด/หมวดหมู่/หมวดหมู่ย่อย) + ฟุตเตอร์

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './HomeUser.css';
import { api, path, mediaSrc } from '../lib/api';
import { addItem as addToCart } from '../lib/cart';
import Footer from '../components/Footer'; // ✅ นำฟุตเตอร์กลับมา

/* ---------- helpers ---------- */
const toArray = (d) =>
  Array.isArray(d) ? d
  : Array.isArray(d?.items) ? d.items
  : Array.isArray(d?.data?.items) ? d.data.items
  : Array.isArray(d?.data) ? d.data
  : [];

const normalizeProduct = (p, idx) => {
  const imgPath =
    p.image_url || p.cover_url || p.image || (Array.isArray(p.images) ? p.images[0] : '');
  const img = mediaSrc(imgPath); // ✅ ครอบ mediaSrc ทุกเคส

  const priceRaw =
    p.min_price ??
    p.selling_price ??
    p.price ??
    p.unit_price ??
    p.product_price ??
    0;
  const price = Number(priceRaw) || 0;

  // เก็บฟิลด์ที่ใช้กรองไว้ด้วย (หลากหลายชื่อ เพื่อรองรับ backend หลายแบบ)
  const cid = p.category_id ?? p.categoryId ?? p.cat_id ?? p.category ?? p.category_code ?? null;
  const sid = p.subcategory_id ?? p.subCategoryId ?? p.subcat_id ?? p.subcategory ?? null;
  const cName = p.category_name ?? p.categoryName ?? p.category ?? '';
  const sName = p.subcategory_name ?? p.subCategoryName ?? p.subcategory ?? '';

  return {
    id: p.product_id ?? p.id ?? `p-${idx}`,
    name: p.product_name ?? p.name_th ?? p.name ?? p.title ?? '',
    price,
    img,
    _raw: p,
    _cid: cid ? String(cid) : '',
    _sid: sid ? String(sid) : '',
    _cName: cName ? String(cName) : '',
    _sName: sName ? String(sName) : '',
  };
};

async function fetchWithCount(url, want) {
  const paramSets = [
    { limit: want },
    { take: want },
    { per_page: want },
    { pageSize: want },
    { top: want },
    {},
  ];
  for (const ps of paramSets) {
    try {
      const r = await api.get(path(url), { params: { ...ps, _: Date.now() } });
      const arr = toArray(r);
      if (arr.length) return arr;
    } catch {}
  }
  return [];
}

// ---------- ตัวช่วยยิง API สำหรับค้นหาแบบ server-side (ถ้ามี) ----------
async function serverSearch(mode, value, want = 100) {
  const tryList = [];
  if (mode === 'keyword') {
    tryList.push(['/products/search', { q: value, limit: want }]);
    tryList.push(['/products', { q: value, limit: want }]);
    tryList.push(['/products', { keyword: value, limit: want }]);
    tryList.push(['/products', { search: value, limit: want }]);
  } else if (mode === 'category') {
    tryList.push(['/products', { category_id: value, limit: want }]);
    tryList.push(['/products', { cat_id: value, limit: want }]);
    tryList.push(['/products', { category: value, limit: want }]);
    tryList.push(['/products/by-category', { id: value, limit: want }]);
  } else if (mode === 'subcategory') {
    tryList.push(['/products', { subcategory_id: value, limit: want }]);
    tryList.push(['/products', { subcat_id: value, limit: want }]);
    tryList.push(['/products/by-subcategory', { id: value, limit: want }]);
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

export default function HomeUser() {
  const [categories, setCategories] = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [bestSellers, setBestSellers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState({ cat: true, sub: true, best: true, all: true, search: false });
  const [err, setErr] = useState({ cat: '', sub: '', best: '', all: '', search: '' });

  // ---------- state แถบค้นหา ----------
  const [mode, setMode] = useState('keyword'); // 'keyword' | 'category' | 'subcategory'
  const [keyword, setKeyword] = useState('');
  const [catValue, setCatValue] = useState('');
  const [subValue, setSubValue] = useState('');
  const [searchResults, setSearchResults] = useState(null); // null = ยังไม่ค้นหา / array = ผลลัพธ์

  // โหลดหมวดหมู่
  useEffect(() => {
    (async () => {
      try {
        setLoading((s) => ({ ...s, cat: true }));
        let res = null;
        try {
          res = await api.get(path('/categories'), {
            params: { status: 'active', _: Date.now() },
          });
        } catch {
          try {
            res = await api.get(path('/categories'), {
              params: { published: 1, _: Date.now() },
            });
          } catch {
            res = await api.get(path('/categories'), { params: { _: Date.now() } });
          }
        }
        const raw = toArray(res)
          .map((c, idx) => {
            const cid = c.category_id ?? c.id ?? c.code ?? c.slug ?? `cat-${idx}`;
            const name = c.category_name ?? c.name_th ?? c.name ?? '';
            const forcedSlug =
              String(cid) === 'ro1' ? 'plants'
                : String(cid) === 'ro2' ? 'tools'
                : null;
            const slug = forcedSlug ?? (c.slug ? String(c.slug).toLowerCase() : String(cid).toLowerCase());
            const img = c.image_url || c.image || c.cover || c.thumbnail || '';
            return { id: String(cid), slug, name, image: img ? mediaSrc(img) : '' };
          })
          .filter((x) => x.id && x.name);

        const order = ['plants', 'tools'];
        raw.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
        // ใช้ทั้งเพื่อโชว์หัวข้อ และเพื่อ filter
        setCategories(raw);
      } catch {
        setCategories([]);
        setErr((e) => ({ ...e, cat: 'โหลดหมวดหมู่ไม่สำเร็จ' }));
      } finally {
        setLoading((s) => ({ ...s, cat: false }));
      }
    })();
  }, []);

  // โหลดหมวดหมู่ย่อย (ถ้ามี)
  useEffect(() => {
    (async () => {
      try {
        setLoading((s) => ({ ...s, sub: true }));
        let res = null;
        try {
          res = await api.get(path('/subcategories'), { params: { _: Date.now() } });
        } catch {
          // บางระบบอาจไม่มี subcategories ก็ปล่อยว่าง
        }
        const list = toArray(res).map((s, i) => ({
          id: String(s.subcategory_id ?? s.id ?? s.code ?? `sub-${i}`),
          name: s.subcategory_name ?? s.name_th ?? s.name ?? '',
          category_id: String(s.category_id ?? s.cat_id ?? s.category ?? ''),
        })).filter(x => x.id && x.name);
        setSubcategories(list);
      } catch {
        setSubcategories([]);
        setErr((e) => ({ ...e, sub: '' })); // ไม่ถือเป็น error ใหญ่
      } finally {
        setLoading((s) => ({ ...s, sub: false }));
      }
    })();
  }, []);

  // โหลดสินค้าขายดี
  useEffect(() => {
    (async () => {
      try {
        setLoading((s) => ({ ...s, best: true }));
        const endpoints = [
          '/products/best-sellers',
          '/products?sort=popular',
          '/products?featured=1',
          '/products',
        ];
        let bag = [];
        for (const ep of endpoints) {
          const got = await fetchWithCount(ep, 12);
          if (got.length) bag = bag.concat(got);
          if (bag.length >= 12) break;
        }
        const list = bag.map((p, i) => normalizeProduct(p, i)).filter((x) => x.id && x.name);
        // โชว์แค่ 5 รายการพอเป็นไฮไลต์
        setBestSellers(list.slice(0, 5));
        if (!list.length)
          setErr((e) => ({ ...e, best: 'ยังไม่มีรายการขายดีหรือ API ไม่ส่งข้อมูล' }));
      } catch {
        setBestSellers([]);
        setErr((e) => ({ ...e, best: 'โหลดสินค้าขายดีไม่สำเร็จ' }));
      } finally {
        setLoading((s) => ({ ...s, best: false }));
      }
    })();
  }, []);

  // โหลดสินค้าทั้งหมด
  useEffect(() => {
    (async () => {
      try {
        setLoading((s) => ({ ...s, all: true }));
        const got = await fetchWithCount('/products', 100);
        const seen = new Set();
        const list = got
          .map((p, i) => normalizeProduct(p, i))
          .filter((x) => x.id && x.name && !seen.has(x.id) && seen.add(x.id));
        list.sort((a, b) => {
          const ai = Number(a.id), bi = Number(b.id);
          if (Number.isFinite(ai) && Number.isFinite(bi)) return bi - ai;
          return 0;
        });
        setAllProducts(list);
        if (!list.length)
          setErr((e) => ({ ...e, all: 'ยังไม่มีสินค้าในระบบหรือ API ไม่ส่งข้อมูล' }));
      } catch {
        setAllProducts([]);
        setErr((e) => ({ ...e, all: 'โหลดสินค้าทั้งหมดไม่สำเร็จ' }));
      } finally {
        setLoading((s) => ({ ...s, all: false }));
      }
    })();
  }, []);

  // ---------- กรองฝั่ง client (สำรอง ถ้า server-search ไม่คืนผล) ----------
  const clientFilter = useMemo(() => {
    return (mode, value) => {
      if (!value) return [];
      const val = String(value).toLowerCase();
      if (mode === 'keyword') {
        return allProducts.filter(p =>
          p.name.toLowerCase().includes(val) ||
          String(p.id).toLowerCase().includes(val)
        );
      }
      if (mode === 'category') {
        return allProducts.filter(p =>
          p._cid.toLowerCase() === val ||
          p._cName.toLowerCase() === val
        );
      }
      if (mode === 'subcategory') {
        return allProducts.filter(p =>
          p._sid.toLowerCase() === val ||
          p._sName.toLowerCase() === val
        );
      }
      return [];
    };
  }, [allProducts]);

  // ---------- ทำงานเมื่อกดค้นหา ----------
  const onSearch = async (e) => {
    e?.preventDefault?.();
    setSearchResults(null);
    setErr((x) => ({ ...x, search: '' }));
    setLoading((s) => ({ ...s, search: true }));

    try {
      let val = '';
      if (mode === 'keyword') val = keyword.trim();
      if (mode === 'category') val = catValue;
      if (mode === 'subcategory') val = subValue;
      if (!val) {
        setSearchResults([]);
        return;
      }

      // ลอง server-side ก่อน
      const srv = await serverSearch(mode, val, 100);
      let list = srv.length ? srv.map((p, i) => normalizeProduct(p, i)).filter(x => x.id && x.name) : [];

      // ถ้าไม่ได้ผล ใช้ client-side กรองจาก allProducts
      if (!list.length) {
        list = clientFilter(mode, val);
      }

      setSearchResults(list);
      if (!list.length) {
        setErr((x) => ({ ...x, search: 'ไม่พบผลลัพธ์ที่ตรงกับเงื่อนไข' }));
      }
    } catch {
      setErr((x) => ({ ...x, search: 'ค้นหาไม่สำเร็จ' }));
      setSearchResults([]);
    } finally {
      setLoading((s) => ({ ...s, search: false }));
    }
  };

  // ---------- UI ชุดค้นหา ----------
  const SearchBar = () => (
    <form className="search-bar card" onSubmit={onSearch}>
      <div className="filters-row">
        <label>
          โหมดค้นหา
          <select value={mode} onChange={(e) => { setMode(e.target.value); setErr((x)=>({...x,search:''})); }}>
            <option value="keyword">คีย์เวิร์ด</option>
            <option value="category">หมวดหมู่</option>
            <option value="subcategory">หมวดหมู่ย่อย</option>
          </select>
        </label>

        {mode === 'keyword' && (
          <label className="grow">
            คำค้นหา
            <input
              type="text"
              placeholder="เช่น กุหลาบ กระบองเพชร ดินปลูก…"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
        )}

        {mode === 'category' && (
          <label className="grow">
            เลือกหมวดหมู่
            <select value={catValue} onChange={(e) => setCatValue(e.target.value)}>
              <option value="">— เลือกหมวดหมู่ —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}

        {mode === 'subcategory' && (
          <label className="grow">
            เลือกหมวดหมู่ย่อย
            <select value={subValue} onChange={(e) => setSubValue(e.target.value)}>
              <option value="">— เลือกหมวดหมู่ย่อย —</option>
              {subcategories.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}

        <button className="btn-search" type="submit" disabled={loading.search}>
          {loading.search ? 'กำลังค้นหา…' : 'ค้นหา'}
        </button>
      </div>

      {!!err.search && <div className="info-inline warn">{err.search}</div>}
    </form>
  );

  // ---------- เลือกว่าจะโชว์ผลค้นหาหรือ “สินค้าทั้งหมด” ----------
  const listToShow = searchResults ? searchResults : allProducts;

  return (
    <div className="home-container">
      {/* แถบค้นหา */}
      <SearchBar />

      {/* หมวดหมู่แนะนำ (ถ้าต้องการโชว์เฉพาะ Plants/Tools แบบเดิม ให้กรองได้) */}
      <section className="categories-quick">
        <div className="cats-row">
          {categories
            .filter(c => ['plants', 'tools'].includes(c.slug) || true) // โชว์ทั้งหมดไว้ก่อน
            .slice(0, 6)
            .map(c => (
              <Link
                key={c.id}
                className="cat-card"
                to={`/category/${encodeURIComponent(c.id)}`}
                onClick={(e) => {
                  // คลิกแล้วตั้งโหมดเป็นหมวดหมู่ + ใส่ค่า แล้วกดค้นหา
                  e.preventDefault();
                  setMode('category');
                  setCatValue(c.id);
                  setTimeout(() => onSearch(), 0);
                }}
              >
                {c.image ? <img src={c.image} alt={c.name} /> : <div className="noimg">—</div>}
                <span>{c.name}</span>
              </Link>
            ))}
        </div>
      </section>

      {/* สินค้าขายดี */}
      <section className="best-sellers">
        <h2>🌟 สินค้าขายดี</h2>
        {loading.best ? (
          <div className="info-inline">กำลังโหลด…</div>
        ) : bestSellers.length ? (
          <div className="product-grid">
            {bestSellers.map((item) => (
              <div className="product-card" key={item.id}>
                {item.img ? (
                  <img src={item.img} alt={item.name} />
                ) : (
                  <div
                    style={{
                      height: 180,
                      display: 'grid',
                      placeItems: 'center',
                      background: '#eef5ef',
                    }}
                  >
                    ไม่มีรูป
                  </div>
                )}
                <h3>{item.name}</h3>
                <p>{item.price ? `${item.price.toLocaleString()} บาท` : '— บาท'}</p>
                <button className="btn-add" onClick={() => addToCart(item)}>
                  + เพิ่มลงตะกร้า
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="info-inline">{err.best || 'ไม่มีข้อมูลขายดี'}</div>
        )}
      </section>

      {/* ผลลัพธ์การค้นหา (ถ้ามี) / หรือสินค้าทั้งหมด */}
      <section className="all-products">
        <h2>{searchResults ? '🔎 ผลการค้นหา' : '🛒 สินค้าทั้งหมด'}</h2>
        {(loading.all && !searchResults) || loading.search ? (
          <div className="info-inline">กำลังโหลด…</div>
        ) : listToShow.length ? (
          <div className="product-grid">
            {listToShow.map((p) => (
              <div className="product-card" key={p.id}>
                {p.img ? (
                  <img src={p.img} alt={p.name} />
                ) : (
                  <div
                    style={{
                      height: 180,
                      display: 'grid',
                      placeItems: 'center',
                      background: '#eef5ef',
                    }}
                  >
                    ไม่มีรูป
                  </div>
                )}
                <h3>{p.name}</h3>
                <p>{p.price ? `${p.price.toLocaleString()} บาท` : '— บาท'}</p>
                <button className="btn-add" onClick={() => addToCart(p)}>
                  + เพิ่มลงตะกร้า
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="info-inline">{(searchResults && err.search) || err.all || 'ไม่พบสินค้า'}</div>
        )}
      </section>

      {/* ฟุตเตอร์ */}
      <Footer />
    </div>
  );
}
