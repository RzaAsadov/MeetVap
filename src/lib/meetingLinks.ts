const PUBLIC_MEETING_HOSTS = new Set([
  'meet.meetvap.com',
  'meet.meetvap.ru',
]);

const APP_SCHEMES = new Set([
  'com.meetvap.app:',
  'meetvap:',
]);

export function getMeetingCodeFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const isPublicMeetingUrl = parsed.protocol === 'https:' && PUBLIC_MEETING_HOSTS.has(parsed.hostname.toLowerCase());
    const isAppMeetingUrl = APP_SCHEMES.has(parsed.protocol) && parsed.hostname === 'meet';

    if (!isPublicMeetingUrl && !isAppMeetingUrl) {
      return null;
    }

    const pathSegments = parsed.pathname.split('/').filter(Boolean);

    if (pathSegments.length !== 1 || !/^[A-Za-z0-9_-]{1,160}$/.test(pathSegments[0])) {
      return null;
    }

    return pathSegments[0];
  } catch {
    return null;
  }
}
