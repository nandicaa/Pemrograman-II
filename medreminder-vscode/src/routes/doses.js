const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { summarize, WINDOW_MS } = require('../lib/doses');

const router = express.Router();
router.use(requireAuth('pasien'));

const MIN = 60e3;
const MAX_SKEW_MS = 5 * MIN;
const toDate = (v) => {
  const d = new Date(v);
  return v && Number.isFinite(d.getTime()) ? d : null;
};

const DOSE_COLUMNS = `d.id, d.medication_id, d.scheduled_at, d.status, d.device_time, d.server_time, d.warning, d.pose, d.face_check,
  m.name AS medication, m.unit, m.qty_per_dose, m.note`;

// GET /api/doses?from=ISO&to=ISO  -> jadwal dosis dalam rentang waktu (maks. 14 hari), untuk alarm dan layar Hari ini
router.get('/', async (req, res, next) => {
  try {
    const from = toDate(req.query.from) || new Date(Date.now() - 864e5);
    const to = toDate(req.query.to) || new Date(Date.now() + 2 * 864e5);
    if (to - from > 14 * 864e5 || to <= from) return res.status(400).json({ error: 'Rentang waktu maksimal 14 hari.' });
    const [rows] = await db.execute(
      `SELECT ${DOSE_COLUMNS} FROM doses d JOIN medications m ON m.id = d.medication_id
        WHERE d.patient_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ?
        ORDER BY d.scheduled_at`,
      [req.user.id, from, to]
    );
    res.json({ server_time: new Date().toISOString(), window_minutes: WINDOW_MS / MIN, doses: rows });
  } catch (e) {
    next(e);
  }
});

// GET /api/doses/history?days=30  -> dosis yang sudah selesai + ringkasan kepatuhan
router.get('/history', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const [rows] = await db.execute(
      `SELECT ${DOSE_COLUMNS} FROM doses d JOIN medications m ON m.id = d.medication_id
        WHERE d.patient_id = ? AND d.status <> 'terjadwal' AND d.scheduled_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
        ORDER BY d.scheduled_at DESC`,
      [req.user.id, days]
    );
    res.json({ summary: { days, ...summarize(rows) }, doses: rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/doses/sync
// Perangkat mengirim konfirmasi dosis. Kalau sedang offline, perangkat menyimpannya dan mengirim ulang nanti.
// {
//   "sent_at": "2026-11-14T03:00:05Z",            // jam perangkat saat mengirim
//   "updates": [{ "dose_id": 12, "status": "diminum", "device_time": "...", "pose": "Acungkan jempol", "face_check": "ok" }]
// }
// - status hanya "diminum". Swafoto wajib: setiap konfirmasi harus menyertakan tantangan pose dari kamera.
//   Status "terlewat" ditentukan server bila 30 menit lewat tanpa konfirmasi.
// - Konfirmasi tetap diterima walau server sudah menandai terlewat, asalkan waktu konfirmasi di perangkat
//   masih di dalam 30 menit jendela minum (berguna saat perangkat offline).
// - Server memberi stempel waktunya sendiri dan catatan bila jam perangkat selisih > 5 menit.
router.post('/sync', async (req, res, next) => {
  const updates = Array.isArray(req.body.updates) ? req.body.updates.slice(0, 200) : [];
  if (!updates.length) return res.status(400).json({ error: 'Tidak ada dosis yang dikirim.' });

  const serverNow = new Date();
  const sentAt = toDate(req.body.sent_at);
  if (!sentAt) return res.status(400).json({ error: 'Waktu pengiriman perangkat (sent_at) tidak valid.' });
  const skew = serverNow - sentAt;
  const warning = Math.abs(skew) > MAX_SKEW_MS
    ? `Jam perangkat ${skew > 0 ? 'terlambat' : 'lebih cepat'} ${Math.round(Math.abs(skew) / MIN)} menit dari jam server`
    : null;

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const results = [];
    for (const u of updates) {
      if (!u || typeof u !== 'object') {
        results.push({ dose_id: null, error: 'Format pembaruan dosis tidak valid.' });
        continue;
      }
      const id = Number(u.dose_id);
      const result = { dose_id: Number.isInteger(id) && id > 0 ? id : u.dose_id ?? null };
      results.push(result);
      if (!Number.isInteger(id) || id <= 0) {
        result.error = 'ID dosis tidak valid.';
        continue;
      }
      const deviceTime = toDate(u.device_time);
      if (u.status !== 'diminum') {
        result.error = 'Dosis hanya bisa dikonfirmasi dengan swafoto.';
        continue;
      }
      if (!deviceTime || !String(u.pose || '').trim()) {
        result.error = 'Konfirmasi harus disertai swafoto dengan tantangan pose.';
        continue;
      }
      if (deviceTime.getTime() > sentAt.getTime() + MIN) {
        result.error = 'Waktu konfirmasi perangkat tidak valid.';
        continue;
      }
      const [rows] = await conn.execute(
        'SELECT * FROM doses WHERE id = ? AND patient_id = ? FOR UPDATE',
        [id, req.user.id]
      );
      const dose = rows[0];
      if (!dose) { result.error = 'Dosis tidak ditemukan.'; continue; }
      if (dose.status === 'diminum' || dose.status === 'dilewati') {
        result.status = dose.status; // sudah tercatat sebelumnya; kiriman ulang diabaikan
        continue;
      }
      // Waktu konfirmasi dihitung dengan jam perangkat yang dikoreksi selisihnya terhadap jam server
      const corrected = deviceTime.getTime() + skew;
      const sched = new Date(dose.scheduled_at).getTime();
      if (corrected < sched - 5 * MIN || corrected > sched + WINDOW_MS + MIN) {
        result.status = dose.status;
        result.error = 'Konfirmasi di luar 30 menit jendela minum.';
        continue;
      }
      await conn.execute(
        `UPDATE doses SET status = ?, device_time = ?, server_time = ?, warning = ?, pose = ?, face_check = ?
          WHERE id = ?`,
        [u.status, deviceTime, serverNow, warning, String(u.pose).trim().slice(0, 80),
         ['ok', 'tidak_diverifikasi'].includes(u.face_check) ? u.face_check : 'tidak_diverifikasi', id]
      );
      await conn.execute(
        'UPDATE medications m JOIN doses d ON d.medication_id = m.id SET m.stock = GREATEST(m.stock - m.qty_per_dose, 0) WHERE d.id = ?',
        [id]
      );
      result.status = u.status;
    }
    await conn.commit();
    res.json({ server_time: serverNow.toISOString(), warning, results });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    next(e);
  } finally {
    if (conn) conn.release();
  }
});

module.exports = router;
