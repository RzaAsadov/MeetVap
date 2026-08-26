import AsyncStorage from '@react-native-async-storage/async-storage';

import { validateServerUrl } from './api';
import { getRoutingHostnames, normalizeRoutingHostname, parseRoutingRecord, type ParsedRoutingRecord } from './serverRoutingRecords';
import { DEFAULT_SERVER_URL } from './storage';

const ALIAS_TXT_DOMAIN = 'rasadov.com';
const ALIAS_CACHE_KEY = 'messenger.loginAliasCache.v1';
const MAIN_POOL_CACHE_KEY = 'messenger.mainServerPoolCache.v1';
const DNS_TIMEOUT_MS = 5_000;
const PRIMARY_RETRY_DELAY_MS = 650;
const MAX_STALE_ALIAS_AGE_MS = 30 * 24 * 60 * 60_000;

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
};

type MainPoolCacheEntry = MainServerCandidate & {
  verifiedAt: number;
};

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
    try {
      const serverUrl = await requireReachableHost(DEFAULT_SERVER_URL);
      return {
        candidateServerUrls: [serverUrl],
        serverUrl,
        source: 'main',
        username: parsed.username,
      };
    } catch {
      const candidates = await resolveMainLoginFallbackCandidates();
      if (candidates.length === 0) throw new LoginHostUnavailableError(DEFAULT_SERVER_URL);
      return {
        candidateServerUrls: candidates.map((candidate) => candidate.serverUrl),
        serverUrl: candidates[0].serverUrl,
        source: 'main-dns-pool',
        username: parsed.username,
      };
    }
  }

  const hostname = parsed.domain.includes('.')
    ? normalizeRoutingHostname(parsed.domain)
    : await resolveServerAlias(parsed.domain);
  const serverUrl = `https://${hostname}`;
  const reachableServerUrl = await requireReachableHost(serverUrl);

  return {
    ...(hostname === parsed.domain ? {} : { alias: parsed.domain }),
    candidateServerUrls: [reachableServerUrl],
    serverUrl: reachableServerUrl,
    source: parsed.domain.includes('.') ? 'direct-hostname' : 'dns-alias',
    username: parsed.username,
  };
}

export async function resolveMainLoginFallbackCandidates() {
  try {
    const records = await queryRoutingTxtRecords();
    const candidates = await probeMainServerCandidates(getRoutingHostnames(records, 'main'));
    if (candidates.length > 0) await cacheMainPoolCandidates(candidates);
    return candidates;
  } catch {
    await delay(PRIMARY_RETRY_DELAY_MS);
    const primary = await probeMainServerCandidate(DEFAULT_SERVER_URL);
    if (primary) return [primary];
    const cached = await getCachedMainPoolCandidates();
    return probeMainServerCandidates(cached.map((candidate) => candidate.hostname));
  }
}

export async function discoverRuntimeMainServers(
  expectedServerInstanceId: string,
): Promise<RuntimeMainServerDiscovery> {
  try {
    const records = await queryRoutingTxtRecords();
    const candidates = await probeMainServerCandidates(
      getRoutingHostnames(records, 'main'),
      expectedServerInstanceId,
    );
    if (candidates.length > 0) await cacheMainPoolCandidates(candidates);
    return { candidates, dnsReachable: true };
  } catch {
    return { candidates: [], dnsReachable: false };
  }
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
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${ALIAS_TXT_DOMAIN}&type=TXT`,
    `https://dns.google/resolve?name=${ALIAS_TXT_DOMAIN}&type=TXT`,
  ];
  const results = await Promise.allSettled(endpoints.map(queryTxtEndpoint));
  const successful = results.filter((result): result is PromiseFulfilledResult<string[]> => result.status === 'fulfilled');
  if (successful.length === 0) throw new Error('DNS lookup failed');
  return [...new Set(successful.flatMap((result) => result.value))]
    .map(parseRoutingRecord)
    .filter((record): record is ParsedRoutingRecord => !!record);
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
    const payload = await response.json() as { Answer?: { data?: unknown; type?: number }[] };
    return (payload.Answer ?? [])
      .filter((answer) => answer.type === 16 && typeof answer.data === 'string')
      .map((answer) => decodeTxtData(answer.data as string));
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
  await AsyncStorage.setItem(MAIN_POOL_CACHE_KEY, JSON.stringify(entries));
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
