package com.meetvap.messenger

import android.content.Context
import android.util.Base64
import java.io.BufferedWriter
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import org.json.JSONObject

object QuickReplyApi {
  private const val DEFAULT_SERVER_URL = "https://mm.meetvap.com"
  private const val MASK_HEADER = "x-meetvap-mask"
  private const val MASK_KEY = "meetvap:first-api-mask:v1:2026-05"
  private const val MASK_VERSION = "v1"

  fun sendTextMessage(context: Context, conversationId: String, body: String, quickReplyToken: String? = null): Boolean {
    if (!quickReplyToken.isNullOrBlank()) {
      val serverUrl = QuickReplyCredentials.load(context)?.serverUrl ?: DEFAULT_SERVER_URL
      val endpoint = "$serverUrl/conversations/quick-reply"
      val payload = JSONObject()
        .put("body", body)
        .put("token", quickReplyToken)

      return executeJsonPost(endpoint, null, payload)
    }

    val credentials = QuickReplyCredentials.load(context) ?: run {
      return false
    }
    val encodedConversationId = URLEncoder.encode(conversationId, "UTF-8")
    val endpoint = "${credentials.serverUrl}/conversations/$encodedConversationId/messages"
    val metadata = JSONObject()
      .put("clientId", "quick-reply-${UUID.randomUUID()}")

    val payload = JSONObject()
      .put("body", body)
      .put("kind", "TEXT")
      .put("metadata", metadata)

    return executeJsonPost(endpoint, credentials.authToken, payload)
  }

  fun markConversationRead(context: Context, conversationId: String): Boolean {
    val credentials = QuickReplyCredentials.load(context) ?: run {
      return false
    }
    val encodedConversationId = URLEncoder.encode(conversationId, "UTF-8")
    val endpoint = "${credentials.serverUrl}/conversations/$encodedConversationId/read"
    val payload = JSONObject()
      .put("source", "notification_action")

    return executeJsonPost(endpoint, credentials.authToken, payload)
  }

  private fun executeJsonPost(endpoint: String, authToken: String?, payload: JSONObject): Boolean {
    val maskedPayload = maskPayload(payload)
    val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
      connectTimeout = 10000
      readTimeout = 15000
      requestMethod = "POST"
      doOutput = true
      setRequestProperty("Accept", "application/json")
      if (!authToken.isNullOrBlank()) {
        setRequestProperty("Authorization", "Bearer $authToken")
      }
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty(MASK_HEADER, MASK_VERSION)
    }

    return try {
      BufferedWriter(OutputStreamWriter(connection.outputStream, Charsets.UTF_8)).use { writer ->
        writer.write(maskedPayload.toString())
      }
      val status = connection.responseCode
      if (status in 200..299) {
        true
      } else {
        false
      }
    } catch (_: Exception) {
      false
    } finally {
      connection.disconnect()
    }
  }

  private fun maskPayload(payload: JSONObject): JSONObject {
    val plainBytes = payload.toString().toByteArray(Charsets.UTF_8)
    val keyBytes = MASK_KEY.toByteArray(Charsets.UTF_8)
    val maskedBytes = ByteArray(plainBytes.size)

    for (index in plainBytes.indices) {
      maskedBytes[index] = (plainBytes[index].toInt() xor keyBytes[index % keyBytes.size].toInt()).toByte()
    }

    return JSONObject().put("payload", Base64.encodeToString(maskedBytes, Base64.NO_WRAP))
  }
}
