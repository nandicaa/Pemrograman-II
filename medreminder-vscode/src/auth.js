const jwt = require('jsonwebtoken');

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// requireAuth()            -> semua akun yang sudah masuk
// requireAuth('pasien')    -> hanya pasien
// requireAuth('pengawas')  -> hanya pengawas
function requireAuth(role) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (role && payload.role !== role) {
        return res.status(403).json({ error: 'Akun ini tidak punya akses ke fitur tersebut.' });
      }
      req.user = payload;
      next();
    } catch (e) {
      return res.status(401).json({ error: 'Sesi berakhir. Silakan masuk lagi.' });
    }
  };
}

module.exports = { signToken, requireAuth };
