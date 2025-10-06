// src/components/HeaderClassic.js
import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { getCount, CART_EVENT } from "../lib/cart";
import ProfileModal from "../pages/ProfileModal";

const { VITE_SIGNUP_PATH } = import.meta.env || {};
const SIGNUP_PATH =
  VITE_SIGNUP_PATH ||
  process.env.REACT_APP_SIGNUP_PATH ||
  "/signup";

export default function HeaderClassic() {
  const location = useLocation();
  const isAdminPath = location.pathname.startsWith("/admin");

  const [isAuth, setIsAuth] = useState(!!localStorage.getItem("token"));
  const [role, setRole] = useState(localStorage.getItem("role") || "");
  const [fullname, setFullname] = useState(localStorage.getItem("fullname") || "ผู้ใช้งาน");
  const [avatar, setAvatar] = useState(
    localStorage.getItem("avatar_url") || (process.env.PUBLIC_URL + "/profile.jpg")
  );

  const [cartCount, setCartCount] = useState(getCount());
  useEffect(() => {
    const onChanged = () => setCartCount(getCount());
    window.addEventListener(CART_EVENT, onChanged);
    return () => window.removeEventListener(CART_EVENT, onChanged);
  }, []);

  useEffect(() => {
    const onStorage = () => {
      setIsAuth(!!localStorage.getItem("token"));
      setRole(localStorage.getItem("role") || "");
      setFullname(localStorage.getItem("fullname") || "ผู้ใช้งาน");
      setAvatar(localStorage.getItem("avatar_url") || (process.env.PUBLIC_URL + "/profile.jpg"));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("auth:changed", onStorage);
    window.addEventListener("profile:changed", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("auth:changed", onStorage);
      window.removeEventListener("profile:changed", onStorage);
    };
  }, []);

  useEffect(() => {
    setIsAuth(!!localStorage.getItem("token"));
    setRole(localStorage.getItem("role") || "");
    setFullname(localStorage.getItem("fullname") || "ผู้ใช้งาน");
    setAvatar(localStorage.getItem("avatar_url") || (process.env.PUBLIC_URL + "/profile.jpg"));
    // eslint-disable-next-line
  }, [location.pathname]);

  const [showProfile, setShowProfile] = useState(false);
  const [initialTab, setInitialTab] = useState("profile");
  const openProfile = (tab = "profile") => {
    if (isAdminPath) return; // ห้ามเปิดในโซน Admin
    setInitialTab(tab);
    setShowProfile(true);
  };

  // ✅ ปุ่มออกจากระบบ (ใช้ได้ทั้งลูกค้าและแอดมิน)
  const logout = () => {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("fullname");
      localStorage.removeItem("avatar_url");
      setIsAuth(false);
      setRole("");
      window.dispatchEvent(new Event("auth:changed"));
    } finally {
      // ลูกค้า -> กลับหน้าแรก / แอดมิน -> ไปหน้า login แอดมิน
      window.location.href = isAdminPath ? "/admin/login" : "/";
    }
  };

  const logoHref = isAdminPath ? "/admin" : "/";

  return (
    <>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        {/* โลโก้ */}
        <Link
          to={logoHref}
          style={{ fontWeight: 700, fontSize: 20, color: "#16a34a", textDecoration: "none" }}
        >
          PRACH MAEJO
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {!isAuth ? (
            <>
              {isAdminPath ? (
                location.pathname !== "/admin/login" && <Link to="/admin/login">เข้าสู่ระบบแอดมิน</Link>
              ) : (
                <>
                  {location.pathname !== "/login" && <Link to="/login">เข้าสู่ระบบ</Link>}
                  {location.pathname !== SIGNUP_PATH && <Link to={SIGNUP_PATH}>สมัครสมาชิก</Link>}
                </>
              )}
            </>
          ) : (
            <>
              {/* ===== โซนแอดมิน: แสดงแบนเนอร์ + ปุ่มออกจากระบบ (ถ้าต้องการเอาเฉพาะแบนเนอร์ ให้ลบปุ่มออก) ===== */}
              {(isAdminPath || role === "admin") ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 14,
                      color: "#111827",
                      fontWeight: 600,
                    }}
                    aria-label="Admin Banner"
                    title="Admin"
                  >
                    👨‍💻 แอดมิน · {fullname || "Admin"}
                  </div>
                  <button
                    onClick={logout}
                    className="btn"
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff" }}
                  >
                    ออกจากระบบ
                  </button>
                </div>
              ) : (
                /* ===== โซนลูกค้า ===== */
                <>
                  {/* ตะกร้าสินค้า */}
                  <div style={{ position: "relative" }}>
                    <Link to="/cart" title="ตะกร้าสินค้า" aria-label="ตะกร้าสินค้า">🛒</Link>
                    {cartCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -10,
                          background: "#ef4444",
                          color: "#fff",
                          borderRadius: 999,
                          fontSize: 12,
                          minWidth: 18,
                          height: 18,
                          display: "grid",
                          placeItems: "center",
                          padding: "0 4px",
                        }}
                      >
                        {cartCount}
                      </span>
                    )}
                  </div>

                  {/* ประวัติคำสั่งซื้อ */}
                  <button
                    onClick={() => openProfile("orders")}
                    style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 18 }}
                    title="ประวัติคำสั่งซื้อ"
                    aria-label="ประวัติคำสั่งซื้อ"
                  >
                    📑
                  </button>

                  {/* โปรไฟล์ */}
                  <button
                    onClick={() => openProfile("profile")}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      border: "none",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                    title="โปรไฟล์"
                    aria-label="โปรไฟล์"
                  >
                    <img
                      src={avatar}
                      alt="avatar"
                      onError={(e) => (e.currentTarget.src = process.env.PUBLIC_URL + "/logo.png")}
                      style={{ width: 32, height: 32, borderRadius: 999, objectFit: "cover" }}
                    />
                    <span>{fullname}</span>
                  </button>

                  {/* ✅ ปุ่มออกจากระบบ (ลูกค้า) */}
                  <button
                    onClick={logout}
                    className="btn"
                    style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff" }}
                    aria-label="ออกจากระบบ"
                    title="ออกจากระบบ"
                  >
                    ออกจากระบบ
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </header>

      {/* ProfileModal เฉพาะเวลาล็อกอินและไม่ใช่โซน Admin */}
      {isAuth && !isAdminPath && showProfile && (
        <ProfileModal
          initialTab={initialTab}
          onClose={() => {
            setShowProfile(false);
            setFullname(localStorage.getItem("fullname") || "ผู้ใช้งาน");
            setAvatar(localStorage.getItem("avatar_url") || (process.env.PUBLIC_URL + "/profile.jpg"));
            window.dispatchEvent(new Event("profile:changed"));
          }}
        />
      )}
    </>
  );
}
