import apn from '@parse/node-apn';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import jwt from 'jsonwebtoken';

import { config } from './config';
import { prisma } from './prisma';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const INCOMING_CALL_CHANNEL_ID = 'incoming-calls-ringtone';
const INCOMING_CALL_FCM_SOUND = 'ringtone';

type StoredPushToken = {
  locale?: string | null;
  platform?: string | null;
  provider: string;
  token: string;
  userId?: string | null;
};

type IncomingCallPush = {
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

type CallEndedPush = {
  callId: string;
  callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED';
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'VOICE' | 'VIDEO';
  title: string;
  tokens: StoredPushToken[];
};

type MessagePush = {
  avatarUrl?: string | null;
  body: string;
  conversationId: string;
  messageId: string;
  title: string;
  tokens: StoredPushToken[];
};

let apnsProvider: apn.Provider | null = null;
let hasWarnedMissingFirebaseServiceAccount = false;

export async function sendIncomingCallPush(input: IncomingCallPush) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + 45_000;
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

  await Promise.all([
    sendExpoPushNotifications(expoTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return {
        body,
        categoryId: 'incoming-call',
        channelId: INCOMING_CALL_CHANNEL_ID,
        data: { ...baseData, ...labels, body },
        priority: 'high',
        sound: 'ringtone.wav',
        title: callerTitle,
        to: item.token,
      };
    })),
    Promise.all(fcmTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return sendFcmNotifications([item.token], {
        body,
        categoryId: 'incoming-call',
        channelId: INCOMING_CALL_CHANNEL_ID,
        data: { ...baseData, ...labels, body },
        dataOnly: true,
        priority: 'high',
        sound: INCOMING_CALL_FCM_SOUND,
        title: callerTitle,
        imageUrl: input.avatarUrl,
      });
    })),
    Promise.all(apnsVoipTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return sendApnsVoipNotifications([item.token], {
        body,
        data: { ...baseData, ...labels, body },
        title: callerTitle,
      }).then((failedTokens) => {
        if (failedTokens.length > 0 && item.userId) {
          failedVoipUserIds.add(item.userId);
        }
      }).catch((error) => {
        console.warn('APNs VoIP push send threw', error);
        if (item.userId) {
          failedVoipUserIds.add(item.userId);
        }
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

  await Promise.all([
    Promise.all(apnsAlertFallbackTokens.map((item) => {
      const body = getIncomingCallBody(input, item.locale);
      const labels = getCallNotificationLabels(item.locale);

      return sendApnsNotifications([item.token], {
        body,
        categoryId: 'incoming-call',
        data: { ...baseData, ...labels, body },
        sound: 'ringtone.wav',
        title: callerTitle,
      });
    })),
  ]);
}

export async function sendCallEndedPush(input: CallEndedPush) {
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

  await Promise.all([
    sendExpoPushNotifications(expoTokens.map((item) => ({
      channelId: INCOMING_CALL_CHANNEL_ID,
      contentAvailable: true,
      data: { ...baseData, locale: getPushLanguage(item.locale) },
      priority: 'high',
      to: item.token,
    }))),
    Promise.all(fcmTokens.map((item) => sendFcmNotifications([item.token], {
      body: '',
      channelId: INCOMING_CALL_CHANNEL_ID,
      data: { ...baseData, locale: getPushLanguage(item.locale) },
      dataOnly: true,
      priority: 'high',
      title: '',
    }))),
    sendApnsBackgroundNotifications(apnsTokens.map((item) => item.token), {
      data: { ...baseData, locale: 'en' },
    }),
  ]);
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
    const quickReplyToken = createQuickReplyToken(input.conversationId, item.userId);

    return {
      ...baseData,
      ...(quickReplyToken ? { quickReplyToken } : {}),
    };
  };

  const expoTokens = input.tokens.filter((item) => item.provider === 'expo');
  const fcmTokens = input.tokens.filter((item) => item.provider === 'fcm');
  const apnsTokens = input.tokens.filter((item) => item.provider === 'apns');
  const prefetchData = {
    conversationId: input.conversationId,
    messageId: input.messageId,
    type: 'message-prefetch',
  };

  await Promise.all([
    sendExpoPushNotifications(expoTokens.map((item) => ({
      body: input.body,
      categoryId: 'message',
      channelId: 'messages',
      data: dataForToken(item),
      priority: 'high',
      title: input.title,
      to: item.token,
    }))),
    sendExpoPushNotifications(expoTokens.map((item) => ({
      channelId: 'messages',
      contentAvailable: true,
      data: prefetchData,
      priority: 'normal',
      to: item.token,
    }))),
    ...fcmTokens.map((item) => sendFcmNotifications([item.token], {
        body: input.body,
        categoryId: 'message',
        channelId: 'messages',
        data: dataForToken(item),
        dataOnly: true,
        priority: 'high',
        title: input.title,
        imageUrl: input.avatarUrl,
      })),
    sendFcmNotifications(fcmTokens.map((item) => item.token), {
      body: '',
      channelId: 'messages',
      data: prefetchData,
      dataOnly: true,
      priority: 'high',
      title: '',
    }),
    ...apnsTokens.map((item) => sendApnsNotifications([item.token], {
        body: input.body,
        categoryId: 'message',
        data: dataForToken(item),
        title: input.title,
      })),
    sendApnsBackgroundNotifications(apnsTokens.map((item) => item.token), {
      data: prefetchData,
    }),
  ]);
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
  imageUrl?: string | null;
  sound?: string;
}>) {
  if (messages.length === 0) {
    return;
  }

  await Promise.all(
    chunk(messages, 100).map(async (batch) => {
      const response = await fetch(EXPO_PUSH_URL, {
        body: JSON.stringify(batch.map((message) => ({
          ...message,
          ...(message.categoryId ? { categoryIdentifier: message.categoryId } : {}),
          ...(message.contentAvailable ? { _contentAvailable: true } : {}),
          ...(message.imageUrl ? { richContent: { image: message.imageUrl } } : {}),
          ...(!message.contentAvailable ? { sound: message.sound ?? 'default' } : {}),
        }))),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      if (!response.ok) {
        console.warn('Expo push send failed', response.status, await response.text());
      }
    }),
  );
}

async function sendFcmNotifications(tokens: string[], input: {
  body: string;
  categoryId?: string;
  channelId: string;
  data: Record<string, string>;
  dataOnly?: boolean;
  priority: 'normal' | 'high';
  title: string;
  imageUrl?: string | null;
  sound?: string;
}) {
  if (tokens.length === 0) {
    return;
  }

  if (!config.FIREBASE_SERVICE_ACCOUNT_PATH) {
    if (!hasWarnedMissingFirebaseServiceAccount) {
      hasWarnedMissingFirebaseServiceAccount = true;
      console.warn('FCM push send skipped because FIREBASE_SERVICE_ACCOUNT_PATH is not configured');
    }
    return;
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(config.FIREBASE_SERVICE_ACCOUNT_PATH),
    });
  }

  await Promise.all(tokens.map(async (token) => {
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
        },
        data,
        token,
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
    } catch (error) {
      if (isInvalidFcmPushTokenError(error)) {
        await deleteStoredPushToken(token);
        return;
      }

      console.warn('FCM push send failed', error);
    }
  }));
}

async function sendApnsNotifications(tokens: string[], input: {
  body: string;
  categoryId?: string;
  data: Record<string, string>;
  sound?: string;
  title: string;
}) {
  if (
    tokens.length === 0 ||
    !config.APNS_BUNDLE_ID ||
    !config.APNS_KEY_ID ||
    !config.APNS_KEY_PATH ||
    !config.APNS_TEAM_ID
  ) {
    return;
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

  if (input.categoryId) {
    (notification as apn.Notification & { category?: string }).category = input.categoryId;
  }

  const result = await apnsProvider.send(notification, tokens);

  if (result.failed.length > 0) {
    console.warn('APNs push send failed', result.failed);
  }
}

async function sendApnsBackgroundNotifications(tokens: string[], input: {
  data: Record<string, string>;
}) {
  if (
    tokens.length === 0 ||
    !config.APNS_BUNDLE_ID ||
    !config.APNS_KEY_ID ||
    !config.APNS_KEY_PATH ||
    !config.APNS_TEAM_ID
  ) {
    return;
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
  const result = await apnsProvider.send(notification, tokens);

  if (result.failed.length > 0) {
    console.warn('APNs background push send failed', result.failed);
  }
}

async function sendApnsVoipNotifications(tokens: string[], input: {
  body: string;
  data: Record<string, string>;
  title: string;
}) {
  if (
    tokens.length === 0 ||
    !config.APNS_BUNDLE_ID ||
    !config.APNS_KEY_ID ||
    !config.APNS_KEY_PATH ||
    !config.APNS_TEAM_ID
  ) {
    return [];
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

  const result = await apnsProvider.send(notification, tokens);

  if (result.failed.length > 0) {
    console.warn('APNs VoIP push send failed', result.failed);
  }

  return result.failed
    .map((failure) => failure.device)
    .filter((token): token is string => typeof token === 'string');
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
