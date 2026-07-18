import { Ionicons } from '@expo/vector-icons';
import { AudioSession, LiveKitRoom, useConnectionState, useLocalParticipant, useParticipants, useRoomContext } from '@livekit/react-native';
import { ScreenCapturePickerView } from '@livekit/react-native-webrtc';
import { CommonActions } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Asset } from 'expo-asset';
import { createAudioPlayer, getRecordingPermissionsAsync, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AudioPresets, ConnectionQuality, ConnectionState, RoomEvent, Track, VideoPresets, VideoQuality, createLocalAudioTrack } from 'livekit-client';
import type { LocalParticipant as LiveKitLocalParticipant, LocalTrackPublication, LocalVideoTrack, RemoteTrackPublication, ScreenShareCaptureOptions, TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Modal, NativeModules, Platform, Pressable, StyleSheet, Text, TextInput, findNodeHandle, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { t } from '../i18n';
import { ApiError } from '../lib/api';
import { beginAppLockForegroundOperation, endCallOnlyAccess } from '../lib/appLockAccess';
import { getActiveCallSession, setActiveCallSession } from '../lib/activeCallSession';
import { answerCall, createCall, endCall, getCallScreenshotPrivacy, getCallStatus as fetchCallStatus, getCallToken, getConversationScreenshotPrivacy, inviteCallParticipant, submitCallFeedback } from '../lib/backend';
import { getMobileCallAnswerClientId } from '../lib/callAnswerClient';
import { subscribeToCallEvent } from '../lib/callEvents';
import { ensureRemoteAudioPublicationSubscribed, ensureRemoteVideoPublicationSubscribed, recoverRemoteVideoPublicationIfDecoderStalled } from '../lib/liveKitRemoteSubscription';
import { logCallDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { recordFinishedCallInDatabase } from '../lib/messageStore';
import { setPendingShareDraft } from '../lib/pendingShareDraft';
import { clearScreenCaptureProtectionRequirement, setScreenCaptureProtectionRequirement } from '../lib/screenCaptureProtection';
import { subscribeToShareIntentItems } from '../lib/shareIntentEvents';
import { formatShareSubtitle, formatShareSummary, isUsableSharedItem, prepareSharedItem } from '../lib/shareTargetItems';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { MainTabs } from '../navigation/MainTabs';
import { answerNativeIncomingCallKitCall, beginNativeLiveVoiceEffectSession, cancelNativeAndroidIncomingCall, closeCallPictureInPicture, confirmNativeLiveVoiceEffectAttached, endIosCallKitCall, enterCallPictureInPicture, getNativeCallAudioRoutes, isIosMultitaskingCameraAccessSupported, prepareNativeCallAudioSession, prepareNativeCallKitAudioSession, selectNativeCallAudioRoute, setCallPictureInPictureEnabled, setNativeCallAudioRoute, setNativeLiveVoiceEffect, setNativeLiveVoiceEffectAndWait, setNativeMediaViewerOrientationUnlocked, setNativeProximityScreenOffEnabled, startNativeCallService, startNativeIncomingRingtone, startNativeOutgoingRingback, stopNativeCallService, stopNativeIncomingRingtone, stopNativeOutgoingRingback, waitForNativeCallKitAudioActivation, waitForNativeLiveVoiceProcessing } from '../native/CallNative';
import type { CallAudioRoute } from '../native/CallNative';
import { AddPeopleModal, CallConnectionProblemModal, CallControl, CallRoomPresentationProvider, ConnectedCallStage, IncomingControls, LiveKitWaitingVideoStage, MinimizedCallView, PeopleInCallModal, WaitingCallControls, WaitingIncomingCallModal, WaitingVideoStage, clampMiniCallPosition, getMiniCallBounds } from './call/CallRoomPresentation';
import type { CallParticipantProfile, InviteCandidate, ScreenPoint } from './call/CallRoomPresentation';
import { createCallRoomStyles } from './call/CallRoomStyles';
import { useAppStore, type AppState as AppStoreState } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { AuthUser, Conversation } from '../types/domain';
import { RootStackParamList, SharedIntentItem } from '../types/navigation';
import { DEFAULT_VOICE_EFFECT_ID, VoiceEffectId, normalizeVoiceEffectId } from '../types/voiceEffects';

type Props = NativeStackScreenProps<RootStackParamList, 'CallRoom'>;
type CallAudioRouteOperationGuard = () => boolean;
const RINGTONE = require('../../assets/ringtone.wav') as number;
const OUTGOING_RINGBACK = require('../../assets/ringing.mp3') as number;
const activeCallMicrophonePublishPromises = new WeakMap<LiveKitLocalParticipant, Promise<LocalTrackPublication | undefined>>();
const CONNECTION_LOSS_TIMEOUT_MS = 30_000;
const PEER_CONNECTION_NOTICE_GRACE_MS = 1_200;
const VIDEO_CALL_CHROME_VISIBLE_MS = 5_000;
const VIDEO_CALL_KEEP_AWAKE_TAG = 'MeetVapVideoCall';
const VOICE_EFFECTS: { descriptionKey: string; icon: keyof typeof Ionicons.glyphMap; id: VoiceEffectId; titleKey: string }[] = [
  { descriptionKey: 'voiceEffectNormalDescription', icon: 'mic-outline', id: 'normal', titleKey: 'voiceEffectNormal' },
  { descriptionKey: 'voiceEffectDeepDescription', icon: 'radio-outline', id: 'deep', titleKey: 'voiceEffectDeep' },
  { descriptionKey: 'voiceEffectBrightDescription', icon: 'sparkles-outline', id: 'bright', titleKey: 'voiceEffectBright' },
  { descriptionKey: 'voiceEffectHeliumDescription', icon: 'balloon-outline', id: 'helium', titleKey: 'voiceEffectHelium' },
];
let callAudioRouteSelectionVersion = 0;
let callAudioRouteApplyVersion = 0;
let areCallAudioRouteOperationsBlocked = true;
let hasExplicitCallAudioRouteSelection = false;
let explicitCallAudioRoute: CallAudioRoute | null = null;
let callAudioPreparationQueue: Promise<void> = Promise.resolve();

function enqueueCallAudioPreparation(task: () => Promise<void>) {
  const run = callAudioPreparationQueue.catch(() => undefined).then(task);
  callAudioPreparationQueue = run.catch(() => undefined);
  return run;
}
const ANDROID_CALL_AUDIO_CAPTURE_OPTIONS = {
  autoGainControl: true,
  echoCancellation: true,
  noiseSuppression: true,
  voiceIsolation: true,
};
const ANDROID_VOICE_EFFECT_AUDIO_CAPTURE_OPTIONS = {
  autoGainControl: false,
  echoCancellation: true,
  noiseSuppression: false,
  voiceIsolation: false,
};
type CallAudioCaptureOptions = typeof ANDROID_CALL_AUDIO_CAPTURE_OPTIONS | typeof ANDROID_VOICE_EFFECT_AUDIO_CAPTURE_OPTIONS | undefined;
type CallVideoNetworkProfile = 'normal' | 'degraded' | 'critical';
const CALL_CONNECT_OPTIONS = {
  // Let LiveKit perform the initial subscription transaction. MeetVap adapts
  // quality only after a usable remote track has arrived.
  autoSubscribe: true,
  maxRetries: 3, // Increased for better reliability
  peerConnectionTimeout: 15_000, // Increased timeout
  websocketTimeout: 15_000,
};
const CALL_ROOM_OPTIONS = {
  // React Native WebRTC can emit preallocated receiver tracks before LiveKit's
  // participant/track metadata is available when publisher and subscriber use
  // one PeerConnection. Keep inbound media on LiveKit's dedicated subscriber
  // connection so remote tracks carry their real stream/publication identity.
  singlePeerConnection: false,
  // Remote video is rendered through MeetVap's own RTCView path, so there is no
  // LiveKit VideoTrack element to report visibility/dimensions. Let the explicit
  // post-subscription controller below own downlink adaptation.
  adaptiveStream: false,
  dynacast: true,
  publishDefaults: {
    audioPreset: AudioPresets.speech,
    dtx: true,
    forceStereo: false,
    red: true,
    stopMicTrackOnMute: false,
  },
};
const DIRECT_VIDEO_CAPTURE_OPTIONS: VideoCaptureOptions = {
  facingMode: 'user',
  frameRate: 15,
  resolution: {
    frameRate: 15,
    height: 360,
    width: 640,
  },
};
const GROUP_VIDEO_CAPTURE_OPTIONS: VideoCaptureOptions = {
  facingMode: 'user',
  frameRate: 15,
  resolution: {
    frameRate: 15,
    height: 360,
    width: 640,
  },
};
const DIRECT_VIDEO_PUBLISH_OPTIONS: TrackPublishOptions = {
  degradationPreference: 'maintain-framerate',
  simulcast: true,
  source: Track.Source.Camera,
  videoEncoding: VideoPresets.h360.encoding,
  videoSimulcastLayers: [VideoPresets.h180],
};
const GROUP_VIDEO_PUBLISH_OPTIONS: TrackPublishOptions = {
  degradationPreference: 'maintain-framerate',
  simulcast: true,
  source: Track.Source.Camera,
  videoEncoding: VideoPresets.h360.encoding,
  videoSimulcastLayers: [VideoPresets.h180],
};
const CALL_SCREEN_SHARE_CAPTURE_OPTIONS: ScreenShareCaptureOptions = {
  audio: false,
  resolution: {
    frameRate: 15,
    height: 720,
    width: 1280,
  },
};
const CALL_SCREEN_SHARE_PUBLISH_OPTIONS: TrackPublishOptions = {
  degradationPreference: 'maintain-resolution',
  simulcast: false,
  source: Track.Source.ScreenShare,
  videoEncoding: VideoPresets.h720.encoding,
};
const CALL_VIDEO_PROFILE_SWITCH_MIN_INTERVAL_MS = 8_000;
const CALL_VIDEO_DEGRADE_BAD_SAMPLE_COUNT = 2;
const CALL_VIDEO_CRITICAL_BAD_SAMPLE_COUNT = 4;
const CALL_VIDEO_RECOVERY_STABLE_MS = 8_000;
const CALL_VIDEO_ADAPTATION_BOOTSTRAP_GRACE_MS = 5_000;
const CALL_REMOTE_VIDEO_STARTUP_WATCHDOG_MS = 20_000;
const CALL_WEBRTC_STATS_SAMPLE_INTERVAL_MS = 3_000;
const CALL_WEBRTC_STATS_DEGRADE_BAD_SAMPLE_COUNT = 1;
const CALL_WEBRTC_STATS_CRITICAL_BAD_SAMPLE_COUNT = 2;
const CALL_WEBRTC_DEGRADED_LOSS_RATIO = 0.04;
const CALL_WEBRTC_CRITICAL_LOSS_RATIO = 0.10;
const CALL_WEBRTC_DEGRADED_RTT_MS = 450;
const CALL_WEBRTC_CRITICAL_RTT_MS = 900;
const CALL_WEBRTC_DEGRADED_JITTER_SECONDS = 0.04;
const CALL_WEBRTC_CRITICAL_JITTER_SECONDS = 0.10;
const CALL_WEBRTC_DEGRADED_AVAILABLE_BITRATE_BPS = 220_000;
const CALL_WEBRTC_CRITICAL_AVAILABLE_BITRATE_BPS = 110_000;
const CAMERA_REACQUIRE_COOLDOWN_MS = 900;
const CAMERA_PREVIEW_PUBLISH_TIMEOUT_MS = 5_000;
const IOS_BACKGROUND_CAMERA_INACTIVE_GRACE_MS = 800;
let lastCameraReleaseAt = 0;
type CameraFacingMode = 'user' | 'environment';
type SwitchableMediaTrack = MediaStreamTrack & {
  _switchCamera?: () => Promise<void> | void;
};
type RestartableVideoTrack = {
  mediaStreamTrack: SwitchableMediaTrack;
  restartTrack?: (options?: VideoCaptureOptions) => Promise<void>;
};
type RestartableAudioTrack = {
  isUpstreamPaused?: boolean;
  mediaStreamTrack?: MediaStreamTrack;
  restartTrack?: () => Promise<void>;
};
type CallRtcStatsSnapshot = {
  availableOutgoingBitrateBps?: number;
  inboundJitterSeconds?: number;
  inboundPacketLossRatio?: number;
  outboundQualityLimitedByBandwidth?: boolean;
  remoteInboundPacketLossRatio?: number;
  remoteInboundRttMs?: number;
};
type CallRtcStatsPrevious = {
  bytesSent?: number;
  framesEncoded?: number;
  packetsLost?: number;
  packetsReceived?: number;
  timestamp?: number;
};
type StatsCapableTransport = {
  getStats?: () => Promise<RTCStatsReport>;
};
type StatsCapableRoom = {
  engine?: {
    pcManager?: {
      publisher?: StatsCapableTransport;
      subscriber?: StatsCapableTransport;
    };
  };
};
type OutgoingCallStatusPhase = 'dialing' | 'ringing' | 'connecting' | 'connected' | 'ended';
type ConnectLiveKitOptions = {
  callKitAudioManaged?: boolean;
  keepOutgoingRingback?: boolean;
  keepIncomingRingtone?: boolean;
  permissionsAlreadyGranted?: boolean;
  preserveStatus?: boolean;
  silent?: boolean;
  skipAudioPreparation?: boolean;
  skipPermissionsCheck?: boolean;
};
type WaitingIncomingCall = {
  callId: string;
  conversationId: string;
  isGroupCall?: boolean;
  mode: 'voice' | 'video';
  participantNames?: string[];
  title: string;
};

function withCameraOperationTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string,
  onLateResolve?: (value: T) => void,
) {
  let didTimeout = false;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      didTimeout = true;
      reject(new Error(`${operationName} timed out`));
    }, timeoutMs);

    void operation.then((value) => {
      if (didTimeout) {
        try {
          onLateResolve?.(value);
        } catch {
          // Late native camera results must not interrupt the active call.
        }
        return;
      }

      clearTimeout(timeout);
      resolve(value);
    }, (error) => {
      if (didTimeout) {
        return;
      }

      clearTimeout(timeout);
      reject(error);
    });
  });
}

function getCallVideoCaptureOptions(
  isGroupCall?: boolean,
  facingMode: CameraFacingMode = 'user',
  _profile: CallVideoNetworkProfile = 'normal',
): VideoCaptureOptions {
  if (!isGroupCall) {
    return { ...DIRECT_VIDEO_CAPTURE_OPTIONS, facingMode };
  }

  return { ...GROUP_VIDEO_CAPTURE_OPTIONS, facingMode };
}

function getCallVideoPublishOptions(
  isGroupCall?: boolean,
  _profile: CallVideoNetworkProfile = 'normal',
): TrackPublishOptions {
  return isGroupCall ? GROUP_VIDEO_PUBLISH_OPTIONS : DIRECT_VIDEO_PUBLISH_OPTIONS;
}

function getCallVideoProfileRank(profile: CallVideoNetworkProfile) {
  switch (profile) {
    case 'critical':
      return 2;
    case 'degraded':
      return 1;
    default:
      return 0;
  }
}

function getPublishingQualityForNetworkProfile(profile: CallVideoNetworkProfile) {
  if (profile === 'critical') {
    return VideoQuality.LOW;
  }

  if (profile === 'degraded') {
    return VideoQuality.MEDIUM;
  }

  return VideoQuality.HIGH;
}

function getStatsNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getRtcStatsEntries(report: RTCStatsReport | undefined) {
  const entries: Array<Record<string, unknown>> = [];
  const maybeReport = report as unknown as {
    forEach?: (callback: (value: Record<string, unknown>) => void) => void;
    values?: () => Iterable<Record<string, unknown>>;
  };

  if (typeof maybeReport?.forEach === 'function') {
    maybeReport.forEach((value) => entries.push(value));
    return entries;
  }

  if (typeof maybeReport?.values === 'function') {
    return Array.from(maybeReport.values());
  }

  return entries;
}

async function collectCallRtcStatsSnapshot(
  room: unknown,
  previousStatsById: MutableRefObject<Map<string, CallRtcStatsPrevious>>,
) {
  const pcManager = (room as StatsCapableRoom).engine?.pcManager;
  const transports = [pcManager?.publisher, pcManager?.subscriber].filter(
    (transport): transport is StatsCapableTransport => typeof transport?.getStats === 'function',
  );
  const snapshot: CallRtcStatsSnapshot = {};

  if (transports.length === 0) {
    return snapshot;
  }

  for (const [transportIndex, transport] of transports.entries()) {
    let report: RTCStatsReport | undefined;

    try {
      report = await transport.getStats?.();
    } catch {
      continue;
    }

    getRtcStatsEntries(report).forEach((stats) => {
      const id = typeof stats.id === 'string' ? stats.id : undefined;
      const type = typeof stats.type === 'string' ? stats.type : undefined;
      const kind = stats.kind ?? stats.mediaType;
      const isVideo = kind === 'video';
      const timestamp = getStatsNumber(stats.timestamp);

      if (!id || !type || !timestamp) {
        return;
      }

      const statsKey = `${transportIndex}:${id}`;

      if (type === 'outbound-rtp' && isVideo) {
        const bytesSent = getStatsNumber(stats.bytesSent);
        const framesEncoded = getStatsNumber(stats.framesEncoded);
        const previous = previousStatsById.current.get(statsKey);
        snapshot.outboundQualityLimitedByBandwidth = snapshot.outboundQualityLimitedByBandwidth === true ||
          stats.qualityLimitationReason === 'bandwidth';

        previousStatsById.current.set(statsKey, { ...previous, bytesSent, framesEncoded, timestamp });
        return;
      }

      if (type === 'remote-inbound-rtp' && isVideo) {
        const roundTripTime = getStatsNumber(stats.roundTripTime);
        const fractionLost = getStatsNumber(stats.fractionLost);
        const packetsLost = getStatsNumber(stats.packetsLost);
        const packetsReceived = getStatsNumber(stats.packetsReceived);

        if (roundTripTime !== undefined) {
          snapshot.remoteInboundRttMs = Math.max(snapshot.remoteInboundRttMs ?? 0, roundTripTime * 1000);
        }

        const previous = previousStatsById.current.get(statsKey);

        if (fractionLost !== undefined) {
          snapshot.remoteInboundPacketLossRatio = Math.max(snapshot.remoteInboundPacketLossRatio ?? 0, fractionLost);
        } else if (
          packetsLost !== undefined &&
          packetsReceived !== undefined &&
          previous?.packetsLost !== undefined &&
          previous.packetsReceived !== undefined
        ) {
          const lostDelta = Math.max(0, packetsLost - previous.packetsLost);
          const receivedDelta = Math.max(0, packetsReceived - previous.packetsReceived);

          if (lostDelta + receivedDelta > 0) {
          snapshot.remoteInboundPacketLossRatio = Math.max(
            snapshot.remoteInboundPacketLossRatio ?? 0,
              lostDelta / (lostDelta + receivedDelta),
          );
          }
        }
        previousStatsById.current.set(statsKey, { ...previous, packetsLost, packetsReceived, timestamp });
        return;
      }

      if (type === 'inbound-rtp' && isVideo) {
        const jitter = getStatsNumber(stats.jitter);
        const packetsLost = getStatsNumber(stats.packetsLost);
        const packetsReceived = getStatsNumber(stats.packetsReceived);

        if (jitter !== undefined) {
          snapshot.inboundJitterSeconds = Math.max(snapshot.inboundJitterSeconds ?? 0, jitter);
        }

        const previous = previousStatsById.current.get(statsKey);

        if (
          packetsLost !== undefined &&
          packetsReceived !== undefined &&
          previous?.packetsLost !== undefined &&
          previous.packetsReceived !== undefined
        ) {
          const lostDelta = Math.max(0, packetsLost - previous.packetsLost);
          const receivedDelta = Math.max(0, packetsReceived - previous.packetsReceived);

          if (lostDelta + receivedDelta > 0) {
            snapshot.inboundPacketLossRatio = Math.max(
              snapshot.inboundPacketLossRatio ?? 0,
              lostDelta / (lostDelta + receivedDelta),
            );
          }
        }
        previousStatsById.current.set(statsKey, { ...previous, packetsLost, packetsReceived, timestamp });
        return;
      }

      if (type === 'candidate-pair' && (stats.selected === true || stats.nominated === true) && stats.state === 'succeeded') {
        const availableOutgoingBitrate = getStatsNumber(stats.availableOutgoingBitrate);
        const currentRoundTripTime = getStatsNumber(stats.currentRoundTripTime);

        if (availableOutgoingBitrate !== undefined) {
          snapshot.availableOutgoingBitrateBps = snapshot.availableOutgoingBitrateBps === undefined
            ? availableOutgoingBitrate
            : Math.min(snapshot.availableOutgoingBitrateBps, availableOutgoingBitrate);
        }

        if (currentRoundTripTime !== undefined) {
          snapshot.remoteInboundRttMs = Math.max(snapshot.remoteInboundRttMs ?? 0, currentRoundTripTime * 1000);
        }
      }
    });
  }

  return snapshot;
}

function getUplinkNetworkProfileFromRtcStats(snapshot: CallRtcStatsSnapshot): CallVideoNetworkProfile | null {
  const lossRatio = snapshot.remoteInboundPacketLossRatio ?? 0;
  const rttMs = snapshot.remoteInboundRttMs ?? 0;
  const availableOutgoingBitrateBps = snapshot.availableOutgoingBitrateBps;
  const isCritical = (
    lossRatio >= CALL_WEBRTC_CRITICAL_LOSS_RATIO ||
    rttMs >= CALL_WEBRTC_CRITICAL_RTT_MS ||
    (
      availableOutgoingBitrateBps !== undefined &&
      availableOutgoingBitrateBps <= CALL_WEBRTC_CRITICAL_AVAILABLE_BITRATE_BPS
    )
  );

  if (isCritical) {
    return 'critical';
  }

  const isDegraded = (
    lossRatio >= CALL_WEBRTC_DEGRADED_LOSS_RATIO ||
    rttMs >= CALL_WEBRTC_DEGRADED_RTT_MS ||
    snapshot.outboundQualityLimitedByBandwidth === true ||
    (
      availableOutgoingBitrateBps !== undefined &&
      availableOutgoingBitrateBps <= CALL_WEBRTC_DEGRADED_AVAILABLE_BITRATE_BPS
    )
  );

  return isDegraded ? 'degraded' : 'normal';
}

function getDownlinkNetworkProfileFromRtcStats(snapshot: CallRtcStatsSnapshot): CallVideoNetworkProfile | null {
  const lossRatio = snapshot.inboundPacketLossRatio ?? 0;
  const jitterSeconds = snapshot.inboundJitterSeconds ?? 0;
  const rttMs = snapshot.remoteInboundRttMs ?? 0;

  if (
    lossRatio >= CALL_WEBRTC_CRITICAL_LOSS_RATIO ||
    jitterSeconds >= CALL_WEBRTC_CRITICAL_JITTER_SECONDS ||
    rttMs >= CALL_WEBRTC_CRITICAL_RTT_MS
  ) {
    return 'critical';
  }

  if (
    lossRatio >= CALL_WEBRTC_DEGRADED_LOSS_RATIO ||
    jitterSeconds >= CALL_WEBRTC_DEGRADED_JITTER_SECONDS ||
    rttMs >= CALL_WEBRTC_DEGRADED_RTT_MS
  ) {
    return 'degraded';
  }

  return 'normal';
}

function logCallDebug(event: string, details?: Record<string, unknown>) {
  logCallDiagnostic(event, {
    ...details,
    timestamp: new Date().toISOString(),
    timestampMs: Date.now(),
  });
}

// Utility function for cleaning up audio resources
const cleanupAudioResources = (refs: {
  ringtoneRef?: MutableRefObject<ReturnType<typeof createAudioPlayer> | null>;
  outgoingRingbackRef?: MutableRefObject<ReturnType<typeof createAudioPlayer> | null>;
  outgoingRingbackNativeActiveRef?: MutableRefObject<boolean>;
  ringbackTimeoutRef?: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  ringbackSubscriptionRef?: MutableRefObject<{ remove: () => void } | null>;
  ringbackGenerationRef?: MutableRefObject<number>;
}) => {
  if (refs.ringbackTimeoutRef?.current) {
    clearTimeout(refs.ringbackTimeoutRef.current);
    refs.ringbackTimeoutRef.current = null;
  }

  if (refs.ringbackSubscriptionRef?.current) {
    refs.ringbackSubscriptionRef.current.remove();
    refs.ringbackSubscriptionRef.current = null;
  }

  if (refs.ringbackGenerationRef?.current) {
    refs.ringbackGenerationRef.current += 1;
  }

  if (refs.outgoingRingbackRef?.current) {
    try {
      refs.outgoingRingbackRef.current.loop = false;
      refs.outgoingRingbackRef.current.pause();
      refs.outgoingRingbackRef.current.remove();
    } catch {
      // Ignore cleanup errors
    } finally {
      refs.outgoingRingbackRef.current = null;
    }
  }

  if (refs.outgoingRingbackNativeActiveRef?.current) {
    stopNativeOutgoingRingback();
    refs.outgoingRingbackNativeActiveRef.current = false;
  }

  if (refs.ringtoneRef?.current) {
    try {
      refs.ringtoneRef.current.loop = false;
      refs.ringtoneRef.current.pause();
      refs.ringtoneRef.current.remove();
    } catch {
      // Ignore cleanup errors
    } finally {
      refs.ringtoneRef.current = null;
    }
  }
};

export function CallRoomScreen({ navigation, route }: Props) {
  useThemeColors();
  styles = createCallRoomStyles();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const supportsLocalVideoCapture = Platform.OS === 'android' || Device.isDevice !== false;
  const ringtoneRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const outgoingRingbackRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const outgoingRingbackNativeActiveRef = useRef(false);
  const outgoingRingbackLoopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingRingbackSubscriptionRef = useRef<{ remove: () => void } | null>(null);
  const outgoingRingbackGenerationRef = useRef(0);
  const hasRecordedCallRef = useRef(false);
  const isAnsweringCallRef = useRef(false);
  const hasAutoAnsweredNativeCallRef = useRef(false);
  const isEndingCallRef = useRef(false);
  const hasClosedCallScreenRef = useRef(false);
  const activeConnectPromiseRef = useRef<Promise<void> | null>(null);
  const activeConnectCallIdRef = useRef<string | null>(null);
  const preparedConnectPromiseRef = useRef<Promise<{ token: string; url: string }> | null>(null);
  const preparedConnectCallIdRef = useRef<string | null>(null);
  const hasStartedCallSetupRef = useRef(false);
  const outgoingStatusPhaseRef = useRef<OutgoingCallStatusPhase>(route.params.direction === 'outgoing' ? 'dialing' : 'connecting');
  const nativeCallSessionIdRef = useRef(`call-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const prefetchedCallTokenRef = useRef<{ callId: string; token: string; url: string } | null>(null);
  const isCallAcceptedRef = useRef(false);
  const isRecordingFinishedCallStatsRef = useRef(false);
  const skipCallFeedbackPromptRef = useRef(false);
  const isIncomingPendingRef = useRef(false);
  const localPreviewVideoTrackRef = useRef<LocalVideoTrack | null>(null);
  const serverUrl: AppStoreState['serverUrl'] = useAppStore((state: AppStoreState) => state.serverUrl);
  const user: AppStoreState['user'] = useAppStore((state: AppStoreState) => state.user);
  const subscriptionStatus = useAppStore((state: AppStoreState) => state.subscriptionStatus);
  const contacts: AppStoreState['contacts'] = useAppStore((state: AppStoreState) => state.contacts);
  const conversations: AppStoreState['conversations'] = useAppStore((state: AppStoreState) => state.conversations);
  const loadContacts: AppStoreState['loadContacts'] = useAppStore((state: AppStoreState) => state.loadContacts);
  const loadConversations: AppStoreState['loadConversations'] = useAppStore((state: AppStoreState) => state.loadConversations);
  const recordCallLog: AppStoreState['recordCallLog'] = useAppStore((state: AppStoreState) => state.recordCallLog);
  const isLockedCallAccess = route.params.callAccess === 'locked-call';
  const [incomingVoiceEffectId, setIncomingVoiceEffectId] = useState<VoiceEffectId>(() => normalizeVoiceEffectId(route.params.voiceEffectId));
  const [isIncomingVoiceEffectPickerOpen, setIncomingVoiceEffectPickerOpen] = useState(false);
  const canShowVoiceChanger = route.params.mode === 'voice';
  const canUseVoiceChanger = canShowVoiceChanger && hasPremiumAccess(subscriptionStatus);
  const nativeCallVoiceEffectId = canUseVoiceChanger
    ? normalizeVoiceEffectId(route.params.direction === 'incoming' ? incomingVoiceEffectId : route.params.voiceEffectId)
    : DEFAULT_VOICE_EFFECT_ID;
  const nativeCallVoiceEffectIdRef = useRef(nativeCallVoiceEffectId);
  nativeCallVoiceEffectIdRef.current = nativeCallVoiceEffectId;
  const callAudioCaptureOptions = useMemo(() => {
    if (Platform.OS === 'ios') {
      return undefined;
    }

    return nativeCallVoiceEffectId === DEFAULT_VOICE_EFFECT_ID
      ? ANDROID_CALL_AUDIO_CAPTURE_OPTIONS
      : ANDROID_VOICE_EFFECT_AUDIO_CAPTURE_OPTIONS;
  }, [nativeCallVoiceEffectId]);
  const [isMuted, setMuted] = useState(false);
  const isMutedRef = useRef(isMuted);
  const [isCameraOff, setCameraOff] = useState(route.params.mode === 'voice' || !supportsLocalVideoCapture);
  const [localCameraFacing, setLocalCameraFacing] = useState<CameraFacingMode>('user');
  const [isSpeakerOn, setSpeakerOn] = useState(route.params.mode === 'video');
  const [callAudioRoutes, setCallAudioRoutes] = useState<CallAudioRoute[]>([]);
  const [isCallAudioRoutePickerOpen, setCallAudioRoutePickerOpen] = useState(false);
  const requestedCallAudioRouteIdRef = useRef<string | null>(null);
  const isAutoSelectingCallAudioRouteRef = useRef(false);
  const [isPictureInPictureLayout, setPictureInPictureLayout] = useState(false);
  const [isSystemPictureInPictureLayout, setSystemPictureInPictureLayout] = useState(false);
  const [isRemoteScreenShareActive, setRemoteScreenShareActive] = useState(false);
  const enterPictureInPictureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hasCallPermissions, setHasCallPermissions] = useState(false);
  const [callId, setCallId] = useState(route.params.callId ?? null);
  const currentCallIdRef = useRef<string | null>(route.params.callId ?? null);
  const [liveKitUrl, setLiveKitUrl] = useState<string | undefined>();
  const [liveKitToken, setLiveKitToken] = useState<string | undefined>();
  const [isLiveKitRoomEnabled, setLiveKitRoomEnabled] = useState(true);
  const isLiveKitRoomEnabledRef = useRef(true);
  const liveKitDisconnectRef = useRef<(() => Promise<void>) | null>(null);
  const canApplyCallAudioRoute = useCallback(() => (
    !isEndingCallRef.current && isLiveKitRoomEnabledRef.current
  ), []);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const [localConnectionIssueSince, setLocalConnectionIssueSince] = useState<number | null>(null);
  const [peerConnectionIssueSince, setPeerConnectionIssueSince] = useState<number | null>(null);
  const [connectionProblemNotice, setConnectionProblemNotice] = useState<{ message: string; title: string } | null>(null);
  const peerConnectionProblemTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callEndedStatusCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callEndedStatusCheckVersionRef = useRef(0);
  const [isLiveKitStarting, setLiveKitStarting] = useState(false);
  const [hasLocalCameraPublished, setLocalCameraPublished] = useState(false);
  const [localPreviewVideoTrack, setLocalPreviewVideoTrack] = useState<LocalVideoTrack | null>(null);
  const [localCameraRenderVersion, setLocalCameraRenderVersion] = useState(0);
  const [answeredParticipantIds, setAnsweredParticipantIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (isLockedCallAccess) {
      skipCallFeedbackPromptRef.current = true;
    }
  }, [isLockedCallAccess]);

  const shouldAutoAnswerInitialIncomingCall = route.params.answeredByNative === true;
  const [status, setStatus] = useState(route.params.direction === 'incoming'
    ? (shouldAutoAnswerInitialIncomingCall ? t('connecting') : getIncomingCallStatus(route.params.mode, route.params.isGroupCall))
    : t('calling'));
  const [isCallAccepted, setCallAccepted] = useState(route.params.direction === 'incoming' ? shouldAutoAnswerInitialIncomingCall : false);
  const [miniCallPosition, setMiniCallPosition] = useState<ScreenPoint | null>(null);
  const [isIncomingPending, setIncomingPending] = useState(route.params.direction === 'incoming' && !shouldAutoAnswerInitialIncomingCall);
  const [isRingtoneEnabled, setRingtoneEnabled] = useState(true);
  const [isAddPeopleOpen, setAddPeopleOpen] = useState(false);
  const [isPeopleListOpen, setPeopleListOpen] = useState(false);
  const [isVideoCallChromeVisible, setVideoCallChromeVisible] = useState(true);
  const videoCallChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [peopleSearch, setPeopleSearch] = useState('');
  const [debouncedPeopleSearch, setDebouncedPeopleSearch] = useState('');
  const [waitingIncomingCall, setWaitingIncomingCall] = useState<WaitingIncomingCall | null>(null);
  const [pendingCallFeedbackId, setPendingCallFeedbackId] = useState<string | null>(null);
  const [selectedCallRating, setSelectedCallRating] = useState(0);
  const [isShareTargetOpen, setShareTargetOpen] = useState(false);
  const [shareTargetItems, setShareTargetItems] = useState<SharedIntentItem[]>([]);
  const [shareTargetQuery, setShareTargetQuery] = useState('');
  const [isShareSending, setShareSending] = useState(false);
  const [selectedShareConversationId, setSelectedShareConversationId] = useState<string | null>(null);
  const isInitialNativeCallAudioPreparationPendingRef = useRef(Platform.OS === 'ios' && route.params.answeredByNative === true);
  const isCallKitAudioManagedCall = Platform.OS === 'ios' &&
    route.params.direction === 'incoming' &&
    route.params.answeredByNative === true;

  useEffect(() => {
    const shouldUnlockOrientation = route.params.mode === 'video' &&
      isRemoteScreenShareActive &&
      !isIncomingPending &&
      !isPictureInPictureLayout &&
      !isSystemPictureInPictureLayout;

    setNativeMediaViewerOrientationUnlocked(shouldUnlockOrientation);

    return () => {
      setNativeMediaViewerOrientationUnlocked(false);
    };
  }, [
    isIncomingPending,
    isPictureInPictureLayout,
    isRemoteScreenShareActive,
    isSystemPictureInPictureLayout,
    route.params.mode,
  ]);

  useEffect(() => {
    callAudioRouteSelectionVersion += 1;
    enableCallAudioRouteOperations();
    hasExplicitCallAudioRouteSelection = false;
    explicitCallAudioRoute = null;

    return () => {
      callAudioRouteSelectionVersion += 1;
      blockPendingCallAudioRouteOperations();
      hasExplicitCallAudioRouteSelection = false;
      explicitCallAudioRoute = null;
    };
  }, []);

  useEffect(() => subscribeToShareIntentItems((items) => {
    if (isLockedCallAccess) {
      return;
    }

    const nextItems = items.filter(isUsableSharedItem);

    if (nextItems.length === 0) {
      return;
    }

    if (peerConnectionProblemTimeoutRef.current) {
      clearTimeout(peerConnectionProblemTimeoutRef.current);
      peerConnectionProblemTimeoutRef.current = null;
    }
    setLocalConnectionIssueSince(null);
    setPeerConnectionIssueSince(null);
    setConnectionProblemNotice(null);
    setShareTargetItems(nextItems);
    setShareTargetQuery('');
    setSelectedShareConversationId(null);
    setShareSending(false);
    setShareTargetOpen(true);
    void loadConversations().catch(() => undefined);
  }), [isLockedCallAccess, loadConversations]);

  useEffect(() => {
    if (!callId || !isCallAccepted || isIncomingPending || isEndingCallRef.current) {
      return;
    }

    setActiveCallSession({
      answeredByNative: route.params.answeredByNative,
      autoJoin: route.params.autoJoin,
      callAccess: route.params.callAccess,
      callId,
      callState: 'active',
      conversationId: route.params.conversationId,
      direction: route.params.direction,
      isGroupCall: route.params.isGroupCall,
      mode: route.params.mode,
      participantNames: route.params.participantNames,
      title: route.params.title,
    });
    logCallDebug('active-call-session-registered', {
      callId,
      direction: route.params.direction,
      mode: route.params.mode,
    });
  }, [callId, isCallAccepted, isIncomingPending, route.params.answeredByNative, route.params.autoJoin, route.params.callAccess, route.params.conversationId, route.params.direction, route.params.isGroupCall, route.params.mode, route.params.participantNames, route.params.title]);

  const setCallMuted = useCallback((value: boolean) => {
    isMutedRef.current = value;
    setMuted(value);
  }, []);

  const markParticipantAnswered = useCallback((participantId?: string) => {
    if (!participantId) {
      return;
    }

    setAnsweredParticipantIds((current) => {
      if (current.has(participantId)) {
        return current;
      }

      const next = new Set(current);
      next.add(participantId);
      return next;
    });
  }, []);

  useEffect(() => {
    isCallAcceptedRef.current = isCallAccepted;
  }, [isCallAccepted]);

  useEffect(() => {
    isIncomingPendingRef.current = isIncomingPending;
  }, [isIncomingPending]);
  useEffect(() => {
    currentCallIdRef.current = callId ?? route.params.callId ?? null;
  }, [callId, route.params.callId]);

  const inviteCandidates = useMemo(
    () => getInviteCandidates(contacts, conversations, route.params.conversationId),
    [contacts, conversations, route.params.conversationId],
  );

  const visibleInviteCandidates = useMemo(() => {
    const query = debouncedPeopleSearch.trim().toLowerCase();

    if (!query) {
      return inviteCandidates;
    }

    return inviteCandidates.filter((candidate) => (
      candidate.title.toLowerCase().includes(query) ||
      candidate.username.toLowerCase().includes(query)
    ));
  }, [debouncedPeopleSearch, inviteCandidates]);

  const shareableConversations = useMemo(
    () => conversations.filter((conversation) => conversation.type !== 'DIRECT' || !!conversation.otherUserId),
    [conversations],
  );

  const visibleShareableConversations = useMemo(() => {
    const query = shareTargetQuery.trim().toLowerCase();

    if (!query) {
      return shareableConversations.slice(0, 100);
    }

    return shareableConversations.filter((conversation) => (
      conversation.title.toLowerCase().includes(query) ||
      conversation.searchSnippet?.toLowerCase().includes(query)
    )).slice(0, 100);
  }, [shareableConversations, shareTargetQuery]);

  const callParticipantProfiles = useMemo(() => {
    const profiles = new Map<string, CallParticipantProfile>();
    const addProfile = (profileUser?: AuthUser | null) => {
      if (!profileUser) {
        return;
      }

      profiles.set(profileUser.id, {
        avatarUrl: profileUser.avatarUrl,
        name: profileUser.displayName || profileUser.username,
      });
    };

    addProfile(user);
    contacts.forEach(addProfile);
    conversations.forEach((conversation) => {
      conversation.members?.forEach(addProfile);
    });

    return profiles;
  }, [contacts, conversations, user]);
  const shouldProtectCallFromLocalSettings = useMemo(() => {
    const conversation = route.params.conversationId
      ? conversations.find((item) => item.id === route.params.conversationId)
      : undefined;

    if (!conversation) {
      return false;
    }

    if (conversation.type === 'GROUP' || route.params.isGroupCall === true) {
      return conversation.preventScreenshots === true;
    }

    return conversation.members?.some((member) => member.id !== user?.id && member.preventPeerScreenshots === true) === true;
  }, [conversations, route.params.conversationId, route.params.isGroupCall, user?.id]);

  const participantLine = useMemo(() => {
    const participantNames = route.params.participantNames?.filter(Boolean) ?? [];

    if (!route.params.isGroupCall || participantNames.length < 2) {
      return null;
    }

    return formatParticipantNames(participantNames);
  }, [route.params.isGroupCall, route.params.participantNames]);

  const miniCallBounds = useMemo(() => getMiniCallBounds(window.width, window.height, insets.top, insets.bottom), [insets.bottom, insets.top, window.height, window.width]);
  const defaultMiniCallPosition = useMemo(() => ({
    x: miniCallBounds.maxX,
    y: miniCallBounds.minY,
  }), [miniCallBounds.maxX, miniCallBounds.minY]);
  const visibleMiniCallPosition = miniCallPosition
    ? clampMiniCallPosition(miniCallPosition, miniCallBounds)
    : defaultMiniCallPosition;

  const logCallTiming = useCallback((event: string, details?: Record<string, unknown>) => {
    logCallDebug(event, {
      accepted: isCallAcceptedRef.current,
      callId: callId ?? route.params.callId ?? null,
      direction: route.params.direction,
      incomingPending: isIncomingPendingRef.current,
      mode: route.params.mode,
      remoteParticipantCount,
      sessionId: nativeCallSessionIdRef.current,
      userId: user?.id,
      ...details,
    });
  }, [callId, remoteParticipantCount, route.params.callId, route.params.direction, route.params.mode, user?.id]);

  const logCallScreenDebug = useCallback((event: string, details?: Record<string, unknown>) => {
    logCallDebug(event, {
      accepted: isCallAcceptedRef.current,
      callId: callId ?? route.params.callId ?? null,
      connectedAt: !!connectedAt,
      direction: route.params.direction,
      hasLiveKitToken: !!liveKitToken,
      incomingPending: isIncomingPendingRef.current,
      isGroupCall: route.params.isGroupCall === true,
      liveKitStarting: isLiveKitStarting,
      localPreview: !!localPreviewVideoTrackRef.current,
      mode: route.params.mode,
      remoteParticipantCount,
      sessionId: nativeCallSessionIdRef.current,
      status,
      userId: user?.id,
      ...details,
    });
  }, [
    callId,
    connectedAt,
    isLiveKitStarting,
    liveKitToken,
    remoteParticipantCount,
    route.params.callId,
    route.params.direction,
    route.params.isGroupCall,
    route.params.mode,
    status,
    user?.id,
  ]);

  const applyCallScreenshotProtection = useCallback(async (isActive: () => boolean) => {
    const protectionReason = `call:${nativeCallSessionIdRef.current}`;
    const conversationId = route.params.conversationId;
    const nextCallId = currentCallIdRef.current;

    if (!conversationId && !nextCallId) {
      clearScreenCaptureProtectionRequirement(protectionReason);
      return;
    }

    if (!serverUrl) {
      setScreenCaptureProtectionRequirement(protectionReason, true);
      return;
    }

    if (shouldProtectCallFromLocalSettings) {
      setScreenCaptureProtectionRequirement(protectionReason, true);
    }

    try {
      const privacy = route.params.isGroupCall === true && nextCallId
        ? await getCallScreenshotPrivacy(serverUrl, nextCallId)
        : conversationId
          ? await getConversationScreenshotPrivacy(serverUrl, conversationId)
          : await getCallScreenshotPrivacy(serverUrl, nextCallId as string);

      if (!isActive()) {
        return;
      }

      setScreenCaptureProtectionRequirement(protectionReason, privacy.preventPeerScreenshots === true);
    } catch {
      if (!isActive()) {
        return;
      }

      setScreenCaptureProtectionRequirement(protectionReason, true);
    }
  }, [callId, remoteParticipantCount, route.params.callId, route.params.conversationId, route.params.isGroupCall, serverUrl, shouldProtectCallFromLocalSettings]);

  useEffect(() => {
    let active = true;

    void applyCallScreenshotProtection(() => active);

    return () => {
      active = false;
    };
  }, [applyCallScreenshotProtection]);

  useEffect(() => {
    const protectionReason = `call:${nativeCallSessionIdRef.current}`;

    return () => {
      clearScreenCaptureProtectionRequirement(protectionReason);
    };
  }, []);

  useEffect(() => {
    const screenSessionId = nativeCallSessionIdRef.current;

    logCallScreenDebug('screen-mounted', {
      appState: AppState.currentState,
      autoJoin: route.params.autoJoin === true,
      hasServerUrl: !!serverUrl,
      initialCallId: route.params.callId ?? null,
      isGroupCall: route.params.isGroupCall === true,
      supportsLocalVideoCapture,
    });

    return () => {
      logCallDebug('screen-unmounted', {
        accepted: isCallAcceptedRef.current,
        callId: currentCallIdRef.current,
        direction: route.params.direction,
        incomingPending: isIncomingPendingRef.current,
        mode: route.params.mode,
        platform: Platform.OS,
        sessionId: screenSessionId,
      });
    };
  }, [logCallScreenDebug, route.params.autoJoin, route.params.callId, route.params.direction, route.params.isGroupCall, route.params.mode, serverUrl, supportsLocalVideoCapture]);

  const recordCall = useCallback((nextCallId: string, direction: 'incoming' | 'outgoing', status: 'answered' | 'cancelled' | 'declined' | 'missed' = 'answered') => {
    if (hasRecordedCallRef.current && status === 'answered') {
      return;
    }

    if (status === 'answered') {
      hasRecordedCallRef.current = true;
    }
    void recordCallLog({
      conversationId: route.params.conversationId,
      direction,
      id: nextCallId,
      mode: route.params.mode,
      status,
      title: route.params.title,
    });
  }, [recordCallLog, route.params.conversationId, route.params.mode, route.params.title]);

  // FIX 1: Enhanced cleanup with all resources
  const stopRingtone = useCallback(() => {
    stopNativeIncomingRingtone();
    const player = ringtoneRef.current;

    if (!player) {
      return;
    }

    try {
      player.loop = false;
      player.pause();
      void player.seekTo(0).catch(() => undefined);
      player.remove();
    } catch {
      // Audio players can throw if the native audio object has already been released.
    } finally {
      ringtoneRef.current = null;
    }
  }, []);

  const stopOutgoingRingback = useCallback(() => {
    outgoingRingbackGenerationRef.current += 1;
    stopNativeOutgoingRingback();
    outgoingRingbackNativeActiveRef.current = false;

    if (outgoingRingbackLoopTimeoutRef.current) {
      clearTimeout(outgoingRingbackLoopTimeoutRef.current);
      outgoingRingbackLoopTimeoutRef.current = null;
    }

    outgoingRingbackSubscriptionRef.current?.remove();
    outgoingRingbackSubscriptionRef.current = null;

    const player = outgoingRingbackRef.current;

    if (!player) {
      return;
    }

    try {
      player.loop = false;
      player.pause();
      void player.seekTo(0).catch(() => undefined);
      player.remove();
    } catch {
      // Audio players can throw if the native audio object has already been released.
    } finally {
      outgoingRingbackRef.current = null;
    }
  }, []);

  const stopLocalCameraPreview = useCallback(() => {
    const track = localPreviewVideoTrackRef.current;

    if (!track) {
      setLocalPreviewVideoTrack(null);
      return;
    }

    logCallDebug('local-preview-stop', {
      callId: currentCallIdRef.current,
      mediaTrackId: track.mediaStreamTrack.id,
      muted: track.mediaStreamTrack.muted,
      readyState: track.mediaStreamTrack.readyState,
    });

    localPreviewVideoTrackRef.current = null;
    setLocalPreviewVideoTrack(null);

    try {
      track.stop();
      lastCameraReleaseAt = Date.now();
    } catch {
      // The native preview track can already be released when the call screen is closing.
    }
  }, []);

  const registerLiveKitDisconnect = useCallback((disconnect: (() => Promise<void>) | null) => {
    if (!isLiveKitRoomEnabledRef.current && disconnect) {
      void disconnect().catch(() => undefined);
      return;
    }

    liveKitDisconnectRef.current = disconnect;
  }, []);

  const stopLiveKitRoom = useCallback(() => {
    if (!isLiveKitRoomEnabledRef.current) {
      return;
    }

    const disconnect = liveKitDisconnectRef.current;

    liveKitDisconnectRef.current = null;
    isLiveKitRoomEnabledRef.current = false;
    blockPendingCallAudioRouteOperations();
    setLiveKitRoomEnabled(false);
    setLiveKitToken(undefined);
    setLiveKitUrl(undefined);
    lastCameraReleaseAt = Date.now();
    logCallDebug('livekit-teardown-start', {
      callId: currentCallIdRef.current,
      hasDisconnect: !!disconnect,
    });
    void disconnect?.().catch(() => undefined);
    void AudioSession.stopAudioSession().catch(() => undefined);
  }, []);

  const detachLocalPreviewTrack = useCallback((publishedTrack?: LocalVideoTrack | null) => {
    const currentTrack = localPreviewVideoTrackRef.current;

    if (publishedTrack && currentTrack && currentTrack !== publishedTrack) {
      return;
    }

    logCallDebug('local-preview-detach-after-publish', {
      callId: currentCallIdRef.current,
      mediaTrackId: currentTrack?.mediaStreamTrack.id ?? publishedTrack?.mediaStreamTrack.id ?? null,
      sameTrack: !currentTrack || !publishedTrack || currentTrack === publishedTrack,
    });

    if (publishedTrack && currentTrack === publishedTrack) {
      return;
    }

    localPreviewVideoTrackRef.current = null;
    setLocalPreviewVideoTrack(null);
  }, []);

  const finishCloseCallScreenOnce = useCallback(() => {
    if (hasClosedCallScreenRef.current) {
      return;
    }

    hasClosedCallScreenRef.current = true;
    endCallOnlyAccess(currentCallIdRef.current ?? route.params.callId);

    // FIX 1: Ensure all audio resources are cleaned up
    cleanupAudioResources({
      ringtoneRef,
      outgoingRingbackRef,
      outgoingRingbackNativeActiveRef,
      ringbackTimeoutRef: outgoingRingbackLoopTimeoutRef,
      ringbackSubscriptionRef: outgoingRingbackSubscriptionRef,
      ringbackGenerationRef: outgoingRingbackGenerationRef,
    });
    stopLocalCameraPreview();

    navigation.dispatch((state) => {
      const routes = state.routes.filter((item) => item.key !== route.key);

      return CommonActions.reset({
        index: Math.max(0, routes.length - 1),
        routes: routes.length > 0 ? routes : [{ name: 'MainTabs' }],
      } as never);
    });
  }, [navigation, route.key, stopLocalCameraPreview]);

  const closeCallScreenOnce = useCallback(() => {
    stopLiveKitRoom();

    if (hasClosedCallScreenRef.current || pendingCallFeedbackId) {
      return;
    }

    const nextCallId = currentCallIdRef.current;

    if (
      !skipCallFeedbackPromptRef.current &&
      !isRecordingFinishedCallStatsRef.current &&
      isCallAcceptedRef.current &&
      nextCallId
    ) {
      isRecordingFinishedCallStatsRef.current = true;
      void recordFinishedCallInDatabase(route.params.mode, elapsedSeconds)
        .then((finishedCallCount) => {
          isRecordingFinishedCallStatsRef.current = false;

          skipCallFeedbackPromptRef.current = true;
        })
        .catch(() => {
          isRecordingFinishedCallStatsRef.current = false;
          skipCallFeedbackPromptRef.current = true;
        });
    }

    finishCloseCallScreenOnce();
  }, [elapsedSeconds, finishCloseCallScreenOnce, pendingCallFeedbackId, route.params.mode, serverUrl, stopLiveKitRoom]);

  const closeCallFeedback = useCallback(() => {
    skipCallFeedbackPromptRef.current = true;
    setPendingCallFeedbackId(null);
    finishCloseCallScreenOnce();
  }, [finishCloseCallScreenOnce]);

  const submitPendingCallFeedback = useCallback(async () => {
    if (!pendingCallFeedbackId || !serverUrl || selectedCallRating < 1) {
      return;
    }

    try {
      await submitCallFeedback(serverUrl, pendingCallFeedbackId, selectedCallRating);
    } catch (error) {
      Alert.alert(t('callFeedbackFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      closeCallFeedback();
    }
  }, [closeCallFeedback, pendingCallFeedbackId, selectedCallRating, serverUrl]);

  const prefetchCallToken = useCallback(async (nextCallId: string) => {
    if (!serverUrl || prefetchedCallTokenRef.current?.callId === nextCallId) {
      return;
    }

    try {
      logCallTiming('token-prefetch-start', { nextCallId });
      const response = await getCallToken(serverUrl, nextCallId);
      prefetchedCallTokenRef.current = { callId: nextCallId, token: response.token, url: response.url };
      logCallTiming('token-prefetch-ready', { nextCallId });
    } catch {
      logCallTiming('token-prefetch-failed', { nextCallId });
      // Token prefetch is an optimization. The actual connect path will retry.
    }
  }, [logCallTiming, serverUrl]);

  const cacheCallToken = useCallback((nextCallId: string, credentials?: { token: string; url: string } | null) => {
    if (!credentials) {
      return;
    }

    prefetchedCallTokenRef.current = {
      callId: nextCallId,
      token: credentials.token,
      url: credentials.url,
    };
    logCallTiming('token-cached', { nextCallId });
  }, [logCallTiming]);

  const resolveNativeCallVoiceEffect = useCallback(async () => {
    if (route.params.mode === 'video') {
      nativeCallVoiceEffectIdRef.current = DEFAULT_VOICE_EFFECT_ID;
      setNativeLiveVoiceEffect(DEFAULT_VOICE_EFFECT_ID);
      return DEFAULT_VOICE_EFFECT_ID;
    }

    const resolvedEffectId = route.params.mode === 'voice'
      ? nativeCallVoiceEffectId
      : DEFAULT_VOICE_EFFECT_ID;

    nativeCallVoiceEffectIdRef.current = resolvedEffectId;
    await setNativeLiveVoiceEffectAndWait(resolvedEffectId);
    return resolvedEffectId;
  }, [nativeCallVoiceEffectId, route.params.mode]);

  const prepareLiveKitConnection = useCallback(async (
    nextCallId: string,
    options?: {
      callKitAudioManaged?: boolean;
      permissionsAlreadyGranted?: boolean;
      skipAudioPreparation?: boolean;
      skipPermissionsCheck?: boolean;
    },
  ) => {
    if (!serverUrl) {
      throw new Error(t('couldNotStartCall'));
    }

    if (preparedConnectPromiseRef.current && preparedConnectCallIdRef.current === nextCallId) {
      return preparedConnectPromiseRef.current;
    }

    const preparePromise = (async () => {
      if (!options?.permissionsAlreadyGranted && !options?.skipPermissionsCheck) {
        const hasPermissions = await ensureCallPermissions(route.params.mode);

        if (!hasPermissions) {
          throw new Error(
            route.params.mode === 'video'
              ? t('cameraMicrophonePermissionNeeded')
              : t('microphonePermissionNeeded'),
          );
        }
      }

      if (options?.permissionsAlreadyGranted || !options?.skipPermissionsCheck) {
        setHasCallPermissions(true);
      }

      const prefetched = prefetchedCallTokenRef.current?.callId === nextCallId
        ? prefetchedCallTokenRef.current
        : null;
      const tokenPromise = prefetched
        ? Promise.resolve({ token: prefetched.token, url: prefetched.url })
        : getCallToken(serverUrl, nextCallId);
      const responsePromise = tokenPromise;
      const prerequisites: Promise<unknown>[] = [
        responsePromise,
      ];

      if (options?.callKitAudioManaged) {
        prerequisites.push((async () => {
          await prepareCallKitManagedCallAudio(route.params.mode);
          await resolveNativeCallVoiceEffect();
        })());
      } else if (!options?.skipAudioPreparation) {
        prerequisites.push(resolveNativeCallVoiceEffect());
        prerequisites.push(prepareCallAudio(route.params.mode, canApplyCallAudioRoute));
      } else {
        prerequisites.push(resolveNativeCallVoiceEffect());
      }

      logCallTiming('connect-prepare-start', { nextCallId, prefetched: !!prefetched });
      const [response] = await Promise.all(prerequisites) as [{ token: string; url: string }, ...unknown[]];

      prefetchedCallTokenRef.current = { callId: nextCallId, token: response.token, url: response.url };
      logCallTiming('connect-prepare-ready', { nextCallId });
      return response;
    })();

    preparedConnectCallIdRef.current = nextCallId;
    preparedConnectPromiseRef.current = preparePromise;

    try {
      return await preparePromise;
    } finally {
      if (preparedConnectPromiseRef.current === preparePromise) {
        preparedConnectPromiseRef.current = null;
        preparedConnectCallIdRef.current = null;
      }
    }
  }, [canApplyCallAudioRoute, logCallTiming, resolveNativeCallVoiceEffect, route.params.mode, serverUrl]);

  const connectLiveKit = useCallback(async (
    nextCallId: string,
    options?: ConnectLiveKitOptions,
  ) => {
    if (!serverUrl || !isLiveKitRoomEnabledRef.current || isEndingCallRef.current) {
      return;
    }

    if (liveKitToken) {
      logCallScreenDebug('livekit-connect-skip-token-present', { nextCallId });
      if (options?.callKitAudioManaged || !options?.skipAudioPreparation) {
        try {
          await prepareLiveKitConnection(nextCallId, options);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : t('couldNotStartCall'));
        }
      }
      return;
    }

    if (activeConnectPromiseRef.current && activeConnectCallIdRef.current === nextCallId) {
      logCallScreenDebug('livekit-connect-await-existing', { nextCallId });
      await activeConnectPromiseRef.current;

      if (!isLiveKitRoomEnabledRef.current || isEndingCallRef.current) {
        return;
      }

      if (options?.callKitAudioManaged || !options?.skipAudioPreparation) {
        try {
          await prepareLiveKitConnection(nextCallId, options);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : t('couldNotStartCall'));
        }
      }
      return;
    }

    const connectPromise = (async () => {
      setLiveKitStarting(true);
      logCallTiming('livekit-connect-start', {
        keepIncomingRingtone: options?.keepIncomingRingtone === true,
        prejoin: options?.skipPermissionsCheck === true,
      });
      if (!options?.keepIncomingRingtone) {
        setRingtoneEnabled(false);
        stopRingtone();
      }
      if (!options?.keepOutgoingRingback) {
        stopOutgoingRingback();
      }
      if (!options?.preserveStatus) {
        outgoingStatusPhaseRef.current = 'connecting';
        setStatus(t('connecting'));
      }

      try {
        const response = await prepareLiveKitConnection(nextCallId, options);

        if (!isLiveKitRoomEnabledRef.current || isEndingCallRef.current) {
          logCallTiming('livekit-credentials-ignored-after-teardown', { nextCallId });
          return;
        }

        setLiveKitUrl(response.url);
        setLiveKitToken(response.token);
        logCallTiming('livekit-credentials-applied', { nextCallId });
      } catch (error) {
        setLiveKitStarting(false);
        if (!options?.silent) {
          setStatus(error instanceof Error ? error.message : t('couldNotStartCall'));
        }
        logCallTiming('livekit-connect-failed', {
          message: error instanceof Error ? error.message : 'unknown',
          nextCallId,
        });
        throw error;
      }
    })();

    activeConnectCallIdRef.current = nextCallId;
    activeConnectPromiseRef.current = connectPromise;

    try {
      await connectPromise;
    } finally {
      if (activeConnectPromiseRef.current === connectPromise) {
        activeConnectPromiseRef.current = null;
        activeConnectCallIdRef.current = null;
      }
    }
  }, [liveKitToken, logCallScreenDebug, logCallTiming, prepareLiveKitConnection, serverUrl, stopOutgoingRingback, stopRingtone]);

  // FIX 3: Enhanced connection with retry logic
  const connectLiveKitWithRetry = useCallback(async (
    nextCallId: string,
    options?: ConnectLiveKitOptions,
    retryCount = 0
  ): Promise<void> => {
    const maxRetries = 3;
    const baseDelay = 1000;

    try {
      await connectLiveKit(nextCallId, options);
    } catch (error) {
      if (retryCount < maxRetries) {
        const retryDelayMs = baseDelay * Math.pow(2, retryCount);
        logCallTiming('livekit-connect-retry', { nextCallId, retryCount: retryCount + 1, retryDelayMs });
        await delay(retryDelayMs);
        if (options?.callKitAudioManaged) {
          await prepareCallKitManagedCallAudio(route.params.mode).catch(() => undefined);
        } else if (options?.skipAudioPreparation) {
          await prepareCallAudio(route.params.mode, canApplyCallAudioRoute).catch(() => undefined);
        }
        return connectLiveKitWithRetry(nextCallId, options, retryCount + 1);
      }
      throw error;
    }
  }, [canApplyCallAudioRoute, connectLiveKit, logCallTiming, route.params.mode]);

  const startRingtone = useCallback(async () => {
    if (route.params.direction !== 'incoming' || !isIncomingPending) {
      stopRingtone();
      return;
    }

    if (Platform.OS === 'android') {
      startNativeIncomingRingtone();
      return;
    }

    if (ringtoneRef.current) {
      return;
    }

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const player = createAudioPlayer(RINGTONE);
      player.loop = true;
      player.volume = 0.72;
      ringtoneRef.current = player;
      player.play();
    } catch {
      ringtoneRef.current?.remove();
      ringtoneRef.current = null;
      setRingtoneEnabled(false);
    }
  }, [isIncomingPending, route.params.direction, stopRingtone]);

  const startOutgoingRingback = useCallback(async () => {
    stopRingtone();

    if (outgoingRingbackNativeActiveRef.current || outgoingRingbackRef.current) {
      return;
    }

    const generation = outgoingRingbackGenerationRef.current + 1;
    outgoingRingbackGenerationRef.current = generation;

    try {
      const ringbackUri = Platform.OS === 'android'
        ? ''
        : await Asset.loadAsync(OUTGOING_RINGBACK)
          .then(([ringbackAsset]) => ringbackAsset.localUri ?? ringbackAsset.uri);

      if (outgoingRingbackGenerationRef.current !== generation) {
        return;
      }

      const nativeStarted = await startNativeOutgoingRingback(ringbackUri, route.params.mode);

      if (outgoingRingbackGenerationRef.current !== generation) {
        if (nativeStarted) {
          stopNativeOutgoingRingback();
        }
        return;
      }

      if (nativeStarted) {
        outgoingRingbackNativeActiveRef.current = true;
        return;
      }

      // Native playback is unavailable in an older development build. Keep a
      // routed Expo player fallback until that binary is rebuilt.
      await restoreCallAudio(route.params.mode, route.params.mode === 'video', canApplyCallAudioRoute)
        .catch(() => undefined);

      if (outgoingRingbackGenerationRef.current !== generation || outgoingRingbackRef.current) {
        return;
      }

      const player = createAudioPlayer(OUTGOING_RINGBACK, {
        keepAudioSessionActive: true,
        updateInterval: 250,
      });
      player.loop = false;
      player.volume = 0.62;
      outgoingRingbackRef.current = player;
      let nextReplayAt = 0;

      const resumeOutgoingRingback = async () => {
        if (
          outgoingRingbackGenerationRef.current !== generation ||
          outgoingRingbackRef.current !== player
        ) {
          return;
        }

        const playbackStatus = player.currentStatus;
        const reachedEnd = playbackStatus.didJustFinish ||
          (
            playbackStatus.duration > 0 &&
            playbackStatus.currentTime >= playbackStatus.duration - 0.08
          );

        try {
          if (reachedEnd) {
            if (nextReplayAt === 0) {
              nextReplayAt = Date.now() + 1_000;
            }
            if (Date.now() < nextReplayAt) {
              return;
            }

            await player.seekTo(0);
            nextReplayAt = 0;
          }

          if (
            outgoingRingbackGenerationRef.current === generation &&
            outgoingRingbackRef.current === player &&
            !player.currentStatus.playing
          ) {
            await restoreCallAudio(route.params.mode, route.params.mode === 'video', canApplyCallAudioRoute)
              .catch(() => undefined);

            if (
              outgoingRingbackGenerationRef.current !== generation ||
              outgoingRingbackRef.current !== player
            ) {
              return;
            }

            player.loop = false;
            player.play();
          }
        } catch {
          // The next watchdog pass retries after temporary call-audio-session interruptions.
        }
      };

      const scheduleOutgoingRingbackWatchdog = () => {
        if (
          outgoingRingbackGenerationRef.current !== generation ||
          outgoingRingbackRef.current !== player
        ) {
          return;
        }

        if (outgoingRingbackLoopTimeoutRef.current) {
          clearTimeout(outgoingRingbackLoopTimeoutRef.current);
        }

        const nextCheckDelay = nextReplayAt > Date.now()
          ? Math.max(80, nextReplayAt - Date.now())
          : 500;

        outgoingRingbackLoopTimeoutRef.current = setTimeout(() => {
          outgoingRingbackLoopTimeoutRef.current = null;
          void resumeOutgoingRingback().finally(scheduleOutgoingRingbackWatchdog);
        }, nextCheckDelay);
      };

      outgoingRingbackSubscriptionRef.current = player.addListener('playbackStatusUpdate', (playbackStatus) => {
        const didStopAtEnd = !playbackStatus.playing &&
          (
            playbackStatus.didJustFinish ||
            playbackStatus.duration > 0 &&
            playbackStatus.currentTime >= playbackStatus.duration - 0.08
          );

        if (
          !didStopAtEnd ||
          outgoingRingbackGenerationRef.current !== generation ||
          outgoingRingbackRef.current !== player ||
          outgoingRingbackLoopTimeoutRef.current
        ) {
          return;
        }

        nextReplayAt = Date.now() + 1_000;
        outgoingRingbackLoopTimeoutRef.current = setTimeout(() => {
          outgoingRingbackLoopTimeoutRef.current = null;
          void resumeOutgoingRingback().finally(scheduleOutgoingRingbackWatchdog);
        }, 1_000);
      });

      player.play();
      scheduleOutgoingRingbackWatchdog();
    } catch {
      stopOutgoingRingback();
    }
  }, [canApplyCallAudioRoute, route.params.mode, stopOutgoingRingback, stopRingtone]);

  const answerIncomingCall = useCallback(async () => {
    if (!serverUrl || !callId) {
      return;
    }

    if (isAnsweringCallRef.current) {
      return;
    }

    try {
      isAnsweringCallRef.current = true;
      logCallTiming('answer-tap');
      let hasAnsweredOnServer = false;

      const answerCallOnServer = async () => {
        if (hasAnsweredOnServer) {
          return;
        }

        logCallTiming('answer-api-start');

        try {
          const response = await answerCall(serverUrl, callId, {
            answerClientId: getMobileCallAnswerClientId(),
            answerSurface: 'mobile',
          });
          logCallTiming('answer-api-ready');
          recordCall(callId, 'incoming');
          cacheCallToken(callId, response.livekit);
          hasAnsweredOnServer = true;
        } catch (error) {
          const canRecoverStaleNativeAnswer = Platform.OS === 'ios' &&
            route.params.answeredByNative === true &&
            error instanceof ApiError &&
            error.status === 404;

          if (!canRecoverStaleNativeAnswer) {
            throw error;
          }

          logCallTiming('answer-api-not-found-token-recovery-start');
          const tokenResponse = await getCallToken(serverUrl, callId);
          logCallTiming('answer-api-not-found-token-recovery-ready');
          cacheCallToken(callId, {
            token: tokenResponse.token,
            url: tokenResponse.url,
          });
          recordCall(callId, 'incoming');
          hasAnsweredOnServer = true;
        }
      };

      const preansweredServerPromise = route.params.answeredByNative === true
        ? answerCallOnServer()
        : null;

      const hasPermissions = await ensureCallPermissions(route.params.mode);

      if (!hasPermissions) {
        preansweredServerPromise?.catch(() => undefined);
        setStatus(route.params.mode === 'video'
          ? t('cameraMicrophonePermissionNeeded')
          : t('microphonePermissionNeeded'));
        return;
      }

      setHasCallPermissions(true);
      isCallAcceptedRef.current = true;
      isIncomingPendingRef.current = false;
      setCallAccepted(true);
      setIncomingPending(false);
      setRingtoneEnabled(false);
      setStatus(t('connecting'));
      stopRingtone();
      markParticipantAnswered(user?.id);

      const callKitAnswerPromise = route.params.answeredByNative === true
        ? Promise.resolve(false)
        : answerNativeIncomingCallKitCall(callId).catch(() => false);
      const shouldAwaitAudioPreparation = route.params.answeredByNative !== true;
      const audioPreparationPromise = shouldAwaitAudioPreparation
        ? (async () => {
            const answeredByCallKit = route.params.answeredByNative === true || await callKitAnswerPromise;
            if (answeredByCallKit && Platform.OS === 'ios') {
              await prepareCallKitManagedCallAudio(route.params.mode);
              return;
            }
            await prepareCallAudio(route.params.mode, canApplyCallAudioRoute);
          })().catch(() => undefined)
        : Promise.resolve(undefined);

      if (route.params.answeredByNative === true) {
        isInitialNativeCallAudioPreparationPendingRef.current = false;
      }

      if (preansweredServerPromise) {
        await preansweredServerPromise;
      } else {
        await answerCallOnServer();
      }

      if (shouldAwaitAudioPreparation && route.params.mode !== 'video') {
        await audioPreparationPromise;
      }

      await connectLiveKitWithRetry(callId, {
        callKitAudioManaged: isCallKitAudioManagedCall,
        permissionsAlreadyGranted: true,
        skipAudioPreparation: true,
      });

      if (shouldAwaitAudioPreparation && route.params.mode === 'video') {
        void audioPreparationPromise;
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t('couldNotStartCall'));
    } finally {
      if (!route.params.answeredByNative) {
        isInitialNativeCallAudioPreparationPendingRef.current = false;
      }
      isAnsweringCallRef.current = false;
    }
  }, [cacheCallToken, callId, canApplyCallAudioRoute, connectLiveKitWithRetry, isCallKitAudioManagedCall, logCallTiming, markParticipantAnswered, recordCall, route.params.answeredByNative, route.params.mode, serverUrl, stopRingtone, user?.id]);

  useEffect(() => {
    if (
      hasAutoAnsweredNativeCallRef.current ||
      route.params.direction !== 'incoming' ||
      route.params.answeredByNative !== true ||
      !serverUrl ||
      !callId
    ) {
      return;
    }

    hasAutoAnsweredNativeCallRef.current = true;
    void answerIncomingCall();
  }, [answerIncomingCall, callId, route.params.answeredByNative, route.params.direction, serverUrl]);

  useEffect(() => {
    let isMounted = true;

    async function setupCall() {
      if (!serverUrl) {
        return;
      }

      if (hasStartedCallSetupRef.current) {
        return;
      }

      hasStartedCallSetupRef.current = true;

      try {
        if (route.params.direction === 'incoming' && route.params.callId) {
          logCallScreenDebug('setup-incoming', {
            answeredByNative: route.params.answeredByNative === true,
            resumeActiveCall: route.params.resumeActiveCall === true,
          });
          setCallId(route.params.callId);

          if (route.params.answeredByNative === true) {
            const hasPermissions = await ensureCallPermissions(route.params.mode);

            if (isMounted) {
              setHasCallPermissions(hasPermissions);
            }

            if (!hasPermissions) {
              if (isMounted) {
                setStatus(route.params.mode === 'video'
                  ? t('cameraMicrophonePermissionNeeded')
                  : t('microphonePermissionNeeded'));
              }
              return;
            }

            void prefetchCallToken(route.params.callId).catch(() => undefined);

            void connectLiveKitWithRetry(route.params.callId, {
              permissionsAlreadyGranted: true,
              preserveStatus: true,
              skipAudioPreparation: true,
              silent: true,
              keepIncomingRingtone: true,
            }).catch(() => undefined);

            return;
          }

          if (route.params.resumeActiveCall) {
            const hasPermissions = await ensureCallPermissions(route.params.mode);

            if (!hasPermissions) {
              if (isMounted) {
                setStatus(route.params.mode === 'video'
                  ? t('cameraMicrophonePermissionNeeded')
                  : t('microphonePermissionNeeded'));
              }
              return;
            }

            if (isMounted) {
              setHasCallPermissions(true);
              setCallAccepted(true);
              setIncomingPending(false);
              setRingtoneEnabled(false);
              setStatus(t('connecting'));
            }
            void prepareLiveKitConnection(route.params.callId, { permissionsAlreadyGranted: true }).catch(() => undefined);
            void connectLiveKitWithRetry(route.params.callId, { permissionsAlreadyGranted: true, preserveStatus: true }).catch(() => undefined);
            return;
          }
          void prefetchCallToken(route.params.callId);
          if (route.params.mode === 'voice') {
            void getRecordingPermissionsAsync()
              .then((permission) => {
                if (isMounted && permission.granted) {
                  setHasCallPermissions(true);
                }
              })
              .catch(() => undefined);
          }
          if (route.params.mode === 'video' && Platform.OS === 'android') {
            // On iOS, the pre-answer WebRTC session can interrupt the foreground ringtone.
            // Keep iOS ringing stable, then join LiveKit from the normal answer path.
            logCallTiming('incoming-prejoin-start');
            void connectLiveKitWithRetry(route.params.callId, {
              keepIncomingRingtone: true,
              preserveStatus: true,
              silent: true,
              skipAudioPreparation: true,
              skipPermissionsCheck: true,
            }).catch(() => undefined);
          }
          return;
        }

        if (route.params.direction === 'outgoing' && route.params.callId && route.params.resumeActiveCall) {
          logCallScreenDebug('setup-outgoing-resume');
          setCallId(route.params.callId);
          const hasPermissions = await ensureCallPermissions(route.params.mode);

          if (!hasPermissions) {
            if (isMounted) {
              setStatus(route.params.mode === 'video'
                ? t('cameraMicrophonePermissionNeeded')
                : t('microphonePermissionNeeded'));
            }
            return;
          }

          if (isMounted) {
            setHasCallPermissions(true);
            setCallAccepted(true);
            setIncomingPending(false);
            setRingtoneEnabled(false);
            setStatus(t('connecting'));
          }
          void prepareLiveKitConnection(route.params.callId, { permissionsAlreadyGranted: true }).catch(() => undefined);
          void connectLiveKitWithRetry(route.params.callId, { permissionsAlreadyGranted: true, preserveStatus: true }).catch(() => undefined);
          return;
        }

        if (route.params.conversationId && !route.params.callId) {
          logCallScreenDebug('setup-outgoing-new', {
            conversationId: route.params.conversationId,
            initialInviteeIds: route.params.initialInviteeIds,
          });
          const hasPermissions = await ensureCallPermissions(route.params.mode);

          if (!hasPermissions) {
            if (isMounted) {
              setStatus(route.params.mode === 'video'
                ? t('cameraMicrophonePermissionNeeded')
                : t('microphonePermissionNeeded'));
            }
            return;
          }

          if (isMounted) {
            setHasCallPermissions(true);
          }
          logCallTiming('create-call-start');
          const response = await createCall(serverUrl, route.params.conversationId, route.params.mode, route.params.initialInviteeIds);
          logCallTiming('create-call-ready', { hasLiveKitCredentials: !!response.livekit });
          const call = response.call;
          if (isMounted) {
            setCallId(call.id);
            outgoingStatusPhaseRef.current = 'dialing';
            setStatus(t('calling'));
            recordCall(call.id, 'outgoing');
            cacheCallToken(call.id, response.livekit);
            void prepareLiveKitConnection(call.id, {
              permissionsAlreadyGranted: true,
              skipAudioPreparation: true,
            }).catch(() => undefined);
            logCallTiming('outgoing-prejoin-start');
            void connectLiveKitWithRetry(call.id, {
              keepOutgoingRingback: true,
              permissionsAlreadyGranted: true,
              preserveStatus: true,
              skipAudioPreparation: true,
            }).catch(() => undefined);
          }
        }
      } catch (error) {
        if (isMounted) {
          setStatus(error instanceof Error ? error.message : t('couldNotStartCall'));
        }
      }
    }

    void setupCall();

    return () => {
      isMounted = false;
    };
  }, [cacheCallToken, connectLiveKitWithRetry, logCallScreenDebug, logCallTiming, prepareLiveKitConnection, prefetchCallToken, recordCall, route.params.answeredByNative, route.params.callId, route.params.conversationId, route.params.direction, route.params.initialInviteeIds, route.params.mode, route.params.resumeActiveCall, serverUrl]);

  useEffect(() => {
    if (route.params.mode !== 'video') {
      return undefined;
    }

    void activateKeepAwakeAsync(VIDEO_CALL_KEEP_AWAKE_TAG).catch(() => undefined);

    return () => {
      void deactivateKeepAwake(VIDEO_CALL_KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [route.params.mode]);

  useEffect(() => {
    if (!isCallAccepted || isIncomingPending || !hasCallPermissions) {
      return;
    }

    if (isInitialNativeCallAudioPreparationPendingRef.current) {
      return;
    }

    if (Platform.OS === 'ios' && route.params.answeredByNative) {
      void prepareCallKitManagedCallAudio(route.params.mode).catch(() => undefined);
      return;
    }

    void prepareCallAudio(route.params.mode, canApplyCallAudioRoute).catch(() => undefined);
  }, [canApplyCallAudioRoute, hasCallPermissions, isCallAccepted, isIncomingPending, route.params.answeredByNative, route.params.mode]);

  useEffect(() => {
    const unsubscribeIncomingInvite = subscribeToCallEvent('incomingInvite', (payload) => {
      logCallScreenDebug('socket-incoming-invite-event', payload as Record<string, unknown>);

      if (
        payload.callId === callId ||
        !payload.conversationId ||
        (payload.mode !== 'VOICE' && payload.mode !== 'VIDEO')
      ) {
        return;
      }

      setWaitingIncomingCall((current) => {
        if (current?.callId === payload.callId) {
          return current;
        }

        return {
          callId: payload.callId,
          conversationId: payload.conversationId!,
          isGroupCall: payload.isGroupCall,
          mode: payload.mode!.toLowerCase() as 'voice' | 'video',
          participantNames: payload.participantNames,
          title: payload.fromDisplayName ?? t('incomingCallTitle'),
        };
      });
    });

    const unsubscribeRinging = subscribeToCallEvent('ringing', (payload) => {
      logCallScreenDebug('socket-ringing-event', payload as Record<string, unknown>);
      if (payload.callId === callId && route.params.direction === 'outgoing') {
        if (outgoingStatusPhaseRef.current === 'connecting' || outgoingStatusPhaseRef.current === 'connected' || outgoingStatusPhaseRef.current === 'ended') {
          return;
        }

        outgoingStatusPhaseRef.current = 'ringing';
        setStatus(t('ringing'));
      }
    });

    const unsubscribeAnswered = subscribeToCallEvent('answered', (payload) => {
      logCallScreenDebug('socket-answered-event', payload as Record<string, unknown>);
      if (payload.callId !== callId) {
        return;
      }

      markParticipantAnswered(payload.userId);
      logCallTiming('call-answered-event', { userId: payload.userId });

      if (payload.userId === user?.id) {
        const wasAnsweredOnThisClient = !!payload.answerClientId &&
          payload.answerClientId === getMobileCallAnswerClientId();
        const shouldDismissAnswerFromAnotherClient = route.params.direction === 'incoming' &&
          !isAnsweringCallRef.current &&
          (isIncomingPendingRef.current || !isCallAcceptedRef.current) &&
          (!payload.answerClientId || !wasAnsweredOnThisClient);

        if (shouldDismissAnswerFromAnotherClient) {
          isEndingCallRef.current = true;
          isCallAcceptedRef.current = false;
          isIncomingPendingRef.current = false;
          outgoingStatusPhaseRef.current = 'ended';
          setCallAccepted(false);
          setIncomingPending(false);
          setRingtoneEnabled(false);
          setStatus(t('answered'));
          stopRingtone();
          stopOutgoingRingback();
          endIosCallKitCall(callId);
          cancelNativeAndroidIncomingCall(callId);
          setActiveCallSession(null);
          setSystemPictureInPictureLayout(false);
          setPictureInPictureLayout(false);
          setCallPictureInPictureEnabled(false);
          setNativeProximityScreenOffEnabled(false);
          stopNativeCallService(nativeCallSessionIdRef.current);
          void closeCallPictureInPicture();
          closeCallScreenOnce();
          return;
        }

        if (isCallAcceptedRef.current && !isIncomingPendingRef.current) {
          stopRingtone();
          stopOutgoingRingback();
          return;
        }

        isCallAcceptedRef.current = true;
        isIncomingPendingRef.current = false;
        setCallAccepted(true);
        outgoingStatusPhaseRef.current = 'connecting';
        setIncomingPending(false);
        setRingtoneEnabled(false);
        setStatus(t('connecting'));
        stopRingtone();
        stopOutgoingRingback();
        void prepareCallAudio(route.params.mode, canApplyCallAudioRoute).catch(() => undefined);
        void connectLiveKitWithRetry(payload.callId, { permissionsAlreadyGranted: true, skipAudioPreparation: true });
        return;
      }

      if (route.params.direction === 'outgoing') {
        isCallAcceptedRef.current = true;
        isIncomingPendingRef.current = false;
        setCallAccepted(true);
        outgoingStatusPhaseRef.current = 'connecting';
        setIncomingPending(false);
        setRingtoneEnabled(false);
        setStatus(t('connecting'));
        stopRingtone();
        stopOutgoingRingback();
        void prepareCallAudio(route.params.mode, canApplyCallAudioRoute).catch(() => undefined);
        void connectLiveKitWithRetry(payload.callId, { permissionsAlreadyGranted: true, skipAudioPreparation: true });
      }
    });

    const unsubscribeEnded = subscribeToCallEvent('ended', (payload) => {
      logCallScreenDebug('socket-ended-event', payload as Record<string, unknown>);
      if (payload.callId === callId) {
        if (peerConnectionProblemTimeoutRef.current) {
          clearTimeout(peerConnectionProblemTimeoutRef.current);
          peerConnectionProblemTimeoutRef.current = null;
        }
        setLocalConnectionIssueSince(null);
        setPeerConnectionIssueSince(null);
        setConnectionProblemNotice(null);
      }

      if (waitingIncomingCall?.callId === payload.callId) {
        setWaitingIncomingCall(null);
        void recordCallLog({
          conversationId: waitingIncomingCall.conversationId,
          direction: 'incoming',
          id: waitingIncomingCall.callId,
          mode: waitingIncomingCall.mode,
          status: 'missed',
          title: waitingIncomingCall.title,
        });
        return;
      }

      if (payload.callId === callId) {
        invalidatePendingCallAudioRouteOperations();
        stopLiveKitRoom();

        if (isEndingCallRef.current) {
          outgoingStatusPhaseRef.current = 'ended';
          stopRingtone();
          stopOutgoingRingback();
          setSystemPictureInPictureLayout(false);
          setPictureInPictureLayout(false);
          setCallPictureInPictureEnabled(false);
          stopNativeCallService(nativeCallSessionIdRef.current);
          void closeCallPictureInPicture().finally(() => {
            closeCallScreenOnce();
          });
          return;
        }

        outgoingStatusPhaseRef.current = 'ended';
        if (!connectedAt) {
          recordCall(callId, route.params.direction === 'incoming' ? 'incoming' : 'outgoing', getCallLogStatusFromCallStatus(payload.callStatus));
        }
        endIosCallKitCall(callId);
        stopRingtone();
        stopOutgoingRingback();
        isEndingCallRef.current = true;
        setActiveCallSession(null);
        setSystemPictureInPictureLayout(false);
        setPictureInPictureLayout(false);
        setCallPictureInPictureEnabled(false);
        stopNativeCallService(nativeCallSessionIdRef.current);
        void closeCallPictureInPicture().finally(() => {
          closeCallScreenOnce();
        });
      }
    });

    return () => {
      unsubscribeIncomingInvite();
      unsubscribeRinging();
      unsubscribeAnswered();
      unsubscribeEnded();
    };
  }, [callId, canApplyCallAudioRoute, closeCallScreenOnce, connectLiveKitWithRetry, connectedAt, logCallScreenDebug, logCallTiming, markParticipantAnswered, recordCall, recordCallLog, route.params.direction, route.params.mode, stopLiveKitRoom, stopOutgoingRingback, stopRingtone, user?.id, waitingIncomingCall]);

  useEffect(() => {
    const shouldRing = route.params.direction === 'incoming' &&
      isRingtoneEnabled &&
      isIncomingPending;

    if (shouldRing) {
      void startRingtone();
    } else {
      stopRingtone();
    }
  }, [isIncomingPending, isRingtoneEnabled, route.params.direction, startRingtone, status, stopRingtone]);

  useEffect(() => {
    if (route.params.direction !== 'incoming') {
      return;
    }

    cancelNativeAndroidIncomingCall(callId ?? route.params.callId);
  }, [callId, route.params.callId, route.params.direction]);

  useEffect(() => {
    const shouldPlayOutgoingRingback = route.params.direction === 'outgoing' &&
      !!callId &&
      !isCallAccepted;

    if (shouldPlayOutgoingRingback) {
      void startOutgoingRingback();
    } else {
      stopOutgoingRingback();
    }
  }, [
    callId,
    isCallAccepted,
    route.params.direction,
    startOutgoingRingback,
    stopOutgoingRingback,
  ]);

  const refreshCallAudioRoutes = useCallback(async () => {
    if (isEndingCallRef.current || !isLiveKitRoomEnabledRef.current) {
      return;
    }

    const routes = await getNativeCallAudioRoutes();

    if (isEndingCallRef.current || !isLiveKitRoomEnabledRef.current) {
      return;
    }

    const activeRoute = routes.find((item) => item.isActive);
    const preferredExternalRoute = routes.find((item) => item.type === 'bluetooth') ??
      routes.find((item) => item.type === 'wired');
    const explicitExternalRoute = hasExplicitCallAudioRouteSelection &&
      explicitCallAudioRoute &&
      (explicitCallAudioRoute.type === 'bluetooth' || explicitCallAudioRoute.type === 'wired')
      ? routes.find((item) => item.id === explicitCallAudioRoute?.id)
      : undefined;
    const shouldAutoRestoreExternalRoute = route.params.mode === 'video';
    const externalRouteToRestore = explicitExternalRoute ??
      (!hasExplicitCallAudioRouteSelection && shouldAutoRestoreExternalRoute ? preferredExternalRoute : undefined);
    const isExternalRouteAlreadyActive = explicitExternalRoute
      ? activeRoute?.id === explicitExternalRoute.id
      : activeRoute?.type === 'bluetooth' || activeRoute?.type === 'wired';

    setCallAudioRoutes(routes);

    if (
      isCallAccepted &&
      !isIncomingPending &&
      !isAutoSelectingCallAudioRouteRef.current &&
      !requestedCallAudioRouteIdRef.current &&
      externalRouteToRestore &&
      !isExternalRouteAlreadyActive
    ) {
      isAutoSelectingCallAudioRouteRef.current = true;
      void selectExplicitCallAudioRoute(externalRouteToRestore, callAudioRouteSelectionVersion, undefined, canApplyCallAudioRoute)
        .then(setCallAudioRoutes)
        .finally(() => {
          isAutoSelectingCallAudioRouteRef.current = false;
        });
    }
  }, [canApplyCallAudioRoute, isCallAccepted, isIncomingPending, route.params.mode]);

  useEffect(() => {
    void refreshCallAudioRoutes();
    const intervalId = setInterval(() => void refreshCallAudioRoutes(), 1200);
    return () => clearInterval(intervalId);
  }, [refreshCallAudioRoutes]);

  const selectCallAudioRoute = useCallback(async (audioRoute: CallAudioRoute) => {
    hasExplicitCallAudioRouteSelection = true;
    explicitCallAudioRoute = audioRoute;
    const selectionVersion = ++callAudioRouteSelectionVersion;
    requestedCallAudioRouteIdRef.current = audioRoute.id;
    setCallAudioRoutePickerOpen(false);

    try {
      const routes = await selectExplicitCallAudioRoute(audioRoute, selectionVersion, undefined, canApplyCallAudioRoute);
      const activeRoute = routes.find((item) => item.isActive);

      setCallAudioRoutes(routes);
      if (activeRoute?.type === 'speaker' || activeRoute?.type === 'earpiece') {
        setSpeakerOn(activeRoute.type === 'speaker');
      }
    } finally {
      requestedCallAudioRouteIdRef.current = null;
      await refreshCallAudioRoutes();
    }
  }, [canApplyCallAudioRoute, refreshCallAudioRoutes]);

  const toggleCallSpeaker = useCallback(async () => {
    const activeRoute = callAudioRoutes.find((item) => item.isActive);
    const nextRoute = activeRoute?.type === 'speaker'
      ? findPreferredNonSpeakerRoute(callAudioRoutes)
      : callAudioRoutes.find((item) => item.type === 'speaker');

    if (nextRoute) {
      await selectCallAudioRoute(nextRoute);
      return;
    }

    const nextSpeaker = !isSpeakerOn;
    setSpeakerOn(nextSpeaker);
    await forceCallAudioRoute(nextSpeaker, false, undefined, canApplyCallAudioRoute).catch(() => setSpeakerOn(!nextSpeaker));
  }, [callAudioRoutes, canApplyCallAudioRoute, isSpeakerOn, selectCallAudioRoute]);

  const showCallAudioRoutePicker = useCallback(() => {
    void getNativeCallAudioRoutes().then((routes) => {
      setCallAudioRoutes(routes);
      setCallAudioRoutePickerOpen(true);
    });
  }, []);

  useEffect(() => {
    if (!isAddPeopleOpen) {
      return;
    }

    void Promise.all([
      loadContacts(),
      loadConversations(),
    ]).catch(() => undefined);
  }, [isAddPeopleOpen, loadContacts, loadConversations]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedPeopleSearch(peopleSearch.trim());
    }, 350);

    return () => clearTimeout(timeout);
  }, [peopleSearch]);

  useEffect(() => () => {
    // FIX 1: Comprehensive cleanup on unmount
    isLiveKitRoomEnabledRef.current = false;
    liveKitDisconnectRef.current = null;
    cleanupAudioResources({
      ringtoneRef,
      outgoingRingbackRef,
      outgoingRingbackNativeActiveRef,
      ringbackTimeoutRef: outgoingRingbackLoopTimeoutRef,
      ringbackSubscriptionRef: outgoingRingbackSubscriptionRef,
      ringbackGenerationRef: outgoingRingbackGenerationRef,
    });
    stopLocalCameraPreview();

    if (getActiveCallSession()?.callId === currentCallIdRef.current) {
      setActiveCallSession(null);
    }
    invalidatePendingCallAudioRouteOperations();
    setCallPictureInPictureEnabled(false);
    setNativeProximityScreenOffEnabled(false);
    stopNativeCallService(nativeCallSessionIdRef.current);
    void AudioSession.stopAudioSession().catch(() => undefined);
  }, [stopLocalCameraPreview]);

  useEffect(() => {
    if (localPreviewVideoTrackRef.current && !liveKitToken) {
      stopLocalCameraPreview();
    }
  }, [liveKitToken, stopLocalCameraPreview]);

  useEffect(() => {
    setNativeLiveVoiceEffect(nativeCallVoiceEffectId);

    return () => {
      if (Platform.OS === 'ios') {
        setNativeLiveVoiceEffect(DEFAULT_VOICE_EFFECT_ID);
      }
    };
  }, [nativeCallVoiceEffectId]);

  useEffect(() => {
    if (!liveKitToken || !liveKitUrl || !isCallAccepted) {
      return;
    }

    setNativeLiveVoiceEffect(nativeCallVoiceEffectId);
    const retryTimers = [250, 500, 1000].map((waitMs) => (
      setTimeout(() => setNativeLiveVoiceEffect(nativeCallVoiceEffectId), waitMs)
    ));
    const nativeCallSessionId = nativeCallSessionIdRef.current;

    startNativeCallService(route.params.mode, nativeCallSessionId, nativeCallVoiceEffectId);
    setCallPictureInPictureEnabled(true);

    return () => {
      retryTimers.forEach(clearTimeout);
      setCallPictureInPictureEnabled(false);
      stopNativeCallService(nativeCallSessionId);
      if (Platform.OS === 'ios') {
        setNativeLiveVoiceEffect(DEFAULT_VOICE_EFFECT_ID);
      }
    };
  }, [isCallAccepted, liveKitToken, liveKitUrl, nativeCallVoiceEffectId, route.params.mode]);

  useEffect(() => {
    if (!liveKitToken || !liveKitUrl) {
      return;
    }

    logCallScreenDebug('livekit-room-mounted-inputs', {
      keySuffix: liveKitToken.slice(-16),
      serverUrl: liveKitUrl,
    });
  }, [liveKitToken, liveKitUrl, logCallScreenDebug]);

  // FIX 4: Better network state handling
  useEffect(() => {
    if (!liveKitToken || !isCallAccepted) {
      return undefined;
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      logCallScreenDebug('app-state-change', {
        nextState,
        pictureInPicture: isPictureInPictureLayout,
        systemPictureInPicture: isSystemPictureInPictureLayout,
      });

      if (nextState === 'background' || nextState === 'inactive') {
        if (Platform.OS === 'ios' && route.params.mode === 'video') {
          setSystemPictureInPictureLayout(false);
          setPictureInPictureLayout(false);
        } else if (Platform.OS === 'android') {
          setSystemPictureInPictureLayout(true);
          setPictureInPictureLayout(false);
          setLocalConnectionIssueSince(null);
          setPeerConnectionIssueSince(null);
          setConnectionProblemNotice(null);
          if (enterPictureInPictureTimerRef.current) {
            clearTimeout(enterPictureInPictureTimerRef.current);
            enterPictureInPictureTimerRef.current = null;
          }
        } else {
          setSystemPictureInPictureLayout(false);
          setPictureInPictureLayout(true);
          if (enterPictureInPictureTimerRef.current) {
            clearTimeout(enterPictureInPictureTimerRef.current);
          }
          enterPictureInPictureTimerRef.current = setTimeout(() => {
            void enterCallPictureInPicture();
            enterPictureInPictureTimerRef.current = null;
          }, 120);
        }
      } else if (nextState === 'active') {
        if (enterPictureInPictureTimerRef.current) {
          clearTimeout(enterPictureInPictureTimerRef.current);
          enterPictureInPictureTimerRef.current = null;
        }
        setSystemPictureInPictureLayout(false);
        setPictureInPictureLayout(false);

        setLocalConnectionIssueSince(null);
        setPeerConnectionIssueSince(null);
      }
    });

    return () => {
      if (enterPictureInPictureTimerRef.current) {
        clearTimeout(enterPictureInPictureTimerRef.current);
        enterPictureInPictureTimerRef.current = null;
      }
      subscription.remove();
    };
  }, [isCallAccepted, isPictureInPictureLayout, isSystemPictureInPictureLayout, liveKitToken, logCallScreenDebug, route.params.mode]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (!callId) {
        return;
      }

      if (enterPictureInPictureTimerRef.current) {
        clearTimeout(enterPictureInPictureTimerRef.current);
        enterPictureInPictureTimerRef.current = null;
      }

      setSystemPictureInPictureLayout(false);
      setPictureInPictureLayout(false);
      void closeCallPictureInPicture();
    });

    return unsubscribe;
  }, [callId, navigation]);

  // FIX 4: Connection loss detection with network quality monitoring
  const beginLocalConnectionProblem = useCallback(() => {
    if (isEndingCallRef.current) {
      return;
    }

    setLocalConnectionIssueSince((current) => current ?? Date.now());
    setConnectionProblemNotice({
      message: t('yourConnectionUnstable'),
      title: t('reconnectingCall'),
    });
    setStatus(t('reconnecting'));
  }, []);

  const canShowConnectionProblem = useCallback(() => (
    !!connectedAt || (isCallAcceptedRef.current && remoteParticipantCount > 0)
  ), [connectedAt, remoteParticipantCount]);

  const clearPeerConnectionProblem = useCallback(() => {
    if (peerConnectionProblemTimeoutRef.current) {
      clearTimeout(peerConnectionProblemTimeoutRef.current);
      peerConnectionProblemTimeoutRef.current = null;
    }

    setPeerConnectionIssueSince(null);
    setConnectionProblemNotice((current) => {
      if (current?.message === t('otherSideLostConnection')) {
        return null;
      }

      return current;
    });
  }, []);

  const schedulePeerConnectionProblem = useCallback(() => {
    if (isEndingCallRef.current || peerConnectionProblemTimeoutRef.current) {
      return;
    }

    peerConnectionProblemTimeoutRef.current = setTimeout(() => {
      peerConnectionProblemTimeoutRef.current = null;

      if (isEndingCallRef.current) {
        return;
      }

      setPeerConnectionIssueSince((current) => current ?? Date.now());
      setConnectionProblemNotice({
        message: t('otherSideLostConnection'),
        title: t('reconnectingCall'),
      });
    }, PEER_CONNECTION_NOTICE_GRACE_MS);
  }, []);

  const clearCallEndedStatusCheck = useCallback(() => {
    callEndedStatusCheckVersionRef.current += 1;

    if (callEndedStatusCheckTimeoutRef.current) {
      clearTimeout(callEndedStatusCheckTimeoutRef.current);
      callEndedStatusCheckTimeoutRef.current = null;
    }
  }, []);

  const closeEndedCallFromStatusCheck = useCallback((callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED') => {
    if (isEndingCallRef.current) {
      return;
    }

    clearCallEndedStatusCheck();
    invalidatePendingCallAudioRouteOperations();
    stopLiveKitRoom();
    outgoingStatusPhaseRef.current = 'ended';
    isEndingCallRef.current = true;
    setConnectedAt(null);
    setElapsedSeconds(0);
    setRemoteParticipantCount(0);
    setLocalConnectionIssueSince(null);
    setPeerConnectionIssueSince(null);
    setConnectionProblemNotice(null);
    setRingtoneEnabled(false);
    setStatus(t('callEnded'));

    if (callId && !connectedAt) {
      recordCall(callId, route.params.direction === 'incoming' ? 'incoming' : 'outgoing', getCallLogStatusFromCallStatus(callStatus));
    }

    endIosCallKitCall(callId);
    stopRingtone();
    stopOutgoingRingback();
    setActiveCallSession(null);
    setSystemPictureInPictureLayout(false);
    setPictureInPictureLayout(false);
    setCallPictureInPictureEnabled(false);
    setNativeProximityScreenOffEnabled(false);
    stopNativeCallService(nativeCallSessionIdRef.current);
    void closeCallPictureInPicture().finally(() => {
      closeCallScreenOnce();
    });
  }, [callId, clearCallEndedStatusCheck, closeCallScreenOnce, connectedAt, recordCall, route.params.direction, stopLiveKitRoom, stopOutgoingRingback, stopRingtone]);

  const scheduleCallEndedStatusCheck = useCallback(() => {
    if (!serverUrl || !callId || isEndingCallRef.current || callEndedStatusCheckTimeoutRef.current) {
      return;
    }

    const version = ++callEndedStatusCheckVersionRef.current;

    callEndedStatusCheckTimeoutRef.current = setTimeout(() => {
      callEndedStatusCheckTimeoutRef.current = null;

      if (isEndingCallRef.current || version !== callEndedStatusCheckVersionRef.current) {
        return;
      }

      void fetchCallStatus(serverUrl, callId)
        .then((response) => {
          if (
            isEndingCallRef.current ||
            version !== callEndedStatusCheckVersionRef.current ||
            response.call.id !== callId
          ) {
            return;
          }

          if (response.call.endedAt) {
            closeEndedCallFromStatusCheck(response.call.callStatus === 'RINGING' ? undefined : response.call.callStatus);
          }
        })
        .catch(() => undefined);
    }, PEER_CONNECTION_NOTICE_GRACE_MS + 350);
  }, [callId, closeEndedCallFromStatusCheck, serverUrl]);

  useEffect(() => () => {
    if (peerConnectionProblemTimeoutRef.current) {
      clearTimeout(peerConnectionProblemTimeoutRef.current);
      peerConnectionProblemTimeoutRef.current = null;
    }
    clearCallEndedStatusCheck();
  }, [clearCallEndedStatusCheck]);

  const revealVideoCallChrome = useCallback(() => {
    if (route.params.mode !== 'video') {
      return;
    }

    if (videoCallChromeTimerRef.current) {
      clearTimeout(videoCallChromeTimerRef.current);
      videoCallChromeTimerRef.current = null;
    }

    setVideoCallChromeVisible(true);
    videoCallChromeTimerRef.current = setTimeout(() => {
      videoCallChromeTimerRef.current = null;
      setVideoCallChromeVisible(false);
    }, VIDEO_CALL_CHROME_VISIBLE_MS);
  }, [route.params.mode]);

  useEffect(() => {
    if (route.params.mode !== 'video' || isIncomingPending) {
      if (videoCallChromeTimerRef.current) {
        clearTimeout(videoCallChromeTimerRef.current);
        videoCallChromeTimerRef.current = null;
      }
      setVideoCallChromeVisible(true);
      return undefined;
    }

    revealVideoCallChrome();

    return undefined;
  }, [callId, isCallAccepted, isIncomingPending, revealVideoCallChrome, route.params.mode]);

  useEffect(() => () => {
    if (videoCallChromeTimerRef.current) {
      clearTimeout(videoCallChromeTimerRef.current);
      videoCallChromeTimerRef.current = null;
    }
  }, []);

  const markLiveKitConnected = useCallback(() => {
    setLiveKitStarting(false);
    logCallTiming('livekit-connected');
    setNativeLiveVoiceEffect(nativeCallVoiceEffectId);
    const hasAcceptedOrJoinedPeer = isCallAcceptedRef.current;

    if (hasAcceptedOrJoinedPeer) {
      stopOutgoingRingback();
    }
    if (!isIncomingPendingRef.current) {
      setRingtoneEnabled(false);
      stopRingtone();
    }
    setLocalConnectionIssueSince(null);
    clearPeerConnectionProblem();
    setConnectionProblemNotice(null);
    if (hasAcceptedOrJoinedPeer) {
      const now = Date.now();

      outgoingStatusPhaseRef.current = 'connected';
      setConnectedAt((current) => current ?? now);
      setElapsedSeconds((current) => current || 0);
      setStatus(t('connected'));
      void forceCallAudioRoute(isSpeakerOn, route.params.mode === 'video', undefined, canApplyCallAudioRoute, route.params.mode === 'video')
        .catch(() => undefined);
    }
  }, [canApplyCallAudioRoute, clearPeerConnectionProblem, isSpeakerOn, logCallTiming, nativeCallVoiceEffectId, route.params.mode, stopOutgoingRingback, stopRingtone]);

  const handleLiveKitConnected = useCallback(() => {
    markLiveKitConnected();
  }, [markLiveKitConnected]);

  const handleLiveKitDisconnected = useCallback(() => {
    setLiveKitStarting(false);
    logCallTiming('livekit-disconnected');

    if (isIncomingPendingRef.current) {
      setLocalConnectionIssueSince(null);
      clearPeerConnectionProblem();
      setConnectionProblemNotice(null);
      setStatus(getIncomingCallStatus(route.params.mode, route.params.isGroupCall));
      return;
    }

    if (!isEndingCallRef.current && canShowConnectionProblem()) {
      beginLocalConnectionProblem();
      return;
    }

    setConnectedAt(null);
    setElapsedSeconds(0);
    setLocalConnectionIssueSince(null);
    clearPeerConnectionProblem();
    setConnectionProblemNotice(null);
    setStatus(t('disconnected'));
  }, [beginLocalConnectionProblem, canShowConnectionProblem, clearPeerConnectionProblem, logCallTiming, route.params.isGroupCall, route.params.mode]);

  const handleLiveKitConnectionState = useCallback((connectionState: ConnectionState) => {
    if (connectionState === ConnectionState.Reconnecting || connectionState === ConnectionState.SignalReconnecting) {
      if (canShowConnectionProblem()) {
        beginLocalConnectionProblem();
      }
      return;
    }

    if (connectionState === ConnectionState.Connected) {
      markLiveKitConnected();
    }
  }, [beginLocalConnectionProblem, canShowConnectionProblem, markLiveKitConnected]);

  const handleLiveKitError = useCallback((error?: unknown) => {
    setLiveKitStarting(false);
    logCallTiming('livekit-error', {
      message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown',
    });

    if (isIncomingPendingRef.current) {
      setStatus(getIncomingCallStatus(route.params.mode, route.params.isGroupCall));
      return;
    }

    if (canShowConnectionProblem()) {
      beginLocalConnectionProblem();
      return;
    }

    setStatus(t('connecting'));
  }, [beginLocalConnectionProblem, canShowConnectionProblem, logCallTiming, route.params.isGroupCall, route.params.mode]);

  const handlePeerPresence = useCallback((input: { hadRemoteParticipant: boolean; remoteParticipantCount: number; remoteParticipantIdentities: string[] }) => {
    setRemoteParticipantCount(input.remoteParticipantCount);
    const hasAnsweredRemoteParticipant = input.remoteParticipantIdentities.some((identity) => answeredParticipantIds.has(identity));

    if (input.remoteParticipantCount > 0) {
      clearCallEndedStatusCheck();

      if (!isCallAccepted) {
        if (route.params.direction === 'outgoing' && hasAnsweredRemoteParticipant) {
          isCallAcceptedRef.current = true;
          isIncomingPendingRef.current = false;
          setCallAccepted(true);
          setIncomingPending(false);
          setRingtoneEnabled(false);
          outgoingStatusPhaseRef.current = 'connecting';
          stopRingtone();
          stopOutgoingRingback();
          setStatus(t('connecting'));
        }

        clearPeerConnectionProblem();
        return;
      }

      const now = Date.now();

      outgoingStatusPhaseRef.current = 'connected';
      stopOutgoingRingback();
      setConnectedAt((current) => current ?? now);
      setElapsedSeconds((current) => current || 0);
      clearPeerConnectionProblem();
      setStatus(t('connected'));
      return;
    }

    if (input.hadRemoteParticipant && input.remoteParticipantCount === 0 && (isCallAcceptedRef.current || !!connectedAt)) {
      schedulePeerConnectionProblem();
      scheduleCallEndedStatusCheck();
      return;
    }

    clearCallEndedStatusCheck();
    clearPeerConnectionProblem();
  }, [answeredParticipantIds, clearCallEndedStatusCheck, clearPeerConnectionProblem, connectedAt, isCallAccepted, route.params.direction, scheduleCallEndedStatusCheck, schedulePeerConnectionProblem, stopOutgoingRingback, stopRingtone]);

  useEffect(() => {
    if (!connectedAt) {
      return undefined;
    }

    let animationFrameId: number;
    let lastTimestamp = performance.now();

    const updateCallDuration = () => {
      const now = performance.now();
      if (now - lastTimestamp >= 1000) {
        setElapsedSeconds(Math.max(0, Math.floor((Date.now() - connectedAt) / 1000)));
        lastTimestamp = now;
      }
      animationFrameId = requestAnimationFrame(updateCallDuration);
    };

    animationFrameId = requestAnimationFrame(updateCallDuration);

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [connectedAt]);

  useEffect(() => {
    setMiniCallPosition((current) => current ? clampMiniCallPosition(current, miniCallBounds) : current);
  }, [miniCallBounds]);

  useEffect(() => {
    const activeRoute = callAudioRoutes.find((item) => item.isActive);
    const shouldUseProximityScreenOff = route.params.mode === 'voice' &&
      !!connectedAt &&
      (activeRoute ? activeRoute.type === 'earpiece' : !isSpeakerOn);

    setNativeProximityScreenOffEnabled(shouldUseProximityScreenOff);

    return () => setNativeProximityScreenOffEnabled(false);
  }, [callAudioRoutes, connectedAt, isSpeakerOn, route.params.mode]);

  const minimizeCall = useCallback(async () => {
    if (!liveKitToken || isLockedCallAccess) {
      return;
    }

    setSystemPictureInPictureLayout(false);
    setPictureInPictureLayout(true);
  }, [isLockedCallAccess, liveKitToken]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      stopRingtone();
      stopOutgoingRingback();

      if (isEndingCallRef.current || !liveKitToken) {
        return;
      }

      event.preventDefault();

      if (isLockedCallAccess) {
        void hangUp();
        return;
      }

      void minimizeCall();
    });

    return unsubscribe;
  }, [isLockedCallAccess, liveKitToken, minimizeCall, navigation, stopOutgoingRingback, stopRingtone]);

  async function inviteUserToCall(userId: string, title: string) {
    if (!serverUrl || !callId) {
      return;
    }

    try {
      await inviteCallParticipant(serverUrl, callId, userId);
      setAddPeopleOpen(false);
      setPeopleSearch('');
      Alert.alert(t('invitationSent'), t('invitationSentMessage', { name: title }));
    } catch (error) {
      Alert.alert(t('inviteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function sendSharedItemsToConversation(conversation: Conversation) {
    if (isShareSending || !user || shareTargetItems.length === 0) {
      return;
    }

    setSelectedShareConversationId(conversation.id);
    setShareSending(true);

    try {
      const preparedItems = await Promise.all(shareTargetItems.map((item) => prepareSharedItem(item)));
      setPendingShareDraft(conversation.id, preparedItems);
      setShareTargetOpen(false);
      setSystemPictureInPictureLayout(false);
      setPictureInPictureLayout(true);
      navigation.navigate('ChatRoom', {
        conversationId: conversation.id,
        isGroup: conversation.type === 'GROUP',
        sharedItems: preparedItems,
        title: conversation.title,
      });
    } catch (error) {
      Alert.alert(t('shareFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setShareSending(false);
      setSelectedShareConversationId(null);
    }
  }

  const endCallAfterConnectionProblem = useCallback(async () => {
    if (isEndingCallRef.current) {
      return;
    }

    isEndingCallRef.current = true;
    stopLiveKitRoom();
    setStatus(t('connectionLost'));
    setConnectedAt(null);
    setElapsedSeconds(0);
    setRemoteParticipantCount(0);
    setLocalConnectionIssueSince(null);
    setPeerConnectionIssueSince(null);
    setConnectionProblemNotice(null);
    setRingtoneEnabled(false);

    // FIX 1: Cleanup audio resources
    cleanupAudioResources({
      ringtoneRef,
      outgoingRingbackRef,
      outgoingRingbackNativeActiveRef,
      ringbackTimeoutRef: outgoingRingbackLoopTimeoutRef,
      ringbackSubscriptionRef: outgoingRingbackSubscriptionRef,
      ringbackGenerationRef: outgoingRingbackGenerationRef,
    });

    setActiveCallSession(null);
    endIosCallKitCall(callId);
    setSystemPictureInPictureLayout(false);
    setPictureInPictureLayout(false);
    setCallPictureInPictureEnabled(false);
    setNativeProximityScreenOffEnabled(false);
    invalidatePendingCallAudioRouteOperations();
    stopNativeCallService(nativeCallSessionIdRef.current);
    void closeCallPictureInPicture();

    if (serverUrl && callId) {
      await Promise.race([
        endCall(serverUrl, callId).catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }

    closeCallScreenOnce();
    setTimeout(() => {
      Alert.alert(t('callEnded'), t('callEndedConnectionMessage'));
    }, 250);
  }, [callId, closeCallScreenOnce, serverUrl, stopLiveKitRoom]);

  useEffect(() => {
    const issueSince = localConnectionIssueSince ?? peerConnectionIssueSince;

    if (!issueSince || isEndingCallRef.current) {
      return undefined;
    }

    const delay = Math.max(0, CONNECTION_LOSS_TIMEOUT_MS - (Date.now() - issueSince));
    const timeout = setTimeout(() => {
      void endCallAfterConnectionProblem();
    }, delay);

    return () => clearTimeout(timeout);
  }, [endCallAfterConnectionProblem, localConnectionIssueSince, peerConnectionIssueSince]);

  function renderCallContent(canUseRoomControls: boolean) {
    const displayStatus = getDisplayStatus({
      connectedAt,
      elapsedSeconds,
      localConnectionIssueSince,
      peerConnectionIssueSince,
      status,
    });
    const canShowConnectedStage = canUseRoomControls && (
      !!connectedAt ||
      remoteParticipantCount > 0 ||
      (route.params.mode === 'video' && isCallAccepted && !!liveKitToken)
    );
    const shouldRenderConnectedStage = canShowConnectedStage;
    const isConnectedCall = shouldRenderConnectedStage && !!liveKitToken;
    const isConnectedVideo = shouldRenderConnectedStage && route.params.mode === 'video';
    const isWaitingVideo = !isConnectedCall && route.params.mode === 'video';
    const isVideoLayout = isConnectedVideo || isWaitingVideo;
    const isAndroidSystemPictureInPicture = Platform.OS === 'android' && isSystemPictureInPictureLayout;
    const shouldAutoHideVideoChrome = isVideoLayout && !isIncomingPending && !isPictureInPictureLayout && !isSystemPictureInPictureLayout;
    const showVideoChrome = isAndroidSystemPictureInPicture ? false : (!shouldAutoHideVideoChrome || isVideoCallChromeVisible);
    const callStage = shouldRenderConnectedStage ? (
      <ConnectedCallStage
        enableIosPictureInPicture={Platform.OS === 'ios' && route.params.mode === 'video'}
        hideLocalPreview={isAndroidSystemPictureInPicture}
        isAndroidSystemPictureInPicture={isAndroidSystemPictureInPicture}
        isCameraOff={isCameraOff}
        isCompact={isPictureInPictureLayout || (isSystemPictureInPictureLayout && !isAndroidSystemPictureInPicture)}
        localCameraRenderVersion={localCameraRenderVersion}
        localCameraMirror={localCameraFacing === 'user'}
        showLabels={showVideoChrome}
        mode={route.params.mode}
        onRemoteScreenShareActiveChange={setRemoteScreenShareActive}
        onShowPeople={() => setPeopleListOpen(true)}
        profiles={callParticipantProfiles}
        title={route.params.title}
        localPreviewVideoTrack={localPreviewVideoTrack}
      />
    ) : route.params.mode === 'video' && liveKitToken && liveKitUrl ? (
      <LiveKitWaitingVideoStage
        isCameraOff={isCameraOff}
        localCameraRenderVersion={localCameraRenderVersion}
        localCameraMirror={localCameraFacing === 'user'}
        previewVideoTrack={localPreviewVideoTrack}
        showLabels={showVideoChrome}
        title={route.params.title}
      />
    ) : route.params.mode === 'video' ? (
      <WaitingVideoStage
        isCameraOff={isCameraOff}
        localCameraRenderVersion={localCameraRenderVersion}
        localCameraMirror={localCameraFacing === 'user'}
        previewVideoTrack={localPreviewVideoTrack}
        showLabels={showVideoChrome}
        title={route.params.title}
      />
    ) : (
      <Avatar label={route.params.title} size={118} />
    );

    if (isSystemPictureInPictureLayout && isConnectedCall && !isAndroidSystemPictureInPicture) {
      return (
        <View style={styles.systemPipScreen}>
          <View style={[styles.systemPipStage, route.params.mode === 'video' ? styles.systemVideoPipStage : styles.systemVoicePipStage]}>
            {callStage}
          </View>
          <View style={styles.systemPipLabel}>
            <Ionicons color={colors.white} name={route.params.mode === 'video' ? 'videocam' : 'call'} size={14} />
            <Text numberOfLines={1} style={styles.systemPipLabelText}>{displayStatus}</Text>
          </View>
        </View>
      );
    }

    if (isPictureInPictureLayout && canUseRoomControls && !isLockedCallAccess) {
      return (
        <MinimizedCallView
          bounds={miniCallBounds}
          callStage={callStage}
          mode={route.params.mode}
          onMove={setMiniCallPosition}
          onRestore={() => setPictureInPictureLayout(false)}
          position={visibleMiniCallPosition}
          title={route.params.title}
        />
      );
    }

    return (
      <View
        onTouchStart={shouldAutoHideVideoChrome ? revealVideoCallChrome : undefined}
        style={styles.callContent}
      >
        {(!isVideoLayout || showVideoChrome) ? (
          <View style={[styles.topBar, isVideoLayout ? [styles.overlayTopBar, { paddingTop: insets.top + spacing.sm }] : undefined]}>
            <View style={styles.topActions}>
              {isLockedCallAccess && canUseRoomControls ? (
                <View style={styles.topButton} />
              ) : (
                <Pressable onPress={canUseRoomControls ? () => void minimizeCall() : hangUp} style={styles.topButton}>
                  <Ionicons color={colors.white} name="chevron-down" size={24} />
                </Pressable>
              )}
              {canShowConnectedStage && !isLockedCallAccess ? (
                <Pressable onPress={() => setAddPeopleOpen(true)} style={styles.topButton}>
                  <Ionicons color={colors.white} name="person-add" size={22} />
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.encryptionText}>
              {t(route.params.isGroupCall ? 'groupCallTitle' : 'privateCallTitle', { mode: route.params.mode === 'video' ? t('video') : t('voice') })}
            </Text>
            {canUseRoomControls && route.params.mode === 'video' && !isLockedCallAccess ? (
              <ScreenShareTopMenu
                cameraFacing={localCameraFacing}
                isCameraOff={isCameraOff}
                isGroupCall={route.params.isGroupCall}
                onCamera={setCameraOff}
                onCameraRenderRefresh={() => setLocalCameraRenderVersion((current) => current + 1)}
              />
            ) : (
              <View style={styles.topButton} />
            )}
          </View>
        ) : null}

        <View style={isVideoLayout ? styles.videoStageFull : [styles.stage, isIncomingPending ? styles.incomingStage : undefined]}>
          {callStage}
          {isIncomingPending && isVideoLayout ? <View pointerEvents="none" style={styles.incomingVideoShade} /> : null}
          {!isVideoLayout ? (
            <>
              <Text style={styles.name}>{route.params.title}</Text>
              {participantLine ? <Text numberOfLines={2} style={styles.participantLine}>{participantLine}</Text> : null}
              <Text style={styles.status}>{displayStatus}</Text>
            </>
          ) : showVideoChrome ? (
            <View style={styles.videoStatusOverlay}>
              <Text numberOfLines={1} style={styles.videoCallTitle}>{route.params.title}</Text>
              {participantLine ? <Text numberOfLines={1} style={styles.videoCallSubtitle}>{participantLine}</Text> : null}
              <Text style={styles.videoCallSubtitle}>{displayStatus}</Text>
            </View>
          ) : null}
        </View>

        {isIncomingPending ? (
          <View style={isVideoLayout ? [styles.overlayControls, { bottom: insets.bottom + spacing.lg }] : undefined}>
            <IncomingControls
              isVoiceChangerPremium={canUseVoiceChanger}
              onAnswer={() => void answerIncomingCall()}
              onDecline={() => void hangUp()}
              onVoiceChanger={canShowVoiceChanger ? () => {
                if (canUseVoiceChanger) {
                  setIncomingVoiceEffectPickerOpen(true);
                  return;
                }

                navigation.navigate('Subscription');
              } : undefined}
            />
          </View>
        ) : canUseRoomControls && showVideoChrome ? (
          <View style={isVideoLayout ? [styles.overlayControls, { bottom: insets.bottom + spacing.lg }] : undefined}>
            <CallControls
              cameraFacing={localCameraFacing}
              isCameraOff={isCameraOff}
              isGroupCall={route.params.isGroupCall}
              isMuted={isMuted}
              isSpeakerOn={isSpeakerOn}
              activeAudioRoute={callAudioRoutes.find((item) => item.isActive)}
              audioOptions={callAudioCaptureOptions}
              onCamera={setCameraOff}
              onCameraFacingChange={setLocalCameraFacing}
              onCameraRenderRefresh={() => setLocalCameraRenderVersion((current) => current + 1)}
              showCamera={route.params.mode === 'video' && supportsLocalVideoCapture}
              muteRef={isMutedRef}
              onHangUp={hangUp}
              onMuted={setCallMuted}
              onSpeakerLongPress={showCallAudioRoutePicker}
              onSpeakerPress={toggleCallSpeaker}
              voiceEffectId={nativeCallVoiceEffectId}
            />
          </View>
        ) : !isIncomingPending && showVideoChrome ? (
          <View style={isVideoLayout ? [styles.overlayControls, { bottom: insets.bottom + spacing.lg }] : undefined}>
            <PreConnectCallControls
              isCameraOff={isCameraOff}
              isMuted={isMuted}
              isSpeakerOn={isSpeakerOn}
              activeAudioRoute={callAudioRoutes.find((item) => item.isActive)}
              muteRef={isMutedRef}
              onCamera={setCameraOff}
              onHangUp={hangUp}
              onMuted={setCallMuted}
              onSpeakerLongPress={showCallAudioRoutePicker}
              onSpeakerPress={toggleCallSpeaker}
              showCamera={route.params.mode === 'video' && supportsLocalVideoCapture}
            />
          </View>
        ) : showVideoChrome ? (
          <View style={isVideoLayout ? [styles.overlayControls, { bottom: insets.bottom + spacing.lg }] : undefined}>
            <WaitingCallControls onHangUp={hangUp} />
          </View>
        ) : null}
      </View>
    );
  }

  async function hangUp() {
    logCallScreenDebug('hangup-pressed');
    isEndingCallRef.current = true;
    stopLiveKitRoom();
    setActiveCallSession(null);
    invalidatePendingCallAudioRouteOperations();

    if (callId && route.params.direction === 'incoming' && isIncomingPending && route.params.isGroupCall) {
      recordCall(callId, 'incoming', 'missed');
      endIosCallKitCall(callId);
      setRingtoneEnabled(false);
      if (serverUrl) {
        void endCall(serverUrl, callId).catch(() => undefined);
      }

      // FIX 1: Cleanup audio resources
      cleanupAudioResources({
        ringtoneRef,
        outgoingRingbackRef,
        outgoingRingbackNativeActiveRef,
        ringbackTimeoutRef: outgoingRingbackLoopTimeoutRef,
        ringbackSubscriptionRef: outgoingRingbackSubscriptionRef,
        ringbackGenerationRef: outgoingRingbackGenerationRef,
      });

      closeCallScreenOnce();
      return;
    }

    if (serverUrl && callId) {
      if (route.params.direction === 'outgoing' && !isCallAccepted) {
        recordCall(callId, 'outgoing', 'cancelled');
      }

      if (route.params.direction === 'incoming' && isIncomingPending) {
        recordCall(callId, 'incoming', 'declined');
      }

      void Promise.race([
        endCall(serverUrl, callId),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]).catch(() => {
        // The call may already have ended on the other device.
      });
    }

    endIosCallKitCall(callId);
    setRingtoneEnabled(false);

    // FIX 1: Cleanup audio resources
    cleanupAudioResources({
      ringtoneRef,
      outgoingRingbackRef,
      outgoingRingbackNativeActiveRef,
      ringbackTimeoutRef: outgoingRingbackLoopTimeoutRef,
      ringbackSubscriptionRef: outgoingRingbackSubscriptionRef,
      ringbackGenerationRef: outgoingRingbackGenerationRef,
    });

    closeCallScreenOnce();
  }

  const dismissWaitingIncomingCall = useCallback(async () => {
    const nextCall = waitingIncomingCall;

    if (!nextCall) {
      return;
    }

    setWaitingIncomingCall(null);

    if (serverUrl) {
      await endCall(serverUrl, nextCall.callId).catch(() => undefined);
    }
  }, [serverUrl, waitingIncomingCall]);

  const switchToWaitingIncomingCall = useCallback(async () => {
    const nextCall = waitingIncomingCall;

    if (!nextCall || !serverUrl) {
      return;
    }

    setWaitingIncomingCall(null);
    isEndingCallRef.current = true;
    stopLiveKitRoom();
    setActiveCallSession(null);
    setRingtoneEnabled(false);
    invalidatePendingCallAudioRouteOperations();

    // FIX 1: Cleanup audio resources
    cleanupAudioResources({
      ringtoneRef,
      outgoingRingbackRef,
      outgoingRingbackNativeActiveRef,
      ringbackTimeoutRef: outgoingRingbackLoopTimeoutRef,
      ringbackSubscriptionRef: outgoingRingbackSubscriptionRef,
      ringbackGenerationRef: outgoingRingbackGenerationRef,
    });

    if (callId) {
      await endCall(serverUrl, callId).catch(() => undefined);
    }

    try {
      await answerCall(serverUrl, nextCall.callId);
    } catch (error) {
      isEndingCallRef.current = false;
      Alert.alert(t('couldNotStartCall'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      return;
    }

    endIosCallKitCall(callId);
    navigation.replace('CallRoom', {
      answeredByNative: true,
      callId: nextCall.callId,
      conversationId: nextCall.conversationId,
      direction: 'incoming',
      isGroupCall: nextCall.isGroupCall,
      mode: nextCall.mode,
      participantNames: nextCall.participantNames,
      title: nextCall.title,
    });
  }, [callId, navigation, serverUrl, stopLiveKitRoom, waitingIncomingCall]);

  const isManualMinimized = isPictureInPictureLayout && !isSystemPictureInPictureLayout;

  return (
    <CallRoomPresentationProvider styles={styles}>
      <View
        style={[
          isManualMinimized ? styles.minimizedAppScreen : styles.screen,
          !isManualMinimized && isIncomingPending ? styles.incomingScreen : undefined,
          !isManualMinimized && (
            isPictureInPictureLayout && isSystemPictureInPictureLayout
              ? styles.pipScreen
              : route.params.mode === 'video'
                ? styles.videoScreen
                : { paddingBottom: insets.bottom + spacing.lg, paddingTop: insets.top + spacing.xl }
          ),
        ]}
      >
      {isManualMinimized ? <MainTabs /> : null}
      {isLiveKitRoomEnabled && liveKitToken && liveKitUrl ? (
        <View pointerEvents={isManualMinimized ? 'box-none' : 'auto'} style={isManualMinimized ? styles.minimizedCallLayer : styles.liveKitRoomHost}>
          <LiveKitRoom
            audio={false}
            connect
            connectOptions={CALL_CONNECT_OPTIONS}
            key={`${callId ?? route.params.callId ?? 'call'}:${liveKitToken.slice(-16)}`}
            onConnected={handleLiveKitConnected}
            onDisconnected={handleLiveKitDisconnected}
            onError={handleLiveKitError}
            options={CALL_ROOM_OPTIONS}
            serverUrl={liveKitUrl}
            token={liveKitToken}
            video={false}
          >
            <CallRoomDisconnectRegistrar onDisconnectReady={registerLiveKitDisconnect} />
            <CallAudioPublisher
              audioOptions={callAudioCaptureOptions}
              callKitAudioManaged={isCallKitAudioManagedCall}
              canPublish={isCallAccepted}
              canPrePublishPaused={route.params.mode === 'voice' && route.params.direction === 'outgoing' && hasCallPermissions && !isCallAccepted}
              isMuted={isMuted}
              mode={route.params.mode}
              muteRef={isMutedRef}
              onMuted={setCallMuted}
              voiceEffectId={nativeCallVoiceEffectId}
            />
            {(route.params.mode === 'video' && supportsLocalVideoCapture) && (
              <CallVideoPublisher
                canPublish={isCallAccepted}
                canPrePublishPaused={route.params.direction === 'outgoing' && hasCallPermissions && !isCallAccepted}
                cameraFacing={localCameraFacing}
                isCameraOff={isCameraOff}
                isGroupCall={route.params.isGroupCall}
                onLocalCameraPublished={setLocalCameraPublished}
                onPreviewTrackPublished={detachLocalPreviewTrack}
                onTimingEvent={logCallTiming}
                previewVideoTrack={localPreviewVideoTrack}
              />
            )}
            <CallConnectionMonitor
              onConnectionStateChange={handleLiveKitConnectionState}
              onPeerPresenceChange={handlePeerPresence}
            />
            <CallRemoteTrackSubscriptionMonitor
              enabled={isCallAccepted || route.params.direction === 'outgoing'}
              mode={route.params.mode}
            />
            {isCallAccepted ? (
              <CallAudioRecoveryMonitor
                audioOptions={callAudioCaptureOptions}
                callKitAudioManaged={isCallKitAudioManagedCall}
                canPublish={isCallAccepted}
                isMuted={isMuted}
                mode={route.params.mode}
                muteRef={isMutedRef}
                preferMicrophoneRestart={Platform.OS === 'ios' && route.params.direction === 'incoming' && route.params.answeredByNative === true}
                shouldApplyAudioRoute={canApplyCallAudioRoute}
                useSpeaker={isSpeakerOn}
                voiceEffectId={nativeCallVoiceEffectId}
              />
            ) : null}
            {renderCallContent(isCallAccepted)}
            <AddPeopleModal
              candidates={visibleInviteCandidates}
              isVisible={isAddPeopleOpen}
              maxReachedMessage={route.params.mode === 'video' ? t('videoCallsLimit') : t('voiceCallsLimit')}
              onClose={() => setAddPeopleOpen(false)}
              onInvite={(candidate) => void inviteUserToCall(candidate.id, candidate.title)}
              onSearch={setPeopleSearch}
              search={peopleSearch}
            />
            <PeopleInCallModal isVisible={isPeopleListOpen} onClose={() => setPeopleListOpen(false)} profiles={callParticipantProfiles} />
            <CallConnectionProblemModal
              isVisible={!!connectionProblemNotice && !isSystemPictureInPictureLayout && !isShareTargetOpen}
              message={connectionProblemNotice?.message ?? ''}
              title={connectionProblemNotice?.title ?? t('reconnectingCall')}
            />
          </LiveKitRoom>
        </View>
      ) : (
        <>
          {renderCallContent(false)}
          <AddPeopleModal
            candidates={visibleInviteCandidates}
            isVisible={isAddPeopleOpen}
            maxReachedMessage={route.params.mode === 'video' ? t('videoCallsLimit') : t('voiceCallsLimit')}
            onClose={() => setAddPeopleOpen(false)}
            onInvite={(candidate) => void inviteUserToCall(candidate.id, candidate.title)}
            onSearch={setPeopleSearch}
            search={peopleSearch}
          />
          <CallConnectionProblemModal
            isVisible={!!connectionProblemNotice && !isSystemPictureInPictureLayout && !isShareTargetOpen}
            message={connectionProblemNotice?.message ?? ''}
            title={connectionProblemNotice?.title ?? t('reconnectingCall')}
          />
        </>
      )}
      <IncomingVoiceEffectModal
        bottomInset={insets.bottom}
        isProcessing={isAnsweringCallRef.current}
        onAnswer={() => {
          setIncomingVoiceEffectPickerOpen(false);
          void answerIncomingCall();
        }}
        onCancel={() => setIncomingVoiceEffectPickerOpen(false)}
        onSelect={(effectId) => {
          setIncomingVoiceEffectId(effectId);
          setNativeLiveVoiceEffect(effectId);
        }}
        selectedEffectId={incomingVoiceEffectId}
        visible={isIncomingVoiceEffectPickerOpen && isIncomingPending && canUseVoiceChanger}
      />
      <WaitingIncomingCallModal
        cancelLabel={t('declineIncomingCallWhileBusy')}
        isVisible={!!waitingIncomingCall}
        message={t('incomingCallWhileBusyMessage', { name: waitingIncomingCall?.title ?? t('incomingCallTitle') })}
        onCancel={() => void dismissWaitingIncomingCall()}
        onSwitch={switchToWaitingIncomingCall}
        switchLabel={t('endCurrentAndAnswer')}
        topOffset={insets.top + spacing.sm}
        title={t('incomingCallWhileBusyTitle')}
      />
      <Modal
        animationType="slide"
        onRequestClose={() => setShareTargetOpen(false)}
        transparent
        visible={isShareTargetOpen}
      >
        <Pressable
          onPress={() => setShareTargetOpen(false)}
          style={shareTargetPickerStyles.backdrop}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[
              shareTargetPickerStyles.panel,
              {
                maxHeight: Math.min(window.height * 0.78, window.height - insets.top - insets.bottom - spacing.xl * 2),
                paddingBottom: insets.bottom + spacing.md,
              },
            ]}
          >
            <View style={shareTargetPickerStyles.header}>
              <View style={shareTargetPickerStyles.headerText}>
                <Text numberOfLines={1} style={shareTargetPickerStyles.title}>{formatShareSummary(
                  shareTargetItems.filter((item) => item.kind === 'text' && item.text),
                  shareTargetItems.filter((item) => item.kind === 'file' && item.uri),
                )}</Text>
                <Text numberOfLines={2} style={shareTargetPickerStyles.subtitle}>{formatShareSubtitle(
                  shareTargetItems.filter((item) => item.kind === 'text' && item.text),
                  shareTargetItems.filter((item) => item.kind === 'file' && item.uri),
                )}</Text>
              </View>
              <Pressable
                hitSlop={10}
                onPress={() => setShareTargetOpen(false)}
                style={shareTargetPickerStyles.closeButton}
              >
                <Ionicons color={colors.textSecondary} name="close" size={20} />
              </Pressable>
            </View>
            <View style={shareTargetPickerStyles.searchWrap}>
              <Ionicons color={colors.textSecondary} name="search" size={18} />
              <TextInput
                autoCapitalize="none"
                onChangeText={setShareTargetQuery}
                placeholder={t('search')}
                placeholderTextColor={colors.textSecondary}
                style={shareTargetPickerStyles.searchInput}
                value={shareTargetQuery}
              />
            </View>
            <FlatList
              contentContainerStyle={visibleShareableConversations.length === 0 ? shareTargetPickerStyles.emptyList : shareTargetPickerStyles.list}
              data={visibleShareableConversations}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={(
                <View style={shareTargetPickerStyles.emptyState}>
                  <Text style={shareTargetPickerStyles.emptyTitle}>{t('noChatsYet')}</Text>
                </View>
              )}
              renderItem={({ item }) => {
                const isThisSending = isShareSending && selectedShareConversationId === item.id;

                return (
                  <Pressable
                    disabled={isShareSending}
                    onPress={() => void sendSharedItemsToConversation(item)}
                    style={({ pressed }) => [
                      shareTargetPickerStyles.row,
                      pressed && !isShareSending ? shareTargetPickerStyles.rowPressed : undefined,
                    ]}
                  >
                    <Avatar label={item.title} size={46} uri={item.avatarUrl} />
                    <View style={shareTargetPickerStyles.rowText}>
                      <Text numberOfLines={1} style={shareTargetPickerStyles.rowTitle}>{item.title}</Text>
                      <Text numberOfLines={1} style={shareTargetPickerStyles.rowSubtitle}>{item.type === 'GROUP' ? t('group') : t('privateChat')}</Text>
                    </View>
                    {isThisSending ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Ionicons color={colors.textSecondary} name="send" size={20} />
                    )}
                  </Pressable>
                );
              }}
              showsVerticalScrollIndicator={false}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setCallAudioRoutePickerOpen(false)}
        transparent
        visible={isCallAudioRoutePickerOpen}
      >
        <Pressable
          onPress={() => setCallAudioRoutePickerOpen(false)}
          style={[callAudioRoutePickerStyles.backdrop, { paddingBottom: insets.bottom + spacing.md }]}
        >
          <Pressable onPress={(event) => event.stopPropagation()} style={callAudioRoutePickerStyles.panel}>
            <Text style={callAudioRoutePickerStyles.title}>{t('audioOutput')}</Text>
            {callAudioRoutes.map((audioRoute) => (
              <Pressable
                key={audioRoute.id}
                onPress={() => void selectCallAudioRoute(audioRoute)}
                style={[callAudioRoutePickerStyles.route, audioRoute.isActive && callAudioRoutePickerStyles.activeRoute]}
              >
                <View style={[callAudioRoutePickerStyles.icon, audioRoute.isActive && callAudioRoutePickerStyles.activeIcon]}>
                  <Ionicons color={audioRoute.isActive ? colors.white : colors.primary} name={getCallAudioRouteIcon(audioRoute)} size={22} />
                </View>
                <Text numberOfLines={1} style={callAudioRoutePickerStyles.routeText}>{getCallAudioRouteLabel(audioRoute, true)}</Text>
                {audioRoute.isActive ? <Ionicons color={colors.primary} name="checkmark-circle" size={22} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal animationType="fade" transparent visible={!!pendingCallFeedbackId} onRequestClose={closeCallFeedback}>
        <View style={callFeedbackStyles.backdrop}>
          <View style={callFeedbackStyles.panel}>
            <Text style={callFeedbackStyles.title}>{t('callFeedbackTitle')}</Text>
            <Text style={callFeedbackStyles.body}>{t('callFeedbackDescription')}</Text>
            <View style={callFeedbackStyles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <Pressable key={star} onPress={() => setSelectedCallRating(star)} style={callFeedbackStyles.starButton}>
                  <Ionicons color={selectedCallRating >= star ? '#f5b301' : colors.textSecondary} name="star" size={36} />
                </Pressable>
              ))}
            </View>
            <View style={callFeedbackStyles.actions}>
              <Pressable onPress={closeCallFeedback} style={callFeedbackStyles.secondaryButton}>
                <Text style={callFeedbackStyles.secondaryText}>{t('notNow')}</Text>
              </Pressable>
              <Pressable
                disabled={selectedCallRating < 1}
                onPress={() => void submitPendingCallFeedback()}
                style={[callFeedbackStyles.primaryButton, selectedCallRating < 1 ? callFeedbackStyles.primaryButtonDisabled : undefined]}
              >
                <Text style={callFeedbackStyles.primaryText}>{t('send')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </View>
    </CallRoomPresentationProvider>
  );
}

function getCallLogStatusFromCallStatus(callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED') {
  if (callStatus === 'CANCELLED') {
    return 'cancelled' as const;
  }

  if (callStatus === 'DECLINED') {
    return 'declined' as const;
  }

  return 'missed' as const;
}

const callFeedbackStyles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    gap: spacing.lg,
    padding: spacing.xl,
    width: '100%',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
  },
  primaryText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  secondaryText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '800',
  },
  starButton: {
    padding: spacing.xs,
  },
  stars: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: '900',
    textAlign: 'center',
  },
});

const shareTargetPickerStyles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  list: {
    paddingBottom: spacing.sm,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: spacing.xs,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    minHeight: 42,
    padding: 0,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
});

const callAudioRoutePickerStyles = StyleSheet.create({
  activeIcon: {
    backgroundColor: colors.primary,
  },
  activeRoute: {
    backgroundColor: 'rgba(64, 158, 255, 0.12)',
    borderColor: 'rgba(64, 158, 255, 0.38)',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: 'rgba(64, 158, 255, 0.12)',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  route: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  routeText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
});

function getDisplayStatus(input: {
  connectedAt: number | null;
  elapsedSeconds: number;
  localConnectionIssueSince: number | null;
  peerConnectionIssueSince: number | null;
  status: string;
}) {
  if (input.localConnectionIssueSince) {
    return t('reconnectingYourCall');
  }

  if (input.peerConnectionIssueSince) {
    return t('waitingForOtherSideReconnect');
  }

  if (input.connectedAt) {
    return formatCallElapsed(input.elapsedSeconds);
  }

  return input.status === t('connectingAudio') ? t('connectingAudioShort') : input.status;
}

function formatCallElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const paddedSeconds = String(seconds).padStart(2, '0');

  return hours > 0
    ? `${hours}:${paddedMinutes}:${paddedSeconds}`
    : `${paddedMinutes}:${paddedSeconds}`;
}

function CallConnectionMonitor({
  onConnectionStateChange,
  onPeerPresenceChange,
}: {
  onConnectionStateChange: (connectionState: ConnectionState) => void;
  onPeerPresenceChange: (input: { hadRemoteParticipant: boolean; remoteParticipantCount: number; remoteParticipantIdentities: string[] }) => void;
}) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const hadRemoteParticipantRef = useRef(false);
  const remoteParticipantIdentities = useMemo(() => (
    participants
      .filter((participant) => participant.identity !== localParticipant.identity)
      .map((participant) => participant.identity)
  ), [localParticipant.identity, participants]);
  const remoteParticipantCount = remoteParticipantIdentities.length;

  useEffect(() => {
    logCallDebug('livekit-connection-state-change', {
      connectionState,
      localParticipantId: localParticipant.identity,
    });
    onConnectionStateChange(connectionState);
  }, [connectionState, localParticipant.identity, onConnectionStateChange]);

  useEffect(() => {
    if (remoteParticipantCount > 0) {
      hadRemoteParticipantRef.current = true;
    }

    onPeerPresenceChange({
      hadRemoteParticipant: hadRemoteParticipantRef.current,
      remoteParticipantIdentities,
      remoteParticipantCount,
    });
    logCallDebug('livekit-participants-change', {
      hadRemoteParticipant: hadRemoteParticipantRef.current,
      localParticipantId: localParticipant.identity,
      remoteParticipantCount,
      remoteParticipantIdentities,
    });
  }, [localParticipant.identity, onPeerPresenceChange, remoteParticipantCount, remoteParticipantIdentities]);

  return null;
}

function CallRemoteTrackSubscriptionMonitor({
  enabled,
  mode,
}: {
  enabled: boolean;
  mode: 'voice' | 'video';
}) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const remoteCameraStateSignaturesRef = useRef(new Map<string, string>());
  const remoteNetworkBadSamplesRef = useRef(0);
  const remoteNetworkStableSinceRef = useRef(0);
  const remoteNetworkLastSwitchAtRef = useRef(0);
  const remoteRtcStatsBadSamplesRef = useRef(0);
  const remoteRtcStatsPreviousByIdRef = useRef(new Map<string, CallRtcStatsPrevious>());
  const remoteSubscriptionBootstrapStartedAtRef = useRef(0);
  const hasSeenFirstRemoteVideoTrackRef = useRef(false);
  const firstRemoteBytesLoggedRef = useRef(new Set<string>());
  const firstRemoteFrameLoggedRef = useRef(new Set<string>());
  const remoteStartupStatsSamplePendingRef = useRef(false);
  const remoteNetworkProfileRef = useRef<CallVideoNetworkProfile>('normal');
  const [remoteNetworkProfile, setRemoteNetworkProfile] = useState<CallVideoNetworkProfile>('normal');

  const switchRemoteNetworkProfile = useCallback((nextProfile: CallVideoNetworkProfile, reason: string) => {
    const currentProfile = remoteNetworkProfileRef.current;

    if (nextProfile === currentProfile) {
      return;
    }

    // Startup already requests the lowest simulcast layer. Do not let incomplete
    // inbound stats trigger another layer update before the first frame exists.
    if (!hasSeenFirstRemoteVideoTrackRef.current && nextProfile !== 'normal') {
      logCallDebug('remote-video-network-profile-deferred', {
        localParticipantId: localParticipant.identity,
        reason,
        requestedProfile: nextProfile,
      });
      return;
    }

    const now = Date.now();
    const isDowngrade = getCallVideoProfileRank(nextProfile) > getCallVideoProfileRank(currentProfile);

    const minInterval = isDowngrade ? 2_000 : CALL_VIDEO_PROFILE_SWITCH_MIN_INTERVAL_MS;

    if (now - remoteNetworkLastSwitchAtRef.current < minInterval) {
      return;
    }

    remoteNetworkLastSwitchAtRef.current = now;
    remoteNetworkProfileRef.current = nextProfile;
    setRemoteNetworkProfile(nextProfile);
    logCallDebug('remote-video-network-profile-switch', {
      from: currentProfile,
      localParticipantId: localParticipant.identity,
      reason,
      to: nextProfile,
    });
  }, [localParticipant.identity]);

  useEffect(() => {
    remoteNetworkProfileRef.current = remoteNetworkProfile;
  }, [remoteNetworkProfile]);

  useEffect(() => {
    if (!enabled || mode !== 'video') {
      remoteNetworkBadSamplesRef.current = 0;
      remoteRtcStatsBadSamplesRef.current = 0;
      remoteRtcStatsPreviousByIdRef.current.clear();
      return undefined;
    }

    function handleLocalConnectionQuality(quality: ConnectionQuality, participant: { identity?: string } | undefined) {
      if (participant?.identity !== localParticipant.identity) {
        return;
      }

      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
        remoteNetworkStableSinceRef.current = 0;
        remoteNetworkBadSamplesRef.current += 1;

        if (remoteNetworkBadSamplesRef.current >= CALL_VIDEO_CRITICAL_BAD_SAMPLE_COUNT) {
          switchRemoteNetworkProfile('critical', `quality-${quality}`);
          return;
        }

        if (remoteNetworkBadSamplesRef.current >= CALL_VIDEO_DEGRADE_BAD_SAMPLE_COUNT) {
          switchRemoteNetworkProfile('degraded', `quality-${quality}`);
        }
        return;
      }

      if (quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent) {
        remoteNetworkBadSamplesRef.current = 0;

        if (remoteNetworkStableSinceRef.current === 0) {
          remoteNetworkStableSinceRef.current = Date.now();
        }
      }
    }

    room.on(RoomEvent.ConnectionQualityChanged, handleLocalConnectionQuality);
    const recoveryInterval = setInterval(() => {
      const stableSince = remoteNetworkStableSinceRef.current;

      if (
        stableSince > 0 &&
        remoteNetworkProfileRef.current !== 'normal' &&
        Date.now() - stableSince >= CALL_VIDEO_RECOVERY_STABLE_MS
      ) {
        switchRemoteNetworkProfile('normal', 'quality-recovery-timer');
      }
    }, 2_000);

    return () => {
      clearInterval(recoveryInterval);
      room.off(RoomEvent.ConnectionQualityChanged, handleLocalConnectionQuality);
    };
  }, [enabled, localParticipant.identity, mode, room, switchRemoteNetworkProfile]);

  useEffect(() => {
    if (!enabled || mode !== 'video') {
      return undefined;
    }

    let isCancelled = false;

    async function sampleRtcStats() {
      const statsProfile = getDownlinkNetworkProfileFromRtcStats(
        await collectCallRtcStatsSnapshot(room, remoteRtcStatsPreviousByIdRef).catch(() => ({})),
      );

      if (isCancelled || !statsProfile) {
        return;
      }

      if (statsProfile === 'normal') {
        remoteRtcStatsBadSamplesRef.current = 0;

        if (remoteNetworkStableSinceRef.current === 0) {
          remoteNetworkStableSinceRef.current = Date.now();
        }
        return;
      }

      remoteNetworkStableSinceRef.current = 0;
      remoteRtcStatsBadSamplesRef.current += 1;

      if (
        statsProfile === 'critical' &&
        remoteRtcStatsBadSamplesRef.current >= CALL_WEBRTC_STATS_CRITICAL_BAD_SAMPLE_COUNT
      ) {
        switchRemoteNetworkProfile('critical', 'rtc-stats-critical');
        return;
      }

      if (remoteRtcStatsBadSamplesRef.current >= CALL_WEBRTC_STATS_DEGRADE_BAD_SAMPLE_COUNT) {
        switchRemoteNetworkProfile('degraded', `rtc-stats-${statsProfile}`);
      }
    }

    void sampleRtcStats();
    const interval = setInterval(() => {
      void sampleRtcStats();
    }, CALL_WEBRTC_STATS_SAMPLE_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [enabled, mode, room, switchRemoteNetworkProfile]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    remoteSubscriptionBootstrapStartedAtRef.current = Date.now();
    const getRemoteParticipants = () => Array.from(room.remoteParticipants.values());

    const subscribeRemoteTracks = () => {
      const participants = getRemoteParticipants();
      const participantCount = participants.length + 1;
      const activeSpeakerIdentities = new Set(room.activeSpeakers.map((participant) => participant.identity));
      const isStartup = mode === 'video' && !hasSeenFirstRemoteVideoTrackRef.current;

      participants.forEach((participant) => {
        if (!participant.identity || participant.identity === localParticipant.identity) {
          return;
        }

        const microphonePublication = participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined;
        ensureRemoteAudioPublicationSubscribed(microphonePublication);

        if (mode === 'video') {
          const screenSharePublication = participant.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
          const cameraPublication = participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
          const isActiveSpeaker = activeSpeakerIdentities.has(participant.identity);
          const shouldLimitGroupVideo = participantCount > 2 && !(remoteNetworkProfile === 'normal' && isActiveSpeaker);
          const cameraState = {
            localParticipantId: localParticipant.identity,
            participantCount,
            participantId: participant.identity,
            hasScreenSharePublication: !!screenSharePublication,
            hasScreenShareTrack: !!screenSharePublication?.track,
            isScreenShareDesired: screenSharePublication?.isDesired === true,
            isScreenShareMuted: screenSharePublication?.isMuted === true,
            isScreenShareSubscribed: screenSharePublication?.isSubscribed === true,
            screenShareReadyState: screenSharePublication?.track?.mediaStreamTrack.readyState,
            screenShareTrackSid: screenSharePublication?.trackSid,
            hasPublication: !!cameraPublication,
            hasTrack: !!cameraPublication?.track,
            isDesired: cameraPublication?.isDesired === true,
            isMuted: cameraPublication?.isMuted === true,
            isSubscribed: cameraPublication?.isSubscribed === true,
            readyState: cameraPublication?.track?.mediaStreamTrack.readyState,
            remoteNetworkProfile,
            source: cameraPublication?.source,
            trackKind: cameraPublication?.kind,
            trackSid: cameraPublication?.trackSid,
            useGroupVideoLimits: shouldLimitGroupVideo,
          };
          const cameraStateSignature = JSON.stringify(cameraState);

          if (remoteCameraStateSignaturesRef.current.get(participant.identity) !== cameraStateSignature) {
            remoteCameraStateSignaturesRef.current.set(participant.identity, cameraStateSignature);
            logCallDebug('remote-camera-publication-state', cameraState);
          }

          ensureRemoteVideoPublicationSubscribed(screenSharePublication, {
            isStartup,
            log: (event, details) => {
              logCallDebug(event, {
                localParticipantId: localParticipant.identity,
                participantId: participant.identity,
                source: Track.Source.ScreenShare,
                ...details,
              });
            },
            networkProfile: remoteNetworkProfile,
            useGroupVideoLimits: false,
          });
          ensureRemoteVideoPublicationSubscribed(cameraPublication, {
            isStartup,
            log: (event, details) => {
              logCallDebug(event, {
                localParticipantId: localParticipant.identity,
                participantId: participant.identity,
                source: Track.Source.Camera,
                ...details,
              });
            },
            networkProfile: remoteNetworkProfile,
            useGroupVideoLimits: shouldLimitGroupVideo,
          });
        }
      });
    };

    subscribeRemoteTracks();
    const bootstrapInterval = mode === 'video'
      ? setInterval(() => {
          if (
            hasSeenFirstRemoteVideoTrackRef.current ||
            Date.now() - remoteSubscriptionBootstrapStartedAtRef.current >= CALL_REMOTE_VIDEO_STARTUP_WATCHDOG_MS
          ) {
            clearInterval(bootstrapInterval);
            return;
          }

          subscribeRemoteTracks();
        }, 200)
      : undefined;
    const handleRemoteTrackUpdate = () => {
      subscribeRemoteTracks();
    };
    const handleRemoteTrackSubscribed = (
      track: unknown,
      publication: RemoteTrackPublication,
      participant: { identity?: string } | undefined,
    ) => {
      if (publication.source === Track.Source.Camera || publication.source === Track.Source.ScreenShare) {
        logCallDebug('remote-video-track-subscribed', {
          localParticipantId: localParticipant.identity,
          participantId: participant?.identity,
          readyState: publication.track?.mediaStreamTrack.readyState,
          source: publication.source,
          trackSid: publication.trackSid,
        });
      }

      subscribeRemoteTracks();
    };
    const decoderHealthInterval = mode === 'video'
      ? setInterval(() => {
          getRemoteParticipants().forEach((participant) => {
            if (!participant.identity || participant.identity === localParticipant.identity) {
              return;
            }

            const publication = participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
            void recoverRemoteVideoPublicationIfDecoderStalled(publication, (event, details) => {
              logCallDebug(event, {
                localParticipantId: localParticipant.identity,
                participantId: participant.identity,
                ...details,
              });
            });
          });
        }, 2_000)
      : undefined;
    const startupStatsInterval = mode === 'video'
      ? setInterval(() => {
          if (
            remoteStartupStatsSamplePendingRef.current ||
            Date.now() - remoteSubscriptionBootstrapStartedAtRef.current > CALL_REMOTE_VIDEO_STARTUP_WATCHDOG_MS
          ) {
            return;
          }

          remoteStartupStatsSamplePendingRef.current = true;
          void Promise.all(getRemoteParticipants().map(async (participant) => {
            if (!participant.identity || participant.identity === localParticipant.identity) {
              return;
            }

            const publication = participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
            const track = publication?.track as (RemoteTrackPublication['track'] & {
              getReceiverStats?: () => Promise<{ bytesReceived?: number; framesDecoded?: number } | undefined>;
            }) | undefined;

            if (!publication?.trackSid || !track?.getReceiverStats) {
              return;
            }

            const stats = await track.getReceiverStats().catch(() => undefined);
            const bytesReceived = stats?.bytesReceived ?? 0;
            const framesDecoded = stats?.framesDecoded ?? 0;

            if (bytesReceived > 0 && !firstRemoteBytesLoggedRef.current.has(publication.trackSid)) {
              firstRemoteBytesLoggedRef.current.add(publication.trackSid);
              logCallDebug('remote-video-first-bytes', {
                bytesReceived,
                framesDecoded,
                localParticipantId: localParticipant.identity,
                participantId: participant.identity,
                trackSid: publication.trackSid,
              });
            }

            if (framesDecoded > 0 && !firstRemoteFrameLoggedRef.current.has(publication.trackSid)) {
              firstRemoteFrameLoggedRef.current.add(publication.trackSid);
              hasSeenFirstRemoteVideoTrackRef.current = true;
              logCallDebug('remote-video-first-decoded-frame', {
                bytesReceived,
                framesDecoded,
                localParticipantId: localParticipant.identity,
                participantId: participant.identity,
                trackSid: publication.trackSid,
              });

              subscribeRemoteTracks();
            }
          })).finally(() => {
            remoteStartupStatsSamplePendingRef.current = false;
          });
        }, 200)
      : undefined;

    room
      .on(RoomEvent.ParticipantConnected, handleRemoteTrackUpdate)
      .on(RoomEvent.ActiveSpeakersChanged, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackPublished, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackSubscribed, handleRemoteTrackSubscribed)
      .on(RoomEvent.TrackStreamStateChanged, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackSubscriptionStatusChanged, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackMuted, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackUnmuted, handleRemoteTrackUpdate);

    return () => {
      if (bootstrapInterval) {
        clearInterval(bootstrapInterval);
      }
      if (decoderHealthInterval) {
        clearInterval(decoderHealthInterval);
      }
      if (startupStatsInterval) {
        clearInterval(startupStatsInterval);
      }
      room
        .off(RoomEvent.ParticipantConnected, handleRemoteTrackUpdate)
        .off(RoomEvent.ActiveSpeakersChanged, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackPublished, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackSubscribed, handleRemoteTrackSubscribed)
        .off(RoomEvent.TrackStreamStateChanged, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackSubscriptionStatusChanged, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackMuted, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackUnmuted, handleRemoteTrackUpdate);
    };
  }, [enabled, localParticipant.identity, mode, remoteNetworkProfile, room]);

  return null;
}

function CallRoomDisconnectRegistrar({
  onDisconnectReady,
}: {
  onDisconnectReady: (disconnect: (() => Promise<void>) | null) => void;
}) {
  const room = useRoomContext();

  useEffect(() => {
    onDisconnectReady(room.disconnect);

    return () => {
      onDisconnectReady(null);
    };
  }, [onDisconnectReady, room]);

  return null;
}

function CallAudioPublisher({
  audioOptions,
  callKitAudioManaged,
  canPublish,
  canPrePublishPaused,
  isMuted,
  mode,
  muteRef,
  onMuted,
  voiceEffectId,
}: {
  audioOptions: CallAudioCaptureOptions;
  callKitAudioManaged: boolean;
  canPublish: boolean;
  canPrePublishPaused: boolean;
  isMuted: boolean;
  mode: 'voice' | 'video';
  muteRef: MutableRefObject<boolean>;
  onMuted: (value: boolean) => void;
  voiceEffectId: VoiceEffectId;
}) {
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const microphoneApplyVersionRef = useRef(0);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      return undefined;
    }

    let isCancelled = false;
    const applyVersion = microphoneApplyVersionRef.current + 1;
    microphoneApplyVersionRef.current = applyVersion;

    const shouldStopMicrophoneWork = () => isCancelled || microphoneApplyVersionRef.current !== applyVersion || muteRef.current;

    async function applyMicrophoneState() {
      async function publishMicrophoneWithAudioRecovery() {
        try {
          return await publishCallMicrophoneTrack(localParticipant, audioOptions, voiceEffectId);
        } catch (error) {
          await restoreCallAudio(mode, mode === 'video').catch(() => undefined);

          if (shouldStopMicrophoneWork()) {
            return undefined;
          }

          await delay(220);
          return publishCallMicrophoneTrack(localParticipant, audioOptions, voiceEffectId);
        }
      }

      if (callKitAudioManaged) {
        await prepareCallKitManagedCallAudio(mode).catch(() => undefined);
      }

      if (!canPublish) {
        if (canPrePublishPaused && !muteRef.current) {
          const publication = await publishMicrophoneWithAudioRecovery();

          if (isCancelled || microphoneApplyVersionRef.current !== applyVersion) {
            return;
          }

          if (muteRef.current) {
            await disableCallMicrophone(localParticipant);
            return;
          }

          await publication?.pauseUpstream().catch(() => undefined);
          return;
        }

        await disableCallMicrophone(localParticipant);
        return;
      }

      if (muteRef.current) {
        await disableCallMicrophone(localParticipant);
        return;
      }

      const publication = await publishMicrophoneWithAudioRecovery();

      if (shouldStopMicrophoneWork()) {
        if (muteRef.current) {
          await disableCallMicrophone(localParticipant);
        }
        return;
      }

      await publication?.unmute();
      await publication?.resumeUpstream().catch(() => undefined);

      if (shouldStopMicrophoneWork()) {
        await disableCallMicrophone(localParticipant);
        return;
      }

      onMuted(false);

      setNativeLiveVoiceEffect(voiceEffectId);
      const isEffectAttached = await confirmNativeLiveVoiceEffectAttached(voiceEffectId);
      const isEffectProcessing = await waitForNativeLiveVoiceProcessing(voiceEffectId);

      if (Platform.OS === 'android' && voiceEffectId !== DEFAULT_VOICE_EFFECT_ID && (!isEffectAttached || !isEffectProcessing)) {
        const microphoneTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track as RestartableAudioTrack | undefined;
        await microphoneTrack?.restartTrack?.().catch(() => undefined);

        if (shouldStopMicrophoneWork()) {
          await disableCallMicrophone(localParticipant);
          return;
        }

        const restartedTrackIsProcessing = await waitForNativeLiveVoiceProcessing(voiceEffectId);

        if (!restartedTrackIsProcessing) {
          const nextPublication = await publishMicrophoneWithAudioRecovery();

          if (shouldStopMicrophoneWork()) {
            await disableCallMicrophone(localParticipant);
            return;
          }

          await nextPublication?.unmute();
          await nextPublication?.resumeUpstream().catch(() => undefined);

          if (shouldStopMicrophoneWork()) {
            await disableCallMicrophone(localParticipant);
            return;
          }
        }

        await confirmNativeLiveVoiceEffectAttached(voiceEffectId);
        await waitForNativeLiveVoiceProcessing(voiceEffectId);

        if (shouldStopMicrophoneWork()) {
          await disableCallMicrophone(localParticipant);
        }
      }
    }

    void applyMicrophoneState().catch((error) => {
      logCallDebug('call-audio-microphone-apply-failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [audioOptions, callKitAudioManaged, canPrePublishPaused, canPublish, connectionState, isMuted, localParticipant, mode, muteRef, onMuted, voiceEffectId]);

  return null;
}

function CallVideoPublisher({
  canPublish,
  canPrePublishPaused,
  cameraFacing,
  isCameraOff,
  isGroupCall,
  onLocalCameraPublished,
  onPreviewTrackPublished,
  onTimingEvent,
  previewVideoTrack,
}: {
  canPublish: boolean;
  canPrePublishPaused: boolean;
  cameraFacing: CameraFacingMode;
  isCameraOff: boolean;
  isGroupCall?: boolean;
  onLocalCameraPublished: (value: boolean) => void;
  onPreviewTrackPublished: (track?: LocalVideoTrack | null) => void;
  onTimingEvent: (event: string, details?: Record<string, unknown>) => void;
  previewVideoTrack: LocalVideoTrack | null;
}) {
  const connectionState = useConnectionState();
  const room = useRoomContext();
  const roomParticipants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const cameraPublishPromiseRef = useRef<Promise<LocalTrackPublication | undefined> | null>(null);
  const cameraEnablePromiseRef = useRef<Promise<void> | null>(null);
  const latestCanPublishRef = useRef(canPublish);
  const latestCameraOffRef = useRef(isCameraOff);
  const cameraApplyVersionRef = useRef(0);
  const cameraPublishAttemptStartedAtRef = useRef(0);
  const lastCameraHealthRecoveryAtRef = useRef(0);
  const iosBackgroundCameraRestoreRef = useRef(false);
  const iosBackgroundCameraOperationRef = useRef<Promise<void> | null>(null);
  const iosBackgroundCameraDisabledRef = useRef(false);
  const iosBackgroundCameraDisableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iosBackgroundCameraGenerationRef = useRef(0);
  const videoNetworkBadSamplesRef = useRef(0);
  const videoNetworkStableSinceRef = useRef(0);
  const videoNetworkLastSwitchAtRef = useRef(0);
  const rtcStatsBadSamplesRef = useRef(0);
  const rtcStatsPreviousByIdRef = useRef(new Map<string, CallRtcStatsPrevious>());
  const firstCameraPublishedAtRef = useRef(0);
  const videoNetworkProfileRef = useRef<CallVideoNetworkProfile>('normal');
  const lastAppliedVideoNetworkProfileRef = useRef<CallVideoNetworkProfile>('normal');
  const [iosMultitaskingCameraSupported, setIosMultitaskingCameraSupported] = useState(Platform.OS !== 'ios');
  const [cameraHealthRecoveryTick, setCameraHealthRecoveryTick] = useState(0);
  const [videoNetworkProfile, setVideoNetworkProfile] = useState<CallVideoNetworkProfile>('normal');
  const effectiveIsGroupCall = isGroupCall === true || roomParticipants.length > 2;

  useEffect(() => {
    latestCanPublishRef.current = canPublish;
  }, [canPublish]);

  useEffect(() => {
    latestCameraOffRef.current = isCameraOff;
  }, [isCameraOff]);

  useEffect(() => {
    videoNetworkProfileRef.current = videoNetworkProfile;
  }, [videoNetworkProfile]);

  const switchVideoProfile = useCallback((nextProfile: CallVideoNetworkProfile, reason: string, details?: Record<string, unknown>) => {
    const currentProfile = videoNetworkProfileRef.current;

    if (nextProfile === currentProfile) {
      return;
    }

    const now = Date.now();
    const isDowngrade = getCallVideoProfileRank(nextProfile) > getCallVideoProfileRank(currentProfile);

    const minInterval = isDowngrade ? 2_000 : CALL_VIDEO_PROFILE_SWITCH_MIN_INTERVAL_MS;

    if (now - videoNetworkLastSwitchAtRef.current < minInterval) {
      return;
    }

    videoNetworkLastSwitchAtRef.current = now;
    videoNetworkProfileRef.current = nextProfile;
    setVideoNetworkProfile(nextProfile);
    onTimingEvent('video-network-profile-switch', {
      ...details,
      from: currentProfile,
      reason,
      to: nextProfile,
    });
  }, [onTimingEvent]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || !canPublish || isCameraOff) {
      return undefined;
    }

    function handleLocalConnectionQuality(quality: ConnectionQuality) {
      const now = Date.now();

      if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) {
        videoNetworkStableSinceRef.current = 0;
        videoNetworkBadSamplesRef.current += 1;

        if (videoNetworkBadSamplesRef.current >= CALL_VIDEO_CRITICAL_BAD_SAMPLE_COUNT) {
          switchVideoProfile('critical', `quality-${quality}`);
          return;
        }

        if (videoNetworkBadSamplesRef.current >= CALL_VIDEO_DEGRADE_BAD_SAMPLE_COUNT) {
          switchVideoProfile('degraded', `quality-${quality}`);
        }
        return;
      }

      if (quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent) {
        videoNetworkBadSamplesRef.current = 0;

        if (videoNetworkStableSinceRef.current === 0) {
          videoNetworkStableSinceRef.current = now;
        }

        if (
          videoNetworkProfileRef.current !== 'normal' &&
          now - videoNetworkStableSinceRef.current >= CALL_VIDEO_RECOVERY_STABLE_MS
        ) {
          switchVideoProfile('normal', `quality-recovered-${quality}`);
        }
      }
    }

    const handleConnectionQualityChanged = (
      quality: ConnectionQuality,
      participant: { identity?: string } | undefined,
    ) => {
      if (participant?.identity !== localParticipant.identity) {
        return;
      }

      handleLocalConnectionQuality(quality);
    };

    room.on(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged);
    const recoveryInterval = setInterval(() => {
      const stableSince = videoNetworkStableSinceRef.current;

      if (
        stableSince > 0 &&
        videoNetworkProfileRef.current !== 'normal' &&
        Date.now() - stableSince >= CALL_VIDEO_RECOVERY_STABLE_MS
      ) {
        switchVideoProfile('normal', 'quality-recovery-timer');
      }
    }, 2_000);

    return () => {
      clearInterval(recoveryInterval);
      room.off(RoomEvent.ConnectionQualityChanged, handleConnectionQualityChanged);
    };
  }, [canPublish, connectionState, isCameraOff, localParticipant.identity, room, switchVideoProfile]);

  useEffect(() => {
    if (
      connectionState !== ConnectionState.Connected ||
      !canPublish ||
      isCameraOff ||
      firstCameraPublishedAtRef.current === 0
    ) {
      rtcStatsBadSamplesRef.current = 0;
      rtcStatsPreviousByIdRef.current.clear();
      return undefined;
    }

    let isCancelled = false;

    async function sampleRtcStats() {
      // Initial reports are incomplete while publication and subscriber
      // negotiation settle. Treating them as congestion changed the sender layer
      // before either peer had rendered its first frame.
      if (Date.now() - firstCameraPublishedAtRef.current < CALL_VIDEO_ADAPTATION_BOOTSTRAP_GRACE_MS) {
        return;
      }

      const statsProfile = getUplinkNetworkProfileFromRtcStats(
        await collectCallRtcStatsSnapshot(room, rtcStatsPreviousByIdRef).catch(() => ({})),
      );

      if (isCancelled || !statsProfile) {
        return;
      }

      if (statsProfile === 'normal') {
        rtcStatsBadSamplesRef.current = 0;

        if (videoNetworkStableSinceRef.current === 0) {
          videoNetworkStableSinceRef.current = Date.now();
        }
        return;
      }

      videoNetworkStableSinceRef.current = 0;
      rtcStatsBadSamplesRef.current += 1;

      if (
        statsProfile === 'critical' &&
        rtcStatsBadSamplesRef.current >= CALL_WEBRTC_STATS_CRITICAL_BAD_SAMPLE_COUNT
      ) {
        switchVideoProfile('critical', 'rtc-stats-critical');
        return;
      }

      if (rtcStatsBadSamplesRef.current >= CALL_WEBRTC_STATS_DEGRADE_BAD_SAMPLE_COUNT) {
        switchVideoProfile('degraded', `rtc-stats-${statsProfile}`);
      }
    }

    void sampleRtcStats();
    const interval = setInterval(() => {
      void sampleRtcStats();
    }, CALL_WEBRTC_STATS_SAMPLE_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [canPublish, connectionState, isCameraOff, room, switchVideoProfile]);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return undefined;
    }

    let isCancelled = false;

    isIosMultitaskingCameraAccessSupported()
      .then((isSupported) => {
        if (isCancelled) {
          return;
        }

        setIosMultitaskingCameraSupported(isSupported);
        onTimingEvent('ios-multitasking-camera-support', { isSupported });
      })
      .catch(() => {
        if (!isCancelled) {
          setIosMultitaskingCameraSupported(false);
          onTimingEvent('ios-multitasking-camera-support', { isSupported: false });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [onTimingEvent]);

  useEffect(() => () => {
    const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
    const cameraTrack = cameraPublication?.track as LocalVideoTrack | undefined;

    onTimingEvent('local-camera-publisher-unmount', {
      hasPublication: !!cameraPublication,
      hasTrack: !!cameraTrack,
      isMuted: cameraPublication?.isMuted === true,
      mediaTrackId: cameraTrack?.mediaStreamTrack.id,
      readyState: cameraTrack?.mediaStreamTrack.readyState,
      trackSid: cameraPublication?.trackSid,
      upstreamPaused: cameraTrack?.isUpstreamPaused === true,
    });
  }, [localParticipant, onTimingEvent]);

  const publishPreviewCameraTrack = useCallback(async () => {
    const existingPublication = localParticipant.getTrackPublication(Track.Source.Camera);

    if (existingPublication?.track) {
      onTimingEvent('local-camera-preview-publish-reuse-existing', {
        isMuted: existingPublication.isMuted === true,
        readyState: (existingPublication.track as LocalVideoTrack | undefined)?.mediaStreamTrack.readyState,
        trackSid: existingPublication.trackSid,
      });
      return existingPublication;
    }

    if (!previewVideoTrack) {
      onTimingEvent('local-camera-preview-publish-no-preview-track');
      return undefined;
    }

    if (cameraPublishPromiseRef.current) {
      onTimingEvent('local-camera-preview-publish-await-existing-promise', {
        mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
        readyState: previewVideoTrack.mediaStreamTrack.readyState,
      });
      return cameraPublishPromiseRef.current;
    }

    onTimingEvent('local-camera-preview-publish-request', {
      isGroupCall: effectiveIsGroupCall,
      mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
      muted: previewVideoTrack.mediaStreamTrack.muted,
      networkProfile: videoNetworkProfileRef.current,
      readyState: previewVideoTrack.mediaStreamTrack.readyState,
    });
    cameraPublishAttemptStartedAtRef.current = Date.now();
    const publishPromise = withCameraOperationTimeout(
      localParticipant.publishTrack(
        previewVideoTrack,
        getCallVideoPublishOptions(effectiveIsGroupCall, videoNetworkProfileRef.current),
      ),
      CAMERA_PREVIEW_PUBLISH_TIMEOUT_MS,
      'Local camera preview publication',
      () => {
        onTimingEvent('local-camera-preview-publish-late-cleanup', {
          mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
        });
        void localParticipant.unpublishTrack(previewVideoTrack, true).catch(() => undefined);
      },
    );
    cameraPublishPromiseRef.current = publishPromise;

    try {
      const publication = await publishPromise;
      onTimingEvent('local-camera-preview-publish-resolved', {
        hasTrack: !!publication.track,
        isMuted: publication.isMuted === true,
        mediaTrackId: (publication.track as LocalVideoTrack | undefined)?.mediaStreamTrack.id,
        readyState: (publication.track as LocalVideoTrack | undefined)?.mediaStreamTrack.readyState,
        trackSid: publication.trackSid,
      });
      return publication;
    } finally {
      if (cameraPublishPromiseRef.current === publishPromise) {
        cameraPublishPromiseRef.current = null;
      }
    }
  }, [effectiveIsGroupCall, localParticipant, onTimingEvent, previewVideoTrack]);

  const setCameraEnabledSafely = useCallback(async (
    useGroupVideoProfile: boolean,
    waitMs: number,
    profile: CallVideoNetworkProfile = videoNetworkProfileRef.current,
  ) => {
    if (cameraEnablePromiseRef.current) {
      onTimingEvent('local-camera-enable-await-existing', {
        isGroupCall: useGroupVideoProfile,
        profile,
        waitMs,
      });
      await cameraEnablePromiseRef.current;
      return;
    }

    const enablePromise = (async () => {
      try {
        cameraPublishAttemptStartedAtRef.current = Date.now();
        const cameraCooldownRemaining = Math.max(0, CAMERA_REACQUIRE_COOLDOWN_MS - (Date.now() - lastCameraReleaseAt));

        if (cameraCooldownRemaining > 0) {
          onTimingEvent('local-camera-enable-cooldown', {
            isGroupCall: useGroupVideoProfile,
            waitMs: cameraCooldownRemaining,
          });
          await delay(cameraCooldownRemaining);
        }

        await localParticipant.setCameraEnabled(
          true,
          getCallVideoCaptureOptions(useGroupVideoProfile, cameraFacing, profile),
          getCallVideoPublishOptions(useGroupVideoProfile, profile),
        );
      } catch (error) {
        onTimingEvent('local-camera-set-enabled-failed', {
          isGroupCall: useGroupVideoProfile,
          message: error instanceof Error ? error.message : 'unknown',
          profile,
          waitMs,
        });
      }
    })();
    cameraEnablePromiseRef.current = enablePromise;

    try {
      await enablePromise;
    } finally {
      if (cameraEnablePromiseRef.current === enablePromise) {
        cameraEnablePromiseRef.current = null;
      }
    }
  }, [cameraFacing, localParticipant, onTimingEvent]);

  useEffect(() => {
    if (
      Platform.OS !== 'ios' ||
      iosMultitaskingCameraSupported ||
      connectionState !== ConnectionState.Connected ||
      !canPublish
    ) {
      return undefined;
    }

    function getCameraState() {
      const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const cameraTrack = cameraPublication?.track as LocalVideoTrack | undefined;

      return {
        cameraPublication,
        cameraTrack,
        hasPublication: !!cameraPublication,
        hasTrack: !!cameraTrack,
        isMuted: cameraPublication?.isMuted === true,
        mediaTrackId: cameraTrack?.mediaStreamTrack.id,
        readyState: cameraTrack?.mediaStreamTrack.readyState,
        trackSid: cameraPublication?.trackSid,
        upstreamPaused: cameraTrack?.isUpstreamPaused === true,
      };
    }

    function setOperation(operation: Promise<void>) {
      iosBackgroundCameraOperationRef.current = operation;
      void operation.finally(() => {
        if (iosBackgroundCameraOperationRef.current === operation) {
          iosBackgroundCameraOperationRef.current = null;
        }
      });
    }

    function clearPendingBackgroundCameraDisable() {
      if (iosBackgroundCameraDisableTimerRef.current) {
        clearTimeout(iosBackgroundCameraDisableTimerRef.current);
        iosBackgroundCameraDisableTimerRef.current = null;
        iosBackgroundCameraGenerationRef.current += 1;
      }
    }

    function disableCameraForBackground(reason: 'background' | 'inactive', generation: number) {
      if (generation !== iosBackgroundCameraGenerationRef.current) {
        onTimingEvent('ios-background-camera-disable-cancelled', { reason });
        return;
      }

      if (latestCameraOffRef.current || iosBackgroundCameraDisabledRef.current) {
        return;
      }

      const cameraState = getCameraState();

      if (
        !cameraState.cameraPublication ||
        cameraState.cameraPublication.isMuted === true ||
        !cameraState.cameraTrack ||
        cameraState.cameraTrack.mediaStreamTrack.readyState !== 'live'
      ) {
        onTimingEvent('ios-background-camera-disable-skip', { ...cameraState, reason });
        return;
      }

      iosBackgroundCameraRestoreRef.current = true;
      iosBackgroundCameraDisabledRef.current = true;

      const operation = (async () => {
        onTimingEvent('ios-background-camera-disable-start', { ...cameraState, reason });
        await localParticipant.setCameraEnabled(false).catch((error) => {
          onTimingEvent('ios-background-camera-disable-failed', {
            message: error instanceof Error ? error.message : 'unknown',
            reason,
            trackSid: cameraState.trackSid,
          });
        });
        lastCameraReleaseAt = Date.now();
        onLocalCameraPublished(false);
        onTimingEvent('ios-background-camera-disable-complete', { ...getCameraState(), reason });
      })();

      setOperation(operation);
    }

    function restoreCameraAfterBackground() {
      if (!iosBackgroundCameraRestoreRef.current) {
        return;
      }

      iosBackgroundCameraRestoreRef.current = false;
      const pendingBackgroundOperation = iosBackgroundCameraOperationRef.current;

      const operation = (async () => {
        await pendingBackgroundOperation?.catch(() => undefined);
        iosBackgroundCameraDisabledRef.current = false;

        if (latestCameraOffRef.current || !latestCanPublishRef.current) {
          onTimingEvent('ios-background-camera-restore-skip', {
            canPublish: latestCanPublishRef.current,
            isCameraOff: latestCameraOffRef.current,
          });
          return;
        }

        onTimingEvent('ios-background-camera-restore-start', getCameraState());
        await setCameraEnabledSafely(effectiveIsGroupCall, 0);

        const cameraState = getCameraState();
        await cameraState.cameraPublication?.unmute().catch(() => undefined);
        await cameraState.cameraTrack?.resumeUpstream().catch(() => undefined);

        const restoredState = getCameraState();
        const isHealthy = !!restoredState.cameraPublication &&
          restoredState.cameraPublication.isMuted !== true &&
          !!restoredState.cameraTrack &&
          restoredState.cameraTrack.mediaStreamTrack.readyState === 'live' &&
          restoredState.cameraTrack.isUpstreamPaused !== true;

        onLocalCameraPublished(isHealthy);
        onTimingEvent('ios-background-camera-restore-complete', {
          ...restoredState,
          isHealthy,
        });

        if (!isHealthy) {
          setCameraHealthRecoveryTick((current) => current + 1);
        } else if (firstCameraPublishedAtRef.current === 0) {
          firstCameraPublishedAtRef.current = Date.now();
        }
      })();

      setOperation(operation);
    }

    function scheduleCameraDisableForAppState(nextState: 'background' | 'inactive') {
      clearPendingBackgroundCameraDisable();

      const generation = iosBackgroundCameraGenerationRef.current + 1;
      iosBackgroundCameraGenerationRef.current = generation;

      if (nextState === 'background') {
        disableCameraForBackground('background', generation);
        return;
      }

      iosBackgroundCameraDisableTimerRef.current = setTimeout(() => {
        iosBackgroundCameraDisableTimerRef.current = null;
        disableCameraForBackground('inactive', generation);
      }, IOS_BACKGROUND_CAMERA_INACTIVE_GRACE_MS);
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'inactive' || nextState === 'background') {
        scheduleCameraDisableForAppState(nextState);
        return;
      }

      if (nextState === 'active') {
        clearPendingBackgroundCameraDisable();
        restoreCameraAfterBackground();
      }
    });

    return () => {
      clearPendingBackgroundCameraDisable();
      subscription.remove();
    };
  }, [
    canPublish,
    connectionState,
    effectiveIsGroupCall,
    iosMultitaskingCameraSupported,
    localParticipant,
    onLocalCameraPublished,
    onTimingEvent,
    setCameraEnabledSafely,
  ]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || !canPublish || isCameraOff) {
      return undefined;
    }

    const interval = setInterval(() => {
      if (
        Platform.OS === 'ios' &&
        (
          AppState.currentState !== 'active' ||
          iosBackgroundCameraDisabledRef.current ||
          iosBackgroundCameraOperationRef.current
        )
      ) {
        return;
      }

      const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const cameraTrack = cameraPublication?.track as LocalVideoTrack | undefined;
      const isHealthy = !!cameraPublication &&
        cameraPublication.isMuted !== true &&
        !!cameraTrack &&
        cameraTrack.mediaStreamTrack.readyState === 'live' &&
        cameraTrack.isUpstreamPaused !== true;

      if (isHealthy) {
        return;
      }

      const now = Date.now();

      if (
        firstCameraPublishedAtRef.current === 0 &&
        now - cameraPublishAttemptStartedAtRef.current < CALL_VIDEO_ADAPTATION_BOOTSTRAP_GRACE_MS
      ) {
        return;
      }

      if (cameraPublishPromiseRef.current || cameraEnablePromiseRef.current || now - cameraPublishAttemptStartedAtRef.current < 2600) {
        return;
      }

      if (now - lastCameraHealthRecoveryAtRef.current < 1800) {
        return;
      }

      lastCameraHealthRecoveryAtRef.current = now;
      onTimingEvent('local-camera-health-recover', {
        hasPublication: !!cameraPublication,
        hasTrack: !!cameraTrack,
        isMuted: cameraPublication?.isMuted === true,
        mediaTrackId: cameraTrack?.mediaStreamTrack.id,
        readyState: cameraTrack?.mediaStreamTrack.readyState,
        trackSid: cameraPublication?.trackSid,
        upstreamPaused: cameraTrack?.isUpstreamPaused === true,
      });
      setCameraHealthRecoveryTick((current) => current + 1);
    }, 900);

    return () => clearInterval(interval);
  }, [canPublish, connectionState, isCameraOff, localParticipant, onTimingEvent]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      onTimingEvent('local-camera-apply-skip-not-connected', {
        canPrePublishPaused,
        canPublish,
        connectionState,
        isCameraOff,
        previewReadyState: previewVideoTrack?.mediaStreamTrack.readyState,
      });
      return undefined;
    }

    let isCancelled = false;
    const applyVersion = cameraApplyVersionRef.current + 1;
    cameraApplyVersionRef.current = applyVersion;

    async function applyCameraState() {
      if (latestCameraOffRef.current) {
        onTimingEvent('local-camera-disabled', {
          canPublish,
          cameraOff: latestCameraOffRef.current,
          connectionState,
        });
        await localParticipant.setCameraEnabled(false).catch(() => undefined);
        onLocalCameraPublished(false);
        return;
      }

      const existingCameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const existingCameraTrack = existingCameraPublication?.track as LocalVideoTrack | undefined;
      const currentVideoProfile = videoNetworkProfileRef.current;

      onTimingEvent('local-camera-apply-state', {
        applyVersion,
        canPrePublishPaused,
        canPublish,
        existingHasPublication: !!existingCameraPublication,
        existingHasTrack: !!existingCameraTrack,
        existingIsMuted: existingCameraPublication?.isMuted === true,
        existingMediaTrackId: existingCameraTrack?.mediaStreamTrack.id,
        existingReadyState: existingCameraTrack?.mediaStreamTrack.readyState,
        existingTrackSid: existingCameraPublication?.trackSid,
        existingUpstreamPaused: existingCameraTrack?.isUpstreamPaused === true,
        isCameraOff: latestCameraOffRef.current,
        isGroupCall: effectiveIsGroupCall,
        networkProfile: currentVideoProfile,
        roomParticipantCount: roomParticipants.length,
        previewMediaTrackId: previewVideoTrack?.mediaStreamTrack.id,
        previewReadyState: previewVideoTrack?.mediaStreamTrack.readyState,
      });

      const existingCameraIsStale = !!existingCameraPublication &&
        !!existingCameraTrack &&
        (existingCameraPublication.isMuted === true || existingCameraTrack.mediaStreamTrack.readyState !== 'live');

      if (existingCameraIsStale) {
        onTimingEvent('local-camera-stale-publication-reset', {
          existingIsMuted: existingCameraPublication?.isMuted === true,
          existingMediaTrackId: existingCameraTrack?.mediaStreamTrack.id,
          existingReadyState: existingCameraTrack?.mediaStreamTrack.readyState,
          existingTrackSid: existingCameraPublication?.trackSid,
          isGroupCall: effectiveIsGroupCall,
        });
        await localParticipant.setCameraEnabled(false).catch((error) => {
          onTimingEvent('local-camera-stale-disable-failed', {
            message: error instanceof Error ? error.message : 'unknown',
            trackSid: existingCameraPublication?.trackSid,
          });
        });
        lastCameraReleaseAt = Date.now();
        await delay(150);
      } else if (existingCameraPublication && existingCameraTrack && existingCameraPublication.isMuted !== true) {
        if (!canPublish) {
          if (!canPrePublishPaused) {
            onTimingEvent('local-camera-disabled', {
              canPublish,
              cameraOff: latestCameraOffRef.current,
              connectionState,
            });
            await localParticipant.setCameraEnabled(false).catch(() => undefined);
            onLocalCameraPublished(false);
            return;
          }

          await existingCameraTrack.pauseUpstream().catch((error) => {
            onTimingEvent('local-camera-prepublish-pause-failed', {
              message: error instanceof Error ? error.message : 'unknown',
              trackSid: existingCameraPublication.trackSid,
            });
          });
          onTimingEvent('local-camera-prepublish-already-ready', {
            trackSid: existingCameraPublication.trackSid,
            upstreamPaused: existingCameraTrack.isUpstreamPaused === true,
          });
          return;
        }

        await existingCameraTrack.resumeUpstream().catch((error) => {
          onTimingEvent('local-camera-resume-upstream-failed', {
            message: error instanceof Error ? error.message : 'unknown',
            trackSid: existingCameraPublication.trackSid,
          });
        });

        if (currentVideoProfile !== lastAppliedVideoNetworkProfileRef.current) {
          existingCameraTrack.setPublishingQuality?.(getPublishingQualityForNetworkProfile(currentVideoProfile));
          lastAppliedVideoNetworkProfileRef.current = currentVideoProfile;
          onTimingEvent('local-camera-profile-layer-applied', {
            networkProfile: currentVideoProfile,
            trackSid: existingCameraPublication.trackSid,
          });
        }

        if (previewVideoTrack && existingCameraTrack === previewVideoTrack) {
          onTimingEvent('local-camera-detach-preview-after-existing-publish', {
            mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
            readyState: previewVideoTrack.mediaStreamTrack.readyState,
            trackSid: existingCameraPublication.trackSid,
          });
          onPreviewTrackPublished(previewVideoTrack);
        }

        if (firstCameraPublishedAtRef.current === 0) {
          firstCameraPublishedAtRef.current = Date.now();
        }
        onLocalCameraPublished(true);
        onTimingEvent('local-camera-already-published', {
          trackSid: existingCameraPublication.trackSid,
          upstreamPaused: existingCameraTrack.isUpstreamPaused === true,
        });
        return;
      }

      if (!canPublish) {
        if (canPrePublishPaused) {
          if (!previewVideoTrack) {
            onTimingEvent('local-camera-prepublish-start', { reusedPreviewTrack: false });
            await setCameraEnabledSafely(effectiveIsGroupCall, 0, currentVideoProfile);

            const publication = localParticipant.getTrackPublication(Track.Source.Camera);
            const publicationTrack = publication?.track as LocalVideoTrack | undefined;

            if (!publication || !publicationTrack || publicationTrack.mediaStreamTrack.readyState !== 'live') {
              onTimingEvent('local-camera-prepublish-no-publication');
              return;
            }

            if (!latestCanPublishRef.current) {
              await publicationTrack.pauseUpstream().catch((error) => {
                onTimingEvent('local-camera-prepublish-pause-failed', {
                  message: error instanceof Error ? error.message : 'unknown',
                  trackSid: publication.trackSid,
                });
              });
            }

            if (isCancelled || cameraApplyVersionRef.current !== applyVersion || latestCameraOffRef.current) {
              return;
            }

            onTimingEvent('local-camera-prepublish-ready', {
              trackSid: publication.trackSid,
              upstreamPaused: publicationTrack.isUpstreamPaused === true,
            });
            return;
          }

          try {
            onTimingEvent('local-camera-prepublish-start', { reusedPreviewTrack: true });
            const publication = await publishPreviewCameraTrack();
            const publicationTrack = publication?.track as LocalVideoTrack | undefined;

            if (!publication || !publicationTrack) {
              onTimingEvent('local-camera-prepublish-no-publication');
              return;
            }

            if (!latestCanPublishRef.current) {
              await publicationTrack.pauseUpstream().catch((error) => {
                onTimingEvent('local-camera-prepublish-pause-failed', {
                  message: error instanceof Error ? error.message : 'unknown',
                  trackSid: publication.trackSid,
                });
              });
            }

            if (isCancelled || cameraApplyVersionRef.current !== applyVersion || latestCameraOffRef.current) {
              return;
            }

            onTimingEvent('local-camera-prepublish-ready', {
              trackSid: publication.trackSid,
              upstreamPaused: publicationTrack.isUpstreamPaused === true,
            });
          } catch (error) {
            onTimingEvent('local-camera-prepublish-failed', {
              message: error instanceof Error ? error.message : 'unknown',
              mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
              readyState: previewVideoTrack.mediaStreamTrack.readyState,
            });
          }
          return;
        }

        onTimingEvent('local-camera-disabled', {
          canPublish,
          cameraOff: latestCameraOffRef.current,
          connectionState,
        });
        await localParticipant.setCameraEnabled(false).catch(() => undefined);
        onLocalCameraPublished(false);
        return;
      }

      if (isCancelled || cameraApplyVersionRef.current !== applyVersion || latestCameraOffRef.current) {
        if (latestCameraOffRef.current || !latestCanPublishRef.current) {
          await localParticipant.setCameraEnabled(false).catch(() => undefined);
          lastCameraReleaseAt = Date.now();
        }
        return;
      }

      if (previewVideoTrack) {
        try {
          onTimingEvent('local-camera-publish-start', { reusedPreviewTrack: true });
          const publication = await publishPreviewCameraTrack();
          const publicationTrack = publication?.track as LocalVideoTrack | undefined;

          await publicationTrack?.resumeUpstream().catch((error) => {
            onTimingEvent('local-camera-resume-upstream-failed', {
              message: error instanceof Error ? error.message : 'unknown',
              trackSid: publication?.trackSid,
            });
          });

          const publishedPreviewIsHealthy = !!publication &&
            publication.isMuted !== true &&
            !!publicationTrack &&
            publicationTrack.mediaStreamTrack.readyState === 'live';

          if (
            publishedPreviewIsHealthy &&
            (isCancelled || cameraApplyVersionRef.current !== applyVersion)
          ) {
            onTimingEvent('local-camera-preview-publish-superseded', {
              applyVersion,
              currentApplyVersion: cameraApplyVersionRef.current,
              trackSid: publication.trackSid,
            });
            return;
          }

          if (
            publishedPreviewIsHealthy &&
            !isCancelled &&
            cameraApplyVersionRef.current === applyVersion &&
            !latestCameraOffRef.current
          ) {
            publicationTrack.setPublishingQuality?.(getPublishingQualityForNetworkProfile(currentVideoProfile));
            lastAppliedVideoNetworkProfileRef.current = currentVideoProfile;
            onPreviewTrackPublished(previewVideoTrack);
            if (firstCameraPublishedAtRef.current === 0) {
              firstCameraPublishedAtRef.current = Date.now();
            }
            onLocalCameraPublished(true);
            onTimingEvent('local-camera-published', { reusedPreviewTrack: true });
            return;
          }

          onTimingEvent('local-camera-preview-publish-unhealthy', {
            hasPublication: !!publication,
            hasTrack: !!publicationTrack,
            isMuted: publication?.isMuted === true,
            mediaTrackId: publicationTrack?.mediaStreamTrack.id,
            readyState: publicationTrack?.mediaStreamTrack.readyState,
            trackSid: publication?.trackSid,
          });
        } catch (error) {
          onTimingEvent('local-camera-preview-publish-failed', {
            message: error instanceof Error ? error.message : 'unknown',
            mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
            readyState: previewVideoTrack.mediaStreamTrack.readyState,
          });
        }

        onTimingEvent('local-camera-preview-publish-bypassed', {
          mediaTrackId: previewVideoTrack.mediaStreamTrack.id,
          readyState: previewVideoTrack.mediaStreamTrack.readyState,
        });
      }

      if (isCancelled || cameraApplyVersionRef.current !== applyVersion || latestCameraOffRef.current) {
        if (latestCameraOffRef.current || !latestCanPublishRef.current) {
          await localParticipant.setCameraEnabled(false).catch(() => undefined);
          lastCameraReleaseAt = Date.now();
        }
        return;
      }

      onTimingEvent('local-camera-publish-start', { reusedPreviewTrack: false });
      await setCameraEnabledSafely(effectiveIsGroupCall, 0, currentVideoProfile);

      const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const cameraTrack = cameraPublication?.track as LocalVideoTrack | undefined;

      onTimingEvent('local-camera-publication-check', {
        hasPublication: !!cameraPublication,
        hasTrack: !!cameraPublication?.track,
        isMuted: cameraPublication?.isMuted === true,
        mediaTrackId: cameraTrack?.mediaStreamTrack.id,
        readyState: cameraTrack?.mediaStreamTrack.readyState,
        trackSid: cameraPublication?.trackSid,
        upstreamPaused: cameraTrack?.isUpstreamPaused === true,
        waitMs: 0,
      });

      if (
        cameraPublication &&
        cameraPublication.isMuted !== true &&
        cameraTrack &&
        cameraTrack.mediaStreamTrack.readyState === 'live'
      ) {
        cameraTrack.setPublishingQuality?.(getPublishingQualityForNetworkProfile(currentVideoProfile));
        lastAppliedVideoNetworkProfileRef.current = currentVideoProfile;
        if (firstCameraPublishedAtRef.current === 0) {
          firstCameraPublishedAtRef.current = Date.now();
        }
        onLocalCameraPublished(true);
        onTimingEvent('local-camera-published', { reusedPreviewTrack: false });
      }

      if (isCancelled || cameraApplyVersionRef.current !== applyVersion || latestCameraOffRef.current) {
        if (latestCameraOffRef.current || !latestCanPublishRef.current) {
          await localParticipant.setCameraEnabled(false).catch(() => undefined);
          lastCameraReleaseAt = Date.now();
          onLocalCameraPublished(false);
        }
      }
    }

    void applyCameraState();

    return () => {
      isCancelled = true;
    };
  }, [cameraHealthRecoveryTick, canPrePublishPaused, canPublish, connectionState, effectiveIsGroupCall, isCameraOff, localParticipant, onLocalCameraPublished, onPreviewTrackPublished, onTimingEvent, previewVideoTrack, publishPreviewCameraTrack, roomParticipants.length, setCameraEnabledSafely, videoNetworkProfile]);

  return null;
}

function CallAudioRecoveryMonitor({
  audioOptions,
  callKitAudioManaged,
  canPublish,
  isMuted,
  mode,
  muteRef,
  preferMicrophoneRestart,
  shouldApplyAudioRoute,
  useSpeaker,
  voiceEffectId,
}: {
  audioOptions: CallAudioCaptureOptions;
  callKitAudioManaged: boolean;
  canPublish: boolean;
  isMuted: boolean;
  mode: 'voice' | 'video';
  muteRef: MutableRefObject<boolean>;
  preferMicrophoneRestart: boolean;
  shouldApplyAudioRoute: CallAudioRouteOperationGuard;
  useSpeaker: boolean;
  voiceEffectId: VoiceEffectId;
}) {
  const connectionState = useConnectionState();
  const { localParticipant } = useLocalParticipant();
  const activeRecoveryPromiseRef = useRef<Promise<void> | null>(null);
  const latestStateRef = useRef({ audioOptions, callKitAudioManaged, canPublish, isMuted, mode, useSpeaker, voiceEffectId });

  useEffect(() => {
    latestStateRef.current = { audioOptions, callKitAudioManaged, canPublish, isMuted, mode, useSpeaker, voiceEffectId };
  }, [audioOptions, callKitAudioManaged, canPublish, isMuted, mode, useSpeaker, voiceEffectId]);

  const getMicrophoneHealth = useCallback(() => {
    const publication = localParticipant.getTrackPublication(Track.Source.Microphone);
    const microphoneTrack = publication?.track as RestartableAudioTrack | undefined;
    const readyState = microphoneTrack?.mediaStreamTrack?.readyState;
    const upstreamPaused = microphoneTrack?.isUpstreamPaused === true;

    return {
      hasPublication: !!publication,
      hasTrack: !!microphoneTrack,
      isHealthy: !!publication &&
        publication.isMuted !== true &&
        !!microphoneTrack &&
        readyState === 'live' &&
        !upstreamPaused,
      isMuted: publication?.isMuted === true,
      readyState,
      upstreamPaused,
    };
  }, [localParticipant]);

  const recoverCallAudio = useCallback(async (restartMicrophoneTrack: boolean) => {
    if (activeRecoveryPromiseRef.current) {
      await activeRecoveryPromiseRef.current;
      return;
    }

    const recoveryPromise = (async () => {
      const latestState = latestStateRef.current;

      setNativeLiveVoiceEffect(latestState.voiceEffectId);
      if (latestState.callKitAudioManaged) {
        await prepareCallKitManagedCallAudio(latestState.mode).catch(() => undefined);
      } else if (restartMicrophoneTrack) {
        await restoreCallAudio(latestState.mode, latestState.useSpeaker, shouldApplyAudioRoute).catch(() => undefined);
      } else {
        await forceCallAudioRoute(
          latestState.useSpeaker,
          latestState.mode === 'video',
          undefined,
          shouldApplyAudioRoute,
          latestState.mode === 'video',
        ).catch(() => undefined);
      }
      setNativeLiveVoiceEffect(latestState.voiceEffectId);

      if (!latestState.canPublish) {
        await disableCallMicrophone(localParticipant);
        return;
      }

      if (muteRef.current || latestState.isMuted) {
        await disableCallMicrophone(localParticipant);
        return;
      }

      let microphoneHealth = getMicrophoneHealth();

      if (!microphoneHealth.hasTrack) {
        await publishCallMicrophoneTrack(
          localParticipant,
          latestState.audioOptions,
          latestState.voiceEffectId,
        ).catch(() => undefined);

        if (muteRef.current) {
          await disableCallMicrophone(localParticipant);
          return;
        }
      }

      const microphonePublication = localParticipant.getTrackPublication(Track.Source.Microphone);
      await microphonePublication?.unmute().catch(() => undefined);
      await microphonePublication?.resumeUpstream().catch(() => undefined);
      microphoneHealth = getMicrophoneHealth();

      if (restartMicrophoneTrack) {
        if (muteRef.current) {
          await disableCallMicrophone(localParticipant);
          return;
        }

        if (Platform.OS === 'android' && latestState.voiceEffectId !== DEFAULT_VOICE_EFFECT_ID) {
          await publishCallMicrophoneTrack(
            localParticipant,
            latestState.audioOptions,
            latestState.voiceEffectId,
          ).catch(() => undefined);

          if (muteRef.current) {
            await disableCallMicrophone(localParticipant);
            return;
          }
        } else if (Platform.OS === 'ios') {
          if (microphoneHealth.isHealthy) {
            logCallDebug('call-audio-mic-healthy-skip-republish', {
              readyState: microphoneHealth.readyState,
              upstreamPaused: microphoneHealth.upstreamPaused,
            });
            return;
          }

          logCallDebug('call-audio-mic-republish-needed', {
            hasPublication: microphoneHealth.hasPublication,
            hasTrack: microphoneHealth.hasTrack,
            isMuted: microphoneHealth.isMuted,
            readyState: microphoneHealth.readyState,
            upstreamPaused: microphoneHealth.upstreamPaused,
          });

          await republishCallMicrophoneTrack(
            localParticipant,
            latestState.audioOptions,
            latestState.voiceEffectId,
          ).catch(() => undefined);

          if (muteRef.current) {
            await disableCallMicrophone(localParticipant);
            return;
          }
        } else {
          const microphoneTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.track as RestartableAudioTrack | undefined;
          await microphoneTrack?.restartTrack?.().catch(() => undefined);
        }
      }

      if (muteRef.current) {
        await disableCallMicrophone(localParticipant);
        return;
      }

      setNativeLiveVoiceEffect(latestState.voiceEffectId);
    })();

    activeRecoveryPromiseRef.current = recoveryPromise;

    try {
      await recoveryPromise;
    } finally {
      if (activeRecoveryPromiseRef.current === recoveryPromise) {
        activeRecoveryPromiseRef.current = null;
      }
    }
  }, [getMicrophoneHealth, localParticipant, muteRef, shouldApplyAudioRoute]);

  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      return undefined;
    }

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const scheduleRecovery = (restartMicrophoneTrack: boolean) => {
      const recoveryDelays = restartMicrophoneTrack ? [900, 1800, 3200] : [900, 1800];
      recoveryDelays.forEach((waitMs) => {
        const timeout = setTimeout(() => {
          void recoverCallAudio(restartMicrophoneTrack && waitMs >= 1200);
        }, waitMs);
        timeouts.push(timeout);
      });
    };

    scheduleRecovery(preferMicrophoneRestart);

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        scheduleRecovery(true);
      }
    });

    return () => {
      subscription.remove();
      timeouts.forEach(clearTimeout);
    };
  }, [connectionState, preferMicrophoneRestart, recoverCallAudio]);

  return null;
}

type CallControlsProps = {
  activeAudioRoute?: CallAudioRoute;
  audioOptions: CallAudioCaptureOptions;
  cameraFacing: CameraFacingMode;
  isCameraOff: boolean;
  isGroupCall?: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  muteRef: MutableRefObject<boolean>;
  showCamera: boolean;
  onCamera: (value: boolean) => void;
  onCameraFacingChange: (value: CameraFacingMode) => void;
  onCameraRenderRefresh: () => void;
  onHangUp: () => void;
  onMuted: (value: boolean) => void;
  onSpeakerLongPress: () => void;
  onSpeakerPress: () => void;
  voiceEffectId: VoiceEffectId;
};

function CallAudioRouteControl({
  activeAudioRoute,
  isSpeakerOn,
  onLongPress,
  onPress,
}: {
  activeAudioRoute?: CallAudioRoute;
  isSpeakerOn: boolean;
  onLongPress: () => void;
  onPress: () => void;
}) {
  const didLongPressRef = useRef(false);

  return (
    <CallControl
      active={activeAudioRoute ? activeAudioRoute.type === 'speaker' : isSpeakerOn}
      icon={getCallAudioRouteIcon(activeAudioRoute)}
      label={getCallAudioRouteLabel(activeAudioRoute)}
      onLongPress={() => {
        didLongPressRef.current = true;
        onLongPress();
      }}
      onPress={() => {
        if (didLongPressRef.current) {
          didLongPressRef.current = false;
          return;
        }

        onPress();
      }}
    />
  );
}

function ScreenShareTopMenu({ cameraFacing, isCameraOff, isGroupCall, onCamera, onCameraRenderRefresh }: {
  cameraFacing: CameraFacingMode;
  isCameraOff: boolean;
  isGroupCall?: boolean;
  onCamera: (value: boolean) => void;
  onCameraRenderRefresh: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const screenCapturePickerRef = useRef(null);
  const screenShareLockDeferralRef = useRef<(() => void) | null>(null);
  const screenShareRestoreCameraRef = useRef(false);
  const [isMenuOpen, setMenuOpen] = useState(false);
  const [isScreenSharing, setScreenSharing] = useState(false);
  const [isStartingScreenShare, setStartingScreenShare] = useState(false);

  function beginScreenShareLockDeferral() {
    if (screenShareLockDeferralRef.current) {
      return;
    }

    screenShareLockDeferralRef.current = beginAppLockForegroundOperation();
  }

  function endScreenShareLockDeferral() {
    const endLockDeferral = screenShareLockDeferralRef.current;

    if (!endLockDeferral) {
      return;
    }

    screenShareLockDeferralRef.current = null;
    endLockDeferral();
  }

  useEffect(() => {
    const updateScreenShareState = () => {
      const publication = localParticipant.getTrackPublication(Track.Source.ScreenShare);
      const isActive = !!publication?.track &&
        publication.isMuted !== true &&
        publication.track.mediaStreamTrack.readyState === 'live';

      setScreenSharing(isActive);
    };
    const handleLocalTrackUnpublished = (publication: { source?: Track.Source }) => {
      updateScreenShareState();
      if (publication.source === Track.Source.ScreenShare) {
        endScreenShareLockDeferral();
        void restoreCameraAfterScreenShare();
      }
    };

    updateScreenShareState();

    room
      .on(RoomEvent.LocalTrackPublished, updateScreenShareState)
      .on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
      .on(RoomEvent.TrackMuted, updateScreenShareState)
      .on(RoomEvent.TrackUnmuted, updateScreenShareState);

    return () => {
      room
        .off(RoomEvent.LocalTrackPublished, updateScreenShareState)
        .off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished)
        .off(RoomEvent.TrackMuted, updateScreenShareState)
        .off(RoomEvent.TrackUnmuted, updateScreenShareState);
    };
  }, [localParticipant, room]);

  useEffect(() => () => endScreenShareLockDeferral(), []);

  async function showIosScreenCapturePicker() {
    if (Platform.OS !== 'ios') {
      return;
    }

    const reactTag = findNodeHandle(screenCapturePickerRef.current);

    if (!reactTag || !NativeModules.ScreenCapturePickerViewManager?.show) {
      throw new Error(t('screenSharingUnavailable'));
    }

    await NativeModules.ScreenCapturePickerViewManager.show(reactTag);
  }

  async function restoreCameraAfterScreenShare() {
    if (!screenShareRestoreCameraRef.current) {
      return;
    }

    screenShareRestoreCameraRef.current = false;
    onCamera(false);
    await localParticipant.setCameraEnabled(true, getCallVideoCaptureOptions(isGroupCall, cameraFacing), getCallVideoPublishOptions(isGroupCall)).catch(() => {
      onCamera(true);
    });
    onCameraRenderRefresh();
  }

  async function toggleScreenShare() {
    if (isStartingScreenShare) {
      return;
    }

    setMenuOpen(false);

    if (isScreenSharing) {
      setStartingScreenShare(true);
      try {
        await localParticipant.setScreenShareEnabled(false);
        setScreenSharing(false);
        await restoreCameraAfterScreenShare();
      } finally {
        endScreenShareLockDeferral();
        setStartingScreenShare(false);
      }
      return;
    }

    setStartingScreenShare(true);
    beginScreenShareLockDeferral();
    const cameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
    const shouldRestoreCamera = !isCameraOff &&
      !!cameraPublication?.track &&
      cameraPublication.isMuted !== true &&
      cameraPublication.track.mediaStreamTrack.readyState === 'live';
    screenShareRestoreCameraRef.current = shouldRestoreCamera;

    try {
      if (shouldRestoreCamera) {
        onCamera(true);
        await localParticipant.setCameraEnabled(false);
      }

      await showIosScreenCapturePicker();
      await localParticipant.setScreenShareEnabled(
        true,
        CALL_SCREEN_SHARE_CAPTURE_OPTIONS,
        CALL_SCREEN_SHARE_PUBLISH_OPTIONS,
      );
      setScreenSharing(true);
    } catch {
      endScreenShareLockDeferral();
      screenShareRestoreCameraRef.current = false;
      setScreenSharing(false);
      if (shouldRestoreCamera) {
        onCamera(false);
        await localParticipant.setCameraEnabled(true, getCallVideoCaptureOptions(isGroupCall, cameraFacing), getCallVideoPublishOptions(isGroupCall)).catch(() => {
          onCamera(true);
        });
        onCameraRenderRefresh();
      }
      Alert.alert(t('shareScreen'), t('pleaseTryAgain'));
    } finally {
      setStartingScreenShare(false);
    }
  }

  return (
    <>
      {Platform.OS === 'ios' ? (
        <View style={styles.hiddenScreenCapturePicker}>
          <ScreenCapturePickerView ref={screenCapturePickerRef} />
        </View>
      ) : null}
      <Pressable accessibilityLabel={t('moreOptions')} onPress={() => setMenuOpen(true)} style={styles.topButton}>
        <Ionicons color={colors.white} name="ellipsis-vertical" size={22} />
      </Pressable>
      <Modal animationType="fade" transparent visible={isMenuOpen} onRequestClose={() => setMenuOpen(false)}>
        <Pressable onPress={() => setMenuOpen(false)} style={styles.callMenuBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.callTopMenuPanel}>
            <Pressable
              disabled={isStartingScreenShare}
              onPress={() => void toggleScreenShare()}
              style={[styles.callTopMenuItem, isStartingScreenShare && styles.callTopMenuItemDisabled]}
            >
              <Ionicons color={colors.white} name={isScreenSharing ? 'stop-circle' : 'phone-portrait-outline'} size={20} />
              <Text style={styles.callTopMenuText}>{t(isScreenSharing ? 'endScreenSharing' : 'shareScreen')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function CallControls({ activeAudioRoute, audioOptions, cameraFacing, isCameraOff, isGroupCall, isMuted, isSpeakerOn, muteRef, onCamera, onCameraFacingChange, onCameraRenderRefresh, onHangUp, onMuted, onSpeakerLongPress, onSpeakerPress, showCamera, voiceEffectId }: CallControlsProps) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const isFlippingCameraRef = useRef(false);
  const [isScreenSharing, setScreenSharing] = useState(false);

  useEffect(() => {
    const updateScreenShareState = () => {
      const publication = localParticipant.getTrackPublication(Track.Source.ScreenShare);
      const isActive = !!publication?.track &&
        publication.isMuted !== true &&
        publication.track.mediaStreamTrack.readyState === 'live';

      setScreenSharing(isActive);
    };

    updateScreenShareState();

    room
      .on(RoomEvent.LocalTrackPublished, updateScreenShareState)
      .on(RoomEvent.LocalTrackUnpublished, updateScreenShareState)
      .on(RoomEvent.TrackMuted, updateScreenShareState)
      .on(RoomEvent.TrackUnmuted, updateScreenShareState);

    return () => {
      room
        .off(RoomEvent.LocalTrackPublished, updateScreenShareState)
        .off(RoomEvent.LocalTrackUnpublished, updateScreenShareState)
        .off(RoomEvent.TrackMuted, updateScreenShareState)
        .off(RoomEvent.TrackUnmuted, updateScreenShareState);
    };
  }, [localParticipant, room]);

  async function toggleMute() {
    const nextMuted = !muteRef.current;
    muteRef.current = nextMuted;
    onMuted(nextMuted);

    try {
      let publication: LocalTrackPublication | undefined;

      if (nextMuted) {
        await disableCallMicrophone(localParticipant);
      } else if (Platform.OS === 'android' && voiceEffectId !== DEFAULT_VOICE_EFFECT_ID) {
        publication = await publishCallMicrophoneTrack(localParticipant, audioOptions, voiceEffectId);
        if (muteRef.current) {
          await disableCallMicrophone(localParticipant);
          return;
        }
      } else {
        await setNativeLiveVoiceEffectAndWait(voiceEffectId);
        if (muteRef.current) {
          await disableCallMicrophone(localParticipant);
          return;
        }
        publication = await localParticipant.setMicrophoneEnabled(true, audioOptions);
        if (muteRef.current) {
          await disableCallMicrophone(localParticipant);
          return;
        }
      }
      await publication?.resumeUpstream().catch(() => undefined);
      setNativeLiveVoiceEffect(voiceEffectId);
    } catch {
      muteRef.current = isMuted;
      onMuted(isMuted);
    }
  }

  async function toggleCamera() {
    const nextCameraOff = !isCameraOff;
    onCamera(nextCameraOff);
    await localParticipant.setCameraEnabled(!nextCameraOff, getCallVideoCaptureOptions(isGroupCall, cameraFacing), getCallVideoPublishOptions(isGroupCall)).catch(() => {
      onCamera(isCameraOff);
    });
  }

  async function flipCamera() {
    if (isFlippingCameraRef.current) {
      return;
    }

    isFlippingCameraRef.current = true;

    const publication = localParticipant.getTrackPublication(Track.Source.Camera);
    const cameraTrack = publication?.track as RestartableVideoTrack | undefined;
    const currentFacing = cameraTrack?.mediaStreamTrack.getSettings?.().facingMode;
    const activeFacing: CameraFacingMode =
      (currentFacing === 'environment' || currentFacing === 'user' ? currentFacing : cameraFacing);
    const nextFacing: CameraFacingMode = activeFacing === 'environment' ? 'user' : 'environment';
    const nextCaptureOptions = getCallVideoCaptureOptions(isGroupCall, nextFacing);
    const nextPublishOptions = getCallVideoPublishOptions(isGroupCall);

    const ensureCameraEnabledWithFacing = async () => {
      await localParticipant.setCameraEnabled(true, nextCaptureOptions, nextPublishOptions);
      const nextPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const nextTrack = nextPublication?.track as LocalVideoTrack | undefined;

      if (!nextPublication || !nextTrack || nextTrack.mediaStreamTrack.readyState !== 'live') {
        throw new Error(t('cameraFlipFailed'));
      }

      await nextPublication.unmute().catch(() => undefined);
      await nextTrack.resumeUpstream().catch(() => undefined);
    };

    try {
      if (!cameraTrack || isCameraOff) {
        onCamera(false);
        await ensureCameraEnabledWithFacing();
        onCameraFacingChange(nextFacing);
        onCameraRenderRefresh();
        return;
      }

      if (cameraTrack.restartTrack) {
        await cameraTrack.restartTrack(nextCaptureOptions);
      } else {
        await cameraTrack.mediaStreamTrack.applyConstraints(nextCaptureOptions as any);
      }

      const currentPublication = localParticipant.getTrackPublication(Track.Source.Camera);
      const currentTrack = currentPublication?.track as LocalVideoTrack | undefined;

      if (!currentPublication || !currentTrack || currentTrack.mediaStreamTrack.readyState !== 'live') {
        await ensureCameraEnabledWithFacing();
      } else {
        await currentPublication.unmute().catch(() => undefined);
        await currentTrack.resumeUpstream().catch(() => undefined);
      }

      onCameraFacingChange(nextFacing);
      onCameraRenderRefresh();
    } catch {
      try {
        await ensureCameraEnabledWithFacing();
        onCameraFacingChange(nextFacing);
        onCameraRenderRefresh();
      } catch {
        onCamera(isCameraOff);
      }
    } finally {
      isFlippingCameraRef.current = false;
    }
  }

  return (
    <View style={styles.controls}>
      <CallControl active={isMuted} icon={isMuted ? 'mic-off' : 'mic'} label={t('mute')} onPress={() => void toggleMute()} />
      <CallAudioRouteControl activeAudioRoute={activeAudioRoute} isSpeakerOn={isSpeakerOn} onLongPress={onSpeakerLongPress} onPress={onSpeakerPress} />
      {showCamera ? (
        <>
          <CallControl active={isCameraOff} icon={isCameraOff ? 'videocam-off' : 'videocam'} label={t('camera')} onPress={() => {
            if (!isScreenSharing) {
              void toggleCamera();
            }
          }} />
          <CallControl active={false} icon="camera-reverse" label={t('flip')} onPress={() => {
            if (!isScreenSharing) {
              void flipCamera();
            }
          }} />
        </>
      ) : null}
      <Pressable onPress={onHangUp} style={styles.endButton}>
        <Ionicons color={colors.white} name="call" size={26} />
      </Pressable>
    </View>
  );
}

type PreConnectCallControlsProps = {
  activeAudioRoute?: CallAudioRoute;
  isCameraOff: boolean;
  isMuted: boolean;
  isSpeakerOn: boolean;
  muteRef: MutableRefObject<boolean>;
  showCamera: boolean;
  onCamera: (value: boolean) => void;
  onHangUp: () => void;
  onMuted: (value: boolean) => void;
  onSpeakerLongPress: () => void;
  onSpeakerPress: () => void;
};

function PreConnectCallControls({
  activeAudioRoute,
  isCameraOff,
  isMuted,
  isSpeakerOn,
  muteRef,
  showCamera,
  onCamera,
  onHangUp,
  onMuted,
  onSpeakerLongPress,
  onSpeakerPress,
}: PreConnectCallControlsProps) {
  function toggleMute() {
    const nextMuted = !muteRef.current;
    muteRef.current = nextMuted;
    onMuted(nextMuted);
  }

  return (
    <View style={styles.controls}>
      <CallControl active={isMuted} icon={isMuted ? 'mic-off' : 'mic'} label={t('mute')} onPress={toggleMute} />
      <CallAudioRouteControl activeAudioRoute={activeAudioRoute} isSpeakerOn={isSpeakerOn} onLongPress={onSpeakerLongPress} onPress={onSpeakerPress} />
      {showCamera ? (
        <CallControl active={isCameraOff} icon={isCameraOff ? 'videocam-off' : 'videocam'} label={t('camera')} onPress={() => onCamera(!isCameraOff)} />
      ) : null}
      <Pressable onPress={onHangUp} style={styles.endButton}>
        <Ionicons color={colors.white} name="call" size={26} />
      </Pressable>
    </View>
  );
}

async function publishCallMicrophoneTrack(
  localParticipant: LiveKitLocalParticipant,
  audioOptions: CallAudioCaptureOptions,
  voiceEffectId: VoiceEffectId,
) {
  const existingPublication = localParticipant.getTrackPublication(Track.Source.Microphone);

  if (existingPublication?.track && !existingPublication.isMuted) {
    setNativeLiveVoiceEffect(voiceEffectId);
    return existingPublication;
  }

  const activePublishPromise = activeCallMicrophonePublishPromises.get(localParticipant);

  if (activePublishPromise) {
    return activePublishPromise;
  }

  const publishPromise = (async () => {
    if (Platform.OS === 'android' && voiceEffectId !== DEFAULT_VOICE_EFFECT_ID) {
      const currentPublication = localParticipant.getTrackPublication(Track.Source.Microphone);

      if (currentPublication?.track && !currentPublication.isMuted) {
        setNativeLiveVoiceEffect(voiceEffectId);
        return currentPublication;
      }

      if (currentPublication?.track) {
        await localParticipant.unpublishTrack(currentPublication.track, true).catch(() => undefined);
      }

      await delay(140);
      beginNativeLiveVoiceEffectSession(voiceEffectId);
      await setNativeLiveVoiceEffectAndWait(voiceEffectId);
      const microphoneTrack = await createLocalAudioTrack(audioOptions);
      const publication = await localParticipant.publishTrack(microphoneTrack);

      beginNativeLiveVoiceEffectSession(voiceEffectId);
      await setNativeLiveVoiceEffectAndWait(voiceEffectId);
      setNativeLiveVoiceEffect(voiceEffectId);
      return publication;
    }

    await setNativeLiveVoiceEffectAndWait(voiceEffectId);
    const publication = await localParticipant.setMicrophoneEnabled(true, audioOptions);
    return publication;
  })();

  activeCallMicrophonePublishPromises.set(localParticipant, publishPromise);

  try {
    return await publishPromise;
  } finally {
    if (activeCallMicrophonePublishPromises.get(localParticipant) === publishPromise) {
      activeCallMicrophonePublishPromises.delete(localParticipant);
    }
  }
}

async function disableCallMicrophone(localParticipant: LiveKitLocalParticipant) {
  const publication = localParticipant.getTrackPublication(Track.Source.Microphone);

  await publication?.mute().catch(() => undefined);
  await localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
}

async function republishCallMicrophoneTrack(
  localParticipant: LiveKitLocalParticipant,
  audioOptions: CallAudioCaptureOptions,
  voiceEffectId: VoiceEffectId,
) {
  await disableCallMicrophone(localParticipant);
  await delay(140);
  const publication = await publishCallMicrophoneTrack(localParticipant, audioOptions, voiceEffectId);
  await publication?.unmute().catch(() => undefined);
  await publication?.resumeUpstream().catch(() => undefined);
  return publication;
}

function getInviteCandidates(
  contacts: AuthUser[],
  conversations: Conversation[],
  currentConversationId?: string,
) {
  const chatUserIds = new Set<string>();
  const candidates: InviteCandidate[] = [];

  function addCandidate(user: AuthUser | undefined | null, fallbackTitle?: string) {
    if (!user || chatUserIds.has(user.id)) {
      return;
    }

    chatUserIds.add(user.id);
    candidates.push({
      id: user.id,
      title: user.displayName || fallbackTitle || user.username,
      username: user.username,
    });
  }

  function addCandidateById(userId: string, title: string) {
    if (chatUserIds.has(userId)) {
      return;
    }

    chatUserIds.add(userId);
    candidates.push({
      id: userId,
      title,
      username: title,
    });
  }

  conversations.forEach((conversation) => {
    if (!conversation.otherUserId || conversation.id === currentConversationId) {
      return;
    }

    const chatUser = conversation.members?.find((member) => member.id === conversation.otherUserId);

    if (chatUser) {
      addCandidate(chatUser, conversation.title);
    } else {
      addCandidateById(conversation.otherUserId, conversation.title);
    }
  });

  contacts.forEach((contact) => {
    addCandidate(contact);
  });

  return candidates;
}

function IncomingVoiceEffectModal({
  bottomInset,
  isProcessing,
  onAnswer,
  onCancel,
  onSelect,
  selectedEffectId,
  visible,
}: {
  bottomInset: number;
  isProcessing: boolean;
  onAnswer: () => void;
  onCancel: () => void;
  onSelect: (effectId: VoiceEffectId) => void;
  selectedEffectId: VoiceEffectId;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onCancel} transparent visible={visible}>
      <Pressable onPress={isProcessing ? undefined : onCancel} style={styles.voiceEffectBackdrop}>
        <Pressable style={[styles.incomingVoiceEffectPanel, { paddingBottom: Math.max(spacing.lg, bottomInset + spacing.md) }]}>
          <Text style={styles.incomingVoiceEffectTitle}>{t('voiceEffectTitle')}</Text>
          <Text style={styles.incomingVoiceEffectSubtitle}>{t('voiceEffectIncomingCallSubtitle')}</Text>
          <View style={styles.incomingVoiceEffectList}>
            {VOICE_EFFECTS.map((effect) => {
              const isSelected = selectedEffectId === effect.id;

              return (
                <Pressable
                  disabled={isProcessing}
                  key={effect.id}
                  onPress={() => onSelect(effect.id)}
                  style={[styles.incomingVoiceEffectOption, isSelected ? styles.incomingVoiceEffectOptionSelected : undefined]}
                >
                  <View style={styles.incomingVoiceEffectOptionIcon}>
                    <Ionicons color={isSelected ? colors.white : colors.primary} name={effect.icon} size={18} />
                  </View>
                  <View style={styles.incomingVoiceEffectOptionText}>
                    <Text style={[styles.incomingVoiceEffectOptionTitle, isSelected ? styles.incomingVoiceEffectOptionTitleSelected : undefined]}>
                      {t(effect.titleKey)}
                    </Text>
                    <Text style={[styles.incomingVoiceEffectOptionDescription, isSelected ? styles.incomingVoiceEffectOptionDescriptionSelected : undefined]}>
                      {t(effect.descriptionKey)}
                    </Text>
                  </View>
                  {isSelected ? <Ionicons color={colors.white} name="checkmark-circle" size={22} /> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.incomingVoiceEffectActions}>
            <Pressable disabled={isProcessing} onPress={onCancel} style={styles.incomingVoiceEffectSecondaryButton}>
              <Text style={styles.incomingVoiceEffectSecondaryText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable disabled={isProcessing} onPress={onAnswer} style={[styles.incomingVoiceEffectPrimaryButton, isProcessing ? styles.incomingVoiceEffectPrimaryButtonDisabled : undefined]}>
              {isProcessing ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.incomingVoiceEffectPrimaryText}>{t('answer')}</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function getIncomingCallStatus(mode: 'voice' | 'video', isGroupCall?: boolean) {
  if (isGroupCall) {
    return mode === 'video' ? t('incomingGroupVideoCall') : t('incomingGroupVoiceCall');
  }

  return mode === 'video' ? t('incomingVideoCall') : t('incomingVoiceCall');
}

function formatParticipantNames(names: string[]) {
  const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));

  if (uniqueNames.length <= 3) {
    return uniqueNames.join(', ');
  }

  return `${uniqueNames.slice(0, 3).join(', ')} +${uniqueNames.length - 3} more`;
}

async function selectCallAudioOutput(useSpeaker: boolean) {
  const outputs = await AudioSession.getAudioOutputs().catch((): string[] => []);
  const preferredOutputs = useSpeaker ? ['force_speaker', 'speaker'] : ['earpiece', 'default'];
  const output = preferredOutputs.find((item) => outputs.includes(item)) ?? preferredOutputs[0];

  await AudioSession.selectAudioOutput(output);
}

function findPreferredNonSpeakerRoute(routes: CallAudioRoute[]) {
  return routes.find((item) => item.type === 'earpiece') ??
    routes.find((item) => item.type === 'wired') ??
    routes.find((item) => item.type === 'bluetooth');
}

function getCallAudioRouteIcon(audioRoute?: CallAudioRoute): keyof typeof Ionicons.glyphMap {
  switch (audioRoute?.type) {
    case 'bluetooth':
      return 'bluetooth';
    case 'wired':
      return 'headset';
    case 'earpiece':
      return 'phone-portrait-outline';
    default:
      return 'volume-high';
  }
}

function getCallAudioRouteLabel(audioRoute?: CallAudioRoute, includeDeviceName = false) {
  switch (audioRoute?.type) {
    case 'bluetooth':
      return includeDeviceName && audioRoute.name ? audioRoute.name : t('bluetooth');
    case 'wired':
      return includeDeviceName && audioRoute.name ? audioRoute.name : t('wiredHeadset');
    case 'earpiece':
      return t('phoneEarpiece');
    default:
      return t('speaker');
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalidatePendingCallAudioRouteOperations() {
  callAudioRouteApplyVersion += 1;
}

function enableCallAudioRouteOperations() {
  areCallAudioRouteOperationsBlocked = false;
  invalidatePendingCallAudioRouteOperations();
}

function blockPendingCallAudioRouteOperations() {
  areCallAudioRouteOperationsBlocked = true;
  invalidatePendingCallAudioRouteOperations();
}

function isCallAudioRouteOperationCurrent(
  applyVersion: number,
  shouldContinue?: CallAudioRouteOperationGuard,
) {
  return !areCallAudioRouteOperationsBlocked &&
    applyVersion === callAudioRouteApplyVersion &&
    (shouldContinue?.() ?? true);
}

async function selectExplicitCallAudioRoute(
  audioRoute: CallAudioRoute,
  selectionVersion = callAudioRouteSelectionVersion,
  applyVersion = ++callAudioRouteApplyVersion,
  shouldContinue?: CallAudioRouteOperationGuard,
) {
  let routes: CallAudioRoute[] = [];

  for (const waitMs of [0, 240, 600, 1200, 2200]) {
    if (selectionVersion !== callAudioRouteSelectionVersion || !isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
      return getNativeCallAudioRoutes();
    }

    if (waitMs > 0) {
      await delay(waitMs);
    }

    if (selectionVersion !== callAudioRouteSelectionVersion || !isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
      return getNativeCallAudioRoutes();
    }

    if (audioRoute.type === 'speaker' || audioRoute.type === 'earpiece') {
      await selectCallAudioOutput(audioRoute.type === 'speaker').catch(() => undefined);
    }

    await selectNativeCallAudioRoute(audioRoute.id);
    await delay(120);
    if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
      return getNativeCallAudioRoutes();
    }
    routes = await getNativeCallAudioRoutes();

    if (routes.some((item) => item.isActive && (
      item.id === audioRoute.id ||
      item.type === audioRoute.type
    ))) {
      return routes;
    }
  }

  return routes;
}

async function forceCallAudioRoute(
  useSpeaker: boolean,
  preserveExternalRoute = true,
  applyVersion = ++callAudioRouteApplyVersion,
  shouldContinue?: CallAudioRouteOperationGuard,
  autoSelectAvailableExternalRoute = false,
) {
  if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
    return;
  }

  if (AppState.currentState !== 'active') {
    return;
  }

  await AudioSession.startAudioSession();

  if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
    if (areCallAudioRouteOperationsBlocked) {
      await AudioSession.stopAudioSession().catch(() => undefined);
    }
    return;
  }

  const routes = await getNativeCallAudioRoutes();
  const activeRoute = routes.find((item) => item.isActive);
  const preferredExternalRoute = routes.find((item) => item.type === 'bluetooth') ??
    routes.find((item) => item.type === 'wired');

  if (preserveExternalRoute && hasExplicitCallAudioRouteSelection && explicitCallAudioRoute) {
    const isExplicitRouteAvailable = explicitCallAudioRoute.type === 'speaker' ||
      explicitCallAudioRoute.type === 'earpiece' ||
      routes.some((item) => item.id === explicitCallAudioRoute?.id);

    if (isExplicitRouteAvailable) {
      if (activeRoute && (
        activeRoute.id === explicitCallAudioRoute.id ||
        activeRoute.type === explicitCallAudioRoute.type
      )) {
        return;
      }

      await selectExplicitCallAudioRoute(explicitCallAudioRoute, callAudioRouteSelectionVersion, applyVersion, shouldContinue);
      return;
    }

    hasExplicitCallAudioRouteSelection = false;
    explicitCallAudioRoute = null;
  }

  if (preserveExternalRoute && hasExplicitCallAudioRouteSelection) {
    return;
  }

  if (preserveExternalRoute && activeRoute && (activeRoute.type === 'bluetooth' || activeRoute.type === 'wired')) {
    return;
  }

  if (preserveExternalRoute && autoSelectAvailableExternalRoute && preferredExternalRoute) {
    await selectExplicitCallAudioRoute(preferredExternalRoute, callAudioRouteSelectionVersion, applyVersion, shouldContinue);
    return;
  }

  for (const waitMs of [0, 180, 520, 1000]) {
    if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
      return;
    }

    if (waitMs > 0) {
      await delay(waitMs);
    }

    if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
      return;
    }

    const latestRoutes = await getNativeCallAudioRoutes();
    const targetType = useSpeaker ? 'speaker' : 'earpiece';
    const route = latestRoutes.find((item) => item.type === targetType);
    if (latestRoutes.some((item) => item.isActive && item.type === targetType)) {
      return;
    }

    await selectCallAudioOutput(useSpeaker).catch(() => undefined);
    if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
      return;
    }
    if (route) {
      await selectNativeCallAudioRoute(route.id);
    } else {
      setNativeCallAudioRoute(useSpeaker);
    }
  }
}

async function configureCallAudioSession(
  mode: 'voice' | 'video',
  options?: { skipAppleAudioConfiguration?: boolean; skipNativeActivation?: boolean; useCallKitManagedNative?: boolean },
) {
  const prepareIosNativeAudioSession = options?.useCallKitManagedNative
    ? prepareNativeCallKitAudioSession
    : prepareNativeCallAudioSession;

  if (Platform.OS === 'ios' && (options?.useCallKitManagedNative || !options?.skipNativeActivation)) {
    await prepareIosNativeAudioSession(mode, mode === 'video').catch(() => undefined);
  } else {
    if (Platform.OS !== 'ios') {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      }).catch(() => undefined);
    }
  }

  await AudioSession.configureAudio({
    android: {
      audioTypeOptions: {
        manageAudioFocus: true,
        audioMode: 'inCommunication',
        audioFocusMode: 'gain',
        audioStreamType: 'voiceCall',
        audioAttributesUsageType: 'voiceCommunication',
        audioAttributesContentType: 'speech',
        forceHandleAudioRouting: true,
      },
      preferredOutputList: mode === 'video'
        ? ['bluetooth', 'headset', 'speaker', 'earpiece']
        : ['earpiece', 'headset', 'bluetooth', 'speaker'],
    },
    ios: {
      defaultOutput: mode === 'video' ? 'speaker' : 'earpiece',
    },
  });

  if (!options?.skipAppleAudioConfiguration) {
    await AudioSession.setAppleAudioConfiguration({
      audioCategory: 'playAndRecord',
      audioCategoryOptions: mode === 'video'
        ? ['allowBluetooth', 'allowBluetoothA2DP', 'defaultToSpeaker']
        : ['allowBluetooth'],
      audioMode: mode === 'video' ? 'videoChat' : 'voiceChat',
    }).catch(() => undefined);
  }

  if (Platform.OS === 'ios' && (options?.useCallKitManagedNative || !options?.skipNativeActivation)) {
    await prepareIosNativeAudioSession(mode, mode === 'video').catch(() => undefined);
  }
}

async function prepareCallKitManagedCallAudio(mode: 'voice' | 'video') {
  if (Platform.OS !== 'ios') {
    await prepareCallAudio(mode);
    return;
  }

  await enqueueCallAudioPreparation(async () => {
    await configureCallAudioSession(mode, { useCallKitManagedNative: true });
    const activatedByCallKit = await waitForNativeCallKitAudioActivation();

    if (!activatedByCallKit) {
      await restoreCallAudio(mode, mode === 'video');
      return;
    }

    await configureCallAudioSession(mode, { useCallKitManagedNative: true });
  });
}

async function restoreCallAudio(
  mode: 'voice' | 'video',
  useSpeaker: boolean,
  shouldContinue?: CallAudioRouteOperationGuard,
) {
  const applyVersion = ++callAudioRouteApplyVersion;
  await configureCallAudioSession(mode);
  if (!isCallAudioRouteOperationCurrent(applyVersion, shouldContinue)) {
    return;
  }
  await forceCallAudioRoute(useSpeaker, mode === 'video', applyVersion, shouldContinue, mode === 'video').catch(() => undefined);
}

async function prepareCallAudio(
  mode: 'voice' | 'video',
  shouldContinue?: CallAudioRouteOperationGuard,
) {
  await enqueueCallAudioPreparation(async () => {
    await restoreCallAudio(mode, mode === 'video', shouldContinue);
  });
}

async function ensureCallPermissions(mode: 'voice' | 'video') {
  const existingMicrophonePermission = await getRecordingPermissionsAsync();
  const microphonePermission = existingMicrophonePermission.granted
    ? existingMicrophonePermission
    : await requestRecordingPermissionsAsync();

  if (!microphonePermission.granted) {
    return false;
  }

  if (mode === 'voice') {
    return true;
  }

  if (Platform.OS === 'ios' && Device.isDevice === false) {
    return true;
  }

  const existingCameraPermission = await ImagePicker.getCameraPermissionsAsync();
  const cameraPermission = existingCameraPermission.granted
    ? existingCameraPermission
    : await ImagePicker.requestCameraPermissionsAsync();

  return cameraPermission.granted;
}

let styles = createCallRoomStyles();
