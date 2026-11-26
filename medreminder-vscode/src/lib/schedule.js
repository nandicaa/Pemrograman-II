// Aturan minum seperti "3x1": 3 kali sehari, 1 tiap minum.
// Dosis pertama jatuh pada jam minum pertama di tanggal mulai, lalu berulang tiap (24 jam / kali sehari).

const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 864e5;

function parseRule(value) {
  const m = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .match(/^(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?|½|1\/2)$/);
  if (!m) return null;
  const timesPerDay = parseInt(m[1], 10);
  const qtyPerDose = m[2] === '½' || m[2] === '1/2' ? 0.5 : parseFloat(m[2]);
  if (timesPerDay < 1 || timesPerDay > 6) return null;
  if (!(qtyPerDose > 0) || qtyPerDose > 20) return null;
  return { timesPerDay, qtyPerDose };
}

const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''));
const isDate = (v) => {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

function isTimezone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (e) {
    return false;
  }
}

// ruleTimes(3, "06:00") -> ["06:00", "14:00", "22:00"] (diurutkan menurut jam)
function ruleTimes(timesPerDay, firstTime) {
  const [h, mi] = firstTime.split(':').map(Number);
  const start = h * 60 + mi;
  const step = 1440 / timesPerDay;
  const out = [];
  for (let i = 0; i < timesPerDay; i++) {
    const t = Math.round(start + i * step) % 1440;
    out.push(pad(Math.floor(t / 60)) + ':' + pad(t % 60));
  }
  return out.sort();
}

function intervalText(timesPerDay) {
  const mins = 1440 / timesPerDay;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h + ' jam' + (m ? ' ' + m + ' menit' : '');
}

// Selisih zona waktu (ms) pada saat tertentu
function tzOffsetMs(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - date.getTime();
}

// Jam dinding lokal di zona tz -> Date (UTC)
function localToUtc(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  const off2 = tzOffsetMs(new Date(t), tz);
  if (guess - off2 !== t) t = guess - off2;
  return new Date(t);
}

// Tanggal lokal "YYYY-MM-DD" di zona tz untuk saat tertentu
function localDate(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Semua waktu dosis (Date, UTC) untuk satu obat
function doseTimes(med, tz) {
  const first = localToUtc(med.start_date, med.first_time, tz).getTime();
  const step = DAY_MS / med.times_per_day;
  const total = med.times_per_day * med.duration_days;
  const out = [];
  for (let i = 0; i < total; i++) out.push(new Date(first + Math.round(i * step)));
  return out;
}

module.exports = {
  parseRule, ruleTimes, intervalText, isTime, isDate, isTimezone,
  localToUtc, localDate, addDays, doseTimes,
};
