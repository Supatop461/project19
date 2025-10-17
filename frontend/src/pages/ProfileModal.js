// src/pages/ProfileModal.js
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api as axiosClient, mediaSrc as resolveUrl } from "../lib/api";
import "./ProfileModal.css";

const UPLOAD_ENDPOINT = "/uploads/avatar";

function toDbUrl(u) {
  if (!u) return null;
  const s = String(u);
  try {
    const url = new URL(s, window.location.origin);
    if (url.origin === window.location.origin && url.pathname) {
      return url.pathname;
    }
  } catch {}
  return s;
}

export default function ProfileModal({ initialTab = "profile", onClose }) {
  const [tab, setTab] = useState(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [toast, setToast] = useState({ show: false, type: "success", message: "" });

  const pushToast = (message, type = "success") => {
    setToast({ show: true, type, message });
    window.clearTimeout(pushToast._t);
    pushToast._t = window.setTimeout(() => setToast((t) => ({ ...t, show: false })), 2500);
  };

  const [profile, setProfile] = useState({
    id: "",
    fullname: "",
    email: "",
    phone: "",
    avatar_url: "",
  });
  const [prefs, setPrefs] = useState({ order_updates: true, marketing_email: false });
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [addrLoading, setAddrLoading] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [editing, setEditing] = useState(null);

  const avatarFallback = useMemo(() => process.env.PUBLIC_URL + "/profile.jpg", []);
  const closeModal = () => typeof onClose === "function" && onClose();

  const normAddress = (a = {}) => ({
    id: a.id ?? a.address_id ?? null,
    fullname: a.recipient_name ?? a.fullname ?? a.name ?? profile.fullname ?? "",
    phone: a.phone ?? a.phone_number ?? "",
    line1: a.line1 ?? a.address ?? a.address_line1 ?? "",
    line2: a.line2 ?? a.address2 ?? a.address_line2 ?? "",
    subdistrict: a.subdistrict ?? a.tambon ?? "",
    district: a.district ?? a.amphoe ?? a.city ?? "",
    province: a.province ?? "",
    postcode: a.postcode ?? a.postal_code ?? a.zip ?? "",
    is_default: !!(a.is_default ?? a.default ?? false),
  });
  const denormAddress = (a = {}) => ({
    recipient_name: a.fullname ?? "",
    phone: a.phone ?? "",
    address_line: a.line1 ?? "",
    subdistrict: a.subdistrict ?? "",
    district: a.district ?? "",
    province: a.province ?? "",
    zipcode: a.postcode ?? a.postal_code ?? "",
    is_default: !!a.is_default,
  });

  // โหลดข้อมูลผู้ใช้
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        setLoadErr("");
        const r = await axiosClient.get("/api/me");
        if (ignore) return;
        const u = r.data || {};
        const next = {
          id: u.id || "",
          fullname: u.fullname || "",
          email: u.email || "",
          phone: u.phone || "",
          avatar_url: resolveUrl(u.avatar_url) || "",
        };
        setProfile({ ...next, avatar_url: next.avatar_url || avatarFallback });
      } catch (e) {
        console.error("GET /api/me failed:", e);
        setLoadErr(e?.response?.data?.message || e?.message || "โหลดข้อมูลผู้ใช้ล้มเหลว");
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [axiosClient, avatarFallback]);

  // โหลดคำสั่งซื้อ
  useEffect(() => {
    if (tab !== "orders") return;
    let ignore = false;
    (async () => {
      try {
        setOrdersLoading(true);
        const r = await axiosClient.get("/api/orders/my", { params: { limit: 5 } });
        if (!ignore) setOrders(Array.isArray(r.data) ? r.data : r.data?.items || []);
      } catch (e) {
        console.error("GET /api/orders/my failed:", e);
      } finally {
        setOrdersLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [tab]);

  // โหลดที่อยู่
  useEffect(() => {
    if (tab !== "addresses") return;
    let off = false;
    (async () => {
      try {
        setAddrLoading(true);
        const r = await axiosClient.get("/api/user-addresses");
        const list = Array.isArray(r.data) ? r.data : r.data?.items || [];
        if (!off) setAddresses(list.map(normAddress));
      } catch (e) {
        console.error("GET /api/user-addresses failed:", e);
        if (!off) setAddresses([]);
      } finally {
        if (!off) setAddrLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [tab]);

  const saveProfile = async () => {
    try {
      setSaving(true);
      const payload = {
        fullname: profile.fullname ?? "",
        phone: profile.phone ?? "",
        avatar_url:
          profile.avatar_url && profile.avatar_url !== avatarFallback
            ? toDbUrl(profile.avatar_url)
            : null,
      };
      const r = await axiosClient.put("/api/me", payload);
      const u = r.data || {};
      const next = {
        fullname: u.fullname || profile.fullname,
        email: u.email || profile.email,
        phone: u.phone || profile.phone,
        avatar_url: resolveUrl(u.avatar_url) || profile.avatar_url,
      };
      setProfile((s) => ({ ...s, ...next, avatar_url: next.avatar_url || avatarFallback }));
      pushToast("บันทึกโปรไฟล์เรียบร้อย ✅", "success");
    } catch (e) {
      console.error("PUT /api/me failed:", e);
      pushToast("บันทึกโปรไฟล์ล้มเหลว", "error");
    } finally {
      setSaving(false);
    }
  };

  async function reloadAddresses() {
    const r = await axiosClient.get("/api/user-addresses");
    const list = Array.isArray(r.data) ? r.data : r.data?.items || [];
    setAddresses(list.map(normAddress));
  }

  async function saveAddress() {
    try {
      setSaving(true);
      const payload = denormAddress(editing);
      if (editing.id) await axiosClient.put(`/api/addresses/${editing.id}`, payload);
      else await axiosClient.post(`/api/addresses`, payload);
      await reloadAddresses();
      setEditing(null);
      pushToast("บันทึกที่อยู่เรียบร้อย ✅", "success");
    } catch (e) {
      console.error("save address failed:", e);
      pushToast("บันทึกที่อยู่ล้มเหลว", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeAddress(id) {
    try {
      setSaving(true);
      await axiosClient.delete(`/api/addresses/${id}`);
      await reloadAddresses();
      pushToast("ลบที่อยู่แล้ว ✅", "success");
    } catch (e) {
      console.error("delete address failed:", e);
      pushToast("ลบไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault(id) {
    try {
      setSaving(true);
      await axiosClient.post(`/api/user-addresses/set-default`, { address_id: id });
      await reloadAddresses();
      pushToast("ตั้งค่าเริ่มต้นแล้ว ✅", "success");
    } catch (e) {
      console.error("default address failed:", e);
      pushToast("ตั้งค่าเริ่มต้นไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  const logout = () => {
    localStorage.clear();
    delete axiosClient.defaults.headers.common["Authorization"];
    closeModal();
    window.location.href = "/login";
  };

  return (
    <div className="profile-modal">
      <div className="modal-header">
        <h2>โปรไฟล์ผู้ใช้</h2>
        <button onClick={closeModal}>✕</button>
      </div>
      <div className="tabs">
        <button onClick={() => setTab("profile")} className={tab === "profile" ? "active" : ""}>ข้อมูลส่วนตัว</button>
        <button onClick={() => setTab("orders")} className={tab === "orders" ? "active" : ""}>คำสั่งซื้อ</button>
        <button onClick={() => setTab("addresses")} className={tab === "addresses" ? "active" : ""}>ที่อยู่</button>
        <button onClick={logout}>ออกจากระบบ</button>
      </div>

      <div className="tab-content">
        {tab === "profile" && (
          <div className="profile-tab">
            <img className="avatar" src={profile.avatar_url || avatarFallback} alt="avatar" />
            <input
              type="text"
              value={profile.fullname}
              onChange={(e) => setProfile((p) => ({ ...p, fullname: e.target.value }))}
              placeholder="ชื่อ-นามสกุล"
            />
            <input
              type="text"
              value={profile.phone}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              placeholder="เบอร์โทร"
            />
            <button disabled={saving} onClick={saveProfile}>บันทึก</button>
          </div>
        )}

        {tab === "orders" && (
          <div className="orders-tab">
            {ordersLoading ? (
              <p>กำลังโหลดคำสั่งซื้อ...</p>
            ) : orders.length === 0 ? (
              <p>ยังไม่มีคำสั่งซื้อ</p>
            ) : (
              <ul>
                {orders.map((o) => (
                  <li key={o.order_id || o.id}>#{o.order_id} — {o.status}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "addresses" && (
          <div className="addresses-tab">
            {addrLoading ? (
              <p>กำลังโหลดที่อยู่...</p>
            ) : (
              addresses.map((a) => (
                <div key={a.id} className={`address-card ${a.is_default ? "default" : ""}`}>
                  <div>{a.fullname}</div>
                  <div>{a.phone}</div>
                  <div>{a.line1} {a.subdistrict} {a.district} {a.province} {a.postcode}</div>
                  {!a.is_default && (
                    <button onClick={() => makeDefault(a.id)}>ตั้งค่าเริ่มต้น</button>
                  )}
                  <button onClick={() => removeAddress(a.id)}>ลบ</button>
                </div>
              ))
            )}
            <button onClick={() => setEditing({})}>เพิ่มที่อยู่ใหม่</button>
          </div>
        )}
      </div>

      {toast.show && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
