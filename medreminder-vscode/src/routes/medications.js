const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const { parseRule, ruleTimes, isTime, isDate } = require('../lib/schedule');
const { regenerateDoses, WINDOW_MS } = require('../lib/doses');
const { Medication, Collection } = require('../lib/medication');

const router = express.Router();
router.use(requireAuth('pasien'));

const TYPES = ['botol', 'pil', 'lain'];
const SELECT_MED = "SELECT *, DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date FROM medications";

function medJson(m) {
  return new Medication(m).toJSON();
}

// Validasi isi formulir obat; mengembalikan { error } atau { values }
function readForm(b) {
  const name = String(b.name || '').trim().slice(0, 120);
  const unit = String(b.unit || '').trim().slice(0, 80);
  const rule = parseRule(b.rule);
  const days = parseInt(b.duration_days, 10);
  const stock = Number(b.stock);
  const minStock = Number(b.min_stock);
  if (!name || !unit) return { error: 'Isi nama obat dan satuannya.' };
  if (!rule) return { error: 'Aturan minum belum benar. Tulis seperti 3x1 (maksimal 6 kali sehari).' };
  if (!isTime(b.first_time)) return { error: 'Pilih jam minum pertama.' };
  if (!(days >= 1 && days <= 365)) return { error: 'Lama minum antara 1 sampai 365 hari.' };
  if (!isDate(b.start_date)) return { error: 'Pilih tanggal mulai.' };
  if (!(stock >= 0 && stock <= 99999) || !(minStock >= 0 && minStock <= 99999)) {
    return { error: 'Stok harus berupa angka antara 0 sampai 99.999.' };
  }
  return {
    values: {
      name, unit,
      type: TYPES.includes(b.type) ? b.type : 'pil',
      note: String(b.note || '').trim().slice(0, 255) || null,
      times_per_day: rule.timesPerDay,
      qty_per_dose: rule.qtyPerDose,
      first_time: b.first_time,
      schedule_times: ruleTimes(rule.timesPerDay, b.first_time).join(','),
      duration_days: days,
      start_date: b.start_date,
      stock,
      min_stock: minStock,
    },
  };
}

async function getTimezone(userId) {
  const [rows] = await db.execute('SELECT timezone FROM users WHERE id = ?', [userId]);
  return rows[0] ? rows[0].timezone : 'Asia/Jakarta';
}

async function getMed(conn, id, patientId) {
  const [rows] = await conn.execute(SELECT_MED + ' WHERE id = ? AND patient_id = ? AND active = 1', [id, patientId]);
  return rows[0] || null;
}

// GET /api/medications  -> obat aktif milik pasien
router.get('/', async (req, res, next) => {
  try {
    const [rows] = await db.execute(SELECT_MED + ' WHERE patient_id = ? AND active = 1 ORDER BY name', [req.user.id]);
    const medications = new Collection(rows.map((row) => new Medication(row))).map((medication) => medication.toJSON());
    res.json({ medications });
  } catch (e) {
    next(e);
  }
});

// POST /api/medications  -> tambah obat dan buat jadwal dosisnya
router.post('/', async (req, res, next) => {
  const form = readForm(req.body);
  if (form.error) return res.status(400).json({ error: form.error });
  const v = form.values;
  let conn;
  try {
    const tz = await getTimezone(req.user.id);
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `INSERT INTO medications
        (patient_id, name, type, unit, note, times_per_day, qty_per_dose, first_time, schedule_times, duration_days, start_date, stock, min_stock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, v.name, v.type, v.unit, v.note, v.times_per_day, v.qty_per_dose, v.first_time,
       v.schedule_times, v.duration_days, v.start_date, v.stock, v.min_stock]
    );
    const med = await getMed(conn, r.insertId, req.user.id);
    const count = await regenerateDoses(conn, med, tz);
    await conn.commit();
    res.status(201).json({ medication: medJson(med), doses_created: count });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    next(e);
  } finally {
    if (conn) conn.release();
  }
});

// PUT /api/medications/:id  -> ubah obat; jadwal mendatang dibuat ulang, riwayat tidak berubah
router.put('/:id', async (req, res, next) => {
  const form = readForm(req.body);
  if (form.error) return res.status(400).json({ error: form.error });
  const v = form.values;
  let conn;
  try {
    const tz = await getTimezone(req.user.id);
    conn = await db.getConnection();
    await conn.beginTransaction();
    const old = await getMed(conn, req.params.id, req.user.id);
    if (!old) {
      await conn.rollback();
      return res.status(404).json({ error: 'Obat tidak ditemukan.' });
    }
    await conn.execute(
      `UPDATE medications SET name = ?, type = ?, unit = ?, note = ?, times_per_day = ?, qty_per_dose = ?, first_time = ?,
         schedule_times = ?, duration_days = ?, start_date = ?, stock = ?, min_stock = ? WHERE id = ?`,
      [v.name, v.type, v.unit, v.note, v.times_per_day, v.qty_per_dose, v.first_time, v.schedule_times,
       v.duration_days, v.start_date, v.stock, v.min_stock, old.id]
    );
    const med = await getMed(conn, old.id, req.user.id);
    const scheduleChanged = ['times_per_day', 'first_time', 'duration_days', 'start_date']
      .some((k) => String(old[k]) !== String(med[k]));
    if (scheduleChanged) await regenerateDoses(conn, med, tz);
    await conn.commit();
    res.json({ medication: medJson(med), schedule_changed: scheduleChanged });
  } catch (e) {
    if (conn) await conn.rollback().catch(() => {});
    next(e);
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/medications/:id/refill  { amount }  -> tambah stok setelah membeli obat
router.post('/:id/refill', async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!(amount > 0) || amount > 10000) return res.status(400).json({ error: 'Jumlah isi ulang harus lebih dari 0.' });
    const [r] = await db.execute(
      'UPDATE medications SET stock = LEAST(stock + ?, 99999) WHERE id = ? AND patient_id = ? AND active = 1',
      [amount, req.params.id, req.user.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Obat tidak ditemukan.' });
    const med = await getMed(db, req.params.id, req.user.id);
    res.json({ medication: medJson(med) });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/medications/:id  -> obat dinonaktifkan, jadwal mendatang dihapus, riwayat tetap ada
router.delete('/:id', async (req, res, next) => {
  try {
    const [r] = await db.execute(
      'UPDATE medications SET active = 0 WHERE id = ? AND patient_id = ? AND active = 1',
      [req.params.id, req.user.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: 'Obat tidak ditemukan.' });
    await db.execute(
      "DELETE FROM doses WHERE medication_id = ? AND status = 'terjadwal' AND scheduled_at > ?",
      [req.params.id, new Date(Date.now() - WINDOW_MS)]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = { router, medJson, SELECT_MED };
