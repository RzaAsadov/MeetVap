import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();
const attestationModeSchema = z.enum(['observe', 'soft', 'enforce']);
const appDomainSchema = z.string()
  .trim()
  .transform((value) => value.toLowerCase().replace(/\.$/, ''))
  .refine(
    (value) => value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value),
    'appdomains entries must be hostnames such as example.com',
  );
const publicApiHostSchema = z.string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/\.$/, ''))
  .refine(
    (value) => value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value),
    'public API hosts must be DNS hostnames',
  );
const httpsOriginSchema = (settingName: string) => z.string().url().transform((value, context) => {
  const parsed = new URL(value);

  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `${settingName} values must be HTTPS origins` });
    return z.NEVER;
  }

  return parsed.origin;
});
export const publicApiEndpointSchema = z.object({
  host: publicApiHostSchema,
  meetUrl: httpsOriginSchema('public API meetUrl').optional(),
  mode: z.enum(['direct', 'relay']).default('direct'),
  shareUrl: httpsOriginSchema('public API shareUrl').optional(),
  url: z.string().url().transform((value, context) => {
    const parsed = new URL(value);

    if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'public API endpoint URLs must be HTTPS origins' });
      return z.NEVER;
    }

    return parsed.origin;
  }),
}).superRefine((value, context) => {
  if (new URL(value.url).hostname.toLowerCase() !== value.host) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'public API endpoint host must match its URL hostname' });
  }
});
const publicApiSchema = z.object({
  defaultHost: publicApiHostSchema,
  endpoints: z.array(publicApiEndpointSchema).min(1),
}).superRefine((value, context) => {
  const hosts = value.endpoints.map((endpoint) => endpoint.host);

  if (!hosts.includes(value.defaultHost)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'publicApi.defaultHost must exist in publicApi.endpoints' });
  }
  if (new Set(hosts).size !== hosts.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'publicApi endpoints must have unique hosts' });
  }
});
export const appVersionsSchema = z.object({
  android: z.object({
    latest: z.string().trim().min(1).default('0.1.0'),
    minimum: z.string().trim().min(1).default('0.1.0'),
    storeUrl: z.string().url().default('https://play.google.com/store/apps/details?id=com.meetvap.messenger&hl=en'),
  }).default({
    latest: '0.1.0',
    minimum: '0.1.0',
    storeUrl: 'https://play.google.com/store/apps/details?id=com.meetvap.messenger&hl=en',
  }),
  ios: z.object({
    latest: z.string().trim().min(1).default('0.1.0'),
    minimum: z.string().trim().min(1).default('0.1.0'),
    storeUrl: z.string().url().default('https://apps.apple.com/tr/app/meetvap/id6767963508'),
  }).default({
    latest: '0.1.0',
    minimum: '0.1.0',
    storeUrl: 'https://apps.apple.com/tr/app/meetvap/id6767963508',
  }),
});

const operationalConfigSchema = z.object({
  serverInstanceId: z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9._:-]+$/).optional(),
  serverRole: z.enum(['main', 'child']).default('main'),
  publicApi: publicApiSchema.optional(),
  mainServerHost: z.string().url().refine((value) => new URL(value).protocol === 'https:', 'mainServerHost must use HTTPS').optional(),
  mainServerKey: z.string()
    .trim()
    .min(24)
    .regex(/^[A-Za-z0-9_-]+$/, 'mainServerKey must contain only ASCII letters, numbers, underscore, and hyphen')
    .optional(),
  appdomains: z.array(appDomainSchema).default([]).transform((domains) => Array.from(new Set(domains))),
  appVersions: appVersionsSchema.default({
    android: {
      latest: '0.1.0',
      minimum: '0.1.0',
      storeUrl: 'https://play.google.com/store/apps/details?id=com.meetvap.messenger&hl=en',
    },
    ios: {
      latest: '0.1.0',
      minimum: '0.1.0',
      storeUrl: 'https://apps.apple.com/tr/app/meetvap/id6767963508',
    },
  }),
  attestation: z.object({
    androidRequiredBuild: positiveInteger.default(999999),
    bootstrapGraceMinutes: positiveInteger.default(15),
    challengeTtlMinutes: positiveInteger.default(2),
    iosRequiredBuild: positiveInteger.default(999999),
    legacyAllowUntil: z.string().datetime().nullable().default(null),
    mode: attestationModeSchema.default('observe'),
    platforms: z.object({
      android: attestationModeSchema.optional(),
      ios: attestationModeSchema.optional(),
    }).default({}),
    trustTtlHours: positiveInteger.default(24),
    unevaluatedRetryAfterSeconds: positiveInteger.default(300),
  }).default({
    androidRequiredBuild: 999999,
    bootstrapGraceMinutes: 15,
    challengeTtlMinutes: 2,
    iosRequiredBuild: 999999,
    legacyAllowUntil: null,
    mode: 'observe',
    platforms: {},
    trustTtlHours: 24,
    unevaluatedRetryAfterSeconds: 300,
  }),
  maintenance: z.object({
    cleanupIntervalMinutes: positiveInteger.default(15),
    expiredSessionRetentionDays: positiveInteger.default(7),
    orphanMediaRetentionHours: positiveInteger.default(24),
    partialUploadRetentionHours: positiveInteger.default(24),
    staleCallTimeoutHours: positiveInteger.default(12),
  }),
  messageQueue: z.object({
    activePushTokenDays: positiveInteger.default(45),
    hardDeleteMinBuild: z.object({
      android: positiveInteger.default(1),
      ios: positiveInteger.default(1),
    }),
  }).default({
    activePushTokenDays: 45,
    hardDeleteMinBuild: {
      android: 1,
      ios: 1,
    },
  }),
  pushNotifications: z.object({
    messageTtlHours: positiveInteger.default(72),
    outboxMaxAttempts: positiveInteger.default(8),
    outboxMaxRetrySeconds: positiveInteger.default(300),
  }).default({
    messageTtlHours: 72,
    outboxMaxAttempts: 8,
    outboxMaxRetrySeconds: 300,
  }),
  premium: z.object({
    trialDays: nonNegativeInteger.default(15),
  }).default({
    trialDays: 15,
  }),
  rateLimits: z.object({
    mediaMessagesPerMinute: positiveInteger.default(20),
    textMessagesPerMinute: positiveInteger.default(90),
    uploadsPerMinute: positiveInteger.default(24),
  }),
  retention: z.object({
    clientContentAckHours: positiveInteger.default(72),
    locationMessageDays: positiveInteger.default(10),
    mediaMessageDays: positiveInteger.default(15),
    textMessageDays: positiveInteger.default(30),
  }),
  uploads: z.object({
    maxAttachmentBytes: positiveInteger.default(1024 * 1024 * 1024),
    maxBatchAttachmentBytes: positiveInteger.default(1024 * 1024 * 1024),
    maxChunkBytes: positiveInteger.default(1024 * 1024),
    maxDirectUploadBytes: positiveInteger.default(100 * 1024 * 1024),
  }),
  webMediaCache: z.object({
    maxSingleMediaBytes: positiveInteger.default(500 * 1024 * 1024),
    maxTotalBytes: positiveInteger.default(10 * 1024 * 1024 * 1024),
  }).default({
    maxSingleMediaBytes: 500 * 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024 * 1024,
  }),
});

const configPaths = [
  path.resolve(__dirname, '../../config.json'),
  path.resolve(process.cwd(), '../config.json'),
  path.resolve(process.cwd(), 'config.json'),
  path.resolve(__dirname, '../config.json'),
];

const discoveredConfigPath = configPaths.find((candidate) => fs.existsSync(candidate));

if (!discoveredConfigPath) {
  throw new Error(`Operational config.json not found. Checked: ${configPaths.join(', ')}`);
}
const configPath: string = discoveredConfigPath;

export const operationalConfig = operationalConfigSchema.parse(
  JSON.parse(fs.readFileSync(configPath, 'utf8')),
);

if (operationalConfig.serverRole === 'child' && (!operationalConfig.mainServerHost || !operationalConfig.mainServerKey)) {
  throw new Error('Child servers require mainServerHost and mainServerKey in config.json');
}

export type AppVersionsConfig = z.infer<typeof appVersionsSchema>;

export async function refreshOperationalAppVersionsFromDisk() {
  const rawConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf8')) as Record<string, unknown>;
  const appVersions = operationalConfigSchema.parse(rawConfig).appVersions;

  if (JSON.stringify(operationalConfig.appVersions) !== JSON.stringify(appVersions)) {
    applyOperationalAppVersions(appVersions);
  }

  return appVersions;
}

export async function updateOperationalAppVersions(input: unknown) {
  const appVersions = appVersionsSchema.parse(input);

  if (JSON.stringify(operationalConfig.appVersions) === JSON.stringify(appVersions)) {
    return false;
  }

  const rawConfig = JSON.parse(await fs.promises.readFile(configPath, 'utf8')) as Record<string, unknown>;
  const nextRawConfig = { ...rawConfig, appVersions };
  operationalConfigSchema.parse(nextRawConfig);
  await persistOperationalConfig(`${JSON.stringify(nextRawConfig, null, 2)}\n`);

  applyOperationalAppVersions(appVersions);
  return true;
}

function applyOperationalAppVersions(appVersions: AppVersionsConfig) {
  operationalConfig.appVersions.android = appVersions.android;
  operationalConfig.appVersions.ios = appVersions.ios;
}

async function persistOperationalConfig(contents: string) {
  const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, contents, 'utf8');

  try {
    await fs.promises.rename(temporaryPath, configPath);
  } catch (error) {
    await fs.promises.unlink(temporaryPath).catch(() => undefined);

    // Docker bind-mounted files cannot be replaced with rename(2), but they can
    // be safely rewritten after the complete replacement document is validated.
    if (!isBindMountReplacementError(error)) {
      throw error;
    }
    await fs.promises.writeFile(configPath, contents, 'utf8');
  }
}

function isBindMountReplacementError(error: unknown) {
  return error instanceof Error && 'code' in error && ['EBUSY', 'EPERM', 'EXDEV'].includes(String(error.code));
}

export function getServerInstanceId(publicApiUrl?: string) {
  if (operationalConfig.serverInstanceId) return operationalConfig.serverInstanceId;
  if (publicApiUrl) {
    try { return new URL(publicApiUrl).hostname.toLowerCase(); } catch { /* Fall through. */ }
  }
  return operationalConfig.serverRole === 'main' ? 'meetvap-main' : `meetvap-child-${operationalConfig.mainServerHost ?? 'unknown'}`;
}

export function getClientPolicy(publicApiUrl?: string, shareUrl = 'https://meetvap.com') {
  return {
    serverInstanceId: getServerInstanceId(publicApiUrl),
    publicUrls: {
      share: shareUrl,
    },
    appVersions: {
      android: {
        latest: operationalConfig.appVersions.android.latest,
        minimum: operationalConfig.appVersions.android.minimum,
        storeUrl: operationalConfig.appVersions.android.storeUrl,
      },
      ios: {
        latest: operationalConfig.appVersions.ios.latest,
        minimum: operationalConfig.appVersions.ios.minimum,
        storeUrl: operationalConfig.appVersions.ios.storeUrl,
      },
    },
    attestation: {
      androidRequiredBuild: operationalConfig.attestation.androidRequiredBuild,
      bootstrapGraceMinutes: operationalConfig.attestation.bootstrapGraceMinutes,
      iosRequiredBuild: operationalConfig.attestation.iosRequiredBuild,
      mode: operationalConfig.attestation.mode,
      platforms: {
        android: getAttestationMode('android'),
        ios: getAttestationMode('ios'),
      },
      trustTtlHours: operationalConfig.attestation.trustTtlHours,
      unevaluatedRetryAfterSeconds: operationalConfig.attestation.unevaluatedRetryAfterSeconds,
    },
    premium: {
      trialDays: operationalConfig.premium.trialDays,
    },
    rateLimits: {
      mediaMessagesPerMinute: operationalConfig.rateLimits.mediaMessagesPerMinute,
      textMessagesPerMinute: operationalConfig.rateLimits.textMessagesPerMinute,
    },
    uploads: {
      maxAttachmentBytes: operationalConfig.uploads.maxAttachmentBytes,
      maxBatchAttachmentBytes: operationalConfig.uploads.maxBatchAttachmentBytes,
      maxChunkBytes: operationalConfig.uploads.maxChunkBytes,
      maxDirectUploadBytes: operationalConfig.uploads.maxDirectUploadBytes,
    },
    webMediaCache: {
      maxSingleMediaBytes: operationalConfig.webMediaCache.maxSingleMediaBytes,
      maxTotalBytes: operationalConfig.webMediaCache.maxTotalBytes,
    },
  };
}

export type AttestationPlatform = 'android' | 'ios';
export type AttestationMode = 'observe' | 'soft' | 'enforce';

export function getAttestationMode(platform: AttestationPlatform): AttestationMode {
  return operationalConfig.attestation.platforms[platform] ?? operationalConfig.attestation.mode;
}
