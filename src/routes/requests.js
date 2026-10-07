'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('../config');
const svc = require('../services/requests');
const { requestWorkbook } = require('../exports/excel');
const { usersWith } = require('../auth/access');
const { toArray } = require('../services/util');
const { factoriesFor, allFactories, upload, fixName, sendWorkbook, forbidden } = require('./common');

// Thao tác có tệp đính kèm
const FILE_ACTIONS = new Set(['quote_add', 'price_external']);

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
    res.redirect(`/de-xuat/${id}`);
  };

  const load = (req, res) => {
    const row = svc.get(db, Number(req.params.id));
    if (!row) {
      res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy phiếu đề xuất' });
      return null;
    }
    if (!svc.canView(db, req.access, req.user, row)) {
      forbidden(res, 'Bạn không có quyền xem phiếu này.');
      return null;
    }
    return row;
  };

  r.get('/', (req, res) => {
    const data = svc.list(db, req.access, req.user, {
      status: req.query.status, factoryId: req.query.factory_id, q: req.query.q, mine: req.query.mine === '1', page: req.query.page,
    });
    res.render('requests/list', {
      title: 'Phiếu đề xuất vật tư', ...data, query: req.query, STATUS: svc.STATUS,
      factories: allFactories(db), canCreate: factoriesFor(db, req.access, 'request.create').length > 0,
    });
  });

  r.get('/moi', (req, res) => {
    const factories = factoriesFor(db, req.access, 'request.create');
    if (!factories.length) return forbidden(res, 'Bạn chưa được phân quyền lập phiếu đề xuất.');
    const now = new Date();
    const factory = factories.find((f) => f.id === req.user.home_factory_id) || factories[0];
    const month = `${now.getMonth() + 1}/${now.getFullYear()}`;
    res.render('requests/form', {
      title: 'Lập phiếu đề xuất vật tư', row: {
        factory_id: factory.id,
        title: `Nhu cầu vật tư tháng ${month}`,
        basis: `Căn cứ vào công việc vận hành và sửa chữa thường xuyên. ${factory.name} lập nhu cầu sử dụng vật tư bổ sung tháng ${month} như bảng kê sau:`,
      }, items: [], factories, pktMode: false,
    });
  });

  /** Lỗi nhập liệu: hiển thị lại form với dữ liệu người dùng vừa nhập thay vì xóa trắng. */
  const keepForm = (req, res, err, row, opts) => {
    if (!err.status || err.status >= 500) throw err;
    res.status(err.status).render('requests/form', {
      ...opts,
      row: { ...row, ...req.body },
      items: toArray(req.body.items).map((it) => ({ ...it, material_code: it.material_id ? db.one('SELECT code FROM materials WHERE id = ?', Number(it.material_id))?.code : '' })),
      error: err.message,
    });
  };

  r.post('/moi', (req, res) => {
    let id;
    try {
      id = svc.create(db, req.user, req.access, req.body);
    } catch (err) {
      return keepForm(req, res, err, {}, { title: 'Lập phiếu đề xuất vật tư', factories: factoriesFor(db, req.access, 'request.create'), pktMode: false });
    }
    saveThen(req, res, id, 'Đã lưu phiếu');
  });

  r.get('/:id', (req, res) => {
    const row = load(req, res);
    if (!row) return;
    const acts = svc.availableActions(db, req.access, req.user, row);
    const items = svc.items(db, row.id);
    const { unsealed, quotes } = svc.visibleQuotes(db, row.id, req.user);
    const quoters = svc.quoters(db, row.id);
    const selectedLines = new Set(items.map((i) => i.selected_line_id).filter(Boolean));
    res.render('requests/detail', {
      title: `Phiếu ${row.number || 'nháp'}`,
      row, items, quotes, unsealed, quoters, acts, selectedLines,
      history: svc.history(db, row.id),
      STATUS: svc.STATUS, FLOW: svc.FLOW, ACTION_LABEL: svc.ACTION_LABEL, REJECT_TO: svc.REJECT_TO,
      reviewers: acts.has('pkt_assign') ? usersWith(db, 'request.pkt_review') : [],
      directors: acts.has('pkt_approve') || acts.has('comparison_submit') ? usersWith(db, 'request.approve_director') : [],
      staff: acts.has('assign_quoters') ? usersWith(db, 'purchase.staff') : [],
      defaultDirector: db.one('SELECT director_id FROM factories WHERE id = ?', row.factory_id)?.director_id,
      maxQuoters: Number(db.one(`SELECT value FROM settings WHERE key = 'max_quoters'`)?.value || 3),
      myQuoter: quoters.find((q) => q.user_id === req.user.id),
    });
  });

  r.get('/:id/sua', (req, res) => {
    const row = load(req, res);
    if (!row) return;
    const acts = svc.availableActions(db, req.access, req.user, row);
    const pktMode = ['CHO_PKT', 'CHO_TPKT'].includes(row.status) && acts.has('pkt_edit');
    if (!acts.has('edit') && !pktMode) return forbidden(res, 'Phiếu không ở trạng thái cho phép sửa.');
    res.render('requests/form', {
      title: `Sửa phiếu ${row.number || 'nháp'}`, row, items: svc.items(db, row.id),
      factories: allFactories(db).filter((f) => f.id === row.factory_id), pktMode,
    });
  });

  r.post('/:id/sua', (req, res) => {
    const id = Number(req.params.id);
    try {
      svc.update(db, req.user, req.access, id, req.body);
    } catch (err) {
      const row = svc.get(db, id);
      if (!row) throw err;
      const pktMode = ['CHO_PKT', 'CHO_TPKT'].includes(row.status);
      return keepForm(req, res, err, row, { title: `Sửa phiếu ${row.number || 'nháp'}`, factories: allFactories(db).filter((f) => f.id === row.factory_id), pktMode });
    }
    saveThen(req, res, id, 'Đã lưu phiếu');
  });

  // Kiểm tra quyền TRƯỚC khi nhận tệp tải lên, và chỉ nhận tệp cho thao tác cần tệp
  const guardAction = (req, res, next) => {
    const row = svc.get(db, Number(req.params.id));
    if (!row) return res.status(404).render('error', { title: 'Không tìm thấy', message: 'Không tìm thấy phiếu đề xuất' });
    if (!svc.availableActions(db, req.access, req.user, row).has(req.params.action)) {
      return forbidden(res, `Bạn không thể thực hiện "${svc.ACTION_LABEL[req.params.action] || req.params.action}" ở trạng thái hiện tại của phiếu.`);
    }
    if (FILE_ACTIONS.has(req.params.action)) return upload.single('file')(req, res, next);
    next();
  };

  r.post('/:id/thao-tac/:action', guardAction, (req, res) => {
    const id = Number(req.params.id);
    const file = fixName(req.file);
    try {
      svc.act(db, req.user, req.access, id, req.params.action, req.body, file);
    } catch (err) {
      if (file) fs.unlink(file.path, () => {});
      throw err;
    }
    res.flash('success', `Đã thực hiện: ${svc.ACTION_LABEL[req.params.action] || req.params.action}`);
    res.redirect(`/de-xuat/${id}`);
  });

  r.get('/:id/excel', async (req, res) => {
    const row = load(req, res);
    if (!row) return;
    if (!row.demand_approved_at || row.status === 'DA_HUY') return forbidden(res, 'Chỉ tải phiếu sau khi Giám đốc đã duyệt nhu cầu.');
    const wb = await requestWorkbook(db, row, svc.items(db, row.id));
    await sendWorkbook(res, wb, `Phieu-nhu-cau-${(row.number || row.id).toString().replace(/[/\\&]/g, '-')}.xlsx`);
  });

  // Tải tệp đính kèm: báo giá (chỉ khi người dùng được xem báo giá đó) hoặc tờ trình duyệt giá ngoài
  r.get('/:id/tep/:kind{/:fileId}', (req, res) => {
    const row = load(req, res);
    if (!row) return;
    let stored = null;
    let name = null;
    if (req.params.kind === 'bao-gia') {
      const q = svc.visibleQuotes(db, row.id, req.user).quotes.find((x) => x.id === Number(req.params.fileId));
      if (q) [stored, name] = [q.attachment, q.attachment_name];
    } else if (req.params.kind === 'to-trinh') {
      [stored, name] = [row.price_attachment, row.price_attachment_name];
    }
    if (!stored) return forbidden(res, 'Không tìm thấy tệp hoặc bạn chưa được xem tệp này.');
    res.download(path.join(config.uploadDir, path.basename(stored)), name || stored);
  });

  return r;
};
