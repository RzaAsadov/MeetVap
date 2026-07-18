import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { CallLog, Conversation, Message, SubscriptionStatus } from '../types/domain';
import { removePartialMediaDownloadsForMessages } from './mediaCache';
import { ensureMessageDatabaseReady, getLatestMessagesByConversationIdsFromDatabase, getMessagesByIdsFromDatabase, getMessagesFromDatabase, getOlderMessagesFromDatabase, getRecentMessagesFromDatabase, removeAllMediaDownloadRecords, removeAllMessagesFromDatabase, removeMessageRecordsFromDatabase, removeMessagesFromDatabase, saveMessagesToDatabase, upsertMessagesToDatabase } from './messageStore';

const SERVER_URL_KEY = 'messenger.serverUrl';
const AUTH_TOKEN_KEY = 'messenger.authToken';
const USER_KEY = 'messenger.user';
const MESSAGE_CACHE_PREFIX = 'messenger.messages.';
const DELETED_CHAT_PREFIX = 'messenger.deletedChat.';
const CALL_LOGS_KEY = 'messenger.callLogs';
const CONVERSATIONS_KEY = 'messenger.conversations';
const DARK_MODE_KEY = 'messenger.darkMode';
const LANGUAGE_KEY = 'messenger.language';
const FAVORITE_CONVERSATIONS_KEY = 'messenger.favoriteConversations';
const PLAYED_VOICE_MESSAGES_KEY = 'messenger.playedVoiceMessages';
const RECENT_EMOJIS_KEY = 'messenger.recentEmojis';
const LOCK_PIN_KEY = 'messenger.lockPin';
const ERASE_PIN_KEY = 'messenger.erasePin';
const ERASE_PIN_ALERT_CONFIG_KEY = 'messenger.erasePinAlertConfig';
const ERASE_PIN_DELETE_PEERS_KEY = 'messenger.erasePinDeletePeers';
const DECOY_OFFLINE_KEY = 'messenger.decoyOffline';
const SUBSCRIPTION_STATUS_KEY = 'messenger.subscriptionStatus';
const PREMIUM_TRIAL_INTRO_SEEN_PREFIX = 'messenger.premiumTrialIntroSeen.';
const SUBSCRIPTION_EXPIRY_NOTICE_SEEN_PREFIX = 'messenger.subscriptionExpiryNoticeSeen.';
const VOICE_CALL_TIP_DISMISSED_PREFIX = 'messenger.voiceCallTipDismissed.';
const BACKGROUND_LOCATION_DISCLOSURE_VERSION_KEY = 'messenger.backgroundLocationDisclosureVersion';

export const DEFAULT_SERVER_URL = 'https://mm.meetvap.com';
export type ErasePinAlertConfig = {
  message: string;
  sendLiveLocation?: boolean;
  targetUserIds: string[];
};

export async function getServerUrl() {
  const storedUrl = await SecureStore.getItemAsync(SERVER_URL_KEY);

  return storedUrl && storedUrl === DEFAULT_SERVER_URL ? storedUrl : DEFAULT_SERVER_URL;
}

export async function setServerUrl(serverUrl: string) {
  await SecureStore.setItemAsync(SERVER_URL_KEY, serverUrl);
}

export async function clearServerUrl() {
  await SecureStore.deleteItemAsync(SERVER_URL_KEY);
}

export async function getAuthToken() {
  return SecureStore.getItemAsync(AUTH_TOKEN_KEY);
}

export async function setAuthToken(token: string) {
  await SecureStore.setItemAsync(AUTH_TOKEN_KEY, token);
}

export async function clearAuthToken() {
  await SecureStore.deleteItemAsync(AUTH_TOKEN_KEY);
}

export async function getStoredUser<T>() {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setStoredUser<T>(user: T) {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function clearStoredUser() {
  await SecureStore.deleteItemAsync(USER_KEY);
}

export async function getStoredSubscriptionStatus() {
  const raw = await SecureStore.getItemAsync(SUBSCRIPTION_STATUS_KEY);
  return raw ? (JSON.parse(raw) as SubscriptionStatus) : null;
}

export async function setStoredSubscriptionStatus(status: SubscriptionStatus) {
  await SecureStore.setItemAsync(SUBSCRIPTION_STATUS_KEY, JSON.stringify(status));
}

export async function clearStoredSubscriptionStatus() {
  await SecureStore.deleteItemAsync(SUBSCRIPTION_STATUS_KEY);
}

export async function getStoredPremiumTrialIntroSeen(userId: string) {
  return AsyncStorage.getItem(`${PREMIUM_TRIAL_INTRO_SEEN_PREFIX}${userId}`);
}

export async function setStoredPremiumTrialIntroSeen(userId: string) {
  await AsyncStorage.setItem(`${PREMIUM_TRIAL_INTRO_SEEN_PREFIX}${userId}`, 'true');
}

export async function getStoredSubscriptionExpiryNoticeSeen(userId: string, noticeKey: string) {
  return AsyncStorage.getItem(`${SUBSCRIPTION_EXPIRY_NOTICE_SEEN_PREFIX}${userId}.${noticeKey}`);
}

export async function setStoredSubscriptionExpiryNoticeSeen(userId: string, noticeKey: string) {
  await AsyncStorage.setItem(`${SUBSCRIPTION_EXPIRY_NOTICE_SEEN_PREFIX}${userId}.${noticeKey}`, 'true');
}

export async function getStoredVoiceCallTipDismissed(userId: string) {
  return AsyncStorage.getItem(`${VOICE_CALL_TIP_DISMISSED_PREFIX}${userId}`);
}

export async function setStoredVoiceCallTipDismissed(userId: string) {
  await AsyncStorage.setItem(`${VOICE_CALL_TIP_DISMISSED_PREFIX}${userId}`, 'true');
}

export async function getStoredMessages(conversationId: string) {
  return getMessagesFromDatabase(conversationId);
}

export async function getStoredRecentMessages(conversationId: string, limit: number) {
  return getRecentMessagesFromDatabase(conversationId, limit);
}

export async function getStoredMessagesByIds(conversationId: string, messageIds: string[]) {
  return getMessagesByIdsFromDatabase(conversationId, messageIds);
}

export async function getStoredOlderMessages(conversationId: string, beforeCreatedAtMs: number, limit: number) {
  return getOlderMessagesFromDatabase(conversationId, beforeCreatedAtMs, limit);
}

export async function getStoredLatestMessagesByConversationIds(conversationIds: string[]) {
  return getLatestMessagesByConversationIdsFromDatabase(conversationIds);
}

export async function setStoredMessages(conversationId: string, messages: Message[]) {
  await saveMessagesToDatabase(conversationId, messages);
  await AsyncStorage.removeItem(`${MESSAGE_CACHE_PREFIX}${conversationId}`);
}

export async function upsertStoredMessages(conversationId: string, messages: Message[]) {
  await upsertMessagesToDatabase(conversationId, messages);
  await AsyncStorage.removeItem(`${MESSAGE_CACHE_PREFIX}${conversationId}`);
}

export async function removeStoredMessageRecords(conversationId: string, messageIds: string[]) {
  await removeMessageRecordsFromDatabase(conversationId, messageIds);
}

export async function removeStoredMessages(conversationId: string) {
  const messages = await getMessagesFromDatabase(conversationId).catch(() => []);
  await removeLocalMessageMediaFiles(messages);
  await removeMessagesFromDatabase(conversationId).catch(() => undefined);
  await AsyncStorage.removeItem(`${MESSAGE_CACHE_PREFIX}${conversationId}`);
}

export async function getStoredConversations() {
  const raw = await AsyncStorage.getItem(CONVERSATIONS_KEY);
  return raw ? (JSON.parse(raw) as Conversation[]) : [];
}

export async function setStoredConversations(conversations: Conversation[]) {
  await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(dedupeStoredConversations(conversations)));
}

function dedupeStoredConversations(conversations: Conversation[]) {
  return Array.from(new Map(conversations.map((conversation) => [conversation.id, conversation])).values());
}

export async function clearStoredConversations() {
  await AsyncStorage.removeItem(CONVERSATIONS_KEY);
}

export async function getDeletedConversationAfter(conversationId: string) {
  return AsyncStorage.getItem(`${DELETED_CHAT_PREFIX}${conversationId}`);
}

export async function setDeletedConversationAfter(conversationId: string, timestampIso: string) {
  await AsyncStorage.setItem(`${DELETED_CHAT_PREFIX}${conversationId}`, timestampIso);
}

export async function clearDeletedConversationAfter(conversationId: string) {
  await AsyncStorage.removeItem(`${DELETED_CHAT_PREFIX}${conversationId}`);
}

export async function getStoredCallLogs() {
  const raw = await AsyncStorage.getItem(CALL_LOGS_KEY);
  return raw ? (JSON.parse(raw) as CallLog[]) : [];
}

export async function setStoredCallLogs(callLogs: CallLog[]) {
  await AsyncStorage.setItem(CALL_LOGS_KEY, JSON.stringify(callLogs.slice(0, 150)));
}

export async function getStoredDarkMode() {
  const value = await AsyncStorage.getItem(DARK_MODE_KEY);

  if (value === null) {
    return null;
  }

  return value === 'true';
}

export async function setStoredDarkMode(isDarkMode: boolean) {
  await AsyncStorage.setItem(DARK_MODE_KEY, isDarkMode ? 'true' : 'false');
}

export async function getStoredLanguage() {
  return AsyncStorage.getItem(LANGUAGE_KEY);
}

export async function setStoredLanguage(language: string) {
  await AsyncStorage.setItem(LANGUAGE_KEY, language);
}

export async function getStoredBackgroundLocationDisclosureVersion() {
  const value = await AsyncStorage.getItem(BACKGROUND_LOCATION_DISCLOSURE_VERSION_KEY);
  const version = value ? Number.parseInt(value, 10) : 0;

  return Number.isFinite(version) ? version : 0;
}

export async function setStoredBackgroundLocationDisclosureVersion(version: number) {
  await AsyncStorage.setItem(BACKGROUND_LOCATION_DISCLOSURE_VERSION_KEY, String(version));
}

export async function getStoredFavoriteConversationIds() {
  const raw = await AsyncStorage.getItem(FAVORITE_CONVERSATIONS_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function setStoredFavoriteConversationIds(conversationIds: string[]) {
  await AsyncStorage.setItem(FAVORITE_CONVERSATIONS_KEY, JSON.stringify(Array.from(new Set(conversationIds))));
}

export async function getStoredPlayedVoiceMessageIds() {
  const raw = await AsyncStorage.getItem(PLAYED_VOICE_MESSAGES_KEY);
  const values = raw ? (JSON.parse(raw) as unknown) : [];

  return Array.isArray(values)
    ? values.filter((value): value is string => typeof value === 'string')
    : [];
}

export async function setStoredPlayedVoiceMessageIds(messageIds: string[]) {
  await AsyncStorage.setItem(PLAYED_VOICE_MESSAGES_KEY, JSON.stringify(Array.from(new Set(messageIds)).slice(-2000)));
}

export async function getStoredRecentEmojis() {
  const raw = await AsyncStorage.getItem(RECENT_EMOJIS_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export async function setStoredRecentEmojis(emojis: string[]) {
  await AsyncStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(Array.from(new Set(emojis)).slice(0, 36)));
}

export async function getStoredLockPin() {
  return SecureStore.getItemAsync(LOCK_PIN_KEY);
}

export async function setStoredLockPin(pin: string) {
  await SecureStore.setItemAsync(LOCK_PIN_KEY, pin);
}

export async function clearStoredLockPin() {
  await SecureStore.deleteItemAsync(LOCK_PIN_KEY);
}

export async function getStoredErasePin() {
  return SecureStore.getItemAsync(ERASE_PIN_KEY);
}

export async function setStoredErasePin(pin: string) {
  await SecureStore.setItemAsync(ERASE_PIN_KEY, pin);
}

export async function clearStoredErasePin() {
  await SecureStore.deleteItemAsync(ERASE_PIN_KEY);
}

export async function getStoredErasePinAlertConfig() {
  const raw = await SecureStore.getItemAsync(ERASE_PIN_ALERT_CONFIG_KEY);
  const config = raw ? (JSON.parse(raw) as ErasePinAlertConfig) : null;

  return config ? { ...config, sendLiveLocation: config.sendLiveLocation === true } : null;
}

export async function setStoredErasePinAlertConfig(config: ErasePinAlertConfig) {
  await SecureStore.setItemAsync(ERASE_PIN_ALERT_CONFIG_KEY, JSON.stringify({
    message: config.message,
    sendLiveLocation: config.sendLiveLocation === true,
    targetUserIds: Array.from(new Set(config.targetUserIds)).slice(0, 2),
  }));
}

export async function clearStoredErasePinAlertConfig() {
  await SecureStore.deleteItemAsync(ERASE_PIN_ALERT_CONFIG_KEY);
}

export async function getStoredErasePinDeletePeers() {
  const value = await SecureStore.getItemAsync(ERASE_PIN_DELETE_PEERS_KEY);

  return value !== 'false';
}

export async function setStoredErasePinDeletePeers(isEnabled: boolean) {
  await SecureStore.setItemAsync(ERASE_PIN_DELETE_PEERS_KEY, isEnabled ? 'true' : 'false');
}

export async function getStoredDecoyOffline() {
  return (await SecureStore.getItemAsync(DECOY_OFFLINE_KEY)) === 'true';
}

export async function setStoredDecoyOffline(isEnabled: boolean) {
  await SecureStore.setItemAsync(DECOY_OFFLINE_KEY, isEnabled ? 'true' : 'false');
}

export async function clearStoredDecoyOffline() {
  await SecureStore.deleteItemAsync(DECOY_OFFLINE_KEY);
}

export type MessageStorageMigrationProgress = {
  done: number;
  total: number;
};

export type MessageStorageMigrationResult = MessageStorageMigrationProgress & {
  migratedMessages: number;
};

export async function migrateLegacyMessageStorage(
  onProgress?: (progress: MessageStorageMigrationProgress) => void,
): Promise<MessageStorageMigrationResult> {
  const keys = await AsyncStorage.getAllKeys();
  const messageKeys = keys.filter((key) => key.startsWith(MESSAGE_CACHE_PREFIX));
  let migratedMessages = 0;

  onProgress?.({ done: 0, total: messageKeys.length });

  if (messageKeys.length === 0) {
    return {
      done: 0,
      total: 0,
      migratedMessages: 0,
    };
  }

  await ensureMessageDatabaseReady();

  for (let index = 0; index < messageKeys.length; index += 1) {
    const key = messageKeys[index];
    const conversationId = key.slice(MESSAGE_CACHE_PREFIX.length);
    const raw = await AsyncStorage.getItem(key);
    const messages = raw ? (JSON.parse(raw) as Message[]) : [];
    await upsertMessagesToDatabase(conversationId, messages);
    await AsyncStorage.removeItem(key);

    migratedMessages += messages.length;
    onProgress?.({ done: index + 1, total: messageKeys.length });
  }

  return {
    done: messageKeys.length,
    total: messageKeys.length,
    migratedMessages,
  };
}

export async function eraseLocalChatData() {
  const keys = await AsyncStorage.getAllKeys().catch(() => []);
  const chatKeys = keys.filter((key) => (
    key === CALL_LOGS_KEY
    || key === CONVERSATIONS_KEY
    || key === FAVORITE_CONVERSATIONS_KEY
    || key === PLAYED_VOICE_MESSAGES_KEY
    || key.startsWith(MESSAGE_CACHE_PREFIX)
    || key.startsWith(DELETED_CHAT_PREFIX)
  ));

  await Promise.allSettled([
    removeAllMessagesFromDatabase(),
    removeAllMediaDownloadRecords(),
    chatKeys.length > 0 ? AsyncStorage.multiRemove(chatKeys) : Promise.resolve(),
    deletePath(FileSystem.documentDirectory ? `${FileSystem.documentDirectory}messenger-media` : null),
  ]);
}

export async function eraseLocalAppData() {
  await Promise.allSettled([
    AsyncStorage.clear(),
    SecureStore.deleteItemAsync(SERVER_URL_KEY),
    SecureStore.deleteItemAsync(AUTH_TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
    SecureStore.deleteItemAsync(SUBSCRIPTION_STATUS_KEY),
    SecureStore.deleteItemAsync(LOCK_PIN_KEY),
    SecureStore.deleteItemAsync(ERASE_PIN_KEY),
    SecureStore.deleteItemAsync(ERASE_PIN_ALERT_CONFIG_KEY),
    SecureStore.deleteItemAsync(DECOY_OFFLINE_KEY),
    deleteDirectoryContents(FileSystem.cacheDirectory),
    deleteDirectoryContents(FileSystem.documentDirectory),
  ]);
}

async function removeLocalMessageMediaFiles(messages: Message[]) {
  const localUris = new Set<string>();

  messages.forEach((message) => {
    if (message.mediaUri && shouldDeleteLocalMessageMediaUri(message.mediaUri)) {
      localUris.add(message.mediaUri);
    }
  });

  await Promise.allSettled([...localUris].map((uri) => (
    FileSystem.deleteAsync(uri, { idempotent: true })
  )));
  await removePartialMediaDownloadsForMessages(messages.map((message) => message.id));
}

function shouldDeleteLocalMessageMediaUri(uri: string) {
  if (/^https?:\/\//i.test(uri) || /^content:/i.test(uri)) {
    return false;
  }

  return [FileSystem.documentDirectory, FileSystem.cacheDirectory].some((directory) => (
    !!directory && uri.startsWith(directory)
  ));
}

async function deleteDirectoryContents(directoryUri: string | null) {
  if (!directoryUri) {
    return;
  }

  const children = await FileSystem.readDirectoryAsync(directoryUri).catch(() => []);
  await Promise.allSettled(children.map((child) => (
    FileSystem.deleteAsync(`${directoryUri}${child}`, { idempotent: true })
  )));
}

async function deletePath(uri: string | null) {
  if (!uri) {
    return;
  }

  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}
