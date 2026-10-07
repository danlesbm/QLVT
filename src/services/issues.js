'use strict';
const { AppError, str, num, toArray } = require('./util');
const { can, factoryScope } = require('../auth/access');
const stock = require('./stock');

/** Trạng thái phiếu xuất kho: thủ kho lập → GĐ nhà máy duyệt → hoàn thành (trừ tồn kho). */
const STATUS = {
  NHAP: { label: 'Nháp', color: 'secondary' },
  TRA_LAI: { label: 'Bị từ chối - chờ sửa', color: 'danger' },
  CHO_DUYET: { label: 'Chờ GĐ nhà máy duyệt', color: 'warning' },
  HOAN_THANH: { label: 'Hoàn thành', color: 'success' },
  DA_HUY: { label: 'Đã hủy', color: 'dark' },
};

const ACTION_LABEL = {
  create: 'Lập phiếu',
  edit: 'Sửa phiếu',
  submit: 'Trình GĐ nhà máy',
  approve: 'GĐ nhà máy duyệt, hoàn thành xuất kho',
  reject: 'Từ chối',
  cancel: 'Hủy phiếu',
};

function get(db, id) {
  return db.one(
    `SELECT i.*, f.name AS factory_name, f.code AS factory_code, f.warehouse_name, f.address AS factory_address,
            uc.full_name AS creator_name, ua.full_name AS approver_name
       FROM issues i JOIN factories f ON f.id = i.factory_id JOIN users uc ON uc.id = i.created_by
       LEFT JOIN users ua ON ua.id = i.approved_by WHERE i.id = ?`,
    id,
  );
}

function items(db, id) {
  return db.all(
    `SELECT it.*, m.code, m.name, m.spec, m.manufacturer, m.unit,
            (SELECT quantity FROM stock s WHERE s.material_id = it.material_id AND s.factory_id = i.factory_id) AS stock_qty
       FROM issue_items it JOIN materials m ON m.id = it.material_id JOIN issues i ON i.id = it.issue_id
      WHERE it.issue_id = ? ORDER BY it.line_no`,
    id,
  );
}

function history(db, id) {
  return db.all(
    'SELECT h.*, u.full_name FROM issue_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.issue_id = ? ORDER BY h.id',
    id,
  );
}

function canView(access, user, x) {
  return x.created_by === user.id || can(access, 'issue.view', x.factory_id) || can(access, 'issue.approve', x.factory_id) || can(access, 'issue.create', x.factory_id);
}

function list(db, access, user, { status, factoryId, q, page = 1, pageSize = 30 } = {}) {
  const where = ['1 = 1'];
  const params = [];
  const scopes = ['issue.view', 'issue.create', 'issue.approve'].map((p) => factoryScope(access, p));
  if (!scopes.some((s) => s === null)) {
    const ids = [...new Set(scopes.flat())];
    where.push(`(x.factory_id IN (${(ids.length ? ids : [0]).map(() => '?').join(',')}) OR x.created_by = ?)`);
    params.push(...(ids.length ? ids : [0]), user.id);
  }
  if (typeof status === 'string' && status) {
    where.push('x.status = ?');
    params.push(status);
  }
  if (factoryId) {
    where.push('x.factory_id = ?');
    params.push(Number(factoryId));
  }
  if (q) {
    where.push('(x.number LIKE ? OR x.receiver_name LIKE ? OR x.reason LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  where.push(`(x.status <> 'NHAP' OR x.created_by = ? OR ?)`);
  params.push(user.id, access.isAdmin ? 1 : 0);
  const base = `FROM issues x JOIN factories f ON f.id = x.factory_id JOIN users u ON u.id = x.created_by WHERE ${where.join(' AND ')}`;
  const total = db.one(`SELECT COUNT(*) n ${base}`, ...params).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = db.all(
    `SELECT x.*, f.name AS factory_name, u.full_name AS creator_name,
            (SELECT COUNT(*) FROM issue_items it WHERE it.issue_id = x.id) AS item_count
     ${base} ORDER BY x.updated_at DESC, x.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  return { rows, total, page, pages };
}

function availableActions(access, user, x) {
  const a = new Set();
  if (['NHAP', 'TRA_LAI'].includes(x.status) && can(access, 'issue.create', x.factory_id)) a.add('edit').add('submit').add('cancel');
  if (x.status === 'CHO_DUYET' && can(access, 'issue.approve', x.factory_id)) a.add('approve').add('reject');
  if (access.isAdmin && ['NHAP', 'TRA_LAI', 'CHO_DUYET'].includes(x.status)) a.add('cancel');
  return a;
}

function parseItems(db, factoryId, raw) {
  const out = [];
  for (const it of toArray(raw)) {
    const materialId = Number(it.material_id);
    const req = num(it.qty_requested);
    const act = num(it.qty_actual);
    if (!materialId && req == null && act == null) continue;
    const m = db.one('SELECT * FROM materials WHERE id = ?', materialId);
    if (!m) throw new AppError('Có dòng chưa chọn vật tư trong kho');
    if (m.factory_id && m.factory_id !== factoryId) throw new AppError(`Vật tư ${m.code} là mã riêng của nhà máy khác`);
    const qr = req ?? act;
    const qa = act ?? req;
    if (qr == null || qr <= 0 || qa < 0) throw new AppError(`Số lượng xuất của ${m.code} không hợp lệ`);
    out.push({ material_id: materialId, qty_requested: qr, qty_actual: qa, condition: str(it.condition), note: str(it.note) });
  }
  if (!out.length) throw new AppError('Phiếu xuất phải có ít nhất 1 vật tư');
  return out;
}

function writeHeader(data) {
  const receiver = str(data.receiver_name);
  if (!receiver) throw new AppError('Nhập họ tên người nhận hàng');
  return [receiver, str(data.receiver_address), str(data.reason), str(data.location), str(data.issue_date)];
}

function replaceItems(db, issueId, list) {
  db.run('DELETE FROM issue_items WHERE issue_id = ?', issueId);
  const ins = db.prepare('INSERT INTO issue_items (issue_id, line_no, material_id, qty_requested, qty_actual, condition, note) VALUES (?, ?, ?, ?, ?, ?, ?)');
  list.forEach((x, i) => ins.run(issueId, i + 1, x.material_id, x.qty_requested, x.qty_actual, x.condition, x.note));
}

function log(db, x, action, to, user, comment) {
  db.run(
    'INSERT INTO issue_history (issue_id, action, from_status, to_status, user_id, comment) VALUES (?, ?, ?, ?, ?, ?)',
    x.id, action, x.status, to, user.id, comment || null,
  );
}

function create(db, user, access, data) {
  const factoryId = Number(data.factory_id);
  if (!db.one('SELECT 1 FROM factories WHERE id = ? AND active = 1', factoryId)) throw new AppError('Chưa chọn kho xuất');
  if (!can(access, 'issue.create', factoryId)) throw new AppError('Bạn không có quyền lập phiếu xuất cho kho này', 403);
  const header = writeHeader(data);
  const list = parseItems(db, factoryId, data.items);
  return db.tx(() => {
    const r = db.run(
      'INSERT INTO issues (factory_id, receiver_name, receiver_address, reason, location, issue_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      factoryId, ...header, user.id,
    );
    const id = Number(r.lastInsertRowid);
    replaceItems(db, id, list);
    log(db, { id, status: null }, 'create', 'NHAP', user);
    return id;
  });
}

function update(db, user, access, id, data) {
  const x = get(db, id);
  if (!x) throw new AppError('Không tìm thấy phiếu', 404);
  if (!availableActions(access, user, x).has('edit')) throw new AppError('Phiếu không ở trạng thái cho phép sửa', 403);
  const header = writeHeader(data);
  const list = parseItems(db, x.factory_id, data.items);
  db.tx(() => {
    db.run(
      `UPDATE issues SET receiver_name=?, receiver_address=?, reason=?, location=?, issue_date=?, updated_at=datetime('now','localtime') WHERE id=?`,
      ...header, id,
    );
    replaceItems(db, id, list);
    log(db, x, 'edit', x.status, user);
  });
}

function act(db, user, access, id, action, data = {}) {
  const x = get(db, id);
  if (!x) throw new AppError('Không tìm thấy phiếu', 404);
  if (!availableActions(access, user, x).has(action)) throw new AppError(`Bạn không thể thực hiện "${ACTION_LABEL[action] || action}" ở trạng thái "${STATUS[x.status].label}"`, 403);
  const comment = str(data.comment);
  const set = (to, extra = '') => {
    db.run(`UPDATE issues SET status = ?, updated_at = datetime('now','localtime')${extra} WHERE id = ?`, to, id);
    log(db, x, action, to, user, comment);
  };
  return db.tx(() => {
    switch (action) {
      case 'submit': {
        if (!x.number) {
          const year = new Date().getFullYear();
          const seq = (db.one('SELECT MAX(seq) m FROM issues WHERE factory_id = ? AND year = ?', x.factory_id, year).m || 0) + 1;
          db.run('UPDATE issues SET seq = ?, year = ?, number = ? WHERE id = ?', seq, year, `PXK-${x.factory_code}-${year}-${String(seq).padStart(4, '0')}`, id);
        }
        // Kiểm tra trước tồn kho để thủ kho biết sớm (cộng dồn các dòng cùng vật tư)
        const need = new Map();
        for (const it of items(db, id)) {
          const e = need.get(it.material_id) || { ...it, total: 0 };
          e.total += it.qty_actual;
          need.set(it.material_id, e);
        }
        for (const e of need.values()) {
          if ((e.stock_qty || 0) < e.total) throw new AppError(`Không đủ tồn kho: ${e.code} - ${e.name} (tồn ${e.stock_qty || 0}, xuất ${e.total})`);
        }
        set('CHO_DUYET');
        break;
      }
      case 'approve':
        for (const it of items(db, id)) {
          if (it.qty_actual > 0) {
            stock.move(db, { factoryId: x.factory_id, materialId: it.material_id, delta: -it.qty_actual, kind: 'XUAT', refType: 'issue', refId: id, note: `Xuất theo phiếu ${x.number}`, userId: user.id });
          }
        }
        db.run(`UPDATE issues SET approved_by = ?, approved_at = datetime('now','localtime') WHERE id = ?`, user.id, id);
        set('HOAN_THANH');
        break;
      case 'reject':
        if (!comment) throw new AppError('Nhập lý do từ chối');
        set('TRA_LAI');
        break;
      case 'cancel':
        if (!comment) throw new AppError('Nhập lý do hủy phiếu');
        set('DA_HUY');
        break;
      default:
        throw new AppError('Thao tác không hợp lệ');
    }
    return id;
  });
}

function todo(db, access, user) {
  return db.all(
    `SELECT x.*, f.name AS factory_name, u.full_name AS creator_name FROM issues x
       JOIN factories f ON f.id = x.factory_id JOIN users u ON u.id = x.created_by
      WHERE x.status IN ('CHO_DUYET','TRA_LAI') ORDER BY x.updated_at`,
  ).filter((x) => (x.status === 'CHO_DUYET' ? can(access, 'issue.approve', x.factory_id) : x.created_by === user.id));
}

module.exports = { STATUS, ACTION_LABEL, get, items, history, canView, list, availableActions, create, update, act, todo };
