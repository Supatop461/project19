// src/components/ThaiAddressPicker.js
// เลือก จังหวัด → อำเภอ → ตำบล แบบโหลดทีละชั้น (ทนพาธ/คีย์สุดๆ + fallback ได้)

import React, { useEffect, useMemo, useRef, useState } from 'react';

/* -------------------- Helpers: ดึงค่าคีย์แบบยืดหยุ่น -------------------- */
const pick = (o, keys) => { for (const k of keys) if (o && o[k] != null) return o[k]; return null; };
// จังหวัด
const provIdOf   = (o) => pick(o, ['province_id','PROVINCE_ID','id','code']);
const provCodeOf = (o) => pick(o, ['code','province_code','PROVINCE_CODE','id']);
const provNameOf = (o) => pick(o, ['name_th','name','PROVINCE_NAME']) || '';
// อำเภอ
const distIdOf       = (o) => pick(o, ['amphure_id','AMPHUR_ID','district_id','DISTRICT_ID','id','code']);
const distNameOf     = (o) => pick(o, ['name_th','name','AMPHUR_NAME','DISTRICT_NAME']) || '';
const distProvIdOf   = (o) => pick(o, ['province_id','PROVINCE_ID']);
const distProvCodeOf = (o) => pick(o, ['province_code','PROVINCE_CODE']);
// ตำบล
const subIdOf     = (o) => pick(o, ['tambon_id','TAMBON_ID','subdistrict_id','SUBDISTRICT_ID','id','code']);
const subNameOf   = (o) => pick(o, ['name_th','name','TAMBON_NAME','SUBDISTRICT_NAME']) || '';
const subDistIdOf = (o) => pick(o, ['amphure_id','AMPHUR_ID','district_id','DISTRICT_ID']);
const subZipOf    = (o) => pick(o, ['zip_code','zipcode','POSTCODE','postcode']);

const joinUrl = (base, path) => `${String(base).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;

/* ---------- fetch JSON แบบกัน index.html / 404 + กันแคช ---------- */
async function loadJSONWithFallback(basePath, candidates) {
  const tried = [];
  const withBust = (u) => u + (u.includes('?') ? '&' : '?') + 'v=20250818';

  for (const name of candidates) {
    const url = withBust(joinUrl(basePath || '', name));
    tried.push(url);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        console.info('[ThaiAddressPicker] loaded', url);
        return json;
      } catch {
        continue;
      }
    } catch { /* try next */ }
  }
  throw new Error(`No valid JSON from: ${tried.join(', ')}`);
}

/* ================================ Component ================================ */
export default function ThaiAddressPicker({
  value,
  onChange,
  basePath = '/thai',
  basePathCandidates = ['/thai', '/data', ''],
  disabled = false,
  showZipInput = false,
  showErrors = false,              // 🆕 ควบคุมว่าจะโชว์ข้อความ error ไหม (default: ไม่โชว์)
}) {
  const [provinces, setProvinces] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [subs, setSubs]           = useState([]);

  const [loadingProv, setLoadingProv] = useState(true);
  const [loadingDist, setLoadingDist] = useState(false);
  const [loadingSub,  setLoadingSub ] = useState(false);

  const [baseUsed, setBaseUsed] = useState('');
  const [errMsg, setErrMsg]     = useState('');

  const cacheRef = useRef({ districts: {}, subs: {} });
  const patch = (obj) => onChange && onChange(obj);

  /* -------------------- โหลด "จังหวัด" -------------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingProv(true);
      setErrMsg('');
      const candidates = [basePath, ...basePathCandidates].filter((v,i,a) => v!=null && a.indexOf(v)===i);
      let loaded = false, lastError = '';

      for (const bp of candidates) {
        try {
          const js = await loadJSONWithFallback(bp || '', ['provinces.json']);
          if (!alive) return;
          if (!Array.isArray(js) || js.length === 0) throw new Error('empty provinces');
          setProvinces(js);
          setBaseUsed(bp || '');
          setErrMsg('');
          loaded = true;
          break;
        } catch (e) { lastError = e?.message || String(e); }
      }

      if (!alive) return;
      if (!loaded) {
        setProvinces([]);
        setBaseUsed('');
        setErrMsg('โหลดฐานข้อมูลที่อยู่ไม่สำเร็จ (provinces.json)');
        console.error('[ThaiAddressPicker] provinces load failed:', lastError);
      }
      setLoadingProv(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, JSON.stringify(basePathCandidates)]);

  /* -------------------- map ค่า current -------------------- */
  const currentProvinceId = useMemo(() => {
    if (!provinces?.length) return '';
    if (value?.province_id != null) return String(value.province_id);
    if (value?.province_code != null) {
      const pByCode = provinces.find(x => String(provCodeOf(x)) === String(value.province_code));
      if (pByCode) return String(provIdOf(pByCode));
    }
    if (value?.province) {
      const name = String(value.province).trim().toLowerCase();
      const pByName = provinces.find(x => provNameOf(x).trim().toLowerCase() === name);
      if (pByName) return String(provIdOf(pByName));
    }
    return '';
  }, [value?.province_id, value?.province_code, value?.province, provinces]);

  const currentDistrictId = useMemo(() => {
    if (!districts?.length) return '';
    if (value?.district_id != null) return String(value.district_id);
    if (value?.district_code != null) {
      const dByCode = districts.find(x => String(distIdOf(x)) === String(value.district_code));
      if (dByCode) return String(distIdOf(dByCode));
    }
    if (value?.district) {
      const name = String(value.district).trim().toLowerCase();
      const dByName = districts.find(x => distNameOf(x).trim().toLowerCase() === name);
      if (dByName) return String(distIdOf(dByName));
    }
    return '';
  }, [value?.district_id, value?.district_code, value?.district, districts]);

  const currentSubdistrictId = useMemo(() => {
    if (!subs?.length) return '';
    if (value?.subdistrict_id != null) return String(value.subdistrict_id);
    if (value?.subdistrict_code != null) {
      const sByCode = subs.find(x => String(subIdOf(x)) === String(value.subdistrict_code));
      if (sByCode) return String(subIdOf(sByCode));
    }
    if (value?.subdistrict) {
      const name = String(value.subdistrict).trim().toLowerCase();
      const sByName = subs.find(x => subNameOf(x).trim().toLowerCase() === name);
      if (sByName) return String(subIdOf(sByName));
    }
    return '';
  }, [value?.subdistrict_id, value?.subdistrict_code, value?.subdistrict, subs]);

  /* -------------------- เมื่อเลือก/เปลี่ยน "จังหวัด" → โหลดอำเภอ -------------------- */
  useEffect(() => {
    const provId = currentProvinceId;
    if (!provId || !baseUsed) { setDistricts([]); setSubs([]); return; }

    if (cacheRef.current.districts[provId]) { setDistricts(cacheRef.current.districts[provId]); setErrMsg(''); return; }

    let alive = true;
    (async () => {
      setLoadingDist(true);
      setErrMsg('');
      try {
        const provObj = provinces.find(p => String(provIdOf(p)) === String(provId)) || {};
        const tryKeys = Array.from(new Set([
          String(provId),
          String(provCodeOf(provObj) ?? ''),
          String(provId).padStart(2,'0'),
          String(provId).padStart(3,'0'),
        ].filter(Boolean)));

        let data = null, lastErr = '';

        for (const k of tryKeys) {
          try {
            const js = await loadJSONWithFallback(baseUsed, [`districts/${k}.json`]);
            if (Array.isArray(js) && js.length) { data = js; break; }
          } catch (e) { lastErr = e?.message || String(e); }
        }

        if (!data) {
          const all = await loadJSONWithFallback(baseUsed, ['amphures.json']);
          const provCandidates = Array.from(new Set([
            String(provId),
            String(provCodeOf(provObj) ?? ''),
          ].filter(Boolean)));
          const filtered = (all || []).filter(a => {
            const pid = String(distProvIdOf(a) ?? distProvCodeOf(a) ?? '');
            return pid && provCandidates.includes(pid);
          });
          data = filtered;
        }

        if (!alive) return;
        const arr = Array.isArray(data) ? data : [];
        cacheRef.current.districts[provId] = arr;
        setDistricts(arr);
        setErrMsg('');
        if (arr.length === 0) console.warn('[ThaiAddressPicker] districts empty for provinceId=', provId, 'base=', baseUsed);
      } catch (e) {
        console.error('[ThaiAddressPicker] districts load error:', e);
        if (alive) {
          setDistricts([]);
          setErrMsg('โหลดฐานข้อมูลที่อยู่ไม่สำเร็จ (districts)');
        }
      } finally {
        if (alive) setLoadingDist(false);
      }
    })();

    return () => { alive = false; };
  }, [currentProvinceId, baseUsed, provinces]);

  /* -------------------- เมื่อเลือก/เปลี่ยน "อำเภอ" → โหลดตำบล -------------------- */
  useEffect(() => {
    const distId = currentDistrictId;
    if (!distId || !baseUsed) { setSubs([]); return; }

    if (cacheRef.current.subs[distId]) { setSubs(cacheRef.current.subs[distId]); setErrMsg(''); return; }

    let alive = true;
    (async () => {
      setLoadingSub(true);
      setErrMsg('');
      try {
        const tryKeys = Array.from(new Set([
          String(distId),
          String(distId).padStart(2,'0'),
          String(distId).padStart(3,'0'),
        ]));

        let data = null, lastErr = '';

        for (const k of tryKeys) {
          try {
            const js = await loadJSONWithFallback(baseUsed, [`subdistricts/${k}.json`]);
            if (Array.isArray(js) && js.length) { data = js; break; }
          } catch (e) { lastErr = e?.message || String(e); }
        }

        if (!data) {
          const all = await loadJSONWithFallback(baseUsed, ['tambons.json']);
          const filtered = (all || []).filter(t => String(subDistIdOf(t) ?? '') === String(distId));
          data = filtered;
        }

        if (!alive) return;
        const arr = Array.isArray(data) ? data : [];
        cacheRef.current.subs[distId] = arr;
        setSubs(arr);
        setErrMsg('');
        if (arr.length === 0) console.warn('[ThaiAddressPicker] subdistricts empty for districtId=', distId, 'base=', baseUsed);
      } catch (e) {
        console.error('[ThaiAddressPicker] subdistricts load error:', e);
        if (alive) {
          setSubs([]);
          setErrMsg('โหลดฐานข้อมูลที่อยู่ไม่สำเร็จ (subdistricts)');
        }
      } finally {
        if (alive) setLoadingSub(false);
      }
    })();

    return () => { alive = false; };
  }, [currentDistrictId, baseUsed]);

  /* -------------------- onChange -------------------- */
  const handleProvince = (e) => {
    const id  = e.target.value || '';
    const sel = provinces.find(p => String(provIdOf(p)) === String(id)) || null;
    setErrMsg('');
    patch({
      province:       sel ? provNameOf(sel) : '',
      province_id:    sel ? provIdOf(sel)   : null,
      province_code:  sel ? provCodeOf(sel) : null,
      district: '', district_id: null, district_code: null,
      subdistrict: '', subdistrict_id: null, subdistrict_code: null,
      postal_code: '',
    });
  };

  const handleDistrict = (e) => {
    const id  = e.target.value || '';
    const sel = districts.find(d => String(distIdOf(d)) === String(id)) || null;
    setErrMsg('');
    patch({
      district:       sel ? distNameOf(sel) : '',
      district_id:    sel ? distIdOf(sel)   : null,
      district_code:  sel ? distIdOf(sel)   : null,
      subdistrict: '', subdistrict_id: null, subdistrict_code: null,
      postal_code: '',
    });
  };

  const handleSubdistrict = (e) => {
    const id  = e.target.value || '';
    const sel = subs.find(s => String(subIdOf(s)) === String(id)) || null;
    setErrMsg('');
    patch({
      subdistrict:      sel ? subNameOf(sel) : '',
      subdistrict_id:   sel ? subIdOf(sel)   : null,
      subdistrict_code: sel ? subIdOf(sel)   : null,
      postal_code:      sel ? String(subZipOf(sel) || '') : '',
    });
  };

  /* -------------------- disabled flags (ตัด errMsg ออก) -------------------- */
  const disProv = disabled || loadingProv;
  const disDist = disabled || !currentProvinceId || loadingDist;
  const disSub  = disabled || !currentDistrictId || loadingSub;

  /* -------------------- UI -------------------- */
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {/* จังหวัด */}
        <select value={currentProvinceId} onChange={handleProvince} disabled={disProv}>
          <option value="">
            {loadingProv ? 'กำลังโหลดจังหวัด...' : (provinces.length ? '-- เลือกจังหวัด --' : 'ไม่พบข้อมูลจังหวัด')}
          </option>
          {provinces.map(p => {
            const id   = String(provIdOf(p) ?? '');
            const name = provNameOf(p);
            return <option key={id} value={id}>{name}</option>;
          })}
        </select>

        {/* อำเภอ */}
        <select value={currentDistrictId} onChange={handleDistrict} disabled={disDist}>
          <option value="">
            {loadingDist ? 'กำลังโหลดอำเภอ...' : (currentProvinceId ? '-- เลือกอำเภอ --' : 'เลือกจังหวัดก่อน')}
          </option>
          {districts.map(d => {
            const id   = String(distIdOf(d) ?? '');
            const name = distNameOf(d);
            return <option key={id} value={id}>{name}</option>;
          })}
        </select>

        {/* ตำบล */}
        <select value={currentSubdistrictId} onChange={handleSubdistrict} disabled={disSub}>
          <option value="">
            {loadingSub ? 'กำลังโหลดตำบล...' : (currentDistrictId ? '-- เลือกตำบล --' : 'เลือกอำเภอก่อน')}
          </option>
          {subs.map(s => {
            const id   = String(subIdOf(s) ?? '');
            const name = subNameOf(s);
            return <option key={id} value={id}>{name}</option>;
          })}
        </select>
      </div>

      {/* รหัสไปรษณีย์ (ตัวเลือก) */}
      {showZipInput && (
        <input
          placeholder="รหัสไปรษณีย์"
          value={value?.postal_code || ''}
          onChange={e => patch({ postal_code: e.target.value })}
          disabled={disabled}
        />
      )}

      {/* แสดง error เฉพาะเมื่ออนุญาต */}
      {showErrors && errMsg && (
        <small style={{ color:'#c00' }}>{errMsg}</small>
      )}

      {baseUsed ? <small style={{ color:'#999' }}>ใช้ข้อมูลจาก: <code>{baseUsed || '/'}</code></small> : null}
    </div>
  );
}
