import * as FileSystem from 'expo-file-system/legacy';
import * as VideoThumbnails from 'expo-video-thumbnails';

import { getMediaDownloadRecord, listPendingMediaDownloads, removeMediaDownloadRecord, saveMediaDownloadRecord } from './messageStore';

const MAX_CONCURRENT_MEDIA_DOWNLOADS = 2;
const CHUNK_SIZE_BYTES = 1024 * 1024;
const CHUNKED_DOWNLOAD_THRESHOLD_BYTES = 2 * 1024 * 1024;
const PROGRESS_PERSIST_INTERVAL_MS = 900;
const PROGRESS_PERSIST_BYTES = 1024 * 1024;
const DOCUMENT_MEDIA_DIRECTORY_NAME = 'messenger-media';
const VIDEO_THUMBNAIL_DIRECTORY_NAME = 'messenger-media-thumbs';

type DownloadTask = ReturnType<typeof FileSystem.createDownloadResumable>;
type FileInfo = Awaited<ReturnType<typeof FileSystem.getInfoAsync>>;

const activeDownloads = new Map<string, Promise<string | null>>();
const activeDownloadTasks = new Map<string, DownloadTask>();
const activeThumbnailRequests = new Map<string, Promise<string | null>>();
const rememberedThumbnailUris = new Map<string, string>();
const downloadQueue: (() => void)[] = [];
const progressListeners = new Set<(progress: MediaDownloadProgress) => void>();
const progressByMessageId = new Map<string, MediaDownloadProgress>();
const canceledMessageIds = new Set<string>();
const pausedMessageIds = new Set<string>();
const resumeRequestedMessageIds = new Set<string>();
let activeDownloadCount = 0;

export type MediaDownloadProgress = {
  downloadedBytes: number;
  messageId: string;
  status: 'downloading' | 'paused' | 'complete';
  totalBytes: number;
};

export function sanitizeCacheFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function getMessageMediaCacheUri(input: {
  fileName?: string | null;
  kind?: string | null;
  messageId: string;
}) {
  const mediaDirectory = getDocumentMediaCacheDirectory();
  await FileSystem.makeDirectoryAsync(mediaDirectory, { intermediates: true }).catch(() => undefined);

  return `${mediaDirectory}/${getMessageMediaCacheFileName(input)}`;
}

export async function resolveCachedMessageMediaUri(input: {
  expectedSizeBytes?: number | null;
  fileName?: string | null;
  kind?: string | null;
  messageId: string;
}) {
  const canonicalUri = await getMessageMediaCacheUri(input);

  if (await isLocalMediaFileComplete(canonicalUri, input.expectedSizeBytes)) {
    return canonicalUri;
  }

  for (const candidateUri of getLegacyMessageMediaCacheUris(input)) {
    if (candidateUri === canonicalUri || !(await isLocalMediaFileComplete(candidateUri, input.expectedSizeBytes))) {
      continue;
    }

    await FileSystem.deleteAsync(canonicalUri, { idempotent: true }).catch(() => undefined);
    await FileSystem.copyAsync({ from: candidateUri, to: canonicalUri }).catch(() => undefined);

    if (await isLocalMediaFileComplete(canonicalUri, input.expectedSizeBytes)) {
      return canonicalUri;
    }

    return candidateUri;
  }

  return null;
}

export async function getCachedVideoThumbnailUri(input: {
  messageId: string;
  quality?: number;
  sourceSizeBytes?: number | null;
  sourceUri: string;
  timeMs?: number;
}) {
  const requestKey = getVideoThumbnailRequestKey(input);
  const rememberedUri = rememberedThumbnailUris.get(requestKey);

  if (rememberedUri) {
    return rememberedUri;
  }

  const cacheUri = await getVideoThumbnailCacheUri(input);

  if (await isLocalMediaFileComplete(cacheUri)) {
    rememberedThumbnailUris.set(requestKey, cacheUri);
    return cacheUri;
  }

  const activeRequest = activeThumbnailRequests.get(requestKey);

  if (activeRequest) {
    return activeRequest;
  }

  const request = generateCachedVideoThumbnail(input, cacheUri).finally(() => {
    activeThumbnailRequests.delete(requestKey);
  });
  activeThumbnailRequests.set(requestKey, request);

  return request;
}

export function getRememberedCachedVideoThumbnailUri(input: {
  messageId: string;
  quality?: number;
  sourceSizeBytes?: number | null;
  sourceUri?: string | null;
  timeMs?: number;
}) {
  if (!input.sourceUri) {
    return null;
  }

  return rememberedThumbnailUris.get(getVideoThumbnailRequestKey({ ...input, sourceUri: input.sourceUri })) ?? null;
}

export async function isLocalMediaFileComplete(uri?: string | null, expectedSizeBytes?: number | null) {
  if (!uri) {
    return false;
  }

  try {
    return isCompleteFileInfo(await FileSystem.getInfoAsync(uri), expectedSizeBytes);
  } catch {
    return false;
  }
}

export async function resolveLocalMediaFileUri(uri?: string | null, expectedSizeBytes?: number | null) {
  if (!uri || /^https?:\/\//i.test(uri)) {
    return null;
  }

  if (await isLocalMediaFileComplete(uri, expectedSizeBytes)) {
    return uri;
  }

  const rebasedUri = getRebasedDocumentMediaUri(uri);

  if (rebasedUri && rebasedUri !== uri && await isLocalMediaFileComplete(rebasedUri, expectedSizeBytes)) {
    return rebasedUri;
  }

  return null;
}

export async function downloadRemoteMediaFile(input: {
  expectedSizeBytes?: number | null;
  localUri: string;
  messageId?: string;
  priority?: 'high' | 'normal';
  remoteUri: string;
}) {
  if (input.messageId) {
    resumeMediaDownload(input.messageId);
  }

  const key = `${input.remoteUri}|${input.expectedSizeBytes ?? 0}`;
  const existingDownload = activeDownloads.get(key);

  if (existingDownload) {
    const shouldRestartAfterPause = input.messageId ? resumeRequestedMessageIds.has(input.messageId) : false;
    const result = await existingDownload;

    if (!result && input.messageId && shouldRestartAfterPause && !pausedMessageIds.has(input.messageId)) {
      resumeRequestedMessageIds.delete(input.messageId);
      return downloadRemoteMediaFile(input);
    }

    if (input.messageId) {
      resumeRequestedMessageIds.delete(input.messageId);
    }

    return result;
  }

  if (input.messageId) {
    resumeRequestedMessageIds.delete(input.messageId);
  }

  const downloadPromise = runWithDownloadSlot(() => performVerifiedDownload(input), input.priority).finally(() => {
    activeDownloads.delete(key);
  });
  activeDownloads.set(key, downloadPromise);

  return downloadPromise;
}

export function subscribeToMediaDownloadProgress(listener: (progress: MediaDownloadProgress) => void) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

export function getMediaDownloadProgress(messageId: string) {
  return progressByMessageId.get(messageId) ?? null;
}

export function pauseMediaDownload(messageId: string) {
  pausedMessageIds.add(messageId);
  resumeRequestedMessageIds.delete(messageId);
  const activeTask = activeDownloadTasks.get(messageId);

  if (activeTask) {
    void activeTask.pauseAsync().catch(() => undefined);
  }

  const progress = progressByMessageId.get(messageId);

  if (progress && progress.status !== 'complete') {
    emitProgress({ ...progress, status: 'paused' });
  }
}

export function resumeMediaDownload(messageId: string) {
  pausedMessageIds.delete(messageId);
  const progress = progressByMessageId.get(messageId);

  if (progress?.status === 'paused') {
    resumeRequestedMessageIds.add(messageId);
    emitProgress({ ...progress, status: 'downloading' });
  }
}

export async function removePartialMediaDownloadsForMessages(messageIds: string[]) {
  const ids = new Set(messageIds);
  messageIds.forEach((messageId) => canceledMessageIds.add(messageId));
  const records = await listPendingMediaDownloads().catch(() => []);
  await Promise.allSettled(records
    .filter((record) => ids.has(record.messageId))
    .map(async (record) => {
      await FileSystem.deleteAsync(`${record.localUri}.part`, { idempotent: true }).catch(() => undefined);
      await removeMediaDownloadRecord(record.localUri);
      progressByMessageId.delete(record.messageId);
    }));
}

async function performVerifiedDownload({
  expectedSizeBytes,
  localUri,
  messageId = localUri,
  remoteUri,
}: {
  expectedSizeBytes?: number | null;
  localUri: string;
  messageId?: string;
  remoteUri: string;
}) {
  const finalInfo = await FileSystem.getInfoAsync(localUri).catch(() => null);

  if (finalInfo && isCompleteFileInfo(finalInfo, expectedSizeBytes)) {
    const sizeBytes = expectedSizeBytes ?? getFileInfoSize(finalInfo);
    emitProgress({ downloadedBytes: sizeBytes, messageId, status: 'complete', totalBytes: sizeBytes });
    return localUri;
  }

  if (finalInfo?.exists) {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => undefined);
  }

  const nativeDownloadResult = await performNativeDownload({ expectedSizeBytes, localUri, messageId, remoteUri });

  if (nativeDownloadResult) {
    return nativeDownloadResult;
  }

  if (expectedSizeBytes && expectedSizeBytes > CHUNKED_DOWNLOAD_THRESHOLD_BYTES) {
    return performChunkedDownload({ expectedSizeBytes, localUri, messageId, remoteUri });
  }

  return null;
}

async function performNativeDownload({
  expectedSizeBytes,
  localUri,
  messageId,
  remoteUri,
}: {
  expectedSizeBytes?: number | null;
  localUri: string;
  messageId: string;
  remoteUri: string;
}) {
  const tempUri = `${localUri}.download-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  const progressWriter = createProgressWriter({ expectedSizeBytes, localUri, messageId, remoteUri });

  await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
  await progressWriter.write(0, 'downloading', true);

  try {
    const downloadTask = FileSystem.createDownloadResumable(
      remoteUri,
      tempUri,
      {},
      (progress) => {
        const totalBytes = getExpectedDownloadSize(progress.totalBytesExpectedToWrite, expectedSizeBytes);
        void progressWriter.write(Math.min(progress.totalBytesWritten, totalBytes), 'downloading');
      },
    );
    activeDownloadTasks.set(messageId, downloadTask);
    const result = await downloadTask.downloadAsync().finally(() => {
      if (activeDownloadTasks.get(messageId) === downloadTask) {
        activeDownloadTasks.delete(messageId);
      }
    });

    if (!result) {
      throw new Error('Media download was cancelled.');
    }

    if (typeof result.status === 'number' && (result.status < 200 || result.status >= 300)) {
      throw new Error(`Media download failed with status ${result.status}`);
    }

    const tempInfo = await FileSystem.getInfoAsync(tempUri);

    if (!isCompleteFileInfo(tempInfo, expectedSizeBytes)) {
      throw new Error('Media download finished before the full file was saved.');
    }

    if (canceledMessageIds.has(messageId)) {
      await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
      await removeMediaDownloadRecord(localUri).catch(() => undefined);
      return null;
    }

    await FileSystem.moveAsync({ from: tempUri, to: localUri });

    const movedInfo = await FileSystem.getInfoAsync(localUri);
    if (!isCompleteFileInfo(movedInfo, expectedSizeBytes)) {
      throw new Error('Media download moved before the full file was saved.');
    }

    await progressWriter.flush();
    await removeMediaDownloadRecord(localUri).catch(() => undefined);
    const sizeBytes = expectedSizeBytes ?? getFileInfoSize(movedInfo);
    emitProgress({ downloadedBytes: sizeBytes, messageId, status: 'complete', totalBytes: sizeBytes });
    return localUri;
  } catch {
    await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
    await progressWriter.write(0, 'paused', true);
    return null;
  }
}

async function performChunkedDownload({
  expectedSizeBytes,
  localUri,
  messageId,
  remoteUri,
}: {
  expectedSizeBytes: number;
  localUri: string;
  messageId: string;
  remoteUri: string;
}) {
  const partialUri = `${localUri}.part`;
  const storedRecord = await getMediaDownloadRecord(localUri).catch(() => null);
  const partialInfo = await FileSystem.getInfoAsync(partialUri).catch(() => null);
  let downloadedBytes = partialInfo?.exists && typeof partialInfo.size === 'number' ? partialInfo.size : 0;
  const canResumeStoredDownload = storedRecord?.remoteUri === remoteUri &&
    storedRecord.expectedSizeBytes === expectedSizeBytes &&
    downloadedBytes === storedRecord.downloadedBytes &&
    downloadedBytes <= expectedSizeBytes;

  if (!canResumeStoredDownload && downloadedBytes > 0) {
    await FileSystem.deleteAsync(partialUri, { idempotent: true }).catch(() => undefined);
    downloadedBytes = 0;
  }

  await persistAndEmitProgress({ downloadedBytes, expectedSizeBytes, localUri, messageId, remoteUri, status: 'downloading' });

  try {
    while (downloadedBytes < expectedSizeBytes) {
      if (pausedMessageIds.has(messageId)) {
        await persistAndEmitProgress({ downloadedBytes, expectedSizeBytes, localUri, messageId, remoteUri, status: 'paused' });
        return null;
      }

      if (canceledMessageIds.has(messageId)) {
        await removePartialDownload(localUri, partialUri);
        return null;
      }

      const endByte = Math.min(downloadedBytes + CHUNK_SIZE_BYTES, expectedSizeBytes) - 1;
      const chunkUri = `${partialUri}.${downloadedBytes}-${endByte}.tmp`;
      const expectedChunkBytes = endByte - downloadedBytes + 1;

      await FileSystem.deleteAsync(chunkUri, { idempotent: true }).catch(() => undefined);

      try {
        const downloadTask = FileSystem.createDownloadResumable(remoteUri, chunkUri, {
          headers: { Range: `bytes=${downloadedBytes}-${endByte}` },
        });
        activeDownloadTasks.set(messageId, downloadTask);
        const result = await downloadTask.downloadAsync().finally(() => {
          if (activeDownloadTasks.get(messageId) === downloadTask) {
            activeDownloadTasks.delete(messageId);
          }
        });

        if (pausedMessageIds.has(messageId)) {
          await persistAndEmitProgress({ downloadedBytes, expectedSizeBytes, localUri, messageId, remoteUri, status: 'paused' });
          return null;
        }

        if (!result) {
          throw new Error('Media range download was cancelled.');
        }

        if (result.status !== 206) {
          throw new Error(`Media range download failed with status ${result.status}`);
        }

        const chunkInfo = await FileSystem.getInfoAsync(chunkUri);
        const chunkSize = chunkInfo.exists && typeof chunkInfo.size === 'number' ? chunkInfo.size : 0;

        if (chunkSize !== expectedChunkBytes) {
          throw new Error('Media range download returned an unexpected byte count.');
        }

        if (canceledMessageIds.has(messageId)) {
          await removePartialDownload(localUri, partialUri);
          return null;
        }

        const chunkBase64 = await FileSystem.readAsStringAsync(chunkUri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(partialUri, chunkBase64, {
          append: downloadedBytes > 0,
          encoding: FileSystem.EncodingType.Base64,
        });
        downloadedBytes += chunkSize;
        const nextStatus = pausedMessageIds.has(messageId) ? 'paused' : 'downloading';
        await persistAndEmitProgress({ downloadedBytes, expectedSizeBytes, localUri, messageId, remoteUri, status: nextStatus });

        if (nextStatus === 'paused') {
          return null;
        }
      } finally {
        await FileSystem.deleteAsync(chunkUri, { idempotent: true }).catch(() => undefined);
      }
    }

    const partialFileInfo = await FileSystem.getInfoAsync(partialUri);

    if (!isCompleteFileInfo(partialFileInfo, expectedSizeBytes)) {
      throw new Error('Media download finished before the full file was saved.');
    }

    if (canceledMessageIds.has(messageId)) {
      await removePartialDownload(localUri, partialUri);
      return null;
    }

    await FileSystem.moveAsync({ from: partialUri, to: localUri });
    await removeMediaDownloadRecord(localUri).catch(() => undefined);
    emitProgress({ downloadedBytes: expectedSizeBytes, messageId, status: 'complete', totalBytes: expectedSizeBytes });
    return localUri;
  } catch {
    await persistAndEmitProgress({ downloadedBytes, expectedSizeBytes, localUri, messageId, remoteUri, status: 'paused' });
    return null;
  }
}

async function removePartialDownload(localUri: string, partialUri: string) {
  await FileSystem.deleteAsync(partialUri, { idempotent: true }).catch(() => undefined);
  await removeMediaDownloadRecord(localUri).catch(() => undefined);
}

async function persistAndEmitProgress({
  downloadedBytes,
  expectedSizeBytes,
  localUri,
  messageId,
  remoteUri,
  status,
}: {
  downloadedBytes: number;
  expectedSizeBytes: number;
  localUri: string;
  messageId: string;
  remoteUri: string;
  status: 'downloading' | 'paused';
}) {
  await saveMediaDownloadRecord({
    downloadedBytes,
    expectedSizeBytes,
    localUri,
    messageId,
    remoteUri,
    status,
  });
  emitProgress({ downloadedBytes, messageId, status, totalBytes: expectedSizeBytes });
}

function createProgressWriter({
  expectedSizeBytes,
  localUri,
  messageId,
  remoteUri,
}: {
  expectedSizeBytes?: number | null;
  localUri: string;
  messageId: string;
  remoteUri: string;
}) {
  let lastPersistedAt = 0;
  let lastPersistedBytes = -1;
  let pendingWrite: Promise<void> = Promise.resolve();

  const write = (downloadedBytes: number, status: 'downloading' | 'paused', force = false) => {
    const totalBytes = getExpectedDownloadSize(expectedSizeBytes, downloadedBytes);
    const now = Date.now();
    const shouldPersist = force ||
      status === 'paused' ||
      downloadedBytes === 0 ||
      (!!expectedSizeBytes && expectedSizeBytes > 0 && downloadedBytes >= totalBytes) ||
      now - lastPersistedAt >= PROGRESS_PERSIST_INTERVAL_MS ||
      Math.abs(downloadedBytes - lastPersistedBytes) >= PROGRESS_PERSIST_BYTES;

    if (!shouldPersist) {
      return pendingWrite;
    }

    lastPersistedAt = now;
    lastPersistedBytes = downloadedBytes;
    pendingWrite = pendingWrite
      .catch(() => undefined)
      .then(() => persistAndEmitProgress({
        downloadedBytes,
        expectedSizeBytes: totalBytes,
        localUri,
        messageId,
        remoteUri,
        status,
      }));

    return pendingWrite;
  };

  return {
    flush: () => pendingWrite.catch(() => undefined),
    write,
  };
}

function getExpectedDownloadSize(nativeExpectedBytes?: number | null, fallbackBytes?: number | null) {
  if (nativeExpectedBytes && nativeExpectedBytes > 0) {
    return nativeExpectedBytes;
  }

  if (fallbackBytes && fallbackBytes > 0) {
    return fallbackBytes;
  }

  return 1;
}

function emitProgress(progress: MediaDownloadProgress) {
  if (progress.status === 'complete') {
    progressByMessageId.delete(progress.messageId);
  } else {
    progressByMessageId.set(progress.messageId, progress);
  }

  progressListeners.forEach((listener) => listener(progress));
}

async function runWithDownloadSlot<T>(task: () => Promise<T>, priority: 'high' | 'normal' = 'normal') {
  if (activeDownloadCount >= MAX_CONCURRENT_MEDIA_DOWNLOADS) {
    await new Promise<void>((resolve) => {
      if (priority === 'high') {
        downloadQueue.unshift(resolve);
      } else {
        downloadQueue.push(resolve);
      }
    });
  }

  activeDownloadCount += 1;

  try {
    return await task();
  } finally {
    activeDownloadCount = Math.max(0, activeDownloadCount - 1);
    downloadQueue.shift()?.();
  }
}

function getRebasedDocumentMediaUri(uri: string) {
  if (!FileSystem.documentDirectory || !/^file:/i.test(uri)) {
    return null;
  }

  const marker = '/messenger-media/';
  const markerIndex = uri.indexOf(marker);

  if (markerIndex < 0) {
    return null;
  }

  const relativeMediaPath = uri.slice(markerIndex + marker.length);

  return relativeMediaPath ? `${FileSystem.documentDirectory}${DOCUMENT_MEDIA_DIRECTORY_NAME}/${relativeMediaPath}` : null;
}

function getDocumentMediaCacheDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error('Document directory is unavailable');
  }

  return `${FileSystem.documentDirectory}${DOCUMENT_MEDIA_DIRECTORY_NAME}`;
}

function getDocumentVideoThumbnailCacheDirectory() {
  if (!FileSystem.documentDirectory) {
    throw new Error('Document directory is unavailable');
  }

  return `${FileSystem.documentDirectory}${VIDEO_THUMBNAIL_DIRECTORY_NAME}`;
}

async function getVideoThumbnailCacheUri(input: {
  messageId: string;
  quality?: number;
  sourceSizeBytes?: number | null;
  sourceUri: string;
  timeMs?: number;
}) {
  const directory = getDocumentVideoThumbnailCacheDirectory();
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);

  const key = hashString(getVideoThumbnailRequestKey(input));
  return `${directory}/${sanitizeCacheFileName(input.messageId)}-${key}.jpg`;
}

function getVideoThumbnailRequestKey(input: {
  messageId: string;
  quality?: number;
  sourceSizeBytes?: number | null;
  sourceUri: string;
  timeMs?: number;
}) {
  return `${input.messageId}|${input.sourceUri}|${input.sourceSizeBytes ?? 0}|${input.timeMs ?? 0}|${input.quality ?? 0}`;
}

async function generateCachedVideoThumbnail(input: {
  messageId: string;
  quality?: number;
  sourceSizeBytes?: number | null;
  sourceUri: string;
  timeMs?: number;
}, cacheUri: string) {
  if (!/^https?:\/\//i.test(input.sourceUri) && !(await isLocalMediaFileComplete(input.sourceUri, input.sourceSizeBytes))) {
    return null;
  }

  const thumbnail = await VideoThumbnails.getThumbnailAsync(input.sourceUri, {
    quality: input.quality,
    time: input.timeMs ?? 350,
  });

  await FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => undefined);
  await FileSystem.copyAsync({ from: thumbnail.uri, to: cacheUri }).catch(() => undefined);

  if (await isLocalMediaFileComplete(cacheUri)) {
    rememberedThumbnailUris.set(getVideoThumbnailRequestKey(input), cacheUri);
    return cacheUri;
  }

  return thumbnail.uri;
}

function getMessageMediaCacheFileName({
  fileName,
  kind,
  messageId,
}: {
  fileName?: string | null;
  kind?: string | null;
  messageId: string;
}) {
  return `${messageId}-${sanitizeCacheFileName(fileName || getDefaultMediaFileName(messageId, kind))}`;
}

function getLegacyMessageMediaCacheUris(input: {
  fileName?: string | null;
  kind?: string | null;
  messageId: string;
}) {
  const names = new Set([
    getMessageMediaCacheFileName(input),
    `${input.messageId}-${sanitizeCacheFileName(input.fileName || input.kind || `${input.messageId}.bin`)}`,
    `${input.messageId}-${sanitizeCacheFileName(input.fileName || `${input.messageId}.bin`)}`,
  ]);
  const directories = [FileSystem.cacheDirectory, FileSystem.documentDirectory].filter((directory): directory is string => !!directory);
  const uris: string[] = [];

  directories.forEach((directory) => {
    names.forEach((name) => {
      uris.push(`${directory}${name}`);
    });
  });

  return uris;
}

function getDefaultMediaFileName(messageId: string, kind?: string | null) {
  if (kind === 'image') {
    return `${messageId}.jpg`;
  }

  if (kind === 'video') {
    return `${messageId}.mp4`;
  }

  if (kind === 'voice') {
    return `${messageId}.m4a`;
  }

  return `${messageId}.bin`;
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function isCompleteFileInfo(info: FileInfo, expectedSizeBytes?: number | null) {
  if (!info.exists) {
    return false;
  }

  const size = getFileInfoSize(info);

  if (expectedSizeBytes && expectedSizeBytes > 0) {
    return size === expectedSizeBytes;
  }

  return size > 0;
}

function getFileInfoSize(info: FileInfo) {
  return 'size' in info && typeof info.size === 'number' ? info.size : 0;
}
