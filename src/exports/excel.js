'use strict';
const ExcelJS = require('exceljs');

const FONT = 'Times New Roman';
const thin = { style: 'thin' };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

function settings(db) {
  return Object.fromEntries(db.all('SELECT key, value FROM settings').map((r) => [r.key, r.value]));
}
const userName = (db, id) => (id ? db.one('SELECT full_name FROM users WHERE id = ?', id)?.full_name || '' : '');

function dateParts(iso) {
  const d = iso ? new Date(iso) : new Date();
  return { d: String(d.getDate()).padStart(2, '0'), m: String(d.getMonth() + 1).padStart(2, '0'), y: d.getFullYear() };
}

function put(ws, ref, value, style = {}) {
  const c = ws.getCell(ref);
  c.value = value;
  c.font = { name: FONT, size: 12, ...(style.font || {}) };
  c.alignment = { vertical: 'middle', wrapText: true, ...(style.alignment || {}) };
  if (style.border) c.border = BORDER;
  return c;
}

function mergePut(ws, range, value, style) {
  ws.mergeCells(range);
  return put(ws, range.split(':')[0], value, style);
}

/** Phiếu nhu cầu vật tư theo mẫu PNC của công ty (A4 ngang). */
async function requestWorkbook(db, r, items) {
  const s = settings(db);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Phieu nhu cau', {
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [6, 30, 22, 14, 9, 9, 12, 24, 18].map((width) => ({ width }));
  const C = { bold: true };
  const center = { horizontal: 'center' };

  mergePut(ws, 'C1:I1', s.company_name, { font: { bold: true, size: 13 }, alignment: center });
  mergePut(ws, 'C2:I2', s.company_name_en || '', { font: { size: 11 }, alignment: center });
  mergePut(ws, 'C3:I3', `Địa chỉ: ${s.company_address || ''}`, { font: { size: 11 } });
  mergePut(ws, 'C4:I4', `Điện thoại: ${s.company_phone || ''}    Website: ${s.company_website || ''}    Email: ${s.company_email || ''}`, { font: { size: 11 } });
  mergePut(ws, 'A1:B4', s.company_short || '', { font: { bold: true, size: 22, color: { argb: 'FF1F4E79' } }, alignment: center });
  mergePut(ws, 'A5:D5', `Số: ${r.number || '...'}`, { alignment: center });
  mergePut(ws, 'A7:I7', 'PHIẾU NHU CẦU VẬT TƯ', { font: { bold: true, size: 15 }, alignment: center });
  mergePut(ws, 'A8:I8', `Kính gửi: ${s.request_recipient || ''}`, { alignment: center });
  mergePut(ws, 'B10:I10', { richText: [{ text: 'Họ và tên: ', font: { name: FONT, size: 12 } }, { text: r.creator_name, font: { name: FONT, size: 12, bold: true } }] });
  mergePut(ws, 'B11:I11', { richText: [{ text: 'Bộ phận: ', font: { name: FONT, size: 12 } }, { text: r.factory_name, font: { name: FONT, size: 12, bold: true } }] });
  mergePut(ws, 'A12:I12', `        ${r.basis || r.title}`, {});
  ws.getRow(12).height = 34;

  const head = ['STT', 'Tên vật tư', 'Mã hiệu/ Nước sản xuất', 'Mã thiết bị', 'Đơn vị tính', 'Số lượng', 'Thời điểm sử dụng', 'Mục đích sử dụng', 'Ghi chú'];
  const hr = 14;
  head.forEach((h, i) => put(ws, ws.getRow(hr).getCell(i + 1).address, h, { font: C, alignment: center, border: true }));
  ws.getRow(hr).height = 36;
  ws.pageSetup.printTitlesRow = `${hr}:${hr}`;
  items.forEach((it, i) => {
    const row = ws.getRow(hr + 1 + i);
    const vals = [
      i + 1,
      it.spec ? `${it.name}\n${it.spec}` : it.name,
      it.model || '',
      it.equipment_code || '',
      it.unit || '',
      it.quantity,
      it.use_time || '',
      it.purpose || '',
      it.note || '',
    ];
    vals.forEach((v, j) => put(ws, row.getCell(j + 1).address, v, { border: true, alignment: [0, 4, 5, 6].includes(j) ? center : {} }));
  });

  let y = hr + items.length + 2;
  const d = dateParts(r.demand_approved_at);
  mergePut(ws, `G${y}:I${y}`, `Ngày ${d.d} tháng ${d.m} năm ${d.y}`, { font: { italic: true }, alignment: center });
  y++;
  const pktSigner = s.pkt_signer === 'head' ? r.pkt_approved_by : r.pkt_checked_by || r.pkt_approved_by;
  const sign = [
    ['A', 'B', 'Giám đốc\nDuyệt', userName(db, r.director_approved_by)],
    ['C', 'D', 'Phòng Kỹ thuật\nKiểm tra', userName(db, pktSigner)],
    ['E', 'G', 'Nhà máy\nGiám đốc', userName(db, r.factory_approved_by)],
    ['H', 'I', '\nNgười lập', r.creator_name],
  ];
  for (const [a, b, title, name] of sign) {
    mergePut(ws, `${a}${y}:${b}${y}`, title, { font: C, alignment: center });
    mergePut(ws, `${a}${y + 5}:${b}${y + 5}`, name, { font: C, alignment: center });
  }
  ws.getRow(y).height = 34;
  y += 7;
  mergePut(ws, `A${y}:B${y}`, 'Nơi nhận:', { font: { bold: true, underline: true, size: 11 }, alignment: { wrapText: false } });
  const fill = (t) => String(t || '').replace(/\{nha_may\}/g, r.factory_name);
  const recipients = [s.request_cc_hard && `- Bản cứng: ${fill(s.request_cc_hard)}`, s.request_cc_scan && `- Bản scan: ${fill(s.request_cc_scan)}`].filter(Boolean);
  recipients.forEach((line, i) => mergePut(ws, `B${y + 1 + i}:I${y + 1 + i}`, line, { font: { size: 11 } }));
  return wb;
}

/** Phiếu xuất kho theo mẫu BM.06. */
async function issueWorkbook(db, x, items) {
  const s = settings(db);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BM.06', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = [6, 38, 14, 8, 10, 10, 12, 16].map((width) => ({ width }));
  const center = { horizontal: 'center' };
  const b = { bold: true };
  put(ws, 'H1', 'BM.06', { font: { bold: true }, alignment: { horizontal: 'right' } });
  mergePut(ws, 'A2:D2', (s.company_name || '').replace('CÔNG TY CỔ PHẦN', 'CÔNG TY CP'), { font: { bold: true, size: 10 } });
  mergePut(ws, 'A3:D3', (x.factory_name || '').toUpperCase(), { font: { bold: true, size: 10 } });
  mergePut(ws, 'E3:H3', 'PHIẾU XUẤT KHO', { font: { bold: true, size: 16 }, alignment: center });
  mergePut(ws, 'E4:H4', `Số: ${x.number || '...'}`, { alignment: center });
  const d = dateParts(x.issue_date || x.approved_at || x.created_at);
  mergePut(ws, 'E5:H5', `Ngày ${d.d} tháng ${d.m} năm ${d.y}`, { font: { italic: true }, alignment: center });
  mergePut(ws, 'A6:H6', `Họ và tên người nhận hàng: ${x.receiver_name}`, { font: b });
  mergePut(ws, 'A7:H7', `Địa chỉ: ${x.receiver_address || ''}`, { font: b });
  mergePut(ws, 'A8:H8', `Lý do xuất kho: ${x.reason || ''}`, { font: b });
  mergePut(ws, 'A9:D9', `Xuất tại kho: ${x.warehouse_name || x.factory_name}`, { font: b });
  mergePut(ws, 'E9:H9', `Địa điểm: ${x.location || ''}`, { font: b });

  mergePut(ws, 'A10:A11', 'TT', { font: b, alignment: center, border: true });
  mergePut(ws, 'B10:B11', 'Tên, nhãn hiệu, quy cách, phẩm chất vật tư, dụng cụ, sản phẩm hàng hoá', { font: b, alignment: center, border: true });
  mergePut(ws, 'C10:C11', 'Mã', { font: b, alignment: center, border: true });
  mergePut(ws, 'D10:D11', 'ĐVT', { font: b, alignment: center, border: true });
  mergePut(ws, 'E10:F10', 'Số lượng', { font: b, alignment: center, border: true });
  put(ws, 'E11', 'Theo yêu cầu', { font: { italic: true }, alignment: center, border: true });
  put(ws, 'F11', 'Thực xuất', { font: { italic: true }, alignment: center, border: true });
  mergePut(ws, 'G10:G11', 'Tình trạng', { font: b, alignment: center, border: true });
  mergePut(ws, 'H10:H11', 'Ghi chú', { font: b, alignment: center, border: true });
  for (const ref of ['A10', 'B10', 'C10', 'D10', 'E10', 'F10', 'G10', 'H10', 'A11', 'B11', 'C11', 'D11', 'G11', 'H11']) ws.getCell(ref).border = BORDER;
  ws.getRow(10).height = 22;
  ws.getRow(11).height = 30;
  ws.pageSetup.printTitlesRow = '10:11';

  let y = 12;
  items.forEach((it, i) => {
    const name = [it.name, it.spec, it.manufacturer].filter(Boolean).join(' - ');
    const vals = [i + 1, name, it.code, it.unit || '', it.qty_requested, it.qty_actual, it.condition || '', it.note || ''];
    vals.forEach((v, j) => put(ws, ws.getRow(y).getCell(j + 1).address, v, { border: true, alignment: [0, 3, 4, 5].includes(j) ? center : {} }));
    y++;
  });
  put(ws, `A${y}`, '', { border: true });
  put(ws, `B${y}`, 'Cộng', { font: b, alignment: center, border: true });
  for (const col of ['C', 'D', 'G', 'H']) put(ws, `${col}${y}`, '', { border: true });
  put(ws, `E${y}`, items.reduce((a, it) => a + Number(it.qty_requested || 0), 0), { font: b, alignment: center, border: true });
  put(ws, `F${y}`, items.reduce((a, it) => a + Number(it.qty_actual || 0), 0), { font: b, alignment: center, border: true });
  y += 1;
  // Ngày ký chỉ điền khi GĐ nhà máy đã duyệt
  const ad = x.approved_at ? dateParts(x.approved_at) : { d: '.....', m: '.....', y: '..........' };
  mergePut(ws, `E${y}:H${y}`, `Ngày ${ad.d} tháng ${ad.m} năm ${ad.y}`, { font: { italic: true }, alignment: center });
  y += 2;
  const sign = [['A', 'B', 'LẬP PHIẾU', x.creator_name], ['C', 'E', 'NGƯỜI NHẬN HÀNG', x.receiver_name], ['F', 'H', 'GIÁM ĐỐC NHÀ MÁY', x.approver_name || '']];
  for (const [a, c, title, name] of sign) {
    mergePut(ws, `${a}${y}:${c}${y}`, title, { font: b, alignment: center });
    mergePut(ws, `${a}${y + 5}:${c}${y + 5}`, name, { font: b, alignment: center });
  }
  return wb;
}

/** Báo cáo tồn kho (cùng cột với giao diện quản lý vật tư). */
async function stockWorkbook(db, rows, title) {
  const s = settings(db);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ton kho', { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [6, 24, 40, 30, 22, 9, 10, 14, 24, 20].map((width) => ({ width }));
  mergePut(ws, 'A1:J1', s.company_name, { font: { bold: true } });
  mergePut(ws, 'A2:J2', title, { font: { bold: true, size: 14 }, alignment: { horizontal: 'center' } });
  const head = ['STT', 'Mã vật tư', 'Tên vật tư', 'Thông số kỹ thuật', 'Hãng SX / Nước SX', 'Đơn vị', 'Số lượng', 'Tình trạng', 'Ghi chú', 'Kho'];
  head.forEach((h, i) => put(ws, ws.getRow(4).getCell(i + 1).address, h, { font: { bold: true }, alignment: { horizontal: 'center' }, border: true }));
  rows.forEach((r, i) => {
    const vals = [i + 1, r.code, r.name, r.spec || '', r.manufacturer || '', r.unit || '', r.quantity, r.condition || '', r.note || '', r.factory_name];
    vals.forEach((v, j) => put(ws, ws.getRow(5 + i).getCell(j + 1).address, v, { border: true, font: { size: 11 } }));
  });
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.pageSetup.printTitlesRow = '4:4';
  return wb;
}

module.exports = { requestWorkbook, issueWorkbook, stockWorkbook };
