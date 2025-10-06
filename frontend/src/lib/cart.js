// src/lib/cart.js
const KEY = 'cart';
const EVENT_NAME = 'cart:changed';

/** ปลอดภัยเวลา localStorage ใช้ไม่ได้ (เช่น SSR / โหมด privacy) */
function safeLocal() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {}
  // fallback in-memory (จะหายเมื่อรีเฟรช)
  const mem = { v: '{}' };
  return {
    getItem: k => (JSON.parse(mem.v || '{}'))[k] ?? null,
    setItem: (k, v) => { const o = JSON.parse(mem.v || '{}'); o[k] = v; mem.v = JSON.stringify(o); },
    removeItem: k => { const o = JSON.parse(mem.v || '{}'); delete o[k]; mem.v = JSON.stringify(o); }
  };
}

function dispatchChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(EVENT_NAME));
  }
}

function normalizeNumber(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : def;
}

function makeKey(item) {
  // รวมซ้ำโดยอิง product id + variant id (ถ้ามี)
  const id = String(item.id ?? '');
  const vid = item.variantId != null ? String(item.variantId) : '';
  return `${id}::${vid}`;
}

export function getCart() {
  try {
    const raw = safeLocal().getItem(KEY) || '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function setCart(arr) {
  safeLocal().setItem(KEY, JSON.stringify(arr || []));
  dispatchChanged();
}

export function addItem(item, qty = 1) {
  const cart = getCart();
  const q = Math.max(1, normalizeNumber(qty, 1));

  // ปรับฟิลด์พื้นฐานให้สะอาด
  const base = {
    id: item.id,
    variantId: item.variantId ?? item.variant_id ?? null,
    name: item.name ?? item.product_name ?? 'สินค้า',
    price: normalizeNumber(item.price ?? item.selling_price ?? item.sale_price, 0),
    img: item.img || item.image || item.thumbnail || (Array.isArray(item.images) ? item.images[0] : ''),
  };

  const key = makeKey(base);
  const idx = cart.findIndex(x => makeKey(x) === key);

  if (idx > -1) {
    cart[idx].quantity = Math.max(1, normalizeNumber(cart[idx].quantity, 1) + q);
  } else {
    cart.push({ ...base, quantity: q });
  }
  setCart(cart);
}

export function updateQty(id, qty, variantId = null) {
  const cart = getCart();
  const q = Math.max(1, normalizeNumber(qty, 1));
  const idx = cart.findIndex(x => makeKey({ id: x.id, variantId: x.variantId }) === makeKey({ id, variantId }));
  if (idx > -1) {
    cart[idx].quantity = q;
    setCart(cart);
  }
}

export function removeItem(id, variantId = null) {
  const cart = getCart().filter(x => makeKey(x) !== makeKey({ id, variantId }));
  setCart(cart);
}

export function clearCart() {
  setCart([]);
}

export function getCount() {
  return getCart().reduce((s, x) => s + Math.max(1, normalizeNumber(x.quantity, 1)), 0);
}

export function getTotal() {
  return getCart().reduce((s, x) => {
    const price = Math.max(0, normalizeNumber(x.price, 0));
    const qty = Math.max(1, normalizeNumber(x.quantity, 1));
    return s + price * qty;
  }, 0);
}

// เผยแพร่ CONSTANT เผื่อ component อยากใช้ชื่ออีเวนต์
export const CART_EVENT = EVENT_NAME;
