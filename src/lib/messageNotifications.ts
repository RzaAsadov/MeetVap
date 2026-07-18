import * as Notifications from 'expo-notifications';

import { cancelNativeMessageNotifications } from '../native/CallNative';

export async function showForegroundMessageNotification(input: {
  body: string;
  conversationId: string;
  messageId?: string;
  title: string;
}) {
  await Notifications.scheduleNotificationAsync({
    content: {
      body: input.body,
      categoryIdentifier: 'message',
      data: {
        conversationId: input.conversationId,
        messageId: input.messageId,
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
  cancelNativeMessageNotifications(conversationId);

  const notifications = await Notifications.getPresentedNotificationsAsync().catch((): Notifications.Notification[] => []);
  const matchingNotifications = notifications.filter((notification) => {
    const data = notification.request.content.data;

    return data?.type === 'message' && data.conversationId === conversationId;
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
