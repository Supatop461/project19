// frontend/src/admin/UserManagement.jsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { toast } from "react-hot-toast";
import "./UserManagement.css";

function ConfirmModal({ open, title, subtitle, onClose, onConfirm, busy }) {
  const [pw, setPw] = useState("");
  useEffect(() => { if (!open) setPw(""); }, [open]);
  if (!open) return null;

  return (
    <div className="umodal-backdrop" onClick={onClose}>
      <div className="umodal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {subtitle && <p className="umodal-sub">{subtitle}</p>}
        <label className="umodal-label">รหัสผ่านแอดมินเพื่อยืนยัน</label>
        <input
          type="password"
          className="umodal-input"
          placeholder="••••••••"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <div className="umodal-actions">
          <button className="ghost" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="primary" onClick={() => onConfirm(pw)} disabled={busy || !pw.trim()}>
            {busy ? "กำลังดำเนินการ…" : "ยืนยัน"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all|active|inactive
  const [busyId, setBusyId] = useState(null);
  const [me, setMe] = useState({ id: null, role: null });
  const [modal, setModal] = useState({ open: false, action: null, user: null });

  async function loadMe() {
    try {
      const r = await api.get("/api/admin/me");
      const data = r?.data || r;
      setMe({ id: data?.id ?? null, role: data?.role ?? null });
    } catch {
      setMe({ id: null, role: null });
    }
  }

  async function loadUsers() {
    setLoading(true);
    try {
      const url = `/api/admin/users?q=${encodeURIComponent(q)}&role=${roleFilter}&status=${statusFilter}`;
      const res = await api.get(url);
      const data = res?.data?.items || res?.items || res || [];
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Load users failed:", err);
      toast.error("โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  function openRoleModal(user, makeRole) {
    setModal({ open: true, action: { type: "role", make: makeRole }, user });
  }
  function openActiveModal(user, toActive) {
    setModal({ open: true, action: { type: "active", to: !!toActive }, user });
  }

  async function confirmModal(pw) {
    const { user, action } = modal;
    if (!user || !action) return;

    const userId = user.id ?? user.user_id;
    setBusyId(userId);

    try {
      if (action.type === "role") {
        const res = await api.patch(`/api/admin/users/${userId}/role`, {
          make: action.make,
          confirm_password: pw.trim(),
        });
        const updated = res?.data?.user || res?.user;
        if (updated) {
          setUsers(prev => prev.map(u => String(u.id ?? u.user_id) === String(userId) ? updated : u));
        }
        toast.success(action.make === "admin" ? "ตั้งเป็น admin สำเร็จ" : "ลดสิทธิ์เป็น user สำเร็จ");
      } else if (action.type === "active") {
        const res = await api.patch(`/api/admin/users/${userId}/active`, {
          active: action.to,
          confirm_password: pw.trim(),
        });
        const updated = res?.data?.user || res?.user;
        if (updated) {
          setUsers(prev => prev.map(u => String(u.id ?? u.user_id) === String(userId) ? updated : u));
        }
        toast.success(action.to ? "เปิดใช้งานผู้ใช้แล้ว" : "ปิดการใช้งานผู้ใช้แล้ว");
      }
      setModal({ open: false, action: null, user: null });
    } catch (err) {
      console.error("Action failed:", err);
      const d = err?.response?.data || {};
      const msg = d.message || d.detail || d.error || "ดำเนินการไม่สำเร็จ";
      toast.error(String(msg));
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => { loadMe(); loadUsers(); }, []);
  useEffect(() => {
    const t = setTimeout(loadUsers, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, roleFilter, statusFilter]);

  const filtered = useMemo(() => {
    const list = users || [];
    if (!q && (roleFilter === "all" || !roleFilter) && (statusFilter === "all" || !statusFilter)) return list;
    const ql = q.trim().toLowerCase();
    return list.filter((u) => {
      const name = (u.full_name || u.name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const username = (u.username || "").toLowerCase();
      const matchQ = ql ? (name.includes(ql) || email.includes(ql) || username.includes(ql)) : true;
      const role = (u.role || (u.is_admin ? "admin" : "user")) || "user";
      const matchRole = roleFilter === "all" ? true : role === roleFilter;
      const status = u.is_active ? "active" : "inactive";
      const matchStatus = statusFilter === "all" ? true : status === statusFilter;
      return matchQ && matchRole && matchStatus;
    });
  }, [users, q, roleFilter, statusFilter]);

  return (
    <div className="user-page">
      <h2>จัดการผู้ใช้ (Deactivate แทนการลบ)</h2>

      <div className="toolbar">
        <input
          placeholder="ค้นชื่อ/อีเมล/username…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">บทบาท: ทั้งหมด</option>
          <option value="admin">admin</option>
          <option value="user">user</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">สถานะ: ทั้งหมด</option>
          <option value="active">ใช้งานอยู่</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
        <button onClick={loadUsers} disabled={loading}>รีเฟรช</button>
      </div>

      {loading ? (
        <p>กำลังโหลด...</p>
      ) : (
        <table className="user-table">
          <thead>
            <tr>
              <th>#</th>
              <th style={{ textAlign: "left" }}>ชื่อ</th>
              <th style={{ textAlign: "left" }}>อีเมล / ผู้ใช้</th>
              <th>บทบาท</th>
              <th>สถานะ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => {
              const id = u.id ?? u.user_id;
              const isAdmin = !!u.is_admin || u.role === "admin";
              const role = u.role || (isAdmin ? "admin" : "user");
              const isMe = me?.id && String(me.id) === String(id);
              const isActive = u.is_active !== false; // default true

              return (
                <tr key={id}>
                  <td>{i + 1}</td>
                  <td style={{ textAlign: "left" }}>{u.full_name || u.name || "-"}</td>
                  <td style={{ textAlign: "left" }}>{u.email || u.username || "-"}</td>
                  <td>
                    <span className={`badge ${isAdmin ? "badge-admin" : ""}`}>{role}</span>
                    {isMe && <span className="chip-me">คุณ</span>}
                  </td>
                  <td>
                    <span className={`badge ${isActive ? "badge-ok" : "badge-off"}`}>
                      {isActive ? "ใช้งานอยู่" : "ปิดใช้งาน"}
                    </span>
                  </td>
                  <td className="actions">
                    {/* เปลี่ยนบทบาท */}
                    {isAdmin ? (
                      <button
                        className="ghost"
                        disabled={busyId === id || isMe}
                        onClick={() => openRoleModal(u, "user")}
                        title={isMe ? "ห้ามลดสิทธิ์ตัวเอง" : "ลดสิทธิ์เป็น user"}
                      >
                        {busyId === id ? "..." : "ลดสิทธิ์เป็น user"}
                      </button>
                    ) : (
                      <button
                        className="primary"
                        disabled={busyId === id}
                        onClick={() => openRoleModal(u, "admin")}
                      >
                        {busyId === id ? "..." : "ตั้งเป็น admin"}
                      </button>
                    )}

                    <select
                      value={role}
                      disabled={busyId === id || isMe}
                      onChange={(e) => openRoleModal(u, e.target.value)}
                      title={isMe ? "ห้ามเปลี่ยนสิทธิ์ตัวเอง" : ""}
                    >
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>

                    {/* เปิด/ปิดใช้งาน */}
                    {isActive ? (
                      <button
                        className="ban"
                        disabled={busyId === id || isMe}
                        onClick={() => openActiveModal(u, false)}
                        title={isMe ? "ห้ามปิดการใช้งานตัวเอง" : "ปิดการใช้งานบัญชีนี้"}
                      >
                        ปิดใช้งาน
                      </button>
                    ) : (
                      <button
                        className="unban"
                        disabled={busyId === id}
                        onClick={() => openActiveModal(u, true)}
                      >
                        เปิดใช้งาน
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "#999" }}>
                  ไม่พบผู้ใช้ตามเงื่อนไขที่เลือก
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <ConfirmModal
        open={modal.open}
        title={
          modal.action?.type === "role"
            ? (modal.action?.make === "admin" ? "ยืนยันการตั้งเป็นแอดมิน" : "ยืนยันการลดสิทธิ์เป็นผู้ใช้")
            : (modal.action?.to ? "ยืนยันการเปิดใช้งานผู้ใช้" : "ยืนยันการปิดการใช้งานผู้ใช้")
        }
        subtitle={
          modal.user
            ? (modal.user.email || modal.user.username || `ผู้ใช้ #${modal.user.id ?? modal.user.user_id}`)
            : ""
        }
        busy={!!busyId}
        onClose={() => setModal({ open: false, action: null, user: null })}
        onConfirm={confirmModal}
      />
    </div>
  );
}
