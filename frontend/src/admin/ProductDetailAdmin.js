import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, mediaSrc } from "../lib/api";
import "./product-detail-admin.css";

export default function ProductDetailAdmin() {
  const { id } = useParams();
  const [product, setProduct] = useState(null);
  const [images, setImages] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        // ✅ โหลดข้อมูลสินค้า
        const pRes = await api.get(`/api/admin/products/${id}`);
        setProduct(pRes.data);
        setImages(pRes.data.images || pRes.data.product_images || []);

        // ✅ โหลดข้อมูลสต็อกแต่ละล็อต
        try {
          const inv = await api.get(`/api/inventory?product_id=${id}`);
          if (Array.isArray(inv.data)) setStocks(inv.data);
          else if (Array.isArray(inv.data.items)) setStocks(inv.data.items);
        } catch (err) {
          console.warn("ไม่มีข้อมูลสต็อก:", err);
        }

        // ✅ โหลดข้อมูลยอดขาย
        try {
          const sale = await api.get(`/api/admin/orders?product_id=${id}`);
          if (Array.isArray(sale.data)) setSales(sale.data);
          else if (Array.isArray(sale.data.items)) setSales(sale.data.items);
        } catch (err) {
          console.warn("ไม่มีข้อมูลยอดขาย:", err);
        }
      } catch (err) {
        console.error(err);
        alert("❌ โหลดข้อมูลไม่สำเร็จ");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <div className="pd-wrapper"><p>⏳ กำลังโหลด...</p></div>;
  if (!product) return <div className="pd-wrapper"><p>❌ ไม่พบสินค้า</p></div>;

  // คำนวณกำไรรวม
  const totalProfit = sales.reduce((sum, s) => sum + (Number(s.profit || 0)), 0);

  return (
    <div className="pd-wrapper">
      <div className="pd-card">
        <h1 className="pd-title">{product.product_name}</h1>
        <p className="pd-subtitle">{product.category_name} / {product.subcategory_name}</p>

        {/* 🎞 รูปภาพแบบเลื่อน */}
        <div className="pd-gallery">
          <div className="pd-scroll">
            {images.length > 0 ? (
              images.map((im, i) => (
                <img key={i} src={mediaSrc(im.url || im.path)} alt="product" />
              ))
            ) : (
              <div className="pd-placeholder">ไม่มีรูปภาพ</div>
            )}
          </div>
        </div>

        {/* 📋 ข้อมูลสินค้า */}
        <div className="pd-info">
          <div><strong>หมวดหมู่:</strong> {product.category_name}</div>
          <div><strong>ราคาซื้อ:</strong> ฿{product.cost_price ?? "-"}</div>
          <div><strong>ราคาขาย:</strong> ฿{product.price ?? "-"}</div>
          <div><strong>สต็อกคงเหลือรวม:</strong> {product.live_stock ?? product.stock ?? 0}</div>
          <div><strong>หน่วย:</strong> {product.product_unit_name}</div>
          <div><strong>สถานะ:</strong> {product.product_status_name}</div>
          <div><strong>ต้นกำเนิด:</strong> {product.origin || "-"}</div>
          <div><strong>รายละเอียด:</strong><br />{product.description || "ไม่มีรายละเอียด"}</div>
        </div>

        {/* 🧩 รุ่นย่อย */}
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
                    <td>฿{v.price ?? "-"}</td>
                    <td>{v.stock ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 📦 รายละเอียดสต็อกแต่ละล็อต */}
        {stocks.length > 0 && (
          <div className="pd-section">
            <h3>รายละเอียดสต็อกแต่ละล็อต</h3>
            <table className="pd-table">
              <thead>
                <tr>
                  <th>วันที่รับเข้า</th>
                  <th>ล็อต</th>
                  <th>จำนวนรับเข้า</th>
                  <th>ขายไป</th>
                  <th>คงเหลือ</th>
                  <th>ราคาทุน</th>
                  <th>กำไรต่อหน่วย</th>
                  <th>รวมกำไร</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s, i) => {
                  const profit = (s.selling_price - s.cost_price) * s.qty_remaining;
                  return (
                    <tr key={i}>
                      <td>{new Date(s.created_at).toLocaleDateString()}</td>
                      <td>{s.lot_code || "-"}</td>
                      <td>{s.qty_in ?? 0}</td>
                      <td>{s.qty_out ?? 0}</td>
                      <td>{s.qty_remaining ?? 0}</td>
                      <td>฿{s.cost_price ?? "-"}</td>
                      <td>฿{(s.selling_price - s.cost_price) || "-"}</td>
                      <td>฿{profit ?? "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 💰 ประวัติการขาย */}
        {sales.length > 0 && (
          <div className="pd-section">
            <h3>ประวัติการขายสินค้า</h3>
            <table className="pd-table">
              <thead>
                <tr><th>วันที่</th><th>คำสั่งซื้อ</th><th>จำนวน</th><th>ยอดขาย</th><th>กำไร</th></tr>
              </thead>
              <tbody>
                {sales.map((o, i) => (
                  <tr key={i}>
                    <td>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td>{o.order_id || o.id}</td>
                    <td>{o.total_qty || o.quantity || "-"}</td>
                    <td>฿{o.total_price || o.grand_total}</td>
                    <td>฿{o.profit ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><th colSpan="4">รวมกำไรทั้งหมด</th><th>฿{totalProfit}</th></tr>
              </tfoot>
            </table>
          </div>
        )}

        <Link to="/admin/products/all" className="pd-back">⬅ กลับไปหน้าสินค้าทั้งหมด</Link>
      </div>
    </div>
  );
}
