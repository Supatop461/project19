// src/account/Addresses.js
// จัดการที่อยู่ผู้ใช้ (CRUD + default) — พรีฟิลจากตอนสมัครสมาชิกถ้ายังไม่มีที่อยู่
import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ThaiAddressPicker from '../components/ThaiAddressPicker';

const S = {
  page:   { maxWidth: 980, margin: '0 auto', padding: 24 },
  topbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  backBtn:{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fafafa', cursor: 'pointer' },
  card:   { background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: 16 },
  h2:     { margin: '0 0 12px', fontSize: 20 },
  grid2:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' },
  grid3:  { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'start' },
  label:  { fontSize: 12, color: '#555', marginBottom: 6 },
  input:  { padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, width: '100%' },
  row:    { display: 'flex', gap: 8, alignItems: 'center' },
  btn:    { padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: '#fafafa', cursor: 'pointer' },
  btnPri: { padding: '8px 12px', borderRadius: 8, border: '1px solid #2f7', background: '#19d28f', color: '#fff', cursor: 'pointer' },
  btnWarn:{ padding: '8px 12px', borderRadius: 8, border: '1px solid #f77', background: '#ff4d4f', color: '#fff', cursor: 'pointer' },
  list:   { display: 'grid', gap: 12, marginTop: 16 },
  badge:  { fontSize: 12, padding: '2px 6px', borderRadius: 6, background: '#f0f9f5', border: '1px solid #cfeede', color: '#0d7a52' },
};

export default function Addresses() {
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);

  // เก็บ *_code ไว้เพื่อให้ ThaiAddressPicker พรีเลือกได้แม่น
  const [form, setForm] = useState({
    label: '',
    recipient_name: '',
    phone: '',
    line1: '',
    line2: '',
    province: '',
    province_code: null,
    district: '',
    district_code: null,
    subdistrict: '',
    subdistrict_code: null,
    postal_code: '',
    country: 'TH',
    is_default: false,
  });

  /* ------------------------- FIX เล็กๆ: axiosClient รองรับหลาย token key + เดา baseURL อัตโนมัติ ------------------------- */
  const axiosClient = useMemo(() => {
    // รองรับชื่อ key ที่ทีมอื่นๆ อาจใช้
    const token =
      localStorage.getItem('token') ||
      localStorage.getItem('access_token') ||
      localStorage.getItem('jwt') ||
      '';

    // ลำดับการเดา baseURL:
    // 1) .env: REACT_APP_API_BASE
    // 2) ใช้ origin ตอนนี้แล้วแทนพอร์ตเป็น 3001 (สำหรับ dev)
    // 3) ค่าเดิมใน axios.defaults.baseURL
    // 4) 'http://localhost:3001'
    const envBase = process.env.REACT_APP_API_BASE;
    const guessFromOrigin = (() => {
      try {
        const u = new URL(window.location.href);
        // ถ้า dev บน 3000 ให้เดาเป็น 3001
        const port = u.port === '3000' ? '3001' : (u.port || '3001');
        return `${u.protocol}//${u.hostname}:${port}`;
      } catch {
        return null;
      }
    })();

    const base =
      envBase ||
      guessFromOrigin ||
      axios.defaults.baseURL ||
      'http://localhost:3001';

    return axios.create({
      baseURL: base, // เรียกด้วย path /api/...
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 15000,
    });
  }, []);

  /* ------------------------- โหลดรายการที่อยู่ของผู้ใช้ ------------------------- */
  async function fetchList() {
    setLoading(true);
    try {
      const res = await axiosClient.get('/api/addresses/me');
      const data = Array.isArray(res.data?.items) ? res.data.items : res.data;
      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => Number(b?.is_default) - Number(a?.is_default))
        : [];
      setRows(sorted);
      return sorted;
    } catch (e) {
      console.error('fetch addresses error:', e);
      alert(e?.response?.data?.error || 'ดึงรายการไม่สำเร็จ');
      return [];
    } finally {
      setLoading(false);
    }
  }

  /* ------------------------- พรีฟิลจากข้อมูลตอนสมัคร ------------------------- */
  async function tryPrefillFromSignup() {
    try {
      const endpoints = ['/api/me'];
      let me = null;
      for (const url of endpoints) {
        try {
          const r = await axiosClient.get(url);
          if (r?.data) { me = r.data; break; }
        } catch (_) {}
      }
      if (!me) return;

      const asStr = (v) => (v==null ? '' : String(v));

      const fullName =
        asStr(me.recipient_name) ||
        asStr(me.full_name) ||
        [asStr(me.first_name), asStr(me.last_name)].filter(Boolean).join(' ').trim() ||
        asStr(me.name);

      const phone =
        asStr(me.phone) ||
        asStr(me.phone_number) ||
        '';

      const line1 =
        asStr(me.line1) || asStr(me.address_line1) || asStr(me.address) || asStr(me.address1) || asStr(me.street) || '';

      const line2 =
        asStr(me.line2) || asStr(me.address_line2) || asStr(me.address2) || asStr(me.building) || '';

      const province    = asStr(me.province)    || '';
      const district    = asStr(me.district)    || asStr(me.amphure) || '';
      const subdistrict = asStr(me.subdistrict) || asStr(me.tambon)  || '';
      const postalCode  =
        asStr(me.postal_code) || asStr(me.zip) || asStr(me.zipcode) || asStr(me.postcode) || '';

      setForm(f => ({
        ...f,
        recipient_name: fullName || f.recipient_name,
        phone: phone || f.phone,
        line1: line1 || f.line1,
        line2: line2 || f.line2,
        province: province || f.province,
        district: district || f.district,
        subdistrict: subdistrict || f.subdistrict,
        postal_code: postalCode || f.postal_code,
        country: 'TH',
      }));
    } catch (_) { /* เงียบไว้ */ }
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      const items = await fetchList();
      if (mounted && (!items || items.length === 0)) {
        await tryPrefillFromSignup();
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditingId(null);
    setSaving(false);
    setForm({
      label: '',
      recipient_name: '',
      phone: '',
      line1: '',
      line2: '',
      province: '',
      province_code: null,
      district: '',
      district_code: null,
      subdistrict: '',
      subdistrict_code: null,
      postal_code: '',
      country: 'TH',
      is_default: false,
    });
  }

  const normalizedPhone = useMemo(
    () => (form.phone || '').replace(/\D/g, ''),
    [form.phone]
  );

  function validate() {
    if (!form.recipient_name.trim()) return 'กรุณากรอกชื่อผู้รับ';
    if (!normalizedPhone || normalizedPhone.length < 9 || normalizedPhone.length > 10)
      return 'กรุณากรอกเบอร์โทรให้ถูกต้อง (9–10 หลัก)';
    if (!form.line1.trim()) return 'กรุณากรอกที่อยู่ (บรรทัด 1)';
    if (!form.province) return 'กรุณาเลือกจังหวัด';
    if (!form.district) return 'กรุณาเลือกอำเภอ/เขต';
    if (!form.subdistrict) return 'กรุณาเลือกตำบล/แขวง';
    if (!form.postal_code) return 'ไม่พบรหัสไปรษณีย์ (โปรดเลือกตำบล/แขวงใหม่อีกครั้ง)';
    return '';
  }

  /* ------------------------- สร้าง/แก้ไขที่อยู่ ------------------------- */
  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) return alert(err);

    setSaving(true);
    try {
      const payload = {
        ...form,
        phone: normalizedPhone,
        country: 'TH',
      };
      if (editingId) {
        await axiosClient.put(`/api/addresses/${editingId}`, payload); // เเก้ไข
      } else {
        await axiosClient.post('/api/addresses', payload);  // เพิ่มใหม่
      }
      resetForm();
      await fetchList();
    } catch (e) {
      alert(e?.response?.data?.error || 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------- กดแก้ไข/ลบ/ตั้ง default ------------------------- */
  function handleEdit(a) {
    setEditingId(a.address_id);
    setForm({
      label: a.label || '',
      recipient_name: a.recipient_name || '',
      phone: a.phone || '',
      line1: a.line1 || '',
      line2: a.line2 || '',
      province: a.province || '',
      province_code: a.province_code ?? null,
      district: a.district || '',
      district_code: a.district_code ?? null,
      subdistrict: a.subdistrict || '',
      subdistrict_code: a.subdistrict_code ?? null,
      postal_code: a.postal_code || '',
      country: 'TH',
      is_default: !!a.is_default,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(a) {
    if (!window.confirm('ลบที่อยู่นี้ใช่ไหม?')) return;
    try {
      await axiosClient.delete(`/api/addresses/${a.address_id}`);  // ลบ
      if (editingId === a.address_id) resetForm();
      await fetchList();
    } catch (e) {
      alert(e?.response?.data?.error || 'ลบไม่สำเร็จ');
    }
  }

  async function setDefault(a) {
    try {
      await axiosClient.patch(`/api/addresses/${a.address_id}/default`);  // ค่าเริ่มต้นที่อยู่
      await fetchList();
    } catch (e) {
      alert(e?.response?.data?.error || 'ตั้งค่าเริ่มต้นไม่สำเร็จ');
    }
  }

  return (
    <div style={S.page}>
      {/* ===== ปุ่มกลับไปหน้าโปรไฟล์ ===== */}
      <div style={S.topbar}>
        <button
          type="button"
          onClick={() => navigate(-1)}  // ถ้าอยากบังคับไปหน้า Home ใช้ navigate('/')
          style={S.backBtn}
        >
          ← กลับไปหน้าโปรไฟล์
        </button>
      </div>

      <div style={S.card}>
        <h2 style={S.h2}>{editingId ? 'แก้ไขที่อยู่' : 'เพิ่มที่อยู่ใหม่'}</h2>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          {/* ชื่อเรียก */}
          <div>
            <div style={S.label}>ชื่อเรียก (บ้าน/คอนโด)</div>
            <input
              style={S.input}
              placeholder="เช่น ที่บ้าน / ที่ทำงาน"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              autoComplete="address-line3"
            />
          </div>

          {/* ผู้รับ + โทร */}
          <div style={S.grid2}>
            <div>
              <div style={S.label}>ชื่อผู้รับ *</div>
              <input
                style={S.input}
                placeholder="ชื่อ-นามสกุล"
                value={form.recipient_name}
                onChange={e => setForm(f => ({ ...f, recipient_name: e.target.value }))}
                autoComplete="name"
                required
              />
            </div>
            <div>
              <div style={S.label}>เบอร์โทร *</div>
              <input
                style={S.input}
                placeholder="0XXXXXXXXX"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                inputMode="numeric"
                pattern="[0-9\\s\\-()+]*"
                autoComplete="tel"
                required
              />
            </div>
          </div>

          {/* ที่อยู่บรรทัด 1/2 */}
          <div style={S.grid2}>
            <div>
              <div style={S.label}>ที่อยู่ (บรรทัด 1) *</div>
              <input
                style={S.input}
                name="line1"
                placeholder="เช่น 52/45 หมู่ 6 ซอย..., ถนน..."
                value={form.line1}
                onChange={e => setForm(f => ({ ...f, line1: e.target.value }))}
                autoComplete="address-line1"
                required
              />
            </div>
            <div>
              <div style={S.label}>รายละเอียดเพิ่มเติม (บรรทัด 2)</div>
              <input
                style={S.input}
                name="line2"
                placeholder="เช่น อาคาร/ชั้น/ห้อง หรือ หมายเหตุให้คนส่ง"
                value={form.line2}
                onChange={e => setForm(f => ({ ...f, line2: e.target.value }))}
                autoComplete="address-line2"
              />
            </div>
          </div>

          {/* จังหวัด/อำเภอ/ตำบล + ไปรษณีย์ */}
          <div style={S.grid3}>
            <div>
              <div style={S.label}>จังหวัด / อำเภอ / ตำบล *</div>
              <ThaiAddressPicker
                // ✅ โปรเจกต์นี้ไฟล์อยู่ frontend/public/data
                basePath="/data"
                basePathCandidates={['/data']} // ตัดการลองพาธอื่น เพื่อลดการยิงซ้ำ
                value={form}
                onChange={patch => setForm(f => ({ ...f, ...patch }))}
              />
            </div>
            <div>
              <div style={S.label}>รหัสไปรษณีย์ *</div>
              <input
                style={S.input}
                placeholder="ไปรษณีย์"
                value={form.postal_code}
                onChange={e => setForm(f => ({ ...f, postal_code: e.target.value }))}
                readOnly   // ให้ ThaiAddressPicker เติมอัตโนมัติเมื่อเลือก "ตำบล"
                autoComplete="postal-code"
                required
              />
            </div>
            <div style={{ alignSelf: 'end' }}>
              <label style={{ ...S.row, gap: 10 }}>
                <input
                  type="checkbox"
                  checked={form.is_default}
                  onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))}
                />
                ตั้งเป็นที่อยู่เริ่มต้น
              </label>
            </div>
          </div>

          <div style={S.row}>
            <button type="submit" style={S.btnPri} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : (editingId ? 'อัปเดตที่อยู่' : 'เพิ่มที่อยู่')}
            </button>
            {editingId && (
              <button type="button" style={S.btn} onClick={resetForm} disabled={saving}>
                ยกเลิก
              </button>
            )}
          </div>
        </form>
      </div>

      {/* รายการที่อยู่ */}
      <div style={{ marginTop: 24 }}>
        <h2 style={S.h2}>ที่อยู่ของฉัน</h2>
        {loading ? (
          <div style={S.card}>กำลังโหลด...</div>
        ) : rows.length === 0 ? (
          <div style={S.card}>ยังไม่มีที่อยู่</div>
        ) : (
          <div style={S.list}>
            {rows.map(a => (
              <div key={a.address_id} style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {a.recipient_name || '-'} {a.is_default && <span style={{ ...S.badge, marginLeft: 8 }}>ค่าเริ่มต้น</span>}
                    </div>
                    <div style={{ color: '#666', marginTop: 2 }}>{a.phone || '-'}</div>
                    <div style={{ marginTop: 8 }}>
                      {a.line1}{a.line2 ? `, ${a.line2}` : ''}
                      <div>{[a.subdistrict, a.district, a.province].filter(Boolean).join(', ')}</div>
                      <div>{a.postal_code}</div>
                    </div>
                    {a.label && <div style={{ color: '#888', fontSize: 12, marginTop: 6 }}>{a.label}</div>}
                  </div>

                  <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
                    {!a.is_default && (
                      <button style={S.btn} onClick={() => setDefault(a)}>ตั้งเป็นค่าเริ่มต้น</button>
                    )}
                    <button style={S.btn} onClick={() => handleEdit(a)}>แก้ไข</button>
                    <button style={S.btnWarn} onClick={() => handleDelete(a)}>ลบ</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
