// frontend/src/admin/OrderManagement.js
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './OrderManagement.css'; // << ใช้ไฟล์ CSS แยก

const STATUS_CLASS = (id) => `status-${String(id || '').toLowerCase()}`;

export default function OrderManagement() {
  const [orders, setOrders] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // filters
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);

  // tracking inline
  const [trackingDraft, setTrackingDraft] = useState({});

  // detail modal
  const [detail, setDetail] = useState({ open: false, order: null, items: [] });

  const fmtCurrency = (n) =>
    Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '-');

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((total || 0) / pageSize)),
    [total, pageSize]
  );

  const currentParams = useMemo(
    () => ({
      page,
      pageSize,
      status_id: statusFilter || undefined,
      q: q || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [page, pageSize, statusFilter, q, dateFrom, dateTo]
  );

  async function fetchStatuses() {
    try {
      const res = await axios.get('/api/orders/statuses');
      setStatuses(res.data || []);
    } catch {
      /* noop */
    }
  }

  async function fetchOrders(params = currentParams) {
    setLoading(true);
    setErr('');
    try {
      const res = await axios.get('/api/orders', { params });
      setOrders(res.data?.rows || []);
      setTotal(res.data?.total || 0);
      setPage(res.data?.page || params.page || 1);
      const nextDraft = {};
      (res.data?.rows || []).forEach((o) => (nextDraft[o.order_id] = o.tracking_number || ''));
      setTrackingDraft(nextDraft);
    } catch {
      setErr('โหลดรายการคำสั่งซื้อไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(orderId) {
    try {
      const res = await axios.get(`/api/orders/${orderId}`);
      setDetail({ open: true, order: res.data.order, items: res.data.items || [] });
    } catch {
      alert('ดึงรายละเอียดไม่สำเร็จ');
    }
  }
  function closeDetail() {
    setDetail({ open: false, order: null, items: [] });
  }

  useEffect(() => {
    fetchStatuses();
    fetchOrders({ ...currentParams, page: 1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleStatusChange(orderId, newStatusId) {
    try {
      const res = await axios.put(`/api/orders/${orderId}/status`, { order_status_id: newStatusId });
      const updated = res.data?.row;
      if (updated) {
        setOrders((prev) => prev.map((o) => (o.order_id === orderId ? { ...o, ...updated } : o)));
      }
    } catch {
      alert('อัปเดตสถานะไม่สำเร็จ');
    }
  }

  // Auto-refresh ทุก 30 วินาที + ส่งสัญญาณให้ AdminLayout อัปเดต badge
  useEffect(() => {
    let alive = true;

    async function refresh() {
      if (!alive) return;
      await fetchOrders({ ...currentParams, page }); // รีโหลดตามฟิลเตอร์ปัจจุบัน

      // แจ้ง AdminLayout ให้รีเฟรช badge NEW
      const ev = new CustomEvent('orders:signal', { detail: 'orders:refreshed' });
      window.dispatchEvent(ev);
    }

    const id = setInterval(refresh, 30_000); // 30s
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentParams, page]);

 async function handleTrackingSave(orderId) {
  const newTracking = (trackingDraft[orderId] ?? '').trim(); 
  try {
    const res = await axios.put(`/api/orders/${orderId}/tracking`, {
      tracking_number: newTracking || null,
    });
    const updated = res.data?.row;
    if (updated) {
      setOrders((prev) => prev.map((o) => (o.order_id === orderId ? { ...o, ...updated } : o)));
      setTrackingDraft((prev) => ({ ...prev, [orderId]: updated.tracking_number || '' }));
    }
  } catch {
    alert('อัปเดตเลขพัสดุไม่สำเร็จ');
  }
}

  function doSearch() {
    setPage(1);
    fetchOrders({ ...currentParams, page: 1 });
  }
  function resetFilters() {
    setQ('');
    setStatusFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
    fetchOrders({ page: 1, pageSize });
  }
  function exportCSV() {
    const params = new URLSearchParams({
      q: q || '',
      status_id: statusFilter || '',
      date_from: dateFrom || '',
      date_to: dateTo || '',
    });
    window.open(`/api/orders/export?${params.toString()}`, '_blank');
  }

  return (
    <div className="om-container">
      <h2 className="om-title">จัดการคำสั่งซื้อ</h2>

      {/* Filter bar */}
      <div className="om-filter">
        <input
          className="om-input"
          placeholder="ค้นหา: เลขคำสั่งซื้อ / เลขพัสดุ / user_id"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
        />
        <select
          className="om-input"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">— ทุกสถานะ —</option>
          {statuses.map((s) => (
            <option key={s.order_status_id} value={s.order_status_id}>
              {s.order_status_name}
            </option>
          ))}
        </select>
        <input
          className="om-input"
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <input
          className="om-input"
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />

        {/* ปุ่มชุดเดียว (ไม่มีซ้อน) */}
        <div className="om-actions">
          <button className="om-btn" onClick={doSearch}>ค้นหา</button>
          <button
            className="om-btn om-btn-outline"
            onClick={() => {
              const today = new Date().toISOString().slice(0, 10);
              setDateFrom(today);
              setDateTo(today);
              setPage(1);
              fetchOrders({ ...currentParams, date_from: today, date_to: today, page: 1 });
            }}
          >
            วันนี้
          </button>
          <button className="om-btn om-btn-secondary" onClick={resetFilters}>รีเซ็ต</button>
          <button className="om-btn om-btn-outline" onClick={exportCSV}>Export CSV</button>
        </div>
      </div>

      {/* Pagination */}
      <div className="om-pagination">
        <button
          className="om-btn"
          disabled={page <= 1}
          onClick={() => {
            const p = page - 1;
            setPage(p);
            fetchOrders({ ...currentParams, page: p });
          }}
        >
          ก่อนหน้า
        </button>
        <span className="om-pageinfo">
          หน้า {page} / {totalPages} (รวม {total} รายการ)
        </span>
        <button
          className="om-btn"
          disabled={page >= totalPages}
          onClick={() => {
            const p = page + 1;
            setPage(p);
            fetchOrders({ ...currentParams, page: p });
          }}
        >
          ถัดไป
        </button>
      </div>

      {err && <div className="om-error">{err}</div>}

      {loading ? (
        <div className="om-loading">กำลังโหลด...</div>
      ) : (
        <div className="om-tablewrap">
          <table className="om-table">
            <thead>
              <tr>
                <th className="om-th">เลขที่</th>
                <th className="om-th">ผู้ใช้</th>
                <th className="om-th">วันที่</th>
                <th className="om-th">ยอดรวม</th>
                <th className="om-th">สถานะ</th>
                <th className="om-th">อัปเดตสถานะ</th>
                <th className="om-th">เลขพัสดุ</th>
                <th className="om-th">ดู</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id} className="om-tr">
                  <td className="om-td">#{o.order_id}</td>
                  <td className="om-td">ผู้ใช้ #{o.user_id}</td>
                  <td className="om-td">{fmtDate(o.order_date)}</td>
                  <td className="om-td om-num">{fmtCurrency(o.total_amount)}</td>

                  <td className="om-td">
                    <span className={`om-badge ${STATUS_CLASS(o.order_status_id)}`}>
                      {o.order_status_name}
                    </span>
                  </td>

                  <td className="om-td">
                    <select
                      className="om-input"
                      value={o.order_status_id}
                      onChange={(e) => handleStatusChange(o.order_id, e.target.value)}
                    >
                      {statuses.map((s) => (
                        <option key={s.order_status_id} value={s.order_status_id}>
                          {s.order_status_name}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className="om-td">
                    <div className="om-trk">
                      <input
                        className="om-input"
                        placeholder="ใส่เลขพัสดุ"
                        value={trackingDraft[o.order_id] ?? (o.tracking_number || '')}
                        onChange={(e) =>
                          setTrackingDraft((prev) => ({ ...prev, [o.order_id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleTrackingSave(o.order_id);
                        }}
                      />
                      <button className="om-btn" onClick={() => handleTrackingSave(o.order_id)}>
                        บันทึก
                      </button>
                    </div>
                  </td>

                  <td className="om-td">
                    <button className="om-btn om-btn-secondary" onClick={() => openDetail(o.order_id)}>
                      รายละเอียด
                    </button>
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td
                    className="om-td"
                    colSpan={8}
                    style={{ textAlign: 'center', color: '#777', padding: 24 }}
                  >
                    ไม่พบข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail Modal */}
      {detail.open && (
        <div className="om-modal-backdrop" onClick={closeDetail}>
          <div className="om-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="om-modal-title">ออเดอร์ #{detail.order?.order_id}</h3>
            <div className="om-order-meta">
              ผู้ใช้ #{detail.order?.user_id} · วันที่ {fmtDate(detail.order?.order_date)} <br />
              สถานะ: {detail.order?.order_status_name} · เลขพัสดุ: {detail.order?.tracking_number || '-'} <br />
              ยอดรวม: {fmtCurrency(detail.order?.total_amount)}
            </div>

            <div className="om-tablewrap">
              <table className="om-table">
                <thead>
                  <tr>
                    <th className="om-th">#</th>
                    <th className="om-th">สินค้า</th>
                    <th className="om-th">SKU</th>
                    <th className="om-th">ตัวเลือก</th>
                    <th className="om-th">จำนวน</th>
                    <th className="om-th">ราคา/หน่วย</th>
                    <th className="om-th">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((it, idx) => (
                    <tr key={it.order_detail_id} className="om-tr">
                      <td className="om-td">{idx + 1}</td>
                      <td className="om-td">
                        <div className="om-item">
                          {it.image ? (
                            <img alt="" src={it.image} className="om-thumb" />
                          ) : (
                            <div className="om-thumb om-thumb-na">N/A</div>
                          )}
                          <div>
                            <div className="om-item-name">{it.product_name || `#${it.product_id}`}</div>
                            <div className="om-item-sub">variant_id: {it.variant_id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="om-td">{it.sku || '-'}</td>
                      <td className="om-td om-ellipsis">{it.options || '-'}</td>
                      <td className="om-td">{it.quantity}</td>
                      <td className="om-td om-num">{fmtCurrency(it.price_each)}</td>
                      <td className="om-td om-num">{fmtCurrency(it.line_total)}</td>
                    </tr>
                  ))}
                  {!detail.items.length && (
                    <tr>
                      <td
                        className="om-td"
                        colSpan={7}
                        style={{ textAlign: 'center', color: '#777', padding: 24 }}
                      >
                        ไม่มีรายการสินค้า
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="om-modal-actions">
              <button className="om-btn om-btn-secondary" onClick={closeDetail}>
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
