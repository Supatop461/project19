// FRONTEND: src/pages/Login.js
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Login.css';

export default function Login() {
  const navigate = useNavigate();

  const [form, setForm] = useState({ username: '', password: '', showPw: false });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ✅ เลือก path ให้ถูก: baseURL ลงท้าย /api → ใช้ '/auth/login' และ '/me'
  const baseEndsWithApi = (axios.defaults.baseURL || '').replace(/\/+$/, '').endsWith('/api');
  const LOGIN_PATH = baseEndsWithApi ? '/auth/login' : '/api/auth/login';
  const ME_PATH = baseEndsWithApi ? '/me' : '/api/me';

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
  };

  async function onSubmit(e) {
    e.preventDefault();
    setError('');

    const username = form.username.trim();
    const password = form.password.trim();
    if (!username || !password) {
      setError('กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }

    try {
      setLoading(true);

      const res = await axios.post(LOGIN_PATH, {
        username,
        email: username, // เผื่อผู้ใช้กรอกเป็นอีเมล
        password,
      });

      // ✅ รองรับคีย์ token หลายแบบ
      const token =
        res.data?.token ||
        res.data?.accessToken ||
        res.data?.jwt ||
        res.data?.data?.token;

      if (!token) throw new Error('ไม่พบ token จากเซิร์ฟเวอร์');

      // แนบ header ให้รีเควสต์ถัดไป
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;

      // ✅ ดึงข้อมูลผู้ใช้
      const user = res.data?.user || res.data?.data?.user || {};
      const roleRaw = user.role || res.data?.role || 'customer';

      // map ชื่อ
      let name =
        user.fullname ||
        user.full_name || // ← ของคุณส่งมาแบบนี้
        [user.first_name, user.last_name].filter(Boolean).join(' ') ||
        user.username ||
        user.email ||
        username;

      // map เบอร์โทร
      const phone =
        user.phone ||
        user.phone_number ||
        '';

      // ถ้า response ไม่มี → fallback ไปดึงจาก /me
      if (!name || !phone) {
        try {
          const me = await axios.get(ME_PATH, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const u = me.data?.user || me.data || {};
          if (!name) {
            name =
              u.fullname ||
              u.full_name ||
              [u.first_name, u.last_name].filter(Boolean).join(' ') ||
              u.username ||
              u.email ||
              username;
          }
        } catch {
          // ignore fallback error
        }
      }

      // เก็บลง localStorage
      const role = String(roleRaw).toLowerCase();
      localStorage.setItem('token', token);
      localStorage.setItem('role', role);
      localStorage.setItem('fullname', name || '');
      localStorage.setItem('phone', phone || '');
      if (user.email) localStorage.setItem('email', user.email);

      // แจ้งทุกคอมโพเนนต์ให้รู้ว่า auth/profile เปลี่ยน
      window.dispatchEvent(new Event('auth:changed'));
      window.dispatchEvent(new Event('profile:changed'));

      // ✅ เด้งตามสิทธิ์
      if (role.includes('admin')) {
        navigate('/admin/products', { replace: true }); // แอดมิน
      } else {
        navigate('/home-user', { replace: true }); // ลูกค้า
      }
    } catch (e) {
      const status = e?.response?.status;
      const msg =
        status === 401
          ? 'อีเมล/ชื่อผู้ใช้ หรือรหัสผ่านไม่ถูกต้อง'
          : status === 403
          ? 'บัญชีนี้ยังไม่มีสิทธิ์เข้าใช้งาน'
          : status === 404
          ? 'ไม่พบปลายทาง /auth/login (เช็กว่า backend mount ที่ /api/auth และ baseURL ถูกต้อง)'
          : e?.code === 'ERR_NETWORK'
          ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ตรวจสอบ backend พอร์ต 3001)'
          : e?.response?.data?.error || e?.message || 'เข้าสู่ระบบล้มเหลว';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      {/* ฝั่งโปรโมท */}
      <aside className="promo">
        <div className="promo-inner">
          <div className="promo-badge">GARDEN PRODUCT ONLINE</div>
          <h1>🌿 ยินดีต้อนรับเข้าสู่ หจก.ปราชญ์แม่โจ้ 🌿</h1>
          <p>มีพันธุ์ไม้มากกว่า 100 ชนิด ราคาเป็นมิตร พร้อมบริการจัดส่งรวดเร็ว</p>
        </div>
      </aside>

      {/* ฟอร์มล็อกอิน */}
      <main className="panel">
        <div className="login-card">
          <div className="brand">
            <Link to="/" className="brand-name">
              PRACH MAEJO
            </Link>
            <p className="brand-sub">กรุณาเข้าสู่ระบบ</p>
          </div>

          <form className="login-form" onSubmit={onSubmit} noValidate>
            <label className="field">
              <span className="label">อีเมล / ชื่อผู้ใช้</span>
              <div className="input-wrap">
                <input
                  type="text"
                  name="username"
                  placeholder="กรอกอีเมลหรือชื่อผู้ใช้"
                  value={form.username}
                  onChange={onChange}
                  required
                />
              </div>
            </label>

            <label className="field">
              <span className="label">รหัสผ่าน</span>
              <div className="input-wrap">
                <input
                  type={form.showPw ? 'text' : 'password'}
                  name="password"
                  placeholder="********"
                  value={form.password}
                  onChange={onChange}
                  required
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setForm((p) => ({ ...p, showPw: !p.showPw }))}
                >
                  {form.showPw ? '👁️' : '🙈'}
                </button>
              </div>
            </label>

            <div className="row-between">
              <span />
              <Link className="text-link" to="/reset-password">
                ลืมรหัสผ่าน?
              </Link>
            </div>

            {error && (
              <div className="form-error" role="alert">
                {error}
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
