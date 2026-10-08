'use strict';
const config = require('../config');
const { BY_CODE, PLANT_PERMS } = require('./permissions');

/** Id các kho mà người dùng là nhân sự (thuộc đơn vị SSO của kho, không tính "Người phụ trách"). */
function memberFactoryIds(db, userId) {
  return new Set(
    db.all(
      `SELECT DISTINCT d.factory_id AS id FROM user_departments ud JOIN departments d ON d.id = ud.department_id
        WHERE ud.user_id = ? AND ud.member = 1 AND d.factory_id IS NOT NULL`,
      userId,
    ).map((r) => r.id),
  );
}

/** Nhân sự của kho (đang hoạt động), kèm chức vụ / đơn vị trên SSO. */
function factoryMembers(db, factoryId) {
  return db.all(
    `SELECT u.id, u.full_name, u.username, u.sso_id,
            GROUP_CONCAT(DISTINCT NULLIF(ud.role, '')) AS roles, GROUP_CONCAT(DISTINCT d.name) AS departments
       FROM users u JOIN user_departments ud ON ud.user_id = u.id AND ud.member = 1
       JOIN departments d ON d.id = ud.department_id
      WHERE u.active = 1 AND d.factory_id = ?
      GROUP BY u.id ORDER BY u.full_name`,
    factoryId,
  );
}

/**
 * Quyền gán theo kho có hiệu lực không: quyền vận hành kho (thủ kho, lập phiếu, GĐ nhà máy...) gán theo kho
 * chỉ có hiệu lực với nhân sự của kho đó. Gán toàn công ty (factoryId null) luôn có hiệu lực.
 */
const grantEffective = (perm, factoryId, members) => factoryId == null || !PLANT_PERMS.has(perm) || members.has(factoryId);

const isAdminUser = (user) => !!user.is_admin || (config.sso.adminIsAdmin && !!user.sso_admin);

/**
 * Nạp ngữ cảnh quyền của người dùng: { grants: Map<perm, Set<factoryId|null>> }.
 * factoryId null = toàn công ty.
 */
function loadAccess(db, user) {
  const rows = db.all(
    `SELECT r.permissions, ur.factory_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
    user.id,
  );
  const members = memberFactoryIds(db, user.id);
  const grants = new Map();
  for (const row of rows) {
    for (const perm of JSON.parse(row.permissions)) {
      if (!grantEffective(perm, row.factory_id, members)) continue;
      if (!grants.has(perm)) grants.set(perm, new Set());
      grants.get(perm).add(row.factory_id ?? null);
    }
  }
  return { grants, isAdmin: isAdminUser(user), members };
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
  const members = new Map();
  const memberOf = (uid) => members.get(uid) || members.set(uid, memberFactoryIds(db, uid)).get(uid);
  const ok = new Set();
  for (const r of rows) {
    if (!JSON.parse(r.permissions).includes(perm)) continue;
    if (factoryId !== undefined && r.factory_id != null && r.factory_id !== Number(factoryId)) continue;
    if (grantEffective(perm, r.factory_id, PLANT_PERMS.has(perm) ? memberOf(r.user_id) : null)) ok.add(r.user_id);
  }
  return users.filter((u) => ok.has(u.id));
}

function isScoped(perm) {
  return !!BY_CODE[perm]?.scoped;
}

module.exports = { loadAccess, can, factoryScope, usersWith, isScoped, memberFactoryIds, factoryMembers, grantEffective, isAdminUser };
