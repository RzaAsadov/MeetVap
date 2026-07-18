import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import NetInfo from '@react-native-community/netinfo';
import { AppState, InteractionManager, Keyboard, Platform } from 'react-native';

import { beginCallOnlyAccess, shouldOpenIncomingCallAsCallOnly } from '../lib/appLockAccess';
import { getActiveCallSession, isSameActiveCall } from '../lib/activeCallSession';
import { emitCallEvent } from '../lib/callEvents';
import { acknowledgeConversationDeletion, acknowledgeMessageDeletions, acknowledgeMessageEdits, mapMessage, ringCall } from '../lib/backend';
import type { MessageEdit, MessageReactionUpdate } from '../lib/backend';
import { getVisibleChatRoomConversationId, isCallRoomVisibleFor, restoreActiveCallIfNeeded } from '../navigation/navigationRef';
import { MASK_SOCKET_AUTH_KEY, MASK_SOCKET_VERSION_KEY, MASK_VERSION, maskPayload } from '../lib/payloadMask';
import { showNativeAndroidIncomingCall, suppressNativeIncomingCallKitCall } from '../native/CallNative';
import { setRealtimeSocket } from '../lib/realtimeSocket';
import { maskSocketOutgoing } from '../lib/socketMask';
import { getAuthToken } from '../lib/storage';
import { getMobileCallAnswerClientId } from '../lib/callAnswerClient';
import { dismissMessageNotificationsForConversation, showForegroundMessageNotification } from '../lib/messageNotifications';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { CONVERSATION_LIST_STALE_MS } from '../lib/conversationList';
import { getClientRequestHeaders, initializeClientInstallationId } from '../lib/appClientInfo';
import { useAppStore } from '../store/useAppStore';
import { AuthUser, Message } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
const CONVERSATION_REFRESH_THROTTLE_MS = 60_000;
const CONVERSATION_REFRESH_IDLE_DELAY_MS = 5_000;

export function RealtimeBridge() {
  const navigation = useNavigation<Navigation>();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const user = useAppStore((state) => state.user);
  const receiveMessage = useAppStore((state) => state.receiveMessage);
  const applyMessageEdit = useAppStore((state) => state.applyMessageEdit);
  const removeMessage = useAppStore((state) => state.removeMessage);
  const removeChatLocally = useAppStore((state) => state.removeChatLocally);
  const markCallMessageReadByCallId = useAppStore((state) => state.markCallMessageReadByCallId);
  const markConversationMessagesDelivered = useAppStore((state) => state.markConversationMessagesDelivered);
  const markConversationMessagesRead = useAppStore((state) => state.markConversationMessagesRead);
  const applyMessageReaction = useAppStore((state) => state.applyMessageReaction);
  const updateCurrentUser = useAppStore((state) => state.updateCurrentUser);
  const updateUserPresence = useAppStore((state) => state.updateUserPresence);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const loadStatuses = useAppStore((state) => state.loadStatuses);
  const refreshStatusSummary = useAppStore((state) => state.refreshStatusSummary);
  const socketRef = useRef<Socket | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInteractionCancelRef = useRef<(() => void) | null>(null);
  const isRefreshScheduledRef = useRef(false);
  const isRefreshQueuedRef = useRef(false);
  const lastConversationRefreshAtRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    function refreshConversations() {
      if (isRefreshScheduledRef.current || refreshTimeoutRef.current) {
        isRefreshQueuedRef.current = true;
        return;
      }
      isRefreshScheduledRef.current = true;

      const elapsedSinceRefresh = Date.now() - lastConversationRefreshAtRef.current;
      const refreshDelay = elapsedSinceRefresh >= CONVERSATION_REFRESH_THROTTLE_MS
        ? CONVERSATION_REFRESH_IDLE_DELAY_MS
        : Math.max(CONVERSATION_REFRESH_IDLE_DELAY_MS, CONVERSATION_REFRESH_THROTTLE_MS - elapsedSinceRefresh);

      const interaction = InteractionManager.runAfterInteractions(() => {
        refreshTimeoutRef.current = setTimeout(() => {
          refreshTimeoutRef.current = null;
          refreshInteractionCancelRef.current = null;
          isRefreshScheduledRef.current = false;
          const shouldRefreshAgain = isRefreshQueuedRef.current;
          isRefreshQueuedRef.current = false;
          lastConversationRefreshAtRef.current = Date.now();
          const {
            conversations,
            conversationsLastFetchedAt,
            conversationsQuery,
            conversationsFilter,
            hasLoadedConversations,
          } = useAppStore.getState();
          const hasFreshLocalList = hasLoadedConversations &&
            conversations.length > 0 &&
            conversationsQuery === '' &&
            conversationsFilter === 'all' &&
            Date.now() - conversationsLastFetchedAt < CONVERSATION_LIST_STALE_MS;

          if (hasFreshLocalList) {
            if (shouldRefreshAgain) {
              refreshConversations();
            }
            return;
          }

          void loadConversations().finally(() => {
            if (shouldRefreshAgain) {
              refreshConversations();
            }
          });
        }, refreshDelay);
      });
      refreshInteractionCancelRef.current = () => interaction.cancel();
    }

    function emitAppState(socket: Socket | null, state = AppState.currentState) {
      socket?.emit('app:state', {
        isForeground: state === 'active',
        state,
      });
    }

    async function connectSocket() {
      const [, token] = await Promise.all([
        initializeClientInstallationId(),
        getAuthToken(),
      ]);

      if (!serverUrl || !token || !user?.id || !isMounted) {
        return;
      }

      const socket = io(serverUrl, {
        auth: {
          [MASK_SOCKET_AUTH_KEY]: maskPayload({ token }),
          [MASK_SOCKET_VERSION_KEY]: MASK_VERSION,
        },
        extraHeaders: getClientRequestHeaders(),
        reconnection: true,
      });
      maskSocketOutgoing(socket);

      socketRef.current = socket;
      setRealtimeSocket(socket);

      socket.on('connect', () => {
        emitAppState(socket);
        refreshConversations();
      });

      socket.on('message:new', (message) => {
        const mappedMessage = mapMessage(message, serverUrl);
        logMessageDeliveryDiagnostic('socket-message-new', {
          conversationId: mappedMessage.conversationId,
          kind: mappedMessage.kind,
          messageId: mappedMessage.id,
          senderId: mappedMessage.senderId,
        });

        if (isReactionFallbackMessage(mappedMessage)) {
          logMessageDeliveryDiagnostic('socket-message-new-skipped-reaction-fallback', {
            conversationId: mappedMessage.conversationId,
            messageId: mappedMessage.id,
          });
          return;
        }

        const conversation = useAppStore.getState().conversations.find((item) => item.id === mappedMessage.conversationId);

        if (conversation?.myGroupInvitePending === true) {
          logMessageDeliveryDiagnostic('socket-message-new-skipped-pending-invite', {
            conversationId: mappedMessage.conversationId,
            messageId: mappedMessage.id,
          });
          maybeOpenIncomingCallFromMessage(mappedMessage);
          refreshConversations();
          return;
        }

        receiveMessage(mappedMessage);
        logMessageDeliveryDiagnostic('socket-message-new-received-by-store', {
          conversationId: mappedMessage.conversationId,
          messageId: mappedMessage.id,
        });
        maybeShowForegroundMessageNotification(mappedMessage);
        maybeOpenIncomingCallFromMessage(mappedMessage);
      });

      socket.on('conversation:updated', () => {
        refreshConversations();
      });

      socket.on('status:updated', () => {
        void loadStatuses().catch(() => {
          void refreshStatusSummary().catch(() => undefined);
        });
      });

      socket.on('message:deleted', (payload: { conversationId: string; messageId?: string; messageKey?: string; mode?: 'me' | 'all'; userId?: string }) => {
        if (payload.mode === 'me' && payload.userId !== user.id) {
          return;
        }

        const localMessageId = payload.messageId ?? findLocalMessageIdByDeleteKey(payload.conversationId, payload.messageKey);

        if (localMessageId) {
          removeMessage(payload.conversationId, localMessageId);
        }
        if (payload.mode === 'all') {
          void acknowledgeMessageDeletions(
            serverUrl,
            payload.conversationId,
            payload.messageId ? [payload.messageId] : [],
            payload.messageKey ? [payload.messageKey] : [],
          ).catch(() => undefined);
        }
        refreshConversations();
      });

      socket.on('message:edited', (edit: MessageEdit) => {
        applyMessageEdit(edit);

        void acknowledgeMessageEdits(
          serverUrl,
          edit.conversationId,
          edit.messageId ? [edit.messageId] : [],
          edit.messageKey ? [edit.messageKey] : [],
        ).catch(() => undefined);
        refreshConversations();
      });

      socket.on('message:reaction', (reaction: MessageReactionUpdate) => {
        applyMessageReaction(reaction);
      });

      socket.on('live-location:updated', (payload: { conversationId: string; messageId: string; metadata: Message['metadata'] }) => {
        applyMessageEdit({
          body: 'Live location',
          conversationId: payload.conversationId,
          messageId: payload.messageId,
          messageKey: '',
          metadata: payload.metadata,
          updatedAt: new Date().toISOString(),
        });
      });

      socket.on('conversation:deleted', (payload: { conversationId: string; mode?: 'all'; userId?: string }) => {
        if (payload.userId === user.id) {
          return;
        }

        void removeChatLocally(payload.conversationId).catch(() => undefined);
        if (payload.mode === 'all') {
          void acknowledgeConversationDeletion(serverUrl, payload.conversationId).catch(() => undefined);
        }
        refreshConversations();
      });

      socket.on('message:delivered', (payload: { conversationId: string; delivererId: string; messageIds?: string[] }) => {
        markConversationMessagesDelivered(payload.conversationId, payload.delivererId, payload.messageIds);
      });

      socket.on('message:read', (payload: { conversationId: string; messageIds?: string[]; messageKeys?: string[]; readAt?: string; readerId: string }) => {
        markConversationMessagesRead(payload.conversationId, payload.readerId, payload.readAt, payload.messageIds, payload.messageKeys);
        if (payload.readerId === user.id) {
          void dismissMessageNotificationsForConversation(payload.conversationId);
        }
      });

      socket.on('presence:update', (payload: { isOnline: boolean; lastSeenAt?: string | null; showLastSeen?: boolean; userId: string }) => {
        updateUserPresence(payload);
      });

      socket.on('presence:privacy', (payload: { showLastSeen: boolean; userId: string }) => {
        updateUserPresence({ isOnline: payload.showLastSeen, showLastSeen: payload.showLastSeen, userId: payload.userId });
      });

      socket.on('user:updated', (payload: { user?: AuthUser }) => {
        if (payload.user?.id === user.id) {
          updateCurrentUser(payload.user);
        }
      });

      socket.on('call:invite', (payload: { autoJoin?: boolean; callId?: string; conversationId: string; fromDisplayName?: string; fromUserId?: string; isGroupCall?: boolean; mode: 'VOICE' | 'VIDEO'; participantNames?: string[] }) => {
        if (!payload.callId || payload.fromUserId === user.id) {
          return;
        }

        openIncomingCall({
          autoJoin: payload.autoJoin,
          callId: payload.callId,
          conversationId: payload.conversationId,
          fromDisplayName: payload.fromDisplayName,
          isGroupCall: payload.isGroupCall,
          mode: payload.mode,
          participantNames: payload.participantNames,
        });
      });

      socket.on('call:ringing', (payload: { callId: string; conversationId: string; userId: string }) => {
        emitCallEvent('ringing', payload);
      });

      socket.on('call:answered', (payload: { answerClientId?: string; answerSurface?: string; callId: string; conversationId: string; userId: string }) => {
        markCallMessageReadByCallId(payload.conversationId, payload.callId, payload.userId);
        if (payload.userId === user.id && payload.answerClientId && payload.answerClientId !== getMobileCallAnswerClientId()) {
          void suppressNativeIncomingCallKitCall(payload.callId);
        }
        emitCallEvent('answered', payload);
      });

      socket.on('call:ended', (payload: { callId: string; callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED'; conversationId: string }) => {
        emitCallEvent('ended', payload);
      });
    }

    function maybeOpenIncomingCallFromMessage(message: Message) {
      if (message.kind !== 'call' || message.senderId === user?.id) {
        return;
      }

      const metadata = message.metadata;
      const callId = metadata && typeof metadata === 'object' && 'callId' in metadata && typeof metadata.callId === 'string'
        ? metadata.callId
        : undefined;
      const callStatus = metadata && typeof metadata === 'object' && 'callStatus' in metadata && typeof metadata.callStatus === 'string'
        ? metadata.callStatus
        : undefined;
      const mode = metadata && typeof metadata === 'object' && 'mode' in metadata && (metadata.mode === 'VOICE' || metadata.mode === 'VIDEO')
        ? metadata.mode
        : undefined;

      if (!callId || callStatus !== 'RINGING' || !mode) {
        return;
      }

      const conversation = useAppStore.getState().conversations.find((item) => item.id === message.conversationId);

      if (conversation?.isMuted) {
        return;
      }

      const participantNames = conversation?.members
        ?.map((member) => member.displayName || member.username)
        .filter(Boolean);

      openIncomingCall({
        callId,
        conversationId: message.conversationId,
        fromDisplayName: message.sender?.displayName || message.sender?.username,
        isGroupCall: conversation?.type === 'GROUP' || (conversation?.memberCount ?? 0) > 2,
        mode,
        participantNames,
      });
    }

    function maybeShowForegroundMessageNotification(message: Message) {
      if (
        AppState.currentState !== 'active' ||
        message.senderId === user?.id ||
        message.kind === 'call' ||
        getVisibleChatRoomConversationId() === message.conversationId
      ) {
        return;
      }

      const conversation = useAppStore.getState().conversations.find((item) => item.id === message.conversationId);

      if (conversation?.isMuted) {
        return;
      }

      void showForegroundMessageNotification({
        body: getForegroundNotificationBody(message),
        conversationId: message.conversationId,
        messageId: message.id,
        title: conversation?.title || message.sender?.displayName || message.sender?.username || 'MeetVap',
      });
    }

    function openIncomingCall(input: {
      autoJoin?: boolean;
      callId: string;
      conversationId: string;
      fromDisplayName?: string;
      isGroupCall?: boolean;
      mode: 'VOICE' | 'VIDEO';
      participantNames?: string[];
    }) {
      Keyboard.dismiss();

      const mode = input.mode.toLowerCase() as 'voice' | 'video';
      const conversation = useAppStore.getState().conversations.find((item) => item.id === input.conversationId);
      const nextCallParams = {
        answeredByNative: false,
        autoJoin: input.autoJoin,
        callId: input.callId,
        conversationId: input.conversationId,
        direction: 'incoming' as const,
        isGroupCall: input.isGroupCall,
        mode,
        participantNames: input.participantNames,
        title: input.fromDisplayName ?? conversation?.title ?? 'Incoming call',
      };
      const activeCall = getActiveCallSession();

      if (isSameActiveCall(activeCall, nextCallParams)) {
        return;
      }

      if (activeCall?.callState === 'active' && activeCall.conversationId === input.conversationId) {
        return;
      }

      if (Platform.OS === 'ios' && AppState.currentState === 'active') {
        void suppressNativeIncomingCallKitCall(input.callId);
      }

      if (serverUrl) {
        void ringCall(serverUrl, input.callId);
      }

      if (activeCall?.callState === 'active' && !isSameActiveCall(activeCall, nextCallParams)) {
        emitCallEvent('incomingInvite', {
          callId: input.callId,
          autoJoin: input.autoJoin,
          conversationId: input.conversationId,
          fromDisplayName: input.fromDisplayName,
          isGroupCall: input.isGroupCall,
          mode: input.mode,
          participantNames: input.participantNames,
        });
        return;
      }

      if (Platform.OS === 'ios' && AppState.currentState !== 'active') {
        return;
      }

      if (isCallRoomVisibleFor(input.callId)) {
        return;
      }

      if (Platform.OS === 'android' && AppState.currentState !== 'active') {
        showNativeAndroidIncomingCall({
          autoJoin: input.autoJoin,
          callId: input.callId,
          conversationId: input.conversationId,
          isGroupCall: input.isGroupCall,
          mode: input.mode,
          participantNames: input.participantNames,
          title: nextCallParams.title,
        });
        return;
      }

      const shouldUseCallOnlyAccess = shouldOpenIncomingCallAsCallOnly();

      if (shouldUseCallOnlyAccess) {
        beginCallOnlyAccess(input.callId);
      }

      navigation.navigate('CallRoom', {
        ...nextCallParams,
        callAccess: shouldUseCallOnlyAccess ? 'locked-call' : undefined,
      });
    }

    void connectSocket();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      emitAppState(socketRef.current, nextState);

      if (nextState === 'active') {
        restoreActiveCallIfNeeded();
        refreshConversations();
      }
    });
    const networkSubscription = NetInfo.addEventListener((state) => {
      if (state.isConnected === true) {
        refreshConversations();
      }
    });

    return () => {
      isMounted = false;
      emitAppState(socketRef.current, 'inactive');
      socketRef.current?.disconnect();
      socketRef.current = null;
      setRealtimeSocket(null);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      refreshInteractionCancelRef.current?.();
      refreshInteractionCancelRef.current = null;
      isRefreshScheduledRef.current = false;
      isRefreshQueuedRef.current = false;
      appStateSubscription.remove();
      networkSubscription();
    };
  }, [applyMessageEdit, applyMessageReaction, loadConversations, loadStatuses, markCallMessageReadByCallId, markConversationMessagesDelivered, markConversationMessagesRead, navigation, receiveMessage, removeChatLocally, removeMessage, serverUrl, updateCurrentUser, updateUserPresence, user?.id]);

  return null;
}

function isReactionFallbackMessage(message: Message) {
  const metadata = message.metadata;

  return !!(
    metadata &&
    typeof metadata === 'object' &&
    'reactionFallback' in metadata &&
    metadata.reactionFallback &&
    typeof metadata.reactionFallback === 'object'
  );
}

function getForegroundNotificationBody(message: Message) {
  if (message.kind === 'image') {
    return message.body || 'Photo';
  }

  if (message.kind === 'video') {
    return message.body || 'Video';
  }

  if (message.kind === 'file') {
    return message.body || 'File';
  }

  if (message.kind === 'voice') {
    return 'Voice message';
  }

  return message.body || 'New message';
}

function findLocalMessageId(conversationId: string, messageId?: string, messageKey?: string) {
  const messages = (useAppStore.getState().messagesByConversation[conversationId] ?? []) as Message[];
  const idMatch = messageId ? messages.find((message) => message.id === messageId)?.id : undefined;

  if (idMatch || !messageKey) {
    return idMatch;
  }

  return messages.find((message) => {
    const metadata = message.metadata;

    return metadata &&
      typeof metadata === 'object' &&
      'deleteKey' in metadata &&
      metadata.deleteKey === messageKey;
  })?.id;
}

function findLocalMessageIdByDeleteKey(conversationId: string, messageKey?: string) {
  return findLocalMessageId(conversationId, undefined, messageKey);
}
