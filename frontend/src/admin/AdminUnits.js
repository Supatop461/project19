// src/admin/AdminUnits.js
// ✅ หน่วยสินค้า (product_units) — ฝั่งแอดมิน
// Endpoints ใช้จริงตอนนี้:
//   GET    /api/admin/units[?only_visible=1]
//   POST   /api/admin/units
//   PUT    /api/admin/units/:code       // :code รองรับเลข id ได้
//   DELETE /api/admin/units/:code

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './admin-units.css';

const asStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const toArr = (x) => Array.isArray(x) ? x : (x ? [x] : []);
const uniq = (xs) => Array.from(new Set(xs));

/* ---------- Toggle Button Group (multi) ---------- */
function MultiToggle({ options, value = [], onChange }) {
  const set = new Set((value || []).map(String));
  const toggle = (id) => {
    const next = new Set(set);
    const key = String(id);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(Array.from(next));
  };
  return (
    <div className="mu-wrap">
      {options.map(opt => {
        const id = String(opt.value);
        const active = set.has(id);
        return (
          <button
            type="button"
            key={id}
            className={`mu-chip ${active ? 'is-active' : ''}`}
            onClick={() => toggle(id)}
            aria-pressed={active}
            title={opt.label}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- API helpers (ใช้ fetch โดยตรง) ---------- */
async function httpJSON(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw { status: res.status, response: { data: err } };
  }
  return res.json().catch(() => ({}));
}
const listUnits = async (params = {}) => {
  const qs = new URLSearchParams();
  if (params.only_visible) qs.set('only_visible', '1');
  const url = `/api/admin/units${qs.toString() ? `?${qs}` : ''}`;
  return httpJSON('GET', url);
};
const createUnitAPI = (payload) => httpJSON('POST', '/api/admin/units', payload);
const updateUnitAPI = (codeOrId, payload) => httpJSON('PUT', `/api/admin/units/${encodeURIComponent(codeOrId)}`, payload);
const deleteUnitAPI = (codeOrId) => httpJSON('DELETE', `/api/admin/units/${encodeURIComponent(codeOrId)}`);

/* หาคีย์สำหรับ row (code เป็นหลัก, ถ้าไม่มีค่อยใช้ unit_id/id) */
const unitKey = (u) => u?.code ?? (u?.unit_id ?? u?.id ?? '');

export default function AdminUnits() {
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState([]); // [{value,label}]
  const [units, setUnits] = useState([]);
  const [filter, setFilter] = useState('');
  const [onlyVisible, setOnlyVisible] = useState(false);

  const [form, setForm] = useState({
    code: '',
    unit_name: '',
    description: '',
    category_ids: [], // array of TEXT ids
  });
  const [editing, setEditing] = useState(null); // เก็บแถวที่กำลังแก้ไข (ใช้ code เป็นหลัก)

  // ====== focus helpers ======
  const formWrapRef = useRef(null);
  const unitNameInputRef = useRef(null);
  const focusForm = () => {
    const target = unitNameInputRef.current || formWrapRef.current;
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    unitNameInputRef.current?.focus({ preventScroll: true });
    formWrapRef.current?.classList.add('flash-focus');
    setTimeout(() => formWrapRef.current?.classList.remove('flash-focus'), 700);
  };

  /* ---------- helpers ---------- */
  const setField = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  function extractCategoryIds(u) {
    if (Array.isArray(u?.category_ids) && u.category_ids.length) {
      return u.category_ids.map(String);
    }
    if (Array.isArray(u?.categories) && u.categories.length) {
      return u.categories.map(c => String(c.category_id ?? c.id ?? c.code));
    }
    if (u?.category_id) return [String(u.category_id)];
    return [];
  }

  const isPublishedOn = (u) =>
    (u?.is_visible !== false) && (u?.is_active !== false) && (u?.is_published !== false);

  /* ---------- load categories + units ---------- */
  async function loadAll() {
    setLoading(true);
    try {
      // categories (published อย่างเดียว)
      const catRes = await fetch('/api/categories?published=1', { credentials: 'include' });
      const catJson = await catRes.json();
      const cats = (Array.isArray(catJson) ? catJson : []).map(c => ({
        value: String(c.category_id ?? c.id ?? c.code),
        label: `${c.category_id ?? c.id ?? c.code} — ${c.category_name ?? c.name}`,
      }));
      setCategories(cats);

      // units (admin list — alias ไป handler เดียวกับ /api/units)
      const data = await listUnits({ only_visible: onlyVisible ? 1 : undefined });
      setUnits(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      alert('โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function refreshUnits() {
    try {
      const data = await listUnits({ only_visible: onlyVisible ? 1 : undefined });
      setUnits(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      alert('โหลดรายการหน่วยไม่สำเร็จ');
    }
  }

  useEffect(() => { loadAll(); }, []);
  useEffect(() => { refreshUnits(); }, [onlyVisible]); // เปลี่ยน filter แล้วโหลดใหม่

  const rows = useMemo(() => {
    const q = asStr(filter).toLowerCase();
    return (units || []).filter(u =>
      !q ||
      asStr(u.code).toLowerCase().includes(q) ||
      asStr(u.unit_name).toLowerCase().includes(q) ||
      asStr(u.description).toLowerCase().includes(q)
    );
  }, [units, filter]);

  function startCreate() {
    setEditing(null);
    setForm({ code: '', unit_name: '', description: '', category_ids: [] });
    setTimeout(focusForm, 0);
  }

  function startEdit(u) {
    setEditing(u);
    setForm({
      code: asStr(u.code),
      unit_name: asStr(u.unit_name),
      description: asStr(u.description),
      category_ids: extractCategoryIds(u),
    });
    setTimeout(focusForm, 0);
  }

  async function doSubmit(e) {
    e?.preventDefault?.();
    const ids = uniq(toArr(form.category_ids).map(String));
    const codeLower = asStr(form.code).toLowerCase();

    const payload = {
      code: codeLower,
      unit_name: asStr(form.unit_name),
      description: asStr(form.description) || null,
      // backend รองรับทั้ง category_id/ids ถ้ามีคอลัมน์
      category_id: ids.length ? ids[0] : null,
      category_ids: ids,
    };

    if (!payload.code || !payload.unit_name) {
      alert('กรอก code และ unit name ให้ครบ');
      return;
    }

    setLoading(true);
    try {
      if (editing?.code) {
        await updateUnitAPI(editing.code, payload);
      } else {
        await createUnitAPI(payload);
      }
      await refreshUnits();
      setEditing(null);
      setForm({ code: '', unit_name: '', description: '', category_ids: [] });
    } catch (e2) {
      console.error(e2);
      const msg = e2?.response?.data?.message || e2?.response?.data?.error || 'บันทึกไม่สำเร็จ';
      alert(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(row) {
    const key = unitKey(row);
    if (!key) return alert('ไม่พบรหัสหน่วยที่จะลบ');
    if (!window.confirm(`ลบหน่วย ${row.code || row.unit_name}?`)) return;
    setLoading(true);
    try {
      await deleteUnitAPI(key);
      await refreshUnits();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || e?.response?.data?.error || 'ลบไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  async function onTogglePublish(row) {
    const key = unitKey(row);
    if (!key) return;
    setLoading(true);
    try {
      const next = !isPublishedOn(row);
      await updateUnitAPI(key, { is_published: next });
      await refreshUnits();
    } catch (e) {
      console.error(e);
      alert(e?.response?.data?.message || e?.response?.data?.error || 'อัปเดตสถานะเผยแพร่ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <p><Link to="/admin">← กลับไปจัดการสินค้า</Link></p>
        <h2>จัดการหน่วยสินค้า (จากฐานข้อมูล)</h2>
      </div>

      {/* ───────────── Toolbar ───────────── */}
      <div className="card" style={{ marginBottom: 12, padding: 12 }}>
        <div className="toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="search"
            placeholder="ค้นหา: code / unit_name / description"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: 1, minWidth: 240 }}
          />
          <label className="chk" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={onlyVisible}
              onChange={(e) => setOnlyVisible(e.target.checked)}
            />
            เฉพาะที่แสดงผล (visible)
          </label>
          <button onClick={refreshUnits} disabled={loading}>รีเฟรช</button>
          <button className="btn-primary" onClick={startCreate} disabled={loading}>+ เพิ่มหน่วย</button>
        </div>
      </div>

      {/* ───────────── Form ───────────── */}
      <form ref={formWrapRef} className="card unit-form-card" onSubmit={doSubmit} autoComplete="off">
        <div className="form-row">
          <label>code (เช่น: piece, pot) [a-z]</label>
          <input
            value={form.code}
            onChange={e => setField('code', e.target.value)}
            placeholder="เช่น pot, bag, kg"
            disabled={!!editing?.code} /* กำลังแก้ไข ห้ามแก้ code เพื่อลดปัญหา duplicate */
          />
        </div>

        <div className="form-row">
          <label>unit name (เช่น: ชิ้น, กระถาง)</label>
          <input
            ref={unitNameInputRef}
            value={form.unit_name}
            onChange={e => setField('unit_name', e.target.value)}
            placeholder="ชื่อหน่วย"
          />
        </div>

        <div className="form-row">
          <label>หมวด (กดเลือกได้หลายค่า)</label>
          <MultiToggle
            options={categories}
            value={form.category_ids}
            onChange={(ids) => setField('category_ids', ids)}
          />
          <small className="hint">กดปุ่มเพื่อเลือก/ยกเลิก (หลายค่าได้)</small>
        </div>

        <div className="form-row">
          <label>description (ถ้ามี)</label>
          <textarea
            value={form.description}
            onChange={e => setField('description', e.target.value)}
            placeholder="บันทึกเพิ่มเติม"
            rows={2}
          />
        </div>

        <div className="actions">
          <button type="submit" className="btn-primary" disabled={loading}>
            {editing ? 'บันทึกการแก้ไข' : 'เพิ่มหน่วยสินค้า'}
          </button>
          {editing && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { setEditing(null); setForm({ code: '', unit_name: '', description: '', category_ids: [] }); }}
              disabled={loading}
            >
              ยกเลิกแก้ไข
            </button>
          )}
        </div>
      </form>

      {/* ───────────── Units Table ───────────── */}
      <div className="table card">
        <div className="table-scroll">
          <table className="tbl-units">
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className="txt-left">code</th>
                <th className="txt-left">unit_name</th>
                <th className="txt-left">category_ids</th>
                <th className="txt-left">สถานะ</th>
                <th className="txt-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const ids = extractCategoryIds(u);
                const on = isPublishedOn(u);
                const key = unitKey(u);
                return (
                  <tr key={key || u.code}>
                    <td className="mono">{u.code || '-'}</td>
                    <td className="wrap">{u.unit_name || '-'}</td>
                    <td>
                      {ids.length ? (
                        <div className="badges">
                          {ids.map((id) => (
                            <span className="badge" key={id}>{id}</span>
                          ))}
                        </div>
                      ) : <span className="muted">-</span>}
                    </td>
                    <td>
                      <span className={on ? 'badge on' : 'badge off'}>
                        {on ? 'เผยแพร่' : 'ถูกซ่อน'}
                      </span>
                    </td>
                    <td className="actions-cell">
                      <button className="btn-chip" onClick={() => startEdit(u)}>แก้ไข</button>
                      <button className="btn-chip danger" onClick={() => onDelete(u)}>ลบ</button>
                      <button className={on ? 'btn-chip muted' : 'btn-chip primary'} onClick={() => onTogglePublish(u)}>
                        {on ? 'ซ่อน' : 'เผยแพร่'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                    ไม่พบข้อมูล
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
