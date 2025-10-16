// frontend/src/pages/OrdersUser.js
// Minimal "My Orders" page — fetch from GET /api/orders/me

import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

function formatBaht(n) {
  const v = Number(n || 0);
  return v.toLocaleString('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
}

function fmtDate(d) {
  const dt = d ? new Date(d) : null;
  return dt ? dt.toLocaleString('th-TH') : '-';
}

export default function OrdersUser() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get('/api/orders/me');
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('load orders error', err);
      alert(err?.response?.data?.message || 'โหลดรายการสั่งซื้อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 12px' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>คำสั่งซื้อของฉัน</h2>
        <button onClick={load} style={{ border:'1px solid #2e7d32', color:'#2e7d32', background:'#fff', padding:'8px 12px', borderRadius:8 }}>
          รีเฟรช
        </button>
      </div>

      {loading && <div>กำลังโหลด…</div>}

      {!loading && orders.length === 0 && (
        <div style={{ border:'1px dashed #e5e7eb', borderRadius:12, padding:16 }}>
          ยังไม่มีคำสั่งซื้อ — <Link to="/products">ไปเลือกซื้อสินค้า</Link>
        </div>
      )}

      {!loading && orders.map((o) => (
        <div key={o.order_id} style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:12, margin:'12px 0' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <div>
              <div style={{ fontWeight:700 }}>Order #{o.order_id}</div>
              <div style={{ color:'#6b7280', fontSize:13 }}>สร้างเมื่อ: {fmtDate(o.created_at)}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontWeight:700 }}>{formatBaht(o.grand_total ?? (o.total_price || 0) + (o.shipping_fee || 0))}</div>
              <div style={{ fontSize:13, color:'#6b7280' }}>
                สถานะ: <b>{o.status || o.order_status_id || '-'}</b>
              </div>
            </div>
          </div>

          <div style={{ marginTop:12, background:'#fafafa', border:'1px solid #f3f4f6', borderRadius:8, padding:8 }}>
            <div style={{ fontWeight:600, marginBottom:6 }}>รายการสินค้า</div>
            <ul style={{ margin:0, paddingLeft:18 }}>
              {(o.items || []).map((it, idx) => (
                <li key={idx} style={{ lineHeight:1.6 }}>
                  SKU #{it.product_variant_id} × {it.quantity} @ {formatBaht(it.price)} = {formatBaht(it.subtotal)}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display:'flex', gap:12, marginTop:12, alignItems:'center', flexWrap:'wrap' }}>
            <div>
              สลิป: {o.payment_slip_url
                ? <a href={o.payment_slip_url} target="_blank" rel="noreferrer">เปิดดู</a>
                : <span style={{ color:'#6b7280' }}>ยังไม่แนบ</span>}
            </div>
            <Link to="/checkout" style={{ marginLeft:'auto', border:'1px solid #2e7d32', color:'#2e7d32', padding:'6px 10px', borderRadius:8 }}>
              สั่งซื้อเพิ่ม
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
