type CallEventPayload = {
  answeredByNative?: boolean;
  answerClientId?: string;
  answerSurface?: string;
  autoJoin?: boolean;
  callId: string;
  callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED';
  conversationId?: string;
  fromDisplayName?: string;
  isGroupCall?: boolean;
  mode?: 'VOICE' | 'VIDEO';
  participantNames?: string[];
  userId?: string;
};

type CallEventName = 'answered' | 'ended' | 'incomingInvite' | 'ringing';
type CallEventListener = (payload: CallEventPayload) => void;

const listeners: Record<CallEventName, Set<CallEventListener>> = {
  answered: new Set(),
  ended: new Set(),
  incomingInvite: new Set(),
  ringing: new Set(),
};

export function emitCallEvent(event: CallEventName, payload: CallEventPayload) {
  listeners[event].forEach((listener) => listener(payload));
}

export function subscribeToCallEvent(event: CallEventName, listener: CallEventListener) {
  listeners[event].add(listener);

  return () => {
    listeners[event].delete(listener);
  };
}
