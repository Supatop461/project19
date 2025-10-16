// frontend/src/pages/CheckoutPage.js
// Checkout: ดึงที่อยู่ของฉัน (เลือก/แก้/บันทึกใหม่ได้) + คำนวณค่าส่งอัตโนมัติ
// สูตรค่าส่ง: เริ่มต้น 80 บาท + (จำนวนต้นทั้งหมด - 1) * 40

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { getCart, getTotal, clearCart, updateQty, removeItem } from '../lib/cart';

function formatBaht(n) {
  const v = Number(n || 0);
  return v.toLocaleString('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 });
}

// แปลงโครงที่อยู่จาก backend หลากหลายสคีมา → โครงเดียวที่ใช้ในฟอร์ม
function normalizeAddr(a) {
  if (!a) return null;
  return {
    id: a.address_id ?? a.id ?? null,
    fullname: a.fullname ?? a.full_name ?? a.name ?? '',
    phone: a.phone ?? a.tel ?? a.mobile ?? '',
    line1: a.line1 ?? a.address_line ?? a.address ?? a.house_no ?? '',
    subdistrict: a.subdistrict ?? a.sub_district ?? a.tambon ?? '',
    district: a.district ?? a.amphoe ?? a.khet ?? '',
    province: a.province ?? '',
    zipcode: a.zipcode ?? a.postcode ?? a.postal_code ?? '',
    isDefault: Boolean(a.is_default ?? a.default ?? a.is_primary ?? a.primary ?? a.is_main ?? false),
  };
}

// รวม address -> string สั้น ๆ ไว้โชว์ในตัวเลือก
function addrLabel(a) {
  if (!a) return '-';
  const parts = [
    a.fullname || '',
    a.phone || '',
    a.line1 || '',
    a.subdistrict || '',
    a.district || '',
    a.province || '',
    a.zipcode || '',
  ].filter(Boolean);
  return parts.join(' • ');
}

export default function CheckoutPage() {
  const navigate = useNavigate();

  // ----- cart -----
  const [cart, setCart] = useState(getCart());
  const subtotal = useMemo(() => getTotal(), [cart]);

  // 🧮 ค่าส่งอัตโนมัติ: เริ่ม 80 + ต้นต่อไป +40
  const [shippingFee, setShippingFee] = useState(80);
  useEffect(() => {
    if (!cart || !cart.length) { setShippingFee(0); return; }
    const totalQty = cart.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
    const fee = 80 + Math.max(0, totalQty - 1) * 40;
    setShippingFee(fee);
  }, [cart]);

  const grand = (subtotal || 0) + (shippingFee || 0);

  // ----- addresses -----
  const [addresses, setAddresses] = useState([]);     // รายการ address ที่ดึงมา
  const [selectedId, setSelectedId] = useState('');   // id ที่เลือกใน <select> ("", "new")
  const [address, setAddress] = useState({            // ฟอร์ม address (แก้ไขได้)
    line1: '', subdistrict: '', district: '', province: '', zipcode: '',
    phone: '', fullname: '',
  });
  const [saveBack, setSaveBack] = useState(false);    // ติ๊กแล้วอัปเดตกลับไปยัง address เดิม
  const [saveAsNew, setSaveAsNew] = useState(false);  // ติ๊กแล้วบันทึกเป็นที่อยู่อันใหม่
  const [loadingAddr, setLoadingAddr] = useState(true);

  // ----- slip / ui -----
  const [slip, setSlip] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // โหลด "ที่อยู่ของฉัน" จาก API เดิม (มี /api/user-addresses; fallback /api/addresses)
  useEffect(() => {
    (async () => {
      try {
        setLoadingAddr(true);
        let data = [];
        try {
          const r1 = await axios.get('/api/user-addresses');
          data = Array.isArray(r1.data) ? r1.data : (r1.data?.items || []);
        } catch {
          const r2 = await axios.get('/api/addresses');
          data = Array.isArray(r2.data) ? r2.data : (r2.data?.items || []);
        }
        const list = (data || []).map(normalizeAddr).filter(Boolean);
        setAddresses(list);
        const def = list.find(a => a.isDefault) || list[0] || null;
        if (def) {
          setSelectedId(def.id ?? '');
          setAddress({ ...def, id: undefined, isDefault: undefined });
        } else {
          setSelectedId('new'); // ไม่มีที่อยู่ → ให้กรอกใหม่
        }
      } catch {
        setSelectedId('new');
      } finally {
        setLoadingAddr(false);
      }
    })();
  }, []);

  const onPickAddr = (val) => {
    setSelectedId(val);
    setSaveBack(false);
    setSaveAsNew(false);
    if (val === 'new' || val === '') {
      setAddress({ line1:'', subdistrict:'', district:'', province:'', zipcode:'', phone:'', fullname:'' });
    } else {
      const found = addresses.find(a => String(a.id) === String(val));
      if (found) setAddress({ ...found, id: undefined, isDefault: undefined });
    }
  };

  const onQtyChange = (id, variantId, qty) => {
    const q = Math.max(1, Number(qty || 1));
    updateQty(id, q, variantId);
    setCart(getCart());
  };
  const onRemove = (id, variantId) => {
    removeItem(id, variantId);
    setCart(getCart());
  };

  const isAddressValid = () => {
    const a = address;
    return a.fullname && a.phone && a.line1 && a.district && a.province && a.zipcode;
  };

  // บันทึก address กลับไปยังระบบ address (ถ้าเลือก)
  async function persistAddressChanges() {
    try {
      if (saveBack && selectedId && selectedId !== 'new') {
        await axios.put(`/api/addresses/${selectedId}`, {
          fullname: address.fullname,
          phone: address.phone,
          line1: address.line1,
          subdistrict: address.subdistrict,
          district: address.district,
          province: address.province,
          zipcode: address.zipcode,
        }).catch(() => {});
      }
      if (saveAsNew) {
        await axios.post(`/api/addresses`, {
          fullname: address.fullname,
          phone: address.phone,
          line1: address.line1,
          subdistrict: address.subdistrict,
          district: address.district,
          province: address.province,
          zipcode: address.zipcode,
          is_default: false,
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('persist address failed (ignored)', e);
    }
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!cart.length) return alert('ยังไม่มีสินค้าในตะกร้า');
    if (!isAddressValid()) return alert('กรอกที่อยู่ให้ครบก่อนนะ');

    try {
      setSubmitting(true);
      await persistAddressChanges();

      // payload items
      const items = cart.map(x => ({
        variantId: x.variantId ?? x.variant_id,
        quantity: x.quantity,
        price: Number(x.price) || 0,
      }));

      // 1) create order (pending) — ส่งค่าส่งที่คำนวณแล้ว
      const { data: order } = await axios.post('/api/orders', {
        address,
        items,
        shipping_fee: Number(shippingFee) || 0,
      });

      // 2) optional: upload slip
      if (slip) {
        const fd = new FormData();
        fd.append('slip', slip);
        await axios.post(`/api/orders/${order.order_id}/slip`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }

      // 3) clear cart + go to "my orders"
      clearCart();
      alert('สั่งซื้อสำเร็จ! เราได้บันทึกออเดอร์ของคุณแล้ว');
      navigate('/orders');
    } catch (err) {
      console.error('checkout error', err);
      const msg = err?.response?.data?.message || 'สั่งซื้อไม่สำเร็จ กรุณาลองใหม่';
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 12px' }}>
      <h2 style={{ marginBottom: 16 }}>ชำระเงิน</h2>

      {/* เลือกที่อยู่ */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 16 }}>
        <div style={{ display:'flex', alignItems:'center', gap: 12, marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>ที่อยู่จัดส่ง</h3>
          {loadingAddr && <span style={{ color:'#6b7280', fontSize:13 }}>(กำลังโหลดที่อยู่...)</span>}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap: 12, alignItems:'center' }}>
          <select
            value={selectedId}
            onChange={(e) => onPickAddr(e.target.value)}
            style={{ padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:8 }}
          >
            {addresses.map(a => (
              <option key={String(a.id)} value={String(a.id)}>
                {a.isDefault ? '⭐ ' : ''}{addrLabel(a)}
              </option>
            ))}
            <option value="new">+ ใช้ที่อยู่อื่น (กรอกใหม่)</option>
          </select>

          {/* toggles บันทึกกลับระบบ address */}
          <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
            {selectedId && selectedId !== 'new' && (
              <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:13 }}>
                <input type="checkbox" checked={saveBack} onChange={(e)=>setSaveBack(e.target.checked)} />
                บันทึกการแก้ไขกลับที่อยู่นี้
              </label>
            )}
            <label style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:13 }}>
              <input type="checkbox" checked={saveAsNew} onChange={(e)=>setSaveAsNew(e.target.checked)} />
              บันทึกเป็นที่อยู่อันใหม่
            </label>
          </div>
        </div>

        {/* ฟอร์มแก้ไข/กรอกที่อยู่ */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <input placeholder="ชื่อ-นามสกุล" value={address.fullname} onChange={e=>setAddress({ ...address, fullname: e.target.value })} />
            <input placeholder="เบอร์โทร" value={address.phone} onChange={e=>setAddress({ ...address, phone: e.target.value })} />
          </div>
          <div style={{ marginTop: 12 }}>
            <input placeholder="ที่อยู่ (บ้านเลขที่/ถนน/หมู่บ้าน)" value={address.line1} onChange={e=>setAddress({ ...address, line1: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <input placeholder="ตำบล/แขวง" value={address.subdistrict} onChange={e=>setAddress({ ...address, subdistrict: e.target.value })} />
            <input placeholder="อำเภอ/เขต" value={address.district} onChange={e=>setAddress({ ...address, district: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <input placeholder="จังหวัด" value={address.province} onChange={e=>setAddress({ ...address, province: e.target.value })} />
            <input placeholder="รหัสไปรษณีย์" value={address.zipcode} onChange={e=>setAddress({ ...address, zipcode: e.target.value })} />
          </div>
        </div>
      </div>

      {/* ตะกร้า + สรุปยอด */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 12px' }}>ตะกร้าสินค้า</h3>
            {!cart.length && (
              <div style={{ padding: 8 }}>
                ยังไม่มีสินค้าในตะกร้า — <Link to="/products">เลือกสินค้าต่อ</Link>
              </div>
            )}
            {cart.map((it, idx) => (
              <div key={`${it.id}-${it.variantId}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '64px 1fr 120px 80px 40px', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: idx ? '1px solid #f3f4f6' : 'none' }}>
                <div>
                  {it.img ? (
                    <img src={it.img} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
                  ) : (
                    <div style={{ width: 64, height: 64, background: '#f3f4f6', borderRadius: 8 }} />
                  )}
                </div>
                <div style={{ fontSize: 14 }}>
                  <div style={{ fontWeight: 600 }}>{it.name || 'สินค้า'}</div>
                  {it.variantId ? <div style={{ color: '#6b7280' }}>SKU #{it.variantId}</div> : null}
                </div>
                <div>{formatBaht(it.price)}</div>
                <div>
                  <input
                    type="number"
                    value={it.quantity}
                    min={1}
                    onChange={(e) => onQtyChange(it.id, it.variantId, e.target.value)}
                    style={{ width: 72, padding: 6 }}
                  />
                </div>
                <button type="button" onClick={() => onRemove(it.id, it.variantId)} style={{ border: '1px solid #ef4444', color: '#ef4444', background: 'white', borderRadius: 8, padding: 6 }}>
                  ลบ
                </button>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, height: 'fit-content', position: 'sticky', top: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>สรุปคำสั่งซื้อ</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, fontSize: 14 }}>
            <div>ยอดสินค้า</div>
            <div>{formatBaht(subtotal)}</div>
            <div>ค่าส่ง</div>
            <div>{formatBaht(shippingFee)}</div>
            <div style={{ borderTop: '1px dashed #e5e7eb', marginTop: 8, paddingTop: 8, fontWeight: 700 }}>รวมทั้งสิ้น</div>
            <div style={{ borderTop: '1px dashed #e5e7eb', marginTop: 8, paddingTop: 8, fontWeight: 700 }}>{formatBaht(grand)}</div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 14, marginBottom: 6 }}>แนบสลิป (ถ้ามีตอนนี้)</div>
            <input type="file" accept="image/*" onChange={e=>setSlip(e.target.files?.[0] || null)} />
          </div>

          <button
            type="submit"
            disabled={submitting || !cart.length}
            style={{ width: '100%', marginTop: 16, padding: '10px 14px', borderRadius: 10, background: '#2e7d32', color: 'white', border: 'none', fontWeight: 700 }}
          >
            {submitting ? 'กำลังสั่งซื้อ…' : 'ยืนยันสั่งซื้อ'}
          </button>

          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <Link to="/cart">กลับไปแก้ไขตะกร้า</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
