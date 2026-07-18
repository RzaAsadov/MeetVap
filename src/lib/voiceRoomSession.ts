import { getActiveCallSession, subscribeToActiveCallSession } from './activeCallSession';
import { joinVoiceRoom, leaveVoiceRoom, updateVoiceRoomParticipant } from './backend';
import { logVoiceRoomDiagnostic } from './voiceRoomDiagnostics';
import type { VoiceRoomParticipant } from '../types/domain';

export type VoiceRoomAudioRoute = {
  id: string;
  label: string;
};

export type VoiceRoomSessionState = {
  adminMuted: boolean;
  conversationId: string | null;
  error: string | null;
  isConnecting: boolean;
  isPushToTalking: boolean;
  isSelfMuted: boolean;
  isSpeakerMuted: boolean;
  isSuspendedForCall: boolean;
  roomName: string | null;
  serverUrl: string | null;
  title: string | null;
  token: string | null;
  url: string | null;
  userId: string | null;
};

const initialState: VoiceRoomSessionState = {
  adminMuted: false,
  conversationId: null,
  error: null,
  isConnecting: false,
  isPushToTalking: false,
  isSelfMuted: true,
  isSpeakerMuted: false,
  isSuspendedForCall: false,
  roomName: null,
  serverUrl: null,
  title: null,
  token: null,
  url: null,
  userId: null,
};

type Listener = (state: VoiceRoomSessionState) => void;
const listeners = new Set<Listener>();
let state = initialState;

function setState(patch: Partial<VoiceRoomSessionState>) {
  state = { ...state, ...patch };
  logVoiceRoomDiagnostic('session-state', {
    adminMuted: state.adminMuted,
    conversationId: state.conversationId,
    error: state.error,
    hasToken: !!state.token,
    hasUrl: !!state.url,
    isConnecting: state.isConnecting,
    isPushToTalking: state.isPushToTalking,
    isSelfMuted: state.isSelfMuted,
    isSpeakerMuted: state.isSpeakerMuted,
    isSuspendedForCall: state.isSuspendedForCall,
    patchKeys: Object.keys(patch),
    roomName: state.roomName,
    userId: state.userId,
  });
  listeners.forEach((listener) => listener(state));
}

export function getVoiceRoomSessionState() {
  return state;
}

export function subscribeToVoiceRoomSession(listener: Listener) {
  listeners.add(listener);
  listener(state);

  return () => {
    listeners.delete(listener);
  };
}

export async function joinVoiceRoomSession(input: { conversationId: string; serverUrl: string; title: string; userId: string }) {
  logVoiceRoomDiagnostic('join-request', {
    conversationId: input.conversationId,
    hasActiveCall: getActiveCallSession()?.callState === 'active',
    userId: input.userId,
  });

  if (getActiveCallSession()?.callState === 'active') {
    setState({
      conversationId: input.conversationId,
      error: 'active-call',
      isConnecting: false,
      serverUrl: input.serverUrl,
      title: input.title,
      userId: input.userId,
    });
    return false;
  }

  setState({
    adminMuted: false,
    conversationId: input.conversationId,
    error: null,
    isConnecting: true,
    isPushToTalking: false,
    isSelfMuted: true,
    isSpeakerMuted: false,
    isSuspendedForCall: false,
    serverUrl: input.serverUrl,
    title: input.title,
    userId: input.userId,
  });

  try {
    const response = await joinVoiceRoom(input.serverUrl, input.conversationId);
    logVoiceRoomDiagnostic('join-response', {
      adminMuted: response.participant.adminMuted,
      conversationId: input.conversationId,
      hasToken: !!response.token,
      hasUrl: !!response.url,
      roomName: response.roomName,
      selfMuted: response.participant.selfMuted,
    });

    setState({
      adminMuted: response.participant.adminMuted,
      error: null,
      isConnecting: false,
      isSelfMuted: response.participant.selfMuted,
      roomName: response.roomName,
      token: response.token,
      url: response.url,
    });
    return true;
  } catch (error) {
    logVoiceRoomDiagnostic('join-failed', {
      conversationId: input.conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
    setState({
      error: error instanceof Error ? error.message : 'Could not join voice room',
      isConnecting: false,
      roomName: null,
      token: null,
      url: null,
    });
    return false;
  }
}

export async function leaveVoiceRoomSession(options: { clear?: boolean; reason?: 'call' | 'leave' } = {}) {
  const current = state;
  logVoiceRoomDiagnostic('leave-request', {
    clear: options.clear,
    conversationId: current.conversationId,
    hasToken: !!current.token,
    reason: options.reason,
  });

  setState({
    isConnecting: false,
    isPushToTalking: false,
    roomName: null,
    token: null,
    url: null,
    ...(options.reason === 'call' ? { isSuspendedForCall: true } : {}),
  });

  if (current.serverUrl && current.conversationId) {
    await leaveVoiceRoom(current.serverUrl, current.conversationId).catch((error) => {
      logVoiceRoomDiagnostic('leave-server-failed', {
        conversationId: current.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  if (options.clear !== false && options.reason !== 'call') {
    setState(initialState);
  }
}

export async function setVoiceRoomSelfMuted(selfMuted: boolean) {
  const current = state;
  logVoiceRoomDiagnostic('self-muted-request', {
    conversationId: current.conversationId,
    selfMuted,
    userId: current.userId,
  });

  setState({ isPushToTalking: false, isSelfMuted: selfMuted });

  if (current.serverUrl && current.conversationId && current.userId) {
    const participant = await updateVoiceRoomParticipant(current.serverUrl, current.conversationId, current.userId, { selfMuted })
      .catch((error): VoiceRoomParticipant | null => {
        logVoiceRoomDiagnostic('self-muted-update-failed', {
          conversationId: current.conversationId,
          message: error instanceof Error ? error.message : String(error),
          selfMuted,
          userId: current.userId,
        });
        return null;
      });

    if (participant) {
      setState({
        adminMuted: participant.adminMuted,
        isSelfMuted: participant.selfMuted,
      });
    }
  }
}

export function setVoiceRoomAdminMuted(adminMuted: boolean) {
  logVoiceRoomDiagnostic('admin-muted-state', { adminMuted, conversationId: state.conversationId });
  setState({ adminMuted });
}

export function setVoiceRoomSpeakerMuted(isSpeakerMuted: boolean) {
  logVoiceRoomDiagnostic('speaker-muted-state', { conversationId: state.conversationId, isSpeakerMuted });
  setState({ isSpeakerMuted });
}

export function setVoiceRoomPushToTalking(isPushToTalking: boolean) {
  logVoiceRoomDiagnostic('push-to-talk-state', { conversationId: state.conversationId, isPushToTalking });
  setState({ isPushToTalking });
}

export async function handleVoiceRoomActiveCallChange() {
  const current = state;
  const hasActiveCall = getActiveCallSession()?.callState === 'active';
  logVoiceRoomDiagnostic('active-call-change', {
    conversationId: current.conversationId,
    hasActiveCall,
    hasToken: !!current.token,
    isSuspendedForCall: current.isSuspendedForCall,
  });

  if (hasActiveCall && current.conversationId && current.token) {
    await leaveVoiceRoomSession({ clear: false, reason: 'call' });
    return;
  }

  if (!hasActiveCall && current.isSuspendedForCall && current.conversationId && current.serverUrl && current.title && current.userId) {
    await joinVoiceRoomSession({
      conversationId: current.conversationId,
      serverUrl: current.serverUrl,
      title: current.title,
      userId: current.userId,
    });
  }
}

export function subscribeVoiceRoomToActiveCalls() {
  return subscribeToActiveCallSession(() => {
    void handleVoiceRoomActiveCallChange();
  });
}
