// src/admin/OptionsPage.js
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

export default function OptionsPage() {
  const { id } = useParams();
  const productId = Number(id || 0);
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [product, setProduct] = useState(null);
  const [options, setOptions] = useState([]);

  const [optName, setOptName] = useState('');
  const [chosenOpt, setChosenOpt] = useState('');
  const [valName, setValName] = useState('');

  const toast = (m) => alert(m);

  const fetchMeta = useCallback(async () => {
    if (!productId) return;
    setLoading(true); setError('');
    try {
      const { data } = await axios.get(`/api/admin/products/${productId}/variants`);
      setProduct(data.product || null);
      setOptions(data.options || []);
    } catch (e) {
      console.error(e);
      setError(e?.response?.data?.error || 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { fetchMeta(); }, [fetchMeta]);

  async function addOption(e) {
    e?.preventDefault();
    if (!optName.trim()) return toast('กรอกชื่อออปชั่นก่อนนะ');
    try {
      await axios.post(`/api/admin/products/${productId}/options`, { option_name: optName.trim() });
      setOptName(''); await fetchMeta(); toast('เพิ่มออปชั่นสำเร็จ');
    } catch (e) { console.error(e); toast(e?.response?.data?.error || 'เพิ่มออปชั่นไม่สำเร็จ'); }
  }

  async function addValue(e) {
    e?.preventDefault();
    const oid = Number(chosenOpt);
    if (!oid) return toast('เลือกออปชั่นก่อน');
    if (!valName.trim()) return toast('กรอกชื่อค่า');
    try {
      await axios.post(`/api/admin/options/${oid}/values`, { value_name: valName.trim() });
      setValName(''); await fetchMeta(); toast('เพิ่มค่าเรียบร้อย');
    } catch (e) { console.error(e); toast(e?.response?.data?.error || 'เพิ่มค่าไม่สำเร็จ'); }
  }

  async function deleteOption(oid) {
    if (!window.confirm('ลบออปชั่นนี้ (รวมค่าภายใน) ใช่ไหม?')) return;
    try { await axios.delete(`/api/admin/options/${oid}`); await fetchMeta(); }
    catch (e) { console.error(e); toast(e?.response?.data?.error || 'ลบไม่สำเร็จ'); }
  }

  async function deleteValue(vid) {
    if (!window.confirm('ลบค่านี้ใช่ไหม?')) return;
    try { await axios.delete(`/api/admin/values/${vid}`); await fetchMeta(); }
    catch (e) { console.error(e); toast(e?.response?.data?.error || 'ลบไม่สำเร็จ (อาจถูกใช้ใน SKU)'); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">จัดการออปชั่นสินค้า</h1>
          <p className="text-sm text-gray-600">
            สินค้า: {product ? `${product.product_name} (#${product.product_id})` : '—'}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded-xl border hover:bg-gray-50" onClick={fetchMeta}>รีเฟรช</button>
          <button className="px-3 py-2 rounded-xl border hover:bg-gray-50" onClick={() => nav(-1)}>ย้อนกลับ</button>
          <button className="px-3 py-2 rounded-xl border hover:bg-gray-50" onClick={() => nav(`/admin/products/${productId}/variants`)}>
            ไปหน้า SKU
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-500 animate-pulse">กำลังโหลด...</div>
      ) : error ? (
        <div className="text-red-600">{error}</div>
      ) : (
        <>
          <section className="mb-6 p-4 rounded-2xl border shadow-sm">
            <h2 className="text-lg font-semibold mb-3">เพิ่มออปชั่น</h2>
            <form onSubmit={addOption} className="flex flex-col md:flex-row gap-3">
              <input className="flex-1 rounded-xl border px-3 py-2"
                placeholder="เช่น สี / ขนาด / เสริมราก"
                value={optName} onChange={(e) => setOptName(e.target.value)} />
              <button type="submit" className="px-4 py-2 rounded-xl bg-black text-white">เพิ่ม</button>
            </form>
          </section>

          <section className="mb-8 p-4 rounded-2xl border shadow-sm">
            <h2 className="text-lg font-semibold mb-3">เพิ่มค่าให้กับออปชั่น</h2>
            <form onSubmit={addValue} className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select className="rounded-xl border px-3 py-2"
                      value={chosenOpt} onChange={(e) => setChosenOpt(e.target.value)}>
                <option value="">— เลือกออปชั่น —</option>
                {options.map(o => (
                  <option key={o.option_id} value={o.option_id}>
                    {o.option_name} (#{o.option_id})
                  </option>
                ))}
              </select>
              <input className="rounded-xl border px-3 py-2"
                placeholder="เช่น แดง / 200ซม. / 2 ราก"
                value={valName} onChange={(e) => setValName(e.target.value)} />
              <button type="submit" className="px-4 py-2 rounded-xl bg-black text-white">เพิ่มค่า</button>
            </form>
          </section>

          <section className="p-4 rounded-2xl border shadow-sm">
            <h2 className="text-lg font-semibold mb-3">ออปชั่น & ค่า</h2>
            {options.length === 0 ? (
              <div className="text-gray-600">ยังไม่มีออปชั่น</div>
            ) : (
              <div className="space-y-6">
                {options.map((o) => (
                  <div key={o.option_id}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-base">
                        {o.option_name} <span className="text-gray-400">#{o.option_id}</span>
                      </div>
                      <button className="px-3 py-1 rounded-lg border hover:bg-gray-50"
                              onClick={() => deleteOption(o.option_id)}>
                        ลบออปชั่น
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {o.values?.length ? (
                        o.values.map((v) => (
                          <span key={v.value_id}
                                className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm">
                            {v.value_name}
                            <button className="text-gray-500 hover:text-red-600" title="ลบค่า"
                                    onClick={() => deleteValue(v.value_id)}>×</button>
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-500">— ยังไม่มีค่า —</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
