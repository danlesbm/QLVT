'use strict';
const express = require('express');
const requests = require('../services/requests');
const issues = require('../services/issues');

module.exports = (db) => {
  const r = express.Router();
  r.get('/', (req, res) => {
    const reqTodo = requests.todo(db, req.access, req.user);
    const issueTodo = issues.todo(db, req.access, req.user);
    const counts = Object.fromEntries(
      db.all(`SELECT status, COUNT(*) n FROM requests WHERE status <> 'NHAP' GROUP BY status`).map((x) => [x.status, x.n]),
    );
    const stats = {
      materials: db.one('SELECT COUNT(*) n FROM materials WHERE active = 1').n,
      stockRows: db.one('SELECT COUNT(*) n FROM stock WHERE quantity > 0').n,
      inProgress: db.one(`SELECT COUNT(*) n FROM requests WHERE status NOT IN ('NHAP','HOAN_THANH','DA_HUY')`).n,
      issuesPending: db.one(`SELECT COUNT(*) n FROM issues WHERE status = 'CHO_DUYET'`).n,
    };
    const factories = db.all(
      `SELECT f.*, (SELECT COUNT(*) FROM stock s WHERE s.factory_id = f.id AND s.quantity > 0) AS items,
              (SELECT COUNT(*) FROM requests q WHERE q.factory_id = f.id AND q.status NOT IN ('NHAP','HOAN_THANH','DA_HUY')) AS open_requests
         FROM factories f WHERE f.active = 1 ORDER BY f.sort`,
    );
    res.render('home', { title: 'Tổng quan', reqTodo, issueTodo, counts, stats, factories, RS: requests.STATUS, IS: issues.STATUS });
  });
  return r;
};
