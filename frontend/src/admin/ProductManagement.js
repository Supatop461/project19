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

  /* ---------- new: filters/ui states ---------- */
  const [showArchived, setShowArchived] = useState(false);
  const [visibilityFilter, setVisibilityFilter] = useState('all'); // all|shown|hidden
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [subcatFilter, setSubcatFilter] = useState('');
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [perPage, setPerPage] = useState(20); // 10/20/50/100/0(all)
  const [page, setPage] = useState(1);

  // ✅ ดึง lookups จากฐานข้อมูล
  const { data: lookups, loading: lkLoading, error: lkError, reload: reloadLookups } =
    useLookups({ published: true });

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editProductId, setEditProductId] = useState(null);

  // ✅ ฟอร์มใช้ price (จำนวนเต็ม) แทน selling_price
  const [form, setForm] = useState({
    product_name: '',
    description: '',
    price: '',
    category_id: null,
    subcategory_id: null,
    product_unit_id: null,
    size_value: '',
    size_unit_id: null,
    origin: '',
    product_status_id: ''
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
    setProducts(prev =>
      (Array.isArray(prev) ? prev : []).map(p =>
        p.product_id === productId ? { ...p, is_published: !current } : p
      )
    );
    try {
      await api.patch(path(`/admin/products/${productId}/publish`), { is_published: !current });
      await fetchProducts();
    } catch (err) {
      setProducts(prev =>
        (Array.isArray(prev) ? prev : []).map(p =>
          p.product_id === productId ? { ...p, is_published: current } : p
        )
      );
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

    if (name === 'product_status_id') {
      return setForm((p) => ({ ...p, product_status_id: asStr(value) }));
    }

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
      price:               asStr(p.price ?? p.selling_price ?? ''),
      category_id:         asStr(p.category_id ?? '') || null,
      subcategory_id:      asStr(p.subcategory_id ?? '') || null,
      product_unit_id:     toInt(p.product_unit_id),
      size_value:          asStr(p.size_value ?? ''),
      size_unit_id:        toInt(p.size_unit_id),
      origin:              p.origin ?? '',
      product_status_id:   asStr(p.product_status_id ?? p.ProductStatusID ?? '')
    });
    setIsEditing(true);
    setEditProductId(p.product_id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearForm = () => {
    setForm({
      product_name: '', description: '', price: '',
      category_id: null, subcategory_id: null,
      product_unit_id: null,
      size_value: '', size_unit_id: null, origin: '',
      product_status_id: ''
    });
    setSelectedFiles([]);
    setIsEditing(false);
    setEditProductId(null);
  };

  /* ---------- Submit ---------- */
  const onSubmit = async (e) => {
    e.preventDefault();

    const trimmedPrice = asStr(form.price).trim();
    const priceInt = Number.parseInt(trimmedPrice, 10);
    if (!Number.isInteger(priceInt) || priceInt < 0 || asStr(priceInt) !== trimmedPrice.replace(/^0+(?=\d)/, '')) {
      return alert('ราคา ต้องเป็น "จำนวนเต็มไม่ติดลบ" เท่านั้น');
    }

    const catIdStr = asStr(form.category_id).trim();
    if (!catIdStr) {
      alert('กรุณาเลือก "ประเภท" ให้ถูกต้อง');
      catRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const statusText = (asStr(form.product_status_id).trim() || null);

    const puId = toInt(form.product_unit_id);
    if (puId == null) return alert('กรุณาเลือก "หน่วยสินค้า"');

    const suId    = form.size_unit_id != null ? toInt(form.size_unit_id) : null;
    const sValStr = asStr(form.size_value).trim();
    const sizeV   = sValStr === '' ? null : toNum(sValStr);
    if (sizeV !== null && suId == null) return alert('กรุณาเลือก "หน่วยของขนาด" ให้ครบ');
    if (sizeV === null && suId !== null) return alert('กรุณากรอก "ขนาดสินค้า (ตัวเลข)" ให้ครบ');

    let uploadedUrls = [];
    if (selectedFiles.length > 0) {
      try { uploadedUrls = (await Promise.all(selectedFiles.map(f => uploadImage(f)))).filter(Boolean); }
      catch (err) { return handleApiError(err, '❌ อัปโหลดรูปไม่สำเร็จ'); }
    }

    const body = {
      product_name: (form.product_name || '').trim(),
      description: form.description || '',
      price: priceInt,
      category_id: catIdStr,
      subcategory_id: (asStr(form.subcategory_id || '').trim() || null),
      product_status_id: statusText,
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

  // หน่วย
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

  /* ---------- view data: search/filter/group/paginate ---------- */
  const viewProductsBase = useMemo(() => {
    if (!Array.isArray(products)) return [];
    const q = query.trim().toLowerCase();
    return products.filter(p => {
      const published = (typeof p.is_published === 'boolean') ? p.is_published : true;
      if (visibilityFilter === 'shown' && !published) return false;
      if (visibilityFilter === 'hidden' && published) return false;
      if (catFilter && asStr(p.category_id) !== asStr(catFilter)) return false;
      if (subcatFilter && asStr(p.subcategory_id) !== asStr(subcatFilter)) return false;
      if (q) {
        const hay = [
          p.product_name, p.description,
          p.category_name, p.subcategory_name,
          p.origin
        ].map(asStr).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [products, visibilityFilter, catFilter, subcatFilter, query]);

  useEffect(() => { setPage(1); }, [visibilityFilter, catFilter, subcatFilter, query, perPage, groupByCategory]);

  const total = viewProductsBase.length;
  const totalPages = perPage && perPage > 0 ? Math.max(1, Math.ceil(total / perPage)) : 1;
  const pageSafe = Math.min(page, totalPages);
  const paged = useMemo(() => {
    if (!perPage || perPage === 0) return viewProductsBase;
    const start = (pageSafe - 1) * perPage;
    const end = start + perPage;
    return viewProductsBase.slice(start, end);
  }, [viewProductsBase, perPage, pageSafe]);

  const grouped = useMemo(() => {
    if (!groupByCategory) return null;
    const map = new Map();
    for (const p of paged) {
      const key = p.category_name || '(ไม่ระบุประเภท)';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    }
    return Array.from(map.entries());
  }, [groupByCategory, paged]);

  if (loading || lkLoading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;
  if (lkError) console.warn('⚠ lookups error:', lkError);

  return (
    <div className="pm-page">
      {/* quick links */}
      <div className="pm-links">
        <Link to="/admin/categories" className="btn btn-ghost">📂 จัดการประเภท</Link>
        <Link to="/admin/subcategories" className="btn btn-ghost">🗂️ จัดการหมวดย่อย</Link>
        <Link to="/admin/units" className="btn btn-ghost">📏 จัดการหน่วยสินค้า</Link>
        <Link to="/admin/sizes" className="btn btn-ghost">📐 จัดการหน่วยขนาด</Link>
      </div>

      {/* form panel */}
      <div className="pm-panel">
        <h2>{isEditing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2>

        <form onSubmit={onSubmit} className="pm-form">
          {/* แถว 1 */}
          <div className="frm">
            <label htmlFor="product_name">ชื่อสินค้า</label>
            <input id="product_name" name="product_name" placeholder="เช่น ยางอินโด/Monstera" value={form.product_name} onChange={onChange} />
          </div>

          <div className="frm">
            <label htmlFor="price">ราคา (จำนวนเต็ม)</label>
            <input
              id="price"
              name="price"
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              placeholder="เช่น 150"
              value={form.price}
              onChange={onChange}
            />
          </div>

          {/* แถว 2 */}
          <div className="frm pm-input-group pm-row-3 col-span-2">
            <div className="frm">
              <label htmlFor="size_value">ขนาดสินค้า (ตัวเลข)</label>
              <input
                id="size_value"
                name="size_value"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                placeholder="เช่น 50"
                value={form.size_value}
                onChange={onChange}
                title="เช่น 50"
              />
            </div>
            <div className="frm">
              <label htmlFor="size_unit_id">หน่วยของขนาด</label>
              <select id="size_unit_id" name="size_unit_id" value={form.size_unit_id ?? ''} onChange={onChange} title="หน่วยของขนาด">
                {sizeUnitOptions}
              </select>
            </div>
            <div className="frm">
              <label htmlFor="product_unit_id">หน่วยสินค้า</label>
              <select id="product_unit_id" name="product_unit_id" value={form.product_unit_id ?? ''} onChange={onChange} title="หน่วยสินค้า">
                {productUnitOptions}
              </select>
            </div>
          </div>

          {/* แถว 3 */}
          <div className="frm">
            <label htmlFor="origin">แหล่งที่มา</label>
            <input id="origin" name="origin" placeholder="เช่น สวนที่ จ.เชียงใหม่" value={form.origin} onChange={onChange} />
          </div>

          <div className="frm">
            <label htmlFor="product_status_id">สถานะสินค้า</label>
            <select id="product_status_id" name="product_status_id" value={asStr(form.product_status_id ?? '')} onChange={onChange}>
              {statusOptions}
            </select>
          </div>

          {/* แถว 4 */}
          <div className="frm">
            <label htmlFor="category_id">ประเภทสินค้า</label>
            <select ref={catRef} id="category_id" name="category_id" value={form.category_id ?? ''} onChange={onChange}>
              {categoryOptions}
            </select>
          </div>

          <div className="frm">
            <label htmlFor="subcategory_id">หมวดหมู่ย่อย</label>
            <select id="subcategory_id" name="subcategory_id" value={form.subcategory_id ?? ''} onChange={onChange}>
              <option value="">{filteredSubcategoriesByForm.length ? 'เลือกหมวดย่อย' : '— ไม่มีหมวดย่อย —'}</option>
              {filteredSubcategoriesByForm
                .slice()
                .sort((a,b)=>asStr(a.subcategory_name).localeCompare(asStr(b.subcategory_name),'th'))
                .map(s => (
                  <option key={s.subcategory_id} value={asStr(s.subcategory_id)}>{s.subcategory_name}</option>
                ))}
            </select>
          </div>

          {/* แถว 5 */}
          <div className="frm col-span-2">
            <label htmlFor="description">คำอธิบายสินค้า</label>
            <textarea id="description" name="description" placeholder="อธิบายรายละเอียด เช่น วิธีดูแล/คุณสมบัติ" value={form.description} onChange={onChange} />
          </div>

          {/* แถว 6: รูปภาพ */}
          <div className="frm col-span-2">
            <label htmlFor="images">รูปภาพสินค้า</label>
            <input id="images" className="col-span-2" type="file" accept="image/*" multiple onChange={onFiles} />
            <div className="hint">รูปแรกจะถูกตั้งเป็น “รูปหลัก” อัตโนมัติ</div>
          </div>

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

          {/* Actions */}
          <div className="pm-actions col-span-2">
            <button type="submit" className="btn btn-primary">{isEditing ? 'อัปเดต' : 'บันทึก'}</button>
            {isEditing && <button type="button" className="btn btn-ghost" onClick={clearForm}>ยกเลิกแก้ไข</button>}
          </div>
        </form>
      </div>

      {/* ---------- Toolbar: filters/search/paging ---------- */}
      <div className="pm-toolbar-2">
        <div className="seg">
          <button type="button" className={`seg-btn ${visibilityFilter==='all' ? 'active': ''}`} onClick={()=>setVisibilityFilter('all')}>ทั้งหมด</button>
          <button type="button" className={`seg-btn ${visibilityFilter==='shown' ? 'active': ''}`} onClick={()=>setVisibilityFilter('shown')}>เฉพาะที่แสดง</button>
          <button type="button" className={`seg-btn ${visibilityFilter==='hidden' ? 'active': ''}`} onClick={()=>setVisibilityFilter('hidden')}>เฉพาะที่ซ่อน</button>
        </div>

        <input
          className="pm-search"
          placeholder="ค้นหาชื่อ/รายละเอียด/แหล่งที่มา…"
          value={query}
          onChange={(e)=>setQuery(e.target.value)}
        />

        <select className="pm-filter" value={catFilter} onChange={(e)=>{ setCatFilter(e.target.value); setSubcatFilter(''); }}>
          <option value="">ทุกประเภท</option>
          {(lookups.product_categories || []).map(c=>(
            <option key={c.category_id} value={asStr(c.category_id)}>{c.category_name}</option>
          ))}
        </select>

        <select className="pm-filter" value={subcatFilter} onChange={(e)=>setSubcatFilter(e.target.value)}>
          <option value="">ทุกหมวดย่อย</option>
          {(lookups.subcategories || [])
            .filter(s => !catFilter || asStr(s.category_id ?? s.parent_id) === asStr(catFilter))
            .map(s=>(
              <option key={s.subcategory_id} value={asStr(s.subcategory_id)}>{s.subcategory_name}</option>
            ))}
        </select>

        <label className="pm-switch">
          <input
            type="checkbox"
            checked={groupByCategory}
            onChange={(e)=>setGroupByCategory(e.target.checked)}
          />
          <span className="toggle-ui" aria-hidden="true"></span>
          <span className="toggle-label">จัดกลุ่มตามประเภท</span>
        </label>

        <div className="pm-perpage">
          <span>แสดง</span>
          <select value={perPage} onChange={(e)=>setPerPage(Number(e.target.value))}>
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={0}>ทั้งหมด</option>
          </select>
          <span>รายการ/หน้า</span>
        </div>

        <button
          type="button"
          className={`btn-archived ${showArchived ? 'active' : ''}`}
          onClick={() => setShowArchived(v => !v)}
          aria-pressed={showArchived}
        >
          <span className="icon" aria-hidden>🗃️</span>
          {showArchived ? 'กำลังแสดง: สินค้าที่เก็บแล้ว' : 'แสดงสินค้าที่เก็บแล้ว'}
        </button>
      </div>

      {/* ---------- Summary + Pagination ---------- */}
      <div className="pm-summary">
        <div>ทั้งหมด {total.toLocaleString()} รายการ</div>
        {perPage !== 0 && (
          <div className="pm-pager">
            <button className="btn-ghost" disabled={pageSafe<=1} onClick={()=>setPage(p=>Math.max(1, p-1))}>‹ ก่อนหน้า</button>
            <span>หน้า {pageSafe} / {totalPages}</span>
            <button className="btn-ghost" disabled={pageSafe>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages, p+1))}>ถัดไป ›</button>
          </div>
        )}
      </div>

      {/* ---------- Table / Grouped View ---------- */}
      <h2>รายการสินค้า</h2>
      <div className="pm-table-wrap">
        {!groupByCategory ? (
          <table className="pm-table">
            <thead>
              <tr>
                <th>สินค้า</th><th>ราคา</th><th>คงเหลือ</th><th>หมวดหมู่</th><th>สถานะ</th><th>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(paged || []).map(p => {
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
                    <td>{Number(p.price ?? p.selling_price ?? 0).toLocaleString()}</td>
                    <td>{p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0}</td>
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
              {(!paged || paged.length === 0) && (
                <tr><td colSpan={6} style={{ color:'#777' }}>— ไม่มีข้อมูล —</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <div className="pm-groups">
            {(grouped || []).map(([catName, items]) => (
              <div className="pm-group" key={catName}>
                <div className="pm-group-title">{catName} <span className="pm-group-count">{items.length} รายการ</span></div>
                <table className="pm-table small">
                  <thead>
                    <tr>
                      <th>สินค้า</th><th>ราคา</th><th>คงเหลือ</th><th>หมวดย่อย</th><th>สถานะ</th><th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(p => {
                      const published = (typeof p.is_published === 'boolean') ? p.is_published : true;
                      return (
                        <tr key={p.product_id} className={p.is_archived ? 'is-archived' : ''}>
                          <td>
                            <span className={`pill ${published ? 'on' : 'off'}`}>{published ? 'กำลังแสดง' : 'ถูกซ่อน'}</span>
                            <span className="name-with-badges">{p.product_name}{p.is_archived && <span className="badge-archived">เก็บแล้ว</span>}</span>
                          </td>
                          <td>{Number(p.price ?? p.selling_price ?? 0).toLocaleString()}</td>
                          <td>{p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0}</td>
                          <td>{p.subcategory_name || '-'}</td>
                          <td>{p.product_status_name ?? pickStatusName(p)}</td>
                          <td className="cell-actions">
                            <button className={`btn ${published ? 'btn-warn' : 'btn-primary'}`} onClick={() => togglePublish(p.product_id, published)}>
                              {published ? 'ไม่แสดง' : 'แสดง'}
                            </button>
                            <button className="btn btn-ghost" onClick={() => onEdit(p)}>แก้ไข</button>
                            {!p.is_archived ? (
                              <button className="btn btn-warn" onClick={() => archiveProduct(p.product_id)}>เก็บ</button>
                            ) : (
                              <button className="btn btn-primary" onClick={() => unarchiveProduct(p.product_id)}>กู้คืน</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            {(!grouped || grouped.length === 0) && <div style={{color:'#777'}}>— ไม่มีข้อมูล —</div>}
          </div>
        )}
      </div>
    </div>
  );
}
