// src/auth/Register.js
// หน้าที่: แบบฟอร์มสมัครสมาชิก → POST /api/auth/register
// - ตรวจฟอร์มเบื้องต้น (อีเมล/พาสเวิร์ด/ยืนยันพาสเวิร์ด)
// - สมัครเสร็จ: ถ้ามี token ที่ตอบกลับมา → login อัตโนมัติ
//   ถ้าไม่มี token → เรียก /api/auth/login ต่อเพื่อรับ token
// - เซ็ต Authorization header ให้ axios และเด้งกลับหน้าแรก

import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';

export default function Register() {
  // ✅ เก็บค่าฟอร์ม
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    confirm: '',
    phone: ''
  });

  // ✅ state แสดงผล
  const [showPw, setShowPw] = useState(false);     // toggle โชว์/ซ่อนพาสเวิร์ด
  const [loading, setLoading] = useState(false);   // ป้องกันกดซ้ำ
  const [error, setError] = useState('');          // แสดง error บนหน้า

  const nav = useNavigate();

  // ✅ อัปเดตฟอร์ม
  const onChange = (e) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  // ✅ ตรวจอีเมลง่าย ๆ
  const validEmail = (v) => /\S+@\S+\.\S+/.test(v);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    // --- ตรวจฟอร์มฝั่งหน้าเว็บ ---
    if (!form.full_name.trim())  return setError('กรุณากรอกชื่อ-นามสกุล');
    if (!validEmail(form.email)) return setError('รูปแบบอีเมลไม่ถูกต้อง');
    if (form.password.length < 6) return setError('รหัสผ่านต้องอย่างน้อย 6 ตัวอักษร');
    if (form.password !== form.confirm) return setError('ยืนยันรหัสผ่านไม่ตรงกัน');

    setLoading(true);
    try {
      // 🔹 พยายามสมัครสมาชิก
      const res = await axios.post('/api/auth/register', {
        name: form.full_name,     // ⚠️ ฝั่ง backend อาจใช้ name หรือ full_name ก็ได้
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined
      });

      // 🔹 กรณี backend ส่ง token กลับมาเลย → ตั้งค่าแล้วเด้งหน้าแรก
      let token = res?.data?.token;
      if (!token) {
        // 🔹 ถ้าไม่ส่ง token กลับมา: login ทันทีด้วยอีเมล/พาสเวิร์ดที่เพิ่งสมัคร
        const loginRes = await axios.post('/api/auth/login', {
          email: form.email,
          password: form.password
        });
        token = loginRes?.data?.token;
      }

      if (token) {
        localStorage.setItem('token', token);
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        nav('/', { replace: true });
      } else {
        // สมัครสำเร็จแต่ไม่มี token และล็อกอินไม่สำเร็จ → พาผู้ใช้ไปหน้า login
        nav('/login', { replace: true });
      }
    } catch (err) {
      // แสดงข้อความจาก backend ถ้ามี
      setError(err?.response?.data?.error || 'สมัครสมาชิกไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '24px auto', padding: 16 }}>
      <h1 style={{ marginBottom: 8 }}>สมัครสมาชิก</h1>
      <p style={{ color: '#666', marginTop: 0 }}>สร้างบัญชีใหม่เพื่อเริ่มใช้งานระบบ</p>

      {/* แสดงข้อผิดพลาดแบบเรียบง่าย */}
      {!!error && (
        <div style={{ background: '#fff1f0', border: '1px solid #ffa39e', color: '#cf1322', padding: 8, borderRadius: 8, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 10 }}>
        <input
          name="full_name"
          placeholder="ชื่อ-นามสกุล"
          value={form.full_name}
          onChange={onChange}
          autoComplete="name"
        />
        <input
          name="email"
          placeholder="อีเมล"
          value={form.email}
          onChange={onChange}
          autoComplete="email"
          type="email"
        />
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1 }}
              name="password"
              placeholder="รหัสผ่าน (อย่างน้อย 6 ตัวอักษร)"
              value={form.password}
              onChange={onChange}
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPw(v => !v)}>
              {showPw ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>

          <input
            name="confirm"
            placeholder="ยืนยันรหัสผ่าน"
            value={form.confirm}
            onChange={onChange}
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
          />
        </div>

        <input
          name="phone"
          placeholder="เบอร์โทร (ถ้ามี)"
          value={form.phone}
          onChange={onChange}
          autoComplete="tel"
        />

        <button type="submit" disabled={loading}>
          {loading ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}
        </button>
      </form>

      <div style={{ marginTop: 12, fontSize: 14 }}>
        มีบัญชีอยู่แล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
      </div>
    </div>
  );
}
