import { createNavigationContainerRef } from '@react-navigation/native';

import { beginCallOnlyAccess, getCallOnlyAccessCallId, isCallOnlyAccessFor, shouldOpenIncomingCallAsCallOnly } from '../lib/appLockAccess';
import { getActiveCallSession, isSameActiveCall, setActiveCallSession } from '../lib/activeCallSession';
import { getActiveMeetingSession } from '../lib/activeMeetingSession';
import { emitCallEvent } from '../lib/callEvents';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { useAppStore } from '../store/useAppStore';
import { RootStackParamList } from '../types/navigation';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
const CHAT_OPEN_DIAGNOSTICS_ENABLED = false;

let pendingNavigationAction: (() => void) | null = null;

function logChatOpenDiagnostic(event: string, details: Record<string, unknown> = {}) {
  if (!CHAT_OPEN_DIAGNOSTICS_ENABLED) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[MeetVapChatOpen] ${event}`, details);
}

function runWhenNavigationReady(action: () => void) {
  if (navigationRef.isReady()) {
    action();
    return;
  }

  pendingNavigationAction = action;
}

export function flushPendingNavigation() {
  if (!navigationRef.isReady() || !pendingNavigationAction) {
    return;
  }

  const action = pendingNavigationAction;
  pendingNavigationAction = null;
  action();
}

export function navigateToIncomingCall(input: {
  answeredByNative?: boolean;
  autoJoin?: boolean;
  callId: string;
  forceCallOnlyAccess?: boolean;
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'voice' | 'video';
  participantNames?: string[];
  title: string;
}) {
  runWhenNavigationReady(() => {
    const activeCall = getActiveCallSession();

    if (isSameActiveCall(activeCall, { callId: input.callId, conversationId: input.conversationId, mode: input.mode, title: input.title })) {
      return;
    }

    if (activeCall?.callState === 'active') {
      if (activeCall.callId === input.callId) {
        return;
      }

      if (activeCall.conversationId !== input.conversationId) {
        emitCallEvent('incomingInvite', {
          answeredByNative: input.answeredByNative,
          autoJoin: input.autoJoin,
          callId: input.callId,
          conversationId: input.conversationId,
          fromDisplayName: input.title,
          isGroupCall: input.isGroupCall,
          mode: input.mode.toUpperCase() as 'VOICE' | 'VIDEO',
          participantNames: input.participantNames,
        });
        return;
      }

      setActiveCallSession(null);
    }

    if (isCallRoomVisibleFor(input.callId)) {
      return;
    }

    const shouldUseCallOnlyAccess = input.answeredByNative === true ||
      input.forceCallOnlyAccess === true ||
      isCallOnlyAccessFor(input.callId) ||
      shouldOpenIncomingCallAsCallOnly();

    if (shouldUseCallOnlyAccess) {
      beginCallOnlyAccess(input.callId);
    }

    navigationRef.navigate('CallRoom', {
      answeredByNative: input.answeredByNative,
      autoJoin: input.autoJoin,
      callAccess: shouldUseCallOnlyAccess ? 'locked-call' : undefined,
      callId: input.callId,
      conversationId: input.conversationId,
      direction: 'incoming',
      isGroupCall: input.isGroupCall,
      mode: input.mode,
      participantNames: input.participantNames,
      title: input.title,
    });
  });
}

export function isCallRoomVisibleFor(callId?: string | null) {
  if (!navigationRef.isReady()) {
    return false;
  }

  const currentRoute = navigationRef.getCurrentRoute();

  if (currentRoute?.name !== 'CallRoom') {
    return false;
  }

  if (!callId) {
    return true;
  }

  const params = currentRoute.params as RootStackParamList['CallRoom'] | undefined;
  return params?.callId === callId;
}

export function getVisibleCallRoomParams() {
  if (!navigationRef.isReady()) {
    return null;
  }

  const currentRoute = navigationRef.getCurrentRoute();

  if (currentRoute?.name !== 'CallRoom') {
    return null;
  }

  return currentRoute.params as RootStackParamList['CallRoom'] | undefined ?? null;
}

export function getVisibleChatRoomConversationId() {
  if (!navigationRef.isReady()) {
    return null;
  }

  const currentRoute = navigationRef.getCurrentRoute();

  if (currentRoute?.name !== 'ChatRoom') {
    return null;
  }

  const params = currentRoute.params as RootStackParamList['ChatRoom'] | undefined;
  return params?.conversationId ?? null;
}

export function restoreActiveCallIfNeeded() {
  runWhenNavigationReady(() => {
    const pendingAnsweredCallId = getCallOnlyAccessCallId();

    if (pendingAnsweredCallId && !isCallRoomVisibleFor(pendingAnsweredCallId)) {
      return;
    }

    const activeCall = getActiveCallSession();

    if (!activeCall || activeCall.callState !== 'active') {
      return;
    }

    if (pendingAnsweredCallId && activeCall.callId !== pendingAnsweredCallId) {
      setActiveCallSession(null);
      return;
    }

    const currentRoute = navigationRef.getCurrentRoute();

    if (
      currentRoute?.name === 'CallRoom' &&
      isSameActiveCall(currentRoute.params as RootStackParamList['CallRoom'] | undefined, activeCall)
    ) {
      return;
    }

    const shouldUseCallOnlyAccess = !!activeCall.callId && shouldOpenIncomingCallAsCallOnly();

    if (shouldUseCallOnlyAccess && activeCall.callId) {
      beginCallOnlyAccess(activeCall.callId);
    }

    navigationRef.navigate('CallRoom', {
      ...activeCall,
      callAccess: shouldUseCallOnlyAccess ? 'locked-call' : activeCall.callAccess,
      resumeActiveCall: true,
    });
  });
}

export function navigateToChat(input: {
  conversationId: string;
  openReason?: RootStackParamList['ChatRoom']['openReason'];
  targetMessageId?: string;
  title: string;
}) {
  const navigate = () => {
    runWhenNavigationReady(() => {
      logChatOpenDiagnostic('navigation-ref-chat-navigation-start', {
        conversationId: input.conversationId,
        openReason: input.openReason,
        targetMessageId: input.targetMessageId,
      });
      logMessageDeliveryDiagnostic('navigate-to-chat', {
        conversationId: input.conversationId,
        openReason: input.openReason,
        targetMessageId: input.targetMessageId,
      });
      navigationRef.navigate('ChatRoom', {
        conversationId: input.conversationId,
        openReason: input.openReason,
        targetMessageId: input.targetMessageId,
        title: input.title,
      });
    });
  };
  const hasLiveMessages = (useAppStore.getState().messagesByConversation[input.conversationId] ?? []).length > 0;

  navigate();

  void (async () => {
    logChatOpenDiagnostic('navigation-ref-chat-preload-start', {
      conversationId: input.conversationId,
      hasLiveMessages,
      openReason: input.openReason,
      targetMessageId: input.targetMessageId,
    });
    logMessageDeliveryDiagnostic('navigate-to-chat-preload-start', {
      conversationId: input.conversationId,
      hasLiveMessages,
      openReason: input.openReason,
      targetMessageId: input.targetMessageId,
    });

    if (!hasLiveMessages) {
      await useAppStore.getState().prepareConversationMessages(input.conversationId, { limit: 80 }).catch((error) => {
        logChatOpenDiagnostic('navigation-ref-chat-preload-local-failed', {
          conversationId: input.conversationId,
          message: error instanceof Error ? error.message : String(error),
        });
        logMessageDeliveryDiagnostic('navigate-to-chat-preload-local-failed', {
          conversationId: input.conversationId,
          message: error instanceof Error ? error.message : String(error),
          targetMessageId: input.targetMessageId,
        });
      });
    }

    await useAppStore.getState().loadMessages(input.conversationId, { hydrate: false }).catch((error) => {
      logChatOpenDiagnostic('navigation-ref-chat-preload-server-failed', {
        conversationId: input.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      logMessageDeliveryDiagnostic('navigate-to-chat-preload-server-failed', {
        conversationId: input.conversationId,
        message: error instanceof Error ? error.message : String(error),
        targetMessageId: input.targetMessageId,
      });
    });
    logChatOpenDiagnostic('navigation-ref-chat-preload-finished', {
      conversationId: input.conversationId,
      targetMessageId: input.targetMessageId,
    });
    logMessageDeliveryDiagnostic('navigate-to-chat-preload-finished', {
      conversationId: input.conversationId,
      targetMessageId: input.targetMessageId,
    });
  })();
}

export function navigateToChats() {
  runWhenNavigationReady(() => {
    navigationRef.navigate('MainTabs', { screen: 'Chats' });
  });
}

export function navigateToMeeting(input: string | RootStackParamList['MeetingRoom']) {
  runWhenNavigationReady(() => {
    const params = typeof input === 'string' ? { code: input } : input;
    navigationRef.navigate('MeetingRoom', params);
  });
}

export function restoreActiveMeetingIfNeeded() {
  runWhenNavigationReady(() => {
    const activeMeeting = getActiveMeetingSession();

    if (!activeMeeting) {
      return;
    }

    const currentRoute = navigationRef.getCurrentRoute();
    const currentParams = currentRoute?.params as RootStackParamList['MeetingRoom'] | undefined;

    if (currentRoute?.name === 'MeetingRoom' && currentParams?.code === activeMeeting.code) {
      return;
    }

    navigationRef.navigate('MeetingRoom', {
      ...activeMeeting,
      autoJoin: true,
    });
  });
}
