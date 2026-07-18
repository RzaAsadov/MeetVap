export type ConversationListFilter = 'all' | 'unread' | 'groups' | 'favorites';

export const CONVERSATION_LIST_STALE_MS = 5 * 60_000;

export function isServerSideConversationFilter(filter: ConversationListFilter) {
  return filter === 'unread' || filter === 'groups';
}
