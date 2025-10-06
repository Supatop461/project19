// src/admin/VariantPreview.js
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

export default function VariantPreview({ productId }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [product, setProduct] = useState(null);   // ใช้ชื่อโชว์หัวกล่อง
  const [options, setOptions] = useState([]);     // [{option_id, option_name, values:[{value_id,value_name}]}]
  const [variants, setVariants] = useState([]);   // [{variant_id, sku, final_price/price, stock/stock_qty, combo}]

  async function load() {
    setLoading(true); setErr('');
    try {
      // ดึงชื่อสินค้า (public products)
      const p = await axios.get(`/api/products/${productId}`).catch(() => ({ data: null }));
      setProduct(p?.data || null);

      // ดึง options และ variants ตาม backend ใหม่
      const [{ data: opts }, { data: vars }] = await Promise.all([
        axios.get(`/api/variants/products/${productId}/options`),
        axios.get(`/api/variants/product/${productId}?active=1`),
      ]);
      setOptions(opts || []);
      setVariants(vars || []);
    } catch (e) {
      setErr(e?.response?.data?.message || e?.message || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId]);

  // สร้างตัวช่วย map id -> name เพื่อแสดงคอมโบเป็นภาษาคน
  const optNameById = useMemo(() => {
    const m = new Map();
    options.forEach(o => m.set(o.option_id, o.option_name));
    return m;
  }, [options]);
  const valNameById = useMemo(() => {
    const m = new Map();
    options.forEach(o => (o.values || []).forEach(v => m.set(v.value_id, v.value_name)));
    return m;
  }, [options]);

  const comboText = (v) => {
    // รองรับทั้ง 'combo' และ 'combos'
    const list = v.combo || v.combos || [];
    if (!list.length) return '—';
    return list
      .map(c => `${optNameById.get(c.option_id) ?? c.option_id}: ${valNameById.get(c.value_id) ?? c.value_id}`)
      .join(' • ');
  };

  if (loading) return <div style={{ padding: 12 }}>กำลังโหลด…</div>;
  if (err)      return <div style={{ padding: 12, color:'#b00020' }}>{err}</div>;

  return (
    <div style={{ padding: 12, background: '#fafafa', borderRadius: 12, border: '1px solid #eee' }}>
      <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8 }}>
        <strong>ตัวเลือก/Variant — {product?.product_name ?? `สินค้า #${productId}`}</strong>
        <button onClick={load} style={{ marginLeft:'auto' }}>รีเฟรช</button>
        <a
          href={`/admin/products/${productId}/variants`}
          style={{ textDecoration:'none', padding:'6px 10px', border:'1px solid #ddd', borderRadius:8 }}
        >
          จัดการแบบเต็มหน้า
        </a>
      </div>

      {/* แสดงหัวข้อออปชั่นที่มี */}
      <div style={{ display:'flex', gap:16, flexWrap:'wrap', marginBottom:10 }}>
        {options.map(o => (
          <div key={o.option_id}>
            <div style={{ fontWeight:600 }}>{o.option_name}</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {(o.values || []).length
                ? (o.values || []).map(v => (
                    <span key={v.value_id} style={{ background:'#fff', border:'1px solid #eee', padding:'2px 8px', borderRadius:8 }}>
                      {v.value_name}
                    </span>
                  ))
                : <em style={{ color:'#888' }}>— ไม่มีค่า —</em>}
            </div>
          </div>
        ))}
      </div>

      {/* ตาราง variants */}
      <table width="100%" cellPadding="8" style={{ borderCollapse:'collapse' }}>
        <thead>
          <tr style={{ background:'#f5f5f5' }}>
            <th align="left">SKU</th>
            <th align="left">คอมโบ</th>
            <th align="right">ราคา</th>
            <th align="right">สต็อก</th>
          </tr>
        </thead>
        <tbody>
          {variants.length === 0 ? (
            <tr><td colSpan={4} align="center"><em>ยังไม่มี Variant</em></td></tr>
          ) : variants.map(v => (
            <tr key={v.variant_id} style={{ borderTop:'1px solid #eee' }}>
              <td>{v.sku || <em>(auto)</em>}</td>
              <td>{comboText(v)}</td>
              <td align="right">{(v.final_price ?? v.price ?? '-')}</td>
              <td align="right">{(v.stock ?? v.stock_qty ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
