// src/pages/OrderHistoryPage.jsx
import React, { useEffect, useState, useMemo } from "react";
import axios from "axios";

const API_BASE = import.meta?.env?.VITE_API_BASE || "http://localhost:3000";

export default function OrderHistoryPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const axiosClient = useMemo(() => {
    const token = localStorage.getItem("token") || "";
    return axios.create({
      baseURL: API_BASE,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 12000,
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await axiosClient.get("/api/orders/my-history");
        setItems(res.data || []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [axiosClient]);

  if (loading) return <div style={{padding:16}}>กำลังโหลดประวัติคำสั่งซื้อ…</div>;

  return (
    <div style={{maxWidth: 980, margin: "24px auto", padding: "0 12px"}}>
      <h2>ประวัติคำสั่งซื้อของฉัน</h2>
      {items.length === 0 ? (
        <p>ยังไม่มีคำสั่งซื้อ</p>
      ) : (
        <div className="orders">
          {items.map((o) => (
            <div key={o.id} className="order-card" style={{
              border:"1px solid #eee", borderRadius:12, padding:16, marginBottom:12
            }}>
              <div><b>เลขที่คำสั่งซื้อ:</b> {o.order_no || o.id}</div>
              <div><b>สถานะ:</b> {o.status}</div>
              <div><b>ยอดรวม:</b> {o.total_amount} บาท</div>
              <div><b>วันที่:</b> {new Date(o.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
