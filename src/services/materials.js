'use strict';
const { AppError, str } = require('./util');
const { can, factoryScope } = require('../auth/access');

/** Người dùng có được tạo/sửa mã ở phạm vi này không (factoryId null = mã chung toàn công ty). */
function canCode(access, factoryId) {
  return factoryId ? can(access, 'catalog.code_factory', factoryId) || can(access, 'catalog.code_company') : can(access, 'catalog.code_company');
}

function list(db, access, { q, scope, groupCode, page = 1, pageSize = 50 } = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (q) {
    where.push('(m.code LIKE ? OR m.name LIKE ? OR m.spec LIKE ? OR m.manufacturer LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (scope === 'company') where.push('m.factory_id IS NULL');
  else if (scope) {
    where.push('m.factory_id = ?');
    params.push(Number(scope));
  }
  if (groupCode) {
    where.push('m.code LIKE ?');
    params.push(`${groupCode}-%`);
  }
  const base = `FROM materials m LEFT JOIN factories f ON f.id = m.factory_id WHERE ${where.join(' AND ')}`;
  const total = db.one(`SELECT COUNT(*) n ${base}`, ...params).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  // Tổng tồn chỉ tính các kho người dùng được xem
  const sc = factoryScope(access, 'stock.view');
  let qtyCol = '(SELECT IFNULL(SUM(quantity), 0) FROM stock s WHERE s.material_id = m.id)';
  if (sc && !sc.length) qtyCol = 'NULL';
  else if (sc) qtyCol = `(SELECT IFNULL(SUM(quantity), 0) FROM stock s WHERE s.material_id = m.id AND s.factory_id IN (${sc.map(Number).join(',')}))`;
  const rows = db.all(
    `SELECT m.*, f.name AS factory_name, ${qtyCol} AS total_qty
     ${base} ORDER BY m.code LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  return { rows, total, page, pages };
}

/** Tìm nhanh cho ô gợi ý khi lập phiếu. factoryId: chỉ lấy mã chung + mã riêng của nhà máy đó. */
function search(db, q, factoryId, limit = 20) {
  const like = `%${q || ''}%`;
  return db.all(
    `SELECT m.id, m.code, m.name, m.spec, m.manufacturer, m.unit,
            (SELECT quantity FROM stock s WHERE s.material_id = m.id AND s.factory_id = ?) AS stock_qty
       FROM materials m
      WHERE m.active = 1 AND (m.factory_id IS NULL OR m.factory_id = ?) AND (m.code LIKE ? OR m.name LIKE ?)
      ORDER BY CASE WHEN m.code LIKE ? THEN 0 ELSE 1 END, m.code LIMIT ?`,
    factoryId || 0, factoryId || 0, like, like, `${q || ''}%`, limit,
  );
}

/** Gợi ý mã tiếp theo theo tiền tố, vd 1-01-00-00-02-02 → 1-01-00-00-02-02-007. */
function suggestCode(db, prefix) {
  const p = String(prefix || '').replace(/-+$/, '');
  if (!p) return '';
  const rows = db.all('SELECT code FROM materials WHERE code LIKE ?', `${p}-%`);
  let max = 0;
  let width = 3;
  for (const { code } of rows) {
    // Tính cả các mã con sâu hơn (vd 3-00-...-001-064 chiếm đoạn 001)
    const seg = code.slice(p.length + 1).split('-')[0];
    if (/^\d+$/.test(seg)) {
      max = Math.max(max, Number(seg));
      width = Math.max(width, seg.length);
    }
  }
  return `${p}-${String(max + 1).padStart(width, '0')}`;
}

function save(db, user, access, data) {
  const id = data.id ? Number(data.id) : null;
  const factoryId = data.factory_id ? Number(data.factory_id) : null;
  const existing = id ? db.one('SELECT * FROM materials WHERE id = ?', id) : null;
  if (id && !existing) throw new AppError('Không tìm thấy mã vật tư', 404);
  if (existing && !canCode(access, existing.factory_id)) throw new AppError('Bạn không có quyền sửa mã vật tư này', 403);
  if (!canCode(access, factoryId)) throw new AppError(factoryId ? 'Bạn không có quyền đánh mã cho nhà máy này' : 'Bạn không có quyền đánh mã chung toàn công ty', 403);
  const code = str(data.code);
  const name = str(data.name);
  if (!code || !name) throw new AppError('Mã và tên vật tư là bắt buộc');
  if (!/^[A-Za-z0-9.\-_/]+$/.test(code)) throw new AppError('Mã vật tư chỉ gồm chữ không dấu, số và các ký tự . - _ /');
  const dup = db.one('SELECT id FROM materials WHERE code = ? AND id <> ?', code, id || 0);
  if (dup) throw new AppError(`Mã ${code} đã tồn tại`);
  // Không chuyển thành mã riêng một nhà máy khi nhà máy khác còn tồn vật tư này
  if (existing && factoryId && factoryId !== existing.factory_id) {
    const other = db.one(
      'SELECT f.name FROM stock s JOIN factories f ON f.id = s.factory_id WHERE s.material_id = ? AND s.factory_id <> ? AND s.quantity <> 0',
      id, factoryId,
    );
    if (other) throw new AppError(`Mã đang có tồn ở ${other.name}, không thể chuyển thành mã riêng của nhà máy khác`);
  }
  const vals = [code, name, str(data.spec), str(data.manufacturer), str(data.unit), factoryId, str(data.note), data.active === '0' ? 0 : 1];
  if (existing) {
    db.run(
      `UPDATE materials SET code=?, name=?, spec=?, manufacturer=?, unit=?, factory_id=?, note=?, active=?, updated_at=datetime('now','localtime') WHERE id=?`,
      ...vals, id,
    );
    return id;
  }
  const r = db.run(
    `INSERT INTO materials (code, name, spec, manufacturer, unit, factory_id, note, active, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    ...vals, user.id,
  );
  return Number(r.lastInsertRowid);
}

function groups(db) {
  return db.all('SELECT * FROM material_groups ORDER BY code');
}

function saveGroup(db, access, data) {
  if (!can(access, 'catalog.code_company')) throw new AppError('Bạn không có quyền quản lý nhóm mã', 403);
  const code = str(data.code);
  const name = str(data.name);
  if (!code || !name) throw new AppError('Nhập đủ tiền tố mã và tên nhóm');
  db.run('INSERT INTO material_groups (code, name) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name', code, name);
}

module.exports = { list, search, suggestCode, save, canCode, groups, saveGroup };
