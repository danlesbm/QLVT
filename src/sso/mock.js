'use strict';
const directory = require('./mock-directory');

/** SSO giả lập: chọn người dùng trong danh bạ mẫu để đăng nhập (chỉ dùng khi phát triển/demo). */
module.exports = {
  name: 'mock',
  async fetchDirectory() {
    return directory;
  },
  loginStart(req, res) {
    res.redirect('/login');
  },
  async callback(req) {
    const id = String(req.body.sso_id || '');
    const e = directory.employees.find((x) => x.id === id);
    if (!e) throw new Error('Người dùng không tồn tại trong SSO giả lập');
    return e;
  },
  logoutUrl() {
    return '/login';
  },
};
