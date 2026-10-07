'use strict';
const crypto = require('node:crypto');
const config = require('../config');
const { loadAccess, can } = require('./access');

const COOKIE = 'qlvt_sid';

function parseCookies(req, _res, next) {
  req.cookies = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* bỏ qua cookie lỗi */
    }
  }
  next();
}

function createSession(db, res, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(16).toString('hex');
  const expires = new Date(Date.now() + config.sessionHours * 3600 * 1000);
  db.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  db.run('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)', id, userId, csrf, expires.toISOString());
  db.run(`UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?`, userId);
  res.cookie(COOKIE, id, { httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure, expires });
}

function destroySession(db, req, res) {
  if (req.cookies[COOKIE]) db.run('DELETE FROM sessions WHERE id = ?', req.cookies[COOKIE]);
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
}

/** Gắn req.user, req.access, res.locals cho view. */
function sessionMiddleware(db) {
  return (req, res, next) => {
    const sid = req.cookies[COOKIE];
    if (sid) {
      const s = db.one('SELECT * FROM sessions WHERE id = ? AND expires_at > ?', sid, new Date().toISOString());
      const user = s && db.one(
        `SELECT u.*, d.name AS department_name, d.factory_id AS home_factory_id, p.name AS position_name
           FROM users u LEFT JOIN departments d ON d.id = u.department_id LEFT JOIN positions p ON p.id = u.position_id
          WHERE u.id = ? AND u.active = 1`,
        s.user_id,
      );
      if (user) {
        req.user = user;
        req.csrf = s.csrf;
        req.access = loadAccess(db, user);
      }
    }
    res.locals.user = req.user || null;
    res.locals.isAdmin = !!req.access?.isAdmin;
    res.locals.csrf = req.csrf || '';
    res.locals.can = (perm, factoryId) => can(req.access, perm, factoryId);
    next();
  };
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.method === 'GET') return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.status(401).send('Phiên đăng nhập đã hết hạn');
}

/** Chặn POST không có mã CSRF hợp lệ. */
function csrfCheck(req, res, next) {
  if (req.method !== 'POST' || !req.user) return next();
  const token = req.body?._csrf || req.query._csrf || req.get('x-csrf-token');
  if (token && token === req.csrf) return next();
  res.status(403).render('error', { title: 'Lỗi bảo mật', message: 'Mã bảo mật của biểu mẫu không hợp lệ, vui lòng tải lại trang.' });
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (can(req.access, perm)) return next();
    res.status(403).render('error', { title: 'Không có quyền', message: 'Bạn không có quyền truy cập chức năng này.' });
  };
}

module.exports = { parseCookies, createSession, destroySession, sessionMiddleware, requireLogin, csrfCheck, requirePerm, COOKIE };
