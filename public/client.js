// ===================== حالة التطبيق =====================
const state = {
  socket:          null,
  me:              null,   // { username, role, nameColor, isGuest }
  currentRoom:     'egypt',
  privateWith:     null,   // اسم الشخص في المحادثة الخاصة
  ownerAuth:       null,   // base64 بيانات المالك
  ownerTabActive:  'online',
};

// ===================== بدء =====================
window.addEventListener('DOMContentLoaded', () => {
  const authData = JSON.parse(sessionStorage.getItem('livechat_auth') || 'null');
  if (!authData) { window.location.replace('login.html'); return; }
  if (authData.ownerAuth) state.ownerAuth = authData.ownerAuth;
  connectSocket(authData);
});

// ===================== معلومات الجهاز =====================
function getDeviceInfo() {
  const ua = navigator.userAgent;
  return {
    userAgent: ua,
    platform:  navigator.platform,
    language:  navigator.language,
    screen:    `${screen.width}x${screen.height}`,
    timezone:  Intl.DateTimeFormat().resolvedOptions().timeZone,
    isMobile:  /Mobi|Android/i.test(ua),
    os: /Windows/i.test(ua) ? 'Windows'
      : /Mac/i.test(ua)     ? 'macOS'
      : /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad/i.test(ua) ? 'iOS'
      : /Linux/i.test(ua)   ? 'Linux' : 'Unknown',
    browser: /Chrome/i.test(ua) && !/Edg/i.test(ua) ? 'Chrome'
           : /Firefox/i.test(ua) ? 'Firefox'
           : /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Safari'
           : /Edg/i.test(ua) ? 'Edge' : 'Other',
  };
}

function getFingerprint(info) {
  const str = JSON.stringify(info);
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(16).padStart(8, '0');
}

// ===================== اتصال Socket =====================
function connectSocket(joinPayload) {
  state.socket = io();

  state.socket.on('auth_error', (err) => {
    sessionStorage.removeItem('livechat_auth');
    window.location.replace('login.html?error=' + encodeURIComponent(err));
  });

  state.socket.on('joined', (data) => {
    state.me = data.user;
    state.currentRoom = 'egypt';
    showChatScreen(data);
  });

  state.socket.on('message',         (msg)  => appendMessage(msg));
  state.socket.on('members_update',  (list) => renderMembers(list));
  state.socket.on('rooms_update',    (list) => renderRooms(list));

  state.socket.on('message_deleted', ({ msgId }) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) el.remove();
  });

  state.socket.on('room_changed', (data) => {
    state.currentRoom = data.roomId;
    document.getElementById('room-name-header').textContent = data.roomName;
    document.getElementById('messages-area').innerHTML = '';
    data.messages.forEach(m => appendMessage(m));
    renderMembers(data.members);
    scrollBottom();
  });

  state.socket.on('private_message', (msg) => {
    if (state.privateWith === msg.from || state.privateWith === msg.to) {
      appendPrivateMessage(msg);
    } else if (msg.from !== state.me.username) {
      showAnno(`💬 رسالة خاصة من ${msg.from}`);
    }
  });

  state.socket.on('announcement', (data) => showAnno(`📢 ${data.text}`));

  state.socket.on('kicked', (data) => {
    alert(data.reason || 'تم طردك');
    logout();
  });

  state.socket.on('you_muted', () => {
    document.getElementById('muted-icon').style.display = 'inline';
    const inp = document.getElementById('msg-input');
    inp.disabled    = true;
    inp.placeholder = 'أنت مكتوم 🔇';
  });

  state.socket.on('you_unmuted', () => {
    document.getElementById('muted-icon').style.display = 'none';
    const inp = document.getElementById('msg-input');
    inp.disabled    = false;
    inp.placeholder = 'اكتب رسالة...';
  });

  state.socket.on('your_role_updated', ({ role }) => {
    state.me.role = role;
    updateMyBadge();
    // إظهار/إخفاء زر لوحة التحكم
    document.getElementById('owner-panel-btn').style.display =
      role === 'owner' ? 'inline' : 'none';
  });

  state.socket.on('your_color_updated', ({ color }) => {
    state.me.nameColor = color;
    updateMyBadge();
  });

  state.socket.on('room_created', ({ roomId }) => {
    state.socket.emit('change_room', roomId);
  });

  state.socket.on('perm_error', ({ msg }) => {
    showAnno(msg || '❌ غير مسموح');
  });

  state.socket.on('full_reset', () => {
    document.getElementById('messages-area').innerHTML = '';
    showAnno('🔄 تم إعادة ضبط الشات');
  });

  state.socket.on('connect', () => {
    const info = getDeviceInfo();
    state.socket.emit('join', {
      ...joinPayload,
      fingerprint: getFingerprint(info),
      deviceInfo:  info,
    });
  });

  state.socket.on('connect_error', () => {
    sessionStorage.removeItem('livechat_auth');
    window.location.replace('login.html?error=' + encodeURIComponent('تعذّر الاتصال بالخادم'));
  });
}

// ===================== عرض الشات =====================
function showChatScreen(data) {
  document.getElementById('chat-screen').style.display = 'flex';
  updateMyBadge();

  if (state.me.role === 'owner') {
    document.getElementById('owner-panel-btn').style.display = 'inline';
  }

  const area = document.getElementById('messages-area');
  area.innerHTML = '';
  data.messages.forEach(m => appendMessage(m));
  renderMembers(data.members);
  renderRooms(data.rooms);
  scrollBottom();

  document.getElementById('msg-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) sendMessage();
  });
}

function updateMyBadge() {
  const nameEl  = document.getElementById('my-name');
  const badgeEl = document.getElementById('my-badge');
  nameEl.textContent  = state.me.username;
  nameEl.style.color  = state.me.nameColor || '';
  badgeEl.className   = 'badge';
  const b = roleBadge(state.me.role);
  if (b) {
    badgeEl.textContent = b;
    badgeEl.classList.add(`badge-${state.me.role}`);
  } else {
    badgeEl.textContent = '';
  }
}

// ===================== رسائل =====================
function appendMessage(msg) {
  const area = document.getElementById('messages-area');
  if (!area) return;

  if (msg.type === 'system') {
    const el = document.createElement('div');
    el.className   = 'msg-system';
    el.textContent = msg.text;
    area.appendChild(el);
  } else {
    const isOwn = msg.username === state.me?.username;
    const el    = document.createElement('div');
    el.className = `msg ${isOwn ? 'own' : 'other'}`;
    el.id        = `msg-${msg.id}`;

    const badge     = roleBadge(msg.role);
    const colorAttr = msg.nameColor ? `style="color:${msg.nameColor}"` : '';
    const canDelete = ['owner', 'moderator'].includes(state.me?.role);

    el.innerHTML = `
      <div class="msg-meta">
        ${badge ? `<span class="badge badge-${msg.role}">${badge}</span>` : ''}
        <span class="msg-name" ${colorAttr}>${escHtml(msg.username)}</span>
        ${canDelete ? `<button class="msg-delete-btn" onclick="deleteMsg('${msg.id}')" title="حذف">🗑️</button>` : ''}
      </div>
      <div class="msg-bubble">${escHtml(msg.text)}</div>
      <div class="msg-time">${formatTime(msg.time)}</div>
    `;
    area.appendChild(el);
  }
  scrollBottom();
}

function appendPrivateMessage(msg) {
  const area  = document.getElementById('messages-area');
  const isOwn = msg.from === state.me.username;
  const el    = document.createElement('div');
  el.className = `msg ${isOwn ? 'own' : 'other'}`;
  el.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${escHtml(isOwn ? 'أنت' : msg.from)}</span>
    </div>
    <div class="msg-bubble" style="border: 1.5px dashed #4f8ef7">${escHtml(msg.text)}</div>
    <div class="msg-time">${formatTime(msg.time)}</div>
  `;
  area.appendChild(el);
  scrollBottom();
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  if (!text) return;

  if (state.privateWith) {
    state.socket.emit('private_message', { to: state.privateWith, text });
  } else {
    state.socket.emit('send_message', { text });
  }
  input.value = '';
}

function deleteMsg(msgId) {
  state.socket.emit('delete_message', { msgId });
}

// ===================== الأعضاء =====================
function renderMembers(members) {
  const list  = document.getElementById('members-list');
  const count = document.getElementById('members-count');
  if (!list) return;
  count.textContent = members.length;

  list.innerHTML = members.map(m => {
    const badge     = roleBadge(m.role);
    const colorAttr = m.nameColor ? `style="color:${m.nameColor}"` : '';
    const dotClass  = m.muted ? 'member-dot muted' : 'member-dot';
    return `<div class="member-item" onclick="openMemberModal('${escAttr(m.username)}','${m.role}','${m.muted}')">
      <div class="${dotClass}" title="${m.muted ? 'مكتوم' : 'أونلاين'}"></div>
      <span class="member-name" ${colorAttr}>${escHtml(m.username)}</span>
      ${badge ? `<span class="member-badge">${badge}</span>` : ''}
    </div>`;
  }).join('');
}

// ===================== الغرف =====================
function toggleRoomsPanel() {
  document.getElementById('rooms-panel').classList.toggle('hidden');
}

function renderRooms(rooms) {
  const list = document.getElementById('rooms-list');
  if (!list) return;
  list.innerHTML = rooms.map(r => `
    <div class="room-item ${r.id === state.currentRoom ? 'active' : ''}" onclick="changeRoom('${r.id}')">
      <span>${r.isPrivate ? '🔒 ' : ''}${escHtml(r.name)}</span>
      <span class="room-count">${r.count}</span>
    </div>
  `).join('');

  // إظهار/إخفاء حقل إنشاء غرفة بناءً على الصلاحية
  const createSection = document.getElementById('create-room-section');
  if (createSection) {
    createSection.style.display = canCreateRoomClient(state.me?.role) ? '' : 'none';
  }
}

function changeRoom(roomId) {
  if (roomId === state.currentRoom) return;
  closePrivate();
  state.socket.emit('change_room', roomId);
  document.getElementById('rooms-panel').classList.add('hidden');
}

function createRoom() {
  const name = document.getElementById('new-room-name').value.trim();
  if (!name) return;
  state.socket.emit('create_room', { name });
  document.getElementById('new-room-name').value = '';
}

// ===================== الخاص =====================
function openPrivate(username) {
  state.privateWith = username;
  document.getElementById('private-indicator').style.display = 'flex';
  document.getElementById('private-with').textContent = username;
  document.getElementById('messages-area').innerHTML = '';
  document.getElementById('msg-input').placeholder   = `رسالة لـ ${username}...`;
  closeMemberModal();
}

function closePrivate() {
  state.privateWith = null;
  document.getElementById('private-indicator').style.display = 'none';
  document.getElementById('msg-input').placeholder = 'اكتب رسالة...';
  document.getElementById('messages-area').innerHTML = '';
}

// ===================== مودال العضو =====================
function openMemberModal(username, role, muted) {
  if (username === state.me.username) return;
  document.getElementById('member-modal-name').textContent = username;
  const actions = document.getElementById('member-modal-actions');
  const isMuted = muted === 'true' || muted === true;
  const myRole  = state.me.role;

  // ترتيب الأدوار للمقارنة
  const RANK = { owner:0, moderator:1, host:2, vip:3, member:4, guest:5 };
  const canActOnTarget = RANK[myRole] < RANK[role];

  let html = '';

  // زر الخاص — بناءً على صلاحيات الإرسال
  const privateAllowed = canSendPrivateClient(myRole, role);
  if (privateAllowed && username !== state.me.username) {
    html += `<button style="background:#e8f4ff;color:#2c6ce4" onclick="openPrivate('${escAttr(username)}')">💬 رسالة خاصة</button>`;
  }

  // كتم / رفع كتم
  if (canMuteClient(myRole) && canActOnTarget) {
    if (isMuted) {
      html += `<button style="background:#f0fff4;color:#27ae60" onclick="unmuteUser('${escAttr(username)}')">🔊 رفع الكتم</button>`;
    } else {
      html += `<button style="background:#fff3e0;color:#e67e22" onclick="muteUser('${escAttr(username)}')">🔇 كتم</button>`;
    }
  }

  // طرد
  if (canKickClient(myRole) && canActOnTarget) {
    html += `<button style="background:#ffeaea;color:#e74c3c" onclick="kickUser('${escAttr(username)}')">👢 طرد</button>`;
  }

  if (!html) html = '<span style="color:#aaa;font-size:0.85rem">لا توجد إجراءات متاحة</span>';

  actions.innerHTML = html;
  document.getElementById('member-modal').classList.remove('hidden');
}

// ===== دوال فحص الصلاحيات (Client-side للـ UI فقط) =====
function canSendPrivateClient(myRole, targetRole) {
  const RANK = { owner:0, moderator:1, host:2, vip:3, member:4, guest:5 };
  if (myRole === 'guest') return false;
  if (targetRole === 'guest') return false;
  if (myRole === 'member') return RANK[targetRole] <= RANK['vip'];
  return true;
}
function canMuteClient(role)  { return ['owner','moderator','host'].includes(role); }
function canKickClient(role)  { return ['owner','moderator'].includes(role); }
function canCreateRoomClient(role) { return ['owner','moderator','host','vip'].includes(role); }


function closeMemberModal() {
  document.getElementById('member-modal').classList.add('hidden');
}

function muteUser(username) {
  state.socket.emit('mute_user', { username });
  closeMemberModal();
}
function unmuteUser(username) {
  state.socket.emit('unmute_user', { username });
  closeMemberModal();
}
function kickUser(username) {
  const reason = prompt('سبب الطرد (اختياري):') || '';
  state.socket.emit('kick_user', { username, reason });
  closeMemberModal();
}

// ===================== لوحة تحكم المالك =====================
function openOwnerPanel() {
  document.getElementById('owner-panel').classList.remove('hidden');
  loadOwnerTab('online');
}
function closeOwnerPanel() {
  document.getElementById('owner-panel').classList.add('hidden');
}

function ownerTab(tab, btn) {
  state.ownerTabActive = tab;
  document.querySelectorAll('.otab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadOwnerTab(tab);
}

function loadOwnerTab(tab) {
  const content = document.getElementById('owner-content');

  if (tab === 'online') {
    ownerFetch('/api/owner/online').then(r => {
      if (!r.ok) return;
      content.innerHTML = `
        <table class="owner-table">
          <tr><th>الاسم</th><th>الدور</th><th>الغرفة</th><th>الجهاز</th><th>OS</th><th>Fingerprint</th></tr>
          ${r.users.map(u => `<tr>
            <td><b>${escHtml(u.username)}</b>${u.isGuest ? ' <span style="color:#aaa;font-size:0.75rem">(زائر)</span>' : ''}</td>
            <td>${roleBadge(u.role) || u.role}</td>
            <td>${escHtml(u.room || '')}</td>
            <td>${u.deviceInfo?.browser || '?'} / ${u.deviceInfo?.isMobile ? '📱' : '🖥️'}</td>
            <td>${u.deviceInfo?.os || '?'}</td>
            <td style="font-size:0.72rem;color:#aaa">${u.fingerprint || ''}</td>
          </tr>`).join('')}
        </table>`;
    });
  }

  else if (tab === 'users') {
    ownerFetch('/api/owner/users').then(r => {
      if (!r.ok) return;
      content.innerHTML = `
        <table class="owner-table">
          <tr><th>الاسم</th><th>الدور</th><th>لون الاسم</th><th>إجراءات</th></tr>
          ${r.users.map(u => `<tr>
            <td><span style="color:${u.nameColor || 'inherit'}">${escHtml(u.username)}</span>${u.banned ? ' 🚫' : ''}</td>
            <td>${u.role}</td>
            <td>
              <input type="color" value="${u.nameColor || '#222222'}"
                onchange="ownerSetColor('${escAttr(u.username)}', this.value)"
                style="border:none;width:32px;height:24px;cursor:pointer;border-radius:4px">
            </td>
            <td style="display:flex;gap:4px;flex-wrap:wrap">
              <button class="btn-xs blue"   onclick="ownerSetRole('${escAttr(u.username)}','moderator')">⭐ مشرف</button>
              <button class="btn-xs purple" onclick="ownerSetRole('${escAttr(u.username)}','host')">🎖️ هوست</button>
              <button class="btn-xs gold"   onclick="ownerSetRole('${escAttr(u.username)}','vip')">✨ VIP</button>
              <button class="btn-xs gray"   onclick="ownerSetRole('${escAttr(u.username)}','member')">عادي</button>
              ${u.banned
                ? `<button class="btn-xs green" onclick="ownerUnban('${escAttr(u.username)}')">✅ رفع حظر</button>`
                : `<button class="btn-xs red"   onclick="ownerBan('${escAttr(u.username)}')">🚫 حظر</button>`
              }
            </td>
          </tr>`).join('')}
        </table>`;
    });
  }

  else if (tab === 'private') {
    content.innerHTML = `
      <div style="display:flex;height:460px;gap:0;border:1px solid var(--border);border-radius:12px;overflow:hidden">

        <!-- قائمة المحادثات -->
        <div style="width:200px;min-width:160px;border-left:1px solid var(--border);display:flex;flex-direction:column;background:var(--bg)">
          <div style="padding:10px 10px 6px;font-weight:700;font-size:0.82rem;color:#888;letter-spacing:0.04em;border-bottom:1px solid var(--border)">
            💬 المحادثات الخاصة
          </div>
          <input id="pm-search" type="text" placeholder="🔍 بحث..." oninput="filterPrivateList()"
            style="margin:8px;padding:6px 10px;border:1px solid var(--border);border-radius:8px;font-size:0.82rem;outline:none;background:#fff">
          <div id="pm-list" style="overflow-y:auto;flex:1;padding:4px 0"></div>
          <div style="padding:8px;border-top:1px solid var(--border)">
            <button onclick="loadOwnerTab('private')"
              style="width:100%;padding:5px;font-size:0.75rem;border:none;border-radius:7px;background:#f0f4ff;color:#4f8ef7;cursor:pointer">
              🔄 تحديث
            </button>
          </div>
        </div>

        <!-- منطقة المحادثة -->
        <div style="flex:1;display:flex;flex-direction:column;background:#fff">
          <div id="pm-header" style="padding:12px 16px;font-weight:700;font-size:0.9rem;color:#4f8ef7;border-bottom:1px solid var(--border);background:var(--bg);display:flex;align-items:center;gap:8px">
            <span>اختر محادثة من القائمة</span>
          </div>
          <div id="pm-messages" style="flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:8px">
            <div style="margin:auto;text-align:center;color:#ccc;font-size:2rem;padding-top:40px">💬</div>
          </div>
        </div>

      </div>`;

    // جلب البيانات وتخزينها
    ownerFetch('/api/owner/private-chats').then(r => {
      if (!r.ok) return;
      window._pmChats = r.chats;
      renderPrivateList(r.chats);
    });
  }

  else if (tab === 'broadcast') {
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0">
        <label style="font-weight:600;font-size:0.9rem">إعلان للجميع</label>
        <textarea id="bc-text" rows="4" class="input" placeholder="اكتب الإعلان هنا..."></textarea>
        <button class="btn-primary" onclick="doBroadcast()">📢 إرسال للجميع</button>
      </div>`;
  }

  else if (tab === 'settings') {
    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:14px;padding:4px 0">
        <label style="font-weight:600;font-size:0.9rem">تغيير كلمة مرور المالك</label>
        <input id="new-owner-pass" type="password" class="input" placeholder="كلمة المرور الجديدة (6 أحرف على الأقل)">
        <button class="btn-primary" onclick="doChangeOwnerPass()">🔒 تغيير كلمة المرور</button>
        <hr style="border:none;border-top:1px solid var(--border)">
        <label style="font-weight:600;font-size:0.9rem;color:var(--danger)">منطقة الخطر</label>
        <button class="btn-primary" style="background:var(--danger)" onclick="doReset()">🔄 حذف كل الرسائل والغرف الخاصة</button>
      </div>`;
  }
}

// ===================== لوحة تحكم — المحادثات الخاصة =====================
function renderPrivateList(chats) {
  const list = document.getElementById('pm-list');
  if (!list) return;
  const keys = Object.keys(chats);
  if (!keys.length) {
    list.innerHTML = '<p style="color:#aaa;font-size:0.78rem;padding:16px;text-align:center">لا توجد محادثات</p>';
    return;
  }
  list.innerHTML = keys.map(k => {
    const msgs   = chats[k];
    const last   = msgs[msgs.length - 1];
    const users  = k.split('__');
    const label  = users.join(' ↔ ');
    const preview = last ? escHtml(last.text.slice(0, 28)) + (last.text.length > 28 ? '…' : '') : '';
    return `<div class="pm-list-item" data-key="${escAttr(k)}" onclick="openPrivateChat('${escAttr(k)}')"
      style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f0f2f5;transition:background .15s">
      <div style="font-weight:600;font-size:0.82rem;color:#222;margin-bottom:2px">${escHtml(label)}</div>
      <div style="font-size:0.74rem;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${preview}</div>
      <div style="font-size:0.7rem;color:#c0c0c0;margin-top:2px">${msgs.length} رسالة</div>
    </div>`;
  }).join('');
}

function filterPrivateList() {
  const q    = (document.getElementById('pm-search')?.value || '').toLowerCase();
  const chats = window._pmChats || {};
  const filtered = {};
  Object.keys(chats).forEach(k => {
    if (!q || k.toLowerCase().includes(q)) filtered[k] = chats[k];
  });
  renderPrivateList(filtered);
}

function openPrivateChat(key) {
  // تمييز المحادثة المختارة
  document.querySelectorAll('.pm-list-item').forEach(el => {
    el.style.background = el.dataset.key === key ? '#eef3ff' : '';
  });

  const chats = window._pmChats || {};
  const msgs  = chats[key] || [];
  const users = key.split('__');

  const header = document.getElementById('pm-header');
  const area   = document.getElementById('pm-messages');
  if (!header || !area) return;

  header.innerHTML = `
    <span style="font-size:1.1rem">💬</span>
    <span>${escHtml(users[0])}</span>
    <span style="color:#bbb;font-weight:400;font-size:0.85rem">↔</span>
    <span>${escHtml(users[1])}</span>
    <span style="margin-right:auto;font-size:0.75rem;color:#aaa;font-weight:400">${msgs.length} رسالة</span>`;

  if (!msgs.length) {
    area.innerHTML = '<p style="color:#ccc;text-align:center;padding-top:40px">لا توجد رسائل</p>';
    return;
  }

  area.innerHTML = msgs.map(m => {
    const isFirst = m.from === users[0];
    const align   = isFirst ? 'flex-end' : 'flex-start';
    const bg      = isFirst ? '#4f8ef7' : '#f0f2f5';
    const color   = isFirst ? '#fff' : '#222';
    return `<div style="display:flex;flex-direction:column;align-items:${align};max-width:80%;align-self:${align}">
      <div style="font-size:0.7rem;color:#aaa;margin-bottom:2px;padding:0 4px">${escHtml(m.from)} · ${formatTime(m.time)}</div>
      <div style="background:${bg};color:${color};padding:8px 12px;border-radius:14px;font-size:0.85rem;word-break:break-word;max-width:100%">
        ${escHtml(m.text)}
      </div>
    </div>`;
  }).join('');

  // scroll لآخر رسالة
  area.scrollTop = area.scrollHeight;
}

function ownerFetch(url) {
  return fetch(url, {
    headers: { 'x-owner-auth': state.ownerAuth }
  }).then(r => r.json());
}

function ownerPost(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-owner-auth': state.ownerAuth },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

function ownerSetRole(username, role) {
  ownerPost('/api/owner/set-role', { username, role }).then(r => {
    if (r.ok) loadOwnerTab('users');
    else alert(r.error || 'فشل');
  });
}

function ownerSetColor(username, color) {
  ownerPost('/api/owner/set-color', { username, color });
}

function ownerBan(username) {
  if (!confirm(`حظر ${username}؟`)) return;
  ownerPost('/api/owner/ban', { username }).then(r => {
    if (r.ok) loadOwnerTab('users');
  });
}

function ownerUnban(username) {
  ownerPost('/api/owner/unban', { username }).then(r => {
    if (r.ok) loadOwnerTab('users');
  });
}

function doBroadcast() {
  const text = (document.getElementById('bc-text')?.value || '').trim();
  if (!text) return;
  ownerPost('/api/owner/broadcast', { text }).then(r => {
    if (r.ok) {
      document.getElementById('bc-text').value = '';
      alert('✅ تم الإرسال');
    }
  });
}

function doChangeOwnerPass() {
  const newPassword = (document.getElementById('new-owner-pass')?.value || '').trim();
  if (!newPassword) return;
  ownerPost('/api/owner/change-password', { newPassword }).then(r => {
    if (r.ok) {
      alert('✅ تم تغيير كلمة المرور — سيُطلب منك الدخول مجدداً');
      logout();
    } else alert(r.error || 'فشل');
  });
}

function doReset() {
  if (!confirm('هتحذف كل الرسائل والغرف الخاصة؟ هذا لا يمكن التراجع عنه!')) return;
  ownerPost('/api/owner/reset', {}).then(r => {
    if (r.ok) closeOwnerPanel();
  });
}

// ===================== إعلان =====================
function showAnno(text) {
  const bar = document.getElementById('announcement-bar');
  bar.textContent = text;
  bar.classList.remove('hidden');
  clearTimeout(bar._timer);
  bar._timer = setTimeout(() => bar.classList.add('hidden'), 5000);
}

// ===================== إيموجي بيكر =====================
const EMOJI_CATS = [
  { label: '😀', name: 'وجوه', emojis: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','🥱','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','🥴','😠','😡','🤬','😷','🤒','🤕','🤢','🤮','🤧','😇','🥳','🥸','🤠','🤡','🤫','🤭','🧐','🤓'] },
  { label: '👍', name: 'أيدي', emojis: ['👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','☝️','👇','👋','🤚','🖐️','✋','🖖','👏','🙌','🤲','🤝','🙏','✍️','💪','🦾','🖕','💅','🤳'] },
  { label: '❤️', name: 'قلوب', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️','❤️‍🔥','❤️‍🩹'] },
  { label: '🎉', name: 'احتفال', emojis: ['🎉','🎊','🎈','🎁','🎀','🎗️','🎟️','🎫','🎖️','🏆','🥇','🥈','🥉','🎯','🎲','🎮','🕹️','🎰','🃏','🀄','🎴','🎭','🎨','🎪','🎠','🎡','🎢','🎶','🎵','🎤','🎧','🎸','🎹','🥁','🎷','🎺','🎻'] },
  { label: '🔥', name: 'رموز', emojis: ['🔥','💯','✨','⭐','🌟','💫','⚡','🌈','☀️','🌙','❄️','💥','🎆','🎇','🌊','💧','🌸','🌺','🌹','🌻','🌼','🍀','🌴','🌵','🍁','🍂','🍃'] },
  { label: '😸', name: 'حيوانات', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🦋','🐛','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿️','🦔'] },
  { label: '🍕', name: 'طعام', emojis: ['🍕','🍔','🌮','🌯','🥪','🥗','🍜','🍝','🍛','🍲','🥘','🍱','🍣','🍤','🍙','🍚','🍘','🍥','🧆','🧇','🥞','🧈','🍳','🥚','🧀','🥩','🍗','🍖','🌭','🥓','🥫','🍿','🧂','🥡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍷','🥂','🍸','🍹','🧋','🥤','☕','🍵','🧃','🥛','🍺','🍻','🍾'] },
  { label: '⚽', name: 'رياضة', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🎣','🤿','🎽','🎿','🛷','🥌','⛸️','🪂','🏋️','🤼','🤸','⛹️','🤺','🏇','🧘','🏄','🏊','🚴','🏆','🥇'] },
];

let _emojiCatIdx = 0;

function initEmojiPicker() {
  const catsEl = document.getElementById('emoji-cats');
  if (!catsEl || catsEl.children.length) return; // مبنيش تاني
  EMOJI_CATS.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.textContent = cat.label;
    btn.title = cat.name;
    btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:1.15rem;padding:3px 5px;border-radius:7px;flex-shrink:0;transition:background .15s';
    btn.onclick = () => { _emojiCatIdx = i; renderEmojiGrid(i); highlightCat(i); };
    catsEl.appendChild(btn);
  });
  renderEmojiGrid(0);
  highlightCat(0);
}

function highlightCat(idx) {
  const catsEl = document.getElementById('emoji-cats');
  if (!catsEl) return;
  [...catsEl.children].forEach((b, i) => {
    b.style.background = i === idx ? '#eef3ff' : 'none';
  });
}

function renderEmojiGrid(idx) {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = EMOJI_CATS[idx].emojis.map(e =>
    `<button onclick="insertEmoji('${e}')" style="background:none;border:none;cursor:pointer;font-size:1.3rem;padding:4px;border-radius:7px;transition:background .12s" onmouseover="this.style.background='#f0f2f5'" onmouseout="this.style.background='none'">${e}</button>`
  ).join('');
}

function insertEmoji(emoji) {
  const inp = document.getElementById('msg-input');
  if (!inp) return;
  const start = inp.selectionStart;
  const end   = inp.selectionEnd;
  inp.value   = inp.value.slice(0, start) + emoji + inp.value.slice(end);
  inp.selectionStart = inp.selectionEnd = start + emoji.length;
  inp.focus();
}

function toggleEmojiPicker(e) {
  e.stopPropagation();
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  const isHidden = picker.style.display === 'none';
  picker.style.display = isHidden ? 'block' : 'none';
  if (isHidden) initEmojiPicker();
}

// إغلاق البيكر بالضغط خارجه
document.addEventListener('click', (e) => {
  const picker = document.getElementById('emoji-picker');
  if (picker && !picker.contains(e.target) && e.target.id !== 'emoji-picker') {
    picker.style.display = 'none';
  }
});


function logout() {
  if (state.socket) state.socket.disconnect();
  state.me = null; state.socket = null; state.ownerAuth = null;
  sessionStorage.removeItem('livechat_auth');
  window.location.replace('login.html');
}

// ===================== مساعدات =====================
function roleBadge(role) {
  if (role === 'owner')     return '👑';
  if (role === 'moderator') return '⭐';
  if (role === 'host')      return '🎖️';
  if (role === 'vip')       return '✨';
  return '';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function scrollBottom() {
  const a = document.getElementById('messages-area');
  if (a) a.scrollTop = a.scrollHeight;
}
