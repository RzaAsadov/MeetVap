import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();

const operationalConfigSchema = z.object({
  appVersions: z.object({
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
  }).default({
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
    challengeTtlMinutes: positiveInteger.default(2),
    iosRequiredBuild: positiveInteger.default(999999),
    legacyAllowUntil: z.string().datetime().nullable().default(null),
    mode: z.enum(['observe', 'soft', 'enforce']).default('observe'),
    trustTtlHours: positiveInteger.default(24),
  }).default({
    androidRequiredBuild: 999999,
    challengeTtlMinutes: 2,
    iosRequiredBuild: 999999,
    legacyAllowUntil: null,
    mode: 'observe',
    trustTtlHours: 24,
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

const configPath = configPaths.find((candidate) => fs.existsSync(candidate));

if (!configPath) {
  throw new Error(`Operational config.json not found. Checked: ${configPaths.join(', ')}`);
}

export const operationalConfig = operationalConfigSchema.parse(
  JSON.parse(fs.readFileSync(configPath, 'utf8')),
);

export function getClientPolicy() {
  return {
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
      iosRequiredBuild: operationalConfig.attestation.iosRequiredBuild,
      mode: operationalConfig.attestation.mode,
      trustTtlHours: operationalConfig.attestation.trustTtlHours,
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
