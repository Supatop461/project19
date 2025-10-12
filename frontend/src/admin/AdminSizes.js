// [FRONTEND] src/admin/AdminSizes.js
// ✅ ใช้ข้อมูลจากฐานข้อมูลจริง 100% (ไม่ใช้ default)
// ✅ คอลัมน์ที่บันทึก: code, unit_name, description, is_published
// ✅ รองรับ endpoint ทั้ง /size-units และ /sizes
// ✅ มีฟอร์มเพิ่ม code / ชื่อหน่วย / คำอธิบาย (กันค่า NULL)
// ✅ มีปุ่ม แก้ไข / ลบ / แสดง-ไม่แสดง (publish toggle)

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './admin-sizes.css';
import { api, path } from '../lib/api';

const asStr = (v) => (v === null || v === undefined ? '' : String(v));

export default function AdminSizes() {
  const [units, setUnits] = useState([]); // ดึงจาก DB เท่านั้น
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all'); // all | published | hidden
  const [supportsPublish, setSupportsPublish] = useState(false);

  // ฟอร์มเพิ่ม
  const [newUnit, setNewUnit] = useState({
    code: '',
    unit_name: '',
    description: '',
  });

  const handleApiError = (err, fallback = 'เกิดข้อผิดพลาด') => {
    console.error(fallback, err?.response?.data || err?.message || err);
    alert(err?.response?.data?.error || err?.message || fallback);
  };

  /* ---------- ดึงรายการจาก /size-units หรือ /sizes ---------- */
  const fetchUnits = async () => {
    const normalize = (list) =>
      (list || [])
        .map((u) => {
          const code = asStr(
            u.code ??
              u.size_code ??
              u.Code ??
              u.SizeCode ??
              u.id ??
              u.ID ??
              ''
          );
          const unit_name = asStr(
            u.unit_name ??
              u.UnitName ??
              u.label ??         // เผื่อบางระบบเก็บชื่อไว้ใน label
              u.name ??          // หรือ name
              ''
          );
          const description = asStr(
            u.description ??
              u.desc ??
              u.short ??
              (unit_name ? unit_name : '') // กันไม่ให้เป็นค่าว่าง/NULL
          );
          const is_published =
            typeof u.is_published === 'boolean'
              ? u.is_published
              : u.status === 'published' ||
                u.published === true ||
                u.IsPublished === true ||
                u.is_visible === true ||
                true; // ถ้าไม่ส่งมา ให้ถือว่าแสดง

          return { code, unit_name, description, is_published };
        })
        .filter((u) => u.code && u.unit_name); // ต้องมี code + ชื่อหน่วย

    try {
      const { data } = await api.get(path('/size-units'));
      const norm = Array.isArray(data) ? normalize(data) : normalize(data?.items);
      if (norm.length > 0) {
        setUnits(norm);
        return;
      }
      console.warn('⚠️ size-units: map ไม่สำเร็จ', data);
    } catch (e1) {
      try {
        const { data } = await api.get(path('/sizes'));
        const norm = Array.isArray(data) ? normalize(data) : normalize(data?.items);
        if (norm.length > 0) {
          setUnits(norm);
          return;
        }
        console.warn('⚠️ sizes: map ไม่สำเร็จ', data);
      } catch (e2) {
        handleApiError(e2, 'โหลดข้อมูลหน่วยขนาดไม่สำเร็จ');
      }
    }
  };

  /* ---------- ตรวจว่ารองรับ publish toggle ไหม ---------- */
  const probePublishSupport = async () => {
    try {
      await api.patch(path('/admin/size-units/__probe__/publish'), { is_published: true });
      setSupportsPublish(true);
    } catch {
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

  /* ---------- Filter ---------- */
  const filteredUnits = useMemo(() => {
    if (!Array.isArray(units)) return [];
    if (filter === 'all') return units;
    return units.filter((u) => {
      const pub = typeof u.is_published === 'boolean' ? u.is_published : true;
      return filter === 'published' ? pub : !pub;
    });
  }, [units, filter]);

  /* ---------- เพิ่ม ---------- */
  const createUnit = async () => {
    const code = newUnit.code.trim().toUpperCase().replace(/\s+/g, '_');
    const unit_name = newUnit.unit_name.trim();
    const description = (newUnit.description || '').trim() || unit_name; // กัน NULL

    if (!code) return alert('กรอกรหัสหน่วย (code)');
    if (!unit_name) return alert('กรอกชื่อหน่วย (unit_name)');

    if (units.some((u) => u.code.toUpperCase() === code))
      return alert(`รหัสหน่วย "${code}" มีอยู่แล้ว`);
    if (units.some((u) => u.unit_name === unit_name))
      return alert(`ชื่อหน่วย "${unit_name}" มีอยู่แล้ว`);

    // ✅ ส่งครบทุกคอลัมน์ที่ DB ต้องการ
    const payload = {
      code,                 // เช่น 'CM'
      unit_name,            // เช่น 'เซนติเมตร'
      description,          // เช่น 'cm' หรือคำอธิบาย
      is_published: true,   // เริ่มต้นเปิดใช้งาน
    };

    const tryPost = async (url) => api.post(path(url), payload);

    try {
      try { await tryPost('/size-units'); }
      catch { await tryPost('/sizes'); }
      await fetchUnits();
      setNewUnit({ code: '', unit_name: '', description: '' });
    } catch (err) {
      handleApiError(err, 'เพิ่มหน่วยไม่สำเร็จ');
    }
  };

  /* ---------- แก้ไข ---------- */
  const editUnit = async (u) => {
    const name = window.prompt('ชื่อหน่วยใหม่ (unit_name)', u.unit_name);
    if (!name) return;
    const desc = window.prompt('คำอธิบาย/รหัสย่อ (description)', u.description || u.unit_name || '');
    if (desc === null) return;

    const next_name = name.trim();
    const next_desc = (desc || '').trim() || next_name;

    if (!next_name) return alert('กรุณากรอกชื่อหน่วย');

    if (units.some((x) => x.code === u.code && x.unit_name === next_name && x.description === next_desc)) {
      // ไม่มีการเปลี่ยนแปลง
      return;
    }
    if (units.some((x) => x.code !== u.code && x.unit_name === next_name)) {
      return alert(`ชื่อหน่วย "${next_name}" ซ้ำกับรายการอื่น`);
    }

    // ไม่บังคับแก้ code จากหน้าแก้ไข (คงเดิม)
    const payload = {
      unit_name: next_name,
      description: next_desc,
      is_published: typeof u.is_published === 'boolean' ? u.is_published : true,
    };

    const tryPut = async (url) => api.put(path(`${url}/${u.code}`), payload);

    try {
      try { await tryPut('/size-units'); }
      catch { await tryPut('/sizes'); }
      await fetchUnits();
    } catch (err) {
      handleApiError(err, 'แก้ไขหน่วยไม่สำเร็จ');
    }
  };

  /* ---------- ลบ ---------- */
  const deleteUnit = async (u) => {
    if (!window.confirm(`ลบหน่วย "${u.unit_name}" ?`)) return;
    const tryDelete = async (url) => api.delete(path(`${url}/${u.code}`));
    try {
      try { await tryDelete('/size-units'); }
      catch { await tryDelete('/sizes'); }
      await fetchUnits();
    } catch (err) {
      handleApiError(err, 'ลบหน่วยไม่สำเร็จ');
    }
  };

  /* ---------- toggle publish ---------- */
  const togglePublish = async (u) => {
    if (!supportsPublish) return;
    const current = typeof u.is_published === 'boolean' ? u.is_published : true;
    const tryPatch = async (url) =>
      api.patch(path(`${url}/${u.code}/publish`), { is_published: !current });

    try {
      try { await tryPatch('/admin/size-units'); }
      catch { await tryPatch('/admin/sizes'); }
      await fetchUnits();
    } catch (err) {
      handleApiError(err, '❌ อัปเดตการแสดงผลไม่สำเร็จ');
    }
  };

  if (loading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;

  /* ---------- UI ---------- */
  return (
    <div className="pm-page">
      {/* Back */}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0 20px', flexWrap: 'wrap' }}>
        <Link to="/admin/products" className="btn btn-ghost">← กลับไปจัดการสินค้า</Link>
      </div>

      <h2>จัดการหน่วยขนาด</h2>

      {/* ฟอร์มเพิ่ม */}
      <div className="pm-actions mt-8" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <input
          placeholder="code (เช่น: CM, MM, KG)"
          value={newUnit.code}
          onChange={(e) => setNewUnit((p) => ({ ...p, code: e.target.value }))}
          style={{ maxWidth: 180 }}
        />
        <input
          placeholder="ชื่อหน่วย (unit_name) เช่น: เซนติเมตร"
          value={newUnit.unit_name}
          onChange={(e) => setNewUnit((p) => ({ ...p, unit_name: e.target.value }))}
          style={{ minWidth: 240 }}
        />
        <input
          placeholder="คำอธิบาย/รหัสย่อ (description) เช่น: cm"
          value={newUnit.description}
          onChange={(e) => setNewUnit((p) => ({ ...p, description: e.target.value }))}
          style={{ minWidth: 200 }}
        />
        <button type="button" className="btn btn-primary" onClick={createUnit}>
          เพิ่มหน่วยขนาด
        </button>
      </div>

      {/* ฟิลเตอร์ (เฉพาะรองรับ publish) */}
      {supportsPublish && (
        <div className="pm-toolbar">
          <div className="seg">
            <button type="button" className={`seg-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>ทั้งหมด</button>
            <button type="button" className={`seg-btn ${filter === 'published' ? 'active' : ''}`} onClick={() => setFilter('published')}>เฉพาะที่แสดง</button>
            <button type="button" className={`seg-btn ${filter === 'hidden' ? 'active' : ''}`} onClick={() => setFilter('hidden')}>เฉพาะที่ซ่อน</button>
          </div>
        </div>
      )}

      {/* ตาราง */}
      <div className="pm-table-wrap mt-8">
        <table className="pm-table pm-fixed">
          <thead>
            <tr>
              <th style={{ width: 160 }}>รหัส (code)</th>
              <th style={{ width: 280 }}>ชื่อหน่วย (unit_name)</th>
              <th>คำอธิบาย (description)</th>
              <th style={{ textAlign: 'center', width: supportsPublish ? 260 : 200 }}>จัดการ</th>
              {supportsPublish && <th style={{ textAlign: 'center', width: 140 }}>แสดงผล</th>}
            </tr>
          </thead>
          <tbody>
            {(filteredUnits || units).map((u) => {
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
                    <span className="name-with-badges">{u.unit_name}</span>
                  </td>
                  <td>{u.description}</td>
                  <td className="cell-actions">
                    <button className="btn btn-ghost" onClick={() => editUnit(u)}>แก้ไข</button>
                    <button className="btn btn-danger" onClick={() => deleteUnit(u)}>ลบ</button>
                  </td>
                  {supportsPublish && (
                    <td className="cell-actions" style={{ textAlign: 'center' }}>
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
              <tr>
                <td colSpan={supportsPublish ? 5 : 4} style={{ color: '#777' }}>— ไม่มีหน่วยขนาด —</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
