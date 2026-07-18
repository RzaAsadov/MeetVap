import { Conversation, ConversationMember, Message, MessageStatus, Prisma } from '@prisma/client';

import { isUserCurrentlyOnline } from './socket';
import { isMeetVapSystemUsername } from './systemAccount';
import { AuthUser } from './types';
import { isConversationMembershipMuted } from './conversationMute';

type ConversationWithMembers = Conversation & {
  members: Array<ConversationMember & { user: AuthUser }>;
  messages: Array<Pick<Message, 'body' | 'createdAt' | 'id' | 'kind' | 'senderId' | 'status'> & {
    receipts?: Array<Pick<Prisma.MessageReceiptUncheckedCreateInput, 'status' | 'userId'>>;
  }>;
};

type MessageWithMedia = Prisma.MessageGetPayload<{
  include: {
    media: true;
    sender: {
      select: {
        avatarUrl: true;
        displayName: true;
        id: true;
        username: true;
      };
    };
  };
}>;

export function serializeUser(user: AuthUser, options?: { revealNickname?: boolean }) {
  return {
    avatarUrl: user.avatarUrl,
    displayName: user.displayName,
    hideFromSearch: user.hideFromSearch === true,
    hideNickname: user.hideNickname !== false,
    hasPremiumAccess: user.hasPremiumAccess === true,
    id: user.id,
    isSystem: isMeetVapSystemUsername(user.username),
    isOnline: user.showLastSeen === false ? false : isUserCurrentlyOnline(user.id),
    lastSeenAt: user.showLastSeen === false ? null : user.lastSeenAt?.toISOString() ?? null,
    onlyContactsCanCall: user.onlyContactsCanCall === true,
    preventPeerScreenshots: user.preventPeerScreenshots !== false,
    publicShareCode: user.publicShareCode ?? null,
    showLastSeen: user.showLastSeen !== false,
    useGroupAliases: user.useGroupAliases === true,
    username: options?.revealNickname === true || user.hideNickname === false ? user.username : '',
  };
}

function isPendingGroupMember(conversation: ConversationWithMembers, member?: ConversationMember) {
  return !!member && conversation.type === 'GROUP' && conversation.ownerId !== member.userId && member.aliasPromptSeen === false;
}

function serializeConversationUser(member: ConversationMember & { user: AuthUser }, options?: { isGroup?: boolean; isPending?: boolean }) {
  const user = serializeUser({
    ...member.user,
    displayName: member.aliasName?.trim() || member.user.displayName,
  });

  return {
    ...user,
    groupAliasName: member.aliasName,
    groupInvitePending: options?.isPending === true,
    groupAliasPromptSeen: member.aliasPromptSeen,
    username: options?.isGroup && member.user.hideFromSearch === true ? '' : user.username,
  };
}

export function serializeConversation(
  conversation: ConversationWithMembers,
  currentUserId: string,
  unreadCount = 0,
  searchSnippet?: string,
  options?: { isContact?: boolean; otherUserId?: string },
) {
  const otherMembers = conversation.members.filter((member) => member.userId !== currentUserId);
  const isSystem = otherMembers.some((member) => isMeetVapSystemUsername(member.user.username));
  const title = conversation.title ?? otherMembers.map((member) => member.user.displayName).join(', ');
  const avatarUrl = conversation.type === 'DIRECT' ? otherMembers[0]?.user.avatarUrl : conversation.avatarUrl;
  const lastMessage = getConversationListLastMessage(conversation);
  const currentMembership = conversation.members.find((member) => member.userId === currentUserId);
  const isCurrentUserPendingInvite = isPendingGroupMember(conversation, currentMembership);
  const canSeeMembers = conversation.type !== 'GROUP' || !conversation.hideMembers || conversation.ownerId === currentUserId || currentMembership?.isAdmin === true;
  const canSeePendingMembers = conversation.type === 'GROUP' && (conversation.ownerId === currentUserId || currentMembership?.isAdmin === true);
  const visibleMembers = canSeeMembers
    ? conversation.members.filter((member) => canSeePendingMembers || !isPendingGroupMember(conversation, member))
    : [];
  const adminIds = conversation.members
    .filter((member) => member.isAdmin || member.userId === conversation.ownerId)
    .map((member) => member.userId);
  const visibleLastMessage = isCurrentUserPendingInvite ? undefined : lastMessage;
  const lastMessageStatus = visibleLastMessage
    ? getConversationMessageStatusForViewer(visibleLastMessage, currentUserId, conversation.members)
    : undefined;

  return {
    adminIds,
    avatarUrl,
    hideMembers: conversation.hideMembers,
    disappearingMessagesDurationMinutes: conversation.disappearingMessagesDurationMinutes,
    disappearingMessagesExpiredAt: conversation.disappearingMessagesExpiredAt?.toISOString() ?? null,
    disappearingMessagesSetById: conversation.disappearingMessagesSetById,
    id: conversation.id,
    isSystem,
    isMuted: isConversationMembershipMuted(currentMembership),
    mutedUntil: currentMembership?.mutedUntil?.toISOString() ?? null,
    isVoiceRoom: (conversation as Conversation & { isVoiceRoom?: boolean }).isVoiceRoom === true,
    lastMessage: formatLastMessage(visibleLastMessage),
    lastMessageAt: visibleLastMessage?.createdAt?.toISOString() ?? conversation.updatedAt.toISOString(),
    lastMessageId: visibleLastMessage?.id === 'conversation-preview' ? undefined : visibleLastMessage?.id,
    lastMessageKind: visibleLastMessage?.kind,
    lastMessageSenderId: visibleLastMessage?.senderId,
    lastMessageStatus,
    memberCount: visibleMembers.length,
    members: visibleMembers.map((member) => serializeConversationUser(member, {
      isGroup: conversation.type === 'GROUP',
      isPending: isPendingGroupMember(conversation, member),
    })),
    myGroupAliasName: currentMembership?.aliasName ?? null,
    myGroupInvitePending: isCurrentUserPendingInvite,
    myGroupAliasPromptSeen: currentMembership?.aliasPromptSeen ?? false,
    isContact: isSystem || options?.isContact === true,
    isPublic: (conversation as Conversation & { isPublic?: boolean }).isPublic === true,
    otherUserId: options?.otherUserId,
    ownerId: conversation.ownerId,
    ownerOnlyMessages: conversation.ownerOnlyMessages,
    preventMediaSave: (conversation as Conversation & { preventMediaSave?: boolean }).preventMediaSave === true,
    preventScreenshots: (conversation as Conversation & { preventScreenshots?: boolean }).preventScreenshots === true,
    publicInviteCode: (conversation as Conversation & { publicInviteCode?: string | null }).publicInviteCode ?? null,
    searchSnippet,
    showAdmins: conversation.showAdmins,
    showMemberCount: (conversation as Conversation & { showMemberCount?: boolean }).showMemberCount !== false,
    title,
    type: conversation.type,
    unreadCount: isCurrentUserPendingInvite ? 1 : unreadCount,
  };
}

export function serializeMessage(message: MessageWithMedia, statusOverride?: MessageStatus, senderAliasName?: string | null) {
  return {
    body: message.body,
    conversationId: message.conversationId,
    createdAt: message.createdAt.toISOString(),
    id: message.id,
    kind: message.kind,
    media: message.media
      ? {
          durationSec: message.media.durationSec,
          id: message.media.id,
          mimeType: message.media.mimeType,
          originalName: message.media.originalName,
          sizeBytes: message.media.sizeBytes,
          storageKey: message.media.storageKey,
        }
      : null,
    mediaId: message.mediaId,
    metadata: sanitizeMessageMetadata(message.metadata),
    sender: serializeUser({
      ...message.sender,
      displayName: senderAliasName?.trim() || message.sender.displayName,
    }),
    senderId: message.senderId,
    status: statusOverride ?? message.status,
    updatedAt: message.updatedAt.toISOString(),
  };
}

function sanitizeMessageMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }

  if ((metadata as { source?: unknown }).source !== 'support_admin') {
    return metadata;
  }

  const sanitized = { ...metadata } as Record<string, Prisma.JsonValue | undefined>;
  delete sanitized.adminBody;
  delete sanitized.adminUsername;

  return sanitized;
}

function getStoredConversationPreview(conversation: Conversation) {
  if (!conversation.lastMessageAt || !conversation.lastMessageKind || !conversation.lastMessageSenderId) {
    return undefined;
  }

  return {
    body: conversation.lastMessageBody ?? '',
    createdAt: conversation.lastMessageAt,
    id: 'conversation-preview',
    kind: conversation.lastMessageKind,
    receipts: [],
    senderId: conversation.lastMessageSenderId,
    status: conversation.lastMessageStatus ?? 'SENT',
  };
}

function getConversationListLastMessage(conversation: ConversationWithMembers) {
  const includedMessage = conversation.messages[0];
  const storedPreview = getStoredConversationPreview(conversation);

  if (!includedMessage) {
    return storedPreview;
  }

  if (!storedPreview) {
    return includedMessage;
  }

  return storedPreview.createdAt.getTime() > includedMessage.createdAt.getTime()
    ? storedPreview
    : includedMessage;
}

function formatLastMessage(message?: Pick<Message, 'body' | 'kind'>) {
  if (!message) {
    return '';
  }

  if (message.kind === 'CALL') {
    return message.body || 'Call';
  }

  if (message.body) {
    return message.body;
  }

  if (message.kind === 'VOICE') {
    return 'Voice message';
  }

  if (message.kind === 'IMAGE') {
    return 'Photo';
  }

  if (message.kind === 'VIDEO') {
    return 'Video';
  }

  if (message.kind === 'FILE') {
    return 'File';
  }

  return '';
}

function getConversationMessageStatusForViewer(
  message: Pick<Message, 'createdAt' | 'senderId' | 'status'> & {
    receipts?: Array<{ status: MessageStatus; userId: string }>;
  },
  currentUserId: string,
  _members: Array<Pick<ConversationMember, 'lastReadAt' | 'userId'>>,
): MessageStatus {
  if (message.senderId !== currentUserId) {
    return message.status;
  }

  const otherReceipts = (message.receipts ?? []).filter((receipt) => receipt.userId !== currentUserId);

  if (otherReceipts.some((receipt) => receipt.status === 'READ')) {
    return 'READ';
  }

  if (otherReceipts.some((receipt) => receipt.status === 'DELIVERED')) {
    return 'DELIVERED';
  }

  return 'SENT';
}
