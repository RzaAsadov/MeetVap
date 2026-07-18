import { t } from '../../i18n';
import type { AppLanguage } from '../../i18n';
import type { AuthUser, Message } from '../../types/domain';

const CHAT_DATE_LOCALE_BY_LANGUAGE: Record<AppLanguage, string> = {
  az: 'az-AZ',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  'pt-BR': 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
};
const CHAT_TODAY_BY_LANGUAGE: Record<AppLanguage, string> = {
  az: 'Bu gün',
  de: 'Heute',
  en: 'Today',
  es: 'Hoy',
  fr: 'Aujourd’hui',
  it: 'Oggi',
  pt: 'Hoje',
  'pt-BR': 'Hoje',
  ru: 'Сегодня',
  tr: 'Bugün',
};

// ---------------------------------------------------------------------------
// Date dividers / chat list grouping
// ---------------------------------------------------------------------------

export type ChatDateDividerItem = {
  dateKey: string;
  id: string;
  label: string;
  type: 'date';
};
export type ChatMessageListItem = {
  message: Message;
  type: 'message';
};
export type ChatListItem = ChatDateDividerItem | ChatMessageListItem;

export function getMessageDate(message: Message) {
  const parsed = message.createdAtIso ? new Date(message.createdAtIso) : new Date(message.createdAt);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return new Date();
}

export function getDateDividerKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function isSameCalendarDate(left: Date, right: Date) {
  return left.getDate() === right.getDate() &&
    left.getMonth() === right.getMonth() &&
    left.getFullYear() === right.getFullYear();
}

export function formatChatDateDivider(date: Date, language: AppLanguage) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameCalendarDate(date, today)) {
    return CHAT_TODAY_BY_LANGUAGE[language];
  }

  if (isSameCalendarDate(date, yesterday)) {
    return t('yesterday', {}, language);
  }

  const locale = CHAT_DATE_LOCALE_BY_LANGUAGE[language];
  return date.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function buildChatListItems(messages: Message[], language: AppLanguage): ChatListItem[] {
  const items: ChatListItem[] = [];
  let previousDateKey: string | null = null;

  messages.forEach((message) => {
    const messageDate = getMessageDate(message);
    const dateKey = getDateDividerKey(messageDate);

    if (dateKey !== previousDateKey) {
      items.push({
        dateKey,
        id: `date-${dateKey}`,
        label: formatChatDateDivider(messageDate, language),
        type: 'date',
      });
      previousDateKey = dateKey;
    }

    items.push({ message, type: 'message' });
  });

  return items;
}

export function shouldRenderTimelineMessage(message: Message) {
  if (message.body.trim().length > 0) {
    return true;
  }

  if (message.kind === 'call') {
    return !!message.metadata?.callId || !!message.metadata?.callStatus;
  }

  if (message.kind === 'text') {
    return !!message.metadata?.location || !!message.metadata?.liveLocation || !!message.metadata?.liveLocationEstablishment;
  }

  return !!message.mediaUri ||
    !!message.fileName ||
    !!message.mimeType ||
    !!message.metadata?.remoteMediaUri ||
    !!message.metadata?.disappearingAfterView;
}

export function getChatListItemRenderKey(item: ChatListItem) {
  if (item.type === 'date') {
    return item.id;
  }

  // getMessageRenderKey lives in chatMediaHelpers to avoid a circular import;
  // callers should keep using that version for message rows.
  const metadata = item.message.metadata;

  return metadata && typeof metadata === 'object' && 'clientId' in metadata && typeof metadata.clientId === 'string'
    ? metadata.clientId
    : item.message.id;
}

// ---------------------------------------------------------------------------
// Call limits
// ---------------------------------------------------------------------------

export function getGroupCallLimit(mode: 'voice' | 'video') {
  const GROUP_VOICE_CALL_LIMIT = 8;
  const GROUP_VIDEO_CALL_LIMIT = 6;

  return mode === 'video' ? GROUP_VIDEO_CALL_LIMIT : GROUP_VOICE_CALL_LIMIT;
}

// ---------------------------------------------------------------------------
// Presence / "last seen"
// ---------------------------------------------------------------------------

export function isToday(date: Date) {
  const now = new Date();

  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

export function formatTimeAgo(date: Date, language: AppLanguage) {
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const totalHours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(t('timeDay', { count: days }, language));
  }

  if (hours > 0) {
    parts.push(t('timeHour', { count: hours }, language));
  }

  return t('timeAgo', { duration: parts.join(' ') }, language);
}

export function formatPresenceSubtitle(user: AuthUser | null, language: AppLanguage, options?: { compact?: boolean }) {
  if (!user || user.showLastSeen === false) {
    return '';
  }

  if (user.isOnline) {
    return t('online', {}, language);
  }

  if (!user.lastSeenAt) {
    return '';
  }

  const lastSeenDate = new Date(user.lastSeenAt);

  if (Number.isNaN(lastSeenDate.getTime())) {
    return '';
  }

  if (isToday(lastSeenDate)) {
    const time = lastSeenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return options?.compact
      ? `${CHAT_TODAY_BY_LANGUAGE[language].toLocaleLowerCase(CHAT_DATE_LOCALE_BY_LANGUAGE[language])} ${time}`
      : t('lastSeenTodayAt', { time }, language);
  }

  const timeAgo = formatTimeAgo(lastSeenDate, language);
  return options?.compact
    ? timeAgo
    : t('lastSeenAgo', { time: timeAgo }, language);
}

// ---------------------------------------------------------------------------
// Scheduled-send date parsing/formatting
// ---------------------------------------------------------------------------

export function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

export function parseScheduledSendAt(dateDraft: string, hourDraft: string, minuteDraft: string, secondDraft: string) {
  const dateMatch = dateDraft.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!dateMatch) {
    return null;
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(hourDraft);
  const minute = Number(minuteDraft);
  const second = Number(secondDraft);

  if (
    !Number.isInteger(hour) || hour < 0 || hour > 23 ||
    !Number.isInteger(minute) || minute < 0 || minute > 59 ||
    !Number.isInteger(second) || second < 0 || second > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, second, 0);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

// ---------------------------------------------------------------------------
// Drawing canvas math (used by the image-drawing modal)
// ---------------------------------------------------------------------------

export type ImageDrawingPoint = { x: number; y: number };
export type ImageDrawingStrokeLike = {
  color: string;
  points: ImageDrawingPoint[];
  width: number;
};

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getDrawingPath(stroke: ImageDrawingStrokeLike, width: number, height: number) {
  if (stroke.points.length === 0) {
    return '';
  }

  const [firstPoint, ...rest] = stroke.points;
  const firstX = firstPoint.x * width;
  const firstY = firstPoint.y * height;

  if (rest.length === 0) {
    return `M ${firstX} ${firstY} L ${firstX + 0.1} ${firstY + 0.1}`;
  }

  return rest.reduce(
    (path, point) => `${path} L ${point.x * width} ${point.y * height}`,
    `M ${firstX} ${firstY}`,
  );
}

// ---------------------------------------------------------------------------
// Pagination (used by the group member list)
// ---------------------------------------------------------------------------

export function getPaginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 3) {
    return [1, 2, 3, 4, 'ellipsis' as const, totalPages];
  }

  if (currentPage >= totalPages - 2) {
    return [1, 'ellipsis' as const, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, 'ellipsis' as const, currentPage - 1, currentPage, currentPage + 1, 'ellipsis' as const, totalPages];
}
