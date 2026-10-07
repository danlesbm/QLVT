'use strict';
/**
 * Danh bạ giả lập SSO dùng khi phát triển / demo (SSO_MODE=mock).
 * Cấu trúc giống dữ liệu mà adapter OIDC lấy từ SSO thật.
 */
const departments = [
  { id: 'BGD', code: 'BGD', name: 'Ban Giám đốc' },
  { id: 'PKT', code: 'PKT', name: 'Phòng Kỹ thuật' },
  { id: 'PKH', code: 'PKH', name: 'Phòng Kế hoạch' },
  { id: 'PHC', code: 'PHC', name: 'Phòng Hành chính' },
  { id: 'NM-TACO', code: 'TACO', name: 'NMTĐ Tà Cọ' },
  { id: 'NM-NC3', code: 'NC3', name: 'NMTĐ Nậm Công 3' },
  { id: 'NM-NATAU', code: 'NATAU', name: 'NMTĐ Nậm Tàu' },
  { id: 'NM-SS3', code: 'SS3', name: 'NMTĐ SS3' },
  { id: 'NM-TG', code: 'TG', name: 'NMTĐ TG' },
];

const positions = [
  { id: 'GD', code: 'GD', name: 'Giám đốc' },
  { id: 'PGD', code: 'PGD', name: 'Phó giám đốc' },
  { id: 'TP', code: 'TP', name: 'Trưởng phòng' },
  { id: 'CV', code: 'CV', name: 'Chuyên viên' },
  { id: 'GDNM', code: 'GDNM', name: 'Giám đốc nhà máy' },
  { id: 'TK', code: 'TK', name: 'Thủ kho' },
  { id: 'NV', code: 'NV', name: 'Nhân viên vận hành' },
];

const employees = [
  { id: 'nv900', username: 'admin', full_name: 'Quản trị hệ thống', department_id: 'PHC', position_id: 'CV' },
  { id: 'nv001', username: 'ledacdan', full_name: 'Lê Đắc Dần', department_id: 'BGD', position_id: 'GD' },
  { id: 'nv002', username: 'pgd.hung', full_name: 'Nguyễn Văn Hùng', department_id: 'BGD', position_id: 'PGD' },
  { id: 'nv010', username: 'tp.kythuat', full_name: 'Trần Minh Khoa', department_id: 'PKT', position_id: 'TP' },
  { id: 'nv011', username: 'phamvanhao', full_name: 'Phạm Văn Hảo', department_id: 'PKT', position_id: 'CV' },
  { id: 'nv020', username: 'tp.kehoach', full_name: 'Đỗ Thị Lan', department_id: 'PKH', position_id: 'TP' },
  { id: 'nv021', username: 'kh.an', full_name: 'Nguyễn Thị An', department_id: 'PKH', position_id: 'CV' },
  { id: 'nv022', username: 'kh.binh', full_name: 'Vũ Đức Bình', department_id: 'PKH', position_id: 'CV' },
  { id: 'nv023', username: 'kh.cuong', full_name: 'Hoàng Văn Cường', department_id: 'PKH', position_id: 'CV' },
  { id: 'nv100', username: 'lovanthin', full_name: 'Lò Văn Thìn', department_id: 'NM-TACO', position_id: 'GDNM' },
  { id: 'nv101', username: 'quangvanthu', full_name: 'Quàng Văn Thư', department_id: 'NM-TACO', position_id: 'NV' },
  { id: 'nv102', username: 'thukho.taco', full_name: 'Lường Thị Mai', department_id: 'NM-TACO', position_id: 'TK' },
  { id: 'nv200', username: 'gd.nc3', full_name: 'Cầm Văn Sơn', department_id: 'NM-NC3', position_id: 'GDNM' },
  { id: 'nv201', username: 'th.nc3', full_name: 'Tòng Văn Phúc', department_id: 'NM-NC3', position_id: 'NV' },
];

module.exports = { departments, positions, employees };
