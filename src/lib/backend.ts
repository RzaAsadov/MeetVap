import { ApiError, apiRequest } from './api';
import * as FileSystem from 'expo-file-system/legacy';
import { assertAttachmentsWithinPolicy } from './serverPolicy';
import { Platform } from 'react-native';

import { getDeviceLanguage, t, type AppLanguage } from '../i18n';
import type { ConversationListFilter } from './conversationList';
import { AuthUser, Conversation, LiveLocation, Message, MessageKind, SubscriptionStatus, VoiceRoomParticipant } from '../types/domain';
import { getAuthToken } from './storage';
import type { ConversationMuteDurationMinutes } from './conversationMute';
import type { DisappearingMessagesDurationMinutes } from './disappearingMessages';
import { getClientRequestHeaders, initializeClientInstallationId } from './appClientInfo';
import { formatConversationActivityTime } from './format';

const CHUNK_UPLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
const LEGACY_CHUNK_SIZE_BYTES = 1024 * 1024;
const MAX_CLIENT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
export const CURRENT_TERMS_VERSION = '2026-05-30';

type BackendAuthResponse = {
  token: string;
  user: AuthUser;
};

type BackendConversation = {
  adminIds?: string[];
  avatarUrl?: string | null;
  disappearingMessagesDurationMinutes?: number | null;
  disappearingMessagesExpiredAt?: string | null;
  disappearingMessagesSetById?: string | null;
  hideMembers?: boolean;
  id: string;
  isContact?: boolean;
  isMuted?: boolean;
  mutedUntil?: string | null;
  isSystem?: boolean;
  isPublic?: boolean;
  isVoiceRoom?: boolean;
  memberCount?: number;
  title: string;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageAtIso?: string;
  lastMessageId?: string | null;
  members?: AuthUser[];
  myGroupInvitePending?: boolean;
  myGroupAliasName?: string | null;
  myGroupAliasPromptSeen?: boolean;
  otherUserId?: string | null;
  ownerId?: string | null;
  ownerOnlyMessages?: boolean;
  preventMediaSave?: boolean;
  preventScreenshots?: boolean;
  publicInviteCode?: string | null;
  lastMessageKind?: string | null;
  lastMessageSenderId?: string | null;
  lastMessageStatus?: string | null;
  searchSnippet?: string | null;
  showAdmins?: boolean;
  showMemberCount?: boolean;
  type?: 'DIRECT' | 'GROUP';
  unreadCount: number;
};

type BackendMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  kind?: string | null;
  body?: string | null;
  createdAt?: string | null;
  status?: string | null;
  media?: {
    durationSec?: number | null;
    id?: string | null;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    storageKey: string;
  } | null;
  mediaId?: string | null;
  metadata?: Message['metadata'] | null;
  sender?: AuthUser;
};

export type BackendPinnedMessage = {
  message: BackendMessage;
  pinnedAt: string;
  scope: 'all' | 'me';
};

export type PinnedMessage = {
  message: Message;
  pinnedAt: string;
  scope: 'all' | 'me';
};

export type MessageEdit = {
  body: string;
  conversationId: string;
  createdAt?: string;
  messageId?: string | null;
  messageKey: string;
  metadata?: Message['metadata'] | null;
  requestedById?: string | null;
  updatedAt?: string;
};

export type MessageStatusUpdate = {
  conversationId: string;
  deliveredAt?: string | null;
  messageId?: string | null;
  messageKey: string;
  readAt?: string | null;
  status: 'DELIVERED' | 'READ';
  updatedAt?: string;
};

export type MessageReactionUpdate = {
  conversationId: string;
  emoji: string | null;
  messageId: string;
  reactions?: Record<string, string>;
  userId: string;
};

export type ScheduledMessage = {
  body: string;
  cancelledAt?: string | null;
  clientTimezone?: string | null;
  conversationId: string;
  createdAt: string;
  failureReason?: string | null;
  id: string;
  kind: string;
  mediaId?: string | null;
  metadata?: Message['metadata'] | null;
  processedAt?: string | null;
  sendAt: string;
  sentMessageId?: string | null;
  senderId: string;
  status: string;
};

export type StatusKind = 'TEXT' | 'IMAGE' | 'VIDEO';
export type StatusAudience = 'CONTACTS' | 'CONTACTS_EXCEPT' | 'ONLY_SHARE_WITH';

export type StatusUpdate = {
  audience: StatusAudience;
  authorId: string;
  backgroundColor?: string | null;
  body: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  kind: StatusKind;
  media?: {
    durationSec?: number | null;
    id: string;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  } | null;
  mediaId?: string | null;
  mediaUri?: string;
  viewedByMe: boolean;
  viewerCount?: number;
};

export type StatusGroup = {
  author: AuthUser;
  hasUnviewed: boolean;
  latestAt: string;
  statuses: StatusUpdate[];
};

export type StatusViewer = {
  user: AuthUser;
  viewedAt: string;
};

export type MessageDeletionUpdate = {
  createdAt?: string;
  messageId?: string | null;
  messageKey?: string | null;
  mode?: string;
  requestedById?: string | null;
};

export type AttestationChallengeResponse = {
  challenge: string;
  challengeId: string;
  expiresAt: string;
  mode: 'observe' | 'soft' | 'enforce';
  provider: 'play-integrity' | 'app-attest';
};

export type AttestationSubmitResponse = {
  ok: true;
  status: 'TRUSTED' | 'UNTRUSTED' | 'PENDING' | 'FAILED';
};

export async function register(serverUrl: string, input: { displayName: string; username: string; password: string }) {
  const response = await apiRequest<BackendAuthResponse>('/auth/register', {
    body: JSON.stringify({
      ...input,
      locale: getDeviceLanguage(),
      platform: Platform.OS,
      termsAccepted: true,
      termsVersion: CURRENT_TERMS_VERSION,
    }),
    method: 'POST',
    serverUrl,
  });

  return { ...response, user: mapUser(response.user, serverUrl) };
}

export async function checkUsernameAvailability(serverUrl: string, username: string) {
  return apiRequest<{ available: boolean; username: string }>(`/auth/username-availability?username=${encodeURIComponent(username)}`, {
    method: 'GET',
    serverUrl,
  });
}

export async function login(serverUrl: string, input: { username: string; password: string }) {
  const response = await apiRequest<BackendAuthResponse>('/auth/login', {
    body: JSON.stringify({
      ...input,
      locale: getDeviceLanguage(),
      platform: Platform.OS,
      termsAccepted: true,
      termsVersion: CURRENT_TERMS_VERSION,
    }),
    method: 'POST',
    serverUrl,
  });

  return { ...response, user: mapUser(response.user, serverUrl) };
}

export async function getWebDevices(serverUrl: string) {
  return apiRequest<{
    enabled: boolean;
    webSession: {
      createdAt: string;
      expiresAt: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    } | null;
  }>('/web/devices', {
    method: 'GET',
    serverUrl,
  });
}

export async function logoutWebDevices(serverUrl: string) {
  await apiRequest<{ ok: true }>('/web/devices/logout', {
    method: 'POST',
    serverUrl,
  });
}

export async function approveWebPairing(serverUrl: string, input: { pairingId: string; secret: string }) {
  await apiRequest<{ ok: true }>(`/web/pairing/${encodeURIComponent(input.pairingId)}/approve`, {
    body: JSON.stringify({ secret: input.secret }),
    method: 'POST',
    serverUrl,
  });
}

export async function deleteAccount(serverUrl: string, password: string) {
  await apiRequest<{ ok: true }>('/users/me', {
    body: JSON.stringify({ password }),
    method: 'DELETE',
    serverUrl,
  });
}

export async function getMe(serverUrl: string) {
  const response = await apiRequest<{ user: AuthUser }>('/auth/me', {
    method: 'GET',
    serverUrl,
  });

  return { ...response, user: mapUser(response.user, serverUrl) };
}

export async function getCatalogConfig(serverUrl: string) {
  return apiRequest<{ catalogUrl: string | null }>('/users/me/catalog', {
    method: 'GET',
    serverUrl,
  });
}

export async function getHelpConfig(serverUrl: string) {
  return apiRequest<{ helpUrl: string | null }>('/users/me/help', {
    method: 'GET',
    serverUrl,
  });
}

export async function getRemoteDiagnosticsConfig(serverUrl: string) {
  return apiRequest<{
    callEnabled?: boolean;
    enabled: boolean;
    maxBatchSize?: number;
    messageEnabled?: boolean;
    uploadIntervalSeconds?: number;
  }>('/users/me/diagnostics', {
    method: 'GET',
    serverUrl,
  });
}

export async function uploadRemoteDiagnostics(serverUrl: string, entries: {
  at: string;
  details: Record<string, unknown>;
  event: string;
  scope: 'call' | 'message';
}[]) {
  return apiRequest<{ accepted: boolean; stored: number }>('/users/me/diagnostics', {
    body: JSON.stringify({ entries }),
    method: 'POST',
    serverUrl,
  });
}

export async function getSubscriptionStatus(serverUrl: string) {
  return apiRequest<SubscriptionStatus>('/subscriptions/status', {
    method: 'GET',
    serverUrl,
  });
}

export async function createAttestationChallenge(
  serverUrl: string,
  input: { platform: 'android' | 'ios'; provider: 'play-integrity' | 'app-attest' },
) {
  return apiRequest<AttestationChallengeResponse>('/attestation/challenge', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function submitAndroidPlayIntegrityAttestation(serverUrl: string, input: { challengeId: string; token: string }) {
  return apiRequest<AttestationSubmitResponse>('/attestation/android/play-integrity', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function submitIosAppAttestRegistration(serverUrl: string, input: {
  attestationObject: string;
  challengeId: string;
  keyId: string;
}) {
  return apiRequest<AttestationSubmitResponse>('/attestation/ios/app-attest/register', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function verifyAppleSubscription(serverUrl: string, input: { productId: string; transactionReceipt: string }) {
  return apiRequest<SubscriptionStatus>('/subscriptions/apple/verify', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function verifyGoogleSubscription(serverUrl: string, input: { productId: string; purchaseToken: string }) {
  return apiRequest<SubscriptionStatus>('/subscriptions/google/verify', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function redeemSubscriptionCode(serverUrl: string, input: { code: string }) {
  return apiRequest<SubscriptionStatus>('/subscriptions/redeem', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function searchUsers(serverUrl: string, query: string) {
  const response = await apiRequest<{ users: AuthUser[] }>(`/users/search?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    serverUrl,
  });

  return { ...response, users: response.users.map((user) => mapUser(user, serverUrl)) };
}

export async function getSharedUser(serverUrl: string, shareCode: string) {
  const response = await apiRequest<{ user: AuthUser }>(`/users/shared/${encodeURIComponent(shareCode.trim())}`, {
    method: 'GET',
    serverUrl,
  });

  return { ...response, user: mapUser(response.user, serverUrl) };
}

export async function listBlockedUsers(serverUrl: string) {
  const response = await apiRequest<{ blockedUsers: AuthUser[] }>('/users/blocks', {
    method: 'GET',
    serverUrl,
  });

  return { ...response, blockedUsers: response.blockedUsers.map((user) => mapUser(user, serverUrl)) };
}

export async function listContacts(serverUrl: string) {
  const response = await apiRequest<{ contacts: AuthUser[] }>('/users/contacts', {
    method: 'GET',
    serverUrl,
  });

  return { ...response, contacts: response.contacts.map((user) => mapUser(user, serverUrl)) };
}

export async function getStatusSummary(serverUrl: string) {
  return apiRequest<{ count: number; hasUnviewed: boolean }>('/statuses/summary', {
    method: 'GET',
    serverUrl,
  });
}

export async function listStatuses(serverUrl: string) {
  const response = await apiRequest<{ groups: StatusGroup[] }>('/statuses', {
    method: 'GET',
    serverUrl,
  });

  return {
    groups: response.groups.map((group) => ({
      ...group,
      author: mapUser(group.author, serverUrl),
      statuses: group.statuses.map((status) => mapStatus(status, serverUrl)),
    })),
  };
}

export async function createStatus(
  serverUrl: string,
  input: {
    audience?: StatusAudience;
    backgroundColor?: string | null;
    body?: string;
    exceptUserIds?: string[];
    kind: StatusKind;
    mediaId?: string | null;
    onlyUserIds?: string[];
  },
) {
  const response = await apiRequest<{ status: StatusUpdate }>('/statuses', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });

  return mapStatus(response.status, serverUrl);
}

export async function markStatusViewed(serverUrl: string, statusId: string) {
  await apiRequest<{ ok: true }>(`/statuses/${encodeURIComponent(statusId)}/view`, {
    method: 'POST',
    serverUrl,
  });
}

export async function deleteStatus(serverUrl: string, statusId: string) {
  await apiRequest<{ ok: true }>(`/statuses/${encodeURIComponent(statusId)}`, {
    method: 'DELETE',
    serverUrl,
  });
}

export async function listStatusViewers(serverUrl: string, statusId: string) {
  const response = await apiRequest<{ viewers: StatusViewer[] }>(`/statuses/${encodeURIComponent(statusId)}/views`, {
    serverUrl,
  });

  return response.viewers.map((viewer) => ({
    ...viewer,
    user: mapUser(viewer.user, serverUrl),
  }));
}

export async function replyToStatus(serverUrl: string, statusId: string, body: string) {
  const response = await apiRequest<{ conversationId: string; message: BackendMessage }>(`/statuses/${encodeURIComponent(statusId)}/reply`, {
    body: JSON.stringify({ body }),
    method: 'POST',
    serverUrl,
  });

  return {
    conversationId: response.conversationId,
    message: mapMessage(response.message, serverUrl),
  };
}

export async function addContact(serverUrl: string, userId: string) {
  const response = await apiRequest<{ contact: AuthUser }>('/users/contacts', {
    body: JSON.stringify({ userId }),
    method: 'POST',
    serverUrl,
  });

  return { ...response, contact: mapUser(response.contact, serverUrl) };
}

export async function deleteContact(serverUrl: string, userId: string) {
  await apiRequest<{ ok: true }>(`/users/contacts/${userId}`, {
    method: 'DELETE',
    serverUrl,
  });
}

export async function blockUser(serverUrl: string, userId: string) {
  await apiRequest<{ ok: true }>('/users/blocks', {
    body: JSON.stringify({ userId }),
    method: 'POST',
    serverUrl,
  });
}

export async function unblockUser(serverUrl: string, userId: string) {
  await apiRequest<{ ok: true }>(`/users/blocks/${userId}`, {
    method: 'DELETE',
    serverUrl,
  });
}

export async function createDirectConversation(serverUrl: string, userId: string) {
  const response = await apiRequest<{ conversation: BackendConversation }>('/conversations/direct', {
    body: JSON.stringify({ userId }),
    method: 'POST',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function createGroupConversation(serverUrl: string, input: { title: string; userIds: string[] }) {
  const response = await apiRequest<{ conversation: BackendConversation }>('/conversations/group', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function createVoiceRoomConversation(serverUrl: string, input: { title: string; userIds: string[] }) {
  const response = await apiRequest<{ conversation: BackendConversation }>('/conversations/voice-room', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function joinVoiceRoom(serverUrl: string, conversationId: string) {
  const response = await apiRequest<{
    participant: VoiceRoomParticipant;
    roomName: string;
    token: string;
    url: string;
  }>(`/conversations/${conversationId}/voice-room/join`, {
    method: 'POST',
    serverUrl,
  });

  return {
    ...response,
    participant: mapVoiceRoomParticipant(response.participant, serverUrl),
  };
}

export async function leaveVoiceRoom(serverUrl: string, conversationId: string) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/voice-room/leave`, {
    method: 'POST',
    serverUrl,
  });
}

export async function listVoiceRoomParticipants(serverUrl: string, conversationId: string, input: { limit?: number; offset?: number } = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(input.limit ?? 100));
  params.set('offset', String(input.offset ?? 0));
  const response = await apiRequest<{
    hasMore?: boolean;
    nextOffset?: number;
    participants: VoiceRoomParticipant[];
  }>(`/conversations/${conversationId}/voice-room/participants?${params.toString()}`, {
    method: 'GET',
    serverUrl,
  });

  return {
    hasMore: response.hasMore === true,
    nextOffset: response.nextOffset ?? (input.offset ?? 0) + response.participants.length,
    participants: response.participants.map((participant) => mapVoiceRoomParticipant(participant, serverUrl)),
  };
}

export async function updateVoiceRoomParticipant(
  serverUrl: string,
  conversationId: string,
  userId: string,
  input: { adminMuted?: boolean; selfMuted?: boolean },
) {
  const response = await apiRequest<{ participant: VoiceRoomParticipant }>(`/conversations/${conversationId}/voice-room/participants/${userId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    serverUrl,
  });

  return mapVoiceRoomParticipant(response.participant, serverUrl);
}

export async function updateGroupAvatar(serverUrl: string, conversationId: string, avatarUrl: string | null) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/avatar`, {
    body: JSON.stringify({ avatarUrl }),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function updateGroupTitle(serverUrl: string, conversationId: string, title: string) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/title`, {
    body: JSON.stringify({ title }),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function updateGroupSettings(serverUrl: string, conversationId: string, input: { hideMembers?: boolean; isPublic?: boolean; ownerOnlyMessages?: boolean; preventMediaSave?: boolean; preventScreenshots?: boolean; showAdmins?: boolean; showMemberCount?: boolean }) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/settings`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function getPublicGroupInvite(serverUrl: string, inviteCode: string) {
  const response = await apiRequest<{ group: { avatarUrl?: string | null; id: string; memberCount: number; title: string } }>(`/conversations/public-invites/${encodeURIComponent(inviteCode.trim())}`, {
    method: 'GET',
    serverUrl,
  });

  return {
    ...response,
    group: {
      ...response.group,
      avatarUrl: normalizeAvatarUrl(response.group.avatarUrl, serverUrl),
    },
  };
}

export async function joinPublicGroupInvite(serverUrl: string, inviteCode: string) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/public-invites/${encodeURIComponent(inviteCode.trim())}/join`, {
    method: 'POST',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function addGroupMembers(serverUrl: string, conversationId: string, userIds: string[]) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/members`, {
    body: JSON.stringify({ userIds }),
    method: 'POST',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function addGroupAdmins(serverUrl: string, conversationId: string, userIds: string[]) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/admins`, {
    body: JSON.stringify({ userIds }),
    method: 'POST',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function revokeGroupAdmin(serverUrl: string, conversationId: string, userId: string) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/admins/${userId}`, {
    method: 'DELETE',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function transferGroupOwnership(serverUrl: string, conversationId: string, userId: string) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/owner`, {
    body: JSON.stringify({ userId }),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function deleteGroup(serverUrl: string, conversationId: string) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/group`, {
    method: 'DELETE',
    serverUrl,
  });
}

export async function removeGroupMember(serverUrl: string, conversationId: string, userId: string) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/members/${userId}`, {
    method: 'DELETE',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function listConversations(
  serverUrl: string,
  query = '',
  input: { filter?: ConversationListFilter; limit?: number; offset?: number } = {},
) {
  const params = new URLSearchParams();
  const normalizedQuery = query.trim();
  const filter = input.filter ?? 'all';

  if (normalizedQuery) {
    params.set('q', normalizedQuery);
  }

  if (filter === 'unread' || filter === 'groups') {
    params.set('filter', filter);
  }

  params.set('limit', String(input.limit ?? 100));
  params.set('offset', String(input.offset ?? 0));

  const response = await apiRequest<{
    conversations: BackendConversation[];
    hasMore?: boolean;
    nextOffset?: number;
    totalUnreadConversations?: number;
  }>(`/conversations?${params.toString()}`, {
    method: 'GET',
    serverUrl,
  });

  return {
    conversations: response.conversations
      .map((conversation) => mapConversation(conversation, serverUrl))
      .filter(isVisibleConversation),
    hasMore: response.hasMore === true,
    nextOffset: response.nextOffset ?? (input.offset ?? 0) + response.conversations.length,
    totalUnreadConversations: response.totalUnreadConversations ?? 0,
  };
}

function isVisibleConversation(conversation: Conversation) {
  return conversation.type !== 'DIRECT' || !!conversation.otherUserId;
}

export async function listMessages(serverUrl: string, conversationId: string, after?: string) {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  const response = await apiRequest<{ messages: BackendMessage[]; readThrough?: string | null }>(`/conversations/${conversationId}/messages${query}`, {
    method: 'GET',
    serverUrl,
  });

  return {
    messages: response.messages.map((message) => mapMessage(message, serverUrl)),
    readThrough: response.readThrough ?? null,
  };
}

export async function listMessageDeletions(serverUrl: string, conversationId: string) {
  const response = await apiRequest<{ deletions: { messageId?: string; messageKey?: string }[] }>(`/conversations/${conversationId}/deletions`, {
    method: 'GET',
    serverUrl,
  });

  return response.deletions;
}

export async function listBulkMessageDeletions(serverUrl: string, conversationIds: string[]) {
  if (conversationIds.length === 0) {
    return {};
  }

  const response = await apiRequest<{ items: Record<string, MessageDeletionUpdate[]> }>('/conversations/sync/deletions', {
    body: JSON.stringify({ conversationIds }),
    method: 'POST',
    serverUrl,
  });

  return response.items;
}

export async function listMessageEdits(serverUrl: string, conversationId: string) {
  const response = await apiRequest<{ edits: MessageEdit[] }>(`/conversations/${conversationId}/edits`, {
    method: 'GET',
    serverUrl,
  });

  return response.edits;
}

export async function listBulkMessageEdits(serverUrl: string, conversationIds: string[]) {
  if (conversationIds.length === 0) {
    return {};
  }

  const response = await apiRequest<{ items: Record<string, MessageEdit[]> }>('/conversations/sync/edits', {
    body: JSON.stringify({ conversationIds }),
    method: 'POST',
    serverUrl,
  });

  return response.items;
}

export async function listPinnedMessages(serverUrl: string, conversationId: string) {
  const response = await apiRequest<{ pins: BackendPinnedMessage[] }>(`/conversations/${conversationId}/pins`, {
    method: 'GET',
    serverUrl,
  });

  return response.pins.map((pin) => ({
    message: mapMessage(pin.message, serverUrl),
    pinnedAt: pin.pinnedAt,
    scope: pin.scope,
  }));
}

export async function pinMessage(serverUrl: string, conversationId: string, messageId: string, scope: 'all' | 'me') {
  const response = await apiRequest<BackendPinnedMessage & { conversationId: string }>(`/conversations/${conversationId}/messages/${messageId}/pin`, {
    body: JSON.stringify({ scope }),
    method: 'POST',
    serverUrl,
  });

  return {
    message: mapMessage(response.message, serverUrl),
    pinnedAt: response.pinnedAt,
    scope: response.scope,
  };
}

export async function unpinMessage(serverUrl: string, conversationId: string, messageId: string, scope: 'all' | 'me') {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/messages/${messageId}/pin`, {
    body: JSON.stringify({ scope }),
    method: 'DELETE',
    serverUrl,
  });
}

export async function acknowledgeMessageDeletions(serverUrl: string, conversationId: string, messageIds: string[], messageKeys: string[] = []) {
  if (messageIds.length === 0 && messageKeys.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/deletions/ack`, {
    body: JSON.stringify({ messageIds, messageKeys }),
    method: 'POST',
    serverUrl,
  });
}

export async function acknowledgeBulkMessageDeletions(serverUrl: string, items: Array<{ conversationId: string; messageIds: string[]; messageKeys?: string[] }>) {
  const ackItems = items
    .map((item) => ({
      conversationId: item.conversationId,
      messageIds: item.messageIds,
      messageKeys: item.messageKeys ?? [],
    }))
    .filter((item) => item.messageIds.length > 0 || item.messageKeys.length > 0);

  if (ackItems.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>('/conversations/sync/deletions/ack', {
    body: JSON.stringify({ items: ackItems }),
    method: 'POST',
    serverUrl,
  });
}

export async function acknowledgeMessageEdits(serverUrl: string, conversationId: string, messageIds: string[], messageKeys: string[] = []) {
  if (messageIds.length === 0 && messageKeys.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/edits/ack`, {
    body: JSON.stringify({ messageIds, messageKeys }),
    method: 'POST',
    serverUrl,
  });
}

export async function acknowledgeBulkMessageEdits(serverUrl: string, items: Array<{ conversationId: string; messageIds: string[]; messageKeys?: string[] }>) {
  const ackItems = items
    .map((item) => ({
      conversationId: item.conversationId,
      messageIds: item.messageIds,
      messageKeys: item.messageKeys ?? [],
    }))
    .filter((item) => item.messageIds.length > 0 || item.messageKeys.length > 0);

  if (ackItems.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>('/conversations/sync/edits/ack', {
    body: JSON.stringify({ items: ackItems }),
    method: 'POST',
    serverUrl,
  });
}

export async function listMessageStatusUpdates(serverUrl: string, conversationId: string) {
  const response = await apiRequest<{ updates: MessageStatusUpdate[] }>(`/conversations/${conversationId}/status-updates`, {
    method: 'GET',
    serverUrl,
  });

  return response.updates;
}

export async function listBulkMessageStatusUpdates(serverUrl: string, conversationIds: string[]) {
  if (conversationIds.length === 0) {
    return {};
  }

  const response = await apiRequest<{ items: Record<string, MessageStatusUpdate[]> }>('/conversations/sync/status-updates', {
    body: JSON.stringify({ conversationIds }),
    method: 'POST',
    serverUrl,
  });

  return response.items;
}

export async function acknowledgeMessageStatusUpdates(serverUrl: string, conversationId: string, messageIds: string[], messageKeys: string[] = []) {
  if (messageIds.length === 0 && messageKeys.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/status-updates/ack`, {
    body: JSON.stringify({ messageIds, messageKeys }),
    method: 'POST',
    serverUrl,
  });
}

export async function acknowledgeBulkMessageStatusUpdates(serverUrl: string, items: Array<{ conversationId: string; messageIds: string[]; messageKeys?: string[] }>) {
  const ackItems = items
    .map((item) => ({
      conversationId: item.conversationId,
      messageIds: item.messageIds,
      messageKeys: item.messageKeys ?? [],
    }))
    .filter((item) => item.messageIds.length > 0 || item.messageKeys.length > 0);

  if (ackItems.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>('/conversations/sync/status-updates/ack', {
    body: JSON.stringify({ items: ackItems }),
    method: 'POST',
    serverUrl,
  });
}

export async function acknowledgeMessageContent(serverUrl: string, conversationId: string, messageIds: string[]) {
  if (messageIds.length === 0) {
    return;
  }

  for (let index = 0; index < messageIds.length; index += 250) {
    const chunk = messageIds.slice(index, index + 250);

    await apiRequest<{ ok: true }>(`/conversations/${conversationId}/messages/acks`, {
      body: JSON.stringify({ client: 'MOBILE', messageIds: chunk }),
      method: 'POST',
      serverUrl,
    });
  }
}

export async function markMessagesDelivered(serverUrl: string, conversationId: string, messageIds: string[]) {
  if (messageIds.length === 0) {
    return;
  }

  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/messages/delivered`, {
    body: JSON.stringify({ messageIds }),
    method: 'POST',
    serverUrl,
  });
}

export async function createTextMessage(
  serverUrl: string,
  conversationId: string,
  body: string,
  clientId?: string,
  metadata?: Message['metadata'],
) {
  const response = await apiRequest<{ message: BackendMessage }>(`/conversations/${conversationId}/messages`, {
    body: JSON.stringify({
      body,
      kind: 'TEXT',
      metadata: mergeMessageMetadata(metadata, clientId),
    }),
    method: 'POST',
    serverUrl,
  });

  return mapMessage(response.message, serverUrl);
}

export async function createScheduledMessage(
  serverUrl: string,
  conversationId: string,
  input: {
    body?: string;
    clientTimezone?: string;
    kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE';
    mediaId?: string;
    metadata?: Message['metadata'];
    sendAt: string;
  },
) {
  const response = await apiRequest<{ scheduledMessage: ScheduledMessage }>(`/conversations/${conversationId}/scheduled-messages`, {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });

  return response.scheduledMessage;
}

export async function deleteScheduledMessage(serverUrl: string, conversationId: string, scheduledMessageId: string) {
  await apiRequest<{ ok: boolean }>(`/conversations/${conversationId}/scheduled-messages/${scheduledMessageId}`, {
    method: 'DELETE',
    serverUrl,
  });
}

export async function reactToMessage(serverUrl: string, conversationId: string, messageId: string, emoji: string | null) {
  const response = await apiRequest<{ message: BackendMessage; reaction: MessageReactionUpdate }>(
    `/conversations/${conversationId}/messages/${messageId}/reaction`,
    {
      body: JSON.stringify({ emoji }),
      method: 'POST',
      serverUrl,
    },
  );

  return {
    message: mapMessage(response.message, serverUrl),
    reaction: response.reaction,
  };
}

export async function openDisappearingMessage(
  serverUrl: string,
  conversationId: string,
  messageId: string,
  secondsAfterView?: number,
) {
  const response = await apiRequest<{
    disappearingView: {
      deleteAt: string;
      messageId: string;
      openedAt: string;
      secondsAfterView: number;
    };
  }>(`/conversations/${conversationId}/messages/${messageId}/disappearing/open`, {
    body: JSON.stringify(secondsAfterView ? { secondsAfterView } : {}),
    method: 'POST',
    serverUrl,
  });

  return response.disappearingView;
}

export async function createLiveLocation(
  serverUrl: string,
  input: { address?: string; clientId?: string; conversationId: string; durationMinutes: 15 | 60 | 240 | 720; latitude: number; longitude: number },
) {
  const response = await apiRequest<{ liveLocation: LiveLocation; message: BackendMessage }>('/live-locations', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
  return { liveLocation: response.liveLocation, message: mapMessage(response.message, serverUrl) };
}

export async function updateLiveLocation(
  serverUrl: string,
  liveLocationId: string,
  input: { address?: string; latitude: number; longitude: number },
) {
  return apiRequest<{ liveLocation: LiveLocation }>(`/live-locations/${liveLocationId}`, {
    body: JSON.stringify(input),
    method: 'PATCH',
    serverUrl,
  });
}

export async function stopLiveLocation(serverUrl: string, liveLocationId: string) {
  return apiRequest<{ liveLocation: LiveLocation }>(`/live-locations/${liveLocationId}/stop`, {
    method: 'POST',
    serverUrl,
  });
}

export async function createForwardedMessage(serverUrl: string, conversationId: string, source: Message) {
  const response = await apiRequest<{ message: BackendMessage }>(`/conversations/${conversationId}/messages`, {
    body: JSON.stringify({
      body: source.body,
      kind: source.kind.toUpperCase(),
      mediaId: source.mediaId,
      metadata: {
        forwarded: true,
      },
    }),
    method: 'POST',
    serverUrl,
  });

  return mapMessage(response.message, serverUrl);
}

export async function uploadMedia(
  serverUrl: string,
  input: {
    base64: string;
    durationSec?: number;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
  },
) {
  const response = await apiRequest<{ media: { id: string } }>('/media/upload', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });

  return response.media;
}

export async function uploadMediaFile(
  serverUrl: string,
  input: {
    durationSec?: number;
    mimeType: string;
    originalName: string;
    sizeBytes?: number;
    uri: string;
  },
  options: {
    onProgress?: (progress: { sentBytes: number; totalBytes: number }) => void;
    signal?: AbortSignal;
    uploadId?: string;
  } = {},
) {
  const policy = await assertAttachmentsWithinPolicy(serverUrl, [input.sizeBytes]);
  const sizeBytes = input.sizeBytes ?? 0;
  const directUploadLimitBytes = Math.max(CHUNK_UPLOAD_THRESHOLD_BYTES, policy.uploads.maxDirectUploadBytes);
  const chunkSizeBytes = normalizeUploadChunkSize(policy.uploads.maxChunkBytes);

  if (sizeBytes && sizeBytes > directUploadLimitBytes) {
    return uploadMediaFileInChunks(serverUrl, input, { ...options, chunkSizeBytes });
  }

  return uploadMediaFileDirect(serverUrl, input, options);
}

async function uploadMediaFileDirect(
  serverUrl: string,
  input: {
    durationSec?: number;
    mimeType: string;
    originalName: string;
    sizeBytes?: number;
    uri: string;
  },
  options: {
    onProgress?: (progress: { sentBytes: number; totalBytes: number }) => void;
    signal?: AbortSignal;
  } = {},
) {
  await initializeClientInstallationId();
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    ...getClientRequestHeaders(),
    'Content-Type': input.mimeType,
    'x-mime-type': input.mimeType,
    'x-original-name': encodeURIComponent(input.originalName),
  };

  if (input.durationSec) {
    headers['x-duration-sec'] = String(Math.max(1, Math.round(input.durationSec)));
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const uploadTask = FileSystem.createUploadTask(`${serverUrl}/media/upload-binary`, input.uri, {
    headers,
    httpMethod: 'POST',
    sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
  }, (progress) => {
    const expectedBytes = progress.totalBytesExpectedToSend > 0
      ? progress.totalBytesExpectedToSend
      : input.sizeBytes ?? progress.totalBytesSent;
    options.onProgress?.({
      sentBytes: Math.min(progress.totalBytesSent, expectedBytes),
      totalBytes: expectedBytes,
    });
  });
  const abortUpload = () => {
    void uploadTask.cancelAsync().catch(() => undefined);
  };

  if (options.signal?.aborted) {
    throw new UploadCanceledError();
  }

  options.signal?.addEventListener('abort', abortUpload, { once: true });

  let response: FileSystem.FileSystemUploadResult | null | undefined;

  try {
    response = await uploadTask.uploadAsync();
  } catch (error) {
    if (options.signal?.aborted) {
      throw new UploadCanceledError();
    }

    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abortUpload);
  }

  if (!response) {
    throw options.signal?.aborted ? new UploadCanceledError() : new Error('Upload failed');
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(response.body || `Upload failed with ${response.status}`);
  }

  if (input.sizeBytes) {
    options.onProgress?.({ sentBytes: input.sizeBytes, totalBytes: input.sizeBytes });
  }

  return (JSON.parse(response.body) as { media: { id: string } }).media;
}

export class UploadCanceledError extends Error {
  constructor() {
    super('Upload canceled');
    this.name = 'UploadCanceledError';
  }
}

export function isUploadCanceledError(error: unknown) {
  return error instanceof UploadCanceledError ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError');
}

async function uploadMediaFileInChunks(
  serverUrl: string,
  input: {
    durationSec?: number;
    mimeType: string;
    originalName: string;
    sizeBytes?: number;
    uri: string;
  },
  options: {
    chunkSizeBytes: number;
    onProgress?: (progress: { sentBytes: number; totalBytes: number }) => void;
    signal?: AbortSignal;
    uploadId?: string;
  },
) {
  const info = await FileSystem.getInfoAsync(input.uri);
  const totalBytes = (info.exists && 'size' in info ? info.size : input.sizeBytes) ?? 0;

  if (!totalBytes) {
    throw new Error(t('attachmentFileEmpty'));
  }

  const uploadId = sanitizeUploadId(options.uploadId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const chunkSizeBytes = options.chunkSizeBytes;
  const totalChunks = Math.ceil(totalBytes / chunkSizeBytes);
  let completedChunks = new Set<number>(await getCompletedUploadChunks(serverUrl, uploadId));

  options.onProgress?.({ sentBytes: getUploadedBytes(completedChunks, totalBytes, chunkSizeBytes), totalBytes });

  try {
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      throwIfUploadCanceled(options.signal);

      if (completedChunks.has(chunkIndex)) {
        continue;
      }

      const position = chunkIndex * chunkSizeBytes;
      const length = Math.min(chunkSizeBytes, totalBytes - position);
      const chunkBase64 = await FileSystem.readAsStringAsync(input.uri, {
        encoding: FileSystem.EncodingType.Base64,
        length,
        position,
      });

      const serverCompletedChunks = await uploadMediaChunkWithResume(serverUrl, uploadId, chunkIndex, {
        chunkBase64,
        chunkSize: length,
        durationSec: input.durationSec,
        mimeType: input.mimeType,
        originalName: input.originalName,
        sizeBytes: totalBytes,
        totalChunks,
      }, options.signal);

      completedChunks = new Set(serverCompletedChunks.length ? serverCompletedChunks : [...completedChunks, chunkIndex]);
      options.onProgress?.({ sentBytes: getUploadedBytes(completedChunks, totalBytes, chunkSizeBytes), totalBytes });
    }

    const response = await apiRequest<{ media: { id: string } }>(`/media/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: 'POST',
      serverUrl,
      signal: options.signal,
    });

    return response.media;
  } catch (error) {
    if (isUploadCanceledError(error)) {
      await cancelMediaUpload(serverUrl, uploadId).catch(() => undefined);
      throw new UploadCanceledError();
    }

    completedChunks = new Set(await getCompletedUploadChunks(serverUrl, uploadId).catch(() => [...completedChunks]));
    options.onProgress?.({ sentBytes: getUploadedBytes(completedChunks, totalBytes, chunkSizeBytes), totalBytes });
    throw error;
  }
}

async function getCompletedUploadChunks(serverUrl: string, uploadId: string) {
  const response = await apiRequest<{ completedChunks: number[] }>(`/media/uploads/${encodeURIComponent(uploadId)}/status?t=${Date.now()}`, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
    method: 'GET',
    serverUrl,
  });

  return response.completedChunks;
}

async function uploadMediaChunk(
  serverUrl: string,
  uploadId: string,
  chunkIndex: number,
  body: {
    chunkBase64: string;
    chunkSize: number;
    durationSec?: number;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    totalChunks: number;
  },
  signal?: AbortSignal,
) {
  const response = await apiRequest<{ completedChunks?: number[]; ok: true }>(`/media/uploads/${encodeURIComponent(uploadId)}/chunks/${chunkIndex}`, {
    body: JSON.stringify(body),
    method: 'POST',
    serverUrl,
    signal,
  });

  return response.completedChunks ?? [];
}

async function uploadMediaChunkWithResume(
  serverUrl: string,
  uploadId: string,
  chunkIndex: number,
  body: {
    chunkBase64: string;
    chunkSize: number;
    durationSec?: number;
    mimeType: string;
    originalName: string;
    sizeBytes: number;
    totalChunks: number;
  },
  signal?: AbortSignal,
) {
  while (true) {
    throwIfUploadCanceled(signal);

    try {
      return await uploadMediaChunk(serverUrl, uploadId, chunkIndex, body, signal);
    } catch (error) {
      if (isUploadCanceledError(error)) {
        throw error;
      }

      if (error instanceof ApiError && error.status && error.status >= 400 && error.status < 500) {
        throw error;
      }

      const completedChunks = await getCompletedUploadChunks(serverUrl, uploadId).catch((): number[] => []);

      if (completedChunks.includes(chunkIndex)) {
        return completedChunks;
      }

      await waitForUploadRetry(signal);
    }
  }
}

export async function cancelMediaUpload(serverUrl: string, uploadId: string) {
  await apiRequest<{ ok: true }>(`/media/uploads/${encodeURIComponent(sanitizeUploadId(uploadId))}`, {
    method: 'DELETE',
    serverUrl,
  });
}

function throwIfUploadCanceled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new UploadCanceledError();
  }
}

function getUploadedBytes(completedChunks: Set<number>, totalBytes: number, chunkSizeBytes: number) {
  let uploadedBytes = 0;

  completedChunks.forEach((chunkIndex) => {
    uploadedBytes += Math.min(chunkSizeBytes, Math.max(0, totalBytes - (chunkIndex * chunkSizeBytes)));
  });

  return Math.min(uploadedBytes, totalBytes);
}

function normalizeUploadChunkSize(value: number) {
  const normalized = Math.floor(value);

  if (!Number.isFinite(normalized) || normalized < LEGACY_CHUNK_SIZE_BYTES) {
    return LEGACY_CHUNK_SIZE_BYTES;
  }

  return Math.min(normalized, MAX_CLIENT_CHUNK_SIZE_BYTES);
}

function waitForUploadRetry(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadCanceledError());
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 1800);
    const abort = () => {
      clearTimeout(timeout);
      reject(new UploadCanceledError());
    };

    signal?.addEventListener('abort', abort, { once: true });
  });
}

function sanitizeUploadId(uploadId: string) {
  return uploadId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128).padEnd(8, '_');
}

export async function createVoiceMessage(serverUrl: string, conversationId: string, mediaId: string, clientId?: string, metadata?: Message['metadata']) {
  const response = await apiRequest<{ message: BackendMessage }>(`/conversations/${conversationId}/messages`, {
    body: JSON.stringify({
      body: 'Voice message',
      kind: 'VOICE',
      mediaId,
      metadata: mergeMessageMetadata(metadata, clientId),
    }),
    method: 'POST',
    serverUrl,
  });

  return mapMessage(response.message, serverUrl);
}

export async function createMediaMessage(
  serverUrl: string,
  conversationId: string,
  input: { body?: string; clientId?: string; kind: 'IMAGE' | 'VIDEO' | 'FILE'; mediaId: string; metadata?: Message['metadata'] },
) {
  const response = await apiRequest<{ message: BackendMessage }>(`/conversations/${conversationId}/messages`, {
    body: JSON.stringify({
      body: input.body ?? '',
      kind: input.kind,
      mediaId: input.mediaId,
      metadata: mergeMessageMetadata(input.metadata, input.clientId),
    }),
    method: 'POST',
    serverUrl,
  });

  return mapMessage(response.message, serverUrl);
}

export async function deleteMessage(
  serverUrl: string,
  conversationId: string,
  messageId: string,
  mode: 'me' | 'all',
  messageKey?: string,
) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/messages/${messageId}`, {
    body: JSON.stringify({ messageKey, mode }),
    method: 'DELETE',
    serverUrl,
  });
}

export async function editMessage(
  serverUrl: string,
  conversationId: string,
  messageId: string,
  body: string,
  messageKey?: string,
  createdAt?: string,
) {
  const requestBody = JSON.stringify({ body, createdAt, messageKey });
  let response: { edit: MessageEdit };

  try {
    response = await apiRequest<{ edit: MessageEdit }>(`/conversations/${conversationId}/messages/${messageId}`, {
      body: requestBody,
      method: 'PATCH',
      serverUrl,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404 || !/route not found/i.test(error.message)) {
      throw error;
    }

    response = await apiRequest<{ edit: MessageEdit }>(`/conversations/${conversationId}/messages/${messageId}/edit`, {
      body: requestBody,
      method: 'POST',
      serverUrl,
    });
  }

  return response.edit;
}

export async function deleteCallMessageByCallId(
  serverUrl: string,
  conversationId: string,
  callId: string,
  mode: 'me' | 'all',
  messageKey?: string,
) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/call-messages/${callId}`, {
    body: JSON.stringify({ messageKey, mode }),
    method: 'DELETE',
    serverUrl,
  });
}

export async function deleteConversation(serverUrl: string, conversationId: string) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}`, {
    body: JSON.stringify({ mode: 'me' }),
    method: 'DELETE',
    serverUrl,
  });
}

export async function deleteConversationForAnyone(serverUrl: string, conversationId: string) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}`, {
    body: JSON.stringify({ mode: 'all' }),
    method: 'DELETE',
    serverUrl,
  });
}

export async function bulkDeleteConversations(
  serverUrl: string,
  input: { conversationIds: string[]; mode: 'me' | 'all' },
) {
  return apiRequest<{ deletedConversationIds: string[]; ok: true; skippedConversationIds: string[] }>('/conversations/bulk-delete', {
    body: JSON.stringify({
      conversationIds: Array.from(new Set(input.conversationIds)),
      mode: input.mode,
    }),
    method: 'POST',
    serverUrl,
  });
}

export async function acknowledgeConversationDeletion(serverUrl: string, conversationId: string) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/deletion/ack`, {
    method: 'POST',
    serverUrl,
  });
}

export async function updateConversationMute(serverUrl: string, conversationId: string, muted: boolean, durationMinutes?: ConversationMuteDurationMinutes) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/mute`, {
    body: JSON.stringify({ durationMinutes, muted }),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function updateDisappearingMessages(serverUrl: string, conversationId: string, durationMinutes: DisappearingMessagesDurationMinutes | null) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/disappearing-messages`, {
    body: JSON.stringify({ durationMinutes }),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function updateGroupAlias(serverUrl: string, conversationId: string, aliasName: string | null) {
  const response = await apiRequest<{ conversation: BackendConversation }>(`/conversations/${conversationId}/alias`, {
    body: JSON.stringify({ aliasName }),
    method: 'PATCH',
    serverUrl,
  });

  return mapConversation(response.conversation, serverUrl);
}

export async function declineGroupInvite(serverUrl: string, conversationId: string, input: { blockGroup?: boolean; reportGroup?: boolean }) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/invite/decline`, {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function createCall(serverUrl: string, conversationId: string, mode: 'voice' | 'video', inviteeUserIds?: string[], messageKey?: string) {
  const response = await apiRequest<{ call: { id: string }; livekit?: { roomName: string; token: string; url: string } | null }>('/calls', {
    body: JSON.stringify({ conversationId, inviteeUserIds, messageKey, mode: mode.toUpperCase() }),
    method: 'POST',
    serverUrl,
  });

  return response;
}

export async function createMeeting(serverUrl: string, mode: 'voice' | 'video') {
  return apiRequest<{
    meeting: {
      code: string;
      durationLimitSeconds: number;
      id: string;
      link: string;
      maxEndsAt: string;
      mode: 'voice' | 'video';
      startedAt: string;
      status: 'active' | 'ended';
    };
    remainingSeconds: number;
  }>('/meetings', {
    body: JSON.stringify({ mode: mode.toUpperCase() }),
    method: 'POST',
    serverUrl,
  });
}

export type MeetingInfo = {
  code: string;
  creator: { displayName: string; id: string; username: string };
  durationLimitSeconds: number;
  endedAt: string | null;
  id: string;
  link: string;
  maxEndsAt: string;
  mode: 'voice' | 'video';
  startedAt: string;
  status: 'active' | 'ended';
};

export type MeetingParticipantInfo = {
  displayName: string;
  guestId: string | null;
  id: string;
  joinedAt: string;
  leftAt: string | null;
  role: 'HOST' | 'GUEST';
  userId: string | null;
};

export async function getMeeting(serverUrl: string, code: string) {
  return apiRequest<{
    meeting: MeetingInfo;
    participants: MeetingParticipantInfo[];
    remainingSeconds: number;
  }>(`/meetings/${encodeURIComponent(code)}`, {
    method: 'GET',
    serverUrl,
  });
}

export async function joinMeeting(serverUrl: string, code: string, displayName: string) {
  return apiRequest<{
    livekit: { roomName: string; token: string; url: string };
    meeting: MeetingInfo;
    participant: MeetingParticipantInfo;
    remainingSeconds: number;
  }>(`/meetings/${encodeURIComponent(code)}/join`, {
    body: JSON.stringify({ displayName }),
    method: 'POST',
    serverUrl,
  });
}

export async function leaveMeeting(serverUrl: string, code: string, participantId: string) {
  await apiRequest<{ ok: true }>(`/meetings/${encodeURIComponent(code)}/leave`, {
    body: JSON.stringify({ participantId }),
    method: 'POST',
    serverUrl,
  });
}

export async function endMeeting(serverUrl: string, code: string) {
  return apiRequest<{ meeting: MeetingInfo }>(`/meetings/${encodeURIComponent(code)}/end`, {
    method: 'POST',
    serverUrl,
  });
}

export async function answerCall(serverUrl: string, callId: string, options?: { answerClientId?: string; answerSurface?: 'mobile' | 'web' }) {
  return apiRequest<{ call: { id: string }; livekit?: { roomName: string; token: string; url: string } | null }>(`/calls/${callId}/answer`, {
    body: options ? JSON.stringify(options) : undefined,
    method: 'POST',
    serverUrl,
  });
}

export async function ringCall(serverUrl: string, callId: string) {
  await apiRequest<{ ok: true }>(`/calls/${callId}/ringing`, {
    method: 'POST',
    serverUrl,
  });
}

export async function endCall(serverUrl: string, callId: string) {
  await apiRequest<{ call: { id: string } }>(`/calls/${callId}/end`, {
    method: 'POST',
    serverUrl,
  });
}

export async function getCallStatus(serverUrl: string, callId: string) {
  return apiRequest<{
    call: {
      callStatus: 'RINGING' | 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED';
      conversationId: string;
      endedAt: string | null;
      id: string;
    };
  }>(`/calls/${callId}/status`, {
    method: 'GET',
    serverUrl,
  });
}

export async function getCallToken(serverUrl: string, callId: string) {
  return apiRequest<{ roomName: string; token: string; url: string }>(`/calls/${callId}/token`, {
    method: 'GET',
    serverUrl,
  });
}

export async function inviteCallParticipant(serverUrl: string, callId: string, userId: string) {
  await apiRequest<{ user: AuthUser }>(`/calls/${callId}/invite`, {
    body: JSON.stringify({ userId }),
    method: 'POST',
    serverUrl,
  });
}

export async function markConversationRead(
  serverUrl: string,
  conversationId: string,
  source: 'chat_open' | 'notification_action' = 'chat_open',
  messageIds: string[] = [],
  messageKeys: string[] = [],
) {
  await apiRequest<{ ok: true }>(`/conversations/${conversationId}/read`, {
    body: JSON.stringify({ messageIds, messageKeys, source }),
    method: 'POST',
    serverUrl,
  });
}

export async function markAllConversationsRead(serverUrl: string) {
  return apiRequest<{ ok: true; conversationIds: string[]; readAt: string }>('/conversations/read-all', {
    method: 'POST',
    serverUrl,
  });
}

export async function registerPushToken(serverUrl: string, input: { locale: AppLanguage; platform: string; provider: 'apns' | 'apns_voip' | 'expo' | 'fcm'; token: string }) {
  await apiRequest<{ ok: true }>('/users/push-token', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export async function updateMyAvatar(serverUrl: string, avatarUrl: string | null) {
  const response = await apiRequest<{ user: AuthUser }>('/users/me/avatar', {
    body: JSON.stringify({ avatarUrl }),
    method: 'POST',
    serverUrl,
  });

  return mapUser(response.user, serverUrl);
}

export async function updateMyProfile(serverUrl: string, input: { displayName?: string; username?: string }) {
  const response = await apiRequest<{ user: AuthUser }>('/users/me/profile', {
    body: JSON.stringify(input),
    method: 'PATCH',
    serverUrl,
  });

  return mapUser(response.user, serverUrl);
}

export async function updateMyPassword(serverUrl: string, input: { currentPassword: string; newPassword: string }) {
  await apiRequest<{ ok: true }>('/users/me/password', {
    body: JSON.stringify(input),
    method: 'PATCH',
    serverUrl,
  });
}

export async function getConversationScreenshotPrivacy(serverUrl: string, conversationId: string) {
  return apiRequest<{ preventPeerScreenshots: boolean }>(`/conversations/${conversationId}/screenshot-privacy`, {
    method: 'GET',
    serverUrl,
  });
}

export async function getCallScreenshotPrivacy(serverUrl: string, callId: string) {
  return apiRequest<{ preventPeerScreenshots: boolean }>(`/calls/${callId}/screenshot-privacy`, {
    method: 'GET',
    serverUrl,
  });
}

export async function submitCallFeedback(serverUrl: string, callId: string, stars: number) {
  await apiRequest<{ ok: true }>(`/calls/${callId}/feedback`, {
    body: JSON.stringify({ stars }),
    method: 'POST',
    serverUrl,
  });
}

export async function updatePrivacy(serverUrl: string, input: { hideFromSearch?: boolean; hideNickname?: boolean; onlyContactsCanCall?: boolean; preventPeerScreenshots?: boolean; showLastSeen?: boolean; useGroupAliases?: boolean }) {
  const response = await apiRequest<{ user: AuthUser }>('/users/me/privacy', {
    body: JSON.stringify(input),
    method: 'PATCH',
    serverUrl,
  });

  return mapUser(response.user, serverUrl);
}

export async function reportContent(
  serverUrl: string,
  input: { conversationId?: string; reason?: string; targetId: string; targetType: 'USER' | 'MESSAGE' | 'GROUP' },
) {
  await apiRequest<{ ok: true; reportId: string }>('/reports', {
    body: JSON.stringify(input),
    method: 'POST',
    serverUrl,
  });
}

export function mapMessage(message: BackendMessage, serverUrl?: string | null): Message {
  return {
    body: message.body ?? '',
    conversationId: message.conversationId,
    createdAt: formatMessageTime(message.createdAt),
    createdAtIso: message.createdAt ?? undefined,
    durationSeconds: message.media?.durationSec ?? undefined,
    fileName: message.media?.originalName,
    id: message.id,
    kind: mapMessageKind(message.kind),
    mediaId: message.mediaId ?? message.media?.id ?? undefined,
    mediaUri: message.media?.id && serverUrl ? `${serverUrl}/media/${message.media.id}/file` : undefined,
    metadata: message.metadata ?? undefined,
    mimeType: message.media?.mimeType,
    senderId: message.senderId,
    sender: mapUser(message.sender, serverUrl),
    sizeBytes: message.media?.sizeBytes,
    status: mapMessageStatus(message.status),
  };
}

function mapStatus(status: StatusUpdate, serverUrl?: string | null): StatusUpdate {
  return {
    ...status,
    mediaUri: status.media?.id && serverUrl ? `${serverUrl}/media/${status.media.id}/file` : undefined,
  };
}

function mapConversation(conversation: BackendConversation, serverUrl?: string | null): Conversation {
  return {
    adminIds: conversation.adminIds ?? [],
    avatarLabel: conversation.title || 'M',
    avatarUrl: normalizeAvatarUrl(conversation.avatarUrl, serverUrl),
    disappearingMessagesDurationMinutes: conversation.disappearingMessagesDurationMinutes,
    disappearingMessagesExpiredAt: conversation.disappearingMessagesExpiredAt,
    disappearingMessagesSetById: conversation.disappearingMessagesSetById,
    hideMembers: conversation.hideMembers,
    id: conversation.id,
    isContact: conversation.isContact,
    isMuted: conversation.isMuted,
    mutedUntil: conversation.mutedUntil,
    isSystem: conversation.isSystem === true,
    isPublic: conversation.isPublic === true,
    isVoiceRoom: conversation.isVoiceRoom === true,
    memberCount: conversation.memberCount,
    members: conversation.members?.map((member) => mapUser(member, serverUrl)),
    myGroupInvitePending: conversation.myGroupInvitePending === true,
    myGroupAliasName: conversation.myGroupAliasName ?? null,
    myGroupAliasPromptSeen: conversation.myGroupAliasPromptSeen === true,
    lastMessage: conversation.lastMessage || 'No messages yet',
    lastMessageAt: formatConversationActivityTime(conversation.lastMessageAt, getDeviceLanguage()),
    lastMessageAtIso: conversation.lastMessageAt,
    lastMessageId: conversation.lastMessageId ?? undefined,
    lastMessageKind: conversation.lastMessageKind ? mapMessageKind(conversation.lastMessageKind) : undefined,
    lastMessageSenderId: conversation.lastMessageSenderId ?? undefined,
    lastMessageStatus: conversation.lastMessageStatus ? mapMessageStatus(conversation.lastMessageStatus) : undefined,
    otherUserId: conversation.otherUserId ?? undefined,
    ownerId: conversation.ownerId,
    ownerOnlyMessages: conversation.ownerOnlyMessages,
    preventMediaSave: conversation.preventMediaSave === true,
    preventScreenshots: conversation.preventScreenshots === true,
    publicInviteCode: conversation.publicInviteCode ?? null,
    searchSnippet: conversation.searchSnippet ?? undefined,
    showAdmins: conversation.showAdmins !== false,
    showMemberCount: conversation.showMemberCount !== false,
    title: conversation.title,
    type: conversation.type,
    unreadCount: conversation.unreadCount,
  };
}

function mapVoiceRoomParticipant(participant: VoiceRoomParticipant, serverUrl?: string | null): VoiceRoomParticipant {
  return {
    ...participant,
    user: mapUser(participant.user, serverUrl),
  };
}

function mapUser<T extends AuthUser | undefined>(user: T, serverUrl?: string | null): T {
  if (!user) {
    return user;
  }

  return {
    ...user,
    avatarUrl: normalizeAvatarUrl(user.avatarUrl, serverUrl),
  };
}

function normalizeAvatarUrl(avatarUrl?: string | null, serverUrl?: string | null) {
  if (!avatarUrl) {
    return undefined;
  }

  if (!serverUrl) {
    return avatarUrl;
  }

  if (avatarUrl.startsWith('/media/')) {
    return `${serverUrl}${avatarUrl}`;
  }

  try {
    const parsedAvatarUrl = new URL(avatarUrl);

    if (parsedAvatarUrl.pathname.startsWith('/media/')) {
      return `${serverUrl}${parsedAvatarUrl.pathname}${parsedAvatarUrl.search}`;
    }
  } catch {
    return avatarUrl;
  }

  return avatarUrl;
}

function mergeMessageMetadata(metadata: Message['metadata'] | undefined, clientId?: string) {
  const deleteKey = getMessageDeleteKeyFromMetadata(metadata) ?? createMessageDeleteKey();

  if (!clientId && !deleteKey) {
    return metadata;
  }

  return {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    clientId,
    deleteKey,
  };
}

function createMessageDeleteKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 16; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return value;
}

function getMessageDeleteKeyFromMetadata(metadata: Message['metadata'] | undefined) {
  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : undefined;
}

function formatMessageTime(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function mapMessageKind(value?: string | null): MessageKind {
  const normalized = value?.toLowerCase();

  if (
    normalized === 'text' ||
    normalized === 'image' ||
    normalized === 'video' ||
    normalized === 'file' ||
    normalized === 'voice' ||
    normalized === 'call'
  ) {
    return normalized;
  }

  return 'text';
}

function mapMessageStatus(value?: string | null): Message['status'] {
  const normalized = value?.toLowerCase();

  if (
    normalized === 'sending' ||
    normalized === 'sent' ||
    normalized === 'delivered' ||
    normalized === 'read'
  ) {
    return normalized;
  }

  return 'sent';
}
