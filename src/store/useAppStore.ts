import { create, type StoreApi, type UseBoundStore } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState as NativeAppState, Appearance, InteractionManager } from 'react-native';

import { ApiError } from '../lib/api';
import { AppLanguage, isLanguagePreference, LanguagePreference, resolveLanguage, setI18nLanguage, t } from '../i18n';
import { acknowledgeBulkMessageDeletions, acknowledgeBulkMessageStatusUpdates, acknowledgeMessageContent, acknowledgeMessageDeletions, acknowledgeMessageEdits, acknowledgeMessageStatusUpdates, addContact, addGroupAdmins as addGroupAdminsRequest, addGroupMembers as addGroupMembersRequest, blockUser, bulkDeleteConversations, createDirectConversation, createForwardedMessage, createGroupConversation, createMediaMessage, createScheduledMessage, createStatus as createStatusRequest, createTextMessage, createVoiceMessage, createVoiceRoomConversation, declineGroupInvite as declineGroupInviteRequest, deleteAccount as deleteAccountRequest, deleteCallMessageByCallId as deleteCallMessageByCallIdRequest, deleteContact as deleteContactRequest, deleteConversation as deleteConversationRequest, deleteConversationForAnyone as deleteConversationForAnyoneRequest, deleteGroup as deleteGroupRequest, deleteMessage as deleteMessageRequest, deleteScheduledMessage as deleteScheduledMessageRequest, deleteStatus as deleteStatusRequest, editMessage as editMessageRequest, getCatalogConfig, getHelpConfig, getMe, getStatusSummary, getSubscriptionStatus as getSubscriptionStatusRequest, listBlockedUsers, listBulkMessageDeletions, listBulkMessageStatusUpdates, listContacts, listConversations, listMessageDeletions, listMessageEdits, listMessages, listMessageStatusUpdates, listStatuses, login, markAllConversationsRead, markConversationRead, markStatusViewed as markStatusViewedRequest, openDisappearingMessage as openDisappearingMessageRequest, reactToMessage as reactToMessageRequest, register, removeGroupMember as removeGroupMemberRequest, replyToStatus as replyToStatusRequest, reportContent, revokeGroupAdmin as revokeGroupAdminRequest, transferGroupOwnership as transferGroupOwnershipRequest, unblockUser, updateConversationMute as updateConversationMuteRequest, updateDisappearingMessages as updateDisappearingMessagesRequest, updateGroupAlias as updateGroupAliasRequest, updateGroupAvatar as updateGroupAvatarRequest, updateGroupSettings as updateGroupSettingsRequest, updateGroupTitle as updateGroupTitleRequest, updateMyAvatar, updateMyPassword, updateMyProfile, updatePrivacy as updatePrivacyRequest, uploadMediaFile } from '../lib/backend';
import type { ConversationMuteDurationMinutes } from '../lib/conversationMute';
import type { ConversationListFilter } from '../lib/conversationList';
import type { DisappearingMessagesDurationMinutes } from '../lib/disappearingMessages';
import type { MessageDeletionUpdate, MessageEdit, MessageReactionUpdate, MessageStatusUpdate, StatusGroup, StatusKind } from '../lib/backend';
import { formatConversationActivityTime } from '../lib/format';
import { downloadRemoteMediaFile, getMessageMediaCacheUri, isLocalMediaFileComplete, removePartialMediaDownloadsForMessages, resolveCachedMessageMediaUri, resolveLocalMediaFileUri, sanitizeCacheFileName } from '../lib/mediaCache';
import { logMessageDeliveryDiagnostic, refreshRemoteMessageDeliveryDiagnostics } from '../lib/messageDeliveryDiagnostics';
import { dismissAllMessageNotifications, dismissMessageNotificationsForConversation } from '../lib/messageNotifications';
import { clearAuthToken, clearDeletedConversationAfter, clearStoredConversations, clearStoredSubscriptionStatus, clearStoredUser, eraseLocalAppData, eraseLocalChatData, getAuthToken, getDeletedConversationAfter, getServerUrl, getStoredCallLogs, getStoredConversations, getStoredDarkMode, getStoredDecoyOffline, getStoredErasePinDeletePeers, getStoredLanguage, getStoredLatestMessagesByConversationIds, getStoredMessages, getStoredMessagesByIds, getStoredOlderMessages, getStoredRecentMessages, getStoredSubscriptionStatus, getStoredUser, removeStoredMessageRecords, removeStoredMessages, setAuthToken, setDeletedConversationAfter, setServerUrl, setStoredCallLogs, setStoredConversations, setStoredDarkMode, setStoredDecoyOffline, setStoredLanguage, setStoredSubscriptionStatus, setStoredUser, upsertStoredMessages } from '../lib/storage';
import { createBypassSubscriptionStatus, createEmptySubscriptionStatus, hasPremiumAccess, isSubscriptionBypassed } from '../lib/subscriptionAccess';
import { clearNativeQuickReplyCredentials, setNativeQuickReplyCredentials } from '../native/CallNative';
import { setActiveCallSession } from '../lib/activeCallSession';
import { AuthUser, CallLog, Conversation, Message, SubscriptionStatus } from '../types/domain';

const CONVERSATION_PAGE_SIZE = 100;
const CONVERSATION_PERSIST_DEBOUNCE_MS = 700;
const RECEIPT_BATCH_DELAY_MS = 80;
const LOW_PRIORITY_CONVERSATION_MAINTENANCE_DELAY_MS = 10_000;
const LOW_PRIORITY_MESSAGE_MAINTENANCE_DELAY_MS = 6_000;
const LOW_PRIORITY_MEDIA_CACHE_DELAY_MS = 8_000;
let conversationsRequest: { filter: ConversationListFilter; offset: number; promise: Promise<void>; query: string } | null = null;
const messageRequests = new Map<string, Promise<void>>();
const messageCacheRequests = new Map<string, Promise<void>>();
const olderLocalMessageRequests = new Map<string, Promise<number>>();
const pendingMessageMaintenanceCancelByConversation = new Map<string, () => void>();
const olderLocalMessagesExhaustedBeforeByConversation = new Map<string, number>();
const uploadControllers = new Map<string, AbortController>();
const incomingMediaCacheRequests = new Map<string, Promise<Message | null>>();
const queuedIncomingMediaCacheIds = new Set<string>();
const incomingMediaCacheQueue: Message[] = [];
let isIncomingMediaCacheQueueRunning = false;
const pendingReadCallIdsByConversation = new Map<string, Set<string>>();
const deliverySyncConversationIds = new Set<string>();
const deletionSyncConversationIds = new Set<string>();
const statusUpdateSyncConversationIds = new Set<string>();
const localReadThroughByConversation = new Map<string, number>();
const locallyClearedAfterByConversation = new Map<string, number>();
const resolvedLocalClearBoundaryConversationIds = new Set<string>();
const locallyDeletedMessageIdsByConversation = new Map<string, Set<string>>();
const locallyDeletedMessageKeysByConversation = new Map<string, Set<string>>();
let pendingConversationMaintenanceCancel: (() => void) | null = null;

function scheduleLowPriorityStoreTask(callback: () => void, delayMs = 0) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const interaction = InteractionManager.runAfterInteractions(() => {
    timeout = setTimeout(callback, delayMs);
  });

  return () => {
    interaction.cancel();
    if (timeout) {
      clearTimeout(timeout);
    }
  };
}

function scheduleConversationMaintenance(serverUrl: string, conversations: Conversation[]) {
  pendingConversationMaintenanceCancel?.();
  pendingConversationMaintenanceCancel = scheduleLowPriorityStoreTask(() => {
    pendingConversationMaintenanceCancel = null;
    void (async () => {
      await syncMissingOwnPreviewMessages(serverUrl, conversations);
      await new Promise((resolve) => setTimeout(resolve, 800));
      await syncIncomingConversationDeliveries(serverUrl, conversations);
      await new Promise((resolve) => setTimeout(resolve, 800));
      await syncPendingMessageDeletionsForConversations(serverUrl, conversations);
      await new Promise((resolve) => setTimeout(resolve, 800));
      await syncPendingMessageStatusUpdatesForConversations(serverUrl, conversations);
      await new Promise((resolve) => setTimeout(resolve, 800));
      resumeLoadedIncomingMediaCaching();
    })().catch(() => undefined);
  }, LOW_PRIORITY_CONVERSATION_MAINTENANCE_DELAY_MS);
}

async function syncMissingOwnPreviewMessages(serverUrl: string, conversations: Conversation[]) {
  const currentUserId = useAppStore.getState().user?.id;

  if (!currentUserId || conversations.length === 0 || NativeAppState.currentState !== 'active') {
    return;
  }

  const candidateConversations = conversations
    .filter((conversation) => (
      conversation.myGroupInvitePending !== true &&
      conversation.lastMessageSenderId === currentUserId &&
      !!conversation.lastMessageId &&
      !messageRequests.has(conversation.id)
    ))
    .slice(0, 8);

  if (candidateConversations.length === 0) {
    return;
  }

  let latestStoredMessages: Map<string, Message>;

  try {
    latestStoredMessages = await getStoredLatestMessagesByConversationIds(candidateConversations.map((conversation) => conversation.id));
  } catch {
    return;
  }

  const missingConversations = candidateConversations.filter((conversation) => {
    const previewMessageId = conversation.lastMessageId;

    if (!previewMessageId) {
      return false;
    }

    const liveMessages = useAppStore.getState().messagesByConversation[conversation.id] ?? [];
    const hasLiveMessage = liveMessages.some((message) => message.id === previewMessageId);
    const latestStoredMessage = latestStoredMessages.get(conversation.id);
    const hasStoredMessage = latestStoredMessage?.id === previewMessageId;

    return !hasLiveMessage && !hasStoredMessage;
  });

  if (missingConversations.length === 0) {
    return;
  }

  logMessageDeliveryDiagnostic('own-preview-recovery-start', {
    conversations: missingConversations.map((conversation) => ({
      conversationId: conversation.id,
      lastMessageId: conversation.lastMessageId,
    })),
  });

  await Promise.allSettled(missingConversations.map((conversation) => (
    requestConversationMessages(conversation.id, serverUrl, { hydrate: false })
  )));
}

function scheduleMessagePostLoadMaintenance(
  serverUrl: string,
  conversationId: string,
  messages: Message[],
  messagesToPersist: Message[],
) {
  pendingMessageMaintenanceCancelByConversation.get(conversationId)?.();
  pendingMessageMaintenanceCancelByConversation.set(conversationId, scheduleLowPriorityStoreTask(() => {
    pendingMessageMaintenanceCancelByConversation.delete(conversationId);
    void (async () => {
      await persistChangedConversationMessages(conversationId, messagesToPersist);
      logMessageDeliveryDiagnostic('load-messages-persisted', {
        ackCandidateCount: messages.length,
        conversationId,
        persistedCount: messagesToPersist.length,
        tailIds: messagesToPersist.slice(-10).map((message) => message.id),
      });
      scheduleIncomingMediaCaching(messages);
      const ackableMessageIds = await getContentAckableMessageIds(messages, useAppStore.getState().user?.id);

      if (ackableMessageIds.length > 0) {
        logMessageDeliveryDiagnostic('load-messages-content-ack-start', {
          conversationId,
          messageCount: ackableMessageIds.length,
          messageIds: ackableMessageIds.slice(-10),
        });
        void acknowledgeMessageContent(serverUrl, conversationId, ackableMessageIds)
          .then(() => {
            logMessageDeliveryDiagnostic('load-messages-content-ack-finished', {
              conversationId,
              messageCount: ackableMessageIds.length,
              messageIds: ackableMessageIds.slice(-10),
            });
          })
          .catch((error) => {
            logMessageDeliveryDiagnostic('load-messages-content-ack-failed', {
              conversationId,
              message: error instanceof Error ? error.message : String(error),
              messageCount: ackableMessageIds.length,
              messageIds: ackableMessageIds.slice(-10),
            });
          });
      }

      void syncPendingMessageStatusUpdates(serverUrl, conversationId).catch(() => undefined);
    })().catch((error) => {
      logMessageDeliveryDiagnostic('load-messages-maintenance-failed', {
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, LOW_PRIORITY_MESSAGE_MAINTENANCE_DELAY_MS));
}
const uploadProgressSnapshots = new Map<string, { ratio: number; updatedAt: number }>();
let storedConversationsPersistTimer: ReturnType<typeof setTimeout> | null = null;
let storedConversationsPersistPromise: Promise<void> | null = null;
const pendingDeliveredReceiptBatches = new Map<string, { conversationId: string; delivererId: string; messageIds: Set<string> }>();
const pendingReadReceiptBatches = new Map<string, { conversationId: string; messageIds: Set<string>; messageKeys: Set<string>; readAt?: string; readerId: string }>();
let deliveredReceiptBatchTimer: ReturnType<typeof setTimeout> | null = null;
let readReceiptBatchTimer: ReturnType<typeof setTimeout> | null = null;
const UPLOAD_PROGRESS_MIN_INTERVAL_MS = 250;
const UPLOAD_PROGRESS_MIN_RATIO_DELTA = 0.05;
const MAX_AUTOMATIC_INCOMING_MEDIA_CACHE_MESSAGES = 6;

type UploadProgress = { sentBytes: number; totalBytes: number };

function publishUploadProgress(messageId: string, progress: UploadProgress, options?: { force?: boolean }) {
  const totalBytes = Math.max(0, progress.totalBytes);
  const sentBytes = Math.min(Math.max(0, progress.sentBytes), totalBytes || progress.sentBytes);
  const ratio = totalBytes > 0 ? sentBytes / totalBytes : 0;
  const now = Date.now();
  const previous = uploadProgressSnapshots.get(messageId);

  if (
    !options?.force &&
    ratio < 1 &&
    previous &&
    now - previous.updatedAt < UPLOAD_PROGRESS_MIN_INTERVAL_MS &&
    ratio - previous.ratio < UPLOAD_PROGRESS_MIN_RATIO_DELTA
  ) {
    return;
  }

  uploadProgressSnapshots.set(messageId, { ratio, updatedAt: now });
  useAppStore.setState((state) => {
    const current = state.uploadProgressByMessageId[messageId];

    if (current?.sentBytes === sentBytes && current?.totalBytes === totalBytes) {
      return state;
    }

    return {
      uploadProgressByMessageId: {
        ...state.uploadProgressByMessageId,
        [messageId]: { sentBytes, totalBytes },
      },
    };
  });
}

function clearUploadProgress(messageId: string) {
  uploadProgressSnapshots.delete(messageId);
  useAppStore.setState((state) => {
    if (!state.uploadProgressByMessageId[messageId]) {
      return state;
    }

    return {
      uploadProgressByMessageId: omitRecordKey(state.uploadProgressByMessageId, messageId),
    };
  });
}

export type AppState = {
  isBootstrapping: boolean;
  isCheckingSubscription: boolean;
  isDarkMode: boolean;
  isDarkModeManual: boolean;
  hasLoadedConversations: boolean;
  isLoadingConversations: boolean;
  hasMoreConversations: boolean;
  isLoadingMoreConversations: boolean;
  conversationsNextOffset: number;
  conversationsQuery: string;
  conversationsFilter: ConversationListFilter;
  conversationsLastFetchedAt: number;
  totalUnreadConversations: number;
  isRefreshingConversations: boolean;
  isDecoyOffline: boolean;
  language: AppLanguage;
  languagePreference: LanguagePreference;
  connectionStatus: 'online' | 'offline' | 'unknown';
  connectionNotice: string | null;
  serverUrl: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  user: AuthUser | null;
  conversations: Conversation[];
  blockedUsers: AuthUser[];
  callLogs: CallLog[];
  catalogUrl: string | null;
  catalogUrlLoadError: string | null;
  helpUrl: string | null;
  helpUrlLoadError: string | null;
  isLoadingCatalogUrl: boolean;
  isLoadingHelpUrl: boolean;
  contacts: AuthUser[];
  statusGroups: StatusGroup[];
  hasUnviewedStatuses: boolean;
  isLoadingStatuses: boolean;
  messagesByConversation: Record<string, Message[]>;
  uploadProgressByMessageId: Record<string, { sentBytes: number; totalBytes: number }>;
  bootstrap: () => Promise<void>;
  cancelUpload: (messageId: string) => void;
  clearConnectionNotice: () => void;
  setDarkMode: (isDarkMode: boolean) => Promise<void>;
  setLanguagePreference: (languagePreference: LanguagePreference) => Promise<void>;
  syncSystemDarkMode: (isDarkMode: boolean) => void;
  setDecoyOfflineMode: (isDecoyOffline: boolean) => Promise<void>;
  saveServerUrl: (serverUrl: string) => Promise<void>;
  signInWithPassword: (username: string, password: string) => Promise<void>;
  registerWithPassword: (displayName: string, username: string, password: string) => Promise<void>;
  deleteAccountForever: (password: string) => Promise<void>;
  wipeChatsOnlyData: (preservePeerConversationIds?: string[]) => Promise<void>;
  loadConversations: (query?: string, filter?: ConversationListFilter, options?: { refresh?: boolean }) => Promise<void>;
  loadMoreConversations: (query?: string, filter?: ConversationListFilter) => Promise<void>;
  loadMessages: (conversationId: string, options?: { hydrate?: boolean }) => Promise<void>;
  loadOlderLocalMessages: (conversationId: string, options?: { limit?: number }) => Promise<number>;
  prepareConversationMessages: (conversationId: string, options?: { limit?: number }) => Promise<void>;
  releaseConversationHistory: (conversationId: string) => void;
  markConversationReadNow: (conversationId: string) => Promise<void>;
  markAllConversationsReadNow: () => Promise<void>;
  sendTextMessage: (conversationId: string, body: string, clientId?: string, metadata?: Message['metadata']) => Promise<Message>;
  scheduleTextMessage: (conversationId: string, body: string, sendAt: string, clientTimezone?: string, metadata?: Message['metadata']) => Promise<Message>;
  scheduleMediaMessage: (input: { body?: string; clientTimezone?: string; conversationId: string; durationSeconds?: number; fileName: string; kind: 'image' | 'video' | 'file'; metadata?: Message['metadata']; mimeType: string; sendAt: string; sizeBytes: number; uri: string }) => Promise<Message>;
  openDisappearingMessage: (conversationId: string, messageId: string, secondsAfterView?: number) => Promise<void>;
  reactToMessage: (conversationId: string, messageId: string, emoji: string | null) => Promise<void>;
  applyMessageReaction: (reaction: MessageReactionUpdate) => void;
  forwardMessage: (conversationId: string, message: Message) => Promise<Message>;
  addOptimisticMessage: (message: Message) => void;
  sendMediaMessage: (input: { clientId?: string; conversationId: string; body?: string; durationSeconds?: number; fileName: string; kind: 'image' | 'video' | 'file'; metadata?: Message['metadata']; mimeType: string; sizeBytes: number; uri: string }) => Promise<Message>;
  sendVoiceMessage: (input: { clientId?: string; conversationId: string; durationSeconds: number; fileName: string; mimeType: string; sizeBytes: number; uri: string }) => Promise<Message>;
  editMessage: (conversationId: string, messageId: string, body: string) => Promise<Message>;
  deleteMessage: (conversationId: string, messageId: string, mode: 'me' | 'all') => Promise<void>;
  deleteChat: (conversationId: string, mode?: 'me' | 'all') => Promise<void>;
  removeChatLocally: (conversationId: string) => Promise<void>;
  clearLocalChat: (conversationId: string) => Promise<void>;
  updateConversationMute: (conversationId: string, muted: boolean, durationMinutes?: ConversationMuteDurationMinutes) => Promise<void>;
  updateDisappearingMessages: (conversationId: string, durationMinutes: DisappearingMessagesDurationMinutes | null) => Promise<void>;
  reportTarget: (input: { conversationId?: string; reason?: string; targetId: string; targetType: 'USER' | 'MESSAGE' | 'GROUP' }) => Promise<void>;
  updateAvatar: (avatarUrl: string | null) => Promise<void>;
  updatePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  updateProfile: (input: { displayName?: string; username?: string }) => Promise<void>;
  updatePrivacy: (input: { hideFromSearch?: boolean; hideNickname?: boolean; onlyContactsCanCall?: boolean; preventPeerScreenshots?: boolean; showLastSeen?: boolean; useGroupAliases?: boolean }) => Promise<void>;
  updateCurrentUser: (user: AuthUser) => void;
  updateUserPresence: (input: { isOnline: boolean; lastSeenAt?: string | null; showLastSeen?: boolean; userId: string }) => void;
  updateGroupAvatar: (conversationId: string, avatarUrl: string | null) => Promise<void>;
  updateGroupAlias: (conversationId: string, aliasName: string | null) => Promise<Conversation>;
  declineGroupInvite: (conversationId: string, input: { blockGroup?: boolean; reportGroup?: boolean }) => Promise<void>;
  addGroupMembers: (conversationId: string, userIds: string[]) => Promise<Conversation>;
  addGroupAdmins: (conversationId: string, userIds: string[]) => Promise<Conversation>;
  deleteGroup: (conversationId: string) => Promise<void>;
  removeGroupMember: (conversationId: string, userId: string) => Promise<Conversation>;
  revokeGroupAdmin: (conversationId: string, userId: string) => Promise<Conversation>;
  transferGroupOwnership: (conversationId: string, userId: string) => Promise<Conversation>;
  updateGroupSettings: (conversationId: string, input: { hideMembers?: boolean; isPublic?: boolean; ownerOnlyMessages?: boolean; preventMediaSave?: boolean; preventScreenshots?: boolean; showAdmins?: boolean; showMemberCount?: boolean }) => Promise<Conversation>;
  updateGroupTitle: (conversationId: string, title: string) => Promise<Conversation>;
  addUserToContacts: (userId: string) => Promise<void>;
  blockUserById: (userId: string) => Promise<void>;
  deleteContactById: (userId: string) => Promise<void>;
  loadContacts: () => Promise<void>;
  loadStatuses: () => Promise<void>;
  refreshStatusSummary: () => Promise<void>;
  createTextStatus: (body: string, backgroundColor?: string | null, audienceInput?: { audience?: 'CONTACTS' | 'CONTACTS_EXCEPT' | 'ONLY_SHARE_WITH'; exceptUserIds?: string[]; onlyUserIds?: string[] }) => Promise<void>;
  createMediaStatus: (input: { audience?: 'CONTACTS' | 'CONTACTS_EXCEPT' | 'ONLY_SHARE_WITH'; body?: string; durationSeconds?: number; exceptUserIds?: string[]; fileName: string; kind: 'image' | 'video'; mimeType: string; onlyUserIds?: string[]; sizeBytes?: number; uri: string }) => Promise<void>;
  markStatusViewed: (statusId: string) => Promise<void>;
  deleteStatusById: (statusId: string) => Promise<void>;
  replyToStatus: (statusId: string, body: string) => Promise<void>;
  loadBlockedUsers: () => Promise<void>;
  loadCatalogUrl: () => Promise<string | null>;
  loadHelpUrl: () => Promise<string | null>;
  unblockUserById: (userId: string) => Promise<void>;
  refreshSubscriptionStatus: () => Promise<SubscriptionStatus>;
  setSubscriptionStatus: (subscriptionStatus: SubscriptionStatus) => Promise<void>;
  loadCallLogs: () => Promise<void>;
  recordCallLog: (callLog: Omit<CallLog, 'happenedAt' | 'happenedAtIso'>) => Promise<void>;
  deleteCallLog: (callLogId: string, mode?: 'me' | 'all') => Promise<void>;
  startDirectConversation: (userId: string) => Promise<Conversation>;
  startGroupConversation: (input: { title: string; userIds: string[] }) => Promise<Conversation>;
  startVoiceRoomConversation: (input: { title: string; userIds: string[] }) => Promise<Conversation>;
  receiveMessage: (message: Message) => void;
  cacheDownloadedMessageMedia: (conversationId: string, messageId: string, localUri: string, remoteUri?: string | null) => Promise<void>;
  applyMessageEdit: (edit: MessageEdit) => boolean;
  removeMessage: (conversationId: string, messageId: string) => void;
  markCallMessageReadByCallId: (conversationId: string, callId: string, readerId: string) => void;
  markConversationMessagesDelivered: (conversationId: string, delivererId: string, messageIds?: string[]) => void;
  markConversationMessagesRead: (conversationId: string, readerId: string, readAt?: string, messageIds?: string[], messageKeys?: string[]) => void;
  signOut: () => Promise<void>;
};

export const useAppStore: UseBoundStore<StoreApi<AppState>> = create<AppState>((set) => ({
  blockedUsers: [],
  callLogs: [],
  catalogUrl: null,
  catalogUrlLoadError: null,
  helpUrl: null,
  helpUrlLoadError: null,
  contacts: [],
  statusGroups: [],
  hasUnviewedStatuses: false,
  isLoadingStatuses: false,
  connectionNotice: null,
  connectionStatus: 'unknown',
  conversations: [],
  conversationsNextOffset: 0,
  conversationsQuery: '',
  conversationsFilter: 'all',
  conversationsLastFetchedAt: 0,
  totalUnreadConversations: 0,
  isRefreshingConversations: false,
  hasLoadedConversations: false,
  hasMoreConversations: false,
  isBootstrapping: true,
  isCheckingSubscription: false,
  isDarkMode: Appearance.getColorScheme() === 'dark',
  isDarkModeManual: false,
  isDecoyOffline: false,
  isLoadingConversations: false,
  isLoadingMoreConversations: false,
  isLoadingCatalogUrl: false,
  isLoadingHelpUrl: false,
  language: resolveLanguage('system'),
  languagePreference: 'system',
  messagesByConversation: {},
  serverUrl: null,
  subscriptionStatus: null,
  uploadProgressByMessageId: {},
  user: null,

  async bootstrap() {
    const [serverUrl, storedUser, token, storedConversations, storedDarkMode, storedLanguage, storedSubscriptionStatus, storedDecoyOffline] = await Promise.all([
      getServerUrl(),
      getStoredUser<AuthUser>(),
      getAuthToken(),
      getStoredConversations(),
      getStoredDarkMode(),
      getStoredLanguage(),
      getStoredSubscriptionStatus(),
      getStoredDecoyOffline(),
    ]);
    const languagePreference: LanguagePreference = isLanguagePreference(storedLanguage)
      ? storedLanguage
      : 'system';
    const language = resolveLanguage(languagePreference);
    const systemIsDarkMode = Appearance.getColorScheme() === 'dark';
    const isSignedOutInSystemDarkMode = !storedUser && systemIsDarkMode;
    const isDarkModeManual = !isSignedOutInSystemDarkMode && storedDarkMode !== null;
    const isDarkMode = isSignedOutInSystemDarkMode ? true : storedDarkMode ?? systemIsDarkMode;
    const storedSubscriptionStatusToUse = isSubscriptionStatusUsable(storedSubscriptionStatus)
      ? storedSubscriptionStatus
      : null;
    const callLogs = storedUser ? await getStoredCallLogs() : [];
    const visibleStoredConversations = sortConversationsByActivity(dedupeConversations(storedConversations.filter(isVisibleConversation)));
    const storedConversationsLoadedAt = visibleStoredConversations.length > 0 ? Date.now() : 0;

    setI18nLanguage(language);

    set({
      callLogs,
      conversations: visibleStoredConversations,
      conversationsNextOffset: visibleStoredConversations.length,
      conversationsQuery: '',
      conversationsFilter: 'all',
      conversationsLastFetchedAt: storedConversationsLoadedAt,
      totalUnreadConversations: visibleStoredConversations.filter((conversation) => conversation.unreadCount > 0 || conversation.myGroupInvitePending).length,
      hasLoadedConversations: visibleStoredConversations.length > 0,
      hasMoreConversations: visibleStoredConversations.length >= CONVERSATION_PAGE_SIZE,
      isBootstrapping: false,
      isCheckingSubscription: false,
      isDecoyOffline: storedDecoyOffline,
      isDarkMode,
      isDarkModeManual,
      language,
      languagePreference,
      serverUrl,
      subscriptionStatus: storedSubscriptionStatusToUse,
      user: storedUser,
    });
    if (visibleStoredConversations.length > 0) {
      void setStoredConversations(visibleStoredConversations);
      scheduleLowPriorityStoreTask(() => {
        void repairConversationPreviewsWithStoredMessages(visibleStoredConversations)
          .then((repairedConversations) => {
            if (repairedConversations === visibleStoredConversations) {
              return;
            }

            set({
              conversations: repairedConversations,
              conversationsNextOffset: repairedConversations.length,
              totalUnreadConversations: repairedConversations.filter((conversation) => conversation.unreadCount > 0 || conversation.myGroupInvitePending).length,
            });
            void setStoredConversations(repairedConversations);
          })
          .catch(() => undefined);
      }, 1500);
    }

    if (serverUrl && token && storedUser && !storedDecoyOffline) {
      setNativeQuickReplyCredentials(serverUrl, token);
      void getMe(serverUrl)
        .then(async (response) => {
          await setStoredUser(response.user);
          const wasOffline = useAppStore.getState().connectionStatus === 'offline';
          set({ connectionNotice: wasOffline ? t('connectionRecovered') : null, connectionStatus: 'online', user: response.user });
          await useAppStore.getState().refreshSubscriptionStatus();
          void refreshRemoteMessageDeliveryDiagnostics().catch(() => undefined);
          void useAppStore.getState().loadCatalogUrl().catch(() => undefined);
          void useAppStore.getState().loadHelpUrl().catch(() => undefined);
          void useAppStore.getState().loadConversations('', 'all').catch(() => undefined);
        })
        .catch(async (error) => {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            await Promise.all([clearAuthToken(), clearStoredUser(), clearStoredSubscriptionStatus()]);
            clearNativeQuickReplyCredentials();
            set({ blockedUsers: [], callLogs: [], catalogUrl: null, helpUrl: null, contacts: [], conversations: [], conversationsNextOffset: 0, conversationsQuery: '', hasLoadedConversations: false, hasMoreConversations: false, isCheckingSubscription: false, isLoadingMoreConversations: false, messagesByConversation: {}, subscriptionStatus: null, user: null });
            return;
          }

          set({ connectionNotice: t('noConnectionMessagesSync'), connectionStatus: 'offline', isCheckingSubscription: false });
        });
    } else {
      clearNativeQuickReplyCredentials();
    }
  },

  clearConnectionNotice() {
    set({ connectionNotice: null });
  },

  cancelUpload(messageId) {
    uploadControllers.get(messageId)?.abort();
    clearUploadProgress(messageId);
  },

  async setDarkMode(isDarkMode) {
    await setStoredDarkMode(isDarkMode);
    set({ isDarkMode, isDarkModeManual: true });
  },

  async setLanguagePreference(languagePreference) {
    await setStoredLanguage(languagePreference);
    const language = resolveLanguage(languagePreference);
    setI18nLanguage(language);
    set({ language, languagePreference });
  },

  syncSystemDarkMode(isDarkMode) {
    if (useAppStore.getState().isDarkModeManual) {
      return;
    }

    set({ isDarkMode });
  },

  async setDecoyOfflineMode(isDecoyOffline) {
    if (isDecoyOffline) {
      conversationsRequest = null;
      messageRequests.clear();
      messageCacheRequests.clear();
      olderLocalMessageRequests.clear();
      olderLocalMessagesExhaustedBeforeByConversation.clear();
      uploadControllers.forEach((controller) => controller.abort());
      uploadControllers.clear();
      clearNativeQuickReplyCredentials();
      set({
        blockedUsers: [],
        catalogUrl: null,
        helpUrl: null,
        connectionNotice: null,
        connectionStatus: 'unknown',
        contacts: [],
        conversations: [],
        conversationsNextOffset: 0,
        conversationsQuery: '',
        hasLoadedConversations: true,
        hasMoreConversations: false,
        isDecoyOffline: true,
        isLoadingConversations: false,
        isLoadingMoreConversations: false,
        messagesByConversation: {},
      });
      await Promise.all([
        setStoredDecoyOffline(true),
        clearStoredConversations(),
      ]);
      return;
    }

    await setStoredDecoyOffline(false);
    const [serverUrl, token, user] = await Promise.all([
      getServerUrl(),
      getAuthToken(),
      getStoredUser<AuthUser>(),
    ]);

    if (serverUrl && token && user) {
      setNativeQuickReplyCredentials(serverUrl, token);
    }

    set({
      connectionNotice: null,
      connectionStatus: 'unknown',
      isDecoyOffline: false,
    });

    void useAppStore.getState().loadConversations().catch(() => undefined);
    void useAppStore.getState().loadContacts().catch(() => undefined);
    void useAppStore.getState().refreshStatusSummary().catch(() => undefined);
    void useAppStore.getState().loadBlockedUsers().catch(() => undefined);
    void useAppStore.getState().loadCatalogUrl().catch(() => undefined);
    void useAppStore.getState().loadHelpUrl().catch(() => undefined);
  },

  async saveServerUrl(serverUrl) {
    await setServerUrl(serverUrl);
    const token = await getAuthToken();

    if (token) {
      setNativeQuickReplyCredentials(serverUrl, token);
    }

    set({ serverUrl });
  },

  async signInWithPassword(username, password) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const response = await login(serverUrl, { password, username });

    await Promise.all([
      clearStoredConversations(),
      setStoredCallLogs([]),
      setAuthToken(response.token),
      setStoredUser(response.user),
    ]);
    setNativeQuickReplyCredentials(serverUrl, response.token);

    locallyClearedAfterByConversation.clear();
    resolvedLocalClearBoundaryConversationIds.clear();
    olderLocalMessageRequests.clear();
    olderLocalMessagesExhaustedBeforeByConversation.clear();
    setActiveCallSession(null);
    set({
      blockedUsers: [],
      callLogs: [],
      catalogUrl: null,
      helpUrl: null,
      contacts: [],
      conversations: [],
      conversationsNextOffset: 0,
      conversationsQuery: '',
      hasLoadedConversations: false,
      hasMoreConversations: false,
      isCheckingSubscription: true,
      isLoadingMoreConversations: false,
      messagesByConversation: {},
      subscriptionStatus: null,
      user: response.user,
    });
    try {
      await useAppStore.getState().refreshSubscriptionStatus();
      void refreshRemoteMessageDeliveryDiagnostics().catch(() => undefined);
      void useAppStore.getState().loadCatalogUrl().catch(() => undefined);
      void useAppStore.getState().loadHelpUrl().catch(() => undefined);
    } catch {
      set({ connectionNotice: t('noConnectionMessagesSync'), connectionStatus: 'offline' });
    }
  },

  async registerWithPassword(displayName, username, password) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const response = await register(serverUrl, { displayName, password, username });

    await Promise.all([
      clearStoredConversations(),
      setStoredCallLogs([]),
      setAuthToken(response.token),
      setStoredUser(response.user),
    ]);
    setNativeQuickReplyCredentials(serverUrl, response.token);

    locallyClearedAfterByConversation.clear();
    resolvedLocalClearBoundaryConversationIds.clear();
    olderLocalMessageRequests.clear();
    olderLocalMessagesExhaustedBeforeByConversation.clear();
    setActiveCallSession(null);
    set({
      blockedUsers: [],
      callLogs: [],
      catalogUrl: null,
      helpUrl: null,
      contacts: [],
      conversations: [],
      conversationsNextOffset: 0,
      conversationsQuery: '',
      hasLoadedConversations: false,
      hasMoreConversations: false,
      isCheckingSubscription: true,
      isLoadingMoreConversations: false,
      messagesByConversation: {},
      subscriptionStatus: null,
      user: response.user,
    });
    try {
      await useAppStore.getState().refreshSubscriptionStatus();
      void refreshRemoteMessageDeliveryDiagnostics().catch(() => undefined);
      void useAppStore.getState().loadCatalogUrl().catch(() => undefined);
      void useAppStore.getState().loadHelpUrl().catch(() => undefined);
    } catch {
      set({ connectionNotice: t('noConnectionMessagesSync'), connectionStatus: 'offline' });
    }
  },

  async deleteAccountForever(password) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await deleteAccountRequest(serverUrl, password);
    await clearLocalSession();
    set({ blockedUsers: [], callLogs: [], catalogUrl: null, helpUrl: null, contacts: [], conversations: [], conversationsNextOffset: 0, conversationsQuery: '', hasLoadedConversations: false, hasMoreConversations: false, isCheckingSubscription: false, isLoadingMoreConversations: false, messagesByConversation: {}, subscriptionStatus: null, user: null });
  },

  async wipeChatsOnlyData(preservePeerConversationIds = []) {
    const { conversations, serverUrl } = useAppStore.getState();
    const conversationsToDelete = conversations.length > 0 ? conversations : await getStoredConversations();
    const shouldDeleteOnPeers = await getStoredErasePinDeletePeers();
    const preservedPeerConversationIds = new Set(preservePeerConversationIds);

    if (serverUrl && conversationsToDelete.length > 0) {
      const directConversationIds = conversationsToDelete
        .filter((conversation) => conversation.type !== 'GROUP' && !preservedPeerConversationIds.has(conversation.id))
        .map((conversation) => conversation.id);
      const selfOnlyConversationIds = conversationsToDelete
        .filter((conversation) => preservedPeerConversationIds.has(conversation.id) || !shouldDeleteOnPeers || conversation.type === 'GROUP')
        .map((conversation) => conversation.id);
      const bulkDeleteRequests: Promise<unknown>[] = [];

      if (shouldDeleteOnPeers && directConversationIds.length > 0) {
        bulkDeleteRequests.push(bulkDeleteConversations(serverUrl, {
          conversationIds: directConversationIds,
          mode: 'all',
        }));
      }

      if (selfOnlyConversationIds.length > 0) {
        bulkDeleteRequests.push(bulkDeleteConversations(serverUrl, {
          conversationIds: selfOnlyConversationIds,
          mode: 'me',
        }));
      }

      await Promise.allSettled(bulkDeleteRequests);
    }

    await eraseLocalChatData();
    conversationsRequest = null;
    messageRequests.clear();
    messageCacheRequests.clear();
    olderLocalMessageRequests.clear();
    olderLocalMessagesExhaustedBeforeByConversation.clear();
    locallyClearedAfterByConversation.clear();
    resolvedLocalClearBoundaryConversationIds.clear();
    uploadControllers.forEach((controller) => controller.abort());
    uploadControllers.clear();
    set({
      callLogs: [],
      contacts: [],
      blockedUsers: [],
      conversations: [],
      conversationsNextOffset: 0,
      conversationsQuery: '',
      hasLoadedConversations: false,
      hasMoreConversations: false,
      isLoadingMoreConversations: false,
      messagesByConversation: {},
      uploadProgressByMessageId: {},
    });
  },

  async loadConversations(query = '', filter?: ConversationListFilter, options?: { refresh?: boolean }) {
    const { conversationsFilter, isDecoyOffline, serverUrl } = useAppStore.getState();
    const normalizedQuery = query.trim();
    const normalizedFilter = filter ?? conversationsFilter;
    const serverFilter = normalizedFilter === 'favorites' ? 'all' : normalizedFilter;

    logMessageDeliveryDiagnostic('load-conversations-start', {
      currentCount: useAppStore.getState().conversations.length,
      filter: normalizedFilter,
      hasLoadedConversations: useAppStore.getState().hasLoadedConversations,
      query: normalizedQuery,
      refresh: options?.refresh === true,
    });

    if (isDecoyOffline) {
      logMessageDeliveryDiagnostic('load-conversations-skipped-decoy', {
        filter: normalizedFilter,
        query: normalizedQuery,
      });
      set({
        connectionNotice: null,
        connectionStatus: 'unknown',
        conversationsFilter: normalizedFilter,
        conversationsNextOffset: 0,
        conversationsQuery: normalizedQuery,
        hasLoadedConversations: true,
        hasMoreConversations: false,
        isLoadingConversations: false,
        isLoadingMoreConversations: false,
        isRefreshingConversations: false,
      });
      return;
    }

    if (!serverUrl) {
      logMessageDeliveryDiagnostic('load-conversations-skipped-no-server-url', {
        filter: normalizedFilter,
        query: normalizedQuery,
      });
      return;
    }

    if (
      conversationsRequest?.query === normalizedQuery &&
      conversationsRequest.filter === normalizedFilter &&
      conversationsRequest.offset === 0 &&
      !options?.refresh
    ) {
      logMessageDeliveryDiagnostic('load-conversations-deduped-existing-request', {
        filter: normalizedFilter,
        query: normalizedQuery,
      });
      return conversationsRequest.promise;
    }

    const shouldShowInitialLoading = useAppStore.getState().conversations.length === 0 && !useAppStore.getState().hasLoadedConversations;

    set({
      conversationsFilter: normalizedFilter,
      isLoadingConversations: shouldShowInitialLoading,
      isRefreshingConversations: options?.refresh === true,
    });

    let request!: Promise<void>;
    request = (async () => {
      try {
        const response = await listConversations(serverUrl, normalizedQuery, {
          filter: serverFilter,
          limit: CONVERSATION_PAGE_SIZE,
          offset: 0,
        });
        logMessageDeliveryDiagnostic('load-conversations-server-response', {
          filter: normalizedFilter,
          hasMore: response.hasMore,
          nextOffset: response.nextOffset,
          query: normalizedQuery,
          serverCount: response.conversations.length,
          serverPreview: summarizeConversationDiagnostics(response.conversations),
          totalUnreadConversations: response.totalUnreadConversations,
        });
        const serverConversations = await applyLocalConversationClearBoundaries(response.conversations);
        const conversations = await repairConversationPreviewsWithStoredMessages(
          mergeConversationPreviews(useAppStore.getState().conversations, serverConversations, normalizedQuery, { preferIncomingUnread: true }),
        );
        logMessageDeliveryDiagnostic('load-conversations-repaired', {
          filter: normalizedFilter,
          query: normalizedQuery,
          repairedCount: conversations.length,
          repairedPreview: summarizeConversationDiagnostics(conversations),
        });
        set({
          conversations,
          conversationsLastFetchedAt: Date.now(),
          conversationsNextOffset: response.nextOffset,
          conversationsQuery: normalizedQuery,
          hasLoadedConversations: true,
          hasMoreConversations: response.hasMore,
          totalUnreadConversations: response.totalUnreadConversations,
        });
        scheduleStoredConversationsPersist(LOW_PRIORITY_MESSAGE_MAINTENANCE_DELAY_MS);
        if (!normalizedQuery && serverFilter === 'all') {
          scheduleConversationMaintenance(serverUrl, conversations);
        }
        if (useAppStore.getState().connectionStatus === 'offline') {
          set({ connectionNotice: 'Connection recovered', connectionStatus: 'online' });
        } else {
          set({ connectionStatus: 'online' });
        }
      } finally {
        if ((conversationsRequest as { promise: Promise<void> } | null)?.promise === request) {
          conversationsRequest = null;
        }
        set({
          isLoadingConversations: false,
          isRefreshingConversations: false,
        });
      }
    })();

    conversationsRequest = {
      filter: normalizedFilter,
      offset: 0,
      promise: request,
      query: normalizedQuery,
    };

    try {
      await request;
    } catch (error) {
      logMessageDeliveryDiagnostic('load-conversations-failed', {
        filter: normalizedFilter,
        message: error instanceof Error ? error.message : String(error),
        query: normalizedQuery,
      });
      set({
        connectionNotice: 'No connection to server. Showing saved chats.',
        connectionStatus: 'offline',
        isRefreshingConversations: false,
      });
    }
  },

  async loadMoreConversations(query = '', filter?: ConversationListFilter) {
    const {
      conversationsFilter,
      conversationsNextOffset,
      conversationsQuery,
      hasMoreConversations,
      isDecoyOffline,
      isLoadingMoreConversations,
      serverUrl,
    } = useAppStore.getState();
    const normalizedQuery = query.trim();
    const normalizedFilter = filter ?? conversationsFilter;

    if (normalizedFilter === 'favorites') {
      return;
    }

    const serverFilter = normalizedFilter;

    if (
      isDecoyOffline ||
      !serverUrl ||
      isLoadingMoreConversations ||
      !hasMoreConversations ||
      conversationsQuery !== normalizedQuery ||
      conversationsFilter !== normalizedFilter
    ) {
      return;
    }

    if (conversationsRequest) {
      return conversationsRequest.promise;
    }

    set({ isLoadingMoreConversations: true });

    let request!: Promise<void>;
    request = (async () => {
      try {
        const response = await listConversations(serverUrl, normalizedQuery, {
          filter: serverFilter,
          limit: CONVERSATION_PAGE_SIZE,
          offset: conversationsNextOffset,
        });
        const serverConversations = await applyLocalConversationClearBoundaries(response.conversations);
        const conversations = await repairConversationPreviewsWithStoredMessages(
          mergeConversationPreviews(
            useAppStore.getState().conversations,
            serverConversations,
            normalizedQuery,
            { append: true, preferIncomingUnread: true },
          ),
        );
        set({
          conversations,
          conversationsLastFetchedAt: Date.now(),
          conversationsNextOffset: response.nextOffset,
          hasMoreConversations: response.hasMore,
          totalUnreadConversations: response.totalUnreadConversations,
        });
        scheduleStoredConversationsPersist(LOW_PRIORITY_MESSAGE_MAINTENANCE_DELAY_MS);
        if (!normalizedQuery && serverFilter === 'all') {
          scheduleConversationMaintenance(serverUrl, conversations);
        }
      } finally {
        if ((conversationsRequest as { promise: Promise<void> } | null)?.promise === request) {
          conversationsRequest = null;
        }
        set({ isLoadingMoreConversations: false });
      }
    })();

    conversationsRequest = {
      filter: normalizedFilter,
      offset: conversationsNextOffset,
      promise: request,
      query: normalizedQuery,
    };

    try {
      await request;
    } catch {
      set({ connectionNotice: 'No connection to server. Showing saved chats.', connectionStatus: 'offline' });
    }
  },

  async loadMessages(conversationId, options) {
    if (options?.hydrate !== false) {
      await hydrateStoredConversationMessages(conversationId);
    }

    const { isDecoyOffline, serverUrl } = useAppStore.getState();

    if (isDecoyOffline || !serverUrl) {
      return;
    }

    return requestConversationMessages(conversationId, serverUrl, { hydrate: options?.hydrate !== false });
  },

  async loadOlderLocalMessages(conversationId, options) {
    return loadOlderStoredConversationMessages(conversationId, options);
  },

  async prepareConversationMessages(conversationId, options) {
    await hydrateStoredConversationMessages(conversationId, options);
  },

  releaseConversationHistory(conversationId) {
    set((state) => {
      const currentMessages = state.messagesByConversation[conversationId] ?? [];

      if (currentMessages.length <= 400) {
        return state;
      }

      const retainedTail = currentMessages.slice(-240);
      const activeMessages = currentMessages.slice(0, -240).filter((message) => (
        message.status === 'sending' ||
        message.id.startsWith('local-') ||
        !!getMessageScheduledMessageId(message) ||
        !!getMessageLiveLocationId(message)
      ));
      const retainedMessages = mergeMessages(activeMessages, retainedTail);

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: retainedMessages,
        },
      };
    });
  },

  async markConversationReadNow(conversationId) {
    const { isDecoyOffline, serverUrl, user } = useAppStore.getState();

    if (isDecoyOffline || !serverUrl || !user) {
      return;
    }

    try {
      let messages = useAppStore.getState().messagesByConversation[conversationId];
      let messageIds = getReadableIncomingMessageIds(messages, user.id);
      let messageKeys = getReadableIncomingMessageKeys(messages, user.id);

      if (messageIds.length === 0 && messageKeys.length === 0) {
        await requestConversationMessages(conversationId, serverUrl, { hydrate: false });

        messages = useAppStore.getState().messagesByConversation[conversationId];
        messageIds = getReadableIncomingMessageIds(messages, user.id);
        messageKeys = getReadableIncomingMessageKeys(messages, user.id);
      }

      await markConversationRead(serverUrl, conversationId, 'chat_open', messageIds, messageKeys);
    } catch {
      set({ connectionNotice: 'No connection to server. Read status will sync later.', connectionStatus: 'offline' });
      return;
    }
    rememberConversationReadThrough(conversationId);
    set((state) => {
      const currentConversation = state.conversations.find((conversation) => conversation.id === conversationId);
      const hadUnread = (currentConversation?.unreadCount ?? 0) > 0 || currentConversation?.myGroupInvitePending === true;

      return {
        conversations: state.conversations.map((conversation) => (
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )),
        totalUnreadConversations: hadUnread
          ? Math.max(0, state.totalUnreadConversations - 1)
          : state.totalUnreadConversations,
      };
    });
    scheduleStoredConversationsPersist();
    void dismissMessageNotificationsForConversation(conversationId);
  },

  async markAllConversationsReadNow() {
    const { isDecoyOffline, serverUrl } = useAppStore.getState();

    if (isDecoyOffline || !serverUrl) {
      return;
    }

    try {
      const response = await markAllConversationsRead(serverUrl);
      const readAt = Date.parse(response.readAt);

      set((state) => ({
        conversations: state.conversations.map((conversation) => {
          const lastMessageAt = conversation.lastMessageAtIso ? Date.parse(conversation.lastMessageAtIso) : Number.NEGATIVE_INFINITY;

          if (conversation.unreadCount === 0 || lastMessageAt > readAt) {
            return conversation;
          }

          return { ...conversation, unreadCount: 0 };
        }),
        totalUnreadConversations: 0,
      }));
    } catch {
      set({ connectionNotice: 'No connection to server. Read status will sync later.', connectionStatus: 'offline' });
      return;
    }

    scheduleStoredConversationsPersist();
    void dismissAllMessageNotifications();
  },

  addOptimisticMessage(message) {
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === message.conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [message.conversationId]: replaceMatchingOptimisticMessage(state.messagesByConversation[message.conversationId] ?? [], message),
      },
    }));
    void persistChangedConversationMessages(message.conversationId, [message]);
    void cacheMessageMediaAndPersist(message).catch(() => undefined);
    scheduleStoredConversationsPersist();
  },

  async sendTextMessage(conversationId, body, clientId, metadata) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const message = await createTextMessage(
      serverUrl,
      conversationId,
      body,
      clientId,
      withLocalDeleteKey(conversationId, clientId, metadata),
    );

    if (useAppStore.getState().isDecoyOffline) {
      return message;
    }

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: replaceMatchingOptimisticMessage(state.messagesByConversation[conversationId] ?? [], message),
      },
    }));
    void persistChangedConversationMessages(conversationId, [message]);
    scheduleStoredConversationsPersist();
    return message;
  },

  async scheduleTextMessage(conversationId, body, sendAt, clientTimezone, metadata) {
    const { serverUrl, user } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const localId = `scheduled-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scheduledMetadata = {
      ...withLocalDeleteKey(conversationId, localId, metadata),
      scheduledSendAt: sendAt,
    };
    const scheduledMessage = await createScheduledMessage(serverUrl, conversationId, {
      body,
      clientTimezone,
      kind: 'TEXT',
      metadata: scheduledMetadata,
      sendAt,
    });
    const message: Message = {
      body,
      conversationId,
      createdAt: formatConversationActivityTime(scheduledMessage.createdAt),
      createdAtIso: scheduledMessage.createdAt,
      id: `scheduled-${scheduledMessage.id}`,
      kind: 'text',
      metadata: {
        ...scheduledMetadata,
        scheduledMessageId: scheduledMessage.id,
        scheduledSendAt: scheduledMessage.sendAt,
      },
      senderId: user?.id ?? scheduledMessage.senderId,
      status: 'sent',
    };

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: upsertMessage(state.messagesByConversation[conversationId] ?? [], message),
      },
    }));
    void persistChangedConversationMessages(conversationId, [message]);
    scheduleStoredConversationsPersist();
    return message;
  },

  async openDisappearingMessage(conversationId, messageId, secondsAfterView) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const view = await openDisappearingMessageRequest(serverUrl, conversationId, messageId, secondsAfterView);

    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).map((message) => {
          if (message.id !== messageId) {
            return message;
          }

          const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {};

          return {
            ...message,
            metadata: {
              ...metadata,
              disappearingAfterView: {
                seconds: view.secondsAfterView,
              },
              disappearingDeleteAt: view.deleteAt,
              disappearingOpenedAt: view.openedAt,
            },
          };
        }),
      },
    }));
    void persistCurrentConversationMessage(conversationId, messageId);
  },

  async scheduleMediaMessage(input) {
    const { serverUrl, user } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const media = await uploadMediaFile(serverUrl, {
      durationSec: input.durationSeconds ? Math.max(1, Math.round(input.durationSeconds)) : undefined,
      mimeType: input.mimeType,
      originalName: input.fileName,
      sizeBytes: input.sizeBytes,
      uri: input.uri,
    });
    const localId = `scheduled-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scheduledMetadata = {
      ...withLocalDeleteKey(input.conversationId, localId, input.metadata),
      scheduledSendAt: input.sendAt,
    };
    const scheduledMessage = await createScheduledMessage(serverUrl, input.conversationId, {
      body: input.body,
      clientTimezone: input.clientTimezone,
      kind: input.kind.toUpperCase() as 'IMAGE' | 'VIDEO' | 'FILE',
      mediaId: media.id,
      metadata: scheduledMetadata,
      sendAt: input.sendAt,
    });
    const message: Message = {
      body: input.body ?? '',
      conversationId: input.conversationId,
      createdAt: formatConversationActivityTime(scheduledMessage.createdAt),
      createdAtIso: scheduledMessage.createdAt,
      durationSeconds: input.durationSeconds,
      fileName: input.fileName,
      id: `scheduled-${scheduledMessage.id}`,
      kind: input.kind,
      mediaId: media.id,
      mediaUri: input.uri,
      metadata: {
        ...scheduledMetadata,
        scheduledMessageId: scheduledMessage.id,
        scheduledSendAt: scheduledMessage.sendAt,
      },
      mimeType: input.mimeType,
      senderId: user?.id ?? scheduledMessage.senderId,
      sizeBytes: input.sizeBytes,
      status: 'sent',
    };

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === input.conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [input.conversationId]: upsertMessage(state.messagesByConversation[input.conversationId] ?? [], message),
      },
    }));
    void persistChangedConversationMessages(input.conversationId, [message]);
    scheduleStoredConversationsPersist();
    return message;
  },

  async reactToMessage(conversationId, messageId, emoji) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const { reaction } = await reactToMessageRequest(serverUrl, conversationId, messageId, emoji);
    useAppStore.getState().applyMessageReaction(reaction);
  },

  applyMessageReaction(reaction) {
    set((state) => {
      const messages = state.messagesByConversation[reaction.conversationId] ?? [];
      let didUpdate = false;
      const nextMessages = messages.map((message) => {
        if (message.id !== reaction.messageId) {
          return message;
        }

        didUpdate = true;
        const metadata = {
          ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
          reactions: reaction.reactions ?? updateMessageReactions(message.metadata, reaction.userId, reaction.emoji),
        };

        return { ...message, metadata };
      });

      if (!didUpdate) {
        return state;
      }

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [reaction.conversationId]: nextMessages,
        },
      };
    });
    void persistCurrentConversationMessage(reaction.conversationId, reaction.messageId);
  },

  async forwardMessage(conversationId, sourceMessage) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    if (sourceMessage.kind !== 'text' && sourceMessage.kind !== 'image' && sourceMessage.kind !== 'video' && sourceMessage.kind !== 'file' && sourceMessage.kind !== 'voice') {
      throw new Error(t('messageCannotBeForwarded'));
    }
    const message = sourceMessage.kind === 'text'
      ? await createForwardedMessage(serverUrl, conversationId, sourceMessage)
      : await forwardMediaMessage(serverUrl, conversationId, sourceMessage);

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: upsertMessage(state.messagesByConversation[conversationId] ?? [], message),
      },
    }));
    void persistChangedConversationMessages(conversationId, [message]);
    scheduleStoredConversationsPersist();
    return message;
  },

  async sendMediaMessage(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const uploadController = input.clientId ? new AbortController() : undefined;

    if (input.clientId && uploadController) {
      uploadControllers.set(input.clientId, uploadController);
      publishUploadProgress(input.clientId, { sentBytes: 0, totalBytes: input.sizeBytes }, { force: true });
    }

    const media = await uploadMediaFile(serverUrl, {
      durationSec: input.durationSeconds ? Math.max(1, Math.round(input.durationSeconds)) : undefined,
      mimeType: input.mimeType,
      originalName: input.fileName,
      sizeBytes: input.sizeBytes,
      uri: input.uri,
    }, {
      onProgress: input.clientId
        ? (progress) => publishUploadProgress(input.clientId!, progress)
        : undefined,
      signal: uploadController?.signal,
      uploadId: input.clientId,
    });
    const message = await createMediaMessage(serverUrl, input.conversationId, {
      body: input.body,
      clientId: input.clientId,
      kind: input.kind.toUpperCase() as 'IMAGE' | 'VIDEO' | 'FILE',
      mediaId: media.id,
      metadata: withLocalDeleteKey(input.conversationId, input.clientId, input.metadata),
    });

    const confirmedMessage = message.mediaUri
      ? withRemoteMediaMetadata({ ...message, mediaUri: input.uri }, message.mediaUri)
      : { ...message, mediaUri: input.uri };

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === input.conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [input.conversationId]: replaceMatchingOptimisticMessage(
          state.messagesByConversation[input.conversationId] ?? [],
          confirmedMessage,
        ),
      },
      uploadProgressByMessageId: input.clientId ? omitRecordKey(state.uploadProgressByMessageId, input.clientId) : state.uploadProgressByMessageId,
    }));
    if (input.clientId) {
      uploadControllers.delete(input.clientId);
      uploadProgressSnapshots.delete(input.clientId);
    }
    void persistChangedConversationMessages(input.conversationId, [confirmedMessage]);
    scheduleStoredConversationsPersist();
    return message;
  },

  async sendVoiceMessage(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const uploadController = input.clientId ? new AbortController() : undefined;

    if (input.clientId && uploadController) {
      uploadControllers.set(input.clientId, uploadController);
      publishUploadProgress(input.clientId, { sentBytes: 0, totalBytes: input.sizeBytes }, { force: true });
    }

    const media = await uploadMediaFile(serverUrl, {
      durationSec: Math.max(1, Math.round(input.durationSeconds)),
      mimeType: input.mimeType,
      originalName: input.fileName,
      sizeBytes: input.sizeBytes,
      uri: input.uri,
    }, {
      onProgress: input.clientId
        ? (progress) => publishUploadProgress(input.clientId!, progress)
        : undefined,
      signal: uploadController?.signal,
      uploadId: input.clientId,
    });
    const message = await createVoiceMessage(
      serverUrl,
      input.conversationId,
      media.id,
      input.clientId,
      withLocalDeleteKey(input.conversationId, input.clientId),
    );

    const confirmedMessage = message.mediaUri
      ? withRemoteMediaMetadata({ ...message, mediaUri: input.uri }, message.mediaUri)
      : { ...message, mediaUri: input.uri };

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === input.conversationId
          ? applyMessagePreviewToConversation(conversation, message)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [input.conversationId]: replaceMatchingOptimisticMessage(
          state.messagesByConversation[input.conversationId] ?? [],
          confirmedMessage,
        ),
      },
      uploadProgressByMessageId: input.clientId ? omitRecordKey(state.uploadProgressByMessageId, input.clientId) : state.uploadProgressByMessageId,
    }));
    if (input.clientId) {
      uploadControllers.delete(input.clientId);
      uploadProgressSnapshots.delete(input.clientId);
    }
    void persistChangedConversationMessages(input.conversationId, [confirmedMessage]);
    scheduleStoredConversationsPersist();
    return message;
  },

  async editMessage(conversationId, messageId, body) {
    const { serverUrl } = useAppStore.getState();
    const editedMessage = useAppStore.getState().messagesByConversation[conversationId]?.find((message) => message.id === messageId);

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const edit = await editMessageRequest(serverUrl, conversationId, messageId, body, getMessageDeleteKey(editedMessage), editedMessage?.createdAtIso);
    applyMessageEditToState(edit);

    return findMessageByEdit(conversationId, edit) ?? {
      ...(editedMessage ?? {
        conversationId,
        createdAt: '',
        id: messageId,
        kind: 'text' as const,
        senderId: useAppStore.getState().user?.id ?? '',
        status: 'sent' as const,
      }),
      body: edit.body,
    };
  },

  async deleteMessage(conversationId, messageId, mode) {
    const { serverUrl } = useAppStore.getState();
    const deletedMessage = useAppStore.getState().messagesByConversation[conversationId]?.find((message) => message.id === messageId);
    const deletedMessageKey = getMessageDeleteKey(deletedMessage);
    const scheduledMessageId = getMessageScheduledMessageId(deletedMessage);
    const deletedCallLogIds = getMessageCallLogIds(deletedMessage);

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    rememberLocallyDeletedMessage(conversationId, messageId, deletedMessageKey);
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) {
          return conversation;
        }

        const nextMessages = (state.messagesByConversation[conversationId] ?? [])
          .filter((message) => !shouldRemoveMessageForDeletion(
            message,
            [messageId],
            deletedMessageKey ? [deletedMessageKey] : [],
          ));

        return syncConversationPreviewWithMessages(conversation, nextMessages);
      }),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? [])
          .filter((message) => !shouldRemoveMessageForDeletion(
            message,
            [messageId],
            deletedMessageKey ? [deletedMessageKey] : [],
          )),
      },
    }));
    await removeStoredCallLogs(deletedCallLogIds);
    await removeStoredMessageRecords(conversationId, [messageId]);
    await setStoredConversations(useAppStore.getState().conversations);

    try {
      if (scheduledMessageId) {
        await deleteScheduledMessageRequest(serverUrl, conversationId, scheduledMessageId);
      } else {
        await deleteMessageRequest(serverUrl, conversationId, messageId, mode, deletedMessageKey);
      }
    } catch (error) {
      forgetLocallyDeletedMessage(conversationId, messageId, deletedMessageKey);

      if (deletedMessage) {
        set((state) => {
          const nextMessages = upsertMessage(state.messagesByConversation[conversationId] ?? [], deletedMessage);

          return {
            conversations: state.conversations.map((conversation) => (
              conversation.id === conversationId ? syncConversationPreviewWithMessages(conversation, nextMessages) : conversation
            )),
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: nextMessages,
            },
          };
        });
        void persistChangedConversationMessages(conversationId, [deletedMessage]);
        scheduleStoredConversationsPersist();
      }

      throw error;
    }
  },

  async deleteChat(conversationId, mode = 'me') {
    const { conversations, serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    if (conversations.some((conversation) => conversation.id === conversationId && conversation.isSystem === true)) {
      throw new Error(t('meetVapChatCannotBeDeleted'));
    }

    if (mode === 'all') {
      await deleteConversationForAnyoneRequest(serverUrl, conversationId);
    } else {
      await deleteConversationRequest(serverUrl, conversationId);
    }
    await useAppStore.getState().removeChatLocally(conversationId);
  },

  async removeChatLocally(conversationId) {
    await Promise.all([
      setDeletedConversationAfter(conversationId, new Date().toISOString()),
      removeStoredMessages(conversationId),
    ]);
    set((state) => {
      const nextMessages = { ...state.messagesByConversation };
      delete nextMessages[conversationId];

      return {
        conversations: state.conversations.filter((conversation) => conversation.id !== conversationId),
        messagesByConversation: nextMessages,
      };
    });
    scheduleStoredConversationsPersist();
  },

  async clearLocalChat(conversationId) {
    const clearedAtIso = new Date().toISOString();
    locallyClearedAfterByConversation.set(conversationId, Date.parse(clearedAtIso));
    resolvedLocalClearBoundaryConversationIds.add(conversationId);
    await Promise.all([
      setDeletedConversationAfter(conversationId, clearedAtIso),
      removeStoredMessages(conversationId),
    ]);
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? {
              ...conversation,
              lastMessage: 'No messages yet',
              lastMessageAt: conversation.lastMessageAt,
              lastMessageAtIso: undefined,
              lastMessageId: undefined,
              lastMessageKind: undefined,
              lastMessageSenderId: undefined,
              lastMessageStatus: undefined,
              unreadCount: 0,
            }
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [],
      },
    }));
    scheduleStoredConversationsPersist();
  },

  async updateConversationMute(conversationId, muted, durationMinutes) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const updated = await updateConversationMuteRequest(serverUrl, conversationId, muted, durationMinutes);

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId ? updated : conversation
      )),
    }));
    scheduleStoredConversationsPersist();
  },

  async updateDisappearingMessages(conversationId, durationMinutes) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const updated = await updateDisappearingMessagesRequest(serverUrl, conversationId, durationMinutes);

    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId ? updated : conversation
      )),
    }));
    scheduleStoredConversationsPersist();
  },

  async reportTarget(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await reportContent(serverUrl, input);
  },

  async updateAvatar(avatarUrl) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const user = await updateMyAvatar(serverUrl, avatarUrl);
    await setStoredUser(user);
    set((state) => ({
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        avatarUrl: conversation.otherUserId === user.id ? user.avatarUrl : conversation.avatarUrl,
        members: conversation.members?.map((member) => (member.id === user.id ? user : member)),
      })),
      user,
    }));
  },

  async updatePassword(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await updateMyPassword(serverUrl, input);
  },

  async updateProfile(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const user = await updateMyProfile(serverUrl, input);

    await setStoredUser(user);
    set((state) => ({
      contacts: state.contacts.map((contact) => (contact.id === user.id ? user : contact)),
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        members: conversation.members?.map((member) => (member.id === user.id ? user : member)),
        title: conversation.otherUserId === user.id ? user.displayName || user.username : conversation.title,
      })),
      user,
    }));
  },

  async updatePrivacy(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const user = await updatePrivacyRequest(serverUrl, input);
    await setStoredUser(user);
    set((state) => ({ user: mergePresenceIntoUser(state.user, user) }));
  },

  updateCurrentUser(user) {
    void setStoredUser(user);
    set((state) => ({
      blockedUsers: state.blockedUsers.map((blockedUser) => (blockedUser.id === user.id ? mergePresenceIntoUser(blockedUser, user) : blockedUser)),
      contacts: state.contacts.map((contact) => (contact.id === user.id ? mergePresenceIntoUser(contact, user) : contact)),
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        avatarUrl: conversation.otherUserId === user.id ? user.avatarUrl : conversation.avatarUrl,
        members: conversation.members?.map((member) => (member.id === user.id ? mergePresenceIntoUser(member, user) : member)),
        title: conversation.otherUserId === user.id ? user.displayName || user.username : conversation.title,
      })),
      user: state.user?.id === user.id ? mergePresenceIntoUser(state.user, user) : state.user,
    }));
  },

  updateUserPresence(input) {
    set((state) => ({
      blockedUsers: state.blockedUsers.map((user) => mergePresenceIntoUser(user, input)),
      contacts: state.contacts.map((user) => mergePresenceIntoUser(user, input)),
      conversations: state.conversations.map((conversation) => ({
        ...conversation,
        members: conversation.members?.map((member) => mergePresenceIntoUser(member, input)),
      })),
      user: state.user?.id === input.userId ? mergePresenceIntoUser(state.user, input) : state.user,
    }));
  },

  async updateGroupAvatar(conversationId, avatarUrl) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await updateGroupAvatarRequest(serverUrl, conversationId, avatarUrl);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();
  },

  async updateGroupAlias(conversationId, aliasName) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await updateGroupAliasRequest(serverUrl, conversationId, aliasName);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async declineGroupInvite(conversationId, input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await declineGroupInviteRequest(serverUrl, conversationId, input);
    set((state) => ({
      conversations: state.conversations.filter((conversation) => conversation.id !== conversationId),
      messagesByConversation: omitRecordKey(state.messagesByConversation, conversationId),
    }));
    await removeStoredMessages(conversationId);
    scheduleStoredConversationsPersist();
  },

  async addGroupMembers(conversationId, userIds) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await addGroupMembersRequest(serverUrl, conversationId, userIds);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async addGroupAdmins(conversationId, userIds) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await addGroupAdminsRequest(serverUrl, conversationId, userIds);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async deleteGroup(conversationId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await deleteGroupRequest(serverUrl, conversationId);
    set((state) => ({
      conversations: state.conversations.filter((conversation) => conversation.id !== conversationId),
      messagesByConversation: omitRecordKey(state.messagesByConversation, conversationId),
    }));
    await removeStoredMessages(conversationId);
    scheduleStoredConversationsPersist();
  },

  async removeGroupMember(conversationId, userId) {
    const { serverUrl, user } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await removeGroupMemberRequest(serverUrl, conversationId, userId);

    if (userId === user?.id) {
      set((state) => ({
        conversations: state.conversations.filter((item) => item.id !== conversationId),
        messagesByConversation: omitRecordKey(state.messagesByConversation, conversationId),
      }));
      await removeStoredMessages(conversationId);
    } else {
      set((state) => ({
        conversations: upsertConversation(state.conversations, conversation),
      }));
    }

    scheduleStoredConversationsPersist();

    return conversation;
  },

  async revokeGroupAdmin(conversationId, userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await revokeGroupAdminRequest(serverUrl, conversationId, userId);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async transferGroupOwnership(conversationId, userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await transferGroupOwnershipRequest(serverUrl, conversationId, userId);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async updateGroupSettings(conversationId, input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await updateGroupSettingsRequest(serverUrl, conversationId, input);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async updateGroupTitle(conversationId, title) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await updateGroupTitleRequest(serverUrl, conversationId, title);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async addUserToContacts(userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const response = await addContact(serverUrl, userId);
    set((state) => ({
      contacts: upsertUser(state.contacts, response.contact),
      conversations: state.conversations.map((conversation) => (
        conversation.otherUserId === userId ? { ...conversation, isContact: true } : conversation
      )),
    }));
  },

  async blockUserById(userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await blockUser(serverUrl, userId);
    set((state) => ({
      blockedUsers: state.blockedUsers.filter((item) => item.id !== userId),
      contacts: state.contacts.filter((item) => item.id !== userId),
    }));
    await useAppStore.getState().loadBlockedUsers();
  },

  async deleteContactById(userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await deleteContactRequest(serverUrl, userId);
    set((state) => ({
      contacts: state.contacts.filter((contact) => contact.id !== userId),
      conversations: state.conversations.map((conversation) => (
        conversation.otherUserId === userId ? { ...conversation, isContact: false } : conversation
      )),
    }));
  },

  async loadContacts() {
    const { isDecoyOffline, serverUrl } = useAppStore.getState();

    if (isDecoyOffline) {
      set({ contacts: [] });
      return;
    }

    if (!serverUrl) {
      return;
    }

    const response = await listContacts(serverUrl);
    set({ contacts: response.contacts });
  },

  async refreshStatusSummary() {
    const { isDecoyOffline, serverUrl } = useAppStore.getState();

    if (isDecoyOffline || !serverUrl) {
      set({ hasUnviewedStatuses: false });
      return;
    }

    const summary = await getStatusSummary(serverUrl);
    set({ hasUnviewedStatuses: summary.hasUnviewed });
  },

  async loadStatuses() {
    const { isDecoyOffline, serverUrl } = useAppStore.getState();

    if (isDecoyOffline) {
      set({ hasUnviewedStatuses: false, isLoadingStatuses: false, statusGroups: [] });
      return;
    }

    if (!serverUrl) {
      return;
    }

    set({ isLoadingStatuses: true });
    try {
      const response = await listStatuses(serverUrl);
      set({
        hasUnviewedStatuses: response.groups.some((group) => group.hasUnviewed),
        statusGroups: response.groups,
      });
    } finally {
      set({ isLoadingStatuses: false });
    }
  },

  async createTextStatus(body: string, backgroundColor?: string | null, audienceInput?: { audience?: 'CONTACTS' | 'CONTACTS_EXCEPT' | 'ONLY_SHARE_WITH'; exceptUserIds?: string[]; onlyUserIds?: string[] }) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverNotConfigured'));
    }

    await createStatusRequest(serverUrl, {
      audience: audienceInput?.audience,
      backgroundColor,
      body,
      exceptUserIds: audienceInput?.exceptUserIds,
      kind: 'TEXT',
      onlyUserIds: audienceInput?.onlyUserIds,
    });
    await useAppStore.getState().loadStatuses();
  },

  async createMediaStatus(input: { audience?: 'CONTACTS' | 'CONTACTS_EXCEPT' | 'ONLY_SHARE_WITH'; body?: string; durationSeconds?: number; exceptUserIds?: string[]; fileName: string; kind: 'image' | 'video'; mimeType: string; onlyUserIds?: string[]; sizeBytes?: number; uri: string }) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverNotConfigured'));
    }

    const media = await uploadMediaFile(serverUrl, {
      durationSec: input.durationSeconds,
      mimeType: input.mimeType,
      originalName: input.fileName,
      sizeBytes: input.sizeBytes,
      uri: input.uri,
    });
    await createStatusRequest(serverUrl, {
      audience: input.audience,
      body: input.body?.trim(),
      exceptUserIds: input.exceptUserIds,
      kind: input.kind.toUpperCase() as StatusKind,
      mediaId: media.id,
      onlyUserIds: input.onlyUserIds,
    });
    await useAppStore.getState().loadStatuses();
  },

  async markStatusViewed(statusId: string) {
    const { serverUrl, statusGroups } = useAppStore.getState();

    if (!serverUrl) {
      return;
    }

    set({
      statusGroups: statusGroups.map((group) => ({
        ...group,
        hasUnviewed: group.statuses.some((status) => status.id === statusId)
          ? group.statuses.some((status) => status.id !== statusId && !status.viewedByMe)
          : group.hasUnviewed,
        statuses: group.statuses.map((status) => status.id === statusId ? { ...status, viewedByMe: true } : status),
      })),
    });
    await markStatusViewedRequest(serverUrl, statusId);
    await useAppStore.getState().refreshStatusSummary().catch(() => undefined);
  },

  async deleteStatusById(statusId: string) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      return;
    }

    await deleteStatusRequest(serverUrl, statusId);
    await useAppStore.getState().loadStatuses();
  },

  async replyToStatus(statusId: string, body: string) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverNotConfigured'));
    }

    const response = await replyToStatusRequest(serverUrl, statusId, body);
    useAppStore.getState().receiveMessage(response.message);
    void useAppStore.getState().loadConversations('', 'all', { refresh: true }).catch(() => undefined);
  },

  async loadBlockedUsers() {
    const { isDecoyOffline, serverUrl } = useAppStore.getState();

    if (isDecoyOffline) {
      set({ blockedUsers: [] });
      return;
    }

    if (!serverUrl) {
      return;
    }

    const response = await listBlockedUsers(serverUrl);
    set({ blockedUsers: response.blockedUsers });
  },

  async loadCatalogUrl() {
    const { isDecoyOffline, serverUrl, user } = useAppStore.getState();

    if (isDecoyOffline || !user) {
      set({ catalogUrl: null, catalogUrlLoadError: null, isLoadingCatalogUrl: false });
      return null;
    }

    if (!serverUrl) {
      return useAppStore.getState().catalogUrl;
    }

    set({ catalogUrlLoadError: null, isLoadingCatalogUrl: true });

    try {
      const response = await getCatalogConfig(serverUrl);
      set({ catalogUrl: response.catalogUrl, catalogUrlLoadError: null, isLoadingCatalogUrl: false });
      return response.catalogUrl;
    } catch (error) {
      const fallbackCatalogUrl = useAppStore.getState().catalogUrl;
      const message = error instanceof Error ? error.message : 'Failed to load catalog URL';
      set({ catalogUrlLoadError: message, isLoadingCatalogUrl: false });
      return fallbackCatalogUrl;
    }
  },

  async loadHelpUrl() {
    const { isDecoyOffline, serverUrl, user } = useAppStore.getState();

    if (isDecoyOffline || !user) {
      set({ helpUrl: null, helpUrlLoadError: null, isLoadingHelpUrl: false });
      return null;
    }

    if (!serverUrl) {
      return useAppStore.getState().helpUrl;
    }

    set({ helpUrlLoadError: null, isLoadingHelpUrl: true });

    try {
      const response = await getHelpConfig(serverUrl);
      set({ helpUrl: response.helpUrl, helpUrlLoadError: null, isLoadingHelpUrl: false });
      return response.helpUrl;
    } catch (error) {
      const fallbackHelpUrl = useAppStore.getState().helpUrl;
      const message = error instanceof Error ? error.message : 'Failed to load help URL';
      set({ helpUrlLoadError: message, isLoadingHelpUrl: false });
      return fallbackHelpUrl;
    }
  },

  async unblockUserById(userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    await unblockUser(serverUrl, userId);
    set((state) => ({
      blockedUsers: state.blockedUsers.filter((item) => item.id !== userId),
    }));
  },

  async refreshSubscriptionStatus() {
    const { serverUrl, user } = useAppStore.getState();

    if (isSubscriptionBypassed()) {
      const bypassStatus = createBypassSubscriptionStatus();
      await setStoredSubscriptionStatus(bypassStatus);
      set({ isCheckingSubscription: false, subscriptionStatus: bypassStatus });
      return bypassStatus;
    }

    if (!serverUrl || !user) {
      const emptyStatus: SubscriptionStatus = createEmptySubscriptionStatus();
      set({ isCheckingSubscription: false, subscriptionStatus: emptyStatus });
      return emptyStatus;
    }

    set({ isCheckingSubscription: true });

    try {
      const subscriptionStatus = await getSubscriptionStatusRequest(serverUrl);
      await setStoredSubscriptionStatus(subscriptionStatus);
      set({ subscriptionStatus });
      return subscriptionStatus;
    } finally {
      set({ isCheckingSubscription: false });
    }
  },

  async setSubscriptionStatus(subscriptionStatus) {
    await setStoredSubscriptionStatus(subscriptionStatus);
    set({ subscriptionStatus });
  },

  async loadCallLogs() {
    const callLogs = await getStoredCallLogs();
    set({ callLogs });
  },

  async recordCallLog(callLog) {
    const nextCallLog: CallLog = {
      ...callLog,
      happenedAt: new Date().toLocaleString([], {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
      }),
      happenedAtIso: new Date().toISOString(),
    };

    const callLogs = [nextCallLog, ...useAppStore.getState().callLogs]
      .filter((item, index, all) => index === all.findIndex((candidate) => candidate.id === item.id))
      .slice(0, 150);

    await setStoredCallLogs(callLogs);
    set({ callLogs });
  },

  async deleteCallLog(callLogId, mode = 'me') {
    const { callLogs: currentCallLogs, serverUrl } = useAppStore.getState();
    const deletedCallLog = currentCallLogs.find((item) => item.id === callLogId);
    const callMessage = deletedCallLog ? findCallMessageByCallLog(deletedCallLog) : undefined;

    if (serverUrl && deletedCallLog?.conversationId) {
      await deleteCallMessageByCallIdRequest(serverUrl, deletedCallLog.conversationId, deletedCallLog.id, mode, getMessageDeleteKey(callMessage));
    }

    const callLogs = currentCallLogs.filter((item) => item.id !== callLogId);
    await setStoredCallLogs(callLogs);
    set((state) => ({
      callLogs,
      messagesByConversation: callMessage
        ? {
            ...state.messagesByConversation,
            [callMessage.conversationId]: (state.messagesByConversation[callMessage.conversationId] ?? [])
              .filter((message) => !shouldRemoveMessageForDeletion(
                message,
                [callMessage.id],
                [getMessageDeleteKey(callMessage)].filter((key): key is string => !!key),
              )),
          }
        : state.messagesByConversation,
    }));
    if (callMessage) {
      void removeStoredMessageRecords(callMessage.conversationId, [callMessage.id]);
    }
  },

  async startDirectConversation(userId) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await createDirectConversation(serverUrl, userId);

    if (useAppStore.getState().isDecoyOffline) {
      return conversation;
    }

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async startGroupConversation(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await createGroupConversation(serverUrl, input);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  async startVoiceRoomConversation(input) {
    const { serverUrl } = useAppStore.getState();

    if (!serverUrl) {
      throw new Error(t('serverUrlNotConfigured'));
    }

    const conversation = await createVoiceRoomConversation(serverUrl, input);

    set((state) => ({
      conversations: upsertConversation(state.conversations, conversation),
    }));
    scheduleStoredConversationsPersist();

    return conversation;
  },

  receiveMessage(message) {
    logMessageDeliveryDiagnostic('receive-message-called', {
      conversationId: message.conversationId,
      kind: message.kind,
      messageId: message.id,
      senderId: message.senderId,
    });

    if (useAppStore.getState().isDecoyOffline) {
      logMessageDeliveryDiagnostic('receive-message-skipped-decoy', {
        conversationId: message.conversationId,
        messageId: message.id,
      });
      return;
    }

    if (shouldRemoveMessageForLocalDeletion(message) || isReactionFallbackMessage(message)) {
      logMessageDeliveryDiagnostic('receive-message-skipped-filtered', {
        conversationId: message.conversationId,
        isReactionFallback: isReactionFallbackMessage(message),
        messageId: message.id,
      });
      return;
    }

    set((state) => {
      const nextMessage = applyPendingCallRead(message, state.user?.id);
      const currentMessages = state.messagesByConversation[nextMessage.conversationId] ?? [];
      const currentMessage = findMatchingMessage(currentMessages, nextMessage);
      const nextMessages = upsertMessage(currentMessages, nextMessage);
      const mergedMessage = findMatchingMessage(nextMessages, nextMessage) ?? nextMessage;
      const unreadDelta = getUnreadCountDelta(nextMessage, currentMessage, state.user?.id);
      const existingConversation = state.conversations.find((conversation) => conversation.id === nextMessage.conversationId);
      const revivedConversation = existingConversation ?? createConversationFromIncomingMessage(nextMessage, state.user?.id);
      const hadUnreadBefore = (existingConversation?.unreadCount ?? 0) > 0 || existingConversation?.myGroupInvitePending === true;
      const conversations = revivedConversation
        ? upsertConversation(state.conversations, {
            ...applyMessagePreviewToConversation(revivedConversation, mergedMessage),
            unreadCount: Math.max(0, revivedConversation.unreadCount + unreadDelta),
          })
        : state.conversations;
      const updatedConversation = conversations.find((conversation) => conversation.id === nextMessage.conversationId);
      const hasUnreadNow = (updatedConversation?.unreadCount ?? 0) > 0 || updatedConversation?.myGroupInvitePending === true;

      return {
        conversations,
        totalUnreadConversations: !hadUnreadBefore && hasUnreadNow && unreadDelta > 0
          ? state.totalUnreadConversations + 1
          : state.totalUnreadConversations,
        messagesByConversation: {
          ...state.messagesByConversation,
          [nextMessage.conversationId]: nextMessages,
        },
      };
    });
    locallyClearedAfterByConversation.delete(message.conversationId);
    resolvedLocalClearBoundaryConversationIds.add(message.conversationId);
    void clearDeletedConversationAfter(message.conversationId);
    logMessageDeliveryDiagnostic('receive-message-state-updated', {
      conversationId: message.conversationId,
      messageId: message.id,
      messageIds: (useAppStore.getState().messagesByConversation[message.conversationId] ?? []).slice(-10).map((item) => item.id),
      stateCount: (useAppStore.getState().messagesByConversation[message.conversationId] ?? []).length,
    });
    void acknowledgeMessageContentAfterLocalCache(message).catch((error) => {
      logMessageDeliveryDiagnostic('content-ack-after-cache-failed', {
        conversationId: message.conversationId,
        message: error instanceof Error ? error.message : String(error),
        messageId: message.id,
      });
    });
    void persistCurrentConversationMessage(message.conversationId, message.id);
    scheduleStoredConversationsPersist();
  },

  async cacheDownloadedMessageMedia(conversationId, messageId, localUri, remoteUri) {
    const currentMessage = useAppStore.getState().messagesByConversation[conversationId]?.find((message) => message.id === messageId);

    if (!currentMessage || !isMediaMessageKind(currentMessage.kind)) {
      return;
    }

    const cachedMessage = remoteUri && /^https?:\/\//i.test(remoteUri)
      ? withRemoteMediaMetadata({ ...currentMessage, mediaUri: localUri }, remoteUri)
      : { ...currentMessage, mediaUri: localUri };

    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: upsertMessage(state.messagesByConversation[conversationId] ?? [], cachedMessage),
      },
    }));
    await persistChangedConversationMessages(conversationId, [cachedMessage]);
  },

  applyMessageEdit(edit) {
    return applyMessageEditToState(edit);
  },

  markCallMessageReadByCallId(conversationId, callId, readerId) {
    const { user } = useAppStore.getState();

    if (!user || user.id === readerId) {
      return;
    }

    rememberPendingCallRead(conversationId, callId);

    set((state) => {
      const currentMessages = state.messagesByConversation[conversationId] ?? [];
      let didUpdate = false;
      const nextMessages = currentMessages.map((message) => {
        if (message.senderId !== user.id || getMessageCallLogId(message) !== callId || message.status === 'read') {
          return message;
        }

        didUpdate = true;
        return { ...message, status: 'read' as const };
      });

      if (!didUpdate) {
        return state;
      }

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: nextMessages,
        },
        conversations: state.conversations.map((conversation) => (
          conversation.id === conversationId
            ? syncConversationPreviewWithMessages(conversation, nextMessages)
            : conversation
        )),
      };
    });
    void persistChangedConversationMessages(
      conversationId,
      (useAppStore.getState().messagesByConversation[conversationId] ?? [])
        .filter((message) => message.senderId === user.id && getMessageCallLogId(message) === callId),
    );
    scheduleStoredConversationsPersist();
  },

  removeMessage(conversationId, messageId) {
    uploadControllers.delete(messageId);
    uploadProgressSnapshots.delete(messageId);
    const removedMessage = useAppStore.getState().messagesByConversation[conversationId]?.find((message) => message.id === messageId);
    const removedMessageKey = getMessageDeleteKey(removedMessage);
    const removedCallLogIds = getMessageCallLogIds(removedMessage);
    rememberLocallyDeletedMessage(conversationId, messageId, removedMessageKey);
    set((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? syncConversationPreviewWithMessages(conversation, (state.messagesByConversation[conversationId] ?? [])
            .filter((message) => message.id !== messageId))
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: (state.messagesByConversation[conversationId] ?? []).filter((message) => message.id !== messageId),
      },
      uploadProgressByMessageId: omitRecordKey(state.uploadProgressByMessageId, messageId),
    }));
    void removeStoredCallLogs(removedCallLogIds);
    void removePartialMediaDownloadsForMessages([messageId]);
    void removeStoredMessageRecords(conversationId, [messageId]);
    scheduleStoredConversationsPersist();
  },

  markConversationMessagesDelivered(conversationId, delivererId, messageIds) {
    const { user } = useAppStore.getState();

    if (!user || user.id === delivererId) {
      return;
    }

    const deliveredMessageIds = new Set(messageIds ?? []);
    if (deliveredMessageIds.size === 0) {
      return;
    }

    enqueueDeliveredReceipt(conversationId, delivererId, deliveredMessageIds);
  },

  markConversationMessagesRead(conversationId, readerId, readAt, messageIds, messageKeys) {
    const { user } = useAppStore.getState();

    if (!user) {
      return;
    }

    if (user.id === readerId) {
      rememberConversationReadThrough(conversationId, readAt);
      set((state) => ({
        conversations: state.conversations.map((conversation) => (
          conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
        )),
      }));
      scheduleStoredConversationsPersist();
      return;
    }

    enqueueReadReceipt(conversationId, readerId, readAt, new Set(messageIds ?? []), new Set(messageKeys ?? []));
  },

  async signOut() {
    await clearLocalSession();
    locallyClearedAfterByConversation.clear();
    resolvedLocalClearBoundaryConversationIds.clear();
    olderLocalMessageRequests.clear();
    olderLocalMessagesExhaustedBeforeByConversation.clear();

    set({ blockedUsers: [], callLogs: [], catalogUrl: null, helpUrl: null, contacts: [], conversations: [], conversationsNextOffset: 0, conversationsQuery: '', hasLoadedConversations: false, hasMoreConversations: false, isCheckingSubscription: false, isLoadingMoreConversations: false, messagesByConversation: {}, subscriptionStatus: null, user: null });
  },
}));

async function clearLocalSession() {
  await Promise.all([
    clearAuthToken(),
    clearStoredConversations(),
    clearStoredSubscriptionStatus(),
    clearStoredUser(),
  ]);
  clearNativeQuickReplyCredentials();
}

function requestConversationMessages(conversationId: string, serverUrl: string, options?: { hydrate?: boolean }) {
  const activeRequest = messageRequests.get(conversationId);

  if (activeRequest) {
    return activeRequest;
  }

  let request!: Promise<void>;
  request = (async () => {
    try {
      await loadConversationMessages(conversationId, serverUrl, options);
    } finally {
      if (messageRequests.get(conversationId) === request) {
        messageRequests.delete(conversationId);
      }
    }
  })();

  messageRequests.set(conversationId, request);
  return request;
}

async function syncIncomingConversationDeliveries(serverUrl: string, conversations: Conversation[]) {
  const { user } = useAppStore.getState();

  if (!user || NativeAppState.currentState !== 'active') {
    return;
  }

  const conversationsToSync = conversations.filter((conversation) => (
    conversation.unreadCount > 0 &&
    conversation.myGroupInvitePending !== true &&
    !deliverySyncConversationIds.has(conversation.id)
  ));

  if (conversationsToSync.length === 0) {
    return;
  }

  conversationsToSync.forEach((conversation) => deliverySyncConversationIds.add(conversation.id));

  await Promise.allSettled(conversationsToSync.map(async (conversation) => {
    try {
      await requestConversationMessages(conversation.id, serverUrl, { hydrate: false });
    } finally {
      deliverySyncConversationIds.delete(conversation.id);
    }
  }));
}

async function syncPendingMessageDeletionsForConversations(serverUrl: string, conversations: Conversation[]) {
  const conversationIds = conversations
    .filter((conversation) => conversation.myGroupInvitePending !== true)
    .map((conversation) => conversation.id)
    .filter((conversationId) => !deletionSyncConversationIds.has(conversationId));

  if (conversationIds.length === 0) {
    return;
  }

  conversationIds.forEach((conversationId) => deletionSyncConversationIds.add(conversationId));

  try {
    const deletionsByConversationId = await listBulkMessageDeletions(serverUrl, conversationIds);
    const ackItems: Array<{ conversationId: string; messageIds: string[]; messageKeys: string[] }> = [];

    for (const conversationId of conversationIds) {
      const result = await applyPendingMessageDeletions(conversationId, deletionsByConversationId[conversationId] ?? []);

      if (result.messageIds.length > 0 || result.messageKeys.length > 0) {
        ackItems.push({ conversationId, messageIds: result.messageIds, messageKeys: result.messageKeys });
      }
    }

    await acknowledgeBulkMessageDeletions(serverUrl, ackItems);
  } finally {
    conversationIds.forEach((conversationId) => deletionSyncConversationIds.delete(conversationId));
  }
}

async function syncPendingMessageDeletions(serverUrl: string, conversationId: string) {
  const deletions = await listMessageDeletions(serverUrl, conversationId);
  const result = await applyPendingMessageDeletions(conversationId, deletions);

  await acknowledgeMessageDeletions(serverUrl, conversationId, result.messageIds, result.messageKeys);
}

async function applyPendingMessageDeletions(conversationId: string, deletions: MessageDeletionUpdate[]) {
  const deletedMessageIds = deletions.map((deletion) => deletion.messageId).filter((id): id is string => !!id);
  const deletedMessageKeys = deletions.map((deletion) => deletion.messageKey).filter((key): key is string => !!key);

  if (deletedMessageIds.length === 0 && deletedMessageKeys.length === 0) {
    return { messageIds: [], messageKeys: [] };
  }

  deletedMessageIds.forEach((messageId) => rememberLocallyDeletedMessage(conversationId, messageId));
  deletedMessageKeys.forEach((messageKey) => rememberLocallyDeletedMessage(conversationId, undefined, messageKey));

  const storedMessages = dedupeMessages(deletedMessageIds.length === deletions.length
    ? await getStoredMessagesByIds(conversationId, deletedMessageIds)
    : await getStoredMessages(conversationId));
  const liveMessages = useAppStore.getState().messagesByConversation[conversationId];
  const liveMessagesBeforeDeletion = liveMessages ?? [];
  const locallyDeletedMessages = dedupeMessages([...storedMessages, ...liveMessagesBeforeDeletion])
    .filter((message) => shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys));
  const locallyDeletedMessageKeys = locallyDeletedMessages
    .map(getMessageDeleteKey)
    .filter((key): key is string => !!key);
  const deletedCallLogIds = locallyDeletedMessages
    .flatMap(getMessageCallLogIds);
  const nextStoredMessages = storedMessages
    .filter((message) => !shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys));
  const nextLiveMessages = liveMessagesBeforeDeletion
    .filter((message) => !shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys));
  const didChangeStoredMessages = nextStoredMessages.length !== storedMessages.length;
  const didChangeLiveMessages = nextLiveMessages.length !== liveMessagesBeforeDeletion.length;

  if (didChangeStoredMessages) {
    await removeStoredMessageRecords(conversationId, locallyDeletedMessages.map((message) => message.id));
  }
  const latestStoredMessagesAfterDeletion = didChangeStoredMessages
    ? await getStoredRecentMessages(conversationId, 1)
    : [];

  if (didChangeLiveMessages || (liveMessages && liveMessages.length > 0)) {
    useAppStore.setState((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? syncConversationPreviewWithMessages(conversation, nextLiveMessages.length > 0 ? nextLiveMessages : latestStoredMessagesAfterDeletion)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: nextLiveMessages,
      },
    }));
  } else if (didChangeStoredMessages) {
    useAppStore.setState((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? syncConversationPreviewWithMessages(conversation, latestStoredMessagesAfterDeletion)
          : conversation
      )),
    }));
  }

  const ackableMessageKeys = deletedMessageIds.length > 0
    ? deletedMessageKeys
    : deletedMessageKeys.filter((key) => locallyDeletedMessageKeys.includes(key));

  if (didChangeStoredMessages || didChangeLiveMessages) {
    scheduleStoredConversationsPersist();
  }
  void removeStoredCallLogs(deletedCallLogIds);

  return {
    messageIds: deletedMessageIds,
    messageKeys: ackableMessageKeys,
  };
}

async function syncPendingMessageStatusUpdatesForConversations(serverUrl: string, conversations: Conversation[]) {
  const conversationIds = conversations
    .filter((conversation) => conversation.myGroupInvitePending !== true)
    .map((conversation) => conversation.id)
    .filter((conversationId) => !statusUpdateSyncConversationIds.has(conversationId));

  if (conversationIds.length === 0) {
    return;
  }

  conversationIds.forEach((conversationId) => statusUpdateSyncConversationIds.add(conversationId));

  try {
    const updatesByConversationId = await listBulkMessageStatusUpdates(serverUrl, conversationIds);
    const ackItems: Array<{ conversationId: string; messageIds: string[]; messageKeys: string[] }> = [];

    for (const conversationId of conversationIds) {
      const result = await applyPendingMessageStatusUpdates(conversationId, updatesByConversationId[conversationId] ?? []);

      if (result.messageIds.length > 0 || result.messageKeys.length > 0) {
        ackItems.push({ conversationId, messageIds: result.messageIds, messageKeys: result.messageKeys });
      }
    }

    await acknowledgeBulkMessageStatusUpdates(serverUrl, ackItems);
  } finally {
    conversationIds.forEach((conversationId) => statusUpdateSyncConversationIds.delete(conversationId));
  }
}

async function syncPendingMessageStatusUpdates(serverUrl: string, conversationId: string) {
  const updates = await listMessageStatusUpdates(serverUrl, conversationId);
  const result = await applyPendingMessageStatusUpdates(conversationId, updates);

  await acknowledgeMessageStatusUpdates(serverUrl, conversationId, result.messageIds, result.messageKeys);
}

async function applyPendingMessageStatusUpdates(conversationId: string, updates: MessageStatusUpdate[]) {
  if (updates.length === 0) {
    return { messageIds: [], messageKeys: [] };
  }

  const updateMessageIds = updates.map((update) => update.messageId).filter((id): id is string => !!id);
  const storedMessages = dedupeMessages(updateMessageIds.length === updates.length
    ? await getStoredMessagesByIds(conversationId, updateMessageIds)
    : await getStoredMessages(conversationId));
  const liveMessages = useAppStore.getState().messagesByConversation[conversationId];
  const liveMessagesBeforeUpdate = liveMessages ?? [];
  const storedResult = applyMessageStatusUpdatesToMessages(storedMessages, updates);
  const liveResult = applyMessageStatusUpdatesToMessages(liveMessagesBeforeUpdate, updates);

  if (storedResult.didApply) {
    await persistChangedConversationMessages(
      conversationId,
      storedResult.messages.filter((message) => updates.some((update) => isMessageStatusUpdateTarget(message, update))),
    );
  }

  if (liveResult.didApply || (liveMessages && liveMessages.length > 0)) {
    const nextMessagesForState = liveResult.messages.length > 0 || liveMessagesBeforeUpdate.length > 0
      ? liveResult.messages
      : storedResult.messages;

    useAppStore.setState((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? syncConversationPreviewWithMessages(conversation, liveResult.messages.length > 0 ? liveResult.messages : storedResult.messages)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: nextMessagesForState,
      },
    }));
  } else {
    useAppStore.setState((state) => ({
      conversations: state.conversations.map((conversation) => (
        conversation.id === conversationId
          ? applyConversationStatusUpdatesToPreview(conversation, updates)
          : conversation
      )),
    }));
  }

  scheduleStoredConversationsPersist();

  return {
    messageIds: updates.map((update) => update.messageId).filter((id): id is string => !!id),
    messageKeys: updates.map((update) => update.messageKey).filter((key): key is string => !!key),
  };
}

async function loadConversationMessages(conversationId: string, serverUrl: string, options?: { hydrate?: boolean }) {
  logMessageDeliveryDiagnostic('load-messages-start', {
    conversationId,
    hydrate: options?.hydrate !== false,
  });
  if (options?.hydrate !== false) {
    await hydrateStoredConversationMessages(conversationId);
  }
  const cachedMessages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
  const conversation = useAppStore.getState().conversations.find((item) => item.id === conversationId);
  const currentUserId = useAppStore.getState().user?.id;
  const serverPreviewMessageId = conversation?.lastMessageId;
  const isServerPreviewMissingLocally = !!serverPreviewMessageId &&
    !cachedMessages.some((message) => message.id === serverPreviewMessageId);

  const latestCachedMessage = cachedMessages
    .filter((message) => !message.id.startsWith('local-') && message.createdAtIso)
    .at(-1);
  const deletedAfter = latestCachedMessage && !isServerPreviewMissingLocally ? null : await getDeletedConversationAfter(conversationId);
  const fetchAfter = isServerPreviewMissingLocally
    ? deletedAfter ?? undefined
    : getOverlappingMessageFetchAfter(latestCachedMessage?.createdAtIso) ?? deletedAfter ?? undefined;
  let response: Awaited<ReturnType<typeof listMessages>>;
  let editedMessagesToPersist: Message[] = [];

  logMessageDeliveryDiagnostic('load-messages-fetch-plan', {
    cachedCount: cachedMessages.length,
    conversationId,
    fetchAfter: fetchAfter ?? null,
    isServerPreviewMissingLocally,
    latestCachedMessageId: latestCachedMessage?.id,
    serverPreviewMessageId,
    summary: summarizeMessagesForDiagnostics(cachedMessages, currentUserId),
  });

  try {
    response = await listMessages(
      serverUrl,
      conversationId,
      fetchAfter,
    );
    const [deletions, edits] = await Promise.all([
      listMessageDeletions(serverUrl, conversationId),
      listMessageEdits(serverUrl, conversationId),
    ]);
    const deletedMessageIds = deletions.map((deletion) => deletion.messageId).filter((id): id is string => !!id);
    const deletedMessageKeys = deletions.map((deletion) => deletion.messageKey).filter((key): key is string => !!key);
    logMessageDeliveryDiagnostic('load-messages-fetched', {
      conversationId,
      deletedCount: deletions.length,
      editCount: edits.length,
      remoteCount: response.messages.length,
      remoteIds: response.messages.slice(-10).map((message) => message.id),
      remoteSummary: summarizeMessagesForDiagnostics(response.messages, currentUserId),
    });
    if (options?.hydrate !== false) {
      await hydrateStoredConversationMessages(conversationId);
    }
    if (deletedMessageIds.length > 0 || deletedMessageKeys.length > 0) {
      const deletedMessages = (useAppStore.getState().messagesByConversation[conversationId] ?? cachedMessages)
        .filter((message) => shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys));
      const deletedCallLogIds = deletedMessages.flatMap(getMessageCallLogIds);
      response = {
        ...response,
        messages: response.messages.filter((message) => (
          !shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys) &&
          !shouldRemoveMessageForLocalDeletion(message) &&
          !isReactionFallbackMessage(message)
        )),
      };
      useAppStore.setState((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: (state.messagesByConversation[conversationId] ?? cachedMessages)
            .filter((message) => (
              !shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys) &&
              !shouldRemoveMessageForLocalDeletion(message) &&
              !isReactionFallbackMessage(message)
            )),
        },
      }));
      await removeStoredMessageRecords(conversationId, deletedMessages.map((message) => message.id));
      await acknowledgeMessageDeletions(serverUrl, conversationId, deletedMessageIds, deletedMessageKeys);
      void removeStoredCallLogs(deletedCallLogIds);
    }
    if (edits.length > 0) {
      response = {
        ...response,
        messages: applyMessageEditsToMessages(response.messages, edits).messages,
      };
      useAppStore.setState((state) => {
        const result = applyMessageEditsToMessages(state.messagesByConversation[conversationId] ?? cachedMessages, edits);

        if (!result.didApply) {
          return state;
        }

        editedMessagesToPersist = result.messages.filter((message) => (
          edits.some((edit) => isMessageEditTarget(message, edit))
        ));

        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: result.messages,
          },
        };
      });
      await acknowledgeMessageEdits(
        serverUrl,
        conversationId,
        edits.map((edit) => edit.messageId).filter((id): id is string => !!id),
        edits.map((edit) => edit.messageKey).filter((key): key is string => !!key),
      );
    }
    if (useAppStore.getState().connectionStatus === 'offline') {
      useAppStore.setState({ connectionNotice: 'Connection recovered', connectionStatus: 'online' });
    } else {
      useAppStore.setState({ connectionStatus: 'online' });
    }
  } catch (error) {
    logMessageDeliveryDiagnostic('load-messages-fetch-failed', {
      conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
    useAppStore.setState({ connectionNotice: 'No connection to server. Showing saved messages.', connectionStatus: 'offline' });
    return;
  }

  let nextMessages = useAppStore.getState().messagesByConversation[conversationId] ?? cachedMessages;

  if (response.messages.length > 0) {
    useAppStore.setState((state) => {
      const currentMessages = state.messagesByConversation[conversationId] ?? cachedMessages;
      nextMessages = mergeMessages(currentMessages, response.messages)
        .filter((message) => !shouldRemoveMessageForLocalDeletion(message) && !isReactionFallbackMessage(message));

      logMessageDeliveryDiagnostic('load-messages-merged', {
        conversationId,
        currentSummary: summarizeMessagesForDiagnostics(currentMessages, currentUserId),
        mergedSummary: summarizeMessagesForDiagnostics(nextMessages, currentUserId),
        remoteSummary: summarizeMessagesForDiagnostics(response.messages, currentUserId),
      });

      return {
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: nextMessages,
        },
        conversations: state.conversations.map((conversation) => (
          conversation.id === conversationId
            ? syncConversationPreviewWithMessages(conversation, nextMessages)
            : conversation
        )),
      };
    });
  }

  const changedMessagesToPersist = dedupeMessages([
    ...response.messages,
    ...editedMessagesToPersist,
  ]).filter((message) => !shouldRemoveMessageForLocalDeletion(message) && !isReactionFallbackMessage(message));
  scheduleMessagePostLoadMaintenance(serverUrl, conversationId, nextMessages, changedMessagesToPersist);
}

async function hydrateStoredConversationMessages(conversationId: string, options?: { limit?: number }) {
  const requestKey = options?.limit ? `${conversationId}:recent:${options.limit}` : conversationId;
  const activeRequest = messageCacheRequests.get(requestKey);

  if (activeRequest) {
    return activeRequest;
  }

  let request!: Promise<void>;
  request = (async () => {
    try {
      const persistedMessages = dedupeMessages(options?.limit
        ? await getStoredRecentMessages(conversationId, options.limit)
        : await getStoredMessages(conversationId));
      const storedMessages = persistedMessages.filter((message) => !shouldRemoveMessageForLocalDeletion(message));
      const locallyDeletedMessageIds = persistedMessages
        .filter(shouldRemoveMessageForLocalDeletion)
        .map((message) => message.id);

      if (locallyDeletedMessageIds.length > 0) {
        await removeStoredMessageRecords(conversationId, locallyDeletedMessageIds);
      }

      if (storedMessages.length === 0) {
        logMessageDeliveryDiagnostic('hydrate-messages-empty', {
          conversationId,
          limit: options?.limit ?? null,
          persistedCount: persistedMessages.length,
        });
        return;
      }

      useAppStore.setState((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: mergeMessages(state.messagesByConversation[conversationId] ?? [], storedMessages),
        },
      }));
      logMessageDeliveryDiagnostic('hydrate-messages-loaded', {
        conversationId,
        limit: options?.limit ?? null,
        locallyDeletedCount: locallyDeletedMessageIds.length,
        persistedSummary: summarizeMessagesForDiagnostics(persistedMessages, useAppStore.getState().user?.id),
        storedSummary: summarizeMessagesForDiagnostics(storedMessages, useAppStore.getState().user?.id),
        stateSummary: summarizeMessagesForDiagnostics(useAppStore.getState().messagesByConversation[conversationId] ?? [], useAppStore.getState().user?.id),
      });
      scheduleLowPriorityStoreTask(() => scheduleIncomingMediaCaching(storedMessages), LOW_PRIORITY_MEDIA_CACHE_DELAY_MS);
    } finally {
      if (messageCacheRequests.get(requestKey) === request) {
        messageCacheRequests.delete(requestKey);
      }
    }
  })();

  messageCacheRequests.set(requestKey, request);
  return request;
}

async function loadOlderStoredConversationMessages(conversationId: string, options?: { limit?: number }) {
  const currentMessages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
  let oldestLoadedTime: number | undefined;

  for (const message of currentMessages) {
    const messageTime = getMessageTime(message);

    if (Number.isFinite(messageTime) && messageTime > 0 && (oldestLoadedTime === undefined || messageTime < oldestLoadedTime)) {
      oldestLoadedTime = messageTime;
    }
  }

  if (!oldestLoadedTime) {
    return 0;
  }

  const exhaustedBefore = olderLocalMessagesExhaustedBeforeByConversation.get(conversationId);

  if (exhaustedBefore !== undefined && oldestLoadedTime <= exhaustedBefore) {
    return 0;
  }

  const limit = Math.max(1, Math.min(500, Math.floor(options?.limit ?? 120)));
  const requestKey = `${conversationId}:${oldestLoadedTime}:${limit}`;
  const activeRequest = olderLocalMessageRequests.get(requestKey);

  if (activeRequest) {
    return activeRequest;
  }

  let request!: Promise<number>;
  request = (async () => {
    try {
      const persistedMessages = dedupeMessages(await getStoredOlderMessages(conversationId, oldestLoadedTime, limit));
      const storedMessages = persistedMessages.filter((message) => !shouldRemoveMessageForLocalDeletion(message));
      const locallyDeletedMessageIds = persistedMessages
        .filter(shouldRemoveMessageForLocalDeletion)
        .map((message) => message.id);

      if (locallyDeletedMessageIds.length > 0) {
        await removeStoredMessageRecords(conversationId, locallyDeletedMessageIds);
      }

      if (storedMessages.length === 0) {
        olderLocalMessagesExhaustedBeforeByConversation.set(conversationId, oldestLoadedTime);
        return 0;
      }

      let addedCount = 0;

      useAppStore.setState((state) => {
        const current = state.messagesByConversation[conversationId] ?? [];
        const next = mergeMessages(current, storedMessages);
        addedCount = Math.max(0, next.length - current.length);

        if (addedCount === 0) {
          return state;
        }

        return {
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: next,
          },
        };
      });

      scheduleIncomingMediaCaching(storedMessages, { limit: 0 });
      return addedCount;
    } finally {
      if (olderLocalMessageRequests.get(requestKey) === request) {
        olderLocalMessageRequests.delete(requestKey);
      }
    }
  })();

  olderLocalMessageRequests.set(requestKey, request);
  return request;
}

function scheduleIncomingMediaCaching(messages: Message[], options?: { limit?: number }) {
  const currentUserId = useAppStore.getState().user?.id;
  const limit = options?.limit ?? MAX_AUTOMATIC_INCOMING_MEDIA_CACHE_MESSAGES;

  if (!currentUserId || limit <= 0) {
    return;
  }

  const candidates = messages.slice(-limit);
  const highPriorityStartIndex = Math.max(0, candidates.length - 3);

  candidates.forEach((message, index) => {
    if (message.senderId !== currentUserId && isMediaMessageKind(message.kind)) {
      enqueueIncomingMediaCache(message, {
        priority: index >= highPriorityStartIndex ? 'high' : 'normal',
      });
    }
  });
}

function resumeLoadedIncomingMediaCaching() {
  const currentUserId = useAppStore.getState().user?.id;

  if (!currentUserId) {
    return;
  }

  const latestMessages = Object.values(useAppStore.getState().messagesByConversation as Record<string, Message[]>)
    .flatMap((messages) => messages.slice(-2))
    .filter((message) => message.senderId !== currentUserId && isMediaMessageKind(message.kind))
    .slice(-MAX_AUTOMATIC_INCOMING_MEDIA_CACHE_MESSAGES);

  latestMessages.forEach((message) => enqueueIncomingMediaCache(message, { priority: 'normal' }));
}

function enqueueIncomingMediaCache(message: Message, options?: { priority?: 'high' | 'normal' }) {
  if (queuedIncomingMediaCacheIds.has(message.id) || incomingMediaCacheRequests.has(message.id)) {
    return;
  }

  queuedIncomingMediaCacheIds.add(message.id);
  if (options?.priority === 'high') {
    incomingMediaCacheQueue.unshift(message);
  } else {
    incomingMediaCacheQueue.push(message);
  }
  void runIncomingMediaCacheQueue();
}

async function runIncomingMediaCacheQueue() {
  if (isIncomingMediaCacheQueueRunning) {
    return;
  }

  isIncomingMediaCacheQueueRunning = true;
  try {
    while (incomingMediaCacheQueue.length > 0) {
      const message = incomingMediaCacheQueue.shift();
      if (!message) {
        continue;
      }

      queuedIncomingMediaCacheIds.delete(message.id);
      await new Promise((resolve) => setTimeout(resolve, 600));
      await cacheMessageMediaAndPersist(message, { priority: 'normal' }).catch(() => null);
    }
  } finally {
    isIncomingMediaCacheQueueRunning = false;
  }
}

function getReadableIncomingMessageIds(messages: Message[] | undefined, currentUserId: string) {
  return (messages ?? [])
    .filter((message) => message.senderId !== currentUserId && !message.id.startsWith('local-'))
    .map((message) => message.id);
}

function getReadableIncomingMessageKeys(messages: Message[] | undefined, currentUserId: string) {
  return (messages ?? [])
    .filter((message) => message.senderId !== currentUserId && !message.id.startsWith('local-'))
    .map((message) => getMessageDeleteKey(message))
    .filter((messageKey): messageKey is string => !!messageKey);
}

function upsertMessage(messages: Message[], message: Message) {
  const existingIndex = messages.findIndex((item) => areMatchingMessages(item, message));

  if (existingIndex >= 0) {
    return messages.map((item, index) => (
      index === existingIndex ? mergeMessageUpdate(item, message) : item
    ));
  }

  return [...messages, message];
}

function mergeMessageUpdate(current: Message, next: Message): Message {
  const clientId = getMessageClientId(current) ?? getMessageClientId(next);
  const currentCallId = getMessageCallIdFromMetadata(current);
  const nextCallId = getMessageCallIdFromMetadata(next);
  const isSameCallMessage = !!currentCallId && currentCallId === nextCallId;
  const canonicalMessage = isSameCallMessage && getMessageTime(current) <= getMessageTime(next)
    ? current
    : next;
  const preferCurrentMedia = (current.status === 'sending' && !!current.mediaUri) || (
    isLocalMediaUri(current.mediaUri) && !isLocalMediaUri(next.mediaUri)
  );
  const preferCurrentBody = !!current.body && !next.body;
  const mediaUri = preferCurrentMedia ? current.mediaUri : next.mediaUri;
  const remoteMediaUri = getMessageRemoteMediaUri(next) ?? getMessageRemoteMediaUri(current);

  return {
    ...next,
    body: preferCurrentBody ? current.body : next.body,
    createdAt: canonicalMessage.createdAt,
    createdAtIso: canonicalMessage.createdAtIso,
    fileName: next.fileName ?? current.fileName,
    id: canonicalMessage.id,
    mediaUri,
    mimeType: next.mimeType ?? current.mimeType,
    metadata: mergeMessageMetadata(current.metadata, next.metadata, clientId, remoteMediaUri),
    sender: canonicalMessage.sender,
    senderId: canonicalMessage.senderId,
    sizeBytes: next.sizeBytes ?? current.sizeBytes,
    status: getHighestMessageStatus(current.status, next.status),
  };
}

const MESSAGE_STATUS_RANK: Record<Message['status'], number> = {
  delivered: 2,
  read: 3,
  sending: 0,
  sent: 1,
};

function getHighestMessageStatus(current: Message['status'], next: Message['status']) {
  return MESSAGE_STATUS_RANK[current] > MESSAGE_STATUS_RANK[next] ? current : next;
}

function applyMessageStatusUpdatesToMessages(messages: Message[], updates: MessageStatusUpdate[]) {
  const currentUserId = useAppStore.getState().user?.id;
  let didApply = false;

  if (!currentUserId || updates.length === 0 || messages.length === 0) {
    return { didApply, messages };
  }

  const nextMessages = messages.map((message) => {
    if (message.senderId !== currentUserId) {
      return message;
    }

    const matchingUpdates = updates.filter((update) => isMessageStatusUpdateTarget(message, update));

    if (matchingUpdates.length === 0) {
      return message;
    }

    const nextStatus = matchingUpdates.reduce<Message['status']>(
      (status, update) => getHighestMessageStatus(status, mapServerMessageStatus(update.status)),
      message.status,
    );

    if (nextStatus === message.status) {
      return message;
    }

    didApply = true;
    return { ...message, status: nextStatus };
  });

  return { didApply, messages: nextMessages };
}

function applyConversationStatusUpdatesToPreview(conversation: Conversation, updates: MessageStatusUpdate[]) {
  const currentUserId = useAppStore.getState().user?.id;

  if (!currentUserId || conversation.lastMessageSenderId !== currentUserId || !conversation.lastMessageId) {
    return conversation;
  }

  const matchingUpdates = updates.filter((update) => update.messageId === conversation.lastMessageId);

  if (matchingUpdates.length === 0) {
    return conversation;
  }

  const nextStatus = matchingUpdates.reduce<Message['status']>(
    (status, update) => getHighestMessageStatus(status, mapServerMessageStatus(update.status)),
    conversation.lastMessageStatus ?? 'sent',
  );

  return nextStatus === conversation.lastMessageStatus
    ? conversation
    : { ...conversation, lastMessageStatus: nextStatus };
}

function isMessageStatusUpdateTarget(message: Message, update: MessageStatusUpdate) {
  const messageKey = getMessageDeleteKey(message);

  return (!!update.messageId && update.messageId === message.id) ||
    (!!messageKey && update.messageKey === messageKey);
}

function mapServerMessageStatus(status: MessageStatusUpdate['status']): Message['status'] {
  return status === 'READ' ? 'read' : 'delivered';
}

function getHighestOptionalMessageStatus(
  current: Message['status'] | undefined,
  next: Message['status'] | undefined,
) {
  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return getHighestMessageStatus(current, next);
}

function isLocalMediaUri(uri?: string) {
  if (!uri) {
    return false;
  }

  if (/^(file|content):/i.test(uri)) {
    return true;
  }

  return [FileSystem.documentDirectory, FileSystem.cacheDirectory].some((directory) => (
    !!directory && uri.startsWith(directory)
  ));
}

function isMediaMessageKind(kind: Message['kind']) {
  return kind === 'image' || kind === 'video' || kind === 'file' || kind === 'voice';
}

async function isMessageContentReadyForAck(message: Message, currentUserId?: string | null) {
  if (!currentUserId || message.id.startsWith('local-')) {
    return false;
  }

  if (!isMediaMessageKind(message.kind)) {
    return true;
  }

  return isLocalMediaUri(message.mediaUri) && (await isLocalMediaFileComplete(message.mediaUri, message.sizeBytes));
}

async function getContentAckableMessageIds(messages: Message[], currentUserId?: string | null) {
  const ackableIds: string[] = [];
  let checkedCount = 0;

  for (const message of messages) {
    if (await isMessageContentReadyForAck(message, currentUserId)) {
      ackableIds.push(message.id);
    }
    checkedCount += 1;
    if (checkedCount % 20 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return ackableIds;
}

function replaceMatchingOptimisticMessage(messages: Message[], message: Message) {
  const messageClientId = getMessageClientId(message);
  const optimisticIndex = messages.findIndex((item) => (
    item.id.startsWith('local-') &&
    !!messageClientId &&
    getMessageClientId(item) === messageClientId
  ));

  if (optimisticIndex >= 0) {
    return messages.map((item, index) => (
      index === optimisticIndex
        ? mergeMessageUpdate(item, message)
        : item
    ));
  }

  return upsertMessage(messages, message);
}

function getMessageClientId(message: Message) {
  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'clientId' in metadata && typeof metadata.clientId === 'string'
    ? metadata.clientId
    : undefined;
}

function getMessageDeleteKey(message?: Message) {
  const metadata = message?.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : undefined;
}

function getMessageScheduledMessageId(message?: Message) {
  const metadata = message?.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'scheduledMessageId' in metadata &&
    typeof metadata.scheduledMessageId === 'string'
    ? metadata.scheduledMessageId
    : undefined;
}

function rememberLocallyDeletedMessage(conversationId: string, messageId?: string, messageKey?: string) {
  if (messageId) {
    const ids = locallyDeletedMessageIdsByConversation.get(conversationId) ?? new Set<string>();
    ids.add(messageId);
    locallyDeletedMessageIdsByConversation.set(conversationId, ids);
  }

  if (messageKey) {
    const keys = locallyDeletedMessageKeysByConversation.get(conversationId) ?? new Set<string>();
    keys.add(messageKey);
    locallyDeletedMessageKeysByConversation.set(conversationId, keys);
  }
}

function forgetLocallyDeletedMessage(conversationId: string, messageId?: string, messageKey?: string) {
  if (messageId) {
    const ids = locallyDeletedMessageIdsByConversation.get(conversationId);
    ids?.delete(messageId);
    if (ids?.size === 0) {
      locallyDeletedMessageIdsByConversation.delete(conversationId);
    }
  }

  if (messageKey) {
    const keys = locallyDeletedMessageKeysByConversation.get(conversationId);
    keys?.delete(messageKey);
    if (keys?.size === 0) {
      locallyDeletedMessageKeysByConversation.delete(conversationId);
    }
  }
}

function getLocalDeletedMessageIds(conversationId: string) {
  return Array.from(locallyDeletedMessageIdsByConversation.get(conversationId) ?? []);
}

function getLocalDeletedMessageKeys(conversationId: string) {
  return Array.from(locallyDeletedMessageKeysByConversation.get(conversationId) ?? []);
}

function shouldRemoveMessageForLocalDeletion(message: Message) {
  return shouldRemoveMessageForDeletion(
    message,
    getLocalDeletedMessageIds(message.conversationId),
    getLocalDeletedMessageKeys(message.conversationId),
  );
}

function getMessageEditKey(edit: MessageEdit) {
  return edit.messageKey || undefined;
}

function findMessageByEdit(conversationId: string, edit: MessageEdit) {
  return (useAppStore.getState().messagesByConversation[conversationId] ?? []).find((message) => isMessageEditTarget(message, edit));
}

function isMessageEditTarget(message: Message, edit: MessageEdit) {
  const messageKey = getMessageDeleteKey(message);
  const editKey = getMessageEditKey(edit);
  const editLiveLocationId = getLiveLocationIdFromMetadata(edit.metadata);

  return (!!edit.messageId && message.id === edit.messageId) ||
    (!!editKey && messageKey === editKey) ||
    (!!editLiveLocationId && getMessageLiveLocationId(message) === editLiveLocationId);
}

function applyMessageEditToMessage(message: Message, edit: MessageEdit): Message {
  return {
    ...message,
    body: edit.body,
    metadata: mergeMessageMetadata(
      message.metadata,
      {
        ...(edit.metadata && typeof edit.metadata === 'object' ? edit.metadata : {}),
        deleteKey: getMessageEditKey(edit) ?? getMessageDeleteKey(message),
      },
    ),
  };
}

function applyMessageEditsToMessages(messages: Message[], edits: MessageEdit[]) {
  let didApply = false;
  const nextMessages = messages.map((message) => {
    const edit = edits.find((item) => isMessageEditTarget(message, item));

    if (!edit) {
      return message;
    }

    didApply = true;
    return applyMessageEditToMessage(message, edit);
  });

  return { didApply, messages: nextMessages };
}

function applyMessageEditToState(edit: MessageEdit) {
  let didApply = false;
  let editedMessage: Message | null = null;

  useAppStore.setState((state) => {
    const currentMessages = state.messagesByConversation[edit.conversationId] ?? [];
    const result = applyMessageEditsToMessages(currentMessages, [edit]);

    if (!result.didApply) {
      return state;
    }

    didApply = true;
    editedMessage = result.messages.find((message) => isMessageEditTarget(message, edit)) ?? null;
    return {
      conversations: state.conversations.map((conversation) => (
        conversation.id === edit.conversationId
          ? syncConversationPreviewWithMessages(conversation, result.messages)
          : conversation
      )),
      messagesByConversation: {
        ...state.messagesByConversation,
        [edit.conversationId]: result.messages,
      },
    };
  });

  if (didApply) {
    if (editedMessage) {
      void persistChangedConversationMessages(edit.conversationId, [editedMessage]);
    }
    scheduleStoredConversationsPersist();
  }

  return didApply;
}

function withLocalDeleteKey(conversationId: string, clientId?: string, metadata?: Message['metadata']) {
  const metadataDeleteKey = getDeleteKeyFromMetadata(metadata);
  const localDeleteKey = clientId
    ? getMessageDeleteKey((useAppStore.getState().messagesByConversation[conversationId] ?? [])
        .find((message) => getMessageClientId(message) === clientId))
    : undefined;
  const deleteKey = metadataDeleteKey ?? localDeleteKey ?? createMessageDeleteKey();

  return {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    deleteKey,
  };
}

function getDeleteKeyFromMetadata(metadata: Message['metadata'] | undefined) {
  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : undefined;
}

function createMessageDeleteKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 16; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return value;
}

function shouldRemoveMessageForDeletion(message: Message, messageIds: string[], messageKeys: string[]) {
  const deleteKey = getMessageDeleteKey(message);

  return messageIds.includes(message.id) || (!!deleteKey && messageKeys.includes(deleteKey));
}

async function forwardMediaMessage(serverUrl: string, conversationId: string, sourceMessage: Message) {
  if (sourceMessage.kind === 'text' || sourceMessage.kind === 'call') {
    throw new Error(t('messageCannotBeForwarded'));
  }

  if (sourceMessage.mediaId) {
    try {
      return await createForwardedMessage(serverUrl, conversationId, sourceMessage);
    } catch (error) {
      if (!sourceMessage.mediaUri && !getMessageRemoteMediaUri(sourceMessage)) {
        throw error;
      }
    }
  }

  const preparedMedia = await prepareForwardMediaUpload(sourceMessage);
  const deleteKeyMetadata = withLocalDeleteKey(conversationId, undefined, {
    forwarded: true,
  });

  const media = await uploadMediaFile(serverUrl, {
    durationSec: sourceMessage.kind === 'voice'
      ? Math.max(1, Math.round(sourceMessage.durationSeconds ?? 1))
      : undefined,
    mimeType: preparedMedia.mimeType,
    originalName: preparedMedia.fileName,
    sizeBytes: preparedMedia.sizeBytes,
    uri: preparedMedia.uri,
  });

  if (sourceMessage.kind === 'voice') {
    const message = await createVoiceMessage(
      serverUrl,
      conversationId,
      media.id,
      undefined,
      deleteKeyMetadata,
    );

    return {
      ...message,
      mediaUri: preparedMedia.uri,
    };
  }

  const message = await createMediaMessage(serverUrl, conversationId, {
    body: sourceMessage.body,
    kind: sourceMessage.kind.toUpperCase() as 'IMAGE' | 'VIDEO' | 'FILE',
    mediaId: media.id,
    metadata: deleteKeyMetadata,
  });

  return {
    ...message,
    mediaUri: preparedMedia.uri,
  };
}

async function prepareForwardMediaUpload(message: Message) {
  const localMediaUri = message.mediaUri;
  const remoteMediaUri = getMessageRemoteMediaUri(message);
  const fileName = getForwardMediaFileName(message);
  const mimeType = getForwardMediaMimeType(message);

  if (localMediaUri && isForwardableLocalUri(localMediaUri)) {
    const isComplete = /^content:/i.test(localMediaUri)
      ? true
      : await isLocalMediaFileComplete(localMediaUri, message.sizeBytes);

    if (isComplete) {
      return {
        fileName,
        mimeType,
        sizeBytes: await getForwardMediaFileSize(localMediaUri, message.sizeBytes),
        uri: localMediaUri,
      };
    }
  }

  if (remoteMediaUri) {
    const cachedUri = await downloadForwardMediaToCache(message, remoteMediaUri);

    return {
      fileName,
      mimeType,
      sizeBytes: await getForwardMediaFileSize(cachedUri, message.sizeBytes),
      uri: cachedUri,
    };
  }

  throw new Error(t('mediaForwardUnavailableYet'));
}

async function downloadForwardMediaToCache(message: Message, remoteUri: string) {
  const cacheRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory;

  if (!cacheRoot) {
    throw new Error(t('cacheDirectoryUnavailable'));
  }

  const localUri = `${cacheRoot}forward-${message.id}-${sanitizeCacheFileName(getForwardMediaFileName(message))}`;
  const cachedUri = await downloadRemoteMediaFile({
    expectedSizeBytes: message.sizeBytes,
    localUri,
    messageId: message.id,
    remoteUri,
  });

  if (!cachedUri) {
    throw new Error(t('mediaNoLongerAvailable'));
  }

  return cachedUri;
}

async function getForwardMediaFileSize(uri: string, fallbackSize?: number) {
  if (fallbackSize && fallbackSize > 0) {
    return fallbackSize;
  }

  const info = await FileSystem.getInfoAsync(uri);

  if (!info.exists || typeof info.size !== 'number' || info.size <= 0) {
    throw new Error(t('mediaForwardUnavailableYet'));
  }

  return info.size;
}

function isForwardableLocalUri(uri: string) {
  return /^file:/i.test(uri) || /^content:/i.test(uri);
}

function getForwardMediaFileName(message: Message) {
  if (message.fileName?.trim()) {
    return message.fileName.trim();
  }

  switch (message.kind) {
    case 'image':
      return `${message.id}.jpg`;
    case 'video':
      return `${message.id}.mp4`;
    case 'voice':
      return `${message.id}.m4a`;
    case 'file':
      return `${message.id}.bin`;
    default:
      return `${message.id}.bin`;
  }
}

function getForwardMediaMimeType(message: Message) {
  if (message.mimeType?.trim()) {
    return message.mimeType.trim();
  }

  switch (message.kind) {
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'voice':
      return 'audio/mp4';
    case 'file':
    default:
      return 'application/octet-stream';
  }
}

function getMessageRemoteMediaUri(message?: Message) {
  if (!message) {
    return undefined;
  }

  if (message.mediaUri && /^https?:\/\//i.test(message.mediaUri)) {
    return message.mediaUri;
  }

  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'remoteMediaUri' in metadata && typeof metadata.remoteMediaUri === 'string'
    ? metadata.remoteMediaUri
    : undefined;
}

function withRemoteMediaMetadata(message: Message, remoteMediaUri: string) {
  return {
    ...message,
    metadata: {
      ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
      remoteMediaUri,
    },
  };
}

function getMessageCallLogId(message?: Message) {
  if (!message || message.kind !== 'call') {
    return undefined;
  }

  return getMessageCallIdFromMetadata(message) ?? message.id;
}

function getMessageCallIdFromMetadata(message?: Message) {
  const metadata = message?.metadata;

  return message?.kind === 'call' && metadata && typeof metadata === 'object' && 'callId' in metadata && typeof metadata.callId === 'string'
    ? metadata.callId
    : undefined;
}

function rememberPendingCallRead(conversationId: string, callId: string) {
  const existing = pendingReadCallIdsByConversation.get(conversationId) ?? new Set<string>();

  existing.add(callId);
  pendingReadCallIdsByConversation.set(conversationId, existing);
}

function applyPendingCallRead(message: Message, currentUserId?: string | null) {
  if (!currentUserId || message.senderId !== currentUserId) {
    return message;
  }

  const callId = getMessageCallLogId(message);

  if (!callId || !pendingReadCallIdsByConversation.get(message.conversationId)?.has(callId)) {
    return message;
  }

  return {
    ...message,
    status: 'read' as const,
  };
}

function getMessageCallLogIds(message?: Message) {
  if (!message || message.kind !== 'call') {
    return [];
  }

  return Array.from(new Set([getMessageCallLogId(message), message.id].filter((id): id is string => !!id)));
}

function getMessageCallStatus(message?: Message) {
  const metadata = message?.metadata;

  return metadata && typeof metadata === 'object' && 'callStatus' in metadata && typeof metadata.callStatus === 'string'
    ? metadata.callStatus
    : undefined;
}

function findCallMessageByCallLog(callLog: CallLog) {
  const messagesByConversation = useAppStore.getState().messagesByConversation;
  const conversationMessages = callLog.conversationId ? messagesByConversation[callLog.conversationId] ?? [] : [];
  const messages = conversationMessages.length > 0
    ? conversationMessages
    : Object.values(messagesByConversation).flat();

  return messages.find((message) => getMessageCallLogId(message) === callLog.id);
}

function findMatchingMessage(messages: Message[], message: Message) {
  return messages.find((item) => areMatchingMessages(item, message));
}

function areMatchingMessages(current: Message, next: Message) {
  const nextClientId = getMessageClientId(next);
  const nextDeleteKey = getMessageDeleteKey(next);
  const nextScheduledMessageId = getMessageScheduledMessageId(next);
  const nextCallId = getMessageCallIdFromMetadata(next);
  const nextLiveLocationId = getMessageLiveLocationId(next);

  return current.id === next.id ||
    (!!nextClientId && getMessageClientId(current) === nextClientId) ||
    (!!nextDeleteKey && getMessageDeleteKey(current) === nextDeleteKey) ||
    (!!nextScheduledMessageId && getMessageScheduledMessageId(current) === nextScheduledMessageId) ||
    (!!nextCallId && getMessageCallIdFromMetadata(current) === nextCallId) ||
    (!!nextLiveLocationId && getMessageLiveLocationId(current) === nextLiveLocationId);
}

function shouldCountMessageAsUnread(message: Message, currentUserId?: string) {
  if (message.senderId === currentUserId) {
    return false;
  }

  if (message.kind === 'call') {
    const callStatus = getMessageCallStatus(message);

    return callStatus === 'MISSED' || callStatus === 'CANCELLED';
  }

  return true;
}

function getUnreadCountDelta(nextMessage: Message, currentMessage: Message | undefined, currentUserId?: string) {
  const shouldCountNext = shouldCountMessageAsUnread(nextMessage, currentUserId);
  const didCountCurrent = currentMessage ? shouldCountMessageAsUnread(currentMessage, currentUserId) : false;

  if (shouldCountNext === didCountCurrent) {
    return 0;
  }

  return shouldCountNext ? 1 : -1;
}

function updateMessageReactions(metadata: Message['metadata'] | undefined, userId: string, emoji: string | null) {
  const current = metadata && typeof metadata === 'object' && 'reactions' in metadata && metadata.reactions && typeof metadata.reactions === 'object'
    ? metadata.reactions as Record<string, string>
    : {};
  const next = { ...current };

  if (emoji) {
    next[userId] = emoji;
  } else {
    delete next[userId];
  }

  return next;
}

function isReactionFallbackMessage(message: Message) {
  const metadata = message.metadata;

  return !!(
    metadata &&
    typeof metadata === 'object' &&
    'reactionFallback' in metadata &&
    metadata.reactionFallback &&
    typeof metadata.reactionFallback === 'object'
  );
}

async function removeStoredCallLogs(callLogIds: (string | undefined)[]) {
  const uniqueIds = Array.from(new Set(callLogIds.filter((id): id is string => !!id)));

  if (uniqueIds.length === 0) {
    return;
  }

  const storedCallLogs = await getStoredCallLogs();
  const callLogsById = new Map<string, CallLog>();

  [...storedCallLogs, ...useAppStore.getState().callLogs].forEach((callLog) => {
    callLogsById.set(callLog.id, callLog);
  });

  const currentCallLogs = Array.from(callLogsById.values());
  const callLogs = currentCallLogs.filter((item) => !uniqueIds.includes(item.id));

  if (callLogs.length === currentCallLogs.length) {
    return;
  }

  await setStoredCallLogs(callLogs);
  useAppStore.setState({ callLogs });
}

function mergeMessageMetadata(
  currentMetadata: Message['metadata'] | undefined,
  nextMetadata: Message['metadata'] | undefined,
  clientId?: string,
  remoteMediaUri?: string,
) {
  if (!clientId && !remoteMediaUri && !currentMetadata) {
    return nextMetadata;
  }

  const metadata = {
    ...(currentMetadata && typeof currentMetadata === 'object' ? currentMetadata : {}),
    ...(nextMetadata && typeof nextMetadata === 'object' ? nextMetadata : {}),
    ...(clientId ? { clientId } : {}),
    ...(remoteMediaUri ? { remoteMediaUri } : {}),
  };

  if ('liveLocation' in metadata) {
    delete metadata.liveLocationEstablishment;
  }

  return metadata;
}

function getMessageLiveLocationId(message: Message) {
  return getLiveLocationIdFromMetadata(message.metadata);
}

function getLiveLocationIdFromMetadata(metadata: Message['metadata'] | null | undefined) {
  if (!metadata || typeof metadata !== 'object' || !('liveLocation' in metadata)) {
    return undefined;
  }

  const liveLocation = metadata.liveLocation;

  return liveLocation &&
    typeof liveLocation === 'object' &&
    'id' in liveLocation &&
    typeof liveLocation.id === 'string'
    ? liveLocation.id
    : undefined;
}

function mergeMessages(currentMessages: Message[], nextMessages: Message[]) {
  return dedupeMessages([...currentMessages, ...nextMessages]).sort((left, right) => (
    getMessageTime(left) - getMessageTime(right)
  ));
}

function summarizeMessagesForDiagnostics(messages: Message[], currentUserId?: string | null) {
  const outgoingMessages = currentUserId ? messages.filter((message) => message.senderId === currentUserId) : [];
  const incomingMessages = currentUserId ? messages.filter((message) => message.senderId !== currentUserId) : [];
  const emptyTextMessages = messages.filter((message) => message.kind === 'text' && message.body.trim().length === 0);
  const emptyOutgoingTextMessages = currentUserId
    ? emptyTextMessages.filter((message) => message.senderId === currentUserId)
    : [];

  return {
    emptyOutgoingTextCount: emptyOutgoingTextMessages.length,
    emptyOutgoingTextIds: emptyOutgoingTextMessages.slice(-10).map((message) => message.id),
    emptyTextCount: emptyTextMessages.length,
    incomingCount: incomingMessages.length,
    lastIds: messages.slice(-10).map((message) => message.id),
    outgoingCount: outgoingMessages.length,
    totalCount: messages.length,
  };
}

function dedupeMessages(messages: Message[]) {
  const deduped: Message[] = [];
  const keyToIndex = new Map<string, number>();

  messages.forEach((message) => {
    const keys = getMessageMergeKeys(message);
    const existingIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index): index is number => index !== undefined);

    if (existingIndex === undefined) {
      const nextIndex = deduped.length;
      deduped.push(message);
      keys.forEach((key) => keyToIndex.set(key, nextIndex));
      return;
    }

    const mergedMessage = mergeMessageUpdate(deduped[existingIndex], message);
    deduped[existingIndex] = mergedMessage;
    getMessageMergeKeys(mergedMessage).forEach((key) => keyToIndex.set(key, existingIndex));
  });

  return deduped;
}

function getMessageMergeKeys(message: Message) {
  return [
    message.id,
    getMessageClientId(message),
    getMessageDeleteKey(message),
    getMessageScheduledMessageId(message),
    getMessageCallIdFromMetadata(message),
    getMessageLiveLocationId(message),
  ].filter((key): key is string => !!key);
}

function applyReadThrough(messages: Message[], currentUserId?: string, readThrough?: string | null) {
  if (!currentUserId || !readThrough) {
    return messages;
  }

  return messages.map((message) => (
    message.senderId === currentUserId && isMessageReadByTimestamp(message, readThrough)
      ? { ...message, status: 'read' as const }
      : message
  ));
}

function isMessageReadByTimestamp(message: Message, readAt?: string | null) {
  if (!readAt || !message.createdAtIso) {
    return !readAt;
  }

  return new Date(message.createdAtIso).getTime() <= new Date(readAt).getTime();
}

function getMessageTime(message: Message) {
  const timestamp = message.createdAtIso ?? message.createdAt;
  const time = timestamp ? new Date(timestamp).getTime() : 0;
  return Number.isNaN(time) ? 0 : time;
}

function getOverlappingMessageFetchAfter(createdAtIso?: string) {
  if (!createdAtIso) {
    return undefined;
  }

  const createdAtTime = Date.parse(createdAtIso);

  if (!Number.isFinite(createdAtTime)) {
    return undefined;
  }

  return new Date(Math.max(0, createdAtTime - 2000)).toISOString();
}

async function persistChangedConversationMessages(conversationId: string, messages: Message[]) {
  const changedMessages = dedupeMessages(messages);

  if (changedMessages.length === 0) {
    return;
  }

  await upsertStoredMessages(conversationId, changedMessages);
}

async function persistCurrentConversationMessage(conversationId: string, messageId: string) {
  const message = (useAppStore.getState().messagesByConversation[conversationId] ?? [])
    .find((item) => item.id === messageId || getMessageClientId(item) === messageId);

  if (!message) {
    return;
  }

  await persistChangedConversationMessages(conversationId, [message]);
}

function upsertConversation(conversations: Conversation[], conversation: Conversation) {
  const current = conversations.find((item) => item.id === conversation.id) ??
    conversations.find((item) => isSameDirectConversationPeer(item, conversation));
  const nextConversation = keepLocalConversationPreview(current, conversation);
  const nextConversations = current
    ? conversations
        .filter((item) => item.id === current.id || !isSameDirectConversationPeer(item, nextConversation))
        .map((item) => (item.id === current.id ? nextConversation : item))
    : [nextConversation, ...conversations];

  return sortConversationsByActivity(dedupeConversations(nextConversations));
}

function isSameDirectConversationPeer(left: Conversation, right: Conversation) {
  return left.type === 'DIRECT' &&
    right.type === 'DIRECT' &&
    !!left.otherUserId &&
    left.otherUserId === right.otherUserId;
}

function sortConversationsByActivity(conversations: Conversation[]) {
  return [...conversations].sort((left, right) => getConversationActivityTime(right) - getConversationActivityTime(left));
}

function getConversationActivityTime(conversation: Conversation) {
  const value = conversation.lastMessageAtIso ?? conversation.lastMessageAt;
  const time = value ? new Date(value).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
}

function rememberConversationReadThrough(conversationId: string, readAt?: string) {
  const readTime = readAt ? Date.parse(readAt) : Date.now();

  if (!Number.isFinite(readTime)) {
    localReadThroughByConversation.set(conversationId, Date.now());
    return;
  }

  localReadThroughByConversation.set(conversationId, readTime);
}

function getMergedUnreadCount(current: Conversation, incoming: Conversation, preferIncomingUnread?: boolean) {
  if (!preferIncomingUnread) {
    return Math.max(current.unreadCount, incoming.unreadCount);
  }

  const localReadThrough = localReadThroughByConversation.get(incoming.id);
  const incomingActivityTime = getConversationActivityTime(incoming);
  const hasLocalReadThroughForIncomingActivity = (
    localReadThrough !== undefined &&
    incomingActivityTime <= localReadThrough
  );

  if (
    current.unreadCount === 0 &&
    incoming.unreadCount > 0 &&
    hasLocalReadThroughForIncomingActivity
  ) {
    return 0;
  }

  if (
    current.unreadCount > incoming.unreadCount &&
    !hasLocalReadThroughForIncomingActivity
  ) {
    return current.unreadCount;
  }

  return incoming.unreadCount;
}

async function applyLocalConversationClearBoundaries(conversations: Conversation[]) {
  return Promise.all(conversations.map(async (conversation) => {
    let clearedAfter = locallyClearedAfterByConversation.get(conversation.id);

    if (clearedAfter === undefined && !resolvedLocalClearBoundaryConversationIds.has(conversation.id)) {
      const storedClearedAfter = await getDeletedConversationAfter(conversation.id);
      const parsedClearedAfter = storedClearedAfter ? Date.parse(storedClearedAfter) : Number.NaN;

      if (Number.isFinite(parsedClearedAfter)) {
        clearedAfter = parsedClearedAfter;
        locallyClearedAfterByConversation.set(conversation.id, parsedClearedAfter);
      }
      resolvedLocalClearBoundaryConversationIds.add(conversation.id);
    }

    if (clearedAfter === undefined) {
      return conversation;
    }

    const serverActivityTime = getConversationActivityTime(conversation);

    if (conversation.lastMessageId && serverActivityTime > clearedAfter) {
      locallyClearedAfterByConversation.delete(conversation.id);
      await clearDeletedConversationAfter(conversation.id);
      return conversation;
    }

    return {
      ...conversation,
      lastMessage: 'No messages yet',
      lastMessageId: undefined,
      lastMessageKind: undefined,
      lastMessageSenderId: undefined,
      lastMessageStatus: undefined,
      unreadCount: 0,
    };
  }));
}

async function repairConversationPreviewsWithStoredMessages(conversations: Conversation[]) {
  if (conversations.length === 0) {
    return conversations;
  }

  const conversationIds = conversations
    .filter((conversation) => isVisibleConversation(conversation) && conversation.myGroupInvitePending !== true)
    .map((conversation) => conversation.id);

  if (conversationIds.length === 0) {
    return conversations;
  }

  let latestMessagesByConversationId: Map<string, Message>;

  try {
    latestMessagesByConversationId = await getStoredLatestMessagesByConversationIds(conversationIds);
  } catch {
    return conversations;
  }

  if (latestMessagesByConversationId.size === 0) {
    return conversations;
  }

  let didRepair = false;
  const repairedConversations = conversations.map((conversation) => {
    const latestMessage = latestMessagesByConversationId.get(conversation.id);

    if (!latestMessage || !shouldApplyStoredMessagePreview(conversation, latestMessage)) {
      return conversation;
    }

    const repairedConversation = applyStoredMessagePreviewToConversation(conversation, latestMessage);

    if (hasSameConversationPreview(conversation, repairedConversation)) {
      return conversation;
    }

    didRepair = true;
    return repairedConversation;
  });

  return didRepair
    ? sortConversationsByActivity(dedupeConversations(repairedConversations))
    : conversations;
}

function mergeConversationPreviews(currentConversations: Conversation[], serverConversations: Conversation[], query = '', options?: { append?: boolean; preferIncomingUnread?: boolean }) {
  const mergedConversations = serverConversations.map((conversation) => {
    const current = currentConversations.find((item) => item.id === conversation.id) ??
      currentConversations.find((item) => isSameDirectConversationPeer(item, conversation));

    return keepLocalConversationPreview(current, conversation, { preferIncomingUnread: options?.preferIncomingUnread === true });
  });
  const serverConversationIds = new Set(serverConversations.map((conversation) => conversation.id));
  const locallyActiveConversations = query
    ? []
    : currentConversations.filter((conversation) => (
        !serverConversationIds.has(conversation.id) && (options?.append === true || hasPendingLocalConversationMessage(conversation.id))
      ));

  return sortConversationsByActivity(dedupeConversations([...mergedConversations, ...locallyActiveConversations]));
}

function dedupeConversations(conversations: Conversation[]) {
  const conversationsById = new Map<string, Conversation>();

  conversations.forEach((conversation) => {
    const directPeerKey = getDirectConversationPeerKey(conversation);
    const existingKey = directPeerKey && Array.from(conversationsById.keys()).find((key) => {
      const currentConversation = conversationsById.get(key);

      return !!currentConversation && getDirectConversationPeerKey(currentConversation) === directPeerKey;
    });
    const conversationKey = existingKey ?? conversation.id;
    const current = conversationsById.get(conversationKey);

    if (!current) {
      conversationsById.set(conversationKey, conversation);
      return;
    }

    const merged = getConversationActivityTime(conversation) >= getConversationActivityTime(current)
      ? keepLocalConversationPreview(current, conversation)
      : keepLocalConversationPreview(conversation, current);

    conversationsById.set(conversationKey, {
      ...merged,
      unreadCount: Math.max(current.unreadCount, conversation.unreadCount, merged.unreadCount),
    });
  });

  return Array.from(conversationsById.values());
}

function getDirectConversationPeerKey(conversation: Conversation) {
  return conversation.type === 'DIRECT' && conversation.otherUserId
    ? `direct:${conversation.otherUserId}`
    : null;
}

function isVisibleConversation(conversation: Conversation) {
  return conversation.type !== 'DIRECT' || !!conversation.otherUserId;
}

function shouldApplyStoredMessagePreview(conversation: Conversation, message: Message) {
  if (conversation.myGroupInvitePending) {
    return false;
  }

  if (locallyDeletedMessageIdsByConversation.get(conversation.id)?.has(message.id)) {
    return false;
  }

  const messageDeleteKey = getMessageDeleteKey(message);

  if (messageDeleteKey && locallyDeletedMessageKeysByConversation.get(conversation.id)?.has(messageDeleteKey)) {
    return false;
  }

  const messageTime = getMessageTime(message);
  const clearedAfter = locallyClearedAfterByConversation.get(conversation.id);

  if (clearedAfter !== undefined && messageTime <= clearedAfter) {
    return false;
  }

  if (isWeakConversationPreview(conversation)) {
    return true;
  }

  return messageTime >= getConversationActivityTime(conversation);
}

function isWeakConversationPreview(conversation: Pick<Conversation, 'lastMessage' | 'lastMessageKind'>) {
  const preview = conversation.lastMessage?.trim();

  if (!preview || preview === 'No messages yet' || preview === 'New message') {
    return true;
  }

  return preview === 'Call' && conversation.lastMessageKind !== 'call';
}

function keepLocalConversationPreview(current: Conversation | undefined, incoming: Conversation, options?: { preferIncomingUnread?: boolean }) {
  if (!current) {
    return incoming;
  }

  const incomingWithMergedMembers = mergeConversationMemberMetadata(current, incoming);

  if (incoming.myGroupInvitePending) {
    return { ...incomingWithMergedMembers, unreadCount: 1 };
  }

  if (
    incoming.lastMessageId &&
    locallyDeletedMessageIdsByConversation.get(incoming.id)?.has(incoming.lastMessageId)
  ) {
    return {
      ...incomingWithMergedMembers,
      lastMessage: current.lastMessage,
      lastMessageAt: current.lastMessageAt,
      lastMessageAtIso: current.lastMessageAtIso,
      lastMessageId: current.lastMessageId,
      lastMessageKind: current.lastMessageKind,
      lastMessageSenderId: current.lastMessageSenderId,
      lastMessageStatus: current.lastMessageStatus,
      unreadCount: getMergedUnreadCount(current, incoming, options?.preferIncomingUnread === true),
    };
  }

  const currentTime = getConversationActivityTime(current);
  const incomingTime = getConversationActivityTime(incoming);
  const currentHasUsablePreview = !isWeakConversationPreview(current);
  const incomingHasWeakPreview = isWeakConversationPreview(incoming);
  const shouldKeepLocalPreview = (
    (incomingHasWeakPreview && currentHasUsablePreview) ||
    (currentHasUsablePreview && currentTime >= incomingTime)
  );

  if (!shouldKeepLocalPreview) {
    return incomingWithMergedMembers;
  }

  const isSamePreviewMessage = (
    current.lastMessageAtIso === incoming.lastMessageAtIso &&
    current.lastMessage === incoming.lastMessage
  );

  return {
    ...incomingWithMergedMembers,
    lastMessage: current.lastMessage,
    lastMessageAt: current.lastMessageAt,
    lastMessageAtIso: current.lastMessageAtIso,
    lastMessageId: isSamePreviewMessage ? (incoming.lastMessageId ?? current.lastMessageId) : current.lastMessageId,
    lastMessageKind: isSamePreviewMessage ? (incoming.lastMessageKind ?? current.lastMessageKind) : current.lastMessageKind,
    lastMessageSenderId: isSamePreviewMessage ? (incoming.lastMessageSenderId ?? current.lastMessageSenderId) : current.lastMessageSenderId,
    lastMessageStatus: isSamePreviewMessage
      ? getHighestOptionalMessageStatus(current.lastMessageStatus, incoming.lastMessageStatus)
      : current.lastMessageStatus,
    unreadCount: getMergedUnreadCount(current, incoming, options?.preferIncomingUnread === true),
  };
}

function mergeConversationMemberMetadata(current: Conversation, incoming: Conversation) {
  if (!current.members?.length || !incoming.members?.length) {
    return incoming;
  }

  const currentMembersById = new Map(current.members.map((member) => [member.id, member]));
  let didMerge = false;
  const members = incoming.members.map((member) => {
    const currentMember = currentMembersById.get(member.id);

    if (!currentMember) {
      return member;
    }

    const hasPremiumAccess = member.hasPremiumAccess ?? currentMember.hasPremiumAccess;
    const shouldMergePremiumAccess = member.hasPremiumAccess === undefined && hasPremiumAccess !== undefined;

    if (!shouldMergePremiumAccess) {
      return member;
    }

    didMerge = true;
    return {
      ...member,
      hasPremiumAccess,
    };
  });

  return didMerge ? { ...incoming, members } : incoming;
}

function hasPendingLocalConversationMessage(conversationId: string) {
  return (useAppStore.getState().messagesByConversation[conversationId] ?? []).some((message) => message.status === 'sending');
}

function applyMessagePreviewToConversation(conversation: Conversation, message: Message): Conversation {
  const language = useAppStore.getState().language;

  return {
    ...conversation,
    lastMessage: getConversationPreviewFromMessage(message),
    lastMessageAt: formatConversationActivityTime(message.createdAtIso ?? message.createdAt, language),
    lastMessageAtIso: message.createdAtIso,
    lastMessageId: message.id,
    lastMessageKind: message.kind,
    lastMessageSenderId: message.senderId,
    lastMessageStatus: message.status,
  };
}

function applyStoredMessagePreviewToConversation(conversation: Conversation, message: Message): Conversation {
  const nextConversation = applyMessagePreviewToConversation(conversation, message);
  const isSamePreviewMessage = (
    conversation.lastMessageId === message.id ||
    (
      conversation.lastMessageAtIso === message.createdAtIso &&
      conversation.lastMessage === nextConversation.lastMessage
    )
  );

  if (!isSamePreviewMessage) {
    return nextConversation;
  }

  return {
    ...nextConversation,
    lastMessageStatus: getHighestOptionalMessageStatus(conversation.lastMessageStatus, nextConversation.lastMessageStatus),
  };
}

function summarizeConversationDiagnostics(conversations: Conversation[]) {
  return conversations.slice(0, 8).map((conversation) => ({
    id: conversation.id,
    lastMessageId: conversation.lastMessageId,
    lastMessageKind: conversation.lastMessageKind,
    lastMessageSenderId: conversation.lastMessageSenderId,
    lastMessageStatus: conversation.lastMessageStatus,
    lastMessageTextLength: conversation.lastMessage?.length ?? 0,
    title: conversation.title,
    unreadCount: conversation.unreadCount,
  }));
}

function hasSameConversationPreview(left: Conversation, right: Conversation) {
  return left.lastMessage === right.lastMessage &&
    left.lastMessageAt === right.lastMessageAt &&
    left.lastMessageAtIso === right.lastMessageAtIso &&
    left.lastMessageId === right.lastMessageId &&
    left.lastMessageKind === right.lastMessageKind &&
    left.lastMessageSenderId === right.lastMessageSenderId &&
    left.lastMessageStatus === right.lastMessageStatus;
}

function createConversationFromIncomingMessage(message: Message, currentUserId?: string | null): Conversation | null {
  const sender = message.sender;

  if (!sender || sender.id === currentUserId) {
    return null;
  }

  const title = sender.displayName || sender.username;

  return {
    avatarLabel: title,
    avatarUrl: sender.avatarUrl,
    id: message.conversationId,
    isContact: sender.isContact,
    lastMessage: 'No messages yet',
    lastMessageAt: message.createdAt,
    lastMessageAtIso: message.createdAtIso,
    lastMessageId: undefined,
    members: [sender],
    otherUserId: sender.id,
    title,
    type: 'DIRECT',
    unreadCount: 0,
  };
}

function syncConversationPreviewWithMessages(conversation: Conversation, messages: Message[]): Conversation {
  const latestMessage = messages[messages.length - 1];

  if (!latestMessage) {
    return {
      ...conversation,
      lastMessage: 'No messages yet',
      lastMessageId: undefined,
      lastMessageKind: undefined,
      lastMessageSenderId: undefined,
      lastMessageStatus: undefined,
    };
  }

  return applyMessagePreviewToConversation(conversation, latestMessage);
}

function applyConversationPreviewReceiptStatus(
  conversation: Conversation,
  currentUserId: string,
  receiptStatus: Extract<Message['status'], 'delivered' | 'read'>,
  messageIds: Set<string>,
  readAt?: string,
): Conversation {
  if (conversation.lastMessageSenderId !== currentUserId) {
    return conversation;
  }

  const isTargetPreview = messageIds.size > 0
    ? !!conversation.lastMessageId && messageIds.has(conversation.lastMessageId)
    : receiptStatus === 'read' && isMessageReadByTimestamp({
        conversationId: conversation.id,
        createdAt: conversation.lastMessageAt,
        createdAtIso: conversation.lastMessageAtIso,
        id: conversation.lastMessageId ?? 'conversation-preview',
        kind: conversation.lastMessageKind ?? 'text',
        body: conversation.lastMessage,
        senderId: conversation.lastMessageSenderId,
        status: conversation.lastMessageStatus ?? 'sent',
      }, readAt);

  if (!isTargetPreview) {
    return conversation;
  }

  const nextStatus = getHighestMessageStatus(conversation.lastMessageStatus ?? 'sent', receiptStatus);

  if (nextStatus === conversation.lastMessageStatus) {
    return conversation;
  }

  return {
    ...conversation,
    lastMessageStatus: nextStatus,
  };
}

function upsertUser(users: AuthUser[], user: AuthUser) {
  if (users.some((item) => item.id === user.id)) {
    return users.map((item) => (item.id === user.id ? user : item));
  }

  return [user, ...users];
}

function mergePresenceIntoUser<T extends AuthUser | null | undefined>(
  user: T,
  presence: { isOnline?: boolean; lastSeenAt?: string | null; showLastSeen?: boolean; userId?: string } & Partial<AuthUser>,
): T {
  if (!user || (presence.userId && user.id !== presence.userId) || (presence.id && user.id !== presence.id)) {
    return user;
  }

  return {
    ...user,
    hideFromSearch: presence.hideFromSearch ?? user.hideFromSearch,
    hideNickname: presence.hideNickname ?? user.hideNickname,
    isOnline: presence.showLastSeen === false ? false : presence.isOnline ?? user.isOnline,
    lastSeenAt: presence.showLastSeen === false ? null : presence.lastSeenAt ?? user.lastSeenAt,
    onlyContactsCanCall: presence.onlyContactsCanCall ?? user.onlyContactsCanCall,
    preventPeerScreenshots: presence.preventPeerScreenshots ?? user.preventPeerScreenshots,
    showLastSeen: presence.showLastSeen ?? user.showLastSeen,
    useGroupAliases: presence.useGroupAliases ?? user.useGroupAliases,
  };
}

function getConversationPreviewFromMessage(message: Message) {
  const currentUserId = useAppStore.getState().user?.id;

  if (isDisappearingAfterViewMessage(message) && message.senderId !== currentUserId && !getDisappearingDeleteAt(message)) {
    return t('clickToView', {}, useAppStore.getState().language);
  }

  if (message.kind === 'call') {
    return message.body || 'Call';
  }

  if (message.body) {
    return message.body;
  }

  if (message.kind === 'voice') {
    return 'Voice message';
  }

  if (message.kind === 'image') {
    return 'Photo';
  }

  if (message.kind === 'video') {
    return 'Video';
  }

  if (message.kind === 'file') {
    return 'File';
  }

  return 'New message';
}

function isDisappearingAfterViewMessage(message: Message) {
  const metadata = message.metadata;

  return !!(
    metadata &&
    typeof metadata === 'object' &&
    'disappearingAfterView' in metadata &&
    metadata.disappearingAfterView &&
    typeof metadata.disappearingAfterView === 'object'
  );
}

function getDisappearingDeleteAt(message: Message) {
  const metadata = message.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'disappearingDeleteAt' in metadata &&
    typeof metadata.disappearingDeleteAt === 'string'
    ? metadata.disappearingDeleteAt
    : undefined;
}

function omitRecordKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];

  return next;
}

function isSubscriptionStatusUsable(subscriptionStatus: SubscriptionStatus | null) {
  return hasPremiumAccess(subscriptionStatus);
}

function enqueueDeliveredReceipt(conversationId: string, delivererId: string, messageIds: Set<string>) {
  const batchKey = `${conversationId}:${delivererId}`;
  const batch = pendingDeliveredReceiptBatches.get(batchKey) ?? {
    conversationId,
    delivererId,
    messageIds: new Set<string>(),
  };

  messageIds.forEach((messageId) => batch.messageIds.add(messageId));
  pendingDeliveredReceiptBatches.set(batchKey, batch);

  if (deliveredReceiptBatchTimer) {
    clearTimeout(deliveredReceiptBatchTimer);
  }

  deliveredReceiptBatchTimer = setTimeout(flushDeliveredReceiptBatches, RECEIPT_BATCH_DELAY_MS);
}

function flushDeliveredReceiptBatches() {
  if (deliveredReceiptBatchTimer) {
    clearTimeout(deliveredReceiptBatchTimer);
    deliveredReceiptBatchTimer = null;
  }

  const batches = Array.from(pendingDeliveredReceiptBatches.values());
  pendingDeliveredReceiptBatches.clear();

  if (batches.length === 0) {
    return;
  }

  const { user } = useAppStore.getState();

  if (!user) {
    return;
  }

  const touchedConversationIds = new Set<string>();
  const changedMessagesByConversation = new Map<string, Message[]>();

  useAppStore.setState((state) => {
    let nextMessagesByConversation = state.messagesByConversation;
    let nextConversations = state.conversations;

    batches.forEach((batch) => {
      if (batch.messageIds.size === 0 || batch.delivererId === user.id) {
        return;
      }

      const currentMessages = nextMessagesByConversation[batch.conversationId] ?? [];
      let didUpdateMessages = false;
      const changedMessages: Message[] = [];
      const nextMessages = currentMessages.map((message) => {
        if (message.senderId !== user.id || !batch.messageIds.has(message.id) || message.status === 'read' || message.status === 'delivered') {
          return message;
        }

        didUpdateMessages = true;
        const updatedMessage = { ...message, status: 'delivered' as const };
        changedMessages.push(updatedMessage);
        return updatedMessage;
      });

      if (changedMessages.length > 0) {
        changedMessagesByConversation.set(batch.conversationId, [
          ...(changedMessagesByConversation.get(batch.conversationId) ?? []),
          ...changedMessages,
        ]);
      }

      nextMessagesByConversation = didUpdateMessages
        ? {
            ...nextMessagesByConversation,
            [batch.conversationId]: nextMessages,
          }
        : nextMessagesByConversation;

      let didUpdateConversation = false;
      nextConversations = nextConversations.map((conversation) => {
        if (conversation.id !== batch.conversationId) {
          return conversation;
        }

        const previewConversation = didUpdateMessages && nextMessages.length > 0
          ? syncConversationPreviewWithMessages(conversation, nextMessages)
          : conversation;
        const updatedConversation = applyConversationPreviewReceiptStatus(
          previewConversation,
          user.id,
          'delivered',
          batch.messageIds,
        );

        if (updatedConversation !== conversation) {
          didUpdateConversation = true;
        }

        return updatedConversation;
      });

      if (didUpdateMessages || didUpdateConversation) {
        touchedConversationIds.add(batch.conversationId);
      }
    });

    return touchedConversationIds.size > 0
      ? {
          conversations: nextConversations,
          messagesByConversation: nextMessagesByConversation,
        }
      : state;
  });

  changedMessagesByConversation.forEach((messages, conversationId) => {
    void persistChangedConversationMessages(conversationId, messages);
  });
  if (touchedConversationIds.size > 0) {
    scheduleStoredConversationsPersist();
  }
}

function enqueueReadReceipt(conversationId: string, readerId: string, readAt: string | undefined, messageIds: Set<string>, messageKeys: Set<string>) {
  const batchKey = `${conversationId}:${readerId}`;
  const batch = pendingReadReceiptBatches.get(batchKey) ?? {
    conversationId,
    messageIds: new Set<string>(),
    messageKeys: new Set<string>(),
    readAt,
    readerId,
  };

  messageIds.forEach((messageId) => batch.messageIds.add(messageId));
  messageKeys.forEach((messageKey) => batch.messageKeys.add(messageKey));

  if (readAt && (!batch.readAt || Date.parse(readAt) > Date.parse(batch.readAt))) {
    batch.readAt = readAt;
  }

  pendingReadReceiptBatches.set(batchKey, batch);

  if (readReceiptBatchTimer) {
    clearTimeout(readReceiptBatchTimer);
  }

  readReceiptBatchTimer = setTimeout(flushReadReceiptBatches, RECEIPT_BATCH_DELAY_MS);
}

function flushReadReceiptBatches() {
  if (readReceiptBatchTimer) {
    clearTimeout(readReceiptBatchTimer);
    readReceiptBatchTimer = null;
  }

  const batches = Array.from(pendingReadReceiptBatches.values());
  pendingReadReceiptBatches.clear();

  if (batches.length === 0) {
    return;
  }

  const { user } = useAppStore.getState();

  if (!user) {
    return;
  }

  const touchedConversationIds = new Set<string>();
  const changedMessagesByConversation = new Map<string, Message[]>();

  useAppStore.setState((state) => {
    let nextMessagesByConversation = state.messagesByConversation;
    let nextConversations = state.conversations;

    batches.forEach((batch) => {
      if (batch.readerId === user.id) {
        return;
      }

      const currentMessages = nextMessagesByConversation[batch.conversationId] ?? [];
      const shouldUseTimestamp = batch.messageIds.size === 0 && batch.messageKeys.size === 0;
      let didUpdateMessages = false;
      const changedMessages: Message[] = [];
      const nextMessages = currentMessages.map((message) => {
        if (message.senderId !== user.id || message.status === 'read') {
          return message;
        }

        const messageKey = getMessageDeleteKey(message);
        const shouldMarkAsRead = shouldUseTimestamp
          ? isMessageReadByTimestamp(message, batch.readAt)
          : batch.messageIds.has(message.id) || (!!messageKey && batch.messageKeys.has(messageKey));

        if (!shouldMarkAsRead) {
          return message;
        }

        didUpdateMessages = true;
        const updatedMessage = { ...message, status: 'read' as const };
        changedMessages.push(updatedMessage);
        return updatedMessage;
      });

      if (changedMessages.length > 0) {
        changedMessagesByConversation.set(batch.conversationId, [
          ...(changedMessagesByConversation.get(batch.conversationId) ?? []),
          ...changedMessages,
        ]);
      }

      nextMessagesByConversation = didUpdateMessages
        ? {
            ...nextMessagesByConversation,
            [batch.conversationId]: nextMessages,
          }
        : nextMessagesByConversation;

      let didUpdateConversation = false;
      nextConversations = nextConversations.map((conversation) => {
        if (conversation.id !== batch.conversationId) {
          return conversation;
        }

        const previewConversation = didUpdateMessages && nextMessages.length > 0
          ? syncConversationPreviewWithMessages(conversation, nextMessages)
          : conversation;
        const updatedConversation = applyConversationPreviewReceiptStatus(
          previewConversation,
          user.id,
          'read',
          batch.messageIds,
          batch.readAt,
        );

        if (updatedConversation !== conversation) {
          didUpdateConversation = true;
        }

        return updatedConversation;
      });

      if (didUpdateMessages || didUpdateConversation) {
        touchedConversationIds.add(batch.conversationId);
      }
    });

    return touchedConversationIds.size > 0
      ? {
          conversations: nextConversations,
          messagesByConversation: nextMessagesByConversation,
        }
      : state;
  });

  changedMessagesByConversation.forEach((messages, conversationId) => {
    void persistChangedConversationMessages(conversationId, messages);
  });
  if (touchedConversationIds.size > 0) {
    scheduleStoredConversationsPersist();
  }
}

function scheduleStoredConversationsPersist(delayMs = CONVERSATION_PERSIST_DEBOUNCE_MS) {
  if (storedConversationsPersistTimer) {
    clearTimeout(storedConversationsPersistTimer);
  }

  storedConversationsPersistTimer = setTimeout(() => {
    storedConversationsPersistTimer = null;
    void flushStoredConversationsPersist();
  }, delayMs);
}

async function flushStoredConversationsPersist() {
  if (storedConversationsPersistTimer) {
    clearTimeout(storedConversationsPersistTimer);
    storedConversationsPersistTimer = null;
  }

  if (storedConversationsPersistPromise) {
    return storedConversationsPersistPromise;
  }

  storedConversationsPersistPromise = setStoredConversations(useAppStore.getState().conversations)
    .catch(() => undefined)
    .finally(() => {
      storedConversationsPersistPromise = null;
    });

  return storedConversationsPersistPromise;
}

NativeAppState.addEventListener('change', (nextState) => {
  if (nextState !== 'active') {
    flushDeliveredReceiptBatches();
    flushReadReceiptBatches();
    void flushStoredConversationsPersist();
  }
});

async function cacheIncomingMedia(messages: Message[], options?: { priority?: 'high' | 'normal' }) {
  if (!FileSystem.documentDirectory) {
    return messages;
  }

  const cachedMessages: Message[] = [];

  for (const message of messages) {
    if (!isMediaMessageKind(message.kind)) {
      cachedMessages.push(message);
      continue;
    }

    const remoteMediaUri = getMessageRemoteMediaUri(message);
    const messageWithRemoteMetadata = remoteMediaUri ? withRemoteMediaMetadata(message, remoteMediaUri) : message;
    const mediaUri = message.mediaUri;

    if (!mediaUri && !remoteMediaUri) {
      cachedMessages.push(message);
      continue;
    }

    if (mediaUri && isLocalMediaUri(mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(mediaUri, message.sizeBytes);
      const resolvedMessage = resolvedLocalUri && resolvedLocalUri !== mediaUri
        ? { ...messageWithRemoteMetadata, mediaUri: resolvedLocalUri }
        : messageWithRemoteMetadata;

      if (message.id.startsWith('local-') || message.status === 'sending' || /^content:/i.test(mediaUri)) {
        cachedMessages.push(resolvedMessage);
        continue;
      }

      if (resolvedLocalUri) {
        cachedMessages.push(resolvedMessage);
        continue;
      }

      if (remoteMediaUri) {
        await FileSystem.deleteAsync(mediaUri, { idempotent: true }).catch(() => undefined);
      }
    } else if (mediaUri && !/^https?:\/\//i.test(mediaUri)) {
      cachedMessages.push(messageWithRemoteMetadata);
      continue;
    }

    const downloadUri = remoteMediaUri ?? mediaUri;

    if (!downloadUri || !/^https?:\/\//i.test(downloadUri)) {
      cachedMessages.push(messageWithRemoteMetadata);
      continue;
    }

    try {
      const existingCachedUri = await resolveCachedMessageMediaUri({
        expectedSizeBytes: message.sizeBytes,
        fileName: message.fileName,
        kind: message.kind,
        messageId: message.id,
      });

      if (existingCachedUri) {
        cachedMessages.push(withRemoteMediaMetadata({ ...message, mediaUri: existingCachedUri }, downloadUri));
        continue;
      }

      const localUri = await getMessageMediaCacheUri({
        fileName: message.fileName,
        kind: message.kind,
        messageId: message.id,
      });
      const cachedUri = await downloadRemoteMediaFile({
        expectedSizeBytes: message.sizeBytes,
        localUri,
        messageId: message.id,
        priority: options?.priority,
        remoteUri: downloadUri,
      });

      cachedMessages.push(cachedUri
        ? withRemoteMediaMetadata({ ...message, mediaUri: cachedUri }, downloadUri)
        : withRemoteMediaMetadata({ ...message, mediaUri: downloadUri }, downloadUri));
    } catch {
      cachedMessages.push(withRemoteMediaMetadata({ ...message, mediaUri: downloadUri }, downloadUri));
    }
  }

  return cachedMessages;
}

async function cacheMessageMediaAndPersist(message: Message, options?: { priority?: 'high' | 'normal' }) {
  const cacheKey = message.id;
  const activeRequest = incomingMediaCacheRequests.get(cacheKey);

  if (activeRequest) {
    return activeRequest;
  }

  const request = (async () => {
    const [cachedMessage] = await cacheIncomingMedia([message], { priority: options?.priority });

    if (!cachedMessage) {
      return null;
    }

    if (cachedMessage.mediaUri !== message.mediaUri) {
      useAppStore.setState((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [message.conversationId]: upsertMessage(state.messagesByConversation[message.conversationId] ?? [], cachedMessage),
        },
      }));
      await persistChangedConversationMessages(message.conversationId, [cachedMessage]);
    }

    return cachedMessage;
  })().finally(() => {
    if (incomingMediaCacheRequests.get(cacheKey) === request) {
      incomingMediaCacheRequests.delete(cacheKey);
    }
  });

  incomingMediaCacheRequests.set(cacheKey, request);
  return request;
}

async function acknowledgeMessageContentAfterLocalCache(message: Message) {
  const { serverUrl, user } = useAppStore.getState();

  if (!serverUrl || !user || message.id.startsWith('local-') || message.senderId === user.id) {
    logMessageDeliveryDiagnostic('content-ack-after-cache-skipped-prereq', {
      conversationId: message.conversationId,
      hasServerUrl: !!serverUrl,
      hasUser: !!user,
      isLocal: message.id.startsWith('local-'),
      isOwnMessage: message.senderId === user?.id,
      messageId: message.id,
    });
    return;
  }

  logMessageDeliveryDiagnostic('content-ack-after-cache-start', {
    conversationId: message.conversationId,
    kind: message.kind,
    messageId: message.id,
  });
  const cachedMessage = await cacheMessageMediaAndPersist(message, { priority: 'high' });
  const messageForAck = cachedMessage ?? message;

  if (!(await isMessageContentReadyForAck(messageForAck, user.id))) {
    logMessageDeliveryDiagnostic('content-ack-after-cache-not-ready', {
      conversationId: message.conversationId,
      kind: message.kind,
      mediaUri: messageForAck.mediaUri,
      messageId: message.id,
    });
    return;
  }

  await persistChangedConversationMessages(message.conversationId, [messageForAck]);
  logMessageDeliveryDiagnostic('content-ack-after-cache-persisted', {
    conversationId: message.conversationId,
    messageId: message.id,
  });
  await acknowledgeMessageContent(serverUrl, message.conversationId, [message.id]);
  logMessageDeliveryDiagnostic('content-ack-after-cache-finished', {
    conversationId: message.conversationId,
    messageId: message.id,
  });
}
