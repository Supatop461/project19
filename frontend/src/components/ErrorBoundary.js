// [FRONTEND] src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import axios from 'axios';
import ErrorBoundary from './components/ErrorBoundary';
import DebugPage from './pages/Debug';
import Login from './pages/Login'; // << สำคัญ: path ให้ตรงกับไฟล์ของคุณ

/* baseURL: ถ้าตั้งใน src/index.js แล้ว จะไม่ override */
const ENV_BASE = process.env.REACT_APP_API_BASE || process.env.REACT_APP_API_BASEURL || 'http://localhost:3001';
if (!axios.defaults.baseURL) {
  axios.defaults.baseURL = ENV_BASE.replace(/\/+$/, '');
}

function Navbar(){
  const linkStyle = ({ isActive }) => ({
    textDecoration:'none', padding:'6px 10px', borderRadius:8,
    background: isActive ? '#f0f0f0' : 'transparent',
  });
  return (
    <nav style={{ padding:10, display:'flex', gap:16, borderBottom:'1px solid #eee' }}>
      <NavLink to="/" style={linkStyle} end>หน้าแรก (Debug)</NavLink>
      <NavLink to="/login" style={linkStyle}>เข้าสู่ระบบ</NavLink>
      {/* ค่อยเปิดลิงก์เหล่านี้หลังจากยืนยันว่าไม่ขาวแล้ว
      <NavLink to="/admin/products" style={linkStyle}>สินค้า</NavLink>
      <NavLink to="/admin/orders" style={linkStyle}>คำสั่งซื้อ</NavLink>
      <NavLink to="/account/addresses" style={linkStyle}>ที่อยู่ของฉัน</NavLink>
      */}
    </nav>
  );
}

export default function App(){
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Navbar />
        <Routes>
          {/* เริ่มที่หน้า debug ปลอดภัยก่อน */}
          <Route path="/" element={<DebugPage />} />
          <Route path="/login" element={<Login />} />

          {/* ค่อยกลับมาเปิดเส้นทางจริงหลังตรวจแล้วไม่จอขาว
          <Route path="/admin/products" element={<ProductManagement />} />
          <Route path="/admin/orders" element={<OrderManagement />} />
          <Route path="/account/addresses" element={<Addresses />} />
          <Route path="/admin/products/:productId/variants" element={<VariantsManager />} />
          */}

          {/* route อื่น กลับหน้าแรก */}
          <Route path="*" element={<DebugPage />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
