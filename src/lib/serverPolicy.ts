import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_MAX_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const POLICY_CACHE_KEY_PREFIX = 'messenger.clientPolicy.v1.';

export type ClientPolicy = {
  publicUrls: {
    share: string;
  };
  uploads: {
    maxAttachmentBytes: number;
    maxBatchAttachmentBytes: number;
    maxChunkBytes: number;
    maxDirectUploadBytes: number;
  };
};

const fallbackPolicy: ClientPolicy = {
  publicUrls: {
    share: 'https://meetvap.com',
  },
  uploads: {
    maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
    maxBatchAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES,
    maxChunkBytes: 1024 * 1024,
    maxDirectUploadBytes: 2 * 1024 * 1024,
  },
};

const cachedByServerUrl = new Map<string, { expiresAt: number; policy: ClientPolicy }>();

export async function getClientPolicy(serverUrl: string) {
  const normalizedServerUrl = serverUrl.trim().replace(/\/+$/, '');
  const cached = cachedByServerUrl.get(normalizedServerUrl);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.policy;
  }

  try {
    const response = await fetch(`${normalizedServerUrl}/config/client`);

    if (!response.ok) {
      throw new Error(`Client policy request failed with ${response.status}`);
    }

    const policy = normalizePolicy(await response.json());
    cachedByServerUrl.set(normalizedServerUrl, { expiresAt: Date.now() + CACHE_MS, policy });
    void AsyncStorage.setItem(getPolicyCacheKey(normalizedServerUrl), JSON.stringify(policy)).catch(() => undefined);
    return policy;
  } catch {
    const storedPolicy = await readStoredPolicy(normalizedServerUrl);

    if (storedPolicy) {
      cachedByServerUrl.set(normalizedServerUrl, { expiresAt: Date.now() + CACHE_MS, policy: storedPolicy });
      return storedPolicy;
    }

    return fallbackPolicy;
  }
}

export async function getShareBaseUrl(serverUrl?: string | null) {
  if (!serverUrl) {
    return fallbackPolicy.publicUrls.share;
  }

  return (await getClientPolicy(serverUrl)).publicUrls.share;
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
  const publicUrls = 'publicUrls' in value && value.publicUrls && typeof value.publicUrls === 'object'
    ? value.publicUrls as Record<string, unknown>
    : {};
  return {
    publicUrls: {
      share: httpsOrigin(publicUrls.share, fallbackPolicy.publicUrls.share),
    },
    uploads: {
      maxAttachmentBytes: positiveNumber(uploads.maxAttachmentBytes, fallbackPolicy.uploads.maxAttachmentBytes),
      maxBatchAttachmentBytes: positiveNumber(uploads.maxBatchAttachmentBytes, fallbackPolicy.uploads.maxBatchAttachmentBytes),
      maxChunkBytes: positiveNumber(uploads.maxChunkBytes, fallbackPolicy.uploads.maxChunkBytes),
      maxDirectUploadBytes: positiveNumber(uploads.maxDirectUploadBytes, fallbackPolicy.uploads.maxDirectUploadBytes),
    },
  };
}

function httpsOrigin(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash
      ? parsed.origin
      : fallback;
  } catch {
    return fallback;
  }
}

function positiveNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function getPolicyCacheKey(serverUrl: string) {
  return `${POLICY_CACHE_KEY_PREFIX}${encodeURIComponent(serverUrl)}`;
}

async function readStoredPolicy(serverUrl: string) {
  try {
    const raw = await AsyncStorage.getItem(getPolicyCacheKey(serverUrl));
    return raw ? normalizePolicy(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
