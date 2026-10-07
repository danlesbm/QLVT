'use strict';
const directory = require('../sso/mock-directory');
const { syncDirectory } = require('../sso/sync');

/** Phân quyền mẫu cho danh bạ SSO giả lập (dùng cho demo và kiểm thử). */
const ASSIGN = [
  ['nv001', 'Ban Giám đốc', null],
  ['nv002', 'Ban Giám đốc', null],
  ['nv010', 'Trưởng phòng Kỹ thuật', null],
  ['nv011', 'Cán bộ Phòng Kỹ thuật', null],
  ['nv020', 'Trưởng phòng Kế hoạch', null],
  ['nv021', 'Nhân viên Phòng Kế hoạch', null],
  ['nv022', 'Nhân viên Phòng Kế hoạch', null],
  ['nv023', 'Nhân viên Phòng Kế hoạch', null],
  ['nv100', 'Giám đốc nhà máy', 'TACO'],
  ['nv101', 'Người tổng hợp đề xuất (nhà máy)', 'TACO'],
  ['nv102', 'Thủ kho', 'TACO'],
  ['nv102', 'Người đánh mã vật tư', 'TACO'],
  ['nv200', 'Giám đốc nhà máy', 'NC3'],
  ['nv201', 'Người tổng hợp đề xuất (nhà máy)', 'NC3'],
  ['nv201', 'Thủ kho', 'NC3'],
];

function seedDemo(db, { admin = 'nv900' } = {}) {
  syncDirectory(db, directory, admin ? [admin] : []);
  const uid = (sso) => db.one('SELECT id FROM users WHERE sso_id = ?', sso).id;
  const rid = (name) => db.one('SELECT id FROM roles WHERE name = ?', name).id;
  const fid = (code) => (code ? db.one('SELECT id FROM factories WHERE code = ?', code).id : null);
  for (const [sso, role, factory] of ASSIGN) {
    db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id, factory_id) VALUES (?, ?, ?)', uid(sso), rid(role), fid(factory));
  }
  // GĐ phụ trách mặc định cho các nhà máy
  db.run('UPDATE factories SET director_id = ? WHERE director_id IS NULL', uid('nv002'));
}

module.exports = { seedDemo };
