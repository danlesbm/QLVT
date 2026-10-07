'use strict';
// Dùng: npm run import:tonkho -- duong-dan/ton-kho.xlsx
const fs = require('node:fs');
const config = require('../src/config');
const db = require('../src/db').open(config.dbFile);
const imp = require('../src/services/import-tonkho');

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error('Cách dùng: npm run import:tonkho -- <file.xlsx>');
    process.exit(1);
  }
  const rows = await imp.parse(fs.readFileSync(file));
  const res = imp.apply(db, null, rows);
  console.log(`Đọc ${rows.length} dòng. Tạo mới ${res.materials_created} mã vật tư, cập nhật ${res.stock_rows} dòng tồn kho.`);
  if (res.factories_created.length) console.log('Kho mới:', res.factories_created.join(', '));
  if (res.errors.length) console.log(res.errors.join('\n'));
})();
