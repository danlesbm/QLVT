'use strict';
/**
 * Kho gắn với đơn vị SSO: quản trị tích "có kho" cho đơn vị nào thì đơn vị đó có kho.
 * Tên kho luôn lấy theo tên đơn vị trên SSO; nhân sự của kho là người thuộc đơn vị đó.
 */
const { plain } = require('../sso/names');

// Kho đã có ở phần mềm cũ: đơn vị SSO trùng tên thì dùng lại mã kho cũ (để import tồn kho) và ký hiệu số phiếu
const KNOWN_PLANTS = [
  { code: 'TACO', keys: ['taco'], warehouse_code: 'KHOTACO', request_prefix: 'PNC-TC-SBM' },
  { code: 'NC3', keys: ['namcong3', 'nc3'], warehouse_code: 'KHONC3', request_prefix: 'PNC-NC3-SBM' },
  { code: 'NATAU', keys: ['natau'], warehouse_code: 'KHONATAU', request_prefix: 'PNC-NT-SBM' },
  { code: 'SS3', keys: ['suoisap3', 'ss3'], warehouse_code: 'KHOSS3', request_prefix: 'PNC-SS3-SBM' },
  { code: 'TG', keys: ['thoonggot', 'tg'], warehouse_code: 'KHOTG', request_prefix: 'PNC-TG-SBM' },
];

const PREFIX = /^(nha may thuy dien|nha may|nmtd|thuy dien)( |$)/;

/** Tách tên thành các từ không dấu, bỏ tiền tố "NMTĐ" / "Nhà máy (thủy điện)". */
function nameWords(name) {
  let s = plain(name).replace(/[^a-z0-9]+/g, ' ').trim();
  let plant = false;
  for (let m = PREFIX.exec(s); m; m = PREFIX.exec(s)) {
    s = s.slice(m[0].length).trim();
    plant = true;
  }
  return { words: s ? s.split(' ') : [], plant };
}

const initials = (w) => w.map((x) => (/^\d+$/.test(x) ? x : x[0])).join('');

/** Khóa nhận diện tên nhà máy: "NMTĐ Suối Sập 3" -> ["suoisap3", "ss3"]; "TACO" -> ["taco"]. */
function plantKeys(name) {
  const { words, plant } = nameWords(name);
  if (!words.length) return [];
  const keys = [words.join('')];
  if (plant && words.length > 1) keys.push(initials(words));
  return keys;
}

function factoryKeys(f) {
  const keys = [...plantKeys(f.name), ...plantKeys(f.code), ...plantKeys(String(f.warehouse_code || '').replace(/^kho/i, ''))];
  const known = KNOWN_PLANTS.find((k) => k.code === String(f.code || '').toUpperCase());
  if (known) keys.push(...known.keys);
  return keys;
}

const noDigits = (keys) => keys.map((k) => k.replace(/\d+/g, '')).filter(Boolean);

/**
 * Ghép từng phần tử bên trái với đúng một phần tử bên phải có khóa trùng (và ngược lại).
 * Lượt 1 so khóa đầy đủ; lượt 2 bỏ chữ số (vd "Nậm Công" khớp "Nậm Công 3") cho phần chưa ghép được.
 * Trùng nhiều hơn một thì không ghép (để quản trị tự chọn).
 */
function pairUnique(left, right, leftKeys, rightKeys) {
  const pairs = new Map();
  for (const strip of [false, true]) {
    const L = left.filter((l) => !pairs.has(l));
    const R = right.filter((r) => ![...pairs.values()].includes(r));
    const lk = new Map(L.map((l) => [l, new Set(strip ? noDigits(leftKeys(l)) : leftKeys(l))]));
    const rk = new Map(R.map((r) => [r, strip ? noDigits(rightKeys(r)) : rightKeys(r)]));
    const hits = (l, r) => rk.get(r).some((k) => lk.get(l).has(k));
    for (const l of L) {
      const rs = R.filter((r) => hits(l, r));
      if (rs.length !== 1) continue;
      if (L.filter((x) => hits(x, rs[0])).length !== 1) continue;
      pairs.set(l, rs[0]);
    }
  }
  return pairs;
}

const knownPlantFor = (name) => pairUnique([name], KNOWN_PLANTS, plantKeys, (k) => k.keys).get(name) || null;

/** Gắn kho với đơn vị SSO; tên kho lấy theo tên đơn vị. */
function linkFactory(db, factoryId, departmentId) {
  db.run('UPDATE departments SET factory_id = NULL WHERE factory_id = ? AND id IN (SELECT department_id FROM factories WHERE id = ?)', factoryId, factoryId);
  db.run('UPDATE factories SET department_id = ? WHERE id = ?', departmentId, factoryId);
  db.run('UPDATE departments SET factory_id = ? WHERE id = ?', factoryId, departmentId);
  refreshFactoryNames(db);
}

/** Tên kho theo tên đơn vị SSO (chạy sau mỗi lần đồng bộ). Tên kho tự đặt theo dạng "Kho <tên>" cũng đổi theo. */
function refreshFactoryNames(db) {
  const dn = '(SELECT d.name FROM departments d WHERE d.id = factories.department_id)';
  db.run(
    `UPDATE factories SET
       warehouse_name = CASE WHEN warehouse_name IS NULL OR warehouse_name = '' OR warehouse_name = 'Kho ' || name THEN 'Kho ' || ${dn} ELSE warehouse_name END,
       name = ${dn}
     WHERE department_id IS NOT NULL AND name IS NOT ${dn}`,
  );
  // Đơn vị chính của kho luôn thuộc kho đó
  db.run(
    `UPDATE departments SET factory_id = (SELECT f.id FROM factories f WHERE f.department_id = departments.id)
      WHERE id IN (SELECT department_id FROM factories WHERE department_id IS NOT NULL)
        AND factory_id IS NOT (SELECT f.id FROM factories f WHERE f.department_id = departments.id)`,
  );
}

/** Kho đang hoạt động chưa gắn đơn vị SSO (dữ liệu từ bản trước): tự gắn khi tên khớp duy nhất một đơn vị. */
function autoLinkFactories(db) {
  const facs = db.all('SELECT * FROM factories WHERE department_id IS NULL AND active = 1');
  if (!facs.length) return [];
  const deps = db.all('SELECT * FROM departments WHERE active = 1 AND virtual = 0 AND id NOT IN (SELECT department_id FROM factories WHERE department_id IS NOT NULL)');
  const pairs = pairUnique(facs, deps, factoryKeys, (d) => plantKeys(d.name));
  for (const [f, d] of pairs) linkFactory(db, f.id, d.id);
  return [...pairs].map(([f, d]) => `${f.code} → ${d.name}`);
}

function uniqueValue(db, col, base) {
  const taken = (v) => db.one(`SELECT 1 FROM factories WHERE upper(${col}) = upper(?)`, v);
  let v = base;
  for (let i = 2; taken(v); i++) v = `${base}${i}`;
  return v;
}

/** Tạo kho cho đơn vị SSO (hoặc dùng lại kho cũ chưa gắn đơn vị có tên khớp). Trả về id kho. */
function enableWarehouse(db, dept) {
  const legacy = db.all('SELECT * FROM factories WHERE department_id IS NULL');
  const match = pairUnique([dept], legacy, (d) => plantKeys(d.name), factoryKeys).get(dept);
  if (match) {
    linkFactory(db, match.id, dept.id);
    db.run('UPDATE factories SET active = 1 WHERE id = ?', match.id);
    return match.id;
  }
  const known = knownPlantFor(dept.name);
  const free = (col, v) => v && !db.one(`SELECT 1 FROM factories WHERE upper(${col}) = upper(?)`, v);
  const { words } = nameWords(dept.name);
  const guess = (words.length > 1 ? initials(words) : (words[0] || 'kho').slice(0, 8)).toUpperCase();
  const code = known && free('code', known.code) ? known.code : uniqueValue(db, 'code', guess);
  const wh = known && free('warehouse_code', known.warehouse_code) ? known.warehouse_code : free('warehouse_code', `KHO${code}`) ? `KHO${code}` : null;
  const sort = (db.one('SELECT MAX(sort) m FROM factories').m || 0) + 1;
  const id = Number(
    db.run(
      'INSERT INTO factories (code, name, warehouse_code, warehouse_name, request_prefix, sort, active, department_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?)',
      code, dept.name, wh, `Kho ${dept.name}`, known ? known.request_prefix : `PNC-${code}-SBM`, sort, dept.id,
    ).lastInsertRowid,
  );
  db.run('UPDATE departments SET factory_id = ? WHERE id = ?', id, dept.id);
  return id;
}

/**
 * Lưu danh sách đơn vị có kho. shownIds: các đơn vị hiện trên trang (chỉ xét các đơn vị này);
 * tickedIds: đơn vị được tích. Bỏ tích thì ngưng hoạt động kho (giữ nguyên dữ liệu, tích lại là dùng tiếp).
 */
function setWarehouseUnits(db, shownIds, tickedIds) {
  const ticked = new Set(tickedIds.map(Number));
  const out = { enabled: [], disabled: [] };
  for (const did of new Set(shownIds.map(Number))) {
    const d = db.one('SELECT * FROM departments WHERE id = ? AND virtual = 0', did);
    if (!d) continue;
    const f = db.one('SELECT * FROM factories WHERE department_id = ?', did);
    if (ticked.has(did)) {
      if (f && f.active) continue;
      if (f) db.run('UPDATE factories SET active = 1 WHERE id = ?', f.id);
      else enableWarehouse(db, d);
      out.enabled.push(d.name);
    } else if (f && f.active) {
      db.run('UPDATE factories SET active = 0 WHERE id = ?', f.id);
      out.disabled.push(d.name);
    }
  }
  return out;
}

module.exports = { KNOWN_PLANTS, plantKeys, factoryKeys, pairUnique, linkFactory, refreshFactoryNames, autoLinkFactories, enableWarehouse, setWarehouseUnits };
