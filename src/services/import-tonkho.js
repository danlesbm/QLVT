'use strict';
const ExcelJS = require('exceljs');
const stock = require('./stock');
const { AppError } = require('./util');

/** Chuẩn hóa đơn vị tính viết không dấu của phần mềm cũ. */
const UNITS = {
  CAI: 'Cái', 'CÁI': 'Cái', BO: 'Bộ', 'BỘ': 'Bộ', M: 'm', MET: 'm', KG: 'kg', LIT: 'Lít', CUON: 'Cuộn', DOI: 'Đôi',
  SOI: 'Sợi', HOP: 'Hộp', M2: 'm²', LO: 'Lọ', VIEN: 'Viên', TAM: 'Tấm', BINH: 'Bình', 'BÌNH': 'Bình', TO: 'Tờ',
  TUYP: 'Tuýp', TUI: 'Túi', ONG: 'Ống', THANH: 'Thanh', BANH: 'Bánh', THUNG: 'Thùng', BIEN: 'Biển', DAY: 'Dây',
  MIENG: 'Miếng', CHIEC: 'Chiếc', CAY: 'Cây', GOI: 'Gói', CAN: 'Can', HU: 'Hũ', QUYEN: 'Quyển', RAM: 'Ram',
};
const normUnit = (u) => {
  const s = String(u ?? '').normalize('NFC').trim();
  return UNITS[s.toUpperCase()] || s || null;
};

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return v.result ?? '';
    if (v.text) return v.text;
  }
  return v;
};

/**
 * Đọc file "Báo cáo tồn kho" xuất từ phần mềm cũ (cột STT, Mã hàng, Tên hàng, ĐVT, SL tồn, Giá trị tồn, Kho hàng).
 * Trả về các dòng đã chuẩn hóa.
 */
async function parse(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('File Excel không có dữ liệu');
  let header = null;
  const cols = {};
  const rows = [];
  ws.eachRow((row, idx) => {
    const vals = Array.from(row.values, cellText).map((v) => (typeof v === 'string' ? v.trim() : v));
    if (!header) {
      const lower = vals.map((v) => String(v ?? '').toLowerCase());
      const codeCol = lower.findIndex((v) => v === 'mã hàng' || v === 'mã vật tư');
      if (codeCol > 0) {
        header = idx;
        cols.code = codeCol;
        cols.name = lower.findIndex((v) => v.startsWith('tên'));
        cols.unit = lower.findIndex((v) => v === 'đvt' || v.startsWith('đơn vị'));
        cols.qty = lower.findIndex((v) => v.startsWith('sl') || v.startsWith('số lượng'));
        cols.wh = lower.findIndex((v) => v.startsWith('kho'));
      }
      return;
    }
    const code = String(vals[cols.code] ?? '').trim();
    // Bỏ qua dòng tổng cộng / chữ ký cuối báo cáo
    if (!code || !vals[cols.name] || /^tổng/i.test(code)) return;
    const qty = Number(vals[cols.qty]);
    rows.push({
      line: idx,
      code,
      name: String(vals[cols.name] ?? '').replace(/\s+/g, ' ').trim(),
      unit: normUnit(vals[cols.unit]),
      quantity: Number.isFinite(qty) ? qty : 0,
      warehouse: cols.wh > 0 ? String(vals[cols.wh] ?? '').trim() : '',
    });
  });
  if (!header) throw new AppError('Không tìm thấy dòng tiêu đề có cột "Mã hàng"');
  return rows;
}

/**
 * Ghi dữ liệu tồn kho vào CSDL: tạo mã vật tư (mã chung toàn công ty) nếu chưa có,
 * tạo kho nếu mã kho chưa có, và đặt số lượng tồn bằng số trong file.
 */
function apply(db, user, rows, { defaultFactoryId } = {}) {
  const result = { materials_created: 0, stock_rows: 0, factories_created: [], errors: [] };
  db.tx(() => {
    const up = (v) => String(v || '').trim().toUpperCase();
    const factories = new Map(db.all('SELECT id, warehouse_code FROM factories WHERE warehouse_code IS NOT NULL').map((f) => [up(f.warehouse_code), f.id]));
    // Một mã có thể xuất hiện nhiều lần trong cùng một kho: cộng dồn số lượng
    const totals = new Map();
    for (const r of rows) {
      let fid = r.warehouse ? factories.get(up(r.warehouse)) : defaultFactoryId;
      if (!fid && r.warehouse) {
        // Thử khớp theo mã nhà máy (vd KHOTACO -> TACO) trước khi tạo kho mới
        const code = r.warehouse.replace(/^KHO/i, '') || r.warehouse;
        const byCode = db.one('SELECT id FROM factories WHERE upper(code) = ?', up(code));
        if (byCode) fid = byCode.id;
        else {
          fid = Number(db.run('INSERT INTO factories (code, name, warehouse_code, warehouse_name, sort) VALUES (?, ?, ?, ?, 99)', code, `Nhà máy ${code}`, r.warehouse, r.warehouse).lastInsertRowid);
          result.factories_created.push(r.warehouse);
        }
        factories.set(up(r.warehouse), fid);
      }
      if (!fid) {
        result.errors.push(`Dòng ${r.line}: không xác định được kho`);
        continue;
      }
      let m = db.one('SELECT id, factory_id FROM materials WHERE code = ?', r.code);
      if (!m) {
        const ins = db.run('INSERT INTO materials (code, name, unit, created_by) VALUES (?, ?, ?, ?)', r.code, r.name || r.code, r.unit, user ? user.id : null);
        m = { id: Number(ins.lastInsertRowid), factory_id: null };
        result.materials_created++;
      }
      if (m.factory_id && m.factory_id !== fid) {
        result.errors.push(`Dòng ${r.line}: mã ${r.code} là mã riêng của nhà máy khác, bỏ qua`);
        continue;
      }
      const key = `${fid}:${m.id}`;
      totals.set(key, { fid, mid: m.id, qty: (totals.get(key)?.qty || 0) + r.quantity });
    }
    for (const { fid, mid, qty } of totals.values()) {
      const cur = db.one('SELECT quantity FROM stock WHERE factory_id = ? AND material_id = ?', fid, mid);
      const delta = qty - (cur ? cur.quantity : 0);
      if (delta !== 0 || !cur) {
        stock.move(db, { factoryId: fid, materialId: mid, delta, kind: 'IMPORT', note: 'Import tồn kho từ Excel', userId: user ? user.id : null, allowNegative: true });
      }
      result.stock_rows++;
    }
  });
  return result;
}

module.exports = { parse, apply, normUnit };
