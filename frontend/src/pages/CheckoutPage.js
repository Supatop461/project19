import React, { useState } from 'react';
import axios from 'axios';
import CheckoutAddress from '../checkout/CheckoutAddress';

export default function CheckoutPage() {
  const [shipAddr, setShipAddr] = useState(null);

  const placeOrder = async () => {
    if (!shipAddr) return alert('ยังไม่มีที่อยู่จัดส่ง');

    const payload = {
      items: [], // TODO: ใส่รายการตะกร้าจริงของคุณ
      shipping_address_id: shipAddr.address_id, // ให้ backend ทำ snapshot จาก id
      note: '',
    };

    try {
      const res = await axios.post('/api/orders', payload);
      alert('สั่งซื้อสำเร็จ: ' + res.data.order_id);
    } catch (e) {
      alert(e?.response?.data?.error || 'สั่งซื้อไม่สำเร็จ');
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      <h2>ชำระเงิน</h2>
      <CheckoutAddress onSelect={setShipAddr} />
      <div style={{ marginTop: 16 }}>
        <button onClick={placeOrder}>ยืนยันคำสั่งซื้อ</button>
      </div>
    </div>
  );
}
