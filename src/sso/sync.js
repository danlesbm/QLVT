'use strict';

const now = () => new Date().toISOString();
const n = (v) => (v === undefined || v === '' ? null : v);

/** Đồng bộ danh bạ (bộ phận, chức vụ, CBCNV) từ SSO vào CSDL QLVT. */
function syncDirectory(db, dir, adminSsoIds = []) {
  return db.tx(() => {
    const stamp = now();
    const upDep = db.prepare(
      `INSERT INTO departments (sso_id, code, name, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(sso_id) DO UPDATE SET code = excluded.code, name = excluded.name, active = 1`,
    );
    for (const d of dir.departments) upDep.run(String(d.id), n(d.code), d.name);
    const upPos = db.prepare(
      `INSERT INTO positions (sso_id, code, name, active) VALUES (?, ?, ?, 1)
       ON CONFLICT(sso_id) DO UPDATE SET code = excluded.code, name = excluded.name, active = 1`,
    );
    for (const p of dir.positions) upPos.run(String(p.id), n(p.code), p.name);

    // Gán bộ phận vào nhà máy khi mã bộ phận trùng mã nhà máy (chỉ khi chưa cấu hình)
    db.run(
      `UPDATE departments SET factory_id = (SELECT f.id FROM factories f WHERE f.code = departments.code)
        WHERE factory_id IS NULL AND code IN (SELECT code FROM factories)`,
    );

    for (const e of dir.employees) upsertUser(db, e, stamp, adminSsoIds);

    // Bộ phận / chức vụ / người không còn trong SSO thì ngưng hoạt động
    const keep = (rows) => rows.map((r) => String(r.id));
    deactivateMissing(db, 'departments', keep(dir.departments));
    deactivateMissing(db, 'positions', keep(dir.positions));
    deactivateMissing(db, 'users', keep(dir.employees));
    return { departments: dir.departments.length, positions: dir.positions.length, employees: dir.employees.length };
  });
}

function deactivateMissing(db, table, ids) {
  const placeholders = ids.map(() => '?').join(',') || "''";
  db.run(`UPDATE ${table} SET active = 0 WHERE sso_id NOT IN (${placeholders})`, ...ids);
}

/** Thêm/cập nhật 1 người dùng từ hồ sơ SSO. Trả về bản ghi users. */
function upsertUser(db, e, stamp = now(), adminSsoIds = []) {
  const dep = e.department_id != null ? db.one('SELECT id FROM departments WHERE sso_id = ?', String(e.department_id)) : null;
  const pos = e.position_id != null ? db.one('SELECT id FROM positions WHERE sso_id = ?', String(e.position_id)) : null;
  db.run(
    `INSERT INTO users (sso_id, username, full_name, email, phone, department_id, position_id, active, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(sso_id) DO UPDATE SET username = excluded.username, full_name = excluded.full_name,
       email = excluded.email, phone = excluded.phone,
       department_id = COALESCE(excluded.department_id, users.department_id),
       position_id = COALESCE(excluded.position_id, users.position_id),
       active = 1, synced_at = excluded.synced_at`,
    String(e.id), n(e.username), e.full_name || e.username || String(e.id), n(e.email), n(e.phone),
    dep ? dep.id : null, pos ? pos.id : null, stamp,
  );
  if (adminSsoIds.includes(String(e.id))) db.run('UPDATE users SET is_admin = 1 WHERE sso_id = ?', String(e.id));
  return db.one('SELECT * FROM users WHERE sso_id = ?', String(e.id));
}

module.exports = { syncDirectory, upsertUser };
