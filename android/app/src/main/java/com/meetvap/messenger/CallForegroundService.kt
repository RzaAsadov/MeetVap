package com.meetvap.messenger

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class CallForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val mode = intent?.getStringExtra(EXTRA_MODE)?.lowercase() ?: "voice"
    val notification = createNotification(mode)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val serviceType = if (mode == "video") {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      } else {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
      startForeground(NOTIFICATION_ID, notification, serviceType)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    return START_STICKY
  }

  private fun createNotification(mode: String): Notification {
    ensureNotificationChannel()

    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(this, MainActivity::class.java)
    val pendingIntentFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }
    val contentIntent = PendingIntent.getActivity(this, 0, launchIntent, pendingIntentFlags)
    val title = if (mode == "video") "Video call in progress" else "Voice call in progress"

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setCategory(Notification.CATEGORY_CALL)
      .setContentIntent(contentIntent)
      .setContentText("Tap to return to MeetVap")
      .setContentTitle(title)
      .setOngoing(true)
      .setSmallIcon(android.R.drawable.stat_sys_phone_call)
      .build()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) {
      return
    }

    val channel = NotificationChannel(CHANNEL_ID, "Calls", NotificationManager.IMPORTANCE_LOW)
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  companion object {
    const val EXTRA_MODE = "mode"
    private const val CHANNEL_ID = "meetvap_calls"
    private const val NOTIFICATION_ID = 4701
  }
}
