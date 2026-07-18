import { RootStackParamList } from '../types/navigation';

export type ActiveCallRoute = RootStackParamList['CallRoom'];
type ActiveCallListener = (session: ActiveCallRoute | null) => void;

let activeCallSession: ActiveCallRoute | null = null;
const listeners = new Set<ActiveCallListener>();

export function getActiveCallSession() {
  return activeCallSession;
}

export function setActiveCallSession(session: ActiveCallRoute | null) {
  activeCallSession = session;
  listeners.forEach((listener) => listener(activeCallSession));
}

export function subscribeToActiveCallSession(listener: ActiveCallListener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function isSameActiveCall(left: ActiveCallRoute | null | undefined, right: ActiveCallRoute | null | undefined) {
  if (!left || !right) {
    return false;
  }

  if (left.callId && right.callId) {
    return left.callId === right.callId;
  }

  return left.conversationId === right.conversationId &&
    left.direction === right.direction &&
    left.mode === right.mode;
}
