import React, { useState } from "react";
import axios from "axios";
import "./TogglePublish.css";

/**
 * kind: 'category' | 'subcategory' | 'product'
 * id:   รหัสของแถวนั้น (category_id / subcategory_id / product_id)
 * initial: ค่าสถานะเริ่มต้นจาก DB (boolean)
 */
export default function TogglePublish({ kind, id, initial=true, onChanged }) {
  const [on, setOn] = useState(!!initial);
  const [busy, setBusy] = useState(false);

  const url = {
    category:    `/api/admin/categories/${id}/publish`,
    subcategory: `/api/admin/subcategories/${id}/publish`,
    product:     `/api/admin/products/${id}/publish`,
  }[kind];

  const toggle = async () => {
    if (!url || busy) return;
    setBusy(true);
    try {
      const r = await axios.patch(url, { is_published: !on });
      const v = !!r.data?.is_published;
      setOn(v);
      onChanged?.(v);
      // แจ้งหน้าอื่น ๆ ในโดเมนเดียวกันให้รีโหลดได้ ถ้าต้องการ
      window.dispatchEvent(new Event(`${kind}s:changed`));
    } catch (e) {
      alert(e?.response?.data?.error || e.message || "อัปเดตการแสดงผลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className={`tp-btn ${on ? "on" : "off"}`}
      onClick={toggle}
      disabled={busy}
      title={on ? "กำลังแสดง" : "กำลังซ่อน"}
    >
      {busy ? "…" : on ? "แสดง" : "ซ่อน"}
    </button>
  );
}
