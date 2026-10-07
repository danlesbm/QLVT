'use strict';
const { BY_CODE } = require('./permissions');

/**
 * Nạp ngữ cảnh quyền của người dùng: { grants: Map<perm, Set<factoryId|null>> }.
 * factoryId null = toàn công ty.
 */
function loadAccess(db, user) {
  const rows = db.all(
    `SELECT r.permissions, ur.factory_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    user.id,
  );
  const grants = new Map();
  for (const row of rows) {
    for (const perm of JSON.parse(row.permissions)) {
      if (!grants.has(perm)) grants.set(perm, new Set());
      grants.get(perm).add(row.factory_id ?? null);
    }
  }
  return { grants, isAdmin: !!user.is_admin };
}

/**
 * Kiểm tra quyền.
 * - factoryId bỏ trống: có quyền ở bất kỳ phạm vi nào.
 * - factoryId cụ thể: quyền toàn công ty hoặc đúng nhà máy đó.
 */
function can(access, perm, factoryId) {
  if (!access) return false;
  if (access.isAdmin) return true;
  const scopes = access.grants.get(perm);
  if (!scopes) return false;
  if (factoryId === undefined) return true;
  return scopes.has(null) || scopes.has(Number(factoryId));
}

/** Danh sách nhà máy (id) người dùng có quyền; null = tất cả. */
function factoryScope(access, perm) {
  if (access.isAdmin) return null;
  const scopes = access.grants.get(perm);
  if (!scopes) return [];
  if (scopes.has(null)) return null;
  return [...scopes];
}

/** Người dùng đang hoạt động có quyền perm tại nhà máy factoryId (dùng cho danh sách chọn người). */
function usersWith(db, perm, factoryId) {
  const users = db.all(
    `SELECT u.id, u.full_name, u.is_admin, p.name AS position_name, d.name AS department_name
       FROM users u LEFT JOIN positions p ON p.id = u.position_id LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.active = 1 ORDER BY u.full_name`,
  );
  const rows = db.all(
    `SELECT ur.user_id, ur.factory_id, r.permissions FROM user_roles ur JOIN roles r ON r.id = ur.role_id`,
  );
  const ok = new Set();
  for (const r of rows) {
    if (!JSON.parse(r.permissions).includes(perm)) continue;
    if (factoryId === undefined || r.factory_id == null || r.factory_id === Number(factoryId)) ok.add(r.user_id);
  }
  return users.filter((u) => ok.has(u.id));
}

function isScoped(perm) {
  return !!BY_CODE[perm]?.scoped;
}

module.exports = { loadAccess, can, factoryScope, usersWith, isScoped };
