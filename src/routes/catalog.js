'use strict';
const express = require('express');
const materials = require('../services/materials');
const { can } = require('../auth/access');
const { requirePerm } = require('../auth/session');
const { allFactories, forbidden } = require('./common');

module.exports = (db) => {
  const r = express.Router();
  r.use(requirePerm('catalog.view'));

  /** Phạm vi người dùng được đánh mã: null = chung, id = nhà máy. */
  const codeScopes = (access) => {
    const out = [];
    if (can(access, 'catalog.code_company')) out.push({ id: '', name: 'Mã chung toàn công ty' });
    for (const f of allFactories(db)) if (materials.canCode(access, f.id)) out.push({ id: f.id, name: `Mã riêng ${f.name}` });
    return out;
  };

  r.get('/', (req, res) => {
    const data = materials.list(db, req.access, { q: req.query.q, scope: req.query.scope, groupCode: req.query.group, page: req.query.page });
    for (const m of data.rows) m.editable = materials.canCode(req.access, m.factory_id);
    res.render('catalog/list', {
      title: 'Danh mục mã vật tư',
      ...data,
      query: req.query,
      factories: allFactories(db),
      groups: materials.groups(db),
      canCode: codeScopes(req.access).length > 0,
      canGroups: can(req.access, 'catalog.code_company'),
    });
  });

  const form = (req, res, row) => {
    const scopes = codeScopes(req.access);
    if (!scopes.length) return forbidden(res, 'Bạn chưa được phân quyền đánh mã vật tư.');
    if (row && !materials.canCode(req.access, row.factory_id)) return forbidden(res, 'Bạn không có quyền sửa mã vật tư này.');
    res.render('catalog/form', { title: row ? `Sửa mã ${row.code}` : 'Thêm mã vật tư', row, scopes, groups: materials.groups(db), back: req.query.back });
  };
  r.get('/moi', (req, res) => form(req, res, null));
  r.get('/:id/sua', (req, res) => {
    const row = db.one('SELECT * FROM materials WHERE id = ?', Number(req.params.id));
    if (!row) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy mã vật tư' });
    form(req, res, row);
  });

  r.post('/luu', (req, res) => {
    const id = materials.save(db, req.user, req.access, req.body);
    res.flash('success', 'Đã lưu mã vật tư');
    const back = req.body.back;
    if (back === 'kho') return res.redirect(`/kho/them?material_id=${id}`);
    res.redirect(`/ma-vat-tu?q=${encodeURIComponent(req.body.code)}`);
  });

  r.post('/nhom', (req, res) => {
    materials.saveGroup(db, req.access, req.body);
    res.flash('success', 'Đã lưu nhóm mã');
    res.redirect('/ma-vat-tu');
  });

  return r;
};
