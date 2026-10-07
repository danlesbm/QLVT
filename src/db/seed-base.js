'use strict';
const { DEFAULT_ROLES } = require('../auth/permissions');

/**
 * 5 nhà máy / kho lấy theo mã kho trong file tồn kho của phần mềm cũ.
 * Tên các nhà máy chưa rõ có thể sửa trong Cài đặt > Nhà máy.
 */
const FACTORIES = [
  { code: 'TACO', name: 'NMTĐ Tà Cọ', warehouse_code: 'KHOTACO', request_prefix: 'PNC-TC-SBM' },
  { code: 'NC3', name: 'NMTĐ Nậm Công 3', warehouse_code: 'KHONC3', request_prefix: 'PNC-NC3-SBM' },
  { code: 'NATAU', name: 'NMTĐ Nậm Tàu', warehouse_code: 'KHONATAU', request_prefix: 'PNC-NT-SBM' },
  { code: 'SS3', name: 'NMTĐ SS3', warehouse_code: 'KHOSS3', request_prefix: 'PNC-SS3-SBM' },
  { code: 'TG', name: 'NMTĐ TG', warehouse_code: 'KHOTG', request_prefix: 'PNC-TG-SBM' },
];

const SETTINGS = {
  company_name: 'CÔNG TY CỔ PHẦN ĐẦU TƯ PHÁT TRIỂN BẮC MINH',
  company_name_en: 'BAC MINH DEVELOPMENT INVESTMENT JOINT STOCK COMPANY',
  company_short: 'SBM',
  company_address: 'Số 03, An Dương, P. Hồng Hà, TP.Hà Nội, Việt Nam',
  company_phone: '024.37764615',
  company_website: 'sbm.com.vn',
  company_email: 'bacminh.sbm@gmail.com',
  request_recipient: 'Ban giám đốc Công ty CP ĐTPT Bắc Minh',
  // Ai ký mục "Phòng Kỹ thuật - Kiểm tra" trên phiếu: 'reviewer' (người kiểm soát) hoặc 'head' (TP Kỹ thuật)
  pkt_signer: 'reviewer',
  max_quoters: '3',
};

function seedBase(db) {
  const has = db.prepare('SELECT COUNT(*) n FROM roles').get().n;
  if (has) return;
  db.exec('BEGIN');
  const r = db.prepare('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)');
  for (const role of DEFAULT_ROLES) r.run(role.name, role.description, JSON.stringify(role.permissions));
  const f = db.prepare('INSERT OR IGNORE INTO factories (code, name, warehouse_code, warehouse_name, request_prefix, sort) VALUES (?, ?, ?, ?, ?, ?)');
  FACTORIES.forEach((x, i) => f.run(x.code, x.name, x.warehouse_code, `Kho ${x.name}`, x.request_prefix, i + 1));
  const s = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SETTINGS)) s.run(k, v);
  db.exec('COMMIT');
}

module.exports = { seedBase, FACTORIES };
