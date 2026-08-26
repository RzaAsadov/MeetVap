import { AuthUser } from '../types/domain';
import { t } from '../i18n';

export const DEFAULT_SHARE_BASE_URL = 'https://meetvap.com';

export function buildSharedContactWebUrl(publicShareCode: string, shareBaseUrl = DEFAULT_SHARE_BASE_URL) {
  return new URL(`/u/${encodeURIComponent(publicShareCode.trim())}`, normalizeShareBaseUrl(shareBaseUrl)).toString();
}

export function buildSharedContactAppUrl(publicShareCode: string) {
  return `meetvap://u/${encodeURIComponent(publicShareCode.trim())}`;
}

export function buildSharedGroupWebUrl(publicInviteCode: string, shareBaseUrl = DEFAULT_SHARE_BASE_URL) {
  return new URL(`/g/${encodeURIComponent(publicInviteCode.trim())}`, normalizeShareBaseUrl(shareBaseUrl)).toString();
}

export function buildSharedGroupAppUrl(publicInviteCode: string) {
  return `meetvap://g/${encodeURIComponent(publicInviteCode.trim())}`;
}

export function buildSharedContactMessage(
  user: Pick<AuthUser, 'displayName' | 'publicShareCode'>,
  shareBaseUrl = DEFAULT_SHARE_BASE_URL,
) {
  const title = user.displayName?.trim() || t('sharedContact');
  const shareCode = user.publicShareCode?.trim();

  if (!shareCode) {
    throw new Error(t('sharedContactCodeMissing'));
  }

  const webUrl = buildSharedContactWebUrl(shareCode, shareBaseUrl);

  return {
    message: t('sharedContactMessage', { name: title, url: webUrl }),
    url: webUrl,
  };
}

function normalizeShareBaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.origin : DEFAULT_SHARE_BASE_URL;
  } catch {
    return DEFAULT_SHARE_BASE_URL;
  }
}
