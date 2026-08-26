import { config } from './config';
import { operationalConfig } from './operationalConfig';
import { PublicApiEndpoint, resolveMeetServerUrl, resolvePublicApiEndpointByHost, resolveShareServerUrl } from './publicApiRouting';

export type { PublicApiEndpoint } from './publicApiRouting';

type PublicApiRequest = {
  get(name: 'host' | 'x-forwarded-host'): string | undefined;
};

export function getConfiguredPublicApiEndpoints(): PublicApiEndpoint[] {
  if (operationalConfig.publicApi) {
    return operationalConfig.publicApi.endpoints;
  }

  const legacyUrl = normalizePublicApiUrl(config.PUBLIC_API_URL);

  return legacyUrl
    ? [{ host: new URL(legacyUrl).hostname.toLowerCase(), mode: 'direct', url: legacyUrl }]
    : [];
}

export function getDefaultPublicApiEndpoint(): PublicApiEndpoint | null {
  const endpoints = getConfiguredPublicApiEndpoints();

  if (operationalConfig.publicApi) {
    return endpoints.find((endpoint) => endpoint.host === operationalConfig.publicApi?.defaultHost) ?? null;
  }

  return endpoints[0] ?? null;
}

export function resolveRequestPublicApiEndpoint(req: PublicApiRequest): PublicApiEndpoint | null {
  const endpoints = getConfiguredPublicApiEndpoints();
  return resolvePublicApiEndpointByHost(
    endpoints,
    getDefaultPublicApiEndpoint(),
    req.get('x-forwarded-host'),
    req.get('host'),
  );
}

export function getPublicApiUrlForRequest(req: PublicApiRequest) {
  return resolveRequestPublicApiEndpoint(req)?.url ?? null;
}

export function getMeetServerUrlForRequest(req: PublicApiRequest) {
  return resolveMeetServerUrl(resolveRequestPublicApiEndpoint(req), config.MEET_SERVER_URL);
}

export function getShareServerUrlForRequest(req: PublicApiRequest) {
  return resolveShareServerUrl(resolveRequestPublicApiEndpoint(req));
}

export function getPublicApiUrlOrDefault(value?: string | null) {
  const normalized = normalizePublicApiUrl(value);

  if (normalized && getConfiguredPublicApiEndpoints().some((endpoint) => endpoint.url === normalized)) {
    return normalized;
  }

  return getDefaultPublicApiEndpoint()?.url ?? null;
}

export function createPublicApiUrl(pathname: string, publicApiUrl?: string | null) {
  const origin = getPublicApiUrlOrDefault(publicApiUrl);

  return origin ? new URL(pathname, origin).toString() : null;
}

function normalizePublicApiUrl(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    return parsed.origin;
  } catch {
    return null;
  }
}
