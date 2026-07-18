import { getI18nLanguage, t } from '../../i18n';
import type { AppLanguage } from '../../i18n';
import type { Message } from '../../types/domain';

// ---------------------------------------------------------------------------
// Reply preview
// ---------------------------------------------------------------------------

export function getReplySenderName(message: Message, currentUserId?: string) {
  if (message.senderId === currentUserId) {
    return 'you';
  }

  return message.sender?.displayName || message.sender?.username || 'message';
}

export function getMessagePreview(message: Pick<Message, 'body' | 'fileName' | 'kind'>, language: AppLanguage) {
  if (message.body) {
    if (message.body === 'Voice message' || message.body === 'Sesli mesaj' || message.body === 'Голосовое сообщение') {
      return t('voiceMessage', {}, language);
    }

    if (message.body === 'Location' || message.body === 'Konum' || message.body === 'Местоположение') {
      return t('location', {}, language);
    }

    if (message.body === 'Live location') {
      return t('liveLocation', {}, language);
    }

    if (message.body === 'Photo' || message.body === 'Fotoğraf' || message.body === 'Фото') {
      return t('photo', {}, language);
    }

    if (message.body === 'Video' || message.body === 'Видео') {
      return t('video', {}, language);
    }

    if (message.body === 'File' || message.body === 'Dosya' || message.body === 'Файл') {
      return t('file', {}, language);
    }

    if (message.body === 'Call' || message.body === 'Arama' || message.body === 'Звонок') {
      return t('call', {}, language);
    }

    return message.body;
  }

  if (message.kind === 'voice') {
    return t('voiceMessage', {}, language);
  }

  if (message.kind === 'image') {
    return t('photo', {}, language);
  }

  if (message.kind === 'video') {
    return message.fileName ?? t('video', {}, language);
  }

  if (message.kind === 'file') {
    return message.fileName ?? t('file', {}, language);
  }

  if (message.kind === 'call') {
    return t('call', {}, language);
  }

  return t('message', {}, language);
}

export function getReplyPreview(message: Message, currentUserId?: string, language: AppLanguage = getI18nLanguage()) {
  return {
    body: getMessagePreview(message, language),
    id: message.id,
    kind: message.kind,
    senderName: getReplySenderName(message, currentUserId),
  };
}

export function getDisappearingSecondsAfterView(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('disappearingAfterView' in metadata)) {
    return undefined;
  }

  const config = metadata.disappearingAfterView;

  return config &&
    typeof config === 'object' &&
    'seconds' in config &&
    typeof config.seconds === 'number' &&
    Number.isFinite(config.seconds)
    ? Math.max(1, Math.floor(config.seconds))
    : undefined;
}

// ---------------------------------------------------------------------------
// Pinned message helpers
// ---------------------------------------------------------------------------

export function mergePinnedMessageWithLocalCopy(serverMessage: Message, localMessage: Message): Message {
  return {
    ...serverMessage,
    body: serverMessage.body.trim() ? serverMessage.body : localMessage.body,
    durationSeconds: serverMessage.durationSeconds ?? localMessage.durationSeconds,
    fileName: serverMessage.fileName ?? localMessage.fileName,
    mediaId: serverMessage.mediaId ?? localMessage.mediaId,
    mediaUri: serverMessage.mediaUri ?? localMessage.mediaUri,
    metadata: serverMessage.metadata ?? localMessage.metadata,
    mimeType: serverMessage.mimeType ?? localMessage.mimeType,
    sizeBytes: serverMessage.sizeBytes ?? localMessage.sizeBytes,
  };
}

export function getMessageCaption(message: Message) {
  const body = message.body.trim();

  if (
    !body ||
    body === message.fileName ||
    body === 'Photo' || body === 'Fotoğraf' || body === 'Фото' ||
    body === 'Video' || body === 'Видео' ||
    body === 'File' || body === 'Dosya' || body === 'Файл' ||
    body === 'Voice message' || body === 'Sesli mesaj' || body === 'Голосовое сообщение' ||
    body === 'Location' || body === 'Konum' || body === 'Местоположение'
  ) {
    return '';
  }

  return body;
}

export function getMessageLocation(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  const location = 'liveLocation' in metadata ? metadata.liveLocation : 'location' in metadata ? metadata.location : null;

  if (!location || typeof location !== 'object' || !('latitude' in location) || !('longitude' in location)) {
    return null;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    address: 'address' in location && typeof location.address === 'string' ? location.address : undefined,
    latitude,
    longitude,
  };
}

export function getPinnedMessageTitle(message: Message, language: AppLanguage) {
  if (message.kind === 'file') {
    return [message.fileName ?? t('file', {}, language), getMessageCaption(message)].filter(Boolean).join(' - ');
  }

  if (message.kind === 'voice') {
    return [t('voiceMessage', {}, language), getMessageCaption(message)].filter(Boolean).join(' - ');
  }

  if (getMessageLocation(message)) {
    return [t('location', {}, language), getMessageCaption(message)].filter(Boolean).join(' - ');
  }

  if (message.kind === 'image') {
    return [t('photo', {}, language), getMessageCaption(message)].filter(Boolean).join(' - ');
  }

  if (message.kind === 'video') {
    return [t('video', {}, language), getMessageCaption(message)].filter(Boolean).join(' - ');
  }

  return getMessagePreview(message, language);
}

export function getPinnedMessageSearchText(message: Message, language: AppLanguage) {
  return `${getPinnedMessageTitle(message, language)} ${getMessageCaption(message)}`.toLowerCase();
}

export function getPinnedStaticMapUrl(location: { latitude: number; longitude: number }) {
  const center = `${location.latitude},${location.longitude}`;
  const marker = `${location.latitude},${location.longitude},red-pushpin`;

  return `https://staticmap.openstreetmap.de/staticmap.php?center=${center}&zoom=15&size=120x120&maptype=mapnik&markers=${encodeURIComponent(marker)}`;
}

export function formatPinnedDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString([], {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });
}

// ---------------------------------------------------------------------------
// Forward target search / group member rank
// ---------------------------------------------------------------------------

export type ForwardTargetLike = {
  title: string;
  user: { displayName: string; username: string };
};

export function filterForwardTargets<T extends ForwardTargetLike>(targets: T[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length < 2) {
    return targets;
  }

  return targets.filter((target) => (
    target.title.toLowerCase().includes(normalizedQuery) ||
    target.user.displayName.toLowerCase().includes(normalizedQuery) ||
    target.user.username.toLowerCase().includes(normalizedQuery)
  ));
}

export function filterForwardTargetsByAnySearch<T extends ForwardTargetLike>(targets: T[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return targets;
  }

  return targets.filter((target) => (
    target.title.toLowerCase().includes(normalizedQuery) ||
    target.user.displayName.toLowerCase().includes(normalizedQuery) ||
    target.user.username.toLowerCase().includes(normalizedQuery)
  ));
}

export function getGroupMemberRank(userId: string, ownerId: string | null | undefined, adminIdSet: Set<string>) {
  if (userId === ownerId) {
    return 0;
  }

  if (adminIdSet.has(userId)) {
    return 1;
  }

  return 2;
}

// ---------------------------------------------------------------------------
// Links / gallery
// ---------------------------------------------------------------------------

export function extractChatLinks(messages: Message[]) {
  return messages.flatMap((message) => {
    if (!message.body) {
      return [];
    }

    const urls = message.body.match(/https?:\/\/[^\s<>)]+/gi) ?? [];

    return urls.map((rawUrl: string, index: number) => ({
      id: `${message.id}-${index}-${rawUrl}`,
      message,
      url: rawUrl.replace(/[.,!?;:]+$/, ''),
    }));
  });
}

export function getLinkHost(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatSubscriberCount(count: number, language: AppLanguage) {
  return t('groupSubscriberCount', { count }, language);
}
