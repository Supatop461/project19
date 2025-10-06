import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function CheckoutAddress({ onSelect }) {
  const [defAddr, setDefAddr] = useState(null);
  const [list, setList] = useState([]);
  const [openPicker, setOpenPicker] = useState(false);

  useEffect(() => {
    (async () => {
      const [d, l] = await Promise.all([
        axios.get('/api/addresses/default'),
        axios.get('/api/addresses'),
      ]);
      setDefAddr(d.data || null);
      setList(l.data || []);
      if (onSelect) onSelect(d.data || null);
    })().catch(console.error);
  }, [onSelect]);

  return (
    <div style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
      <h3>ที่อยู่จัดส่ง</h3>
      {defAddr ? (
        <div>
          <div><b>{defAddr.recipient_name}</b> ({defAddr.phone || '-'})</div>
          <div>{defAddr.line1}{defAddr.line2 ? `, ${defAddr.line2}` : ''}</div>
          <div>{[defAddr.subdistrict, defAddr.district, defAddr.province].filter(Boolean).join(', ')}</div>
          <div>{defAddr.postal_code} {defAddr.country}</div>
        </div>
      ) : (
        <div style={{ color: '#b00' }}>ยังไม่ได้ตั้งที่อยู่ค่าเริ่มต้น</div>
      )}

      <div style={{ marginTop: 8 }}>
        <button onClick={() => setOpenPicker(v => !v)}>
          {openPicker ? 'ซ่อนรายการที่อยู่ทั้งหมด' : 'เลือกที่อยู่อื่น'}
        </button>
      </div>

      {openPicker && (
        <div style={{ marginTop: 8 }}>
          {list.map(a => (
            <div key={a.address_id}
                 style={{ padding: 8, border: '1px solid #eee', marginBottom: 6, borderRadius: 6 }}>
              <div><b>{a.recipient_name}</b> ({a.phone || '-'}) {a.is_default ? '✅' : ''}</div>
              <div>{a.line1}{a.line2 ? `, ${a.line2}` : ''}</div>
              <div>{[a.subdistrict, a.district, a.province].filter(Boolean).join(', ')}</div>
              <div>{a.postal_code} {a.country}</div>
              <div style={{ marginTop: 6 }}>
                <button onClick={() => { setDefAddr(a); setOpenPicker(false); onSelect && onSelect(a); }}>
                  ใช้ที่อยู่นี้
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
