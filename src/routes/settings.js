'use strict';
const express = require('express');
const { PERMISSIONS } = require('../auth/permissions');
const { can, usersWith } = require('../auth/access');
const { runSync } = require('../sso');
const { AppError, str } = require('../services/util');
const { forbidden } = require('./common');

const SETTING_KEYS = [
  ['company_name', 'Tên công ty'],
  ['company_name_en', 'Tên tiếng Anh'],
  ['company_short', 'Tên viết tắt / logo chữ'],
  ['company_address', 'Địa chỉ'],
  ['company_phone', 'Điện thoại'],
  ['company_website', 'Website'],
  ['company_email', 'Email'],
  ['request_recipient', 'Kính gửi (phiếu nhu cầu)'],
  ['request_cc_hard', 'Nơi nhận - bản cứng (phiếu nhu cầu)'],
  ['request_cc_scan', 'Nơi nhận - bản scan ({nha_may} = tên nhà máy)'],
];

module.exports = (db) => {
  const r = express.Router();
  const need = (perm) => (req, res, next) => (can(req.access, perm) ? next() : forbidden(res));
  const anySettings = (req, res, next) => (can(req.access, 'admin.settings') || can(req.access, 'admin.permissions') ? next() : forbidden(res));
  r.use(anySettings);

  const settingsMap = () => Object.fromEntries(db.all('SELECT key, value FROM settings').map((x) => [x.key, x.value]));

  r.get('/', (req, res) => {
    res.render('settings/index', {
      title: 'Cài đặt', settings: settingsMap(), SETTING_KEYS,
      factories: db.all('SELECT f.*, u.full_name AS director_name FROM factories f LEFT JOIN users u ON u.id = f.director_id ORDER BY f.sort, f.name'),
      counts: {
        users: db.one('SELECT COUNT(*) n FROM users WHERE active = 1').n,
        departments: db.one('SELECT COUNT(*) n FROM departments WHERE active = 1').n,
        positions: db.one('SELECT COUNT(*) n FROM positions WHERE active = 1').n,
      },
    });
  });

  r.post('/chung', need('admin.settings'), (req, res) => {
    const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k] of SETTING_KEYS) if (k in req.body) up.run(k, str(req.body[k]) || '');
    if (['reviewer', 'head'].includes(req.body.pkt_signer)) up.run('pkt_signer', req.body.pkt_signer);
    const mq = Number(req.body.max_quoters);
    if (mq >= 1 && mq <= 10) up.run('max_quoters', String(mq));
    res.flash('success', 'Đã lưu cài đặt chung');
    res.redirect('/cai-dat');
  });

  r.post('/dong-bo-sso', need('admin.settings'), async (req, res) => {
    try {
      const x = await runSync(db);
      res.flash(x.warnings.length ? 'warning' : 'success', `Đã đồng bộ từ SSO: ${x.employees} CBCNV, ${x.departments} bộ phận, ${x.positions} chức vụ${x.warnings.length ? '. ' + x.warnings.join('; ') : ''}`);
    } catch (err) {
      res.flash('danger', `Đồng bộ SSO thất bại: ${err.message}`);
    }
    res.redirect('/cai-dat');
  });

  // ----- Nhà máy -----
  r.get('/nha-may/:id', need('admin.settings'), (req, res) => {
    const row = req.params.id === 'moi' ? { active: 1, sort: 99 } : db.one('SELECT * FROM factories WHERE id = ?', Number(req.params.id));
    if (!row) return forbidden(res, 'Không tìm thấy nhà máy');
    res.render('settings/factory', {
      title: row.id ? `Nhà máy ${row.name}` : 'Thêm nhà máy', row,
      directors: usersWith(db, 'request.approve_director'),
      departments: db.all('SELECT d.*, f.name AS factory_name FROM departments d LEFT JOIN factories f ON f.id = d.factory_id WHERE d.active = 1 ORDER BY d.name'),
    });
  });

  r.post('/nha-may', need('admin.settings'), (req, res) => {
    const b = req.body;
    const id = b.id ? Number(b.id) : null;
    const code = str(b.code);
    const name = str(b.name);
    if (!code || !name) throw new AppError('Nhập mã và tên nhà máy');
    if (db.one('SELECT 1 FROM factories WHERE code = ? AND id <> ?', code, id || 0)) throw new AppError(`Mã nhà máy ${code} đã tồn tại`);
    if (str(b.warehouse_code) && db.one('SELECT 1 FROM factories WHERE warehouse_code = ? AND id <> ?', str(b.warehouse_code), id || 0)) throw new AppError(`Mã kho ${b.warehouse_code} đã dùng cho nhà máy khác`);
    const vals = [code, name, str(b.warehouse_code), str(b.warehouse_name), str(b.address), str(b.request_prefix), b.director_id ? Number(b.director_id) : null, Number(b.sort) || 0, b.active ? 1 : 0];
    db.tx(() => {
      let fid = id;
      if (id) db.run('UPDATE factories SET code=?, name=?, warehouse_code=?, warehouse_name=?, address=?, request_prefix=?, director_id=?, sort=?, active=? WHERE id=?', ...vals, id);
      else fid = Number(db.run('INSERT INTO factories (code, name, warehouse_code, warehouse_name, address, request_prefix, director_id, sort, active) VALUES (?,?,?,?,?,?,?,?,?)', ...vals).lastInsertRowid);
      const deps = [].concat(b.departments || []).map(Number);
      db.run('UPDATE departments SET factory_id = NULL WHERE factory_id = ?', fid);
      for (const d of deps) db.run('UPDATE departments SET factory_id = ? WHERE id = ?', fid, d);
    });
    res.flash('success', 'Đã lưu nhà máy');
    res.redirect('/cai-dat');
  });

  // ----- Nhóm quyền -----
  r.get('/nhom-quyen', need('admin.permissions'), (req, res) => {
    const roles = db.all('SELECT r.*, (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS members FROM roles r ORDER BY r.name');
    res.render('settings/roles', { title: 'Nhóm quyền', roles: roles.map((x) => ({ ...x, perms: JSON.parse(x.permissions) })), PERMISSIONS });
  });

  r.get('/nhom-quyen/:id', need('admin.permissions'), (req, res) => {
    const row = req.params.id === 'moi' ? { permissions: '[]' } : db.one('SELECT * FROM roles WHERE id = ?', Number(req.params.id));
    if (!row) return forbidden(res, 'Không tìm thấy nhóm quyền');
    res.render('settings/role', { title: row.id ? `Nhóm quyền: ${row.name}` : 'Thêm nhóm quyền', row, perms: new Set(JSON.parse(row.permissions)), PERMISSIONS });
  });

  r.post('/nhom-quyen', need('admin.permissions'), (req, res) => {
    const name = str(req.body.name);
    if (!name) throw new AppError('Nhập tên nhóm quyền');
    if (db.one('SELECT 1 FROM roles WHERE name = ? AND id <> ?', name, Number(req.body.id) || 0)) throw new AppError(`Nhóm quyền "${name}" đã tồn tại`);
    const valid = new Set(PERMISSIONS.map((p) => p.code));
    const perms = [].concat(req.body.perms || []).filter((p) => valid.has(p));
    if (req.body.id) db.run('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?', name, str(req.body.description), JSON.stringify(perms), Number(req.body.id));
    else db.run('INSERT INTO roles (name, description, permissions) VALUES (?, ?, ?)', name, str(req.body.description), JSON.stringify(perms));
    res.flash('success', 'Đã lưu nhóm quyền');
    res.redirect('/cai-dat/nhom-quyen');
  });

  r.post('/nhom-quyen/:id/xoa', need('admin.permissions'), (req, res) => {
    db.run('DELETE FROM roles WHERE id = ?', Number(req.params.id));
    res.flash('success', 'Đã xóa nhóm quyền');
    res.redirect('/cai-dat/nhom-quyen');
  });

  // ----- Người dùng & phân quyền -----
  r.get('/nguoi-dung', need('admin.permissions'), (req, res) => {
    const q = req.query.q ? `%${req.query.q}%` : '%';
    const users = db.all(
      `SELECT u.*, d.name AS department_name, p.name AS position_name,
              (SELECT GROUP_CONCAT(r.name || IFNULL(' @' || f.code, ''), ', ') FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 LEFT JOIN factories f ON f.id = ur.factory_id WHERE ur.user_id = u.id) AS roles
         FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN positions p ON p.id = u.position_id
        WHERE (u.full_name LIKE ? OR u.username LIKE ? OR d.name LIKE ?) AND (? = 0 OR u.department_id = ?)
        ORDER BY u.active DESC, d.name, u.full_name`,
      q, q, q, Number(req.query.dep) || 0, Number(req.query.dep) || 0,
    );
    res.render('settings/users', { title: 'Người dùng & phân quyền', users, query: req.query, departments: db.all('SELECT * FROM departments WHERE active = 1 ORDER BY name') });
  });

  r.get('/nguoi-dung/:id', need('admin.permissions'), (req, res) => {
    const u = db.one(
      `SELECT u.*, d.name AS department_name, p.name AS position_name FROM users u
         LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN positions p ON p.id = u.position_id WHERE u.id = ?`,
      Number(req.params.id),
    );
    if (!u) return forbidden(res, 'Không tìm thấy người dùng');
    const assigned = db.all(
      `SELECT ur.*, r.name AS role_name, r.permissions, f.name AS factory_name FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id LEFT JOIN factories f ON f.id = ur.factory_id WHERE ur.user_id = ? ORDER BY r.name`,
      u.id,
    );
    res.render('settings/user', {
      title: u.full_name, u, assigned, PERMISSIONS,
      roles: db.all('SELECT * FROM roles ORDER BY name'),
      factories: db.all('SELECT * FROM factories WHERE active = 1 ORDER BY sort'),
    });
  });

  r.post('/nguoi-dung/:id/gan', need('admin.permissions'), (req, res) => {
    const uid = Number(req.params.id);
    const roleId = Number(req.body.role_id);
    if (!db.one('SELECT 1 FROM roles WHERE id = ?', roleId)) throw new AppError('Chọn nhóm quyền');
    const factories = [].concat(req.body.factory_ids || []).filter(Boolean).map(Number);
    const scopes = factories.length ? factories : [null];
    for (const f of scopes) db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id, factory_id) VALUES (?, ?, ?)', uid, roleId, f);
    res.flash('success', 'Đã gán quyền');
    res.redirect(`/cai-dat/nguoi-dung/${uid}`);
  });

  r.post('/nguoi-dung/:id/bo/:ur', need('admin.permissions'), (req, res) => {
    db.run('DELETE FROM user_roles WHERE id = ? AND user_id = ?', Number(req.params.ur), Number(req.params.id));
    res.flash('success', 'Đã bỏ quyền');
    res.redirect(`/cai-dat/nguoi-dung/${req.params.id}`);
  });

  r.post('/nguoi-dung/:id/quan-tri', (req, res) => {
    if (!req.access.isAdmin) return forbidden(res, 'Chỉ quản trị viên mới cấp được quyền quản trị.');
    const uid = Number(req.params.id);
    if (uid === req.user.id) throw new AppError('Không thể tự bỏ quyền quản trị của chính mình');
    db.run('UPDATE users SET is_admin = ? WHERE id = ?', req.body.is_admin === '1' ? 1 : 0, uid);
    res.flash('success', 'Đã cập nhật quyền quản trị');
    res.redirect(`/cai-dat/nguoi-dung/${uid}`);
  });

  return r;
};
