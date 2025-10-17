// [FRONTEND] src/App.js — FIX useLocation outside Router + ProductDetail route + Checkout/Orders routes
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
import AllProducts       from "./admin/AllProducts";
import ProductDetailAdmin from "./admin/ProductDetailAdmin";



import AdminCategories    from "./admin/AdminCategories";
import AdminSubcategories from "./admin/AdminSubcategories";
import AdminUnits         from "./admin/AdminUnits";
import AdminSizes         from "./admin/AdminSizes";
import UserManagement     from "./admin/UserManagement";


import Addresses     from "./account/Addresses";
import SignUp        from "./pages/SignUp";
import Login         from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import HomeUser      from "./pages/HomeUser";
import OrdersUser    from "./pages/OrdersUser";
import CheckoutPage  from "./pages/CheckoutPage";      // ✅ added

import ProductList   from "./pages/ProductList";
import Plants        from "./pages/Plants";
import Tools         from "./pages/Tools";
import CartPage      from "./pages/CartPage";
import ProductDetail from "./pages/ProductDetail";     // ✅ product detail route

import { Toaster } from "react-hot-toast";
import HeaderClassic from "./components/HeaderClassic";
import Footer from "./components/Footer";

/* ================== API BASE ================== */
const pickApiBase = () => {
  if (axios.defaults?.baseURL) return axios.defaults.baseURL;
  if (process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE;
  return "http://localhost:3001";
};
axios.defaults.baseURL = pickApiBase();
/* ============================================= */

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
          <pre style={{ background:"#111", color:"#0f0", padding:12, borderRadius:8, overflow:"auto" }}>
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
    return <Navigate to={`/login?redirect=${redirect}&msg=login_required`} replace />;
  }
  return children;
}

function RequireAdmin({ children }) {
  const loc = useLocation();
  if (!getToken()) {
    const redirect = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?redirect=${redirect}&msg=login_required`} replace />;
  }
  if (!isAdminRole(getRole())) return <Navigate to="/" replace />;
  return children;
}
/* ===================================================== */

/* ============== InnerApp (อยู่ภายใน Router) ============== */
function InnerApp() {
  const { pathname } = useLocation();                 // ✅ อยู่ใต้ Router แล้ว ปลอดภัย
  const isAdminRoute = pathname.startsWith("/admin");

  useEffect(() => {
    const t = getToken();
    if (t) axios.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  }, []);

  // ✅ ลูกค้า & guest เห็น, แอดมิน/หน้า /admin ไม่เห็น
  const role = getRole();
  const showFooter = !isAdminRoute && role !== "admin" && role !== "staff" && role !== "superadmin";

  return (
    <>
      <HeaderClassic />
      <Toaster position="top-right" />

      <Routes>
        <Route path="/" element={<HomeUser />} />
        <Route path="/home-user" element={<Navigate to="/" replace />} />

        <Route path="/plants" element={<Plants />} />
        <Route path="/tools" element={<Tools />} />
        <Route path="/products" element={<ProductList />} />
        <Route path="/products/:id" element={<ProductDetail />} />
        <Route path="/cart" element={<CartPage />} />

        {/* ✅ Checkout & Orders (ต้องล็อกอิน) */}
        <Route
          path="/checkout"
          element={
            <RequireAuth>
              <CheckoutPage />
            </RequireAuth>
          }
        />
        <Route
          path="/orders"
          element={
            <RequireAuth>
              <OrdersUser />
            </RequireAuth>
          }
        />

        <Route
          path="/account/addresses"
          element={
            <RequireAuth>
              <Addresses />
            </RequireAuth>
          }
        />

                <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminLayout />
            </RequireAdmin>
          }
        >
          <Route index element={<Dashboard />} />

          {/* ✅ ต้องวางไว้ก่อน products/:id */}
          <Route path="products/detail/:id" element={<ProductDetailAdmin />} />

          <Route path="products" element={<ProductManagement />} />
          <Route path="products/:id" element={<ProductEditPage />} />
          <Route path="products/:productId/variants" element={<VariantsManager />} />
          <Route path="products/:id/variants" element={<VariantsManager />} />
          <Route path="products/all" element={<AllProducts />} />

          <Route path="orders" element={<OrderManagement />} />
          <Route path="categories" element={<AdminCategories />} />
          <Route path="subcategories" element={<AdminSubcategories />} />
          <Route path="units" element={<AdminUnits />} />
          <Route path="sizes" element={<AdminSizes />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="user-management" element={<UserManagement />} />
        </Route>


        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/register" element={<SignUp />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {showFooter && <Footer />}
    </>
  );
}

/* ======================== App (สร้าง Router) ========================= */
export default function App() {
  // ❗ ห้ามใช้ useLocation ที่นี่ เพราะอยู่นอก Router
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <InnerApp />
      </ErrorBoundary>
    </BrowserRouter>
  );
}
