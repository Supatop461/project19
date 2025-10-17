import React, { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import "./AdminLayout.css";
import { getNewOrdersCount } from "../lib/api";

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [newOrders, setNewOrders] = useState(0);
  const lastCheckRef = useRef(null);

  const m = location.pathname.match(/\/admin\/products\/([^/]+)/);
  const pid = m ? m[1] : null;
  const currentProductId = pid && pid !== "all" && pid !== "new" ? pid : null;

  // ✅ กลุ่มเมนู
  const menuGroups = [
    {
      title: "ภาพรวมระบบ",
      items: [{ label: "Dashboard", icon: "📊", path: "/admin", exact: true }],
    },
    {
      title: "การจัดการสินค้า",
      items: [
        { label: "เพิ่มและจัดการสินค้า", icon: "📦", path: "/admin/products" },
        { label: "สินค้าทั้งหมด", icon: "🗃️", path: "/admin/products/all" },
        { label: "ประเภท", icon: "📂", path: "/admin/categories" },
        { label: "หมวดย่อย", icon: "🗂️", path: "/admin/subcategories" },
        { label: "หน่วยสินค้า", icon: "📏", path: "/admin/units" },
        { label: "หน่วยขนาด", icon: "📐", path: "/admin/sizes" },
      ],
    },
    {
      title: "คลังและคำสั่งซื้อ",
      items: [
        { label: "สินค้าคงคลัง", icon: "🏬", path: "/admin/inventory" },
        { label: "คำสั่งซื้อ", icon: "🧾", path: "/admin/orders", badge: true },
        { label: "สรุปยอดขาย", icon: "💰", path: "/admin/reports" },
      ],
    },
    {
      title: "ระบบผู้ใช้",
      items: [
        { label: "ผู้ใช้/สิทธิ์", icon: "👤", path: "/admin/user-management" },
      ],
    },
  ];

  const [openGroups, setOpenGroups] = useState(() =>
    Object.fromEntries(menuGroups.map((g) => [g.title, true]))
  );

  const toggleGroup = (title) =>
    setOpenGroups((prev) => ({ ...prev, [title]: !prev[title] }));

  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    navigate("/login?role=admin");
  };

  // ✅ Polling สำหรับ badge "NEW"
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
      <aside className="admin-sidebar">
        <div className="sidebar-header">🌿 ADMIN</div>
        <nav className="sidebar-nav">
          {menuGroups.map((group) => (
            <div key={group.title} className="menu-group">
              <button
                className="menu-title-btn"
                onClick={() => toggleGroup(group.title)}
              >
                <span>{group.title}</span>
                <span className="arrow">
                  {openGroups[group.title] ? "▾" : "▸"}
                </span>
              </button>

              {openGroups[group.title] && (
                <div className="menu-items">
                  {group.items.map((m) => (
                    <NavLink
                      key={m.path}
                      to={m.path}
                      end={!!m.exact}
                      className={({ isActive }) =>
                        `menu-item ${isActive ? "active" : ""}`
                      }
                    >
                      <div className="menu-label">
                        <span className="icon">{m.icon}</span>
                        {m.label}
                      </div>
                      {m.badge && newOrders > 0 && (
                        <span className="badge-new">NEW ({newOrders})</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}

          {currentProductId && (
            <NavLink
              to={`/admin/products/${currentProductId}/variants`}
              className={({ isActive }) =>
                `menu-item variant-link ${isActive ? "active" : ""}`
              }
            >
              <span className="icon">🎛️</span>
              ตัวเลือก/Variants (สินค้านี้)
            </NavLink>
          )}
        </nav>

        <button className="logout-btn" onClick={logout}>
          🚪 ออกจากระบบ
        </button>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
