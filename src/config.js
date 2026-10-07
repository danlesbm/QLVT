'use strict';
const path = require('node:path');

// Nạp biến môi trường từ file .env (nếu có) mà không cần thư viện ngoài.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* không có .env */
}

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  dbFile: env.DB_FILE || path.join(__dirname, '..', 'data', 'qlvt.db'),
  uploadDir: env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads'),
  sessionHours: Number(env.SESSION_HOURS || 12),
  cookieSecure: env.COOKIE_SECURE === '1',
  // SSO: "mock" (phát triển/demo) hoặc "oidc" (SSO thật của công ty)
  sso: {
    mode: env.SSO_MODE || 'mock',
    authorizeUrl: env.SSO_AUTHORIZE_URL,
    tokenUrl: env.SSO_TOKEN_URL,
    userinfoUrl: env.SSO_USERINFO_URL,
    logoutUrl: env.SSO_LOGOUT_URL,
    clientId: env.SSO_CLIENT_ID,
    clientSecret: env.SSO_CLIENT_SECRET,
    scope: env.SSO_SCOPE || 'openid profile email',
    redirectUri: env.SSO_REDIRECT_URI,
    claimId: env.SSO_CLAIM_ID || 'sub',
    directoryUrl: env.SSO_DIRECTORY_URL,
    directoryToken: env.SSO_DIRECTORY_TOKEN,
    syncMinutes: Number(env.SSO_SYNC_MINUTES || 60),
  },
  // Mã SSO của người dùng luôn là quản trị viên (để cấp quyền lần đầu)
  adminSsoIds: list(env.ADMIN_SSO_IDS ?? ((env.SSO_MODE || 'mock') === 'mock' ? 'nv900' : '')),
};
