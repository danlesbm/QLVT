'use strict';
/**
 * Làm sạch tên và xếp hạng chức vụ lấy từ SSO (cùng quy tắc với app Payroll).
 *  Quản lý:   "Chức vụ - Họ và tên"        (vd "Phó phòng kỹ thuật - Phạm Văn Hảo")
 *  Nhân viên: "Họ và tên - NV bộ phận xxx" (vd "Nguyễn Vân Kiều - NV Văn phòng")
 */
// Từ viết tắt (BKS, GĐ, PGĐ, NV) phải đứng riêng; \b của JS không hiểu chữ có dấu nên dùng ranh giới Unicode
const W = (x) => `(?<![\\p{L}\\p{N}])${x}(?![\\p{L}\\p{N}])`;
const POS = new RegExp(
  `(chủ tịch|hđqt|${W('bks')}|thành viên|hành chính|giám đốc|${W('p?gđ')}|phó|trưởng|chánh|phụ trách|kế toán|${W('nv')}|nhân viên|lái xe|kỹ thuật|kỹ sư|vận hành|thủ quỹ|văn thư|bảo vệ|tạp vụ|nmtđ|nhà máy|phòng|bộ phận|ban |hội đồng|kiểm soát)`,
  'iu',
);
const BOARD = /(hội đồng quản trị|ban kiểm soát)/iu;
const MANAGER = /(giám đốc|phó gđ|trưởng phòng|phó phòng|hội đồng quản trị|kiểm soát)/iu;

function cleanName(raw, positions = '') {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  // Dấu ngăn cách: - – — _ ; có cách hai đầu, một đầu hoặc không cách
  const parts = s.split(/\s*[-–—_]\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return s;
  const a = parts[0];
  const b = parts.slice(1).join(' - ');
  const aPos = POS.test(a);
  const bPos = POS.test(b);
  if (BOARD.test(String(positions || '')) && aPos) return b; // HĐQT / BKS: đoạn đầu là chức danh
  if (aPos && !bPos) return b;
  if (bPos && !aPos) return a;
  if (!aPos && !bPos && !/\s[-–—_]\s/.test(s)) return s; // tên có gạch nối liền (Nguyễn Thị Hoa-Lan): không tách
  return MANAGER.test(String(positions || '')) ? b : a;
}

// Thứ bậc chức vụ SSO (số nhỏ = cao hơn)
const RANKS = new Map([
  ['hội đồng quản trị', 5], ['ban kiểm soát', 6], ['giám đốc', 10], ['phó gđ', 20], ['trưởng phòng', 30],
  ['phó phòng', 40], ['người phụ trách', 50], ['văn thư', 60], ['nhân viên', 70],
]);
const posRank = (role) => RANKS.get(String(role || '').trim().toLowerCase()) ?? 80;

/** Bỏ dấu tiếng Việt, chữ thường (đ -> d). */
function plain(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

module.exports = { cleanName, posRank, plain };
