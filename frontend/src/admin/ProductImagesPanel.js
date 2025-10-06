// frontend/src/admin/ProductImagesPanel.js
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * ProductImagesPanel
 * - แสดง/เพิ่ม/ลบ/ตั้งรูปหลัก/จัดลำดับรูปของสินค้า
 * - พึ่งพา endpoint backend:
 *   GET    /api/products/:id/images
 *   POST   /api/products/:id/images
 *   PATCH  /api/products/:id/images/reorder
 *   PATCH  /api/products/:id/images/:imageId/primary
 *   DELETE /api/products/:id/images/:imageId
 *   POST   /api/upload   (multipart | key: files)
 */
export default function ProductImagesPanel({ productId }) {
  const API_BASE = useMemo(
    () => (process.env.REACT_APP_API_BASE || "http://localhost:3001").replace(/\/$/, ""),
    []
  );
  const token = useMemo(() => (typeof window !== "undefined" ? localStorage.getItem("token") : null), []);
  const authHeaders = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [addingUrl, setAddingUrl] = useState("");
  const fileInputRef = useRef(null);

  // ---------- Helpers ----------
  const apiGet = async (path) => {
    const res = await fetch(`${API_BASE}${path}`, { headers: { ...authHeaders } });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };
  const apiJSON = async (path, method, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await apiGet(`/api/products/${productId}/images`);
      setImages(Array.isArray(data?.images) ? data.images : []);
    } catch (e) {
      console.error("load images error", e);
      alert("โหลดรูปไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (productId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  // ให้ตำแหน่งเป็น 1..N ตามลำดับปัจจุบัน (primary ไว้หัว)
  const ensureSequentialPositions = (list) =>
    list
      .slice()
      .sort((a, b) => {
        if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
        if (a.position !== b.position) return a.position - b.position;
        return a.id - b.id;
      })
      .map((img, idx) => ({ ...img, position: idx + 1 }));

  // ---------- Actions ----------
  const handleUpload = async (files) => {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);

      // อัปโหลดไฟล์ไปที่ /api/upload (ต้องมี Bearer token)
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        headers: { ...authHeaders }, // อย่าใส่ Content-Type เอง ให้ browser จัดการ boundary
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text());
      const up = await res.json();

      // รองรับหลายรูปแบบ response
      const uploadedUrls =
        up?.files?.map((f) => `${API_BASE}${f.url || f.path || ""}`) ||
        up?.map?.((f) => `${API_BASE}${f.url || f.path || ""}`) ||
        [];

      if (!uploadedUrls.length) {
        alert("อัปโหลดไฟล์ไม่สำเร็จ");
        return;
      }

      await apiJSON(`/api/products/${productId}/images`, "POST", {
        images: uploadedUrls.map((url) => ({ url })),
      });

      await load();
    } catch (e) {
      console.error("upload error", e);
      alert("อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddByUrl = async () => {
    const url = (addingUrl || "").trim();
    if (!url) return;
    try {
      await apiJSON(`/api/products/${productId}/images`, "POST", { images: [{ url }] });
      setAddingUrl("");
      await load();
    } catch (e) {
      console.error("add url error", e);
      alert("เพิ่มรูปจาก URL ไม่สำเร็จ");
    }
  };

  const setPrimary = async (imageId) => {
    try {
      await apiJSON(`/api/products/${productId}/images/${imageId}/primary`, "PATCH", {});
      await load();
    } catch (e) {
      console.error("set primary error", e);
      alert("ตั้งรูปหลักไม่สำเร็จ (ตรวจ token/สิทธิ์แอดมิน)");
    }
  };

  const remove = async (imageId) => {
    if (!window.confirm("ยืนยันลบรูปนี้?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/products/${productId}/images/${imageId}`, {
        method: "DELETE",
        headers: { ...authHeaders },
      });
      if (!res.ok) throw new Error(await res.text());
      await load();
    } catch (e) {
      console.error("delete image error", e);
      alert("ลบรูปไม่สำเร็จ");
    }
  };

  const move = async (imageId, dir = 1) => {
    // dir: +1 ลง, -1 ขึ้น
    const ordered = ensureSequentialPositions(images);
    const idx = ordered.findIndex((i) => i.id === imageId);
    if (idx < 0) return;
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= ordered.length) return;

    // สลับตำแหน่งใน local แล้วส่งตำแหน่งทั้งชุด (1..N) ไปให้ backend
    const tmp = ordered[idx].position;
    ordered[idx].position = ordered[swapIdx].position;
    ordered[swapIdx].position = tmp;

    const payload = ordered
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((i, pos) => ({ id: i.id, position: pos + 1 }));

    try {
      await apiJSON(`/api/products/${productId}/images/reorder`, "PATCH", { order: payload });
      await load();
    } catch (e) {
      console.error("reorder error", e);
      alert("จัดลำดับไม่สำเร็จ");
    }
  };

  // ---------- UI ----------
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>รูปภาพสินค้า</h2>
        <button onClick={load} disabled={loading} style={{ padding: "6px 10px" }}>
          รีโหลด
        </button>
      </div>

      {/* เพิ่มรูป */}
      <div style={{ border: "1px dashed #ccc", borderRadius: 8, padding: 12 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => handleUpload(e.target.files)}
            />
            {uploading && <span style={{ fontSize: 12, color: "#666" }}>กำลังอัปโหลด...</span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ flex: 1, padding: 8, border: "1px solid #ddd", borderRadius: 6 }}
              placeholder="วางลิงก์รูป (URL) แล้วกด เพิ่ม"
              value={addingUrl}
              onChange={(e) => setAddingUrl(e.target.value)}
            />
            <button onClick={handleAddByUrl} style={{ padding: "6px 10px" }}>
              เพิ่ม URL
            </button>
          </div>
        </div>
      </div>

      {/* แกลเลอรี */}
      {images.length === 0 ? (
        <div style={{ fontSize: 13, color: "#666" }}>ยังไม่มีรูปสำหรับสินค้านี้</div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          }}
        >
          {images.map((img) => (
            <div key={img.id} style={{ border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16 / 9",
                  background: "#f6f7f8",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                <img
                  src={img.url}
                  alt={img.alt_text || `image-${img.id}`}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </div>
              <div style={{ padding: 10, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  {img.is_primary ? (
                    <span
                      style={{
                        fontSize: 12,
                        background: "#111",
                        color: "#fff",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      รูปหลัก
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 12,
                        background: "#eee",
                        color: "#333",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      รูปที่ {img.position}
                    </span>
                  )}

                  <div style={{ display: "flex", gap: 6 }}>
                    <button title="ย้ายขึ้น" onClick={() => move(img.id, -1)}>
                      ↑
                    </button>
                    <button title="ย้ายลง" onClick={() => move(img.id, +1)}>
                      ↓
                    </button>
                    {!img.is_primary && (
                      <button title="ตั้งเป็นรูปหลัก" onClick={() => setPrimary(img.id)}>
                        ★
                      </button>
                    )}
                    <button title="ลบรูป" onClick={() => remove(img.id)}>
                      🗑
                    </button>
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#666", wordBreak: "break-all" }}>{img.url}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
