package com.meetvap.messenger

import android.app.KeyguardManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  companion object {
    @Volatile
    var isCallPictureInPictureEnabled: Boolean = false
    @Volatile
    var isAppInForeground: Boolean = false
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    applyIncomingCallWindowFlags(intent)
    updatePictureInPictureParams()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    applyIncomingCallWindowFlags(intent)
  }

  override fun onResume() {
    super.onResume()
    isAppInForeground = true
  }

  override fun onPause() {
    isAppInForeground = false
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      enterCallPictureInPictureIfNeeded(220)
    }
    super.onPause()
  }

  private fun applyIncomingCallWindowFlags(intent: Intent?) {
    val data = intent?.data
    val isIncomingCall = data?.scheme == "meetvap" && data.host == "incoming-call"
    val isCallNotificationLaunch = data?.scheme == "meetvap" && (data.host == "incoming-call" || data.host == "chats")
    val isDeclineOnly = isIncomingCall && data?.getQueryParameter("action") == "decline"
    val isAcceptedIncomingCall = isIncomingCall && data?.getQueryParameter("answeredByNative") == "true"

    if (isCallNotificationLaunch) {
      if (isIncomingCall) {
        IncomingCallIntentStore.remember(intent)
      }
      IncomingCallNotificationHelper.stopRingtone()
      IncomingCallNotificationHelper.cancel(applicationContext, data?.getQueryParameter("callId"))
    }

    if (isDeclineOnly) {
      Handler(Looper.getMainLooper()).postDelayed({
        moveTaskToBack(true)
      }, 250)
      return
    }

    if (!isIncomingCall) {
      return
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
      )
    }

    if (isAcceptedIncomingCall && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val keyguardManager = getSystemService(KeyguardManager::class.java)
      keyguardManager?.requestDismissKeyguard(this, null)
    }
  }

  fun updatePictureInPictureParams() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val sourceRect = getPictureInPictureSourceRect()
      setPictureInPictureParams(
        CallNativeModule.createPictureInPictureParams(
          isCallPictureInPictureEnabled,
          sourceRect,
        ),
      )
    }
  }

  override fun onUserLeaveHint() {
    if (
      isCallPictureInPictureEnabled &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S
    ) {
      enterCallPictureInPictureIfNeeded(220)
      return
    }

    super.onUserLeaveHint()
  }

  private fun enterCallPictureInPictureIfNeeded(delayMs: Long) {
    if (!isCallPictureInPictureEnabled || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || isInPictureInPictureMode || isFinishing) {
      return
    }

    Handler(Looper.getMainLooper()).postDelayed({
      if (isCallPictureInPictureEnabled && !isInPictureInPictureMode && !isFinishing) {
        runCatching {
          val sourceRect = getPictureInPictureSourceRect()
          enterPictureInPictureMode(
            CallNativeModule.createPictureInPictureParams(
              isCallPictureInPictureEnabled,
              sourceRect,
            ),
          )
        }
      }
    }, delayMs)
  }

  private fun getPictureInPictureSourceRect(): Rect? {
    val rect = Rect()
    return if (window.decorView.getGlobalVisibleRect(rect) && !rect.isEmpty) {
      rect
    } else {
      null
    }
  }

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
