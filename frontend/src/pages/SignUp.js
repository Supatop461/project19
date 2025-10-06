// FRONTEND: src/pages/SignUp.js
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './SignUp.css';

/* NOTE: ตั้งค่า API baseURL/paths ผ่าน .env ได้
   REACT_APP_API_URL=http://localhost:8080
   REACT_APP_REGISTER_PATH=/auth/register
   REACT_APP_LOGIN_PATH=/auth/login
*/
axios.defaults.baseURL = process.env.REACT_APP_API_URL || axios.defaults.baseURL || '';
axios.defaults.headers.common['Content-Type'] = 'application/json';

export default function SignUp() {
  const nav = useNavigate();

  // ====== Form state (เก็บรหัส code) ======
  const [form, setForm] = useState({
    email: '', password: '', confirm: '',
    first_name: '', last_name: '',
    phone: '', houseNo: '',
    province_code: '', amphoe_code: '', tambon_code: '',
    gender: '',
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ====== แหล่งข้อมูลที่อยู่ ======
  const [db, setDb] = useState(null);          // ไฟล์ในโปรเจ็กต์
  const [addrLoadErr, setAddrLoadErr] = useState('');
  const [fallback, setFallback] = useState(null); // { provinces, amphures, tambons } จาก mirror

  // --- โหลดไฟล์ในโปรเจ็กต์ (ถ้ามี) ---
  useEffect(() => {
    (async () => {
      try {
        const url = `${process.env.PUBLIC_URL}/data/thai-address.min.json`;
        const res = await fetch(url);
        const json = await res.json();
        setDb(json);
      } catch (e) {
        console.error(e);
        setAddrLoadErr('โหลดฐานข้อมูลที่อยู่ไม่สำเร็จ');
      }
    })();
  }, []);

  // --- โหลด fallback จากหลาย mirror พร้อมกัน ใครมาก่อนใช้คนนั้น ---
  const MIRRORS = {
    province: [
      `${process.env.PUBLIC_URL}/data/api_province.json`,
      'https://cdn.jsdelivr.net/gh/kongvut/thai-province-data@master/api_province.json',
      'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api_province.json',
    ],
    amphure: [
      `${process.env.PUBLIC_URL}/data/api_amphure.json`,
      'https://cdn.jsdelivr.net/gh/kongvut/thai-province-data@master/api_amphure.json',
      'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api_amphure.json',
    ],
    tambon: [
      `${process.env.PUBLIC_URL}/data/api_tambon.json`,
      'https://cdn.jsdelivr.net/gh/kongvut/thai-province-data@master/api_tambon.json',
      'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api_tambon.json',
    ],
  };
  const fetchFirstOk = async (urls) => {
    for (const u of urls) {
      try { const r = await fetch(u); if (r.ok) return await r.json(); } catch { /* next */ }
    }
    return null;
  };
  useEffect(() => {
    (async () => {
      const [prov, amph, tamb] = await Promise.all([
        fetchFirstOk(MIRRORS.province),
        fetchFirstOk(MIRRORS.amphure),
        fetchFirstOk(MIRRORS.tambon),
      ]);
      if (prov && amph && tamb) setFallback({ provinces: prov, amphures: amph, tambons: tamb });
    })();
  }, []); // ยิงทันที ไม่ต้องรอ db

  // ====== Helpers ======
  const toArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  const pickName = (o) => (o && (o.name_th ?? o.name ?? o.label ?? o.PROVINCE_NAME_TH ?? o.AMPHOE_NAME_TH ?? o.TAMBON_NAME_TH)) || String(o);
  const pickCode = (o) => (o && (o.code ?? o.id ?? o.value ?? o.province_code ?? o.amphoe_code ?? o.tambon_code ?? o.PROVINCE_CODE ?? o.AMPHOE_CODE ?? o.TAMBON_CODE)) || pickName(o);
  const normList = (raw) => toArray(raw).map((it) => (typeof it === 'object'
    ? { code: String(pickCode(it)), name_th: pickName(it), zip: it.zip ?? it.zipcode ?? it.postal_code ?? it.postcode ?? '' }
    : { code: String(it), name_th: String(it), zip: '' }
  ));

  const extractProvinces = (dbObj) => {
    const pv = dbObj?.provinces || dbObj?.province || dbObj?.prov;
    if (!pv) return [];
    if (Array.isArray(pv)) return normList(pv);
    const vals = Object.values(pv);
    const looksProvince = (v) => typeof v === 'string' || !!(v && (v.name_th || v.name || v.PROVINCE_NAME_TH || v.code || v.PROVINCE_CODE));
    const flattened = vals.flatMap((v) => (looksProvince(v) ? [v] : Object.values(v || {})));
    return normList(flattened).sort((a, b) => a.name_th.localeCompare(b.name_th, 'th'));
  };
  const extractAmphoes = (dbObj, provCode) => {
    const raw =
      dbObj?.districts?.[provCode] ||
      dbObj?.amphoes?.[provCode] ||
      dbObj?.districts_by_province?.[provCode] ||
      dbObj?.amphoesByProvince?.[provCode];
    return normList(raw).sort((a, b) => a.name_th.localeCompare(b.name_th, 'th'));
  };
  const extractTambons = (dbObj, provCode, amphCode) => {
    const raw =
      dbObj?.subdistricts?.[provCode]?.[amphCode] ||
      dbObj?.tambons?.[provCode]?.[amphCode] ||
      dbObj?.subdistricts_by_amphoe?.[provCode]?.[amphCode] ||
      dbObj?.tambonsByAmphoe?.[provCode]?.[amphCode];
    return normList(raw).sort((a, b) => a.name_th.localeCompare(b.name_th, 'th'));
  };

  // ====== เลือกแหล่งข้อมูลจังหวัดที่ “สมบูรณ์กว่า” อัตโนมัติ ======
  const addrSource = useMemo(() => {
    const fromDb = db ? extractProvinces(db) : [];
    const fromFb = fallback ? fallback.provinces.map(p => ({ code: String(p.id), name_th: p.name_th })) : [];
    const useFb = fromFb.length > fromDb.length;
    const provinces = (useFb ? fromFb : fromDb).sort((a, b) => a.name_th.localeCompare(b.name_th, 'th'));
    return { useFb, provinces };
  }, [db, fallback]);

  const provinces = addrSource.provinces;

  const amphoes = useMemo(() => {
    if (!form.province_code) return [];
    if (addrSource.useFb && fallback) {
      const list = fallback.amphures.filter(a => String(a.province_id) === String(form.province_code));
      return list.map(a => ({ code: String(a.id), name_th: a.name_th }))
                 .sort((x, y) => x.name_th.localeCompare(y.name_th, 'th'));
    }
    return db ? extractAmphoes(db, form.province_code) : [];
  }, [addrSource.useFb, fallback, db, form.province_code]);

  const tambons = useMemo(() => {
    if (!form.amphoe_code) return [];
    if (addrSource.useFb && fallback) {
      const list = fallback.tambons.filter(t => String(t.amphure_id) === String(form.amphoe_code));
      return list.map(t => ({ code: String(t.id), name_th: t.name_th, zip: String(t.zip_code || '') }))
                 .sort((x, y) => x.name_th.localeCompare(y.name_th, 'th'));
    }
    return db ? extractTambons(db, form.province_code, form.amphoe_code) : [];
  }, [addrSource.useFb, fallback, db, form.province_code, form.amphoe_code]);

  const zipcode = useMemo(() => tambons.find(x => x.code === form.tambon_code)?.zip || '', [tambons, form.tambon_code]);

  // ====== Validation / helpers ======
  const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || '').trim());
  const pwMismatch = form.password && form.confirm && form.password !== form.confirm;
  const makeUsername = (email) => {
    const raw = String(email).split('@')[0] || '';
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9_.-]/g, '');
    return cleaned || `cust${Date.now().toString().slice(-6)}`;
  };
  const findName = (list, code) => list.find(x => String(x.code) === String(code))?.name_th || '';

  const getServerMessage = (err) => {
    if (!err?.response) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (Network/CORS) — ตรวจค่า REACT_APP_API_URL หรือ proxy';
    const d = err.response.data;
    const code = err.response.status;
    const raw =
      d?.error || d?.message || d?.msg ||
      (Array.isArray(d?.errors) && d.errors.map(e => e.msg || e.message).filter(Boolean).join(', ')) ||
      (typeof d === 'string' ? d : '');
    if (code === 409) return raw || 'อีเมลนี้ถูกใช้แล้ว';
    if (code === 422) return raw || 'ข้อมูลไม่ผ่านการตรวจสอบ (422)';
    if (code === 400) return raw || 'คำขอไม่ถูกต้อง (400)';
    if (code === 401) return raw || 'ไม่ได้รับอนุญาต (401)';
    if (code === 404) return raw || 'ปลายทางไม่พบ (404)';
    if (code >= 500) return raw || 'เซิร์ฟเวอร์มีปัญหา (5xx)';
    return raw || 'สมัครสมาชิกไม่สำเร็จ';
  };

  // ====== Handlers ======
  const onChange = (e) => {
    const { name, value } = e.target;
    if (name === 'province_code') return setForm(p => ({ ...p, province_code: value, amphoe_code: '', tambon_code: '' }));
    if (name === 'amphoe_code')   return setForm(p => ({ ...p, amphoe_code: value, tambon_code: '' }));
    setForm(p => ({ ...p, [name]: value }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (loading) return;
    setError('');

    if (!isEmail(form.email)) return setError('กรุณากรอกอีเมลให้ถูกต้อง');
    if (form.password.length < 8) return setError('รหัสผ่านอย่างน้อย 8 ตัวอักษร');
    if (pwMismatch) return setError('ยืนยันรหัสผ่านไม่ตรงกัน');

    const required = ['first_name', 'last_name', 'phone', 'houseNo', 'province_code', 'amphoe_code', 'tambon_code'];
    if (required.some(k => !String(form[k]).trim())) return setError('กรุณากรอกข้อมูลให้ครบถ้วน');

    const first_name = form.first_name.trim();
    const last_name  = form.last_name.trim();
    const provName = findName(provinces, form.province_code) || form.province_code;
    const amphName = findName(amphoes, form.amphoe_code) || form.amphoe_code;
    const tambName = findName(tambons, form.tambon_code) || form.tambon_code;
    const address = `${form.houseNo} ต.${tambName} อ.${amphName} จ.${provName} ${zipcode || ''}`.trim();

    const payload = {
      first_name, last_name,
      full_name: `${first_name} ${last_name}`.trim(),   // เผื่อแบ็กเอนด์ต้องการ full_name
      email: form.email.trim(),
      username: makeUsername(form.email),
      password: form.password,
      confirm_password: form.confirm,
      password_confirmation: form.confirm,
      phone_number: form.phone.trim(),
      phone: form.phone.trim(),
      address,
      province_code: form.province_code, province: provName,
      amphoe_code: form.amphoe_code,     amphoe: amphName,
      tambon_code: form.tambon_code,     tambon: tambName,
      zipcode,
      gender: form.gender || undefined,
      role: 'customer',
    };

    try {
      setLoading(true);
      const registerPath = process.env.REACT_APP_REGISTER_PATH || '/auth/register';
      const loginPath = process.env.REACT_APP_LOGIN_PATH || '/auth/login';

      const res = await axios.post(registerPath, payload);

      let token = res?.data?.token || res?.data?.accessToken || res?.data?.jwt || res?.data?.data?.token;
      if (!token) {
        const login = await axios.post(loginPath, { email: form.email, password: form.password });
        token = login?.data?.token || login?.data?.accessToken || login?.data?.jwt || login?.data?.data?.token;
      }
      if (token) {
        localStorage.setItem('token', token);
        localStorage.setItem('role', res?.data?.user?.role || 'customer');
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      }
      nav('/', { replace: true });
    } catch (err) {
      console.error('register error:', err?.response?.status, err?.response?.data);
      setError(getServerMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // ====== UI ======
  return (
    <div className="signup-page">
      <div className="signup-hero">
        <div className="notch">
          <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="PRACH MAEJO" />
        </div>
      </div>

      <div className="brand-head">
        <div className="brand-line">
          <span className="brand">PRACH MAEJO</span>
          <span className="online">ONLINE</span>
        </div>
        <h2>สร้างบัญชี / สมัครสมาชิก</h2>
      </div>

      <form className="signup-form" onSubmit={onSubmit} noValidate>
        {/* NOTE: อีเมลให้กินเต็มบรรทัดบน (span-2) */}
        <label className="field col span-2">
          <span className="label">อีเมล</span>
          <input type="email" name="email" placeholder="กรอกอีเมลที่ใช้งานได้จริง" value={form.email} onChange={onChange} />
        </label>

        {/* NOTE: ทำให้รหัสผ่าน + ยืนยันรหัสผ่านอยู่บรรทัดเดียวกัน */}
        <label className="field col">
          <span className="label">รหัสผ่าน</span>
          <div className="pw-wrap">
            <input
              type={showPw ? 'text' : 'password'}
              name="password"
              placeholder="อย่างน้อย 8 ตัวอักษร"
              value={form.password}
              onChange={onChange}
              className={pwMismatch ? 'is-invalid' : ''}
            />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(s => !s)}>
              {showPw ? '👁️' : '🙈'}
            </button>
          </div>
        </label>

        <label className="field col">
          <span className="label">ยืนยันรหัสผ่าน</span>
          <input
            type={showPw ? 'text' : 'password'}
            name="confirm"
            placeholder="พิมพ์รหัสผ่านเดิมอีกครั้ง"
            value={form.confirm}
            onChange={onChange}
            className={pwMismatch ? 'is-invalid' : ''}
          />
          {pwMismatch && <div className="hint-error">รหัสผ่านไม่ตรงกัน</div>}
        </label>

        {/* ชื่อ & นามสกุล (บรรทัดถัดไป) */}
        <label className="field col">
          <span className="label">ชื่อ</span>
          <input type="text" name="first_name" placeholder="กรอกชื่อ" value={form.first_name} onChange={onChange} />
        </label>

        <label className="field col">
          <span className="label">นามสกุล</span>
          <input type="text" name="last_name" placeholder="กรอกนามสกุล" value={form.last_name} onChange={onChange} />
        </label>

        {/* เบอร์โทร */}
        <label className="field col">
          <span className="label">เบอร์ติดต่อ</span>
          <input type="tel" name="phone" placeholder="กรอกเบอร์โทรที่สามารถติดต่อได้" value={form.phone} onChange={onChange} />
        </label>

        {/* ที่อยู่ */}
        <div className="col span-2">
          <span className="label">ที่อยู่</span>
          {!!addrLoadErr && <div className="hint-error" style={{ marginBottom: 8 }}>{addrLoadErr}</div>}

          <div className="addr-grid">
            <input type="text" name="houseNo" placeholder="บ้านเลขที่ / หมู่ / อาคาร (ถ้ามี)" value={form.houseNo} onChange={onChange} />

            <select name="province_code" value={form.province_code} onChange={onChange} disabled={!provinces.length}>
              <option value="">{provinces.length ? '— เลือกจังหวัด —' : 'กำลังโหลดจังหวัด...'}</option>
              {provinces.map(p => <option key={p.code} value={p.code}>{p.name_th}</option>)}
            </select>

            <select name="amphoe_code" value={form.amphoe_code} onChange={onChange} disabled={!form.province_code}>
              <option value="">{form.province_code ? '— เลือกอำเภอ —' : 'เลือกจังหวัดก่อน'}</option>
              {amphoes.map(a => <option key={a.code} value={a.code}>{a.name_th}</option>)}
            </select>

            <select name="tambon_code" value={form.tambon_code} onChange={onChange} disabled={!form.amphoe_code}>
              <option value="">{form.amphoe_code ? '— เลือกตำบล —' : 'เลือกอำเภอก่อน'}</option>
              {tambons.map(t => <option key={t.code} value={t.code}>{t.name_th}</option>)}
            </select>

            <input type="text" placeholder="รหัสไปรษณีย์" value={zipcode} readOnly />
          </div>
        </div>

        {/* เพศ: id + htmlFor คลิกที่ตัวอักษรได้ และกัน overlay */}
        <div className="right-group col" style={{ position: 'relative', zIndex: 3 }}>
          <div className="field">
            <span className="label">เพศ</span>
            <div className="radios">
              <div className="radio-item">
                <input id="gender-m" type="radio" name="gender" value="ชาย"
                       checked={form.gender === 'ชาย'} onChange={onChange}/>
                <label htmlFor="gender-m">ชาย</label>
              </div>
              <div className="radio-item">
                <input id="gender-f" type="radio" name="gender" value="หญิง"
                       checked={form.gender === 'หญิง'} onChange={onChange}/>
                <label htmlFor="gender-f">หญิง</label>
              </div>
              <div className="radio-item">
                <input id="gender-x" type="radio" name="gender" value="อื่นๆ"
                       checked={form.gender === 'อื่นๆ'} onChange={onChange}/>
                <label htmlFor="gender-x">อื่นๆ</label>
              </div>
            </div>
          </div>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="actions span-2">
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'กำลังสมัครสมาชิก…' : 'สมัครสมาชิก'}
          </button>
        </div>
      </form>
    </div>
  );
}
