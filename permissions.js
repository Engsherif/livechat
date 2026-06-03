// ===================== نظام الصلاحيات =====================
// الأدوار بالترتيب: owner > moderator > host > vip > member > guest

const ROLE_RANK = {
  owner:     0,
  moderator: 1,
  host:      2,
  vip:       3,
  member:    4,
  guest:     5,
};

// صلاحيات كل دور
const PERMISSIONS = {
  owner: {
    // الغرف العامة
    canSendPublic:    true,
    canDeleteMsg:     true,    // حذف أي رسالة
    canMuteUsers:     true,
    canKickUsers:     true,
    canCreateRoom:    true,
    canJoinPrivateRoom: true,

    // الخاص
    canSendPrivate:   true,    // يقدر يبعت خاص لأي حد
    canReceivePrivate: true,   // أي حد يقدر يبعتله

    // إدارة
    canManageRoles:   true,
    canBanUsers:      true,
    canBroadcast:     true,
  },

  moderator: {
    canSendPublic:    true,
    canDeleteMsg:     true,    // حذف رسائل member وguest فقط
    canMuteUsers:     true,    // كتم member وguest
    canKickUsers:     true,    // طرد member وguest
    canCreateRoom:    true,
    canJoinPrivateRoom: true,

    canSendPrivate:   true,
    canReceivePrivate: true,

    canManageRoles:   false,
    canBanUsers:      false,
    canBroadcast:     false,
  },

  host: {
    canSendPublic:    true,
    canDeleteMsg:     false,
    canMuteUsers:     true,    // كتم member وguest فقط
    canKickUsers:     false,
    canCreateRoom:    true,
    canJoinPrivateRoom: true,

    canSendPrivate:   true,
    canReceivePrivate: true,

    canManageRoles:   false,
    canBanUsers:      false,
    canBroadcast:     false,
  },

  vip: {
    canSendPublic:    true,
    canDeleteMsg:     false,
    canMuteUsers:     false,
    canKickUsers:     false,
    canCreateRoom:    true,
    canJoinPrivateRoom: true,

    canSendPrivate:   true,
    canReceivePrivate: true,   // أي حد يقدر يبعتله

    canManageRoles:   false,
    canBanUsers:      false,
    canBroadcast:     false,
  },

  member: {
    canSendPublic:    true,
    canDeleteMsg:     false,
    canMuteUsers:     false,
    canKickUsers:     false,
    canCreateRoom:    false,   // member ما يعملش غرفة
    canJoinPrivateRoom: true,

    canSendPrivate:   true,    // يبعت خاص لـ vip فأعلى فقط
    canReceivePrivate: true,   // يستقبل من member فأعلى

    canManageRoles:   false,
    canBanUsers:      false,
    canBroadcast:     false,
  },

  guest: {
    canSendPublic:    true,    // يقدر يبعت في العام
    canDeleteMsg:     false,
    canMuteUsers:     false,
    canKickUsers:     false,
    canCreateRoom:    false,   // guest ما يعملش غرفة
    canJoinPrivateRoom: false, // guest ما يدخلش غرف خاصة

    canSendPrivate:   false,   // guest ما يبعتش خاص
    canReceivePrivate: false,  // ما حدش يبعتله خاص

    canManageRoles:   false,
    canBanUsers:      false,
    canBroadcast:     false,
  },
};

// هل المستخدم يقدر يعمل إجراء على مستخدم تاني؟
// (مينفعش تكتم/تطرد حد رتبته أعلى أو زيك)
function canActOn(actorRole, targetRole) {
  return ROLE_RANK[actorRole] < ROLE_RANK[targetRole];
}

function hasPermission(role, perm) {
  return !!(PERMISSIONS[role] && PERMISSIONS[role][perm]);
}

// قواعد الخاص:
// - guest: ممنوع خالص
// - member: يبعت خاص لـ vip وفوق بس (مش member ومش guest)
// - vip وفوق: يبعت لأي حد (إلا guest)
function canSendPrivateTo(senderRole, receiverRole) {
  if (!hasPermission(senderRole, 'canSendPrivate')) return false;
  if (!hasPermission(receiverRole, 'canReceivePrivate')) return false;

  // member يبعت لـ vip وفوق بس
  if (senderRole === 'member') {
    return ROLE_RANK[receiverRole] <= ROLE_RANK['vip'];
  }
  return true;
}

module.exports = { ROLE_RANK, PERMISSIONS, hasPermission, canActOn, canSendPrivateTo };
