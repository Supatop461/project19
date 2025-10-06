// FRONTEND: src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import axios from 'axios';

/* =========================
   1) Axios Global Config อ่านนะ
   ========================= */
// ❗ เปลี่ยน default เป็นโดเมนอย่างเดียว (ไม่มี /api)
// จากนี้ endpoint ทุกที่ในโปรเจกต์ ให้ขึ้นต้นด้วย /api/...
const API_BASE = (
  process.env.REACT_APP_API_BASE ||
  process.env.REACT_APP_API_BASEURL ||
  'http://localhost:3001'
).replace(/\/+$/, ''); // ตัด "/" ท้าย ป้องกัน // ซ้อน

axios.defaults.baseURL = API_BASE;
axios.defaults.timeout = 10000; // กันรีเควสต์ค้างนาน

// แนบ token ตั้งแต่บูต (กรณีเคยล็อกอินไว้)
const bootToken = localStorage.getItem('token');
if (bootToken) {
  axios.defaults.headers.common['Authorization'] = `Bearer ${bootToken}`;
}

/* =========================
   2) Interceptors (แนะนำให้มี)
   ========================= */
const IS_DEV = process.env.NODE_ENV !== 'production';

// helper สร้าง URL ไว้โชว์ใน log
function buildUrl(cfg) {
  const b = (cfg.baseURL || '').replace(/\/+$/, '');
  const u = cfg.url || '';
  return /^https?:\/\//i.test(u) ? u : `${b}${u.startsWith('/') ? '' : '/'}${u}`;
}

// Request: อ่าน token ล่าสุดก่อนยิงทุกครั้ง + log
axios.interceptors.request.use((cfg) => {
  const t = localStorage.getItem('token'); // เผื่อ token เปลี่ยนหลังบูต
  if (t) cfg.headers.Authorization = `Bearer ${t}`;

  if (IS_DEV) {
    cfg.metadata = { start: Date.now() };
    // eslint-disable-next-line no-console
    console.log(
      '➡️',
      (cfg.method || 'GET').toUpperCase(),
      buildUrl(cfg),
      cfg.params ? { params: cfg.params } : '',
      cfg.data instanceof FormData ? '[FormData]' :
      cfg.data ? { data: cfg.data } : ''
    );
  }
  return cfg;
});

// Response: โชว์เวลา/สถานะ + จัดการ 401
axios.interceptors.response.use(
  (res) => {
    if (IS_DEV) {
      const ms = Date.now() - (res.config.metadata?.start || Date.now());
      // eslint-disable-next-line no-console
      console.log(
        '✅',
        res.status,
        (res.config.method || 'GET').toUpperCase(),
        buildUrl(res.config),
        `${ms}ms`
      );
    }
    return res;
  },
  (err) => {
    const { response, config } = err;
    if (IS_DEV && config) {
      const ms = Date.now() - (config.metadata?.start || Date.now());
      // eslint-disable-next-line no-console
      console.warn(
        '❌',
        response?.status || 'NETWORK',
        (config.method || 'GET').toUpperCase(),
        buildUrl(config),
        `${ms}ms`,
        err.message
      );
    }

    // ถ้า token หมดอายุ/ไม่ถูกต้อง
    if (response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      // ถ้าอยากเด้งไปหน้า login อัตโนมัติ เปิดบรรทัดล่าง
      // window.location.assign('/login');
    }
    return Promise.reject(err);
  }
);

/* =========================
   3) React Mount
   ========================= */
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
