import type { SharedIntentItem } from '../types/navigation';

type PendingShareDraft = {
  conversationId: string;
  items: SharedIntentItem[];
};

let pendingShareDraft: PendingShareDraft | null = null;

export function setPendingShareDraft(conversationId: string, items: SharedIntentItem[]) {
  pendingShareDraft = {
    conversationId,
    items,
  };
}

export function takePendingShareDraft(conversationId: string) {
  if (!pendingShareDraft || pendingShareDraft.conversationId !== conversationId) {
    return null;
  }

  const nextDraft = pendingShareDraft;
  pendingShareDraft = null;
  return nextDraft.items;
}
