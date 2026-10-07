'use strict';
const express = require('express');
const stock = require('../services/stock');
const imp = require('../services/import-tonkho');
const { stockWorkbook } = require('../exports/excel');
const { can } = require('../auth/access');
const { requirePerm } = require('../auth/session');
const { factoriesFor, memoryUpload, sendWorkbook, forbidden } = require('./common');

module.exports = (db) => {
  const r = express.Router();

  r.get('/', requirePerm('stock.view'), (req, res) => {
    const { factory_id: factoryId, q, page, ton } = req.query;
    const data = stock.list(db, req.access, { factoryId, q, page, onlyInStock: ton === '1' });
    res.render('stock/list', {
      title: 'Tồn kho vật tư',
      ...data,
      query: req.query,
      factories: factoriesFor(db, req.access, 'stock.view'),
      editable: factoriesFor(db, req.access, 'stock.edit'),
    });
  });

  r.get('/xuat-excel', requirePerm('stock.view'), async (req, res) => {
    const { factory_id: factoryId, q, ton } = req.query;
    const data = stock.list(db, req.access, { factoryId, q, onlyInStock: ton === '1', pageSize: 100000 });
    const f = factoryId ? db.one('SELECT name FROM factories WHERE id = ?', factoryId) : null;
    const title = `BÁO CÁO TỒN KHO ${f ? '- ' + f.name.toUpperCase() : 'CÁC NHÀ MÁY'} (ngày ${new Date().toLocaleDateString('vi-VN')})`;
    await sendWorkbook(res, await stockWorkbook(db, data.rows, title), `ton-kho-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  r.get('/them', (req, res) => {
    const editable = factoriesFor(db, req.access, 'stock.edit');
    if (!editable.length) return forbidden(res);
    let row = null;
    if (req.query.id) {
      row = db.one(
        `SELECT s.*, m.code, m.name, m.unit FROM stock s JOIN materials m ON m.id = s.material_id WHERE s.id = ?`,
        Number(req.query.id),
      );
      if (!row || !can(req.access, 'stock.edit', row.factory_id)) return forbidden(res);
    }
    const preMaterial = !row && req.query.material_id ? db.one('SELECT id, code, name, unit FROM materials WHERE id = ?', Number(req.query.material_id)) : null;
    res.render('stock/form', { title: row ? 'Cập nhật vật tư trong kho' : 'Nhập thêm vật tư vào kho', row, preMaterial, editable, query: req.query });
  });

  r.post('/luu', (req, res) => {
    stock.save(db, req.user, req.access, req.body);
    res.flash('success', 'Đã lưu vật tư trong kho');
    res.redirect(`/kho?factory_id=${req.body.factory_id}`);
  });

  r.get('/import', requirePerm('stock.import'), (req, res) => {
    res.render('stock/import', { title: 'Import tồn kho từ Excel', result: null });
  });

  r.post('/import', requirePerm('stock.import'), memoryUpload.single('file'), async (req, res) => {
    if (!req.file) {
      res.flash('danger', 'Chưa chọn file Excel');
      return res.redirect('/kho/import');
    }
    const rows = await imp.parse(req.file.buffer);
    const result = imp.apply(db, req.user, rows);
    res.render('stock/import', { title: 'Import tồn kho từ Excel', result: { ...result, total: rows.length } });
  });

  r.get('/:id', requirePerm('stock.view'), (req, res) => {
    const row = db.one(
      `SELECT s.*, m.code, m.name, m.spec, m.manufacturer, m.unit, f.name AS factory_name
         FROM stock s JOIN materials m ON m.id = s.material_id JOIN factories f ON f.id = s.factory_id WHERE s.id = ?`,
      Number(req.params.id),
    );
    if (!row || !can(req.access, 'stock.view', row.factory_id)) return forbidden(res);
    res.render('stock/detail', { title: `${row.code} - ${row.name}`, row, moves: stock.movements(db, row.id) });
  });

  return r;
};
