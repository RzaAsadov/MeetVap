const DEFAULT_MAX_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;

export type ClientPolicy = {
  uploads: {
    maxAttachmentBytes: number;
    maxBatchAttachmentBytes: number;
    maxChunkBytes: number;
    maxDirectUploadBytes: number;
  };
};

const fallbackPolicy: ClientPolicy = {
  uploads: {
    maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
    maxBatchAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
    maxChunkBytes: 1024 * 1024,
    maxDirectUploadBytes: 2 * 1024 * 1024,
  },
};

let cached: { expiresAt: number; policy: ClientPolicy; serverUrl: string } | null = null;

export async function getClientPolicy(serverUrl: string) {
  if (cached?.serverUrl === serverUrl && cached.expiresAt > Date.now()) {
    return cached.policy;
  }

  try {
    const response = await fetch(`${serverUrl}/config/client`);

    if (!response.ok) {
      return fallbackPolicy;
    }

    const policy = normalizePolicy(await response.json());
    cached = { expiresAt: Date.now() + CACHE_MS, policy, serverUrl };
    return policy;
  } catch {
    return fallbackPolicy;
  }
}

export async function assertAttachmentsWithinPolicy(serverUrl: string, sizes: (number | undefined)[]) {
  const policy = await getClientPolicy(serverUrl);
  const normalizedSizes = sizes.map((size) => Math.max(0, size ?? 0));

  if (normalizedSizes.some((size) => size > policy.uploads.maxAttachmentBytes)) {
    throw new AttachmentPolicyError('single', policy.uploads.maxAttachmentBytes);
  }

  if (normalizedSizes.reduce((sum, size) => sum + size, 0) > policy.uploads.maxBatchAttachmentBytes) {
    throw new AttachmentPolicyError('batch', policy.uploads.maxBatchAttachmentBytes);
  }

  return policy;
}

export class AttachmentPolicyError extends Error {
  constructor(readonly type: 'batch' | 'single', readonly maximumBytes: number) {
    super(type === 'batch' ? 'Attachment batch is too large' : 'Attachment is too large');
    this.name = 'AttachmentPolicyError';
  }
}

function normalizePolicy(value: unknown): ClientPolicy {
  if (!value || typeof value !== 'object' || !('uploads' in value) || !value.uploads || typeof value.uploads !== 'object') {
    return fallbackPolicy;
  }

  const uploads = value.uploads as Record<string, unknown>;
  return {
    uploads: {
      maxAttachmentBytes: positiveNumber(uploads.maxAttachmentBytes, fallbackPolicy.uploads.maxAttachmentBytes),
      maxBatchAttachmentBytes: positiveNumber(uploads.maxBatchAttachmentBytes, fallbackPolicy.uploads.maxBatchAttachmentBytes),
      maxChunkBytes: positiveNumber(uploads.maxChunkBytes, fallbackPolicy.uploads.maxChunkBytes),
      maxDirectUploadBytes: positiveNumber(uploads.maxDirectUploadBytes, fallbackPolicy.uploads.maxDirectUploadBytes),
    },
  };
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
