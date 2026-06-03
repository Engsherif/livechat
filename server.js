const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const db       = require('./db');
const { authenticateOwner } = require('./auth');
const { hasPermission, canActOn, canSendPrivateTo } = require('./permissions');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' },
  pingTimeout: 30000,
  pingInterval: 10000,
});

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '32kb' }));
app.use('/api/', makeRateLimiter({ windowMs: 60_000, max: 90 }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '1h' }));

// الصفحة الرئيسية → صفحة الدخول
app.get('/', (req, res) => res.redirect('/login.html'));

// ===================== الغرف الثابتة =====================
const STATIC_ROOMS = [
  { id: 'egypt',     name: '🇪🇬 مصر' },
  { id: 'arabs',     name: '🌍 كل العرب' },
  { id: 'youth',     name: '👥 شباب وبنات' },
  { id: 'butterfly', name: '🦋 فراشة' },
  { id: 'romantic',  name: '💕 رومانسية' },
];

// ===================== الذاكرة (RAM) =====================
const liveRooms    = {};   // roomId → { id, name, isPrivate, owner, messages[] }
const onlineUsers  = {};   // socketId → user
const privateChats = {};   // key → messages[]

STATIC_ROOMS.forEach(r => {
  liveRooms[r.id] = { ...r, isPrivate: false, owner: null, messages: [] };
});

// ===================== حماية وتنظيف مدخلات =====================
const apiBuckets = new Map();
const USERNAME_RE = /^[\p{L}\p{N}_\- ]{3,20}$/u;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
}

function makeRateLimiter({ windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = getIp(req) + ':' + req.path;
    const bucket = (apiBuckets.get(key) || []).filter(t => now - t < windowMs);
    bucket.push(now);
    apiBuckets.set(key, bucket);
    if (bucket.length > max) return res.status(429).json({ ok: false, error: 'طلبات كثيرة، حاول بعد قليل' });
    next();
  };
}

function sanitizeName(value, fallback = '') {
  const clean = String(value || fallback || '')
    .replace(/[\u0000-\u001f\u007f<>"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  return clean;
}

function isValidUsername(name) {
  return USERNAME_RE.test(name);
}

function sanitizeText(value, max = 500) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s{4,}/g, '   ')
    .trim()
    .slice(0, max);
}

function sanitizeColor(color) {
  return COLOR_RE.test(String(color || '')) ? color : null;
}

function limitRoomMessages(roomId) {
  if (liveRooms[roomId] && liveRooms[roomId].messages.length > 200) {
    liveRooms[roomId].messages = liveRooms[roomId].messages.slice(-200);
  }
}

function socketRateLimited(socket, key, max = 12, windowMs = 5000) {
  const now = Date.now();
  socket.data.rate = socket.data.rate || {};
  const arr = (socket.data.rate[key] || []).filter(t => now - t < windowMs);
  arr.push(now);
  socket.data.rate[key] = arr;
  if (arr.length > max) {
    socket.emit('perm_error', { action: 'rate_limit', msg: '⚠️ رسائل كثيرة بسرعة، اهدأ قليلاً' });
    return true;
  }
  return false;
}

// ===================== مساعدات =====================
const roleOrder = { owner: 0, moderator: 1, host: 2, vip: 3, member: 4, guest: 5 };

function getRoomList() {
  return Object.values(liveRooms).map(r => ({
    id: r.id,
    name: r.name,
    isPrivate: r.isPrivate,
    count: Object.values(onlineUsers).filter(u => u.room === r.id).length,
  }));
}

function getMemberList(roomId) {
  return Object.values(onlineUsers)
    .filter(u => u.room === roomId)
    .sort((a, b) => (roleOrder[a.role] ?? 5) - (roleOrder[b.role] ?? 5))
    .map(u => ({
      username: u.username,
      role: u.role,
      nameColor: u.nameColor,
      isGuest: u.isGuest,
      muted: u.muted,
    }));
}

function privateKey(a, b) { return [a, b].sort().join('__'); }

function systemMsg(roomId, text) {
  const msg = { type: 'system', text, time: Date.now() };
  if (liveRooms[roomId]) { liveRooms[roomId].messages.push(msg); limitRoomMessages(roomId); }
  io.to(roomId).emit('message', msg);
}

function findUserByName(username) {
  return Object.values(onlineUsers).find(u => u.username === username);
}

// ===================== REST API =====================

// تسجيل
app.post('/api/register', (req, res) => {
  const username = sanitizeName(req.body?.username);
  const password = String(req.body?.password || '');
  if (!isValidUsername(username)) return res.json({ ok: false, error: 'اسم المستخدم غير صالح' });
  res.json(db.registerUser(username, password));
});

// تسجيل دخول (فحص فقط)
app.post('/api/login', makeRateLimiter({ windowMs: 60_000, max: 20 }), (req, res) => {
  const username = sanitizeName(req.body?.username);
  const password = String(req.body?.password || '');
  res.json(db.loginUser(username, password));
});

// --- لوحة تحكم المالك ---

// قائمة الأعضاء المسجلين
app.get('/api/owner/users', authenticateOwner, (req, res) => {
  res.json({ ok: true, users: db.getAllUsers() });
});

// الأعضاء أونلاين الآن
app.get('/api/owner/online', authenticateOwner, (req, res) => {
  const users = Object.values(onlineUsers).map(u => ({
    username:   u.username,
    role:       u.role,
    room:       u.room,
    isGuest:    u.isGuest,
    muted:      u.muted,
    fingerprint: u.fingerprint,
    deviceInfo: u.deviceInfo,
    joinedAt:   u.joinedAt,
  }));
  res.json({ ok: true, users });
});

// المحادثات الخاصة
app.get('/api/owner/private-chats', authenticateOwner, (req, res) => {
  res.json({ ok: true, chats: privateChats });
});

// تعيين رول
app.post('/api/owner/set-role', authenticateOwner, (req, res) => {
  const { username, role } = req.body || {};
  const result = db.setUserRole(username, role);
  if (result.ok) {
    const u = findUserByName(username);
    if (u) {
      u.role = role;
      io.to(u.room).emit('members_update', getMemberList(u.room));
      io.to(u.socketId).emit('your_role_updated', { role });
    }
  }
  res.json(result);
});

// تعيين لون الاسم
app.post('/api/owner/set-color', authenticateOwner, (req, res) => {
  const username = sanitizeName(req.body?.username);
  const color = sanitizeColor(req.body?.color);
  const result = db.setUserColor(username, color);
  if (result.ok) {
    const u = findUserByName(username);
    if (u) {
      u.nameColor = color;
      io.to(u.room).emit('members_update', getMemberList(u.room));
      io.to(u.socketId).emit('your_color_updated', { color });
    }
  }
  res.json(result);
});

// حظر مستخدم
app.post('/api/owner/ban', authenticateOwner, (req, res) => {
  const username = sanitizeName(req.body?.username);
  const u = findUserByName(username);
  if (u && u.role === 'owner') return res.json({ ok: false, error: 'لا يمكن حظر المالك' });
  db.banUser(username);
  if (u) {
    io.to(u.socketId).emit('kicked', { reason: 'تم حظرك من قبل المالك' });
    io.sockets.sockets.get(u.socketId)?.disconnect(true);
  }
  res.json({ ok: true });
});

// رفع حظر
app.post('/api/owner/unban', authenticateOwner, (req, res) => {
  const username = sanitizeName(req.body?.username);
  res.json(db.unbanUser(username));
});

// كتم مستخدم (API)
app.post('/api/owner/mute', authenticateOwner, (req, res) => {
  const username = sanitizeName(req.body?.username);
  const u = findUserByName(username);
  if (u && u.role === 'owner') return res.json({ ok: false, error: 'لا يمكن كتم المالك' });
  if (u) {
    u.muted = true;
    io.to(u.socketId).emit('you_muted');
    io.to(u.room).emit('members_update', getMemberList(u.room));
  }
  res.json({ ok: true });
});

// رفع كتم (API)
app.post('/api/owner/unmute', authenticateOwner, (req, res) => {
  const username = sanitizeName(req.body?.username);
  const u = findUserByName(username);
  if (u) {
    u.muted = false;
    io.to(u.socketId).emit('you_unmuted');
    io.to(u.room).emit('members_update', getMemberList(u.room));
  }
  res.json({ ok: true });
});

// طرد مستخدم (API)
app.post('/api/owner/kick', authenticateOwner, (req, res) => {
  const username = sanitizeName(req.body?.username);
  const reason = sanitizeText(req.body?.reason, 120);
  const u = findUserByName(username);
  if (u && u.role === 'owner') return res.json({ ok: false, error: 'لا يمكن طرد المالك' });
  if (u) {
    io.to(u.socketId).emit('kicked', { reason: reason || 'تم طردك من قبل المالك' });
    io.sockets.sockets.get(u.socketId)?.disconnect(true);
  }
  res.json({ ok: true });
});

// إعلان للجميع
app.post('/api/owner/broadcast', authenticateOwner, (req, res) => {
  const text = sanitizeText(req.body?.text, 300);
  if (!text) return res.json({ ok: false, error: 'النص فارغ' });
  io.emit('announcement', { text, time: Date.now() });
  res.json({ ok: true });
});

// تغيير كلمة مرور المالك
app.post('/api/owner/change-password', authenticateOwner, (req, res) => {
  const { newPassword } = req.body || {};
  res.json(db.changeOwnerPassword(newPassword));
});

// ريست كامل
app.post('/api/owner/reset', authenticateOwner, (req, res) => {
  Object.values(liveRooms).forEach(r => { r.messages = []; });
  Object.keys(privateChats).forEach(k => delete privateChats[k]);
  Object.keys(liveRooms)
    .filter(id => liveRooms[id].isPrivate)
    .forEach(id => delete liveRooms[id]);
  io.emit('full_reset');
  res.json({ ok: true });
});

// ===================== Socket.io =====================
io.on('connection', (socket) => {

  // ==================== دخول ====================
  socket.on('join', (data) => {
    let user;

    if (data.isGuest) {
      const guestName = sanitizeName(data.username, `زائر_${Date.now() % 9999}`) || `زائر_${Date.now() % 9999}`;
      // منع التكرار في نفس الغرفة
      const exists = findUserByName(guestName);
      const finalName = exists ? `${guestName}_${Math.floor(Math.random() * 99)}` : guestName;

      user = {
        socketId:   socket.id,
        username:   finalName,
        role:       'guest',
        nameColor:  null,
        isGuest:    true,
        room:       'egypt',
        muted:      false,
        fingerprint: data.fingerprint || '',
        deviceInfo: data.deviceInfo || {},
        joinedAt:   Date.now(),
      };
    } else {
      const result = db.loginUser(sanitizeName(data.username), String(data.password || ''));
      if (!result.ok)          { socket.emit('auth_error', result.error); return; }
      if (result.user.banned)  { socket.emit('auth_error', 'أنت محظور'); return; }

      // إذا كان متصلاً مسبقاً، افصل الجلسة القديمة
      const oldSession = findUserByName(result.user.username);
      if (oldSession) {
        io.to(oldSession.socketId).emit('kicked', { reason: 'تم الدخول من جهاز آخر' });
        io.sockets.sockets.get(oldSession.socketId)?.disconnect(true);
        delete onlineUsers[oldSession.socketId];
      }

      user = {
        socketId:   socket.id,
        username:   result.user.username,
        role:       result.user.role,
        nameColor:  result.user.nameColor,
        isGuest:    false,
        room:       'egypt',
        muted:      false,
        fingerprint: data.fingerprint || '',
        deviceInfo: data.deviceInfo || {},
        joinedAt:   Date.now(),
      };
    }

    onlineUsers[socket.id] = user;
    socket.join('egypt');

    socket.emit('joined', {
      user: {
        username:  user.username,
        role:      user.role,
        nameColor: user.nameColor,
        isGuest:   user.isGuest,
      },
      rooms:    getRoomList(),
      messages: liveRooms['egypt'].messages.slice(-100),
      members:  getMemberList('egypt'),
    });

    io.to('egypt').emit('members_update', getMemberList('egypt'));
    io.emit('rooms_update', getRoomList());
    systemMsg('egypt', `✦ ${user.username} دخل الغرفة`);
  });

  // ==================== تغيير الغرفة ====================
  socket.on('change_room', (roomId) => {
    const user = onlineUsers[socket.id];
    if (!user || !liveRooms[roomId]) return;

    // فحص إذا كانت غرفة خاصة
    if (liveRooms[roomId].isPrivate && !hasPermission(user.role, 'canJoinPrivateRoom')) {
      socket.emit('perm_error', { action: 'join_private', msg: '❌ الغرف الخاصة للأعضاء المسجلين فقط' });
      return;
    }

    const old = user.room;
    socket.leave(old);
    systemMsg(old, `✦ ${user.username} غادر الغرفة`);
    io.to(old).emit('members_update', getMemberList(old));

    user.room = roomId;
    socket.join(roomId);

    socket.emit('room_changed', {
      roomId,
      roomName: liveRooms[roomId].name,
      messages: liveRooms[roomId].messages.slice(-100),
      members:  getMemberList(roomId),
    });

    io.to(roomId).emit('members_update', getMemberList(roomId));
    io.emit('rooms_update', getRoomList());
    systemMsg(roomId, `✦ ${user.username} دخل الغرفة`);
  });

  // ==================== إنشاء غرفة ====================
  socket.on('create_room', (data) => {
    const user = onlineUsers[socket.id];
    if (!user) return;

    // فحص صلاحية إنشاء غرفة
    if (!hasPermission(user.role, 'canCreateRoom')) {
      socket.emit('perm_error', { action: 'create_room', msg: '❌ صلاحيتك لا تسمح بإنشاء غرف' });
      return;
    }
    if (socketRateLimited(socket, 'create_room', 3, 60_000)) return;

    const roomId   = 'pvt_' + Date.now();
    const roomName = sanitizeText((data && data.name) || `غرفة ${user.username}`, 30) || `غرفة ${user.username}`;
    liveRooms[roomId] = { id: roomId, name: roomName, isPrivate: true, owner: user.username, messages: [] };
    io.emit('rooms_update', getRoomList());
    socket.emit('room_created', { roomId, roomName });
  });

  // ==================== إرسال رسالة ====================
  socket.on('send_message', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || user.muted || !liveRooms[user.room]) return;
    if (!hasPermission(user.role, 'canSendPublic')) return socket.emit('perm_error', { action: 'send_message', msg: '❌ لا تملك صلاحية الكتابة في العام' });
    if (socketRateLimited(socket, 'send_message', 10, 5000)) return;

    const text = sanitizeText(data && data.text, 500);
    if (!text) return;

    const msg = {
      type:      'chat',
      id:        `${Date.now()}_${socket.id.slice(0, 4)}`,
      username:  user.username,
      role:      user.role,
      nameColor: user.nameColor,
      text,
      time:      Date.now(),
    };

    liveRooms[user.room].messages.push(msg);
    // احتفظ بآخر 200 رسالة فقط
    limitRoomMessages(user.room);
    io.to(user.room).emit('message', msg);
  });

  // ==================== رسالة خاصة ====================
  socket.on('private_message', (data) => {
    const sender = onlineUsers[socket.id];
    if (!sender || sender.muted) return;
    if (socketRateLimited(socket, 'private_message', 8, 5000)) return;

    const text = sanitizeText(data && data.text, 500);
    const to = sanitizeName(data && data.to);
    if (!text || !to) return;

    // البحث عن المستقبل
    const recv = findUserByName(to);

    // فحص صلاحية الإرسال الخاص
    const receiverRole = recv ? recv.role : 'member'; // إذا أوفلاين نعامله كـ member
    if (!canSendPrivateTo(sender.role, receiverRole)) {
      socket.emit('perm_error', {
        action: 'private_message',
        msg: sender.role === 'guest'
          ? '❌ الزوار لا يمكنهم إرسال رسائل خاصة'
          : '❌ لا يمكنك إرسال رسالة خاصة لهذا المستخدم'
      });
      return;
    }

    const key = privateKey(sender.username, to);
    if (!privateChats[key]) privateChats[key] = [];
    const msg = { from: sender.username, to, text, time: Date.now() };
    privateChats[key].push(msg);
    if (privateChats[key].length > 500) privateChats[key] = privateChats[key].slice(-500);

    socket.emit('private_message', msg);
    if (recv) io.to(recv.socketId).emit('private_message', msg);
  });

  // ==================== حذف رسالة ====================
  socket.on('delete_message', (data) => {
    const user = onlineUsers[socket.id];
    if (!user || !hasPermission(user.role, 'canDeleteMsg')) return;

    const room = liveRooms[user.room];
    if (!room) return;

    // moderator يحذف رسائل الرتب الأدنى فقط
    const targetMsg = room.messages.find(m => m.id === data.msgId);
    if (targetMsg && targetMsg.username) {
      const targetUser = findUserByName(targetMsg.username);
      const targetRole = targetUser ? targetUser.role : 'member';
      if (user.role !== 'owner' && !canActOn(user.role, targetRole)) {
        socket.emit('perm_error', { action: 'delete_msg', msg: '❌ لا يمكنك حذف رسالة هذا المستخدم' });
        return;
      }
    }

    room.messages = room.messages.filter(m => m.id !== data.msgId);
    io.to(user.room).emit('message_deleted', { msgId: data.msgId });
  });

  // ==================== كتم ====================
  socket.on('mute_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin || !hasPermission(admin.role, 'canMuteUsers')) return;

    const target = findUserByName(sanitizeName(data.username));
    if (!target) return;

    // فحص هل يقدر يكتم هذا الدور
    if (!canActOn(admin.role, target.role)) {
      socket.emit('perm_error', { action: 'mute', msg: '❌ لا يمكنك كتم مستخدم برتبة أعلى أو مساوية لك' });
      return;
    }

    target.muted = true;
    io.to(target.socketId).emit('you_muted');
    io.to(target.room).emit('members_update', getMemberList(target.room));
  });

  // ==================== رفع كتم ====================
  socket.on('unmute_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin || !hasPermission(admin.role, 'canMuteUsers')) return;

    const target = findUserByName(sanitizeName(data.username));
    if (!target || !canActOn(admin.role, target.role)) return;

    target.muted = false;
    io.to(target.socketId).emit('you_unmuted');
    io.to(target.room).emit('members_update', getMemberList(target.room));
  });

  // ==================== طرد ====================
  socket.on('kick_user', (data) => {
    const admin = onlineUsers[socket.id];
    if (!admin || !hasPermission(admin.role, 'canKickUsers')) return;

    const target = findUserByName(sanitizeName(data.username));
    if (!target) return;

    if (!canActOn(admin.role, target.role)) {
      socket.emit('perm_error', { action: 'kick', msg: '❌ لا يمكنك طرد مستخدم برتبة أعلى أو مساوية لك' });
      return;
    }

    io.to(target.socketId).emit('kicked', { reason: sanitizeText(data.reason, 120) || 'تم طردك من الغرفة' });
    io.sockets.sockets.get(target.socketId)?.disconnect(true);
  });

  // ==================== قطع الاتصال ====================
  socket.on('disconnect', () => {
    const user = onlineUsers[socket.id];
    if (!user) return;

    const room = user.room;
    delete onlineUsers[socket.id];

    if (liveRooms[room]) {
      io.to(room).emit('members_update', getMemberList(room));
      systemMsg(room, `✦ ${user.username} غادر الشات`);
    }
    io.emit('rooms_update', getRoomList());
  });
});

// ===================== تشغيل =====================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n✅ شات لايف شغال على: http://localhost:${PORT}`);
  console.log(`👑 المالك الافتراضي: ${process.env.OWNER_USERNAME || 'admin'} / ${process.env.OWNER_PASSWORD ? '[من ENV]' : 'admin1234'}\n`);
});
