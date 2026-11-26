// Aplikasi pasien MedReminder (versi web).
// Jadwal dosis dibuat server. Aplikasi ini membunyikan alarm dan meminta swafoto (wajib) sebagai bukti.
// Konfirmasi yang dibuat saat offline disimpan di antrean dan dikirim ulang otomatis.
const { $, esc, fmt, fmtQ, store, STATUS, TYPES, icon, medIcon, ring: ringChart, parseRule, ruleTimes, intervalText, toast, openModal, closeModal, modalType, MIN, DAY } = MR;
const api = MR.client('pasien');

const WINDOW = 30 * MIN;   // jendela minum
const REPEAT = 5 * MIN;    // alarm diulang tiap 5 menit
const POSES = ['Acungkan jempol', 'Angkat dua jari di samping wajah', 'Tutup satu mata', 'Miringkan kepala ke kiri',
  'Miringkan kepala ke kanan', 'Sentuh pipi dengan tangan yang bebas', 'Tersenyum lebar', 'Letakkan tangan bebas di dagu'];

const S = { user: null, meds: [], doses: [], links: [], history: null, historyDays: 30, photoIds: new Set(), online: true, tab: 'hari', authMode: 'login' };

/* ---------- Penyimpanan lokal per akun ---------- */
const K = (name) => `mr_${name}_${S.user.id}`;
const queue = { all: () => store.get(K('queue'), []), save: (q) => store.set(K('queue'), q) };
const setup = { get: () => store.get(K('setup'), {}), set: (patch) => store.set(K('setup'), { ...setup.get(), ...patch }) };
const tz = () => (S.user && S.user.timezone) || undefined;
const todayYmd = () => fmt.ymd(Date.now(), tz());
const firstName = () => String(S.user.name).trim().split(/\s+/)[0];

/* ---------- Penyimpanan foto di IndexedDB (fallback ke localStorage) ---------- */
const photoStore = (() => {
  let dbPromise = null;
  function openDB() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('medreminder_photos', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('photos')) {
            const os = db.createObjectStore('photos', { keyPath: 'k' });
            os.createIndex('userId', 'userId', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbPromise;
  }
  const key = (uid, id) => `${uid}:${id}`;
  async function loadIds(uid) {
    S.photoIds = new Set();
    const legacy = store.get(`mr_photos_${uid}`, {});
    const db = await openDB();
    if (!db) {
      for (const id of Object.keys(legacy)) S.photoIds.add(Number(id));
      return;
    }
    // Migrasi foto lama dari localStorage ke IndexedDB agar localStorage tidak penuh
    const legacyEntries = Object.entries(legacy);
    if (legacyEntries.length) {
      await new Promise((resolve) => {
        const tx = db.transaction('photos', 'readwrite');
        const os = tx.objectStore('photos');
        for (const [id, val] of legacyEntries) os.put({ k: key(uid, id), userId: uid, doseId: Number(id), val });
        tx.oncomplete = () => { store.del(`mr_photos_${uid}`); resolve(); };
        tx.onerror = () => resolve();
      });
    }
    await new Promise((resolve) => {
      const tx = db.transaction('photos', 'readonly');
      const idx = tx.objectStore('photos').index('userId');
      const req = idx.getAllKeys(IDBKeyRange.only(uid));
      req.onsuccess = () => {
        for (const k of req.result || []) {
          const id = Number(String(k).split(':')[1]);
          if (Number.isFinite(id)) S.photoIds.add(id);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  }
  async function get(uid, id) {
    const db = await openDB();
    if (db) {
      const rec = await new Promise((resolve) => {
        const req = db.transaction('photos', 'readonly').objectStore('photos').get(key(uid, id));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      if (rec) return rec.val;
    }
    return store.get(`mr_photos_${uid}`, {})[id] || null;
  }
  async function set(uid, id, val) {
    const db = await openDB();
    if (db) {
      const ok = await new Promise((resolve) => {
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put({ k: key(uid, id), userId: uid, doseId: Number(id), val });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      });
      if (ok) { S.photoIds.add(Number(id)); return true; }
      return false;
    }
    const legacy = store.get(`mr_photos_${uid}`, {});
    legacy[id] = val;
    const ok = store.set(`mr_photos_${uid}`, legacy);
    if (ok) S.photoIds.add(Number(id));
    return ok;
  }
  async function del(uid, id) {
    S.photoIds.delete(Number(id));
    const legacy = store.get(`mr_photos_${uid}`, {});
    if (legacy[id]) { delete legacy[id]; store.set(`mr_photos_${uid}`, legacy); }
    const db = await openDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction('photos', 'readwrite');
      tx.objectStore('photos').delete(key(uid, id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  async function clearUser(uid) {
    S.photoIds.clear();
    store.del(`mr_photos_${uid}`);
    const db = await openDB();
    if (!db) return;
    await new Promise((resolve) => {
      const tx = db.transaction('photos', 'readwrite');
      const os = tx.objectStore('photos');
      const req = os.index('userId').getAllKeys(IDBKeyRange.only(uid));
      req.onsuccess = () => { for (const k of req.result || []) os.delete(k); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  return { loadIds, get, set, del, clearUser, has: (id) => S.photoIds.has(Number(id)), count: () => S.photoIds.size };
})();

/* ---------- Status dosis ---------- */
const queued = (id) => queue.all().find((q) => q.dose_id === id);
const isDue = (d, now = Date.now()) => d.status === 'terjadwal' && !queued(d.id) && now >= +new Date(d.scheduled_at) && now < +new Date(d.scheduled_at) + WINDOW;
function shownStatus(d) {
  if (queued(d.id)) return 'antre';
  if (isDue(d)) return 'due';
  if (d.status === 'terjadwal' && Date.now() >= +new Date(d.scheduled_at) + WINDOW) return 'terlewat';
  return d.status;
}
const CHIP_ICON = { due: 'bell', diminum: 'check', terlewat: 'x', antre: 'refresh', terjadwal: 'clock', dilewati: 'x' };
const chip = (st) => `<span class="chip ${st}">${icon(CHIP_ICON[st])}${STATUS[st]}</span>`;
const doseLabel = (d) => `${fmtQ(d.qty_per_dose)} ${d.unit}`;

/* ---------- Muat data ---------- */
async function loadAll() {
  const from = new Date(Date.now() - DAY).toISOString();
  const to = new Date(Date.now() + 2 * DAY).toISOString();
  try {
    const [m, d, l] = await Promise.all([
      api.call('/medications'),
      api.call(`/doses?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      api.call('/links'),
    ]);
    S.meds = m.medications; S.doses = d.doses; S.links = l.supervisors; S.online = true;
    store.set(K('cache'), { meds: S.meds, doses: S.doses, links: S.links, at: Date.now() });
  } catch (e) {
    if (!e.offline) throw e;
    S.online = false;
    const c = store.get(K('cache'), null);
    if (c) { S.meds = c.meds; S.doses = c.doses; S.links = c.links; }
  }
}

async function flushQueue() {
  const q = queue.all();
  if (!q.length) return;
  try {
    const r = await api.call('/doses/sync', {
      method: 'POST',
      body: { sent_at: new Date().toISOString(), updates: q.map(({ dose_id, status, device_time, pose, face_check }) => ({ dose_id, status, device_time, pose, face_check })) },
    });
    S.online = true;
    const sent = new Set();
    const rejected = new Map();
    for (const res of r.results) {
      sent.add(res.dose_id);
      const d = S.doses.find((x) => x.id === res.dose_id);
      if (d && res.status) d.status = res.status;
      if (res.error) {
        rejected.set(res.dose_id, res.error);
        await photoStore.del(S.user.id, res.dose_id);
        store.set(K('hashes'), store.get(K('hashes'), []).filter((o) => o.dose_id !== res.dose_id));
        const item = q.find((x) => x.dose_id === res.dose_id);
        toast(`Konfirmasi ${item ? item.medication : 'dosis'} tidak diterima: ${res.error}`, true);
      }
    }
    if (sent.size) S.history = null;
    queue.save(queue.all().filter((x) => !sent.has(x.dose_id)));
    const before = new Map(S.meds.map((m) => [m.id, m.low_stock]));
    S.meds = (await api.call('/medications')).medications;
    for (const m of S.meds) if (m.low_stock && !before.get(m.id)) toast(`Stok ${m.name} tinggal ${fmtQ(m.stock)}. Segera isi ulang.`, true);
    return rejected;
  } catch (e) {
    if (e.offline) S.online = false;
    else toast(e.message, true);
    return null;
  }
}

/* ---------- Kerangka tampilan ---------- */
function renderNet() {
  const el = $('#net');
  if (!S.user) { el.hidden = true; return; }
  const n = queue.all().length;
  el.hidden = false;
  el.innerHTML = S.online
    ? (n ? `<span class="dot wait"></span>Mengirim ${n}` : '<span class="dot"></span>Tersambung')
    : `<span class="dot off"></span>Offline${n ? ` · ${n} menunggu` : ''}`;
}

const TABS = [['hari', 'Hari ini', 'home'], ['obat', 'Obat', 'pill'], ['riwayat', 'Riwayat', 'chart'], ['pengawas', 'Pengawas', 'users']];

function render() {
  renderNet();
  if (!S.user) return authView();
  const dueCount = S.doses.filter((d) => isDue(d)).length;
  const banners = [];
  if (!audioReady()) banners.push(`<div class="banner info"><div class="msg">${icon('volume')}<span>Ketuk <strong>Aktifkan suara</strong> agar alarm bisa berbunyi di halaman ini.</span></div><button class="btn sm primary" data-act="sound">Aktifkan suara</button></div>`);
  if (!S.online) banners.push(`<div class="banner miss"><div class="msg">${icon('wifiOff')}<span>Tidak tersambung ke server. Jadwal tetap berjalan, foto konfirmasi dikirim otomatis saat tersambung lagi.</span></div><button class="btn sm" data-act="retry">Coba lagi</button></div>`);
  $('#main').innerHTML = `
    <nav class="nav" aria-label="Menu">${TABS.map(([k, l, ic]) => `<button data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${icon(ic)}<span>${l}</span>${k === 'hari' && dueCount ? `<span class="badge">${dueCount}</span>` : ''}</button>`).join('')}</nav>
    ${banners.length ? `<div class="stack-sm" style="margin-bottom:1rem">${banners.join('')}</div>` : ''}
    <div id="view"></div>`;
  const v = $('#view');
  if (S.tab === 'hari') v.innerHTML = todayView();
  else if (S.tab === 'obat') v.innerHTML = medsView();
  else if (S.tab === 'riwayat') { v.innerHTML = historyView(); if (!S.history) loadHistory(); }
  else v.innerHTML = accountView();
}

/* ---------- Masuk / daftar ---------- */
function authView() {
  const reg = S.authMode === 'register';
  $('#main').innerHTML = `<div class="narrow stack">
    <div><h1>${reg ? 'Buat akun' : 'Selamat datang'}</h1><p class="muted" style="margin-top:.35rem">${reg ? 'Daftar sekali, lalu MedReminder mengingatkan setiap jadwal minum obatmu.' : 'Masuk untuk melihat jadwal minum obatmu hari ini.'}</p></div>
    <div class="card stack">
      <div class="seg" role="group" aria-label="Pilih"><button data-auth="login" aria-pressed="${!reg}">Masuk</button><button data-auth="register" aria-pressed="${reg}">Daftar</button></div>
      <form id="auth-form" class="stack" novalidate>
        ${reg ? '<div><label for="a-name">Nama</label><input id="a-name" name="name" autocomplete="name" placeholder="Nama lengkap"></div>' : ''}
        <div><label for="a-email">Email</label><input id="a-email" name="email" type="email" autocomplete="email" placeholder="nama@email.com"></div>
        <div><label for="a-pw">Password</label><input id="a-pw" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="${reg ? 'Minimal 6 karakter' : ''}"></div>
        ${reg ? `<div class="note stack-sm">
          <div class="row" style="gap:.5rem;color:var(--text)">${icon('shield')}<strong>Data yang dipakai</strong></div>
          <p>Setiap dosis dikonfirmasi dengan swafoto dari kamera depan. Foto dienkripsi dan hanya disimpan di perangkat ini.</p>
          <p>Status setiap dosis (diminum atau terlewat) dan waktunya dikirim ke server.</p>
          <p>Riwayat dosis bisa dilihat pengawas yang kamu tautkan sendiri.</p>
        </div>
        <label class="check"><input type="checkbox" name="consent"> Saya memahami dan menyetujui penggunaan data di atas.</label>` : ''}
        <div class="err" id="auth-err"></div>
        <button class="btn primary lg block" type="submit">${reg ? 'Buat akun' : 'Masuk'}</button>
      </form>
    </div>
    <p class="small muted" style="text-align:center">Keluarga atau perawat? Daftar di <a href="../pengawas/">website pengawas</a>.</p>
  </div>`;
}

async function submitAuth(form) {
  const fd = new FormData(form);
  const reg = S.authMode === 'register';
  const err = $('#auth-err');
  const btn = form.querySelector('button[type=submit]');
  const body = { email: fd.get('email'), password: fd.get('password'), role: 'pasien' };
  if (reg) Object.assign(body, { name: fd.get('name'), consent: fd.get('consent') === 'on', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (reg && !body.consent) { err.textContent = 'Centang persetujuan penggunaan data untuk mendaftar.'; return; }
  btn.disabled = true; err.textContent = '';
  try {
    const r = await api.call(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
    api.setToken(r.token);
    S.user = r.user; S.tab = 'hari';
    store.set('mr_last_user_pasien', S.user);
    await photoStore.loadIds(S.user.id);
    await loadAll();
    await flushQueue();
    render();
    if (reg) toast('Akun dibuat. Ikuti langkah awal di layar ini.');
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false;
  }
}

/* ---------- Hari ini ---------- */
function checklistHTML() {
  const st = setup.get();
  const items = [
    { done: S.meds.length > 0, title: 'Tambah obat pertama', text: 'Tulis aturan minum seperti 3x1. Jam alarm dihitung otomatis.', btn: `<button class="btn sm primary" data-act="add-med">${icon('plus')}Tambah obat</button>` },
    { done: !!st.sound, title: 'Aktifkan suara dan notifikasi', text: 'Supaya alarm terdengar saat halaman ini terbuka.', btn: `<button class="btn sm" data-act="setup-sound">${icon('volume')}Aktifkan</button>` },
    { done: !!st.camera, title: 'Coba kamera', text: 'Setiap dosis wajib dikonfirmasi dengan swafoto. Pastikan kamera bisa dipakai.', btn: `<button class="btn sm" data-act="test-camera">${icon('camera')}Coba kamera</button>` },
    { done: S.links.length > 0, title: 'Tautkan pengawas (opsional)', text: 'Keluarga atau perawat bisa ikut memantau.', btn: `<button class="btn sm" data-tab="pengawas">${icon('link')}Tautkan</button>` },
  ];
  const required = items.slice(0, 3).every((i) => i.done);
  if (required && (items[3].done || st.dismissed)) return '';
  const nextIdx = items.findIndex((i) => !i.done);
  const doneCount = items.filter((i) => i.done).length;
  return `<section class="card">
    <div class="spread"><div><h3>Langkah awal</h3><p class="small muted">${doneCount} dari ${items.length} selesai</p></div>${required ? '<button class="btn sm ghost" data-act="dismiss-setup">Sembunyikan</button>' : ''}</div>
    <ol class="steps">${items.map((it, i) => `<li class="${it.done ? 'done' : i === nextIdx ? 'next' : ''}">
      <span class="n">${it.done ? icon('check') : i + 1}</span>
      <div><div class="s-title">${it.title}</div>${it.done ? '' : `<div class="small muted">${it.text}</div>`}</div>
      <div>${it.done ? '' : it.btn}</div></li>`).join('')}</ol></section>`;
}

function nowCard() {
  const now = Date.now();
  const due = S.doses.filter((d) => isDue(d, now)).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  if (due.length) {
    const d = due[0];
    const left = Math.max(1, Math.round((+new Date(d.scheduled_at) + WINDOW - now) / MIN));
    return `<section class="now due" aria-live="polite">
      <span class="label">${icon('bell')}Saatnya minum</span>
      <div class="time">${fmt.hm(d.scheduled_at, tz())}</div>
      <div class="meds"><strong>${esc(d.medication)}</strong><span>${esc(doseLabel(d))}${d.note ? ' · ' + esc(d.note) : ''}</span></div>
      <button class="btn lg block" data-act="confirm" data-id="${d.id}">${icon('camera')}Ambil foto dan konfirmasi</button>
      <div class="foot">${icon('clock')}Sisa ${left} menit. Setelah pukul ${fmt.hm(+new Date(d.scheduled_at) + WINDOW, tz())} dosis tercatat terlewat.</div>
      ${due.length > 1 ? `<div class="foot">${icon('pill')}Masih ada ${due.length - 1} obat lain yang harus diminum sekarang.</div>` : ''}
    </section>`;
  }
  const next = S.doses.filter((d) => d.status === 'terjadwal' && +new Date(d.scheduled_at) > now).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))[0];
  if (next) {
    const same = S.doses.filter((d) => d.scheduled_at === next.scheduled_at && d.status === 'terjadwal' && !queued(d.id));
    const isToday = fmt.ymd(next.scheduled_at, tz()) === todayYmd();
    return `<section class="now">
      <span class="label">${icon('clock')}Berikutnya</span>
      <div class="time">${fmt.hm(next.scheduled_at, tz())}</div>
      <div class="meds">${same.map((d) => `<strong>${esc(d.medication)}</strong><span>${esc(doseLabel(d))}${d.note ? ' · ' + esc(d.note) : ''}</span>`).join('')}</div>
      <div class="foot">${icon('calendar')}${isToday ? 'Hari ini' : esc(fmt.day(next.scheduled_at, tz()))}, ${fmt.until(next.scheduled_at)}</div>
    </section>`;
  }
  if (S.meds.length) return `<section class="now quiet"><span class="label">${icon('check')}Selesai</span><div class="meds" style="margin-top:.8rem"><strong>Tidak ada jadwal dalam 2 hari ke depan</strong><span>Tambahkan obat baru kalau dokter memberi resep lagi.</span></div></section>`;
  return '';
}

function doseItem(d) {
  const st = shownStatus(d);
  const hasPhoto = photoStore.has(d.id);
  let acts = '';
  if (st === 'due') acts = `<button class="btn sm primary" data-act="confirm" data-id="${d.id}">${icon('camera')}Foto</button>`;
  else if (hasPhoto) acts = `<button class="icon-btn" data-act="photo" data-id="${d.id}" aria-label="Lihat foto bukti">${icon('image')}</button>`;
  const when = d.status === 'diminum' && d.device_time ? `<span>pukul ${fmt.hm(d.device_time, tz())}</span>` : '';
  return `<li class="item ${['diminum', 'terlewat', 'dilewati'].includes(st) ? 'done' : ''}">
    <div class="when">${fmt.hm(d.scheduled_at, tz())}</div>
    <div><div class="name">${esc(d.medication)}</div><div class="meta"><span>${esc(doseLabel(d))}</span>${chip(st)}${when}</div></div>
    <div class="acts">${acts}</div></li>`;
}

function todayView() {
  if (!S.meds.length && !S.doses.length) {
    return `<div class="stack">
      <div><h1>Halo, ${esc(firstName())}</h1><p class="muted">${esc(fmt.day(Date.now(), tz()))}</p></div>
      ${checklistHTML()}
    </div>`;
  }
  const t = todayYmd(), tomorrow = fmt.ymd(Date.now() + DAY, tz());
  const byDay = (ymd) => S.doses.filter((d) => fmt.ymd(d.scheduled_at, tz()) === ymd);
  const today = byDay(t), next = byDay(tomorrow);
  const taken = today.filter((d) => d.status === 'diminum' || queued(d.id)).length;
  const missed = today.filter((d) => shownStatus(d) === 'terlewat').length;
  const low = S.meds.filter((m) => m.low_stock);
  return `<div class="stack">
    <div><h1>Halo, ${esc(firstName())}</h1><p class="muted">${esc(fmt.day(Date.now(), tz()))}</p></div>
    ${checklistHTML()}
    ${nowCard()}
    ${low.map((m) => `<div class="banner sun"><div class="msg">${icon('box')}<span><strong>Stok ${esc(m.name)} ${m.stock <= 0 ? 'habis' : 'tinggal ' + fmtQ(m.stock)}.</strong> ${m.stock > 0 ? (m.days_left > 0 ? `Cukup sekitar ${m.days_left} hari lagi.` : 'Cukup kurang dari 1 hari lagi.') : 'Isi ulang agar bisa diminum.'}</span></div><button class="btn sm" data-act="refill" data-id="${m.id}">Isi ulang</button></div>`).join('')}
    <section class="card">
      <div class="spread"><h3>Jadwal hari ini</h3><span class="small muted">${taken} dari ${today.length} diminum</span></div>
      ${today.length ? `<div class="progress" style="margin:.75rem 0 .5rem"><div class="track">
          <span class="ok" style="width:${(taken / today.length) * 100}%"></span><span class="miss" style="width:${(missed / today.length) * 100}%"></span></div></div>
        <ul class="list">${today.map(doseItem).join('')}</ul>` : '<p class="muted" style="margin-top:.5rem">Tidak ada jadwal minum hari ini.</p>'}
    </section>
    ${next.length ? `<section class="card"><h3>Besok</h3><ul class="list" style="margin-top:.5rem">${next.map(doseItem).join('')}</ul></section>` : ''}
    <p class="small muted" style="text-align:center">Alarm berbunyi selama halaman ini terbuka, diulang tiap 5 menit selama 30 menit.</p>
  </div>`;
}

/* ---------- Obat ---------- */
function medsView() {
  const t = todayYmd();
  if (!S.meds.length) {
    return `<div class="card empty"><div class="art">${icon('pill')}</div><h2>Belum ada obat</h2>
      <p class="muted">Tambahkan obat beserta aturan minumnya. Jam alarm dihitung otomatis.</p>
      <button class="btn primary lg" data-act="add-med">${icon('plus')}Tambah obat</button></div>`;
  }
  return `<div class="stack">
    <div class="spread"><h1>Obat saya</h1><button class="btn primary" data-act="add-med">${icon('plus')}Tambah</button></div>
    <section class="card">${S.meds.map((m) => {
      const ended = m.end_date < t;
      const full = Math.max(m.qty_per_dose * m.times_per_day * m.duration_days, m.stock, 1);
      const w = Math.min(100, Math.round((m.stock / full) * 100));
      return `<div class="med">
        <div class="med-ico ${m.type}">${medIcon(m.type)}</div>
        <div>
          <div class="spread" style="align-items:flex-start"><div><h3>${esc(m.name)}</h3><p class="small muted">${fmtQ(m.qty_per_dose)} ${esc(m.unit)} · ${m.times_per_day}x sehari${m.note ? ' · ' + esc(m.note) : ''}</p></div>
            ${ended ? '<span class="chip neutral">Selesai</span>' : `<span class="chip neutral">${esc(m.rule.replace('x', '×'))}</span>`}</div>
          <div class="times">${m.schedule_times.map((x) => `<span class="chip terjadwal">${icon('clock')}${x.replace(':', '.')}</span>`).join('')}</div>
          <p class="tiny muted">${icon('calendar')} ${fmt.date(m.start_date + 'T12:00:00')} sampai ${fmt.date(m.end_date + 'T12:00:00')}</p>
          <div class="meter ${m.stock <= 0 ? 'empty' : m.low_stock ? 'low' : ''}"><span style="width:${w}%"></span></div>
          <p class="small ${m.low_stock ? 'bad' : 'muted'}">Stok ${fmtQ(m.stock)} ${esc(m.unit.split(' ')[0])}${m.days_left !== null ? `, cukup sekitar ${m.days_left} hari` : ''}</p>
          <div class="acts">
            <button class="btn sm soft" data-act="refill" data-id="${m.id}">${icon('box')}Isi ulang</button>
            <button class="btn sm" data-act="edit-med" data-id="${m.id}">${icon('edit')}Ubah</button>
            <button class="btn sm danger" data-act="del-med" data-id="${m.id}" aria-label="Hapus ${esc(m.name)}">${icon('trash')}Hapus</button>
          </div>
        </div></div>`;
    }).join('')}</section></div>`;
}

function rulePreview(rule, first, startDate, durationDays) {
  const r = parseRule(rule);
  if (!r) return `<span class="bad">Tulis aturan seperti 3x1: 3 kali sehari, 1 tiap minum. Maksimal 6 kali sehari.</span>`;
  if (!/^\d{2}:\d{2}$/.test(first || '')) return 'Pilih jam minum pertama.';
  let pastNote = '';
  const days = Number(durationDays);
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') && Number.isInteger(days) && days >= 1) {
    const end = new Date(startDate + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + days - 1);
    if (!Number.isNaN(end.getTime()) && end.toISOString().slice(0, 10) < todayYmd()) {
      pastNote = `<div class="bad" style="margin-top:.35rem">Periode obat berakhir di masa lalu, sehingga tidak ada jadwal baru yang dibuat.</div>`;
    }
  }
  return `<div class="row" style="gap:.4rem;margin-bottom:.35rem;color:var(--text)">${icon('bell')}<strong>Alarm ${r.n}x sehari, tiap ${intervalText(r.n)}</strong></div>
    <div class="times">${ruleTimes(r.n, first).map((x) => `<span class="chip antre">${x.replace(':', '.')}</span>`).join('')}</div>
    <div>Stok berkurang ${fmtQ(r.q)} setiap kali minum.</div>${pastNote}`;
}

function medForm(med) {
  if (!S.online) { toast('Menambah atau mengubah obat butuh koneksi ke server.', true); return; }
  const m = med || { name: '', type: 'pil', unit: '', note: '', rule: '3x1', first_time: '06:00', duration_days: 7, start_date: todayYmd(), stock: 30, min_stock: 5 };
  const el = openModal(`<form id="med-form" class="stack" novalidate>
    <div class="modal-head"><h2>${med ? 'Ubah obat' : 'Tambah obat'}</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></div>
    <div><label for="m-name">Nama obat</label><input id="m-name" name="name" value="${esc(m.name)}" placeholder="Contoh: Amoksisilin" autofocus></div>
    <div class="grid2">
      <div><label for="m-type">Jenis</label><select id="m-type" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${m.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label for="m-unit">Satuan</label><input id="m-unit" name="unit" value="${esc(m.unit)}" placeholder="Contoh: tablet 500 mg"></div>
    </div>
    <div class="grid2">
      <div><label for="m-rule">Aturan minum</label><input id="m-rule" name="rule" value="${esc(m.rule)}" placeholder="3x1" autocomplete="off" inputmode="text"><span class="hint">Kali sehari × jumlah tiap minum. Contoh 3x1 atau 2x½.</span></div>
      <div><label for="m-first">Minum pertama pukul</label><input id="m-first" name="first_time" type="time" value="${esc(m.first_time)}"></div>
    </div>
    <div class="note" id="rule-preview" aria-live="polite">${rulePreview(m.rule, m.first_time, m.start_date, m.duration_days)}</div>
    <div class="grid2">
      <div><label for="m-start">Mulai tanggal</label><input id="m-start" name="start_date" type="date" value="${esc(m.start_date)}"></div>
      <div><label for="m-days">Lama minum (hari)</label><input id="m-days" name="duration_days" type="number" min="1" max="365" value="${esc(m.duration_days)}"></div>
    </div>
    <div class="grid2">
      <div><label for="m-stock">Stok sekarang</label><input id="m-stock" name="stock" type="number" min="0" step="any" value="${esc(m.stock)}"></div>
      <div><label for="m-min">Ingatkan saat stok tinggal</label><input id="m-min" name="min_stock" type="number" min="0" step="any" value="${esc(m.min_stock)}"></div>
    </div>
    <div><label for="m-note">Catatan <span class="muted" style="font-weight:400">(opsional)</span></label><input id="m-note" name="note" value="${esc(m.note || '')}" placeholder="Contoh: sesudah makan"></div>
    ${med ? '<p class="note">Kalau aturan, jam, atau tanggal diubah, jadwal mendatang dibuat ulang. Riwayat yang sudah lewat tidak berubah.</p>' : ''}
    <div class="err" id="med-err"></div>
    <button class="btn primary lg block" type="submit">${med ? 'Simpan perubahan' : 'Simpan obat'}</button>
  </form>`, { type: 'form' });
  const f = $('#med-form', el);
  f.addEventListener('input', (e) => {
    if (['rule', 'first_time', 'start_date', 'duration_days'].includes(e.target.name)) {
      $('#rule-preview', el).innerHTML = rulePreview(f.rule.value, f.first_time.value, f.start_date.value, f.duration_days.value);
    }
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f).entries());
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; $('#med-err', el).textContent = '';
    try {
      const r = await api.call(med ? `/medications/${med.id}` : '/medications', { method: med ? 'PUT' : 'POST', body });
      closeModal(true);
      await loadAll();
      render();
      toast(med ? `${r.medication.name} diperbarui${r.schedule_changed ? ', jadwal mendatang dibuat ulang' : ''}` : `${r.medication.name} disimpan. Alarm tiap ${r.medication.interval}.`);
    } catch (err) {
      $('#med-err', el).textContent = err.message;
      btn.disabled = false;
    }
  });
}

function refillForm(med) {
  if (!S.online) { toast('Isi ulang stok butuh koneksi ke server.', true); return; }
  const perDay = med.qty_per_dose * med.times_per_day;
  const el = openModal(`<form id="refill-form" class="stack" novalidate>
    <div class="modal-head"><h2>Isi ulang ${esc(med.name)}</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></div>
    <p class="muted">Stok sekarang ${fmtQ(med.stock)} ${esc(med.unit)}.</p>
    <div><label for="r-amt">Jumlah yang dibeli</label><input id="r-amt" name="amount" type="number" min="0.5" step="0.5" value="${perDay * 10}" autofocus></div>
    <div class="note" id="r-prev"></div>
    <div class="err" id="r-err"></div>
    <button class="btn primary lg block" type="submit">Tambah stok</button>
  </form>`, { type: 'form' });
  const f = $('#refill-form', el);
  const prev = () => { const a = Number(f.amount.value) || 0; const total = +(med.stock + a).toFixed(2); $('#r-prev', el).innerHTML = `Stok menjadi <strong>${fmtQ(total)}</strong>, cukup sekitar <strong>${Math.floor(total / perDay)} hari</strong>.`; };
  prev();
  f.addEventListener('input', prev);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true; $('#r-err', el).textContent = '';
    try {
      const r = await api.call(`/medications/${med.id}/refill`, { method: 'POST', body: { amount: Number(f.amount.value) } });
      closeModal(true);
      S.meds = S.meds.map((m) => (m.id === med.id ? r.medication : m));
      render();
      toast(`Stok ${med.name} sekarang ${fmtQ(r.medication.stock)}`);
    } catch (err) {
      $('#r-err', el).textContent = err.message;
      btn.disabled = false;
    }
  });
}

function confirmBox(title, text, okLabel, danger) {
  return new Promise((resolve) => {
    const el = openModal(`<div class="stack"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="grid2"><button class="btn" data-close>Batal</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div></div>`,
    { type: 'confirm', onClose: () => resolve(false) });
    $('[data-ok]', el).addEventListener('click', () => { closeModal(true); resolve(true); });
  });
}

/* ---------- Riwayat ---------- */
async function loadHistory() {
  const days = S.historyDays;
  let data;
  try { data = await api.call(`/doses/history?days=${days}`); }
  catch (e) { data = { error: e.offline ? 'Riwayat butuh koneksi ke server.' : e.message }; }
  if (S.historyDays !== days) return;
  S.history = data;
  if (S.tab === 'riwayat' && !modalType()) render();
}

function historyView() {
  if (!S.history) return '<p class="muted">Memuat riwayat…</p>';
  if (S.history.error) return `<div class="card empty"><div class="art">${icon('wifiOff')}</div><p>${esc(S.history.error)}</p><button class="btn" data-act="reload-history">${icon('refresh')}Muat ulang</button></div>`;
  const { summary, doses } = S.history;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const ymd = fmt.ymd(Date.now() - i * DAY, tz());
    const list = doses.filter((d) => fmt.ymd(d.scheduled_at, tz()) === ymd);
    const ok = list.filter((d) => d.status === 'diminum').length;
    days.push({ ymd, pct: list.length ? Math.round((ok / list.length) * 100) : null, label: Number(ymd.slice(8)) });
  }
  const nPhotos = photoStore.count();
  return `<div class="stack">
    <div class="spread"><h1>Riwayat</h1>
      <select id="history-days" aria-label="Periode riwayat" style="width:auto;min-height:40px;padding:.4rem 2rem .4rem .75rem">
        ${[[7, '7 hari'], [30, '30 hari'], [90, '90 hari']].map(([v, l]) => `<option value="${v}" ${S.historyDays === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    <section class="card"><h3>Kepatuhan ${S.historyDays} hari</h3>
      <div class="stats" style="margin-top:1rem">${ringChart(summary.adherence, 120, 12)}
        <div class="counts">
          <div class="count"><strong style="color:var(--ok)">${summary.taken}</strong><span>Diminum</span></div>
          <div class="count"><strong style="color:var(--miss)">${summary.missed}</strong><span>Terlewat</span></div>
        </div></div>
    </section>
    <section class="card"><div class="spread"><h3>14 hari terakhir</h3><span class="tiny muted">Garis putus-putus: tidak ada jadwal</span></div>
      <div class="bars" style="margin-top:1rem">${days.map((d) => `<div class="b ${d.pct === null ? 'none' : d.pct < 80 ? 'low' : ''}" title="${d.ymd}: ${d.pct === null ? 'tidak ada dosis' : d.pct + '%'}"><span style="height:${d.pct || 0}%"></span></div>`).join('')}</div>
      <div class="barlabels">${days.map((d) => `<span>${d.label}</span>`).join('')}</div>
    </section>
    <section class="card"><h3>Dosis terakhir</h3>
      ${doses.length ? `<ul class="list" style="margin-top:.5rem">${doses.slice(0, 30).map((d) => `<li class="item">
        <div class="when">${fmt.hm(d.scheduled_at, tz())}</div>
        <div><div class="name">${esc(d.medication)}</div><div class="meta"><span>${esc(fmt.date(d.scheduled_at, tz()))}</span>${chip(d.status)}</div></div>
        <div class="acts">${photoStore.has(d.id) ? `<button class="icon-btn" data-act="photo" data-id="${d.id}" aria-label="Lihat foto bukti">${icon('image')}</button>` : ''}</div></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:.5rem">Belum ada dosis yang selesai.</p>'}
    </section>
    <div class="grid2">
      <button class="btn" data-act="csv" ${doses.length ? '' : 'disabled'}>${icon('download')}Ekspor CSV</button>
      <button class="btn danger" data-act="del-photos" ${nPhotos ? '' : 'disabled'}>${icon('trash')}Hapus ${nPhotos} foto bukti</button>
    </div>
  </div>`;
}

function exportCSV() {
  const rows = [['tanggal', 'jam_jadwal', 'obat', 'dosis', 'status', 'dikonfirmasi', 'diterima_server', 'tantangan_pose', 'catatan']];
  for (const d of [...S.history.doses].reverse()) {
    rows.push([fmt.ymd(d.scheduled_at, tz()), fmt.hm(d.scheduled_at, tz()), d.medication, doseLabel(d), d.status,
      d.device_time ? new Date(d.device_time).toISOString() : '', d.server_time ? new Date(d.server_time).toISOString() : '', d.pose || '', d.warning || '']);
  }
  const csv = '\ufeff' + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `riwayat-medreminder-${todayYmd()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Riwayat diekspor');
}

/* ---------- Pengawas & akun ---------- */
function accountView() {
  return `<div class="stack">
    <h1>Pengawas</h1>
    <section class="card stack">
      <p class="muted">Pengawas (keluarga atau perawat) bisa melihat jadwal, stok, dan riwayat dosismu. Foto bukti tidak ikut terlihat.</p>
      <form id="link-form" class="stack-sm" novalidate>
        <label for="l-email">Email akun pengawas</label>
        <div class="row" style="flex-wrap:nowrap"><input id="l-email" name="email" type="email" placeholder="email@pengawas.com" ${S.online ? '' : 'disabled'}><button class="btn primary" type="submit" ${S.online ? '' : 'disabled'}>Tautkan</button></div>
        <span class="hint">Pengawas harus sudah mendaftar di website pengawas.</span>
      </form>
      <div class="err" id="link-err"></div>
      ${S.links.length ? `<ul class="list">${S.links.map((l) => `<li class="item"><div class="avatar">${esc(MR.initials(l.name))}</div>
        <div><div class="name">${esc(l.name)}</div><div class="meta">${esc(l.email)}</div></div>
        <div class="acts"><button class="btn sm" data-act="unlink" data-id="${l.id}" data-name="${esc(l.name)}">Lepas</button></div></li>`).join('')}</ul>`
        : `<div class="note">${icon('users')} Belum ada pengawas yang ditautkan.</div>`}
    </section>
    <section class="card stack"><h3>Akun</h3>
      <div class="row"><div class="avatar">${esc(MR.initials(S.user.name))}</div><div><strong>${esc(S.user.name)}</strong><div class="small muted">${esc(S.user.email)}</div></div></div>
      <p class="small muted">Zona waktu jadwal: ${esc(S.user.timezone)}</p>
      <div class="grid2">
        <button class="btn" data-act="test-sound">${icon('volume')}Uji suara</button>
        <button class="btn" data-act="test-camera">${icon('camera')}Coba kamera</button>
      </div>
      <button class="btn danger" data-act="logout">${icon('logout')}Keluar</button>
    </section></div>`;
}

/* ---------- Suara dan notifikasi ---------- */
let actx = null;
const audioReady = () => !!actx && actx.state === 'running';
function ensureAudio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
  if (actx.state === 'suspended') actx.resume().then(() => { if (S.user && !modalType()) render(); }).catch(() => {});
}
function beep() {
  if (!audioReady()) return;
  const t0 = actx.currentTime;
  for (let i = 0; i < 8; i++) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle'; o.frequency.value = i % 2 ? 660 : 880;
    const s = t0 + i * 0.32;
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.22, s + 0.02); g.gain.linearRampToValueAtTime(0, s + 0.26);
    o.connect(g).connect(actx.destination); o.start(s); o.stop(s + 0.28);
  }
}
function notify(title, body, tag) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag }); } catch (e) {}
}
async function setupSound() {
  ensureAudio();
  setTimeout(beep, 150);
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch (e) {}
  notify('MedReminder', 'Notifikasi aktif. Seperti inilah pengingat minum obat.', 'test');
  setup.set({ sound: true });
  render();
  toast('Suara aktif. Kamu seharusnya mendengar bunyi alarm.');
}

/* ---------- Alarm ---------- */
const rung = {}, ringCount = {};
let alarmDoseId = null;
function soundAlarm(d) {
  ringCount[d.id] = (ringCount[d.id] || 0) + 1;
  beep();
  try { navigator.vibrate && navigator.vibrate([400, 200, 400]); } catch (e) {}
  notify('Saatnya minum ' + d.medication, `${doseLabel(d)} (jadwal ${fmt.hm(d.scheduled_at, tz())}). Buka MedReminder untuk berswafoto.`, 'dose-' + d.id);
  alarmDoseId = d.id;
  openModal(`<div class="alarm">
    <div class="bell">${icon('bell')}</div>
    <div class="time">${fmt.hm(d.scheduled_at, tz())}</div>
    <h2>Saatnya minum ${esc(d.medication)}</h2>
    <p class="muted" style="margin-top:.35rem">${esc(doseLabel(d))}${d.note ? ' · ' + esc(d.note) : ''}</p>
    <div class="actions">
      <button class="btn primary lg block" data-act="confirm" data-id="${d.id}">${icon('camera')}Ambil foto dan konfirmasi</button>
      <button class="btn ghost" data-close>Ingatkan lagi 5 menit lagi</button>
    </div>
    <p class="tiny muted" style="margin-top:.75rem">Pengingat ke-${ringCount[d.id]}. Konfirmasi sebelum pukul ${fmt.hm(+new Date(d.scheduled_at) + WINDOW, tz())}, setelah itu dosis tercatat terlewat.</p>
  </div>`, { type: 'alarm', onClose: () => { alarmDoseId = null; } });
}

let lastSig = '';
function tick() {
  if (!S.user) return;
  const now = Date.now();
  const due = S.doses.filter((d) => isDue(d, now)).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  // Alarm ditunda (bukan dilewati) selama layar kamera, formulir, atau layar berhasil sedang terbuka
  const busy = ['camera', 'form', 'success', 'confirm'].includes(modalType());
  if (!busy) {
    for (const d of due) {
      if (!rung[d.id] || now - rung[d.id] >= REPEAT) { rung[d.id] = now; soundAlarm(d); break; }
    }
  }
  if (modalType() === 'alarm' && alarmDoseId && !due.some((d) => d.id === alarmDoseId)) { alarmDoseId = null; closeModal(true); }
  const sig = S.doses.map((d) => d.id + shownStatus(d)).join() + '|' + queue.all().length + S.online + S.meds.map((m) => m.stock).join() + Math.floor(now / MIN);
  renderNet();
  if (sig !== lastSig) {
    lastSig = sig;
    const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#main form');
    if (!modalType() && !typing) render();
  }
}

/* ---------- Kamera dan swafoto (wajib) ---------- */
let cam = { stream: null, dose: null, pose: '', test: false };
function stopCam() { if (cam.stream) { cam.stream.getTracks().forEach((t) => t.stop()); cam.stream = null; } }

function cameraModal(d) {
  const test = !d;
  return `<div class="modal-head"><h2>${test ? 'Coba kamera' : 'Konfirmasi ' + esc(d.medication)}</h2><button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></div>
    ${test ? '<p class="muted" style="margin-bottom:1rem">Pastikan wajahmu terlihat jelas. Foto percobaan tidak disimpan.</p>' : `
    <ol class="photo-steps">
      <li><span class="n">1</span>Pegang ${esc(d.medication)} di depan kamera</li>
      <li><span class="n">2</span>Lakukan pose di bawah ini</li>
      <li><span class="n">3</span>Tekan tombol kamera</li>
    </ol>
    <div class="pose">${icon('smile')}<div><span class="tiny muted">Pose kali ini</span><strong>${esc(cam.pose)}</strong></div></div>`}
    <div class="cam"><video id="vid" playsinline autoplay muted></video><div class="frame" aria-hidden="true"></div><div id="camerr" class="camerr" hidden></div></div>
    <div class="shutter-row"><button class="shutter" id="snap" data-act="snap" disabled aria-label="Ambil foto">${icon('camera')}</button></div>
    <p id="camstatus" class="camstatus muted" aria-live="polite">Membuka kamera…</p>
    ${test ? '' : `<p class="tiny muted" style="text-align:center;margin-top:.5rem">Swafoto wajib untuk mencatat dosis. Batas konfirmasi pukul ${fmt.hm(+new Date(d.scheduled_at) + WINDOW, tz())}.</p>`}`;
}

async function startCamera(el) {
  stopCam();
  const box = $('#camerr', el), st = $('#camstatus', el), btn = $('#snap', el);
  box.hidden = true; st.textContent = 'Membuka kamera…'; btn.disabled = true;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('insecure');
    cam.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false });
    const v = $('#vid', el);
    if (!v || !document.contains(v)) { stopCam(); return; }
    v.srcObject = cam.stream;
    await v.play().catch(() => {});
    btn.disabled = false;
    st.textContent = cam.test ? 'Kamera siap. Tekan tombol untuk mencoba.' : 'Posisikan wajah di dalam bingkai, lalu tekan tombol.';
  } catch (e) {
    if (!document.contains(box)) return;
    box.hidden = false;
    box.innerHTML = e.message === 'insecure'
      ? `<strong>Kamera tidak bisa dipakai dari alamat ini</strong><span class="small">Buka aplikasi lewat http://localhost atau alamat https.</span>`
      : `<strong>Kamera belum diizinkan</strong><span class="small">Klik ikon kamera atau gembok di bilah alamat browser, pilih Izinkan, lalu coba lagi.</span><button class="btn sm" data-act="retry-camera">${icon('refresh')}Coba lagi</button>`;
    st.textContent = '';
  }
}

function openCamera(id) {
  const d = id ? S.doses.find((x) => x.id === id) : null;
  if (id && (!d || !isDue(d))) { toast('Dosis ini sudah tidak bisa dikonfirmasi.'); closeModal(true); render(); return; }
  cam.dose = d; cam.test = !d;
  cam.pose = POSES[Math.floor(Math.random() * POSES.length)];
  const el = openModal(cameraModal(d), { type: 'camera', onClose: () => { stopCam(); render(); setTimeout(tick, 300); } });
  startCamera(el);
}

async function snap() {
  const v = $('#vid');
  if (!v || !v.videoWidth) return;
  const st = $('#camstatus'), btn = $('#snap');
  btn.disabled = true; st.className = 'camstatus muted'; st.textContent = 'Memeriksa foto…';
  const w = 360, h = Math.round((v.videoHeight * w) / v.videoWidth);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.translate(w, 0); x.scale(-1, 1); x.drawImage(v, 0, 0, w, h);
  const fail = (msg) => { st.className = 'camstatus bad'; st.textContent = msg; btn.disabled = false; };

  let face = 'tidak_diverifikasi';
  if ('FaceDetector' in window) {
    try { const f = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 3 }).detect(c); face = f.length ? 'ok' : 'none'; } catch (e) {}
  }
  if (face === 'none') return fail('Wajah tidak terlihat. Hadapkan wajah ke kamera lalu coba lagi.');

  if (cam.test) {
    stopCam(); closeModal(true);
    setup.set({ camera: true });
    render();
    toast(face === 'ok' ? 'Kamera dan deteksi wajah berfungsi.' : 'Kamera berfungsi. Browser ini belum bisa memeriksa wajah, foto tetap diterima.');
    return;
  }

  const hash = imgHash(c);
  const hashes = store.get(K('hashes'), []);
  if (hashes.some((o) => hamming(o.h, hash) <= 3)) return fail('Foto ini sama dengan foto sebelumnya. Ambil foto baru.');

  const d = cam.dose;
  const encPhoto = await encrypt(c.toDataURL('image/jpeg', 0.72));
  if (!(await photoStore.set(S.user.id, d.id, encPhoto))) return fail('Penyimpanan foto penuh. Hapus foto lama di menu Riwayat.');
  hashes.push({ h: hash, dose_id: d.id });
  store.set(K('hashes'), hashes.slice(-200));
  setup.set({ camera: true });

  const q = queue.all().filter((it) => it.dose_id !== d.id);
  q.push({ dose_id: d.id, status: 'diminum', device_time: new Date().toISOString(), medication: d.medication, pose: cam.pose, face_check: face });
  queue.save(q);
  S.history = null;
  stopCam();
  alarmDoseId = null;
  st.textContent = 'Mengirim konfirmasi…';
  const rejected = navigator.onLine !== false ? await flushQueue() : null;
  if (rejected && rejected.has(d.id)) {
    closeModal(true);
    render();
    return;
  }
  openModal(`<div class="success">
      <div class="tick">${icon('check')}</div>
      <h2>${esc(d.medication)} tercatat diminum</h2>
      <p class="muted" style="margin-top:.4rem">${esc(doseLabel(d))}, dikonfirmasi pukul ${fmt.hm(Date.now(), tz())}.${face === 'ok' ? '' : ' Wajah tidak diverifikasi karena browser ini belum mendukung deteksi wajah.'}${S.online ? '' : ' Disimpan di antrean dan akan dikirim saat tersambung kembali.'}</p>
      <button class="btn primary lg block" style="margin-top:1.25rem" data-close>Selesai</button>
    </div>`, { type: 'success', onClose: () => { render(); setTimeout(tick, 300); } });
  render();
}

/* ---------- Foto: hash duplikat dan enkripsi ---------- */
function imgHash(src) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const x = c.getContext('2d'); x.drawImage(src, 0, 0, 16, 16);
  const px = x.getImageData(0, 0, 16, 16).data, g = [];
  for (let i = 0; i < px.length; i += 4) g.push(px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11);
  const avg = g.reduce((a, b) => a + b, 0) / g.length;
  return g.map((v) => (v > avg ? '1' : '0')).join('');
}
function hamming(a, b) { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; }
const b64e = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
const b64d = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
async function photoKey() {
  const raw = store.get('mr_photo_key', null);
  if (raw) return crypto.subtle.importKey('raw', b64d(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  store.set('mr_photo_key', b64e(await crypto.subtle.exportKey('raw', k)));
  return k;
}
async function encrypt(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await photoKey(), new TextEncoder().encode(text));
  return { iv: b64e(iv), data: b64e(c) };
}
async function decrypt(o) {
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64d(o.iv)) }, await photoKey(), b64d(o.data));
  return new TextDecoder().decode(p);
}
async function viewPhoto(id) {
  const enc = await photoStore.get(S.user.id, id);
  if (!enc) { toast('Foto bukti sudah dihapus.'); return; }
  const d = S.doses.find((x) => x.id === id) || (S.history && S.history.doses.find((x) => x.id === id));
  try {
    const url = await decrypt(enc);
    openModal(`<div class="modal-head"><h2>Bukti ${esc(d ? d.medication : 'dosis')}</h2><button class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></div>
      ${d ? `<p class="small muted" style="margin-bottom:.8rem">${fmt.dt(d.scheduled_at, tz())}${d.pose ? ' · Pose: ' + esc(d.pose) : ''}</p>` : ''}
      <img class="photo" src="${url}" alt="Swafoto bukti minum obat">`, { type: 'photo' });
  } catch (e) {
    toast('Foto tidak dapat dibuka. Data foto di perangkat ini rusak atau kuncinya berbeda.', true);
  }
}

/* ---------- Tindakan ---------- */
document.addEventListener('click', async (e) => {
  ensureAudio();
  const tab = e.target.closest('[data-tab]');
  if (tab) { S.tab = tab.dataset.tab; if (S.tab === 'riwayat') S.history = null; closeModal(true); render(); window.scrollTo(0, 0); return; }
  const auth = e.target.closest('[data-auth]');
  if (auth) { S.authMode = auth.dataset.auth; render(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const id = Number(el.dataset.id);
  switch (el.dataset.act) {
    case 'sound': case 'setup-sound': setupSound(); break;
    case 'test-sound': ensureAudio(); setTimeout(beep, 150); notify('MedReminder', 'Uji notifikasi.', 'test'); break;
    case 'test-camera': openCamera(null); break;
    case 'retry-camera': startCamera(el.closest('.modal')); break;
    case 'dismiss-setup': setup.set({ dismissed: true }); render(); break;
    case 'retry': await loadAll(); await flushQueue(); render(); toast(S.online ? 'Tersambung kembali' : 'Server masih belum dapat dihubungi', !S.online); break;
    case 'add-med': medForm(null); break;
    case 'edit-med': medForm(S.meds.find((m) => m.id === id)); break;
    case 'refill': refillForm(S.meds.find((m) => m.id === id)); break;
    case 'del-med': {
      const m = S.meds.find((x) => x.id === id);
      if (!m || !(await confirmBox(`Hapus ${m.name}?`, 'Jadwal mendatang ikut dihapus. Riwayat yang sudah lewat tetap tersimpan.', 'Hapus', true))) return;
      try { await api.call(`/medications/${id}`, { method: 'DELETE' }); await loadAll(); render(); toast(`${m.name} dihapus`); } catch (err) { toast(err.message, true); }
      break;
    }
    case 'confirm': openCamera(id); break;
    case 'snap': snap(); break;
    case 'photo': viewPhoto(id); break;
    case 'reload-history': S.history = null; render(); break;
    case 'csv': exportCSV(); break;
    case 'del-photos':
      if (!(await confirmBox('Hapus semua foto bukti?', 'Foto di perangkat ini dihapus permanen. Status dosis di server tidak berubah.', 'Hapus foto', true))) return;
      await photoStore.clearUser(S.user.id); store.del(K('hashes')); render(); toast('Semua foto bukti dihapus');
      break;
    case 'unlink':
      if (!(await confirmBox(`Lepas ${el.dataset.name}?`, 'Pengawas ini tidak bisa lagi melihat data dosismu.', 'Lepas', true))) return;
      try { await api.call(`/links/${id}`, { method: 'DELETE' }); S.links = S.links.filter((l) => l.id !== id); render(); } catch (err) { toast(err.message, true); }
      break;
    case 'logout': {
      const n = queue.all().length;
      if (n && !(await confirmBox('Keluar sekarang?', `${n} konfirmasi belum terkirim. Konfirmasi itu tetap tersimpan di perangkat ini dan dikirim saat kamu masuk lagi.`, 'Keluar'))) return;
      api.setToken(null); S.user = null; S.photoIds.clear(); S.history = null; S.authMode = 'login'; render();
      break;
    }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'history-days') {
    S.historyDays = Number(e.target.value) || 30;
    S.history = null;
    render();
  }
});

document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id === 'auth-form') { e.preventDefault(); submitAuth(f); }
  if (f.id === 'link-form') {
    e.preventDefault();
    const err = $('#link-err');
    const btn = f.querySelector('button[type=submit]');
    const email = f.email.value.trim();
    if (!email) { err.textContent = 'Masukkan email pengawas.'; return; }
    btn.disabled = true; err.textContent = '';
    try {
      const r = await api.call('/links', { method: 'POST', body: { email } });
      S.links.push(r.supervisor);
      render();
      toast(`${r.supervisor.name} sekarang bisa memantau dosismu`);
    } catch (x) {
      err.textContent = x.message;
      btn.disabled = false;
    }
  }
});

api.onUnauthorized(() => { S.user = null; closeModal(true); render(); toast('Sesi berakhir. Silakan masuk lagi.', true); });
window.addEventListener('online', async () => { if (!S.user) return; await flushQueue(); await loadAll(); render(); });
document.addEventListener('visibilitychange', async () => { if (!document.hidden && S.user) { await loadAll().catch(() => {}); await flushQueue(); tick(); } });

/* ---------- Mulai ---------- */
async function boot() {
  if (api.token) {
    try {
      S.user = (await api.call('/auth/me')).user;
      store.set('mr_last_user_pasien', S.user);
    } catch (e) {
      if (e.offline) S.user = store.get('mr_last_user_pasien', null);
    }
    if (S.user) { await photoStore.loadIds(S.user.id); await loadAll().catch((e) => toast(e.message, true)); await flushQueue(); }
  }
  render();
  setInterval(tick, 10e3);
  setTimeout(tick, 600);
  setInterval(async () => { if (S.user) { await loadAll().catch(() => {}); await flushQueue(); } }, 60e3);
}
boot();
