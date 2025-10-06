// [FRONTEND] src/admin/AdminSubcategories.js
// ✅ จัดการ "หมวดย่อย" แยกหน้า
// - เพิ่ม/แก้ไข/ลบ
// - เลือกประเภทหลัก
// - อัปโหลด/ล้างรูป
// - toggle แสดง/ซ่อน
// - ฟิลเตอร์
// - ปุ่มกลับไปหน้าสินค้า

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './ProductManagement.css';
import { api, path } from '../lib/api';

const asStr = (v) => (v === null || v === undefined) ? '' : String(v);

// สร้าง URL รูป
const API_BASE = (api?.defaults?.baseURL) || process.env.REACT_APP_API_BASE || 'http://localhost:3001';
const ABS_BASE = String(API_BASE).replace(/\/+$/,'');
const resolveUrl = (u) => {
  if (!u) return '';
  const s = String(u);
  if (/^(https?:|blob:)/i.test(s)) return s;
  if (s.startsWith('/uploads/')) return `${ABS_BASE}${s}`;
  return s;
};

export default function AdminSubcategories() {
  const [categories, setCategories]       = useState([]);
  const [subcategories, setSubcategories] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [subcatFilter, setSubcatFilter]   = useState('all'); // all | published | hidden

  const [newSub, setNewSub] = useState({ subcategory_id: '', subcategory_name: '', category_id: '' });

  const handleApiError = (err, fallback = 'เกิดข้อผิดพลาด') => {
    console.error(fallback, err?.response?.data || err?.message || err);
    alert(err?.response?.data?.error || err?.message || fallback);
  };

  // โหลดประเภท
  const fetchCategories = async () => {
    try {
      const { data } = await api.get(path('/categories'));
      setCategories(Array.isArray(data) ? data : (data?.items || []));
    } catch (err) {
      handleApiError(err, '❌ โหลดประเภทไม่สำเร็จ');
    }
  };

  // โหลดหมวดย่อย
  const fetchSubcategories = async () => {
    try {
      const res = await api.get(path('/subcategories'), { params: { scope: 'admin' } });
      const list = Array.isArray(res?.data)
        ? res.data
        : (Array.isArray(res?.data?.items) ? res.data.items : (Array.isArray(res?.data?.data) ? res.data.data : []));
      setSubcategories(list || []);
    } catch (err) {
      handleApiError(err, '❌ โหลดหมวดย่อยไม่สำเร็จ');
    }
  };

  // อัปโหลดรูปหมวดย่อย
  async function uploadSubcatImage(file) {
    if (!file) return null;
    const fd = new FormData();
    fd.append('file', file);
    const res = await api.post(path('/uploads/subcategory-image'), fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res?.data?.url || res?.data?.imageUrl || null;
  }

  // toggle publish
  async function togglePublish(subId, current) {
    try {
      await api.patch(path(`/admin/subcategories/${subId}/publish`), { is_published: !current });
      await fetchSubcategories();
    } catch (err) {
      handleApiError(err, '❌ อัปเดตการแสดงผลไม่สำเร็จ');
    }
  }

  // เพิ่มหมวดย่อย
  async function createSubcategory() {
    if (!newSub.subcategory_name.trim() || !newSub.category_id) {
      return alert('ใส่ชื่อหมวดย่อย + เลือกประเภทหลัก');
    }
    try {
      await api.post(path('/subcategories'), {
        subcategory_id:   newSub.subcategory_id?.trim() || undefined,
        subcategory_name: newSub.subcategory_name.trim(),
        category_id:      newSub.category_id.trim()
      });
      await fetchSubcategories();
      setNewSub({ subcategory_id:'', subcategory_name:'', category_id:'' });
    } catch (err) {
      handleApiError(err, '❌ เพิ่มหมวดย่อยไม่สำเร็จ');
    }
  }

  // แก้ไขหมวดย่อย
  async function editSubcategory(s) {
    const name = window.prompt('ชื่อหมวดย่อยใหม่', s.subcategory_name);
    if (!name) return;
    const newCat = window.prompt('ย้ายไปประเภทไหน? (ใส่ category_id | เว้นว่าง=ไม่ย้าย)', s.category_id);
    const payload = { subcategory_name: name.trim() };
    if (newCat !== null && newCat.trim() !== '' && newCat !== s.category_id) payload.category_id = newCat.trim();
    try {
      await api.put(path(`/subcategories/${s.subcategory_id}`), payload);
      await fetchSubcategories();
    } catch (err) {
      handleApiError(err, '❌ แก้ไขหมวดย่อยไม่สำเร็จ');
    }
  }

  // ลบหมวดย่อย
  async function deleteSubcategory(s) {
    if (!window.confirm(`ลบหมวดหมู่ย่อย "${s.subcategory_name}" ?`)) return;
    try {
      await api.delete(path(`/subcategories/${s.subcategory_id}`));
      await fetchSubcategories();
    } catch (err) {
      handleApiError(err, '❌ ลบหมวดย่อยไม่สำเร็จ');
    }
  }

  // อัปโหลด/ล้างรูป
  async function chooseImage(s, file) {
    if (!file) return;
    try {
      const url = await uploadSubcatImage(file);
      if (!url) return alert('อัปโหลดไม่สำเร็จ');
      await api.put(path(`/subcategories/${s.subcategory_id}`), { image_url: url });
      await fetchSubcategories();
    } catch (err) {
      handleApiError(err, '❌ อัปโหลด/บันทึกรูปหมวดย่อยไม่สำเร็จ');
    }
  }
  async function clearImage(s) {
    if (!window.confirm(`ล้างภาพของ "${s.subcategory_name}" ใช่ไหม?`)) return;
    try {
      await api.put(path(`/subcategories/${s.subcategory_id}`), { image_url: null });
      await fetchSubcategories();
    } catch (err) {
      handleApiError(err, '❌ ล้างภาพไม่สำเร็จ');
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchCategories(), fetchSubcategories()]);
      setLoading(false);
    })();
  }, []);

  const filteredSubcats = useMemo(() => {
    if (!Array.isArray(subcategories)) return [];
    return subcategories.filter(s => {
      const published = (typeof s.is_published === 'boolean') ? s.is_published : true;
      if (subcatFilter === 'published') return published;
      if (subcatFilter === 'hidden')    return !published;
      return true;
    });
  }, [subcategories, subcatFilter]);

  if (loading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;

  return (
    <div className="pm-page">
      <div style={{display:'flex', gap:8, margin:'12px 0 20px', flexWrap:'wrap'}}>
        <Link to="/admin/products" className="btn btn-ghost">← กลับไปจัดการสินค้า</Link>
      </div>

      <h2>จัดการหมวดย่อย</h2>

      {/* ฟอร์มเพิ่มหมวดย่อย */}
      <div className="pm-actions mt-8" style={{ flexWrap:'wrap' }}>
        <input
          placeholder="subcategory_id (เว้นได้ให้ระบบ gen)"
          value={newSub.subcategory_id}
          onChange={(e)=>setNewSub({ ...newSub, subcategory_id: e.target.value })}
          style={{ maxWidth:240 }}
        />
        <input
          placeholder="subcategory_name"
          value={newSub.subcategory_name}
          onChange={(e)=>setNewSub({ ...newSub, subcategory_name: e.target.value })}
          style={{ minWidth:240 }}
        />
        <select
          value={newSub.category_id}
          onChange={(e)=>setNewSub({ ...newSub, category_id: e.target.value })}
          style={{ minWidth:200 }}
        >
          <option value="">เลือกประเภทหลัก</option>
          {(categories || []).map(c => (
            <option key={c.category_id} value={asStr(c.category_id)}>{c.category_name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={createSubcategory}>
          เพิ่มหมวดย่อย
        </button>
      </div>

      {/* Toolbar */}
      <div className="pm-toolbar">
        <div className="seg">
          <button type="button" className={`seg-btn ${subcatFilter==='all' ? 'active': ''}`} onClick={()=>setSubcatFilter('all')}>ทั้งหมด</button>
          <button type="button" className={`seg-btn ${subcatFilter==='published' ? 'active': ''}`} onClick={()=>setSubcatFilter('published')}>เฉพาะที่แสดง</button>
          <button type="button" className={`seg-btn ${subcatFilter==='hidden' ? 'active': ''}`} onClick={()=>setSubcatFilter('hidden')}>เฉพาะที่ซ่อน</button>
        </div>
      </div>

      {/* ตาราง */}
      <div className="pm-table-wrap mt-8">
        <table className="pm-table pm-fixed">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>หมวดย่อย</th>
              <th>ประเภทหลัก</th>
              <th style={{textAlign:'center'}}>จัดการ</th>
              <th style={{textAlign:'center'}}>รูป</th>
              <th style={{textAlign:'center'}}>แสดงผล</th>
            </tr>
          </thead>
          <tbody>
            {(filteredSubcats || []).map(s => {
              const published = (typeof s.is_published === 'boolean') ? s.is_published : true;
              const catName = categories.find(c => asStr(c.category_id) === asStr(s.category_id))?.category_name || s.category_id;
              return (
                <tr key={s.subcategory_id}>
                  <td>{s.subcategory_id}</td>
                  <td>
                    <span className={`pill ${published ? 'on' : 'off'}`}>
                      {published ? 'กำลังแสดง' : 'ถูกซ่อน'}
                    </span>
                    <span className="name-with-badges">{s.subcategory_name}</span>
                  </td>
                  <td>{catName}</td>
                  <td className="action-stack">
                    <button className="btn btn-ghost" onClick={()=>editSubcategory(s)}>แก้ไข</button>
                    <label className="btn btn-ghost" style={{ cursor:'pointer' }}>
                      เลือกรูป
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={async (e)=>{
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          await chooseImage(s, f);
                        }}
                      />
                    </label>
                    <button className="btn btn-warn" disabled={!s.image_url} onClick={()=>clearImage(s)}>ล้างภาพ</button>
                    <button className="btn btn-danger" onClick={()=>deleteSubcategory(s)}>ลบ</button>
                  </td>
                  <td className="thumb-cell">
                    {s.image_url ? (
                      <img src={resolveUrl(s.image_url)} alt={s.subcategory_name} className="thumb-img" />
                    ) : (
                      <div className="thumb-placeholder">ไม่มีรูป</div>
                    )}
                  </td>
                  <td className="cell-actions" style={{ textAlign:'center' }}>
                    <button
                      className={`btn ${published ? 'btn-warn' : 'btn-primary'}`}
                      onClick={() => togglePublish(s.subcategory_id, published)}
                    >
                      {published ? 'ไม่แสดง' : 'แสดง'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {(!filteredSubcats || filteredSubcats.length === 0) && (
              <tr><td colSpan={6} style={{ color:'#777' }}>— ไม่มีหมวดย่อย —</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
