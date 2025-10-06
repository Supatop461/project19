// src/pages/ProfileModal.js
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import "./ProfileModal.css";

const API_BASE = axios.defaults.baseURL || process.env.REACT_APP_API_BASE || "http://localhost:3001";
const UPLOAD_ENDPOINT = "/api/uploads/avatar";

/* === helper: ทำ URL ให้เป็น absolute (เวลาได้ /uploads/...) === */
const trimSlash = (s) => (s || "").replace(/\/+$/, "");
const ABS_BASE = trimSlash(API_BASE);
function resolveUrl(u) {
  if (!u) return "";
  const s = String(u);
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("blob:")) return s;
  if (s.startsWith("/uploads/")) return `${ABS_BASE}${s}`;
  return s;
}
/* === helper: แปลงกลับเป็น path สำหรับเก็บลง DB ถ้าเป็น absolute === */
function toDbUrl(u) {
  if (!u) return null;
  const s = String(u);
  if (s.startsWith(ABS_BASE)) return s.slice(ABS_BASE.length) || "/"; // ตัด host ออก เหลือ /uploads/...
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

  const [prefs, setPrefs] = useState({
    order_updates: true,
    marketing_email: false,
  });

  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  // ===== Addresses state =====
  const [addrLoading, setAddrLoading] = useState(false);
  const [addresses, setAddresses] = useState([]);
  const [editing, setEditing] = useState(null); // null = โหมดรายการ, object = ฟอร์มแก้/เพิ่ม (ยังไม่ใช้ใน modal นี้)

  const avatarFallback = useMemo(() => process.env.PUBLIC_URL + "/profile.jpg", []);

  const axiosClient = useMemo(() => {
    const token = localStorage.getItem("token") || "";
    return axios.create({
      baseURL: API_BASE,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 12000,
    });
  }, []);

  const closeModal = () => typeof onClose === "function" && onClose();

  /* ------------ helpers addresses mapping (ให้ตรงกับ backend ใหม่) ------------ */
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
    line1: a.line1 ?? "",
    line2: a.line2 ?? "",
    subdistrict: a.subdistrict ?? "",
    district: a.district ?? "",
    province: a.province ?? "",
    postal_code: a.postcode ?? a.postal_code ?? "", // <-- ใช้ postal_code ตาม backend
    is_default: !!a.is_default,
  });

  /* ------------ โหลดโปรไฟล์ ------------ */
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
        setProfile({
          ...next,
          avatar_url: next.avatar_url || avatarFallback,
        });

        setPrefs({
          order_updates: u?.settings?.order_updates ?? true,
          marketing_email: u?.settings?.marketing_email ?? false,
        });

        if (next.fullname) localStorage.setItem("fullname", next.fullname);
        if (next.email) localStorage.setItem("email", next.email);
        if (next.phone) localStorage.setItem("phone", next.phone);
        if (u.avatar_url) localStorage.setItem("avatar_url", resolveUrl(u.avatar_url));

        window.dispatchEvent(new Event("profile:changed"));
      } catch (e) {
        console.error("GET /api/me failed:", e);
        setLoadErr(e?.response?.data?.message || e?.message || "โหลดข้อมูลผู้ใช้ล้มเหลว");
        setProfile((s) => ({
          ...s,
          fullname: localStorage.getItem("fullname") || s.fullname || "ผู้ใช้งาน",
          email: localStorage.getItem("email") || s.email || "",
          phone: localStorage.getItem("phone") || s.phone || "",
          avatar_url: localStorage.getItem("avatar_url") || s.avatar_url || avatarFallback,
        }));
      } finally {
        setLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [axiosClient, avatarFallback]);

  /* ------------ คำสั่งซื้อ ------------ */
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
    return () => { ignore = true; };
  }, [tab, axiosClient]);

  /* ------------ โหลดที่อยู่เมื่อเปิดแท็บ ------------ */
  useEffect(() => {
    if (tab !== "addresses") return;
    let off = false;
    (async () => {
      try {
        setAddrLoading(true);
        const r = await axiosClient.get("/api/addresses");
        const list = Array.isArray(r.data) ? r.data : (r.data?.items || []);
        if (!off) setAddresses(list.map(normAddress));
      } catch (e) {
        console.error("GET /api/addresses failed:", e);
        if (!off) setAddresses([]);
      } finally {
        if (!off) setAddrLoading(false);
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onChangeProfile = (k, v) => setProfile((s) => ({ ...s, [k]: v }));
  const onChangePref = (k, v) => setPrefs((s) => ({ ...s, [k]: v }));

  /* ------------ บันทึกโปรไฟล์ ------------ */
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
      const next = { fullname: u.fullname || profile.fullname, email: u.email || profile.email, phone: u.phone || profile.phone, avatar_url: resolveUrl(u.avatar_url) || profile.avatar_url };
      setProfile((s) => ({ ...s, ...next, avatar_url: next.avatar_url || avatarFallback }));

      if (next.fullname) localStorage.setItem("fullname", next.fullname);
      if (next.email) localStorage.setItem("email", next.email);
      if (next.phone) localStorage.setItem("phone", next.phone);
      if (u.avatar_url) localStorage.setItem("avatar_url", resolveUrl(u.avatar_url));

      window.dispatchEvent(new Event("profile:changed"));
      pushToast("บันทึกโปรไฟล์เรียบร้อย ✅", "success");
    } catch (e) {
      console.error("PUT /api/me failed:", e);
      pushToast(e?.response?.data?.message || e.message || "บันทึกโปรไฟล์ล้มเหลว", "error");
    } finally {
      setSaving(false);
    }
  };

  /* ------------ การตั้งค่า ------------ */
  const saveSettings = async () => {
    try {
      setSaving(true);
      await axiosClient.put("/api/settings", {
        order_updates: !!prefs.order_updates,
        marketing_email: !!prefs.marketing_email,
      });
      pushToast("บันทึกการตั้งค่าเรียบร้อย ✅", "success");
    } catch (e) {
      console.error("PUT /api/settings failed:", e);
      pushToast(e?.response?.data?.message || e.message || "บันทึกการตั้งค่าล้มเหลว", "error");
    } finally {
      setSaving(false);
    }
  };

  /* ------------ ที่อยู่: CRUD (คงไว้แม้ไม่ได้ใช้ในแท็บนี้) ------------ */
  async function reloadAddresses() {
    const r = await axiosClient.get("/api/addresses");
    const list = Array.isArray(r.data) ? r.data : (r.data?.items || []);
    setAddresses(list.map(normAddress));
  }
  async function saveAddress() {
    try {
      setSaving(true);
      const payload = denormAddress(editing);
      if (editing.id) {
        await axiosClient.put(`/api/addresses/${editing.id}`, payload);
      } else {
        await axiosClient.post(`/api/addresses`, payload);
      }
      await reloadAddresses();
      setEditing(null);
      pushToast("บันทึกที่อยู่เรียบร้อย ✅", "success");
    } catch (e) {
      console.error("save address failed:", e);
      pushToast(e?.response?.data?.message || e.message || "บันทึกที่อยู่ล้มเหลว", "error");
    } finally {
      setSaving(false);
    }
  }
  async function removeAddress(id) {
    try {
      setSaving(true);
      await axiosClient.delete(`/api/addresses/${id}`);
    } catch (e) {
      console.error("delete address failed:", e);
      pushToast(e?.response?.data?.message || e.message || "ลบไม่สำเร็จ", "error");
    } finally {
      await reloadAddresses();
      setSaving(false);
      pushToast("ลบที่อยู่แล้ว ✅", "success");
    }
  }
  async function makeDefault(id) {
    try {
      setSaving(true);
      // ใช้ PATCH /api/addresses/:id/default ตาม backend
      await axiosClient.patch(`/api/addresses/${id}/default`);
      await reloadAddresses();
      pushToast("ตั้งค่าเริ่มต้นแล้ว ✅", "success");
    } catch (e) {
      console.error("default address failed:", e);
      pushToast(e?.response?.data?.message || e.message || "ตั้งค่าเริ่มต้นไม่สำเร็จ", "error");
    } finally {
      setSaving(false);
    }
  }

  /* ------------ ออกจากระบบ ------------ */
  const logout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("avatar_url");
    delete axios.defaults.headers.common["Authorization"];
    closeModal();
    window.location.href = "/login";
  };

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {toast.show ? toast.message : ""}
      </div>

      <div className="pm-backdrop" onClick={closeModal} role="dialog" aria-modal="true">
        <div className="pm-card" onClick={(e) => e.stopPropagation()}>
          <button className="pm-close" onClick={closeModal} aria-label="ปิด">×</button>

          <div className="pm-head">
            <img
              className="pm-avatar"
              src={profile.avatar_url || avatarFallback}
              alt="avatar"
              onError={(e) => (e.currentTarget.src = process.env.PUBLIC_URL + "/logo.png")}
            />
            <div className="pm-head-info">
              <div className="pm-name">
                {loading ? "กำลังโหลด..." : (profile.fullname || "ผู้ใช้งาน")}
              </div>
              {(profile.email || profile.phone) && (
                <div className="pm-sub">{profile.email || profile.phone}</div>
              )}
              {loadErr && <div className="pm-sub" style={{ color: "#b91c1c" }}>{loadErr}</div>}
            </div>
          </div>

          <div className="pm-tabs" role="tablist">
            <button className={`pm-tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")} role="tab">โปรไฟล์</button>
            <button className={`pm-tab ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")} role="tab">คำสั่งซื้อของฉัน</button>
            <button className={`pm-tab ${tab === "addresses" ? "active" : ""}`} onClick={() => setTab("addresses")} role="tab">ที่อยู่ของฉัน</button>
            <button className={`pm-tab ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")} role="tab">การตั้งค่า</button>
          </div>

          <div className="pm-body">
            {/* -------- โปรไฟล์ -------- */}
            {tab === "profile" && (
              <div className="pm-section">
                <div className="pm-grid">
                  <label>ชื่อ-นามสกุล</label>
                  <input
                    value={profile.fullname}
                    onChange={(e) => onChangeProfile("fullname", e.target.value)}
                    placeholder="ชื่อ-นามสกุล"
                  />

                  <label>อีเมล</label>
                  <input value={profile.email} disabled title="อีเมลไม่สามารถเปลี่ยนได้" />

                  <label>เบอร์โทร</label>
                  <input
                    value={profile.phone}
                    onChange={(e) => onChangeProfile("phone", e.target.value)}
                    placeholder="เบอร์โทร"
                  />

                  <label>รูปโปรไฟล์</label>
                  <AvatarUploader
                    value={profile.avatar_url || avatarFallback}
                    onUploaded={(url) => onChangeProfile("avatar_url", resolveUrl(url))}
                    axiosClient={axiosClient}
                  />
                </div>

                <div className="pm-actions">
                  <button className="pm-btn pm-primary" onClick={saveProfile} disabled={saving}>
                    {saving ? "กำลังบันทึก..." : "บันทึกโปรไฟล์"}
                  </button>
                  <button
                    className="pm-btn pm-outline"
                    onClick={() => pushToast("ฟีเจอร์เปลี่ยนรหัสผ่าน: จะเพิ่มในรอบถัดไป", "info")}
                  >
                    เปลี่ยนรหัสผ่าน
                  </button>
                </div>
              </div>
            )}

            {/* -------- คำสั่งซื้อ -------- */}
            {tab === "orders" && (
              <div className="pm-section">
                {ordersLoading ? (
                  <div className="pm-note">กำลังโหลดคำสั่งซื้อ…</div>
                ) : orders.length === 0 ? (
                  <div className="pm-note">ยังไม่มีคำสั่งซื้อ</div>
                ) : (
                  <div className="pm-orders">
                    {orders.map((o) => (
                      <div key={o.id || o.order_no} className="pm-order-item">
                        <div><b>เลขที่:</b> {o.order_no || o.id}</div>
                        <div><b>สถานะ:</b> {o.status}</div>
                        <div><b>ยอดรวม:</b> {Number(o.total_amount || o.total).toLocaleString("th-TH")} บาท</div>
                        <div><b>วันที่:</b> {o.created_at ? new Date(o.created_at).toLocaleString() : "-"}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <Link to="/account/orders" className="pm-link" onClick={closeModal}>
                    ดูคำสั่งซื้อทั้งหมด →
                  </Link>
                </div>
              </div>
            )}

            {/* -------- ที่อยู่ของฉัน (สรุป + ปุ่มไปหน้าจัดการ) -------- */}
            {tab === "addresses" && (
              <div className="pm-section">
                {addrLoading ? (
                  <div className="pm-note">กำลังโหลดที่อยู่…</div>
                ) : addresses.length === 0 ? (
                  <div className="pm-note">ยังไม่มีที่อยู่จัดส่ง</div>
                ) : (
                  <div className="pm-address-list">
                    {addresses.map((a) => (
                      <div key={a.id} className="pm-address-item">
                        <div className="pm-address-main">
                          <div className="pm-address-name">
                            {a.fullname} {a.is_default && <span className="pm-badge">ค่าเริ่มต้น</span>}
                          </div>
                          <div
                            className="pm-address-lines"
                            title={`${a.line1 || ""} ${a.line2 || ""} ${a.subdistrict || ""} ${a.district || ""} ${a.province || ""} ${a.postcode || ""}`.trim()}
                          >
                            <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {(a.line1 || "") + (a.line2 ? `, ${a.line2}` : "")} · {a.subdistrict} {a.district} {a.province} {a.postcode} · ☎ {a.phone}
                            </div>
                          </div>
                        </div>
                        <div className="pm-address-actions">
                          {!a.is_default && (
                            <button className="pm-btn pm-outline" onClick={() => makeDefault(a.id)}>
                              ตั้งเป็นค่าเริ่มต้น
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pm-actions">
                  <Link
                    to="/account/addresses"
                    className="pm-btn pm-primary"
                    onClick={closeModal}
                    role="button"
                  >
                    แก้ไข / จัดการที่อยู่
                  </Link>
                </div>
              </div>
            )}

            {/* -------- การตั้งค่า -------- */}
            {tab === "settings" && (
              <div className="pm-section">
                <div className="pm-grid">
                  <label>รับการแจ้งเตือนสถานะคำสั่งซื้อ</label>
                  <Toggle checked={prefs.order_updates} onChange={(v) => onChangePref("order_updates", v)} />

                  <label>รับอีเมลโปรโมชัน/ข่าวสาร</label>
                  <Toggle checked={prefs.marketing_email} onChange={(v) => onChangePref("marketing_email", v)} />
                </div>

                <div className="pm-note" style={{ marginTop: 8 }}>
                  เมื่อเปิดใช้งาน ระบบจะใช้ค่านี้เพื่อส่งการแจ้งเตือน (เช่น อีเมลไปที่ {profile.email || "อีเมลของคุณ"})
                  และจะแสดงอัปเดตสถานะในแท็บ “คำสั่งซื้อของฉัน”
                </div>

                <div className="pm-actions">
                  <button className="pm-btn" onClick={saveSettings} disabled={saving}>
                    {saving ? "กำลังบันทึก..." : "บันทึกการตั้งค่า"}
                  </button>
                  <button className="pm-btn pm-danger" onClick={logout}>
                    ออกจากระบบ
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast((t) => ({ ...t, show: false }))} />
    </>
  );
}

/* ------- UI helper: Toggle ------- */
function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!checked)}
      className={`pm-toggle ${checked ? "on" : ""}`}
      aria-pressed={checked}
    >
      <span className={`pm-toggle-knob ${checked ? "on" : ""}`} />
    </button>
  );
}

/* ------- อัปโหลดรูปโปรไฟล์ ------- */
function AvatarUploader({ value, onUploaded, axiosClient }) {
  const [preview, setPreview] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => setPreview(value), [value]);

  const onPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");

    if (!file.type.startsWith("image/")) {
      setErr("รองรับเฉพาะไฟล์รูปภาพ");
      return;
    }

    const blobUrl = URL.createObjectURL(file);
    setPreview(blobUrl);

    const fd = new FormData();
    fd.append("file", file);

    try {
      setBusy(true);
      const r = await axiosClient.post(UPLOAD_ENDPOINT, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const url = r?.data?.url || r?.data?.files?.[0]?.url || null;
      if (!url) throw new Error("อัปโหลดสำเร็จ แต่ไม่ได้รับ URL กลับมา");

      const abs = resolveUrl(url);
      onUploaded?.(abs);
      localStorage.setItem("avatar_url", abs);
      window.dispatchEvent(new Event("profile:changed"));
    } catch (e) {
      console.error("UPLOAD avatar failed:", e);
      setErr(e?.response?.data?.message || e.message || "อัปโหลดไม่สำเร็จ");
      setPreview(value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pm-upload">
      <div className="pm-upload-row">
        <img
          src={preview}
          alt="avatar preview"
          className="pm-upload-thumb"
          onError={(ev) => (ev.currentTarget.src = process.env.PUBLIC_URL + "/logo.png")}
        />
        <label className="pm-btn pm-outline" style={{ cursor: "pointer" }}>
          {busy ? "กำลังอัปโหลด..." : "เลือกไฟล์รูป"}
          <input type="file" accept="image/*" onChange={onPick} style={{ display: "none" }} disabled={busy} />
        </label>
      </div>
      {err && <div className="pm-error">{err}</div>}
      <div className="pm-help">รองรับ .jpg .png .webp</div>
    </div>
  );
}

/* ------- ฟอร์มที่อยู่ (เผื่อใช้ต่อ) ------- */
function AddressForm({ value, onChange }) {
  const v = value || {};
  const update = (k) => (e) => onChange?.({ [k]: e.target.value });
  const updateBool = (k) => (e) => onChange?.({ [k]: e.target.checked });

  return (
    <div className="pm-grid pm-address-form">
      <label>ชื่อผู้รับ</label>
      <input value={v.fullname || ""} onChange={update("fullname")} placeholder="ชื่อ-นามสกุลผู้รับ" />

      <label>โทรศัพท์</label>
      <input value={v.phone || ""} onChange={update("phone")} placeholder="เช่น 08x-xxx-xxxx" />

      <label>ที่อยู่ (บรรทัด 1)</label>
      <input value={v.line1 || ""} onChange={update("line1")} placeholder="บ้านเลขที่/หมู่/หมู่บ้าน/อาคาร/ชั้น" />

      <label>ที่อยู่ (บรรทัด 2)</label>
      <input value={v.line2 || ""} onChange={update("line2")} placeholder="ตรอก/ซอย/ถนน (ถ้ามี)" />

      <label>ตำบล/แขวง</label>
      <input value={v.subdistrict || ""} onChange={update("subdistrict")} />

      <label>อำเภอ/เขต</label>
      <input value={v.district || ""} onChange={update("district")} />

      <label>จังหวัด</label>
      <input value={v.province || ""} onChange={update("province")} />

      <label>รหัสไปรษณีย์</label>
      <input value={v.postcode || ""} onChange={update("postcode")} />

      <label>ตั้งเป็นค่าเริ่มต้น</label>
      <div className="pm-row">
        <input
          type="checkbox"
          checked={!!v.is_default}
          onChange={updateBool("is_default")}
          id="addr-default"
        />
        <label htmlFor="addr-default" style={{ marginLeft: 8 }}>ใช้เป็นที่อยู่เริ่มต้น</label>
      </div>
    </div>
  );
}

/* ------- Toast ------- */
function Toast({ toast, onClose }) {
  if (!toast?.show) return null;
  return (
    <div
      className={`pm-toast pm-toast-${toast.type}`}
      role="status"
      aria-live="polite"
      onClick={onClose}
      title="คลิกเพื่อปิด"
    >
      {toast.type === "success" ? "✅" : toast.type === "error" ? "⚠️" : "ℹ️"}&nbsp;{toast.message}
    </div>
  );
}
