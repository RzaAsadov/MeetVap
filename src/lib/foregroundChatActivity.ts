import { setNativeVisibleMessageConversation } from '../native/CallNative';

let activeConversationId: string | null = null;
const listeners = new Set<(conversationId: string | null) => void>();

export function getActiveForegroundChatConversationId() {
  return activeConversationId;
}

export function setActiveForegroundChatConversationId(conversationId: string | null) {
  if (activeConversationId === conversationId) {
    return;
  }

  activeConversationId = conversationId;
  setNativeVisibleMessageConversation(activeConversationId);
  listeners.forEach((listener) => listener(activeConversationId));
}

export function clearActiveForegroundChatConversationId(conversationId: string) {
  if (activeConversationId === conversationId) {
    activeConversationId = null;
    setNativeVisibleMessageConversation(null);
    listeners.forEach((listener) => listener(activeConversationId));
  }
}

export function isForegroundChatActive() {
  return activeConversationId !== null;
}

export function addForegroundChatActivityListener(listener: (conversationId: string | null) => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}
