package com.meetvap.messenger

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class QuickReplyCredentialSet(
  val accountUserId: String?,
  val authToken: String,
  val isActive: Boolean,
  val serverInstanceId: String?,
  val serverUrl: String,
)

object QuickReplyCredentials {
  private const val PREFS_NAME = "meetvap_quick_reply"
  private const val KEY_ACCOUNTS = "accounts"
  private const val KEY_AUTH_TOKEN = "auth_token"
  private const val KEY_SERVER_URL = "server_url"

  fun save(context: Context, serverUrl: String, authToken: String) {
    replace(context, listOf(QuickReplyCredentialSet(null, authToken.trim(), true, null, serverUrl.trimEnd('/'))))
  }

  fun replaceFromJson(context: Context, accountsJson: String) {
    val values = mutableListOf<QuickReplyCredentialSet>()
    val array = runCatching { JSONArray(accountsJson) }.getOrNull() ?: JSONArray()
    for (index in 0 until array.length()) {
      val item = array.optJSONObject(index) ?: continue
      val serverUrl = item.optString("serverUrl").trim().trimEnd('/')
      val authToken = item.optString("authToken").trim()
      if (serverUrl.isBlank() || authToken.isBlank()) continue
      values.add(QuickReplyCredentialSet(
        accountUserId = item.optString("accountUserId").trim().ifBlank { null },
        authToken = authToken,
        isActive = item.optBoolean("isActive", false),
        serverInstanceId = item.optString("serverInstanceId").trim().ifBlank { null },
        serverUrl = serverUrl,
      ))
    }
    replace(context, values)
  }

  fun clear(context: Context) {
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
  }

  fun load(context: Context, serverInstanceId: String? = null, accountUserId: String? = null): QuickReplyCredentialSet? {
    val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val array = runCatching { JSONArray(prefs.getString(KEY_ACCOUNTS, "[]")) }.getOrNull() ?: JSONArray()
    val values = (0 until array.length()).mapNotNull { index ->
      val item = array.optJSONObject(index) ?: return@mapNotNull null
      val serverUrl = item.optString("serverUrl").trim().trimEnd('/')
      val authToken = item.optString("authToken").trim()
      if (serverUrl.isBlank() || authToken.isBlank()) return@mapNotNull null
      QuickReplyCredentialSet(
        accountUserId = item.optString("accountUserId").trim().ifBlank { null },
        authToken = authToken,
        isActive = item.optBoolean("isActive", false),
        serverInstanceId = item.optString("serverInstanceId").trim().ifBlank { null },
        serverUrl = serverUrl,
      )
    }
    val matched = values.firstOrNull {
      !serverInstanceId.isNullOrBlank() && !accountUserId.isNullOrBlank() &&
        it.serverInstanceId == serverInstanceId && it.accountUserId == accountUserId
    }
    if (matched != null) return matched
    if (values.isNotEmpty()) return values.first()

    val legacyUrl = prefs.getString(KEY_SERVER_URL, null)?.trim()?.trimEnd('/')
    val legacyToken = prefs.getString(KEY_AUTH_TOKEN, null)?.trim()
    return if (!legacyUrl.isNullOrBlank() && !legacyToken.isNullOrBlank()) {
      QuickReplyCredentialSet(null, legacyToken, true, null, legacyUrl)
    } else null
  }

  fun targetAccountIsActive(
    context: Context,
    serverInstanceId: String?,
    accountUserId: String?,
    accountServerUrl: String? = null,
  ): Boolean? {
    if (serverInstanceId.isNullOrBlank() || accountUserId.isNullOrBlank()) {
      return true
    }

    val credentials = loadAll(context)
    val target = credentials.firstOrNull {
      it.accountUserId == accountUserId && (
        it.serverInstanceId == serverInstanceId ||
          (!accountServerUrl.isNullOrBlank() && normalizeServerUrl(it.serverUrl) == normalizeServerUrl(accountServerUrl))
      )
    }

    return target?.isActive
  }

  private fun normalizeServerUrl(value: String) = value.trim().lowercase().trimEnd('/')

  private fun loadAll(context: Context): List<QuickReplyCredentialSet> {
    val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val array = runCatching { JSONArray(prefs.getString(KEY_ACCOUNTS, "[]")) }.getOrNull() ?: JSONArray()
    return (0 until array.length()).mapNotNull { index ->
      val item = array.optJSONObject(index) ?: return@mapNotNull null
      val serverUrl = item.optString("serverUrl").trim().trimEnd('/')
      val authToken = item.optString("authToken").trim()
      if (serverUrl.isBlank() || authToken.isBlank()) return@mapNotNull null
      QuickReplyCredentialSet(
        accountUserId = item.optString("accountUserId").trim().ifBlank { null },
        authToken = authToken,
        isActive = item.optBoolean("isActive", false),
        serverInstanceId = item.optString("serverInstanceId").trim().ifBlank { null },
        serverUrl = serverUrl,
      )
    }
  }

  private fun replace(context: Context, accounts: List<QuickReplyCredentialSet>) {
    val array = JSONArray()
    accounts.forEach { account ->
      array.put(JSONObject()
        .put("accountUserId", account.accountUserId)
        .put("authToken", account.authToken)
        .put("isActive", account.isActive)
        .put("serverInstanceId", account.serverInstanceId)
        .put("serverUrl", account.serverUrl))
    }
    context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      .edit().putString(KEY_ACCOUNTS, array.toString()).apply()
  }
}
