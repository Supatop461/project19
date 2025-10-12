// src/lib/api.js
// รวมศูนย์การเรียก API ฝั่ง frontend ให้สะอาด/ปลอดภัย/ยืดหยุ่น
// - คงฟังก์ชันเดิมทั้งหมดของคุณ + เพิ่ม Units/Size-Units CRUD
// - มี interceptors แนบ Authorization ทั้ง instance และ global
// - ✅ มี searchItems()/ensureVariant() สำหรับ Inventory Picker
// - คง searchVariants() เป็น alias ชี้ไป searchItems() เพื่อ compatibility

import axios from 'axios';

/* ---------- Base URL ---------- */
const VITE = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const BASE_URL =
  VITE.VITE_API_BASE ||
  process.env.REACT_APP_API_BASE ||
  'http://localhost:3001/api';

// alias เพื่อความเข้ากันได้กับโค้ดเดิมบางส่วน (ถ้ามี)
export const API_BASE = BASE_URL;

/* ---------- Path helper ---------- */
export const path = (p) => {
  const str = String(p || '');
  if (/^https?:\/\//i.test(str) || /^\/\//.test(str)) return str;

  const base = String((BASE_URL || '').replace(/\/+$/, ''));
  const endsWithApi = base.endsWith('/api');

  let s = '/' + str.replace(/^\/+/, '');
  s = s.replace(/\/+/g, '/');

  return endsWithApi
    ? s.replace(/^\/api\//, '/')
    : (s.startsWith('/api/') ? s : '/api' + s);
};

/* ---------- Axios instance ---------- */
export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  validateStatus: (s) => s >= 200 && s < 400, // 4xx/5xx ไปที่ response interceptor
  headers: { Accept: 'application/json' },
});

/* ---------- Interceptors (instance) ---------- */
api.interceptors.request.use((config) => {
  try {
    const token =
      localStorage.getItem('token') ||
      sessionStorage.getItem('token') ||
      (typeof window !== 'undefined' && window.__TOKEN__);
    if (token) {
      config.headers = config.headers || {};
      if (!config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {}
  return config;
});

let retried = new WeakSet();
api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const s = err?.response?.status;
    const cfg = err?.config;

    if (s === 404) console.warn('[API 404]', cfg?.method?.toUpperCase(), cfg?.url, err.response?.data);
    if (s === 401) { try { localStorage.removeItem('token'); } catch {} }

    // เน็ตหลุด/timeout: ลองซ้ำ 1 ครั้ง
    if (!err.response && cfg && !retried.has(cfg)) {
      retried.add(cfg);
      try { return await api.request(cfg); } catch {}
    }
    return Promise.reject(err);
  }
);

/* ---------- Global axios defaults (กันเคสเรียก axios ตรง ๆ) ---------- */
axios.defaults.baseURL = BASE_URL;
axios.interceptors.request.use((cfg) => {
  try {
    const t =
      localStorage.getItem('token') ||
      sessionStorage.getItem('token') ||
      (typeof window !== 'undefined' && window.__TOKEN__);
    if (t) {
      cfg.headers = cfg.headers || {};
      if (!cfg.headers.Authorization) {
        cfg.headers.Authorization = `Bearer ${t}`;
      }
    }
  } catch {}
  return cfg;
});

/* ---------- unwrap + normalize ---------- */
const unwrap = (p) => p.then((r) => r.data);

export const toArray = (x) => {
  if (Array.isArray(x)) return x;
  if (x && Array.isArray(x.data)) return x.data; // { data: [...] }
  return [];
};

export const toObject = (x) => {
  if (x && x.data && !Array.isArray(x.data) && typeof x.data === 'object') return x.data;
  if (x && !Array.isArray(x) && typeof x === 'object') return x;
  return {};
};

/* ---------- generic wrappers ---------- */
const GET  = (url, params) => unwrap(api.get(path(url), { params }));
const POST = (url, body)   => unwrap(api.post(path(url), body));
const PUT  = (url, body)   => unwrap(api.put(path(url), body));
const PATCH= (url, body)   => unwrap(api.patch(path(url), body));
const DEL  = (url)         => unwrap(api.delete(path(url)));

/* ---------- “Safe getters” สำหรับ UI ---------- */
const GET_A = (url, params) => GET(url, params).then(toArray);
const GET_O = (url, params) => GET(url, params).then(toObject);

/* ====================================================================== */
/*                               Auth                                     */
/* ====================================================================== */
export const login = (email_or_username, password) =>
  POST('/auth/login', { email_or_username, password });
export const me = () => GET('/me');

/* ====================================================================== */
/*                               Public                                   */
/* ====================================================================== */
export const getBestSellers = (limit = 8) =>
  GET('/products/best-sellers', { limit });
export const getProducts = (params = {}) =>
  GET('/products', params);
export const getCategories = (status = 'active') =>
  GET('/categories', { status });

/* ====================================================================== */
/*                          Admin: Products                               */
/* ====================================================================== */
export const listAdminProducts = (params = {}) =>
  GET('/admin/products', params);

/* ====================================================================== */
/*                          Variants (admin)                              */
/* ====================================================================== */
export const getProductMeta = (productId) =>
  GET(`/admin/products/${productId}/variants`);
export const addOption = (productId, option_name) =>
  POST(`/admin/products/${productId}/options`, { option_name });
export const renameOption = (productId, optionId, option_name) =>
  PUT(`/admin/products/${productId}/options/${optionId}`, { option_name });
export const addValue = (option_id, value_name) =>
  POST(`/admin/options/${option_id}/values`, { value_name });
export const renameValue = (valueId, value_name) =>
  PUT(`/admin/values/${valueId}`, { value_name });
export const createVariant = (productId, payload) =>
  POST(`/admin/products/${productId}/variants`, payload);
export const generateVariants = (productId, body) =>
  POST(`/admin/products/${productId}/variants/generate`, body);
export const updateVariant = (variantId, patch) =>
  PUT(`/admin/variants/${variantId}`, patch);
export const deleteVariant = (variantId) =>
  DEL(`/admin/variants/${variantId}`);
export const deleteOption = (option_id) =>
  DEL(`/admin/options/${option_id}`);
export const deleteValue = (value_id) =>
  DEL(`/admin/values/${value_id}`);

/* ====================================================================== */
/*                           Inventory (เก่า)                             */
/* ====================================================================== */
export const listInventory = (params = {}) =>
  GET('/inventory', params);
export const listMoves = (params = {}) =>
  GET('/inventory/moves', params);
export const receiveInventory = ({ variant_id, qty, unit_cost, received_at, note }) =>
  POST('/inventory/receive', { variant_id, qty, unit_cost, received_at, note });
export const issueInventory = ({ variant_id, qty, note, ref_order_detail_id, reason_code }) =>
  POST('/inventory/issue', { variant_id, qty, note, ref_order_detail_id, reason_code });
export const adjustInventory = (productId, variant_id, delta, note) =>
  PATCH(`/inventory/${productId}/adjust`, { variant_id, delta, note });
export const setInventory = (productId, variant_id, stock, note) =>
  PUT(`/inventory/${productId}`, { variant_id, stock, note });

/* ====================================================================== */
/*                ✅ Inventory (ใหม่): searchItems + ensureVariant        */
/* ====================================================================== */
/**
 * ค้นหา “ทุกแหล่งสินค้า”:
 * - variants (ที่มี SKU อยู่แล้ว)
 * - products ที่ยังไม่มี variant เลย (โหมด OUT จะไม่คืนอันนี้)
 * Response:
 *  - { kind:'variant', product_id, product_name, variant_id, sku, stock_qty }
 *  - { kind:'product', product_id, product_name, stock_qty:0 }
 */
export async function searchItems(q, { mode = 'in', limit = 20 } = {}) {
  if (!q || !q.trim()) return [];
  const params = new URLSearchParams({
    q: q.trim(),
    mode,
    limit: String(limit),
  });
  const url = path(`/inventory/search/items?${params.toString()}`);
  const data = await unwrap(api.get(url));
  const arr = toArray(data || data?.data || []);
  return mode === 'out' ? arr.filter((x) => Number(x.stock_qty || 0) > 0) : arr;
}

/**
 * สร้าง/ยืนยันว่า product_id นี้ “มี SKU แน่ๆ”
 * - ถ้ามีอยู่แล้ว: คืนตัวแรกที่ active
 * - ถ้ายังไม่มี: จะสร้าง SKU ใหม่ แล้วคืนข้อมูล variant
 */
export async function ensureVariant(product_id) {
  return POST('/inventory/variants/ensure', { product_id });
}

/* (คงไว้เพื่อ compatibility) VariantPicker เดิมเรียกอันนี้ */
export async function searchVariants(q, { mode = 'in', limit = 20 } = {}) {
  return searchItems(q, { mode, limit });
}

/* ====================================================================== */
/*                       Units & Size-Units (อัปเดตใหม่)                  */
/* ====================================================================== */
/** Units (public list) */
export const listUnits = (params = {}) => GET_A('/units', params);
/** Units (public options) */
export const unitOptionsPublic = () => GET_A('/units/options');

/** Units (admin) — ใช้ :id ตาม backend ล่าสุด */
export const listUnitsAdmin = (params = {}) => GET('/admin/units', params);
export const unitOptionsAdmin = () => GET_A('/admin/units/options');
export const createUnit = (payload) => POST('/admin/units', payload);
export const updateUnit = (id, payload) => PUT(`/admin/units/${encodeURIComponent(id)}`, payload);
export const deleteUnit = (id) => DEL(`/admin/units/${encodeURIComponent(id)}`);
export const publishUnit = (id) => PATCH(`/admin/units/${encodeURIComponent(id)}/publish`);
export const unpublishUnit = (id) => PATCH(`/admin/units/${encodeURIComponent(id)}/unpublish`);

/** Size-Units (list public) */
export const listSizeUnits = (params = {}) => GET_A('/size-units', params);

/** Size-Units (admin) — ฝั่งนี้อิง code ตาม router ของคุณ */
export const updateSizeUnit = (code, payload) =>
  PUT(`/admin/size-units/${encodeURIComponent(code)}`, payload);
export const createSizeUnit = (payload) =>
  POST('/admin/size-units', payload);
export const deleteSizeUnit = (code) =>
  DEL(`/admin/size-units/${encodeURIComponent(code)}`);
export const publishSizeUnit = (code) =>
  PATCH(`/admin/size-units/${encodeURIComponent(code)}/publish`, { published: true });
export const unpublishSizeUnit = (code) =>
  PATCH(`/admin/size-units/${encodeURIComponent(code)}/publish`, { published: false });

/* ====================================================================== */
/*                    Orders / Dashboard (เดิม)                           */
/* ====================================================================== */
export async function getNewOrdersCount({ updatedSince } = {}) {
  const url = new URL(path('/orders/new-count'), window.location.origin);
  if (updatedSince) url.searchParams.set('updated_since', updatedSince);
  const { data } = await axios.get(url.toString());
  return data?.count ?? 0;
}

/* ---------- Dashboard APIs ---------- */
export const dashSummary = (params = {}) =>
  GET_O('/dashboard/summary', params);
export const dashSalesByMonth = (params = {}) =>
  GET_A('/dashboard/sales-by-month', params);
export const dashOrdersByStatus = (params = {}) =>
  GET_A('/dashboard/orders-by-status', params);
export const dashCustomersByProvince = (params = {}) =>
  GET_A('/dashboard/customers-by-province', params);
export const dashTopCategories = (params = {}) =>
  GET_A('/dashboard/top-categories-by-purchased', params);
export const dashProductCountByCategory = (params = {}) =>
  GET_A('/dashboard/product-count-by-category', params);
export const dashRecentOrders = () => GET_A('/dashboard/recent-orders');
export const dashRecentProducts = () => GET_A('/dashboard/recent-products');
export const dashRecentAddresses = () => GET_A('/dashboard/recent-addresses');

/* ====================================================================== */
/*                 (ออปชัน) Address helpers ฝั่งลูกค้า                  */
/* ====================================================================== */
export const listMyAddresses = () => GET_A('/addresses/me');
export const listAddresses = () => GET_A('/addresses');
export const getDefaultAddress = () => GET_O('/addresses/default');
export const createAddress = (payload) => POST('/addresses', payload);
export const updateAddress = (id, patch) => PUT(`/addresses/${id}`, patch);
export const setDefaultAddress = (id) => PATCH(`/addresses/${id}/default`);
export const deleteAddress = (id) => DEL(`/addresses/${id}`);

/* ---------- Export default ---------- */
export default api;
