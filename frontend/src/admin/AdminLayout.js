// src/admin/AdminLayout.js
import React, { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import "./AdminLayout.css";
import { getNewOrdersCount } from "../lib/api"; // ✅ ใช้ helper ที่คุณใส่ไว้ใน api.js แล้ว

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const [newOrders, setNewOrders] = useState(0);
  const lastCheckRef = useRef(null);

  // ดึง productId ปัจจุบันจากพาธ
  const match = location.pathname.match(/\/admin\/products\/(\d+)/);
  const currentProductId = match ? match[1] : null;

  const menus = [
    { label: "Dashboard",     icon: "📊", path: "/admin" },
    { label: "จัดการสินค้า",   icon: "📦", path: "/admin/products" },
    { label: "ประเภท",         icon: "📂", path: "/admin/categories" },
    { label: "หมวดย่อย",       icon: "🗂️", path: "/admin/subcategories" },
    { label: "หน่วยสินค้า",     icon: "📏", path: "/admin/units" },
    { label: "หน่วยขนาด",      icon: "📐", path: "/admin/sizes" },
    { label: "สินค้าคงคลัง",   icon: "🏬", path: "/admin/inventory" },
    { label: "คำสั่งซื้อ",      icon: "🧾", path: "/admin/orders", badge: true },
    { label: "สรุปยอดขาย",     icon: "💰", path: "/admin/reports" },
     { label: "ผู้ใช้/สิทธิ์",    icon: "👤", path: "/admin/user-management" },
  ];

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    navigate("/login?role=admin");
  };

  // ✅ Polling สำหรับ badge NEW (x)
  useEffect(() => {
    let alive = true;

    async function tick() {
      try {
        const count = await getNewOrdersCount({
          updatedSince: lastCheckRef.current || null,
        });
        if (!alive) return;
        setNewOrders(count);
        lastCheckRef.current = new Date().toISOString();
      } catch {}
    }

    tick();
    const id = setInterval(tick, 30_000);

    // ฟังสัญญาณจาก OrderManagement
    function onOrdersSignal(ev) {
      if (ev?.detail === "orders:refreshed") tick();
    }
    window.addEventListener("orders:signal", onOrdersSignal);

    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("orders:signal", onOrdersSignal);
    };
  }, []);

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-lg flex flex-col">
        <div className="p-4 text-2xl font-bold border-b">🌿 ADMIN</div>
        <nav className="flex-1 p-4 flex flex-col gap-2">
          {menus.map((m, i) => (
            <NavLink
              key={i}
              to={m.path}
              end={m.path === "/admin"}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg ${
                  isActive ? "bg-green-500 text-white" : "hover:bg-green-100"
                }`
              }
            >
              <div>
                <span className="mr-2">{m.icon}</span>
                {m.label}
              </div>
              {/* ✅ Badge เฉพาะเมนู Orders */}
              {m.badge && newOrders > 0 && (
                <span className="badge-new">NEW ({newOrders})</span>
              )}
            </NavLink>
          ))}

          {/* 🟢 ลิงก์ไดนามิกไปหน้า Variants */}
          {currentProductId && (
            <NavLink
              to={`/admin/products/${currentProductId}/variants`}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg mt-2 ${
                  isActive ? "bg-green-600 text-white" : "bg-green-50 hover:bg-green-100"
                }`
              }
              title={`ตัวเลือก/Variants ของสินค้า #${currentProductId}`}
            >
              <span className="mr-2">🎛️</span>
              ตัวเลือก/Variants (สินค้านี้)
            </NavLink>
          )}
        </nav>
        <button
          className="m-4 px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600"
          onClick={logout}
        >
          🚪 ออกจากระบบ
        </button>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
