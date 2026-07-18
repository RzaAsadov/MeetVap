import { Ionicons } from '@expo/vector-icons';
import { AudioSession, LiveKitRoom, VideoTrack, isTrackReference, useConnectionState, useLocalParticipant, useParticipants, useRoomContext, useTracks } from '@livekit/react-native';
import type { TrackReference } from '@livekit/react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { ConnectionQuality, ConnectionState, RoomEvent, Track, VideoPreset, VideoPresets, VideoQuality } from 'livekit-client';
import type { LocalVideoTrack, RemoteTrackPublication } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMeeting, joinMeeting, leaveMeeting, endMeeting, type MeetingInfo, type MeetingParticipantInfo } from '../lib/backend';
import { setActiveMeetingSession } from '../lib/activeMeetingSession';
import { ensureRemoteAudioPublicationSubscribed, ensureRemoteVideoPublicationSubscribed, recoverRemoteVideoPublicationIfDecoderStalled } from '../lib/liveKitRemoteSubscription';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { t } from '../i18n';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'MeetingRoom'>;

const MEETING_CONNECT_OPTIONS = {
  autoSubscribe: true,
  maxRetries: 3,
  peerConnectionTimeout: 15_000,
  websocketTimeout: 15_000,
};

const MEETING_ROOM_OPTIONS = {
  adaptiveStream: { pauseVideoInBackground: false, pixelDensity: 'screen' as const },
  dynacast: true,
  videoCaptureDefaults: {
    frameRate: 15,
    resolution: { frameRate: 15, height: 360, width: 640 },
  },
  publishDefaults: {
    degradationPreference: 'maintain-framerate' as const,
    dtx: true,
    forceStereo: false,
    red: true,
    simulcast: true,
    stopMicTrackOnMute: false,
    videoEncoding: { maxBitrate: 360_000, maxFramerate: 15 },
    videoSimulcastLayers: [VideoPresets.h90, new VideoPreset(320, 180, 130_000, 12)],
  },
};

const meetingColors = {
  background: '#07111f',
  border: 'rgba(255,255,255,0.14)',
  button: 'rgba(255,255,255,0.14)',
  buttonPressed: 'rgba(255,255,255,0.22)',
  card: '#111f32',
  danger: '#ef4444',
  dangerStrong: '#b91c1c',
  primary: '#2f9bff',
  primaryDark: '#1477d4',
  secondaryText: '#a9bad2',
  text: '#f4f8ff',
  tile: '#0f1b2d',
};

export function MeetingRoomScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const user = useAppStore((state) => state.user);
  const [meeting, setMeeting] = useState<MeetingInfo | null>(null);
  const [participants, setParticipants] = useState<MeetingParticipantInfo[]>([]);
  const [participant, setParticipant] = useState<MeetingParticipantInfo | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [liveKit, setLiveKit] = useState<{ token: string; url: string } | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isJoining, setJoining] = useState(false);
  const [isMicOn, setMicOn] = useState(false);
  const [isCameraOn, setCameraOn] = useState(false);
  const hasAutoJoinedRef = useRef(false);
  const isHost = participant?.role === 'HOST';

  const refreshMeeting = useCallback(async () => {
    if (!serverUrl) {
      return;
    }

    const response = await getMeeting(serverUrl, route.params.code);
    setMeeting(response.meeting);
    setParticipants(response.participants);
    setRemainingSeconds(response.remainingSeconds);
    if (response.meeting.status === 'ended') {
      setLiveKit(null);
      setParticipant(null);
      setActiveMeetingSession(null);
    }
  }, [route.params.code, serverUrl]);

  useEffect(() => {
    let isCancelled = false;

    void refreshMeeting()
      .catch((error) => {
        if (!isCancelled) {
          Alert.alert(t('meetingOpenFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [refreshMeeting]);

  useEffect(() => {
    if (!meeting || meeting.status !== 'active') {
      return undefined;
    }

    const interval = setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((new Date(meeting.maxEndsAt).getTime() - Date.now()) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [meeting]);

  useEffect(() => {
    if (!liveKit) {
      return undefined;
    }

    const interval = setInterval(() => {
      void refreshMeeting().catch(() => undefined);
    }, 3500);

    return () => clearInterval(interval);
  }, [liveKit, refreshMeeting]);

  const join = useCallback(async () => {
    if (!serverUrl || !user || isJoining) {
      return;
    }

    try {
      setJoining(true);
      const response = await joinMeeting(serverUrl, route.params.code, user.displayName || user.username);
      setMeeting(response.meeting);
      setParticipant(response.participant);
      setParticipants((current) => [response.participant, ...current.filter((item) => item.id !== response.participant.id)]);
      setRemainingSeconds(response.remainingSeconds);
      setLiveKit(response.livekit);
      setMicOn(false);
      setCameraOn(false);
      setActiveMeetingSession({
        autoJoin: true,
        code: response.meeting.code,
        link: response.meeting.link,
        mode: response.meeting.mode,
      });
    } catch (error) {
      Alert.alert(t('meetingJoinFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setJoining(false);
    }
  }, [isJoining, route.params.code, serverUrl, user]);

  useEffect(() => {
    if (
      hasAutoJoinedRef.current ||
      !route.params.autoJoin ||
      isLoading ||
      liveKit ||
      meeting?.status !== 'active'
    ) {
      return;
    }

    hasAutoJoinedRef.current = true;
    void join();
  }, [isLoading, join, liveKit, meeting?.status, route.params.autoJoin]);

  const leave = useCallback(async () => {
    const currentParticipantId = participant?.id;

    setLiveKit(null);
    setParticipant(null);
    setMicOn(false);
    setCameraOn(false);
    setActiveMeetingSession(null);

    if (serverUrl && currentParticipantId) {
      await leaveMeeting(serverUrl, route.params.code, currentParticipantId).catch(() => undefined);
    }

    navigation.goBack();
  }, [navigation, participant?.id, route.params.code, serverUrl]);

  const end = useCallback(async () => {
    if (!serverUrl) {
      return;
    }

    await endMeeting(serverUrl, route.params.code).catch(() => undefined);
    setLiveKit(null);
    setParticipant(null);
    setActiveMeetingSession(null);
    setMeeting((current) => current ? { ...current, endedAt: new Date().toISOString(), status: 'ended' } : current);
    navigation.goBack();
  }, [navigation, route.params.code, serverUrl]);

  useEffect(() => {
    if (meeting?.status !== 'ended' || !liveKit) {
      return;
    }

    setLiveKit(null);
    setParticipant(null);
    setActiveMeetingSession(null);
    Alert.alert(t('meetingEnded'), t('meetingEndedByHost'));
    navigation.goBack();
  }, [liveKit, meeting?.status, navigation]);

  const shareLink = useCallback(() => {
    const link = meeting?.link ?? `https://meet.meetvap.com/${route.params.code}`;
    const message = getMeetingInviteText(meeting?.creator.displayName ?? user?.displayName ?? user?.username ?? 'MeetVap', link);

    void Share.share({ message, title: t('createMeetLink'), url: link }).catch(() => undefined);
  }, [meeting?.creator.displayName, meeting?.link, route.params.code, user?.displayName, user?.username]);

  const copyLink = useCallback(() => {
    const link = meeting?.link ?? route.params.link ?? `https://meet.meetvap.com/${route.params.code}`;
    const message = getMeetingInviteText(meeting?.creator.displayName ?? user?.displayName ?? user?.username ?? 'MeetVap', link);

    void Clipboard.setStringAsync(message).then(() => {
      Alert.alert(t('copied'), message);
    }).catch(() => undefined);
  }, [meeting?.creator.displayName, meeting?.link, route.params.code, route.params.link, user?.displayName, user?.username]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!meeting) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title}>{t('meetingNotFound')}</Text>
      </View>
    );
  }

  if (!liveKit) {
    return (
      <View style={[styles.lobby, { paddingBottom: insets.bottom + spacing.lg, paddingTop: insets.top + spacing.xl }]}>
        <View style={styles.lobbyIcon}>
          <Ionicons color={colors.white} name={meeting.mode === 'video' ? 'videocam' : 'call'} size={34} />
        </View>
        <Text style={styles.title}>{meeting.creator.displayName}</Text>
        <Text style={styles.subtitle}>{meeting.mode === 'video' ? t('videoMeet') : t('voiceMeet')}</Text>
        <Text style={styles.remaining}>{meeting.status === 'ended' ? t('meetingEnded') : t('meetingRemaining', { time: formatDuration(remainingSeconds) })}</Text>
        <View style={styles.lobbyActions}>
          <Pressable onPress={shareLink} style={styles.secondaryButton}>
            <Ionicons color={colors.white} name="share-social-outline" size={20} />
            <Text style={styles.buttonText}>{t('shareLink')}</Text>
          </Pressable>
          <Pressable onPress={copyLink} style={styles.secondaryButton}>
            <Ionicons color={colors.white} name="copy-outline" size={20} />
            <Text style={styles.buttonText}>{t('copyLink')}</Text>
          </Pressable>
          {meeting.status === 'active' ? (
            <Pressable disabled={isJoining} onPress={() => void join()} style={[styles.primaryButton, isJoining && styles.disabledButton]}>
              {isJoining ? <ActivityIndicator color={colors.white} /> : <Ionicons color={colors.white} name="log-in-outline" size={20} />}
              <Text style={styles.buttonText}>{t('joinMeet')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <LiveKitRoom
      audio={false}
      connect
      connectOptions={MEETING_CONNECT_OPTIONS}
      key={`${route.params.code}:${liveKit.token.slice(-16)}`}
      options={MEETING_ROOM_OPTIONS}
      serverUrl={liveKit.url}
      token={liveKit.token}
      video={false}
    >
      <MeetingAudioSession />
      <MeetingMediaController isCameraOn={isCameraOn && meeting.mode === 'video'} isMicOn={isMicOn} />
      <MeetingRemoteTrackSubscriber mode={meeting.mode} />
      <View style={[styles.room, { paddingBottom: insets.bottom + spacing.md, paddingTop: insets.top + spacing.md }]}>
        <View style={styles.roomHeader}>
          <View>
            <Text style={styles.roomTitle}>{meeting.creator.displayName}</Text>
            <Text style={styles.roomSubtitle}>{formatDuration(remainingSeconds)} · {participants.length}</Text>
          </View>
          <View style={styles.roomHeaderActions}>
            <Pressable onPress={shareLink} style={styles.iconButton}>
              <Ionicons color={colors.white} name="share-social-outline" size={21} />
            </Pressable>
            <Pressable onPress={copyLink} style={styles.iconButton}>
              <Ionicons color={colors.white} name="copy-outline" size={21} />
            </Pressable>
          </View>
        </View>
        <MeetingTiles mode={meeting.mode} />
        <View style={styles.controls}>
          <Pressable onPress={() => setMicOn((current) => !current)} style={[styles.controlButton, isMicOn && styles.controlButtonActive]}>
            <Ionicons color={colors.white} name={isMicOn ? 'mic' : 'mic-off'} size={23} />
          </Pressable>
          {meeting.mode === 'video' ? (
            <Pressable onPress={() => setCameraOn((current) => !current)} style={[styles.controlButton, isCameraOn && styles.controlButtonActive]}>
              <Ionicons color={colors.white} name={isCameraOn ? 'videocam' : 'videocam-off'} size={23} />
            </Pressable>
          ) : null}
          {isHost ? (
            <Pressable onPress={() => void end()} style={[styles.controlButton, styles.endButtonStrong]}>
              <Ionicons color={colors.white} name="call" size={23} />
            </Pressable>
          ) : (
            <Pressable onPress={() => void leave()} style={[styles.controlButton, styles.endButton]}>
              <Ionicons color={colors.white} name="log-out-outline" size={23} />
            </Pressable>
          )}
        </View>
      </View>
    </LiveKitRoom>
  );
}

function MeetingAudioSession() {
  useEffect(() => {
    void AudioSession.configureAudio({
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
    }).then(() => AudioSession.startAudioSession()).then(() => {
      if (Platform.OS === 'ios') {
        return AudioSession.selectAudioOutput('speaker');
      }

      return AudioSession.selectAudioOutput('force_speaker');
    }).catch(() => undefined);

    return () => {
      void AudioSession.stopAudioSession().catch(() => undefined);
    };
  }, []);

  return null;
}

function MeetingMediaController({ isCameraOn, isMicOn }: { isCameraOn: boolean; isMicOn: boolean }) {
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      return;
    }

    let cancelled = false;

    async function applyMicrophone() {
      if (!isMicOn) {
        await localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
        return;
      }

      const existingPermission = await getRecordingPermissionsAsync();
      const permission = existingPermission.granted ? existingPermission : await requestRecordingPermissionsAsync();

      if (!permission.granted || cancelled) {
        return;
      }

      await localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
    }

    void applyMicrophone();

    return () => {
      cancelled = true;
    };
  }, [connectionState, isMicOn, localParticipant]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      return;
    }

    let cancelled = false;

    async function applyCamera() {
      if (!isCameraOn) {
        await localParticipant.setCameraEnabled(false).catch(() => undefined);
        return;
      }

      const existingPermission = await ImagePicker.getCameraPermissionsAsync();
      const permission = existingPermission.granted ? existingPermission : await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted || cancelled) {
        return;
      }

      await localParticipant.setCameraEnabled(true).catch(() => undefined);
    }

    void applyCamera();

    return () => {
      cancelled = true;
    };
  }, [connectionState, isCameraOn, localParticipant]);

  return null;
}

function MeetingRemoteTrackSubscriber({ mode }: { mode: 'voice' | 'video' }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [networkProfile, setNetworkProfile] = useState<'normal' | 'degraded' | 'critical'>('degraded');
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupStartedAtRef = useRef(Date.now());

  useEffect(() => {
    const updateNetworkProfile = (quality: ConnectionQuality, participant: { identity: string }) => {
      if (participant.identity !== localParticipant.identity) {
        return;
      }

      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }

      if (quality === ConnectionQuality.Poor) {
        setNetworkProfile('critical');
        return;
      }

      if (quality !== ConnectionQuality.Excellent) {
        setNetworkProfile('degraded');
        return;
      }

      recoveryTimerRef.current = setTimeout(() => {
        setNetworkProfile('normal');
        recoveryTimerRef.current = null;
      }, 8_000);
    };

    room.on(RoomEvent.ConnectionQualityChanged, updateNetworkProfile);

    return () => {
      room.off(RoomEvent.ConnectionQualityChanged, updateNetworkProfile);
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [localParticipant.identity, room]);

  useEffect(() => {
    const subscribeRemoteTracks = () => {
      const useGroupVideoLimits = room.remoteParticipants.size > 1;

      room.remoteParticipants.forEach((participant) => {
        ensureRemoteAudioPublicationSubscribed(participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined);

        if (mode === 'video') {
          ensureRemoteVideoPublicationSubscribed(
            participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined,
            {
              isStartup: Date.now() - startupStartedAtRef.current < 2_000,
              networkProfile,
              useGroupVideoLimits,
            },
          );
        }
      });

      const localCamera = localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
      localCamera?.setPublishingQuality(
        networkProfile === 'critical'
          ? VideoQuality.LOW
          : networkProfile === 'degraded'
            ? VideoQuality.MEDIUM
            : VideoQuality.HIGH,
      );
    };

    subscribeRemoteTracks();
    const interval = setInterval(subscribeRemoteTracks, 5_000);
    const decoderHealthInterval = setInterval(() => {
      room.remoteParticipants.forEach((participant) => {
        void recoverRemoteVideoPublicationIfDecoderStalled(
          participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined,
        );
      });
    }, 2_000);

    room
      .on(RoomEvent.ParticipantConnected, subscribeRemoteTracks)
      .on(RoomEvent.TrackPublished, subscribeRemoteTracks)
      .on(RoomEvent.TrackSubscribed, subscribeRemoteTracks)
      .on(RoomEvent.TrackSubscriptionStatusChanged, subscribeRemoteTracks)
      .on(RoomEvent.TrackUnmuted, subscribeRemoteTracks);

    return () => {
      clearInterval(interval);
      clearInterval(decoderHealthInterval);
      room
        .off(RoomEvent.ParticipantConnected, subscribeRemoteTracks)
        .off(RoomEvent.TrackPublished, subscribeRemoteTracks)
        .off(RoomEvent.TrackSubscribed, subscribeRemoteTracks)
        .off(RoomEvent.TrackSubscriptionStatusChanged, subscribeRemoteTracks)
        .off(RoomEvent.TrackUnmuted, subscribeRemoteTracks);
    };
  }, [localParticipant, mode, networkProfile, room]);

  return null;
}

function MeetingTiles({ mode }: { mode: 'voice' | 'video' }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const trackRefs = tracks.filter(isTrackReference);
  const activeSinceRef = useRef(new Map<string, number>());
  const [promotedSpeakerIds, setPromotedSpeakerIds] = useState<Set<string>>(() => new Set());
  const remoteParticipants = useMemo(
    () => participants.filter((participant) => participant.identity !== localParticipant.identity),
    [localParticipant.identity, participants],
  );

  useEffect(() => {
    if (remoteParticipants.length <= 6) {
      activeSinceRef.current.clear();
      setPromotedSpeakerIds(new Set());
      return undefined;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const next = new Set(promotedSpeakerIds);

      remoteParticipants.forEach((participant) => {
        if (participant.isSpeaking) {
          const currentSince = activeSinceRef.current.get(participant.identity) ?? now;
          activeSinceRef.current.set(participant.identity, currentSince);

          if (now - currentSince >= 5_000) {
            next.add(participant.identity);
          }
          return;
        }

        activeSinceRef.current.delete(participant.identity);
      });

      setPromotedSpeakerIds(next);
    }, 900);

    return () => clearInterval(interval);
  }, [promotedSpeakerIds, remoteParticipants]);

  const visibleParticipants = useMemo(() => (
    remoteParticipants.length > 6
      ? [...remoteParticipants]
        .sort((left, right) => {
          const leftPromoted = promotedSpeakerIds.has(left.identity) ? 0 : 1;
          const rightPromoted = promotedSpeakerIds.has(right.identity) ? 0 : 1;

          if (leftPromoted !== rightPromoted) {
            return leftPromoted - rightPromoted;
          }

          return (left.name || left.identity).localeCompare(right.name || right.identity);
        })
        .slice(0, 6)
      : remoteParticipants.length > 0
        ? remoteParticipants.slice(0, 6)
        : [localParticipant]
  ), [localParticipant, promotedSpeakerIds, remoteParticipants]);
  const localTrackRef = trackRefs.find((trackRef) => trackRef.participant.identity === localParticipant.identity);
  const showLocalOverlay = mode === 'video' && remoteParticipants.length > 0;
  const remoteTileCount = remoteParticipants.length;

  return (
    <View style={styles.tileGrid}>
      {visibleParticipants.map((participant, index) => (
        <MeetingTile
          key={participant.identity}
          mode={mode}
          name={participant.name || participant.identity}
          speaking={participant.isSpeaking}
          style={getMeetingTileStyle(remoteTileCount, index)}
          trackRef={trackRefs.find((trackRef) => trackRef.participant.identity === participant.identity)}
        />
      ))}
      {showLocalOverlay ? (
        <View style={styles.localPreviewTile}>
          <MeetingTile compact mode={mode} name={t('you')} speaking={localParticipant.isSpeaking} trackRef={localTrackRef} />
        </View>
      ) : null}
    </View>
  );
}

function MeetingTile({ compact = false, mode, name, speaking, style, trackRef }: { compact?: boolean; mode: 'voice' | 'video'; name: string; speaking: boolean; style?: object; trackRef?: TrackReference }) {
  const hasVideo = mode === 'video' && trackRef?.publication?.isMuted !== true && !!trackRef?.publication?.track;

  return (
    <View style={[styles.tile, style, compact && styles.tileCompact, speaking && styles.tileSpeaking]}>
      {hasVideo ? (
        <VideoTrack mirror={false} objectFit="cover" style={styles.videoTrack} trackRef={trackRef} />
      ) : (
        <View style={[styles.avatarCircle, compact && styles.avatarCircleCompact]}>
          <Text style={[styles.avatarText, compact && styles.avatarTextCompact]}>{name.slice(0, 1).toUpperCase()}</Text>
        </View>
      )}
      <Text numberOfLines={1} style={styles.tileName}>{name}</Text>
    </View>
  );
}

function getMeetingTileStyle(remoteTileCount: number, index: number) {
  if (remoteTileCount <= 1) {
    return styles.tileOne;
  }

  if (remoteTileCount <= 4) {
    return styles.tileQuarter;
  }

  return styles.tileSixth;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getMeetingInviteText(displayName: string, link: string) {
  return `${displayName} invites you to a MeetVap meeting. Click the link to join: ${link}`;
}

let styles = StyleSheet.create({
  avatarCircle: {
    alignItems: 'center',
    backgroundColor: meetingColors.primary,
    borderRadius: 42,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  avatarCircleCompact: {
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  avatarText: {
    color: colors.white,
    fontSize: 36,
    fontWeight: '900',
  },
  avatarTextCompact: {
    fontSize: 24,
  },
  buttonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  centered: {
    alignItems: 'center',
    backgroundColor: meetingColors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  controlButton: {
    alignItems: 'center',
    backgroundColor: meetingColors.button,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  controlButtonActive: {
    backgroundColor: meetingColors.primary,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingTop: spacing.md,
  },
  disabledButton: {
    opacity: 0.55,
  },
  endButton: {
    backgroundColor: meetingColors.danger,
  },
  endButtonStrong: {
    backgroundColor: meetingColors.dangerStrong,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: meetingColors.button,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  localPreviewTile: {
    bottom: spacing.md,
    height: 150,
    position: 'absolute',
    right: spacing.md,
    width: 112,
  },
  lobby: {
    alignItems: 'center',
    backgroundColor: meetingColors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  lobbyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'center',
    paddingTop: spacing.xl,
  },
  lobbyIcon: {
    alignItems: 'center',
    backgroundColor: meetingColors.primary,
    borderRadius: 36,
    height: 72,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 72,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: meetingColors.primary,
    borderRadius: 16,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  remaining: {
    color: meetingColors.secondaryText,
    fontSize: 15,
    marginTop: spacing.sm,
  },
  room: {
    backgroundColor: meetingColors.background,
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  roomHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  roomHeaderActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  roomSubtitle: {
    color: meetingColors.secondaryText,
    fontSize: 13,
    marginTop: 3,
  },
  roomTitle: {
    color: meetingColors.text,
    fontSize: 18,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: meetingColors.button,
    borderRadius: 16,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  subtitle: {
    color: meetingColors.secondaryText,
    fontSize: 16,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  tile: {
    alignItems: 'center',
    backgroundColor: meetingColors.tile,
    borderColor: meetingColors.border,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 170,
    overflow: 'hidden',
  },
  tileCompact: {
    minHeight: 0,
  },
  tileGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  tileOne: {
    flexBasis: '100%',
    height: '100%',
    width: '100%',
  },
  tileQuarter: {
    flexBasis: '50%',
    height: '50%',
    width: '50%',
  },
  tileSixth: {
    flexBasis: '50%',
    height: '33.333%',
    width: '50%',
  },
  tileName: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    bottom: spacing.sm,
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    left: spacing.sm,
    maxWidth: '86%',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    position: 'absolute',
  },
  tileSpeaking: {
    borderColor: meetingColors.primary,
  },
  title: {
    color: meetingColors.text,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  videoTrack: {
    height: '100%',
    width: '100%',
  },
});
