// [FRONTEND] src/admin/AdminCategories.js
// ✅ จัดการ "ประเภท" แยกหน้า
// - ลิสต์/เพิ่ม/แก้ไข/ลบ ประเภท
// - อัปโหลด/ล้างรูปประเภท
// - แสดง/ซ่อน (publish toggle) สำหรับประเภท
// - ตัวกรอง (ทั้งหมด/เฉพาะที่แสดง/เฉพาะที่ซ่อน)
// - ปุ่มกลับไปหน้าสินค้า

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import './ProductManagement.css'; // ใช้สไตล์เดิม
import { api, path } from '../lib/api';

const asStr = (v) => (v === null || v === undefined) ? '' : String(v);

// สร้าง URL รูป (ถ้า backend ส่งเป็น /uploads/... ให้ต่อ BASE ให้เป็น absolute)
const API_BASE = (api?.defaults?.baseURL) || process.env.REACT_APP_API_BASE || 'http://localhost:3001';
const ABS_BASE = String(API_BASE).replace(/\/+$/,'');
const resolveUrl = (u) => {
  if (!u) return '';
  const s = String(u);
  if (/^(https?:|blob:)/i.test(s)) return s;
  if (s.startsWith('/uploads/')) return `${ABS_BASE}${s}`;
  return s;
};

export default function AdminCategories() {
  const [categories, setCategories]   = useState([]);
  const [loading, setLoading]         = useState(false);
  const [catFilter, setCatFilter]     = useState('all'); // all | published | hidden
  const [newCat, setNewCat]           = useState({ category_id: '', category_name: '' });

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

  // อัปโหลดรูปประเภท
  async function uploadCategoryImage(file) {
    if (!file) return null;
    // เส้นทางหลัก
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post(path('/uploads/category-image'), fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res?.data?.url || res?.data?.imageUrl || null;
    } catch (e1) {
      // fallback: /upload
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await api.post(path('/upload'), fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        return res?.data?.url || res?.data?.imageUrl || res?.data?.path || null;
      } catch (e2) {
        throw e2;
      }
    }
  }

  // แสดง/ซ่อน (publish)
  async function togglePublish(categoryId, current) {
    try {
      await api.patch(path(`/admin/categories/${categoryId}/publish`), { is_published: !current });
      await fetchCategories();
    } catch (err) {
      handleApiError(err, '❌ อัปเดตการแสดงผลไม่สำเร็จ');
    }
  }

  // เพิ่มประเภท
  async function createCategory() {
    if (!newCat.category_name.trim()) return alert('ใส่ category_name ก่อน');
    try {
      await api.post(path('/categories'), {
        category_id:  newCat.category_id?.trim() || undefined,
        category_name: newCat.category_name.trim()
      });
      await fetchCategories();
      setNewCat({ category_id:'', category_name:'' });
    } catch (err) {
      handleApiError(err, '❌ เพิ่มประเภทไม่สำเร็จ');
    }
  }

  // แก้ไขชื่อประเภท
  async function editCategory(c) {
    const name = window.prompt('ชื่อประเภทใหม่', c.category_name);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === c.category_name) return;
    try {
      await api.put(path(`/categories/${c.category_id}`), { category_name: trimmed });
      await fetchCategories();
    } catch (err) {
      handleApiError(err, '❌ แก้ไขประเภทไม่สำเร็จ');
    }
  }

  // ลบประเภท
  async function deleteCategory(c) {
    if (!window.confirm(`ลบประเภท "${c.category_name}" ?`)) return;
    try {
      await api.delete(path(`/categories/${c.category_id}`));
      await fetchCategories();
    } catch (err) {
      handleApiError(err, '❌ ลบประเภทไม่สำเร็จ');
    }
  }

  // อัปโหลด/ล้างรูปภาพของประเภท
  async function chooseImage(c, file) {
    if (!file) return;
    try {
      const url = await uploadCategoryImage(file);
      if (!url) return alert('อัปโหลดไม่สำเร็จ');
      await api.put(path(`/categories/${c.category_id}`), { image_url: url });
      await fetchCategories();
    } catch (err) {
      handleApiError(err, '❌ อัปโหลด/บันทึกรูปประเภทไม่สำเร็จ');
    }
  }
  async function clearImage(c) {
    if (!window.confirm(`ล้างภาพของ "${c.category_name}" ใช่ไหม?`)) return;
    try {
      await api.put(path(`/categories/${c.category_id}`), { image_url: null });
      await fetchCategories();
    } catch (err) {
      handleApiError(err, '❌ ล้างภาพไม่สำเร็จ');
    }
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchCategories();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredCats = useMemo(() => {
    if (!Array.isArray(categories)) return [];
    return categories.filter(c => {
      const published = (typeof c.is_published === 'boolean') ? c.is_published : true;
      if (catFilter === 'published') return published;
      if (catFilter === 'hidden')    return !published;
      return true;
    });
  }, [categories, catFilter]);

  if (loading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;

  return (
    <div className="pm-page">
      {/* ปุ่มกลับหน้า "สินค้า" */}
      <div style={{display:'flex', gap:8, margin:'12px 0 20px', flexWrap:'wrap'}}>
        <Link to="/admin/products" className="btn btn-ghost">← กลับไปจัดการสินค้า</Link>
      </div>

      <h2>จัดการประเภท</h2>

      {/* ฟอร์มเพิ่มประเภท */}
      <div className="pm-actions mt-8" style={{ flexWrap:'wrap' }}>
        <input
          placeholder="category_id (เว้นได้ให้ระบบ gen)"
          value={newCat.category_id}
          onChange={(e)=>setNewCat({ ...newCat, category_id: e.target.value })}
          style={{ maxWidth:220 }}
        />
        <input
          placeholder="category_name"
          value={newCat.category_name}
          onChange={(e)=>setNewCat({ ...newCat, category_name: e.target.value })}
          style={{ minWidth:220 }}
        />
        <button type="button" className="btn btn-primary" onClick={createCategory}>
          เพิ่มประเภท
        </button>
      </div>

      {/* Toolbar: ฟิลเตอร์ */}
      <div className="pm-toolbar">
        <div className="seg">
          <button
            type="button"
            className={`seg-btn ${catFilter==='all' ? 'active': ''}`}
            onClick={()=>setCatFilter('all')}
            title="ดูทั้งหมด"
          >ทั้งหมด</button>
          <button
            type="button"
            className={`seg-btn ${catFilter==='published' ? 'active': ''}`}
            onClick={()=>setCatFilter('published')}
            title="เฉพาะที่แสดง"
          >เฉพาะที่แสดง</button>
          <button
            type="button"
            className={`seg-btn ${catFilter==='hidden' ? 'active': ''}`}
            onClick={()=>setCatFilter('hidden')}
            title="เฉพาะที่ซ่อน"
          >เฉพาะที่ซ่อน</button>
        </div>
      </div>

      {/* ตารางประเภท */}
      <div className="pm-table-wrap mt-8">
        <table className="pm-table pm-fixed">
          <colgroup>
            <col className="col-id" />
            <col className="col-name" />
            <col className="col-imgact" />
            <col className="col-thumb" />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อประเภท</th>
              <th style={{textAlign:'center'}}>จัดการ</th>
              <th style={{textAlign:'center'}}>รูป</th>
              <th style={{textAlign:'center'}}>แสดงผล</th>
            </tr>
          </thead>
          <tbody>
            {(filteredCats || []).map(c => {
              const published = (typeof c.is_published === 'boolean') ? c.is_published : true;
              return (
                <tr key={c.category_id}>
                  <td>{c.category_id}</td>
                  <td>
                    <span className={`pill ${published ? 'on' : 'off'}`}>
                      {published ? 'กำลังแสดง' : 'ถูกซ่อน'}
                    </span>
                    <span className="name-with-badges">{c.category_name}</span>
                  </td>

                  {/* จัดการ (แก้ไข/ลบ + อัปโหลด/ล้างภาพ) */}
                  <td className="action-stack">
                    <button className="btn btn-ghost" onClick={()=>editCategory(c)}>
                      แก้ไขชื่อ
                    </button>

                    <label className="btn btn-ghost" style={{ cursor:'pointer', textAlign:'center' }}>
                      เลือกรูป
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={async (e)=>{
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          await chooseImage(c, f);
                        }}
                      />
                    </label>

                    <button className="btn btn-warn" disabled={!c.image_url} onClick={()=>clearImage(c)}>
                      ล้างภาพ
                    </button>

                    <button className="btn btn-danger" onClick={()=>deleteCategory(c)}>
                      ลบประเภท
                    </button>
                  </td>

                  {/* รูป */}
                  <td className="thumb-cell">
                    {c.image_url ? (
                      <img src={resolveUrl(c.image_url)} alt={c.category_name} className="thumb-img" />
                    ) : (
                      <div className="thumb-placeholder">ไม่มีรูป</div>
                    )}
                  </td>

                  {/* แสดงผล */}
                  <td className="cell-actions" style={{ textAlign:'center' }}>
                    <button
                      className={`btn ${published ? 'btn-warn' : 'btn-primary'}`}
                      onClick={() => togglePublish(c.category_id, published)}
                      title={published ? 'ซ่อน' : 'แสดง'}
                    >
                      {published ? 'ไม่แสดง' : 'แสดง'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {(!filteredCats || filteredCats.length === 0) && (
              <tr><td colSpan={5} style={{ color:'#777' }}>— ไม่มีประเภท —</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
