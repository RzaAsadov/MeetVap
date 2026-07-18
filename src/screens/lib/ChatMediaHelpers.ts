import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { Platform, PermissionsAndroid } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { downloadRemoteMediaFile, getMessageMediaCacheUri, resolveLocalMediaFileUri, sanitizeCacheFileName } from '../../lib/mediaCache';
import { t } from '../../i18n';
import type { Message } from '../../types/domain';
import type { SharedIntentItem } from '../../types/navigation';

// ---------------------------------------------------------------------------
// MIME type resolution
// ---------------------------------------------------------------------------

export function getMimeTypeFromFileName(fileName?: string) {
  const extension = fileName?.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'apk':
      return 'application/vnd.android.package-archive';
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'zip':
      return 'application/zip';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'm4v':
      return 'video/x-m4v';
    case 'm4a':
      return 'audio/mp4';
    default:
      return undefined;
  }
}

export function getUsableMimeType(mimeType?: string | null, fileName?: string) {
  const inferredMimeType = getMimeTypeFromFileName(fileName);

  if (!mimeType || mimeType === 'application/octet-stream' || mimeType === '*/*') {
    return inferredMimeType ?? 'application/octet-stream';
  }

  return mimeType;
}

export function getMessageMimeType(message: Message) {
  return message.mimeType || getMimeTypeFromFileName(message.fileName) || (
    message.kind === 'image' ? 'image/jpeg' : message.kind === 'video' ? 'video/mp4' : message.kind === 'voice' ? 'audio/mp4' : 'application/octet-stream'
  );
}

// ---------------------------------------------------------------------------
// File naming / size helpers
// ---------------------------------------------------------------------------

export function getMessageFileName(message: Message) {
  if (message.fileName) {
    return message.fileName;
  }

  if (message.kind === 'image') {
    return `${message.id}.jpg`;
  }

  if (message.kind === 'video') {
    return `${message.id}.mp4`;
  }

  if (message.kind === 'voice') {
    return `${message.id}.m4a`;
  }

  return `${message.id}.bin`;
}

export async function getKnownFileSize(uri: string, fallbackSize?: number | null) {
  if (fallbackSize && fallbackSize > 0) {
    return fallbackSize;
  }

  const info = await FileSystem.getInfoAsync(uri).catch(() => null);

  return info?.exists && 'size' in info && info.size > 0 ? info.size : undefined;
}

export function getSharedItemFileName(uri: string) {
  const cleanUri = uri.split('?')[0];
  const rawName = cleanUri.substring(cleanUri.lastIndexOf('/') + 1);
  const decodedName = decodeURIComponent(rawName || 'shared-file');
  return decodedName || 'shared-file';
}

export function getSharedItemMessageKind(mimeType: string): 'image' | 'video' | 'file' {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  return 'file';
}

export type PendingCaptionAttachment = {
  body?: string;
  durationSeconds?: number;
  fileName: string;
  kind: 'image' | 'video' | 'file';
  mimeType: string;
  sizeBytes?: number;
  uri: string;
};

export async function getSharedPendingAttachment(item: SharedIntentItem): Promise<PendingCaptionAttachment> {
  if (item.kind !== 'file' || !item.uri) {
    throw new Error(t('sharedAttachmentUnavailable'));
  }

  const fileName = item.fileName || getSharedItemFileName(item.uri);
  const mimeType = getUsableMimeType(item.mimeType, fileName);
  const kind = getSharedItemMessageKind(mimeType);
  const sizeBytes = await getKnownFileSize(item.uri, item.sizeBytes);

  return {
    body: kind === 'file' ? fileName : undefined,
    fileName,
    kind,
    mimeType,
    sizeBytes,
    uri: item.uri,
  };
}

export async function prepareOutgoingAttachment(attachment: PendingCaptionAttachment): Promise<PendingCaptionAttachment> {
  if (Platform.OS !== 'android' || !/^content:/i.test(attachment.uri)) {
    return attachment;
  }

  const cacheRoot = FileSystem.cacheDirectory || FileSystem.documentDirectory;

  if (!cacheRoot) {
    throw new Error(t('attachmentCacheUnavailable'));
  }

  const fileName = sanitizeCacheFileName(attachment.fileName) || 'attachment';
  const uri = `${cacheRoot}outgoing-${Date.now()}-${Math.random().toString(36).slice(2)}-${fileName}`;

  await FileSystem.copyAsync({ from: attachment.uri, to: uri });

  return {
    ...attachment,
    sizeBytes: await getKnownFileSize(uri, attachment.sizeBytes),
    uri,
  };
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function ensureSaveToPhonePermission(message: Message) {
  if (Platform.OS === 'ios') {
    if (message.kind === 'file') {
      return true;
    }

    const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);
    return !!mediaPermission?.granted;
  }

  if (Platform.OS !== 'android') {
    return true;
  }

  const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);

  if (mediaPermission?.granted) {
    return true;
  }

  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    const permissions: Array<(typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS]> = [];

    if (message.kind === 'image') {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    } else if (message.kind === 'video') {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
    } else {
      permissions.push(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      );
    }

    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission as keyof typeof result] === PermissionsAndroid.RESULTS.GRANTED);
  }

  const legacyWritePermission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

  if (!legacyWritePermission) {
    return false;
  }

  const result = await PermissionsAndroid.request(legacyWritePermission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// ---------------------------------------------------------------------------
// Remote / local media URI resolution
// ---------------------------------------------------------------------------

export function getMessageRemoteMediaUri(message: Message) {
  if (message.mediaUri && /^https?:\/\//i.test(message.mediaUri)) {
    return message.mediaUri;
  }

  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'remoteMediaUri' in metadata && typeof metadata.remoteMediaUri === 'string'
    ? metadata.remoteMediaUri
    : undefined;
}

export async function getMediaActionCacheUri(message: Message) {
  return getMessageMediaCacheUri({
    fileName: getMessageFileName(message),
    kind: message.kind,
    messageId: message.id,
  });
}

export async function downloadMediaActionAttachment(message: Message) {
  const localUri = await getMediaActionCacheUri(message);
  const remoteUri = getMessageRemoteMediaUri(message) ?? message.mediaUri;

  if (!remoteUri || !/^https?:\/\//i.test(remoteUri)) {
    throw new Error(t('mediaUnavailable'));
  }

  const cachedUri = await downloadRemoteMediaFile({
    expectedSizeBytes: message.sizeBytes,
    localUri,
    messageId: message.id,
    remoteUri,
  });

  if (!cachedUri) {
    throw new Error(t('mediaDownloadIncomplete'));
  }

  return cachedUri;
}

export async function getShareableMediaUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('attachmentNotAvailableYet'));
  }

  if (Platform.OS === 'ios') {
    if (message.mediaUri.startsWith('file:')) {
      return await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;
    }

    if (/^https?:\/\//i.test(message.mediaUri)) {
      return downloadMediaActionAttachment(message);
    }

    return message.mediaUri;
  }

  if (Platform.OS !== 'android') {
    return message.mediaUri;
  }

  if (message.mediaUri.startsWith('file:')) {
    const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;

    return FileSystem.getContentUriAsync(resolvedLocalUri);
  }

  if (message.mediaUri.startsWith('content:')) {
    return message.mediaUri;
  }

  if (/^https?:\/\//i.test(message.mediaUri)) {
    const localUri = await downloadMediaActionAttachment(message);

    return FileSystem.getContentUriAsync(localUri);
  }

  return message.mediaUri;
}

export async function getPlayableVideoUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('videoNotAvailableYet'));
  }

  if (!/^https?:\/\//i.test(message.mediaUri)) {
    if (message.status !== 'sending' && /^file:/i.test(message.mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return downloadMediaActionAttachment({ ...message, mediaUri: remoteUri });
      }

      throw new Error(t('videoStillDownloadingMoment'));
    }

    return message.mediaUri;
  }

  return downloadMediaActionAttachment(message);
}

export async function getRenderableImageUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('imageNotAvailableYet'));
  }

  if (!/^https?:\/\//i.test(message.mediaUri)) {
    if (message.status !== 'sending' && /^file:/i.test(message.mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return remoteUri;
      }

      throw new Error(t('imageStillDownloadingMoment'));
    }

    return message.mediaUri;
  }

  return message.mediaUri;
}

export async function getPlayableVoiceUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('voicePlaybackTryAgain'));
  }

  if (!/^https?:\/\//i.test(message.mediaUri)) {
    if (message.status !== 'sending' && /^file:/i.test(message.mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return downloadMediaActionAttachment({ ...message, mediaUri: remoteUri });
      }

      throw new Error(t('voicePlaybackTryAgain'));
    }

    return message.mediaUri;
  }

  return downloadMediaActionAttachment(message);
}

// ---------------------------------------------------------------------------
// Recorder / audio helpers (no hooks — plain status checks)
// ---------------------------------------------------------------------------

export async function stopRecorderIfNeeded(recorder: { getStatus: () => { canRecord: boolean; isRecording: boolean }; stop: () => Promise<void> }) {
  try {
    const status = getRecorderStatusSafely(recorder);

    if (!status) {
      return;
    }

    if (status.isRecording || status.canRecord) {
      await recorder.stop();
    }
  } catch {
    // The native recorder can already be stopped or invalidated during fast remounts.
  }
}

export function getRecorderStatusSafely(recorder: { getStatus: () => { canRecord: boolean; isRecording: boolean } }) {
  try {
    return recorder.getStatus();
  } catch {
    return null;
  }
}

export function isReleasedRecorderError(error: unknown) {
  return error instanceof Error && (
    error.message.includes('already released') ||
    error.message.includes('AudioRecorder.getStatus') ||
    error.message.includes('cannot be cast to type expo.modules.audio.AudioRecorder')
  );
}

export function getRecordingDurationSeconds(durationMillis: number, startedAt: number | null) {
  if (durationMillis > 0) {
    return durationMillis / 1000;
  }

  return startedAt ? (Date.now() - startedAt) / 1000 : 0;
}

export async function waitForRecordedFile(uri: string) {
  let lastInfo = await FileSystem.getInfoAsync(uri);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const size = lastInfo.exists && 'size' in lastInfo ? lastInfo.size : 0;

    if (size > 0) {
      return lastInfo;
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
    lastInfo = await FileSystem.getInfoAsync(uri);
  }

  return lastInfo;
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export async function getLocationAddress(coords: Location.LocationObjectCoords) {
  try {
    const [address] = await Location.reverseGeocodeAsync({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });

    if (!address) {
      return undefined;
    }

    return [
      address.name,
      address.street,
      address.city || address.subregion,
      address.region,
      address.country,
    ].filter(Boolean).join(', ');
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Misc voice/gallery labels
// ---------------------------------------------------------------------------

export function getVoiceRoomAudioRouteLabel(routeId: string) {
  const normalized = routeId.toLowerCase();

  if (normalized.includes('bluetooth')) {
    return t('bluetooth');
  }

  if (normalized.includes('headset') || normalized.includes('wired')) {
    return t('wiredHeadset');
  }

  if (normalized.includes('earpiece')) {
    return t('phoneEarpiece');
  }

  return t('speaker');
}

export function formatVoiceComposerEffectLabel(effectId: 'normal' | 'deep' | 'bright' | 'helium') {
  switch (effectId) {
    case 'deep':
      return t('voiceEffectDeep');
    case 'bright':
      return t('voiceEffectBright');
    case 'helium':
      return t('voiceEffectHelium');
    default:
      return t('voiceEffectNormal');
  }
}

export function isShareableMediaMessage(message: Message) {
  return ['file', 'image', 'video'].includes(message.kind) && !!message.mediaUri;
}

export function isViewableImageMessage(message: Message) {
  return message.kind === 'image' && !!message.mediaUri;
}

export function createMessageDeleteKey() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';

  for (let index = 0; index < 16; index += 1) {
    value += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return value;
}

export function getMessageDeleteKey(message?: Message | null) {
  const metadata = message?.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : undefined;
}

export function shouldRemovePinnedMessageForDeletion(message: Message, messageIds: string[], messageKeys: string[]) {
  const deleteKey = getMessageDeleteKey(message);

  return messageIds.includes(message.id) || (!!deleteKey && messageKeys.includes(deleteKey));
}

export function getInitialUploadProgress(message: Message) {
  if (message.status !== 'sending' || message.kind === 'text' || !message.sizeBytes) {
    return undefined;
  }

  return { sentBytes: 0, totalBytes: message.sizeBytes };
}

export function getMessageRenderKey(message: Message) {
  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'clientId' in metadata && typeof metadata.clientId === 'string'
    ? metadata.clientId
    : message.id;
}
