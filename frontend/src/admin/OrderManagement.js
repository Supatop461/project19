// src/admin/OrderManagement.js
// Admin: ดูรายการออเดอร์ทั้งหมด + อัปเดตสถานะ (o1=ชำระแล้ว, o2=จัดส่งแล้ว, cancelled)

import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

function formatBaht(n) {
  const v = Number(n || 0);
  return v.toLocaleString('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
}
function fmtDate(d) {
  const dt = d ? new Date(d) : null;
  return dt ? dt.toLocaleString('th-TH') : '-';
}
const STATUS_LABEL = {
  pending: 'รอชำระ',
  o1: 'ชำระแล้ว',
  o2: 'จัดส่งแล้ว',
  completed: 'สำเร็จ',
  cancelled: 'ยกเลิก',
};

export default function OrderManagement() {
  const [orders, setOrders] = useState([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await axios.get('/api/admin/orders');
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('admin load orders error', err);
      alert(err?.response?.data?.message || 'โหลดออเดอร์ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const kw = (q || '').trim().toLowerCase();
    return orders.filter(o => {
      const statusText = (o.status || o.order_status_id || '').toString().toLowerCase();
      if (statusFilter && statusText !== statusFilter) return false;
      if (!kw) return true;
      const text = JSON.stringify(o).toLowerCase();
      return text.includes(kw);
    });
  }, [orders, q, statusFilter]);

  async function setStatus(order_id, order_status_id) {
    try {
      setSaving(order_id);
      await axios.put(`/api/admin/orders/${order_id}/status`, { order_status_id });
      await load();
    } catch (e) {
      console.error('update status error', e);
      alert(e?.response?.data?.message || 'อัปเดตสถานะไม่สำเร็จ');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display:'flex', gap:12, alignItems:'center', marginBottom:12 }}>
        <h2 style={{ margin:0 }}>จัดการออเดอร์</h2>
        <button onClick={load} style={{ marginLeft:'auto', border:'1px solid #2e7d32', color:'#2e7d32', background:'#fff', padding:'8px 12px', borderRadius:8 }}>
          รีเฟรช
        </button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 200px', gap:12, marginBottom:12 }}>
        <input
          placeholder="ค้นหา (#ออเดอร์, SKU, ยอด, ฯลฯ)"
          value={q}
          onChange={e=>setQ(e.target.value)}
          style={{ padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}
        />
        <select
          value={statusFilter}
          onChange={e=>setStatusFilter(e.target.value)}
          style={{ padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}
        >
          <option value="">สถานะทั้งหมด</option>
          <option value="pending">รอชำระ</option>
          <option value="o1">ชำระแล้ว</option>
          <option value="o2">จัดส่งแล้ว</option>
          <option value="completed">สำเร็จ</option>
          <option value="cancelled">ยกเลิก</option>
        </select>
      </div>

      {loading && <div>กำลังโหลด…</div>}

      {!loading && filtered.map(o => {
        const total = (o.grand_total ?? (o.total_price || 0) + (o.shipping_fee || 0)) || 0;
        const status = (o.status || o.order_status_id || '').toString();
        const label = STATUS_LABEL[status] || status || '-';

        return (
          <div key={o.order_id} style={{ border:'1px solid #e5e7eb', borderRadius:12, padding:12, margin:'12px 0' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <div>
                <div style={{ fontWeight:700 }}>Order #{o.order_id}</div>
                <div style={{ color:'#6b7280', fontSize:13 }}>
                  ลูกค้า: {o.user_id ?? '-'} • สร้างเมื่อ {fmtDate(o.created_at)}
                </div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontWeight:700 }}>{formatBaht(total)}</div>
                <div style={{ fontSize:13, color:'#6b7280' }}>สถานะ: <b>{label}</b></div>
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

            <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginTop:12 }}>
              <div>
                สลิป: {o.payment_slip_url
                  ? <a href={o.payment_slip_url} target="_blank" rel="noreferrer">เปิดดู</a>
                  : <span style={{ color:'#6b7280' }}>ไม่มี</span>}
              </div>

              <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
                <button
                  onClick={() => setStatus(o.order_id, 'o1')}
                  disabled={saving === o.order_id}
                  style={{ border:'1px solid #10b981', color:'#10b981', background:'#fff', padding:'6px 10px', borderRadius:8 }}
                >
                  ทำเป็น “ชำระแล้ว”
                </button>
                <button
                  onClick={() => setStatus(o.order_id, 'o2')}
                  disabled={saving === o.order_id}
                  style={{ border:'1px solid #3b82f6', color:'#3b82f6', background:'#fff', padding:'6px 10px', borderRadius:8 }}
                >
                  ทำเป็น “จัดส่งแล้ว”
                </button>
                <button
                  onClick={() => setStatus(o.order_id, 'cancelled')}
                  disabled={saving === o.order_id}
                  style={{ border:'1px solid #ef4444', color:'#ef4444', background:'#fff', padding:'6px 10px', borderRadius:8 }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
