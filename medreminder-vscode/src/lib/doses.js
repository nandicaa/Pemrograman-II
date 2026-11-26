const db = require('../db');
const { doseTimes } = require('./schedule');

const MIN = 60e3;
const WINDOW_MS = 30 * MIN; // jendela minum: 30 menit sejak jadwal

// Buat ulang dosis mendatang untuk satu obat.
// Dosis yang sudah lewat tidak diubah, supaya riwayat tetap utuh.
// Dosis yang jadwalnya baru lewat < 30 menit ikut dibuat agar masih bisa dikonfirmasi.
async function regenerateDoses(conn, med, tz) {
  const now = Date.now();
  await conn.execute(
    "DELETE FROM doses WHERE medication_id = ? AND status = 'terjadwal' AND scheduled_at > ?",
    [med.id, new Date(now - WINDOW_MS)]
  );
  if (!med.active) return 0;
  const times = doseTimes(med, tz).filter((t) => t.getTime() > now - WINDOW_MS);
  for (let i = 0; i < times.length; i += 500) {
    const chunk = times.slice(i, i + 500);
    await conn.query(
      'INSERT IGNORE INTO doses (patient_id, medication_id, scheduled_at) VALUES ?',
      [chunk.map((t) => [med.patient_id, med.id, t])]
    );
  }
  return times.length;
}

// Tandai dosis yang lewat 30 menit tanpa konfirmasi sebagai terlewat.
async function markMissed() {
  const [r] = await db.execute(
    "UPDATE doses SET status = 'terlewat', server_time = UTC_TIMESTAMP() WHERE status = 'terjadwal' AND scheduled_at < ?",
    [new Date(Date.now() - WINDOW_MS)]
  );
  return r.affectedRows;
}

// Ringkasan kepatuhan dari daftar dosis (dosis 'terjadwal' tidak dihitung)
function summarize(rows) {
  const done = rows.filter((r) => r.status !== 'terjadwal');
  const taken = done.filter((r) => r.status === 'diminum').length;
  return {
    total: done.length,
    taken,
    skipped: done.filter((r) => r.status === 'dilewati').length,
    missed: done.filter((r) => r.status === 'terlewat').length,
    adherence: done.length ? Math.round((taken / done.length) * 100) : null,
  };
}

module.exports = { regenerateDoses, markMissed, summarize, WINDOW_MS };
