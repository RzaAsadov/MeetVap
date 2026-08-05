declare global {
  interface Window {
    __MEETVAP_CONFIG__?: {
      apiUrl?: string;
    };
  }
}

export function getRuntimeApiUrl(buildTimeUrl?: string) {
  return normalizeApiUrl(window.__MEETVAP_CONFIG__?.apiUrl) ??
    normalizeApiUrl(buildTimeUrl) ??
    'https://meetvap.com';
}

function normalizeApiUrl(value?: string) {
  const normalized = value?.trim().replace(/\/+$/, '');
  return normalized && /^https?:\/\//i.test(normalized) ? normalized : undefined;
}
