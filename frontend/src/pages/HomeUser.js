// src/pages/HomeUser.js
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './HomeUser.css';
import { addItem as addToCart } from '../lib/cart';

/* ---------- helpers: API path & absolute image URL ---------- */
const apiPath = (p) =>
  (axios.defaults.baseURL || '').replace(/\/+$/, '').endsWith('/api') ? p : '/api' + p;

const backendOrigin = (() => {
  const base = axios.defaults.baseURL || 'http://localhost:3001/api';
  try {
    const u = new URL(base);
    // ตัด /api ออกเพื่อให้เสิร์ฟไฟล์สเตติกจาก root (เช่น /uploads/..)
    return u.origin + (u.pathname.replace(/\/api\/?$/, '') || '');
  } catch {
    return 'http://localhost:3001';
  }
})();
const absUrl = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return backendOrigin + u;
  return `${backendOrigin}/${u.replace(/^\.?\//, '')}`;
};

const toArray = (d) =>
  Array.isArray(d) ? d :
  Array.isArray(d?.data) ? d.data :
  Array.isArray(d?.rows) ? d.rows : [];

/* ---------- map DB → UI ---------- */
const normalizeProduct = (p, idx) => {
  const img =
    p.image_url || p.cover_url || p.image || (Array.isArray(p.images) ? p.images[0] : '');
  return {
    id:    p.product_id ?? p.id ?? `p-${idx}`,
    name:  p.product_name ?? p.name_th ?? p.name ?? p.title ?? '',
    price: Number(p.min_price ?? p.selling_price ?? p.price ?? p.unit_price ?? p.product_price ?? 0),
    img:   img ? absUrl(img) : '',
  };
};

const normalizeCategory = (c, idx) => {
  const cid  = c.category_id ?? c.id ?? c.code ?? c.slug ?? `cat-${idx}`;
  const name = c.category_name ?? c.name_th ?? c.name ?? '';
  // บังคับ mapping ro1→plants, ro2→tools ตามที่ตกลง
  const forcedSlug = String(cid) === 'ro1' ? 'plants' : (String(cid) === 'ro2' ? 'tools' : null);
  const slug = forcedSlug ?? (c.slug ? String(c.slug).toLowerCase() : String(cid).toLowerCase());
  const img  = c.image_url || c.image || c.cover || c.thumbnail || '';
  return { id: String(cid), slug, name, image: img ? absUrl(img) : '' };
};

/* ---------- ดึงข้อมูลโดยกำหนดจำนวนชิ้น (รองรับพารามิเตอร์ที่พบบ่อย) ---------- */
async function fetchWithCount(url, want) {
  const paramSets = [
    { limit: want }, { take: want }, { per_page: want }, { pageSize: want }, { top: want }, {}
  ];
  for (const ps of paramSets) {
    try {
      const r = await axios.get(url, { params: { ...ps, _: Date.now() } });
      const arr = toArray(r.data);
      if (arr.length) return arr;
    } catch (_) {}
  }
  return [];
}

export default function HomeUser() {
  const [categories, setCategories]   = useState([]);
  const [bestSellers, setBestSellers] = useState([]); // 5 ชิ้นจาก DB จริง
  const [allProducts, setAllProducts] = useState([]); // ลิสต์รวมจาก DB จริง
  const [loading, setLoading]         = useState({ cat: true, best: true, all: true });
  const [err, setErr]                 = useState({ cat: '', best: '', all: '' });

  /* ---------- โหลดหมวดหมู่ ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading(s => ({ ...s, cat: true }));
        let res = null;
        try {
          res = await axios.get(apiPath('/categories'), { params: { status: 'active', _: Date.now() } });
        } catch {
          try { res = await axios.get(apiPath('/categories'), { params: { published: 1, _: Date.now() } }); }
          catch { res = await axios.get(apiPath('/categories'), { params: { _: Date.now() } }); }
        }
        const list = toArray(res.data).map(normalizeCategory).filter(x => x.id && x.name);
        // เรียงให้ plants แล้วค่อย tools
        const order = ['plants', 'tools'];
        list.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
        setCategories(list.filter(c => ['plants','tools'].includes(c.slug)).slice(0, 2));
        if (!list.length) setErr(e => ({ ...e, cat: 'ยังไม่มีหมวดหมู่ที่เปิดแสดง' }));
      } catch {
        setCategories([]);
        setErr(e => ({ ...e, cat: 'โหลดหมวดหมู่ไม่สำเร็จ' }));
      } finally {
        setLoading(s => ({ ...s, cat: false }));
      }
    })();
  }, []);

  /* ---------- สินค้าขายดี (พยายามจาก endpoint ที่น่าจะมีจริงก่อน) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading(s => ({ ...s, best: true }));
        const endpoints = [
          apiPath('/products?featured=1'),
          apiPath('/products?sort=popular'),
          // เผื่อมี route เฉพาะ
          apiPath('/products/best-sellers'),
          // fallback รวม
          apiPath('/products'),
        ];
        let bag = [];
        for (const ep of endpoints) {
          const got = await fetchWithCount(ep, 5);
          if (got.length) bag = bag.concat(got);
          if (bag.length >= 5) break;
        }
        const list = bag.map((p, i) => normalizeProduct(p, i))
                        .filter(x => x.id && x.name)
                        .slice(0, 5);
        setBestSellers(list);
        if (!list.length) setErr(e => ({ ...e, best: 'ยังไม่มีรายการขายดีหรือ API ไม่ส่งข้อมูล' }));
      } catch {
        setBestSellers([]);
        setErr(e => ({ ...e, best: 'โหลดสินค้าขายดีไม่สำเร็จ' }));
      } finally {
        setLoading(s => ({ ...s, best: false }));
      }
    })();
  }, []);

  /* ---------- สินค้าทั้งหมด (ของจริงเท่านั้น) ---------- */
  useEffect(() => {
    (async () => {
      try {
        setLoading(s => ({ ...s, all: true }));
        // พยายาม endpoint รวมที่มีจริง
        const endpoints = [
          apiPath('/products'),     // ✅ มีจริง
          // ❌ ตัด /products/all ที่ทำให้ 404 ใน log
        ];
        let items = [];
        for (const ep of endpoints) {
          const got = await fetchWithCount(ep, 60);
          if (got.length) items = items.concat(got);
          if (items.length >= 12) break;
        }
        // ถ้ายังน้อย → ลองยิงตามหมวด plants/tools แบบพารามิเตอร์ category (✅ มีจริง)
        if (items.length < 12) {
          const keys = (categories.length ? categories : []).map(c => c.slug || c.id);
          for (const key of keys) {
            const q = encodeURIComponent(key === 'plants' ? 'ro1' : key === 'tools' ? 'ro2' : key);
            const catUrl = apiPath(`/products?category=${q}`);
            const more = await fetchWithCount(catUrl, 30);
            if (more.length) items = items.concat(more);
            if (items.length >= 12) break;
          }
        }
        // ลบซ้ำ + เรียง id ใหม่ → เก่าถ้าเป็นตัวเลข
        const seen = new Set();
        const list = items
          .map((p, i) => normalizeProduct(p, i))
          .filter(x => x.id && x.name && !seen.has(x.id) && seen.add(x.id));
        list.sort((a, b) => {
          const ai = Number(a.id), bi = Number(b.id);
          if (Number.isFinite(ai) && Number.isFinite(bi)) return bi - ai;
          return 0;
        });
        setAllProducts(list);
        if (!list.length) setErr(e => ({ ...e, all: 'ยังไม่มีสินค้าในระบบหรือ API ไม่ส่งข้อมูล' }));
      } catch {
        setAllProducts([]);
        setErr(e => ({ ...e, all: 'โหลดสินค้าทั้งหมดไม่สำเร็จ' }));
      } finally {
        setLoading(s => ({ ...s, all: false }));
      }
    })();
  }, [categories]);

  return (
    <div className="home-container">
      {/* Search */}
      <div className="search-box">
        <input type="text" placeholder="ค้นหาสินค้า" />
        <button className="search-btn">🔍</button>
      </div>

      {/* Hero */}
      <section
        className="hero"
        style={{
          backgroundImage: `url(${process.env.PUBLIC_URL + '/p2.png'})`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }}
      >
        <div className="hero-text">
          <h1>“<span className="highlight">ร้านปราชญ์แม่โจ้</span>”</h1>
          <p>แหล่งผลิตและจัดจำหน่าย ต้นไม้ และวัสดุปลูก มากกว่า 100 รายการ</p>
        </div>
      </section>

      {/* Categories */}
      <section className="categories">
        {loading.cat ? null :
         categories.length ? (
           categories.map((cat) => (
             <Link
               key={cat.id}
               to={cat.slug === 'plants'
                    ? '/plants'
                    : cat.slug === 'tools'
                      ? '/tools'
                      : `/products?category=${encodeURIComponent(cat.slug || cat.id)}`}
               className="category-card"
               title={cat.name}
             >
               {cat.image ? (
                 <img src={cat.image} alt={cat.name} />
               ) : (
                 <div style={{height:160,display:'grid',placeItems:'center',background:'#eef5ef'}}>ไม่มีรูป</div>
               )}
               <p>{cat.name}</p>
             </Link>
           ))
         ) : (
           <div className="info-inline">{err.cat || 'ไม่มีหมวดหมู่'}</div>
         )}
      </section>

      {/* Best Sellers */}
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
                  <div style={{height:180,display:'grid',placeItems:'center',background:'#eef5ef'}}>ไม่มีรูป</div>
                )}
                <h3>{item.name}</h3>
                <p>{Number(item.price || 0).toLocaleString()} บาท</p>
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

      {/* All products */}
      <section className="all-products">
        <h2>🛒 สินค้าทั้งหมด</h2>
        {loading.all ? (
          <div className="info-inline">กำลังโหลด…</div>
        ) : allProducts.length ? (
          <div className="product-grid">
            {allProducts.map((p) => (
              <div className="product-card" key={p.id}>
                {p.img ? (
                  <img src={p.img} alt={p.name} />
                ) : (
                  <div style={{height:180,display:'grid',placeItems:'center',background:'#eef5ef'}}>ไม่มีรูป</div>
                )}
                <h3>{p.name}</h3>
                <p>{Number(p.price || 0).toLocaleString()} บาท</p>
                <button className="btn-add" onClick={() => addToCart(p)}>
                  + เพิ่มลงตะกร้า
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="info-inline">{err.all || 'ไม่พบสินค้า'}</div>
        )}
      </section>
    </div>
  );
}
