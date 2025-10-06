// tools/fetch-build-thai-geo.js
// ดึงข้อมูล จังหวัด/อำเภอ/ตำบล ทั้งประเทศ แล้วแตกเป็นไฟล์ย่อยตามแผน B
// จะสร้างไฟล์ไว้ที่: frontend/public/data/...

const fs = require('fs');
const path = require('path');
const https = require('https');

const RAW = {
  PROV: 'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api_province.json',
  AMPH: 'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api_amphure.json',
  TAMB: 'https://raw.githubusercontent.com/kongvut/thai-province-data/master/api_tambon.json',
};

// GET JSON ผ่าน https (ไม่ต้องลงแพ็กเกจเพิ่ม)
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          res.resume();
          return;
        }
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', chunk => (raw += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(e); }
        });
      })
      .on('error', reject);
  });
}

(async () => {
  console.log('⬇️  Fetching provinces/amphures/tambons (whole country)...');
  const [provinces, amphures, tambons] = await Promise.all([
    fetchJson(RAW.PROV),
    fetchJson(RAW.AMPH),
    fetchJson(RAW.TAMB),
  ]);

  // โฟลเดอร์ปลายทาง
  const OUT = path.join(__dirname, '..', 'frontend', 'public', 'data');
  const OUT_DIST = path.join(OUT, 'districts');
  const OUT_SUBD = path.join(OUT, 'subdistricts');
  fs.mkdirSync(OUT_DIST, { recursive: true });
  fs.mkdirSync(OUT_SUBD, { recursive: true });

  // provinces.json  -> [{ code, name_th }]
  const provSlim = provinces.map(p => ({
    code: String(p.id),   // ใช้ id เป็นรหัส เพื่ออ้างถึงไฟล์อำเภอ
    name_th: p.name_th,
  })).sort((a,b)=>a.name_th.localeCompare(b.name_th,'th'));
  fs.writeFileSync(path.join(OUT, 'provinces.json'), JSON.stringify(provSlim));

  // districts/<provinceId>.json
  const amphByProv = amphures.reduce((acc, a) => {
    const k = String(a.province_id);
    (acc[k] ||= []).push({ code: String(a.id), name_th: a.name_th });
    return acc;
  }, {});
  for (const [provId, list] of Object.entries(amphByProv)) {
    list.sort((x, y) => x.name_th.localeCompare(y.name_th, 'th'));
    fs.writeFileSync(path.join(OUT_DIST, `${provId}.json`), JSON.stringify(list));
  }

  // subdistricts/<amphureId>.json (มี zip_code)
  const tambByAmph = tambons.reduce((acc, t) => {
    const k = String(t.amphure_id);
    (acc[k] ||= []).push({ code: String(t.id), name_th: t.name_th, zip_code: t.zip_code || '' });
    return acc;
  }, {});
  for (const [amphId, list] of Object.entries(tambByAmph)) {
    list.sort((x, y) => x.name_th.localeCompare(y.name_th, 'th'));
    fs.writeFileSync(path.join(OUT_SUBD, `${amphId}.json`), JSON.stringify(list));
  }

  console.log('✅ Done. Files generated in frontend/public/data');
})();
