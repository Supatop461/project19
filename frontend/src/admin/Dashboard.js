import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Tooltip, Legend, Title
} from 'chart.js';
import { Bar, Line, Pie } from 'react-chartjs-2';
import './Dashboard.css';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, ArcElement, Tooltip, Legend, Title
);

/* ----------------- Palette (คอนทราสต์ชัด อ่านง่าย) ----------------- */
const palette = {
  // เขียวหลัก (bar หลัก)
  brandFill: 'rgba(74,148,74,0.45)',   // #4a944a @ 45% (เข้มขึ้น)
  brandBorder: '#4a944a',

  // สีรองเป็นฟ้า (ให้ต่างจากเขียว)
  brandFill2: 'rgba(37,99,235,0.45)',  // #2563eb @ 45%

  // เทา (ใช้เฉพาะกราฟรวม)
  grayFill: 'rgba(107,114,128,0.25)',  // gray-500 @ 25%
  grayBorder: 'rgba(55,65,81,0.9)',    // gray-700 @ 90%

  // ชุดสีสำหรับ “หลายแท่งในชุดเดียว” และ Pie (ตัดกันชัด)
  pie: [
    'rgba(74,148,74,0.85)',   // green   #4a944a
    'rgba(37,99,235,0.85)',   // blue    #2563eb
    'rgba(245,158,11,0.90)',  // amber   #f59e0b
    'rgba(139,92,246,0.85)',  // violet  #8b5cf6
    'rgba(20,184,166,0.85)',  // teal    #14b8a6
    'rgba(239,68,68,0.90)',   // red     #ef4444
    'rgba(154,122,95,0.85)',  // soil    #9a7a5f
    'rgba(16,185,129,0.85)',  // emerald #10b981
  ]
};

// ช่วยสร้างสีต่อแท่งให้ต่างกัน และทำสีขอบเข้มขึ้นอัตโนมัติ
const bars = (n) => Array.from({ length: n }, (_, i) => palette.pie[i % palette.pie.length]);
const opaque = (rgba) =>
  rgba?.startsWith('rgba(') ? rgba.replace(/rgba\(([^)]+),\s*[^)]+\)/, 'rgba($1,1)') : rgba;

const baht = (n) => Number(n||0).toLocaleString('th-TH');

/* ----------------- Chart.js Options ----------------- */
const moneyBarOpts = {
  responsive: true, maintainAspectRatio: false,
  scales: {
    y: { ticks: { callback: v => baht(v) + ' ฿' }, grid: { color: 'rgba(107,114,128,.25)' } },
    x: { grid: { display: false } }
  },
  plugins: { legend: { display: false }, tooltip: { callbacks: {
    label: ctx => `${ctx.dataset.label}: ${baht(ctx.parsed.y)} ฿`
  } } }
};

const countBarOpts = {
  responsive: true, maintainAspectRatio: false,
  scales: {
    y: { ticks: { precision: 0 }, grid: { color: 'rgba(107,114,128,.25)' } },
    x: { grid: { display: false } }
  },
  plugins: { legend: { display: false } }
};

const pieOpts = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { boxWidth: 14, usePointStyle: true } },
    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${ctx.parsed} รายการ` } }
  }
};

/* ----------------- UI Components ----------------- */
function StatCard({ title, value, suffix }) {
  return (
    <div className="stat-card">
      <div className="stat-card-title">{title}</div>
      <div className="stat-card-value">
        {value === undefined || value === null ? '-' : value}
        {suffix ? <span className="text-base font-normal ml-1">{suffix}</span> : null}
      </div>
    </div>
  );
}

function DataTable({ columns, rows, emptyText = 'ไม่มีข้อมูล' }) {
  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>{columns.map(c => <th key={c.key}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {(!rows || rows.length === 0) ? (
            <tr><td colSpan={columns.length} className="px-3 py-3 text-gray-500">{emptyText}</td></tr>
          ) : rows.map((r, idx) => (
            <tr key={idx}>
              {columns.map(c => (
                <td key={c.key}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const safe = (arr) => Array.isArray(arr) ? arr : [];

/* ----------------- Page ----------------- */
export default function Dashboard() {
  const [summary, setSummary] = useState({});
  const [salesByMonth, setSalesByMonth] = useState([]);
  const [ordersByStatus, setOrdersByStatus] = useState([]);
  const [customersByProvince, setCustomersByProvince] = useState([]);
  const [topCategoriesPurchased, setTopCategoriesPurchased] = useState([]);
  const [productCountByCategory, setProductCountByCategory] = useState([]);
  const [productCountBySubcategory, setProductCountBySubcategory] = useState([]);
  const [categorySubcategoryBreakdown, setCategorySubcategoryBreakdown] = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentProducts, setRecentProducts] = useState([]);
  const [recentAddresses, setRecentAddresses] = useState([]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const q = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const s = params.toString();
    return s ? `?${s}` : '';
  }, [from, to]);

  const log = (name) => (err) => console.error(`[Dashboard] ${name} failed:`, err?.response?.data || err?.message);

  useEffect(() => {
    api.get(`/api/dashboard/summary${q}`).then(r => setSummary(r.data)).catch(log('summary'));
    api.get(`/api/dashboard/sales-by-month${q}`).then(r => setSalesByMonth(r.data)).catch(log('sales-by-month'));
    api.get(`/api/dashboard/orders-by-status${q}`).then(r => setOrdersByStatus(r.data)).catch(log('orders-by-status'));
    api.get(`/api/dashboard/customers-by-province`).then(r => setCustomersByProvince(r.data)).catch(log('customers-by-province'));
    api.get(`/api/dashboard/top-categories-by-purchased${q}`).then(r => setTopCategoriesPurchased(r.data)).catch(log('top-categories-by-purchased'));
    api.get(`/api/dashboard/product-count-by-category`).then(r => setProductCountByCategory(r.data)).catch(log('product-count-by-category'));
    api.get(`/api/dashboard/product-count-by-subcategory`).then(r => setProductCountBySubcategory(r.data)).catch(log('product-count-by-subcategory'));
    api.get(`/api/dashboard/category-subcategory-breakdown`).then(r => setCategorySubcategoryBreakdown(r.data)).catch(log('category-subcategory-breakdown'));
    api.get(`/api/dashboard/recent-orders`).then(r => setRecentOrders(r.data)).catch(log('recent-orders'));
    api.get(`/api/dashboard/recent-products`).then(r => setRecentProducts(r.data)).catch(log('recent-products'));
    api.get(`/api/dashboard/recent-addresses`).then(r => setRecentAddresses(r.data)).catch(log('recent-addresses'));
  }, [q]);

  /* ---------- Datasets + สี ---------- */
  const salesByMonthData = useMemo(() => ({
    labels: safe(salesByMonth).map(x => x.month),
    datasets: [{
      label: 'ยอดขายรวม (บาท)',
      data: safe(salesByMonth).map(x => Number(x.total || 0)),
      backgroundColor: palette.brandFill,
      borderColor: palette.brandBorder,
      borderWidth: 1.6,
      borderRadius: 6
    }]
  }), [salesByMonth]);

  const ordersByStatusData = useMemo(() => ({
    labels: safe(ordersByStatus).map(x => x.status_name),
    datasets: [{
      label: 'จำนวนคำสั่งซื้อ',
      data: safe(ordersByStatus).map(x => Number(x.count || 0)),
      backgroundColor: safe(ordersByStatus).map((_, i) => palette.pie[i % palette.pie.length]),
      borderColor: '#ffffff',
      borderWidth: 1
    }]
  }), [ordersByStatus]);

  const customersByProvinceData = useMemo(() => {
    const top = safe(customersByProvince).slice(0, 10);
    const fill = bars(top.length);
    const border = fill.map(opaque);
    return {
      labels: top.map(x => x.province || 'ไม่ระบุ'),
      datasets: [{
        label: 'จำนวนลูกค้า',
        data: top.map(x => Number(x.count || 0)),
        backgroundColor: fill,          // <- แต่ละแท่งคนละสี
        borderColor: border,            // <- ขอบเข้มขึ้น
        borderWidth: 1.4,
        borderRadius: 6
      }]
    };
  }, [customersByProvince]);

  const topCategoriesPurchasedData = useMemo(() => {
    const labels = safe(topCategoriesPurchased).map(x => x.category_name);
    const data = safe(topCategoriesPurchased).map(x => Number(x.qty || 0));
    const fill = bars(data.length);
    const border = fill.map(opaque);
    return {
      labels,
      datasets: [{
        label: 'จำนวนชิ้นที่ขาย',
        data,
        backgroundColor: fill,         
        borderColor: border,
        borderWidth: 1.4,
        borderRadius: 6
      }]
    };
  }, [topCategoriesPurchased]);

  const productCountByCategoryData = useMemo(() => {
    const labels = safe(productCountByCategory).map(x => x.category_name);
    const data = safe(productCountByCategory).map(x => Number(x.products || 0));
    const fill = bars(data.length);
    const border = fill.map(opaque);
    return {
      labels,
      datasets: [{
        label: 'จำนวนสินค้าในระบบ',
        data,
        backgroundColor: fill,
        borderColor: border,
        borderWidth: 1.3,
        borderRadius: 6
      }]
    };
  }, [productCountByCategory]);

  const productCountBySubcategoryData = useMemo(() => {
    const top = safe(productCountBySubcategory).slice(0, 12);
    const fill = bars(top.length);
    const border = fill.map(opaque);
    return {
      labels: top.map(x => `${x.subcategory_name}`),
      datasets: [{
        label: 'จำนวนสินค้าในหมวดย่อย',
        data: top.map(x => Number(x.products || 0)),
        backgroundColor: fill,
        borderColor: border,
        borderWidth: 1.3,
        borderRadius: 6
      }]
    };
  }, [productCountBySubcategory]);

  return (
    <div className="dashboard-container">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">📊 Dashboard ภาพรวม</h1>
        <div className="date-filter">
          <div className="text-sm text-gray-600">ช่วงเวลา (ยอดขาย/คำสั่งซื้อ/Top Category)</div>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} />
          <span>—</span>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} />
          <button onClick={()=>{setFrom('');setTo('');}}>ล้าง</button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard title="สินค้า" value={summary.products}/>
        <StatCard title="ผู้ใช้งาน" value={summary.users}/>
        <StatCard title="คำสั่งซื้อ" value={summary.orders}/>
        <StatCard title="ที่อยู่จัดส่ง" value={summary.addresses}/>
        <StatCard title="ยอดขายรวม" value={summary.total_sales?.toLocaleString('th-TH')} suffix="บาท"/>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-box">
          <div className="chart-title">ยอดขายรายเดือน</div>
          <Bar data={salesByMonthData} options={moneyBarOpts} />
        </div>
        <div className="chart-box">
          <div className="chart-title">คำสั่งซื้อแยกตามสถานะ</div>
          <Pie data={ordersByStatusData} options={pieOpts} />
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-box">
          <div className="chart-title">ลูกค้าอยู่จังหวัดไหนเยอะที่สุด (Top 10)</div>
          <Bar data={customersByProvinceData} options={{ ...countBarOpts, indexAxis: 'y' }} />
        </div>
        <div className="chart-box">
          <div className="chart-title">ลูกค้าซื้อ “หมวดสินค้า” ไหนเยอะสุด</div>
          <Bar data={topCategoriesPurchasedData} options={countBarOpts} />
        </div>
      </div>

      {/* Charts Row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-box">
          <div className="chart-title">จำนวนสินค้าแยกตามหมวด</div>
          <Bar data={productCountByCategoryData} options={countBarOpts} />
        </div>
        <div className="chart-box">
          <div className="chart-title">จำนวนสินค้าแยกตามหมวดย่อย (Top 12)</div>
          <Bar data={productCountBySubcategoryData} options={{ ...countBarOpts, indexAxis: 'y' }} />
        </div>
      </div>

      {/* Tables: Breakdown + Recents */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-box">
          <div className="chart-title">ประเภท ↔ หมวดย่อย ↔ จำนวนสินค้า</div>
          <DataTable
            columns={[
              { key: 'category_name', header: 'ประเภท (Category)' },
              { key: 'subcategory_name', header: 'หมวดย่อย (Subcategory)' },
              { key: 'products', header: 'จำนวน', render: v => Number(v||0).toLocaleString('th-TH') },
            ]}
            rows={categorySubcategoryBreakdown}
          />
        </div>

        <div className="grid gap-6">
          <div className="chart-box">
            <div className="chart-title">คำสั่งซื้อล่าสุด</div>
            <DataTable
              columns={[
                { key: 'order_id', header: 'Order' },
                { key: 'email', header: 'ลูกค้า' },
                { key: 'total_amount', header: 'ยอด (฿)', render: v => Number(v||0).toLocaleString('th-TH') },
                { key: 'status_name', header: 'สถานะ' },
                { key: 'order_date', header: 'วันที่', render: v => v ? new Date(v).toLocaleString('th-TH') : '' },
              ]}
              rows={recentOrders}
            />
          </div>

          <div className="chart-box">
            <div className="chart-title">สินค้าล่าสุด</div>
            <DataTable
              columns={[
                { key: 'product_id', header: 'ID' },
                { key: 'product_name', header: 'ชื่อสินค้า' },
                { key: 'category_name', header: 'หมวด' },
                { key: 'created_at', header: 'เพิ่มเมื่อ', render: v => v ? new Date(v).toLocaleString('th-TH') : '' },
              ]}
              rows={recentProducts}
            />
          </div>

          <div className="chart-box">
            <div className="chart-title">ที่อยู่ล่าสุด</div>
            <DataTable
              columns={[
                { key: 'address_id', header: 'ID' },
                { key: 'email', header: 'ของผู้ใช้' },
                { key: 'recipient_name', header: 'ผู้รับ' },
                { key: 'province', header: 'จังหวัด' },
                { key: 'created_at', header: 'เพิ่มเมื่อ', render: v => v ? new Date(v).toLocaleString('th-TH') : '' },
              ]}
              rows={recentAddresses}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
