import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';

import { validateServerUrl } from './api';
import { getClientRequestHeaders, initializeClientInstallationId } from './appClientInfo';
import { MASK_SOCKET_AUTH_KEY, MASK_SOCKET_VERSION_KEY, MASK_VERSION, maskPayload } from './payloadMask';
import { getRoutingHostnames, normalizeRoutingHostname, parseRoutingRecord, type ParsedRoutingRecord } from './serverRoutingRecords';
import { DEFAULT_SERVER_URL } from './storage';

const ALIAS_TXT_DOMAIN = 'rasadov.com';
const ALIAS_CACHE_KEY = 'messenger.loginAliasCache.v1';
const MAIN_POOL_CACHE_KEY = 'messenger.mainServerPoolCache.v1';
const MAIN_POOL_STATE_KEY = 'messenger.mainServerPoolState.v2';
const DNS_TIMEOUT_MS = 5_000;
const CANDIDATE_SOCKET_TIMEOUT_MS = 6_000;
const PRIMARY_RETRY_DELAY_MS = 650;
const MAX_STALE_ALIAS_AGE_MS = 30 * 24 * 60 * 60_000;
const MIN_DNS_REFRESH_MS = 5 * 60_000;
const MAX_DNS_REFRESH_MS = 6 * 60 * 60_000;
const MAX_STALE_MAIN_POOL_AGE_MS = 30 * 24 * 60 * 60_000;
const RETIRED_RECORD_SUCCESS_THRESHOLD = 3;
const RETIRED_RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const DNS_REFRESH_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000] as const;
const ENDPOINT_QUARANTINE_DELAYS_MS = [2 * 60_000, 10 * 60_000, 30 * 60_000] as const;

export class LoginHostUnavailableError extends Error {
  constructor(readonly hostname: string) {
    super(`Host ${hostname} is not reachable`);
    this.name = 'LoginHostUnavailableError';
  }
}

export class LoginAliasResolutionError extends Error {
  constructor(readonly alias: string, message = `Server alias @${alias} could not be resolved`) {
    super(message);
    this.name = 'LoginAliasResolutionError';
  }
}

export type LoginServerSource = 'main' | 'main-dns-pool' | 'direct-hostname' | 'dns-alias';

export type LoginServerResolution = {
  alias?: string;
  candidateServerUrls: string[];
  loginDomain?: string;
  serverUrl: string;
  source: LoginServerSource;
  username: string;
};

export type MainServerCandidate = {
  hostname: string;
  responseTimeMs: number;
  serverInstanceId: string;
  serverUrl: string;
};

export type RuntimeMainServerDiscovery = {
  candidates: MainServerCandidate[];
  dnsReachable: boolean;
  refreshAfter: number;
};

type MainPoolCacheEntry = MainServerCandidate & {
  verifiedAt: number;
};

type MainPoolDnsEntry = {
  firstSeenAt: number;
  lastSeenAt: number;
  missingRefreshes: number;
};

type MainPoolEndpointHealth = {
  consecutiveFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  responseTimeMs?: number;
  quarantineUntil?: number;
};

type MainPoolState = {
  dnsEntries: Record<string, MainPoolDnsEntry>;
  fetchedAt: number;
  health: Record<string, MainPoolEndpointHealth>;
  nextRefreshAt: number;
  refreshFailures: number;
  staleUntil: number;
  version: 2;
};

type RoutingTxtLookup = {
  records: ParsedRoutingRecord[];
  ttlMs: number;
};

let mainPoolStateSnapshot: MainPoolState | null = null;
let mainPoolStateLoadPromise: Promise<MainPoolState> | null = null;
let mainPoolStateMutationQueue: Promise<void> = Promise.resolve();
let mainPoolRefreshPromise: Promise<{ dnsReachable: boolean; hostnames: string[]; refreshAfter: number }> | null = null;

export function parseDomainLogin(value: string) {
  const normalized = value.trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');

  if (separator <= 0 || separator === normalized.length - 1) {
    return { domain: null, username: normalized };
  }

  return {
    domain: normalized.slice(separator + 1),
    username: normalized.slice(0, separator),
  };
}

export async function resolveLoginServer(rawUsername: string): Promise<LoginServerResolution> {
  const parsed = parseDomainLogin(rawUsername);

  if (!parsed.domain) {
    const mainServer = await resolveMainServer();
    return { ...mainServer, username: parsed.username };
  }

  const hostname = parsed.domain.includes('.')
    ? normalizeRoutingHostname(parsed.domain)
    : await resolveServerAlias(parsed.domain);
  const serverUrl = `https://${hostname}`;
  const reachableServerUrl = await requireReachableHost(serverUrl);

  return {
    ...(hostname === parsed.domain ? {} : { alias: parsed.domain }),
    candidateServerUrls: [reachableServerUrl],
    loginDomain: parsed.domain,
    serverUrl: reachableServerUrl,
    source: parsed.domain.includes('.') ? 'direct-hostname' : 'dns-alias',
    username: parsed.username,
  };
}

export async function resolveMainServer(): Promise<Omit<LoginServerResolution, 'username'>> {
  try {
    const serverUrl = await requireReachableHost(DEFAULT_SERVER_URL);
    return {
      candidateServerUrls: [serverUrl],
      serverUrl,
      source: 'main',
    };
  } catch {
    const candidates = await resolveMainLoginFallbackCandidates();
    if (candidates.length === 0) throw new LoginHostUnavailableError(DEFAULT_SERVER_URL);
    return {
      candidateServerUrls: candidates.map((candidate) => candidate.serverUrl),
      serverUrl: candidates[0].serverUrl,
      source: 'main-dns-pool',
    };
  }
}

export async function resolveMainLoginFallbackCandidates() {
  const pool = await refreshMainServerPoolCacheIfNeeded();
  const candidates = await probeMainServerCandidates(pool.hostnames);
  if (candidates.length > 0) await cacheMainPoolCandidates(candidates);
  if (candidates.length > 0) return candidates;

  await delay(PRIMARY_RETRY_DELAY_MS);
  const primary = await probeMainServerCandidate(DEFAULT_SERVER_URL);
  if (primary) return [primary];
  const legacyCached = await getCachedMainPoolCandidates();
  return probeMainServerCandidates(legacyCached.map((candidate) => candidate.hostname));
}

export async function discoverRuntimeMainServers(
  expectedServerInstanceId: string,
): Promise<RuntimeMainServerDiscovery> {
  const pool = await refreshMainServerPoolCacheIfNeeded();
  const candidates = await probeMainServerCandidates(
    pool.hostnames,
    expectedServerInstanceId,
  );
  if (candidates.length > 0) await cacheMainPoolCandidates(candidates);
  return { candidates, dnsReachable: pool.dnsReachable, refreshAfter: pool.refreshAfter };
}

export async function refreshMainServerPoolCacheIfNeeded(force = false) {
  const existing = mainPoolRefreshPromise;
  if (existing) return existing;

  const operation = (async () => {
    const now = Date.now();
    const state = await readMainPoolState();
    const cachedHostnames = getUsableCachedHostnames(state, now);

    if (!force && cachedHostnames.length > 0 && now < state.nextRefreshAt) {
      return { dnsReachable: true, hostnames: cachedHostnames, refreshAfter: state.nextRefreshAt };
    }

    try {
      const lookup = await queryRoutingTxtRecordsWithTtl();
      const discoveredHostnames = getRoutingHostnames(lookup.records, 'main');
      if (discoveredHostnames.length === 0) throw new Error('No mv=main DNS records');
      const refreshAfter = now + clamp(lookup.ttlMs, MIN_DNS_REFRESH_MS, MAX_DNS_REFRESH_MS);
      const updated = await updateMainPoolState((current) => {
        const discovered = new Set(discoveredHostnames);
        const dnsEntries: Record<string, MainPoolDnsEntry> = {};
        Object.entries(current.dnsEntries).forEach(([hostname, entry]) => {
          const nextEntry = discovered.has(hostname)
            ? { ...entry, lastSeenAt: now, missingRefreshes: 0 }
            : { ...entry, missingRefreshes: entry.missingRefreshes + 1 };
          if (
            nextEntry.missingRefreshes < RETIRED_RECORD_SUCCESS_THRESHOLD &&
            now - nextEntry.lastSeenAt <= RETIRED_RECORD_MAX_AGE_MS
          ) {
            dnsEntries[hostname] = nextEntry;
          }
        });

        discoveredHostnames.forEach((hostname) => {
          dnsEntries[hostname] = dnsEntries[hostname] ?? {
            firstSeenAt: now,
            lastSeenAt: now,
            missingRefreshes: 0,
          };
        });

        return {
          ...current,
          dnsEntries,
          fetchedAt: now,
          nextRefreshAt: refreshAfter,
          refreshFailures: 0,
          staleUntil: now + MAX_STALE_MAIN_POOL_AGE_MS,
        };
      });
      return {
        dnsReachable: true,
        hostnames: getUsableCachedHostnames(updated, now),
        refreshAfter,
      };
    } catch {
      const updated = await updateMainPoolState((current) => {
        const refreshFailures = current.refreshFailures + 1;
        const retryIndex = Math.min(refreshFailures - 1, DNS_REFRESH_RETRY_DELAYS_MS.length - 1);
        return {
          ...current,
          nextRefreshAt: now + DNS_REFRESH_RETRY_DELAYS_MS[retryIndex],
          refreshFailures,
        };
      });
      return {
        dnsReachable: false,
        hostnames: getUsableCachedHostnames(updated, now),
        refreshAfter: updated.nextRefreshAt,
      };
    }
  })().finally(() => {
    if (mainPoolRefreshPromise === operation) mainPoolRefreshPromise = null;
  });

  mainPoolRefreshPromise = operation;
  return operation;
}

export async function validateAuthenticatedMainServerCandidate(input: {
  expectedServerInstanceId: string;
  expectedUserId: string;
  serverUrl: string;
  token: string;
}) {
  const candidate = await probeMainServerCandidate(input.serverUrl, input.expectedServerInstanceId);
  if (!candidate) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);

  try {
    await initializeClientInstallationId();
    const response = await fetch(`${candidate.serverUrl}/auth/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${input.token}`,
        ...getClientRequestHeaders(),
      },
      signal: controller.signal,
    });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) return null;
    const payload = await response.json() as { user?: { id?: unknown } };
    if (payload.user?.id !== input.expectedUserId) return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }

  const socketConnected = await probeAuthenticatedSocket(candidate.serverUrl, input.token);
  return socketConnected ? candidate : null;
}

export async function isMainServerEndpointQuarantined(serverInstanceId: string, serverUrl: string) {
  const state = await readMainPoolState();
  const health = state.health[getHealthKey(serverInstanceId, serverUrl)];
  return !!health?.quarantineUntil && health.quarantineUntil > Date.now();
}

export async function requiresMainServerEndpointRecoveryConfirmation(serverInstanceId: string, serverUrl: string) {
  const state = await readMainPoolState();
  return (state.health[getHealthKey(serverInstanceId, serverUrl)]?.consecutiveFailures ?? 0) > 0;
}

export async function recordMainServerEndpointFailure(serverInstanceId: string, serverUrl: string) {
  const now = Date.now();
  return updateMainPoolState((state) => {
    const key = getHealthKey(serverInstanceId, serverUrl);
    const current = state.health[key] ?? { consecutiveFailures: 0 };
    const consecutiveFailures = current.consecutiveFailures + 1;
    const delayIndex = Math.min(consecutiveFailures - 1, ENDPOINT_QUARANTINE_DELAYS_MS.length - 1);
    return {
      ...state,
      health: {
        ...state.health,
        [key]: {
          ...current,
          consecutiveFailures,
          lastFailureAt: now,
          quarantineUntil: now + ENDPOINT_QUARANTINE_DELAYS_MS[delayIndex],
        },
      },
    };
  });
}

export async function recordMainServerEndpointSuccess(
  serverInstanceId: string,
  serverUrl: string,
  responseTimeMs?: number,
) {
  const now = Date.now();
  return updateMainPoolState((state) => {
    const key = getHealthKey(serverInstanceId, serverUrl);
    return {
      ...state,
      health: {
        ...state.health,
        [key]: {
          consecutiveFailures: 0,
          lastSuccessAt: now,
          ...(responseTimeMs === undefined ? {} : { responseTimeMs }),
        },
      },
    };
  });
}

export async function probeMainServerCandidate(
  serverUrl: string,
  expectedServerInstanceId?: string,
): Promise<MainServerCandidate | null> {
  let normalizedUrl: string;
  let hostname: string;

  try {
    normalizedUrl = normalizeServerUrl(serverUrl);
    hostname = normalizeRoutingHostname(new URL(normalizedUrl).hostname);
  } catch {
    return null;
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);

  try {
    const [healthResponse, configResponse] = await Promise.all([
      fetch(`${normalizedUrl}/health`, { signal: controller.signal }),
      fetch(`${normalizedUrl}/config/client`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
    ]);
    if (!healthResponse.ok || !configResponse.ok) return null;
    const config = await configResponse.json() as { serverInstanceId?: unknown };
    const serverInstanceId = typeof config.serverInstanceId === 'string' ? config.serverInstanceId.trim() : '';
    if (!serverInstanceId || (expectedServerInstanceId && serverInstanceId !== expectedServerInstanceId)) return null;
    return {
      hostname,
      responseTimeMs: Math.max(1, Date.now() - startedAt),
      serverInstanceId,
      serverUrl: normalizedUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getServerInstanceId(serverUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/config/client`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return serverUrl;
    const payload = await response.json() as { serverInstanceId?: unknown };
    return typeof payload.serverInstanceId === 'string' && payload.serverInstanceId.trim()
      ? payload.serverInstanceId.trim()
      : serverUrl;
  } catch {
    return serverUrl;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveServerAlias(alias: string) {
  if (!/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/.test(alias)) {
    throw new LoginAliasResolutionError(alias, `Invalid server alias @${alias}`);
  }

  try {
    const records = await queryRoutingTxtRecords();
    const hostnames = [...new Set(records.filter((record) => record.alias === alias).map((record) => record.hostname))];
    if (hostnames.length !== 1) {
      throw new LoginAliasResolutionError(
        alias,
        hostnames.length > 1 ? `Server alias @${alias} has conflicting DNS records` : `Server alias @${alias} was not found`,
      );
    }
    await cacheAlias(alias, hostnames[0]);
    return hostnames[0];
  } catch (error) {
    if (error instanceof LoginAliasResolutionError && !error.message.includes('not found')) throw error;
    const cached = await getCachedAlias(alias);
    if (cached) return cached;
    if (error instanceof LoginAliasResolutionError) throw error;
    throw new LoginAliasResolutionError(alias);
  }
}

async function queryRoutingTxtRecords() {
  return (await queryRoutingTxtRecordsWithTtl()).records;
}

async function queryRoutingTxtRecordsWithTtl(): Promise<RoutingTxtLookup> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${ALIAS_TXT_DOMAIN}&type=TXT`,
    `https://dns.google/resolve?name=${ALIAS_TXT_DOMAIN}&type=TXT`,
  ];
  const results = await Promise.allSettled(endpoints.map(queryTxtEndpoint));
  const successful = results.filter((result): result is PromiseFulfilledResult<{ records: string[]; ttlSeconds: number | undefined }> => result.status === 'fulfilled');
  if (successful.length === 0) throw new Error('DNS lookup failed');
  const records = [...new Set(successful.flatMap((result) => result.value.records))]
    .map(parseRoutingRecord)
    .filter((record): record is ParsedRoutingRecord => !!record);
  const ttlSeconds = Math.min(...successful
    .map((result) => result.value.ttlSeconds)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0));
  return {
    records,
    ttlMs: Number.isFinite(ttlSeconds) ? ttlSeconds * 1000 : MIN_DNS_REFRESH_MS,
  };
}

async function queryTxtEndpoint(endpoint: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/dns-json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DNS request failed with ${response.status}`);
    const payload = await response.json() as { Answer?: { TTL?: unknown; data?: unknown; type?: number }[] };
    const answers = (payload.Answer ?? [])
      .filter((answer) => answer.type === 16 && typeof answer.data === 'string');
    const ttlSeconds = Math.min(...answers
      .map((answer) => answer.TTL)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0));
    return {
      records: answers.map((answer) => decodeTxtData(answer.data as string)),
      ttlSeconds: Number.isFinite(ttlSeconds) ? ttlSeconds : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeTxtData(value: string) {
  const chunks = value.match(/"(?:\\.|[^"\\])*"/g);
  if (!chunks) return value.replace(/^"|"$/g, '');
  return chunks.map((chunk) => chunk.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')).join('');
}

async function probeMainServerCandidates(hostnames: string[], expectedServerInstanceId?: string) {
  const results = await Promise.all(hostnames.map((hostname) => (
    probeMainServerCandidate(`https://${hostname}`, expectedServerInstanceId)
  )));
  return results
    .filter((candidate): candidate is MainServerCandidate => !!candidate)
    .sort((left, right) => left.responseTimeMs - right.responseTimeMs);
}

function normalizeServerUrl(value: string) {
  const parsed = new URL(value.trim().replace(/\/+$/, ''));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('Invalid server URL');
  }
  return `https://${normalizeRoutingHostname(parsed.hostname)}`;
}

async function getCachedAlias(alias: string) {
  const cache = await readAliasCache();
  const entry = cache[alias];
  return entry && Date.now() - entry.verifiedAt <= MAX_STALE_ALIAS_AGE_MS ? entry.hostname : null;
}

async function cacheAlias(alias: string, hostname: string) {
  const cache = await readAliasCache();
  cache[alias] = { hostname, verifiedAt: Date.now() };
  await AsyncStorage.setItem(ALIAS_CACHE_KEY, JSON.stringify(cache));
}

async function readAliasCache() {
  try {
    return JSON.parse(await AsyncStorage.getItem(ALIAS_CACHE_KEY) ?? '{}') as Record<string, { hostname: string; verifiedAt: number }>;
  } catch {
    return {};
  }
}

async function cacheMainPoolCandidates(candidates: MainServerCandidate[]) {
  const entries = candidates.map((candidate) => ({ ...candidate, verifiedAt: Date.now() }));
  await AsyncStorage.setItem(MAIN_POOL_CACHE_KEY, JSON.stringify(entries)).catch(() => undefined);
}

async function getCachedMainPoolCandidates() {
  try {
    const entries = JSON.parse(await AsyncStorage.getItem(MAIN_POOL_CACHE_KEY) ?? '[]') as MainPoolCacheEntry[];
    return entries.filter((entry) => (
      typeof entry.hostname === 'string' &&
      typeof entry.verifiedAt === 'number' &&
      Date.now() - entry.verifiedAt <= MAX_STALE_ALIAS_AGE_MS
    ));
  } catch {
    return [];
  }
}

async function probeAuthenticatedSocket(serverUrl: string, token: string) {
  await initializeClientInstallationId();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = io(serverUrl, {
      auth: {
        [MASK_SOCKET_AUTH_KEY]: maskPayload({ token }),
        [MASK_SOCKET_VERSION_KEY]: MASK_VERSION,
      },
      autoConnect: false,
      extraHeaders: getClientRequestHeaders(),
      forceNew: true,
      reconnection: false,
      timeout: CANDIDATE_SOCKET_TIMEOUT_MS,
    });
    const finish = (connected: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.disconnect();
      resolve(connected);
    };
    const timeout = setTimeout(() => finish(false), CANDIDATE_SOCKET_TIMEOUT_MS + 250);
    socket.once('connect', () => finish(true));
    socket.once('connect_error', () => finish(false));
    socket.connect();
  });
}

async function readMainPoolState() {
  if (mainPoolStateSnapshot) return mainPoolStateSnapshot;
  if (mainPoolStateLoadPromise) return mainPoolStateLoadPromise;

  mainPoolStateLoadPromise = (async () => {
    const now = Date.now();
    try {
      const parsed = JSON.parse(await AsyncStorage.getItem(MAIN_POOL_STATE_KEY) ?? 'null') as MainPoolState | null;
      if (parsed?.version === 2 && parsed.dnsEntries && parsed.health) {
        mainPoolStateSnapshot = parsed;
        return parsed;
      }
    } catch {
      // A damaged cache must not prevent login or failover.
    }

    const state = createEmptyMainPoolState();
    try {
      const legacyEntries = JSON.parse(await AsyncStorage.getItem(MAIN_POOL_CACHE_KEY) ?? '[]') as MainPoolCacheEntry[];
      legacyEntries.forEach((entry) => {
        if (typeof entry.hostname !== 'string' || typeof entry.verifiedAt !== 'number') return;
        try {
          const hostname = normalizeRoutingHostname(entry.hostname);
          state.dnsEntries[hostname] = {
            firstSeenAt: entry.verifiedAt,
            lastSeenAt: entry.verifiedAt,
            missingRefreshes: 0,
          };
          state.staleUntil = Math.max(state.staleUntil, entry.verifiedAt + MAX_STALE_MAIN_POOL_AGE_MS);
        } catch {
          // Ignore invalid legacy entries.
        }
      });
    } catch {
      // There is no usable legacy cache.
    }
    state.nextRefreshAt = now;
    mainPoolStateSnapshot = state;
    return state;
  })().finally(() => {
    mainPoolStateLoadPromise = null;
  });

  return mainPoolStateLoadPromise;
}

async function updateMainPoolState(mutator: (state: MainPoolState) => MainPoolState) {
  let updatedState!: MainPoolState;
  const operation = mainPoolStateMutationQueue
    .catch(() => undefined)
    .then(async () => {
      const state = mutator(await readMainPoolState());
      mainPoolStateSnapshot = state;
      updatedState = state;
      await AsyncStorage.setItem(MAIN_POOL_STATE_KEY, JSON.stringify(state)).catch(() => undefined);
    });
  mainPoolStateMutationQueue = operation.catch(() => undefined);
  await operation;
  return updatedState;
}

function createEmptyMainPoolState(): MainPoolState {
  return {
    dnsEntries: {},
    fetchedAt: 0,
    health: {},
    nextRefreshAt: 0,
    refreshFailures: 0,
    staleUntil: 0,
    version: 2,
  };
}

function getUsableCachedHostnames(state: MainPoolState, now: number) {
  if (state.staleUntil > 0 && now > state.staleUntil) return [];
  return Object.entries(state.dnsEntries)
    .filter(([, entry]) => (
      entry.missingRefreshes < RETIRED_RECORD_SUCCESS_THRESHOLD &&
      (entry.missingRefreshes === 0 || now - entry.lastSeenAt <= RETIRED_RECORD_MAX_AGE_MS)
    ))
    .map(([hostname]) => hostname);
}

function getHealthKey(serverInstanceId: string, serverUrl: string) {
  let hostname = serverUrl.trim().toLowerCase().replace(/\/+$/, '');
  try {
    hostname = new URL(normalizeServerUrl(serverUrl)).hostname;
  } catch {
    // Preserve a deterministic key for malformed legacy values.
  }
  return `${serverInstanceId.trim().toLowerCase()}\u0000${hostname}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function requireReachableHost(hostname: string) {
  try {
    return await validateServerUrl(hostname);
  } catch {
    throw new LoginHostUnavailableError(hostname.trim().replace(/\/+$/, ''));
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
