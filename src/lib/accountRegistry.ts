import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import type { AuthUser, SubscriptionStatus } from '../types/domain';

const ACCOUNT_INDEX_KEY = 'messenger.accounts.v1';
const ACTIVE_ACCOUNT_ID_KEY = 'messenger.activeAccountId.v1';
const LEGACY_SERVER_URL_KEY = 'messenger.serverUrl';
const LEGACY_AUTH_TOKEN_KEY = 'messenger.authToken';
const LEGACY_USER_KEY = 'messenger.user';
const LEGACY_SUBSCRIPTION_STATUS_KEY = 'messenger.subscriptionStatus';
const LEGACY_DATABASE_NAME = 'meetvap_messages.db';
export const MAX_SAVED_ACCOUNTS = 5;

export class AccountLimitError extends Error {
  constructor() {
    super('Account limit reached');
    this.name = 'AccountLimitError';
  }
}

export type AccountServerRoutingMode = 'main-dns-pool' | 'direct-hostname' | 'dns-alias';

export type SavedAccount = {
  accountId: string;
  authState: 'authenticated' | 'reauth-required' | 'suspended';
  avatarUrl?: string | null;
  canonicalServerUrl?: string;
  databaseName: string;
  displayName: string;
  lastConnectedAt?: number;
  lastUsedAt: number;
  serverRoutingMode?: AccountServerRoutingMode;
  serverInstanceId: string;
  serverIdentityResolved?: boolean;
  serverUrl: string;
  userId: string;
  username: string;
  unreadConversationIds?: string[];
};

export type AccountSession = SavedAccount & {
  token: string;
  user: AuthUser;
};

let accountsCache: SavedAccount[] | null = null;
let activeAccountIdCache: string | null | undefined;

export async function initializeAccountRegistry(defaultServerUrl: string) {
  const [accounts, activeAccountId] = await Promise.all([
    readAccountIndex(),
    AsyncStorage.getItem(ACTIVE_ACCOUNT_ID_KEY),
  ]);
  accountsCache = accounts;
  activeAccountIdCache = activeAccountId;

  if (accounts.length > 0) {
    if (!activeAccountId || !accounts.some((account) => account.accountId === activeAccountId)) {
      await setActiveAccountId(accounts[0].accountId);
    }
    return;
  }

  const [legacyServerUrl, legacyToken, legacyUserRaw, legacySubscriptionRaw] = await Promise.all([
    SecureStore.getItemAsync(LEGACY_SERVER_URL_KEY),
    SecureStore.getItemAsync(LEGACY_AUTH_TOKEN_KEY),
    SecureStore.getItemAsync(LEGACY_USER_KEY),
    SecureStore.getItemAsync(LEGACY_SUBSCRIPTION_STATUS_KEY),
  ]);
  const legacyUser = parseJson<AuthUser>(legacyUserRaw);

  if (!legacyToken || !legacyUser) {
    activeAccountIdCache = null;
    return;
  }

  const serverUrl = normalizeServerUrl(legacyServerUrl || defaultServerUrl);
  const account = createSavedAccount({
    databaseName: LEGACY_DATABASE_NAME,
    serverInstanceId: serverUrl,
    serverUrl,
    user: legacyUser,
  });
  account.unreadConversationIds = [];
  account.serverIdentityResolved = false;
  accountsCache = [account];
  await Promise.all([
    writeAccountIndex(accountsCache),
    setActiveAccountId(account.accountId),
    SecureStore.setItemAsync(accountSecretKey(account.accountId, 'token'), legacyToken),
    SecureStore.setItemAsync(accountSecretKey(account.accountId, 'user'), JSON.stringify(legacyUser)),
    legacySubscriptionRaw
      ? SecureStore.setItemAsync(accountSecretKey(account.accountId, 'subscription'), legacySubscriptionRaw)
      : Promise.resolve(),
  ]);
}

export async function listSavedAccounts() {
  if (!accountsCache) {
    accountsCache = await readAccountIndex();
  }
  return [...accountsCache];
}

export function getActiveAccountIdSync() {
  return activeAccountIdCache ?? null;
}

export function getActiveAccountSync() {
  const accountId = getActiveAccountIdSync();
  return accountId ? accountsCache?.find((account) => account.accountId === accountId) ?? null : null;
}

export async function getActiveAccount() {
  const accounts = await listSavedAccounts();
  const activeAccountId = activeAccountIdCache === undefined
    ? await AsyncStorage.getItem(ACTIVE_ACCOUNT_ID_KEY)
    : activeAccountIdCache;
  activeAccountIdCache = activeAccountId;
  return accounts.find((account) => account.accountId === activeAccountId) ?? null;
}

export async function getAccountSession(accountId: string): Promise<AccountSession | null> {
  const account = (await listSavedAccounts()).find((item) => item.accountId === accountId);
  if (!account) return null;
  const [token, userRaw] = await Promise.all([
    SecureStore.getItemAsync(accountSecretKey(accountId, 'token')),
    SecureStore.getItemAsync(accountSecretKey(accountId, 'user')),
  ]);
  const user = parseJson<AuthUser>(userRaw);
  return token && user ? { ...account, token, user } : null;
}

export async function getActiveAccountSession() {
  const account = await getActiveAccount();
  return account ? getAccountSession(account.accountId) : null;
}

export async function saveAuthenticatedAccount(input: {
  canonicalServerUrl?: string;
  routingMode?: AccountServerRoutingMode;
  serverInstanceId?: string | null;
  serverUrl: string;
  token: string;
  user: AuthUser;
}) {
  const accounts = await listSavedAccounts();
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const serverInstanceId = input.serverInstanceId?.trim() || serverUrl;
  const generatedAccountId = createAccountId(serverInstanceId, input.user.id);
  const existing = accounts.find((account) => (
    account.accountId === generatedAccountId ||
    (account.serverInstanceId === serverInstanceId && account.userId === input.user.id)
  ));
  const accountId = existing?.accountId ?? generatedAccountId;
  if (!existing && accounts.length >= MAX_SAVED_ACCOUNTS) {
    throw new AccountLimitError();
  }
  const account = createSavedAccount({
    canonicalServerUrl: input.canonicalServerUrl ?? existing?.canonicalServerUrl,
    databaseName: existing?.databaseName ?? `meetvap_${accountId}.db`,
    routingMode: input.routingMode ?? existing?.serverRoutingMode,
    serverInstanceId,
    serverUrl,
    user: input.user,
  });
  account.accountId = accountId;
  account.unreadConversationIds = existing?.unreadConversationIds ?? [];
  account.lastConnectedAt = Date.now();
  account.serverIdentityResolved = true;
  const nextAccounts = [account, ...accounts.filter((item) => item.accountId !== accountId)];
  accountsCache = nextAccounts;
  await Promise.all([
    writeAccountIndex(nextAccounts),
    setActiveAccountId(accountId),
    SecureStore.setItemAsync(accountSecretKey(accountId, 'token'), input.token),
    SecureStore.setItemAsync(accountSecretKey(accountId, 'user'), JSON.stringify(input.user)),
  ]);
  return account;
}

export async function updateSavedAccountUser(user: AuthUser) {
  const active = await getActiveAccount();
  if (!active) return;
  const account = createSavedAccount({
    canonicalServerUrl: active.canonicalServerUrl,
    databaseName: active.databaseName,
    routingMode: active.serverRoutingMode,
    serverInstanceId: active.serverInstanceId,
    serverUrl: active.serverUrl,
    user,
  });
  account.accountId = active.accountId;
  account.lastUsedAt = active.lastUsedAt;
  account.lastConnectedAt = active.lastConnectedAt;
  account.authState = active.authState;
  account.unreadConversationIds = active.unreadConversationIds ?? [];
  account.serverIdentityResolved = active.serverIdentityResolved;
  const accounts = (await listSavedAccounts()).map((item) => item.accountId === active.accountId ? account : item);
  accountsCache = accounts;
  await Promise.all([
    writeAccountIndex(accounts),
    SecureStore.setItemAsync(accountSecretKey(active.accountId, 'user'), JSON.stringify(user)),
  ]);
}

export async function resolveSavedAccountServerIdentity(accountId: string, serverInstanceId: string) {
  const accounts = (await listSavedAccounts()).map((item) => (
    item.accountId === accountId
      ? { ...item, serverIdentityResolved: true, serverInstanceId: serverInstanceId.trim() || item.serverUrl }
      : item
  ));
  accountsCache = accounts;
  await writeAccountIndex(accounts);
  return accounts.find((item) => item.accountId === accountId) ?? null;
}

export async function updateSavedAccountServerEndpoint(
  accountId: string,
  serverUrl: string,
  routingMode?: AccountServerRoutingMode,
  expectedCurrentServerUrl?: string,
) {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  const currentAccounts = await listSavedAccounts();
  const target = currentAccounts.find((item) => item.accountId === accountId);
  if (
    !target ||
    (expectedCurrentServerUrl && normalizeServerUrl(target.serverUrl) !== normalizeServerUrl(expectedCurrentServerUrl))
  ) {
    return null;
  }
  const accounts = currentAccounts.map((item) => (
    item.accountId === accountId
      ? {
          ...item,
          ...(routingMode ? { serverRoutingMode: routingMode } : {}),
          lastConnectedAt: Date.now(),
          serverUrl: normalizedUrl,
        }
      : item
  ));
  accountsCache = accounts;
  await writeAccountIndex(accounts);
  return accounts.find((item) => item.accountId === accountId) ?? null;
}

export async function activateSavedAccount(accountId: string) {
  const accounts = await listSavedAccounts();
  const account = accounts.find((item) => item.accountId === accountId);
  if (!account) throw new Error('Account is no longer available');
  const next = accounts.map((item) => item.accountId === accountId ? { ...item, lastUsedAt: Date.now() } : item);
  accountsCache = next;
  await Promise.all([writeAccountIndex(next), setActiveAccountId(accountId)]);
  return getAccountSession(accountId);
}

export async function markActiveAccountAuthState(authState: SavedAccount['authState']) {
  const activeId = getActiveAccountIdSync();
  if (!activeId) return;
  const accounts = (await listSavedAccounts()).map((item) => item.accountId === activeId ? { ...item, authState } : item);
  accountsCache = accounts;
  await writeAccountIndex(accounts);
}

export async function setActiveAccountUnreadConversationIds(conversationIds: string[]) {
  const activeId = getActiveAccountIdSync();
  if (!activeId) return listSavedAccounts();
  const uniqueIds = [...new Set(conversationIds)];
  const accounts = (await listSavedAccounts()).map((item) => (
    item.accountId === activeId ? { ...item, unreadConversationIds: uniqueIds } : item
  ));
  accountsCache = accounts;
  await writeAccountIndex(accounts);
  return [...accounts];
}

export async function noteAccountUnreadConversation(input: {
  accountServerUrl?: string;
  accountUserId: string;
  conversationId: string;
  serverInstanceId?: string;
}) {
  const accounts = (await listSavedAccounts()).map((item) => {
    const matchesServer = (
      (!!input.serverInstanceId && item.serverInstanceId === input.serverInstanceId) ||
      (!!input.accountServerUrl && normalizeServerUrl(item.serverUrl) === normalizeServerUrl(input.accountServerUrl))
    );
    if (!matchesServer || item.userId !== input.accountUserId) return item;
    return {
      ...item,
      unreadConversationIds: [...new Set([...(item.unreadConversationIds ?? []), input.conversationId])],
    };
  });
  accountsCache = accounts;
  await writeAccountIndex(accounts);
  return [...accounts];
}

export async function removeSavedAccount(accountId: string) {
  const accounts = (await listSavedAccounts()).filter((item) => item.accountId !== accountId);
  accountsCache = accounts;
  const accountDataPrefix = `messenger.accountData.${accountId}.`;
  const accountDataKeys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(accountDataPrefix));
  await Promise.all([
    writeAccountIndex(accounts),
    SecureStore.deleteItemAsync(accountSecretKey(accountId, 'token')),
    SecureStore.deleteItemAsync(accountSecretKey(accountId, 'user')),
    SecureStore.deleteItemAsync(accountSecretKey(accountId, 'subscription')),
    accountDataKeys.length ? AsyncStorage.multiRemove(accountDataKeys) : Promise.resolve(),
  ]);
  if (activeAccountIdCache === accountId) {
    await setActiveAccountId(null);
  }
  return accounts;
}

export async function clearSavedAccountRegistry() {
  const accounts = await listSavedAccounts();
  const secretDeletes = accounts.flatMap((account) => [
    SecureStore.deleteItemAsync(accountSecretKey(account.accountId, 'token')),
    SecureStore.deleteItemAsync(accountSecretKey(account.accountId, 'user')),
    SecureStore.deleteItemAsync(accountSecretKey(account.accountId, 'subscription')),
  ]);
  accountsCache = [];
  activeAccountIdCache = null;
  await Promise.allSettled([
    ...secretDeletes,
    AsyncStorage.removeItem(ACCOUNT_INDEX_KEY),
    AsyncStorage.removeItem(ACTIVE_ACCOUNT_ID_KEY),
  ]);
}

export async function getAccountToken(accountId = getActiveAccountIdSync()) {
  return accountId ? SecureStore.getItemAsync(accountSecretKey(accountId, 'token')) : null;
}

export async function setAccountToken(token: string, accountId = getActiveAccountIdSync()) {
  if (!accountId) return SecureStore.setItemAsync(LEGACY_AUTH_TOKEN_KEY, token);
  await SecureStore.setItemAsync(accountSecretKey(accountId, 'token'), token);
}

export async function clearAccountToken(accountId = getActiveAccountIdSync()) {
  if (!accountId) return SecureStore.deleteItemAsync(LEGACY_AUTH_TOKEN_KEY);
  await SecureStore.deleteItemAsync(accountSecretKey(accountId, 'token'));
}

export async function getAccountUser<T>(accountId = getActiveAccountIdSync()) {
  const raw = accountId
    ? await SecureStore.getItemAsync(accountSecretKey(accountId, 'user'))
    : await SecureStore.getItemAsync(LEGACY_USER_KEY);
  return parseJson<T>(raw);
}

export async function setAccountUser<T>(user: T, accountId = getActiveAccountIdSync()) {
  if (!accountId) return SecureStore.setItemAsync(LEGACY_USER_KEY, JSON.stringify(user));
  await SecureStore.setItemAsync(accountSecretKey(accountId, 'user'), JSON.stringify(user));
}

export async function clearAccountUser(accountId = getActiveAccountIdSync()) {
  if (!accountId) return SecureStore.deleteItemAsync(LEGACY_USER_KEY);
  await SecureStore.deleteItemAsync(accountSecretKey(accountId, 'user'));
}

export async function getAccountSubscription(accountId = getActiveAccountIdSync()) {
  const raw = accountId
    ? await SecureStore.getItemAsync(accountSecretKey(accountId, 'subscription'))
    : await SecureStore.getItemAsync(LEGACY_SUBSCRIPTION_STATUS_KEY);
  return parseJson<SubscriptionStatus>(raw);
}

export async function setAccountSubscription(status: SubscriptionStatus, accountId = getActiveAccountIdSync()) {
  const key = accountId ? accountSecretKey(accountId, 'subscription') : LEGACY_SUBSCRIPTION_STATUS_KEY;
  await SecureStore.setItemAsync(key, JSON.stringify(status));
}

export async function clearAccountSubscription(accountId = getActiveAccountIdSync()) {
  const key = accountId ? accountSecretKey(accountId, 'subscription') : LEGACY_SUBSCRIPTION_STATUS_KEY;
  await SecureStore.deleteItemAsync(key);
}

export function getAccountScopedStorageKey(key: string) {
  const accountId = getActiveAccountIdSync();
  return accountId ? `messenger.accountData.${accountId}.${key.replace(/^messenger\./, '')}` : key;
}

function createSavedAccount(input: {
  canonicalServerUrl?: string;
  databaseName: string;
  routingMode?: AccountServerRoutingMode;
  serverInstanceId: string;
  serverUrl: string;
  user: AuthUser;
}): SavedAccount {
  return {
    accountId: createAccountId(input.serverInstanceId, input.user.id),
    authState: 'authenticated',
    avatarUrl: input.user.avatarUrl,
    ...(input.canonicalServerUrl ? { canonicalServerUrl: normalizeServerUrl(input.canonicalServerUrl) } : {}),
    databaseName: input.databaseName,
    displayName: input.user.displayName,
    lastUsedAt: Date.now(),
    serverRoutingMode: input.routingMode,
    serverInstanceId: input.serverInstanceId,
    serverUrl: normalizeServerUrl(input.serverUrl),
    userId: input.user.id,
    username: input.user.username,
  };
}

function createAccountId(serverInstanceId: string, userId: string) {
  const value = `${serverInstanceId.trim().toLowerCase()}\u0000${userId}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `a${(hash >>> 0).toString(36)}_${sanitizeId(userId).slice(-18)}`;
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeServerUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function accountSecretKey(accountId: string, suffix: 'token' | 'user' | 'subscription') {
  return `messenger.account.${accountId}.${suffix}`;
}

async function readAccountIndex() {
  return parseJson<SavedAccount[]>(await AsyncStorage.getItem(ACCOUNT_INDEX_KEY)) ?? [];
}

async function writeAccountIndex(accounts: SavedAccount[]) {
  await AsyncStorage.setItem(ACCOUNT_INDEX_KEY, JSON.stringify(accounts));
}

async function setActiveAccountId(accountId: string | null) {
  activeAccountIdCache = accountId;
  if (accountId) await AsyncStorage.setItem(ACTIVE_ACCOUNT_ID_KEY, accountId);
  else await AsyncStorage.removeItem(ACTIVE_ACCOUNT_ID_KEY);
}

function parseJson<T>(raw: string | null) {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
