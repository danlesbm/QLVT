'use strict';
const config = require('./config');
const db = require('./db').open(config.dbFile);
const { createApp } = require('./app');
const { runSync } = require('./sso');

const app = createApp(db);

async function sync() {
  try {
    const r = await runSync(db);
    console.log(`[SSO] Đồng bộ ${r.employees} CBCNV, ${r.departments} bộ phận, ${r.positions} chức vụ`);
    for (const w of r.warnings) console.warn(`[SSO] ${w}`);
  } catch (err) {
    console.error('[SSO] Đồng bộ thất bại:', err.message);
  }
}

sync();
if (config.sso.syncMinutes > 0) setInterval(sync, config.sso.syncMinutes * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`QLVT đang chạy tại ${config.baseUrl} (SSO: ${config.sso.mode})`);
});
