package com.meetvap.messenger

import android.content.Context

data class QuickReplyCredentialSet(
  val authToken: String,
  val serverUrl: String,
)

object QuickReplyCredentials {
  private const val PREFS_NAME = "meetvap_quick_reply"
  private const val KEY_AUTH_TOKEN = "auth_token"
  private const val KEY_SERVER_URL = "server_url"

  fun save(context: Context, serverUrl: String, authToken: String) {
    context.applicationContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SERVER_URL, serverUrl.trim())
      .putString(KEY_AUTH_TOKEN, authToken.trim())
      .apply()
  }

  fun clear(context: Context) {
    context.applicationContext
      .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .clear()
      .apply()
  }

  fun load(context: Context): QuickReplyCredentialSet? {
    val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val serverUrl = prefs.getString(KEY_SERVER_URL, null)?.trim()?.takeIf { it.isNotBlank() }
    val authToken = prefs.getString(KEY_AUTH_TOKEN, null)?.trim()?.takeIf { it.isNotBlank() }

    if (serverUrl == null || authToken == null) {
      return null
    }

    return QuickReplyCredentialSet(authToken = authToken, serverUrl = serverUrl.trimEnd('/'))
  }
}
