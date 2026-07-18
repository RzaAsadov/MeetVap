import { z } from 'zod';
import { containsObjectionableContent, OBJECTIONABLE_CONTENT_MESSAGE } from './moderation';
import { CURRENT_TERMS_VERSION } from './terms';

export const MEETVAP_PROHIBITED_NAME_MESSAGE = 'Using "MeetVap" is prohibited by system';

const meetvapKeywordPattern = /meetvap/i;

const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  })
  .refine((value) => !meetvapKeywordPattern.test(value), {
    message: MEETVAP_PROHIBITED_NAME_MESSAGE,
  });

const groupTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  })
  .refine((value) => !meetvapKeywordPattern.test(value), {
    message: MEETVAP_PROHIBITED_NAME_MESSAGE,
  });

const usernameSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscore')
  .transform((value) => value.toLowerCase())
  .refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  })
  .refine((value) => value !== 'meetvap', {
    message: MEETVAP_PROHIBITED_NAME_MESSAGE,
  });

export const registerSchema = z.object({
  displayName: displayNameSchema,
  locale: z.enum(['en', 'tr', 'ru']).optional(),
  password: z
    .string()
    .min(7, 'Password must be at least 7 characters')
    .max(200)
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/\d/, 'Password must contain at least one number'),
  platform: z.string().trim().min(1).max(32).optional(),
  termsAccepted: z.literal(true),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
  username: usernameSchema,
});

export const usernameAvailabilitySchema = z.object({
  username: usernameSchema,
});

export const loginSchema = z.object({
  password: z.string().min(1),
  locale: z.enum(['en', 'tr', 'ru']).optional(),
  platform: z.string().trim().min(1).max(32).optional(),
  termsAccepted: z.literal(true),
  termsVersion: z.literal(CURRENT_TERMS_VERSION),
  username: z.string().trim().min(1).transform((value) => value.toLowerCase()),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

export const userSearchSchema = z.object({
  q: z.string().trim().min(1).max(64),
});

export const userRelationshipSchema = z.object({
  userId: z.string().min(1),
});

export const createDirectConversationSchema = z.object({
  userId: z.string().min(1),
});

export const createGroupConversationSchema = z.object({
  title: groupTitleSchema,
  userIds: z.array(z.string().min(1)).min(1).max(49),
});

export const updateVoiceRoomParticipantSchema = z.object({
  adminMuted: z.boolean().optional(),
  selfMuted: z.boolean().optional(),
}).refine((value) => value.adminMuted !== undefined || value.selfMuted !== undefined, {
  message: 'No voice room state provided',
});

export const createMessageSchema = z.object({
  body: z.string().max(8000).default('').refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  }),
  kind: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'VOICE', 'CALL']).default('TEXT'),
  mediaId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const messageReactionSchema = z.object({
  emoji: z.enum(['👍', '❤️', '😂', '😮', '😢', '🙏', '🤗']).nullable(),
});

export const createScheduledMessageSchema = z.object({
  body: z.string().max(8000).default('').refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  }),
  clientTimezone: z.string().trim().min(1).max(80).optional(),
  kind: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'FILE', 'VOICE']).default('TEXT'),
  mediaId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  sendAt: z.string().datetime(),
}).refine((value) => Date.parse(value.sendAt) > Date.now() + 5_000, {
  message: 'Scheduled send time must be in the future',
  path: ['sendAt'],
});

export const openDisappearingMessageSchema = z.object({
  secondsAfterView: z.number().int().min(1).max(30 * 24 * 60 * 60).optional(),
});

export const quickReplySchema = z.object({
  body: z.string().trim().min(1).max(8000).refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  }),
  token: z.string().trim().min(1),
});

export const groupWebhookMessageSchema = z.object({
  text: z.string().trim().min(1).max(8000).refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  }),
});

export const createLiveLocationSchema = z.object({
  address: z.string().trim().max(500).optional(),
  clientId: z.string().trim().min(1).max(160).optional(),
  conversationId: z.string().min(1),
  durationMinutes: z.union([z.literal(15), z.literal(60), z.literal(240), z.literal(720)]),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const updateLiveLocationSchema = z.object({
  address: z.string().trim().max(500).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const deleteMessageSchema = z.object({
  messageKey: z.string().regex(/^[A-Za-z0-9]{16}$/).optional(),
  mode: z.enum(['me', 'all']),
});

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000).refine((value) => !containsObjectionableContent(value), {
    message: OBJECTIONABLE_CONTENT_MESSAGE,
  }),
  createdAt: z.string().datetime().optional(),
  messageKey: z.string().regex(/^[A-Za-z0-9]{16}$/).optional(),
});

export const deleteConversationSchema = z.object({
  mode: z.enum(['me', 'all']).default('me'),
});

export const bulkDeleteConversationsSchema = z.object({
  conversationIds: z.array(z.string().min(1)).min(1).max(500),
  mode: z.enum(['me', 'all']).default('me'),
});

export const messageIdsSchema = z.object({
  client: z.enum(['MOBILE', 'WEB', 'mobile', 'web']).optional(),
  messageIds: z.array(z.string().min(1)).max(250).default([]),
  messageKeys: z.array(z.string().regex(/^[A-Za-z0-9]{16}$/)).max(250).default([]),
});

export const messageDeletionAckSchema = z.object({
  messageIds: z.array(z.string().min(1)).max(250).default([]),
  messageKeys: z.array(z.string().regex(/^[A-Za-z0-9]{16}$/)).max(250).default([]),
}).refine((input) => input.messageIds.length > 0 || input.messageKeys.length > 0, {
  message: 'Choose at least one deletion',
});

export const bulkConversationSyncSchema = z.object({
  conversationIds: z.array(z.string().min(1)).max(100).default([]),
});

export const bulkConversationAckSchema = z.object({
  items: z.array(z.object({
    conversationId: z.string().min(1),
    messageIds: z.array(z.string().min(1)).max(250).default([]),
    messageKeys: z.array(z.string().regex(/^[A-Za-z0-9]{16}$/)).max(250).default([]),
  }).refine((input) => input.messageIds.length > 0 || input.messageKeys.length > 0, {
    message: 'Choose at least one message',
  })).max(100).default([]),
});

export const registerMediaSchema = z.object({
  durationSec: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().min(1).max(160),
  originalName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  storageKey: z.string().min(1).max(512),
  width: z.number().int().positive().optional(),
});

export const uploadMediaSchema = z.object({
  base64: z.string().min(1),
  durationSec: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().min(1).max(160),
  originalName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  width: z.number().int().positive().optional(),
});

export const createCallSchema = z.object({
  conversationId: z.string().min(1),
  inviteeUserIds: z.array(z.string().min(1)).max(49).optional(),
  livekitRoom: z.string().min(1).max(160).optional(),
  messageKey: z.string().regex(/^[A-Za-z0-9]{16}$/).optional(),
  mode: z.enum(['VOICE', 'VIDEO']),
});

export const inviteCallParticipantSchema = z.object({
  userId: z.string().min(1),
});

export const registerPushTokenSchema = z.object({
  locale: z.enum(['en', 'tr', 'ru']).default('en'),
  platform: z.string().min(1).max(32).optional(),
  provider: z.enum(['apns', 'apns_voip', 'expo', 'fcm']).default('expo'),
  token: z.string().min(1).max(512),
});

export const updateAvatarSchema = z.object({
  avatarUrl: z.string().url().max(2048).nullable(),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  username: usernameSchema.optional(),
}).refine((input) => input.displayName !== undefined || input.username !== undefined, {
  message: 'At least one profile field is required',
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export const updatePrivacySchema = z.object({
  hideFromSearch: z.boolean().optional(),
  hideNickname: z.boolean().optional(),
  onlyContactsCanCall: z.boolean().optional(),
  preventPeerScreenshots: z.boolean().optional(),
  showLastSeen: z.boolean().optional(),
  useGroupAliases: z.boolean().optional(),
}).refine((input) => input.hideFromSearch !== undefined || input.hideNickname !== undefined || input.onlyContactsCanCall !== undefined || input.preventPeerScreenshots !== undefined || input.showLastSeen !== undefined || input.useGroupAliases !== undefined, {
  message: 'At least one privacy setting is required',
});

export const updateGroupAliasSchema = z.object({
  aliasName: displayNameSchema.nullable(),
});

export const declineGroupInviteSchema = z.object({
  blockGroup: z.boolean().optional(),
  reportGroup: z.boolean().optional(),
});

export const updateGroupAvatarSchema = z.object({
  avatarUrl: z.string().url().max(2048).nullable(),
});

export const updateGroupTitleSchema = z.object({
  title: groupTitleSchema,
});

export const updateGroupSettingsSchema = z.object({
  hideMembers: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  ownerOnlyMessages: z.boolean().optional(),
  preventMediaSave: z.boolean().optional(),
  preventScreenshots: z.boolean().optional(),
  showAdmins: z.boolean().optional(),
  showMemberCount: z.boolean().optional(),
});

export const updateConversationMuteSchema = z.object({
  durationMinutes: z.union([z.literal(15), z.literal(60), z.literal(240), z.literal(480), z.literal(1440)]).optional(),
  muted: z.boolean(),
});

export const updateDisappearingMessagesSchema = z.object({
  durationMinutes: z.union([z.literal(240), z.literal(480), z.literal(1440), z.literal(10080)]).nullable(),
});

export const updateGroupMembersSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(49),
});

export const transferGroupOwnershipSchema = z.object({
  userId: z.string().min(1),
});

export const reportSchema = z.object({
  conversationId: z.string().min(1).optional(),
  reason: z.string().trim().max(4000).optional(),
  targetId: z.string().min(1),
  targetType: z.enum(['USER', 'MESSAGE', 'GROUP']),
});

export const verifyAppleSubscriptionSchema = z.object({
  productId: z.string().min(1).max(160),
  transactionReceipt: z.string().min(1),
});

export const verifyGoogleSubscriptionSchema = z.object({
  productId: z.string().min(1).max(160),
  purchaseToken: z.string().min(1).max(4096),
});

export const redeemSubscriptionCodeSchema = z.object({
  code: z.string().trim().min(1).max(80),
});
