'use strict';
const express = require('express');
const { PERMISSIONS, isPlantRole } = require('../auth/permissions');
const { can, usersWith, memberFactoryIds, factoryMembers, isAdminUser } = require('../auth/access');
const { runSync } = require('../sso');
const plants = require('../services/plants');
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

  const ids = (v) => [...new Set([].concat(v ?? []).flatMap((x) => String(x).split(',')).map(Number).filter(Boolean))];
  const plantRoles = () => db.all('SELECT * FROM roles ORDER BY name').filter((x) => isPlantRole(x.permissions));

  r.get('/', (req, res) => {
    res.render('settings/index', {
      title: 'Cài đặt', settings: settingsMap(), SETTING_KEYS,
      // Mọi phòng ban / nhà máy trên SSO (trừ đơn vị ảo HĐQT, BKS, Ban giám đốc); đơn vị đã có kho xếp trước
      units: db.all(
        `SELECT d.id, d.name, d.active, f.id AS factory_id, f.code, f.warehouse_code, f.request_prefix, f.active AS factory_active,
                u.full_name AS director_name,
                (SELECT COUNT(DISTINCT ud.user_id) FROM user_departments ud JOIN users x ON x.id = ud.user_id
                  WHERE ud.department_id = d.id AND ud.member = 1 AND x.active = 1) AS people
           FROM departments d LEFT JOIN factories f ON f.department_id = d.id LEFT JOIN users u ON u.id = f.director_id
          WHERE d.virtual = 0 AND (d.active = 1 OR f.active = 1)
          ORDER BY IFNULL(f.active, 0) DESC, f.sort, d.name`,
      ),
      // Kho của bản trước chưa gắn đơn vị SSO (tên không khớp đơn vị nào)
      unlinked: db.all('SELECT * FROM factories WHERE department_id IS NULL ORDER BY active DESC, sort, name'),
      counts: {
        users: db.one('SELECT COUNT(*) n FROM users WHERE active = 1').n,
        departments: db.one('SELECT COUNT(*) n FROM departments WHERE active = 1 AND virtual = 0').n,
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
      res.flash(x.warnings.length ? 'warning' : 'success', `Đã đồng bộ từ SSO: ${x.users} CBCNV, ${x.departments} phòng ban / nhà máy, ${x.positions} chức vụ${x.warnings.length ? '. ' + x.warnings.join('; ') : ''}`);
    } catch (err) {
      res.flash('danger', `Đồng bộ SSO thất bại: ${err.message}`);
    }
    res.redirect('/cai-dat');
  });

  // ----- Đơn vị có kho: tích đơn vị SSO nào có kho -----
  r.post('/don-vi-co-kho', need('admin.settings'), (req, res) => {
    const x = db.tx(() => plants.setWarehouseUnits(db, ids(req.body.shown), ids(req.body.kho)));
    const msg = [x.enabled.length && `Có kho: ${x.enabled.join(', ')}.`, x.disabled.length && `Ngưng kho: ${x.disabled.join(', ')}.`].filter(Boolean);
    res.flash('success', msg.length ? `Đã lưu đơn vị có kho. ${msg.join(' ')}` : 'Không có thay đổi');
    res.redirect('/cai-dat');
  });

  // ----- Kho -----
  r.get('/nha-may/:id', (req, res) => {
    const row = db.one('SELECT * FROM factories WHERE id = ?', Number(req.params.id));
    if (!row) return forbidden(res, 'Không tìm thấy kho');
    const grants = db.all('SELECT user_id, role_id FROM user_roles WHERE factory_id = ?', row.id);
    const members = factoryMembers(db, row.id);
    const memberIds = new Set(members.map((m) => m.id));
    const roles = plantRoles();
    const roleIds = new Set(roles.map((x) => x.id));
    res.render('settings/factory', {
      title: `Kho ${row.name}`, row,
      unit: row.department_id ? db.one('SELECT * FROM departments WHERE id = ?', row.department_id) : null,
      // Đơn vị chưa có kho (hoặc chỉ có kho đã ngưng, chưa có dữ liệu: chọn thì kho đó được xóa)
      units: db.all(
        `SELECT d.*, f.id AS other_id, f.active AS other_active FROM departments d LEFT JOIN factories f ON f.department_id = d.id AND f.id <> ?
          WHERE d.virtual = 0 AND (d.active = 1 OR d.id = ?) ORDER BY d.name`,
        row.id, row.department_id || 0,
      ).filter((d) => !d.other_id || (!d.other_active && plants.isEmptyFactory(db, d.other_id))),
      directors: usersWith(db, 'request.approve_director'),
      departments: db.all(
        `SELECT d.*, f.name AS factory_name FROM departments d LEFT JOIN factories f ON f.id = d.factory_id
          WHERE d.active = 1 AND d.virtual = 0 AND d.id NOT IN (SELECT department_id FROM factories WHERE department_id IS NOT NULL) ORDER BY d.name`,
      ),
      members, roles,
      granted: new Set(grants.map((g) => `${g.user_id}:${g.role_id}`)),
      // Quyền vận hành kho đã gán cho người không còn thuộc kho (chuyển đơn vị trên SSO): không có hiệu lực
      stale: db.all(
        `SELECT ur.id, ur.user_id, u.full_name, r.name AS role_name, r.id AS role_id FROM user_roles ur JOIN users u ON u.id = ur.user_id
           JOIN roles r ON r.id = ur.role_id WHERE ur.factory_id = ? ORDER BY u.full_name`,
        row.id,
      ).filter((g) => roleIds.has(g.role_id) && !memberIds.has(g.user_id)),
      companyWide: db.all(
        `SELECT u.full_name, r.name AS role_name, r.permissions FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id
          WHERE ur.factory_id IS NULL AND u.active = 1 ORDER BY u.full_name`,
      ).filter((g) => isPlantRole(g.permissions)),
    });
  });

  r.post('/nha-may', need('admin.settings'), (req, res) => {
    const b = req.body;
    const id = Number(b.id);
    const row = db.one('SELECT * FROM factories WHERE id = ?', id || 0);
    if (!row) throw new AppError('Kho chỉ được tạo bằng cách tích "Có kho" cho đơn vị SSO trong Cài đặt');
    const code = str(b.code);
    // Không gửi đơn vị thì giữ đơn vị đang gắn
    const unitId = Number(b.department_id) || row.department_id;
    const unit = unitId ? db.one('SELECT * FROM departments WHERE id = ? AND virtual = 0', unitId) : null;
    if (unitId && !unit) throw new AppError('Đơn vị SSO không hợp lệ');
    const name = unit ? unit.name : str(b.name) || row.name;
    if (!code || !name) throw new AppError('Nhập mã kho và chọn đơn vị SSO');
    // So khớp không phân biệt hoa thường, giống cách import tồn kho tìm kho theo mã
    if (db.one('SELECT 1 FROM factories WHERE upper(code) = upper(?) AND id <> ?', code, id)) throw new AppError(`Mã kho ${code} đã tồn tại`);
    if (str(b.warehouse_code) && db.one('SELECT 1 FROM factories WHERE upper(warehouse_code) = upper(?) AND id <> ?', str(b.warehouse_code), id)) throw new AppError(`Mã kho ${b.warehouse_code} đã dùng cho kho khác`);
    // Tên kho in trên phiếu đang theo tên đơn vị cũ thì đổi theo đơn vị mới; tên quản trị tự đặt thì giữ
    const posted = str(b.warehouse_name);
    const whName = unit && unit.id !== row.department_id && (!posted || posted === `Kho ${row.name}`) ? `Kho ${unit.name}` : posted;
    db.tx(() => {
      const other = unit && db.one('SELECT name FROM factories WHERE department_id = ? AND id <> ?', unit.id, id);
      if (other && !plants.releaseUnit(db, unit.id, id)) throw new AppError(`Đơn vị ${unit.name} đã có kho "${other.name}"`);
      db.run(
        'UPDATE factories SET code=?, name=?, warehouse_code=?, warehouse_name=?, address=?, request_prefix=?, director_id=?, sort=?, active=? WHERE id=?',
        code, name, str(b.warehouse_code), whName, str(b.address), str(b.request_prefix), b.director_id ? Number(b.director_id) : null,
        Number(b.sort) || 0, b.active ? 1 : 0, id,
      );
      // Bộ phận SSO khác có nhân sự thuộc kho này (vd tổ, đội của nhà máy tách riêng trên SSO)
      db.run('UPDATE departments SET factory_id = NULL WHERE factory_id = ?', id);
      for (const d of ids(b.departments)) db.run('UPDATE departments SET factory_id = ? WHERE id = ? AND virtual = 0 AND id NOT IN (SELECT department_id FROM factories WHERE department_id IS NOT NULL)', id, d);
      if (unit) plants.linkFactory(db, id, unit.id);
    });
    res.flash('success', 'Đã lưu kho');
    res.redirect(`/cai-dat/nha-may/${id}`);
  });

  // Nhân sự kho: chỉ người thuộc đơn vị SSO của kho mới được làm thủ kho, GĐ nhà máy, người tổng hợp
  r.post('/nha-may/:id/nhan-su', need('admin.permissions'), (req, res) => {
    const fid = Number(req.params.id);
    if (!db.one('SELECT 1 FROM factories WHERE id = ?', fid)) return forbidden(res, 'Không tìm thấy kho');
    const members = new Set(factoryMembers(db, fid).map((m) => m.id));
    const roles = new Set(plantRoles().map((x) => x.id));
    const users = ids(req.body.shown_users).filter((u) => members.has(u));
    const shownRoles = ids(req.body.shown_roles).filter((x) => roles.has(x));
    const want = new Set([].concat(req.body.g ?? []).map(String));
    db.tx(() => {
      for (const u of users) {
        for (const role of shownRoles) {
          if (want.has(`${u}:${role}`)) db.run('INSERT OR IGNORE INTO user_roles (user_id, role_id, factory_id) VALUES (?, ?, ?)', u, role, fid);
          else db.run('DELETE FROM user_roles WHERE user_id = ? AND role_id = ? AND factory_id = ?', u, role, fid);
        }
      }
    });
    res.flash('success', 'Đã lưu nhân sự kho');
    res.redirect(`/cai-dat/nha-may/${fid}#nhan-su`);
  });

  r.post('/nha-may/:id/bo/:ur', need('admin.permissions'), (req, res) => {
    db.run('DELETE FROM user_roles WHERE id = ? AND factory_id = ?', Number(req.params.ur), Number(req.params.id));
    res.flash('success', 'Đã bỏ quyền');
    res.redirect(`/cai-dat/nha-may/${req.params.id}#nhan-su`);
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
    res.render('settings/users', { title: 'Người dùng & phân quyền', users: users.map((u) => ({ ...u, admin: isAdminUser(u) })), query: req.query, departments: db.all('SELECT * FROM departments WHERE active = 1 ORDER BY name') });
  });

  r.get('/nguoi-dung/:id', need('admin.permissions'), (req, res) => {
    const u = db.one(
      `SELECT u.*, d.name AS department_name, p.name AS position_name FROM users u
         LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN positions p ON p.id = u.position_id WHERE u.id = ?`,
      Number(req.params.id),
    );
    if (!u) return forbidden(res, 'Không tìm thấy người dùng');
    const members = memberFactoryIds(db, u.id);
    const assigned = db.all(
      `SELECT ur.*, r.name AS role_name, r.permissions, f.name AS factory_name FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id LEFT JOIN factories f ON f.id = ur.factory_id WHERE ur.user_id = ? ORDER BY r.name`,
      u.id,
    ).map((a) => ({ ...a, stale: a.factory_id != null && isPlantRole(a.permissions) && !members.has(a.factory_id) }));
    res.render('settings/user', {
      title: u.full_name, u: { ...u, admin: isAdminUser(u) }, assigned, PERMISSIONS, members,
      units: db.all(
        `SELECT d.name, ud.role, ud.member, f.name AS factory_name FROM user_departments ud JOIN departments d ON d.id = ud.department_id
           LEFT JOIN factories f ON f.id = d.factory_id AND f.active = 1 WHERE ud.user_id = ? ORDER BY ud.member DESC, d.name`,
        u.id,
      ),
      roles: db.all('SELECT * FROM roles ORDER BY name').map((x) => ({ ...x, plant: isPlantRole(x.permissions) })),
      factories: db.all('SELECT * FROM factories WHERE active = 1 ORDER BY sort'),
    });
  });

  r.post('/nguoi-dung/:id/gan', need('admin.permissions'), (req, res) => {
    const uid = Number(req.params.id);
    const roleId = Number(req.body.role_id);
    const role = db.one('SELECT * FROM roles WHERE id = ?', roleId);
    if (!role) throw new AppError('Chọn nhóm quyền');
    const factories = [].concat(req.body.factory_ids || []).filter(Boolean).map(Number);
    // Thủ kho, GĐ nhà máy, người tổng hợp... gán theo kho thì chỉ cho người thuộc đơn vị SSO của kho đó
    if (factories.length && isPlantRole(role.permissions)) {
      const members = memberFactoryIds(db, uid);
      const outside = factories.filter((f) => !members.has(f)).map((f) => db.one('SELECT name FROM factories WHERE id = ?', f)?.name).filter(Boolean);
      if (outside.length) {
        throw new AppError(`Nhóm quyền "${role.name}" gồm quyền vận hành kho nên chỉ gán theo kho cho người thuộc đơn vị của kho đó trên SSO. Người này không thuộc: ${outside.join(', ')}.`);
      }
    }
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
