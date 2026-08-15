import apn from '@parse/node-apn';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import jwt from 'jsonwebtoken';

import { countUnreadConversationsForUser } from './conversationList';
import { relayPushToMainServer } from './childPushRelay';
import { config } from './config';
import { operationalConfig } from './operationalConfig';
import { prisma } from './prisma';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const INCOMING_CALL_CHANNEL_ID = 'incoming-calls-ringtone';
const INCOMING_CALL_FCM_SOUND = 'ringtone';

export type StoredPushToken = {
  deliveryReceiptUrl?: string;
  id?: string;
  installationId?: string | null;
  locale?: string | null;
  platform?: string | null;
  provider: string;
  token: string;
  userId?: string | null;
  quickReplyToken?: string;
};

export type IncomingCallPush = {
  autoJoin?: boolean;
  avatarUrl?: string | null;
  body: string;
  callId: string;
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'VOICE' | 'VIDEO';
  participantNames?: string[];
  ringingReceiptUrl?: string;
  title: string;
  tokens: StoredPushToken[];
};

export type CallEndedPush = {
  callId: string;
  callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED';
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'VOICE' | 'VIDEO';
  title: string;
  tokens: StoredPushToken[];
};

export type MessagePush = {
  avatarUrl?: string | null;
  body: string;
  conversationId: string;
  messageId: string;
  title: string;
  tokens: StoredPushToken[];
};

export type PushDispatchResult = {
  acceptedCount: number;
  failedCount: number;
  invalidTokenIds: string[];
  providerReceipts: Array<{ provider: 'expo'; receiptId: string; tokenId?: string }>;
  retryableTokenIds: string[];
  skippedCount: number;
};

let apnsProvider: apn.Provider | null = null;
let hasWarnedMissingFirebaseServiceAccount = false;

export async function sendIncomingCallPush(input: IncomingCallPush) {
  if (await relayPushToMainServer('incoming-call', input)) return emptyPushDispatchResult();
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 30_000;
  const callerTitle = input.title.trim() || 'Incoming call';
  const baseData = {
    categoryId: 'incoming-call',
    categoryIdentifier: 'incoming-call',
    channelId: INCOMING_CALL_CHANNEL_ID,
    autoJoin: input.autoJoin ? 'true' : 'false',
    callId: input.callId,
    callerName: callerTitle,
    conversationId: input.conversationId,
    displayName: callerTitle,
    expiresAt: String(expiresAt),
    isGroupCall: input.isGroupCall ? 'true' : 'false',
    issuedAt: String(issuedAt),
    mode: input.mode,
    participantNames: JSON.stringify(input.participantNames ?? []),
    ...(input.ringingReceiptUrl ? { ringingReceiptUrl: input.ringingReceiptUrl } : {}),
    title: callerTitle,
    type: 'incoming-call',
    ...(input.avatarUrl ? { imageUrl: input.avatarUrl } : {}),
  };

  const fcmTokens = input.tokens.filter((item) => item.provider === 'fcm');
  const fcmAndroidUserIds = new Set(fcmTokens.map((item) => item.userId).filter((userId): userId is string => !!userId));
  const expoTokens = input.tokens.filter((item) => (
    item.provider === 'expo' &&
    item.platform !== 'ios' &&
    (
      item.platform !== 'android' ||
      !item.userId ||
      !fcmAndroidUserIds.has(item.userId)
    )
  ));
  const apnsVoipTokens = input.tokens.filter((item) => item.provider === 'apns_voip');
  const apnsVoipUserIds = new Set(apnsVoipTokens.map((item) => item.userId).filter((userId): userId is string => !!userId));
  const apnsAlertFallbackTokensWithoutVoip = input.tokens.filter((item) => (
    item.provider === 'apns' &&
    item.platform === 'ios' &&
    (
      item.userId
        ? !apnsVoipUserIds.has(item.userId)
        : apnsVoipTokens.length === 0
    )
  ));
  const failedVoipUserIds = new Set<string>();

  const initialResults = await Promise.all([
    sendExpoPushNotifications(expoTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return {
        body,
        categoryId: 'incoming-call',
        channelId: INCOMING_CALL_CHANNEL_ID,
        data: { ...baseData, ...labels, body, ...getDeliveryReceiptData(item) },
        priority: 'high',
        sound: 'ringtone.wav',
        ttlSeconds: 30,
        title: callerTitle,
        to: item.token,
        tokenId: item.id,
      };
    })),
    Promise.all(fcmTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return sendFcmNotifications([item], {
        body,
        categoryId: 'incoming-call',
        channelId: INCOMING_CALL_CHANNEL_ID,
        data: { ...baseData, ...labels, body, ...getDeliveryReceiptData(item) },
        dataOnly: true,
        priority: 'high',
        sound: INCOMING_CALL_FCM_SOUND,
        ttlMs: 30_000,
        title: callerTitle,
        imageUrl: input.avatarUrl,
      });
    })),
    Promise.all(apnsVoipTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return sendApnsVoipNotifications([item], {
        body,
        data: { ...baseData, ...labels, body, ...getDeliveryReceiptData(item) },
        title: callerTitle,
      }).then((voipResult) => {
        const { failedTokens } = voipResult;
        if (failedTokens.length > 0 && item.userId) {
          failedVoipUserIds.add(item.userId);
        }
        return voipResult;
      }).catch((error) => {
        console.warn('APNs VoIP push send threw', error);
        if (item.userId) {
          failedVoipUserIds.add(item.userId);
        }
        return {
          failedTokens: [item.token],
          result: {
            ...emptyPushDispatchResult(),
            failedCount: 1,
          },
        };
      });
    })),
  ]);

  const apnsAlertFallbackTokens = dedupePushTokens([
    ...apnsAlertFallbackTokensWithoutVoip,
    ...input.tokens.filter((item) => (
      item.provider === 'apns' &&
      item.platform === 'ios' &&
      !!item.userId &&
      failedVoipUserIds.has(item.userId)
    )),
  ]);

  const fallbackResults = await Promise.all([
    Promise.all(apnsAlertFallbackTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return sendApnsNotifications([item], {
        body,
        categoryId: 'incoming-call',
        data: { ...baseData, ...labels, body, ...getDeliveryReceiptData(item) },
        sound: 'ringtone.wav',
        title: callerTitle,
        expirySeconds: 30,
      });
    })),
  ]);

  return mergePushDispatchResults([
    initialResults[0],
    ...initialResults[1],
    ...initialResults[2].map((item) => item.result),
    ...fallbackResults[0],
  ]);
}

export async function sendCallEndedPush(input: CallEndedPush) {
  if (await relayPushToMainServer('call-ended', input)) return emptyPushDispatchResult();
  const baseData = {
    callId: input.callId,
    callStatus: input.callStatus ?? 'ENDED',
    conversationId: input.conversationId,
    isGroupCall: input.isGroupCall ? 'true' : 'false',
    mode: input.mode,
    title: input.title,
    type: 'call-ended',
  };

  const expoTokens = input.tokens.filter((item) => item.provider === 'expo' && item.platform !== 'ios');
  const fcmTokens = input.tokens.filter((item) => item.provider === 'fcm');
  const apnsTokens = input.tokens.filter((item) => item.provider === 'apns');

  const results = await Promise.all([
    sendExpoPushNotifications(expoTokens.map((item) => ({
      channelId: INCOMING_CALL_CHANNEL_ID,
      contentAvailable: true,
      data: { ...baseData, locale: getPushLanguage(item.locale), ...getDeliveryReceiptData(item) },
      priority: 'high',
      to: item.token,
      tokenId: item.id,
    }))),
    Promise.all(fcmTokens.map((item) => sendFcmNotifications([item], {
      body: '',
      channelId: INCOMING_CALL_CHANNEL_ID,
      data: { ...baseData, locale: getPushLanguage(item.locale), ...getDeliveryReceiptData(item) },
      dataOnly: true,
      priority: 'high',
      title: '',
    }))),
    Promise.all(apnsTokens.map((item) => sendApnsBackgroundNotifications([item], {
      data: { ...baseData, locale: getPushLanguage(item.locale), ...getDeliveryReceiptData(item) },
    }))),
  ]);

  return mergePushDispatchResults([results[0], ...results[1], ...results[2]]);
}

function getIncomingCallBody(input: { isGroupCall?: boolean; mode: 'VOICE' | 'VIDEO' }, locale?: string | null) {
  const language = getPushLanguage(locale);

  if (language === 'ru') {
    if (input.mode === 'VIDEO') {
      return input.isGroupCall ? 'Входящий групповой видеозвонок' : 'Входящий видеозвонок';
    }

    return input.isGroupCall ? 'Входящий групповой аудиозвонок' : 'Входящий аудиозвонок';
  }

  if (language === 'tr') {
    if (input.mode === 'VIDEO') {
      return input.isGroupCall ? 'Gelen grup video araması' : 'Gelen video araması';
    }

    return input.isGroupCall ? 'Gelen grup sesli araması' : 'Gelen sesli arama';
  }

  if (input.mode === 'VIDEO') {
    return input.isGroupCall ? 'Incoming group video call' : 'Incoming video call';
  }

  return input.isGroupCall ? 'Incoming group voice call' : 'Incoming voice call';
}

function getCallNotificationLabels(locale?: string | null) {
  const language = getPushLanguage(locale);

  if (language === 'ru') {
    return {
      acceptTitle: 'Ответить',
      declineTitle: 'Отклонить',
      fallbackTitle: 'Входящий звонок',
      locale: language,
    };
  }

  if (language === 'tr') {
    return {
      acceptTitle: 'Cevapla',
      declineTitle: 'Reddet',
      fallbackTitle: 'Gelen arama',
      locale: language,
    };
  }

  return {
    acceptTitle: 'Accept',
    declineTitle: 'Decline',
    fallbackTitle: 'Incoming call',
    locale: language,
  };
}

function getPushLanguage(locale?: string | null): 'en' | 'tr' | 'ru' {
  if (locale === 'tr' || locale === 'ru') {
    return locale;
  }

  return 'en';
}

function createQuickReplyToken(conversationId: string, userId?: string | null) {
  if (!userId) {
    return undefined;
  }

  return jwt.sign(
    {
      conversationId,
      purpose: 'quick-reply',
    },
    config.JWT_SECRET,
    {
      expiresIn: '15m',
      subject: userId,
    },
  );
}

export async function sendMessagePush(input: MessagePush) {
  const relayInput = {
    ...input,
    tokens: input.tokens.map((item) => ({
      ...item,
      quickReplyToken: item.quickReplyToken ?? createQuickReplyToken(input.conversationId, item.userId),
    })),
  };
  if (await relayPushToMainServer('message', relayInput)) return emptyPushDispatchResult();
  const baseData = {
    categoryId: 'message',
    categoryIdentifier: 'message',
    channelId: 'messages',
    conversationId: input.conversationId,
    messageId: input.messageId,
    title: input.title,
    type: 'message',
    ...(input.avatarUrl ? { imageUrl: input.avatarUrl } : {}),
  };
  const dataForToken = (item: StoredPushToken) => {
    const quickReplyToken = item.quickReplyToken ?? createQuickReplyToken(input.conversationId, item.userId);

    return {
      ...baseData,
      ...(quickReplyToken ? { quickReplyToken } : {}),
      ...getDeliveryReceiptData(item),
    };
  };

  const expoTokens = input.tokens.filter((item) => item.provider === 'expo');
  const fcmTokens = input.tokens.filter((item) => item.provider === 'fcm');
  const apnsTokens = input.tokens.filter((item) => item.provider === 'apns');
  const apnsBadgeCountByUserId = await getApnsBadgeCountByUserId(apnsTokens);
  const prefetchData = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    type: 'message-prefetch',
  };

  const messageTtlSeconds = operationalConfig.pushNotifications.messageTtlHours * 60 * 60;
  const [visibleResults] = await Promise.all([
    Promise.all([
      sendExpoPushNotifications(expoTokens.map((item) => ({
        body: input.body,
        categoryId: 'message',
        channelId: 'messages',
        data: dataForToken(item),
        priority: 'high',
        title: input.title,
        to: item.token,
        tokenId: item.id,
        ttlSeconds: messageTtlSeconds,
      }))),
      ...fcmTokens.map((item) => sendFcmNotifications([item], {
        body: input.body,
        categoryId: 'message',
        channelId: 'messages',
        data: dataForToken(item),
        dataOnly: true,
        priority: 'high',
        title: input.title,
        imageUrl: input.avatarUrl,
        ttlMs: messageTtlSeconds * 1000,
      })),
      ...apnsTokens.map((item) => sendApnsNotifications([item], {
        body: input.body,
        badge: item.userId ? apnsBadgeCountByUserId.get(item.userId) : undefined,
        categoryId: 'message',
        data: dataForToken(item),
        expirySeconds: messageTtlSeconds,
        title: input.title,
      })),
    ]),
    Promise.all([
      sendExpoPushNotifications(expoTokens.map((item) => ({
        channelId: 'messages',
        contentAvailable: true,
        data: prefetchData,
        priority: 'normal',
        to: item.token,
        tokenId: item.id,
        ttlSeconds: messageTtlSeconds,
      }))),
      sendFcmNotifications(fcmTokens, {
        body: '',
        channelId: 'messages',
        data: prefetchData,
        dataOnly: true,
        priority: 'high',
        title: '',
        ttlMs: messageTtlSeconds * 1000,
      }),
      sendApnsBackgroundNotifications(apnsTokens, {
        data: prefetchData,
      }),
    ]),
  ]);

  return mergePushDispatchResults(visibleResults);
}

async function getApnsBadgeCountByUserId(tokens: StoredPushToken[]) {
  const userIds = [...new Set(tokens.map((item) => item.userId).filter((userId): userId is string => !!userId))];
  const counts = new Map<string, number>();

  await Promise.all(userIds.map(async (userId) => {
    counts.set(userId, await countUnreadConversationsForUser(userId).catch(() => 0));
  }));

  return counts;
}

async function sendExpoPushNotifications(messages: Array<{
  body?: string;
  categoryId?: string;
  channelId: string;
  data: Record<string, string>;
  contentAvailable?: boolean;
  priority: 'normal' | 'high';
  title?: string;
  to: string;
  tokenId?: string;
  imageUrl?: string | null;
  sound?: string;
  ttlSeconds?: number;
}>): Promise<PushDispatchResult> {
  if (messages.length === 0) {
    return emptyPushDispatchResult();
  }

  const results = await Promise.all(
    chunk(messages, 100).map(async (batch) => {
      const response = await fetch(EXPO_PUSH_URL, {
        body: JSON.stringify(batch.map(({ tokenId: _tokenId, ttlSeconds, ...message }) => ({
          ...message,
          ...(message.categoryId ? { categoryIdentifier: message.categoryId } : {}),
          ...(message.contentAvailable ? { _contentAvailable: true } : {}),
          ...(message.imageUrl ? { richContent: { image: message.imageUrl } } : {}),
          ...(!message.contentAvailable ? { sound: message.sound ?? 'default' } : {}),
          ...(ttlSeconds !== undefined ? { ttl: ttlSeconds } : {}),
        }))),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      if (!response.ok) {
        console.warn('Expo push send failed', response.status, await response.text());
        return failedPushDispatchResult(batch);
      }

      try {
        const payload = await response.json() as {
          data?: Array<{ details?: { error?: string }; id?: string; status?: string }>;
        };
        if (!Array.isArray(payload.data)) {
          return acceptedPushDispatchResult(batch);
        }

        return payload.data.reduce<PushDispatchResult>((result, ticket, index) => {
          const tokenId = batch[index]?.tokenId;
          if (ticket.status === 'ok') {
            result.acceptedCount += 1;
            if (ticket.id) {
              result.providerReceipts.push({
                provider: 'expo',
                receiptId: ticket.id,
                ...(tokenId ? { tokenId } : {}),
              });
            }
          } else {
            result.failedCount += 1;
            if (ticket.details?.error === 'DeviceNotRegistered' && tokenId) {
              result.invalidTokenIds.push(tokenId);
            } else if (tokenId) {
              result.retryableTokenIds.push(tokenId);
            }
          }
          return result;
        }, emptyPushDispatchResult());
      } catch {
        return acceptedPushDispatchResult(batch);
      }
    }),
  );

  return mergePushDispatchResults(results);
}

async function sendFcmNotifications(tokens: StoredPushToken[], input: {
  body: string;
  categoryId?: string;
  channelId: string;
  data: Record<string, string>;
  dataOnly?: boolean;
  priority: 'normal' | 'high';
  title: string;
  imageUrl?: string | null;
  sound?: string;
  ttlMs?: number;
}): Promise<PushDispatchResult> {
  if (tokens.length === 0) {
    return emptyPushDispatchResult();
  }

  if (!config.FIREBASE_SERVICE_ACCOUNT_PATH) {
    if (!hasWarnedMissingFirebaseServiceAccount) {
      hasWarnedMissingFirebaseServiceAccount = true;
      console.warn('FCM push send skipped because FIREBASE_SERVICE_ACCOUNT_PATH is not configured');
    }
    return {
      ...emptyPushDispatchResult(),
      skippedCount: tokens.length,
    };
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(config.FIREBASE_SERVICE_ACCOUNT_PATH),
    });
  }

  const results = await Promise.all(tokens.map(async (item) => {
    try {
      const data = {
        ...input.data,
        ...(input.categoryId ? { categoryId: input.categoryId, categoryIdentifier: input.categoryId } : {}),
        body: input.body,
        channelId: input.channelId,
        message: input.body,
        sound: input.sound ?? 'default',
        title: input.title,
      };
      const baseMessage = {
        android: {
          priority: input.priority,
          ...(input.ttlMs !== undefined ? { ttl: input.ttlMs } : {}),
        },
        data,
        token: item.token,
      };

      await getMessaging().send(input.dataOnly
        ? baseMessage
        : {
            ...baseMessage,
            android: {
              ...baseMessage.android,
              notification: {
                clickAction: 'meetvap',
                channelId: input.channelId,
                priority: input.priority === 'high' ? 'max' : 'default',
                ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
                sound: input.sound ?? 'default',
              },
            },
            notification: {
              body: input.body,
              title: input.title,
            },
          });
      return {
        ...emptyPushDispatchResult(),
        acceptedCount: 1,
      };
    } catch (error) {
      if (isInvalidFcmPushTokenError(error)) {
        await deleteStoredPushToken(item.token);
        return {
          ...emptyPushDispatchResult(),
          failedCount: 1,
          invalidTokenIds: item.id ? [item.id] : [],
        };
      }

      console.warn('FCM push send failed', error);
      return {
        ...emptyPushDispatchResult(),
        failedCount: 1,
        retryableTokenIds: item.id ? [item.id] : [],
      };
    }
  }));

  return mergePushDispatchResults(results);
}

async function sendApnsNotifications(tokens: StoredPushToken[], input: {
  badge?: number;
  body: string;
  categoryId?: string;
  data: Record<string, string>;
  expirySeconds?: number;
  sound?: string;
  title: string;
}): Promise<PushDispatchResult> {
  if (
    tokens.length === 0
  ) {
    return emptyPushDispatchResult();
  }

  if (
    !config.APNS_BUNDLE_ID ||
    !config.APNS_KEY_ID ||
    !config.APNS_KEY_PATH ||
    !config.APNS_TEAM_ID
  ) {
    return {
      ...emptyPushDispatchResult(),
      skippedCount: tokens.length,
    };
  }

  if (!apnsProvider) {
    apnsProvider = new apn.Provider({
      production: config.APNS_PRODUCTION,
      token: {
        key: config.APNS_KEY_PATH,
        keyId: config.APNS_KEY_ID,
        teamId: config.APNS_TEAM_ID,
      },
    });
  }

  const notification = new apn.Notification({
    alert: {
      body: input.body,
      title: input.title,
    },
    payload: input.data,
    pushType: 'alert',
    sound: input.sound ?? 'default',
    topic: config.APNS_BUNDLE_ID,
  });

  if (input.expirySeconds !== undefined) {
    notification.expiry = Math.floor(Date.now() / 1000) + input.expirySeconds;
  }

  if (typeof input.badge === 'number' && Number.isFinite(input.badge)) {
    notification.badge = Math.max(0, Math.floor(input.badge));
  }

  if (input.categoryId) {
    (notification as apn.Notification & { category?: string }).category = input.categoryId;
  }

  const result = await apnsProvider.send(notification, tokens.map((item) => item.token));

  if (result.failed.length > 0) {
    console.warn('APNs push send failed', result.failed);
  }

  return getApnsDispatchResult(tokens, result);
}

async function sendApnsBackgroundNotifications(tokens: StoredPushToken[], input: {
  data: Record<string, string>;
}): Promise<PushDispatchResult> {
  if (
    tokens.length === 0
  ) {
    return emptyPushDispatchResult();
  }

  if (
    !config.APNS_BUNDLE_ID ||
    !config.APNS_KEY_ID ||
    !config.APNS_KEY_PATH ||
    !config.APNS_TEAM_ID
  ) {
    return {
      ...emptyPushDispatchResult(),
      skippedCount: tokens.length,
    };
  }

  if (!apnsProvider) {
    apnsProvider = new apn.Provider({
      production: config.APNS_PRODUCTION,
      token: {
        key: config.APNS_KEY_PATH,
        keyId: config.APNS_KEY_ID,
        teamId: config.APNS_TEAM_ID,
      },
    });
  }

  const notification = new apn.Notification({
    contentAvailable: true,
    expiry: Math.floor(Date.now() / 1000) + 300,
    payload: input.data,
    priority: 5,
    pushType: 'background',
    topic: config.APNS_BUNDLE_ID,
  });
  const result = await apnsProvider.send(notification, tokens.map((item) => item.token));

  if (result.failed.length > 0) {
    console.warn('APNs background push send failed', result.failed);
  }

  return getApnsDispatchResult(tokens, result);
}

async function sendApnsVoipNotifications(tokens: StoredPushToken[], input: {
  body: string;
  data: Record<string, string>;
  title: string;
}): Promise<{ failedTokens: string[]; result: PushDispatchResult }> {
  if (
    tokens.length === 0
  ) {
    return { failedTokens: [], result: emptyPushDispatchResult() };
  }

  if (
    !config.APNS_BUNDLE_ID ||
    !config.APNS_KEY_ID ||
    !config.APNS_KEY_PATH ||
    !config.APNS_TEAM_ID
  ) {
    return {
      failedTokens: tokens.map((item) => item.token),
      result: {
        ...emptyPushDispatchResult(),
        skippedCount: tokens.length,
      },
    };
  }

  if (!apnsProvider) {
    apnsProvider = new apn.Provider({
      production: config.APNS_PRODUCTION,
      token: {
        key: config.APNS_KEY_PATH,
        keyId: config.APNS_KEY_ID,
        teamId: config.APNS_TEAM_ID,
      },
    });
  }

  const notification = new apn.Notification({
    expiry: Math.floor(Date.now() / 1000) + 30,
    payload: {
      ...input.data,
      body: input.body,
      title: input.title,
    },
    priority: 10,
    pushType: 'voip',
    topic: `${config.APNS_BUNDLE_ID}.voip`,
  });

  const result = await apnsProvider.send(notification, tokens.map((item) => item.token));

  if (result.failed.length > 0) {
    console.warn('APNs VoIP push send failed', result.failed);
  }

  const failedTokens = result.failed
    .map((failure) => failure.device)
    .filter((token): token is string => typeof token === 'string');

  return {
    failedTokens,
    result: getApnsDispatchResult(tokens, result),
  };
}

function getApnsDispatchResult(
  tokens: StoredPushToken[],
  result: { failed: Array<{ device?: string; response?: { reason?: string } }>; sent: Array<{ device?: string }> },
): PushDispatchResult {
  const tokensByValue = new Map(tokens.map((item) => [item.token, item]));
  const invalidReasons = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered']);
  const invalidTokenIds = result.failed.flatMap((failure) => {
    const item = failure.device ? tokensByValue.get(failure.device) : undefined;
    return item?.id && failure.response?.reason && invalidReasons.has(failure.response.reason)
      ? [item.id]
      : [];
  });
  const retryableTokenIds = result.failed.flatMap((failure) => {
    const item = failure.device ? tokensByValue.get(failure.device) : undefined;
    return item?.id && !invalidTokenIds.includes(item.id) ? [item.id] : [];
  });

  return {
    acceptedCount: result.sent.length,
    failedCount: result.failed.length,
    invalidTokenIds,
    providerReceipts: [],
    retryableTokenIds,
    skippedCount: 0,
  };
}

function dedupePushTokens<T extends { token: string }>(tokens: T[]) {
  const seen = new Set<string>();
  const deduped: T[] = [];

  tokens.forEach((item) => {
    if (seen.has(item.token)) {
      return;
    }

    seen.add(item.token);
    deduped.push(item);
  });

  return deduped;
}

function getDeliveryReceiptData(item: StoredPushToken): Record<string, string> {
  const data: Record<string, string> = {};
  if (item.deliveryReceiptUrl) {
    data.deliveryReceiptUrl = item.deliveryReceiptUrl;
  }
  return data;
}

function emptyPushDispatchResult(): PushDispatchResult {
  return {
    acceptedCount: 0,
    failedCount: 0,
    invalidTokenIds: [],
    providerReceipts: [],
    retryableTokenIds: [],
    skippedCount: 0,
  };
}

function acceptedPushDispatchResult(items: Array<{ tokenId?: string }>): PushDispatchResult {
  return {
    ...emptyPushDispatchResult(),
    acceptedCount: items.length,
  };
}

function failedPushDispatchResult(items: Array<{ tokenId?: string }>): PushDispatchResult {
  return {
    ...emptyPushDispatchResult(),
    failedCount: items.length,
    retryableTokenIds: items.flatMap((item) => item.tokenId ? [item.tokenId] : []),
  };
}

function mergePushDispatchResults(results: PushDispatchResult[]): PushDispatchResult {
  return results.reduce<PushDispatchResult>((merged, result) => ({
    acceptedCount: merged.acceptedCount + result.acceptedCount,
    failedCount: merged.failedCount + result.failedCount,
    invalidTokenIds: [...new Set([...merged.invalidTokenIds, ...result.invalidTokenIds])],
    providerReceipts: [...merged.providerReceipts, ...result.providerReceipts],
    retryableTokenIds: [...new Set([...merged.retryableTokenIds, ...result.retryableTokenIds])],
    skippedCount: merged.skippedCount + result.skippedCount,
  }), emptyPushDispatchResult());
}

function chunk<T>(items: T[], size: number) {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
}

function isInvalidFcmPushTokenError(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  const { code, message } = error as { code?: unknown; message?: unknown };

  return (
    code === 'messaging/registration-token-not-registered' ||
    (
      code === 'messaging/invalid-argument' &&
      typeof message === 'string' &&
      message.toLowerCase().includes('registration token')
    )
  );
}

async function deleteStoredPushToken(token: string) {
  try {
    const result = await prisma.devicePushToken.deleteMany({
      where: { token },
    });

    if (result.count > 0) {
      console.warn('Deleted invalid FCM push token', { count: result.count });
    }
  } catch (error) {
    console.warn('Could not delete stale FCM token', error);
  }
}
