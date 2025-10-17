import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, mediaSrc } from "../lib/api";
import "./product-detail-admin.css";


export default function ProductDetailAdmin() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [stockHistory, setStockHistory] = useState([]);
  const [salesHistory, setSalesHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAll = async () => {
      try {
        // ✅ โหลดข้อมูลสินค้า
        const pRes = await api.get(`/api/admin/products/${id}`);
        setProduct(pRes.data);

        // ✅ โหลดประวัติสต็อก
        try {
          const invRes = await api.get(`/api/inventory?scope=variant&product_id=${id}`);
          if (Array.isArray(invRes.data)) setStockHistory(invRes.data);
          else if (Array.isArray(invRes.data.items)) setStockHistory(invRes.data.items);
        } catch (err) {
          console.warn("ไม่มีข้อมูลสต็อก:", err);
        }

        // ✅ โหลดประวัติการขาย
        try {
          const saleRes = await api.get(`/api/admin/orders?product_id=${id}`);
          if (Array.isArray(saleRes.data)) setSalesHistory(saleRes.data);
          else if (Array.isArray(saleRes.data.items)) setSalesHistory(saleRes.data.items);
        } catch (err) {
          console.warn("ไม่มีข้อมูลคำสั่งซื้อ:", err);
        }
      } catch (err) {
        console.error("โหลดสินค้าไม่สำเร็จ:", err);
        alert("โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    loadAll();
  }, [id]);

  if (loading) return <div className="pd-wrapper"><p>⏳ กำลังโหลดข้อมูล...</p></div>;
  if (!product) return <div className="pd-wrapper"><p>❌ ไม่พบข้อมูลสินค้า</p></div>;

  const img = mediaSrc(product.image_url || product.cover_url);

  return (
    <div className="pd-wrapper">
      <div className="pd-card">
        <h2>{product.product_name}</h2>
        <img src={img} alt={product.product_name} className="pd-img" />

        <div className="pd-info">
          <p><strong>หมวดหมู่:</strong> {product.category_name} / {product.subcategory_name}</p>
          <p><strong>ราคา:</strong> ฿{product.price}</p>
          <p><strong>สต็อกคงเหลือ:</strong> {product.live_stock ?? product.stock ?? 0}</p>
          <p><strong>หน่วย:</strong> {product.product_unit_name}</p>
          <p><strong>สถานะ:</strong> {product.product_status_name}</p>
          <p><strong>ต้นกำเนิด:</strong> {product.origin || "-"}</p>
          <p><strong>รายละเอียด:</strong><br />{product.description || "ไม่มีรายละเอียด"}</p>
        </div>

        {/* 🧾 รุ่นย่อย */}
        {Array.isArray(product.variants) && product.variants.length > 0 && (
          <div className="pd-section">
            <h3>รุ่นย่อย (Variants)</h3>
            <table className="pd-table">
              <thead>
                <tr><th>SKU</th><th>ชื่อรุ่น</th><th>ราคา</th><th>สต็อก</th></tr>
              </thead>
              <tbody>
                {product.variants.map((v) => (
                  <tr key={v.variant_id}>
                    <td>{v.sku}</td>
                    <td>{v.variant_name || "-"}</td>
                    <td>{v.price ?? "-"}</td>
                    <td>{v.stock ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 📦 ประวัติสต็อก */}
        {stockHistory.length > 0 && (
          <div className="pd-section">
            <h3>ประวัติการเคลื่อนไหวสต็อก</h3>
            <table className="pd-table">
              <thead>
                <tr><th>วันที่</th><th>ประเภท</th><th>จำนวน</th><th>สินค้า/รุ่น</th><th>หมายเหตุ</th></tr>
              </thead>
              <tbody>
                {stockHistory.map((s, i) => (
                  <tr key={i}>
                    <td>{new Date(s.created_at).toLocaleString()}</td>
                    <td>{s.move_type || s.type}</td>
                    <td>{s.qty_change || s.quantity}</td>
                    <td>{s.variant_sku || s.product_name}</td>
                    <td>{s.note || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 💰 ประวัติการขาย */}
        {salesHistory.length > 0 && (
          <div className="pd-section">
            <h3>ประวัติการขายสินค้า</h3>
            <table className="pd-table">
              <thead>
                <tr><th>วันที่สั่งซื้อ</th><th>เลขที่คำสั่งซื้อ</th><th>จำนวน</th><th>ราคารวม</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {salesHistory.map((o, i) => (
                  <tr key={i}>
                    <td>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td>{o.order_id || o.id}</td>
                    <td>{o.total_qty || o.quantity || "-"}</td>
                    <td>฿{o.total_price || o.grand_total}</td>
                    <td>{o.status || o.order_status_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Link to="/admin/products/all" className="pd-back">⬅ กลับไปหน้าสินค้าทั้งหมด</Link>
      </div>
    </div>
  );
}
