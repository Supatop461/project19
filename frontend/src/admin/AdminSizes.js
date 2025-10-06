// [FRONTEND] src/admin/AdminSizes.js
// ✅ จัดการ "หน่วยขนาด" แยกหน้า
// - ลิสต์/เพิ่ม/แก้ไข/ลบ หน่วยขนาด (code + label)
// - ถ้า backend รองรับ publish toggle → ใช้งานได้ (fallback เป็นไม่แสดงปุ่ม)
// - พยายามโหลดจาก /size-units (หรือ /sizes ถ้าคนละชื่อ) ถ้าไม่มี → ใช้ค่า default
// - ปุ่มกลับไปหน้าสินค้า

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './ProductManagement.css';
import { api, path } from '../lib/api';

const DEFAULT_SIZE_UNITS = [
  { code: 'mm',   label: 'มม.' },
  { code: 'cm',   label: 'ซม.' },
  { code: 'm',    label: 'ม.' },
  { code: 'inch', label: 'นิ้ว' },
  { code: 'kg',   label: 'กก.' },
  { code: 'ltr',  label: 'ลิตร' },
];

const asStr = (v) => (v === null || v === undefined) ? '' : String(v);

export default function AdminSizes() {
  const [units, setUnits]                 = useState(DEFAULT_SIZE_UNITS);
  const [loading, setLoading]             = useState(false);
  const [filter, setFilter]               = useState('all'); // all | published | hidden
  const [supportsPublish, setSupportsPublish] = useState(false);

  const [newUnit, setNewUnit] = useState({ code: '', label: '' });

  const handleApiError = (err, fallback = 'เกิดข้อผิดพลาด') => {
    console.error(fallback, err?.response?.data || err?.message || err);
    alert(err?.response?.data?.error || err?.message || fallback);
  };

  // โหลดจาก /size-units หรือ /sizes (เผื่อชื่อ endpoint ต่างกัน)
  const fetchUnits = async () => {
    const normalize = (list) => (list || []).map(u => ({
      code:  asStr(u.code ?? u.size_code ?? u.id ?? u.SizeCode ?? ''),
      label: asStr(u.label ?? u.name ?? u.SizeName ?? ''),
      is_published: typeof u.is_published === 'boolean' ? u.is_published
                    : (u.status === 'published' || u.published === true || u.IsPublished === true) || undefined
    })).filter(u => u.code && u.label);

    try {
      const { data } = await api.get(path('/size-units'));
      const norm = Array.isArray(data) ? normalize(data) : normalize(data?.items);
      if (norm.length > 0) return setUnits(norm);
    } catch (e1) {
      // fallback ลอง /sizes
      try {
        const { data } = await api.get(path('/sizes'));
        const norm = Array.isArray(data) ? normalize(data) : normalize(data?.items);
        if (norm.length > 0) return setUnits(norm);
      } catch (e2) {
        console.warn('ℹ️ ใช้ค่า default size units (ไม่มี /size-units หรือ /sizes)', e2?.response?.status || e2?.message);
        setUnits(DEFAULT_SIZE_UNITS);
      }
    }
  };

  // เช็ค publish endpoint
  const probePublishSupport = async () => {
    try {
      await api.patch(path('/admin/size-units/__probe__/publish'), { is_published: true });
      setSupportsPublish(true);
    } catch {
      // ลองอีกชื่อหนึ่ง
      try {
        await api.patch(path('/admin/sizes/__probe__/publish'), { is_published: true });
        setSupportsPublish(true);
      } catch {
        setSupportsPublish(false);
      }
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchUnits();
      await probePublishSupport();
      setLoading(false);
    })();
  }, []);

  const filteredUnits = useMemo(() => {
    if (!Array.isArray(units)) return [];
    if (filter === 'all') return units;
    return units.filter(u => {
      const pub = typeof u.is_published === 'boolean' ? u.is_published : true;
      return filter === 'published' ? pub : !pub;
    });
  }, [units, filter]);

  // เพิ่ม
  const createUnit = async () => {
    const code = newUnit.code.trim().toLowerCase().replace(/\s+/g, '_');
    const label = newUnit.label.trim();
    if (!label) return alert('กรอกชื่อหน่วย (label)');
    if (!code)  return alert('กรอกรหัสหน่วย (code)');
    if (units.some(u => u.code === code || u.label === label)) {
      return alert(`หน่วย "${label}" มีอยู่แล้ว`);
    }

    // พยายาม POST ผ่าน API หลายชื่อ
    const payload = { code, label };
    const tryPost = async (url) => api.post(path(url), payload);

    try {
      try { await tryPost('/size-units'); }
      catch { await tryPost('/sizes'); }
      await fetchUnits();
    } catch (err) {
      console.warn('ℹ️ สร้างผ่าน API ไม่ได้ → เพิ่ม client-side ชั่วคราว');
      setUnits(prev => [...prev, { code, label }]);
    }
    setNewUnit({ code: '', label: '' });
  };

  // แก้ไข
  const editUnit = async (u) => {
    const name = window.prompt('ชื่อหน่วยใหม่', u.label);
    if (!name || name.trim() === u.label) return;
    const nextLabel = name.trim();
    const nextCode  = nextLabel.toLowerCase().replace(/\s+/g, '_');

    if (units.some(x => x.code !== u.code && (x.label === nextLabel || x.code === nextCode))) {
      return alert(`หน่วย "${nextLabel}" ชนกับที่มีอยู่`);
    }

    const payload = { code: nextCode, label: nextLabel };
    const tryPut = async (url) => api.put(path(`${url}/${u.code}`), payload);

    try {
      try { await tryPut('/size-units'); }
      catch { await tryPut('/sizes'); }
      await fetchUnits();
    } catch (err) {
      console.warn('ℹ️ แก้ผ่าน API ไม่ได้ → ปรับ client-side ชั่วคราว');
      setUnits(prev => prev.map(x => x.code === u.code ? { ...x, code: nextCode, label: nextLabel } : x));
    }
  };

  // ลบ
  const deleteUnit = async (u) => {
    if (!window.confirm(`ลบหน่วย "${u.label}" ?`)) return;

    const tryDelete = async (url) => api.delete(path(`${url}/${u.code}`));
    try {
      try { await tryDelete('/size-units'); }
      catch { await tryDelete('/sizes'); }
      await fetchUnits();
    } catch (err) {
      console.warn('ℹ️ ลบผ่าน API ไม่ได้ → ลบ client-side ชั่วคราว');
      setUnits(prev => prev.filter(x => x.code !== u.code));
    }
  };

  // toggle publish
  const togglePublish = async (u) => {
    if (!supportsPublish) return;
    const current = typeof u.is_published === 'boolean' ? u.is_published : true;

    const tryPatch = async (url) => api.patch(path(`${url}/${u.code}/publish`), { is_published: !current });
    try {
      try { await tryPatch('/admin/size-units'); }
      catch { await tryPatch('/admin/sizes'); }
      await fetchUnits();
    } catch (err) {
      handleApiError(err, '❌ อัปเดตการแสดงผลไม่สำเร็จ');
    }
  };

  if (loading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;

  return (
    <div className="pm-page">
      {/* ปุ่มกลับ */}
      <div style={{display:'flex', gap:8, margin:'12px 0 20px', flexWrap:'wrap'}}>
        <Link to="/admin/products" className="btn btn-ghost">← กลับไปจัดการสินค้า</Link>
      </div>

      <h2>จัดการหน่วยขนาด</h2>

      {/* ฟอร์มเพิ่ม */}
      <div className="pm-actions mt-8" style={{ flexWrap:'wrap' }}>
        <input
          placeholder="code (เช่น: cm, inch)"
          value={newUnit.code}
          onChange={(e)=>setNewUnit(prev => ({ ...prev, code: e.target.value }))}
          style={{ maxWidth:220 }}
        />
        <input
          placeholder="label (เช่น: ซม., นิ้ว)"
          value={newUnit.label}
          onChange={(e)=>setNewUnit(prev => ({ ...prev, label: e.target.value }))}
          style={{ minWidth:220 }}
        />
        <button type="button" className="btn btn-primary" onClick={createUnit}>
          เพิ่มหน่วยขนาด
        </button>
      </div>

      {/* ฟิลเตอร์ (เฉพาะกรณีรองรับ publish) */}
      {supportsPublish && (
        <div className="pm-toolbar">
          <div className="seg">
            <button type="button" className={`seg-btn ${filter==='all' ? 'active': ''}`} onClick={()=>setFilter('all')}>ทั้งหมด</button>
            <button type="button" className={`seg-btn ${filter==='published' ? 'active': ''}`} onClick={()=>setFilter('published')}>เฉพาะที่แสดง</button>
            <button type="button" className={`seg-btn ${filter==='hidden' ? 'active': ''}`} onClick={()=>setFilter('hidden')}>เฉพาะที่ซ่อน</button>
          </div>
        </div>
      )}

      {/* ตาราง */}
      <div className="pm-table-wrap mt-8">
        <table className="pm-table pm-fixed">
          <thead>
            <tr>
              <th style={{width:220}}>รหัส (code)</th>
              <th>ชื่อหน่วย (label)</th>
              <th style={{textAlign:'center', width: supportsPublish ? 260 : 200}}>จัดการ</th>
              {supportsPublish && <th style={{textAlign:'center', width:140}}>แสดงผล</th>}
            </tr>
          </thead>
          <tbody>
            {(filteredUnits || units).map(u => {
              const published = typeof u.is_published === 'boolean' ? u.is_published : true;
              return (
                <tr key={u.code}>
                  <td>{u.code}</td>
                  <td>
                    {supportsPublish && (
                      <span className={`pill ${published ? 'on' : 'off'}`} style={{ marginRight: 6 }}>
                        {published ? 'กำลังแสดง' : 'ถูกซ่อน'}
                      </span>
                    )}
                    <span className="name-with-badges">{u.label}</span>
                  </td>
                  <td className="cell-actions">
                    <button className="btn btn-ghost" onClick={()=>editUnit(u)}>แก้ไข</button>
                    <button className="btn btn-danger" onClick={()=>deleteUnit(u)}>ลบ</button>
                  </td>
                  {supportsPublish && (
                    <td className="cell-actions" style={{ textAlign:'center' }}>
                      <button
                        className={`btn ${published ? 'btn-warn' : 'btn-primary'}`}
                        onClick={() => togglePublish(u)}
                        title={published ? 'ซ่อน' : 'แสดง'}
                      >
                        {published ? 'ไม่แสดง' : 'แสดง'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {(!units || units.length === 0) && (
              <tr><td colSpan={supportsPublish ? 4 : 3} style={{ color:'#777' }}>— ไม่มีหน่วยขนาด —</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
