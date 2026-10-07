'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { can } = require('../auth/access');

/** Nhà máy người dùng có quyền perm. */
function factoriesFor(db, access, perm) {
  return db.all('SELECT * FROM factories WHERE active = 1 ORDER BY sort, name').filter((f) => can(access, perm, f.id));
}

function allFactories(db) {
  return db.all('SELECT * FROM factories WHERE active = 1 ORDER BY sort, name');
}

fs.mkdirSync(config.uploadDir, { recursive: true });
/** Tải tệp đính kèm (báo giá, tờ trình) tối đa 20MB. */
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});
// multer giải mã tên tệp theo latin1; chuyển lại UTF-8 để giữ tiếng Việt
function fixName(file) {
  if (file) file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  return file;
}

const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

async function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  await wb.xlsx.write(res);
  res.end();
}

function forbidden(res, message = 'Bạn không có quyền truy cập chức năng này.') {
  return res.status(403).render('error', { title: 'Không có quyền', message });
}

module.exports = { factoriesFor, allFactories, upload, fixName, memoryUpload, sendWorkbook, forbidden };
