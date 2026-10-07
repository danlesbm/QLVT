/* Tiện ích giao diện: thêm/xóa dòng vật tư, gợi ý mã vật tư, xác nhận thao tác. */
(function () {
  'use strict';

  // ----- Bảng dòng động: <table data-rows> + <template data-row-template> -----
  function renumber(table) {
    table.querySelectorAll('tbody tr').forEach(function (tr, i) {
      var no = tr.querySelector('.row-no');
      if (no) no.textContent = i + 1;
    });
  }
  function addRow(table, values) {
    var tpl = document.querySelector(table.dataset.rows);
    var idx = nextIndex(table);
    table.dataset.next = idx + 1;
    var html = tpl.innerHTML.replace(/__i__/g, idx);
    var tbody = table.querySelector('tbody');
    tbody.insertAdjacentHTML('beforeend', html);
    var tr = tbody.lastElementChild;
    if (values) fill(tr, values);
    renumber(table);
    bindAutocomplete(tr);
    return tr;
  }
  function fill(tr, v) {
    Object.keys(v).forEach(function (k) {
      var el = tr.querySelector('[data-f="' + k + '"]');
      if (!el) return;
      var val = v[k] == null ? '' : v[k];
      if (el.tagName === 'SPAN' || el.tagName === 'DIV') el.textContent = val;
      else el.value = val;
    });
  }
  // Chỉ số dòng mới luôn lớn hơn mọi dòng đang có (tránh trùng tên trường khi xóa rồi thêm dòng)
  function nextIndex(table) {
    var max = -1;
    table.querySelectorAll('[name^="items["]').forEach(function (el) {
      var m = /^items\[(\d+)\]/.exec(el.name);
      if (m) max = Math.max(max, Number(m[1]));
    });
    return Math.max(max + 1, Number(table.dataset.next || 0));
  }
  document.querySelectorAll('table[data-rows]').forEach(function (table) {
    if (!table.querySelector('tbody tr')) addRow(table);
  });
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add-row]');
    if (add) {
      e.preventDefault();
      addRow(document.querySelector(add.dataset.addRow));
    }
    var del = e.target.closest('[data-del-row]');
    if (del) {
      e.preventDefault();
      var tr = del.closest('tr');
      var table = tr.closest('table');
      tr.remove();
      renumber(table);
    }
  });

  // ----- Gợi ý vật tư -----
  function bindAutocomplete(root) {
    root.querySelectorAll('input[data-ac]').forEach(function (input) {
      if (input.dataset.bound) return;
      input.dataset.bound = '1';
      // Danh sách gợi ý gắn vào body (position: fixed) để không bị bảng cuộn ngang cắt mất
      var list = document.createElement('div');
      list.className = 'ac-list d-none';
      document.body.appendChild(list);
      function place() {
        var r = input.getBoundingClientRect();
        list.style.left = Math.max(4, Math.min(r.left, window.innerWidth - Math.max(r.width, 420) - 4)) + 'px';
        list.style.top = r.bottom + 2 + 'px';
        list.style.minWidth = Math.max(r.width, 420) + 'px';
        list.style.maxHeight = Math.max(160, window.innerHeight - r.bottom - 12) + 'px';
      }
      window.addEventListener('scroll', function () { if (items.length) place(); }, true);
      window.addEventListener('resize', function () { if (items.length) place(); });
      var timer;
      var items = [];
      var on = -1;
      function render() {
        list.innerHTML = '';
        items.forEach(function (m, i) {
          var d = document.createElement('div');
          if (i === on) d.className = 'on';
          var stock = m.stock_qty != null ? ' · tồn: ' + m.stock_qty : '';
          d.innerHTML = '<b></b> <span></span><div class="small text-muted p-0 border-0"></div>';
          d.querySelector('b').textContent = m.code;
          d.querySelector('span').textContent = m.name;
          d.lastChild.textContent = [m.spec, m.manufacturer, m.unit].filter(Boolean).join(' · ') + stock;
          d.addEventListener('mousedown', function (e) { e.preventDefault(); choose(m); });
          list.appendChild(d);
        });
        if (items.length) place();
        list.classList.toggle('d-none', !items.length);
      }
      function choose(m) {
        var tr = input.closest('tr') || input.closest('form');
        fill(tr, { material_id: m.id, material_code: m.code, name: m.name, stock_qty: m.stock_qty != null ? m.stock_qty : 0 });
        // Đơn vị / thông số / hãng: mã có dữ liệu thì điền; mã để trống thì chỉ xóa chữ do lần chọn trước điền,
        // không xóa chữ người dùng tự gõ
        var desc = { unit: m.unit, spec: m.spec, model: m.manufacturer, manufacturer: m.manufacturer };
        Object.keys(desc).forEach(function (k) {
          var el = tr.querySelector('[data-f="' + k + '"]');
          if (!el) return;
          var o = {};
          if (desc[k]) { o[k] = desc[k]; fill(tr, o); el.dataset.auto = '1'; }
          else if (el.dataset.auto) { o[k] = ''; fill(tr, o); delete el.dataset.auto; }
        });
        if (input.dataset.f !== 'name') input.value = m.code + ' - ' + m.name;
        items = [];
        render();
      }
      input.addEventListener('input', function () {
        clearTimeout(timer);
        // Gõ lại thì bỏ vật tư đã chọn trước đó (tránh lưu nhầm mã cũ)
        var scope = input.closest('tr') || input.closest('form');
        if (scope) {
          var clear = input.dataset.f === 'name' ? { material_id: '', material_code: '' } : { material_id: '', unit: '', stock_qty: '' };
          fill(scope, clear);
        }
        var q = input.value.trim();
        if (q.length < 2) { items = []; render(); return; }
        timer = setTimeout(function () {
          var fsel = document.querySelector('[name="factory_id"]');
          fetch('/api/materials?q=' + encodeURIComponent(q) + '&factory_id=' + (fsel ? fsel.value : ''))
            .then(function (r) { return r.json(); })
            .then(function (data) { items = data; on = -1; render(); });
        }, 200);
      });
      input.addEventListener('keydown', function (e) {
        if (!items.length) return;
        if (e.key === 'ArrowDown') { on = Math.min(items.length - 1, on + 1); render(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { on = Math.max(0, on - 1); render(); e.preventDefault(); }
        else if (e.key === 'Enter' && on >= 0) { choose(items[on]); e.preventDefault(); }
        else if (e.key === 'Escape') { items = []; render(); }
      });
      input.addEventListener('blur', function () { setTimeout(function () { items = []; render(); }, 150); });
    });
  }
  // Người dùng sửa ô do gợi ý điền thì ô đó thành của người dùng
  document.addEventListener('input', function (e) {
    if (e.target.dataset && e.target.dataset.auto) delete e.target.dataset.auto;
  });
  window.qlvtBindAutocomplete = bindAutocomplete;
  bindAutocomplete(document);

  // Đổi nhà máy trên phiếu đề xuất: bỏ các mã đã chọn (mã riêng có thể không thuộc nhà máy mới)
  var fsel = document.querySelector('select[name="factory_id"][data-clear-materials]');
  if (fsel) {
    fsel.addEventListener('change', function () {
      document.querySelectorAll('#items tbody tr').forEach(function (tr) { fill(tr, { material_id: '', material_code: '' }); });
    });
  }

  // ----- Xác nhận trước khi gửi; khóa nút gửi để tránh bấm 2 lần -----
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var msg = form.dataset.confirm;
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    if (e.defaultPrevented || (form.method || '').toLowerCase() !== 'post') return;
    var btns = form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"]');
    // Khóa sau khi trình duyệt đã lấy giá trị nút được bấm; mở lại sau ít giây (vd tải tệp, trang không chuyển)
    setTimeout(function () { btns.forEach(function (b) { b.disabled = true; }); }, 0);
    setTimeout(function () { btns.forEach(function (b) { b.disabled = false; }); }, 8000);
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) document.querySelectorAll('form button:disabled, form input[type="submit"]:disabled').forEach(function (b) { b.disabled = false; });
  });

  // ----- Gợi ý mã tiếp theo -----
  var sug = document.querySelector('[data-suggest-code]');
  if (sug) {
    sug.addEventListener('click', function (e) {
      e.preventDefault();
      var prefix = document.querySelector('[name="prefix"]').value;
      fetch('/api/materials/suggest-code?prefix=' + encodeURIComponent(prefix))
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d.code) document.querySelector('[name="code"]').value = d.code; });
    });
  }
})();
