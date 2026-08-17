package com.meetvap.messenger

import android.util.Log
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class MeetVapFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val data = remoteMessage.data
    acknowledgeReceipt(data["deliveryReceiptUrl"], "meetvap-push-delivery-receipt")

    if (isCallEndedPush(data)) {
      IncomingCallNotificationHelper.finishIncomingCall(applicationContext, data)
      return
    }

    if (data["type"] == "message") {
      val targetAccountIsActive = QuickReplyCredentials.targetAccountIsActive(
        applicationContext,
        data["serverInstanceId"],
        data["accountUserId"],
        data["accountServerUrl"],
      )
      if (MainActivity.isAppInForeground) {
        when (targetAccountIsActive) {
          true -> return // Realtime owns the active account.
          false -> MessageNotificationHelper.show(applicationContext, data)
          null -> super.onMessageReceived(remoteMessage)
        }
      } else {
        MessageNotificationHelper.show(applicationContext, data)
      }
      return
    }

    if (data["type"] != "incoming-call") {
      super.onMessageReceived(remoteMessage)
      return
    }

    val payload = IncomingCallPayload.fromMap(data)

    if (payload == null) {
      Log.w("MeetVapFCM", "Ignoring incoming call push without call identifiers")
      return
    }

    if (!payload.isFresh()) {
      Log.i("MeetVapFCM", "Ignoring expired incoming call push for ${payload.callId}")
      IncomingCallNotificationHelper.cancel(applicationContext, payload.callId)
      return
    }

    acknowledgeReceipt(data["ringingReceiptUrl"], "meetvap-call-ringing-receipt")

    if (MainActivity.isAppInForeground) {
      return
    }

    IncomingCallNotificationHelper.show(applicationContext, payload)
  }

  private fun isCallEndedPush(data: Map<String, String>): Boolean {
    val type = data["type"]?.lowercase()
    val callStatus = data["callStatus"]?.uppercase()

    return type == "call-ended" ||
      type == "call-cancelled" ||
      callStatus == "CANCELLED" ||
      callStatus == "DECLINED" ||
      callStatus == "ENDED" ||
      callStatus == "MISSED"
  }

  private fun acknowledgeReceipt(rawUrl: String?, threadName: String) {
    if (rawUrl.isNullOrBlank()) {
      return
    }

    thread(isDaemon = true, name = threadName) {
      runCatching {
        val url = URL(rawUrl)

        if (url.protocol != "https" && url.protocol != "http") {
          return@runCatching
        }

        val connection = url.openConnection() as HttpURLConnection

        try {
          connection.connectTimeout = 5000
          connection.readTimeout = 5000
          connection.requestMethod = "POST"
          connection.responseCode
        } finally {
          connection.disconnect()
        }
      }
    }
  }
}
