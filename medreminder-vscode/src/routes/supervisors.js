const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { summarize } = require('../lib/doses');
const { localToUtc, localDate, addDays } = require('../lib/schedule');
const { Dictionary } = require('../lib/medication');
const { medJson, SELECT_MED } = require('./medications');

const DAY = 864e5;

// ---------- Untuk pasien: menautkan pengawas ----------
const links = express.Router();
links.use(requireAuth('pasien'));

// GET /api/links
links.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.execute(
      `SELECT u.id, u.name, u.email, l.created_at
         FROM supervisor_links l JOIN users u ON u.id = l.supervisor_id
        WHERE l.patient_id = ? ORDER BY l.created_at`,
      [req.user.id]
    );
    res.json({ supervisors: rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/links  { email }
links.post('/', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const [rows] = await db.execute("SELECT id, name, email FROM users WHERE email = ? AND role = 'pengawas'", [email]);
    if (!rows[0]) {
      return res.status(404).json({ error: 'Email ini belum terdaftar sebagai pengawas. Minta pengawas mendaftar di website pengawas dulu.' });
    }
    const [r] = await db.execute('INSERT IGNORE INTO supervisor_links (patient_id, supervisor_id) VALUES (?, ?)', [req.user.id, rows[0].id]);
    if (!r.affectedRows) return res.status(409).json({ error: 'Pengawas ini sudah tertaut.' });
    res.status(201).json({ supervisor: rows[0] });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/links/:supervisorId
links.delete('/:supervisorId', async (req, res, next) => {
  try {
    await db.execute('DELETE FROM supervisor_links WHERE patient_id = ? AND supervisor_id = ?', [req.user.id, req.params.supervisorId]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- Untuk pengawas ----------
const supervisor = express.Router();
supervisor.use(requireAuth('pengawas'));

async function linkedPatients(supervisorId) {
  const [rows] = await db.execute(
    `SELECT u.id, u.name, u.email, u.timezone FROM supervisor_links l JOIN users u ON u.id = l.patient_id
      WHERE l.supervisor_id = ? ORDER BY u.name`,
    [supervisorId]
  );
  return rows;
}

async function linkedPatient(supervisorId, patientId) {
  const [rows] = await db.execute(
    `SELECT u.id, u.name, u.email, u.timezone FROM supervisor_links l JOIN users u ON u.id = l.patient_id
      WHERE l.supervisor_id = ? AND l.patient_id = ?`,
    [supervisorId, patientId]
  );
  return rows[0] || null;
}

// Awal dan akhir "hari ini" menurut zona waktu pasien
function todayRange(tz) {
  const today = localDate(new Date(), tz);
  return [localToUtc(today, '00:00', tz), localToUtc(addDays(today, 1), '00:00', tz)];
}

// GET /api/supervisor/overview  -> hal yang perlu perhatian + ringkasan tiap pasien
supervisor.get('/overview', async (req, res, next) => {
  try {
    const patients = await linkedPatients(req.user.id);
    if (!patients.length) return res.json({ alerts: [], patients: [] });
    const ids = patients.map((p) => p.id);
    const marks = ids.map(() => '?').join(',');
    const now = Date.now();

    const [doses] = await db.query(
      `SELECT d.patient_id, d.scheduled_at, d.status, d.server_time, d.warning, m.name AS medication
         FROM doses d JOIN medications m ON m.id = d.medication_id
        WHERE d.patient_id IN (${marks}) AND d.scheduled_at >= ? AND d.scheduled_at < ?`,
      [...ids, new Date(now - 30 * DAY), new Date(now + 2 * DAY)]
    );
    const [meds] = await db.query(SELECT_MED + ` WHERE patient_id IN (${marks}) AND active = 1`, ids);

    const alerts = [];
    const list = patients.map((p) => {
      const mine = doses.filter((d) => d.patient_id === p.id);
      const past = (days) => mine.filter((d) => new Date(d.scheduled_at) >= now - days * DAY && new Date(d.scheduled_at) <= now);
      const s7 = summarize(past(7));
      const s30 = summarize(past(30));
      const missed24 = past(1).filter((d) => d.status === 'terlewat');
      const warn7 = past(7).filter((d) => d.warning);
      const myMeds = meds.filter((m) => m.patient_id === p.id).map(medJson);
      const low = myMeds.filter((m) => m.low_stock);
      const next = mine
        .filter((d) => d.status === 'terjadwal' && new Date(d.scheduled_at) > now)
        .sort((a, b) => a.scheduled_at - b.scheduled_at)[0];
      const lastReport = mine.reduce((max, d) => (d.status === 'diminum' || d.status === 'dilewati') && d.server_time > max ? d.server_time : max, null);

      if (missed24.length) {
        const medicationNames = new Dictionary();
        for (const dose of missed24) medicationNames.set(dose.medication, true);
        alerts.push({ level: 'tinggi', patient_id: p.id, patient: p.name,
          text: `${missed24.length} dosis terlewat dalam 24 jam terakhir (${medicationNames.keys().join(', ')})` });
      }
      for (const m of low) {
        alerts.push({ level: 'sedang', patient_id: p.id, patient: p.name,
          text: m.stock <= 0 ? `Stok ${m.name} habis` : `Stok ${m.name} tinggal ${m.stock} (cukup ${m.days_left} hari)` });
      }
      if (warn7.length) {
        alerts.push({ level: 'rendah', patient_id: p.id, patient: p.name,
          text: `${warn7.length} konfirmasi dengan jam perangkat yang tidak sesuai dalam 7 hari` });
      }
      return {
        id: p.id, name: p.name, email: p.email, timezone: p.timezone,
        week: s7, month: s30,
        active_meds: myMeds.length,
        low_stock: low.length,
        warnings_7d: warn7.length,
        next_dose: next ? { scheduled_at: next.scheduled_at, medication: next.medication } : null,
        last_report: lastReport,
      };
    });
    const order = { tinggi: 0, sedang: 1, rendah: 2 };
    alerts.sort((a, b) => order[a.level] - order[b.level]);
    res.json({ alerts, patients: list });
  } catch (e) {
    next(e);
  }
});

// GET /api/supervisor/patients/:id  -> ringkasan, jadwal hari ini, obat, kepatuhan 14 hari
supervisor.get('/patients/:id', async (req, res, next) => {
  try {
    const p = await linkedPatient(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Pasien tidak ditemukan atau belum menautkan akun ini.' });
    const now = Date.now();
    const [start, end] = todayRange(p.timezone);

    const [rows] = await db.execute(
      `SELECT d.id, d.scheduled_at, d.status, d.device_time, d.server_time, d.warning, d.pose, d.face_check,
              m.name AS medication, m.unit, m.qty_per_dose
         FROM doses d JOIN medications m ON m.id = d.medication_id
        WHERE d.patient_id = ? AND d.scheduled_at >= ? AND d.scheduled_at < ?
        ORDER BY d.scheduled_at`,
      [p.id, new Date(now - 30 * DAY), end]
    );
    const past = (days) => rows.filter((d) => new Date(d.scheduled_at) >= now - days * DAY && new Date(d.scheduled_at) <= now);

    // Kepatuhan per hari (14 hari terakhir), dikelompokkan menurut tanggal lokal pasien
    const daily = [];
    const today = localDate(new Date(), p.timezone);
    for (let i = 13; i >= 0; i--) {
      const day = addDays(today, -i);
      const s = summarize(rows.filter((d) => localDate(new Date(d.scheduled_at), p.timezone) === day && new Date(d.scheduled_at) <= now));
      daily.push({ date: day, ...s });
    }

    const [meds] = await db.execute(SELECT_MED + ' WHERE patient_id = ? AND active = 1 ORDER BY name', [p.id]);
    res.json({
      patient: p,
      week: summarize(past(7)),
      month: summarize(past(30)),
      daily,
      today: rows.filter((d) => new Date(d.scheduled_at) >= start),
      medications: meds.map(medJson),
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/supervisor/patients/:id/doses?days=30&status=terlewat&medication_id=3  -> riwayat (maks. 100 baris)
supervisor.get('/patients/:id/doses', async (req, res, next) => {
  try {
    const p = await linkedPatient(req.user.id, req.params.id);
    if (!p) return res.status(404).json({ error: 'Pasien tidak ditemukan atau belum menautkan akun ini.' });
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    const where = ["d.patient_id = ?", "d.status <> 'terjadwal'", 'd.scheduled_at >= ?', 'd.scheduled_at <= UTC_TIMESTAMP()'];
    const params = [p.id, new Date(Date.now() - days * DAY)];
    if (['diminum', 'terlewat'].includes(req.query.status)) { where.push('d.status = ?'); params.push(req.query.status); }
    if (req.query.warning === '1') where.push('d.warning IS NOT NULL');
    if (req.query.medication_id) { where.push('d.medication_id = ?'); params.push(Number(req.query.medication_id)); }

    const [rows] = await db.execute(
      `SELECT d.id, d.medication_id, d.scheduled_at, d.status, d.device_time, d.server_time, d.warning, d.pose, d.face_check,
              m.name AS medication, m.unit, m.qty_per_dose
         FROM doses d JOIN medications m ON m.id = d.medication_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.scheduled_at DESC LIMIT 100`,
      params
    );
    // Semua obat pasien (termasuk yang sudah dihapus) untuk pilihan filter
    const [medOptions] = await db.execute(
      'SELECT DISTINCT m.id, m.name, m.active FROM medications m WHERE m.patient_id = ? ORDER BY m.active DESC, m.name',
      [p.id]
    );
    res.json({ patient: p, doses: rows, medications: medOptions });
  } catch (e) {
    next(e);
  }
});

module.exports = { links, supervisor };
