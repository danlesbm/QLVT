'use strict';
const path = require('node:path');

// Nạp biến môi trường từ file .env (nếu có) mà không cần thư viện ngoài.
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  /* không có .env */
}

const env = process.env;
const root = path.join(__dirname, '..');
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const ssoMode = env.SSO_MODE || (env.SSO_BASE_URL ? 'portal' : 'mock');
const sameSite = ['strict', 'none'].includes(String(env.COOKIE_SAMESITE).toLowerCase()) ? String(env.COOKIE_SAMESITE).toLowerCase() : 'lax';

module.exports = {
  port: Number(env.PORT || 3000),
  baseUrl: env.BASE_URL || `http://localhost:${env.PORT || 3000}`,
  // Đường dẫn tương đối tính từ thư mục ứng dụng (không phụ thuộc thư mục đang đứng khi chạy)
  dbFile: env.DB_FILE === ':memory:' ? ':memory:' : path.resolve(root, env.DB_FILE || 'data/qlvt.db'),
  uploadDir: path.resolve(root, env.UPLOAD_DIR || 'data/uploads'),
  backupDir: path.resolve(root, env.BACKUP_DIR || 'data/backup'),
  sessionHours: Number(env.SESSION_HOURS || 12),
  cookieSecure: env.COOKIE_SECURE === '1' || sameSite === 'none',
  // Lax: app nhúng trong SSO Portal cùng tên miền (*.sbm.com.vn). Nhúng từ tên miền khác thì đặt none (bắt buộc HTTPS).
  cookieSameSite: sameSite,
  // Các trang được phép nhúng app trong iframe (SSO Portal)
  frameAncestors: env.FRAME_ANCESTORS || "'self' https://*.sbm.com.vn",
  // SSO: "portal" (SSO Portal của công ty, giống Payroll) hoặc "mock" (danh bạ giả lập để phát triển/demo)
  sso: {
    mode: ssoMode,
    baseUrl: (env.SSO_BASE_URL || '').replace(/\/+$/, ''),
    // Trang SSO Portal để người dùng mở lại app (mặc định là SSO_BASE_URL)
    portalUrl: env.SSO_PORTAL_URL || env.SSO_BASE_URL || '',
    internalSecret: env.SSO_INTERNAL_API_SECRET || '',
    // Quản trị trên SSO (user.role = admin) là quản trị QLVT
    adminIsAdmin: env.SSO_ADMIN_IS_ADMIN !== 'false',
    syncMinutes: Number(env.SYNC_INTERVAL_MIN ?? 30),
    timeoutMs: 10000,
  },
  // Người luôn có quyền quản trị (để phân quyền lần đầu), cách nhau bởi dấu phẩy: theo mã SSO và theo email
  adminSsoIds: list(env.ADMIN_SSO_IDS ?? (ssoMode === 'mock' ? 'nv900' : '')),
  bootstrapEmails: list(env.QLVT_BOOTSTRAP_EMAILS).map((e) => e.toLowerCase()),
};
