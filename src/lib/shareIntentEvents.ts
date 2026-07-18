import { SharedIntentItem } from '../types/navigation';

type ShareIntentListener = (items: SharedIntentItem[]) => void;

const listeners = new Set<ShareIntentListener>();

export function emitShareIntentItems(items: SharedIntentItem[]) {
  listeners.forEach((listener) => listener(items));
}

export function subscribeToShareIntentItems(listener: ShareIntentListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
