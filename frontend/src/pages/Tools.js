// src/pages/Tools.js
import React from "react";
import { Link } from "react-router-dom";
import "./Tools.css";

export default function Tools() {
  // ✅ หมวดย่อยของ "อุปกรณ์เพาะปลูก"
  const subcats = [
    {
      slug: "soil",
      name: "วัสดุปลูก/ปรับปรุงดิน",
      img: process.env.PUBLIC_URL + "/tools2.jpg",
    },
    {
      slug: "pot",
      name: "กระถาง",
      img: process.env.PUBLIC_URL + "/pot.jpg",
    },
    {
      slug: "bag",
      name: "ถุงเพาะ",
      img: process.env.PUBLIC_URL + "/bag.jpg",
    },
  ];

  const buildLink = (s) => `/products?category=tools&sub=${encodeURIComponent(s)}`;

  return (
    <div className="plants-page">
      {/* breadcrumb */}
      <nav className="breadcrumb">
        <Link to="/" className="crumb">หน้าแรก</Link>
        <span className="sep">›</span>
        <span className="crumb current">อุปกรณ์</span>
      </nav>

      {/* hero */}
      <header className="plants-hero">
        <h1>เลือกหมวดย่อยของ <span className="hl">อุปกรณ์</span></h1>
        <p className="sub">เลือกประเภทอุปกรณ์เพื่อดูรายการสินค้าที่เกี่ยวข้อง</p>
      </header>

      {/* cards */}
      <section className="plants-categories">
        {subcats.map((c) => (
          <Link key={c.slug} to={buildLink(c.slug)} className="plant-card" aria-label={c.name}>
            <div className="thumb">
              <img
                src={c.img}
                alt={c.name}
                onError={(e) => (e.currentTarget.src = process.env.PUBLIC_URL + "/logo.png")}
              />
            </div>
            <div className="meta">
              <p className="p-name">{c.name}</p>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
