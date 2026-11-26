// Fungsi bersama untuk aplikasi pasien dan website pengawas.
(function () {
  // Alamat server API. Default: komputer yang sama, port 3000.
  // Untuk server di alamat lain, jalankan di konsol browser: localStorage.setItem('mr_api', 'http://alamat:3000/api')
  let override = null;
  try { override = localStorage.getItem('mr_api'); } catch (e) {}
  const host = location.hostname || 'localhost';
  const API_BASE = override || `${location.protocol === 'https:' ? 'https:' : 'http:'}//${host}:3000/api`;

  const MIN = 60e3;
  const DAY = 864e5;
  const pad = (n) => String(n).padStart(2, '0');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtQ = (q) => String(Number(q)).replace('.', ',');

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  // Format waktu; tz opsional (zona waktu pasien)
  const fmt = {
    hm(v, tz) { return v ? new Date(v).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '–'; },
    date(v, tz) { return v ? new Date(v).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }) : '–'; },
    day(v, tz) { return v ? new Date(v).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }) : '–'; },
    dt(v, tz) { return v ? fmt.date(v, tz) + ', ' + fmt.hm(v, tz) : '–'; },
    ymd(v, tz) { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(v)); },
    ago(v) {
      if (!v) return 'belum pernah';
      const m = Math.round((Date.now() - new Date(v)) / MIN);
      if (m < 1) return 'baru saja';
      if (m < 60) return m + ' menit lalu';
      if (m < 1440) return Math.round(m / 60) + ' jam lalu';
      return Math.round(m / 1440) + ' hari lalu';
    },
    until(v) {
      const m = Math.max(0, Math.round((new Date(v) - Date.now()) / MIN));
      if (m < 1) return 'sebentar lagi';
      if (m < 60) return 'dalam ' + m + ' menit';
      const h = Math.floor(m / 60), r = m % 60;
      return 'dalam ' + h + ' jam' + (r ? ' ' + r + ' menit' : '');
    },
  };

  const STATUS = { terjadwal: 'Terjadwal', due: 'Saatnya minum', diminum: 'Diminum', dilewati: 'Dilewati', terlewat: 'Terlewat', antre: 'Sedang dikirim' };

  // Ikon garis sederhana (24x24)
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    pill: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/>',
    bottle: '<path d="M9 3h6v3l2 3v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V9l2-3z"/><path d="M7 13h10"/>',
    drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    chart: '<path d="M3 20h18"/><path d="M6 16v-5M11 16V6M16 16v-8"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    camera: '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4M12 17.2v.1"/>',
    wifiOff: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19.5v.01M3 3l18 18"/>',
    volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5v.01M15 9.5v.01"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 10.5V5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 8-6.5 8-3 0-4.5-1.5-6-4L3 13.5a1.5 1.5 0 0 1 2.5-1.7L8 15"/>',
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const medIcon = (type) => icon(type === 'botol' ? 'bottle' : type === 'lain' ? 'drop' : 'pill');
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  // Cincin persentase (SVG)
  function ring(pct, size = 104, stroke = 11) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const v = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
    const color = pct === null || pct === undefined ? 'var(--line)' : v >= 80 ? 'var(--ok)' : v >= 50 ? 'var(--sun)' : 'var(--miss)';
    return `<div class="ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${(c * v) / 100} ${c}"/>
      </svg><span class="v" style="font-size:${Math.round(size / 4.2)}px">${pct === null || pct === undefined ? '–' : v + '%'}</span></div>`;
  }
  const TYPES = { pil: 'Pil, tablet, kapsul', botol: 'Sirup / botol', lain: 'Lainnya (salep, inhaler, racikan)' };

  // Aturan minum (sama dengan server): "3x1" -> 3 kali sehari, 1 tiap minum
  function parseRule(v) {
    const m = String(v || '').trim().toLowerCase().replace(/,/g, '.').match(/^(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?|½|1\/2)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const q = m[2] === '½' || m[2] === '1/2' ? 0.5 : parseFloat(m[2]);
    if (n < 1 || n > 6 || !(q > 0) || q > 20) return null;
    return { n, q };
  }
  function ruleTimes(n, first) {
    const [h, mi] = first.split(':').map(Number);
    const start = h * 60 + mi, step = 1440 / n;
    return Array.from({ length: n }, (_, i) => { const t = Math.round(start + i * step) % 1440; return pad(Math.floor(t / 60)) + ':' + pad(t % 60); }).sort();
  }
  function intervalText(n) {
    const mins = 1440 / n, h = Math.floor(mins / 60), mm = Math.round(mins % 60);
    return h + ' jam' + (mm ? ' ' + mm + ' menit' : '');
  }

  function toast(msg, warn) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast' + (warn ? ' warn' : '');
    t.innerHTML = icon(warn ? 'alert' : 'check') + '<span></span>';
    t.querySelector('span').textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), warn ? 7000 : 4500);
  }

  // Modal sederhana. onClose dipanggil saat ditutup lewat Esc atau tombol [data-close].
  let modalState = null;
  function openModal(html, { type = 'modal', onClose, closable = true } = {}) {
    closeModal(true);
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(ov);
    modalState = { ov, type, onClose, closable, prevFocus: document.activeElement };
    ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
    const f = ov.querySelector('[autofocus], input, select, button');
    if (f) f.focus();
    return ov.firstElementChild;
  }
  function closeModal(silent) {
    if (!modalState) return;
    const { ov, onClose, prevFocus } = modalState;
    modalState = null;
    ov.remove();
    if (!silent && onClose) onClose();
    if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
  }
  const modalType = () => (modalState ? modalState.type : null);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalState && modalState.closable) closeModal(); });

  // Klien API dengan token per peran
  function client(role) {
    const KEY = 'mr_token_' + role;
    let token = store.get(KEY, null);
    const listeners = [];
    const c = {
      get token() { return token; },
      setToken(t) { token = t; t ? store.set(KEY, t) : store.del(KEY); },
      onUnauthorized(fn) { listeners.push(fn); },
      async call(path, { method = 'GET', body } = {}) {
        let res;
        try {
          res = await fetch(API_BASE + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        } catch (e) {
          const err = new Error('Server MedReminder tidak dapat dihubungi. Pastikan "npm start" berjalan di VS Code.');
          err.offline = true;
          throw err;
        }
        let data = {};
        try { data = await res.json(); } catch (e) {}
        if (res.status === 401 && token) { c.setToken(null); listeners.forEach((fn) => fn()); }
        if (!res.ok) { const err = new Error(data.error || 'Server tidak merespons dengan benar.'); err.status = res.status; throw err; }
        return data;
      },
    };
    return c;
  }

  window.MR = { API_BASE, MIN, DAY, pad, $, $$, esc, fmtQ, fmt, store, STATUS, TYPES, icon, medIcon, initials, ring, parseRule, ruleTimes, intervalText, toast, openModal, closeModal, modalType, client };
})();
