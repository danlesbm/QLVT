'use strict';
const { AppError, str, num } = require('./util');
const { can, factoryScope } = require('../auth/access');

/**
 * Cộng/trừ tồn kho và ghi sổ biến động. Phải gọi trong transaction.
 * delta > 0: nhập, delta < 0: xuất.
 */
function move(db, { factoryId, materialId, delta, kind, refType = null, refId = null, note = null, userId = null, allowNegative = false }) {
  let row = db.one('SELECT * FROM stock WHERE factory_id = ? AND material_id = ?', factoryId, materialId);
  if (!row) {
    db.run('INSERT INTO stock (factory_id, material_id, quantity) VALUES (?, ?, 0)', factoryId, materialId);
    row = db.one('SELECT * FROM stock WHERE factory_id = ? AND material_id = ?', factoryId, materialId);
  }
  const balance = Math.round((row.quantity + delta) * 1e6) / 1e6;
  if (balance < 0 && !allowNegative) {
    const m = db.one('SELECT code, name FROM materials WHERE id = ?', materialId);
    throw new AppError(`Không đủ tồn kho: ${m.code} - ${m.name} (tồn ${row.quantity}, cần xuất ${-delta})`);
  }
  db.run(`UPDATE stock SET quantity = ?, updated_at = datetime('now','localtime') WHERE id = ?`, balance, row.id);
  db.run(
    `INSERT INTO stock_movements (factory_id, material_id, kind, quantity, balance, ref_type, ref_id, note, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    factoryId, materialId, kind, delta, balance, refType, refId, note, userId,
  );
  return balance;
}

/** Danh sách tồn kho có lọc / phân trang. */
function list(db, access, { factoryId, q, page = 1, pageSize = 50, onlyInStock } = {}) {
  const where = ['1 = 1'];
  const params = [];
  const scope = factoryScope(access, 'stock.view');
  if (scope) {
    if (!scope.length) return { rows: [], total: 0, page: 1, pages: 1 };
    where.push(`s.factory_id IN (${scope.map(() => '?').join(',')})`);
    params.push(...scope);
  }
  if (factoryId) {
    where.push('s.factory_id = ?');
    params.push(Number(factoryId));
  }
  if (q) {
    where.push('(m.code LIKE ? OR m.name LIKE ? OR m.spec LIKE ? OR m.manufacturer LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (onlyInStock) where.push('s.quantity > 0');
  const base = `FROM stock s JOIN materials m ON m.id = s.material_id JOIN factories f ON f.id = s.factory_id WHERE ${where.join(' AND ')}`;
  const total = db.one(`SELECT COUNT(*) n ${base}`, ...params).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = db.all(
    `SELECT s.*, m.code, m.name, m.spec, m.manufacturer, m.unit, m.factory_id AS material_factory_id,
            f.name AS factory_name, f.code AS factory_code
     ${base} ORDER BY f.sort, m.code LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  return { rows, total, page, pages };
}

/** Thêm vật tư vào kho hoặc chỉnh số lượng/tình trạng (quyền stock.edit theo nhà máy). */
function save(db, user, access, data) {
  const factoryId = Number(data.factory_id);
  if (!can(access, 'stock.edit', factoryId)) throw new AppError('Bạn không có quyền nhập vật tư cho kho này', 403);
  const materialId = Number(data.material_id);
  const material = db.one('SELECT * FROM materials WHERE id = ?', materialId);
  if (!material) throw new AppError('Chưa chọn mã vật tư');
  if (material.factory_id && material.factory_id !== factoryId) throw new AppError('Mã vật tư này là mã riêng của nhà máy khác');
  const qty = num(data.quantity);
  if (qty == null || qty < 0) throw new AppError('Số lượng không hợp lệ');
  return db.tx(() => {
    const cur = db.one('SELECT * FROM stock WHERE factory_id = ? AND material_id = ?', factoryId, materialId);
    const before = cur ? cur.quantity : 0;
    if (qty !== before || !cur) {
      move(db, { factoryId, materialId, delta: qty - before, kind: cur ? 'DIEU_CHINH' : 'NHAP', note: str(data.reason) || (cur ? 'Điều chỉnh số lượng' : 'Nhập thêm vật tư'), userId: user.id });
    }
    db.run(
      `UPDATE stock SET condition = ?, location = ?, note = ?, updated_at = datetime('now','localtime') WHERE factory_id = ? AND material_id = ?`,
      str(data.condition), str(data.location), str(data.note), factoryId, materialId,
    );
    return db.one('SELECT * FROM stock WHERE factory_id = ? AND material_id = ?', factoryId, materialId);
  });
}

function movements(db, stockId) {
  const s = db.one('SELECT * FROM stock WHERE id = ?', stockId);
  if (!s) return [];
  return db.all(
    `SELECT sm.*, u.full_name FROM stock_movements sm LEFT JOIN users u ON u.id = sm.user_id
      WHERE sm.factory_id = ? AND sm.material_id = ? ORDER BY sm.id DESC LIMIT 200`,
    s.factory_id, s.material_id,
  );
}

module.exports = { move, list, save, movements };
