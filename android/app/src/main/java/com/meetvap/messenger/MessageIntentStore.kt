package com.meetvap.messenger

import android.content.Intent

object MessageIntentStore {
  private val lock = Any()
  private var pendingUrl: String? = null

  fun remember(intent: Intent?) {
    val data = intent?.data ?: return
    if ((data.scheme != "meetvap" && data.scheme != "com.meetvap.app") || data.host != "message") {
      return
    }

    synchronized(lock) {
      pendingUrl = data.toString()
    }
  }

  fun consume(): String? {
    synchronized(lock) {
      val url = pendingUrl
      pendingUrl = null
      return url
    }
  }
}
