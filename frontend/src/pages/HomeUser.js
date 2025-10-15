// src/pages/HomeUser.js
// รองรับ {items,total} และ array ตรง ๆ + ขอจำนวนมากขึ้น

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import './HomeUser.css';
import { addItem as addToCart } from '../lib/cart';

const apiPath = (p) =>
  (axios.defaults.baseURL || '').replace(/\/+$/, '').endsWith('/api') ? p : '/api' + p;

const backendOrigin = (() => {
  const base = axios.defaults.baseURL || 'http://localhost:3001/api';
  try { const u = new URL(base); return u.origin + (u.pathname.replace(/\/api\/?$/, '') || ''); }
  catch { return 'http://localhost:3001'; }
})();
const absUrl = (u) => {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return backendOrigin + u;
  return `${backendOrigin}/${u.replace(/^\.?\//, '')}`;
};

const toArray = (d) =>
  Array.isArray(d) ? d :
  Array.isArray(d?.items) ? d.items :
  Array.isArray(d?.data?.items) ? d.data.items :
  Array.isArray(d?.data) ? d.data : [];

const normalizeProduct = (p, idx) => {
  const img = p.image_url || p.cover_url || p.image || (Array.isArray(p.images) ? p.images[0] : '');
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
  const forcedSlug = String(cid) === 'ro1' ? 'plants' : (String(cid) === 'ro2' ? 'tools' : null);
  const slug = forcedSlug ?? (c.slug ? String(c.slug).toLowerCase() : String(cid).toLowerCase());
  const img  = c.image_url || c.image || c.cover || c.thumbnail || '';
  return { id: String(cid), slug, name, image: img ? absUrl(img) : '' };
};

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
  const [bestSellers, setBestSellers] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading]         = useState({ cat: true, best: true, all: true });
  const [err, setErr]                 = useState({ cat: '', best: '', all: '' });

  useEffect(() => {
    (async () => {
      try {
        setLoading(s => ({ ...s, cat: true }));
        let res = null;
        try { res = await axios.get(apiPath('/categories'), { params: { status: 'active', _: Date.now() } }); }
        catch { try { res = await axios.get(apiPath('/categories'), { params: { published: 1, _: Date.now() } }); }
        catch { res = await axios.get(apiPath('/categories'), { params: { _: Date.now() } }); } }
        const list = toArray(res.data).map(normalizeCategory).filter(x => x.id && x.name);
        const order = ['plants', 'tools'];
        list.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));
        setCategories(list.filter(c => ['plants','tools'].includes(c.slug)).slice(0, 2));
      } catch {
        setCategories([]); setErr(e => ({ ...e, cat: 'โหลดหมวดหมู่ไม่สำเร็จ' }));
      } finally { setLoading(s => ({ ...s, cat: false })); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(s => ({ ...s, best: true }));
        const endpoints = [
          apiPath('/products/best-sellers'),
          apiPath('/products?sort=popular'),
          apiPath('/products?featured=1'),
          apiPath('/products'),
        ];
        let bag = [];
        for (const ep of endpoints) {
          const got = await fetchWithCount(ep, 12); // ขอ 12
          if (got.length) bag = bag.concat(got);
          if (bag.length >= 12) break;
        }
        const list = bag.map((p, i) => normalizeProduct(p, i)).filter(x => x.id && x.name);
        setBestSellers(list.slice(0, 5)); // แสดง 5
        if (!list.length) setErr(e => ({ ...e, best: 'ยังไม่มีรายการขายดีหรือ API ไม่ส่งข้อมูล' }));
      } catch {
        setBestSellers([]); setErr(e => ({ ...e, best: 'โหลดสินค้าขายดีไม่สำเร็จ' }));
      } finally { setLoading(s => ({ ...s, best: false })); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(s => ({ ...s, all: true }));
        const got = await fetchWithCount(apiPath('/products'), 100); // ขอ 100 (route default 60)
        const seen = new Set();
        const list = got.map((p, i) => normalizeProduct(p, i))
                        .filter(x => x.id && x.name && !seen.has(x.id) && seen.add(x.id));
        list.sort((a, b) => {
          const ai = Number(a.id), bi = Number(b.id);
          if (Number.isFinite(ai) && Number.isFinite(bi)) return bi - ai;
          return 0;
        });
        setAllProducts(list);
        if (!list.length) setErr(e => ({ ...e, all: 'ยังไม่มีสินค้าในระบบหรือ API ไม่ส่งข้อมูล' }));
      } catch {
        setAllProducts([]); setErr(e => ({ ...e, all: 'โหลดสินค้าทั้งหมดไม่สำเร็จ' }));
      } finally { setLoading(s => ({ ...s, all: false })); }
    })();
  }, []);

  return (
    <div className="home-container">
      {/* hero & categories … (คงเดิมของโปรเจ็กต์คุณ) */}

      <section className="best-sellers">
        <h2>🌟 สินค้าขายดี</h2>
        {loading.best ? <div className="info-inline">กำลังโหลด…</div> :
         bestSellers.length ? (
          <div className="product-grid">
            {bestSellers.map((item) => (
              <div className="product-card" key={item.id}>
                {item.img ? <img src={item.img} alt={item.name} /> :
                  <div style={{height:180,display:'grid',placeItems:'center',background:'#eef5ef'}}>ไม่มีรูป</div>}
                <h3>{item.name}</h3>
                <p>{Number(item.price || 0).toLocaleString()} บาท</p>
                <button className="btn-add" onClick={() => addToCart(item)}>+ เพิ่มลงตะกร้า</button>
              </div>
            ))}
          </div>
        ) : <div className="info-inline">{err.best || 'ไม่มีข้อมูลขายดี'}</div>}
      </section>

      <section className="all-products">
        <h2>🛒 สินค้าทั้งหมด</h2>
        {loading.all ? <div className="info-inline">กำลังโหลด…</div> :
         allProducts.length ? (
          <div className="product-grid">
            {allProducts.map((p) => (
              <div className="product-card" key={p.id}>
                {p.img ? <img src={p.img} alt={p.name} /> :
                  <div style={{height:180,display:'grid',placeItems:'center',background:'#eef5ef'}}>ไม่มีรูป</div>}
                <h3>{p.name}</h3>
                <p>{Number(p.price || 0).toLocaleString()} บาท</p>
                <button className="btn-add" onClick={() => addToCart(p)}>+ เพิ่มลงตะกร้า</button>
              </div>
            ))}
          </div>
        ) : <div className="info-inline">{err.all || 'ไม่พบสินค้า'}</div>}
      </section>
    </div>
  );
}
