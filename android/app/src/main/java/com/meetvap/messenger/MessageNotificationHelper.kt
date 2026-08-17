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
  const val EXTRA_SERVER_INSTANCE_ID = "serverInstanceId"
  const val EXTRA_ACCOUNT_SERVER_URL = "accountServerUrl"
  const val EXTRA_ACCOUNT_USER_ID = "accountUserId"
  const val KEY_REPLY_TEXT = "meetvap.quickReplyText"
  private const val CHANNEL_ID = "messages"
  private const val NOTIFICATION_ID_BASE = 15300

  fun show(context: Context, data: Map<String, String>) {
    val conversationId = data["conversationId"]?.takeIf { it.isNotBlank() } ?: run {
      return
    }
    val title = data["title"]?.takeIf { it.isNotBlank() } ?: localizedText("New message", "Yeni mesaj", "Новое сообщение")
    val quickReplyToken = data["quickReplyToken"]?.takeIf { it.isNotBlank() }
    val serverInstanceId = data["serverInstanceId"]?.takeIf { it.isNotBlank() }
    val accountServerUrl = data["accountServerUrl"]?.takeIf { it.isNotBlank() }
    val accountUserId = data["accountUserId"]?.takeIf { it.isNotBlank() }
    val messageId = data["messageId"]?.takeIf { it.isNotBlank() }
    val body = data["body"]?.takeIf { it.isNotBlank() }
      ?: data["message"]?.takeIf { it.isNotBlank() }
      ?: localizedText("Message", "Mesaj", "Сообщение")

    ensureChannel(context)

    val notificationId = notificationId(conversationId, serverInstanceId, accountUserId)
    val contentIntent = PendingIntent.getActivity(
      context,
      notificationId,
      toMessageIntent(context, conversationId, title, serverInstanceId, accountServerUrl, accountUserId, messageId),
      pendingIntentFlags(),
    )
    val replyIntent = PendingIntent.getBroadcast(
      context,
      notificationId + 1,
      Intent(context, QuickReplyReceiver::class.java)
        .setAction(ACTION_QUICK_REPLY)
        .putExtra(EXTRA_CONVERSATION_ID, conversationId)
        .putExtra(EXTRA_QUICK_REPLY_TOKEN, quickReplyToken)
        .putExtra(EXTRA_SERVER_INSTANCE_ID, serverInstanceId)
        .putExtra(EXTRA_ACCOUNT_SERVER_URL, accountServerUrl)
        .putExtra(EXTRA_ACCOUNT_USER_ID, accountUserId)
        .putExtra(EXTRA_TITLE, title),
      pendingIntentFlags(mutable = true),
    )
    val markReadIntent = PendingIntent.getBroadcast(
      context,
      notificationId + 3,
      Intent(context, QuickReplyReceiver::class.java)
        .setAction(ACTION_MARK_READ)
        .putExtra(EXTRA_CONVERSATION_ID, conversationId)
        .putExtra(EXTRA_SERVER_INSTANCE_ID, serverInstanceId)
        .putExtra(EXTRA_ACCOUNT_SERVER_URL, accountServerUrl)
        .putExtra(EXTRA_ACCOUNT_USER_ID, accountUserId)
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
      .setSmallIcon(R.mipmap.ic_launcher_foreground)
      .setVibrate(longArrayOf(0, 250))
      .addAction(android.R.drawable.ic_menu_view, localizedText("Mark read", "Okundu işaretle", "Отметить прочитанным"), markReadIntent)
      .addAction(replyAction)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
  }

  fun cancel(context: Context, conversationId: String, serverInstanceId: String? = null, accountUserId: String? = null) {
    context.getSystemService(NotificationManager::class.java).cancel(notificationId(conversationId, serverInstanceId, accountUserId))
  }

  fun showReplySending(context: Context, conversationId: String, title: String, serverInstanceId: String? = null, accountServerUrl: String? = null, accountUserId: String? = null) {
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
          notificationId(conversationId, serverInstanceId, accountUserId) + 4,
          toMessageIntent(context, conversationId, title, serverInstanceId, accountServerUrl, accountUserId),
          pendingIntentFlags(),
        ),
      )
      .setContentText(localizedText("Sending reply...", "Yanıt gönderiliyor...", "Отправка ответа..."))
      .setContentTitle(title.ifBlank { localizedText("MeetVap", "MeetVap", "MeetVap") })
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setPriority(Notification.PRIORITY_LOW)
      .setSmallIcon(R.mipmap.ic_launcher_foreground)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId(conversationId, serverInstanceId, accountUserId), notification)
  }

  fun showReplyFailed(context: Context, conversationId: String, title: String, serverInstanceId: String? = null, accountServerUrl: String? = null, accountUserId: String? = null) {
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
          notificationId(conversationId, serverInstanceId, accountUserId) + 2,
          toMessageIntent(context, conversationId, title, serverInstanceId, accountServerUrl, accountUserId),
          pendingIntentFlags(),
        ),
      )
      .setContentText(localizedText("Could not send reply", "Yanıt gönderilemedi", "Не удалось отправить ответ"))
      .setContentTitle(title.ifBlank { localizedText("MeetVap", "MeetVap", "MeetVap") })
      .setOngoing(false)
      .setPriority(Notification.PRIORITY_DEFAULT)
      .setSmallIcon(R.mipmap.ic_launcher_foreground)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId(conversationId, serverInstanceId, accountUserId), notification)
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

  private fun notificationId(conversationId: String, serverInstanceId: String? = null, accountUserId: String? = null) =
    NOTIFICATION_ID_BASE + ("${serverInstanceId.orEmpty()}:${accountUserId.orEmpty()}:$conversationId".hashCode() and 0x0fff)

  private fun pendingIntentFlags(mutable: Boolean = false): Int {
    val mutabilityFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      if (mutable) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE
    } else {
      0
    }

    return PendingIntent.FLAG_UPDATE_CURRENT or mutabilityFlag
  }

  private fun toMessageIntent(
    context: Context,
    conversationId: String,
    title: String,
    serverInstanceId: String? = null,
    accountServerUrl: String? = null,
    accountUserId: String? = null,
    messageId: String? = null,
  ): Intent {
    val uri = Uri.Builder()
      .scheme("meetvap")
      .authority("message")
      .appendQueryParameter("conversationId", conversationId)
      .appendQueryParameter("title", title)
      .appendQueryParameter("serverInstanceId", serverInstanceId)
      .appendQueryParameter("accountServerUrl", accountServerUrl)
      .appendQueryParameter("accountUserId", accountUserId)
      .appendQueryParameter("messageId", messageId)
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
