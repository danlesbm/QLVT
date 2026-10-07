'use strict';
const { AppError, str, num, toArray } = require('./util');
const { can, factoryScope, isAdminUser } = require('../auth/access');
const stock = require('./stock');

/** Trạng thái phiếu đề xuất theo đúng quy trình của công ty. */
const STATUS = {
  NHAP: { label: 'Nháp', color: 'secondary' },
  TRA_LAI: { label: 'Bị từ chối - chờ người lập sửa', color: 'danger' },
  CHO_TBP: { label: 'Chờ Trưởng bộ phận xem xét', color: 'warning' },
  CHO_PKT: { label: 'Chờ PKT xem xét', color: 'warning' },
  CHO_TPKT: { label: 'Chờ TP Kỹ thuật duyệt', color: 'warning' },
  CHO_DUYET_NHU_CAU: { label: 'Chờ duyệt nhu cầu', color: 'warning' },
  CHO_MS_XAC_NHAN: { label: 'Chờ bộ phận mua sắm xác nhận phiếu', color: 'info' },
  DANG_BAO_GIA: { label: 'Đang báo giá', color: 'info' },
  DANG_TONG_HOP: { label: 'Đang tổng hợp so sánh giá', color: 'info' },
  CHO_GD_DUYET_GIA: { label: 'Chờ GĐ duyệt giá', color: 'warning' },
  DANG_MUA_SAM: { label: 'Đang mua sắm', color: 'primary' },
  CHO_CHUYEN_HANG: { label: 'Chờ chuyển hàng', color: 'primary' },
  CHO_KIEM_TRA_HANG: { label: 'Chờ kiểm tra hàng', color: 'primary' },
  HOAN_THANH: { label: 'Hoàn thành', color: 'success' },
  DA_HUY: { label: 'Đã hủy', color: 'dark' },
};

/** Thứ tự các bước chính (hiển thị thanh tiến trình). */
const FLOW = [
  'NHAP', 'CHO_TBP', 'CHO_PKT', 'CHO_TPKT', 'CHO_DUYET_NHU_CAU', 'CHO_MS_XAC_NHAN', 'DANG_BAO_GIA',
  'DANG_TONG_HOP', 'CHO_GD_DUYET_GIA', 'DANG_MUA_SAM', 'CHO_CHUYEN_HANG', 'CHO_KIEM_TRA_HANG', 'HOAN_THANH',
];

/** Từ chối ở bước nào thì phiếu quay về đâu. */
const REJECT_TO = {
  CHO_TBP: 'TRA_LAI',
  CHO_PKT: 'TRA_LAI',
  CHO_TPKT: 'TRA_LAI',
  CHO_DUYET_NHU_CAU: 'TRA_LAI',
  CHO_MS_XAC_NHAN: 'TRA_LAI',
  CHO_GD_DUYET_GIA: 'DANG_TONG_HOP',
  CHO_KIEM_TRA_HANG: 'DANG_MUA_SAM',
};

const ACTION_LABEL = {
  create: 'Lập phiếu',
  edit: 'Sửa phiếu',
  submit: 'Trình Giám đốc nhà máy',
  cancel: 'Hủy phiếu',
  reject: 'Từ chối',
  factory_approve: 'GĐ nhà máy đồng ý, trình Phòng Kỹ thuật',
  pkt_assign: 'TP Kỹ thuật phân công kiểm soát',
  pkt_edit: 'PKT điều chỉnh vật tư',
  pkt_check: 'Kiểm soát xong, trình TP Kỹ thuật',
  pkt_approve: 'TP Kỹ thuật duyệt lần 1, trình Giám đốc',
  director_approve: 'Giám đốc duyệt nhu cầu',
  purchase_receive: 'Phòng Kế hoạch đã nhận phiếu',
  assign_quoters: 'Giao nhân viên báo giá',
  quote_add: 'Gửi báo giá',
  quote_delete: 'Xóa báo giá',
  quote_done: 'Hoàn thành báo giá',
  quote_reopen: 'Yêu cầu báo giá lại',
  quote_close: 'TP Kế hoạch kết thúc báo giá thay nhân viên',
  assign_compiler: 'Giao tổng hợp so sánh giá',
  comparison_submit: 'Trình Giám đốc duyệt giá',
  price_external: 'Duyệt giá ngoài phần mềm',
  price_approve: 'Giám đốc duyệt giá',
  goods_arrived: 'Hàng đã về công ty, chờ chuyển',
  goods_received: 'Nhà máy đã nhận hàng',
  complete: 'Kiểm tra xong, hoàn thành',
};

/**
 * Trường form theo vật tư được đặt tên dạng `received[i<id>]` (có tiền tố "i") để bộ phân tích
 * form (qs) không biến khóa số thành mảng bị dồn chỉ số. Hàm đọc cả hai dạng.
 */
const byItem = (obj, id) => (obj ? obj[`i${id}`] ?? obj[id] : undefined);
const itemKey = (key) => Number(String(key).replace(/^i/, ''));

// ---------- Đọc dữ liệu ----------

function get(db, id) {
  return db.one(
    `SELECT r.*, f.name AS factory_name, f.code AS factory_code, f.request_prefix,
            uc.full_name AS creator_name, ud.full_name AS director_name, ur.full_name AS reviewer_name,
            ucp.full_name AS compiler_name, upa.full_name AS price_approver_name,
            (SELECT full_name FROM users WHERE id = r.factory_approved_by) AS factory_approver_name,
            (SELECT full_name FROM users WHERE id = r.pkt_checked_by) AS pkt_checker_name,
            (SELECT full_name FROM users WHERE id = r.pkt_approved_by) AS pkt_approver_name,
            (SELECT full_name FROM users WHERE id = r.director_approved_by) AS director_approver_name
       FROM requests r JOIN factories f ON f.id = r.factory_id
       JOIN users uc ON uc.id = r.created_by
       LEFT JOIN users ud ON ud.id = r.director_id
       LEFT JOIN users ur ON ur.id = r.pkt_reviewer_id
       LEFT JOIN users ucp ON ucp.id = r.compiler_id
       LEFT JOIN users upa ON upa.id = r.price_approver_id
      WHERE r.id = ?`,
    id,
  );
}

function items(db, id) {
  return db.all(
    `SELECT i.*, m.code AS material_code FROM request_items i LEFT JOIN materials m ON m.id = i.material_id
      WHERE i.request_id = ? ORDER BY i.line_no`,
    id,
  );
}

function history(db, id) {
  return db.all(
    `SELECT h.*, u.full_name FROM request_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.request_id = ? ORDER BY h.id`,
    id,
  );
}

function quoters(db, id) {
  return db.all(
    `SELECT q.*, u.full_name FROM request_quoters q JOIN users u ON u.id = q.user_id WHERE q.request_id = ? ORDER BY q.id`,
    id,
  );
}

/** Báo giá đã được "mở niêm phong" khi mọi người được giao đều hoàn thành. */
function quotesUnsealed(db, id) {
  const qs = quoters(db, id);
  return qs.length > 0 && qs.every((q) => q.status === 'DA_XONG');
}

/**
 * Báo giá người dùng được xem: trước khi mở niêm phong chỉ thấy báo giá của chính mình
 * (kể cả Trưởng phòng và Giám đốc), để đảm bảo tính độc lập.
 */
function visibleQuotes(db, id, user) {
  const unsealed = quotesUnsealed(db, id);
  const rows = db.all(
    `SELECT q.*, u.full_name AS quoter_name FROM quotes q JOIN users u ON u.id = q.quoter_id
      WHERE q.request_id = ? ${unsealed ? '' : 'AND q.quoter_id = ?'} ORDER BY q.id`,
    ...(unsealed ? [id] : [id, user.id]),
  );
  for (const q of rows) {
    q.lines = db.all('SELECT * FROM quote_lines WHERE quote_id = ?', q.id);
    q.byItem = Object.fromEntries(q.lines.map((l) => [l.request_item_id, l]));
  }
  return { unsealed, quotes: rows };
}

function canView(db, access, user, r) {
  if (can(access, 'request.view', r.factory_id)) return true;
  if ([r.created_by, r.pkt_reviewer_id, r.director_id, r.compiler_id, r.price_approver_id].includes(user.id)) return true;
  if (db.one('SELECT 1 FROM request_quoters WHERE request_id = ? AND user_id = ?', r.id, user.id)) return true;
  // Người có vai trò xử lý ở cấp công ty cũng xem được
  return ['request.pkt_head', 'request.pkt_review', 'request.approve_director', 'purchase.head', 'purchase.staff'].some((p) => can(access, p));
}

function list(db, access, user, { status, factoryId, q, mine, page = 1, pageSize = 30 } = {}) {
  const where = ['1 = 1'];
  const params = [];
  const scope = factoryScope(access, 'request.view');
  const companyRole = ['request.pkt_head', 'request.pkt_review', 'request.approve_director', 'purchase.head', 'purchase.staff'].some((p) => can(access, p));
  if (scope && !companyRole) {
    const ids = scope.length ? scope : [0];
    where.push(`(r.factory_id IN (${ids.map(() => '?').join(',')}) OR r.created_by = ? OR r.director_id = ?)`);
    params.push(...ids, user.id, user.id);
  }
  if (typeof status !== 'string') status = '';
  if (status === 'DANG_XU_LY') where.push(`r.status NOT IN ('NHAP','HOAN_THANH','DA_HUY')`);
  else if (status) {
    where.push('r.status = ?');
    params.push(status);
  }
  if (factoryId) {
    where.push('r.factory_id = ?');
    params.push(Number(factoryId));
  }
  if (mine) {
    where.push('r.created_by = ?');
    params.push(user.id);
  }
  if (q) {
    where.push('(r.number LIKE ? OR r.title LIKE ? OR EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND i.name LIKE ?))');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  // Phiếu nháp chỉ người có quyền lập của nhà máy mới thấy
  where.push(`(r.status <> 'NHAP' OR r.created_by = ? OR ?)`);
  params.push(user.id, access.isAdmin ? 1 : 0);
  const base = `FROM requests r JOIN factories f ON f.id = r.factory_id JOIN users u ON u.id = r.created_by WHERE ${where.join(' AND ')}`;
  const total = db.one(`SELECT COUNT(*) n ${base}`, ...params).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(Math.max(1, Number(page) || 1), pages);
  const rows = db.all(
    `SELECT r.*, f.name AS factory_name, u.full_name AS creator_name,
            (SELECT COUNT(*) FROM request_items i WHERE i.request_id = r.id) AS item_count
     ${base} ORDER BY r.updated_at DESC, r.id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize,
  );
  return { rows, total, page, pages };
}

// ---------- Quyền theo bước ----------

/** Các thao tác người dùng được làm trên phiếu ở trạng thái hiện tại. */
function availableActions(db, access, user, r) {
  const a = new Set();
  const f = r.factory_id;
  const isQuoter = db.one('SELECT status FROM request_quoters WHERE request_id = ? AND user_id = ?', r.id, user.id);
  const purchase = can(access, 'purchase.head') || can(access, 'purchase.staff');
  switch (r.status) {
    case 'NHAP':
    case 'TRA_LAI':
      if (can(access, 'request.create', f)) a.add('edit').add('submit').add('cancel');
      break;
    case 'CHO_TBP':
      if (can(access, 'request.approve_factory', f)) a.add('factory_approve').add('reject');
      break;
    case 'CHO_PKT':
      if (can(access, 'request.pkt_head')) a.add('pkt_assign').add('pkt_approve').add('pkt_edit').add('reject');
      if (r.pkt_reviewer_id === user.id) a.add('pkt_check').add('pkt_edit').add('reject');
      break;
    case 'CHO_TPKT':
      if (can(access, 'request.pkt_head')) a.add('pkt_approve').add('pkt_edit').add('reject');
      break;
    case 'CHO_DUYET_NHU_CAU':
      if (r.director_id === user.id || access.isAdmin) a.add('director_approve').add('reject');
      break;
    case 'CHO_MS_XAC_NHAN':
      if (purchase) a.add('purchase_receive');
      if (can(access, 'purchase.head')) a.add('reject');
      break;
    case 'DANG_BAO_GIA': {
      const unsealed = quotesUnsealed(db, r.id);
      if (can(access, 'purchase.head')) {
        if (!unsealed) a.add('assign_quoters').add('quote_close');
        else a.add('assign_compiler').add('quote_reopen');
      }
      if (isQuoter && isQuoter.status === 'DANG_LAM') a.add('quote_add').add('quote_delete').add('quote_done');
      break;
    }
    case 'DANG_TONG_HOP':
      if (r.compiler_id === user.id || can(access, 'purchase.head')) a.add('comparison_submit');
      if (can(access, 'purchase.head')) a.add('price_external').add('assign_compiler');
      break;
    case 'CHO_GD_DUYET_GIA':
      if (r.price_approver_id === user.id || access.isAdmin) a.add('price_approve').add('reject');
      break;
    case 'DANG_MUA_SAM':
      if (purchase) a.add('goods_arrived');
      break;
    case 'CHO_CHUYEN_HANG':
      if (can(access, 'request.receive', f)) a.add('goods_received');
      break;
    case 'CHO_KIEM_TRA_HANG':
      if (can(access, 'request.receive', f)) a.add('complete').add('reject');
      break;
    default:
  }
  if (access.isAdmin && !['HOAN_THANH', 'DA_HUY'].includes(r.status)) a.add('cancel');
  return a;
}

// ---------- Ghi dữ liệu ----------

function log(db, r, action, toStatus, user, comment) {
  db.run(
    'INSERT INTO request_history (request_id, action, from_status, to_status, user_id, comment) VALUES (?, ?, ?, ?, ?, ?)',
    r.id, action, r.status, toStatus, user.id, comment || null,
  );
}

function setStatus(db, r, to, user, action, comment, extra = {}) {
  const sets = ['status = ?', "updated_at = datetime('now','localtime')"];
  const vals = [to];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  db.run(`UPDATE requests SET ${sets.join(', ')} WHERE id = ?`, ...vals, r.id);
  log(db, r, action, to, user, comment);
}

/** Chuẩn hóa danh sách vật tư từ form. */
function parseItems(db, factoryId, raw) {
  const out = [];
  for (const it of toArray(raw)) {
    const name = str(it.name);
    const quantity = num(it.quantity);
    if (!name && quantity == null) continue;
    if (!name) throw new AppError('Có dòng vật tư chưa nhập tên');
    if (quantity == null || quantity <= 0) throw new AppError(`Số lượng của "${name}" không hợp lệ`);
    const materialId = it.material_id ? Number(it.material_id) : null;
    if (materialId) {
      const m = db.one('SELECT code, factory_id, active FROM materials WHERE id = ?', materialId);
      if (!m) throw new AppError('Mã vật tư không tồn tại');
      if (m.factory_id && m.factory_id !== factoryId) throw new AppError(`Mã ${m.code} là mã riêng của nhà máy khác`);
      if (!m.active) throw new AppError(`Mã ${m.code} đã ngưng sử dụng`);
    }
    out.push({
      material_id: materialId,
      name,
      model: str(it.model),
      spec: str(it.spec),
      equipment_code: str(it.equipment_code),
      unit: str(it.unit),
      quantity,
      use_time: str(it.use_time),
      purpose: str(it.purpose),
      note: str(it.note),
    });
  }
  return out;
}

function replaceItems(db, requestId, list) {
  db.run('DELETE FROM request_items WHERE request_id = ?', requestId);
  const ins = db.prepare(
    `INSERT INTO request_items (request_id, line_no, material_id, name, model, spec, equipment_code, unit, quantity, use_time, purpose, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  list.forEach((x, i) => ins.run(requestId, i + 1, x.material_id, x.name, x.model, x.spec, x.equipment_code, x.unit, x.quantity, x.use_time, x.purpose, x.note));
}

function create(db, user, access, data) {
  const factoryId = Number(data.factory_id);
  if (!factoryId) throw new AppError('Chưa chọn nhà máy');
  if (!can(access, 'request.create', factoryId)) throw new AppError('Bạn không có quyền lập phiếu cho nhà máy này', 403);
  if (!db.one('SELECT 1 FROM factories WHERE id = ? AND active = 1', factoryId)) throw new AppError('Chưa chọn nhà máy');
  const title = str(data.title);
  if (!title) throw new AppError('Nhập tiêu đề phiếu');
  const list = parseItems(db, factoryId, data.items);
  return db.tx(() => {
    const r = db.run('INSERT INTO requests (factory_id, title, basis, created_by) VALUES (?, ?, ?, ?)', factoryId, title, str(data.basis), user.id);
    const id = Number(r.lastInsertRowid);
    replaceItems(db, id, list);
    log(db, { id, status: null }, 'create', 'NHAP', user, null);
    return id;
  });
}

/** Sửa phiếu: người lập (nháp/bị từ chối) hoặc PKT điều chỉnh khi đang xem xét. */
function update(db, user, access, id, data) {
  const r = get(db, id);
  if (!r) throw new AppError('Không tìm thấy phiếu', 404);
  const acts = availableActions(db, access, user, r);
  const byPkt = ['CHO_PKT', 'CHO_TPKT'].includes(r.status);
  if (!(acts.has('edit') || (byPkt && acts.has('pkt_edit')))) throw new AppError('Phiếu không ở trạng thái cho phép sửa', 403);
  const list = parseItems(db, r.factory_id, data.items);
  if (!list.length) throw new AppError('Phiếu phải có ít nhất 1 vật tư');
  db.tx(() => {
    if (!byPkt) {
      const title = str(data.title);
      if (!title) throw new AppError('Nhập tiêu đề phiếu');
      db.run(`UPDATE requests SET title = ?, basis = ?, updated_at = datetime('now','localtime') WHERE id = ?`, title, str(data.basis), id);
    }
    replaceItems(db, id, list);
    log(db, r, byPkt ? 'pkt_edit' : 'edit', r.status, user, str(data.comment));
  });
}

/** Số phiếu tăng theo ký hiệu + năm: các nhà máy dùng chung ký hiệu (vd PNC-TC&NC3-SBM) dùng chung dãy số. */
function nextNumber(db, r) {
  const year = new Date().getFullYear();
  const prefix = r.request_prefix || `PNC-${r.factory_code}`;
  // Tính theo ký hiệu đã in trên số phiếu (không theo ký hiệu hiện tại của nhà máy) để đổi ký hiệu vẫn không trùng số
  const seq = (db.one(
    `SELECT MAX(seq) m FROM requests WHERE year = ? AND substr(number, instr(number, '/') + 1) = ?`,
    year, prefix,
  ).m || 0) + 1;
  return { seq, year, number: `${seq}/${prefix}` };
}

/**
 * Thực hiện 1 thao tác quy trình. data tùy thao tác (comment, director_id, quoter_ids...).
 * Trả về id phiếu.
 */
function act(db, user, access, id, action, data = {}, file = null) {
  const r = get(db, id);
  if (!r) throw new AppError('Không tìm thấy phiếu', 404);
  const acts = availableActions(db, access, user, r);
  if (!acts.has(action)) throw new AppError(`Bạn không thể thực hiện "${ACTION_LABEL[action] || action}" ở trạng thái "${STATUS[r.status].label}"`, 403);
  const comment = str(data.comment);

  return db.tx(() => {
    switch (action) {
      case 'submit': {
        const cnt = db.one('SELECT COUNT(*) n FROM request_items WHERE request_id = ?', id).n;
        if (!cnt) throw new AppError('Phiếu chưa có vật tư nào');
        const extra = {};
        if (!r.number) Object.assign(extra, nextNumber(db, r));
        setStatus(db, r, 'CHO_TBP', user, action, comment, extra);
        break;
      }
      case 'cancel':
        if (!comment) throw new AppError('Nhập lý do hủy phiếu');
        setStatus(db, r, 'DA_HUY', user, action, comment);
        break;
      case 'reject': {
        if (!comment) throw new AppError('Nhập lý do từ chối');
        const to = REJECT_TO[r.status];
        const extra = {};
        if (to === 'TRA_LAI') Object.assign(extra, { factory_approved_by: null, pkt_checked_by: null, pkt_approved_by: null, director_approved_by: null, demand_approved_at: null });
        if (r.status === 'CHO_GD_DUYET_GIA') extra.price_approved_by = null;
        setStatus(db, r, to, user, action, comment, extra);
        break;
      }
      case 'factory_approve':
        setStatus(db, r, 'CHO_PKT', user, action, comment, { factory_approved_by: user.id });
        break;
      case 'pkt_assign': {
        const reviewer = Number(data.reviewer_id);
        if (!hasPerm(db, reviewer, 'request.pkt_review')) throw new AppError('Người được chọn không thuộc danh sách cán bộ PKT kiểm soát');
        db.run('UPDATE requests SET pkt_reviewer_id = ? WHERE id = ?', reviewer, id);
        const name = db.one('SELECT full_name FROM users WHERE id = ?', reviewer).full_name;
        log(db, r, action, r.status, user, `Giao ${name} kiểm soát${comment ? ': ' + comment : ''}`);
        break;
      }
      case 'pkt_check':
        setStatus(db, r, 'CHO_TPKT', user, action, comment, { pkt_checked_by: user.id });
        break;
      case 'pkt_approve': {
        const director = Number(data.director_id);
        if (!hasPerm(db, director, 'request.approve_director')) throw new AppError('Chọn Giám đốc / Phó giám đốc phụ trách duyệt nhu cầu');
        setStatus(db, r, 'CHO_DUYET_NHU_CAU', user, action, comment, {
          pkt_approved_by: user.id,
          pkt_checked_by: r.pkt_checked_by || user.id,
          director_id: director,
        });
        break;
      }
      case 'director_approve':
        setStatus(db, r, 'CHO_MS_XAC_NHAN', user, action, comment, {
          director_approved_by: user.id,
          demand_approved_at: new Date().toISOString(),
        });
        break;
      case 'purchase_receive':
        setStatus(db, r, 'DANG_BAO_GIA', user, action, comment);
        break;
      case 'assign_quoters':
        assignQuoters(db, r, user, data);
        break;
      case 'quote_add':
        addQuote(db, r, user, data, file);
        break;
      case 'quote_delete': {
        const q = db.one('SELECT * FROM quotes WHERE id = ? AND request_id = ? AND quoter_id = ?', Number(data.quote_id), id, user.id);
        if (!q) throw new AppError('Không tìm thấy báo giá của bạn');
        db.run('DELETE FROM quotes WHERE id = ?', q.id);
        // Không ghi tên nhà cung cấp: báo giá vẫn đang niêm phong
        log(db, r, action, r.status, user, null);
        break;
      }
      case 'quote_done': {
        const own = db.one('SELECT COUNT(*) n FROM quotes WHERE request_id = ? AND quoter_id = ?', id, user.id).n;
        if (!own && !comment) throw new AppError('Bạn chưa gửi báo giá nào; nếu không lấy được báo giá hãy ghi rõ lý do');
        db.run(
          `UPDATE request_quoters SET status = 'DA_XONG', done_note = ?, done_at = datetime('now','localtime') WHERE request_id = ? AND user_id = ?`,
          comment, id, user.id,
        );
        log(db, r, action, r.status, user, comment);
        logUnseal(db, r, user);
        break;
      }
      case 'quote_close': {
        if (!comment) throw new AppError('Nhập lý do kết thúc báo giá thay nhân viên');
        const qid = Number(data.user_id);
        const row = db.one(`SELECT q.*, u.full_name FROM request_quoters q JOIN users u ON u.id = q.user_id WHERE q.request_id = ? AND q.user_id = ? AND q.status = 'DANG_LAM'`, id, qid);
        if (!row) throw new AppError('Nhân viên này không còn đang báo giá');
        db.run(`UPDATE request_quoters SET status = 'DA_XONG', done_note = ?, done_at = datetime('now','localtime') WHERE id = ?`, `TP kết thúc thay: ${comment}`, row.id);
        log(db, r, action, r.status, user, `${row.full_name}: ${comment}`);
        logUnseal(db, r, user);
        break;
      }
      case 'quote_reopen': {
        if (!comment) throw new AppError('Nhập lý do yêu cầu báo giá lại');
        const qid = Number(data.user_id);
        const row = db.one('SELECT * FROM request_quoters WHERE request_id = ? AND user_id = ?', id, qid);
        if (!row) throw new AppError('Nhân viên này không được giao báo giá');
        db.run(`UPDATE request_quoters SET status = 'DANG_LAM', done_at = NULL WHERE id = ?`, row.id);
        log(db, r, action, r.status, user, comment);
        break;
      }
      case 'assign_compiler': {
        const cid = Number(data.compiler_id);
        if (!db.one('SELECT 1 FROM request_quoters WHERE request_id = ? AND user_id = ?', id, cid)) throw new AppError('Người tổng hợp phải là một trong các nhân viên báo giá');
        const name = db.one('SELECT full_name FROM users WHERE id = ?', cid).full_name;
        setStatus(db, r, 'DANG_TONG_HOP', user, action, `Giao ${name} tổng hợp${comment ? ': ' + comment : ''}`, { compiler_id: cid });
        break;
      }
      case 'comparison_submit':
        submitComparison(db, r, user, data);
        break;
      case 'price_external': {
        if (!comment) throw new AppError('Ghi rõ nội dung đã trình duyệt ngoài (số tờ trình, ngày duyệt...)');
        const extra = { price_external: 1, comparison_note: comment };
        if (file) Object.assign(extra, { price_attachment: file.filename, price_attachment_name: file.originalname });
        setStatus(db, r, 'DANG_MUA_SAM', user, action, comment, extra);
        break;
      }
      case 'price_approve':
        setStatus(db, r, 'DANG_MUA_SAM', user, action, comment, { price_approved_by: user.id });
        break;
      case 'goods_arrived':
        setStatus(db, r, 'CHO_CHUYEN_HANG', user, action, comment);
        break;
      case 'goods_received':
        setStatus(db, r, 'CHO_KIEM_TRA_HANG', user, action, comment, { delivered_at: new Date().toISOString() });
        break;
      case 'complete':
        complete(db, r, user, data);
        break;
      default:
        throw new AppError('Thao tác không hợp lệ');
    }
    return id;
  });
}

function hasPerm(db, userId, perm) {
  const u = db.one('SELECT * FROM users WHERE id = ? AND active = 1', userId);
  if (!u) return false;
  if (isAdminUser(u)) return true;
  return db.all('SELECT r.permissions FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?', userId)
    .some((x) => JSON.parse(x.permissions).includes(perm));
}

function assignQuoters(db, r, user, data) {
  const max = Number(db.one(`SELECT value FROM settings WHERE key = 'max_quoters'`)?.value || 3);
  const ids = [...new Set(toArray(data.quoter_ids).map(Number).filter(Boolean))];
  if (!ids.length) throw new AppError('Chọn ít nhất 1 nhân viên báo giá');
  if (ids.length > max) throw new AppError(`Chỉ giao tối đa ${max} nhân viên báo giá`);
  const current = quoters(db, r.id);
  const currentIds = new Set(current.map((q) => q.user_id));
  const added = ids.filter((uid) => !currentIds.has(uid));
  for (const uid of added) if (!hasPerm(db, uid, 'purchase.staff')) throw new AppError('Có người được chọn không thuộc Phòng Kế hoạch (thiếu quyền nhân viên mua sắm)');
  // Báo giá đã từng mở niêm phong thì không được giao thêm người (người mới có thể đã biết giá)
  if (added.length && wasUnsealed(db, r.id)) throw new AppError('Báo giá đã từng được mở niêm phong, không thể giao thêm người báo giá');
  for (const q of current) {
    if (ids.includes(q.user_id)) continue;
    const has = db.one('SELECT COUNT(*) n FROM quotes WHERE request_id = ? AND quoter_id = ?', r.id, q.user_id).n;
    if (has) throw new AppError(`${q.full_name} đã gửi báo giá, không thể bỏ giao`);
    db.run('DELETE FROM request_quoters WHERE id = ?', q.id);
  }
  for (const uid of ids) db.run('INSERT OR IGNORE INTO request_quoters (request_id, user_id) VALUES (?, ?)', r.id, uid);
  // Đánh dấu vật tư không cần báo giá cạnh tranh
  const nonComp = new Set(toArray(data.non_competitive).map(Number));
  db.run('UPDATE request_items SET competitive = 1 WHERE request_id = ?', r.id);
  for (const itemId of nonComp) db.run('UPDATE request_items SET competitive = 0 WHERE id = ? AND request_id = ?', itemId, r.id);
  const names = quoters(db, r.id).map((q) => q.full_name).join(', ');
  log(db, r, 'assign_quoters', r.status, user, `Giao báo giá: ${names}${nonComp.size ? `; ${nonComp.size} vật tư không cần báo giá cạnh tranh` : ''}`);
  // Bỏ giao người chưa báo giá cũng có thể làm đủ báo giá: ghi nhận mở niêm phong
  logUnseal(db, r, user);
}

function wasUnsealed(db, requestId) {
  return !!db.one(`SELECT 1 FROM request_history WHERE request_id = ? AND action = 'quotes_unsealed'`, requestId);
}

/** Ghi lịch sử "mở niêm phong" đúng 1 lần mỗi khi báo giá chuyển từ niêm phong sang mở. */
function logUnseal(db, r, user) {
  if (!quotesUnsealed(db, r.id)) return;
  const last = db.one(`SELECT action FROM request_history WHERE request_id = ? AND action IN ('quotes_unsealed','quote_reopen') ORDER BY id DESC LIMIT 1`, r.id);
  if (last && last.action === 'quotes_unsealed') return;
  log(db, r, 'quotes_unsealed', r.status, user, 'Đã đủ báo giá - Trưởng phòng và Giám đốc có thể xem');
}

function addQuote(db, r, user, data, file) {
  const supplier = str(data.supplier);
  if (!supplier) throw new AppError('Nhập tên đơn vị báo giá');
  const lines = [];
  const itemIds = new Set(items(db, r.id).map((i) => i.id));
  for (const [key, l] of Object.entries(data.lines || {})) {
    if (!l || typeof l !== 'object') continue;
    const itemId = Number(l.item_id) || itemKey(key);
    if (!itemIds.has(itemId)) continue;
    const price = num(l.unit_price);
    if (price == null) continue;
    if (price < 0) throw new AppError('Đơn giá không hợp lệ');
    lines.push({ itemId, price, vat: num(l.vat_percent), brand: str(l.brand_origin), note: str(l.note) });
  }
  if (!lines.length) throw new AppError('Nhập đơn giá cho ít nhất 1 vật tư');
  const q = db.run(
    `INSERT INTO quotes (request_id, quoter_id, supplier, contact, quote_date, delivery_time, payment_terms, note, attachment, attachment_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    r.id, user.id, supplier, str(data.contact), str(data.quote_date), str(data.delivery_time), str(data.payment_terms), str(data.note),
    file ? file.filename : null, file ? file.originalname : null,
  );
  const qid = Number(q.lastInsertRowid);
  const ins = db.prepare('INSERT INTO quote_lines (quote_id, request_item_id, unit_price, vat_percent, brand_origin, note) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of lines) ins.run(qid, l.itemId, l.price, l.vat, l.brand, l.note);
  // Không ghi tên nhà cung cấp vào lịch sử để giữ bí mật cho đến khi đủ báo giá
  log(db, r, 'quote_add', r.status, user, null);
}

function submitComparison(db, r, user, data) {
  const approver = Number(data.price_approver_id);
  if (!hasPerm(db, approver, 'request.approve_director')) throw new AppError('Chọn Giám đốc duyệt giá');
  const its = items(db, r.id);
  const sel = data.selected || {};
  for (const it of its) {
    const offered = db.one('SELECT COUNT(*) n FROM quote_lines l JOIN quotes q ON q.id = l.quote_id WHERE l.request_item_id = ? AND q.request_id = ?', it.id, r.id).n;
    const lineId = Number(byItem(sel, it.id));
    if (!lineId && !offered) {
      // Vật tư không có báo giá nào (vd không cần báo giá cạnh tranh): để Giám đốc duyệt theo ghi chú
      db.run('UPDATE request_items SET selected_line_id = NULL WHERE id = ?', it.id);
      continue;
    }
    if (!lineId) throw new AppError(`Chưa chọn báo giá cho "${it.name}"`);
    const ok = db.one(
      'SELECT 1 FROM quote_lines l JOIN quotes q ON q.id = l.quote_id WHERE l.id = ? AND l.request_item_id = ? AND q.request_id = ?',
      lineId, it.id, r.id,
    );
    if (!ok) throw new AppError(`Báo giá chọn cho "${it.name}" không hợp lệ`);
    db.run('UPDATE request_items SET selected_line_id = ? WHERE id = ?', lineId, it.id);
  }
  setStatus(db, r, 'CHO_GD_DUYET_GIA', user, 'comparison_submit', str(data.comment), {
    comparison_note: str(data.comparison_note),
    price_approver_id: approver,
    price_external: 0,
  });
}

function complete(db, r, user, data) {
  const its = items(db, r.id);
  const rec = data.received || {};
  const stockIn = data.stock_in === '1' || data.stock_in === 'on' || data.stock_in === true;
  const skipped = [];
  for (const it of its) {
    const x = byItem(rec, it.id) || {};
    const qty = num(x.qty);
    const q = qty == null ? it.quantity : qty;
    if (q < 0) throw new AppError('Số lượng nhận không hợp lệ');
    db.run('UPDATE request_items SET received_qty = ?, received_condition = ? WHERE id = ?', q, str(x.condition), it.id);
    if (stockIn && q > 0) {
      const m = it.material_id ? db.one('SELECT factory_id FROM materials WHERE id = ?', it.material_id) : null;
      if (!m || (m.factory_id && m.factory_id !== r.factory_id)) skipped.push(it.name);
      else stock.move(db, { factoryId: r.factory_id, materialId: it.material_id, delta: q, kind: 'NHAP', refType: 'request', refId: r.id, note: `Nhập theo phiếu ${r.number}`, userId: user.id });
    }
  }
  let comment = str(data.comment) || '';
  if (stockIn) comment += `${comment ? '. ' : ''}Đã nhập kho${skipped.length ? `; chưa có mã (hoặc mã riêng nhà máy khác) nên chưa nhập kho: ${skipped.join(', ')}` : ''}`;
  setStatus(db, r, 'HOAN_THANH', user, 'complete', comment || null, { completed_at: new Date().toISOString() });
}

/** Phiếu đang chờ người dùng xử lý (cho trang Việc cần làm). */
function todo(db, access, user) {
  const rows = db.all(
    `SELECT r.*, f.name AS factory_name, u.full_name AS creator_name FROM requests r
       JOIN factories f ON f.id = r.factory_id JOIN users u ON u.id = r.created_by
      WHERE r.status NOT IN ('HOAN_THANH','DA_HUY') ORDER BY r.updated_at`,
  );
  const ignore = new Set(['cancel', 'edit', 'pkt_edit', 'quote_delete', 'quote_reopen', 'quote_close', 'reject', 'assign_compiler']);
  return rows.filter((r) => {
    if (r.status === 'NHAP' && r.created_by !== user.id) return false;
    const acts = [...availableActions(db, access, user, r)].filter((a) => !ignore.has(a));
    if (r.status === 'DANG_BAO_GIA' && can(access, 'purchase.head') && quotesUnsealed(db, r.id)) acts.push('assign_compiler');
    if (r.status === 'DANG_BAO_GIA' && acts.length === 1 && acts[0] === 'assign_quoters' && quoters(db, r.id).length) return false;
    return acts.length > 0 || (r.status === 'TRA_LAI' && r.created_by === user.id);
  });
}

module.exports = {
  STATUS, FLOW, REJECT_TO, ACTION_LABEL,
  get, items, history, quoters, quotesUnsealed, visibleQuotes, canView, list,
  availableActions, create, update, act, todo, hasPerm,
};
