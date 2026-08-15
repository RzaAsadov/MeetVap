import type { Message } from '../types/domain';

export function getMessageVideoThumbnailUri(message: Pick<Message, 'metadata'>) {
  const value = message.metadata && 'videoThumbnailUri' in message.metadata
    ? message.metadata.videoThumbnailUri
    : undefined;

  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null;
}
