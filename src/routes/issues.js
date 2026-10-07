'use strict';
const express = require('express');
const svc = require('../services/issues');
const { issueWorkbook } = require('../exports/excel');
const { toArray } = require('../services/util');
const { factoriesFor, allFactories, sendWorkbook, forbidden } = require('./common');

module.exports = (db) => {
  const r = express.Router();

  /** Lưu xong thì trình luôn (nếu chọn); trình lỗi thì vẫn giữ bản nháp và báo lý do. */
  const saveThen = (req, res, id, okMsg) => {
    if (req.body.then === 'submit') {
      try {
        svc.act(db, req.user, req.access, id, 'submit', {});
        res.flash('success', `${okMsg} và trình duyệt`);
      } catch (err) {
        if (!err.status || err.status >= 500) throw err;
        res.flash('warning', `Đã lưu nhưng chưa trình được: ${err.message}`);
      }
    } else res.flash('success', okMsg);
    res.redirect(`/xuat-kho/${id}`);
  };

  const load = (req, res) => {
    const row = svc.get(db, Number(req.params.id));
    if (!row) {
      res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy phiếu xuất kho' });
      return null;
    }
    if (!svc.canView(req.access, req.user, row)) {
      forbidden(res, 'Bạn không có quyền xem phiếu này.');
      return null;
    }
    return row;
  };

  r.get('/', (req, res) => {
    const data = svc.list(db, req.access, req.user, { status: req.query.status, factoryId: req.query.factory_id, q: req.query.q, page: req.query.page });
    res.render('issues/list', {
      title: 'Phiếu xuất kho', ...data, query: req.query, STATUS: svc.STATUS,
      factories: allFactories(db), canCreate: factoriesFor(db, req.access, 'issue.create').length > 0,
    });
  });

  r.get('/moi', (req, res) => {
    const factories = factoriesFor(db, req.access, 'issue.create');
    if (!factories.length) return forbidden(res, 'Bạn chưa được phân quyền lập phiếu xuất kho.');
    const f = factories.find((x) => x.id === Number(req.query.factory_id)) || factories.find((x) => x.id === req.user.home_factory_id) || factories[0];
    res.render('issues/form', {
      title: 'Lập phiếu xuất kho', factories,
      row: { factory_id: f.id, issue_date: new Date().toISOString().slice(0, 10), location: f.address || '' }, items: [],
    });
  });

  /** Lỗi nhập liệu: hiển thị lại form với dữ liệu vừa nhập (kèm thông tin vật tư đã chọn). */
  const keepForm = (req, res, err, row, title, factories) => {
    if (!err.status || err.status >= 500) throw err;
    const fid = Number(row.factory_id || req.body.factory_id);
    const items = toArray(req.body.items).map((it) => {
      const m = it.material_id
        ? db.one(
          `SELECT m.code, m.name, m.unit, (SELECT quantity FROM stock s WHERE s.material_id = m.id AND s.factory_id = ?) AS stock_qty
             FROM materials m WHERE m.id = ?`,
          fid, Number(it.material_id),
        )
        : null;
      return { ...it, ...(m || {}) };
    });
    res.status(err.status).render('issues/form', { title, factories, row: { ...row, ...req.body }, items, error: err.message });
  };

  r.post('/moi', (req, res) => {
    let id;
    try {
      id = svc.create(db, req.user, req.access, req.body);
    } catch (err) {
      return keepForm(req, res, err, {}, 'Lập phiếu xuất kho', factoriesFor(db, req.access, 'issue.create'));
    }
    saveThen(req, res, id, 'Đã lưu phiếu');
  });

  r.get('/:id', (req, res) => {
    const row = load(req, res);
    if (!row) return;
    res.render('issues/detail', {
      title: `Phiếu xuất ${row.number || 'nháp'}`, row, items: svc.items(db, row.id), history: svc.history(db, row.id),
      acts: svc.availableActions(req.access, req.user, row), STATUS: svc.STATUS, ACTION_LABEL: svc.ACTION_LABEL,
    });
  });

  r.get('/:id/sua', (req, res) => {
    const row = load(req, res);
    if (!row) return;
    if (!svc.availableActions(req.access, req.user, row).has('edit')) return forbidden(res, 'Phiếu không ở trạng thái cho phép sửa.');
    res.render('issues/form', { title: `Sửa phiếu xuất ${row.number || 'nháp'}`, row, items: svc.items(db, row.id), factories: allFactories(db).filter((f) => f.id === row.factory_id) });
  });

  r.post('/:id/sua', (req, res) => {
    const id = Number(req.params.id);
    try {
      svc.update(db, req.user, req.access, id, req.body);
    } catch (err) {
      const row = svc.get(db, id);
      if (!row) throw err;
      return keepForm(req, res, err, row, `Sửa phiếu xuất ${row.number || 'nháp'}`, allFactories(db).filter((f) => f.id === row.factory_id));
    }
    saveThen(req, res, id, 'Đã lưu phiếu');
  });

  r.post('/:id/thao-tac/:action', (req, res) => {
    const id = Number(req.params.id);
    svc.act(db, req.user, req.access, id, req.params.action, req.body);
    res.flash('success', `Đã thực hiện: ${svc.ACTION_LABEL[req.params.action] || req.params.action}`);
    res.redirect(`/xuat-kho/${id}`);
  });

  r.get('/:id/excel', async (req, res) => {
    const row = load(req, res);
    if (!row) return;
    if (row.status === 'DA_HUY') return forbidden(res, 'Phiếu đã hủy, không tải được phiếu BM.06.');
    const wb = await issueWorkbook(db, row, svc.items(db, row.id));
    await sendWorkbook(res, wb, `Phieu-xuat-kho-${row.number || row.id}.xlsx`);
  });

  return r;
};
