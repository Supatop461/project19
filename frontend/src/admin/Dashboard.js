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

/* ----------------- Palette ----------------- */
const palette = {
  brandFill: 'rgba(74,148,74,0.45)',   // #4a944a
  brandBorder: '#4a944a',
  pie: [
    'rgba(74,148,74,0.85)','rgba(37,99,235,0.85)','rgba(245,158,11,0.90)',
    'rgba(139,92,246,0.85)','rgba(20,184,166,0.85)','rgba(239,68,68,0.90)',
    'rgba(154,122,95,0.85)','rgba(16,185,129,0.85)'
  ]
};
const bars = (n) => Array.from({ length: n }, (_, i) => palette.pie[i % palette.pie.length]);
const opaque = (rgba) => rgba?.startsWith('rgba(') ? rgba.replace(/rgba\(([^)]+),\s*[^)]+\)/, 'rgba($1,1)') : rgba;
const baht = (n) => Number(n||0).toLocaleString('th-TH');

/* ----------------- Flexible field helpers (อิงประวัติ/รองรับหลาย key) ----------------- */
const pickStr = (o, keys) => {
  for (const k of keys) { const v = o?.[k]; if (typeof v === 'string' && v.trim() !== '') return v; }
  const k = keys.find(k=>o?.[k]!=null); return (o?.[k] ?? '') + '';
};
const pickNum = (o, keys) => {
  for (const k of keys) {
    const v = o?.[k];
    const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g,'')) : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

/* ----------------- PLUGINS ----------------- */
// 1) วาดตัวเลขบนแท่ง + % บน Pie
const ValueLabelPlugin = {
  id: 'value-label-plugin',
  afterDatasetsDraw(chart) {
    const { ctx, data, options } = chart;
    const type = chart.config.type;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';

    if (type === 'pie' || type === 'doughnut') {
      const ds = data.datasets[0] || {};
      const values = (ds.data || []).map(v => Number(v || 0));
      const total = values.reduce((a,b)=>a+b, 0);
      const metas = chart.getDatasetMeta(0).data || [];
      values.forEach((v, i) => {
        if (!metas[i] || total <= 0 || v <= 0) return;
        const p = (v/total)*100;
        const { x, y } = metas[i].tooltipPosition();
        ctx.fillStyle = '#0b1324';
        const label = `${p.toFixed(p >= 10 ? 0 : 1)}%`;
        ctx.fillText(label, x, y);
      });
    } else {
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        meta.data.forEach((el, i) => {
          const raw = ds.data[i]; const v = Number(raw ?? 0);
          if (!isFinite(v)) return;
          let x = el.x, y = el.y, align = 'center';
          const isHorizontal = (options?.indexAxis === 'y');
          if (isHorizontal) { align = 'left'; x += 14; } else { y -= 10; }
          ctx.textAlign = align;
          ctx.fillStyle = '#0b1324';
          ctx.fillText(v.toLocaleString('th-TH'), x, y);
        });
      });
    }
    ctx.restore();
  }
};

// 2) ถ้าไม่มีข้อมูล → โชว์ "ไม่มีข้อมูล"
const NoDataPlugin = {
  id: 'no-data-plugin',
  afterDraw(chart) {
    const hasData = (chart.config.data?.datasets || []).some(d => Array.isArray(d.data) && d.data.some(v => Number(v||0) > 0));
    if (hasData) return;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.fillStyle = '#6b7280';
    ctx.font = '600 13px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    ctx.textAlign = 'center';
    ctx.fillText('ไม่มีข้อมูล', (chartArea.left + chartArea.right)/2, (chartArea.top + chartArea.bottom)/2);
    ctx.restore();
  }
};

ChartJS.register(ValueLabelPlugin, NoDataPlugin);

/* ----------------- Chart options ----------------- */
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
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const ds = ctx.dataset.data; const total = ds.reduce((a,b)=>a+Number(b||0),0);
          const val = Number(ctx.parsed || 0); const pct = total>0 ? (val/total*100) : 0;
          return `${ctx.label}: ${val.toLocaleString('th-TH')} (${pct.toFixed(pct>=10?0:1)}%)`;
        }
      }
    }
  }
};

/* ----------------- UI helpers ----------------- */
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
        <thead><tr>{columns.map(c => <th key={c.key}>{c.header}</th>)}</tr></thead>
        <tbody>
          {(!rows || rows.length === 0)
            ? <tr><td colSpan={columns.length} className="px-3 py-3 text-gray-500">{emptyText}</td></tr>
            : rows.map((r, idx) => (
              <tr key={idx}>{columns.map(c => <td key={c.key}>{c.render ? c.render(r[c.key], r) : (r[c.key] ?? '')}</td>)}</tr>
            ))
          }
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
  const [publishedShare, setPublishedShare] = useState([]);
  const [addToCartTrend, setAddToCartTrend] = useState([]);

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
    api.get(`/api/dashboard/published-share`).then(r => setPublishedShare(r.data)).catch(log('published-share'));
    api.get(`/api/dashboard/add-to-cart-trend${q}`).then(r => setAddToCartTrend(r.data)).catch(log('add-to-cart-trend'));
  }, [q]);

  /* ---------- Datasets (ใช้ pickStr/pickNum รองรับหลายชื่อคอลัมน์) ---------- */
  const salesByMonthData = useMemo(() => ({
    labels: safe(salesByMonth).map(x => pickStr(x, ['month','month_name','ym'])),
    datasets: [{
      label: 'ยอดขายรวม (บาท)',
      data: safe(salesByMonth).map(x => pickNum(x, ['total','sum','amount'])),
      backgroundColor: 'rgba(74,148,74,0.45)',
      borderColor: '#4a944a',
      borderWidth: 1.6,
      borderRadius: 6
    }]
  }), [salesByMonth]);

  const ordersByStatusData = useMemo(() => ({
    labels: safe(ordersByStatus).map(x => pickStr(x, ['status_name','status','name'])),
    datasets: [{
      label: 'จำนวนคำสั่งซื้อ',
      data: safe(ordersByStatus).map(x => pickNum(x, ['count','total','qty','orders'])),
      backgroundColor: safe(ordersByStatus).map((_, i) => palette.pie[i % palette.pie.length]),
      borderColor: '#ffffff', borderWidth: 1
    }]
  }), [ordersByStatus]);

  const customersByProvinceData = useMemo(() => {
    const top = safe(customersByProvince).slice(0, 10);
    const fill = bars(top.length); const border = fill.map(opaque);
    return {
      labels: top.map(x => pickStr(x, ['province','province_name','prov']) || 'ไม่ระบุ'),
      datasets: [{ label: 'จำนวนลูกค้า', data: top.map(x => pickNum(x, ['count','cnt','total'])), backgroundColor: fill, borderColor: border, borderWidth: 1.4, borderRadius: 6 }]
    };
  }, [customersByProvince]);

  const topCategoriesPurchasedData = useMemo(() => {
    const labels = safe(topCategoriesPurchased).map(x => pickStr(x, ['category_name','category','name']));
    const data = safe(topCategoriesPurchased).map(x => pickNum(x, ['qty','count','total']));
    const fill = bars(data.length); const border = fill.map(opaque);
    return { labels, datasets: [{ label: 'จำนวนชิ้นที่ขาย', data, backgroundColor: fill, borderColor: border, borderWidth: 1.4, borderRadius: 6 }] };
  }, [topCategoriesPurchased]);

  const productCountByCategoryData = useMemo(() => {
    const labels = safe(productCountByCategory).map(x => pickStr(x, ['category_name','category','name']));
    const data = safe(productCountByCategory).map(x => pickNum(x, ['products','count','total']));
    const fill = bars(data.length); const border = fill.map(opaque);
    return { labels, datasets: [{ label: 'จำนวนสินค้าในระบบ', data, backgroundColor: fill, borderColor: border, borderWidth: 1.3, borderRadius: 6 }] };
  }, [productCountByCategory]);

  const productCountBySubcategoryData = useMemo(() => {
    const top = safe(productCountBySubcategory).slice(0, 12);
    const fill = bars(top.length); const border = fill.map(opaque);
    return {
      labels: top.map(x => pickStr(x, ['subcategory_name','subcategory','name'])),
      datasets: [{ label: 'จำนวนสินค้าในหมวดย่อย', data: top.map(x => pickNum(x, ['products','count','total'])), backgroundColor: fill, borderColor: border, borderWidth: 1.3, borderRadius: 6 }]
    };
  }, [productCountBySubcategory]);

  const publishedShareData = useMemo(() => {
    const labels = safe(publishedShare).map(x => pickStr(x, ['status','published_state']));
    const data = safe(publishedShare).map(x => pickNum(x, ['cnt','count','total']));
    const fill = bars(data.length);
    return { labels, datasets: [{ label: 'สินค้า', data, backgroundColor: fill, borderColor: '#fff', borderWidth: 1 }] };
  }, [publishedShare]);

  const addToCartTrendData = useMemo(() => {
    const labs = safe(addToCartTrend).map(x => pickStr(x, ['day','date']));
    const ds = safe(addToCartTrend).map(x => pickNum(x, ['add_events','count','total']));
    return {
      labels: labs,
      datasets: [{
        label: 'Add-to-Cart (ครั้ง/วัน)',
        data: ds,
        tension: .3,
        borderColor: '#4a944a',
        backgroundColor: 'rgba(74,148,74,0.45)'
      }]
    };
  }, [addToCartTrend]);

  /* ---------- Tables: map ให้ยืดหยุ่น ---------- */
  const recentOrdersRows = useMemo(() => safe(recentOrders).map(r => ({
    order_id: r.order_id ?? r.id,
    email: r.email ?? r.user_email ?? r.customer_email ?? '',
    total_amount: r.total_amount ?? r.grand_total ?? r.total_price ?? 0,
    status_name: r.status_name ?? r.status ?? '',
    order_date: r.order_date ?? r.created_at ?? r.updated_at ?? ''
  })), [recentOrders]);

  const recentProductsRows = useMemo(() => safe(recentProducts).map(r => ({
    product_id: r.product_id ?? r.id,
    product_name: r.product_name ?? r.name,
    category_name: r.category_name ?? r.category ?? '',
    created_at: r.created_at ?? r.updated_at ?? ''
  })), [recentProducts]);

  const recentAddressesRows = useMemo(() => safe(recentAddresses).map(r => ({
    address_id: r.address_id ?? r.id,
    email: r.email ?? r.user_email ?? '',
    recipient_name: r.recipient_name ?? r.name ?? '',
    province: r.province ?? r.province_name ?? '',
    created_at: r.created_at ?? r.updated_at ?? ''
  })), [recentAddresses]);

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

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard title="สินค้า" value={summary.products}/>
        <StatCard title="ผู้ใช้งาน" value={summary.users}/>
        <StatCard title="คำสั่งซื้อ" value={summary.orders}/>
        <StatCard title="ที่อยู่จัดส่ง" value={summary.addresses}/>
        <StatCard title="ยอดขายรวม" value={(summary.total_sales ?? summary.total ?? 0).toLocaleString('th-TH')} suffix="บาท"/>
      </div>

      {/* Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-box">
          <div className="chart-title">ยอดขายรายเดือน</div>
          <Bar data={salesByMonthData} options={countBarOpts} />
        </div>
        <div className="chart-box">
          <div className="chart-title">คำสั่งซื้อแยกตามสถานะ</div>
          <Pie data={ordersByStatusData} options={pieOpts} />
        </div>
      </div>

      {/* Row 2 */}
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

      {/* Row 3 */}
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

      {/* Row 4 — ใหม่ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="chart-box">
          <div className="chart-title">สถานะการเผยแพร่สินค้า (สัดส่วน)</div>
          <Pie data={publishedShareData} options={pieOpts} />
        </div>
        <div className="chart-box">
          <div className="chart-title">แนวโน้มการกดเพิ่มลงตะกร้า (14 วันล่าสุด)</div>
          <Line data={addToCartTrendData} options={{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false }}, scales:{ y:{ beginAtZero:true, ticks:{ precision:0 }}} }} />
        </div>
      </div>

      {/* Tables */}
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
              rows={recentOrdersRows}
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
              rows={recentProductsRows}
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
              rows={recentAddressesRows}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
