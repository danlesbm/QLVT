'use strict';

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Chuẩn hóa giá trị cho node:sqlite (không nhận undefined). */
const n = (v) => (v === undefined || v === '' ? null : v);
const str = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
};
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const x = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(x) ? x : null;
};
const toArray = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : v == null ? [] : [v]);

/** Chỉ chấp nhận đường dẫn nội bộ dạng /abc (chặn //host, /\host, ký tự điều khiển) để tránh chuyển hướng ra ngoài. */
const safeNext = (v) => (typeof v === 'string' && /^\/(?![/\\])[^\\\x00-\x1f]*$/.test(v) ? v : '/');

module.exports = { AppError, n, str, num, toArray, safeNext };
