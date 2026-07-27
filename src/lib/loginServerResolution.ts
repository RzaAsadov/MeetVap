import { Platform } from 'react-native';

import { ApiError, apiRequest, validateServerUrl } from './api';
import { DEFAULT_SERVER_URL } from './storage';

export class LoginHostUnavailableError extends Error {
  constructor(readonly hostname: string) {
    super(`Host ${hostname} is not reachable`);
    this.name = 'LoginHostUnavailableError';
  }
}

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

export async function resolveLoginServer(rawUsername: string) {
  const parsed = parseDomainLogin(rawUsername);

  if (!parsed.domain) {
    return { serverUrl: DEFAULT_SERVER_URL, username: parsed.username };
  }

  let resolvedHostname: string;

  try {
    resolvedHostname = await requestDomainHostname(parsed.domain, parsed.username);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    resolvedHostname = '';
  }

  if (resolvedHostname) {
    return { serverUrl: await requireReachableHost(resolvedHostname), username: parsed.username };
  }

  const directHostname = `https://${parsed.domain}`;

  try {
    return { serverUrl: await requireReachableHost(directHostname), username: parsed.username };
  } catch {
    // A final directory attempt handles temporary bootstrap connectivity loss.
  }

  try {
    resolvedHostname = await requestDomainHostname(parsed.domain, parsed.username);
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new LoginHostUnavailableError(directHostname);
  }

  return { serverUrl: await requireReachableHost(resolvedHostname), username: parsed.username };
}

async function requestDomainHostname(domain: string, username: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await apiRequest<{ hostname: string }>('/auth/domain-resolution', {
      body: JSON.stringify({ domain, platform: Platform.OS, username }),
      method: 'POST',
      serverUrl: DEFAULT_SERVER_URL,
      signal: controller.signal,
    });
    return response.hostname;
  } finally {
    clearTimeout(timeout);
  }
}

async function requireReachableHost(hostname: string) {
  try {
    return await validateServerUrl(hostname);
  } catch {
    throw new LoginHostUnavailableError(hostname.trim().replace(/\/+$/, ''));
  }
}
