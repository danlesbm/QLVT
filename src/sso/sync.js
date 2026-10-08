'use strict';
const { cleanName, posRank } = require('./names');
const plants = require('../services/plants');

const now = () => new Date().toISOString();
const n = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const txt = (v) => String(v ?? '').trim();

// HĐQT / Ban kiểm soát / Ban giám đốc trên SSO là chức vụ không gắn phòng (deptId rỗng):
// tạo "đơn vị ảo" để hiển thị và lọc như phòng ban thường (giống Payroll). Đơn vị ảo không có kho.
const VIRTUAL = {
  'hội đồng quản trị': ['role:HDQT', 'Hội đồng quản trị'],
  'ban kiểm soát': ['role:BKS', 'Ban Kiểm soát'],
  'giám đốc': ['role:BGD', 'Ban Giám đốc'],
  'phó gđ': ['role:BGD', 'Ban Giám đốc'],
};
// "Người phụ trách" một đơn vị thường thuộc đơn vị khác: không tính là nhân sự của đơn vị đó
const NOT_MEMBER = new Set(['người phụ trách']);

/**
 * Chuẩn hóa danh bạ SSO Portal { users, departments, assignments } thành
 * { departments: [{id, name, virtual}], positions: [{id, name}], users: [hồ sơ] }.
 * Mỗi hồ sơ: id, username, email, full_name (đã bỏ chức danh), locked, department_id (đơn vị chính),
 * position_id (chức vụ cao nhất), memberships [{deptId, role, member}].
 */
function normalizeDirectory(dir) {
  const deps = new Map();
  for (const d of dir.departments || []) {
    if (d && txt(d.id)) deps.set(txt(d.id), { id: txt(d.id), name: txt(d.name) || txt(d.id), virtual: 0, placeholder: 0 });
  }
  const roles = new Set();
  const byUser = new Map();
  for (const a of dir.assignments || []) {
    if (!a || !txt(a.userId)) continue;
    const role = txt(a.role);
    if (role) roles.add(role);
    const v = VIRTUAL[role.toLowerCase()];
    let deptId = null;
    let member = 0;
    if (v) {
      [deptId] = v;
      if (!deps.has(deptId)) deps.set(deptId, { id: deptId, name: v[1], virtual: 1, placeholder: 0 });
      member = 1;
    } else if (txt(a.deptId)) {
      deptId = txt(a.deptId);
      // Phòng ban chỉ có trong phân công (không có trong danh sách phòng ban): tạm lấy id làm tên
      if (!deps.has(deptId)) deps.set(deptId, { id: deptId, name: deptId, virtual: 0, placeholder: 1 });
      member = NOT_MEMBER.has(role.toLowerCase()) ? 0 : 1;
    }
    const k = txt(a.userId);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push({ deptId, role, member, rank: posRank(role) });
  }
  const users = [];
  for (const u of dir.users || []) {
    if (!u || !txt(u.id)) continue;
    const id = txt(u.id);
    const as = byUser.get(id) || [];
    const positions = [...new Set(as.map((a) => a.role).filter(Boolean))];
    const raw = txt(u.name) || txt(u.displayName) || txt(u.username) || txt(u.email) || id;
    const byRank = [...as].sort((x, y) => x.rank - y.rank);
    const withDept = byRank.filter((a) => a.deptId);
    // Đơn vị chính: phòng ban thật mình là nhân sự > đơn vị ảo (HĐQT/BKS/BGĐ) > đơn vị mình phụ trách
    const main = withDept.find((a) => a.member && !deps.get(a.deptId).virtual) || withDept.find((a) => a.member) || withDept[0];
    const memberships = new Map();
    for (const a of withDept) memberships.set(`${a.deptId}\u0000${a.role}`, { deptId: a.deptId, role: a.role, member: a.member });
    users.push({
      id,
      username: n(txt(u.username)),
      email: n(txt(u.email)),
      full_name: cleanName(raw, positions.join(', ')) || raw,
      locked: txt(u.status).toLowerCase() === 'locked',
      department_id: main ? main.deptId : null,
      position_id: byRank[0] && byRank[0].role ? byRank[0].role : null,
      memberships: [...memberships.values()],
    });
  }
  return { departments: [...deps.values()], positions: [...roles].map((r) => ({ id: r, name: r })), users };
}

/** Đồng bộ danh bạ SSO (phòng ban / nhà máy, chức vụ, CBCNV) vào CSDL QLVT. */
function syncDirectory(db, dir, opts = {}) {
  const nd = normalizeDirectory(dir);
  return db.tx(() => {
    const stamp = now();
    const upDep = db.prepare(
      `INSERT INTO departments (sso_id, name, virtual, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(sso_id) DO UPDATE SET name = excluded.name, virtual = excluded.virtual, active = 1`,
    );
    // Phòng ban tạm (chỉ thấy trong phân công) không ghi đè tên / trạng thái phòng ban đã có
    const addDep = db.prepare(`INSERT INTO departments (sso_id, name, virtual, active) VALUES (?, ?, 0, 1) ON CONFLICT(sso_id) DO NOTHING`);
    for (const d of nd.departments) {
      if (d.placeholder) addDep.run(d.id, d.name);
      else upDep.run(d.id, d.name, d.virtual);
    }
    const upPos = db.prepare(
      `INSERT INTO positions (sso_id, name, active) VALUES (?, ?, 1)
       ON CONFLICT(sso_id) DO UPDATE SET name = excluded.name, active = 1`,
    );
    for (const p of nd.positions) upPos.run(p.id, p.name);
    // An toàn: nếu danh sách trả về rỗng hoặc ít hơn một nửa số đang có (SSO lỗi, phân trang...)
    // thì không ngưng ai / không xóa phân công nào, chỉ cảnh báo.
    const warnings = [];
    const assigned = (dir.assignments || []).length;
    const current = db.one('SELECT COUNT(*) n FROM user_departments ud JOIN users u ON u.id = ud.user_id WHERE u.active = 1').n;
    const trustAssignments = current === 0 || (assigned > 0 && assigned >= current * 0.5);
    if (!trustAssignments) warnings.push(`SSO chỉ trả về ${assigned}/${current} phân công phòng ban: giữ nguyên đơn vị, chức vụ của CBCNV`);
    for (const u of nd.users) upsertUser(db, u, { ...opts, stamp, memberships: trustAssignments });

    // Đơn vị / chức vụ / người không còn trong SSO thì ngưng hoạt động.
    // Chỉ tính phòng ban SSO liệt kê (và đơn vị ảo đang dùng); phòng ban tạm không giữ phòng ban cũ khỏi bị ngưng.
    const realDeps = nd.departments.filter((d) => !d.virtual && !d.placeholder);
    const keepDeps = nd.departments.filter((d) => !d.placeholder);
    // Chức vụ ngưng hoạt động không ảnh hưởng ai (chỉ để đếm) nên chỉ bỏ qua khi SSO không trả về chức vụ nào
    if (nd.positions.length) db.run(`UPDATE positions SET active = 0 WHERE active = 1 AND sso_id NOT IN (${nd.positions.map(() => '?').join(',')})`, ...nd.positions.map((p) => p.id));
    const checks = [
      ['departments', 'virtual = 0', realDeps, keepDeps, 'phòng ban / nhà máy'],
      ['users', '1 = 1', nd.users, nd.users, 'CBCNV'],
    ];
    for (const [table, where, counted, keep, label] of checks) {
      const active = db.one(`SELECT COUNT(*) n FROM ${table} WHERE active = 1 AND ${where}`).n;
      if (!counted.length || counted.length < active * 0.5) {
        warnings.push(`SSO chỉ trả về ${counted.length}/${active} ${label} đang hoạt động: bỏ qua bước ngưng hoạt động`);
        continue;
      }
      const ids = keep.map((r) => r.id);
      const notIn = `sso_id NOT IN (${ids.map(() => '?').join(',')})`;
      db.run(`UPDATE ${table} SET active = 0 WHERE active = 1 AND ${notIn}`, ...ids);
      // Người đã rời SSO: bỏ luôn phân công phòng ban (không còn là nhân sự kho nào)
      if (table === 'users') db.run(`DELETE FROM user_departments WHERE user_id IN (SELECT id FROM users WHERE ${notIn})`, ...ids);
    }

    // Kho: tên theo đơn vị SSO; kho của bản trước chưa gắn đơn vị thì tự gắn khi tên khớp
    const linked = plants.autoLinkFactories(db);
    plants.refreshFactoryNames(db);
    for (const f of db.all(
      `SELECT f.name FROM factories f JOIN departments d ON d.id = f.department_id WHERE f.active = 1 AND d.active = 0`,
    )) warnings.push(`Đơn vị có kho "${f.name}" không còn trên SSO`);
    return { users: nd.users.length, departments: realDeps.length, positions: nd.positions.length, linked, warnings };
  });
}

/**
 * Thêm/cập nhật 1 người dùng từ hồ sơ SSO đã chuẩn hóa. Trả về bản ghi users.
 * opts.memberships: ghi lại đơn vị chính, chức vụ và danh sách đơn vị (khi hồ sơ có đủ thông tin phân công).
 * opts.ssoAdmin: người dùng là quản trị trên SSO (chỉ biết khi đăng nhập).
 */
function upsertUser(db, p, opts = {}) {
  const { stamp = now(), adminSsoIds = [], bootstrapEmails = [], memberships = false } = opts;
  const ref = (table, ssoId) => (ssoId != null ? db.one(`SELECT id FROM ${table} WHERE sso_id = ?`, String(ssoId))?.id ?? null : null);
  const dep = memberships ? ref('departments', p.department_id) : null;
  const pos = memberships ? ref('positions', p.position_id) : null;
  db.run(
    `INSERT INTO users (sso_id, username, full_name, email, department_id, position_id, active, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(sso_id) DO UPDATE SET username = excluded.username, full_name = excluded.full_name, email = excluded.email,
       department_id = ${memberships ? 'excluded.department_id' : 'users.department_id'},
       position_id = ${memberships ? 'excluded.position_id' : 'users.position_id'},
       active = excluded.active, synced_at = excluded.synced_at`,
    String(p.id), n(p.username), p.full_name || p.username || String(p.id), n(p.email), dep, pos, p.locked ? 0 : 1, stamp,
  );
  const user = db.one('SELECT id FROM users WHERE sso_id = ?', String(p.id));
  if (memberships) {
    db.run('DELETE FROM user_departments WHERE user_id = ?', user.id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_departments (user_id, department_id, role, member) VALUES (?, ?, ?, ?)');
    for (const m of p.memberships || []) {
      const d = ref('departments', m.deptId);
      if (d) ins.run(user.id, d, m.role || '', m.member ? 1 : 0);
    }
  }
  const email = String(p.email || '').toLowerCase();
  if (adminSsoIds.includes(String(p.id)) || (email && bootstrapEmails.includes(email))) db.run('UPDATE users SET is_admin = 1 WHERE id = ?', user.id);
  if (opts.ssoAdmin !== undefined) db.run('UPDATE users SET sso_admin = ? WHERE id = ?', opts.ssoAdmin ? 1 : 0, user.id);
  return db.one('SELECT * FROM users WHERE id = ?', user.id);
}

module.exports = { normalizeDirectory, syncDirectory, upsertUser };
