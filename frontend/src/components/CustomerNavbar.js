// src/components/CustomerNavbar.jsx
import React, { useState } from "react";
import { Link } from "react-router-dom";
import ProfileModal from "../pages/ProfileModal"; // ใช้ Modal ที่คุณมีแล้ว
import "./CustomerNavbar.css";

export default function CustomerNavbar({ user }) {
  const [showProfile, setShowProfile] = useState(false);
  const [initialTab, setInitialTab] = useState("profile");

  const openProfile = (tab = "profile") => {
    setInitialTab(tab);
    setShowProfile(true);
  };

  return (
    <>
      <header className="cm-header">
        {/* ด้านซ้าย: โลโก้ + เมนู */}
        <div className="cm-left">
          <Link to="/" className="cm-logo">
            PRACH MAEJO
          </Link>
          <nav className="cm-nav">
            <Link to="/category/plants">ต้นไม้</Link>
            <Link to="/category/tools">อุปกรณ์</Link>
            <Link to="/contact">ติดต่อเรา</Link>
          </nav>
        </div>

        {/* ตรงกลาง: ช่องค้นหา */}
        <div className="cm-center">
          <form className="cm-search" onSubmit={(e) => e.preventDefault()}>
            <input type="text" placeholder="ค้นหาสินค้า" />
            <button type="submit" className="cm-search-btn" aria-label="ค้นหา">
              🔍
            </button>
          </form>
        </div>

        {/* ด้านขวา: ไอคอนต่าง ๆ */}
        <div className="cm-right">
          <Link to="/cart" className="cm-icon-link" title="ตะกร้าสินค้า">
            🛒
          </Link>

          {/* ปุ่มประวัติคำสั่งซื้อ → เปิด Modal แท็บ orders */}
          <button
            className="cm-icon-link"
            title="ประวัติคำสั่งซื้อ"
            onClick={() => openProfile("orders")}
          >
            📑
          </button>

          {/* Avatar + ชื่อ → เปิด Modal แท็บ profile */}
          <button className="cm-profile" onClick={() => openProfile("profile")}>
            <img
              src={user?.avatar || "/default-avatar.png"}
              alt="avatar"
              className="cm-avatar"
            />
            <span className="cm-hello">
              สวัสดี, {user?.fullname || "ผู้ใช้งาน"}
            </span>
          </button>
        </div>
      </header>

      {/* แสดง ProfileModal */}
      {showProfile && (
        <ProfileModal
          initialTab={initialTab}
          onClose={() => setShowProfile(false)}
        />
      )}
    </>
  );
}
