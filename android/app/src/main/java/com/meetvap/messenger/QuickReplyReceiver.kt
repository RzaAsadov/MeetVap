package com.meetvap.messenger

import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlin.concurrent.thread

class QuickReplyReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != MessageNotificationHelper.ACTION_QUICK_REPLY && intent.action != MessageNotificationHelper.ACTION_MARK_READ) {
      return
    }

    val conversationId = intent.getStringExtra(MessageNotificationHelper.EXTRA_CONVERSATION_ID)?.takeIf { it.isNotBlank() } ?: run {
      return
    }
    val title = intent.getStringExtra(MessageNotificationHelper.EXTRA_TITLE) ?: "MeetVap"
    val quickReplyToken = intent.getStringExtra(MessageNotificationHelper.EXTRA_QUICK_REPLY_TOKEN)?.takeIf { it.isNotBlank() }
    val isMarkReadOnly = intent.action == MessageNotificationHelper.ACTION_MARK_READ
    val replyText = RemoteInput.getResultsFromIntent(intent)
      ?.getCharSequence(MessageNotificationHelper.KEY_REPLY_TEXT)
      ?.toString()
      ?.trim()

    if (!isMarkReadOnly && replyText.isNullOrBlank()) {
      return
    }

    val pendingResult = goAsync()

    if (!isMarkReadOnly) {
      MessageNotificationHelper.showReplySending(context.applicationContext, conversationId, title)
    }

    thread(isDaemon = true, name = "meetvap-quick-reply") {
      try {
        val sent = if (isMarkReadOnly) {
          true
        } else {
          QuickReplyApi.sendTextMessage(context.applicationContext, conversationId, replyText.orEmpty(), quickReplyToken)
        }

        if (sent) {
          val didMarkRead = if (!isMarkReadOnly && quickReplyToken != null) {
            true
          } else {
            QuickReplyApi.markConversationRead(context.applicationContext, conversationId)
          }

          if (!isMarkReadOnly || didMarkRead) {
            MessageNotificationHelper.cancel(context.applicationContext, conversationId)
          }
        } else {
          MessageNotificationHelper.showReplyFailed(context.applicationContext, conversationId, title)
        }
      } finally {
        pendingResult.finish()
      }
    }
  }
}
