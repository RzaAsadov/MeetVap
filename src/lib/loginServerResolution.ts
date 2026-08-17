import AsyncStorage from '@react-native-async-storage/async-storage';

import { validateServerUrl } from './api';
import { DEFAULT_SERVER_URL } from './storage';

const ALIAS_TXT_DOMAIN = 'rasadov.com';
const ALIAS_CACHE_KEY = 'messenger.loginAliasCache.v1';
const DNS_TIMEOUT_MS = 5_000;
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

export type LoginServerResolution = {
  alias?: string;
  serverUrl: string;
  source: 'main' | 'direct-hostname' | 'dns-alias';
  username: string;
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
    return { serverUrl: DEFAULT_SERVER_URL, source: 'main', username: parsed.username };
  }

  const hostname = parsed.domain.includes('.')
    ? normalizeHostname(parsed.domain)
    : await resolveServerAlias(parsed.domain);
  const serverUrl = `https://${hostname}`;

  return {
    ...(hostname === parsed.domain ? {} : { alias: parsed.domain }),
    serverUrl: await requireReachableHost(serverUrl),
    source: parsed.domain.includes('.') ? 'direct-hostname' : 'dns-alias',
    username: parsed.username,
  };
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
    const records = await queryAliasTxtRecords();
    const matches = records
      .map(parseAliasRecord)
      .filter((record): record is { alias: string; hostname: string } => !!record && record.alias === alias);
    const hostnames = [...new Set(matches.map((record) => record.hostname))];
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

async function queryAliasTxtRecords() {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${ALIAS_TXT_DOMAIN}&type=TXT`,
    `https://dns.google/resolve?name=${ALIAS_TXT_DOMAIN}&type=TXT`,
  ];
  let lastError: unknown;
  for (const endpoint of endpoints) {
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
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error('DNS lookup failed');
}

function decodeTxtData(value: string) {
  const chunks = value.match(/"(?:\\.|[^"\\])*"/g);
  if (!chunks) return value.replace(/^"|"$/g, '');
  return chunks.map((chunk) => chunk.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')).join('');
}

function parseAliasRecord(value: string) {
  const match = /^mv=([a-z0-9][a-z0-9_-]{0,62});([^;]+)$/i.exec(value.trim());
  if (!match) return null;
  try {
    return { alias: match[1].toLowerCase(), hostname: normalizeHostname(match[2]) };
  } catch {
    return null;
  }
}

function normalizeHostname(value: string) {
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (
    hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)
  ) {
    throw new Error('Invalid server hostname');
  }
  return hostname;
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

async function requireReachableHost(hostname: string) {
  try {
    return await validateServerUrl(hostname);
  } catch {
    throw new LoginHostUnavailableError(hostname.trim().replace(/\/+$/, ''));
  }
}
