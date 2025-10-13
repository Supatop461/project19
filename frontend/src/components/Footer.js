// src/components/Footer.js
import React from "react";
import { Link } from "react-router-dom";
import "./Footer.css";

export default function Footer() {
  const year = new Date().getFullYear();

  const BRANCHES = [
    {
      name: "สาขาคลองแงะ",
      address: "ตำบลคลองแงะ อำเภอสะเดา จังหวัดสงขลา",
      phones: [{ raw: "0872898370", pretty: "087-289-8370" }],
      email: { text: "prachmaejo@gmail.com", href: "mailto:prachmaejo@gmail.com" },
      map: "https://maps.google.com/?q=ปราชญ์แม่โจ้%20พันธุ์ไม้%20คลองแงะ",
    },
    {
      name: "สาขาปริก",
      address: "ตำบลปริก อำเภอสะเดา จังหวัดสงขลา",
      phones: [{ raw: "0895482797", pretty: "089-548-2797" }],
      email: { text: "aprachmaejo@gmail.com", href: "mailto:aprachmaejo@gmail.com" },
      map: "https://maps.google.com/?q=ปราชญ์แม่โจ้%20พันธุ์ไม้%20ปริก",
    },
  ];

  const FB_PAGE = "https://www.facebook.com/pard.too79";
  const YT_PAGE =
    "https://www.youtube.com/@%E0%B8%9B%E0%B8%B2%E0%B8%94%E0%B9%81%E0%B8%A1%E0%B9%88%E0%B9%82%E0%B8%88%E0%B9%89%E0%B8%9E%E0%B8%B1%E0%B8%99%E0%B8%98%E0%B8%B8%E0%B9%8C%E0%B9%84%E0%B8%A1%E0%B9%89";
  const TIKTOK_PAGE =
    "https://www.tiktok.com/@tuwanida?is_from_webapp=1&sender_device=pc";

  return (
    <footer className="site-footer" role="contentinfo">
      <div className="footer-top">
        {/* Brand / About */}
        <div className="footer-brand">
          <h2>🌿 ปราชญ์แม่โจ้ พันธุ์ไม้</h2>
          <p>
            จำหน่ายไม้ผลพันธุ์ดี ไม้ดอก ไม้ประดับ ไม้เศรษฐกิจ และอุปกรณ์เพาะปลูกครบวงจร
            (ปุ๋ย ดินปลูก แกลบ ขุยมะพร้าว ฮอร์โมน อาหารเสริมต้นไม้ ฯลฯ)
          </p>
        </div>

        {/* Main Menu */}
        <nav className="footer-links" aria-label="เมนูหลัก">
          <h3>เมนู</h3>
          <ul>
            <li><Link to="/home-user">หน้าแรก</Link></li>
            <li><Link to="/plants">ต้นไม้</Link></li>
            <li><Link to="/tools">อุปกรณ์เพาะปลูก</Link></li>
            <li><Link to="/cart">ตะกร้าสินค้า</Link></li>
            <li><Link to="/profile">โปรไฟล์ของฉัน</Link></li>
          </ul>
        </nav>

        {/* Help */}
        <nav className="footer-help" aria-label="ช่วยเหลือ">
          <h3>ช่วยเหลือ</h3>
          <ul>
            <li><Link to="/how-to-order">วิธีสั่งซื้อ</Link></li>
            <li><Link to="/shipping">การจัดส่งสินค้า</Link></li>
            <li><Link to="/faq">คำถามที่พบบ่อย</Link></li>
            <li>
              <a href={FB_PAGE} target="_blank" rel="noreferrer" className="contact-link">
                ติดต่อร้าน (Facebook)
              </a>
            </li>
          </ul>
        </nav>

        {/* Branches */}
        <div className="footer-branches">
          <h3>สาขา</h3>
          <ul>
            {BRANCHES.map((b) => (
              <li key={b.name} className="branch">
                <div className="branch-name">{b.name}</div>
                <div className="branch-line">📍 {b.address}</div>
                <div className="branch-line">
                  📞{" "}
                  {b.phones.map((p, i) => (
                    <span key={p.raw}>
                      <a href={`tel:${p.raw}`}>{p.pretty}</a>
                      {i < b.phones.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </div>
                <div className="branch-line">
                  ✉️ <a href={b.email.href}>{b.email.text}</a>
                </div>
                <div className="branch-actions">
                  <a href={b.map} target="_blank" rel="noreferrer">ดูแผนที่</a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Social */}
      <div className="footer-social" aria-label="โซเชียลของร้าน">
        <a href={FB_PAGE} target="_blank" rel="noreferrer" aria-label="Facebook">
          <i className="fab fa-facebook-f" />
        </a>
        <a href={TIKTOK_PAGE} target="_blank" rel="noreferrer" aria-label="TikTok">
          <i className="fab fa-tiktok" />
        </a>
        <a href={YT_PAGE} target="_blank" rel="noreferrer" aria-label="YouTube">
          <i className="fab fa-youtube" />
        </a>
      </div>

      {/* Bottom */}
      <div className="footer-bottom">
        <p>© {year} ปราชญ์แม่โจ้ พันธุ์ไม้ — All rights reserved.</p>
      </div>
    </footer>
  );
}
