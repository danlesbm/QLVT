'use strict';
const directory = require('./mock-directory');
const { normalizeDirectory } = require('./sync');

/** SSO giả lập: chọn người dùng trong danh bạ mẫu để đăng nhập (chỉ dùng khi phát triển/demo). */
module.exports = {
  name: 'mock',
  async fetchDirectory() {
    return directory;
  },
  /** Danh sách người để chọn đăng nhập: hồ sơ đã chuẩn hóa kèm tên đơn vị. */
  people() {
    const nd = normalizeDirectory(directory);
    const deps = new Map(nd.departments.map((d) => [d.id, d.name]));
    return nd.users.map((u) => ({ ...u, department: deps.get(u.department_id) || '', position: u.position_id || '' }));
  },
  profile(ssoId) {
    const nd = normalizeDirectory(directory);
    const u = nd.users.find((x) => x.id === String(ssoId || ''));
    if (!u) throw new Error('Người dùng không tồn tại trong SSO giả lập');
    return u;
  },
};
