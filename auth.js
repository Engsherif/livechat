const db = require('./db');

// ===================== Middleware: التحقق من المالك =====================
function authenticateOwner(req, res, next) {
  const auth = req.headers['x-owner-auth'];
  if (!auth) return res.json({ ok: false, error: 'غير مصرح' });

  try {
    const decoded  = Buffer.from(auth, 'base64').toString('utf8');
    const { username, password } = JSON.parse(decoded);
    if (db.verifyOwner(username, password)) return next();
    res.json({ ok: false, error: 'بيانات المالك غلط' });
  } catch {
    res.json({ ok: false, error: 'خطأ في التحقق' });
  }
}

// ===================== Device Fingerprint =====================
function generateFingerprint(deviceInfo) {
  const str = JSON.stringify(deviceInfo || {});
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

module.exports = { authenticateOwner, generateFingerprint };
