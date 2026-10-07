-- Lược đồ CSDL Quản lý vật tư (SQLite)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ===== Kho: mỗi kho thuộc một đơn vị SSO được tích "có kho" =====
CREATE TABLE IF NOT EXISTS factories (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,          -- TACO, NC3...
  name             TEXT NOT NULL,                 -- NMTĐ Tà Cọ (lấy theo tên đơn vị SSO)
  warehouse_code   TEXT UNIQUE,                   -- mã kho ở phần mềm cũ: KHOTACO
  warehouse_name   TEXT,
  address          TEXT,
  request_prefix   TEXT,                          -- hậu tố số phiếu: PNC-TC&NC3-SBM
  director_id      INTEGER REFERENCES users(id),  -- GĐ/PGĐ phụ trách duyệt nhu cầu (mặc định)
  sort             INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1,
  department_id    INTEGER REFERENCES departments(id)  -- đơn vị SSO của kho (duy nhất, tạo chỉ mục khi nâng cấp CSDL)
);

-- ===== Dữ liệu đồng bộ từ SSO =====
CREATE TABLE IF NOT EXISTS departments (
  id         INTEGER PRIMARY KEY,
  sso_id     TEXT NOT NULL UNIQUE,                -- id phòng ban SSO; đơn vị ảo: role:HDQT, role:BKS, role:BGD
  code       TEXT,
  name       TEXT NOT NULL,
  factory_id INTEGER REFERENCES factories(id),   -- nhân sự đơn vị này thuộc kho nào
  virtual    INTEGER NOT NULL DEFAULT 0,          -- 1 = đơn vị ảo (HĐQT / BKS / Ban giám đốc), không có kho
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS positions (
  id     INTEGER PRIMARY KEY,
  sso_id TEXT NOT NULL UNIQUE,
  code   TEXT,
  name   TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  sso_id        TEXT NOT NULL UNIQUE,
  username      TEXT,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  department_id INTEGER REFERENCES departments(id),
  position_id   INTEGER REFERENCES positions(id),
  active        INTEGER NOT NULL DEFAULT 1,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  sso_admin     INTEGER NOT NULL DEFAULT 0,       -- quản trị trên SSO (cập nhật mỗi lần đăng nhập)
  last_login_at TEXT,
  synced_at     TEXT
);

-- Mọi đơn vị / chức vụ của người dùng trên SSO; member = 0: chỉ "Người phụ trách", không là nhân sự đơn vị
CREATE TABLE IF NOT EXISTS user_departments (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT '',
  member        INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, department_id, role)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ===== Phân quyền =====
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT NOT NULL DEFAULT '[]'   -- JSON mảng mã quyền
);

-- factory_id NULL = phạm vi toàn công ty
CREATE TABLE IF NOT EXISTS user_roles (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  factory_id INTEGER REFERENCES factories(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_roles ON user_roles(user_id, role_id, IFNULL(factory_id, 0));

-- ===== Danh mục mã vật tư =====
CREATE TABLE IF NOT EXISTS material_groups (
  id         INTEGER PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,    -- tiền tố mã, vd 1-01
  name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  spec         TEXT,                    -- thông số kỹ thuật
  manufacturer TEXT,                    -- hãng sản xuất / nước sản xuất
  unit         TEXT,
  factory_id   INTEGER REFERENCES factories(id),  -- NULL = mã chung toàn công ty
  note         TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_materials_name ON materials(name);

-- ===== Tồn kho =====
CREATE TABLE IF NOT EXISTS stock (
  id          INTEGER PRIMARY KEY,
  factory_id  INTEGER NOT NULL REFERENCES factories(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  quantity    REAL NOT NULL DEFAULT 0,
  condition   TEXT,     -- tình trạng
  location    TEXT,     -- vị trí để
  note        TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (factory_id, material_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id          INTEGER PRIMARY KEY,
  factory_id  INTEGER NOT NULL REFERENCES factories(id),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  kind        TEXT NOT NULL,         -- NHAP | XUAT | DIEU_CHINH | IMPORT
  quantity    REAL NOT NULL,         -- có dấu: + nhập, - xuất
  balance     REAL NOT NULL,         -- tồn sau giao dịch
  ref_type    TEXT,                  -- request | issue
  ref_id      INTEGER,
  note        TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_movements ON stock_movements(factory_id, material_id);

-- Mã dùng một lần của form nhập thêm vật tư: chống cộng tồn 2 lần khi bấm Lưu 2 lần / gửi lại form cũ
CREATE TABLE IF NOT EXISTS form_tokens (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ===== Phiếu đề xuất (nhu cầu) vật tư =====
CREATE TABLE IF NOT EXISTS requests (
  id                  INTEGER PRIMARY KEY,
  number              TEXT,
  seq                 INTEGER,
  year                INTEGER,
  factory_id          INTEGER NOT NULL REFERENCES factories(id),
  title               TEXT NOT NULL,
  basis               TEXT,       -- căn cứ / nội dung đề xuất
  status              TEXT NOT NULL DEFAULT 'NHAP',
  created_by          INTEGER NOT NULL REFERENCES users(id),
  factory_approved_by INTEGER REFERENCES users(id),  -- GĐ nhà máy
  pkt_reviewer_id     INTEGER REFERENCES users(id),  -- người PKT kiểm soát (được phân công)
  pkt_checked_by      INTEGER REFERENCES users(id),
  pkt_approved_by     INTEGER REFERENCES users(id),  -- TP Kỹ thuật duyệt lần 1
  director_id         INTEGER REFERENCES users(id),  -- GĐ/PGĐ phụ trách được phân công
  director_approved_by INTEGER REFERENCES users(id),
  demand_approved_at  TEXT,
  compiler_id         INTEGER REFERENCES users(id),  -- NV tổng hợp so sánh giá
  comparison_note     TEXT,
  price_approver_id   INTEGER REFERENCES users(id),
  price_approved_by   INTEGER REFERENCES users(id),
  price_external      INTEGER NOT NULL DEFAULT 0,     -- duyệt giá ngoài phần mềm
  price_attachment    TEXT,
  price_attachment_name TEXT,
  delivered_at        TEXT,
  completed_at        TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_requests_status ON requests(status, factory_id);

CREATE TABLE IF NOT EXISTS request_items (
  id                INTEGER PRIMARY KEY,
  request_id        INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL,
  material_id       INTEGER REFERENCES materials(id),
  name              TEXT NOT NULL,
  model             TEXT,      -- mã hiệu / nước sản xuất
  spec              TEXT,      -- thông số kỹ thuật
  equipment_code    TEXT,      -- mã thiết bị
  unit              TEXT,
  quantity          REAL NOT NULL,
  use_time          TEXT,      -- thời điểm sử dụng
  purpose           TEXT,      -- mục đích sử dụng
  note              TEXT,
  competitive       INTEGER NOT NULL DEFAULT 1,  -- cần báo giá cạnh tranh
  selected_line_id  INTEGER,                     -- dòng báo giá được chọn
  received_qty      REAL,
  received_condition TEXT
);

CREATE TABLE IF NOT EXISTS request_history (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  user_id     INTEGER REFERENCES users(id),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Người được giao báo giá (tối đa 3/phiếu)
CREATE TABLE IF NOT EXISTS request_quoters (
  id          INTEGER PRIMARY KEY,
  request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'DANG_LAM',   -- DANG_LAM | DA_XONG
  done_note   TEXT,
  done_at     TEXT,
  UNIQUE (request_id, user_id)
);

CREATE TABLE IF NOT EXISTS quotes (
  id              INTEGER PRIMARY KEY,
  request_id      INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  quoter_id       INTEGER NOT NULL REFERENCES users(id),
  supplier        TEXT NOT NULL,
  contact         TEXT,
  quote_date      TEXT,
  delivery_time   TEXT,
  payment_terms   TEXT,
  note            TEXT,
  attachment      TEXT,
  attachment_name TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS quote_lines (
  id              INTEGER PRIMARY KEY,
  quote_id        INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  request_item_id INTEGER NOT NULL REFERENCES request_items(id) ON DELETE CASCADE,
  unit_price      REAL,
  vat_percent     REAL,
  brand_origin    TEXT,
  note            TEXT
);

-- ===== Phiếu xuất kho (BM.06) =====
CREATE TABLE IF NOT EXISTS issues (
  id             INTEGER PRIMARY KEY,
  number         TEXT,
  seq            INTEGER,
  year           INTEGER,
  factory_id     INTEGER NOT NULL REFERENCES factories(id),
  receiver_name  TEXT NOT NULL,   -- họ tên người nhận hàng
  receiver_address TEXT,          -- địa chỉ (bộ phận)
  reason         TEXT,            -- lý do xuất kho
  location       TEXT,            -- địa điểm
  issue_date     TEXT,
  status         TEXT NOT NULL DEFAULT 'NHAP',
  created_by     INTEGER NOT NULL REFERENCES users(id),
  approved_by    INTEGER REFERENCES users(id),
  approved_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS issue_items (
  id            INTEGER PRIMARY KEY,
  issue_id      INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  line_no       INTEGER NOT NULL,
  material_id   INTEGER NOT NULL REFERENCES materials(id),
  qty_requested REAL NOT NULL,
  qty_actual    REAL NOT NULL,
  condition     TEXT,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS issue_history (
  id          INTEGER PRIMARY KEY,
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  user_id     INTEGER REFERENCES users(id),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
