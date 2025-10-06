// src/lib/api.js
// รวมศูนย์การเรียก API ฝั่ง frontend ให้สะอาด/ปลอดภัย/ยืดหยุ่น
// - คงฟังก์ชันเดิมทั้งหมดของคุณ
// - เพิ่ม interceptor แนบ Authorization ทั้ง instance และ global
// - เพิ่ม searchVariants() สำหรับ VariantPicker

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
const DEL  = (url)         => unwrap(api.delete(path(url)));

/* ---------- “Safe getters” สำหรับ UI ---------- */
const GET_A = (url, params) => GET(url, params).then(toArray);
const GET_O = (url, params) => GET(url, params).then(toObject);

/* ---------- Auth ---------- */
export const login = (email_or_username, password) =>
  POST('/auth/login', { email_or_username, password });
export const me = () => GET('/me');

/* ---------- Public ---------- */
export const getBestSellers = (limit = 8) =>
  GET('/products/best-sellers', { limit });
export const getProducts = (params = {}) =>
  GET('/products', params);
export const getCategories = (status = 'active') =>
  GET('/categories', { status });

/* ---------- Admin: Products ---------- */
export const listAdminProducts = (params = {}) =>
  GET('/admin/products', params);

/* ---------- Variants (admin) ---------- */
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

/* ---------- Inventory ---------- */
export const listInventory = (params = {}) =>
  GET('/inventory', params);
export const listMoves = (params = {}) =>
  GET('/inventory/moves', params);
export const receiveInventory = ({ variant_id, qty, unit_cost, received_at, note }) =>
  POST('/inventory/receive', { variant_id, qty, unit_cost, received_at, note });
export const issueInventory = ({ variant_id, qty, note, ref_order_detail_id, reason_code }) =>
  POST('/inventory/issue', { variant_id, qty, note, ref_order_detail_id, reason_code });
export const adjustInventory = (productId, variant_id, delta, note) =>
  unwrap(api.patch(path(`/inventory/${productId}/adjust`), { variant_id, delta, note }));
export const setInventory = (productId, variant_id, stock, note) =>
  unwrap(api.put(path(`/inventory/${productId}`), { variant_id, stock, note }));

// ✅ ใช้ใน VariantPicker ให้ค้นหาโดยตรงที่ /api/inventory/search
export async function searchVariants(q, { mode = 'in', limit = 20 } = {}) {
  if (!q || !q.trim()) return [];
  const params = new URLSearchParams({ q: q.trim(), mode, limit: String(limit) });
  const url = path(`/inventory/search?${params.toString()}`);
  const { data } = await api.get(url);
  return toArray(data || data?.data || []); // รองรับทั้ง array ตรงๆ หรือ {data:[...]}
}

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

/* ---------- (ออปชัน) Address helpers ฝั่งลูกค้า ---------- */
export const listMyAddresses = () => GET_A('/addresses/me');
export const listAddresses = () => GET_A('/addresses');
export const getDefaultAddress = () => GET_O('/addresses/default');
export const createAddress = (payload) => POST('/addresses', payload);
export const updateAddress = (id, patch) => PUT(`/addresses/${id}`, patch);
export const setDefaultAddress = (id) => unwrap(api.patch(path(`/addresses/${id}/default`)));
export const deleteAddress = (id) => DEL(`/addresses/${id}`);

/* ---------- Export default ---------- */
export default api;
