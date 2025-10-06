// frontend/src/admin/ProductManagement.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './ProductManagement.css';
import { api, path } from '../lib/api';
import { useLookups } from '../lib/lookups';

/* ---------- Helpers ---------- */
const asStr = (v) => (v === null || v === undefined) ? '' : String(v);
const pickStatusName = (x) => x?.status_name ?? x?.StatusName ?? x?.name ?? '';
const toInt = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};
const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s฿]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export default function ProductManagement() {
  const [products, setProducts] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(false);

  const [showArchived, setShowArchived] = useState(false);
  const [visibilityFilter, setVisibilityFilter] = useState('all');

  const { data: lookups, loading: lkLoading, error: lkError, reload: reloadLookups } = useLookups({ published: true });

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editProductId, setEditProductId] = useState(null);

  // เก็บ id เป็น number/ string ตามชนิดจริงของแต่ละฟิลด์
  const [form, setForm] = useState({
    product_name: '',
    description: '',
    selling_price: '',
    category_id: null,      // TEXT
    subcategory_id: null,   // TEXT
    product_unit_id: null,  // number
    size_value: '',
    size_unit_id: null,     // number
    origin: '',
    product_status_id: ''   // ✅ เก็บเป็น string ให้แมตช์ option
  });

  const catRef = useRef(null);

  /* ---------- API helpers ---------- */
  const handleApiError = (err, fallback = 'เกิดข้อผิดพลาด') => {
    console.error(fallback, err?.response?.data || err?.message || err);
    alert(err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback);
  };

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await api.get(path('/admin/products'), {
        params: { include_archived: showArchived ? 1 : 0 }
      });
      const items = Array.isArray(data?.items) ? data.items : data;
      setProducts(items || []);
    } catch (err) {
      handleApiError(err, '❌ โหลดสินค้าไม่สำเร็จ');
    }
  }, [showArchived]);

  const fetchStatuses = useCallback(async () => {
    try {
      let res = await api.get(path('/product-status'));
      if (!Array.isArray(res.data)) {
        try { res = await api.get(path('/product-statuses')); } catch {}
      }
      const normalized = (res.data || []).map((x) => ({
        id: asStr(x?.product_status_id ?? x?.ProductStatusID ?? x?.id),
        name: pickStatusName(x)
      }));
      setStatuses(normalized);
    } catch {
      console.warn('⚠ ไม่มี endpoint product-status | product-statuses');
      setStatuses([]);
    }
  }, []);

  /* ---------- Upload ---------- */
  async function uploadImage(file) {
    if (!file) return null;
    const sendWith = async (field) => {
      const fd = new FormData();
      fd.append(field, file);
      const res = await api.post(path('/upload'), fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res?.data?.imageUrl || res?.data?.url || res?.data?.path || res?.data?.location || null;
    };
    try { return await sendWith('file'); }
    catch (e1) {
      const msg = e1?.response?.data?.error || '';
      if (/no file uploaded/i.test(msg) || e1?.response?.status === 400) {
        try { return await sendWith('image'); }
        catch (e2) {
          const msg2 = e2?.response?.data?.error || '';
          if (/no file uploaded/i.test(msg2) || e2?.response?.status === 400) return await sendWith('photo');
          throw e2;
        }
      }
      throw e1;
    }
  }

  /* ---------- Toggles ---------- */
  const togglePublish = useCallback(async (productId, current) => {
    try {
      await api.patch(path(`/admin/products/${productId}/publish`), { is_published: !current });
      await fetchProducts();
    } catch (err) {
      handleApiError(err, '❌ อัปเดตการแสดงผลไม่สำเร็จ');
    }
  }, [fetchProducts]);

  const archiveProduct = useCallback(async (productId) => {
    if (!window.confirm('ย้ายสินค้านี้ไปถังเก็บใช่ไหม?')) return;
    try {
      await api.delete(path(`/admin/products/${productId}`));
      await fetchProducts();
    } catch (err) {
      handleApiError(err, '❌ ย้ายไปถังเก็บไม่สำเร็จ');
    }
  }, [fetchProducts]);

  const unarchiveProduct = useCallback(async (productId) => {
    try {
      await api.patch(path(`/admin/products/${productId}/unarchive`));
    } catch (err) {
      return handleApiError(err, '❌ กู้คืนสินค้าไม่สำเร็จ');
    }
    await fetchProducts();
  }, [fetchProducts]);

  /* ---------- init ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchProducts(), fetchStatuses(), reloadLookups()]);
      setLoading(false);
    })();
  }, [fetchProducts, fetchStatuses, reloadLookups, showArchived]);

  /* ---------- form handlers ---------- */
  const onChange = (e) => {
    const { name, value } = e.target;

    if (name === 'category_id') {
      const cid = asStr(value).trim() || null;
      return setForm((p) => ({ ...p, category_id: cid, subcategory_id: null }));
    }

    if (name === 'subcategory_id') {
      const sid = asStr(value).trim();
      return setForm((p) => ({ ...p, subcategory_id: sid || null }));
    }

    // ✅ product_status_id เก็บเป็นสตริง (ให้ตรงกับ <option value="...">)
    if (name === 'product_status_id') {
      return setForm((p) => ({ ...p, product_status_id: asStr(value) }));
    }

    // ตัวที่เป็นตัวเลขจริง ๆ
    if (name === 'product_unit_id' || name === 'size_unit_id') {
      return setForm((p) => ({ ...p, [name]: toInt(value) }));
    }

    setForm((p) => ({ ...p, [name]: value }));
  };

  const onFiles = (e) => setSelectedFiles(Array.from(e.target.files || []));
  useEffect(() => {
    if (!selectedFiles?.length) { setPreviews([]); return; }
    const urls = selectedFiles.map((f) => ({
      name: f.name, url: URL.createObjectURL(f), size: f.size, type: f.type,
    }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [selectedFiles]);

  const removeSelectedAt = (idx) => setSelectedFiles((prev) => prev.filter((_, i) => i !== idx));
  const moveSelected = (idx, dir) => {
    setSelectedFiles((prev) => {
      const arr = [...prev];
      const to = idx + dir;
      if (to < 0 || to >= arr.length) return arr;
      const t = arr[idx]; arr[idx] = arr[to]; arr[to] = t;
      return arr;
    });
  };

  const onEdit = (p) => {
    setForm({
      product_name:        p.product_name ?? '',
      description:         p.description ?? '',
      selling_price:       asStr(p.selling_price ?? ''),
      category_id:         asStr(p.category_id ?? '') || null,
      subcategory_id:      asStr(p.subcategory_id ?? '') || null,
      product_unit_id:     toInt(p.product_unit_id),
      size_value:          asStr(p.size_value ?? ''),
      size_unit_id:        toInt(p.size_unit_id),
      origin:              p.origin ?? '',
      product_status_id:   asStr(p.product_status_id ?? p.ProductStatusID ?? '') // ✅ เก็บเป็น string
    });
    setIsEditing(true);
    setEditProductId(p.product_id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearForm = () => {
    setForm({
      product_name: '', description: '', selling_price: '',
      category_id: null, subcategory_id: null,
      product_unit_id: null,
      size_value: '', size_unit_id: null, origin: '',
      product_status_id: '' // ✅
    });
    setSelectedFiles([]);
    setIsEditing(false);
    setEditProductId(null);
  };

  /* ---------- Submit ---------- */
  const onSubmit = async (e) => {
    e.preventDefault();

    // ตรวจราคาขาย
    const trimmedPrice = asStr(form.selling_price).trim();
    const priceInt = Number.parseInt(trimmedPrice, 10);
    if (!Number.isInteger(priceInt) || priceInt < 0 || asStr(priceInt) !== trimmedPrice.replace(/^0+(?=\d)/, '')) {
      return alert('ราคาขายต้องเป็น "จำนวนเต็มไม่ติดลบ" เท่านั้น');
    }

    // ต้องเลือกประเภท
    const catIdStr = asStr(form.category_id).trim();
    if (!catIdStr) {
      alert('กรุณาเลือก "ประเภท" ให้ถูกต้อง');
      catRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // ✅ ส่งสถานะเป็น TEXT (เช่น 'p1'/'p2') ให้ตรงกับสคีมา
    const statusText = (asStr(form.product_status_id).trim() || null);

    // หน่วยสินค้า (จำเป็น)
    const puId = toInt(form.product_unit_id);
    if (puId == null) return alert('กรุณาเลือก "หน่วยสินค้า"');

    // หน่วยขนาด/ค่า (ต้องเป็นคู่)
    const suId    = form.size_unit_id != null ? toInt(form.size_unit_id) : null;
    const sValStr = asStr(form.size_value).trim();
    const sizeV   = sValStr === '' ? null : toNum(sValStr);
    if (sizeV !== null && suId == null) return alert('กรุณาเลือก "หน่วยของขนาด" ให้ครบ');
    if (sizeV === null && suId !== null) return alert('กรุณากรอก "ขนาดสินค้า (ตัวเลข)" ให้ครบ');

    // อัปโหลดไฟล์ก่อน (ถ้ามี)
    let uploadedUrls = [];
    if (selectedFiles.length > 0) {
      try { uploadedUrls = (await Promise.all(selectedFiles.map(f => uploadImage(f)))).filter(Boolean); }
      catch (err) { return handleApiError(err, '❌ อัปโหลดรูปไม่สำเร็จ'); }
    }

    const body = {
      product_name: (form.product_name || '').trim(),
      description: form.description || '',
      selling_price: priceInt,
      category_id: catIdStr,
      subcategory_id: (asStr(form.subcategory_id || '').trim() || null),
      product_status_id: statusText, // ✅ ส่ง TEXT เข้าตรง ๆ
      product_unit_id: puId,
      size_unit_id: suId,
      size_value: sizeV,
      origin: form.origin || null
    };

    try {
      let createdId = editProductId;
      if (isEditing && editProductId) {
        await api.put(path(`/admin/products/${editProductId}`), body);
      } else {
        const res = await api.post(path('/admin/products'), body);
        createdId = res?.data?.product_id ?? res?.data?.id ?? res?.data?.ProductID ?? createdId;
      }

      if (createdId && uploadedUrls.length > 0) {
        const imagesPayload = uploadedUrls.map((url, i) => ({
          url, alt_text: previews[i]?.name || null, is_primary: i === 0, position: i + 1
        }));
        try {
          await api.post(path(`/admin/products/${createdId}/images`), { images: imagesPayload });
        } catch {
          for (const img of imagesPayload) {
            try {
              try {
                await api.post(path('/product-images'), {
                  product_id: createdId, url: img.url, alt_text: img.alt_text, is_primary: img.is_primary, position: img.position
                });
              } catch {
                await api.post(path('/admin/product-images'), {
                  product_id: createdId, url: img.url, alt_text: img.alt_text, is_primary: img.is_primary, position: img.position
                });
              }
            } catch (err) {
              console.warn('⚠ บันทึกรูปไม่สำเร็จ', err?.response?.data || err?.message || err);
            }
          }
        }
      }

      await fetchProducts();
      await reloadLookups();
      clearForm();
    } catch (err) {
      handleApiError(err, '❌ บันทึกสินค้าไม่สำเร็จ');
    }
  };

  /* ---------- options ---------- */
  const statusOptions = useMemo(() => ([
    <option key="" value="">— เลือกสถานะ —</option>,
    ...statuses.map(s => <option key={s.id} value={asStr(s.id)}>{s.name || '(ไม่มีชื่อ)'}</option>)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [JSON.stringify(statuses)]);

  const categoryOptions = useMemo(() => ([
    <option key="" value="">เลือกประเภท</option>,
    ...(lookups.product_categories || []).map(c => (
      <option key={c.category_id} value={asStr(c.category_id)}>{c.category_name}</option>
    ))
  ]), [lookups.product_categories]);

  const filteredSubcategoriesByForm = useMemo(() => {
    const all = Array.isArray(lookups.subcategories) ? lookups.subcategories : [];
    const cid = asStr(form.category_id || '').trim();
    if (!cid) return all;
    const byCat = all.filter(s => asStr(s.category_id ?? s.parent_id) === cid);
    return byCat.length > 0 ? byCat : all;
  }, [form.category_id, lookups.subcategories]);

  const subcategoryOptions = useMemo(() => ([
    <option key="" value="">
      {filteredSubcategoriesByForm.length ? 'เลือกหมวดย่อย' : '— ไม่มีหมวดย่อย —'}
    </option>,
    ...filteredSubcategoriesByForm
      .slice()
      .sort((a,b)=>asStr(a.subcategory_name).localeCompare(asStr(b.subcategory_name),'th'))
      .map(s => (
        <option key={s.subcategory_id} value={asStr(s.subcategory_id)}>{s.subcategory_name}</option>
      ))
  ]), [filteredSubcategoriesByForm]);

  const sizeUnitOptions = useMemo(() => ([
    <option key="" value="">— เลือกหน่วยขนาด —</option>,
    ...(lookups.size_units || []).map(u => {
      const id = u.size_unit_id ?? u.id;
      const name = u.unit_name || u.size_unit_name || u.name || '';
      return <option key={id} value={asStr(id)}>{name}</option>;
    })
  ]), [lookups.size_units]);

  const productUnitOptions = useMemo(() => ([
    <option key="" value="">— เลือกหน่วยสินค้า —</option>,
    ...(lookups.product_units || []).map(u => {
      const id = u.unit_id ?? u.id;
      const name = u.unit_name || u.name || '';
      return <option key={id} value={asStr(id)}>{name}</option>;
    })
  ]), [lookups.product_units]);

  /* ---------- filters ---------- */
  const viewProducts = useMemo(() => {
    if (!Array.isArray(products)) return [];
    return products.filter(p => {
      const published = (typeof p.is_published === 'boolean') ? p.is_published : true;
      if (visibilityFilter === 'shown' && !published) return false;
      if (visibilityFilter === 'hidden' && published) return false;
      return true;
    });
  }, [products, visibilityFilter]);

  if (loading || lkLoading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;
  if (lkError) console.warn('⚠ lookups error:', lkError);

  return (
    <div className="pm-page">
      <div style={{display:'flex', gap:8, margin:'12px 0 20px', flexWrap:'wrap'}}>
        <Link to="/admin/categories" className="btn btn-ghost">📂 จัดการประเภท</Link>
        <Link to="/admin/subcategories" className="btn btn-ghost">🗂️ จัดการหมวดย่อย</Link>
        <Link to="/admin/units" className="btn btn-ghost">📏 จัดการหน่วยสินค้า</Link>
        <Link to="/admin/sizes" className="btn btn-ghost">📐 จัดการหน่วยขนาด</Link>
      </div>

      <div className="pm-panel">
        <h2>{isEditing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2>

        <form onSubmit={onSubmit} className="pm-form">
          <input name="product_name" placeholder="ชื่อสินค้า" value={form.product_name} onChange={onChange} />

          <input
            name="selling_price"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            placeholder="ราคาขาย (จำนวนเต็มเท่านั้น)"
            value={form.selling_price}
            onChange={onChange}
          />

          <div className="pm-input-group pm-row-3 col-span-2">
            <input
              name="size_value"
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              placeholder="ขนาดสินค้า (ตัวเลข)"
              value={form.size_value}
              onChange={onChange}
              title="เช่น 50"
            />
            <select name="size_unit_id" value={form.size_unit_id ?? ''} onChange={onChange} title="หน่วยของขนาด">
              {sizeUnitOptions}
            </select>
            <select name="product_unit_id" value={form.product_unit_id ?? ''} onChange={onChange} title="หน่วยสินค้า">
              {productUnitOptions}
            </select>
          </div>

          <input name="origin" placeholder="แหล่งที่มา" value={form.origin} onChange={onChange} />

          {/* ✅ ค่าคุมด้วยสตริงให้ตรงกับ option */}
          <select name="product_status_id" value={asStr(form.product_status_id ?? '')} onChange={onChange}>
            {statusOptions}
          </select>

          <select ref={catRef} name="category_id" value={form.category_id ?? ''} onChange={onChange}>
            {categoryOptions}
          </select>

          <select name="subcategory_id" value={form.subcategory_id ?? ''} onChange={onChange}>
            {subcategoryOptions}
          </select>

          <textarea className="col-span-2" name="description" placeholder="คำอธิบายสินค้า" value={form.description} onChange={onChange} />

          <input className="col-span-2" type="file" accept="image/*" multiple onChange={onFiles} />

          {previews.length > 0 && (
            <div className="pm-files-preview col-span-2">
              {previews.map((p, idx) => (
                <div className="pm-file" key={p.url}>
                  <span className="pm-badge" title={idx === 0 ? 'รูปหลักเมื่อบันทึก' : `ลำดับที่ ${idx + 1}`}>{idx === 0 ? '★' : idx + 1}</span>
                  <img src={p.url} alt={p.name} />
                  <div className="pm-meta">
                    <div className="pm-name" title={p.name}>{p.name}</div>
                    <div className="pm-actions">
                      <button type="button" className="btn-xxs" onClick={() => moveSelected(idx, -1)} disabled={idx === 0}>↑</button>
                      <button type="button" className="btn-xxs" onClick={() => moveSelected(idx, +1)} disabled={idx === previews.length - 1}>↓</button>
                      <button type="button" className="btn-xxs danger" onClick={() => removeSelectedAt(idx)}>ลบ</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pm-actions col-span-2">
            <button type="submit" className="btn btn-primary">{isEditing ? 'อัปเดต' : 'บันทึก'}</button>
            {isEditing && <button type="button" className="btn btn-ghost" onClick={clearForm}>ยกเลิกแก้ไข</button>}
          </div>
        </form>
      </div>

      <div className="pm-toolbar">
        <div className="seg">
          <button type="button" className={`seg-btn ${visibilityFilter==='all' ? 'active': ''}`} onClick={()=>setVisibilityFilter('all')}>ทั้งหมด</button>
          <button type="button" className={`seg-btn ${visibilityFilter==='shown' ? 'active': ''}`} onClick={()=>setVisibilityFilter('shown')}>เฉพาะที่แสดง</button>
          <button type="button" className={`seg-btn ${visibilityFilter==='hidden' ? 'active': ''}`} onClick={()=>setVisibilityFilter('hidden')}>เฉพาะที่ซ่อน</button>
        </div>

        <button
          type="button"
          className={`btn-archived ${showArchived ? 'active' : ''}`}
          onClick={() => setShowArchived(v => !v)}
          aria-pressed={showArchived}
          title={showArchived ? 'คลิกเพื่อซ่อนสินค้าที่เก็บแล้ว' : 'คลิกเพื่อแสดงสินค้าที่เก็บแล้ว'}
        >
          <span className="icon" aria-hidden>🗃️</span>
          {showArchived ? 'กำลังแสดง: สินค้าที่เก็บแล้ว' : 'แสดงสินค้าที่เก็บแล้ว'}
        </button>
      </div>

      <h2>รายการสินค้า</h2>
      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead>
            <tr>
              <th>สินค้า</th><th>ราคา</th><th>คงเหลือ</th><th>หมวดหมู่</th><th>สถานะ</th><th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {(viewProducts || []).map(p => {
              const published = (typeof p.is_published === 'boolean') ? p.is_published : true;
              return (
                <tr key={p.product_id} className={p.is_archived ? 'is-archived' : ''}>
                  <td>
                    <span className={`pill ${published ? 'on' : 'off'}`}>{published ? 'กำลังแสดง' : 'ถูกซ่อน'}</span>
                    <span className="name-with-badges">
                      {p.product_name}
                      {p.is_archived && <span className="badge-archived">เก็บแล้ว</span>}
                    </span>
                  </td>
                  <td>{Number(p.selling_price ?? 0).toLocaleString()}</td>
                  <td>{p.stock ?? p.stock_quantity ?? 0}</td>
                  <td>{`${p.category_name || '-'} / ${p.subcategory_name || '-'}`}</td>
                  <td>{p.product_status_name ?? pickStatusName(p)}</td>
                  <td className="cell-actions">
                    <button className={`btn ${published ? 'btn-warn' : 'btn-primary'}`} onClick={() => togglePublish(p.product_id, published)}>
                      {published ? 'ไม่แสดงสินค้า' : 'แสดงสินค้า'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => onEdit(p)}>แก้ไข</button>
                    {!p.is_archived ? (
                      <button className="btn btn-warn" onClick={() => archiveProduct(p.product_id)}>ย้ายไปถังเก็บ</button>
                    ) : (
                      <button className="btn btn-primary" onClick={() => unarchiveProduct(p.product_id)}>กู้คืน</button>
                    )}
                    <Link to={`/admin/products/${p.product_id}/variants`} className="btn btn-ghost">ตัวเลือก/ขนาด</Link>
                  </td>
                </tr>
              );
            })}
            {(!viewProducts || viewProducts.length === 0) && (
              <tr><td colSpan={6} style={{ color:'#777' }}>— ไม่มีข้อมูล —</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
