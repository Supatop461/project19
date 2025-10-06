// [FRONTEND] src/admin/AdminUnits.js
// ✅ จัดการ "หน่วยสินค้า" แยกหน้า
// - ลิสต์/เพิ่ม/แก้ไข/ลบ หน่วย (code + label)
// - ถ้า backend มี publish toggle: ใช้ได้ทันที (fallback เป็นไม่แสดงปุ่ม)
// - โหลดจาก /units ได้, ถ้าไม่มี API จะใช้ค่า default
// - ปุ่มกลับไปหน้าสินค้า

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './ProductManagement.css';
import { api, path } from '../lib/api';

const DEFAULT_PRODUCT_UNITS = [
  { code: 'plant', label: 'ต้น' },
  { code: 'piece', label: 'ชิ้น' },
  { code: 'pot',   label: 'กระถาง' },
  { code: 'bag',   label: 'ถุง' },
  { code: 'pack',  label: 'แพ็ค' },
  { code: 'kg',    label: 'กิโลกรัม' },
  { code: 'g',     label: 'กรัม' },
  { code: 'ltr',   label: 'ลิตร' },
  { code: 'ml',    label: 'มิลลิลิตร' },
];

const asStr = (v) => (v === null || v === undefined) ? '' : String(v);

export default function AdminUnits() {
  const [units, setUnits]       = useState(DEFAULT_PRODUCT_UNITS);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState('all'); // all | published | hidden
  const [supportsPublish, setSupportsPublish] = useState(false); // ตรวจว่ามี endpoint publish ไหม

  const [newUnit, setNewUnit] = useState({ code: '', label: '' });

  const handleApiError = (err, fallback = 'เกิดข้อผิดพลาด') => {
    console.error(fallback, err?.response?.data || err?.message || err);
    alert(err?.response?.data?.error || err?.message || fallback);
  };

  // โหลดจาก /units ถ้ามี
  const fetchUnits = async () => {
    try {
      const { data } = await api.get(path('/units'));
      const list = Array.isArray(data) ? data : (data?.items || []);
      // normalize: เผื่อ backend ใช้ key อื่น
      const norm = list.map(u => ({
        code:  asStr(u.code ?? u.unit_code ?? u.id ?? u.UnitCode ?? ''),
        label: asStr(u.label ?? u.name ?? u.UnitName ?? ''),
        is_published: typeof u.is_published === 'boolean' ? u.is_published
                      : (u.status === 'published' || u.published === true || u.IsPublished === true) || undefined
      })).filter(u => u.code && u.label);

      if (norm.length > 0) setUnits(norm);
    } catch (err) {
      console.warn('ℹ️ ใช้ค่า default units (ไม่มี /units หรือเรียกไม่สำเร็จ)', err?.response?.status || err?.message);
      setUnits(DEFAULT_PRODUCT_UNITS);
    }
  };

  // เช็คว่ามี endpoint publish ไหม (ถ้าเรียกได้สักครั้ง จะเปิดปุ่มให้ใช้)
  const probePublishSupport = async () => {
    try {
      // เรียกแบบไม่เปลี่ยนค่า (แค่เช็ค 404/405)
      await api.patch(path('/admin/units/__probe__/publish'), { is_published: true });
      setSupportsPublish(true);
    } catch (err) {
      const sc = err?.response?.status;
      // ถ้า 404/405 แสดงว่าไม่รองรับ
      setSupportsPublish(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchUnits();
      await probePublishSupport();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // กันซ้ำในฝั่ง client
    if (units.some(u => u.code === code || u.label === label)) {
      return alert(`หน่วย "${label}" มีอยู่แล้ว`);
    }

    // ถ้ามี API ให้บันทึก
    try {
      await api.post(path('/units'), { code, label });
      await fetchUnits();
    } catch (err) {
      console.warn('ℹ️ สร้างผ่าน API ไม่ได้ → จะเพิ่มแบบ client-side ชั่วคราว');
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

    // กัน label ชน
    if (units.some(x => x.code !== u.code && (x.label === nextLabel || x.code === nextCode))) {
      return alert(`หน่วย "${nextLabel}" ชนกับที่มีอยู่`);
    }

    try {
      // พยายามอัปเดตผ่าน API ก่อน (ใช้ code เดิมเป็น id)
      await api.put(path(`/units/${u.code}`), { code: nextCode, label: nextLabel });
      await fetchUnits();
    } catch (err) {
      console.warn('ℹ️ แก้ผ่าน API ไม่ได้ → ปรับ client-side ชั่วคราว');
      setUnits(prev => prev.map(x => x.code === u.code ? { ...x, code: nextCode, label: nextLabel } : x));
    }
  };

  // ลบ
  const deleteUnit = async (u) => {
    if (!window.confirm(`ลบหน่วย "${u.label}" ?`)) return;
    try {
      await api.delete(path(`/units/${u.code}`));
      await fetchUnits();
    } catch (err) {
      console.warn('ℹ️ ลบผ่าน API ไม่ได้ → ลบ client-side ชั่วคราว');
      setUnits(prev => prev.filter(x => x.code !== u.code));
    }
  };

  // toggle publish (ถ้ารองรับ)
  const togglePublish = async (u) => {
    if (!supportsPublish) return;
    const current = typeof u.is_published === 'boolean' ? u.is_published : true;
    try {
      await api.patch(path(`/admin/units/${u.code}/publish`), { is_published: !current });
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

      <h2>จัดการหน่วยสินค้า</h2>

      {/* ฟอร์มเพิ่ม */}
      <div className="pm-actions mt-8" style={{ flexWrap:'wrap' }}>
        <input
          placeholder="code (เช่น: piece, pot)"
          value={newUnit.code}
          onChange={(e)=>setNewUnit(prev => ({ ...prev, code: e.target.value }))}
          style={{ maxWidth:220 }}
        />
        <input
          placeholder="label (เช่น: ชิ้น, กระถาง)"
          value={newUnit.label}
          onChange={(e)=>setNewUnit(prev => ({ ...prev, label: e.target.value }))}
          style={{ minWidth:220 }}
        />
        <button type="button" className="btn btn-primary" onClick={createUnit}>
          เพิ่มหน่วยสินค้า
        </button>
      </div>

      {/* ฟิลเตอร์ (แสดงผล) — ถ้ารองรับ publish */}
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
              <tr><td colSpan={supportsPublish ? 4 : 3} style={{ color:'#777' }}>— ไม่มีหน่วย —</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
