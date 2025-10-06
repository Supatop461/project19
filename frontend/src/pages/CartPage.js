// src/pages/CartPage.js
import React, { useEffect, useState } from "react";
import "./CartPage.css";
import { Link } from "react-router-dom";
import {
  getCart, updateQty, removeItem, clearCart, getTotal, CART_EVENT
} from "../lib/cart";

export default function CartPage() {
  const [items, setItems] = useState(getCart());
  const [total, setTotal] = useState(getTotal());

  useEffect(() => {
    const onChanged = () => { setItems(getCart()); setTotal(getTotal()); };
    window.addEventListener(CART_EVENT, onChanged);
    return () => window.removeEventListener(CART_EVENT, onChanged);
  }, []);

  const onQty = (id, q, variantId = null) => {
    updateQty(id, q, variantId);
    setItems(getCart()); setTotal(getTotal());
  };

  const onRemove = (id, variantId = null) => {
    // ✅ แก้: ใช้ window.confirm แทน confirm
    if (window.confirm("ลบสินค้านี้ออกจากตะกร้า?")) {
      removeItem(id, variantId);
      setItems(getCart()); setTotal(getTotal());
    }
  };

  const onClear = () => {
    // ✅ แก้: ใช้ window.confirm แทน confirm
    if (window.confirm("ล้างตะกร้าทั้งหมด?")) {
      clearCart(); setItems([]); setTotal(0);
    }
  };

  if (!items.length) {
    return (
      <div className="cart-page">
        <h2>🛒 ตะกร้าสินค้า</h2>
        <div className="empty-cart">
          <p>ตะกร้าของคุณยังว่าง</p>
          <Link to="/plants" className="btn-primary">เลือกซื้อสินค้า</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cart-page">
      <h2>🛒 ตะกร้าสินค้า</h2>

      <table className="cart-table">
        <thead>
          <tr>
            <th>สินค้า</th>
            <th>ราคา</th>
            <th>จำนวน</th>
            <th>รวม</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const imgSrc =
              it.img || it.image || it.thumbnail ||
              (Array.isArray(it.images) ? it.images[0] : "") ||
              process.env.PUBLIC_URL + "/logo.png";
            const qty = Number(it.quantity || 1);
            const price = Number(it.price || 0);
            return (
              <tr key={`${it.id}::${it.variantId ?? ''}`}>
                <td className="cart-product">
                  <img src={imgSrc} alt={it.name} />
                  <div className="p-info">
                    <div className="p-name">{ it.name }</div>
                    {it.variantId && <div className="p-variant">ตัวเลือก: {it.variantId}</div>}
                  </div>
                </td>
                <td>{price.toLocaleString()} บาท</td>
                <td>
                  <div className="cart-actions">
                    <button onClick={() => onQty(it.id, Math.max(1, qty - 1), it.variantId)}>-</button>
                    <span>{qty}</span>
                    <button onClick={() => onQty(it.id, qty + 1, it.variantId)}>+</button>
                  </div>
                </td>
                <td className="cart-total">{(price * qty).toLocaleString()} บาท</td>
                <td>
                  <button className="remove-btn" onClick={() => onRemove(it.id, it.variantId)}>🗑</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="cart-footer">
        <div className="cart-left">
          <Link to="/plants" className="btn-outline">← เลือกซื้อสินค้าต่อ</Link>
          <button className="btn-ghost" onClick={onClear}>ล้างตะกร้า</button>
        </div>
        <div className="cart-right">
          <div className="summary-row">
            <span>ยอดรวมสินค้า</span>
            <span>{total.toLocaleString()} บาท</span>
          </div>
          <div className="summary-row grand">
            <span>ชำระทั้งหมด</span>
            <span>{total.toLocaleString()} บาท</span>
          </div>
          <button className="btn-primary" onClick={() => alert("ไปหน้าชำระเงิน (TODO)")}>
            ดำเนินการชำระเงิน →
          </button>
        </div>
      </div>
    </div>
  );
}
