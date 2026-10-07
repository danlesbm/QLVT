'use strict';

const nf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 });
const mf = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

function num(v) {
  return v == null || v === '' ? '' : nf.format(Number(v));
}
function money(v) {
  return v == null || v === '' ? '' : mf.format(Number(v));
}
function date(v, withTime = false) {
  if (!v) return '';
  const d = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return v;
  const p = (x) => String(x).padStart(2, '0');
  const s = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${s} ${p(d.getHours())}:${p(d.getMinutes())}` : s;
}
/** Tạo query string giữ các bộ lọc hiện tại. */
function qs(query, patch = {}) {
  const o = { ...query, ...patch };
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

module.exports = { num, money, date, qs };
