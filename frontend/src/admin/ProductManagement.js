// frontend/src/admin/ProductManagement.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './ProductManagement.css';
import { api, path, mediaSrc } from '../lib/api'; // ✅ ใช้ mediaSrc กันเคส URL เป็น relative
import { useLookups } from '../lib/lookups';

/* ---------- Helpers ---------- */

// -------- SKU pretty formatter (hide empty parts) --------
const _hasText = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const formatSkuLine = (s) => {
  const parts = [];
  if (_hasText(s.option_text)) parts.push(String(s.option_text));
  if (s.price !== null && s.price !== undefined && String(s.price) !== '') {
    const pv = Number(String(s.price).replace(/[\s,฿]/g, ''));
    if (Number.isFinite(pv)) parts.push('฿' + pv.toLocaleString());
  }
  if (s.stock !== null && s.stock !== undefined && String(s.stock) !== '') {
    const sv = Number(String(s.stock).replace(/[\s,]/g, ''));
    if (Number.isFinite(sv)) parts.push('สต็อก ' + sv.toLocaleString());
  }
  if (_hasText(s.sku)) parts.push(String(s.sku));
  return parts.join(' — ');
};

const asStr = (v) => (v === null || v === undefined) ? '' : String(v);
const toInt = (v) => {
  const n = parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
};
const toNum = (v) => {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s฿]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/* ---------- Tiny Toast (in-file) ---------- */
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = (msg, type = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((xs) => [...xs, { id, msg, type }]);
    setTimeout(() => setToasts((xs) => xs.filter(t => t.id !== id)), 3000);
  };
  const remove = (id) => setToasts((xs) => xs.filter(t => t.id !== id));
  return { toasts, push, remove };
}

export default function ProductManagement() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);

  /* ---------- filters/ui states ---------- */
  const [showArchived, setShowArchived] = useState(false);
  const [visibilityFilter, setVisibilityFilter] = useState('all'); // all|shown|hidden
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [subcatFilter, setSubcatFilter] = useState('');
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [perPage, setPerPage] = useState(20); // 10/20/50/100/0(all)
  const [page, setPage] = useState(1);

  // กรองตามสต็อก + สรุปจำนวนใกล้หมด/หมด
  const [stockFilter, setStockFilter] = useState('all'); // all | low | out

  // ✅ lookups
  const { data: lookups, loading: lkLoading, error: lkError, reload: reloadLookups } =
    useLookups({ published: true });

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editProductId, setEditProductId] = useState(null);

  // ✅ ฟอร์ม (ไม่ใช้ product_status_id)
  const [form, setForm] = useState({
    product_name: '',
    description: '',
    price: '',
    category_id: null,
    subcategory_id: null,
    product_unit_id: null,
    size_value: '',
    size_unit_id: null,
    origin: ''
  });

  /* ---------- Variants Panel ---------- */
  const [variantsOpen, setVariantsOpen] = useState(false);

  // ชื่อตัวเลือก 1–3
  const [opt1Name, setOpt1Name] = useState('สี');
  const [opt2Name, setOpt2Name] = useState('ขนาด');
  const [opt3Name, setOpt3Name] = useState('');

  // ค่าของตัวเลือก (chips)
  const [opt1Values, setOpt1Values] = useState([]);
  const [opt2Values, setOpt2Values] = useState([]);
  const [opt3Values, setOpt3Values] = useState([]);

  // ตารางคอมโบ (แต่ละแถวไม่มีฟิลด์ stock แล้ว) ⬅️ ตัด stock ออก
  // แต่ละแถว: { opt1, opt2, opt3, price, sku, images:[{url,image_id,is_primary,position}], variant_id? }
  const [variantRows, setVariantRows] = useState([]);

  // แคชรายการ SKU ลูกของสินค้าแต่ละตัว (แสดงใต้ชื่อสินค้าแม่)
  const [variantsByProduct, setVariantsByProduct] = useState({}); // { [product_id]: [{sku, option_text}] }

  // refs
  const catRef = useRef(null);
  const formTopRef = useRef(null);
  const nameInputRef = useRef(null);

  // Toasts
  const { toasts, push, remove } = useToasts();

  /* ---------- API helpers ---------- */
  const handleApiError = (err, fallback = 'เกิดข้อผิดพลาด') => {
    console.error(fallback, err?.response?.data || err?.message || err);
    const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;
    push(`❌ ${msg}`, 'danger');
  };

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await api.get(path('/admin/products'), {
        params: { include_archived: showArchived ? 1 : 0 }
      });
      let items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);

      // ผูกสถานะจาก stock เพื่อแสดงผล (แทนการใช้ตารางสถานะ)
      items = (items || []).map(p => {
        const stock = Number(p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0);
        if (stock <= 0) {
          return { ...p, product_status_name: 'สินค้าหมด' };
        } else if (stock <= 5) {
          return { ...p, product_status_name: 'สต็อกใกล้หมด' };
        } else {
          return { ...p, product_status_name: 'พร้อมจำหน่าย' };
        }
      });

      setProducts(items || []);
    } catch (err) {
      handleApiError(err, '❌ โหลดสินค้าไม่สำเร็จ');
    }
  }, [showArchived]);

  /* ---------- Upload (product main) ---------- */
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

  /* ---------- Upload (per-variant image) ---------- */
  async function uploadVariantImage(file) {
    if (!file) return null;

    const trySend = async (endpoint, fieldNames = ['file', 'image', 'photo']) => {
      let lastErr;
      for (const field of fieldNames) {
        try {
          const fd = new FormData();
          fd.append(field, file);
          const res = await api.post(path(endpoint), fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const url =
            res?.data?.url ||
            res?.data?.imageUrl ||
            res?.data?.path ||
            res?.data?.location ||
            res?.data?.data?.url ||
            null;
          const image_id = res?.data?.image_id ?? res?.data?.id ?? null;
          if (url) return { url, image_id };
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr || new Error('UPLOAD_FAIL');
    };

    try {
      return await trySend('/product-images/upload', ['file']);
    } catch {
      const up = await trySend('/upload', ['file', 'image', 'photo']);
      return { url: up.url, image_id: up.image_id ?? null };
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
      push(!current ? '✅ เปิดแสดงสินค้าแล้ว' : '✅ ซ่อนสินค้าแล้ว', 'ok');
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
      push('🗃️ ย้ายไปถังเก็บแล้ว', 'warn');
      await fetchProducts();
    } catch (err) {
      handleApiError(err, '❌ ย้ายไปถังเก็บไม่สำเร็จ');
    }
  }, [fetchProducts]);

  const unarchiveProduct = useCallback(async (productId) => {
    try {
      await api.patch(path(`/admin/products/${productId}/unarchive`));
      push('♻️ กู้คืนสินค้าแล้ว', 'ok');
    } catch (err) {
      return handleApiError(err, '❌ กู้คืนสินค้าไม่สำเร็จ');
    }
    await fetchProducts();
  }, [fetchProducts]);

  /* ---------- init ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchProducts(), reloadLookups()]);
      setLoading(false);
    })();
  }, [fetchProducts, reloadLookups, showArchived]);

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

  /* ---------- ดึงตัวเลือกเดิมของสินค้า ---------- */
  const loadExistingVariants = useCallback(async (productId) => {
    let rows = [];
    const tryEndpoints = [
      path(`/admin/products/${productId}/variants`),
      path(`/products/${productId}/variants`),
      path(`/api/variants/by-product/${productId}`),
      path(`/api/variants?product_id=${productId}`)
    ];
    for (const url of tryEndpoints) {
      try {
        const res = await api.get(url);
        const arr = res?.data?.items || res?.data?.rows || res?.data || [];
        if (Array.isArray(arr) && arr.length) {
          rows = arr;
          break;
        }
      } catch { /* ignore */ }
    }
    if (!rows.length) { setVariantRows([]); return; }

    const mapped = rows.map(v => ({
      variant_id: v.variant_id ?? v.id ?? null,
      opt1: v.option1_value ?? v.opt1 ?? v.color ?? null,
      opt2: v.option2_value ?? v.opt2 ?? v.size ?? null,
      opt3: v.option3_value ?? v.opt3 ?? v.material ?? null,
      price: v.price ?? '',
      sku: v.sku ?? '',
      images: (v.images || []).map((im, i) => ({
        url: mediaSrc(im.url ?? im.image_url ?? im.path ?? ''),
        image_id: im.image_id ?? im.id ?? null,
        is_primary: !!im.is_primary || i === 0, position: im.position ?? (i + 1)
      }))
    }));

    setVariantRows(mapped);

    if (!opt1Name) setOpt1Name('ตัวเลือก 1');
    if (!opt2Name && mapped.some(r => r.opt2)) setOpt2Name('ตัวเลือก 2');
    if (!opt3Name && mapped.some(r => r.opt3)) setOpt3Name('ตัวเลือก 3');

    const uniq = (xs) => Array.from(new Set(xs.filter(Boolean)));
    setOpt1Values(uniq(mapped.map(r => r.opt1)));
    setOpt2Values(uniq(mapped.map(r => r.opt2)));
    setOpt3Values(uniq(mapped.map(r => r.opt3)));
  }, [opt1Name, opt2Name, opt3Name]);

  const onEdit = async (p) => {
    setForm({
      product_name:        p.product_name ?? '',
      description:         p.description ?? '',
      price:               asStr(p.price ?? p.selling_price ?? ''),
      category_id:         asStr(p.category_id ?? '') || null,
      subcategory_id:      asStr(p.subcategory_id ?? '') || null,
      product_unit_id:     toInt(p.product_unit_id),
      size_value:          asStr(p.size_value ?? ''),
      size_unit_id:        toInt(p.size_unit_id),
      origin:              p.origin ?? ''
    });
    setIsEditing(true);
    setEditProductId(p.product_id);

    // เปิด Panel ตัวเลือกอัตโนมัติ และดึงข้อมูลตัวเลือกเดิมขึ้นมา
    setVariantsOpen(true);
    await loadExistingVariants(p.product_id);

    // เลื่อนขึ้นฟอร์ม + โฟกัสชื่อสินค้า
    const scrollToTarget = () => {
      const headerOffset = 80;
      const el = formTopRef.current || nameInputRef.current;
      if (el) {
        const rectTop = el.getBoundingClientRect().top + window.pageYOffset;
        window.scrollTo({ top: Math.max(0, rectTop - headerOffset), behavior: 'smooth' });
      }
      nameInputRef.current?.focus({ preventScroll: true });
      nameInputRef.current?.select?.();
    };
    requestAnimationFrame(() => {
      setTimeout(scrollToTarget, 0);
    });
  };

  const clearForm = () => {
    setForm({
      product_name: '', description: '', price: '',
      category_id: null, subcategory_id: null,
      product_unit_id: null,
      size_value: '', size_unit_id: null, origin: ''
    });
    setSelectedFiles([]);
    setIsEditing(false);
    setEditProductId(null);

    // reset Variants Panel
    setVariantsOpen(false);
    setOpt1Name('สี'); setOpt2Name('ขนาด'); setOpt3Name('');
    setOpt1Values([]); setOpt2Values([]); setOpt3Values([]);
    setVariantRows([]);
  };

  /* ---------- ช่วยเซฟตัวเลือก (เรียกจาก onSubmit เท่านั้น) ---------- */
  const saveVariantsForProduct = async (productId) => {
    if (!productId) return;

    const effective = (variantRows || []).filter(r => r.opt1 || r.opt2 || r.opt3);
    if (effective.length === 0) return;

    let ok = 0, fail = 0;
    for (const r of effective) {
      const payload = {
        product_id: productId,
        options: [
          r.opt1 ? { name: opt1Name, value: r.opt1 } : null,
          r.opt2 ? { name: opt2Name, value: r.opt2 } : null,
          r.opt3 && opt3Name ? { name: opt3Name, value: r.opt3 } : null,
        ].filter(Boolean),
        sku: r.sku || null,
        price: r.price !== '' ? Number(r.price) : null,
        // ⬇️ ไม่มี stock ใน payload แล้ว
        images: (r.images || []).map((im, i) => ({
          url: mediaSrc(im.url), is_primary: i === 0, position: i + 1
        }))
      };

      try {
        await api.post(path('/api/variants/upsert-single'), payload);
        ok++;
      } catch (e) {
        console.error('upsert-single fail', e?.response?.data || e?.message || e);
        fail++;
      }
    }

    if (ok && !fail) push(`✅ บันทึกตัวเลือกทั้งหมดแล้ว (${ok} แถว)`, 'ok');
    else if (ok && fail) push(`⚠️ บันทึกสำเร็จ ${ok} แถว / ล้มเหลว ${fail} แถว`, 'warn');
    else push('❌ บันทึกตัวเลือกไม่สำเร็จ', 'danger');
  };

  /* ---------- Submit product (ปุ่มเดียว: “บันทึก”) ---------- */
  const onSubmit = async (e) => {
    e.preventDefault();

    const trimmedPrice = asStr(form.price).trim();
    const priceInt = Number.parseInt(trimmedPrice, 10);
    if (!Number.isInteger(priceInt) || priceInt < 0 || asStr(priceInt) !== trimmedPrice.replace(/^0+(?=\\d)/, '')) {
      push('ราคา ต้องเป็น “จำนวนเต็มไม่ติดลบ” เท่านั้น', 'danger');
      return;
    }

    const catIdStr = asStr(form.category_id).trim();
    if (!catIdStr) {
      push('กรุณาเลือก “ประเภทสินค้า” ให้ถูกต้อง', 'warn');
      catRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const puId = toInt(form.product_unit_id);
    if (puId == null) { push('กรุณาเลือก “หน่วยสินค้า”', 'warn'); return; }

    const suId    = form.size_unit_id != null ? toInt(form.size_unit_id) : null;
    const sValStr = asStr(form.size_value).trim();
    const sizeV   = sValStr === '' ? null : toNum(sValStr);
    if (sizeV !== null && suId == null) { push('กรุณาเลือก “หน่วยของขนาด” ให้ครบ', 'warn'); return; }
    if (sizeV === null && suId !== null) { push('กรุณากรอก “ขนาดสินค้า (ตัวเลข)” ให้ครบ', 'warn'); return; }

    // อัปโหลดรูปสินค้า (ถ้ามี)
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
      product_unit_id: puId,
      size_unit_id: suId,
      size_value: sizeV,
      origin: form.origin || null
    };

    try {
      let productId = editProductId;
      if (isEditing && editProductId) {
        await api.put(path(`/admin/products/${editProductId}`), body);
      } else {
        const res = await api.post(path('/admin/products'), body);
        productId = res?.data?.product_id ?? res?.data?.id ?? res?.data?.ProductID ?? productId;
      }

      // บันทึกรูปสินค้าเข้าตารางรูป (ถ้ามี)
      if (productId && uploadedUrls.length > 0) {
        const imagesPayload = uploadedUrls.map((url, i) => ({
          url, alt_text: previews[i]?.name || null, is_primary: i === 0, position: i + 1
        }));
        try {
          await api.post(path(`/admin/products/${productId}/images`), { images: imagesPayload });
        } catch {
          for (const img of imagesPayload) {
            try {
              try {
                await api.post(path('/product-images'), {
                  product_id: productId, url: img.url, alt_text: img.alt_text, is_primary: img.is_primary, position: img.position
                });
              } catch {
                await api.post(path('/admin/product-images'), {
                  product_id: productId, url: img.url, alt_text: img.alt_text, is_primary: img.is_primary, position: img.position
                });
              }
            } catch (err) {
              console.warn('⚠ บันทึกรูปไม่สำเร็จ', err?.response?.data || err?.message || err);
            }
          }
        }
      }

      // ✅ เซฟตัวเลือกทั้งหมดที่หน้าเดียวกันนี้ (ไม่มีปุ่มแยกแล้ว)
      await saveVariantsForProduct(productId);

      await fetchProducts();
      await reloadLookups();

      // ถ้าพึ่งสร้างใหม่ ให้เข้าโหมดแก้ไขทันที + เปิดตัวเลือก
      if (!isEditing && productId) {
        const created = (Array.isArray(products) ? products : []).find(p => p.product_id === productId) || { product_id: productId };
        await onEdit(created);
        push('🎉 บันทึกสินค้าแล้ว และบันทึกตัวเลือกเรียบร้อย', 'ok');
        setSelectedFiles([]);
        setPreviews([]);
        return;
      }

      push('✅ บันทึกสำเร็จ', 'ok');
    } catch (err) {
      handleApiError(err, '❌ บันทึกสินค้าไม่สำเร็จ');
    }
  };

  /* ---------- options ---------- */
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
      const name = u.unit_name || u.name || u.label || '';
      return <option key={id} value={asStr(id)}>{name}</option>;
    })
  ]), [lookups.product_units]);

  /* ---------- สรุปรายการใกล้หมด/หมด ---------- */
  const lowStockItems = useMemo(() => {
    return (products || []).filter(p => {
      const s = Number(p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0);
      return s > 0 && s <= 5;
    });
  }, [products]);

  const outOfStockItems = useMemo(() => {
    return (products || []).filter(p => {
      const s = Number(p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0);
      return s <= 0;
    });
  }, [products]);

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

      // กรองตามสต็อก
      const s = Number(p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0);
      if (stockFilter === 'low' && !(s > 0 && s <= 5)) return false;
      if (stockFilter === 'out' && !(s <= 0)) return false;

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
  }, [products, visibilityFilter, catFilter, subcatFilter, stockFilter, query]);

  useEffect(() => { setPage(1); }, [visibilityFilter, catFilter, subcatFilter, stockFilter, query, perPage, groupByCategory]);

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

  /* ---------- สร้างแถวคอมโบใหม่เมื่อค่า chips เปลี่ยน (ไม่มี stock) ---------- */
  useEffect(() => {
    const v1 = opt1Values.length ? opt1Values : [null];
    const v2 = opt2Values.length ? opt2Values : [null];
    const v3 = opt3Values.length ? opt3Values : [null];
    const combos = [];
    for (const a of v1) for (const b of v2) for (const c of v3) {
      combos.push({ opt1: a, opt2: b, opt3: c, price: '', sku: '', images: [] });
    }
    setVariantRows(combos);
  }, [opt1Values, opt2Values, opt3Values]);

  const onUploadRowImage = async (file, rowIdx) => {
    if (!file) return;
    // พรีวิวชั่วคราว
    const tmpUrl = URL.createObjectURL(file);
    setVariantRows(prev => {
      const a = [...prev];
      const imgs = Array.isArray(a[rowIdx].images) ? [...a[rowIdx].images] : [];
      imgs.push({ url: tmpUrl, image_id: null, is_primary: imgs.length === 0, position: imgs.length + 1, __temp: true });
      a[rowIdx] = { ...a[rowIdx], images: imgs };
      return a;
    });
    try {
      const up = await uploadVariantImage(file);
      setVariantRows(prev => {
        const a = [...prev];
        const imgs = [...a[rowIdx].images];
        const idx = imgs.findIndex(x => x.url === tmpUrl);
        if (idx >= 0) imgs[idx] = { ...imgs[idx], url: mediaSrc(up.url), image_id: up.image_id ?? imgs[idx].image_id, __temp: false };
        a[rowIdx] = { ...a[rowIdx], images: imgs };
        return a;
      });
    } catch (e) {
      push('❌ อัปโหลดรูปไม่สำเร็จ', 'danger');
      setVariantRows(prev => {
        const a = [...prev];
        a[rowIdx] = { ...a[rowIdx], images: (a[rowIdx].images || []).filter(x => x.url !== tmpUrl) };
        return a;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(tmpUrl), 2000);
    }
  };

  const removeRowImage = async (rowIdx, imgIdx) => {
    const img = variantRows[rowIdx]?.images?.[imgIdx];
    if (!img) return;
    if (img.image_id) {
      try {
        await api.delete(path(`/product-images/${img.image_id}`));
        push('🗑️ ลบรูปแล้ว', 'ok');
      } catch (e) {
        console.warn('delete image fail', e?.response?.data || e?.message || e);
      }
    }
    setVariantRows(prev => {
      const a = [...prev];
      const imgs = (a[rowIdx].images || []).filter((_, i) => i !== imgIdx);
      const re = imgs.map((x, i) => ({ ...x, position: i + 1, is_primary: i === 0 }));
      a[rowIdx] = { ...a[rowIdx], images: re };
      return a;
    });
  };

  const autoSku = () => {
    const base = `P${editProductId || ''}`.replace(/-+$/,'');
    setVariantRows(prev =>
      prev.map(r => {
        const parts = [base, r.opt1, r.opt2, r.opt3].filter(Boolean);
        const rand = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
        return { ...r, sku: parts.join('-') + '-' + rand };
      })
    );
    push('✨ เติม SKU อัตโนมัติให้ทุกแถวแล้ว', 'ok');
  };

  const openVariantsPanel = async () => {
    const willOpen = !variantsOpen;
    setVariantsOpen(willOpen);
    if (willOpen && editProductId) {
      await loadExistingVariants(editProductId);
    }
  };

  /* ---------- สถานะสินค้า (อ้างอิงจากสต็อก) ---------- */
  const currentEditingProduct = useMemo(
    () => (products || []).find(p => p.product_id === editProductId) || null,
    [products, editProductId]
  );

  /* ---------- ดึงรายการ SKU ลูกเพื่อแสดงใต้ตาราง (เฉพาะสินค้าที่กำลังแสดงในหน้า) ---------- */
  const fetchVariantsForProduct = useCallback(async (productId) => {
    const tryEndpoints = [
      path(`/admin/products/${productId}/variants`),
      path(`/products/${productId}/variants`),
      path(`/api/variants/by-product/${productId}`),
      path(`/api/variants?product_id=${productId}`)
    ];
    for (const url of tryEndpoints) {
      try {
        const res = await api.get(url);
        const arr = res?.data?.items || res?.data?.rows || res?.data || [];
        if (Array.isArray(arr)) {
          const mapped = arr.map(v => ({
          sku: v.sku || '',
          option_text: [
            v.option1_value ?? v.opt1 ?? v.color ?? null,
            v.option2_value ?? v.opt2 ?? v.size ?? null,
            v.option3_value ?? v.opt3 ?? v.material ?? null
          ].filter(Boolean).join(' / '),
          price: Number(v.price ?? v.selling_price ?? v.variant_price ?? v.base_price ?? 0),
          stock: Number(v.stock_qty ?? v.stock ?? v.qty ?? v.quantity ?? 0)
        }));
setVariantsByProduct(prev => ({ ...prev, [productId]: mapped }));
          return;
        }
      } catch { /* try next */ }
    }
    setVariantsByProduct(prev => ({ ...prev, [productId]: [] }));
  }, []);

  useEffect(() => {
    const ids = (paged || []).map(p => p.product_id);
    const missing = ids.filter(id => !(id in variantsByProduct));
    if (missing.length) {
      (async () => {
        for (const id of missing) {
          await fetchVariantsForProduct(id);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged]);

  /* ---------- Render ---------- */
  if (loading || lkLoading) return <div style={{ padding: 12 }}>กำลังโหลดข้อมูล…</div>;
  if (lkError) console.warn('⚠ lookups error:', lkError);

  return (
    <div className="pm-page">
      {/* Toast Host */}
      <div className="pm-toasts">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="toast-msg">{t.msg}</div>
            <button className="toast-x" onClick={()=>remove(t.id)} aria-label="close">×</button>
          </div>
        ))}
      </div>

      {/* quick header */}
      <div className="pm-header">
        <div className="pm-title">
          <span className="emoji" aria-hidden>🪴</span>
          <h1>จัดการสินค้า</h1>
          <span className="subtitle">เพิ่ม/แก้ไขสินค้า และควบคุมการแสดงผล</span>
        </div>
        <div className="pm-links">
          <Link to="/admin/categories" className="btn btn-ghost">📂 จัดการประเภท</Link>
          <Link to="/admin/subcategories" className="btn btn-ghost">🗂️ จัดการหมวดย่อย</Link>
          <Link to="/admin/units" className="btn btn-ghost">📏 หน่วยสินค้า</Link>
          <Link to="/admin/sizes" className="btn btn-ghost">📐 หน่วยขนาด</Link>
        </div>
      </div>

      {/* แจ้งเตือนสรุปสต็อก */}
      {(lowStockItems.length > 0) && (
        <div className="pm-alertbar">
          <button
            type="button"
            className="pm-alert warn"
            onClick={() => { setStockFilter('low'); }}
            title="ดูเฉพาะสินค้าใกล้หมด (1–5)"
          >
            ⚠️ ใกล้หมด {lowStockItems.length} รายการ — คลิกเพื่อกรอง
          </button>

          {(stockFilter !== 'all') && (
            <button
              type="button"
              className="pm-alert clear"
              onClick={() => setStockFilter('all')}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      )}

      {/* form panel */}
      <div className="pm-panel">
        <h2 className="section-title">{isEditing ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h2>

        <form ref={formTopRef} onSubmit={onSubmit} className="pm-form">
          {/* แถว 1 */}
          <div className="frm">
            <label htmlFor="product_name">ชื่อสินค้า</label>
            <input
              ref={nameInputRef}
              id="product_name"
              name="product_name"
              placeholder="เช่น ยางอินโด / Monstera"
              value={form.product_name}
              onChange={onChange}
            />
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
              {subcategoryOptions}
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
                  <img src={mediaSrc(p.url)} alt={p.name} />
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

          {/* ปุ่มเปิด/ปิด Panel ตัวเลือก */}
          <div className="frm col-span-2" style={{marginTop: 8}}>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={openVariantsPanel}
            >
              ➕ ตัวเลือกสินค้า (สี / ขนาด / วัสดุ)
            </button>
          </div>

          {/* Actions — ปุ่มเดียว “บันทึก” */}
          <div className="pm-actions col-span-2" style={{marginTop: 4}}>
            <button type="submit" className="btn btn-primary btn-lg">บันทึก</button>
          </div>
        </form>

        {/* Panel ตัวเลือก (ไม่มีคอลัมน์สต็อก + ไม่มีปุ่มบันทึกแยก) */}
        {variantsOpen && (
          <div className="pm-panel" style={{ marginTop: 12 }}>
            <h3 className="section-title">ตัวเลือกสินค้า (Variants)</h3>

            {/* ตั้งชื่อตัวเลือก + ใส่ค่าแบบชิป */}
            <div className="pm-input-group pm-row-3">
              <div className="frm">
                <label>ชื่อตัวเลือก 1</label>
                <input value={opt1Name} onChange={e=>setOpt1Name(e.target.value)} placeholder="เช่น สี" />
                <div className="hint">พิมพ์ค่าแล้วกด Enter เพื่อเพิ่มชิป</div>
                <div className="pm-files-preview" style={{gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))'}}>
                  {opt1Values.map((v,i)=>(
                    <div key={i} className="pm-file" style={{padding:8}}>
                      <div className="pm-meta" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <strong>{v}</strong>
                        <button type="button" className="btn-xxs danger" onClick={()=>setOpt1Values(opt1Values.filter((_,x)=>x!==i))}>×</button>
                      </div>
                    </div>
                  ))}
                  <input
                    placeholder="เช่น เขียว แล้ว Enter"
                    onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=e.currentTarget.value.trim(); if(v&&!opt1Values.includes(v)) setOpt1Values([...opt1Values,v]); e.currentTarget.value=''; } }}
                  />
                </div>
              </div>

              <div className="frm">
                <label>ชื่อตัวเลือก 2 (ถ้ามี)</label>
                <input value={opt2Name} onChange={e=>setOpt2Name(e.target.value)} placeholder="เช่น ขนาด" />
                <div className="pm-files-preview" style={{gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))'}}>
                  {opt2Values.map((v,i)=>(
                    <div key={i} className="pm-file" style={{padding:8}}>
                      <div className="pm-meta" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <strong>{v}</strong>
                        <button type="button" className="btn-xxs danger" onClick={()=>setOpt2Values(opt2Values.filter((_,x)=>x!==i))}>×</button>
                      </div>
                    </div>
                  ))}
                  <input
                    placeholder="เช่น M / 6 นิ้ว แล้ว Enter"
                    onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=e.currentTarget.value.trim(); if(v&&!opt2Values.includes(v)) setOpt2Values([...opt2Values,v]); e.currentTarget.value=''; } }}
                  />
                </div>
              </div>

              <div className="frm">
                <label>ชื่อตัวเลือก 3 (ถ้ามี)</label>
                <input value={opt3Name} onChange={e=>setOpt3Name(e.target.value)} placeholder="เช่น วัสดุ" />
                <div className="pm-files-preview" style={{gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))'}}>
                  {opt3Values.map((v,i)=>(
                    <div key={i} className="pm-file" style={{padding:8}}>
                      <div className="pm-meta" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <strong>{v}</strong>
                        <button type="button" className="btn-xxs danger" onClick={()=>setOpt3Values(opt3Values.filter((_,x)=>x!==i))}>×</button>
                      </div>
                    </div>
                  ))}
                  <input
                    placeholder="เช่น เซรามิก แล้ว Enter"
                    onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); const v=e.currentTarget.value.trim(); if(v&&!opt3Values.includes(v)) setOpt3Values([...opt3Values,v]); e.currentTarget.value=''; } }}
                  />
                </div>
              </div>
            </div>

            {/* ตารางแถว Variant อัตโนมัติ (ไม่มีคอลัมน์ “สต็อก”) */}
            <div className="pm-table-wrap" style={{marginTop:12}}>
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>รูปภาพ</th>
                    <th>{opt1Name || 'ตัวเลือก 1'}</th>
                    <th>{opt2Name || 'ตัวเลือก 2'}</th>
                    <th>{opt3Name || 'ตัวเลือก 3'}</th>
                    <th>ราคา</th>
                    <th>SKU</th>
                    <th className="th-actions">ลบ</th>
                  </tr>
                </thead>
                <tbody>
                  {variantRows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          <label className="btn btn-ghost btn-md" style={{cursor:'pointer'}}>
                            📸 เพิ่มรูป
                            <input type="file" accept="image/*" style={{display:'none'}}
                                   onChange={(e)=>onUploadRowImage(e.target.files?.[0], i)} />
                          </label>
                          {(r.images || []).map((im,idx)=>(
                            <div key={idx} style={{position:'relative'}}>
                              <img src={mediaSrc(im.url)} alt="" style={{width:48,height:48,objectFit:'cover',borderRadius:8,border:'1px solid #e7ece9'}} />
                              <button type="button" className="btn-xxs" style={{position:'absolute',top:-8,right:-8}} onClick={()=>removeRowImage(i,idx)}>×</button>
                            </div>
                          ))}
                        </div>
                      </td>
                      <td>{r.opt1 || '-'}</td>
                      <td>{r.opt2 || '-'}</td>
                      <td>{r.opt3 || '-'}</td>
                      <td>
                        <input
                          type="number" min="0" step="1"
                          value={r.price}
                          onChange={(e)=>{
                            const v = e.target.value;
                            setVariantRows(prev=>{ const a=[...prev]; a[i]={...a[i], price:v}; return a; });
                          }}
                          placeholder="ไม่ระบุ"
                        />
                      </td>
                      <td>
                        <input
                          value={r.sku}
                          onChange={(e)=>{
                            const v = e.target.value;
                            setVariantRows(prev=>{ const a=[...prev]; a[i]={...a[i], sku:v}; return a; });
                          }}
                          placeholder="SKU"
                        />
                      </td>
                      <td className="cell-actions">
                        <button type="button" className="btn btn-danger btn-md" onClick={()=>setVariantRows(prev=>prev.filter((_,x)=>x!==i))}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                  {variantRows.length === 0 && (
                    <tr><td colSpan={7} style={{color:'#777',textAlign:'center',padding:'14px'}}>— ยังไม่มีตัวเลือก —</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Actions ของ Panel: ไม่มีปุ่มบันทึก — ใช้ปุ่ม “บันทึก” หลักของหน้า */}
            <div style={{display:'flex',gap:10,marginTop:12}}>
              <button type="button" className="btn" onClick={autoSku}>✨ เติม SKU อัตโนมัติ</button>
              <span className="hint" style={{alignSelf:'center', color:'#667085'}}>
                เมื่อแก้ไขเสร็จ ให้กดปุ่ม <strong>“บันทึก”</strong> ด้านบน เพื่อบันทึกตัวเลือกทั้งหมดพร้อมสินค้า
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ---------- Toolbar: filters/search/paging ---------- */}
      <div className="pm-toolbar-2 sticky-toolbar">
        <div className="seg">
          <button type="button" className={`seg-btn ${visibilityFilter==='all' ? 'active': ''}`} onClick={()=>setVisibilityFilter('all')}>ทั้งหมด</button>
          <button type="button" className={`seg-btn ${visibilityFilter==='shown' ? 'active': ''}`} onClick={()=>setVisibilityFilter('shown')}>เฉพาะที่แสดง</button>
          <button type="button" className={`seg-btn ${visibilityFilter==='hidden' ? 'active': ''}`} onClick={()=>setVisibilityFilter('hidden')}>เฉพาะที่ซ่อน</button>
        </div>

        {/* กรองตามสต็อก */}
        <div className="seg">
          <button type="button" className={`seg-btn ${stockFilter==='all' ? 'active': ''}`} onClick={()=>setStockFilter('all')}>สต็อก: ทั้งหมด</button>
          <button type="button" className={`seg-btn ${stockFilter==='low' ? 'active': ''}`} onClick={()=>setStockFilter('low')}>ใกล้หมด (1–5)</button>
          <button type="button" className={`seg-btn ${stockFilter==='out' ? 'active': ''}`} onClick={()=>setStockFilter('out')}>หมด (0)</button>
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
        <div className="big-number">ทั้งหมด <strong>{total.toLocaleString()}</strong> รายการ</div>
        {perPage !== 0 && (
          <div className="pm-pager">
            <button className="btn-ghost" disabled={pageSafe<=1} onClick={()=>setPage(p=>Math.max(1, p-1))}>‹ ก่อนหน้า</button>
            <span className="pager-text">หน้า <strong>{pageSafe}</strong> / {totalPages}</span>
            <button className="btn-ghost" disabled={pageSafe>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages, p+1))}>ถัดไป ›</button>
          </div>
        )}
      </div>

      {/* ---------- Table / Grouped View ---------- */}
      <h2 className="section-title">รายการสินค้า</h2>
      <div className="pm-table-wrap">
        {!groupByCategory ? (
          <table className="pm-table">
            <thead>
              <tr>
                <th>สินค้า</th><th>ราคา</th><th>คงเหลือ</th><th>หมวดหมู่</th><th>สถานะ</th><th className="th-actions">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(paged || []).map(p => {
                const published = (typeof p.is_published === 'boolean') ? p.is_published : true;
                const stock = Number(p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0);
                const stockClass = stock <= 0 ? 'stock-badge danger' : stock <= 5 ? 'stock-badge warn' : 'stock-badge ok';
                const skus = variantsByProduct[p.product_id] || null;

                return (
                  <tr key={p.product_id} className={p.is_archived ? 'is-archived' : ''}>
                    <td>
                      <span className={`pill ${published ? 'on' : 'off'}`}>{published ? 'กำลังแสดง' : 'ถูกซ่อน'}</span>
                      <span className="name-with-badges">
                        <strong className="product-name">{p.product_name}</strong>
                        {p.is_archived && <span className="badge-archived">เก็บแล้ว</span>}
                      </span>
                      {/* ⬇️ แสดงลูก SKU ใต้ชื่อสินค้า */}
                      <div className="subtext">
  {skus
    ? (skus.length ? (
        <ol className="sku-list">{(skus || []).map((s, idx) => formatSkuLine(s)).filter(Boolean).length
  ? (skus || []).map((s, idx) => {
      const line = formatSkuLine(s);
      return line ? <li key={idx}><span style={{fontWeight:600}}>{idx + 1}.</span> {line}</li> : null;
    })
  : null}</ol>
      ) : 'SKU ลูก: — ไม่มี —')
    : 'SKU ลูก: กำลังโหลด…'}
</div>
                    </td>
                    <td><span className="money">{Number(p.price ?? p.selling_price ?? 0).toLocaleString()}</span></td>
                    <td><span className={stockClass}>{stock}</span></td>
                    <td>{`${p.category_name || '-'} / ${p.subcategory_name || '-'}`}</td>
                    <td>
                      <span className={
                        p.product_status_name === 'สินค้าหมด' ? 'status-badge danger' :
                        p.product_status_name === 'สต็อกใกล้หมด' ? 'status-badge warn' :
                        'status-badge ok'
                      }>
                        {p.product_status_name}
                      </span>
                    </td>
                    <td className="cell-actions">
                      <button className={`btn ${published ? 'btn-warn' : 'btn-primary'} btn-md`} onClick={() => togglePublish(p.product_id, published)}>
                        {published ? 'ไม่แสดง' : 'แสดง'}
                      </button>
                      <button className="btn btn-ghost btn-md" onClick={() => onEdit(p)}>แก้ไข</button>
                      {!p.is_archived ? (
                        <button className="btn btn-danger btn-md" onClick={() => archiveProduct(p.product_id)}>ย้ายไปถังเก็บ</button>
                      ) : (
                        <button className="btn btn-primary btn-md" onClick={() => unarchiveProduct(p.product_id)}>กู้คืน</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(!paged || paged.length === 0) && (
                <tr><td colSpan={6} style={{ color:'#777', textAlign:'center', padding:'18px' }}>— ไม่มีข้อมูล —</td></tr>
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
                      <th>สินค้า</th><th>ราคา</th><th>คงเหลือ</th><th>หมวดย่อย</th><th>สถานะ</th><th className="th-actions">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(p => {
                      const published = (typeof p.is_published === 'boolean') ? p.is_published : true;
                      const stock = Number(p.stock_qty ?? p.stock ?? p.stock_quantity ?? 0);
                      const stockClass = stock <= 0 ? 'stock-badge danger' : stock <= 5 ? 'stock-badge warn' : 'stock-badge ok';
                      const skus = variantsByProduct[p.product_id] || null;

                      return (
                        <tr key={p.product_id} className={p.is_archived ? 'is-archived' : ''}>
                          <td>
                            <span className={`pill ${published ? 'on' : 'off'}`}>{published ? 'กำลังแสดง' : 'ถูกซ่อน'}</span>
                            <span className="name-with-badges"><strong className="product-name">{p.product_name}</strong>{p.is_archived && <span className="badge-archived">เก็บแล้ว</span>}</span>
                            <div className="subtext">
  {skus
    ? (skus.length ? (
        <ol className="sku-list">{(skus || []).map((s, idx) => formatSkuLine(s)).filter(Boolean).length
  ? (skus || []).map((s, idx) => {
      const line = formatSkuLine(s);
      return line ? <li key={idx}><span style={{fontWeight:600}}>{idx + 1}.</span> {line}</li> : null;
    })
  : null}</ol>
      ) : 'SKU ลูก: — ไม่มี —')
    : 'SKU ลูก: กำลังโหลด…'}
</div>
                          </td>
                          <td><span className="money">{Number(p.price ?? p.selling_price ?? 0).toLocaleString()}</span></td>
                          <td><span className={stockClass}>{stock}</span></td>
                          <td>{p.subcategory_name || '-'}</td>
                          <td>
                            <span className={
                              p.product_status_name === 'สินค้าหมด' ? 'status-badge danger' :
                              p.product_status_name === 'สต็อกใกล้หมด' ? 'status-badge warn' :
                              'status-badge ok'
                            }>
                              {p.product_status_name}
                            </span>
                          </td>
                          <td className="cell-actions">
                            <button className={`btn ${published ? 'btn-warn' : 'btn-primary'} btn-md`} onClick={() => togglePublish(p.product_id, published)}>
                              {published ? 'ไม่แสดง' : 'แสดง'}
                            </button>
                            <button className="btn btn-ghost btn-md" onClick={() => onEdit(p)}>แก้ไข</button>
                            {!p.is_archived ? (
                              <button className="btn btn-danger btn-md" onClick={() => archiveProduct(p.product_id)}>เก็บ</button>
                            ) : (
                              <button className="btn btn-primary btn-md" onClick={() => unarchiveProduct(p.product_id)}>กู้คืน</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
            {(!grouped || grouped.length === 0) && <div style={{color:'#777', padding:'16px'}}>— ไม่มีข้อมูล —</div>}
          </div>
        )}
      </div>

      {/* ปุ่มสถานะล่างหน้า */}
      {currentEditingProduct && (
        <div className="pm-panel" style={{marginTop:12}}>
          <h3 className="section-title">สถานะสินค้า (สำหรับ: {currentEditingProduct.product_name})</h3>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            <button
              type="button"
              className={`btn ${currentEditingProduct.is_published ? 'btn-warn' : 'btn-primary'} btn-lg`}
              onClick={()=>togglePublish(currentEditingProduct.product_id, !!currentEditingProduct.is_published)}
            >
              {currentEditingProduct.is_published ? 'ปิดการแสดง' : 'เผยแพร่'}
            </button>
            {!currentEditingProduct.is_archived ? (
              <button type="button" className="btn btn-danger btn-lg" onClick={()=>archiveProduct(currentEditingProduct.product_id)}>เก็บเข้าคลัง</button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg" onClick={()=>unarchiveProduct(currentEditingProduct.product_id)}>คืนจากคลัง</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}