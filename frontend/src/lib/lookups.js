// frontend/src/lib/lookups.js
// ดึง lookup เดียวจบ พร้อมแคชในหน่วยความจำ + ตัวช่วย hook

import axios from 'axios';
import { useEffect, useState, useCallback } from 'react';

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const API_BASE =
  ENV.VITE_API_BASE ||
  process.env.REACT_APP_API_BASE ||
  'http://localhost:3001';

const cache = {
  all: null,
  published: null,
  ts_all: 0,
  ts_pub: 0,
  ttl_ms: 60_000, // 1 นาที
};

export async function fetchLookups({ published = false } = {}) {
  const usePublished = !!published;
  const now = Date.now();
  const key = usePublished ? 'published' : 'all';
  const tsKey = usePublished ? 'ts_pub' : 'ts_all';

  if (cache[key] && now - cache[tsKey] < cache.ttl_ms) {
    return cache[key];
  }

  const url = new URL('/api/lookups', API_BASE);
  if (usePublished) url.searchParams.set('published', '1');

  const res = await axios.get(url.toString(), { withCredentials: true }).catch((e) => {
    console.error('lookups fetch error:', e);
    throw e;
  });

  const data = res?.data || {};
  cache[key] = data;
  cache[tsKey] = Date.now();
  return data;
}

// React hook: ใช้ง่ายในหน้าแอดมิน
export function useLookups(options = { published: false }) {
  const [data, setData] = useState({
    ok: false,
    product_categories: [],
    categories: [],           // fallback key
    subcategories: [],
    sub_categories: [],       // fallback key
    product_units: [],
    size_units: [],
    order_statuses: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await fetchLookups(options);
      setData(d);
    } catch (e) {
      setError('โหลดข้อมูล lookup ล้มเหลว');
    } finally {
      setLoading(false);
    }
  }, [options?.published]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
