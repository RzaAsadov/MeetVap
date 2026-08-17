import * as Notifications from 'expo-notifications';

import { getActiveAccountSync } from './accountRegistry';
import { cancelNativeMessageNotifications } from '../native/CallNative';

export async function showForegroundMessageNotification(input: {
  body: string;
  conversationId: string;
  messageId?: string;
  title: string;
}) {
  const account = getActiveAccountSync();
  await Notifications.scheduleNotificationAsync({
    content: {
      body: input.body,
      categoryIdentifier: 'message',
      data: {
        conversationId: input.conversationId,
        accountServerUrl: account?.serverUrl,
        accountUserId: account?.userId,
        messageId: input.messageId,
        presentationSource: 'realtime',
        serverInstanceId: account?.serverInstanceId,
        title: input.title,
        type: 'message',
      },
      sound: 'default',
      title: input.title,
    },
    trigger: null,
  }).catch(() => undefined);
}

export async function dismissMessageNotificationsForConversation(conversationId: string) {
  const account = getActiveAccountSync();
  cancelNativeMessageNotifications(conversationId, account?.serverInstanceId, account?.userId);

  const notifications = await Notifications.getPresentedNotificationsAsync().catch((): Notifications.Notification[] => []);
  const matchingNotifications = notifications.filter((notification) => {
    const data = notification.request.content.data;
    const matchesAccount = !account || !data?.serverInstanceId || !data?.accountUserId || (
      data.serverInstanceId === account.serverInstanceId && data.accountUserId === account.userId
    );

    return data?.type === 'message' && data.conversationId === conversationId && matchesAccount;
  });

  await Promise.all(matchingNotifications.map((notification) => (
    Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined)
  )));
}

export async function dismissAllMessageNotifications() {
  const notifications = await Notifications.getPresentedNotificationsAsync().catch((): Notifications.Notification[] => []);
  const messageNotifications = notifications.filter((notification) => (
    notification.request.content.data?.type === 'message'
  ));

  await Promise.all(messageNotifications.map((notification) => (
    Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined)
  )));
}
