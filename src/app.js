'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { parseCookies, sessionMiddleware, requireLogin, csrfCheck } = require('./auth/session');
const view = require('./views/helpers');

function createApp(db) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.locals.h = view;

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1d' }));
  app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist'), { maxAge: '7d' }));
  app.use('/vendor/icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'font'), { maxAge: '7d' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 20000 }));
  app.use(express.json());
  app.use(parseCookies);
  app.use(sessionMiddleware(db));
  app.use((req, res, next) => {
    res.locals.path = req.originalUrl.split("?")[0];
    res.locals.flash = req.cookies.qlvt_flash ? JSON.parse(req.cookies.qlvt_flash) : null;
    if (res.locals.flash) res.clearCookie('qlvt_flash');
    res.locals.ssoMode = config.sso.mode;
    res.flash = (type, message) => res.cookie('qlvt_flash', JSON.stringify({ type, message }), { httpOnly: true, sameSite: 'lax' });
    next();
  });
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
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Đã có lỗi hệ thống, vui lòng thử lại hoặc báo quản trị.' : err.message;
    // Lỗi nghiệp vụ trên form: quay lại trang trước kèm thông báo
    if (req.method === 'POST' && status < 500 && req.get('referer')) {
      res.flash('danger', message);
      return res.redirect(req.get('referer'));
    }
    res.status(status).render('error', { title: 'Lỗi', message });
  });
  return app;
}

module.exports = { createApp };
