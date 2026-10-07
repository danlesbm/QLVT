'use strict';
const config = require('./config');

// SSO giả lập cho phép chọn bất kỳ ai để đăng nhập: không chạy ở môi trường thật nếu chưa cấu hình SSO Portal
if (config.sso.mode === 'mock' && process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_SSO !== '1') {
  console.error('[SSO] Đang chạy production nhưng chưa cấu hình SSO Portal (SSO_BASE_URL, SSO_INTERNAL_API_SECRET). Dừng để tránh đăng nhập giả lập.');
  process.exit(1);
}

const db = require('./db').open(config.dbFile);
const { createApp } = require('./app');
const { runSync } = require('./sso');

const app = createApp(db);

async function sync() {
  try {
    const r = await runSync(db);
    console.log(`[SSO] Đồng bộ ${r.users} CBCNV, ${r.departments} phòng ban / nhà máy, ${r.positions} chức vụ`);
    for (const l of r.linked) console.log(`[SSO] Gắn kho với đơn vị SSO: ${l}`);
    for (const w of r.warnings) console.warn(`[SSO] ${w}`);
  } catch (err) {
    console.error('[SSO] Đồng bộ thất bại:', err.message);
  }
}

sync();
if (config.sso.syncMinutes > 0) setInterval(sync, config.sso.syncMinutes * 60 * 1000).unref();

app.listen(config.port, () => {
  console.log(`QLVT đang chạy tại ${config.baseUrl} (SSO: ${config.sso.mode === 'portal' ? config.sso.baseUrl : 'giả lập'})`);
});
