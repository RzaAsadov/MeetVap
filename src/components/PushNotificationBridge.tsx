import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { useEffect } from 'react';
import { Alert, AppState, Platform } from 'react-native';

import { t, type AppLanguage } from '../i18n';
import { beginCallOnlyAccess } from '../lib/appLockAccess';
import { endCall, markConversationRead, registerPushToken, ringCall } from '../lib/backend';
import { prefetchConversationMessages } from '../lib/backgroundPrefetch';
import { getVisibleChatRoomConversationId, navigateToChat, navigateToChats, navigateToIncomingCall } from '../navigation/navigationRef';
import { canUseNativeFullScreenIncomingCalls, clearNativeQuickReplyCredentials, consumeNativePendingIncomingCallUrl, endIosCallKitCall, openNativeFullScreenIncomingCallSettings, registerIosVoipPushToken, setNativeQuickReplyCredentials } from '../native/CallNative';
import { getAuthToken, getServerUrl, getStoredDecoyOffline, getStoredUser } from '../lib/storage';
import { dismissMessageNotificationsForConversation } from '../lib/messageNotifications';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { isIncomingCallUrlExpired } from '../lib/incomingCallExpiry';
import { useAppStore } from '../store/useAppStore';

type IncomingCallNotificationData = {
  autoJoin?: unknown;
  callId?: unknown;
  conversationId?: unknown;
  deliveryReceiptUrl?: unknown;
  expiresAt?: unknown;
  isGroupCall?: unknown;
  messageId?: unknown;
  mode?: unknown;
  participantNames?: unknown;
  title?: unknown;
  type?: unknown;
};

const MESSAGE_PREFETCH_TASK = 'meetvap-message-prefetch';
const handledIncomingCallUrls = new Set<string>();
let didPromptFullScreenIncomingCallSettings = false;

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isDecoyOffline = await getStoredDecoyOffline().catch(() => false);

    if (isDecoyOffline) {
      return {
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    const notificationData = getNotificationTaskData(notification.request.content.data);
    await acknowledgePushDelivery(notificationData);
    void syncApplicationIconBadge();

    if (isExpiredIncomingCall(notificationData)) {
      if (typeof notificationData.callId === 'string') {
        endIosCallKitCall(notificationData.callId);
      }
      return {
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    if (AppState.currentState === 'active') {
      const data = notificationData;
      const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : null;
      const isMessagePush = data?.type === 'message' || data?.type === 'message-prefetch';

      if (isMessagePush && conversationId) {
        void useAppStore.getState().loadMessages(conversationId, { hydrate: false })
          .catch((error) => {
            logMessageDeliveryDiagnostic('foreground-push-message-sync-failed', {
              conversationId,
              message: error instanceof Error ? error.message : String(error),
              messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
            });
          });
      }

      const isOtherChatMessage = data?.type === 'message' &&
        !!conversationId &&
        getVisibleChatRoomConversationId() !== conversationId;

      if (isOtherChatMessage) {
          return {
            shouldPlaySound: true,
            shouldSetBadge: true,
            shouldShowBanner: true,
            shouldShowList: true,
          };
      }

      return {
        shouldPlaySound: false,
        shouldSetBadge: true,
        shouldShowBanner: false,
        shouldShowList: false,
      };
    }

    return {
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

if (!TaskManager.isTaskDefined(MESSAGE_PREFETCH_TASK)) {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(MESSAGE_PREFETCH_TASK, ({ data }) => {
    return getStoredDecoyOffline()
      .then(async (isDecoyOffline) => {
        if (isDecoyOffline) {
          return Notifications.BackgroundNotificationTaskResult.NoData;
        }

        const payload = getNotificationTaskData(data);
        await acknowledgePushDelivery(payload);

        if (payload.type === 'incoming-call' && typeof payload.callId === 'string') {
          if (isExpiredIncomingCall(payload)) {
            endIosCallKitCall(payload.callId);
            return Notifications.BackgroundNotificationTaskResult.NoData;
          }
          return getServerUrl()
            .then((serverUrl) => (serverUrl ? ringCall(serverUrl, payload.callId as string) : undefined))
            .then(() => Notifications.BackgroundNotificationTaskResult.NewData)
            .catch(() => Notifications.BackgroundNotificationTaskResult.Failed);
        }

        if (payload.type !== 'message-prefetch' || typeof payload.conversationId !== 'string') {
          return Notifications.BackgroundNotificationTaskResult.NoData;
        }

        logMessageDeliveryDiagnostic('background-prefetch-task-start', {
          conversationId: payload.conversationId,
          messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
        });
        return prefetchConversationMessages(payload.conversationId)
          .then(() => {
            logMessageDeliveryDiagnostic('background-prefetch-task-finished', {
              conversationId: payload.conversationId,
              messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
            });
            return Notifications.BackgroundNotificationTaskResult.NewData;
          })
          .catch((error) => {
            logMessageDeliveryDiagnostic('background-prefetch-task-failed', {
              conversationId: payload.conversationId,
              message: error instanceof Error ? error.message : String(error),
              messageId: typeof payload.messageId === 'string' ? payload.messageId : undefined,
            });
            return Notifications.BackgroundNotificationTaskResult.Failed;
          });
      })
      .catch(() => Notifications.BackgroundNotificationTaskResult.Failed);
  });
}

export function PushNotificationBridge() {
  const language = useAppStore((state) => state.language);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const unreadConversationCount = useAppStore((state) => state.unreadConversationIds.length);
  const user = useAppStore((state) => state.user);

  useEffect(() => {
    void syncNativeQuickReplyCredentials();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncNativeQuickReplyCredentials();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [serverUrl, user]);

  useEffect(() => {
    if (!serverUrl || !user) {
      return;
    }

    void registerForPushNotifications(serverUrl, language).catch((error) => {
      logMessageDeliveryDiagnostic('push-token-registration-failed', {
        language,
        message: error instanceof Error ? error.message : String(error),
        platform: Platform.OS,
        userId: user.id,
      });
    });
  }, [language, serverUrl, user?.id]);

  useEffect(() => {
    void syncApplicationIconBadge(unreadConversationCount);
  }, [unreadConversationCount]);

  useEffect(() => {
    let isMounted = true;
    let isDraining = false;

    const drainPendingNativeIncomingCall = async () => {
      if (isDraining) {
        return;
      }

      isDraining = true;

      try {
        const url = await consumeNativePendingIncomingCallUrl();

        if (isMounted && url) {
          await handleIncomingCallUrl(url, serverUrl ?? await getServerUrl().catch(() => null));
        }
      } finally {
        isDraining = false;
      }
    };

    void drainPendingNativeIncomingCall();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void drainPendingNativeIncomingCall();
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [serverUrl]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !user || didPromptFullScreenIncomingCallSettings) {
      return;
    }

    let isMounted = true;

    const checkFullScreenPermission = async () => {
      if (didPromptFullScreenIncomingCallSettings || AppState.currentState !== 'active') {
        return;
      }

      const canUseFullScreenCalls = await canUseNativeFullScreenIncomingCalls();

      if (!isMounted || canUseFullScreenCalls || didPromptFullScreenIncomingCallSettings) {
        return;
      }

      didPromptFullScreenIncomingCallSettings = true;
      Alert.alert(
        t('fullScreenIncomingCallsPermissionTitle', {}, language),
        t('fullScreenIncomingCallsPermissionMessage', {}, language),
        [
          { text: t('later', {}, language), style: 'cancel' },
          {
            text: t('settings', {}, language),
            onPress: openNativeFullScreenIncomingCallSettings,
          },
        ],
      );
    };

    void checkFullScreenPermission();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkFullScreenPermission();
      }
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, [language, user]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void acknowledgePushDelivery(getNotificationTaskData(response.notification.request.content.data));
      void handleNotificationData(
        response.notification.request.content.data as IncomingCallNotificationData,
        response.actionIdentifier,
        serverUrl,
        response.userText,
      );
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        void acknowledgePushDelivery(getNotificationTaskData(response.notification.request.content.data));
        void handleNotificationData(
          response.notification.request.content.data as IncomingCallNotificationData,
          response.actionIdentifier,
          serverUrl,
          response.userText,
        );
      }
    });

    return () => {
      subscription.remove();
    };
  }, [serverUrl]);

  return null;
}

async function syncApplicationIconBadge(count = useAppStore.getState().unreadConversationIds.length) {
  if (Platform.OS !== 'ios') {
    return;
  }

  await Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => undefined);
}

async function syncNativeQuickReplyCredentials() {
  const [serverUrl, token, isDecoyOffline, user] = await Promise.all([
    getServerUrl(),
    getAuthToken(),
    getStoredDecoyOffline(),
    getStoredUser<unknown>(),
  ]);

  if (serverUrl && token && user && !isDecoyOffline) {
    setNativeQuickReplyCredentials(serverUrl, token);
    return;
  }

  clearNativeQuickReplyCredentials();
}

async function registerForPushNotifications(serverUrl: string, locale: AppLanguage) {
  if (!Device.isDevice) {
    return;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('incoming-calls-ringtone', {
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: getNotificationText(locale, 'Incoming calls', 'Gelen aramalar', 'Входящие звонки'),
      sound: 'ringtone.wav',
      vibrationPattern: [0, 500, 250, 500],
    });
    await Notifications.setNotificationChannelAsync('messages', {
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: getNotificationText(locale, 'Messages', 'Mesajlar', 'Сообщения'),
      sound: 'default',
      vibrationPattern: [0, 250],
    });
  }

  await Notifications.setNotificationCategoryAsync('incoming-call', [
    {
      buttonTitle: getNotificationText(locale, 'Accept', 'Cevapla', 'Ответить'),
      identifier: 'accept',
      options: { opensAppToForeground: true },
    },
    {
      buttonTitle: getNotificationText(locale, 'Cancel', 'İptal', 'Отмена'),
      identifier: 'cancel',
      options: { isDestructive: true, opensAppToForeground: true },
    },
  ]);
  await Notifications.setNotificationCategoryAsync('message', [
    {
      buttonTitle: getNotificationText(locale, 'Mark read', 'Okundu işaretle', 'Отметить прочитанным'),
      identifier: 'mark-read',
      options: { opensAppToForeground: true },
    },
    {
      buttonTitle: getNotificationText(locale, 'Reply', 'Yanıtla', 'Ответить'),
      identifier: 'reply',
      options: { opensAppToForeground: false },
      textInput: {
        placeholder: getNotificationText(locale, 'Message', 'Mesaj', 'Сообщение'),
        submitButtonTitle: getNotificationText(locale, 'Send', 'Gönder', 'Отправить'),
      },
    },
  ]);
  await registerMessagePrefetchTask();

  if (Platform.OS === 'ios') {
    const voipToken = await registerIosVoipPushTokenWithTimeout();

    if (voipToken) {
      await registerPushToken(serverUrl, {
        locale,
        platform: 'ios',
        provider: 'apns_voip',
        token: voipToken,
      });
    }
  }

  const existingPermissions = await Notifications.getPermissionsAsync();
  const finalPermissions = existingPermissions.granted
    ? existingPermissions
    : await Notifications.requestPermissionsAsync();

  if (!finalPermissions.granted) {
    return;
  }

  const nativeToken = await Notifications.getDevicePushTokenAsync();

  await registerPushToken(serverUrl, {
    locale,
    platform: Platform.OS,
    provider: nativeToken.type === 'ios' ? 'apns' : 'fcm',
    token: nativeToken.data,
  });

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const expoToken = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);

  await registerPushToken(serverUrl, {
    locale,
    platform: Platform.OS,
    provider: 'expo',
    token: expoToken.data,
  });
}

async function registerIosVoipPushTokenWithTimeout() {
  return Promise.race([
    registerIosVoipPushToken(),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 3500);
    }),
  ]);
}

function getNotificationText(locale: AppLanguage, english: string, turkish: string, russian: string) {
  if (locale === 'tr') {
    return turkish;
  }

  if (locale === 'ru') {
    return russian;
  }

  return english;
}

async function registerMessagePrefetchTask() {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(MESSAGE_PREFETCH_TASK).catch(() => false);

  if (!isRegistered) {
    await Notifications.registerTaskAsync(MESSAGE_PREFETCH_TASK).catch(() => undefined);
  }
}

function getNotificationTaskData(data: unknown) {
  if (data && typeof data === 'object') {
    if ('dataString' in data && typeof (data as { dataString?: unknown }).dataString === 'string') {
      try {
        return JSON.parse((data as { dataString: string }).dataString) as IncomingCallNotificationData;
      } catch {
        return {};
      }
    }

    if ('data' in data) {
      const maybeData = (data as { data?: unknown }).data;

      if (maybeData && typeof maybeData === 'object') {
        return maybeData as IncomingCallNotificationData;
      }
    }
  }

  return data as IncomingCallNotificationData;
}

async function acknowledgePushDelivery(data: IncomingCallNotificationData) {
  if (typeof data.deliveryReceiptUrl !== 'string' || !/^https?:\/\//i.test(data.deliveryReceiptUrl)) {
    return;
  }

  await fetch(data.deliveryReceiptUrl, { method: 'POST' }).catch(() => undefined);
}

async function handleNotificationData(
  data: IncomingCallNotificationData,
  actionIdentifier: string,
  serverUrl: string | null,
  userText?: string,
) {
  if (
    data.type === 'message' &&
    typeof data.conversationId === 'string'
  ) {
    logMessageDeliveryDiagnostic('notification-message-action', {
      actionIdentifier,
      conversationId: data.conversationId,
      messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
      serverUrlConfigured: !!serverUrl,
    });

    if (actionIdentifier === 'mark-read') {
      if (serverUrl) {
        const didMarkRead = await markConversationRead(serverUrl, data.conversationId, 'notification_action')
          .then(() => true)
          .catch(() => false);

        if (didMarkRead) {
          await dismissMessageNotificationsForConversation(data.conversationId);
        }
      }
      return;
    }

    if (actionIdentifier === 'reply') {
      // Native Android/iOS handlers send quick replies without foregrounding the app.
      return;
    }

    void dismissMessageNotificationsForConversation(data.conversationId);
    logMessageDeliveryDiagnostic('notification-message-navigate-chat', {
      conversationId: data.conversationId,
      messageId: typeof data.messageId === 'string' ? data.messageId : undefined,
      title: typeof data.title === 'string' ? data.title : undefined,
    });
    navigateToChat({
      conversationId: data.conversationId,
      openReason: 'notification',
      targetMessageId: typeof data.messageId === 'string' ? data.messageId : undefined,
      title: typeof data.title === 'string' ? data.title : 'Chat',
    });
    return;
  }

  if (
    data.type !== 'incoming-call' ||
    typeof data.callId !== 'string' ||
    typeof data.conversationId !== 'string'
  ) {
    return;
  }

  if (isExpiredIncomingCall(data)) {
    endIosCallKitCall(data.callId);
    return;
  }

  if (actionIdentifier === 'cancel' || actionIdentifier === 'decline') {
    endIosCallKitCall(data.callId);
    if (serverUrl) {
      await endCall(serverUrl, data.callId).catch(() => undefined);
    }
    await useAppStore.getState().recordCallLog({
      conversationId: data.conversationId,
      direction: 'incoming',
      id: data.callId,
      mode: data.mode === 'VIDEO' || data.mode === 'video' ? 'video' : 'voice',
      status: 'declined',
      title: typeof data.title === 'string' ? data.title : 'Incoming call',
    });
    return;
  }

  if (actionIdentifier !== 'accept') {
    navigateToChats();
    return;
  }

  beginCallOnlyAccess(data.callId);

  navigateToIncomingCall({
    answeredByNative: true,
    autoJoin: data.autoJoin === true || data.autoJoin === 'true',
    callId: data.callId,
    forceCallOnlyAccess: true,
    conversationId: data.conversationId,
    isGroupCall: data.isGroupCall === true || data.isGroupCall === 'true',
    mode: data.mode === 'VIDEO' || data.mode === 'video' ? 'video' : 'voice',
    participantNames: parseParticipantNames(data.participantNames),
    title: typeof data.title === 'string' ? data.title : 'Incoming call',
  });

  if (serverUrl) {
    void ringCall(serverUrl, data.callId).catch(() => undefined);
  }
}

export async function handleIncomingCallUrl(url: string, serverUrl: string | null) {
  try {
    if (handledIncomingCallUrls.has(url)) {
      return;
    }

    const parsed = new URL(url);

    if (
      (parsed.protocol !== 'meetvap:' && parsed.protocol !== 'com.meetvap.app:') ||
      (parsed.hostname !== 'incoming-call' && parsed.hostname !== 'chats' && parsed.hostname !== 'message')
    ) {
      return;
    }

    handledIncomingCallUrls.add(url);

    const callId = parsed.searchParams.get('callId');
    const conversationId = parsed.searchParams.get('conversationId');

    if (parsed.hostname === 'message' && conversationId) {
      navigateToChat({
        conversationId,
        title: parsed.searchParams.get('title') || 'Chat',
      });
      return;
    }

    if (!callId || !conversationId) {
      return;
    }

    if (parsed.hostname === 'chats') {
      navigateToChats();
      return;
    }

    if (parsed.hostname !== 'incoming-call') {
      return;
    }

    if (isIncomingCallUrlExpired(parsed.searchParams.get('expiresAt'))) {
      endIosCallKitCall(callId);
      return;
    }

    if (parsed.searchParams.get('action') === 'decline') {
      endIosCallKitCall(callId);
      if (serverUrl) {
        await endCall(serverUrl, callId).catch(() => undefined);
      }
      await useAppStore.getState().recordCallLog({
        conversationId,
        direction: 'incoming',
        id: callId,
        mode: parsed.searchParams.get('mode') === 'VIDEO' || parsed.searchParams.get('mode') === 'video' ? 'video' : 'voice',
        status: 'declined',
        title: parsed.searchParams.get('title') || 'Incoming call',
      });
      return;
    }

    if (parsed.searchParams.get('answeredByNative') !== 'true' && parsed.searchParams.get('surface') !== 'fullscreen') {
      navigateToChats();
      return;
    }

    // Incoming calls are allowed through the app lock only for the lifetime of
    // this call. Establish that access before navigation so a cold CallKit
    // launch cannot briefly expose the PIN screen.
    beginCallOnlyAccess(callId);
    const isAnsweredByNative = parsed.searchParams.get('answeredByNative') === 'true';

    navigateToIncomingCall({
      answeredByNative: isAnsweredByNative,
      autoJoin: parsed.searchParams.get('autoJoin') === 'true',
      callId,
      forceCallOnlyAccess: true,
      conversationId,
      isGroupCall: parsed.searchParams.get('isGroupCall') === 'true',
      mode: parsed.searchParams.get('mode') === 'VIDEO' || parsed.searchParams.get('mode') === 'video' ? 'video' : 'voice',
      participantNames: parseParticipantNames(parsed.searchParams.get('participantNames')),
      title: parsed.searchParams.get('title') || 'Incoming call',
    });

    if (serverUrl) {
      void ringCall(serverUrl, callId).catch(() => undefined);
    }
  } catch {
    // Ignore URLs that do not belong to the incoming-call route.
  }
}

function isExpiredIncomingCall(data: IncomingCallNotificationData) {
  if (data.type !== 'incoming-call') {
    return false;
  }

  const expiresAt = typeof data.expiresAt === 'number'
    ? data.expiresAt
    : typeof data.expiresAt === 'string'
      ? Number(data.expiresAt)
      : Number.NaN;

  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function parseParticipantNames(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof raw !== 'string' || !raw.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  } catch {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return undefined;
}
