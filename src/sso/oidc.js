'use strict';
const crypto = require('node:crypto');

/**
 * Adapter SSO chuẩn OpenID Connect (Authorization Code + PKCE).
 *
 * Đăng nhập: chuyển hướng sang SSO_AUTHORIZE_URL, nhận code tại /auth/callback,
 * đổi lấy access token ở SSO_TOKEN_URL và đọc hồ sơ tại SSO_USERINFO_URL.
 *
 * Danh bạ: GET {SSO_DIRECTORY_URL}/departments, /positions, /employees
 * với header Authorization: Bearer SSO_DIRECTORY_TOKEN. Mỗi API trả về mảng JSON
 * (hoặc { data: [...] }) với các trường như mô tả trong TONG-QUAN.md.
 */
function create(cfg) {
  const pick = (o, ...keys) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '');

  function normEmployee(o) {
    return {
      id: String(pick(o, cfg.claimId, 'id', 'sub', 'employee_id', 'code')),
      username: pick(o, 'username', 'preferred_username', 'user_name'),
      full_name: pick(o, 'full_name', 'name', 'fullName', 'display_name'),
      email: pick(o, 'email'),
      phone: pick(o, 'phone', 'phone_number', 'mobile'),
      department_id: pick(o, 'department_id', 'departmentId', 'dept_id'),
      position_id: pick(o, 'position_id', 'positionId', 'title_id'),
    };
  }

  async function getJson(url, token) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`SSO trả lỗi ${res.status} khi gọi ${url}`);
    const body = await res.json();
    return Array.isArray(body) ? body : body.data || body.items || [];
  }

  return {
    name: 'oidc',
    async fetchDirectory() {
      if (!cfg.directoryUrl) throw new Error('Chưa cấu hình SSO_DIRECTORY_URL');
      const base = cfg.directoryUrl.replace(/\/$/, '');
      const [deps, poss, emps] = await Promise.all(
        ['departments', 'positions', 'employees'].map((p) => getJson(`${base}/${p}`, cfg.directoryToken)),
      );
      return {
        departments: deps.map((d) => ({ id: String(pick(d, 'id', 'code')), code: pick(d, 'code'), name: pick(d, 'name', 'title') })),
        positions: poss.map((p) => ({ id: String(pick(p, 'id', 'code')), code: pick(p, 'code'), name: pick(p, 'name', 'title') })),
        employees: emps.map(normEmployee),
      };
    },
    loginStart(req, res) {
      const state = crypto.randomBytes(16).toString('hex');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const opts = { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 10 * 60 * 1000 };
      res.cookie('qlvt_oidc', JSON.stringify({ state, verifier, next: req.query.next || '/' }), opts);
      const url = new URL(cfg.authorizeUrl);
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        scope: cfg.scope,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      res.redirect(url.toString());
    },
    async callback(req, res) {
      const saved = JSON.parse(req.cookies.qlvt_oidc || '{}');
      res.clearCookie('qlvt_oidc');
      if (!req.query.code || !saved.state || saved.state !== req.query.state) throw new Error('Phiên đăng nhập SSO không hợp lệ, vui lòng thử lại');
      const tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: cfg.redirectUri,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret || '',
          code_verifier: saved.verifier,
        }),
      });
      if (!tokenRes.ok) throw new Error(`SSO từ chối mã đăng nhập (${tokenRes.status})`);
      const token = await tokenRes.json();
      const infoRes = await fetch(cfg.userinfoUrl, { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!infoRes.ok) throw new Error(`Không đọc được thông tin người dùng từ SSO (${infoRes.status})`);
      const profile = normEmployee(await infoRes.json());
      profile.next = saved.next;
      return profile;
    },
    logoutUrl() {
      return cfg.logoutUrl || '/login';
    },
  };
}

module.exports = { create };
