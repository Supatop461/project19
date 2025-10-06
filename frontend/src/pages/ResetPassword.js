// FRONTEND: src/pages/ResetPassword.js
import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ResetPassword.css'; // ใช้สไตล์การ์ดเดิม ๆ จากหน้า Login ให้หน้าตากลมกัน

export default function ResetPassword() {
  const nav = useNavigate();
  const location = useLocation();

  // อ่าน query params
  const qs = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tokenFromUrl = qs.get('token') || qs.get('code') || qs.get('oobCode') || '';
  const emailFromUrl = qs.get('email') || '';

  // ถ้ามี token → โหมดตั้งรหัสผ่านใหม่, ถ้าไม่มี token → โหมดขออีเมลรีเซ็ต
  const mode = tokenFromUrl ? 'reset' : 'request';

  const [email, setEmail] = useState(emailFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [showPw, setShowPw]     = useState(false);

  const [error, setError]   = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  // เลือก path อัตโนมัติแบบเดียวกับหน้า Login (รองรับ baseURL ลงท้าย /api)
  const endsWithApi = (axios.defaults.baseURL || '').replace(/\/+$/,'').endsWith('/api');
  const FORGOT_PATH = process.env.REACT_APP_FORGOT_PATH || (endsWithApi ? '/auth/forgot-password' : '/api/auth/forgot-password');
  const RESET_PATH  = process.env.REACT_APP_RESET_PATH  || (endsWithApi ? '/auth/reset-password' :  '/api/auth/reset-password');

  const isEmail = (v) => /\S+@\S+\.\S+/.test(String(v || '').trim());

  const submitRequest = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!isEmail(email)) {
      setError('กรุณากรอกอีเมลให้ถูกต้อง');
      return;
    }

    try {
      setLoading(true);
      await axios.post(FORGOT_PATH, { email: email.trim(), username: email.trim() });
      setNotice('เราได้ส่งลิงก์รีเซ็ตรหัสผ่านไปยังอีเมลของคุณแล้ว (หากไม่พบ โปรดตรวจสอบโฟลเดอร์สแปม)');
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'ส่งอีเมลรีเซ็ตไม่สำเร็จ';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (password.length < 8) return setError('รหัสผ่านอย่างน้อย 8 ตัวอักษร');
    if (password !== confirm) return setError('ยืนยันรหัสผ่านไม่ตรงกัน');

    const token = tokenFromUrl;
    if (!token) return setError('ไม่พบโทเค็นรีเซ็ต (token) ในลิงก์');

    try {
      setLoading(true);
      // ส่งหลาย alias ให้เข้ากับหลายแบ็กเอนด์
      await axios.post(RESET_PATH, {
        token, code: token, oobCode: token,
        email: email || undefined,
        password,
        confirm_password: password,
        password_confirmation: password,
      });

      setNotice('ตั้งรหัสผ่านใหม่เรียบร้อย กำลังพากลับไปหน้าเข้าสู่ระบบ…');
      setTimeout(() => nav('/login', { replace: true }), 1500);
    } catch (err) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'ตั้งรหัสผ่านใหม่ไม่สำเร็จ';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <main className="panel" style={{ width: '100%' }}>
        <div className="login-card" style={{ maxWidth: 520 }}>
          <div className="brand">
            <Link to="/" className="brand-name">PRACH MAEJO</Link>
            <p className="brand-sub">
              {mode === 'request' ? 'รีเซ็ตรหัสผ่าน' : 'ตั้งรหัสผ่านใหม่'}
            </p>
          </div>

          {mode === 'request' ? (
            <form className="login-form" onSubmit={submitRequest} noValidate>
              <label className="field">
                <span className="label">อีเมลที่ใช้สมัคร</span>
                <div className="input-wrap">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e)=>setEmail(e.target.value)}
                    required
                  />
                </div>
              </label>

              {error && <div className="form-error" role="alert">{error}</div>}
              {notice && <div className="form-success" role="status">{notice}</div>}

              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? 'กำลังส่งลิงก์…' : 'ส่งลิงก์รีเซ็ตรหัสผ่าน'}
              </button>

              <div className="row-between" style={{ marginTop: 10 }}>
                <Link className="text-link" to="/login">กลับไปหน้าเข้าสู่ระบบ</Link>
                <span />
              </div>
            </form>
          ) : (
            <form className="login-form" onSubmit={submitReset} noValidate>
              {/* แสดงอีเมลถ้ามีใน URL (ให้แก้ได้) */}
              <label className="field">
                <span className="label">อีเมล</span>
                <div className="input-wrap">
                  <input
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e)=>setEmail(e.target.value)}
                  />
                </div>
              </label>

              <label className="field">
                <span className="label">รหัสผ่านใหม่</span>
                <div className="input-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="อย่างน้อย 8 ตัวอักษร"
                    value={password}
                    onChange={(e)=>setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="pw-toggle"
                    onClick={() => setShowPw(s => !s)}
                    aria-label="แสดง/ซ่อนรหัสผ่าน"
                  >
                    {showPw ? '🙈' : '👁️'}
                  </button>
                </div>
              </label>

              <label className="field">
                <span className="label">ยืนยันรหัสผ่านใหม่</span>
                <div className="input-wrap">
                  <input
                    type={showPw ? 'text' : 'password'}
                    placeholder="พิมพ์ซ้ำรหัสผ่านใหม่"
                    value={confirm}
                    onChange={(e)=>setConfirm(e.target.value)}
                    required
                  />
                </div>
              </label>

              {error && <div className="form-error" role="alert">{error}</div>}
              {notice && <div className="form-success" role="status">{notice}</div>}

              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
              </button>

              <div className="row-between" style={{ marginTop: 10 }}>
                <Link className="text-link" to="/login">กลับไปหน้าเข้าสู่ระบบ</Link>
                <span />
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
