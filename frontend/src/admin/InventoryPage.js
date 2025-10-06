// src/admin/InventoryPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  listInventory,
  receiveInventory,
  issueInventory,
  listMoves,
} from "../lib/api";
import VariantPicker from "../components/VariantPicker";
import { toast } from "react-hot-toast";
import "./InventoryPage.css";

/* utils */
const fmt = (n) => new Intl.NumberFormat("th-TH").format(Number(n || 0));
const currency = (n) =>
  new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(
    Number(n || 0)
  );
const cls = (...xs) => xs.filter(Boolean).join(" ");
const nowLocalDatetime = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const Help = ({ children }) => <div className="inv-help">{children}</div>;

/* ---------- helpers: print/export เฉพาะตาราง ---------- */
function printTable(ref, title = "พิมพ์ตาราง") {
  const node = ref?.current;
  if (!node) return;
  const win = window.open("", "_blank", "width=1024,height=768");
  const styles = `
    *{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,TH Sarabun New,Arial;}
    h2{margin:0 0 8px 0;font-weight:800}
    table{width:100%;border-collapse:separate;border-spacing:0}
    thead th{background:#f6f8fb;text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;font-weight:700}
    tbody td{padding:10px;border-top:1px solid #e2e8f0}
    tbody tr:nth-child(2n) td{background:#fcfdfc}
  `;
  win.document.write(`
    <!doctype html>
    <html>
      <head><meta charset="utf-8"><title>${title}</title>
        <style>${styles}</style>
      </head>
      <body>
        <h2>${title}</h2>
        ${node.outerHTML}
        <script>window.onload = () => { window.print(); window.close(); }</script>
      </body>
    </html>
  `);
  win.document.close();
}

async function exportTablePDF(ref, filename = "table.pdf", landscape = true) {
  const node = ref?.current;
  if (!node) return;
  const { jsPDF } = await import("jspdf");
  const html2canvas = (await import("html2canvas")).default;

  const canvas = await html2canvas(node, { scale: 2, backgroundColor: "#fff" });
  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF({
    orientation: landscape ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;

  const imgW = pageW - margin * 2;
  const imgH = (canvas.height * imgW) / canvas.width;

  let heightLeft = imgH;
  pdf.addImage(imgData, "PNG", margin, margin, imgW, imgH);
  heightLeft -= pageH - margin * 2;

  while (heightLeft > 0) {
    pdf.addPage();
    const position = heightLeft * -1 + margin;
    pdf.addImage(imgData, "PNG", margin, position, imgW, imgH);
    heightLeft -= pageH - margin * 2;
  }

  pdf.save(filename);
}

/* ---------- ส่วนพับดู JSON ---------- */
function JsonDetails({ data, title = "รายละเอียด (JSON)" }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  return (
    <div className="inv-json">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inv-json__toggle"
      >
        {open ? "ซ่อน" : "ดู"} {title}
      </button>
      {open && (
        <pre className="inv-json__pre">{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const [tab, setTab] = useState("overview"); // overview | receive | issue | moves
  return (
    <div className="inv">
      <h1 className="inv-title">Inventory Management</h1>

      <div className="inv-tabs">
        {[
          ["overview", "ภาพรวมคงคลัง"],
          ["receive", "รับเข้า (IN)"],
          ["issue", "ตัดออก (OUT) FIFO"],
          ["moves", "ประวัติ (Moves)"],
        ].map(([k, label]) => (
          <button
            key={k}
            className={cls("inv-tab", tab === k && "is-active")}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="inv-section">
        {tab === "overview" && <InventoryOverview />}
        {tab === "receive" && <ReceiveForm />}
        {tab === "issue" && <IssueForm />}
        {tab === "moves" && <MovesPanel />}
      </div>
    </div>
  );
}

/* ---------- 1) ภาพรวม ---------- */
function InventoryOverview() {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("variant");
  const [order, setOrder] = useState("low_stock");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const tableRef = useRef(null);
  const loadLock = useRef(false); // 🔒 กันยิงซ้ำ dev/StrictMode

  const offset = (page - 1) * pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function load() {
    if (loadLock.current) return;
    loadLock.current = true;
    setLoading(true);
    try {
      const data = await listInventory({
        search: q,
        scope,
        order,
        limit: pageSize,
        offset,
        _t: Date.now(), // 🧊 cache-buster
      });
      setItems(data.items || []);
      setTotal(Number(data.total || 0));
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.error || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
      setTimeout(() => {
        loadLock.current = false;
      }, 0);
    }
  }

  useEffect(() => {
    load(); // eslint-disable-next-line
  }, [scope, order, page]);

  return (
    <div>
      <div className="inv-filterRow">
        <div className="inv-field inv-field--grow">
          <label className="inv-label">ค้นหา</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ชื่อสินค้า / คำอธิบาย / SKU"
            className="inv-input"
          />
          <Help>พิมพ์ชื่อสินค้า คำอธิบาย หรือ SKU เพื่อค้นหา</Help>
        </div>
        <div className="inv-field">
          <label className="inv-label">Scope</label>
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setPage(1);
            }}
            className="inv-select"
          >
            <option value="variant">รายตัวเลือก (variant)</option>
            <option value="product">รายสินค้า (product)</option>
          </select>
          <Help>เลือกดูสรุปเป็นรายตัวเลือก หรือรายสินค้า</Help>
        </div>
        <div className="inv-field">
          <label className="inv-label">จัดเรียง</label>
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="inv-select"
          >
            <option value="low_stock">เหลือน้อยก่อน</option>
            <option value="newest">ใหม่ล่าสุด</option>
            <option value="name_asc">ชื่อ A→Z</option>
            <option value="name_desc">ชื่อ Z→A</option>
          </select>
          <Help>วิธีเรียงลำดับรายการที่แสดง</Help>
        </div>
        <button
          onClick={() => {
            setPage(1);
            load();
          }}
          className="inv-btn inv-btn--primary"
        >
          ค้นหา
        </button>
      </div>

      {/* toolbar พิมพ์/ส่งออก เฉพาะตารางภาพรวม */}
      <div className="inv-toolbar">
        <div className="inv-exportBtns">
          <button
            type="button"
            className="inv-btn"
            onClick={() => printTable(tableRef, "ภาพรวมคงคลัง")}
          >
            พิมพ์/บันทึกเป็น PDF
          </button>
          <button
            type="button"
            className="inv-btn"
            onClick={() =>
              exportTablePDF(
                tableRef,
                `inventory_overview_${new Date().toISOString().slice(0, 10)}.pdf`,
                false /* portrait พอ */
              )
            }
          >
            ส่งออก PDF
          </button>
        </div>
      </div>

      <div className="inv-tableWrap" ref={tableRef}>
        <table className="inv-table">
          <thead>
            <tr>
              <th className="text-left">สินค้า</th>
              {scope === "variant" && <th className="text-left">SKU</th>}
              <th className="text-right">สต๊อก</th>
              {scope === "variant" && <th className="text-right">ราคา</th>}
            </tr>
          </thead>
        <tbody>
            {loading ? (
              <tr>
                <td className="p-4" colSpan={scope === "variant" ? 4 : 2}>
                  กำลังโหลด...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td className="p-4" colSpan={scope === "variant" ? 4 : 2}>
                  ไม่พบข้อมูล
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={`${it.product_id}-${it.variant_id || "p"}`}>
                  <td>
                    <div className="inv-cellMain">
                      {it.product_name || `#${it.product_id}`}
                    </div>
                  </td>
                  {scope === "variant" && <td>{it.sku || "-"}</td>}
                  <td className="text-right">{fmt(it.stock)}</td>
                  {scope === "variant" && (
                    <td className="text-right">
                      {it.selling_price != null
                        ? currency(it.selling_price)
                        : it.price != null
                        ? currency(it.price)
                        : "-"}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="inv-pager">
        <button
          className="inv-btn"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
        >
          ก่อนหน้า
        </button>
        <span className="inv-pager__info">
          หน้า {page} / {totalPages}
        </span>
        <button
          className="inv-btn"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
        >
          ถัดไป
        </button>
      </div>
    </div>
  );
}

/* ---------- 2) รับเข้า (IN) ---------- */
function ReceiveForm() {
  const [variantId, setVariantId] = useState("");
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [receivedAt, setReceivedAt] = useState(nowLocalDatetime());
  const [resJson, setResJson] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!variantId || !qty || !unitCost) {
      toast.error("กรอก Variant ID, จำนวน และต้นทุนต่อหน่วย ให้ครบ");
      return;
    }
    setLoading(true);
    try {
      const data = await receiveInventory({
        variant_id: Number(variantId),
        qty: Number(qty),
        unit_cost: Number(unitCost),
        received_at: receivedAt || null,
        note: note || null,
      });
      setResJson(data);

      toast.success(
        `รับเข้าเรียบร้อย • lot_id ${data?.lot?.lot_id} • qty ${fmt(
          qty
        )} • ฿${unitCost}/หน่วย`,
        { duration: 4000 }
      );

      setQty("");
      setNote("");
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.error || "รับเข้าไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="inv-form">
      <VariantPicker
        mode="in"
        onChange={(it) => {
          setVariantId(it.variant_id);
          setSelected(it);
        }}
        autoFocus
      />
      <Help>
        พิมพ์ชื่อสินค้า/คำอธิบาย หรือ SKU แล้วเลือก ระบบจะใส่ Variant ID ให้อัตโนมัติ
      </Help>

      <div className="inv-grid2">
        <div className="inv-field">
          <label className="inv-label">Variant ID</label>
          <input
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="inv-input"
            type="number"
            min="1"
          />
          <Help>
            <b>Variant ID</b> = รหัวย่อยของตัวเลือกสินค้า (ตาราง product_variants)
          </Help>
          {selected && (
            <div className="inv-mini">
              {selected.product_name} • SKU: {selected.sku || "-"} • คงคลัง:{" "}
              {fmt(selected.stock)}
            </div>
          )}
        </div>

        <div className="inv-field">
          <label className="inv-label">จำนวน (qty)</label>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="inv-input"
            type="number"
            min="1"
            placeholder="เช่น 10"
          />
          <Help>จำนวนหน่วยที่จะรับเข้า (จำนวนเต็ม &gt; 0)</Help>
        </div>

        <div className="inv-field">
          <label className="inv-label">ต้นทุนต่อหน่วย (unit_cost)</label>
          <input
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            className="inv-input"
            type="number"
            step="0.01"
            min="0"
            placeholder="เช่น 12.50"
          />
          <Help>ใช้คำนวณมูลค่าสต๊อก/COGS — ราคาต่อ 1 หน่วย</Help>
        </div>

        <div className="inv-field">
          <label className="inv-label">วันที่/เวลาที่รับเข้า (received_at)</label>
          <input
            type="datetime-local"
            value={receivedAt}
            onChange={(e) => setReceivedAt(e.target.value)}
            className="inv-input"
          />
          <Help>เวลารับเข้าจริง (เว้นว่างใช้เวลาปัจจุบัน)</Help>
        </div>

        <div className="inv-field inv-field--full">
          <label className="inv-label">หมายเหตุ</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="inv-input"
            placeholder="เช่น รับจากคนสวน/ซัพพลายเออร์ A"
          />
          <Help>บันทึกเพิ่มเติม (ไม่บังคับ)</Help>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className={cls("inv-btn inv-btn--success", loading && "is-loading")}
      >
        {loading ? "กำลังบันทึก..." : "บันทึกการรับเข้า (IN)"}
      </button>

      <JsonDetails data={resJson} title="รายละเอียดการรับเข้า (JSON)" />
    </form>
  );
}

/* ---------- 3) ตัดออก (OUT) FIFO ---------- */
function IssueForm() {
  const [variantId, setVariantId] = useState("");
  const [selected, setSelected] = useState(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("SALE");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!variantId || !qty) {
      toast.error("กรอก Variant ID และจำนวนที่ต้องการตัดออก");
      return;
    }
    setLoading(true);
    try {
      const data = await issueInventory({
        variant_id: Number(variantId),
        qty: Number(qty),
        note: note || null,
        ref_order_detail_id: ref ? Number(ref) : null,
        reason_code: reason,
      });
      setResult(data);

      const lots = (data?.allocations || []).length;
      toast.success(
        `ตัดออกสำเร็จ • ${fmt(data?.total_allocated)} หน่วย • ${lots} lot • เหตุผล: ${reason}`,
        { duration: 4500 }
      );

      setQty("");
      setNote("");
      setRef("");
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.error || "ตัดสต๊อกไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  const totalAllocated = useMemo(
    () =>
      (result?.allocations || []).reduce(
        (s, a) => s + Number(a.allocated_qty || 0),
        0
      ),
    [result]
  );

  return (
    <div className="inv-layout">
      <form onSubmit={onSubmit} className="inv-form">
        <VariantPicker
          mode="out"
          onChange={(it) => {
            setVariantId(it.variant_id);
            setSelected(it);
          }}
        />
        <Help>เลือกสินค้าที่ต้องการตัดออก ระบบจะกำหนด Variant ID ให้อัตโนมัติ</Help>

        <div className="inv-grid2">
          <div className="inv-field">
            <label className="inv-label">Variant ID</label>
            <input
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="inv-input"
              type="number"
              min="1"
            />
            <Help>รหัสตัวเลือกสินค้า (ตาราง product_variants)</Help>
            {selected && (
              <div className="inv-mini">
                {selected.product_name} • SKU: {selected.sku || "-"} • คงคลัง:{" "}
                {fmt(selected.stock)}
              </div>
            )}
          </div>

          <div className="inv-field">
            <label className="inv-label">จำนวน (qty) ที่ต้องการตัดออก</label>
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="inv-input"
              type="number"
              min="1"
              placeholder="เช่น 3"
            />
            <Help>ระบบจะจัดสรรออกตาม FIFO ของแต่ละ lot</Help>
          </div>

          <div className="inv-field">
            <label className="inv-label">สาเหตุการตัดสต๊อก (reason)</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="inv-select"
            >
              <option value="SALE">ขาย/ส่งออเดอร์ (SALE)</option>
              <option value="DIE_OFF">ตาย/เหี่ยว (DIE_OFF)</option>
              <option value="DAMAGE">เสียหาย (DAMAGE)</option>
              <option value="WASTE">หมดอายุ/ทิ้ง (WASTE)</option>
              <option value="LOST">สูญหาย (LOST)</option>
              <option value="THEFT">ถูกขโมย (THEFT)</option>
              <option value="SAMPLE">ตัวอย่าง (SAMPLE)</option>
              <option value="INTERNAL_USE">ใช้ภายใน (INTERNAL_USE)</option>
              <option value="TRANSFER">ย้ายคลัง (TRANSFER)</option>
            </select>
            <Help>
              ถ้าเป็นการขาย แนะนำระบุรหัส <code>ref_order_detail_id</code> ด้านขวา
            </Help>
          </div>

          <div className="inv-field">
            <label className="inv-label">อ้างอิงรายการสั่งซื้อ (ref_order_detail_id)</label>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              className="inv-input"
              type="number"
              min="1"
              placeholder={reason === "SALE" ? "จำเป็นสำหรับการขาย" : "ระบุถ้ามี"}
            />
            <Help>
              {reason === "SALE"
                ? "จำเป็นสำหรับเหตุผล SALE เพื่อย้อนไปดูคำสั่งซื้อได้"
                : "ไม่บังคับ ใช้เชื่อมกับ order_detail เพื่อตรวจสอบภายหลัง"}
            </Help>
          </div>

          <div className="inv-field inv-field--full">
            <label className="inv-label">หมายเหตุ</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="inv-input"
              placeholder="เช่น ตัดสต๊อกออเดอร์ #555 / เหี่ยวตาย"
            />
            <Help>บันทึกอธิบายเหตุผล (ไม่บังคับ)</Help>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={cls("inv-btn inv-btn--danger", loading && "is-loading")}
        >
          {loading ? "กำลังตัดสต๊อก..." : "บันทึกการตัดสต๊อก (OUT) FIFO"}
        </button>
      </form>

      {result?.allocations?.length > 0 && (
        <div className="inv-card">
          <div className="inv-card__head">
            Allocations (รวม {fmt(totalAllocated)} หน่วย)
          </div>
          <table className="inv-table">
            <thead>
              <tr>
                <th className="text-left">Lot ID</th>
                <th className="text-right">ตัดออก</th>
                <th className="text-right">ต้นทุน/หน่วย</th>
                <th className="text-right">Move ID</th>
                <th className="text-left">เวลา</th>
              </tr>
            </thead>
            <tbody>
              {result.allocations.map((a) => (
                <tr key={a.move_id}>
                  <td>{a.lot_id}</td>
                  <td className="text-right">{fmt(a.allocated_qty)}</td>
                  <td className="text-right">{currency(a.unit_cost)}</td>
                  <td className="text-right">{a.move_id}</td>
                  <td>{new Date(a.move_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <JsonDetails data={result} title="รายละเอียดการตัดออก (JSON)" />
    </div>
  );
}

/* ---------- 4) Moves (เฉพาะตาราง) ---------- */
function MovesPanel() {
  const [variantId, setVariantId] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(50);
  const [kw, setKw] = useState(""); // คำค้นหาชื่อ/SKU
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const tableRef = useRef(null);
  const loadLock = useRef(false); // 🔒 กันยิงซ้ำ

  async function load(override = {}) {
    if (loadLock.current) return;
    loadLock.current = true;
    setLoading(true);
    try {
      const data = await listMoves({
        variant_id: variantId || undefined,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
        q: (override.q ?? kw) || undefined, // ✅ ป้องกัน ESLint
        limit: override.limit ?? limit,
        _t: Date.now(), // 🧊 cache-buster
      });
      setRows(data || []);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.error || "โหลดประวัติไม่สำเร็จ");
    } finally {
      setLoading(false);
      setTimeout(() => {
        loadLock.current = false;
      }, 0);
    }
  }

  const displayName = (r) =>
    r.product_name ||
    r.product_title ||
    r.variant_name ||
    r.sku ||
    `#${r.product_variant_id}`;

  const limitOptions = [10, 50, 100, 200];

  return (
    <div className="inv-form">
      {/* แถวค้นหาแบบคีย์เวิร์ด (ชื่อ/SKU) */}
      <div className="inv-filterRow">
        <div className="inv-field inv-field--grow">
          <label className="inv-label">ค้นหาชื่อ/​SKU</label>
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            className="inv-input"
            placeholder="เช่น กุหลาบ หรือ P31-PD30-53"
          />
          <Help>พิมพ์ชื่อสินค้า หรือ SKU แล้วกด “ค้นหา”</Help>
        </div>
        <button
          type="button"
          className="inv-btn inv-btn--primary"
          onClick={() => load({ q: kw })}
        >
          ค้นหา
        </button>
      </div>

      <div className="inv-grid5">
        <div className="inv-field inv-field--grow">
          <VariantPicker mode="in" onChange={(it) => setVariantId(it.variant_id)} />
          <input
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="inv-input mt-2"
            type="number"
            min="1"
            placeholder="หรือกรอก Variant ID ตรงๆ"
          />
          <Help>กรองประวัติด้วย Variant ID ที่ต้องการ</Help>
        </div>
        <div className="inv-field">
          <label className="inv-label">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="inv-select"
          >
            <option value="">ทั้งหมด</option>
            <option value="IN">IN</option>
            <option value="OUT">OUT</option>
            <option value="ADJ">ADJ</option>
          </select>
          <Help>เลือกเฉพาะประเภทการเคลื่อนไหวที่ต้องการดู</Help>
        </div>
        <div className="inv-field">
          <label className="inv-label">จากวันที่</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="inv-input"
          />
          <Help>เวลาต่ำสุดของช่วงที่ต้องการค้นหา</Help>
        </div>
        <div className="inv-field">
          <label className="inv-label">ถึงวันที่</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="inv-input"
          />
          <Help>เวลาสูงสุดของช่วงที่ต้องการค้นหา</Help>
        </div>
      </div>

      {/* toolbar: โหลด/จำนวน/พิมพ์/ส่งออก */}
      <div className="inv-toolbar">
        <button onClick={() => load()} className="inv-btn inv-btn--primary">
          โหลดประวัติ
        </button>

        <div className="inv-chipWrap">
          <span className="inv-chipLabel">จำนวนล่าสุด:</span>
          {limitOptions.map((n) => (
            <button
              key={n}
              type="button"
              className={cls("inv-chip", limit === n && "is-active")}
              onClick={() => {
                setLimit(n);
                load({ limit: n });
              }}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="inv-exportBtns">
          <button
            type="button"
            className="inv-btn"
            onClick={() => printTable(tableRef, "ประวัติการเคลื่อนไหวคลัง")}
          >
            พิมพ์/บันทึกเป็น PDF
          </button>
          <button
            type="button"
            className="inv-btn"
            onClick={() =>
              exportTablePDF(
                tableRef,
                `inventory_moves_${new Date().toISOString().slice(0, 10)}.pdf`,
                true
              )
            }
          >
            ส่งออก PDF
          </button>
        </div>
      </div>

      <div className="inv-tableWrap" ref={tableRef}>
        <table className="inv-table">
          <thead>
            <tr>
              <th className="text-left col-time">เวลา</th>
              <th className="text-left col-type">ประเภท</th>
              <th className="text-right col-qty">จำนวน</th>
              <th className="text-left col-lot">Lot</th>
              <th className="text-left col-prod">สินค้า</th>
              <th className="text-left col-variant">Variant</th>
              <th className="text-left col-note">Note</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="p-3" colSpan={7}>กำลังโหลด...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="p-3" colSpan={7}>ไม่มีข้อมูล</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.move_id}>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.move_type}</td>
                  <td className="text-right">{fmt(r.change_qty)}</td>
                  <td>{r.lot_id || "-"}</td>
                  <td>
                    <div className="inv-cellMain">{displayName(r)}</div>
                    <div className="text-muted text-sm">
                      {r.sku ? `SKU: ${r.sku}` : ""}
                    </div>
                  </td>
                  <td>ID: {r.product_variant_id}</td>
                  <td>{r.note || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
