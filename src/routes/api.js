'use strict';
const express = require('express');
const materials = require('../services/materials');

module.exports = (db) => {
  const r = express.Router();
  // Gợi ý vật tư khi lập phiếu: mã chung + mã riêng của nhà máy, kèm tồn kho tại nhà máy
  r.get('/materials', (req, res) => {
    res.json(materials.search(db, String(req.query.q || ''), Number(req.query.factory_id) || null));
  });
  r.get('/materials/suggest-code', (req, res) => {
    res.json({ code: materials.suggestCode(db, req.query.prefix) });
  });
  return r;
};
