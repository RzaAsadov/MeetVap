import { AudioSession, LiveKitRoom, useConnectionState, useLocalParticipant, useRoomContext } from '@livekit/react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { AudioPresets, ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { RemoteTrackPublication } from 'livekit-client';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { ensureRemoteAudioPublicationSubscribed } from '../lib/liveKitRemoteSubscription';
import { logVoiceRoomDiagnostic } from '../lib/voiceRoomDiagnostics';
import {
  subscribeToVoiceRoomSession,
  subscribeVoiceRoomToActiveCalls,
  type VoiceRoomSessionState,
} from '../lib/voiceRoomSession';

const VOICE_ROOM_CONNECT_OPTIONS = {
  autoSubscribe: true,
  maxRetries: 3,
  peerConnectionTimeout: 15_000,
  websocketTimeout: 15_000,
};

const VOICE_ROOM_OPTIONS = {
  adaptiveStream: false,
  dynacast: false,
  publishDefaults: {
    audioPreset: AudioPresets.speech,
    dtx: false,
    forceStereo: false,
    red: true,
    stopMicTrackOnMute: false,
  },
};

const VOICE_ROOM_AUDIO_CAPTURE_OPTIONS = Platform.OS === 'ios' ? undefined : {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  voiceIsolation: true,
};
const VOICE_ROOM_REMOTE_AUDIO_WATCHDOG_MS = 5_000;
let voiceRoomAudioPreparation: Promise<void> | null = null;

type RemoteAudioVolumeTrack = {
  setVolume?: (volume: number) => void;
};

function prepareVoiceRoomAudioSession() {
  if (voiceRoomAudioPreparation) {
    logVoiceRoomDiagnostic('audio-prepare-reuse');
    return voiceRoomAudioPreparation;
  }

  voiceRoomAudioPreparation = (async () => {
    logVoiceRoomDiagnostic('audio-prepare-start', { platform: Platform.OS });
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
    }).catch((error) => {
      logVoiceRoomDiagnostic('expo-audio-mode-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    logVoiceRoomDiagnostic('livekit-audio-configure-start');
    await AudioSession.configureAudio({
      android: {
        audioTypeOptions: {
          audioMode: 'inCommunication',
          audioStreamType: 'voiceCall',
          audioAttributesUsageType: 'voiceCommunication',
          audioAttributesContentType: 'speech',
          forceHandleAudioRouting: true,
          manageAudioFocus: true,
        },
        preferredOutputList: ['bluetooth', 'headset', 'speaker', 'earpiece'],
      },
      ios: {
        defaultOutput: 'speaker',
      },
    });
    logVoiceRoomDiagnostic('livekit-audio-configure-done');

    if (Platform.OS === 'ios') {
      await AudioSession.setAppleAudioConfiguration({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: ['allowBluetooth', 'allowBluetoothA2DP', 'defaultToSpeaker'],
        audioMode: 'voiceChat',
      }).catch((error) => {
        logVoiceRoomDiagnostic('ios-audio-config-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }

    logVoiceRoomDiagnostic('audio-session-start');
    await AudioSession.startAudioSession();

    if (Platform.OS === 'ios') {
      await AudioSession.selectAudioOutput('speaker').catch((error) => {
        logVoiceRoomDiagnostic('ios-speaker-select-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return;
    }

    await AudioSession.selectAudioOutput('force_speaker').catch((error) => {
      logVoiceRoomDiagnostic('android-speaker-select-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
    logVoiceRoomDiagnostic('audio-prepare-done');
  })().finally(() => {
    voiceRoomAudioPreparation = null;
  });

  return voiceRoomAudioPreparation;
}

export function VoiceRoomBridge() {
  const [session, setSession] = useState<VoiceRoomSessionState | null>(null);

  useEffect(() => subscribeToVoiceRoomSession((nextSession) => {
    logVoiceRoomDiagnostic('bridge-session-update', {
      adminMuted: nextSession.adminMuted,
      conversationId: nextSession.conversationId,
      hasToken: !!nextSession.token,
      hasUrl: !!nextSession.url,
      isConnecting: nextSession.isConnecting,
      isPushToTalking: nextSession.isPushToTalking,
      isSelfMuted: nextSession.isSelfMuted,
      isSpeakerMuted: nextSession.isSpeakerMuted,
      roomName: nextSession.roomName,
    });
    setSession(nextSession);
  }), []);
  useEffect(() => subscribeVoiceRoomToActiveCalls(), []);

  if (!session?.token || !session.url || !session.conversationId) {
    if (session?.conversationId) {
      logVoiceRoomDiagnostic('bridge-not-rendering-room', {
        conversationId: session.conversationId,
        hasToken: !!session.token,
        hasUrl: !!session.url,
      });
    }
    return null;
  }

  const canPublishMicrophone = !session.adminMuted && (!session.isSelfMuted || session.isPushToTalking);
  logVoiceRoomDiagnostic('bridge-render-room', {
    canPublishMicrophone,
    conversationId: session.conversationId,
    isPushToTalking: session.isPushToTalking,
    isSelfMuted: session.isSelfMuted,
    tokenTail: session.token.slice(-8),
  });

  return (
    <LiveKitRoom
      audio={false}
      connect
      connectOptions={VOICE_ROOM_CONNECT_OPTIONS}
      key={`${session.conversationId}:${session.token.slice(-16)}`}
      options={VOICE_ROOM_OPTIONS}
      serverUrl={session.url}
      token={session.token}
      video={false}
    >
      <VoiceRoomAudioPublisher canPublish={canPublishMicrophone} />
      <VoiceRoomRemoteAudioSubscriber speakerMuted={session.isSpeakerMuted} />
      <VoiceRoomDefaultSpeaker />
    </LiveKitRoom>
  );
}

function VoiceRoomAudioPublisher({ canPublish }: { canPublish: boolean }) {
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    logVoiceRoomDiagnostic('publisher-state', {
      canPublish,
      connectionState,
      localIdentity: localParticipant.identity,
    });

    if (connectionState !== ConnectionState.Connected) {
      return undefined;
    }

    let isCancelled = false;

    async function applyMicrophone() {
      if (!canPublish) {
        const publication = localParticipant.getTrackPublication(Track.Source.Microphone);
        logVoiceRoomDiagnostic('publisher-mute-existing', {
          hasPublication: !!publication,
          localIdentity: localParticipant.identity,
        });
        await publication?.mute().catch((error) => {
          logVoiceRoomDiagnostic('publisher-mute-failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }

      const existingPermission = await getRecordingPermissionsAsync();
      const permission = existingPermission.granted ? existingPermission : await requestRecordingPermissionsAsync();
      logVoiceRoomDiagnostic('publisher-mic-permission', {
        existingGranted: existingPermission.granted,
        granted: permission.granted,
      });

      if (!permission.granted || isCancelled) {
        return;
      }

      await prepareVoiceRoomAudioSession();

      if (isCancelled || !canPublish) {
        return;
      }

      logVoiceRoomDiagnostic('publisher-enable-mic-start', { localIdentity: localParticipant.identity });
      const publication = await localParticipant.setMicrophoneEnabled(true, VOICE_ROOM_AUDIO_CAPTURE_OPTIONS).catch((error) => {
        logVoiceRoomDiagnostic('publisher-enable-mic-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      });
      logVoiceRoomDiagnostic('publisher-enable-mic-done', {
        hasPublication: !!publication,
        localIdentity: localParticipant.identity,
      });

      if (isCancelled || !canPublish) {
        await publication?.mute().catch((error) => {
          logVoiceRoomDiagnostic('publisher-post-enable-mute-failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        });
        return;
      }

      await publication?.unmute().catch((error) => {
        logVoiceRoomDiagnostic('publisher-unmute-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      await publication?.resumeUpstream().catch((error) => {
        logVoiceRoomDiagnostic('publisher-resume-upstream-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      logVoiceRoomDiagnostic('publisher-ready', { localIdentity: localParticipant.identity });
    }

    void applyMicrophone();

    return () => {
      isCancelled = true;
    };
  }, [canPublish, connectionState, localParticipant]);

  return null;
}

function VoiceRoomRemoteAudioSubscriber({ speakerMuted }: { speakerMuted: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  useEffect(() => {
    const subscribeRemoteAudio = () => {
      logVoiceRoomDiagnostic('remote-subscribe-scan', {
        participantCount: room.remoteParticipants.size,
        speakerMuted,
      });
      Array.from(room.remoteParticipants.values()).forEach((participant) => {
        if (!participant.identity || participant.identity === localParticipant.identity) {
          return;
        }

        const publication = participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined;

        if (!publication) {
          logVoiceRoomDiagnostic('remote-publication-missing', {
            identity: participant.identity,
          });
          return;
        }

        logVoiceRoomDiagnostic('remote-publication-subscribe', {
          identity: participant.identity,
          isSubscribed: publication.isSubscribed,
          isMuted: publication.isMuted,
          speakerMuted,
          trackSid: publication.trackSid,
        });
        ensureRemoteAudioPublicationSubscribed(publication);
        setRemoteAudioPublicationVolume(publication, speakerMuted ? 0 : 1, participant.identity);
      });
    };

    subscribeRemoteAudio();
    const interval = setInterval(subscribeRemoteAudio, VOICE_ROOM_REMOTE_AUDIO_WATCHDOG_MS);

    room
      .on(RoomEvent.ParticipantConnected, subscribeRemoteAudio)
      .on(RoomEvent.TrackPublished, subscribeRemoteAudio)
      .on(RoomEvent.TrackSubscribed, subscribeRemoteAudio)
      .on(RoomEvent.TrackSubscriptionStatusChanged, subscribeRemoteAudio)
      .on(RoomEvent.TrackUnmuted, subscribeRemoteAudio);

    return () => {
      clearInterval(interval);
      room
        .off(RoomEvent.ParticipantConnected, subscribeRemoteAudio)
        .off(RoomEvent.TrackPublished, subscribeRemoteAudio)
        .off(RoomEvent.TrackSubscribed, subscribeRemoteAudio)
        .off(RoomEvent.TrackSubscriptionStatusChanged, subscribeRemoteAudio)
        .off(RoomEvent.TrackUnmuted, subscribeRemoteAudio);
    };
  }, [localParticipant.identity, room, speakerMuted]);

  return null;
}

function setRemoteAudioPublicationVolume(publication: RemoteTrackPublication, volume: number, identity: string) {
  const audioTrack = publication.audioTrack ?? publication.track;
  const maybeVolumeTrack = audioTrack as RemoteAudioVolumeTrack | undefined;

  if (!maybeVolumeTrack?.setVolume) {
    logVoiceRoomDiagnostic('remote-publication-volume-unavailable', {
      identity,
      isSubscribed: publication.isSubscribed,
      trackSid: publication.trackSid,
      volume,
    });
    return;
  }

  try {
    maybeVolumeTrack.setVolume(volume);
    logVoiceRoomDiagnostic('remote-publication-volume-set', {
      identity,
      trackSid: publication.trackSid,
      volume,
    });
  } catch (error) {
    logVoiceRoomDiagnostic('remote-publication-volume-failed', {
      identity,
      message: error instanceof Error ? error.message : String(error),
      trackSid: publication.trackSid,
      volume,
    });
  }
}

function VoiceRoomDefaultSpeaker() {
  useEffect(() => {
    logVoiceRoomDiagnostic('default-speaker-mount');
    void prepareVoiceRoomAudioSession().catch((error) => {
      logVoiceRoomDiagnostic('default-speaker-prepare-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      logVoiceRoomDiagnostic('default-speaker-unmount');
      void AudioSession.stopAudioSession().catch((error) => {
        logVoiceRoomDiagnostic('audio-session-stop-failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    };
  }, []);

  return null;
}
