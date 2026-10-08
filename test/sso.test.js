'use strict';
// Đồng bộ SSO Portal, đơn vị có kho, nhân sự kho chỉ lấy trong đơn vị của kho.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qlvt-sso-'));
process.env.SSO_MODE = 'mock';

const { open } = require('../src/db');
const { seedDemo } = require('../src/db/demo');
const { loadAccess, can, usersWith } = require('../src/auth/access');
const { createApp } = require('../src/app');
const { cleanName } = require('../src/sso/names');
const { normalizeDirectory, syncDirectory } = require('../src/sso/sync');
const plants = require('../src/services/plants');
const imp = require('../src/services/import-tonkho');
const directory = require('../src/sso/mock-directory');

const clone = (x) => JSON.parse(JSON.stringify(x));

test('tách họ tên khỏi chức danh trong tên SSO (giống Payroll)', () => {
  const cases = [
    ['Phó phòng kỹ thuật - Phạm Văn Hảo', 'Phó phòng', 'Phạm Văn Hảo'],
    ['Nguyễn Vân Kiều - NV Văn phòng', 'Nhân viên', 'Nguyễn Vân Kiều'],
    ['Giám đốc NMTĐ Suối Sập  3 - Lò Văn Thanh', 'Trưởng phòng', 'Lò Văn Thanh'],
    ['Vũ Văn Nam_lái xe', 'Nhân viên', 'Vũ Văn Nam'],
    ['Giám đốc NMTĐ SS3_ Lò Văn Thanh', 'Trưởng phòng', 'Lò Văn Thanh'],
    ['Nguyễn Văn An -NV phòng KH', 'Nhân viên', 'Nguyễn Văn An'],
    ['Phó phòng KT- Phạm Văn Hảo', 'Phó phòng', 'Phạm Văn Hảo'],
    ['Nguyễn Thị Hoa-Lan', 'Nhân viên', 'Nguyễn Thị Hoa-Lan'],
    ['Admin', '', 'Admin'],
    ['Chủ tịch HĐQT - Vũ Minh Tú', 'Hội đồng quản trị', 'Vũ Minh Tú'],
    ['Chủ tịch HĐQT_Vũ Minh Tú', 'Hội đồng quản trị', 'Vũ Minh Tú'],
    ['Thành viên BKS_Nguyễn Văn Minh', 'Ban Kiểm Soát', 'Nguyễn Văn Minh'],
    ['Kế toán trưởng - Lê Thị Hoa', 'Trưởng phòng', 'Lê Thị Hoa'],
    ['GĐ - Nguyễn Văn A', '', 'Nguyễn Văn A'],
    ['PGĐ_Trần Văn B', 'Người phụ trách', 'Trần Văn B'],
  ];
  for (const [raw, pos, want] of cases) assert.equal(cleanName(raw, pos), want, raw);
});

test('chuẩn hóa danh bạ: đơn vị ảo HĐQT/BGĐ, người phụ trách không là nhân sự, chức vụ cao nhất', () => {
  const nd = normalizeDirectory({
    users: [{ id: 'u1', name: 'Phó Giám đốc - Nguyễn Văn Hùng' }, { id: 'u2', name: 'Lò Văn A - NVVH NMTĐ Tà Cọ', status: 'locked' }],
    departments: [{ id: 11, name: 'NMTĐ Tà Cọ' }],
    assignments: [
      { userId: 'u1', deptId: '', role: 'Phó GĐ' },
      { userId: 'u1', deptId: 11, role: 'Người phụ trách' },
      { userId: 'u2', deptId: 11, role: 'Nhân viên' },
      { userId: 'u2', deptId: 99, role: 'Nhân viên' },
    ],
  });
  const u1 = nd.users.find((u) => u.id === 'u1');
  assert.equal(u1.full_name, 'Nguyễn Văn Hùng');
  assert.equal(u1.department_id, 'role:BGD', 'đơn vị chính là Ban giám đốc, không phải nhà máy mình phụ trách');
  assert.equal(u1.position_id, 'Phó GĐ');
  assert.deepEqual(u1.memberships.find((m) => m.deptId === '11'), { deptId: '11', role: 'Người phụ trách', member: 0 });
  const u2 = nd.users.find((u) => u.id === 'u2');
  assert.ok(u2.locked);
  assert.equal(u2.department_id, '11');
  assert.ok(nd.departments.some((d) => d.id === 'role:BGD' && d.virtual === 1));
  assert.ok(nd.departments.some((d) => d.id === '99' && d.name === '99'), 'phòng ban chỉ có trong phân công vẫn được tạo');
});

function demo() {
  const db = open(':memory:');
  seedDemo(db, { admin: null });
  const fid = (code) => db.one('SELECT id FROM factories WHERE code = ?', code).id;
  const uid = (sso) => db.one('SELECT id FROM users WHERE sso_id = ?', sso).id;
  const rid = (name) => db.one('SELECT id FROM roles WHERE name = ?', name).id;
  const access = (sso) => loadAccess(db, db.one('SELECT * FROM users WHERE sso_id = ?', sso));
  return { db, fid, uid, rid, access };
}

test('tích đơn vị có kho: tạo kho theo tên SSO, bỏ tích là ngưng, tích lại dùng lại kho cũ', () => {
  const { db, fid } = demo();
  const taco = db.one('SELECT * FROM factories WHERE id = ?', fid('TACO'));
  assert.equal(taco.name, 'NMTĐ Tà Cọ');
  assert.equal(taco.warehouse_code, 'KHOTACO', 'đơn vị trùng tên kho cũ thì dùng lại mã kho cũ');
  assert.equal(taco.request_prefix, 'PNC-TC-SBM');
  const pkh = db.one(`SELECT * FROM departments WHERE name = 'Phòng Kế hoạch'`);
  db.tx(() => plants.setWarehouseUnits(db, [pkh.id], [pkh.id]));
  const k = db.one('SELECT * FROM factories WHERE department_id = ?', pkh.id);
  assert.deepEqual([k.code, k.name, k.warehouse_code, k.request_prefix, k.active], ['PKH', 'Phòng Kế hoạch', 'KHOPKH', 'PNC-PKH-SBM', 1]);
  db.tx(() => plants.setWarehouseUnits(db, [pkh.id], []));
  assert.equal(db.one('SELECT active FROM factories WHERE id = ?', k.id).active, 0);
  db.tx(() => plants.setWarehouseUnits(db, [pkh.id], [pkh.id]));
  assert.equal(db.one('SELECT active FROM factories WHERE id = ?', k.id).active, 1);
  assert.equal(db.one('SELECT COUNT(*) n FROM factories WHERE department_id = ?', pkh.id).n, 1);
  // Đơn vị ảo (Ban giám đốc) không có kho
  const bgd = db.one(`SELECT id FROM departments WHERE sso_id = 'role:BGD'`).id;
  db.tx(() => plants.setWarehouseUnits(db, [bgd], [bgd]));
  assert.equal(db.one('SELECT COUNT(*) n FROM factories WHERE department_id = ?', bgd).n, 0);
});

test('đổi tên đơn vị trên SSO thì tên kho đổi theo; đơn vị mất khỏi SSO thì cảnh báo', () => {
  const { db, fid } = demo();
  const dir = clone(directory);
  dir.departments.find((d) => d.id === '14').name = 'Nhà máy thủy điện Suối Sập 3';
  const r = syncDirectory(db, dir);
  const ss3 = db.one('SELECT * FROM factories WHERE id = ?', fid('SS3'));
  assert.equal(ss3.name, 'Nhà máy thủy điện Suối Sập 3');
  assert.equal(ss3.warehouse_name, 'Kho Nhà máy thủy điện Suối Sập 3');
  assert.deepEqual(r.warnings, []);
  dir.departments = dir.departments.filter((d) => d.id !== '15');
  dir.assignments = dir.assignments.filter((a) => a.deptId !== '15');
  const r2 = syncDirectory(db, dir);
  assert.ok(r2.warnings.some((w) => w.includes('NMTĐ Thoong Gót')), 'báo đơn vị có kho không còn trên SSO');
  assert.equal(db.one('SELECT active FROM factories WHERE id = ?', fid('TG')).active, 1, 'kho vẫn giữ để không mất dữ liệu');
});

test('kho tạo từ bản trước tự gắn với đơn vị SSO trùng tên (kể cả tên tạm SS3, TG, Nậm Tàu)', () => {
  const db = open(':memory:');
  const legacy = [
    ['TACO', 'NMTĐ Tà Cọ', 'KHOTACO'], ['NC3', 'NMTĐ Nậm Công 3', 'KHONC3'], ['NATAU', 'NMTĐ Nậm Tàu', 'KHONATAU'],
    ['SS3', 'NMTĐ SS3', 'KHOSS3'], ['TG', 'NMTĐ TG', 'KHOTG'],
  ];
  for (const [code, name, wh] of legacy) db.run('INSERT INTO factories (code, name, warehouse_code, warehouse_name) VALUES (?, ?, ?, ?)', code, name, wh, `Kho ${name}`);
  const r = syncDirectory(db, directory);
  assert.equal(r.linked.length, 5);
  const names = Object.fromEntries(db.all('SELECT code, name FROM factories').map((f) => [f.code, f.name]));
  assert.deepEqual(names, { TACO: 'NMTĐ Tà Cọ', NC3: 'NMTĐ Nậm Công 3', NATAU: 'NMTĐ Nà Tẩu', SS3: 'NMTĐ Suối Sập 3', TG: 'NMTĐ Thoong Gót' });
  assert.equal(db.one(`SELECT warehouse_name FROM factories WHERE code = 'TG'`).warehouse_name, 'Kho NMTĐ Thoong Gót');
  // Nhân sự nhà máy theo SSO thuộc đúng kho
  assert.equal(db.one(`SELECT d.factory_id FROM users u JOIN departments d ON d.id = u.department_id WHERE u.sso_id = 'nv300'`).factory_id,
    db.one(`SELECT id FROM factories WHERE code = 'SS3'`).id);
});

test('tên khớp nhiều đơn vị thì không tự gắn, để quản trị chọn', () => {
  const db = open(':memory:');
  db.run(`INSERT INTO factories (code, name) VALUES ('TACO', 'NMTĐ Tà Cọ')`);
  const dir = clone(directory);
  dir.departments.push({ id: '21', name: 'Nhà máy Tà Cọ' });
  const r = syncDirectory(db, dir);
  assert.deepEqual(r.linked, []);
  assert.equal(db.one(`SELECT department_id FROM factories WHERE code = 'TACO'`).department_id, null);
});

test('quyền vận hành kho gán theo kho chỉ có hiệu lực với nhân sự của kho', () => {
  const { db, fid, uid, rid, access } = demo();
  const taco = fid('TACO');
  // NV Kế hoạch được gán Thủ kho Tà Cọ (dữ liệu cũ / chuyển đơn vị): không có hiệu lực
  db.run('INSERT INTO user_roles (user_id, role_id, factory_id) VALUES (?, ?, ?)', uid('nv021'), rid('Thủ kho'), taco);
  const a = access('nv021');
  assert.equal(can(a, 'stock.edit', taco), false);
  assert.equal(can(a, 'issue.create', taco), false);
  assert.equal(can(a, 'stock.view', taco), true, 'quyền xem trong nhóm vẫn có hiệu lực');
  assert.ok(!usersWith(db, 'issue.create', taco).some((u) => u.id === uid('nv021')));
  assert.ok(usersWith(db, 'issue.create', taco).some((u) => u.id === uid('nv102')), 'thủ kho của nhà máy vẫn có');
  // Gán toàn công ty thì không giới hạn (người của công ty nhập cho tất cả)
  db.run('INSERT INTO user_roles (user_id, role_id, factory_id) VALUES (?, ?, NULL)', uid('nv022'), rid('Thủ kho'));
  assert.equal(can(access('nv022'), 'stock.edit', taco), true);
  // Chuyển sang nhà máy khác trên SSO thì mất quyền thủ kho ở nhà máy cũ
  assert.equal(can(access('nv102'), 'stock.edit', taco), true);
  const dir = clone(directory);
  dir.assignments.find((x) => x.userId === 'nv102').deptId = '12';
  syncDirectory(db, dir);
  assert.equal(can(access('nv102'), 'stock.edit', taco), false);
});

test('import tồn kho không tự tạo kho: mã kho chưa có thì từ chối cả file', () => {
  const { db, fid } = demo();
  assert.throws(
    () => imp.apply(db, null, [{ line: 2, code: 'X-1', name: 'A', unit: 'Cái', quantity: 1, warehouse: 'KHOMOI' }, { line: 3, code: 'X-2', name: 'B', unit: 'Cái', quantity: 1, warehouse: 'KHOTACO' }]),
    /KHOMOI/,
  );
  assert.equal(db.one('SELECT COUNT(*) n FROM stock').n, 0, 'chưa ghi gì');
  // Kho chưa điền mã kho cũ: khớp theo tên nhà máy rồi nhớ mã kho cũ
  db.run(`UPDATE factories SET warehouse_code = NULL WHERE code = 'SS3'`);
  const r = imp.apply(db, null, [{ line: 2, code: 'X-3', name: 'C', unit: 'Cái', quantity: 4, warehouse: 'KHOSS3' }]);
  assert.equal(r.stock_rows, 1);
  assert.equal(db.one('SELECT quantity FROM stock WHERE factory_id = ?', fid('SS3')).quantity, 4);
  assert.equal(db.one(`SELECT warehouse_code FROM factories WHERE code = 'SS3'`).warehouse_code, 'KHOSS3');
});

test('phòng ban chỉ còn trong phân công không đổi tên kho thành mã số; SSO trả về thiếu phòng ban thì không ngưng', () => {
  const { db, fid } = demo();
  const dir = clone(directory);
  dir.departments = dir.departments.filter((d) => d.id !== '15'); // Thoong Gót bị bỏ khỏi danh sách nhưng còn phân công
  const r = syncDirectory(db, dir);
  const tg = db.one('SELECT * FROM factories WHERE id = ?', fid('TG'));
  assert.equal(tg.name, 'NMTĐ Thoong Gót');
  assert.equal(tg.warehouse_name, 'Kho NMTĐ Thoong Gót');
  assert.ok(r.warnings.some((w) => w.includes('NMTĐ Thoong Gót')), 'báo đơn vị có kho không còn trên SSO');
  // Danh sách phòng ban rỗng: giữ nguyên tên, không ngưng phòng ban nào
  const empty = clone(directory);
  empty.departments = [];
  const r2 = syncDirectory(db, empty);
  assert.ok(r2.warnings.some((w) => w.includes('phòng ban / nhà máy')));
  assert.equal(db.one(`SELECT name FROM factories WHERE code = 'TACO'`).name, 'NMTĐ Tà Cọ');
  assert.equal(db.one(`SELECT active FROM departments WHERE name = 'Phòng Kế toán'`).active, 1);
});

test('nhân sự nghỉ / vào mới liên tục vẫn cập nhật phân công (người nghỉ không còn tính)', () => {
  const { db, access, fid } = demo();
  const dir = clone(directory);
  for (let round = 0; round < 12; round++) {
    const leave = dir.users.filter((u) => /^w/.test(u.id)).slice(0, 3).map((u) => u.id);
    dir.users = dir.users.filter((u) => !leave.includes(u.id));
    dir.assignments = dir.assignments.filter((a) => !leave.includes(a.userId));
    for (let i = 0; i < 3; i++) {
      const id = `w${round}-${i}`;
      dir.users.push({ id, name: `Công Nhân ${round}${i} - NVVH NMTĐ Tà Cọ` });
      dir.assignments.push({ userId: id, deptId: '11', role: 'Nhân viên' });
    }
    const r = syncDirectory(db, dir);
    assert.ok(!r.warnings.some((w) => w.includes('phân công')), `vòng ${round}: ${r.warnings}`);
  }
  dir.assignments.find((x) => x.userId === 'nv102').deptId = '12';
  syncDirectory(db, dir);
  assert.equal(can(access('nv102'), 'stock.edit', fid('TACO')), false, 'chuyển nhà máy thì mất quyền thủ kho ở nhà máy cũ');
});

test('tích kho: tên gần giống không lấy nhầm mã kho cũ của nhà máy khác', () => {
  const db = open(':memory:');
  const dir = { users: [], assignments: [], departments: [{ id: 'a', name: 'NMTĐ Suối Sập 2' }, { id: 'b', name: 'NMTĐ Suối Sập 3' }, { id: 'c', name: 'NMTĐ Nậm Chiến 3' }] };
  syncDirectory(db, dir);
  const ids = db.all('SELECT id FROM departments ORDER BY name').map((d) => d.id);
  db.tx(() => plants.setWarehouseUnits(db, ids, ids));
  const code = (n) => db.one('SELECT f.code, f.warehouse_code FROM factories f JOIN departments d ON d.id = f.department_id WHERE d.name = ?', n);
  assert.deepEqual({ ...code('NMTĐ Suối Sập 3') }, { code: 'SS3', warehouse_code: 'KHOSS3' });
  assert.notEqual(code('NMTĐ Suối Sập 2').warehouse_code, 'KHOSS3');
  assert.notEqual(code('NMTĐ Nậm Chiến 3').warehouse_code, 'KHONC3');
  assert.notEqual(code('NMTĐ Nậm Chiến 3').code, 'NC3', 'mã NC3 để dành cho Nậm Công 3');
});

test('tích kho: kho cũ khớp tên nhiều đơn vị thì không bị đơn vị khác lấy mất', () => {
  const db = open(':memory:');
  db.run(`INSERT INTO factories (code, name, warehouse_code) VALUES ('TACO', 'Kho cũ Tà Cọ', 'KHOTACO')`);
  syncDirectory(db, { users: [], assignments: [], departments: [{ id: 'a', name: 'NMTĐ Tà Cọ' }, { id: 'b', name: 'Nhà máy Tà Cọ' }] });
  assert.equal(db.one(`SELECT department_id FROM factories WHERE code = 'TACO'`).department_id, null, 'mơ hồ thì không tự gắn');
  const b = db.one(`SELECT id FROM departments WHERE sso_id = 'b'`).id;
  db.tx(() => plants.setWarehouseUnits(db, [b], [b]));
  assert.equal(db.one(`SELECT department_id FROM factories WHERE code = 'TACO'`).department_id, null, 'kho cũ vẫn chờ quản trị chọn');
  assert.notEqual(db.one('SELECT warehouse_code FROM factories WHERE department_id = ?', b).warehouse_code, 'KHOTACO');
});

// ---------------------------------------------------------------- qua HTTP

let server;
let base;
let hdb;

test.before(async () => {
  hdb = open(':memory:');
  seedDemo(hdb);
  server = createApp(hdb).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function login(ssoId) {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `sso_id=${ssoId}` });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const { csrf } = hdb.one('SELECT csrf FROM sessions WHERE id = ?', cookie.split('=')[1]);
  return async (url, form) => {
    const opts = { redirect: 'manual', headers: { cookie } };
    if (form) {
      opts.method = 'POST';
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
      opts.headers.referer = `${base}${url}`;
      opts.body = typeof form === 'string' ? `_csrf=${csrf}&${form}` : new URLSearchParams({ _csrf: csrf, ...form }).toString();
    }
    return fetch(base + url, opts);
  };
}
const id = (sql, ...p) => hdb.one(sql, ...p).id;

test('gán thủ kho / GĐ nhà máy theo kho cho người ngoài nhà máy bị từ chối', async () => {
  const admin = await login('nv900');
  const taco = id(`SELECT id FROM factories WHERE code = 'TACO'`);
  const role = id(`SELECT id FROM roles WHERE name = 'Giám đốc nhà máy'`);
  for (const sso of ['nv201', 'nv002']) { // người nhà máy khác; PGĐ chỉ là "Người phụ trách" Tà Cọ
    const u = id('SELECT id FROM users WHERE sso_id = ?', sso);
    const res = await admin(`/cai-dat/nguoi-dung/${u}/gan`, { role_id: String(role), factory_ids: String(taco) });
    assert.equal(res.status, 302);
    assert.ok(!hdb.one('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? AND factory_id = ?', u, role, taco), sso);
    assert.match(decodeURIComponent(res.headers.get('set-cookie')), /chỉ gán theo kho cho người thuộc đơn vị của kho đó trên SSO. Người này không thuộc: NMTĐ Tà Cọ/);
  }
  // Người của nhà máy thì gán được; quyền đánh mã (không vận hành kho) gán cho người phòng khác được
  const nv101 = id(`SELECT id FROM users WHERE sso_id = 'nv101'`);
  await admin(`/cai-dat/nguoi-dung/${nv101}/gan`, { role_id: String(role), factory_ids: String(taco) });
  assert.ok(hdb.one('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? AND factory_id = ?', nv101, role, taco));
  const coder = id(`SELECT id FROM roles WHERE name = 'Người đánh mã vật tư'`);
  const nv011 = id(`SELECT id FROM users WHERE sso_id = 'nv011'`);
  await admin(`/cai-dat/nguoi-dung/${nv011}/gan`, { role_id: String(coder), factory_ids: String(taco) });
  assert.ok(hdb.one('SELECT 1 FROM user_roles WHERE user_id = ? AND role_id = ? AND factory_id = ?', nv011, coder, taco));
});

test('trang nhân sự kho chỉ liệt kê người của nhà máy và lưu được phân công', async () => {
  const admin = await login('nv900');
  const ss3 = id(`SELECT id FROM factories WHERE code = 'SS3'`);
  const page = await (await admin(`/cai-dat/nha-may/${ss3}`)).text();
  assert.match(page, /Lò Văn Thanh/);
  assert.match(page, /Hồ Đăng Thành/);
  assert.doesNotMatch(page, /Quàng Văn Thư/, 'người Tà Cọ không có trong danh sách Suối Sập 3');
  const tk = id(`SELECT id FROM roles WHERE name = 'Thủ kho'`);
  const gd = id(`SELECT id FROM roles WHERE name = 'Giám đốc nhà máy'`);
  const thanh = id(`SELECT id FROM users WHERE sso_id = 'nv300'`);
  const ho = id(`SELECT id FROM users WHERE sso_id = 'nv301'`);
  const outsider = id(`SELECT id FROM users WHERE sso_id = 'nv101'`);
  const form = `shown_users=${thanh},${ho},${outsider}&shown_roles=${tk},${gd}&g=${thanh}:${gd}&g=${ho}:${tk}&g=${outsider}:${tk}`;
  assert.equal((await admin(`/cai-dat/nha-may/${ss3}/nhan-su`, form)).status, 302);
  const got = hdb.all('SELECT user_id, role_id FROM user_roles WHERE factory_id = ? ORDER BY user_id', ss3).map((x) => `${x.user_id}:${x.role_id}`);
  assert.deepEqual(got.sort(), [`${thanh}:${gd}`, `${ho}:${tk}`].sort(), 'người ngoài nhà máy bị bỏ qua');
  // Bỏ tích thì bỏ quyền
  await admin(`/cai-dat/nha-may/${ss3}/nhan-su`, `shown_users=${thanh},${ho}&shown_roles=${tk},${gd}&g=${thanh}:${gd}`);
  assert.equal(hdb.one('SELECT COUNT(*) n FROM user_roles WHERE factory_id = ?', ss3).n, 1);
});

test('trang cài đặt: tích đơn vị có kho', async () => {
  const admin = await login('nv900');
  const page = await (await admin('/cai-dat')).text();
  assert.match(page, /Đơn vị có kho/);
  assert.match(page, /Phòng Kế toán/);
  assert.doesNotMatch(page, /Ban Giám đốc<\/label>/, 'đơn vị ảo không có ô tích');
  const kt = id(`SELECT id FROM departments WHERE name = 'Phòng Kế toán'`);
  const plantsIds = hdb.all('SELECT department_id AS id FROM factories WHERE active = 1').map((x) => x.id);
  const shown = [kt, ...plantsIds].join(',');
  await admin('/cai-dat/don-vi-co-kho', `shown=${shown}&${[kt, ...plantsIds].map((x) => `kho=${x}`).join('&')}`);
  assert.equal(hdb.one('SELECT active FROM factories WHERE department_id = ?', kt).active, 1);
  // Bỏ tích Phòng Kế toán: kho ngưng hoạt động, các kho khác giữ nguyên
  await admin('/cai-dat/don-vi-co-kho', `shown=${shown}&${plantsIds.map((x) => `kho=${x}`).join('&')}`);
  assert.equal(hdb.one('SELECT active FROM factories WHERE department_id = ?', kt).active, 0);
  assert.equal(hdb.one('SELECT COUNT(*) n FROM factories WHERE active = 1').n, plantsIds.length);
  // Người không có quyền cài đặt thì không đổi được
  const tk = await login('nv102');
  assert.equal((await tk('/cai-dat/don-vi-co-kho', `shown=${kt}&kho=${kt}`)).status, 403);
  assert.equal(hdb.one('SELECT active FROM factories WHERE department_id = ?', kt).active, 0);
});

test('gắn kho cũ (đang giữ tồn) vào đơn vị đã lỡ tích tạo kho mới', async () => {
  const admin = await login('nv900');
  const kt = id(`SELECT id FROM departments WHERE name = 'Phòng Kế toán'`);
  const legacy = Number(hdb.run(`INSERT INTO factories (code, name, warehouse_code, warehouse_name) VALUES ('CUKT', 'Kho cũ kế toán', 'KHOCUKT', 'Kho cũ kế toán')`).lastInsertRowid);
  hdb.run(`INSERT INTO materials (code, name) VALUES ('KT-01', 'Giấy in')`);
  hdb.run(`INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, (SELECT id FROM materials WHERE code = 'KT-01'), 5)`, legacy);
  // Đã lỡ tích Phòng Kế toán (tạo kho trống) rồi bỏ tích
  hdb.tx(() => plants.setWarehouseUnits(hdb, [kt], [kt]));
  hdb.tx(() => plants.setWarehouseUnits(hdb, [kt], []));
  const page = await (await admin(`/cai-dat/nha-may/${legacy}`)).text();
  assert.match(page, new RegExp(`<option value="${kt}"[^>]*>Phòng Kế toán`), 'đơn vị có kho trống đã ngưng vẫn chọn được');
  await admin('/cai-dat/nha-may', { id: String(legacy), department_id: String(kt), code: 'CUKT', warehouse_code: 'KHOCUKT', warehouse_name: 'Kho cũ kế toán', active: '1' });
  const f = hdb.one('SELECT * FROM factories WHERE id = ?', legacy);
  assert.equal(f.department_id, kt);
  assert.equal(f.name, 'Phòng Kế toán');
  assert.equal(f.warehouse_name, 'Kho cũ kế toán', 'tên in trên phiếu do quản trị tự đặt thì giữ');
  assert.equal(hdb.one('SELECT COUNT(*) n FROM factories WHERE department_id = ?', kt).n, 1, 'kho trống đã bị xóa');
  // Đổi đơn vị: tên in trên phiếu đang theo tên đơn vị cũ thì đổi theo
  hdb.run(`UPDATE factories SET warehouse_name = 'Kho Phòng Kế toán' WHERE id = ?`, legacy);
  const vp = id(`SELECT id FROM departments WHERE name = 'Văn phòng'`);
  await admin('/cai-dat/nha-may', { id: String(legacy), department_id: String(vp), code: 'CUKT', warehouse_name: 'Kho Phòng Kế toán', active: '1' });
  assert.equal(hdb.one('SELECT warehouse_name FROM factories WHERE id = ?', legacy).warehouse_name, 'Kho Văn phòng');
  // Đơn vị có kho đang dùng thì không gắn kho khác vào được
  const taco = hdb.one(`SELECT * FROM factories WHERE code = 'TACO'`);
  await admin('/cai-dat/nha-may', { id: String(legacy), department_id: String(taco.department_id), code: 'CUKT', active: '1' });
  assert.equal(hdb.one('SELECT department_id FROM factories WHERE id = ?', legacy).department_id, vp);
});
