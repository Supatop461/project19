// backend/lib/emailTemplates.js

function formatBaht(n) {
  const v = Number(n || 0);
  return v.toLocaleString('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 });
}
function formatDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}
function buildItemsTable(items = []) {
  const rows = items.map(it => `
    <tr>
      <td style="padding:6px;border:1px solid #ddd;">${it.product_name || it.name}</td>
      <td style="padding:6px;border:1px solid #ddd;text-align:center;">${it.qty || it.quantity}</td>
      <td style="padding:6px;border:1px solid #ddd;text-align:right;">${formatBaht(it.price || it.unit_price)}</td>
    </tr>`).join('');
  return `
    <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:10px 0;">
      <thead><tr style="background:#f8fafc;">
        <th style="padding:6px;border:1px solid #ddd;">สินค้า</th>
        <th style="padding:6px;border:1px solid #ddd;">จำนวน</th>
        <th style="padding:6px;border:1px solid #ddd;">ราคา</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* 1) Order Confirmation (ลูกค้า) */
function buildOrderConfirmation({ order_id, order_date, total_amount, items, customer_name, order_link }) {
  const subject = `ยืนยันคำสั่งซื้อ #${order_id}`;
  const html = `
    <h2>สวัสดีคุณ ${customer_name || ''}</h2>
    <p>ขอบคุณสำหรับการสั่งซื้อ หมายเลข <b>#${order_id}</b> วันที่ ${formatDate(order_date)}</p>
    ${buildItemsTable(items)}
    <p><b>รวมทั้งหมด: ${formatBaht(total_amount)}</b></p>
    <p><a href="${order_link}">ดูคำสั่งซื้อ</a></p>
  `;
  return { subject, html };
}

/* 2) Order Status Updated (ลูกค้า) */
function buildOrderStatusUpdated({ order_id, order_date, status_name, total_amount, items, shipping_carrier, tracking_number, order_link }) {
  const subject = `อัปเดตสถานะ #${order_id} → ${status_name}`;
  const html = `
    <h2>สถานะใหม่: ${status_name}</h2>
    <p>คำสั่งซื้อ #${order_id} วันที่ ${formatDate(order_date)}</p>
    ${buildItemsTable(items)}
    <p><b>รวมทั้งหมด: ${formatBaht(total_amount)}</b></p>
    ${tracking_number ? `<p>ขนส่ง: ${shipping_carrier || '-'} / เลขพัสดุ: ${tracking_number}</p>` : ''}
    <p><a href="${order_link}">ดูคำสั่งซื้อ</a></p>
  `;
  return { subject, html };
}

/* 3) New Order (Admin) */
function buildNewOrderAdmin({ order_id, customer_name, customer_email, total_amount, admin_order_link }) {
  const subject = `มีคำสั่งซื้อใหม่ #${order_id}`;
  const html = `
    <h2>🛒 คำสั่งซื้อใหม่</h2>
    <p>ลูกค้า: ${customer_name || '-'} (${customer_email || '-'})</p>
    <p><b>รวมทั้งหมด: ${formatBaht(total_amount)}</b></p>
    <p><a href="${admin_order_link}">เปิดในระบบแอดมิน</a></p>
  `;
  return { subject, html };
}

module.exports = {
  buildOrderConfirmation,
  buildOrderStatusUpdated,
  buildNewOrderAdmin,
};
