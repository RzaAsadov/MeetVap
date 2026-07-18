import { AuthUser } from '../types/domain';
import { t } from '../i18n';

export const MEETVAP_WEB_HOST = 'meetvap.com';

export function buildSharedContactWebUrl(publicShareCode: string) {
  return `https://${MEETVAP_WEB_HOST}/u/${encodeURIComponent(publicShareCode.trim())}`;
}

export function buildSharedContactAppUrl(publicShareCode: string) {
  return `meetvap://u/${encodeURIComponent(publicShareCode.trim())}`;
}

export function buildSharedGroupWebUrl(publicInviteCode: string) {
  return `https://${MEETVAP_WEB_HOST}/g/${encodeURIComponent(publicInviteCode.trim())}`;
}

export function buildSharedGroupAppUrl(publicInviteCode: string) {
  return `meetvap://g/${encodeURIComponent(publicInviteCode.trim())}`;
}

export function buildSharedContactMessage(user: Pick<AuthUser, 'displayName' | 'publicShareCode'>) {
  const title = user.displayName?.trim() || t('sharedContact');
  const shareCode = user.publicShareCode?.trim();

  if (!shareCode) {
    throw new Error(t('sharedContactCodeMissing'));
  }

  const webUrl = buildSharedContactWebUrl(shareCode);

  return {
    message: t('sharedContactMessage', { name: title, url: webUrl }),
    url: webUrl,
  };
}
