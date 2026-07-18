import { Router } from 'express';
import { createReadStream, createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import { getAuthedUser, requireAuth } from '../auth';
import { config } from '../config';
import { HttpError } from '../httpError';
import { prisma } from '../prisma';
import { registerMediaSchema, uploadMediaSchema } from '../validators';
import { operationalConfig } from '../operationalConfig';
import { enforceRateLimit } from '../rateLimits';

export const mediaRoutes = Router();
const uploadDir = path.resolve(config.UPLOAD_DIR);
const MAX_DIRECT_UPLOAD_BYTES = operationalConfig.uploads.maxDirectUploadBytes;
const MAX_CHUNKED_UPLOAD_BYTES = operationalConfig.uploads.maxAttachmentBytes;
// LEGACY_UPLOAD_COMPAT: old mobile builds upload resumable chunks as 1 MB Base64 JSON.
// Keep this lower bound until legacy upload support is intentionally removed.
const LEGACY_MIN_CHUNK_BYTES = 1024 * 1024;

mediaRoutes.get('/:mediaId/file', async (req, res, next) => {
  try {
    const media = await prisma.mediaFile.findUnique({
      where: { id: req.params.mediaId },
    });

    if (!media) {
      throw new HttpError(404, 'Media not found');
    }

    const filePath = path.resolve(uploadDir, media.storageKey);

    if (!filePath.startsWith(`${uploadDir}${path.sep}`)) {
      throw new HttpError(404, 'Media not found');
    }

    res.type(media.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    await fs.access(filePath);
    const fileStats = await fs.stat(filePath);
    res.setHeader('Accept-Ranges', 'bytes');

    if (req.headers.range) {
      const range = parseByteRange(req.headers.range, fileStats.size);

      res.status(206);
      res.setHeader('Content-Length', range.end - range.start + 1);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${fileStats.size}`);
      createReadStream(filePath, range).on('error', next).pipe(res);
      return;
    }

    res.sendFile(filePath, (error) => {
      if (error) {
        if (res.headersSent && isClientDisconnectError(error)) {
          return;
        }

        next(toMediaFileError(error));
      }
    });
  } catch (error) {
    next(toMediaFileError(error));
  }
});

function parseByteRange(header: string, fileSize: number) {
  const match = /^bytes=(\d+)-(\d+)?$/.exec(header.trim());

  if (!match) {
    throw new HttpError(416, 'Invalid media range');
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  const end = Math.min(requestedEnd, fileSize - 1);

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileSize) {
    throw new HttpError(416, 'Invalid media range');
  }

  return { end, start };
}

mediaRoutes.use(requireAuth);

mediaRoutes.get('/uploads/:uploadId/status', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const uploadId = sanitizeUploadId(req.params.uploadId);
    const session = await readChunkSession(currentUser.id, uploadId);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.json({
      completedChunks: session ? await getCompletedChunkIndexes(currentUser.id, uploadId) : [],
      uploadId,
    });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post('/uploads/:uploadId/chunks/:chunkIndex', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const uploadId = sanitizeUploadId(req.params.uploadId);
    const chunkIndex = Number(req.params.chunkIndex);
    const input = req.body as {
      chunkBase64?: string;
      chunkSize?: number;
      durationSec?: number;
      mimeType?: string;
      originalName?: string;
      sizeBytes?: number;
      totalChunks?: number;
    };

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new HttpError(400, 'Invalid chunk index');
    }

    if (!input.chunkBase64 || !input.mimeType || !input.originalName || !input.sizeBytes || !input.totalChunks) {
      throw new HttpError(400, 'Invalid upload chunk');
    }

    if (!Number.isInteger(input.totalChunks) || input.totalChunks < 1 || input.totalChunks > Math.ceil(MAX_CHUNKED_UPLOAD_BYTES / LEGACY_MIN_CHUNK_BYTES)) {
      throw new HttpError(400, 'Invalid chunk count');
    }

    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_CHUNKED_UPLOAD_BYTES) {
      throw new HttpError(400, 'Invalid media file');
    }

    if (chunkIndex >= input.totalChunks) {
      throw new HttpError(400, 'Invalid chunk index');
    }

    await assertWithinConcurrentUploadLimit(currentUser.id, uploadId, input.sizeBytes);
    const chunkData = Buffer.from(input.chunkBase64, 'base64');

    if (chunkData.length === 0 || chunkData.length > operationalConfig.uploads.maxChunkBytes || (input.chunkSize && chunkData.length !== input.chunkSize)) {
      throw new HttpError(400, 'Invalid chunk data');
    }

    const sessionDir = getChunkSessionDir(currentUser.id, uploadId);
    const chunkPath = getChunkPath(currentUser.id, uploadId, chunkIndex);

    await ensureInsideUploadDir(sessionDir);
    await fs.mkdir(sessionDir, { recursive: true });
    await writeChunkSession(currentUser.id, uploadId, {
      durationSec: input.durationSec,
      mimeType: input.mimeType,
      originalName: input.originalName,
      sizeBytes: input.sizeBytes,
      totalChunks: input.totalChunks,
    });
    await fs.writeFile(chunkPath, chunkData);

    res.json({
      completedChunks: await getCompletedChunkIndexes(currentUser.id, uploadId),
      ok: true,
    });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post('/uploads/:uploadId/complete', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const uploadId = sanitizeUploadId(req.params.uploadId);
    const session = await readChunkSession(currentUser.id, uploadId);
    await enforceRateLimit(currentUser.id, 'media-upload', operationalConfig.rateLimits.uploadsPerMinute);

    if (!session) {
      throw new HttpError(404, 'Upload not found');
    }

    const completedChunks = await getCompletedChunkIndexes(currentUser.id, uploadId);

    if (completedChunks.length !== session.totalChunks) {
      throw new HttpError(409, 'Upload is incomplete');
    }

    const extension = getExtension(session.originalName, session.mimeType);
    const storageKey = `${currentUser.id}/${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.resolve(uploadDir, storageKey);

    await ensureInsideUploadDir(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const fileHandle = await fs.open(filePath, 'w');
    let writtenBytes = 0;

    try {
      for (let index = 0; index < session.totalChunks; index += 1) {
        const chunkData = await fs.readFile(getChunkPath(currentUser.id, uploadId, index));
        writtenBytes += chunkData.length;
        await fileHandle.write(chunkData);
      }
    } finally {
      await fileHandle.close();
    }

    if (writtenBytes !== session.sizeBytes) {
      await fs.rm(filePath, { force: true });
      throw new HttpError(400, 'Upload size mismatch');
    }

    const media = await prisma.mediaFile.create({
      data: {
        durationSec: session.durationSec,
        mimeType: session.mimeType,
        originalName: session.originalName,
        ownerId: currentUser.id,
        sizeBytes: session.sizeBytes,
        storageKey,
      },
    });

    await removeChunkSession(currentUser.id, uploadId);
    res.status(201).json({ media });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.delete('/uploads/:uploadId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const uploadId = sanitizeUploadId(req.params.uploadId);

    await removeChunkSession(currentUser.id, uploadId);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post('/upload', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await enforceRateLimit(currentUser.id, 'media-upload', operationalConfig.rateLimits.uploadsPerMinute);
    const input = uploadMediaSchema.parse(req.body);
    const extension = getExtension(input.originalName, input.mimeType);
    const storageKey = `${currentUser.id}/${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.resolve(uploadDir, storageKey);
    const fileData = Buffer.from(input.base64, 'base64');

    if (fileData.length === 0 || fileData.length > MAX_CHUNKED_UPLOAD_BYTES) {
      throw new HttpError(413, 'Attachment exceeds the allowed size.', { code: 'ATTACHMENT_TOO_LARGE' });
    }

    await ensureInsideUploadDir(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fileData);

    const media = await prisma.mediaFile.create({
      data: {
        durationSec: input.durationSec,
        height: input.height,
        mimeType: input.mimeType,
        originalName: input.originalName,
        ownerId: currentUser.id,
        sizeBytes: fileData.length,
        storageKey,
        width: input.width,
      },
    });

    res.status(201).json({ media });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post('/upload-binary', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await enforceRateLimit(currentUser.id, 'media-upload', operationalConfig.rateLimits.uploadsPerMinute);
    const mimeType = req.header('x-mime-type') || req.header('content-type') || 'application/octet-stream';
    const originalName = decodeURIComponent(req.header('x-original-name') || 'upload.bin');
    const durationHeader = req.header('x-duration-sec');
    const durationSec = durationHeader ? Math.max(1, Math.round(Number(durationHeader))) : undefined;
    let receivedBytes = 0;
    const contentLength = Number(req.header('content-length') || 0);

    if (Number.isFinite(contentLength) && contentLength > MAX_DIRECT_UPLOAD_BYTES) {
      throw new HttpError(413, 'Attachment exceeds the allowed size.', { code: 'ATTACHMENT_TOO_LARGE' });
    }

    const extension = getExtension(originalName, mimeType);
    const storageKey = `${currentUser.id}/${Date.now()}-${randomUUID()}${extension}`;
    const filePath = path.resolve(uploadDir, storageKey);

    await ensureInsideUploadDir(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    try {
      await pipeline(
        req,
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            receivedBytes += chunk.length;

            if (receivedBytes > MAX_DIRECT_UPLOAD_BYTES) {
              callback(new HttpError(413, 'Attachment exceeds the allowed size.', { code: 'ATTACHMENT_TOO_LARGE' }));
              return;
            }

            callback(null, chunk);
          },
        }),
        createWriteStream(filePath, { flags: 'wx' }),
      );
    } catch (error) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      throw error;
    }

    if (receivedBytes === 0) {
      await fs.rm(filePath, { force: true }).catch(() => undefined);
      throw new HttpError(400, 'Attachment file is empty');
    }

    const media = await prisma.mediaFile.create({
      data: {
        durationSec,
        mimeType,
        originalName,
        ownerId: currentUser.id,
        sizeBytes: receivedBytes,
        storageKey,
      },
    });

    res.status(201).json({ media });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.post('/register', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    await enforceRateLimit(currentUser.id, 'media-upload', operationalConfig.rateLimits.uploadsPerMinute);
    const input = registerMediaSchema.parse(req.body);

    if (input.sizeBytes > MAX_CHUNKED_UPLOAD_BYTES) {
      throw new HttpError(413, 'Attachment exceeds the allowed size.', { code: 'ATTACHMENT_TOO_LARGE' });
    }

    const media = await prisma.mediaFile.create({
      data: {
        durationSec: input.durationSec,
        height: input.height,
        mimeType: input.mimeType,
        originalName: input.originalName,
        ownerId: currentUser.id,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        width: input.width,
      },
    });

    res.status(201).json({ media });
  } catch (error) {
    next(error);
  }
});

mediaRoutes.get('/:mediaId', async (req, res, next) => {
  try {
    const currentUser = getAuthedUser(req);
    const media = await prisma.mediaFile.findUnique({
      where: { id: req.params.mediaId },
    });

    if (!media) {
      throw new HttpError(404, 'Media not found');
    }

    if (media.ownerId !== currentUser.id) {
      const sharedMessage = await prisma.message.findFirst({
        where: {
          mediaId: media.id,
          conversation: {
            members: {
              some: { userId: currentUser.id },
            },
          },
        },
      });

      if (!sharedMessage) {
        throw new HttpError(404, 'Media not found');
      }
    }

    res.json({ media });
  } catch (error) {
    next(error);
  }
});

function getExtension(fileName: string, mimeType: string) {
  const parsed = path.extname(fileName).toLowerCase();

  if (parsed && /^[a-z0-9.]+$/.test(parsed)) {
    return parsed;
  }

  if (mimeType === 'audio/mp4' || mimeType === 'audio/aac') {
    return '.m4a';
  }

  if (mimeType === 'audio/mpeg') {
    return '.mp3';
  }

  return '.bin';
}

type ChunkSession = {
  durationSec?: number;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  totalChunks: number;
};

function sanitizeUploadId(uploadId: string) {
  if (!/^[a-zA-Z0-9._-]{8,128}$/.test(uploadId)) {
    throw new HttpError(400, 'Invalid upload id');
  }

  return uploadId;
}

function getChunkSessionDir(userId: string, uploadId: string) {
  return path.resolve(uploadDir, '.chunks', userId, uploadId);
}

function getChunkSessionPath(userId: string, uploadId: string) {
  return path.resolve(getChunkSessionDir(userId, uploadId), 'session.json');
}

function getChunkPath(userId: string, uploadId: string, chunkIndex: number) {
  return path.resolve(getChunkSessionDir(userId, uploadId), `${chunkIndex}.part`);
}

async function readChunkSession(userId: string, uploadId: string): Promise<ChunkSession | null> {
  try {
    const text = await fs.readFile(getChunkSessionPath(userId, uploadId), 'utf8');
    const parsed = JSON.parse(text) as ChunkSession;

    if (!parsed.mimeType || !parsed.originalName || !parsed.sizeBytes || !parsed.totalChunks) {
      return null;
    }

    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function writeChunkSession(userId: string, uploadId: string, session: ChunkSession) {
  await fs.writeFile(getChunkSessionPath(userId, uploadId), JSON.stringify(session), 'utf8');
}

async function getCompletedChunkIndexes(userId: string, uploadId: string) {
  const sessionDir = getChunkSessionDir(userId, uploadId);

  try {
    const entries = await fs.readdir(sessionDir);

    return entries
      .map((entry) => (/^(\d+)\.part$/.exec(entry)?.[1]))
      .filter((entry): entry is string => !!entry)
      .map(Number)
      .sort((left, right) => left - right);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

async function removeChunkSession(userId: string, uploadId: string) {
  await fs.rm(getChunkSessionDir(userId, uploadId), { force: true, recursive: true });
}

async function assertWithinConcurrentUploadLimit(userId: string, uploadId: string, requestedBytes: number) {
  const userUploadDir = path.resolve(uploadDir, '.chunks', userId);
  let totalBytes = requestedBytes;

  try {
    const uploadIds = await fs.readdir(userUploadDir);

    for (const existingUploadId of uploadIds) {
      if (existingUploadId === uploadId) {
        continue;
      }

      const session = await readChunkSession(userId, existingUploadId);
      totalBytes += session?.sizeBytes ?? 0;
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (totalBytes > operationalConfig.uploads.maxBatchAttachmentBytes) {
    throw new HttpError(413, 'Attachment batch exceeds the allowed size.', { code: 'ATTACHMENT_BATCH_TOO_LARGE' });
  }
}

async function ensureInsideUploadDir(filePath: string) {
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) {
    throw new HttpError(400, 'Invalid media path');
  }

  await fs.mkdir(uploadDir, { recursive: true });
}

function toMediaFileError(error: unknown) {
  if (error instanceof HttpError) {
    return error;
  }

  if (isNodeError(error) && error.code === 'ENOENT') {
    return new HttpError(404, 'Media file missing');
  }

  if (isClientDisconnectError(error)) {
    return new HttpError(499, 'Client closed request');
  }

  return error;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isClientDisconnectError(error: unknown) {
  return isNodeError(error) && (error.code === 'EPIPE' || error.code === 'ECONNABORTED' || error.code === 'ECONNRESET');
}
