package com.meetvap.messenger

import android.app.PictureInPictureParams
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.graphics.Rect
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.media.AudioAttributes
import android.media.MediaScannerConnection
import android.media.MediaPlayer
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Rational
import android.util.Log
import android.view.WindowManager
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SonicAudioProcessor
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.livekit.reactnative.audio.processing.CustomAudioProcessingController
import com.livekit.reactnative.audio.processing.AudioProcessingController
import com.livekit.reactnative.audio.processing.AudioProcessorInterface
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import com.oney.WebRTCModule.WebRTCModuleOptions
import org.webrtc.AudioProcessingFactory
import org.json.JSONArray
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class CallNativeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "CallNative"

  @ReactMethod
  fun getAppVersion(promise: Promise) {
    try {
      promise.resolve(reactContext.packageManager.getPackageInfo(reactContext.packageName, 0).versionName)
    } catch (error: Exception) {
      promise.reject("app_version_failed", error)
    }
  }

  @ReactMethod
  fun setQuickReplyCredentials(serverUrl: String, authToken: String) {
    QuickReplyCredentials.save(reactContext.applicationContext, serverUrl, authToken)
  }

  @ReactMethod
  fun clearQuickReplyCredentials() {
    QuickReplyCredentials.clear(reactContext.applicationContext)
  }

  @ReactMethod
  fun setMediaViewerOrientationUnlocked(unlocked: Boolean) {
    mainHandler.post {
      getCurrentActivity()?.requestedOrientation = if (unlocked) {
        ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
      } else {
        ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
      }
    }
  }

  @ReactMethod
  fun requestPlayIntegrityToken(nonce: String, promise: Promise) {
    try {
      val integrityManager = IntegrityManagerFactory.create(reactContext.applicationContext)
      val request = IntegrityTokenRequest.builder()
        .setNonce(nonce)
        .build()

      integrityManager.requestIntegrityToken(request)
        .addOnSuccessListener { response ->
          promise.resolve(response.token())
        }
        .addOnFailureListener { error ->
          promise.reject("play_integrity_failed", error)
        }
    } catch (error: Exception) {
      promise.reject("play_integrity_failed", error)
    }
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var incomingRingtonePlayer: MediaPlayer? = null
  private var outgoingRingbackPlayer: MediaPlayer? = null
  private var outgoingRingbackMode = "voice"
  private var isOutgoingRingbackActive = false
  private var outgoingRingbackLastPositionMs = -1
  private var outgoingRingbackLastProgressAtMs = 0L
  private var outgoingRingbackNextReplayAtMs = 0L
  private val outgoingRingbackRouteRunnable = object : Runnable {
    override fun run() {
      if (!isOutgoingRingbackActive) {
        return
      }

      runCatching {
        val preferredDevice = selectDefaultOutgoingRingbackRoute(outgoingRingbackMode)
        val player = outgoingRingbackPlayer

        if (player == null) {
          outgoingRingbackPlayer = createOutgoingRingbackPlayer(preferredDevice)
        } else {
          applyOutgoingRingbackPreferredDevice(player, preferredDevice)
          recoverOutgoingRingbackPlayer(player)
        }
      }.onFailure {
        outgoingRingbackPlayer?.release()
        outgoingRingbackPlayer = runCatching {
          createOutgoingRingbackPlayer(selectDefaultOutgoingRingbackRoute(outgoingRingbackMode))
        }.getOrNull()
      }

      if (!isOutgoingRingbackActive) {
        return
      }

      mainHandler.postDelayed(this, 350L)
    }
  }
  private val pendingShareIntents = mutableListOf<Intent>()
  private val pendingShareLock = Any()

  private var proximityWakeLock: PowerManager.WakeLock? = null
  @Volatile
  private var selectedCallAudioRouteId: String? = null
  @Volatile
  private var connectedBluetoothScoRouteId: String? = null
  @Volatile
  private var pendingBluetoothScoRouteId: String? = null
  @Volatile
  private var pendingBluetoothScoStartedAtMs = 0L
  private val bluetoothScoReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED) {
        return
      }

      val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val scoState = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_ERROR)
      when (scoState) {
        AudioManager.SCO_AUDIO_STATE_CONNECTED -> {
          val bluetoothDevices = getLegacyCallAudioDevices(audioManager).filter(::isBluetoothCallDevice)
          connectedBluetoothScoRouteId = selectedCallAudioRouteId
            ?.takeIf { selectedRouteId ->
              bluetoothDevices.any { callAudioRouteId(it) == selectedRouteId }
            }
            ?: bluetoothDevices.firstOrNull()?.let(::callAudioRouteId)
          pendingBluetoothScoRouteId = null
          pendingBluetoothScoStartedAtMs = 0L
        }
        AudioManager.SCO_AUDIO_STATE_DISCONNECTED,
        AudioManager.SCO_AUDIO_STATE_ERROR -> {
          connectedBluetoothScoRouteId = null
          pendingBluetoothScoRouteId = null
          pendingBluetoothScoStartedAtMs = 0L
        }
      }
    }
  }
  @Volatile
  private var activeCallServiceSessionId: String? = null

  init {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      reactContext.registerReceiver(
        bluetoothScoReceiver,
        IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED),
        Context.RECEIVER_NOT_EXPORTED,
      )
    } else {
      @Suppress("DEPRECATION")
      reactContext.registerReceiver(bluetoothScoReceiver, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
    }
    reactContext.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onNewIntent(intent: Intent) {
        IncomingCallIntentStore.remember(intent)
        enqueueShareIntent(intent)
      }
    })
  }

  override fun invalidate() {
    runCatching {
      reactContext.unregisterReceiver(bluetoothScoReceiver)
    }
    super.invalidate()
  }

  @ReactMethod
  fun setPictureInPictureEnabled(enabled: Boolean) {
    MainActivity.isCallPictureInPictureEnabled = enabled
    mainHandler.post {
      reactApplicationContext.currentActivity?.let { activity ->
        if (activity is MainActivity) {
          activity.updatePictureInPictureParams()
        }
      }
    }
  }

  @ReactMethod
  fun setScreenCaptureProtection(enabled: Boolean) {
    mainHandler.post {
      reactApplicationContext.currentActivity?.window?.let { window ->
        if (enabled) {
          window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
      }
    }
  }

  @ReactMethod
  fun isPictureInPictureAvailable(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
  }

  @ReactMethod
  fun enterPictureInPicture(promise: Promise) {
    val activity = reactApplicationContext.currentActivity

    if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve(false)
      return
    }

    if (!MainActivity.isCallPictureInPictureEnabled) {
      promise.resolve(false)
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      promise.resolve(false)
      return
    }

    runCatching<Boolean> {
      activity.enterPictureInPictureMode(
        createPictureInPictureParams(
          MainActivity.isCallPictureInPictureEnabled,
          activity.window.decorView.width,
          activity.window.decorView.height,
        ),
      )
    }.onSuccess {
      promise.resolve(true)
    }.onFailure {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun closePictureInPicture(promise: Promise) {
    MainActivity.isCallPictureInPictureEnabled = false
    val activity = reactApplicationContext.currentActivity

    if (activity is MainActivity) {
      activity.updatePictureInPictureParams()
    }

    if (activity is MainActivity && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode) {
      activity.finishAndRemoveTask()
      promise.resolve(true)
      return
    }

    promise.resolve(false)
  }

  @ReactMethod
  fun setCallAudioRoute(speaker: Boolean) {
    selectCallAudioRouteInternal(if (speaker) "speaker" else "earpiece")
  }

  @ReactMethod
  fun getCallAudioRoutes(promise: Promise) {
    promise.resolve(createCallAudioRoutes())
  }

  @ReactMethod
  fun selectCallAudioRoute(routeId: String, promise: Promise) {
    mainHandler.post {
      runCatching {
        selectCallAudioRouteInternal(routeId)
      }.onSuccess {
        promise.resolve(it)
      }.onFailure {
        Log.e(CALL_AUDIO_TAG, "select-call-audio-route-failed route=$routeId", it)
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun clearCallAudioRoute() {
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      audioManager.clearCommunicationDevice()
      selectedCallAudioRouteId = null
      connectedBluetoothScoRouteId = null
      pendingBluetoothScoRouteId = null
      pendingBluetoothScoStartedAtMs = 0L
      return
    }

    @Suppress("DEPRECATION")
    audioManager.stopBluetoothSco()
    @Suppress("DEPRECATION")
    audioManager.isBluetoothScoOn = false
    @Suppress("DEPRECATION")
    run {
      audioManager.isSpeakerphoneOn = false
    }
    selectedCallAudioRouteId = null
    connectedBluetoothScoRouteId = null
    pendingBluetoothScoRouteId = null
    pendingBluetoothScoStartedAtMs = 0L
  }

  private fun selectCallAudioRouteInternal(routeId: String): Boolean {
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val targetDevice = audioManager.availableCommunicationDevices.firstOrNull {
        callAudioRouteId(it) == routeId
      }

      if (targetDevice != null) {
        return audioManager.setCommunicationDevice(targetDevice).also { selected ->
          if (selected) {
            selectedCallAudioRouteId = routeId
          }
        }
      }

      if (routeId == "earpiece") {
        audioManager.clearCommunicationDevice()
        selectedCallAudioRouteId = routeId
        return true
      }

      return false
    }

    val isSpeaker = routeId == "speaker"
    val isBluetooth = routeId.startsWith("device:") &&
      getLegacyCallAudioDevices(audioManager).firstOrNull { callAudioRouteId(it) == routeId }?.let(::isBluetoothCallDevice) == true

    @Suppress("DEPRECATION")
    if (isBluetooth) {
      val now = SystemClock.elapsedRealtime()
      val shouldStartBluetoothSco = connectedBluetoothScoRouteId != routeId &&
        (
          pendingBluetoothScoRouteId != routeId ||
            now - pendingBluetoothScoStartedAtMs >= BLUETOOTH_SCO_RETRY_INTERVAL_MS
          )

      audioManager.isSpeakerphoneOn = false
      if (shouldStartBluetoothSco) {
        connectedBluetoothScoRouteId = null
        pendingBluetoothScoRouteId = routeId
        pendingBluetoothScoStartedAtMs = now
        audioManager.startBluetoothSco()
      }
      audioManager.isBluetoothScoOn = true
      selectedCallAudioRouteId = routeId
      return true
    }

    @Suppress("DEPRECATION")
    audioManager.stopBluetoothSco()
    @Suppress("DEPRECATION")
    audioManager.isBluetoothScoOn = false
    @Suppress("DEPRECATION")
    run {
      audioManager.isSpeakerphoneOn = isSpeaker
    }
    selectedCallAudioRouteId = routeId
    connectedBluetoothScoRouteId = null
    pendingBluetoothScoRouteId = null
    pendingBluetoothScoStartedAtMs = 0L
    return routeId == "earpiece" || isSpeaker || routeId.startsWith("device:")
  }

  private fun createCallAudioRoutes(): com.facebook.react.bridge.WritableArray {
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val devices = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      audioManager.availableCommunicationDevices
    } else {
      getLegacyCallAudioDevices(audioManager)
    }
    val activeRouteId = getActiveCallAudioRouteId(audioManager, devices)
    val routes = Arguments.createArray()
    devices
      .filter { isSupportedCallAudioDevice(it) }
      .distinctBy(::callAudioRouteId)
      .sortedBy { callAudioRouteSortOrder(it.type) }
      .forEach { device ->
        val route = Arguments.createMap()
        route.putString("id", callAudioRouteId(device))
        route.putString("type", callAudioRouteType(device))
        route.putString("name", device.productName?.toString().orEmpty())
        route.putBoolean("isActive", callAudioRouteId(device) == activeRouteId)
        routes.pushMap(route)
      }

    return routes
  }

  private fun getLegacyCallAudioDevices(audioManager: AudioManager): List<AudioDeviceInfo> {
    return audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList()
  }

  private fun getActiveCallAudioRouteId(audioManager: AudioManager, devices: List<AudioDeviceInfo>): String {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return audioManager.communicationDevice?.let(::callAudioRouteId) ?: "earpiece"
    }

    @Suppress("DEPRECATION")
    if (audioManager.isSpeakerphoneOn) {
      return "speaker"
    }

    @Suppress("DEPRECATION")
    val isBluetoothScoEnabled = audioManager.isBluetoothScoOn
    if (!isBluetoothScoEnabled) {
      connectedBluetoothScoRouteId = null
    }

    connectedBluetoothScoRouteId?.let { connectedRouteId ->
      if (isBluetoothScoEnabled && devices.any { callAudioRouteId(it) == connectedRouteId }) {
        return connectedRouteId
      }
    }

    selectedCallAudioRouteId?.let { selectedRouteId ->
      if (selectedRouteId == "earpiece") {
        return selectedRouteId
      }
    }

    return devices.firstOrNull(::isWiredCallDevice)?.let(::callAudioRouteId) ?: "earpiece"
  }

  private fun callAudioRouteId(device: AudioDeviceInfo): String {
    return when (device.type) {
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
      AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
      else -> "device:${device.id}"
    }
  }

  private fun callAudioRouteType(device: AudioDeviceInfo): String {
    return when {
      isBluetoothCallDevice(device) -> "bluetooth"
      isWiredCallDevice(device) -> "wired"
      device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
      else -> "earpiece"
    }
  }

  private fun isSupportedCallAudioDevice(device: AudioDeviceInfo): Boolean {
    return isBluetoothCallDevice(device) ||
      isWiredCallDevice(device) ||
      device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER ||
      device.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
  }

  private fun isBluetoothCallDevice(device: AudioDeviceInfo): Boolean {
    return device.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (device.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
          device.type == AudioDeviceInfo.TYPE_BLE_SPEAKER)) ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && device.type == AudioDeviceInfo.TYPE_HEARING_AID)
  }

  private fun isWiredCallDevice(device: AudioDeviceInfo): Boolean {
    return device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
      device.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
      (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && device.type == AudioDeviceInfo.TYPE_USB_HEADSET)
  }

  private fun callAudioRouteSortOrder(type: Int): Int {
    return when {
      type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> 0
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER) -> 0
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && type == AudioDeviceInfo.TYPE_HEARING_AID -> 0
      type == AudioDeviceInfo.TYPE_WIRED_HEADSET || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> 1
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && type == AudioDeviceInfo.TYPE_USB_HEADSET -> 1
      type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> 2
      else -> 3
    }
  }

  @ReactMethod
  fun setLiveVoiceEffect(effectId: String) {
    MeetVapLiveVoiceEffectRegistry.setEffect(effectId)
  }

  @ReactMethod
  fun getLiveVoiceEffect(promise: Promise) {
    promise.resolve(MeetVapLiveVoiceEffectRegistry.getEffect())
  }

  @ReactMethod
  fun getLiveVoiceEffectStatus(promise: Promise) {
    val effectId = MeetVapLiveVoiceEffectRegistry.getEffect()
    val attached = MeetVapLiveVoiceEffectRegistry.isAttached()
    val factoryInstalled = MeetVapLiveVoiceEffectRegistry.isFactoryInstalled()
    val processedBuffers = MeetVapLiveVoiceEffectRegistry.getProcessedBufferCount()
    val processedFrames = MeetVapLiveVoiceEffectRegistry.getProcessedFrameCount()
    val lastProcessedEffectId = MeetVapLiveVoiceEffectRegistry.getLastProcessedEffect()
    val inputRms = MeetVapLiveVoiceEffectRegistry.getInputRms()
    val outputRms = MeetVapLiveVoiceEffectRegistry.getOutputRms()
    val deltaRms = MeetVapLiveVoiceEffectRegistry.getDeltaRms()
    val status = Arguments.createMap()
    status.putString("effectId", effectId)
    status.putBoolean("attached", attached)
    status.putBoolean("factoryInstalled", factoryInstalled)
    status.putDouble("processedBuffers", processedBuffers.toDouble())
    status.putDouble("processedFrames", processedFrames.toDouble())
    status.putString("lastProcessedEffectId", lastProcessedEffectId)
    status.putString("sampleScale", MeetVapLiveVoiceEffectRegistry.getSampleScaleLabel())
    status.putString("pitchPath", MeetVapLiveVoiceEffectRegistry.getPitchPathLabel())
    status.putDouble("inputRms", inputRms.toDouble())
    status.putDouble("outputRms", outputRms.toDouble())
    status.putDouble("deltaRms", deltaRms.toDouble())
    promise.resolve(status)
  }

  @ReactMethod
  fun beginLiveVoiceEffectSession(effectId: String) {
    MeetVapLiveVoiceEffectRegistry.beginSession(effectId)
  }

  @ReactMethod
  fun startCallService(mode: String, sessionId: String?, voiceEffectId: String?) {
    activeCallServiceSessionId = sessionId
    val resolvedEffectId = if (mode.equals("voice", ignoreCase = true)) {
      voiceEffectId ?: MeetVapLiveVoiceEffectRegistry.getEffect()
    } else {
      "normal"
    }

    MeetVapLiveVoiceEffectRegistry.setEffect(resolvedEffectId)
    MeetVapLiveVoiceEffectRegistry.attach()

    val intent = Intent(reactContext, CallForegroundService::class.java)
      .putExtra(CallForegroundService.EXTRA_MODE, mode)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      reactContext.startForegroundService(intent)
    } else {
      reactContext.startService(intent)
    }
  }

  @ReactMethod
  fun showIncomingCall(payload: ReadableMap) {
    IncomingCallPayload.fromReadableMap(payload)?.let {
      IncomingCallNotificationHelper.show(reactContext.applicationContext, it)
    }
  }

  @ReactMethod
  fun cancelIncomingCall(callId: String?) {
    IncomingCallNotificationHelper.cancel(reactContext.applicationContext, callId)
  }

  @ReactMethod
  fun cancelMessageNotifications(conversationId: String?) {
    if (conversationId.isNullOrBlank()) {
      return
    }

    MessageNotificationHelper.cancel(reactContext.applicationContext, conversationId)
  }

  @ReactMethod
  fun stopCallService(sessionId: String?) {
    val activeSessionId = activeCallServiceSessionId

    if (activeSessionId != null && sessionId != null && activeSessionId != sessionId) {
      return
    }

    activeCallServiceSessionId = null
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    clearCallAudioRoute()

    audioManager.mode = AudioManager.MODE_NORMAL
    MainActivity.isCallPictureInPictureEnabled = false
    setProximityScreenOffEnabled(false)
    reactContext.stopService(Intent(reactContext, CallForegroundService::class.java))
    MeetVapLiveVoiceEffectRegistry.setEffect("normal")
  }

  @ReactMethod
  fun setProximityScreenOffEnabled(enabled: Boolean) {
    if (!enabled) {
      proximityWakeLock?.let { wakeLock ->
        if (wakeLock.isHeld) {
          wakeLock.release()
        }
      }
      proximityWakeLock = null
      return
    }

    val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    val wakeLock = proximityWakeLock ?: powerManager.newWakeLock(
      PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK,
      "${reactContext.packageName}:CallProximity",
    ).also {
      it.setReferenceCounted(false)
      proximityWakeLock = it
    }

    if (!wakeLock.isHeld) {
      wakeLock.acquire()
    }
  }

  @ReactMethod
  fun startIncomingRingtone() {
    mainHandler.post {
      if (incomingRingtonePlayer?.isPlaying == true) {
        return@post
      }

      runCatching {
        incomingRingtonePlayer?.release()
        incomingRingtonePlayer = null

        val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.mode = AudioManager.MODE_NORMAL
        @Suppress("DEPRECATION")
        audioManager.isSpeakerphoneOn = false

        val descriptor = reactContext.resources.openRawResourceFd(R.raw.ringtone)
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

        incomingRingtonePlayer = player
      }.onFailure {
        incomingRingtonePlayer?.release()
        incomingRingtonePlayer = null
      }
    }
  }

  @ReactMethod
  fun stopIncomingRingtone() {
    mainHandler.post {
      incomingRingtonePlayer?.let { player ->
        runCatching {
          if (player.isPlaying) {
            player.stop()
          }
        }
        player.release()
      }
      incomingRingtonePlayer = null
    }
  }

  @ReactMethod
  fun startOutgoingRingback(@Suppress("UNUSED_PARAMETER") uri: String, mode: String, promise: Promise) {
    mainHandler.post {
      runCatching {
        isOutgoingRingbackActive = true
        outgoingRingbackMode = mode

        outgoingRingbackPlayer?.let { player ->
          val preferredDevice = selectDefaultOutgoingRingbackRoute(mode)
          applyOutgoingRingbackPreferredDevice(player, preferredDevice)
          return@runCatching true
        }

        outgoingRingbackPlayer?.release()
        outgoingRingbackPlayer = null
        outgoingRingbackLastPositionMs = -1
        outgoingRingbackLastProgressAtMs = SystemClock.elapsedRealtime()
        outgoingRingbackNextReplayAtMs = 0L
        outgoingRingbackPlayer = createOutgoingRingbackPlayer(selectDefaultOutgoingRingbackRoute(mode))
        mainHandler.removeCallbacks(outgoingRingbackRouteRunnable)
        mainHandler.postDelayed(outgoingRingbackRouteRunnable, 350L)
        true
      }.onSuccess { started ->
        promise.resolve(started)
      }.onFailure { error ->
        mainHandler.removeCallbacks(outgoingRingbackRouteRunnable)
        outgoingRingbackPlayer?.release()
        outgoingRingbackPlayer = null
        isOutgoingRingbackActive = false
        Log.e(CALL_AUDIO_TAG, "start-outgoing-ringback-failed", error)
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun stopOutgoingRingback() {
    mainHandler.post {
      isOutgoingRingbackActive = false
      mainHandler.removeCallbacks(outgoingRingbackRouteRunnable)
      outgoingRingbackPlayer?.let { player ->
        runCatching {
          if (player.isPlaying) {
            player.stop()
          }
        }
        player.release()
      }
      outgoingRingbackPlayer = null
      outgoingRingbackLastPositionMs = -1
      outgoingRingbackLastProgressAtMs = 0L
      outgoingRingbackNextReplayAtMs = 0L
    }
  }

  private fun createOutgoingRingbackPlayer(preferredDevice: AudioDeviceInfo?): MediaPlayer {
    return MediaPlayer().apply {
      isLooping = false
      setVolume(0.62f, 0.62f)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
      } else {
        @Suppress("DEPRECATION")
        setAudioStreamType(AudioManager.STREAM_DTMF)
      }
      val descriptor = reactContext.resources.openRawResourceFd(R.raw.ringing)
      setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.length)
      descriptor.close()
      setOnCompletionListener { completedPlayer ->
        if (isOutgoingRingbackActive) {
          outgoingRingbackLastPositionMs = completedPlayer.currentPosition
          outgoingRingbackLastProgressAtMs = SystemClock.elapsedRealtime()
          outgoingRingbackNextReplayAtMs = SystemClock.elapsedRealtime() + OUTGOING_RINGBACK_PAUSE_MS
        }
      }
      setOnErrorListener { failedPlayer, _, _ ->
        if (outgoingRingbackPlayer === failedPlayer) {
          outgoingRingbackPlayer = null
        }
        runCatching { failedPlayer.release() }
        true
      }
      prepare()
      applyOutgoingRingbackPreferredDevice(this, preferredDevice)
      start()
      outgoingRingbackLastPositionMs = 0
      outgoingRingbackLastProgressAtMs = SystemClock.elapsedRealtime()
      outgoingRingbackNextReplayAtMs = 0L
    }
  }

  private fun recoverOutgoingRingbackPlayer(player: MediaPlayer) {
    val now = SystemClock.elapsedRealtime()
    val position = player.currentPosition

    if (!player.isPlaying && outgoingRingbackNextReplayAtMs > now) {
      return
    }

    if (position != outgoingRingbackLastPositionMs) {
      outgoingRingbackLastPositionMs = position
      outgoingRingbackLastProgressAtMs = now
    }

    if (player.isPlaying && now - outgoingRingbackLastProgressAtMs < OUTGOING_RINGBACK_STALL_TIMEOUT_MS) {
      return
    }

    if (player.duration > 0 && position >= player.duration - 80) {
      player.seekTo(0)
    }
    player.start()
    outgoingRingbackNextReplayAtMs = 0L
    outgoingRingbackLastPositionMs = player.currentPosition
    outgoingRingbackLastProgressAtMs = now
  }

  private fun applyOutgoingRingbackPreferredDevice(player: MediaPlayer, preferredDevice: AudioDeviceInfo?) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && preferredDevice != null) {
      player.setPreferredDevice(preferredDevice)
    }
  }

  private fun selectDefaultOutgoingRingbackRoute(mode: String): AudioDeviceInfo? {
    val audioManager = reactContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    val devices = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      audioManager.availableCommunicationDevices
    } else {
      getLegacyCallAudioDevices(audioManager)
    }
    val isVideoMode = mode.equals("video", ignoreCase = true)
    val activeRouteId = getActiveCallAudioRouteId(audioManager, devices)
    val activeExternalDevice = devices.firstOrNull {
      callAudioRouteId(it) == activeRouteId && (isBluetoothCallDevice(it) || isWiredCallDevice(it))
    }
    val preferredDevice = if (isVideoMode) {
      activeExternalDevice
        ?: devices.firstOrNull(::isBluetoothCallDevice)
        ?: devices.firstOrNull(::isWiredCallDevice)
        ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
    } else {
      devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
        ?: devices.firstOrNull(::isWiredCallDevice)
        ?: devices.firstOrNull(::isBluetoothCallDevice)
    }

    val preferredRouteId = preferredDevice?.let(::callAudioRouteId)
      ?: if (isVideoMode) "speaker" else "earpiece"

    if (activeRouteId != preferredRouteId) {
      selectCallAudioRouteInternal(preferredRouteId)
    }

    return preferredDevice
  }

  @ReactMethod
  fun consumePendingIncomingCallUrl(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    val activityIntent = activity?.intent

    IncomingCallIntentStore.remember(activityIntent)
    val consumedUrl = IncomingCallIntentStore.consume()

    if (consumedUrl != null && isIncomingCallIntent(activityIntent)) {
      activity?.setIntent(Intent(activityIntent).setData(null))
    }

    promise.resolve(consumedUrl)
  }

  @ReactMethod
  fun peekPendingIncomingCallUrl(promise: Promise) {
    val activityIntent = reactApplicationContext.currentActivity?.intent

    IncomingCallIntentStore.remember(activityIntent)
    promise.resolve(IncomingCallIntentStore.peek())
  }

  @ReactMethod
  fun canUseFullScreenIncomingCall(promise: Promise) {
    IncomingCallNotificationHelper.ensureIncomingCallChannel(reactContext.applicationContext)
    val notificationManager = reactContext.getSystemService(NotificationManager::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && notificationManager?.areNotificationsEnabled() == false) {
      promise.resolve(false)
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = notificationManager?.getNotificationChannel("incoming-calls-fullscreen")

      if (channel != null && channel.importance < NotificationManager.IMPORTANCE_HIGH) {
        promise.resolve(false)
        return
      }
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      promise.resolve(true)
      return
    }

    promise.resolve(notificationManager?.canUseFullScreenIntent() != false)
  }

  @ReactMethod
  fun openFullScreenIncomingCallSettings() {
    IncomingCallNotificationHelper.ensureIncomingCallChannel(reactContext.applicationContext)

    if (shouldOpenIncomingCallChannelSettings()) {
      openIncomingCallChannelSettings()
      return
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      openApplicationSettings()
      return
    }

    val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
      .setData(Uri.parse("package:${reactContext.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    try {
      reactContext.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      openApplicationSettings()
    }
  }

  private fun shouldOpenIncomingCallChannelSettings(): Boolean {
    val notificationManager = reactContext.getSystemService(NotificationManager::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && notificationManager?.areNotificationsEnabled() == false) {
      return true
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = notificationManager?.getNotificationChannel("incoming-calls-fullscreen")

      return channel != null && channel.importance < NotificationManager.IMPORTANCE_HIGH
    }

    return false
  }

  private fun openIncomingCallChannelSettings() {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, reactContext.packageName)
        .putExtra(Settings.EXTRA_CHANNEL_ID, "incoming-calls-fullscreen")
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.parse("package:${reactContext.packageName}"))
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    try {
      reactContext.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      openApplicationSettings()
    }
  }

  private fun isIncomingCallIntent(intent: Intent?): Boolean {
    val data = intent?.data ?: return false

    return (data.scheme == "meetvap" || data.scheme == "com.meetvap.app") && data.host == "incoming-call"
  }

  private fun openApplicationSettings() {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
      .setData(Uri.parse("package:${reactContext.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    try {
      reactContext.startActivity(intent)
    } catch (_: ActivityNotFoundException) {
      // Settings app is unavailable on this device.
    }
  }

  @ReactMethod
  fun hasPendingSharedItems(promise: Promise) {
    val activityIntent = reactApplicationContext.currentActivity?.intent
    val hasPendingItems = synchronized(pendingShareLock) {
      pendingShareIntents.isNotEmpty()
    } || isShareIntent(activityIntent)

    promise.resolve(hasPendingItems)
  }

  @ReactMethod
  fun consumeSharedItems(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    val intents = drainShareIntents(activity?.intent)

    if (intents.isEmpty()) {
      promise.resolve(Arguments.createArray())
      return
    }

    try {
      val items = Arguments.createArray()

      intents.forEach { intent ->
        appendSharedItems(intent, items)
      }

      if (activity != null && isShareIntent(activity.intent)) {
        activity.intent = Intent(activity, MainActivity::class.java)
      }
      promise.resolve(items)
    } catch (error: Exception) {
      promise.reject("shared_items_failed", error)
    }
  }

  private fun isShareIntent(intent: Intent?): Boolean =
    intent?.action == Intent.ACTION_SEND || intent?.action == Intent.ACTION_SEND_MULTIPLE

  private fun enqueueShareIntent(intent: Intent) {
    if (!isShareIntent(intent)) {
      return
    }

    synchronized(pendingShareLock) {
      pendingShareIntents.clear()
      pendingShareIntents.add(Intent(intent))
    }
  }

  private fun drainShareIntents(activityIntent: Intent?): List<Intent> {
    val drained = synchronized(pendingShareLock) {
      val copy = pendingShareIntents.map(::Intent)
      pendingShareIntents.clear()
      copy
    }

    if (drained.isNotEmpty()) {
      return drained
    }

    return if (isShareIntent(activityIntent)) {
      listOf(Intent(activityIntent))
    } else {
      emptyList()
    }
  }

  private fun appendSharedItems(intent: Intent, items: com.facebook.react.bridge.WritableArray) {
    val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.takeIf { it.isNotBlank() }

    if (text != null) {
      val item = Arguments.createMap()
      item.putString("kind", "text")
      item.putString("text", text)
      items.pushMap(item)
    }

    val streams = mutableListOf<Uri>()
    val singleStream = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri
    }

    if (singleStream != null) {
      streams.add(singleStream)
    }

    val clipData = intent.clipData
    if (clipData != null) {
      for (index in 0 until clipData.itemCount) {
        clipData.getItemAt(index).uri?.let { uri ->
          if (!streams.contains(uri)) {
            streams.add(uri)
          }
        }
      }
    }

    streams.forEach { uri ->
      copySharedUri(uri, intent.type)?.let(items::pushMap)
    }
  }

  @ReactMethod
  fun processVoiceMessage(uri: String, effectId: String, promise: Promise) {
    if (effectId == "normal") {
      promise.resolve(uri)
      return
    }

    val inputUri = Uri.parse(uri)
    val outputDir = File(reactContext.cacheDir, "voice-effects").apply {
      mkdirs()
    }
    val outputFile = File(outputDir, "${UUID.randomUUID()}.m4a")

    mainHandler.post {
      try {
        val sonicAudioProcessor = SonicAudioProcessor().apply {
          setSpeed(1f)
          setPitch(getVoicePitch(effectId))
        }
        val editedMediaItem = EditedMediaItem.Builder(MediaItem.fromUri(inputUri))
          .setEffects(Effects(listOf(sonicAudioProcessor), emptyList()))
          .build()
        val transformer = Transformer.Builder(reactContext)
          .addListener(object : Transformer.Listener {
            override fun onCompleted(composition: androidx.media3.transformer.Composition, exportResult: ExportResult) {
              promise.resolve(outputFile.toURI().toString())
            }

            override fun onError(
              composition: androidx.media3.transformer.Composition,
              exportResult: ExportResult,
              exportException: ExportException
            ) {
              promise.reject("voice_effect_failed", exportException)
            }
          })
          .build()

        transformer.start(editedMediaItem, outputFile.absolutePath)
      } catch (error: Exception) {
        promise.reject("voice_effect_failed", error)
      }
    }
  }

  @ReactMethod
  fun openFile(uri: String, mimeType: String?, promise: Promise) {
    val parsedUri = Uri.parse(uri)
    val resolvedMimeType = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(parsedUri, resolvedMimeType)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    intent.clipData = ClipData.newUri(reactContext.contentResolver, "attachment", parsedUri)

    val activity = reactApplicationContext.currentActivity

    try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(intent)
      }
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      if (resolvedMimeType != "*/*") {
        val fallbackIntent = Intent(Intent.ACTION_VIEW)
          .setDataAndType(parsedUri, "*/*")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        fallbackIntent.clipData = ClipData.newUri(reactContext.contentResolver, "attachment", parsedUri)

        try {
          if (activity != null) {
            activity.startActivity(fallbackIntent)
          } else {
            fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(fallbackIntent)
          }
          promise.resolve(true)
          return
        } catch (_: ActivityNotFoundException) {
          promise.resolve(false)
          return
        }
      }

      promise.resolve(false)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun saveFile(uri: String, mimeType: String?, displayName: String?, promise: Promise) {
    try {
      val parsedUri = Uri.parse(uri)
      val resolvedMimeType = mimeType?.takeIf { it.isNotBlank() }
        ?: reactContext.contentResolver.getType(parsedUri)
        ?: "application/octet-stream"
      val resolvedDisplayName = displayName?.takeIf { it.isNotBlank() }
        ?: getDisplayName(parsedUri)
        ?: "meetvap-${UUID.randomUUID()}${extensionForMimeType(resolvedMimeType)}"

      val inputStream = openInputStreamForUri(parsedUri)

      if (inputStream == null) {
        promise.resolve(false)
        return
      }

      inputStream.use { input ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val collection = MediaStore.Downloads.EXTERNAL_CONTENT_URI
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, resolvedDisplayName)
            put(MediaStore.MediaColumns.MIME_TYPE, resolvedMimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }

          val outputUri = reactContext.contentResolver.insert(collection, values)

          if (outputUri == null) {
            promise.resolve(false)
            return
          }

          reactContext.contentResolver.openOutputStream(outputUri)?.use { output ->
            input.copyTo(output)
          } ?: run {
            reactContext.contentResolver.delete(outputUri, null, null)
            promise.resolve(false)
            return
          }

          values.clear()
          values.put(MediaStore.MediaColumns.IS_PENDING, 0)
          reactContext.contentResolver.update(outputUri, values, null, null)
          promise.resolve(true)
          return
        }

        @Suppress("DEPRECATION")
        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        if (!downloadsDir.exists()) {
          downloadsDir.mkdirs()
        }
        val targetFile = File(downloadsDir, resolvedDisplayName)
        targetFile.outputStream().use { output ->
          input.copyTo(output)
        }
        MediaScannerConnection.scanFile(reactContext, arrayOf(targetFile.absolutePath), arrayOf(resolvedMimeType), null)
        promise.resolve(true)
      }
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun shareFile(uri: String, mimeType: String?, displayName: String?, promise: Promise) {
    val parsedUri = Uri.parse(uri)
    val resolvedMimeType = mimeType?.takeIf { it.isNotBlank() } ?: "*/*"
    val intent = Intent(Intent.ACTION_SEND)
      .setType(resolvedMimeType)
      .putExtra(Intent.EXTRA_STREAM, parsedUri)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    intent.clipData = ClipData.newUri(reactContext.contentResolver, displayName ?: "attachment", parsedUri)

    val chooser = Intent.createChooser(intent, displayName ?: "Share")
    val activity = reactApplicationContext.currentActivity

    try {
      if (activity != null) {
        activity.startActivity(chooser)
      } else {
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactContext.startActivity(chooser)
      }
      promise.resolve(true)
    } catch (_: ActivityNotFoundException) {
      promise.resolve(false)
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun renderImageDrawing(uri: String, strokesJson: String, outputFileName: String?, promise: Promise) {
    Thread {
      try {
        val parsedUri = Uri.parse(uri)
        val sourceBitmap = openInputStreamForUri(parsedUri)?.use { input ->
          BitmapFactory.decodeStream(input)
        } ?: throw IllegalArgumentException("Image could not be opened.")

        val outputBitmap = Bitmap.createBitmap(sourceBitmap.width, sourceBitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(outputBitmap)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(sourceBitmap, 0f, 0f, null)
        drawImageStrokes(canvas, sourceBitmap.width, sourceBitmap.height, strokesJson)

        val outputDir = File(reactContext.cacheDir, "drawn-images").also { it.mkdirs() }
        val fileName = normalizeDrawnImageFileName(outputFileName)
        val outputFile = File(outputDir, "${UUID.randomUUID()}-$fileName")
        outputFile.outputStream().use { output ->
          outputBitmap.compress(Bitmap.CompressFormat.JPEG, 90, output)
        }

        sourceBitmap.recycle()
        outputBitmap.recycle()

        val result = Arguments.createMap()
        result.putString("uri", Uri.fromFile(outputFile).toString())
        result.putString("fileName", fileName)
        result.putString("mimeType", "image/jpeg")
        result.putDouble("sizeBytes", outputFile.length().toDouble())
        promise.resolve(result)
      } catch (error: Exception) {
        promise.reject("image_drawing_failed", error)
      }
    }.start()
  }

  private fun drawImageStrokes(canvas: Canvas, bitmapWidth: Int, bitmapHeight: Int, strokesJson: String) {
    val strokes = JSONArray(strokesJson)
    val scale = min(bitmapWidth, bitmapHeight).toFloat()

    for (strokeIndex in 0 until strokes.length()) {
      val stroke = strokes.optJSONObject(strokeIndex) ?: continue
      val points = stroke.optJSONArray("points") ?: continue

      if (points.length() == 0) {
        continue
      }

      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = parseDrawingColor(stroke.optString("color", "#ef4444"))
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = max(2f, stroke.optDouble("width", 0.014).toFloat() * scale)
      }
      val path = Path()
      val firstPoint = points.optJSONObject(0) ?: continue
      val firstX = firstPoint.optDouble("x", 0.0).toFloat().coerceIn(0f, 1f) * bitmapWidth
      val firstY = firstPoint.optDouble("y", 0.0).toFloat().coerceIn(0f, 1f) * bitmapHeight
      path.moveTo(firstX, firstY)

      if (points.length() == 1) {
        path.lineTo(firstX + 0.5f, firstY + 0.5f)
      } else {
        for (pointIndex in 1 until points.length()) {
          val point = points.optJSONObject(pointIndex) ?: continue
          path.lineTo(
            point.optDouble("x", 0.0).toFloat().coerceIn(0f, 1f) * bitmapWidth,
            point.optDouble("y", 0.0).toFloat().coerceIn(0f, 1f) * bitmapHeight
          )
        }
      }

      canvas.drawPath(path, paint)
    }
  }

  private fun parseDrawingColor(value: String): Int = try {
    Color.parseColor(value)
  } catch (_: Exception) {
    Color.RED
  }

  private fun normalizeDrawnImageFileName(outputFileName: String?): String {
    val rawName = outputFileName
      ?.substringAfterLast('/')
      ?.takeIf { it.isNotBlank() }
      ?: "photo.jpg"
    val baseName = rawName.substringBeforeLast('.', rawName)
      .replace(Regex("[^A-Za-z0-9._-]"), "_")
      .ifBlank { "photo" }

    return "$baseName.jpg"
  }

  private fun copySharedUri(uri: Uri, fallbackMimeType: String?): WritableMap? {
    val resolver = reactContext.contentResolver
    val mimeType = resolver.getType(uri) ?: fallbackMimeType ?: "application/octet-stream"
    val displayName = getDisplayName(uri) ?: "shared-${UUID.randomUUID()}${extensionForMimeType(mimeType)}"
    val safeName = displayName.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val importDir = File(reactContext.cacheDir, "shared-imports").also { it.mkdirs() }
    val target = File(importDir, "${UUID.randomUUID()}-$safeName")

    resolver.openInputStream(uri)?.use { input ->
      target.outputStream().use { output ->
        input.copyTo(output)
      }
    } ?: return null

    val item = Arguments.createMap()
    item.putString("kind", "file")
    item.putString("uri", Uri.fromFile(target).toString())
    item.putString("fileName", displayName)
    item.putString("mimeType", mimeType)
    item.putDouble("sizeBytes", target.length().toDouble())
    return item
  }

  private fun getDisplayName(uri: Uri): String? {
    if (uri.scheme == "file") {
      return uri.lastPathSegment
    }

    reactContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0) {
          return cursor.getString(index)
        }
      }
    }

    return uri.lastPathSegment
  }

  private fun extensionForMimeType(mimeType: String): String {
    return when {
      mimeType.startsWith("image/") -> ".jpg"
      mimeType.startsWith("video/") -> ".mp4"
      mimeType.startsWith("audio/") -> ".m4a"
      mimeType == "application/pdf" -> ".pdf"
      mimeType == "text/plain" -> ".txt"
      else -> ""
    }
  }

  private fun openInputStreamForUri(uri: Uri) = when (uri.scheme?.lowercase()) {
    "content" -> reactContext.contentResolver.openInputStream(uri)
    "file" -> uri.path?.let { FileInputStream(File(it)) }
    else -> reactContext.contentResolver.openInputStream(uri)
  }

  companion object {
    private const val CALL_AUDIO_TAG = "MeetVapCallAudio"
    private const val BLUETOOTH_SCO_RETRY_INTERVAL_MS = 3000L
    private const val OUTGOING_RINGBACK_PAUSE_MS = 1000L
    private const val OUTGOING_RINGBACK_STALL_TIMEOUT_MS = 1100L

    fun createPictureInPictureParams(): PictureInPictureParams {
      return createPictureInPictureParams(MainActivity.isCallPictureInPictureEnabled)
    }

    fun createPictureInPictureParams(enabled: Boolean): PictureInPictureParams {
      return createPictureInPictureParams(enabled, 0, 0)
    }

    fun createPictureInPictureParams(enabled: Boolean, sourceRect: Rect?): PictureInPictureParams {
      val builder = PictureInPictureParams.Builder()
        .setAspectRatio(Rational(9, 16))

      if (sourceRect != null && !sourceRect.isEmpty) {
        builder.setSourceRectHint(sourceRect)
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder
          .setAutoEnterEnabled(enabled)
          .setSeamlessResizeEnabled(true)
      }

      return builder.build()
    }

    fun createPictureInPictureParams(enabled: Boolean, sourceWidth: Int, sourceHeight: Int): PictureInPictureParams {
      val builder = PictureInPictureParams.Builder()
        .setAspectRatio(Rational(9, 16))

      if (sourceWidth > 0 && sourceHeight > 0) {
        val portraitWidth = minOf(sourceWidth, (sourceHeight * 9f / 16f).toInt().coerceAtLeast(1))
        val portraitHeight = minOf(sourceHeight, (portraitWidth * 16f / 9f).toInt().coerceAtLeast(1))
        val left = ((sourceWidth - portraitWidth) / 2).coerceAtLeast(0)
        val top = ((sourceHeight - portraitHeight) / 2).coerceAtLeast(0)

        builder.setSourceRectHint(Rect(left, top, left + portraitWidth, top + portraitHeight))
      }

      return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder
          .setAutoEnterEnabled(enabled)
          .setSeamlessResizeEnabled(true)
          .build()
      } else {
        builder.build()
      }
    }

  }

  private fun getVoicePitch(effectId: String): Float {
    return when (effectId) {
      "deep" -> 0.78f
      "bright" -> 1.22f
      "helium" -> 1.42f
      else -> 1f
    }
  }
}

internal object MeetVapLiveVoiceEffectRegistry {
  private val processor = LiveVoiceEffectProcessor()

  @Volatile
  private var controller: AudioProcessingController? = null
  @Volatile
  private var installedFactory: Callable<AudioProcessingFactory>? = null
  @Volatile
  private var attachedController: AudioProcessingController? = null
  @Volatile
  private var attachedEffectId: String = "normal"

  @Synchronized
  fun install() {
    val options = WebRTCModuleOptions.getInstance()

    if (options.audioProcessingFactoryFactory === installedFactory) {
      return
    }

    val meetVapAudioProcessingFactory = Callable<AudioProcessingFactory> {
      val nextController = CustomAudioProcessingController()

      controller = nextController
      applyToController(nextController)
      attachedController = nextController
      attachedEffectId = processor.getEffect()
      nextController.externalAudioProcessor
    }

    installedFactory = meetVapAudioProcessingFactory
    options.audioProcessingFactoryFactory = meetVapAudioProcessingFactory
    controller = null
    attachedController = null
    attachedEffectId = "normal"
  }

  fun setEffect(effectId: String) {
    install()
    val normalizedEffectId = normalizeEffectId(effectId)
    val previousEffectId = processor.getEffect()
    val currentController = controller

    processor.setEffect(normalizedEffectId)

    if (
      currentController != null &&
      (
        attachedController !== currentController ||
          attachedEffectId != normalizedEffectId ||
          previousEffectId != normalizedEffectId
      )
    ) {
      attach()
    }
  }

  fun beginSession(effectId: String) {
    install()
    val normalizedEffectId = normalizeEffectId(effectId)

    processor.beginSession(normalizedEffectId)
    attach()
  }

  fun getEffect(): String {
    return processor.getEffect()
  }

  fun getProcessedBufferCount(): Long {
    return processor.getProcessedBufferCount()
  }

  fun getProcessedFrameCount(): Long {
    return processor.getProcessedFrameCount()
  }

  fun getLastProcessedEffect(): String {
    return processor.getLastProcessedEffect()
  }

  fun getSampleScaleLabel(): String {
    return processor.getSampleScaleLabel()
  }

  fun getInputRms(): Float {
    return processor.getInputRms()
  }

  fun getOutputRms(): Float {
    return processor.getOutputRms()
  }

  fun getDeltaRms(): Float {
    return processor.getDeltaRms()
  }

  fun getPitchPathLabel(): String {
    return processor.getPitchPathLabel()
  }

  fun isAttached(): Boolean {
    return controller != null
  }

  fun isFactoryInstalled(): Boolean {
    return WebRTCModuleOptions.getInstance().audioProcessingFactoryFactory === installedFactory
  }

  fun attach() {
    install()
    val currentController = controller ?: return

    if (attachedController === currentController && attachedEffectId == processor.getEffect()) {
      return
    }

    applyToController(currentController)
    attachedController = currentController
    attachedEffectId = processor.getEffect()
  }

  private fun applyToController(targetController: AudioProcessingController) {
    targetController.capturePostProcessor = processor
    targetController.bypassCapturePostProcessing = false
  }

  private fun normalizeEffectId(value: String): String {
    return when (value) {
      "deep", "bright", "helium" -> value
      else -> "normal"
    }
  }

}

private class LiveVoiceEffectProcessor : AudioProcessorInterface {
  @Volatile
  private var effectId: String = "normal"
  @Volatile
  private var resetRequested = false
  @Volatile
  private var lastProcessedEffectId: String = "normal"
  private val processedBufferCount = AtomicLong(0)
  private val processedFrameCount = AtomicLong(0)

  private var sampleRateHz = 48000
  private var channelCount = 1
  private var previousInputByStream = FloatArray(2)
  private var highPassByStream = FloatArray(2)
  private var lowPassByStream = FloatArray(2)
  private var outputToneByStream = FloatArray(2)
  private var outputSmoothByStream = FloatArray(2)
  private var outputAirEnvelopeByStream = FloatArray(2)
  private var pitchRingByStream = Array(2) { FloatArray(PITCH_RING_SIZE) }
  private var pitchWriteIndexByStream = IntArray(2)
  private var pitchPhaseByStream = FloatArray(2)
  private var sonicProcessor = SonicAudioProcessor()
  private var sonicEffectId = ""
  private var sonicSampleRateHz = 0
  private var sonicChannelCount = 0
  private var isSonicConfigured = false
  private var sonicInputBuffer = ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder())
  private var fallbackOutputBySample = FloatArray(0)
  private var sonicOutputQueue = ShortArray(SONIC_OUTPUT_QUEUE_INITIAL_SAMPLES)
  private var sonicOutputReadIndex = 0
  private var sonicOutputSize = 0
  private var sonicWarmupRemainingSamples = 0
  private var sonicFailureCount = 0
  private var forceDelayPitchPath = false
  private val deviceForcesDelayPitchPath =
    Build.MANUFACTURER.equals("HONOR", ignoreCase = true) &&
      Build.MODEL.equals("BRP-NX1M", ignoreCase = true)
  private var sampleFloatScaleLabel = "floatS16"
  @Volatile
  private var pitchPathLabel = "delay"
  @Volatile
  private var inputRms = 0f
  @Volatile
  private var outputRms = 0f
  @Volatile
  private var deltaRms = 0f

  fun setEffect(nextEffectId: String) {
    val normalized = normalizeEffectId(nextEffectId)
    if (effectId != normalized) {
      effectId = normalized
      resetRequested = true
    }
  }

  fun beginSession(nextEffectId: String) {
    effectId = normalizeEffectId(nextEffectId)
    lastProcessedEffectId = "normal"
    processedBufferCount.set(0)
    processedFrameCount.set(0)
    resetRequested = true
  }

  fun getEffect(): String = effectId

  fun getProcessedBufferCount(): Long = processedBufferCount.get()

  fun getProcessedFrameCount(): Long = processedFrameCount.get()

  fun getLastProcessedEffect(): String = lastProcessedEffectId

  fun getSampleScaleLabel(): String = sampleFloatScaleLabel

  fun getInputRms(): Float = inputRms

  fun getOutputRms(): Float = outputRms

  fun getDeltaRms(): Float = deltaRms

  fun getPitchPathLabel(): String = pitchPathLabel

  fun isPassthrough(): Boolean = effectId == "normal"

  override fun isEnabled(): Boolean = true

  override fun getName(): String = "MeetVapLiveVoiceEffect"

  override fun initializeAudioProcessing(sampleRateHz: Int, numChannels: Int) {
    this.sampleRateHz = sampleRateHz.coerceAtLeast(8000)
    channelCount = numChannels.coerceAtLeast(1)
    ensureStreamState(channelCount)
    resetProcessingState()
  }

  override fun resetAudioProcessing(newRate: Int) {
    sampleRateHz = newRate.coerceAtLeast(8000)
    ensureStreamState(channelCount)
    resetProcessingState()
  }

  override fun processAudio(numBands: Int, numFrames: Int, buffer: ByteBuffer) {
    val currentEffect = effectId

    if (currentEffect == "normal" || numFrames <= 0) {
      return
    }

    val activeChannelCount = channelCount.coerceAtLeast(1)
    ensureStreamState(activeChannelCount)

    if (resetRequested) {
      resetProcessingState()
      resetRequested = false
    }

    buffer.order(ByteOrder.nativeOrder())

    val remainingBytes = buffer.remaining().coerceAtLeast(0)
    val baseOffset = if (remainingBytes > 0) buffer.position().coerceAtLeast(0) else 0
    val availableBytes = when {
      remainingBytes > 0 -> remainingBytes
      buffer.limit() > 0 -> buffer.limit()
      else -> buffer.capacity()
    }
    val availableFloatSamples = availableBytes / FLOAT_BYTES_PER_SAMPLE
    val expectedSamples = minOf(numFrames * activeChannelCount, availableFloatSamples)

    if (expectedSamples <= 0) {
      return
    }

    processFloatBuffer(currentEffect, buffer, baseOffset, expectedSamples, activeChannelCount)
    processedBufferCount.incrementAndGet()
    processedFrameCount.addAndGet((expectedSamples / activeChannelCount).coerceAtLeast(1).toLong())
    lastProcessedEffectId = currentEffect
  }

  private fun processFloatBuffer(
    currentEffect: String,
    buffer: ByteBuffer,
    baseOffset: Int,
    sampleCount: Int,
    activeChannelCount: Int,
  ) {
    ensureWorkBuffers(sampleCount)
    // WebRTC's AudioBuffer exposes float samples in int16 amplitude units here.
    // Quiet S16 frames can peak below 8, so per-frame "unit float" detection
    // causes scale flapping and breaks pitch shifting on some Android devices.
    val inputScale = FLOAT_S16_SCALE
    var inputEnergy = 0.0
    var outputEnergy = 0.0
    var deltaEnergy = 0.0

    val sonicReady = !deviceForcesDelayPitchPath && !forceDelayPitchPath && configureSonic(currentEffect, activeChannelCount)

    if (sonicReady) {
      pitchPathLabel = "sonic"
      sonicInputBuffer.clear()
      var sonicMissingSamples = 0

      var sampleOffset = 0
      while (sampleOffset < sampleCount) {
        val stream = sampleOffset % activeChannelCount
        val byteOffset = baseOffset + (sampleOffset * FLOAT_BYTES_PER_SAMPLE)
        val input = floatToNormalized(buffer.getFloat(byteOffset), inputScale)
        val cleanInput = removeDcOffset(input, stream)
        val delayPitchOutput = applyDelayPitchShift(currentEffect, cleanInput, stream)
        val delayFallbackOutput = applyFallbackEffect(currentEffect, cleanInput, stream)

        fallbackOutputBySample[sampleOffset] = blendPitchOutput(currentEffect, delayPitchOutput, delayFallbackOutput)
        sonicInputBuffer.putShort(floatToShort(cleanInput))
        inputEnergy += (cleanInput * cleanInput).toDouble()
        sampleOffset += 1
      }

      sonicInputBuffer.flip()
      sonicProcessor.queueInput(sonicInputBuffer)
      drainSonicOutput()

      sampleOffset = 0
      while (sampleOffset < sampleCount) {
        val stream = sampleOffset % activeChannelCount
        val byteOffset = baseOffset + (sampleOffset * FLOAT_BYTES_PER_SAMPLE)
        val input = floatToNormalized(buffer.getFloat(byteOffset), inputScale)
        val queuedSample = dequeueSonicOutput()
        val sourceOutput = when {
          sonicWarmupRemainingSamples > 0 -> {
            sonicWarmupRemainingSamples -= 1
            fallbackOutputBySample[sampleOffset]
          }
          queuedSample != null -> shortToNormalized(queuedSample)
          else -> {
            sonicMissingSamples += 1
            fallbackOutputBySample[sampleOffset]
          }
        }
        val toneShapedOutput = reduceWheeze(currentEffect, sourceOutput, stream)
        val output = smoothOutput(limitSample(toneShapedOutput * EFFECT_OUTPUT_GAIN), stream)
        val delta = output - input

        buffer.putFloat(byteOffset, normalizedToFloat(output, inputScale))
        outputEnergy += (output * output).toDouble()
        deltaEnergy += (delta * delta).toDouble()
        sampleOffset += 1
      }

      val nextInputRms = sqrt(inputEnergy / sampleCount.coerceAtLeast(1).toDouble()).toFloat()
      val nextOutputRms = sqrt(outputEnergy / sampleCount.coerceAtLeast(1).toDouble()).toFloat()
      val sonicSeemsStarved = sonicMissingSamples > (sampleCount / 3) ||
        (nextInputRms > SONIC_STARVATION_INPUT_RMS_THRESHOLD && nextOutputRms < SONIC_STARVATION_OUTPUT_RMS_THRESHOLD)

      if (sonicSeemsStarved) {
        sonicFailureCount += 1
        if (sonicFailureCount >= SONIC_FAILURE_LIMIT) {
          forceDelayPitchPath = true
          pitchPathLabel = "delay-fallback"
          clearSonicOutputQueue()
        }
      } else {
        sonicFailureCount = 0
      }
    } else {
      pitchPathLabel = when {
        deviceForcesDelayPitchPath -> "delay-device"
        forceDelayPitchPath -> "delay-fallback"
        else -> "delay"
      }
      var sampleOffset = 0
      while (sampleOffset < sampleCount) {
        val stream = sampleOffset % activeChannelCount
        val byteOffset = baseOffset + (sampleOffset * FLOAT_BYTES_PER_SAMPLE)
        val input = floatToNormalized(buffer.getFloat(byteOffset), inputScale)
        val cleanInput = removeDcOffset(input, stream)
        val pitchOutput = applyDelayPitchShift(currentEffect, cleanInput, stream)
        val fallbackOutput = applyFallbackEffect(currentEffect, cleanInput, stream)

        fallbackOutputBySample[sampleOffset] = blendPitchOutput(currentEffect, pitchOutput, fallbackOutput)
        inputEnergy += (cleanInput * cleanInput).toDouble()
        sampleOffset += 1
      }

      sampleOffset = 0
      while (sampleOffset < sampleCount) {
        val stream = sampleOffset % activeChannelCount
        val byteOffset = baseOffset + (sampleOffset * FLOAT_BYTES_PER_SAMPLE)
        val sourceOutput = fallbackOutputBySample[sampleOffset]
        val toneShapedOutput = reduceWheeze(currentEffect, sourceOutput, stream)
        val output = smoothOutput(limitSample(toneShapedOutput * EFFECT_OUTPUT_GAIN), stream)
        val input = floatToNormalized(buffer.getFloat(byteOffset), inputScale)
        val delta = output - input

        buffer.putFloat(byteOffset, normalizedToFloat(output, inputScale))
        outputEnergy += (output * output).toDouble()
        deltaEnergy += (delta * delta).toDouble()
        sampleOffset += 1
      }
    }

    val rmsSampleCount = sampleCount.coerceAtLeast(1).toDouble()
    inputRms = sqrt(inputEnergy / rmsSampleCount).toFloat()
    outputRms = sqrt(outputEnergy / rmsSampleCount).toFloat()
    deltaRms = sqrt(deltaEnergy / rmsSampleCount).toFloat()
  }

  private fun removeDcOffset(input: Float, stream: Int): Float {
    val output = input - previousInputByStream[stream] + (DC_BLOCKER_KEEP * highPassByStream[stream])
    previousInputByStream[stream] = input
    highPassByStream[stream] = output
    return output.coerceIn(-1f, 1f)
  }

  private fun applyFallbackEffect(currentEffect: String, input: Float, stream: Int): Float {
    val lowPass = (lowPassByStream[stream] * FALLBACK_LOW_PASS_KEEP) + (input * (1f - FALLBACK_LOW_PASS_KEEP))
    val highPass = input - lowPass

    lowPassByStream[stream] = lowPass

    return when (currentEffect) {
      "deep" -> limitSample((lowPass * 1.45f) - (highPass * 0.28f))
      "bright" -> limitSample((input * 0.88f) + (highPass * 0.24f))
      "helium" -> limitSample((input * 0.72f) + (highPass * 0.38f))
      else -> input
    }
  }

  private fun blendPitchOutput(currentEffect: String, pitchOutput: Float, fallbackOutput: Float): Float {
    val pitchMix = when (currentEffect) {
      "deep" -> 0.92f
      "bright" -> 0.84f
      "helium" -> 0.90f
      else -> 0f
    }

    return limitSample((pitchOutput * pitchMix) + (fallbackOutput * (1f - pitchMix)))
  }

  private fun applyDelayPitchShift(currentEffect: String, input: Float, stream: Int): Float {
    val pitch = getLivePitch(currentEffect)

    if (abs(pitch - 1f) < 0.01f) {
      return input
    }

    val ring = pitchRingByStream[stream]
    val writeIndex = pitchWriteIndexByStream[stream]
    ring[writeIndex] = input

    val nextWriteIndex = (writeIndex + 1) % ring.size
    pitchWriteIndexByStream[stream] = nextWriteIndex

    val minDelaySamples = (sampleRateHz * PITCH_SHIFT_MIN_DELAY_MS / 1000f)
      .coerceIn(PITCH_SHIFT_MIN_DELAY_FLOOR_SAMPLES, (ring.size / 4f))
    val sweepSamples = (sampleRateHz * PITCH_SHIFT_SWEEP_MS / 1000f)
      .coerceIn(PITCH_SHIFT_SWEEP_FLOOR_SAMPLES, (ring.size / 2f))
    val phase = normalizePhase(pitchPhaseByStream[stream])
    val phaseB = normalizePhase(phase + 0.5f)
    val tapA = readPitchTap(ring, nextWriteIndex, pitch, phase, minDelaySamples, sweepSamples)
    val tapB = readPitchTap(ring, nextWriteIndex, pitch, phaseB, minDelaySamples, sweepSamples)
    val weightA = pitchWindow(phase)
    val weightB = pitchWindow(phaseB)
    val shifted = ((tapA * weightA) + (tapB * weightB)) / (weightA + weightB).coerceAtLeast(0.0001f)
    val phaseStep = (abs(1f - pitch) / sweepSamples).coerceIn(0.00001f, 0.02f)

    pitchPhaseByStream[stream] = normalizePhase(phase + phaseStep)
    return limitSample(shifted)
  }

  private fun readPitchTap(
    ring: FloatArray,
    nextWriteIndex: Int,
    pitch: Float,
    phase: Float,
    minDelaySamples: Float,
    sweepSamples: Float,
  ): Float {
    val delay = if (pitch < 1f) {
      minDelaySamples + (phase * sweepSamples)
    } else {
      minDelaySamples + ((1f - phase) * sweepSamples)
    }

    return readDelayedSample(ring, nextWriteIndex, delay)
  }

  private fun readDelayedSample(ring: FloatArray, nextWriteIndex: Int, delaySamples: Float): Float {
    var readPosition = nextWriteIndex.toFloat() - delaySamples

    while (readPosition < 0f) {
      readPosition += ring.size
    }
    while (readPosition >= ring.size) {
      readPosition -= ring.size
    }

    val index = readPosition.toInt().coerceIn(0, ring.lastIndex)
    val nextIndex = (index + 1) % ring.size
    val fraction = readPosition - index
    return (ring[index] * (1f - fraction)) + (ring[nextIndex] * fraction)
  }

  private fun pitchWindow(phase: Float): Float {
    return (0.5f - (0.5f * cos((phase * TWO_PI).toDouble()).toFloat())).coerceAtLeast(0.001f)
  }

  private fun normalizePhase(value: Float): Float {
    var phase = value

    while (phase >= 1f) {
      phase -= 1f
    }
    while (phase < 0f) {
      phase += 1f
    }

    return phase
  }

  private fun reduceWheeze(currentEffect: String, input: Float, stream: Int): Float {
    val keep = when (currentEffect) {
      "helium" -> OUTPUT_TONE_KEEP_HELIUM
      "bright" -> OUTPUT_TONE_KEEP_BRIGHT
      else -> OUTPUT_TONE_KEEP_DEFAULT
    }
    val filtered = (outputToneByStream[stream] * keep) + (input * (1f - keep))
    val filterMix = when (currentEffect) {
      "helium" -> OUTPUT_TONE_MIX_HELIUM
      "bright" -> OUTPUT_TONE_MIX_BRIGHT
      else -> OUTPUT_TONE_MIX_DEFAULT
    }

    outputToneByStream[stream] = filtered
    val blended = (input * (1f - filterMix)) + (filtered * filterMix)
    return applyOutputDeEsser(currentEffect, blended, filtered, stream)
  }

  private fun applyOutputDeEsser(currentEffect: String, input: Float, filtered: Float, stream: Int): Float {
    val air = input - filtered
    val envelopeKeep = when (currentEffect) {
      "helium" -> OUTPUT_AIR_ENVELOPE_KEEP_HELIUM
      "bright" -> OUTPUT_AIR_ENVELOPE_KEEP_BRIGHT
      else -> OUTPUT_AIR_ENVELOPE_KEEP_DEFAULT
    }
    val nextEnvelope = (
      outputAirEnvelopeByStream[stream] * envelopeKeep
    ) + (abs(air) * (1f - envelopeKeep))
    outputAirEnvelopeByStream[stream] = nextEnvelope

    val threshold = when (currentEffect) {
      "helium" -> OUTPUT_AIR_THRESHOLD_HELIUM
      "bright" -> OUTPUT_AIR_THRESHOLD_BRIGHT
      else -> OUTPUT_AIR_THRESHOLD_DEFAULT
    }
    val maxCut = when (currentEffect) {
      "helium" -> OUTPUT_AIR_MAX_CUT_HELIUM
      "bright" -> OUTPUT_AIR_MAX_CUT_BRIGHT
      else -> OUTPUT_AIR_MAX_CUT_DEFAULT
    }

    val over = ((nextEnvelope - threshold) / (1f - threshold)).coerceIn(0f, 1f)
    val cut = maxCut * over
    val softenedAir = air * (1f - cut)
    return limitSample(filtered + softenedAir)
  }

  private fun smoothOutput(input: Float, stream: Int): Float {
    val output = (outputSmoothByStream[stream] * OUTPUT_SMOOTH_KEEP) + (input * (1f - OUTPUT_SMOOTH_KEEP))
    outputSmoothByStream[stream] = output
    return output
  }

  private fun configureSonic(currentEffect: String, activeChannelCount: Int): Boolean {
    if (
      isSonicConfigured &&
      sonicEffectId == currentEffect &&
      sonicSampleRateHz == sampleRateHz &&
      sonicChannelCount == activeChannelCount
    ) {
      return true
    }

    return runCatching {
      sonicProcessor.reset()
      sonicProcessor.setSpeed(1f)
      sonicProcessor.setPitch(getLivePitch(currentEffect))
      sonicProcessor.configure(AudioProcessor.AudioFormat(sampleRateHz, activeChannelCount, C.ENCODING_PCM_16BIT))
      sonicProcessor.flush()
      sonicEffectId = currentEffect
      sonicSampleRateHz = sampleRateHz
      sonicChannelCount = activeChannelCount
      isSonicConfigured = true
      clearSonicOutputQueue()
      sonicWarmupRemainingSamples = (activeChannelCount * SONIC_WARMUP_FRAMES).coerceAtLeast(activeChannelCount)
      true
    }.getOrElse {
      sonicEffectId = ""
      isSonicConfigured = false
      sonicWarmupRemainingSamples = 0
      clearSonicOutputQueue()
      false
    }
  }

  private fun drainSonicOutput() {
    val output = sonicProcessor.getOutput().order(ByteOrder.nativeOrder())

    while (output.remaining() >= SHORT_BYTES_PER_SAMPLE) {
      enqueueSonicOutput(output.getShort())
    }
  }

  private fun ensureStreamState(streamCount: Int) {
    if (previousInputByStream.size < streamCount) {
      previousInputByStream = FloatArray(streamCount)
      highPassByStream = FloatArray(streamCount)
      lowPassByStream = FloatArray(streamCount)
      outputToneByStream = FloatArray(streamCount)
      outputSmoothByStream = FloatArray(streamCount)
      outputAirEnvelopeByStream = FloatArray(streamCount)
    }

    if (pitchRingByStream.size < streamCount) {
      val nextRings = Array(streamCount) { stream ->
        if (stream < pitchRingByStream.size) pitchRingByStream[stream] else FloatArray(PITCH_RING_SIZE)
      }
      val nextWriteIndexes = IntArray(streamCount) { stream ->
        if (stream < pitchWriteIndexByStream.size) pitchWriteIndexByStream[stream] else 0
      }
      val nextPhases = FloatArray(streamCount) { stream ->
        if (stream < pitchPhaseByStream.size) pitchPhaseByStream[stream] else 0f
      }

      pitchRingByStream = nextRings
      pitchWriteIndexByStream = nextWriteIndexes
      pitchPhaseByStream = nextPhases
    }
  }

  private fun ensureWorkBuffers(sampleCount: Int) {
    val byteCount = sampleCount * SHORT_BYTES_PER_SAMPLE

    if (sonicInputBuffer.capacity() < byteCount) {
      sonicInputBuffer = ByteBuffer.allocateDirect(byteCount).order(ByteOrder.nativeOrder())
    }

    if (fallbackOutputBySample.size < sampleCount) {
      fallbackOutputBySample = FloatArray(sampleCount)
    }
  }

  private fun normalizeEffectId(value: String): String {
    return when (value) {
      "deep", "bright", "helium" -> value
      else -> "normal"
    }
  }

  private fun sanitizeSample(value: Float): Float {
    return if (value.isFinite()) value.coerceIn(-1f, 1f) else 0f
  }

  private fun floatToShort(value: Float): Short {
    return (sanitizeSample(value) * MAX_SHORT_FLOAT)
      .toInt()
      .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
      .toShort()
  }

  private fun shortToNormalized(value: Short): Float {
    return (value.toFloat() / MAX_SHORT_FLOAT).coerceIn(-1f, 1f)
  }

  private fun floatToNormalized(value: Float, scale: Float): Float {
    if (!value.isFinite()) {
      return 0f
    }

    return (value / scale.coerceAtLeast(1f)).coerceIn(-1f, 1f)
  }

  private fun normalizedToFloat(value: Float, scale: Float): Float {
    return sanitizeSample(value) * scale.coerceAtLeast(1f)
  }

  private fun limitSample(value: Float): Float {
    val clipped = value.coerceIn(-LIMITER_INPUT_CEILING, LIMITER_INPUT_CEILING)
    val magnitude = abs(clipped)

    if (magnitude <= LIMITER_KNEE) {
      return clipped
    }

    val sign = if (clipped < 0f) -1f else 1f
    val over = magnitude - LIMITER_KNEE
    val compressed = LIMITER_KNEE + ((over / (1f + over)) * (1f - LIMITER_KNEE))
    return sign * compressed.coerceAtMost(1f)
  }

  private fun enqueueSonicOutput(sample: Short) {
    ensureSonicOutputCapacity(1)
    val writeIndex = (sonicOutputReadIndex + sonicOutputSize) % sonicOutputQueue.size

    sonicOutputQueue[writeIndex] = sample
    sonicOutputSize += 1
  }

  private fun dequeueSonicOutput(): Short? {
    if (sonicOutputSize <= 0) {
      return null
    }

    val sample = sonicOutputQueue[sonicOutputReadIndex]
    sonicOutputReadIndex = (sonicOutputReadIndex + 1) % sonicOutputQueue.size
    sonicOutputSize -= 1
    return sample
  }

  private fun ensureSonicOutputCapacity(additionalSamples: Int) {
    if (sonicOutputSize + additionalSamples <= sonicOutputQueue.size) {
      return
    }

    var nextSize = sonicOutputQueue.size
    while (nextSize < sonicOutputSize + additionalSamples) {
      nextSize *= 2
    }

    val nextQueue = ShortArray(nextSize)
    var index = 0
    while (index < sonicOutputSize) {
      nextQueue[index] = sonicOutputQueue[(sonicOutputReadIndex + index) % sonicOutputQueue.size]
      index += 1
    }

    sonicOutputQueue = nextQueue
    sonicOutputReadIndex = 0
  }

  private fun clearSonicOutputQueue() {
    sonicOutputReadIndex = 0
    sonicOutputSize = 0
    sonicWarmupRemainingSamples = 0
  }

  private fun resetProcessingState() {
    previousInputByStream.fill(0f)
    highPassByStream.fill(0f)
    lowPassByStream.fill(0f)
    outputToneByStream.fill(0f)
    outputSmoothByStream.fill(0f)
    outputAirEnvelopeByStream.fill(0f)
    pitchRingByStream.forEach { it.fill(0f) }
    pitchWriteIndexByStream.fill(0)
    pitchPhaseByStream.fill(0f)
    sampleFloatScaleLabel = "floatS16"
    pitchPathLabel = "delay"
    inputRms = 0f
    outputRms = 0f
    deltaRms = 0f
    sonicFailureCount = 0
    forceDelayPitchPath = false
    sonicEffectId = ""
    isSonicConfigured = false
    sonicProcessor.reset()
    clearSonicOutputQueue()
  }

  private fun getLivePitch(currentEffect: String): Float {
    return when (currentEffect) {
      "deep" -> 0.78f
      "bright" -> 1.22f
      "helium" -> 1.42f
      else -> 1f
    }
  }

  private companion object {
    private const val SHORT_BYTES_PER_SAMPLE = 2
    private const val FLOAT_BYTES_PER_SAMPLE = 4
    private const val MAX_SHORT_FLOAT = 32767f
    private const val FLOAT_S16_SCALE = 32768f
    private const val PITCH_RING_SIZE = 96000
    private const val PITCH_SHIFT_MIN_DELAY_MS = 12f
    private const val PITCH_SHIFT_SWEEP_MS = 34f
    private const val PITCH_SHIFT_MIN_DELAY_FLOOR_SAMPLES = 160f
    private const val PITCH_SHIFT_SWEEP_FLOOR_SAMPLES = 480f
    private const val TWO_PI = 6.2831855f
    private const val DC_BLOCKER_KEEP = 0.995f
    private const val FALLBACK_LOW_PASS_KEEP = 0.86f
    private const val OUTPUT_TONE_KEEP_DEFAULT = 0.34f
    private const val OUTPUT_TONE_KEEP_BRIGHT = 0.42f
    private const val OUTPUT_TONE_KEEP_HELIUM = 0.48f
    private const val OUTPUT_TONE_MIX_DEFAULT = 0.30f
    private const val OUTPUT_TONE_MIX_BRIGHT = 0.42f
    private const val OUTPUT_TONE_MIX_HELIUM = 0.52f
    private const val OUTPUT_AIR_ENVELOPE_KEEP_DEFAULT = 0.86f
    private const val OUTPUT_AIR_ENVELOPE_KEEP_BRIGHT = 0.89f
    private const val OUTPUT_AIR_ENVELOPE_KEEP_HELIUM = 0.91f
    private const val OUTPUT_AIR_THRESHOLD_DEFAULT = 0.026f
    private const val OUTPUT_AIR_THRESHOLD_BRIGHT = 0.020f
    private const val OUTPUT_AIR_THRESHOLD_HELIUM = 0.016f
    private const val OUTPUT_AIR_MAX_CUT_DEFAULT = 0.26f
    private const val OUTPUT_AIR_MAX_CUT_BRIGHT = 0.40f
    private const val OUTPUT_AIR_MAX_CUT_HELIUM = 0.54f
    private const val OUTPUT_SMOOTH_KEEP = 0.30f
    private const val SONIC_UNDERFLOW_SMOOTH_MIX = 0.82f
    private const val SONIC_WARMUP_FRAMES = 960
    private const val SONIC_STARVATION_INPUT_RMS_THRESHOLD = 0.015f
    private const val SONIC_STARVATION_OUTPUT_RMS_THRESHOLD = 0.002f
    private const val SONIC_FAILURE_LIMIT = 2
    private const val EFFECT_OUTPUT_GAIN = 1.0f
    private const val LIMITER_INPUT_CEILING = 1.6f
    private const val LIMITER_KNEE = 0.88f
    private const val SONIC_OUTPUT_QUEUE_INITIAL_SAMPLES = 48000
  }
}
