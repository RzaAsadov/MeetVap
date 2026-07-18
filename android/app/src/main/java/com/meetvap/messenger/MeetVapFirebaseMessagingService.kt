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

    if (isCallEndedPush(data)) {
      IncomingCallNotificationHelper.finishIncomingCall(applicationContext, data)
      return
    }

    if (data["type"] == "message") {
      if (!MainActivity.isAppInForeground) {
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

    acknowledgeRingingReceipt(data["ringingReceiptUrl"])

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

  private fun acknowledgeRingingReceipt(rawUrl: String?) {
    if (rawUrl.isNullOrBlank()) {
      return
    }

    thread(isDaemon = true, name = "meetvap-call-ringing-receipt") {
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
