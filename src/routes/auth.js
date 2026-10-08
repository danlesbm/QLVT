'use strict';
const express = require('express');
const config = require('../config');
const { getProvider, runSync } = require('../sso');
const { upsertUser } = require('../sso/sync');
const { cleanName } = require('../sso/names');
const { createSession, destroySession } = require('../auth/session');
const { safeNext } = require('../services/util');

const NEXT_COOKIE = 'qlvt_next';

module.exports = (db) => {
  const r = express.Router();
  const cookieOpts = { httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure };
  const userOpts = { adminSsoIds: config.adminSsoIds, bootstrapEmails: config.bootstrapEmails };

  const renderLogin = (req, res, status, error) => {
    const people = config.sso.mode === 'mock' ? getProvider().people() : [];
    res.status(status).render('login', {
      title: 'Đăng nhập', people, next: safeNext(req.query.next), error, portalUrl: config.sso.portalUrl, loggedOut: req.query.da_thoat === '1',
    });
  };

  // Người mới đăng nhập lần đầu: đồng bộ danh bạ để có ngay đơn vị / chức vụ (không chờ lượt đồng bộ định kỳ)
  let syncing = null;
  const syncSoon = () => {
    syncing ??= runSync(db).catch((err) => console.error('[SSO] Đồng bộ thất bại:', err.message)).finally(() => (syncing = null));
  };

  // SSO Portal mở app kèm ?token=...: xác thực với SSO, tạo phiên QLVT rồi bỏ token khỏi địa chỉ
  r.use(async (req, res, next) => {
    if (config.sso.mode !== 'portal' || req.method !== 'GET' || !req.query.token) return next();
    const url = new URL(req.originalUrl, 'http://qlvt.local');
    url.searchParams.delete('token');
    url.searchParams.delete('parent');
    let target = safeNext(url.pathname + url.search);
    try {
      const p = await getProvider().introspect(String(req.query.token));
      const existing = db.one('SELECT id FROM users WHERE sso_id = ?', p.id);
      // Tên trên SSO kèm chức danh: tách theo chức vụ đã đồng bộ (giống lúc đồng bộ danh bạ)
      const roles = existing ? db.all('SELECT DISTINCT role FROM user_departments WHERE user_id = ?', existing.id).map((x) => x.role).join(', ') : '';
      const user = db.tx(() => upsertUser(db, { ...p, full_name: cleanName(p.raw_name, roles) }, { ...userOpts, ssoAdmin: p.ssoAdmin }));
      // Mở app bằng token mới (có thể là người khác): bỏ phiên cũ trên trình duyệt này
      if (req.cookies.qlvt_sid) db.run('DELETE FROM sessions WHERE id = ?', req.cookies.qlvt_sid);
      createSession(db, res, user.id);
      if (!existing) syncSoon();
      if (target === '/' && req.cookies[NEXT_COOKIE]) target = safeNext(req.cookies[NEXT_COOKIE]);
      res.clearCookie(NEXT_COOKIE, cookieOpts);
      return res.redirect(target);
    } catch (err) {
      return renderLogin(req, res, 401, err.message);
    }
  });

  r.get('/login', (req, res) => {
    if (req.user) return res.redirect(safeNext(req.query.next));
    // Mở trang cần đăng nhập khi chưa có phiên: nhớ trang đó, đăng nhập qua SSO Portal xong sẽ quay lại
    const next = safeNext(req.query.next);
    if (config.sso.mode === 'portal' && next !== '/') res.cookie(NEXT_COOKIE, next, { ...cookieOpts, maxAge: 15 * 60 * 1000 });
    renderLogin(req, res, 200, req.query.error);
  });

  // SSO giả lập: chọn người trong danh bạ mẫu
  r.post('/login', (req, res) => {
    if (config.sso.mode !== 'mock') return res.status(405).end();
    try {
      const user = db.tx(() => upsertUser(db, getProvider().profile(req.body.sso_id), { ...userOpts, memberships: true }));
      createSession(db, res, user.id);
      res.redirect(safeNext(req.body?.next));
    } catch (err) {
      res.redirect(`/login?error=${encodeURIComponent(err.message)}`);
    }
  });

  r.post('/logout', (req, res) => {
    destroySession(db, req, res);
    res.redirect('/login?da_thoat=1');
  });

  return r;
};
