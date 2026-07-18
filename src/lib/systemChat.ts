import { AuthUser, Conversation } from '../types/domain';

export const MEETVAP_SYSTEM_USERNAME = 'meetvap';
export const MEETVAP_SYSTEM_TITLE = 'MeetVap';
export const MEETVAP_SYSTEM_AVATAR_URL = 'meetvap://logo';

export function isMeetVapSystemUser(user?: Pick<AuthUser, 'avatarUrl' | 'displayName' | 'isSystem' | 'username'> | null) {
  if (!user) {
    return false;
  }

  return user.isSystem === true ||
    normalize(user.username) === MEETVAP_SYSTEM_USERNAME ||
    user.avatarUrl === MEETVAP_SYSTEM_AVATAR_URL ||
    normalize(user.displayName) === MEETVAP_SYSTEM_USERNAME;
}

export function isMeetVapSystemConversation(
  conversation?: Pick<Conversation, 'avatarUrl' | 'isSystem' | 'members' | 'title' | 'type'> | null,
  options?: { fallbackTitle?: string; isGroup?: boolean },
) {
  if (conversation?.isSystem === true) {
    return true;
  }

  if (conversation?.type === 'GROUP' || options?.isGroup === true) {
    return false;
  }

  if (conversation?.members?.some((member) => isMeetVapSystemUser(member))) {
    return true;
  }

  if (conversation?.avatarUrl === MEETVAP_SYSTEM_AVATAR_URL) {
    return true;
  }

  return normalize(conversation?.title ?? options?.fallbackTitle) === MEETVAP_SYSTEM_USERNAME;
}

function normalize(value?: string | null) {
  return value?.trim().toLowerCase() ?? '';
}
