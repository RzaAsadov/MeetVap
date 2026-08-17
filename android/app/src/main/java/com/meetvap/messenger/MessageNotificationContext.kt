package com.meetvap.messenger

object MessageNotificationContext {
  @Volatile
  private var visibleConversationId: String? = null

  fun setVisibleConversation(conversationId: String?) {
    visibleConversationId = conversationId?.trim()?.takeIf { it.isNotEmpty() }
  }

  fun isConversationVisible(conversationId: String?): Boolean {
    return !conversationId.isNullOrBlank() && visibleConversationId == conversationId
  }
}
