import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { config } from './config';

const execFileAsync = promisify(execFile);
const uploadDir = path.resolve(config.UPLOAD_DIR);
const thumbnailDir = path.resolve(uploadDir, '.video-thumbnails');
const ffmpegPath = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
const activeThumbnailRequests = new Map<string, Promise<string>>();
const failedThumbnailAttempts = new Map<string, number>();
const THUMBNAIL_RETRY_DELAY_MS = 60_000;

export type VideoThumbnailMedia = {
  id: string;
  mimeType: string;
  storageKey: string;
};

export function isVideoMedia(media: Pick<VideoThumbnailMedia, 'mimeType'>) {
  return media.mimeType.toLowerCase().startsWith('video/');
}

export function getVideoThumbnailPublicPath(media: Pick<VideoThumbnailMedia, 'id' | 'mimeType'>) {
  return isVideoMedia(media) ? `/media/${media.id}/thumbnail` : null;
}

export async function ensureVideoThumbnail(media: VideoThumbnailMedia) {
  if (!isVideoMedia(media)) {
    throw new Error('Media is not a video');
  }

  const thumbnailPath = getVideoThumbnailFilePath(media.id);

  if (await isReadableFile(thumbnailPath)) {
    return thumbnailPath;
  }

  const lastFailureAt = failedThumbnailAttempts.get(media.id) ?? 0;

  if (Date.now() - lastFailureAt < THUMBNAIL_RETRY_DELAY_MS) {
    throw new Error('Video thumbnail generation is temporarily unavailable');
  }

  const activeRequest = activeThumbnailRequests.get(media.id);

  if (activeRequest) {
    return activeRequest;
  }

  const request = generateVideoThumbnail(media, thumbnailPath)
    .catch((error) => {
      failedThumbnailAttempts.set(media.id, Date.now());
      throw error;
    })
    .finally(() => {
      activeThumbnailRequests.delete(media.id);
    });

  activeThumbnailRequests.set(media.id, request);
  return request;
}

export async function removeVideoThumbnail(mediaId: string) {
  activeThumbnailRequests.delete(mediaId);
  failedThumbnailAttempts.delete(mediaId);
  await fs.rm(getVideoThumbnailFilePath(mediaId), { force: true }).catch(() => undefined);
}

async function generateVideoThumbnail(media: VideoThumbnailMedia, thumbnailPath: string) {
  const sourcePath = path.resolve(uploadDir, media.storageKey);

  assertInsideDirectory(sourcePath, uploadDir);
  assertInsideDirectory(thumbnailPath, thumbnailDir);
  await fs.access(sourcePath);
  await fs.mkdir(thumbnailDir, { recursive: true });

  const temporaryPath = `${thumbnailPath}.${process.pid}-${Date.now()}.tmp.jpg`;

  try {
    await execFileAsync(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', sourcePath,
      '-an',
      '-sn',
      '-vf', "thumbnail=30,scale='min(640,iw)':-2",
      '-frames:v', '1',
      '-q:v', '4',
      temporaryPath,
    ], {
      maxBuffer: 1024 * 1024,
      timeout: 45_000,
    });

    if (!await isReadableFile(temporaryPath)) {
      throw new Error('FFmpeg did not create a video thumbnail');
    }

    await fs.rename(temporaryPath, thumbnailPath);
    failedThumbnailAttempts.delete(media.id);
    return thumbnailPath;
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function getVideoThumbnailFilePath(mediaId: string) {
  const safeId = mediaId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.resolve(thumbnailDir, `${safeId}.jpg`);
}

async function isReadableFile(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

function assertInsideDirectory(filePath: string, directory: string) {
  if (!filePath.startsWith(`${directory}${path.sep}`)) {
    throw new Error('Invalid media storage path');
  }
}
