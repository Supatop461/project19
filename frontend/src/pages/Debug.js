// [FRONTEND] src/pages/Debug.js
import React, { useState } from 'react';
import axios from 'axios';

export default function DebugPage(){
  const [out, setOut] = useState('');
  const [err, setErr] = useState('');

  async function pingHealth(){
    setOut(''); setErr('');
    try {
      const r = await axios.get('/_health');ผ
      setOut(JSON.stringify(r.data, null, 2));
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }

  async function loadCategories(){
    setOut(''); setErr('');
    try {
      const r = await axios.get('/api/categories');
      setOut(JSON.stringify(r.data, null, 2));
    } catch (e) {
      setErr(e?.response?.data?.error || e.message);
    }
  }

  return (
    <div style={{ padding:16 }}>
      <h1>🧪 Debug</h1>
      <div style={{ display:'flex', gap:8, margin:'12px 0' }}>
        <button onClick={pingHealth}>ทดสอบ /_health</button>
        <button onClick={loadCategories}>ทดสอบ /api/categories</button>
      </div>
      {err && <div style={{ color:'crimson' }}>Error: {err}</div>}
      {out && <pre style={{ background:'#111', color:'#0f0', padding:12, borderRadius:8 }}>{out}</pre>}
    </div>
  );
}
