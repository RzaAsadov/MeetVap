import { useCallback } from 'react';

import { useAppStore } from '../store/useAppStore';
import { Conversation } from '../types/domain';

let cachedConversations: Conversation[] | null = null;
let cachedConversationsById = new Map<string, Conversation>();

function getConversationById(conversations: Conversation[], conversationId: string) {
  if (cachedConversations !== conversations) {
    cachedConversations = conversations;
    cachedConversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  }

  return cachedConversationsById.get(conversationId);
}

export function useConversationById(conversationId: string) {
  return useAppStore(
    useCallback(
      (state: { conversations: Conversation[] }) => getConversationById(state.conversations, conversationId),
      [conversationId],
    ),
  );
}
