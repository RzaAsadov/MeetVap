import { AudioSession } from '@livekit/react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { t } from '../i18n';
import { getActiveCallSession } from '../lib/activeCallSession';
import { listVoiceRoomParticipants, updateVoiceRoomParticipant } from '../lib/backend';
import { getRealtimeSocket } from '../lib/realtimeSocket';
import { logVoiceRoomDiagnostic } from '../lib/voiceRoomDiagnostics';
import {
  getVoiceRoomSessionState,
  joinVoiceRoomSession,
  leaveVoiceRoomSession,
  setVoiceRoomAdminMuted,
  setVoiceRoomPushToTalking,
  setVoiceRoomSelfMuted,
  setVoiceRoomSpeakerMuted,
  subscribeToVoiceRoomSession,
} from '../lib/voiceRoomSession';
import { getVoiceRoomAudioRouteLabel } from '../screens/lib/ChatMediaHelpers';
import type { VoiceRoomParticipant } from '../types/domain';
import type { RootStackParamList } from '../types/navigation';

type UseChatVoiceRoomOptions = {
  canModerate: boolean;
  conversationId: string;
  isGroupInvitePending: boolean;
  isVoiceRoom: boolean;
  navigation: NativeStackNavigationProp<RootStackParamList, 'ChatRoom'>;
  serverUrl: string | null;
  title: string;
  userId?: string;
};

export function useChatVoiceRoom({
  canModerate,
  conversationId,
  isGroupInvitePending,
  isVoiceRoom,
  navigation,
  serverUrl,
  title,
  userId,
}: UseChatVoiceRoomOptions) {
  const [session, setSession] = useState(getVoiceRoomSessionState);
  const [participants, setParticipants] = useState<VoiceRoomParticipant[]>([]);
  const [participantsNextOffset, setParticipantsNextOffset] = useState(0);
  const [hasMoreParticipants, setHasMoreParticipants] = useState(false);
  const [isPeopleOpen, setPeopleOpen] = useState(false);
  const [isRoutePickerOpen, setRoutePickerOpen] = useState(false);
  const [audioRoutes, setAudioRoutes] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => subscribeToVoiceRoomSession(setSession), []);

  const refreshParticipants = useCallback(async (offset = 0, append = false) => {
    if (!serverUrl || !isVoiceRoom) {
      setParticipants([]);
      setParticipantsNextOffset(0);
      setHasMoreParticipants(false);
      return;
    }

    logVoiceRoomDiagnostic('chat-participants-refresh-start', {
      append,
      conversationId,
      offset,
    });

    const response = await listVoiceRoomParticipants(serverUrl, conversationId, { limit: 100, offset });
    setParticipants((current) => append ? [...current, ...response.participants] : response.participants);
    setParticipantsNextOffset(response.nextOffset);
    setHasMoreParticipants(response.hasMore);

    const me = response.participants.find((participant) => participant.userId === userId);
    if (me) {
      setVoiceRoomAdminMuted(me.adminMuted);
    }
  }, [conversationId, isVoiceRoom, serverUrl, userId]);

  const join = useCallback(async () => {
    if (!serverUrl || !userId || !isVoiceRoom) {
      return;
    }

    if (getActiveCallSession()?.callState === 'active') {
      Alert.alert(t('voiceRoomUnavailableDuringCallTitle'), t('voiceRoomUnavailableDuringCallMessage'));
      return;
    }

    const didJoin = await joinVoiceRoomSession({
      conversationId,
      serverUrl,
      title,
      userId,
    });

    if (didJoin) {
      void refreshParticipants();
    }
  }, [conversationId, isVoiceRoom, refreshParticipants, serverUrl, title, userId]);

  useEffect(() => {
    if (!isVoiceRoom || isGroupInvitePending) {
      return;
    }

    if (session.conversationId === conversationId && (session.token || session.isConnecting)) {
      return;
    }

    void join();
  }, [conversationId, isGroupInvitePending, isVoiceRoom, join, session.conversationId, session.isConnecting, session.token]);

  useEffect(() => {
    if (!isVoiceRoom) {
      return undefined;
    }

    const socket = getRealtimeSocket();
    const handleParticipantsChanged = (payload: { conversationId: string }) => {
      if (payload.conversationId === conversationId) {
        void refreshParticipants();
      }
    };

    socket?.on('voice-room:participants', handleParticipantsChanged);
    void refreshParticipants();

    return () => {
      socket?.off('voice-room:participants', handleParticipantsChanged);
    };
  }, [conversationId, isVoiceRoom, refreshParticipants]);

  useEffect(() => navigation.addListener('beforeRemove', (event) => {
    if (!isVoiceRoom || session.conversationId !== conversationId || !session.token) {
      return;
    }

    event.preventDefault();
    Alert.alert(t('voiceRoomLeaveTitle'), t('voiceRoomLeaveMessage'), [
      { text: t('keepConnectedOutsideGroup'), onPress: () => navigation.dispatch(event.data.action) },
      {
        text: t('leaveRoomAndDisconnect'),
        style: 'destructive',
        onPress: () => {
          void leaveVoiceRoomSession().finally(() => navigation.dispatch(event.data.action));
        },
      },
      { text: t('cancel'), style: 'cancel' },
    ]);
  }), [conversationId, isVoiceRoom, navigation, session.conversationId, session.token]);

  const toggleMic = useCallback(() => {
    if (session.adminMuted) {
      Alert.alert(t('mutedByAdmin'), t('voiceRoomAdminMutedMessage'));
      return;
    }

    void setVoiceRoomSelfMuted(!session.isSelfMuted).then(() => refreshParticipants());
  }, [refreshParticipants, session.adminMuted, session.isSelfMuted]);

  const beginPushToTalk = useCallback(() => {
    if (session.isSelfMuted && !session.adminMuted) {
      setVoiceRoomPushToTalking(true);
    }
  }, [session.adminMuted, session.isSelfMuted]);

  const endPushToTalk = useCallback(() => {
    setVoiceRoomPushToTalking(false);
  }, []);

  const toggleSpeakerMute = useCallback(() => {
    setVoiceRoomSpeakerMuted(!session.isSpeakerMuted);
  }, [session.isSpeakerMuted]);

  const openRoutePicker = useCallback(async () => {
    const outputs = await AudioSession.getAudioOutputs().catch((): string[] => []);
    const routes = outputs.length > 0 ? outputs : ['force_speaker', 'speaker', 'earpiece'];

    setAudioRoutes(routes.map((routeId) => ({
      id: routeId,
      label: getVoiceRoomAudioRouteLabel(routeId),
    })));
    setRoutePickerOpen(true);
  }, []);

  const selectAudioRoute = useCallback(async (routeId: string) => {
    setRoutePickerOpen(false);
    await AudioSession.selectAudioOutput(routeId).catch(() => undefined);
  }, []);

  const toggleAdminMute = useCallback(async (participant: VoiceRoomParticipant) => {
    if (!serverUrl || !canModerate || participant.userId === userId) {
      return;
    }

    if (participant.selfMuted && participant.adminMuted) {
      await updateVoiceRoomParticipant(serverUrl, conversationId, participant.userId, { adminMuted: false });
    } else if (!participant.selfMuted) {
      await updateVoiceRoomParticipant(serverUrl, conversationId, participant.userId, { adminMuted: !participant.adminMuted });
    }

    await refreshParticipants();
  }, [canModerate, conversationId, refreshParticipants, serverUrl, userId]);

  const loadMoreParticipants = useCallback(() => {
    if (hasMoreParticipants) {
      void refreshParticipants(participantsNextOffset, true);
    }
  }, [hasMoreParticipants, participantsNextOffset, refreshParticipants]);

  return {
    audioRoutes,
    beginPushToTalk,
    endPushToTalk,
    hasMoreParticipants,
    isConnected: session.conversationId === conversationId && !!session.token,
    isConnecting: session.conversationId === conversationId && session.isConnecting,
    isPeopleOpen,
    isRoutePickerOpen,
    join,
    loadMoreParticipants,
    openRoutePicker,
    participants,
    refreshParticipants,
    selectAudioRoute,
    session,
    setPeopleOpen,
    setRoutePickerOpen,
    toggleAdminMute,
    toggleMic,
    toggleSpeakerMute,
  };
}
