'use strict';
const express = require('express');
const config = require('../config');
const { getProvider } = require('../sso');
const { upsertUser } = require('../sso/sync');
const { createSession, destroySession } = require('../auth/session');

const { safeNext } = require('../services/util');

module.exports = (db) => {
  const r = express.Router();

  r.get('/login', async (req, res) => {
    if (req.user) return res.redirect('/');
    let people = [];
    if (config.sso.mode === 'mock') {
      const dir = await getProvider().fetchDirectory();
      const deps = Object.fromEntries(dir.departments.map((d) => [d.id, d.name]));
      const pos = Object.fromEntries(dir.positions.map((p) => [p.id, p.name]));
      people = dir.employees.map((e) => ({ ...e, department: deps[e.department_id], position: pos[e.position_id] }));
    }
    res.render('login', { title: 'Đăng nhập', people, next: safeNext(req.query.next), error: req.query.error });
  });

  r.get('/auth/sso', (req, res) => getProvider().loginStart(req, res));

  async function finish(req, res) {
    try {
      const profile = await getProvider().callback(req, res);
      const user = upsertUser(db, profile, new Date().toISOString(), config.adminSsoIds);
      createSession(db, res, user.id);
      res.redirect(safeNext(profile.next || req.body?.next));
    } catch (err) {
      res.redirect(`/login?error=${encodeURIComponent(err.message)}`);
    }
  }
  r.get('/auth/callback', finish);
  r.post('/login', (req, res) => (config.sso.mode === 'mock' ? finish(req, res) : res.status(405).end()));

  r.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.redirect(getProvider().logoutUrl());
  });

  return r;
};
