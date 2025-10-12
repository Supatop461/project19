import React, { useEffect, useState, useMemo } from "react";
import { api } from "../lib/api";
import "./UserManagement.css";

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await api.get("/admin/users");
      setUsers(res.data || []);
    } catch (err) {
      console.error("Load users failed:", err);
      alert("โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  async function setRole(id, newRole) {
    if (!["customer", "admin"].includes(newRole)) return;
    try {
      await api.put(`/admin/users/${id}/role`, { role: newRole });
      await loadUsers();
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.message || "อัปเดตสิทธิ์ไม่สำเร็จ");
    }
  }

  async function setActive(id, active) {
    try {
      await api.put(`/admin/users/${id}/status`, { active });
      await loadUsers();
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.message || "อัปเดตสถานะไม่สำเร็จ");
    }
  }

  useEffect(() => { loadUsers(); }, []);

  const filtered = useMemo(() => {
    return (users || []).filter(u => {
      const text = [u.full_name || u.name || "", u.email || ""].join(" ").toLowerCase();
      const matchQ = text.includes(q.toLowerCase());
      const matchRole = roleFilter === "all" ? true : u.role === roleFilter;
      return matchQ && matchRole;
    });
  }, [users, q, roleFilter]);

  return (
    <div className="user-page">
      <h2>จัดการสถานะผู้ใช้</h2>

      <div className="toolbar">
        <input
          placeholder="ค้นหาชื่อหรืออีเมล…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="all">ทั้งหมด</option>
          <option value="admin">admin</option>
          <option value="customer">customer</option>
        </select>
        <button onClick={loadUsers} disabled={loading}>
          รีเฟรช
        </button>
      </div>

      {loading ? (
        <p>กำลังโหลด...</p>
      ) : (
        <table className="user-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ชื่อผู้ใช้</th>
              <th>อีเมล</th>
              <th>สิทธิ์</th>
              <th>สถานะ</th>
              <th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => {
              const isAdmin = u.role === "admin";
              return (
                <tr key={u.user_id || u.id}>
                  <td>{i + 1}</td>
                  <td>{u.full_name || u.name || "-"}</td>
                  <td>{u.email || "-"}</td>
                  <td>
                    <span className={isAdmin ? "badge badge-admin" : "badge"}>
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <span className={u.active ? "active" : "banned"}>
                      {u.active ? "ใช้งาน" : "ถูกระงับ"}
                    </span>
                  </td>
                  <td className="actions">
                    {/* ปุ่มลัด Promote/Demote */}
                    {isAdmin ? (
                      <button className="ghost" onClick={() => setRole(u.id, "customer")}>
                        ลดสิทธิ์เป็น customer
                      </button>
                    ) : (
                      <button className="primary" onClick={() => setRole(u.id, "admin")}>
                        ตั้งเป็น admin
                      </button>
                    )}

                    {/* Toggle Active */}
                    <button
                      className={u.active ? "ban" : "unban"}
                      onClick={() => setActive(u.id, !u.active)}
                    >
                      {u.active ? "ระงับ" : "ปลดแบน"}
                    </button>

                    {/* Dropdown เผื่ออนาคตยังอยากเลือกด้วยมือ */}
                    <select
                      value={u.role}
                      onChange={(e) => setRole(u.id, e.target.value)}
                    >
                      <option value="customer">customer</option>
                      <option value="admin">admin</option>
                    </select>
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
    </div>
  );
}
