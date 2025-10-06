// [FRONTEND] src/App.js
import React, { useEffect } from "react";
import {
  BrowserRouter, Routes, Route, Navigate, useLocation,
} from "react-router-dom";
import axios from "axios";

import ProductManagement from "./admin/ProductManagement";
import OrderManagement   from "./admin/OrderManagement";
import VariantsManager   from "./admin/VariantsManager";
import AdminLayout       from "./admin/AdminLayout";
import Dashboard         from "./admin/Dashboard";
import ProductEditPage   from "./admin/ProductEditPage";
import InventoryPage     from "./admin/InventoryPage";

import AdminCategories    from "./admin/AdminCategories";
import AdminSubcategories from "./admin/AdminSubcategories";
import AdminUnits         from "./admin/AdminUnits";
import AdminSizes         from "./admin/AdminSizes";

import Addresses     from "./account/Addresses";
import SignUp        from "./pages/SignUp";
import Login         from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import HomeUser      from "./pages/HomeUser";

import ProductList   from "./pages/ProductList";
import Plants        from "./pages/Plants";
import Tools         from "./pages/Tools";
import CartPage      from "./pages/CartPage";

import { Toaster } from "react-hot-toast";

// 🟢 Header บนทุกหน้า
import HeaderClassic from "./components/HeaderClassic";

/* ================== ตั้งค่า API BASE ทั้งแอป (no import.meta) ================== */
const pickApiBase = () => {
  if (axios.defaults?.baseURL) return axios.defaults.baseURL;                 // ถ้าถูกตั้งไว้ก่อนหน้า
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE; // .env ของ CRA
  return "http://localhost:3001";                                            // fallback
};
axios.defaults.baseURL = pickApiBase();
/* ====================================================================== */

/* ====================== Helpers ====================== */
const getToken = () => localStorage.getItem("token") || "";
const getRole  = () => (localStorage.getItem("role") || "").toLowerCase();
const isAdminRole = (r) =>
  ["admin", "staff", "superadmin"].includes(String(r || "").toLowerCase());

const bootToken = getToken();
if (bootToken) axios.defaults.headers.common["Authorization"] = `Bearer ${bootToken}`;

/* ==================== ErrorBoundary =================== */
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(error) { return { err: error }; }
  componentDidCatch(error, info) { console.error("UI error:", error, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16 }}>
          <h2>เกิดข้อผิดพลาดในหน้า</h2>
          <pre
            style={{
              background: "#111",
              color: "#0f0",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
            }}
          >
{String(this.state.err?.message || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
/* ===================================================== */

/* ====================== Guards ======================== */
function RequireAuth({ children }) {
  const loc = useLocation();
  if (!getToken()) {
    const redirect = encodeURIComponent(loc.pathname + loc.search);
    return (
      <Navigate
        to={`/login?redirect=${redirect}&msg=login_required`}
        replace
      />
    );
  }
  return children;
}

function RequireAdmin({ children }) {
  const loc = useLocation();
  if (!getToken()) {
    const redirect = encodeURIComponent(loc.pathname + loc.search);
    return (
      <Navigate
        to={`/login?redirect=${redirect}&msg=login_required`}
        replace
      />
    );
  }
  if (!isAdminRole(getRole())) return <Navigate to="/" replace />;
  return children;
}
/* ===================================================== */

/* ======================== App ========================= */
export default function App() {
  useEffect(() => {
    const t = getToken();
    if (t) axios.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  }, []);

  return (
    <BrowserRouter>
      <ErrorBoundary>
        {/* ✅ Header + Toaster แสดงบนทุกหน้า */}
        <HeaderClassic />
        <Toaster position="top-right" />

        <Routes>
          {/* ✅ หน้าแรก */}
          <Route path="/" element={<HomeUser />} />
          <Route path="/home-user" element={<Navigate to="/" replace />} />

          {/* ✅ Landing ต้นไม้/อุปกรณ์ + รายการสินค้า */}
          <Route path="/plants" element={<Plants />} />
          <Route path="/tools" element={<Tools />} />
          <Route path="/products" element={<ProductList />} />

          {/* ✅ ตะกร้าสินค้า */}
          <Route path="/cart" element={<CartPage />} />

          {/* ✅ ต้องล็อกอิน */}
          <Route
            path="/account/addresses"
            element={
              <RequireAuth>
                <Addresses />
              </RequireAuth>
            }
          />

          {/* ✅ แอดมิน (ครอบด้วย AdminLayout + RequireAdmin) */}
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="products" element={<ProductManagement />} />
            <Route path="products/:id" element={<ProductEditPage />} />

            {/* 🟢 เส้นทาง Variants (รองรับทั้ง :productId และ :id) */}
            <Route path="products/:productId/variants" element={<VariantsManager />} />
            <Route path="products/:id/variants"        element={<VariantsManager />} />

            <Route path="orders" element={<OrderManagement />} />

            {/* ✅ 4 หน้าใหม่ */}
            <Route path="categories"    element={<AdminCategories />} />
            <Route path="subcategories" element={<AdminSubcategories />} />
            <Route path="units"         element={<AdminUnits />} />
            <Route path="sizes"         element={<AdminSizes />} />

            {/* 🟢 Inventory (ของจริง) */}
            <Route path="inventory" element={<InventoryPage />} />
          </Route> {/* ← ปิดบล็อก /admin ให้เรียบร้อย */}

          {/* ✅ Auth (PUBLIC) */}
          <Route path="/login" element={<Login />} />
          {/* ⭐ รองรับทั้ง /signup และ /register */}
          <Route path="/signup" element={<SignUp />} />
          <Route path="/register" element={<SignUp />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* 404 → หน้าแรก */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
