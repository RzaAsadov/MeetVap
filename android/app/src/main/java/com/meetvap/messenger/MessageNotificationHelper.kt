package com.meetvap.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import java.util.Locale

object MessageNotificationHelper {
  const val ACTION_QUICK_REPLY = "com.meetvap.messenger.action.QUICK_REPLY"
  const val ACTION_MARK_READ = "com.meetvap.messenger.action.MARK_READ"
  const val EXTRA_CONVERSATION_ID = "conversationId"
  const val EXTRA_QUICK_REPLY_TOKEN = "quickReplyToken"
  const val EXTRA_TITLE = "title"
  const val KEY_REPLY_TEXT = "meetvap.quickReplyText"
  private const val CHANNEL_ID = "messages"
  private const val NOTIFICATION_ID_BASE = 15300

  fun show(context: Context, data: Map<String, String>) {
    val conversationId = data["conversationId"]?.takeIf { it.isNotBlank() } ?: run {
      return
    }
    val title = data["title"]?.takeIf { it.isNotBlank() } ?: localizedText("New message", "Yeni mesaj", "Новое сообщение")
    val quickReplyToken = data["quickReplyToken"]?.takeIf { it.isNotBlank() }
    val body = data["body"]?.takeIf { it.isNotBlank() }
      ?: data["message"]?.takeIf { it.isNotBlank() }
      ?: localizedText("Message", "Mesaj", "Сообщение")

    ensureChannel(context)

    val notificationId = notificationId(conversationId)
    val contentIntent = PendingIntent.getActivity(
      context,
      notificationId,
      toMessageIntent(context, conversationId, title),
      pendingIntentFlags(),
    )
    val replyIntent = PendingIntent.getBroadcast(
      context,
      notificationId + 1,
      Intent(context, QuickReplyReceiver::class.java)
        .setAction(ACTION_QUICK_REPLY)
        .putExtra(EXTRA_CONVERSATION_ID, conversationId)
        .putExtra(EXTRA_QUICK_REPLY_TOKEN, quickReplyToken)
        .putExtra(EXTRA_TITLE, title),
      pendingIntentFlags(mutable = true),
    )
    val markReadIntent = PendingIntent.getBroadcast(
      context,
      notificationId + 3,
      Intent(context, QuickReplyReceiver::class.java)
        .setAction(ACTION_MARK_READ)
        .putExtra(EXTRA_CONVERSATION_ID, conversationId)
        .putExtra(EXTRA_TITLE, title),
      pendingIntentFlags(),
    )
    val remoteInput = RemoteInput.Builder(KEY_REPLY_TEXT)
      .setLabel(localizedText("Message", "Mesaj", "Сообщение"))
      .build()
    val replyActionBuilder = Notification.Action.Builder(
      android.R.drawable.sym_action_chat,
      localizedText("Reply", "Yanıtla", "Ответить"),
      replyIntent,
    )
      .addRemoteInput(remoteInput)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      replyActionBuilder.setAllowGeneratedReplies(true)
    }

    val replyAction = replyActionBuilder.build()
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val notification = builder
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setContentIntent(contentIntent)
      .setContentText(body)
      .setContentTitle(title)
      .setPriority(Notification.PRIORITY_HIGH)
      .setSmallIcon(android.R.drawable.sym_action_chat)
      .setVibrate(longArrayOf(0, 250))
      .addAction(android.R.drawable.ic_menu_view, localizedText("Mark read", "Okundu işaretle", "Отметить прочитанным"), markReadIntent)
      .addAction(replyAction)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
  }

  fun cancel(context: Context, conversationId: String) {
    context.getSystemService(NotificationManager::class.java).cancel(notificationId(conversationId))
  }

  fun showReplySending(context: Context, conversationId: String, title: String) {
    ensureChannel(context)

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val notification = builder
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setContentIntent(
        PendingIntent.getActivity(
          context,
          notificationId(conversationId) + 4,
          toMessageIntent(context, conversationId, title),
          pendingIntentFlags(),
        ),
      )
      .setContentText(localizedText("Sending reply...", "Yanıt gönderiliyor...", "Отправка ответа..."))
      .setContentTitle(title.ifBlank { localizedText("MeetVap", "MeetVap", "MeetVap") })
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setPriority(Notification.PRIORITY_LOW)
      .setSmallIcon(android.R.drawable.sym_action_chat)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId(conversationId), notification)
  }

  fun showReplyFailed(context: Context, conversationId: String, title: String) {
    ensureChannel(context)

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val notification = builder
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setContentIntent(
        PendingIntent.getActivity(
          context,
          notificationId(conversationId) + 2,
          toMessageIntent(context, conversationId, title),
          pendingIntentFlags(),
        ),
      )
      .setContentText(localizedText("Could not send reply", "Yanıt gönderilemedi", "Не удалось отправить ответ"))
      .setContentTitle(title.ifBlank { localizedText("MeetVap", "MeetVap", "MeetVap") })
      .setOngoing(false)
      .setPriority(Notification.PRIORITY_DEFAULT)
      .setSmallIcon(android.R.drawable.sym_action_chat)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId(conversationId), notification)
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val channel = NotificationChannel(
      CHANNEL_ID,
      localizedText("Messages", "Mesajlar", "Сообщения"),
      NotificationManager.IMPORTANCE_HIGH,
    )
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun notificationId(conversationId: String) = NOTIFICATION_ID_BASE + (conversationId.hashCode() and 0x0fff)

  private fun pendingIntentFlags(mutable: Boolean = false): Int {
    val mutabilityFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }

    return PendingIntent.FLAG_UPDATE_CURRENT or mutabilityFlag
  }

  private fun toMessageIntent(context: Context, conversationId: String, title: String): Intent {
    val uri = Uri.Builder()
      .scheme("meetvap")
      .authority("message")
      .appendQueryParameter("conversationId", conversationId)
      .appendQueryParameter("title", title)
      .build()

    return Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
      .addCategory(Intent.CATEGORY_DEFAULT)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }

  private fun localizedText(english: String, turkish: String, russian: String): String {
    return when (Locale.getDefault().language.lowercase()) {
      "tr" -> turkish
      "ru" -> russian
      else -> english
    }
  }
}
