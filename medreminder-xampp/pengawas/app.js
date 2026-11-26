// Website pengawas MedReminder.
const { $, esc, fmt, fmtQ, STATUS, icon, medIcon, ring, initials, toast } = MR;
const api = MR.client('pengawas');

const S = { user: null, authMode: 'login', patientId: null, filters: { days: 30, status: '', medication_id: '', warning: '' } };
const CHIP_ICON = { due: 'bell', diminum: 'check', terlewat: 'x', terjadwal: 'clock', dilewati: 'x' };
const chip = (st, label) => `<span class="chip ${st}">${icon(CHIP_ICON[st])}${label || STATUS[st]}</span>`;

/* ---------- Masuk / daftar ---------- */
function authView() {
  const reg = S.authMode === 'register';
  $('#logout').hidden = true;
  $('#who').textContent = '';
  $('#main').innerHTML = `<div class="narrow stack">
    <div><h1>${reg ? 'Buat akun pengawas' : 'Masuk sebagai pengawas'}</h1>
      <p class="muted" style="margin-top:.35rem">Pantau jadwal, stok obat, dan kepatuhan keluarga atau pasien yang kamu dampingi.</p></div>
    <div class="card stack">
      <div class="seg" role="group" aria-label="Pilih"><button data-auth="login" aria-pressed="${!reg}">Masuk</button><button data-auth="register" aria-pressed="${reg}">Daftar</button></div>
      <form id="auth-form" class="stack" novalidate>
        ${reg ? '<div><label for="name">Nama</label><input id="name" name="name" autocomplete="name" placeholder="Nama lengkap"></div>' : ''}
        <div><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" placeholder="nama@email.com"></div>
        <div><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" placeholder="${reg ? 'Minimal 6 karakter' : ''}"></div>
        <div class="err" id="err"></div>
        <button class="btn primary lg block" type="submit">${reg ? 'Buat akun' : 'Masuk'}</button>
      </form>
      ${reg ? `<div class="note">${icon('link')} Setelah mendaftar, berikan email ini kepada pasien. Pasien memasukkannya di menu <strong>Pengawas</strong> pada aplikasi MedReminder.</div>` : ''}
    </div>
  </div>`;
}

/* ---------- Ringkasan semua pasien ---------- */
async function overviewView(quiet) {
  if (!quiet) $('#main').innerHTML = '<p class="muted">Memuat data pasien…</p>';
  let data;
  try { data = await api.call('/supervisor/overview'); }
  catch (e) { return errorView(e); }
  if (S.patientId) return;

  if (!data.patients.length) {
    $('#main').innerHTML = `<div class="card empty narrow"><div class="art">${icon('users')}</div><h2>Belum ada pasien</h2>
      <p class="muted">Minta pasien membuka aplikasi MedReminder, pilih menu <strong>Pengawas</strong>, lalu masukkan email <strong>${esc(S.user.email)}</strong>.</p>
      <button class="btn" data-act="reload">${icon('refresh')}Periksa lagi</button></div>`;
    return;
  }
  const alerts = data.alerts;
  const ALERT_ICON = { tinggi: 'alert', sedang: 'box', rendah: 'clock' };
  $('#main').innerHTML = `<div class="stack-lg">
    <div class="spread"><div><h1>Pantauan pasien</h1><p class="small muted">Diperbarui pukul ${fmt.hm(Date.now())}, dimuat ulang tiap menit</p></div>
      <button class="btn sm" data-act="reload">${icon('refresh')}Muat ulang</button></div>
    <section>
      <div class="section-title" style="margin-top:0"><h2>Perlu perhatian</h2>${alerts.length ? `<span class="small muted">${alerts.length} hal</span>` : ''}</div>
      ${alerts.length ? `<ul class="alerts">${alerts.map((a) => `<li class="${a.level}"><div class="msg">${icon(ALERT_ICON[a.level])}<span><strong>${esc(a.patient)}</strong>: ${esc(a.text)}</span></div><button class="btn sm" data-open="${a.patient_id}">Lihat</button></li>`).join('')}</ul>`
        : `<div class="all-good">${icon('check')}<span>Semua aman. Tidak ada dosis terlewat dalam 24 jam, stok cukup, dan jam perangkat sesuai.</span></div>`}
    </section>
    <section>
      <div class="section-title"><h2>Pasien</h2><span class="small muted">${data.patients.length} orang</span></div>
      <div class="patients">${data.patients.map((p) => `
        <button class="pcard" data-open="${p.id}">
          <div class="head">
            <div class="avatar">${esc(initials(p.name))}</div>
            <div style="flex:1;min-width:0"><strong>${esc(p.name)}</strong><div class="small muted" style="overflow:hidden;text-overflow:ellipsis">${esc(p.email)}</div></div>
            ${ring(p.week.adherence, 64, 7)}
          </div>
          <div class="facts">
            <div class="fact"><strong>${p.month.adherence === null ? '–' : p.month.adherence + '%'}</strong><span>30 hari</span></div>
            <div class="fact ${p.week.missed ? 'warn' : ''}"><strong>${p.week.missed}</strong><span>Terlewat 7 hari</span></div>
            <div class="fact ${p.low_stock ? 'sun' : ''}"><strong>${p.low_stock}</strong><span>Stok menipis</span></div>
          </div>
          <div class="next">${icon('clock')}${p.next_dose ? `Berikutnya ${fmt.hm(p.next_dose.scheduled_at, p.timezone)}, ${esc(p.next_dose.medication)}` : 'Tidak ada jadwal berikutnya'}</div>
          <div class="next" style="margin-top:.25rem">${icon('camera')}Konfirmasi terakhir ${fmt.ago(p.last_report)}</div>
        </button>`).join('')}</div>
      <p class="tiny muted" style="margin-top:.75rem">Lingkaran menunjukkan kepatuhan 7 hari terakhir: hijau 80% ke atas, kuning 50–79%, merah di bawah 50%.</p>
    </section>
  </div>`;
}

/* ---------- Detail satu pasien ---------- */
async function patientView(quiet) {
  if (!quiet) $('#main').innerHTML = '<p class="muted">Memuat data pasien…</p>';
  const id = S.patientId;
  let data;
  try { data = await api.call(`/supervisor/patients/${encodeURIComponent(id)}`); }
  catch (e) {
    if (e.status === 404) { toast(e.message, true); S.patientId = null; return render(); }
    return errorView(e);
  }
  if (S.patientId !== id) return;
  const p = data.patient, tz = p.timezone;
  const now = Date.now();
  const doseState = (d) => (d.status === 'terjadwal' && now >= +new Date(d.scheduled_at) ? 'due' : d.status);
  const low = data.medications.filter((m) => m.low_stock).length;
  const prevHistory = quiet && $('#history') ? $('#history').innerHTML : '<div class="section-title" style="margin-top:0"><h2>Riwayat dosis</h2></div><p class="muted">Memuat riwayat…</p>';

  $('#main').innerHTML = `<div class="stack-lg">
    <div><button class="btn sm ghost" data-act="back" style="margin-left:-.6rem">${icon('back')}Semua pasien</button></div>
    <div class="page-head"><div class="avatar">${esc(initials(p.name))}</div><div><h1>${esc(p.name)}</h1><p class="small muted">${esc(p.email)} · jam menurut zona waktu pasien (${esc(tz)})</p></div></div>
    <div class="kpis">
      <div class="kpi"><div class="v">${data.week.adherence === null ? '–' : data.week.adherence + '%'}</div><div class="l">Kepatuhan 7 hari (${data.week.taken} dari ${data.week.total})</div></div>
      <div class="kpi"><div class="v">${data.month.adherence === null ? '–' : data.month.adherence + '%'}</div><div class="l">Kepatuhan 30 hari (${data.month.taken} dari ${data.month.total})</div></div>
      <div class="kpi ${data.week.missed ? 'warn' : ''}"><div class="v">${data.week.missed}</div><div class="l">Terlewat 7 hari</div></div>
      <div class="kpi ${low ? 'warn' : ''}"><div class="v">${low}</div><div class="l">Obat dengan stok menipis</div></div>
    </div>
    <div class="cols">
      <section class="card"><h3>Jadwal hari ini</h3>
        ${data.today.length ? `<ul class="list" style="margin-top:.5rem">${data.today.map((d) => { const st = doseState(d); return `<li class="item ${['diminum', 'terlewat'].includes(st) ? 'done' : ''}">
          <div class="when">${fmt.hm(d.scheduled_at, tz)}</div>
          <div><div class="name">${esc(d.medication)}</div><div class="meta"><span>${fmtQ(d.qty_per_dose)} ${esc(d.unit)}</span>${chip(st, st === 'due' ? 'Sedang jatuh tempo' : null)}${d.status === 'diminum' && d.device_time ? `<span>pukul ${fmt.hm(d.device_time, tz)}</span>` : ''}</div></div>
          <div></div></li>`; }).join('')}</ul>` : '<p class="muted" style="margin-top:.5rem">Tidak ada jadwal hari ini.</p>'}
      </section>
      <section class="card"><div class="spread"><h3>Kepatuhan 14 hari</h3><span class="tiny muted">Garis putus-putus: tidak ada jadwal</span></div>
        <div class="bars" style="margin-top:1rem">${data.daily.map((d) => `<div class="b ${d.adherence === null ? 'none' : d.adherence < 80 ? 'low' : ''}" title="${d.date}: ${d.adherence === null ? 'tidak ada dosis' : d.adherence + '% (' + d.taken + ' dari ' + d.total + ')'}"><span style="height:${d.adherence || 0}%"></span></div>`).join('')}</div>
        <div class="barlabels">${data.daily.map((d) => `<span>${Number(d.date.slice(8))}</span>`).join('')}</div>
      </section>
    </div>
    <section><div class="section-title" style="margin-top:0"><h2>Obat</h2><span class="small muted">${data.medications.length} aktif</span></div>
      ${data.medications.length ? `<div class="card">${data.medications.map((m) => {
        const full = Math.max(m.qty_per_dose * m.times_per_day * m.duration_days, m.stock, 1);
        return `<div class="med"><div class="med-ico ${m.type}">${medIcon(m.type)}</div><div>
          <div class="spread" style="align-items:flex-start"><div><h3>${esc(m.name)}</h3><p class="small muted">${fmtQ(m.qty_per_dose)} ${esc(m.unit)} · ${m.times_per_day}x sehari, tiap ${esc(m.interval)}${m.note ? ' · ' + esc(m.note) : ''}</p></div>
            ${m.low_stock ? `<span class="chip due">${icon('box')}Stok menipis</span>` : ''}</div>
          <div class="times">${m.schedule_times.map((x) => `<span class="chip terjadwal">${icon('clock')}${x.replace(':', '.')}</span>`).join('')}</div>
          <div class="meter ${m.stock <= 0 ? 'empty' : m.low_stock ? 'low' : ''}"><span style="width:${Math.min(100, Math.round((m.stock / full) * 100))}%"></span></div>
          <p class="small muted">Stok ${fmtQ(m.stock)}, cukup sekitar ${m.days_left} hari · ${fmt.date(m.start_date + 'T12:00:00')} sampai ${fmt.date(m.end_date + 'T12:00:00')}</p>
        </div></div>`;
      }).join('')}</div>` : '<div class="card"><p class="muted">Pasien belum menambahkan obat.</p></div>'}
    </section>
    <section id="history">${prevHistory}</section>
  </div>`;
  loadHistory();
}

async function loadHistory() {
  const box = $('#history');
  if (!box) return;
  const f = S.filters;
  const q = new URLSearchParams({ days: f.days });
  if (f.status) q.set('status', f.status);
  if (f.medication_id) q.set('medication_id', f.medication_id);
  if (f.warning) q.set('warning', '1');
  let data;
  try { data = await api.call(`/supervisor/patients/${encodeURIComponent(S.patientId)}/doses?${q}`); }
  catch (e) { box.innerHTML = `<div class="section-title" style="margin-top:0"><h2>Riwayat dosis</h2></div><p class="err">${esc(e.message)}</p>`; return; }
  const tz = data.patient.timezone;
  box.innerHTML = `<div class="section-title" style="margin-top:0"><h2>Riwayat dosis</h2><span class="small muted">${data.doses.length}${data.doses.length === 100 ? '+' : ''} dosis</span></div>
    <form id="filters" class="filters">
      <select name="days" aria-label="Periode">${[[7, '7 hari'], [30, '30 hari'], [90, '90 hari']].map(([v, l]) => `<option value="${v}" ${+f.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select name="status" aria-label="Status"><option value="">Semua status</option>${['diminum', 'terlewat'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${STATUS[s]}</option>`).join('')}</select>
      <select name="medication_id" aria-label="Obat"><option value="">Semua obat</option>${data.medications.map((m) => `<option value="${m.id}" ${String(f.medication_id) === String(m.id) ? 'selected' : ''}>${esc(m.name)}${m.active ? '' : ' (dihapus)'}</option>`).join('')}</select>
      <label class="check" style="margin:0"><input type="checkbox" name="warning" ${f.warning ? 'checked' : ''}> Ada catatan jam perangkat</label>
    </form>
    ${data.doses.length ? `<div class="tablewrap"><table>
      <thead><tr><th>Jadwal</th><th>Obat</th><th>Status</th><th>Swafoto</th><th>Diterima server</th><th>Catatan</th></tr></thead>
      <tbody>${data.doses.map((d) => `<tr class="${d.status === 'terlewat' ? 'r-miss' : d.warning ? 'r-warn' : ''}">
        <td><strong>${fmt.hm(d.scheduled_at, tz)}</strong><br><span class="small muted">${fmt.date(d.scheduled_at, tz)}</span></td>
        <td><strong>${esc(d.medication)}</strong><br><span class="small muted">${fmtQ(d.qty_per_dose)} ${esc(d.unit)}</span></td>
        <td>${chip(d.status)}</td>
        <td>${d.status === 'diminum' ? `Pukul ${fmt.hm(d.device_time, tz)}${d.pose ? `<br><span class="small muted">Pose: ${esc(d.pose)}</span>` : ''}<br><span class="small muted">${d.face_check === 'ok' ? 'Wajah terdeteksi' : 'Wajah tidak diverifikasi'}</span>` : '<span class="muted">Tidak ada</span>'}</td>
        <td>${d.server_time ? fmt.dt(d.server_time, tz) : '<span class="muted">–</span>'}</td>
        <td>${d.warning ? esc(d.warning) : '<span class="muted">–</span>'}</td>
      </tr>`).join('')}</tbody></table></div>
      <p class="tiny muted" style="margin-top:.6rem">Foto bukti hanya tersimpan di perangkat pasien. Maksimal 100 dosis terbaru ditampilkan.</p>`
      : '<div class="card"><p class="muted">Tidak ada dosis yang cocok dengan pilihan ini.</p></div>'}`;
}

function errorView(e) {
  $('#main').innerHTML = `<div class="card empty narrow"><div class="art">${icon('wifiOff')}</div><p>${esc(e.message)}</p><button class="btn" data-act="reload">${icon('refresh')}Coba lagi</button></div>`;
}

/* ---------- Navigasi ---------- */
function render(quiet) {
  if (!S.user) return authView();
  $('#logout').hidden = false;
  $('#who').textContent = S.user.name;
  return S.patientId ? patientView(quiet) : overviewView(quiet);
}

function openPatient(id) {
  S.patientId = String(id);
  S.filters = { days: 30, status: '', medication_id: '', warning: '' };
  history.pushState({ p: S.patientId }, '', '#pasien-' + S.patientId);
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const auth = e.target.closest('[data-auth]');
  if (auth) { S.authMode = auth.dataset.auth; return render(); }
  const open = e.target.closest('[data-open]');
  if (open) return openPatient(open.dataset.open);
  const act = e.target.closest('[data-act]');
  if (!act) return;
  if (act.dataset.act === 'back') { S.patientId = null; history.pushState({}, '', location.pathname); render(); }
  if (act.dataset.act === 'reload') render();
});
document.addEventListener('change', (e) => {
  const f = e.target.form;
  if (!f || f.id !== 'filters') return;
  S.filters = { days: f.days.value, status: f.status.value, medication_id: f.medication_id.value, warning: f.warning.checked ? '1' : '' };
  loadHistory();
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'auth-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const reg = S.authMode === 'register';
  const body = { email: fd.get('email'), password: fd.get('password'), role: 'pengawas' };
  if (reg) body.name = fd.get('name');
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  $('#err').textContent = '';
  try {
    const r = await api.call(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
    api.setToken(r.token);
    S.user = r.user;
    render();
  } catch (x) {
    $('#err').textContent = x.message;
    btn.disabled = false;
  }
});
window.addEventListener('popstate', () => {
  const m = location.hash.match(/^#pasien-(\d+)$/);
  S.patientId = m ? m[1] : null;
  render();
});
$('#logout').addEventListener('click', () => { api.setToken(null); S.user = null; S.patientId = null; history.replaceState({}, '', location.pathname); render(); });
api.onUnauthorized(() => { S.user = null; render(); toast('Sesi berakhir. Silakan masuk lagi.', true); });

async function boot() {
  const m = location.hash.match(/^#pasien-(\d+)$/);
  if (m) S.patientId = m[1];
  if (api.token) {
    try { S.user = (await api.call('/auth/me')).user; }
    catch (e) { if (api.token) return errorView(e); }
    if (S.user && S.user.role !== 'pengawas') { api.setToken(null); S.user = null; }
  }
  render();
  setInterval(() => {
    if (!S.user || document.hidden) return;
    if (S.patientId) { const a = document.activeElement; if (!(a && a.closest && a.closest('#filters'))) patientView(true); }
    else overviewView(true);
  }, 60e3);
}
boot();
