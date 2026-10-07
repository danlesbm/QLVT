'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { open } = require('../src/db');
const { seedDemo } = require('../src/db/demo');
const { loadAccess } = require('../src/auth/access');
const requests = require('../src/services/requests');
const issues = require('../src/services/issues');
const materials = require('../src/services/materials');

function setup() {
  const db = open(':memory:');
  seedDemo(db, { admin: null });
  const as = (sso) => {
    const user = db.one('SELECT * FROM users WHERE sso_id = ?', sso);
    return { user, access: loadAccess(db, user) };
  };
  const taco = db.one(`SELECT id FROM factories WHERE code = 'TACO'`).id;
  const mat = db.run(`INSERT INTO materials (code, name, unit) VALUES ('1-01-00-001', 'Cảm biến mực nước', 'Cái')`).lastInsertRowid;
  return { db, as, taco, mat: Number(mat) };
}

const run = (db, who, id, action, data, file) => requests.act(db, who.user, who.access, id, action, data, file);

test('quy trình phiếu đề xuất đầy đủ từ lập phiếu đến hoàn thành và nhập kho', () => {
  const { db, as, taco, mat } = setup();
  const lap = as('nv101');
  const gdnm = as('nv100');
  const tpkt = as('nv010');
  const pkt = as('nv011');
  const gd = as('nv002');
  const tpkh = as('nv020');
  const [an, binh, cuong] = ['nv021', 'nv022', 'nv023'].map(as);

  const id = requests.create(db, lap.user, lap.access, {
    factory_id: taco,
    title: 'Nhu cầu vật tư tháng 10/2026',
    items: [
      { material_id: mat, name: 'Cảm biến mực nước', quantity: '2', unit: 'Cái' },
      { name: 'Dầu tua bin', quantity: '200', unit: 'Lít' },
    ],
  });
  assert.equal(requests.get(db, id).status, 'NHAP');

  // GĐ nhà máy chưa thể duyệt khi phiếu còn nháp
  assert.throws(() => run(db, gdnm, id, 'factory_approve'), /không thể/);

  run(db, lap, id, 'submit');
  let r = requests.get(db, id);
  assert.equal(r.status, 'CHO_TBP');
  assert.equal(r.number, '1/PNC-TC-SBM');

  // Từ chối phải có lý do, rồi quay về người lập
  assert.throws(() => run(db, gdnm, id, 'reject', {}), /lý do/);
  run(db, gdnm, id, 'reject', { comment: 'Thiếu mã thiết bị' });
  assert.equal(requests.get(db, id).status, 'TRA_LAI');
  run(db, lap, id, 'submit');
  assert.equal(requests.get(db, id).number, '1/PNC-TC-SBM', 'giữ nguyên số phiếu khi trình lại');

  run(db, gdnm, id, 'factory_approve');
  assert.equal(requests.get(db, id).status, 'CHO_PKT');

  run(db, tpkt, id, 'pkt_assign', { reviewer_id: pkt.user.id });
  run(db, pkt, id, 'pkt_check', { comment: 'Đã kiểm soát' });
  assert.equal(requests.get(db, id).status, 'CHO_TPKT');
  run(db, tpkt, id, 'pkt_approve', { director_id: gd.user.id });
  assert.equal(requests.get(db, id).status, 'CHO_DUYET_NHU_CAU');

  // Chỉ GĐ/PGĐ được phân công mới duyệt được
  assert.throws(() => run(db, as('nv001'), id, 'director_approve'), /không thể/);
  run(db, gd, id, 'director_approve');
  r = requests.get(db, id);
  assert.equal(r.status, 'CHO_MS_XAC_NHAN');
  assert.ok(r.demand_approved_at);

  run(db, an, id, 'purchase_receive');
  assert.equal(requests.get(db, id).status, 'DANG_BAO_GIA');

  const its = requests.items(db, id);
  assert.throws(() => run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id, binh.user.id, cuong.user.id, tpkh.user.id] }), /tối đa 3/);
  run(db, tpkh, id, 'assign_quoters', { quoter_ids: [an.user.id, binh.user.id, cuong.user.id], non_competitive: [its[1].id] });

  const quote = (who, supplier, p1, p2) => run(db, who, id, 'quote_add', {
    supplier,
    lines: { [its[0].id]: { unit_price: p1 }, ...(p2 ? { [its[1].id]: { unit_price: p2 } } : {}) },
  });
  quote(an, 'Công ty A', '1000000', '50000');
  quote(binh, 'Công ty B', '900000');

  // Niêm phong: chưa đủ báo giá thì TP và GĐ không thấy, nhân viên chỉ thấy của mình
  assert.equal(requests.visibleQuotes(db, id, tpkh.user).quotes.length, 0);
  assert.equal(requests.visibleQuotes(db, id, gd.user).quotes.length, 0);
  assert.deepEqual(requests.visibleQuotes(db, id, an.user).quotes.map((q) => q.supplier), ['Công ty A']);
  assert.ok(!requests.availableActions(db, tpkh.access, tpkh.user, requests.get(db, id)).has('assign_compiler'));

  run(db, an, id, 'quote_done');
  run(db, binh, id, 'quote_done');
  assert.throws(() => run(db, cuong, id, 'quote_done', {}), /lý do/);
  run(db, cuong, id, 'quote_done', { comment: 'Không lấy được thêm báo giá' });

  const v = requests.visibleQuotes(db, id, tpkh.user);
  assert.ok(v.unsealed);
  assert.equal(v.quotes.length, 2);
  assert.equal(requests.visibleQuotes(db, id, gd.user).quotes.length, 2);

  assert.throws(() => run(db, tpkh, id, 'assign_compiler', { compiler_id: tpkh.user.id }), /một trong các nhân viên/);
  run(db, tpkh, id, 'assign_compiler', { compiler_id: binh.user.id });
  assert.equal(requests.get(db, id).status, 'DANG_TONG_HOP');

  const lineA = v.quotes.find((q) => q.supplier === 'Công ty A');
  const lineB = v.quotes.find((q) => q.supplier === 'Công ty B');
  run(db, binh, id, 'comparison_submit', {
    price_approver_id: as('nv001').user.id,
    selected: { [its[0].id]: lineB.byItem[its[0].id].id, [its[1].id]: lineA.byItem[its[1].id].id },
  });
  assert.equal(requests.get(db, id).status, 'CHO_GD_DUYET_GIA');
  run(db, as('nv001'), id, 'reject', { comment: 'Xem lại giá dầu' });
  assert.equal(requests.get(db, id).status, 'DANG_TONG_HOP');
  run(db, binh, id, 'comparison_submit', {
    price_approver_id: as('nv001').user.id,
    selected: { [its[0].id]: lineB.byItem[its[0].id].id, [its[1].id]: lineA.byItem[its[1].id].id },
  });
  run(db, as('nv001'), id, 'price_approve');
  assert.equal(requests.get(db, id).status, 'DANG_MUA_SAM');

  run(db, an, id, 'goods_arrived');
  assert.equal(requests.get(db, id).status, 'CHO_CHUYEN_HANG');
  run(db, lap, id, 'goods_received');
  assert.equal(requests.get(db, id).status, 'CHO_KIEM_TRA_HANG');
  run(db, lap, id, 'complete', { stock_in: '1', received: { [its[0].id]: { qty: '2', condition: 'Mới 100%' } } });
  assert.equal(requests.get(db, id).status, 'HOAN_THANH');

  const s = db.one('SELECT quantity FROM stock WHERE factory_id = ? AND material_id = ?', taco, mat);
  assert.equal(s.quantity, 2);
  const h = requests.history(db, id);
  assert.ok(h.some((x) => x.action === 'reject' && x.comment === 'Thiếu mã thiết bị'));
  assert.ok(h.length > 15);
});

test('người khác nhà máy không lập / duyệt được phiếu của nhà máy khác', () => {
  const { db, as, taco } = setup();
  const nc3 = as('nv201');
  assert.throws(() => requests.create(db, nc3.user, nc3.access, { factory_id: taco, title: 'x', items: [{ name: 'a', quantity: 1 }] }), /không có quyền/);
  const lap = as('nv101');
  const id = requests.create(db, lap.user, lap.access, { factory_id: taco, title: 'x', items: [{ name: 'a', quantity: 1 }] });
  run(db, lap, id, 'submit');
  assert.throws(() => run(db, as('nv200'), id, 'factory_approve'), /không thể/);
});

test('duyệt giá ngoài phần mềm chuyển thẳng sang đang mua sắm', () => {
  const { db, as, taco } = setup();
  const lap = as('nv101');
  const id = requests.create(db, lap.user, lap.access, { factory_id: taco, title: 'x', items: [{ name: 'a', quantity: 1 }] });
  db.run(`UPDATE requests SET status = 'DANG_TONG_HOP' WHERE id = ?`, id);
  assert.throws(() => run(db, as('nv020'), id, 'price_external', {}), /trình duyệt ngoài/);
  run(db, as('nv020'), id, 'price_external', { comment: 'Tờ trình số 12/TTr ngày 10/10/2026' });
  const r = requests.get(db, id);
  assert.equal(r.status, 'DANG_MUA_SAM');
  assert.equal(r.price_external, 1);
});

test('phiếu xuất kho: kiểm tra tồn, GĐ nhà máy duyệt thì trừ kho', () => {
  const { db, as, taco, mat } = setup();
  const tk = as('nv102');
  db.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, ?, 5)', taco, mat);
  const id = issues.create(db, tk.user, tk.access, {
    factory_id: taco,
    receiver_name: 'Quàng Văn Thư',
    reason: 'Thay thế cảm biến',
    items: [{ material_id: mat, qty_requested: '3', qty_actual: '3' }],
  });
  issues.act(db, tk.user, tk.access, id, 'submit');
  assert.equal(issues.get(db, id).status, 'CHO_DUYET');
  assert.match(issues.get(db, id).number, /^PXK-TACO-\d{4}-0001$/);
  assert.throws(() => issues.act(db, tk.user, tk.access, id, 'approve'), /không thể/);
  const gd = as('nv100');
  issues.act(db, gd.user, gd.access, id, 'approve');
  assert.equal(issues.get(db, id).status, 'HOAN_THANH');
  assert.equal(db.one('SELECT quantity FROM stock WHERE material_id = ?', mat).quantity, 2);

  const id2 = issues.create(db, tk.user, tk.access, { factory_id: taco, receiver_name: 'A', items: [{ material_id: mat, qty_requested: '9' }] });
  assert.throws(() => issues.act(db, tk.user, tk.access, id2, 'submit'), /Không đủ tồn kho/);
});

test('mã vật tư: gợi ý mã tiếp theo và phân quyền đánh mã theo phạm vi', () => {
  const { db, as, taco } = setup();
  db.run(`INSERT INTO materials (code, name) VALUES ('1-01-00-00-02-02-005', 'x'), ('1-01-00-00-02-02-006', 'y')`);
  assert.equal(materials.suggestCode(db, '1-01-00-00-02-02'), '1-01-00-00-02-02-007');
  const tk = as('nv102');
  const id = materials.save(db, tk.user, tk.access, { code: 'TC-001', name: 'Vật tư riêng Tà Cọ', factory_id: taco });
  assert.ok(id);
  assert.throws(() => materials.save(db, tk.user, tk.access, { code: 'C-001', name: 'Mã chung' }), /chung toàn công ty/);
  assert.throws(() => materials.save(db, tk.user, tk.access, { code: 'TC-001', name: 'Trùng', factory_id: taco }), /đã tồn tại/);
});
