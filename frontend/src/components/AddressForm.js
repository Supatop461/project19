import React from "react";

/**
 * Reusable address form for both Checkout and Account pages
 * Props:
 *  - value: { full_name, phone, line1, subdistrict, district, province, postcode }
 *  - onChange: (field, value) => void
 *  - disabled: boolean (lock inputs when using existing address)
 */
export default function AddressForm({ value = {}, onChange, disabled = false }) {
  const v = {
    full_name: value.full_name || "",
    phone: value.phone || "",
    line1: value.line1 || "",
    subdistrict: value.subdistrict || "",
    district: value.district || "",
    province: value.province || "",
    postcode: value.postcode || "",
  };

  const input = (name, placeholder, type = "text") => (
    <input
      type={type}
      className="input"
      placeholder={placeholder}
      value={v[name]}
      onChange={(e) => onChange(name, e.target.value)}
      disabled={disabled}
      required={!disabled} // ถ้าใช้ที่อยู่อื่น (กรอกใหม่) จะ require ให้ครบ
    />
  );

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        {input("full_name", "ชื่อ-นามสกุล")}
        {input("phone", "เบอร์โทร", "tel")}
      </div>

      {input("line1", "ที่อยู่ (บ้านเลขที่/ถนน/หมู่บ้าน)")}
      <div className="grid grid-cols-2 gap-3">
        {input("subdistrict", "ตำบล/แขวง")}
        {input("district", "อำเภอ/เขต")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {input("province", "จังหวัด")}
        {input("postcode", "รหัสไปรษณีย์")}
      </div>
    </div>
  );
}
