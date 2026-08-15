import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalDate = z.string().datetime().nullable().optional();

export const childUserSnapshotSchema = z.object({
  appBuildNumber: z.number().int().positive().nullable().optional(),
  appVersion: optionalText(64),
  avatarUrl: optionalText(2048),
  childCreatedAt: z.string().datetime(),
  childUpdatedAt: z.string().datetime(),
  childUserId: z.string().min(1).max(128),
  deviceModel: optionalText(128),
  displayName: z.string().trim().min(1).max(160),
  installationId: optionalText(128),
  lastLoginAt: optionalDate,
  lastSeenAt: optionalDate,
  latestLocale: optionalText(32),
  latestPlatform: optionalText(32),
  osVersion: optionalText(64),
  registrationIpAddress: optionalText(128),
  registrationLocale: optionalText(32),
  registrationPlatform: optionalText(32),
  registrationUserAgent: optionalText(1000),
  username: z.string().trim().toLowerCase().min(1).max(64),
}).strict();

export const childUserSyncEventSchema = z.discriminatedUnion('operation', [
  z.object({
    eventId: z.string().uuid(),
    operation: z.literal('UPSERT'),
    reason: z.enum(['REGISTERED', 'LOGIN', 'PROFILE', 'DEVICE', 'RECONCILE', 'UPDATE']).default('UPDATE'),
    snapshot: childUserSnapshotSchema,
  }).strict(),
  z.object({
    eventId: z.string().uuid(),
    operation: z.literal('DELETE'),
    reason: z.literal('DELETED').default('DELETED'),
    snapshot: z.object({ childUserId: z.string().min(1).max(128) }).strict(),
  }).strict(),
]);

export const childUserSyncBatchSchema = z.object({
  events: z.array(childUserSyncEventSchema).min(1).max(200),
});

export type ChildUserSnapshot = z.infer<typeof childUserSnapshotSchema>;
export type ChildUserSyncReason = 'REGISTERED' | 'LOGIN' | 'PROFILE' | 'DEVICE' | 'RECONCILE' | 'UPDATE';
