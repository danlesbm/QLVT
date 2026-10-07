'use strict';
/**
 * Giao tiếp với SSO Portal của công ty (cùng cách app Payroll đang dùng, không cần sửa SSO):
 *  - Đăng nhập: SSO mở app kèm ?token=...; app gọi GET {SSO_BASE_URL}/api/auth/introspect?token=...
 *      -> { active, user: { id, username, email, displayName, role, status } }
 *  - Danh bạ:   GET {SSO_BASE_URL}/api/internal/directory, header X-Internal-Secret: SSO_INTERNAL_API_SECRET
 *      -> { ok: true, users: [{ id, name, username, email, status }], departments: [{ id, name }],
 *           assignments: [{ userId, deptId, role }] }
 */
function create(cfg) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');

  async function getJson(url, headers = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs || 10000);
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctl.signal });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
    } catch (err) {
      throw new Error(`Không kết nối được SSO (${base}): ${err.name === 'AbortError' ? 'quá thời gian chờ' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    name: 'portal',
    /** Hồ sơ người dùng của token, hoặc ném lỗi kèm thông báo cho người dùng. Đơn vị / chức vụ lấy từ danh bạ. */
    async introspect(token) {
      if (!base) throw new Error('Chưa cấu hình SSO_BASE_URL');
      const { ok, data } = await getJson(`${base}/api/auth/introspect?token=${encodeURIComponent(token)}`);
      const u = data && data.user;
      if (!ok || !data.active || !u || u.id == null || u.id === '') throw new Error('Phiên đăng nhập SSO đã hết hạn hoặc không hợp lệ. Hãy mở lại ứng dụng từ SSO Portal.');
      if (String(u.status || '').toLowerCase() === 'locked') throw new Error('Tài khoản của bạn đang bị khóa trên SSO.');
      return {
        id: String(u.id),
        username: u.username || null,
        email: u.email || null,
        raw_name: u.displayName || u.name || u.username || u.email || String(u.id),
        locked: false,
        ssoAdmin: u.role === 'admin',
      };
    },
    async fetchDirectory() {
      if (!base || !cfg.internalSecret) throw new Error('Cần cấu hình SSO_BASE_URL và SSO_INTERNAL_API_SECRET (cùng giá trị với SSO).');
      const { ok, status, data } = await getJson(`${base}/api/internal/directory`, { 'X-Internal-Secret': cfg.internalSecret });
      if (!ok || data.ok !== true) throw new Error(`SSO từ chối đọc danh bạ (HTTP ${status}${data.error ? ': ' + data.error : ''}). Kiểm tra SSO_INTERNAL_API_SECRET.`);
      if (!Array.isArray(data.users) || !Array.isArray(data.departments) || !Array.isArray(data.assignments)) throw new Error('SSO trả về danh bạ không đúng định dạng.');
      return data;
    },
  };
}

module.exports = { create };
