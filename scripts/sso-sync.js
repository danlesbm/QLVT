'use strict';
const config = require('../src/config');
const db = require('../src/db').open(config.dbFile);
const { runSync } = require('../src/sso');

runSync(db)
  .then((r) => {
    console.log(`Đồng bộ SSO xong: ${r.departments} phòng ban / nhà máy, ${r.positions} chức vụ, ${r.users} CBCNV.`);
    for (const l of r.linked) console.log(`Gắn kho với đơn vị SSO: ${l}`);
    for (const w of r.warnings) console.warn(w);
  })
  .catch((err) => {
    console.error('Đồng bộ SSO thất bại:', err.message);
    process.exitCode = 1;
  });
