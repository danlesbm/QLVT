'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const crypto = require('node:crypto');
const { parseCookies, sessionMiddleware, requireLogin, csrfCheck } = require('./auth/session');
const { runSync } = require('./sso');
const view = require('./views/helpers');
const { safeNext } = require('./services/util');

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.locals.h = view;

  // Cho phép SSO Portal nhúng app trong iframe; chặn trình duyệt đoán sai loại nội dung
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': `frame-ancestors ${config.frameAncestors}` });
    next();
  });
  app.get('/health', (req, res) => {
    try {
      db.one('SELECT 1');
      res.json({ ok: true, service: 'qlvt' });
    } catch (err) {
      res.status(503).json({ ok: false, error: err.message });
    }
  });
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'font'), { maxAge: '7d' }));
  // Tham số truy vấn phẳng: khóa lặp lại lấy giá trị cuối (tránh mảng lọt vào câu SQL)
  app.set('query parser', (qs) => Object.fromEntries(new URLSearchParams(qs)));
  app.use(parseCookies);
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.flash = null;
    if (req.cookies.qlvt_flash) {
      try {
        res.locals.flash = JSON.parse(req.cookies.qlvt_flash);
      } catch {
        /* cookie hỏng: bỏ qua */
      }
      res.clearCookie('qlvt_flash', { httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    }
    res.locals.ssoMode = config.sso.mode;
    res.locals.isAdmin = false;
    res.flash = (type, message) => res.cookie('qlvt_flash', JSON.stringify({ type, message }), { httpOnly: true, sameSite: config.cookieSameSite, secure: config.cookieSecure });
    next();
  });
  app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 20000 }));
  app.use(express.json());
  // SSO gọi khi danh bạ thay đổi (header X-Internal-Secret = SSO_INTERNAL_API_SECRET), giống Payroll
  app.post('/api/internal/sync', async (req, res) => {
    const expected = Buffer.from(config.sso.internalSecret || '');
    const got = Buffer.from(String(req.get('x-internal-secret') || ''));
    if (!expected.length || got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return res.status(401).json({ ok: false, error: 'Sai secret nội bộ' });
    try {
      res.json({ ok: true, ...(await runSync(db)) });
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });
  app.use(sessionMiddleware(db));
  app.use(csrfCheck);

  app.use(require('./routes/auth')(db));
  app.use(requireLogin);
  app.use(require('./routes/home')(db));
  app.use('/kho', require('./routes/stock')(db));
  app.use('/ma-vat-tu', require('./routes/catalog')(db));
  app.use('/de-xuat', require('./routes/requests')(db));
  app.use('/xuat-kho', require('./routes/issues')(db));
  app.use('/cai-dat', require('./routes/settings')(db));
  app.use('/api', require('./routes/api')(db));

  app.use((req, res) => res.status(404).render('error', { title: 'Không tìm thấy', message: 'Trang bạn tìm không tồn tại.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.name === 'MulterError') {
      err.status = 400;
      err.message = err.code === 'LIMIT_FILE_SIZE' ? 'Tệp đính kèm vượt quá 20MB' : 'Tệp đính kèm không hợp lệ';
    }
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Đã có lỗi hệ thống, vui lòng thử lại hoặc báo quản trị.' : err.expose === false ? 'Yêu cầu không hợp lệ' : err.message;
    // Lỗi nghiệp vụ trên form: quay lại trang trước (cùng trang web) kèm thông báo
    const back = sameOriginPath(req);
    if (req.method === 'POST' && status < 500 && back) {
      res.flash('danger', message);
      return res.redirect(back);
    }
    res.status(status).render('error', { title: 'Lỗi', message });
  });
  return app;
}

/** Đường dẫn của trang trước nếu cùng máy chủ (không chuyển hướng ra trang ngoài). */
function sameOriginPath(req) {
  const ref = req.get('referer');
  if (!ref) return null;
  try {
    const u = new URL(ref);
    // Sau reverse proxy, Host có thể là địa chỉ nội bộ: chấp nhận cả X-Forwarded-Host (đã bật trust proxy)
    const hosts = [req.get('host'), ...String(req.get('x-forwarded-host') || '').split(',').map((h) => h.trim())].filter(Boolean);
    if (!hosts.includes(u.host)) return null;
    const p = safeNext(u.pathname + u.search);
    return p === '/' && u.pathname !== '/' ? null : p;
  } catch {
    return null;
  }
}

module.exports = { createApp };
