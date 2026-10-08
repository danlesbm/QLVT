'use strict';
// Đăng nhập qua SSO Portal (?token= + introspect) và đồng bộ danh bạ nội bộ, với một SSO giả chạy cục bộ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SECRET = 'bi-mat-noi-bo';
const directory = require('../src/sso/mock-directory');
const TOKENS = {
  'tk-admin': { active: true, user: { id: 'nv900', username: 'admin', email: 'admin@sbm.com.vn', displayName: 'Quản trị hệ thống', role: 'admin', status: 'active' } },
  'tk-thu': { active: true, user: { id: 'nv101', username: 'quangvanthu', displayName: 'Quàng Văn Thư - NVVH NMTĐ Tà Cọ', role: 'user', status: 'active' } },
  'tk-moi': { active: true, user: { id: 'nv777', username: 'moi', displayName: 'Người Mới - NV phòng KH', role: 'user', status: 'active' } },
  'tk-khoa': { active: true, user: { id: 'nv102', displayName: 'Lường Thị Mai', role: 'user', status: 'locked' } },
};
let dirCalls = 0;

const sso = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://sso');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/api/auth/introspect') return res.end(JSON.stringify(TOKENS[url.searchParams.get('token')] || { active: false }));
  if (url.pathname === '/api/internal/directory') {
    if (req.headers['x-internal-secret'] !== SECRET) return res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
    dirCalls++;
    const dir = JSON.parse(JSON.stringify(directory));
    dir.users.push({ id: 'nv777', username: 'moi', name: 'Người Mới - NV phòng KH', status: 'active' });
    dir.assignments.push({ userId: 'nv777', deptId: '2', role: 'Nhân viên' });
    return res.end(JSON.stringify(dir));
  }
  res.writeHead(404).end('{}');
});

let server;
let base;
let db;

test.before(async () => {
  sso.listen(0);
  await new Promise((r) => sso.once('listening', r));
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qlvt-portal-'));
  delete process.env.SSO_MODE;
  process.env.SSO_BASE_URL = `http://127.0.0.1:${sso.address().port}`;
  process.env.SSO_INTERNAL_API_SECRET = SECRET;
  const { open } = require('../src/db');
  const { createApp } = require('../src/app');
  const { runSync } = require('../src/sso');
  db = open(':memory:');
  await runSync(db);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  sso.close();
});

const get = (url, headers = {}) => fetch(base + url, { redirect: 'manual', headers });
const sid = (res) => (res.headers.get('set-cookie') || '').match(/qlvt_sid=([^;]+)/)?.[1];

test('không có SSO_MODE nhưng có SSO_BASE_URL thì chạy chế độ SSO Portal; trang đăng nhập không cho chọn người', async () => {
  const page = await (await get('/login')).text();
  assert.match(page, /mở <b>Quản lý vật tư<\/b> từ SSO Portal/);
  assert.match(page, new RegExp(`href="${process.env.SSO_BASE_URL}"`));
  assert.doesNotMatch(page, /name="sso_id"/);
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'sso_id=nv900' });
  assert.equal(res.status, 405, 'không đăng nhập giả lập được');
});

test('SSO mở app kèm token: tạo phiên, bỏ token khỏi địa chỉ, giữ trang đang mở', async () => {
  const res = await get('/de-xuat?status=CHO_DUYET_NHU_CAU&token=tk-thu&parent=https%3A%2F%2Fsso.sbm.com.vn');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/de-xuat?status=CHO_DUYET_NHU_CAU');
  const s = sid(res);
  assert.ok(s);
  const home = await get('/', { cookie: `qlvt_sid=${s}` });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Quàng Văn Thư/);
  const u = db.one(`SELECT * FROM users WHERE sso_id = 'nv101'`);
  assert.equal(u.full_name, 'Quàng Văn Thư', 'tên bỏ phần chức danh');
  assert.equal(u.is_admin, 0);
});

test('quản trị trên SSO là quản trị QLVT; mất quyền trên SSO thì lần đăng nhập sau mất theo', async () => {
  const res = await get('/?token=tk-admin');
  const s = sid(res);
  assert.equal((await get('/cai-dat', { cookie: `qlvt_sid=${s}` })).status, 200);
  TOKENS['tk-admin'].user.role = 'user';
  const res2 = await get('/?token=tk-admin', { cookie: `qlvt_sid=${s}` });
  assert.equal((await get('/cai-dat', { cookie: `qlvt_sid=${sid(res2)}` })).status, 403);
  assert.equal((await get('/', { cookie: `qlvt_sid=${s}` })).status, 302, 'mở bằng token mới thì phiên cũ trên trình duyệt bị bỏ');
  TOKENS['tk-admin'].user.role = 'admin';
});

test('token hết hạn / tài khoản bị khóa thì báo lỗi, không tạo phiên', async () => {
  const bad = await get('/?token=het-han');
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /hết hạn hoặc không hợp lệ/);
  assert.equal(sid(bad), undefined);
  const locked = await get('/?token=tk-khoa');
  assert.equal(locked.status, 401);
  assert.match(await locked.text(), /bị khóa trên SSO/);
});

test('mở trang khi chưa đăng nhập: vào lại từ SSO Portal thì quay về đúng trang đó', async () => {
  const first = await get('/kho');
  assert.match(first.headers.get('location'), /^\/login\?next=%2Fkho/);
  const login = await get(first.headers.get('location'));
  const next = login.headers.get('set-cookie').match(/qlvt_next=([^;]+)/)[1];
  const res = await get('/?token=tk-thu', { cookie: `qlvt_next=${next}` });
  assert.equal(res.headers.get('location'), '/kho');
});

test('người mới đăng nhập lần đầu: đồng bộ danh bạ ngay để có đơn vị', async () => {
  const before = dirCalls;
  const res = await get('/?token=tk-moi');
  assert.equal(res.status, 302);
  for (let i = 0; i < 50 && dirCalls === before; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 20));
  const u = db.one(`SELECT u.full_name, d.name AS dep FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.sso_id = 'nv777'`);
  assert.deepEqual({ ...u }, { full_name: 'Người Mới', dep: 'Phòng Kế hoạch' });
});

test('SSO gọi đồng bộ: sai secret bị từ chối, đúng secret thì đồng bộ', async () => {
  const wrong = await fetch(`${base}/api/internal/sync`, { method: 'POST', headers: { 'x-internal-secret': 'sai' } });
  assert.equal(wrong.status, 401);
  const none = await fetch(`${base}/api/internal/sync`, { method: 'POST' });
  assert.equal(none.status, 401);
  const ok = await fetch(`${base}/api/internal/sync`, { method: 'POST', headers: { 'x-internal-secret': SECRET } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.users, directory.users.length + 1);
});

test('cho phép SSO Portal nhúng app; có /health', async () => {
  const res = await get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: 'qlvt' });
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'self' https://*.sbm.com.vn");
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
