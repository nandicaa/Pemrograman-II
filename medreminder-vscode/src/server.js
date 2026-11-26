require('dotenv').config();
const express = require('express');
const cors = require('cors');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'ganti-dengan-rahasia-panjang') {
  console.error('JWT_SECRET belum diisi di berkas .env. Lihat .env.example.');
  process.exit(1);
}

const db = require('./db');
const { markMissed } = require('./lib/doses');
const authRoutes = require('./routes/auth');
const { router: medicationRoutes } = require('./routes/medications');
const doseRoutes = require('./routes/doses');
const { links, supervisor } = require('./routes/supervisors');

const app = express();
app.disable('x-powered-by');

const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors(origins.length ? { origin: origins } : undefined));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

app.get('/', (req, res) => {
  res.type('text').send('Server MedReminder berjalan. Buka aplikasinya di http://localhost/medreminder');
});

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1 FROM doses LIMIT 1');
    res.json({ ok: true, server_time: new Date().toISOString() });
  } catch (e) {
    const msg = e.code === 'ER_NO_SUCH_TABLE' || e.code === 'ER_BAD_DB_ERROR'
      ? 'Database atau tabel belum dibuat. Impor database/schema.sql lewat phpMyAdmin.'
      : 'Database tidak dapat dihubungi. Pastikan MySQL di XAMPP sudah dinyalakan.';
    res.status(503).json({ ok: false, error: msg });
  }
});

// Dosis yang lewat 30 menit tanpa konfirmasi ditandai terlewat sebelum data dibaca
app.use('/api', async (req, res, next) => {
  if (req.method === 'GET' && (req.path.startsWith('/doses') || req.path.startsWith('/supervisor'))) {
    try { await markMissed(); } catch (e) { return next(e); }
  }
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/doses', doseRoutes);
app.use('/api/links', links);
app.use('/api/supervisor', supervisor);

app.use('/api', (req, res) => res.status(404).json({ error: 'Alamat API tidak ditemukan.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Format JSON tidak valid.' });
  if (['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE'].includes(err.code)) {
    console.error('Masalah database:', err.code, err.message);
    return res.status(503).json({ error: 'Server tidak dapat membaca database. Buka /api/health untuk melihat penyebabnya.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server.' });
});

// Tandai dosis terlewat setiap menit, supaya pengawas melihatnya walau aplikasi pasien tidak dibuka
setInterval(() => markMissed().catch(() => {}), 60e3);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`MedReminder berjalan di http://localhost:${port}`);
  db.query('SELECT 1 FROM doses LIMIT 1')
    .then(() => console.log('Database tersambung.'))
    .catch((e) => console.error('Database belum siap:', e.code, '- buka http://localhost:' + port + '/api/health'));
});
