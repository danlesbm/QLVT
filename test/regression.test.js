'use strict';
// Test hồi quy cho các lỗi đã phát hiện trong đợt rà soát (giữ lại để không tái phát).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qlvt-rg-'));
process.env.SSO_MODE = 'mock';

const { open } = require('../src/db');
const { seedDemo } = require('../src/db/demo');
const { loadAccess } = require('../src/auth/access');
const { createApp } = require('../src/app');
const requests = require('../src/services/requests');
const issues = require('../src/services/issues');
const materials = require('../src/services/materials');
const stockSvc = require('../src/services/stock');
const { safeNext } = require('../src/services/util');
const { syncDirectory } = require('../src/sso/sync');

function setup() {
  const db = open(':memory:');
  seedDemo(db, { admin: null });
  const as = (sso) => {
    const user = db.one('SELECT * FROM users WHERE sso_id = ?', sso);
    return { user, access: loadAccess(db, user) };
  };
  const taco = db.one(`SELECT id FROM factories WHERE code = 'TACO'`).id;
  const nc3 = db.one(`SELECT id FROM factories WHERE code = 'NC3'`).id;
  const mat = Number(db.run(`INSERT INTO materials (code, name, unit) VALUES ('1-01-00-001', 'Cảm biến mực nước', 'Cái')`).lastInsertRowid);
  return { db, as, taco, nc3, mat };
}

const run = (db, who, id, action, data, file) => requests.act(db, who.user, who.access, id, action, data, file);

/** Đưa 1 phiếu tới trạng thái đang báo giá, trả về id + danh sách vật tư. */
function toQuoting(db, as, taco, mat) {
  const lap = as('nv101');
  const id = requests.create(db, lap.user, lap.access, {
    factory_id: taco,
    title: 'Nhu cầu vật tư',
    items: [{ material_id: mat, name: 'Cảm biến mực nước', quantity: '2', unit: 'Cái' }, { name: 'Dầu tua bin', quantity: '200', unit: 'Lít' }],
  });
  run(db, lap, id, 'submit');
  run(db, as('nv100'), id, 'factory_approve');
  run(db, as('nv010'), id, 'pkt_approve', { director_id: as('nv002').user.id });
  run(db, as('nv002'), id, 'director_approve');
  run(db, as('nv021'), id, 'purchase_receive');
  return { id, its: requests.items(db, id) };
}

// ---------------------------------------------------------------- báo giá niêm phong

test('xóa báo giá không để lọt tên nhà cung cấp vào lịch sử khi còn niêm phong', () => {
  const { db, as, taco, mat } = setup();
  const { id, its } = toQuoting(db, as, taco, mat);
  const tpkh = as('nv020');
  const an = as('nv021');
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id, as('nv022').user.id] });
  run(db, an, id, 'quote_add', { supplier: 'Công ty Mật A', lines: { [`i${its[0].id}`]: { unit_price: '1000000' } } });
  const q = db.one('SELECT id FROM quotes WHERE request_id = ?', id);
  run(db, an, id, 'quote_delete', { quote_id: q.id });
  const h = requests.history(db, id);
  assert.ok(h.some((x) => x.action === 'quote_delete'), 'vẫn ghi lịch sử xóa báo giá');
  assert.ok(!h.some((x) => (x.comment || '').includes('Mật A')), 'không được ghi tên nhà cung cấp lúc còn niêm phong');
  assert.equal(db.one('SELECT COUNT(*) n FROM quotes WHERE request_id = ?', id).n, 0);
});

test('đã mở niêm phong thì không giao thêm người báo giá', () => {
  const { db, as, taco, mat } = setup();
  const { id, its } = toQuoting(db, as, taco, mat);
  const tpkh = as('nv020');
  const an = as('nv021');
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id] });
  run(db, an, id, 'quote_add', { supplier: 'Công ty A', lines: { [`i${its[0].id}`]: { unit_price: '900000' } } });
  assert.equal(requests.visibleQuotes(db, id, tpkh.user).quotes.length, 0, 'chưa xong thì TP chưa thấy');
  run(db, an, id, 'quote_done');
  assert.ok(requests.visibleQuotes(db, id, tpkh.user).unsealed);
  // Đã mở niêm phong thì không còn thao tác giao báo giá nữa
  assert.ok(!requests.availableActions(db, tpkh.access, tpkh.user, requests.get(db, id)).has('assign_quoters'));
  // Yêu cầu báo giá lại làm phiếu niêm phong trở lại, nhưng vẫn không được giao thêm người mới
  run(db, tpkh, id, 'quote_reopen', { user_id: an.user.id, comment: 'Lấy thêm 1 báo giá nữa' });
  assert.ok(requests.availableActions(db, tpkh.access, tpkh.user, requests.get(db, id)).has('assign_quoters'));
  assert.throws(
    () => run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id, as('nv022').user.id] }),
    /mở niêm phong/,
  );
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id] }, undefined);
  run(db, an, id, 'quote_done');
  // Ghi "mở niêm phong" đúng 1 lần cho mỗi lần chuyển từ niêm phong sang mở
  assert.equal(requests.history(db, id).filter((x) => x.action === 'quotes_unsealed').length, 2);
});

test('TP Kế hoạch kết thúc báo giá thay nhân viên để phiếu không bị treo', () => {
  const { db, as, taco, mat } = setup();
  const { id, its } = toQuoting(db, as, taco, mat);
  const tpkh = as('nv020');
  const an = as('nv021');
  const binh = as('nv022');
  const cuong = as('nv023');
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id, binh.user.id, cuong.user.id] });
  run(db, an, id, 'quote_add', { supplier: 'Công ty A', lines: { [`i${its[0].id}`]: { unit_price: '900000' } } });
  run(db, an, id, 'quote_done');
  const r = requests.get(db, id);
  assert.ok(requests.availableActions(db, tpkh.access, tpkh.user, r).has('quote_close'), 'TP phải có thao tác kết thúc thay');
  assert.ok(!requests.visibleQuotes(db, id, tpkh.user).unsealed, 'còn người chưa xong thì vẫn niêm phong');
  assert.throws(() => run(db, tpkh, id, 'quote_close', { user_id: binh.user.id }), /lý do/);
  run(db, tpkh, id, 'quote_close', { user_id: binh.user.id, comment: 'Nghỉ dài hạn' });
  assert.equal(db.one('SELECT status FROM request_quoters WHERE request_id = ? AND user_id = ?', id, binh.user.id).status, 'DA_XONG');
  assert.throws(() => run(db, tpkh, id, 'quote_close', { user_id: binh.user.id, comment: 'x' }), /không còn đang báo giá/);
  assert.ok(!requests.visibleQuotes(db, id, tpkh.user).unsealed);
  run(db, tpkh, id, 'quote_close', { user_id: cuong.user.id, comment: 'Đi công tác' });
  const v = requests.visibleQuotes(db, id, tpkh.user);
  assert.ok(v.unsealed, 'kết thúc thay người cuối thì mở niêm phong');
  assert.equal(v.quotes.length, 1);
});

test('vật tư không có báo giá nào vẫn tổng hợp được để GĐ duyệt giá', () => {
  const { db, as, taco, mat } = setup();
  const { id, its } = toQuoting(db, as, taco, mat);
  const tpkh = as('nv020');
  const an = as('nv021');
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id], non_competitive: [its[1].id] });
  run(db, an, id, 'quote_add', { supplier: 'Công ty A', lines: { [`i${its[0].id}`]: { unit_price: '900000' } } });
  run(db, an, id, 'quote_done');
  run(db, tpkh, id, 'assign_compiler', { compiler_id: an.user.id });
  const v = requests.visibleQuotes(db, id, an.user);
  const line = v.quotes[0].byItem[its[0].id];
  run(db, an, id, 'comparison_submit', {
    price_approver_id: as('nv001').user.id,
    selected: { [`i${its[0].id}`]: line.id },
    comparison_note: 'Dầu tua bin mua theo hợp đồng khung',
  });
  assert.equal(requests.get(db, id).status, 'CHO_GD_DUYET_GIA');
  const rows = requests.items(db, id);
  assert.equal(rows[0].selected_line_id, line.id);
  assert.equal(rows[1].selected_line_id, null);
});

// ---------------------------------------------------------------- lọc / phân quyền

test('lọc danh sách phiếu với tham số lạ không gây lỗi 500', () => {
  const { db, as } = setup();
  const lap = as('nv101');
  for (const status of [undefined, '', 'CHO_TBP', 'DANG_XU_LY', ['a', 'b'], { x: 1 }, 123]) {
    assert.ok(requests.list(db, lap.access, lap.user, { status }).rows);
    assert.ok(issues.list(db, lap.access, lap.user, { status }).rows);
  }
});

test('tổng tồn ở danh mục mã vật tư chỉ tính kho người dùng được xem', () => {
  const { db, as, taco, nc3, mat } = setup();
  db.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, ?, 10), (?, ?, 7)', taco, mat, nc3, mat);
  const admin = as('nv900');
  const adminAccess = { ...admin.access, isAdmin: true };
  assert.equal(materials.list(db, adminAccess, {}).rows[0].total_qty, 17);
  const tkTaco = as('nv102');
  assert.equal(materials.list(db, tkTaco.access, {}).rows[0].total_qty, 10, 'thủ kho Tà Cọ chỉ thấy tồn Tà Cọ');
  // Người chỉ được xem danh mục, không được xem kho nào
  const roleId = Number(db.run(`INSERT INTO roles (name, description, permissions) VALUES ('Chỉ xem danh mục', '', '["catalog.view"]')`).lastInsertRowid);
  db.run('DELETE FROM user_roles WHERE user_id = (SELECT id FROM users WHERE sso_id = ?)', 'nv011');
  db.run('INSERT INTO user_roles (user_id, role_id, factory_id) VALUES ((SELECT id FROM users WHERE sso_id = ?), ?, NULL)', 'nv011', roleId);
  const pkt = as('nv011');
  assert.equal(materials.list(db, pkt.access, {}).rows[0].total_qty, null, 'không có quyền xem kho thì không thấy tồn');
});

test('không chuyển mã chung thành mã riêng khi nhà máy khác còn tồn', () => {
  const { db, as, taco, nc3, mat } = setup();
  db.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, ?, 3)', nc3, mat);
  const admin = as('nv900');
  const access = { ...admin.access, isAdmin: true };
  assert.throws(
    () => materials.save(db, admin.user, access, { id: mat, code: '1-01-00-001', name: 'Cảm biến mực nước', factory_id: taco }),
    /đang có tồn/,
  );
  db.run('UPDATE stock SET quantity = 0 WHERE factory_id = ?', nc3);
  assert.ok(materials.save(db, admin.user, access, { id: mat, code: '1-01-00-001', name: 'Cảm biến mực nước', factory_id: taco }));
});

test('chỉ nhận đường dẫn nội bộ sau khi đăng nhập', () => {
  assert.equal(safeNext('/de-xuat/5'), '/de-xuat/5');
  assert.equal(safeNext('/kho?page=2'), '/kho?page=2');
  for (const bad of ['//evil.test/x', 'https://evil.test', '/\\evil.test', '/a\nb', 5, null, undefined, '']) {
    assert.equal(safeNext(bad), '/', `phải chặn ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------- kho & phiếu xuất

test('nhập thêm thì cộng dồn, sửa tồn thì chặn ghi đè khi số đã thay đổi', () => {
  const { db, as, taco, mat } = setup();
  const tk = as('nv102');
  let row = stockSvc.save(db, tk.user, tk.access, { factory_id: taco, material_id: mat, quantity: '10', mode: 'add', condition: 'Mới 100%', location: 'Kệ A' });
  assert.equal(row.quantity, 10);
  row = stockSvc.save(db, tk.user, tk.access, { factory_id: taco, material_id: mat, quantity: '5', mode: 'add' });
  assert.equal(row.quantity, 15, 'nhập thêm là cộng dồn');
  assert.equal(row.condition, 'Mới 100%', 'để trống thì giữ tình trạng cũ');
  assert.equal(row.location, 'Kệ A');
  assert.throws(() => stockSvc.save(db, tk.user, tk.access, { factory_id: taco, material_id: mat, quantity: '0', mode: 'add' }), /lớn hơn 0/);
  // Sửa tồn: số liệu trên form đã cũ thì không ghi đè
  assert.throws(
    () => stockSvc.save(db, tk.user, tk.access, { factory_id: taco, material_id: mat, quantity: '20', mode: 'set', expected_quantity: '10' }),
    /vừa thay đổi/,
  );
  row = stockSvc.save(db, tk.user, tk.access, { factory_id: taco, material_id: mat, quantity: '20', mode: 'set', expected_quantity: '15', reason: 'Kiểm kê' });
  assert.equal(row.quantity, 20);
  assert.equal(db.one(`SELECT kind FROM stock_movements WHERE material_id = ? ORDER BY id DESC LIMIT 1`, mat).kind, 'DIEU_CHINH');
});

test('phiếu xuất cộng dồn nhiều dòng cùng vật tư khi kiểm tra tồn', () => {
  const { db, as, taco, mat } = setup();
  const tk = as('nv102');
  db.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, ?, 5)', taco, mat);
  const id = issues.create(db, tk.user, tk.access, {
    factory_id: taco,
    receiver_name: 'Quàng Văn Thư',
    items: [{ material_id: mat, qty_requested: '3', qty_actual: '3' }, { material_id: mat, qty_requested: '3', qty_actual: '3' }],
  });
  assert.throws(() => issues.act(db, tk.user, tk.access, id, 'submit'), /Không đủ tồn kho/);
  assert.equal(issues.get(db, id).status, 'NHAP', 'không được chuyển trạng thái khi thiếu tồn');
});

test('số phiếu nhu cầu chạy liên tục theo tiền tố dùng chung của nhiều nhà máy', () => {
  const { db, as, taco, nc3 } = setup();
  db.run(`UPDATE factories SET request_prefix = 'PNC-TC-SBM' WHERE id IN (?, ?)`, taco, nc3);
  const a = as('nv101');
  const b = as('nv201');
  const id1 = requests.create(db, a.user, a.access, { factory_id: taco, title: 'x', items: [{ name: 'a', quantity: 1 }] });
  run(db, a, id1, 'submit');
  const id2 = requests.create(db, b.user, b.access, { factory_id: nc3, title: 'y', items: [{ name: 'b', quantity: 1 }] });
  run(db, b, id2, 'submit');
  assert.equal(requests.get(db, id1).number, '1/PNC-TC-SBM');
  assert.equal(requests.get(db, id2).number, '2/PNC-TC-SBM', 'cùng tiền tố thì không trùng số');
});

// ---------------------------------------------------------------- đồng bộ SSO

test('đồng bộ SSO không ngưng hoạt động hàng loạt khi danh bạ trả về thiếu', () => {
  const { db } = setup();
  const before = db.one('SELECT COUNT(*) n FROM users WHERE active = 1').n;
  assert.ok(before > 5);
  const r1 = syncDirectory(db, { departments: [], positions: [], employees: [] });
  assert.equal(db.one('SELECT COUNT(*) n FROM users WHERE active = 1').n, before, 'danh bạ rỗng thì không ngưng ai');
  assert.equal(r1.warnings.length, 3);
  const r2 = syncDirectory(db, { departments: [], positions: [], employees: [{ id: 'nv101', username: 'nv101', full_name: 'Lò Văn Thiêm' }] });
  assert.equal(db.one('SELECT COUNT(*) n FROM users WHERE active = 1').n, before, 'trả về quá ít cũng không ngưng');
  assert.ok(r2.warnings.some((w) => w.includes('CBCNV')));
  assert.equal(db.one(`SELECT full_name FROM users WHERE sso_id = 'nv101'`).full_name, 'Lò Văn Thiêm', 'vẫn cập nhật hồ sơ');
});

// ---------------------------------------------------------------- đợt kiểm chứng lại

test('phiếu đang chờ nhân viên báo giá không nằm trong việc cần làm của TP Kế hoạch', () => {
  const { db, as, taco, mat } = setup();
  const { id } = toQuoting(db, as, taco, mat);
  const tpkh = as('nv020');
  assert.ok(requests.todo(db, tpkh.access, tpkh.user).some((r) => r.id === id), 'chưa giao báo giá thì là việc của TP');
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [as('nv021').user.id, as('nv022').user.id] });
  assert.ok(!requests.todo(db, tpkh.access, tpkh.user).some((r) => r.id === id), 'đã giao thì chờ nhân viên, không phải việc của TP');
  const an = as('nv021');
  assert.ok(requests.todo(db, an.access, an.user).some((r) => r.id === id), 'là việc của nhân viên được giao');
});

test('nhập thêm cùng một form 2 lần chỉ cộng tồn 1 lần', () => {
  const { db, as, taco, mat } = setup();
  const tk = as('nv102');
  const form = { factory_id: taco, material_id: mat, quantity: '10', mode: 'add', form_token: 'tok-1' };
  stockSvc.save(db, tk.user, tk.access, form);
  assert.throws(() => stockSvc.save(db, tk.user, tk.access, form), /đã được lưu rồi/);
  assert.equal(db.one('SELECT quantity FROM stock WHERE factory_id = ? AND material_id = ?', taco, mat).quantity, 10);
  stockSvc.save(db, tk.user, tk.access, { ...form, form_token: 'tok-2' });
  assert.equal(db.one('SELECT quantity FROM stock WHERE factory_id = ? AND material_id = ?', taco, mat).quantity, 20);
});

test('nhập thêm vào dòng tồn đang âm (dữ liệu cũ) vẫn được, xuất quá tồn vẫn bị chặn', () => {
  const { db, as, taco, mat } = setup();
  const tk = as('nv102');
  db.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, ?, -5)', taco, mat);
  const row = stockSvc.save(db, tk.user, tk.access, { factory_id: taco, material_id: mat, quantity: '3', mode: 'add' });
  assert.equal(row.quantity, -2);
  db.tx(() => assert.throws(() => stockSvc.move(db, { factoryId: taco, materialId: mat, delta: -1, kind: 'XUAT' }), /Không đủ tồn kho/));
});

test('đổi ký hiệu số phiếu của một nhà máy không làm trùng số phiếu nhà máy còn lại', () => {
  const { db, as, taco, nc3 } = setup();
  db.run(`UPDATE factories SET request_prefix = 'PNC-TC&NC3-SBM' WHERE id IN (?, ?)`, taco, nc3);
  const a = as('nv101');
  const b = as('nv201');
  const mk = (who, fid) => {
    const id = requests.create(db, who.user, who.access, { factory_id: fid, title: 'x', items: [{ name: 'a', quantity: 1 }] });
    run(db, who, id, 'submit');
    return requests.get(db, id).number;
  };
  assert.equal(mk(a, taco), '1/PNC-TC&NC3-SBM');
  assert.equal(mk(b, nc3), '2/PNC-TC&NC3-SBM');
  db.run(`UPDATE factories SET request_prefix = 'PNC-NC3-SBM' WHERE id = ?`, nc3);
  assert.equal(mk(a, taco), '3/PNC-TC&NC3-SBM', 'không được cấp lại số 2');
  assert.equal(mk(b, nc3), '1/PNC-NC3-SBM');
});

test('import tồn kho từ chối file thiếu cột số lượng hoặc số lượng không rõ, không ghi gì vào kho', async () => {
  const ExcelJS = require('exceljs');
  const imp = require('../src/services/import-tonkho');
  const xlsx = async (header, rows) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tồn kho');
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  await assert.rejects(imp.parse(await xlsx(['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Giá trị', 'Kho hàng'], [[1, 'VT01', 'Vòng bi', 'CAI', 125, 'KHOTACO']])), /cột số lượng/);
  await assert.rejects(imp.parse(await xlsx(['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'SL tồn', 'Kho hàng'], [[1, 'VT01', 'Vòng bi', 'CAI', '1,250', 'KHOTACO']])), /không hợp lệ.*VT01/);
  const ok = await imp.parse(await xlsx(['STT', 'Mã hàng', 'Tên hàng', 'ĐVT', 'Tồn cuối kỳ', 'Kho hàng'], [[1, 'VT01', 'Vòng bi', 'CAI', '1.250,5', 'KHOTACO'], [2, 'VT02', 'Dầu', 'LIT', 12, 'KHOTACO']]));
  assert.deepEqual(ok.map((r) => r.quantity), [1250.5, 12]);
});

// ---------------------------------------------------------------- qua giao diện web

let server;
let base;
let hdb;

test.before(async () => {
  hdb = open(':memory:');
  seedDemo(hdb);
  hdb.run(`INSERT INTO materials (code, name, unit) VALUES ('1-01-00-001', 'Cảm biến mực nước', 'Cái')`);
  hdb.run(`INSERT INTO materials (code, name, unit, factory_id) VALUES ('NC3-001', 'Vật tư riêng Nậm Công 3', 'Cái', (SELECT id FROM factories WHERE code='NC3'))`);
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
      opts.body = new URLSearchParams({ _csrf: csrf, ...form }).toString();
    }
    return fetch(base + url, opts);
  };
}

test('toàn bộ bước báo giá - so sánh giá - nhận hàng qua form web (khóa i<id> không bị gộp thành mảng)', async () => {
  const lap = await login('nv101');
  const res = await lap('/de-xuat/moi', {
    factory_id: '1', title: 'Nhu cầu vật tư qua web',
    'items[0][name]': 'Cảm biến mực nước', 'items[0][material_id]': '1', 'items[0][unit]': 'Cái', 'items[0][quantity]': '2',
    'items[1][name]': 'Dầu tua bin', 'items[1][unit]': 'Lít', 'items[1][quantity]': '200',
    then: 'submit',
  });
  const id = Number(res.headers.get('location').split('/').pop());
  const its = hdb.all('SELECT id FROM request_items WHERE request_id = ? ORDER BY line_no', id);
  assert.equal(its.length, 2);

  await (await login('nv100'))(`/de-xuat/${id}/thao-tac/factory_approve`, {});
  const tpkt = await login('nv010');
  await tpkt(`/de-xuat/${id}/thao-tac/pkt_approve`, { director_id: String(hdb.one(`SELECT id FROM users WHERE sso_id='nv002'`).id) });
  await (await login('nv002'))(`/de-xuat/${id}/thao-tac/director_approve`, {});
  const an = await login('nv021');
  await an(`/de-xuat/${id}/thao-tac/purchase_receive`, {});
  assert.equal(hdb.one('SELECT status FROM requests WHERE id = ?', id).status, 'DANG_BAO_GIA');

  const tpkh = await login('nv020');
  const uid = (sso) => String(hdb.one('SELECT id FROM users WHERE sso_id = ?', sso).id);
  await tpkh(`/de-xuat/${id}/thao-tac/assign_quoters`, { quoter_ids: uid('nv021'), non_competitive: String(its[1].id) });
  // Khóa i<id> trên form báo giá: giá phải vào đúng dòng vật tư
  const quote = await an(`/de-xuat/${id}/thao-tac/quote_add`, {
    supplier: 'Công ty A', [`lines[i${its[0].id}][unit_price]`]: '1000000', [`lines[i${its[0].id}][vat_percent]`]: '10',
  });
  assert.equal(quote.status, 302);
  const line = hdb.one('SELECT l.* FROM quote_lines l JOIN quotes q ON q.id = l.quote_id WHERE q.request_id = ?', id);
  assert.equal(line.request_item_id, its[0].id, 'giá phải gắn đúng id vật tư');
  assert.equal(line.unit_price, 1000000);
  await an(`/de-xuat/${id}/thao-tac/quote_done`, {});
  await tpkh(`/de-xuat/${id}/thao-tac/assign_compiler`, { compiler_id: uid('nv021') });

  // Khóa i<id> trên form so sánh giá
  await an(`/de-xuat/${id}/thao-tac/comparison_submit`, {
    price_approver_id: uid('nv001'), [`selected[i${its[0].id}]`]: String(line.id), comparison_note: 'Chọn Công ty A',
  });
  assert.equal(hdb.one('SELECT status FROM requests WHERE id = ?', id).status, 'CHO_GD_DUYET_GIA');
  assert.equal(hdb.one('SELECT selected_line_id FROM request_items WHERE id = ?', its[0].id).selected_line_id, line.id);
  await (await login('nv001'))(`/de-xuat/${id}/thao-tac/price_approve`, {});
  await an(`/de-xuat/${id}/thao-tac/goods_arrived`, {});
  await lap(`/de-xuat/${id}/thao-tac/goods_received`, {});

  // Khóa i<id> trên form nhận hàng: số lượng nhận phải vào đúng dòng
  await lap(`/de-xuat/${id}/thao-tac/complete`, {
    stock_in: '1',
    [`received[i${its[0].id}][qty]`]: '2', [`received[i${its[0].id}][condition]`]: 'Mới 100%',
    [`received[i${its[1].id}][qty]`]: '180', [`received[i${its[1].id}][condition]`]: 'Đạt',
  });
  assert.equal(hdb.one('SELECT status FROM requests WHERE id = ?', id).status, 'HOAN_THANH');
  const rows = hdb.all('SELECT received_qty, received_condition FROM request_items WHERE request_id = ? ORDER BY line_no', id);
  assert.deepEqual(rows.map((x) => x.received_qty), [2, 180]);
  assert.deepEqual(rows.map((x) => x.received_condition), ['Mới 100%', 'Đạt']);
  assert.equal(hdb.one('SELECT quantity FROM stock WHERE factory_id = 1 AND material_id = 1').quantity, 2);
});

test('lọc danh sách qua URL với tham số lặp / dạng mảng vẫn trả 200', async () => {
  const admin = await login('nv900');
  for (const url of ['/de-xuat?status=CHO_TBP&status=HOAN_THANH', '/de-xuat?status[]=CHO_TBP', '/de-xuat?status=DANG_XU_LY&factory_id=1&q=vật',
    '/de-xuat?page=abc', '/xuat-kho?status[]=NHAP', '/kho?factory_id=xyz', '/ma-vat-tu?scope=company&page=99']) {
    assert.equal((await admin(url)).status, 200, `${url} trả về lỗi`);
  }
});

test('API gợi ý vật tư không để lọt mã riêng / tồn kho của nhà máy khác', async () => {
  const nc3 = hdb.one(`SELECT id FROM factories WHERE code='NC3'`).id;
  const tkTaco = await login('nv102');
  const all = await (await tkTaco(`/api/materials?q=&factory_id=${nc3}`)).json();
  assert.ok(!all.some((m) => m.code === 'NC3-001'), 'không được trả mã riêng của nhà máy mình không có quyền');
  const own = await (await tkTaco('/api/materials?q=cảm&factory_id=1')).json();
  assert.equal(own[0].code, '1-01-00-001');
  const nc3User = await login('nv200');
  const seen = await (await nc3User(`/api/materials?q=&factory_id=${nc3}`)).json();
  assert.ok(seen.some((m) => m.code === 'NC3-001'), 'người của nhà máy đó thì thấy mã riêng');
});

test('đường dẫn chuyển tiếp sau đăng nhập không ra được trang ngoài', async () => {
  const res = await fetch(`${base}/login?next=//evil.test/x`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'sso_id=nv101' });
  assert.equal(res.headers.get('location'), '/');
});

test('phiếu đã hủy không tải được Excel', async () => {
  const tk = await login('nv102');
  hdb.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (1, 1, 20) ON CONFLICT(factory_id, material_id) DO UPDATE SET quantity = 20');
  const res = await tk('/xuat-kho/moi', {
    factory_id: '1', receiver_name: 'Quàng Văn Thư', reason: 'Thay thế',
    'items[0][material_id]': '1', 'items[0][qty_requested]': '2', 'items[0][qty_actual]': '2', then: 'submit',
  });
  const id = Number(res.headers.get('location').split('/').pop());
  const admin = await login('nv900');
  await admin(`/xuat-kho/${id}/thao-tac/cancel`, { comment: 'Lập sai kho' });
  assert.equal(hdb.one('SELECT status FROM issues WHERE id = ?', id).status, 'DA_HUY');
  assert.equal((await tk(`/xuat-kho/${id}/excel`)).status, 403);
  assert.ok(!(await (await tk(`/xuat-kho/${id}`)).text()).includes('BM.06 (Excel)'));
});

test('form lỗi quyền không hiện lại tồn kho của nhà máy khác', async () => {
  hdb.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (1, 1, 777) ON CONFLICT(factory_id, material_id) DO UPDATE SET quantity = 777');
  const nc3 = await login('nv201');
  for (const url of ['/xuat-kho/moi', '/de-xuat/moi']) {
    const res = await nc3(url, { factory_id: '1', receiver_name: 'x', title: 'x', 'items[0][material_id]': '1', 'items[0][name]': 'a', 'items[0][qty_requested]': '1', 'items[0][quantity]': '1' });
    const body = await res.text();
    assert.ok(!body.includes('777'), `${url} lộ tồn kho Tà Cọ`);
    assert.notEqual(res.status, 200);
  }
  // Lỗi nhập liệu của người có quyền vẫn giữ lại dữ liệu đã nhập
  const tk = await login('nv102');
  const res = await tk('/xuat-kho/moi', { factory_id: '1', receiver_name: '', 'items[0][material_id]': '1', 'items[0][qty_requested]': '2' });
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.match(body, /Nhập họ tên người nhận/);
  assert.match(body, /1-01-00-001/);
});

test('mã nhà máy / mã kho trùng nhau khác hoa thường bị từ chối', async () => {
  const admin = await login('nv900');
  await admin('/cai-dat/nha-may', { code: 'taco', name: 'Trùng mã', warehouse_code: 'KHOMOI' });
  await admin('/cai-dat/nha-may', { code: 'MOI', name: 'Trùng mã kho', warehouse_code: 'khotaco' });
  assert.equal(hdb.one(`SELECT COUNT(*) n FROM factories WHERE upper(code) = 'TACO'`).n, 1);
  assert.equal(hdb.one(`SELECT COUNT(*) n FROM factories WHERE upper(warehouse_code) = 'KHOTACO'`).n, 1);
});

test('sửa mã riêng của nhà máy đã ngưng hoạt động vẫn giữ là mã riêng', async () => {
  const id = Number(hdb.run(`INSERT INTO factories (code, name, warehouse_code, active) VALUES ('CU', 'NMTĐ Cũ', 'KHOCU', 0)`).lastInsertRowid);
  const mid = Number(hdb.run('INSERT INTO materials (code, name, factory_id) VALUES (?, ?, ?)', 'CU-001', 'Vật tư nhà máy cũ', id).lastInsertRowid);
  const admin = await login('nv900');
  const page = await (await admin(`/ma-vat-tu/${mid}/sua`)).text();
  assert.match(page, new RegExp(`<option value="${id}" selected>Mã riêng NMTĐ Cũ \\(ngưng hoạt động\\)`));
});
