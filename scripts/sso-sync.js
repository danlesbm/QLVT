'use strict';
const config = require('../src/config');
const db = require('../src/db').open(config.dbFile);
const { runSync } = require('../src/sso');

runSync(db).then((r) => {
  console.log(`Đồng bộ SSO xong: ${r.departments} bộ phận, ${r.positions} chức vụ, ${r.employees} CBCNV.`);
  for (const w of r.warnings) console.warn(w);
});
