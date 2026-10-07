'use strict';
// Sao lưu CSDL an toàn khi ứng dụng đang chạy: npm run backup [thư-mục-đích]
// CSDL chạy chế độ WAL nên KHÔNG chép trực tiếp file qlvt.db (dữ liệu mới có thể còn nằm trong qlvt.db-wal).
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

if (config.dbFile === ':memory:' || !fs.existsSync(config.dbFile)) {
  console.error(`Không tìm thấy CSDL tại ${config.dbFile}. Kiểm tra DB_FILE trong .env.`);
  process.exit(1);
}
const db = require('../src/db').open(config.dbFile);

// npm run chạy lệnh tại thư mục ứng dụng: đường dẫn tương đối tính theo thư mục người dùng đang đứng
const dir = process.argv[2] ? path.resolve(process.env.INIT_CWD || process.cwd(), process.argv[2]) : config.backupDir;
fs.mkdirSync(dir, { recursive: true });
// Tên tệp theo giờ địa phương của máy chủ, thêm số thứ tự nếu chạy 2 lần trong cùng một giây
const d = new Date();
const p2 = (x) => String(x).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
let dest = path.join(dir, `qlvt-${stamp}.db`);
for (let i = 2; fs.existsSync(dest); i++) dest = path.join(dir, `qlvt-${stamp}-${i}.db`);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();
console.log(`Đã sao lưu CSDL vào ${dest}. Nhớ sao lưu kèm thư mục tệp đính kèm: ${config.uploadDir}`);
