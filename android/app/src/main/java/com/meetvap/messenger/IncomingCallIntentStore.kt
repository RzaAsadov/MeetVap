package com.meetvap.messenger

import android.content.Intent

object IncomingCallIntentStore {
  private val lock = Any()
  private var pendingUrl: String? = null

  fun remember(intent: Intent?) {
    val url = getIncomingCallUrl(intent) ?: return

    synchronized(lock) {
      pendingUrl = url
    }
  }

  fun consume(): String? {
    synchronized(lock) {
      val url = pendingUrl
      pendingUrl = null
      return url
    }
  }

  fun peek(): String? {
    synchronized(lock) {
      return pendingUrl
    }
  }

  private fun getIncomingCallUrl(intent: Intent?): String? {
    val data = intent?.data ?: return null

    if (data.scheme != "meetvap" && data.scheme != "com.meetvap.app") {
      return null
    }

    if (data.host != "incoming-call") {
      return null
    }

    return data.toString()
  }
}
