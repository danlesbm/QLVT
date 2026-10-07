'use strict';

/**
 * Danh mục quyền. scoped=true: quyền gán theo nhà máy (hoặc toàn công ty khi không chọn nhà máy).
 */
const PERMISSIONS = [
  { group: 'Hệ thống', code: 'admin.settings', label: 'Cài đặt hệ thống (nhà máy, thông tin công ty, đồng bộ SSO)' },
  { group: 'Hệ thống', code: 'admin.permissions', label: 'Phân quyền người dùng, quản lý nhóm quyền' },

  { group: 'Mã vật tư', code: 'catalog.view', label: 'Xem danh mục mã vật tư' },
  { group: 'Mã vật tư', code: 'catalog.code_company', label: 'Đánh mã vật tư chung toàn công ty' },
  { group: 'Mã vật tư', code: 'catalog.code_factory', label: 'Đánh mã vật tư riêng của nhà máy', scoped: true },

  { group: 'Tồn kho', code: 'stock.view', label: 'Xem tồn kho', scoped: true },
  { group: 'Tồn kho', code: 'stock.edit', label: 'Nhập thêm / điều chỉnh vật tư trong kho', scoped: true },
  { group: 'Tồn kho', code: 'stock.import', label: 'Import tồn kho từ Excel phần mềm cũ' },

  { group: 'Đề xuất vật tư', code: 'request.view', label: 'Xem phiếu đề xuất', scoped: true },
  { group: 'Đề xuất vật tư', code: 'request.create', label: 'Lập phiếu đề xuất (người tổng hợp của nhà máy)', scoped: true },
  { group: 'Đề xuất vật tư', code: 'request.approve_factory', label: 'Giám đốc nhà máy xem xét phiếu', scoped: true },
  { group: 'Đề xuất vật tư', code: 'request.pkt_head', label: 'Trưởng phòng Kỹ thuật: phân công kiểm soát, duyệt lần 1' },
  { group: 'Đề xuất vật tư', code: 'request.pkt_review', label: 'Cán bộ PKT kiểm soát vật tư (được phân công)' },
  { group: 'Đề xuất vật tư', code: 'request.approve_director', label: 'Giám đốc / Phó giám đốc: duyệt nhu cầu, duyệt giá' },
  { group: 'Đề xuất vật tư', code: 'request.receive', label: 'Nhà máy nhận hàng và kiểm tra hàng', scoped: true },

  { group: 'Mua sắm', code: 'purchase.head', label: 'Trưởng phòng Kế hoạch: nhận phiếu, giao báo giá, giao tổng hợp' },
  { group: 'Mua sắm', code: 'purchase.staff', label: 'Nhân viên Phòng Kế hoạch: báo giá, mua sắm, chuyển hàng' },

  { group: 'Xuất kho', code: 'issue.view', label: 'Xem phiếu xuất kho', scoped: true },
  { group: 'Xuất kho', code: 'issue.create', label: 'Lập phiếu xuất kho (thủ kho / người được phân công)', scoped: true },
  { group: 'Xuất kho', code: 'issue.approve', label: 'Giám đốc nhà máy duyệt phiếu xuất kho', scoped: true },
];

const BY_CODE = Object.fromEntries(PERMISSIONS.map((p) => [p.code, p]));

/** Nhóm quyền mặc định tạo khi khởi tạo CSDL; quản trị có thể sửa hoặc tạo thêm. */
const DEFAULT_ROLES = [
  { name: 'Người xem', description: 'Chỉ xem tồn kho, mã vật tư, phiếu', permissions: ['catalog.view', 'stock.view', 'request.view', 'issue.view'] },
  { name: 'Người tổng hợp đề xuất (nhà máy)', description: 'Lập phiếu nhu cầu vật tư của nhà máy, nhận và kiểm tra hàng', permissions: ['catalog.view', 'stock.view', 'request.view', 'request.create', 'request.receive', 'issue.view'] },
  { name: 'Giám đốc nhà máy', description: 'Xem xét phiếu đề xuất, duyệt phiếu xuất kho', permissions: ['catalog.view', 'stock.view', 'request.view', 'request.approve_factory', 'request.receive', 'issue.view', 'issue.approve'] },
  { name: 'Thủ kho', description: 'Quản lý tồn kho và lập phiếu xuất kho', permissions: ['catalog.view', 'stock.view', 'stock.edit', 'issue.view', 'issue.create', 'request.view', 'request.receive'] },
  { name: 'Người đánh mã vật tư', description: 'Quản lý danh mục mã vật tư', permissions: ['catalog.view', 'catalog.code_factory', 'stock.view'] },
  { name: 'Trưởng phòng Kỹ thuật', description: 'Phân công kiểm soát và duyệt lần 1', permissions: ['catalog.view', 'stock.view', 'request.view', 'request.pkt_head', 'request.pkt_review'] },
  { name: 'Cán bộ Phòng Kỹ thuật', description: 'Kiểm soát vật tư khi được phân công', permissions: ['catalog.view', 'stock.view', 'request.view', 'request.pkt_review'] },
  { name: 'Ban Giám đốc', description: 'Giám đốc / Phó giám đốc phụ trách: duyệt nhu cầu, duyệt giá', permissions: ['catalog.view', 'stock.view', 'request.view', 'request.approve_director', 'issue.view'] },
  { name: 'Trưởng phòng Kế hoạch', description: 'Nhận phiếu, giao báo giá, giao tổng hợp so sánh giá', permissions: ['catalog.view', 'stock.view', 'request.view', 'purchase.head', 'purchase.staff'] },
  { name: 'Nhân viên Phòng Kế hoạch', description: 'Báo giá, mua sắm, chuyển hàng', permissions: ['catalog.view', 'stock.view', 'request.view', 'purchase.staff'] },
];

module.exports = { PERMISSIONS, BY_CODE, DEFAULT_ROLES };
