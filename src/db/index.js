'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { seedBase } = require('./seed-base');

let current = null;

/** Mở (hoặc tạo) CSDL, chạy lược đồ và dữ liệu nền. file=':memory:' dùng cho kiểm thử. */
function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  migrate(db);
  db.tx = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  db.one = (sql, ...p) => db.prepare(sql).get(...p);
  db.all = (sql, ...p) => db.prepare(sql).all(...p);
  db.run = (sql, ...p) => db.prepare(sql).run(...p);
  seedBase(db);
  current = db;
  return db;
}

/** Nâng cấp CSDL tạo từ bản trước: thêm cột / chỉ mục mới (CREATE TABLE IF NOT EXISTS không thêm cột). */
function migrate(db) {
  const addColumn = (table, column, def) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  };
  addColumn('factories', 'department_id', 'INTEGER REFERENCES departments(id)');
  addColumn('departments', 'virtual', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('users', 'sso_admin', 'INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_factories_department ON factories(department_id) WHERE department_id IS NOT NULL');
  db.exec('CREATE INDEX IF NOT EXISTS ix_user_departments_dep ON user_departments(department_id)');
}

function get() {
  if (!current) throw new Error('CSDL chưa được mở');
  return current;
}

module.exports = { open, get };
