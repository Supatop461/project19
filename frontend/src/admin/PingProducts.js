// src/admin/PingProducts.js
import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function PingProducts() {
  const [state, setState] = useState({ loading: true, error: '', items: [] });

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const res = await axios.get('/api/admin/products');
        const ct = res.headers['content-type'] || '';
        if (!ct.includes('application/json')) {
          throw new Error('Expected JSON but got ' + ct);
        }
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        if (on) setState({ loading: false, error: '', items });
      } catch (e) {
        if (on) setState({ loading: false, error: e.message || 'Fetch error', items: [] });
      }
    })();
    return () => { on = false; };
  }, []);

  if (state.loading) return <div style={{ padding: 16 }}>⏳ โหลดรายการสินค้า…</div>;
  if (state.error)   return <div style={{ padding: 16, color: 'red' }}>❌ {state.error}</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2>✅ Ping Products OK</h2>
      <p>ได้ {state.items.length} รายการ</p>
      <pre style={{ background:'#f7f7f7', padding:12, borderRadius:8, maxHeight:240, overflow:'auto' }}>
        {JSON.stringify(state.items.slice(0, 3), null, 2)}
      </pre>
    </div>
  );
}
