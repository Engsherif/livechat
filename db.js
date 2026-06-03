const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const db = new Database(path.join(__dirname, 'chat.db'));

const DEFAULT_OWNER_USERNAME = process.env.OWNER_USERNAME || 'admin';
const DEFAULT_OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'admin1234';
const USERNAME_RE = /^[\p{L}\p{N}_\- ]{3,20}$/u;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ===================== إنشاء الجداول =====================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT UNIQUE NOT NULL,
    password  TEXT NOT NULL,
    role      TEXT DEFAULT 'member',
    nameColor TEXT DEFAULT NULL,
    banned    INTEGER DEFAULT 0,
    createdAt INTEGER DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS owner (
    id       INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    password TEXT NOT NULL
  );
`);

// إنشاء حساب المالك إن لم يكن موجوداً
const ownerExists = db.prepare('SELECT id FROM owner WHERE id=1').get();
if (!ownerExists) {
  const hashed = bcrypt.hashSync(DEFAULT_OWNER_PASSWORD, 10);
  db.prepare('INSERT INTO owner (id, username, password) VALUES (1, ?, ?)').run(DEFAULT_OWNER_USERNAME, hashed);
  console.log(`✅ تم إنشاء حساب المالك: ${DEFAULT_OWNER_USERNAME} / ${DEFAULT_OWNER_PASSWORD === 'admin1234' ? 'admin1234' : '[من ENV]'}`);
  if (DEFAULT_OWNER_PASSWORD === 'admin1234') console.warn('⚠️ غيّر كلمة مرور المالك فوراً من لوحة التحكم أو OWNER_PASSWORD');
}

// ===================== دوال المستخدمين =====================

function registerUser(username, password) {
  try {
    if (!username || username.trim().length < 3) return { ok: false, error: 'الاسم قصير جداً (3 أحرف على الأقل)' };
    if (!password || password.length < 6)        return { ok: false, error: 'كلمة المرور قصيرة جداً (6 أحرف على الأقل)' };
    const clean  = String(username).trim().replace(/\s+/g, ' ');
    if (!USERNAME_RE.test(clean)) return { ok: false, error: 'الاسم يحتوي رموز غير مسموحة أو أطول من اللازم' };
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(clean, hashed);
    return { ok: true };
  } catch (e) {
    if (e.message.includes('UNIQUE')) return { ok: false, error: 'الاسم مستخدم بالفعل' };
    return { ok: false, error: 'خطأ في التسجيل' };
  }
}

function loginUser(username, password) {
  username = String(username || '').trim().replace(/\s+/g, ' ');
  // تحقق هل هو المالك
  const owner = db.prepare('SELECT * FROM owner WHERE username=?').get(username);
  if (owner) {
    const match = bcrypt.compareSync(password, owner.password);
    if (!match) return { ok: false, error: 'كلمة المرور غلط' };
    return { ok: true, user: { username: owner.username, role: 'owner', nameColor: '#FFD700', banned: false } };
  }
  // عضو عادي
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user)              return { ok: false, error: 'اليوزر مش موجود' };
  if (user.banned)        return { ok: false, error: 'أنت محظور' };
  const match = bcrypt.compareSync(password, user.password);
  if (!match)             return { ok: false, error: 'كلمة المرور غلط' };
  return { ok: true, user: { username: user.username, role: user.role, nameColor: user.nameColor, banned: false } };
}

function getAllUsers() {
  return db.prepare('SELECT id, username, role, nameColor, banned, createdAt FROM users ORDER BY createdAt DESC').all();
}

function setUserRole(username, role) {
  const valid = ['member', 'moderator', 'host', 'vip'];
  if (!valid.includes(role)) return { ok: false, error: 'رول غير صحيح' };
  const info = db.prepare('UPDATE users SET role=? WHERE username=?').run(role, username);
  if (info.changes === 0) return { ok: false, error: 'المستخدم غير موجود' };
  return { ok: true };
}

function setUserColor(username, color) {
  if (color && !COLOR_RE.test(color)) return { ok: false, error: 'لون غير صحيح' };
  db.prepare('UPDATE users SET nameColor=? WHERE username=?').run(color || null, username);
  return { ok: true };
}

function banUser(username) {
  db.prepare('UPDATE users SET banned=1 WHERE username=?').run(username);
  return { ok: true };
}

function unbanUser(username) {
  db.prepare('UPDATE users SET banned=0 WHERE username=?').run(username);
  return { ok: true };
}

function verifyOwner(username, password) {
  const owner = db.prepare('SELECT * FROM owner WHERE username=?').get(username);
  if (!owner) return false;
  return bcrypt.compareSync(password, owner.password);
}

function changeOwnerPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) return { ok: false, error: 'كلمة المرور قصيرة جداً' };
  const hashed = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE owner SET password=? WHERE id=1').run(hashed);
  return { ok: true };
}

module.exports = {
  registerUser, loginUser, getAllUsers,
  setUserRole, setUserColor,
  banUser, unbanUser,
  verifyOwner, changeOwnerPassword
};
