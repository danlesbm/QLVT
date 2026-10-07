'use strict';
const express = require('express');
const materials = require('../services/materials');
const { can } = require('../auth/access');

// Quyền liên quan tới việc chọn vật tư của một nhà máy (xem kho, lập phiếu đề xuất, lập phiếu xuất)
const FACTORY_PERMS = ['stock.view', 'stock.edit', 'request.create', 'issue.create'];

module.exports = (db) => {
  const r = express.Router();
  r.use((req, res, next) =>
    ['catalog.view', ...FACTORY_PERMS].some((p) => can(req.access, p)) ? next() : res.status(403).json([]));

  // Gợi ý vật tư khi lập phiếu: mã chung + mã riêng của nhà máy, kèm tồn kho tại nhà máy.
  // Chỉ trả mã riêng / tồn kho của nhà máy mà người dùng có quyền.
  r.get('/materials', (req, res) => {
    let fid = Number(req.query.factory_id) || null;
    if (fid && !FACTORY_PERMS.some((p) => can(req.access, p, fid))) fid = null;
    res.json(materials.search(db, String(req.query.q || ''), fid));
  });
  r.get('/materials/suggest-code', (req, res) => {
    res.json({ code: materials.suggestCode(db, req.query.prefix) });
  });
  return r;
};
