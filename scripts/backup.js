'use strict';
// Sao lưu CSDL an toàn khi ứng dụng đang chạy: npm run backup [thư-mục-đích]
// CSDL chạy chế độ WAL nên KHÔNG chép trực tiếp file qlvt.db (dữ liệu mới có thể còn nằm trong qlvt.db-wal).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const db = require('../src/db').open(config.dbFile);

const dir = path.resolve(process.argv[2] || config.backupDir);
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const dest = path.join(dir, `qlvt-${stamp}.db`);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
console.log(`Đã sao lưu CSDL vào ${dest}. Nhớ sao lưu kèm thư mục tệp đính kèm: ${config.uploadDir}`);
