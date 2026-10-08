'use strict';
const { DEFAULT_ROLES } = require('../auth/permissions');

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
  // Nơi nhận in cuối phiếu nhu cầu; {nha_may} được thay bằng tên nhà máy
  request_cc_hard: 'Đ/c. Điệp',
  request_cc_scan: 'Giám đốc, P. Giám đốc, PKT, Đ/c. Điệp, Giám đốc {nha_may}, Người lập PNCVT, {nha_may};',
  max_quoters: '3',
};

/** Cài đặt và nhóm quyền mặc định. Kho không tạo sẵn: quản trị tích đơn vị SSO nào có kho trong Cài đặt. */
function seedBase(db) {
  // Cài đặt mới bổ sung ở các phiên bản sau cũng được thêm vào CSDL đang dùng
  const s = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SETTINGS)) s.run(k, v);
  const has = db.prepare('SELECT COUNT(*) n FROM roles').get().n;
  if (has) return;
  db.exec('BEGIN');
  const r = db.prepare('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)');
  for (const role of DEFAULT_ROLES) r.run(role.name, role.description, JSON.stringify(role.permissions));
  db.exec('COMMIT');
}

module.exports = { seedBase };
