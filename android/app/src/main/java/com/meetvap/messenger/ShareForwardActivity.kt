package com.meetvap.messenger

import android.app.Activity
import android.content.Intent
import android.os.Bundle

class ShareForwardActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    forwardShareIntent(intent)
    finish()
    overridePendingTransition(0, 0)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    forwardShareIntent(intent)
    finish()
    overridePendingTransition(0, 0)
  }

  private fun forwardShareIntent(source: Intent?) {
    if (source == null) {
      return
    }

    val grantFlags = source.flags and (
      Intent.FLAG_GRANT_READ_URI_PERMISSION or
        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
        Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
      )

    val forwardIntent = Intent(this, MainActivity::class.java).apply {
      action = source.action
      if (source.data != null && source.type != null) {
        setDataAndType(source.data, source.type)
      } else if (source.type != null) {
        type = source.type
      } else if (source.data != null) {
        data = source.data
      }
      clipData = source.clipData
      putExtras(source)
      addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or grantFlags)
    }

    startActivity(forwardIntent)
  }
}
