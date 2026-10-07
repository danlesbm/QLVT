'use strict';
/**
 * Danh bạ giả lập dùng khi phát triển / demo (SSO_MODE=mock).
 * Cùng định dạng với GET {SSO_BASE_URL}/api/internal/directory của SSO Portal:
 * tên người dùng ghi kiểu "Chức vụ - Họ tên" / "Họ tên - NV bộ phận", HĐQT / Ban giám đốc không gắn phòng.
 */
const departments = [
  { id: '1', name: 'Phòng Kỹ thuật' },
  { id: '2', name: 'Phòng Kế hoạch' },
  { id: '3', name: 'Phòng Kế toán' },
  { id: '4', name: 'Văn phòng' },
  { id: '11', name: 'NMTĐ Tà Cọ' },
  { id: '12', name: 'NMTĐ Nậm Công 3' },
  { id: '13', name: 'NMTĐ Nà Tẩu' },
  { id: '14', name: 'NMTĐ Suối Sập 3' },
  { id: '15', name: 'NMTĐ Thoong Gót' },
];

const users = [
  { id: 'nv900', username: 'admin', name: 'Quản trị hệ thống', email: 'admin@sbm.com.vn', status: 'active' },
  { id: 'nv001', username: 'ledacdan', name: 'Giám đốc - Lê Đắc Dần', email: 'ledacdan@sbm.com.vn', status: 'active' },
  { id: 'nv002', username: 'pgd.hung', name: 'Phó Giám đốc - Nguyễn Văn Hùng', email: 'hungnv@sbm.com.vn', status: 'active' },
  { id: 'nv010', username: 'tp.kythuat', name: 'Trưởng phòng kỹ thuật - Trần Minh Khoa', status: 'active' },
  { id: 'nv011', username: 'phamvanhao', name: 'Phạm Văn Hảo - NV Phòng Kỹ thuật', status: 'active' },
  { id: 'nv020', username: 'tp.kehoach', name: 'Trưởng phòng KH - Đỗ Thị Lan', status: 'active' },
  { id: 'nv021', username: 'kh.an', name: 'Nguyễn Thị An - NV phòng KH', status: 'active' },
  { id: 'nv022', username: 'kh.binh', name: 'Vũ Đức Bình -NV phòng KH', status: 'active' },
  { id: 'nv023', username: 'kh.cuong', name: 'Hoàng Văn Cường_NV phòng KH', status: 'active' },
  { id: 'nv100', username: 'lovanthin', name: 'Giám đốc NMTĐ Tà Cọ - Lò Văn Thìn', status: 'active' },
  { id: 'nv101', username: 'quangvanthu', name: 'Quàng Văn Thư - NVVH NMTĐ Tà Cọ', status: 'active' },
  { id: 'nv102', username: 'thukho.taco', name: 'Lường Thị Mai - Thủ kho NMTĐ Tà Cọ', status: 'active' },
  { id: 'nv200', username: 'gd.nc3', name: 'Giám đốc NMTĐ Nậm Công 3 - Cầm Văn Sơn', status: 'active' },
  { id: 'nv201', username: 'th.nc3', name: 'Tòng Văn Phúc - NV NMTĐ Nậm Công 3', status: 'active' },
  { id: 'nv300', username: 'gd.ss3', name: 'Giám đốc NMTĐ SS3_ Lò Văn Thanh', status: 'active' },
  { id: 'nv301', username: 'vh.ss3', name: 'Hồ Đăng Thành - NVVH NMTĐ Suối Sập 3', status: 'active' },
  { id: 'nv400', username: 'pgd.tg', name: 'P. Giám đốc NMTĐ Thoong Gót - Vì Văn Long', status: 'active' },
  { id: 'nv500', username: 'gd.natau', name: 'Giám đốc NMTĐ Nà Tẩu - Hà Văn Quý', status: 'active' },
];

const assignments = [
  { userId: 'nv900', deptId: '4', role: 'Nhân viên' },
  { userId: 'nv001', deptId: '', role: 'Giám đốc' },
  { userId: 'nv002', deptId: '', role: 'Phó GĐ' },
  // Phó GĐ phụ trách nhà máy Tà Cọ: không phải nhân sự của nhà máy
  { userId: 'nv002', deptId: '11', role: 'Người phụ trách' },
  { userId: 'nv010', deptId: '1', role: 'Trưởng phòng' },
  { userId: 'nv011', deptId: '1', role: 'Nhân viên' },
  { userId: 'nv020', deptId: '2', role: 'Trưởng phòng' },
  { userId: 'nv021', deptId: '2', role: 'Nhân viên' },
  { userId: 'nv022', deptId: '2', role: 'Nhân viên' },
  { userId: 'nv023', deptId: '2', role: 'Nhân viên' },
  { userId: 'nv100', deptId: '11', role: 'Trưởng phòng' },
  { userId: 'nv101', deptId: '11', role: 'Nhân viên' },
  { userId: 'nv102', deptId: '11', role: 'Nhân viên' },
  { userId: 'nv200', deptId: '12', role: 'Trưởng phòng' },
  { userId: 'nv201', deptId: '12', role: 'Nhân viên' },
  { userId: 'nv300', deptId: '14', role: 'Trưởng phòng' },
  { userId: 'nv301', deptId: '14', role: 'Nhân viên' },
  { userId: 'nv400', deptId: '15', role: 'Phó phòng' },
  { userId: 'nv500', deptId: '13', role: 'Trưởng phòng' },
];

module.exports = { ok: true, users, departments, assignments };
