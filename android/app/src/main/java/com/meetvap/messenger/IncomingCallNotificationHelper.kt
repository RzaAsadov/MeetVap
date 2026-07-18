package com.meetvap.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import java.util.Locale
import org.json.JSONArray

object IncomingCallNotificationHelper {
  private const val CHANNEL_ID = "incoming-calls-fullscreen"
  private const val NOTIFICATION_ID_BASE = 8700
  private const val RINGTONE_TIMEOUT_MS = 60000L
  private const val FINISHED_CALLS_PREFS = "meetvap_finished_calls"
  private const val FINISHED_CALL_TTL_MS = 10 * 60 * 1000L
  private val mainHandler = Handler(Looper.getMainLooper())
  private var ringtonePlayer: MediaPlayer? = null
  private val stopRingtoneRunnable = Runnable { stopRingtone() }
  private val activePayloads = mutableMapOf<String, IncomingCallPayload>()

  fun show(context: Context, payload: IncomingCallPayload) {
    if (isRecentlyFinishedCall(context, payload.callId)) {
      return
    }

    ensureChannel(context)
    startRingtone(context.applicationContext)
    activePayloads[payload.callId] = payload

    val notificationId = NOTIFICATION_ID_BASE + (payload.callId.hashCode() and 0x0fff)
    val fullScreenIntent = PendingIntent.getActivity(
      context,
      notificationId,
      payload.toIncomingCallIntent(context, answeredByNative = false),
      pendingIntentFlags(),
    )
    val contentIntent = PendingIntent.getActivity(
      context,
      notificationId + 3,
      payload.toIncomingCallIntent(context, answeredByNative = false),
      pendingIntentFlags(),
    )
    val acceptIntent = PendingIntent.getActivity(
      context,
      notificationId + 1,
      payload.toIncomingCallIntent(context, answeredByNative = true),
      pendingIntentFlags(),
    )
    val declineIntent = PendingIntent.getActivity(
      context,
      notificationId + 2,
      payload.toIncomingCallIntent(context, action = "decline"),
      pendingIntentFlags(),
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val body = payload.body.ifBlank { getIncomingCallText(payload) }

    builder
      .setCategory(Notification.CATEGORY_CALL)
      .setContentIntent(contentIntent)
      .setContentText(body)
      .setContentTitle(payload.title.ifBlank { payload.fallbackTitle.ifBlank { localizedText(payload.locale, "Incoming call", "Gelen arama") } })
      .setFullScreenIntent(fullScreenIntent, true)
      .setOngoing(true)
      .setPriority(Notification.PRIORITY_MAX)
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .setTimeoutAfter(RINGTONE_TIMEOUT_MS)
      .setVibrate(longArrayOf(0, 500, 250, 500))
      .setVisibility(Notification.VISIBILITY_PUBLIC)

    val acceptTitle = payload.acceptTitle.ifBlank { localizedText(payload.locale, "Accept", "Cevapla") }
    val declineTitle = payload.declineTitle.ifBlank { localizedText(payload.locale, "Decline", "Reddet") }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val caller = Person.Builder()
        .setImportant(true)
        .setName(payload.title.ifBlank { payload.fallbackTitle.ifBlank { localizedText(payload.locale, "Incoming call", "Gelen arama") } })
        .build()

      builder
        .setStyle(Notification.CallStyle.forIncomingCall(caller, declineIntent, acceptIntent))
        .addPerson(caller)
    } else {
      builder
        .addAction(android.R.drawable.sym_action_call, acceptTitle, acceptIntent)
        .addAction(android.R.drawable.ic_menu_close_clear_cancel, declineTitle, declineIntent)
    }

    val notification = builder.build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
  }

  fun cancel(context: Context, callId: String?) {
    stopRingtone()

    if (callId.isNullOrBlank()) {
      return
    }

    activePayloads.remove(callId)
    val notificationId = NOTIFICATION_ID_BASE + (callId.hashCode() and 0x0fff)
    context.getSystemService(NotificationManager::class.java).cancel(notificationId)
  }

  fun finishIncomingCall(context: Context, data: Map<String, String>) {
    stopRingtone()

    val callId = data["callId"]?.takeIf { it.isNotBlank() } ?: return
    rememberFinishedCall(context, callId)
    val cachedPayload = activePayloads.remove(callId)

    if (cachedPayload == null && data["callStatus"]?.uppercase() == "ENDED") {
      return
    }

    val payload = cachedPayload ?: IncomingCallPayload.fromMap(data) ?: return
    val notificationId = NOTIFICATION_ID_BASE + (callId.hashCode() and 0x0fff)
    val contentIntent = PendingIntent.getActivity(
      context,
      notificationId + 4,
      payload.toChatsIntent(context),
      pendingIntentFlags(),
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(context, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(context)
    }
    val notification = builder
      .setAutoCancel(true)
      .setCategory(Notification.CATEGORY_CALL)
      .setContentIntent(contentIntent)
      .setContentText(getFinishedCallText(payload, data["callStatus"]))
      .setContentTitle(payload.title.ifBlank { localizedText(payload.locale, "Call", "Arama") })
      .setOngoing(false)
      .setOnlyAlertOnce(true)
      .setPriority(Notification.PRIORITY_DEFAULT)
      .setSmallIcon(android.R.drawable.stat_notify_missed_call)
      .build()

    context.getSystemService(NotificationManager::class.java).notify(notificationId, notification)
  }

  fun stopRingtone() {
    mainHandler.post {
      mainHandler.removeCallbacks(stopRingtoneRunnable)
      ringtonePlayer?.let { player ->
        runCatching {
          if (player.isPlaying) {
            player.stop()
          }
        }
        player.release()
      }
      ringtonePlayer = null
    }
  }

  private fun getFinishedCallText(payload: IncomingCallPayload, callStatus: String?): String {
    val callType = if (payload.mode.equals("VIDEO", ignoreCase = true)) {
      localizedText(payload.locale, "video call", "video araması")
    } else {
      localizedText(payload.locale, "voice call", "sesli arama")
    }

    return when (callStatus?.uppercase()) {
      "DECLINED" -> localizedText(payload.locale, "Declined $callType", "Reddedilen $callType")
      "ENDED" -> localizedText(payload.locale, "Call ended", "Arama bitti")
      else -> localizedText(payload.locale, "Missed $callType", "Cevapsız $callType")
    }
  }

  private fun getIncomingCallText(payload: IncomingCallPayload): String {
    val isVideo = payload.mode.equals("VIDEO", ignoreCase = true) || payload.mode.equals("video", ignoreCase = true)

    return if (isTurkishLocale(payload.locale)) {
      if (isVideo) {
        if (payload.isGroupCall) "Gelen grup video araması" else "Gelen video araması"
      } else {
        if (payload.isGroupCall) "Gelen grup sesli araması" else "Gelen sesli arama"
      }
    } else if (isVideo) {
      if (payload.isGroupCall) "Incoming group video call" else "Incoming video call"
    } else {
      if (payload.isGroupCall) "Incoming group voice call" else "Incoming voice call"
    }
  }

  private fun localizedText(locale: String, english: String, turkish: String): String {
    return if (isTurkishLocale(locale)) turkish else english
  }

  private fun isTurkishLocale(locale: String = ""): Boolean {
    return locale.equals("tr", ignoreCase = true) || (locale.isBlank() && Locale.getDefault().language.equals("tr", ignoreCase = true))
  }

  private fun rememberFinishedCall(context: Context, callId: String) {
    val now = System.currentTimeMillis()
    val prefs = context.getSharedPreferences(FINISHED_CALLS_PREFS, Context.MODE_PRIVATE)

    prefs.edit()
      .putLong(callId, now)
      .apply()
  }

  private fun isRecentlyFinishedCall(context: Context, callId: String): Boolean {
    val now = System.currentTimeMillis()
    val prefs = context.getSharedPreferences(FINISHED_CALLS_PREFS, Context.MODE_PRIVATE)
    val finishedAt = prefs.getLong(callId, 0L)

    if (finishedAt <= 0L) {
      return false
    }

    if (now - finishedAt <= FINISHED_CALL_TTL_MS) {
      return true
    }

    prefs.edit().remove(callId).apply()
    return false
  }

  private fun ensureChannel(context: Context) {
    ensureIncomingCallChannel(context)
  }

  fun ensureIncomingCallChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = context.getSystemService(NotificationManager::class.java)
    val existing = manager.getNotificationChannel(CHANNEL_ID)

    if (existing != null && existing.importance >= NotificationManager.IMPORTANCE_HIGH) {
      return
    }

    val channel = NotificationChannel(CHANNEL_ID, localizedText("", "Incoming calls", "Gelen aramalar"), NotificationManager.IMPORTANCE_HIGH).apply {
      description = localizedText("", "Incoming voice and video calls", "Gelen sesli ve görüntülü aramalar")
      enableVibration(true)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      setBypassDnd(true)
      setShowBadge(false)
      setSound(null, null)
    }

    manager.createNotificationChannel(channel)
  }

  private fun startRingtone(context: Context) {
    mainHandler.post {
      if (ringtonePlayer?.isPlaying == true) {
        mainHandler.removeCallbacks(stopRingtoneRunnable)
        mainHandler.postDelayed(stopRingtoneRunnable, RINGTONE_TIMEOUT_MS)
        return@post
      }

      runCatching {
        ringtonePlayer?.release()
        ringtonePlayer = null

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.mode = AudioManager.MODE_NORMAL
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = false

        val descriptor = context.resources.openRawResourceFd(R.raw.ringtone)
        val player = MediaPlayer().apply {
          isLooping = true
          setVolume(0.72f, 0.72f)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            setAudioAttributes(
              AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
            )
          } else {
            @Suppress("DEPRECATION")
            setAudioStreamType(AudioManager.STREAM_RING)
          }
          setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.length)
          descriptor.close()
          prepare()
          start()
        }

        ringtonePlayer = player
        mainHandler.removeCallbacks(stopRingtoneRunnable)
        mainHandler.postDelayed(stopRingtoneRunnable, RINGTONE_TIMEOUT_MS)
      }.onFailure {
        ringtonePlayer?.release()
        ringtonePlayer = null
      }
    }
  }

  private fun pendingIntentFlags(): Int {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
  }
}

data class IncomingCallPayload(
  val acceptTitle: String = "",
  val autoJoin: Boolean = false,
  val body: String = "",
  val callId: String,
  val conversationId: String,
  val declineTitle: String = "",
  val fallbackTitle: String = "",
  val isGroupCall: Boolean = false,
  val locale: String = "",
  val mode: String,
  val participantNames: List<String> = emptyList(),
  val title: String,
) {
  fun toIncomingCallIntent(context: Context, answeredByNative: Boolean = false, action: String? = null): Intent {
    val uriBuilder = Uri.Builder()
      .scheme("meetvap")
      .authority("incoming-call")
      .appendQueryParameter("callId", callId)
      .appendQueryParameter("conversationId", conversationId)
      .appendQueryParameter("mode", mode)
      .appendQueryParameter("title", title)
      .appendQueryParameter("isGroupCall", isGroupCall.toString())
      .appendQueryParameter("autoJoin", autoJoin.toString())
      .appendQueryParameter("surface", "fullscreen")

    if (answeredByNative) {
      uriBuilder.appendQueryParameter("answeredByNative", "true")
    }

    if (!action.isNullOrBlank()) {
      uriBuilder.appendQueryParameter("action", action)
    }

    if (participantNames.isNotEmpty()) {
      uriBuilder.appendQueryParameter("participantNames", JSONArray(participantNames).toString())
    }

    return Intent(Intent.ACTION_VIEW, uriBuilder.build(), context, MainActivity::class.java)
      .addCategory(Intent.CATEGORY_DEFAULT)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      .putExtra("meetvapIncomingCallId", callId)
  }

  fun toChatsIntent(context: Context): Intent {
    val uri = Uri.Builder()
      .scheme("meetvap")
      .authority("chats")
      .appendQueryParameter("conversationId", conversationId)
      .appendQueryParameter("callId", callId)
      .build()

    return Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
      .addCategory(Intent.CATEGORY_DEFAULT)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      .putExtra("meetvapIncomingCallId", callId)
  }

  companion object {
    fun fromReadableMap(data: ReadableMap): IncomingCallPayload? {
      val callId = data.stringValue("callId")?.takeIf { it.isNotBlank() } ?: return null
      val conversationId = data.stringValue("conversationId")?.takeIf { it.isNotBlank() } ?: return null
      val mode = data.stringValue("mode")?.takeIf { it.isNotBlank() } ?: "VOICE"
      val title = data.stringValue("title")?.takeIf { it.isNotBlank() } ?: ""

      return IncomingCallPayload(
        acceptTitle = data.stringValue("acceptTitle") ?: "",
        autoJoin = data.booleanValue("autoJoin"),
        body = data.stringValue("body") ?: "",
        callId = callId,
        conversationId = conversationId,
        declineTitle = data.stringValue("declineTitle") ?: "",
        fallbackTitle = data.stringValue("fallbackTitle") ?: "",
        isGroupCall = data.booleanValue("isGroupCall"),
        locale = data.stringValue("locale") ?: "",
        mode = mode,
        participantNames = data.stringListValue("participantNames"),
        title = title,
      )
    }

    fun fromMap(data: Map<String, String>): IncomingCallPayload? {
      val callId = data["callId"]?.takeIf { it.isNotBlank() } ?: return null
      val conversationId = data["conversationId"]?.takeIf { it.isNotBlank() } ?: return null
      val mode = data["mode"]?.takeIf { it.isNotBlank() } ?: "VOICE"
      val title = data["title"]?.takeIf { it.isNotBlank() } ?: ""
      val participantNames = parseParticipantNames(data["participantNames"])

      return IncomingCallPayload(
        acceptTitle = data["acceptTitle"] ?: "",
        autoJoin = data["autoJoin"] == "true",
        body = data["body"] ?: "",
        callId = callId,
        conversationId = conversationId,
        declineTitle = data["declineTitle"] ?: "",
        fallbackTitle = data["fallbackTitle"] ?: "",
        isGroupCall = data["isGroupCall"] == "true",
        locale = data["locale"] ?: "",
        mode = mode,
        participantNames = participantNames,
        title = title,
      )
    }

    private fun parseParticipantNames(raw: String?): List<String> {
      if (raw.isNullOrBlank()) {
        return emptyList()
      }

      return runCatching {
        val array = JSONArray(raw)
        (0 until array.length()).mapNotNull { index -> array.optString(index).takeIf { it.isNotBlank() } }
      }.getOrElse {
        raw.split(',').map { it.trim() }.filter { it.isNotBlank() }
      }
    }

    private fun ReadableMap.stringValue(key: String): String? {
      if (!hasKey(key) || isNull(key)) {
        return null
      }

      return when (getType(key)) {
        ReadableType.String -> getString(key)
        ReadableType.Number -> getDouble(key).toString()
        ReadableType.Boolean -> getBoolean(key).toString()
        else -> null
      }
    }

    private fun ReadableMap.booleanValue(key: String): Boolean {
      if (!hasKey(key) || isNull(key)) {
        return false
      }

      return when (getType(key)) {
        ReadableType.Boolean -> getBoolean(key)
        ReadableType.String -> getString(key) == "true"
        else -> false
      }
    }

    private fun ReadableMap.stringListValue(key: String): List<String> {
      if (!hasKey(key) || isNull(key)) {
        return emptyList()
      }

      return when (getType(key)) {
        ReadableType.Array -> {
          val array = getArray(key) ?: return emptyList()
          (0 until array.size()).mapNotNull { index ->
            when (array.getType(index)) {
              ReadableType.String -> array.getString(index)?.takeIf { it.isNotBlank() }
              else -> null
            }
          }
        }
        ReadableType.String -> parseParticipantNames(getString(key))
        else -> emptyList()
      }
    }
  }
}
