export type PublicApiEndpoint = {
  host: string;
  meetUrl?: string;
  mode: 'direct' | 'relay';
  shareUrl?: string;
  url: string;
};

export function resolvePublicApiEndpointByHost(
  endpoints: PublicApiEndpoint[],
  defaultEndpoint: PublicApiEndpoint | null,
  forwardedHost?: string,
  requestHost?: string,
) {
  const firstForwardedHost = getFirstHeaderValue(forwardedHost);
  const firstRequestHost = getFirstHeaderValue(requestHost);

  for (const candidate of [firstForwardedHost, firstRequestHost]) {
    const hostname = normalizeHostname(candidate);
    const endpoint = hostname ? endpoints.find((item) => item.host === hostname) : undefined;

    if (endpoint) {
      return endpoint;
    }
  }

  return defaultEndpoint;
}

export function resolveMeetServerUrl(endpoint: PublicApiEndpoint | null, fallbackUrl: string) {
  return endpoint?.meetUrl ?? fallbackUrl;
}

export function resolveShareServerUrl(endpoint: PublicApiEndpoint | null, fallbackUrl = 'https://meetvap.com') {
  return endpoint?.shareUrl ?? fallbackUrl;
}

function getFirstHeaderValue(value?: string) {
  return value?.split(',')[0]?.trim();
}

function normalizeHostname(value?: string) {
  if (!value) {
    return null;
  }

  try {
    return new URL(`http://${value}`).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}
