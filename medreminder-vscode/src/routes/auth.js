const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, requireAuth } = require('../auth');
const { isTimezone } = require('../lib/schedule');

const router = express.Router();
const ROLES = ['pasien', 'pengawas'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, timezone: u.timezone });

// POST /api/auth/register  { name, email, password, role, consent, timezone }
router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = req.body.role;
    const timezone = isTimezone(req.body.timezone) ? req.body.timezone : 'Asia/Jakarta';

    if (!name) return res.status(400).json({ error: 'Isi nama terlebih dahulu.' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Masukkan email yang valid.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter.' });
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Peran harus pasien atau pengawas.' });
    if (role === 'pasien' && req.body.consent !== true) {
      return res.status(400).json({ error: 'Centang persetujuan penggunaan data untuk mendaftar.' });
    }

    const hash = await bcrypt.hash(password, 10);
    try {
      const [r] = await db.execute(
        'INSERT INTO users (name, email, password_hash, role, timezone, consent_at) VALUES (?, ?, ?, ?, ?, ?)',
        [name, email, hash, role, timezone, role === 'pasien' ? new Date() : null]
      );
      const user = { id: r.insertId, name, email, role, timezone };
      res.status(201).json({ token: signToken(user), user });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Email ini sudah terdaftar. Silakan masuk.' });
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login  { email, password, role }
router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const role = req.body.role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Peran harus pasien atau pengawas.' });

    const [rows] = await db.execute('SELECT * FROM users WHERE email = ? AND role = ?', [email, role]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) {
      return res.status(401).json({ error: 'Email atau password salah.' });
    }
    res.json({ token: signToken(u), user: publicUser(u) });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me
router.get('/me', requireAuth(), async (req, res, next) => {
  try {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0]) return res.status(401).json({ error: 'Akun tidak ditemukan. Silakan masuk lagi.' });
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
