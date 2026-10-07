'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qlvt-up-'));
process.env.SSO_MODE = 'mock';

const ExcelJS = require('exceljs');
const { open } = require('../src/db');
const { seedDemo } = require('../src/db/demo');
const { createApp } = require('../src/app');

let server;
let base;
let db;

test.before(async () => {
  db = open(':memory:');
  seedDemo(db);
  db.run(`INSERT INTO materials (code, name, unit) VALUES ('1-01-00-001', 'Cảm biến mực nước', 'Cái')`);
  db.run(`INSERT INTO stock (factory_id, material_id, quantity) VALUES ((SELECT id FROM factories WHERE code='TACO'), 1, 10)`);
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

/** Đăng nhập SSO giả lập, trả về hàm gọi HTTP mang cookie + csrf. */
async function login(ssoId) {
  const res = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `sso_id=${ssoId}` });
  assert.equal(res.status, 302);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const sid = cookie.split('=')[1];
  const { csrf } = db.one('SELECT csrf FROM sessions WHERE id = ?', sid);
  const call = async (url, form) => {
    const opts = { redirect: 'manual', headers: { cookie } };
    if (form) {
      opts.method = 'POST';
      opts.headers['content-type'] = 'application/x-www-form-urlencoded';
      opts.headers.referer = `${base}${url}`;
      opts.body = new URLSearchParams({ _csrf: csrf, ...form }).toString();
    }
    return fetch(base + url, opts);
  };
  return call;
}

test('chưa đăng nhập thì chuyển về trang đăng nhập', async () => {
  const res = await fetch(`${base}/kho`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /^\/login/);
  const page = await fetch(`${base}/login`);
  assert.match(await page.text(), /Quàng Văn Thư/);
});

test('quản trị mở được mọi màn hình chính', async () => {
  const admin = await login('nv900');
  for (const url of ['/', '/de-xuat', '/de-xuat/moi', '/xuat-kho', '/xuat-kho/moi', '/kho', '/kho/them', '/kho/import', '/ma-vat-tu', '/ma-vat-tu/moi',
    '/cai-dat', '/cai-dat/nguoi-dung', '/cai-dat/nguoi-dung/1', '/cai-dat/nhom-quyen', '/cai-dat/nhom-quyen/1', '/cai-dat/nha-may/1', '/kho/1']) {
    const res = await admin(url);
    assert.equal(res.status, 200, `${url} trả ${res.status}`);
  }
  const api = await (await admin('/api/materials?q=cảm&factory_id=1')).json();
  assert.equal(api[0].code, '1-01-00-001');
  assert.equal(api[0].stock_qty, 10);
});

test('POST thiếu mã CSRF bị chặn', async () => {
  const call = await login('nv101');
  const res = await call('/de-xuat/moi', { factory_id: '1', title: 'x' });
  assert.equal(res.status, 302); // có csrf hợp lệ thì vào nghiệp vụ
  const cookie = (await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'sso_id=nv101' })).headers.get('set-cookie').split(';')[0];
  const bad = await fetch(`${base}/de-xuat/moi`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'factory_id=1&title=x' });
  assert.equal(bad.status, 403);
});

test('người không có quyền không vào được cài đặt', async () => {
  const call = await login('nv101');
  assert.equal((await call('/cai-dat')).status, 403);
});

test('lập phiếu đề xuất qua giao diện, duyệt và tải Excel theo mẫu', async () => {
  const lap = await login('nv101');
  const res = await lap('/de-xuat/moi', {
    factory_id: '1', title: 'Nhu cầu vật tư tháng 10/2026', basis: 'Căn cứ công việc vận hành',
    'items[0][name]': 'Kiểm định cảm biến mực nước hồ chứa', 'items[0][model]': 'Waterpilot FMX21/ Endress+Hauser/ Đức',
    'items[0][unit]': 'Cái', 'items[0][quantity]': '1', 'items[0][use_time]': '10-2026', 'items[0][purpose]': 'Kiểm định định kỳ', then: 'submit',
  });
  assert.equal(res.status, 302);
  const id = Number(res.headers.get('location').split('/').pop());
  assert.equal(db.one('SELECT status FROM requests WHERE id = ?', id).status, 'CHO_TBP');
  const detail = await (await lap(`/de-xuat/${id}`)).text();
  assert.match(detail, /Chờ Trưởng bộ phận xem xét/);

  const gdnm = await login('nv100');
  await gdnm(`/de-xuat/${id}/thao-tac/factory_approve`, { comment: 'Đồng ý' });
  const tpkt = await login('nv010');
  const pktPage = await (await tpkt(`/de-xuat/${id}`)).text();
  assert.match(pktPage, /Phân công người kiểm soát/);
  await tpkt(`/de-xuat/${id}/thao-tac/pkt_assign`, { reviewer_id: String(db.one(`SELECT id FROM users WHERE sso_id='nv011'`).id) });
  await (await login('nv011'))(`/de-xuat/${id}/thao-tac/pkt_check`, {});
  await tpkt(`/de-xuat/${id}/thao-tac/pkt_approve`, { director_id: String(db.one(`SELECT id FROM users WHERE sso_id='nv001'`).id) });
  // Chưa duyệt nhu cầu thì chưa tải được phiếu
  assert.equal((await lap(`/de-xuat/${id}/excel`)).status, 403);
  const gd = await login('nv001');
  await gd(`/de-xuat/${id}/thao-tac/director_approve`, {});
  assert.equal(db.one('SELECT status FROM requests WHERE id = ?', id).status, 'CHO_MS_XAC_NHAN');

  const xl = await lap(`/de-xuat/${id}/excel`);
  assert.equal(xl.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xl.arrayBuffer()));
  const text = [];
  wb.worksheets[0].eachRow((r) => r.eachCell((c) => text.push(String(c.value))));
  const all = text.join('|');
  assert.match(all, /PHIẾU NHU CẦU VẬT TƯ/);
  assert.match(all, /1\/PNC-TC-SBM/);
  for (const name of ['Quàng Văn Thư', 'Lò Văn Thìn', 'Phạm Văn Hảo', 'Lê Đắc Dần']) assert.ok(all.includes(name), `thiếu chữ ký ${name}`);
});

test('phiếu xuất kho BM.06: lập, duyệt, trừ tồn và xuất Excel', async () => {
  const tk = await login('nv102');
  const res = await tk('/xuat-kho/moi', {
    factory_id: '1', receiver_name: 'Quàng Văn Thư', reason: 'Thay thế', 'items[0][material_id]': '1', 'items[0][qty_requested]': '4', 'items[0][qty_actual]': '3', then: 'submit',
  });
  const id = Number(res.headers.get('location').split('/').pop());
  assert.equal(db.one('SELECT status FROM issues WHERE id = ?', id).status, 'CHO_DUYET');
  await (await login('nv100'))(`/xuat-kho/${id}/thao-tac/approve`, {});
  assert.equal(db.one('SELECT quantity FROM stock WHERE material_id = 1').quantity, 7);
  const xl = await tk(`/xuat-kho/${id}/excel`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xl.arrayBuffer()));
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('H1').value, 'BM.06');
  assert.equal(ws.getCell('E3').value, 'PHIẾU XUẤT KHO');
  assert.equal(ws.getCell('F12').value, 3);
});
