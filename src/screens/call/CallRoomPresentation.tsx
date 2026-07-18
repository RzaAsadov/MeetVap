import { Ionicons } from '@expo/vector-icons';
import { VideoTrack, VideoView, isTrackReference, useLocalParticipant, useParticipants, useRoomContext, useTracks } from '@livekit/react-native';
import type { TrackReference } from '@livekit/react-native';
import { RTCView } from '@livekit/react-native-webrtc';
import { RemoteVideoTrack, RoomEvent, Track, TrackEvent } from 'livekit-client';
import type { ElementInfo, LocalVideoTrack, Participant, RemoteTrackPublication } from 'livekit-client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Animated, FlatList, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../../components/Avatar';
import { t } from '../../i18n';
import { logCallDiagnostic } from '../../lib/messageDeliveryDiagnostics';
import { colors } from '../../theme/colors';
import { spacing } from '../../theme/spacing';

const LOCAL_PREVIEW_HEIGHT = 132;
const LOCAL_PREVIEW_WIDTH = 96;
const LOCAL_PREVIEW_CONTROLS_CLEARANCE = 104;
const LOCAL_PREVIEW_EDGE_MARGIN = 16;
const MINI_CALL_WIDTH = 132;
const MINI_CALL_HEIGHT = 178;
const MINI_CALL_EDGE_MARGIN = 12;

type CallRoomStyles = Record<string, any>;

const CallRoomStylesContext = createContext<CallRoomStyles | null>(null);

function logCallRenderDebug(event: string, details?: Record<string, unknown>) {
  logCallDiagnostic(event, {
    ...details,
    timestamp: new Date().toISOString(),
    timestampMs: Date.now(),
  });
}

export function CallRoomPresentationProvider({ children, styles }: { children: ReactNode; styles: CallRoomStyles }) {
  return (
    <CallRoomStylesContext.Provider value={styles}>
      {children}
    </CallRoomStylesContext.Provider>
  );
}

function useCallRoomStyles() {
  const styles = useContext(CallRoomStylesContext);

  if (!styles) {
    throw new Error('CallRoomPresentationProvider is missing');
  }

  return styles;
}

export type InviteCandidate = {
  id: string;
  title: string;
  username: string;
};

export type CallParticipantProfile = {
  avatarUrl?: string | null;
  name: string;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type ScreenBounds = {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
};

export function AddPeopleModal({
  candidates,
  isVisible,
  maxReachedMessage,
  onClose,
  onInvite,
  onSearch,
  search,
}: {
  candidates: InviteCandidate[];
  isVisible: boolean;
  maxReachedMessage: string;
  onClose: () => void;
  onInvite: (candidate: InviteCandidate) => void;
  onSearch: (value: string) => void;
  search: string;
}) {
  const styles = useCallRoomStyles();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={isVisible}>
      <View style={styles.modalShade}>
        <View style={styles.addPeoplePanel}>
          <View style={styles.addPeopleHeader}>
            <Text style={styles.addPeopleTitle}>{t('addPeople')}</Text>
            <Pressable onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons color={colors.textPrimary} name="close" size={24} />
            </Pressable>
          </View>
          <View style={styles.peopleSearchWrap}>
            <Ionicons color={colors.mutedText} name="search" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={onSearch}
              placeholder={t('search')}
              placeholderTextColor={colors.mutedText}
              style={styles.peopleSearchInput}
              value={search}
            />
          </View>
          <FlatList
            data={candidates}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.noPeopleText}>{t('noPeopleFound')}. {maxReachedMessage}</Text>}
            style={styles.modalList}
            renderItem={({ item }) => (
              <Pressable onPress={() => onInvite(item)} style={styles.personRow}>
                <Avatar label={item.title} size={40} />
                <View style={styles.personText}>
                  <Text style={styles.personName}>{item.title}</Text>
                  {item.username ? <Text style={styles.personUsername}>@{item.username}</Text> : null}
                </View>
                <Ionicons color={colors.primary} name="person-add-outline" size={22} />
              </Pressable>
            )}
          />
        </View>
      </View>
    </Modal>
  );
}

export function WaitingCallControls({ onHangUp }: { onHangUp: () => void }) {
  const styles = useCallRoomStyles();

  return (
    <View style={styles.controls}>
      <Pressable onPress={onHangUp} style={styles.endButton}>
        <Ionicons color={colors.white} name="call" size={26} />
      </Pressable>
    </View>
  );
}

export function MinimizedCallView({
  bounds,
  callStage,
  mode,
  onMove,
  onRestore,
  position,
  title,
}: {
  bounds: ScreenBounds;
  callStage: ReactNode;
  mode: 'voice' | 'video';
  onMove: (position: ScreenPoint) => void;
  onRestore: () => void;
  position: ScreenPoint;
  title: string;
}) {
  const styles = useCallRoomStyles();
  const dragStartRef = useRef(position);
  const positionRef = useRef(position);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
    onPanResponderGrant: () => {
      dragStartRef.current = positionRef.current;
    },
    onPanResponderMove: (_event, gesture) => {
      onMove(clampMiniCallPosition({
        x: dragStartRef.current.x + gesture.dx,
        y: dragStartRef.current.y + gesture.dy,
      }, bounds));
    },
    onPanResponderRelease: (_event, gesture) => {
      onMove(clampMiniCallPosition({
        x: dragStartRef.current.x + gesture.dx,
        y: dragStartRef.current.y + gesture.dy,
      }, bounds));
    },
    onPanResponderTerminate: () => {
      onMove(clampMiniCallPosition(dragStartRef.current, bounds));
    },
  }), [bounds, onMove]);

  return (
    <View pointerEvents="box-none" style={styles.minimizedCallOverlay}>
      <View
        {...panResponder.panHandlers}
        style={[styles.miniCallBox, { left: position.x, top: position.y }]}
      >
        <Pressable onPress={onRestore} style={styles.miniCallPressable}>
          {callStage}
          <View style={styles.miniCallLabel}>
            <Ionicons color={colors.white} name={mode === 'video' ? 'videocam' : 'call'} size={14} />
            <Text numberOfLines={1} style={styles.miniCallLabelText}>{title}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export function getMiniCallBounds(width: number, height: number, topInset: number, bottomInset: number): ScreenBounds {
  const minX = MINI_CALL_EDGE_MARGIN;
  const minY = topInset + MINI_CALL_EDGE_MARGIN;

  return {
    maxX: Math.max(minX, width - MINI_CALL_WIDTH - MINI_CALL_EDGE_MARGIN),
    maxY: Math.max(minY, height - MINI_CALL_HEIGHT - bottomInset - MINI_CALL_EDGE_MARGIN),
    minX,
    minY,
  };
}

export function clampMiniCallPosition(position: ScreenPoint, bounds: ScreenBounds): ScreenPoint {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, position.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, position.y)),
  };
}

export function ConnectedCallStage({
  enableIosPictureInPicture = false,
  hideLocalPreview = false,
  isCameraOff,
  isCompact,
  isAndroidSystemPictureInPicture = false,
  localCameraRenderVersion = 0,
  localCameraMirror = true,
  localPreviewVideoTrack,
  mode,
  onRemoteScreenShareActiveChange,
  onShowPeople,
  profiles,
  showLabels = true,
  title,
}: {
  enableIosPictureInPicture?: boolean;
  hideLocalPreview?: boolean;
  isCameraOff: boolean;
  isAndroidSystemPictureInPicture?: boolean;
  isCompact?: boolean;
  localCameraRenderVersion?: number;
  localCameraMirror?: boolean;
  localPreviewVideoTrack: LocalVideoTrack | null;
  mode: 'voice' | 'video';
  onRemoteScreenShareActiveChange?: (active: boolean) => void;
  onShowPeople: () => void;
  profiles: Map<string, CallParticipantProfile>;
  showLabels?: boolean;
  title: string;
}) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = participants
    .filter((participant) => participant.identity !== localParticipant.identity);
  const visibleParticipants = mode === 'video' && remoteParticipants.length > 1
    ? [localParticipant, ...remoteParticipants]
    : remoteParticipants;
  const callParticipants = visibleParticipants
    .slice(0, mode === 'video' ? 6 : 8)
    .map((participant) => ({
      ...getParticipantProfile(participant, profiles, title),
      id: participant.identity,
    }));

  if (mode === 'voice') {
    return (
      <VoiceCallStage
        isCompact={isCompact}
        onShowPeople={onShowPeople}
        participants={callParticipants}
        totalCount={participants.length}
      />
    );
  }

  return (
    <VideoGridStage
      enableIosPictureInPicture={enableIosPictureInPicture}
      hideLocalPreview={hideLocalPreview}
      isAndroidSystemPictureInPicture={isAndroidSystemPictureInPicture}
      isCameraOff={isCameraOff}
      isCompact={isCompact}
      localCameraRenderVersion={localCameraRenderVersion}
      localCameraMirror={localCameraMirror}
      localPreviewVideoTrack={localPreviewVideoTrack}
      onRemoteScreenShareActiveChange={onRemoteScreenShareActiveChange}
      participants={callParticipants}
      showLabels={showLabels}
      title={title}
    />
  );
}

function VoiceCallStage({
  isCompact,
  onShowPeople,
  participants,
  totalCount,
}: {
  isCompact?: boolean;
  onShowPeople: () => void;
  participants: { avatarUrl?: string | null; id: string; name: string }[];
  totalCount: number;
}) {
  const styles = useCallRoomStyles();

  if (isCompact) {
    return (
      <View style={styles.compactVoiceCall}>
        <Ionicons color={colors.white} name="call" size={38} />
        <Text numberOfLines={1} style={styles.compactVoiceText}>{t('voiceCall')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.voiceGroupStage}>
      <View style={styles.voiceGrid}>
        {participants.map((participant) => (
          <View key={participant.id} style={styles.voiceTile}>
            <Avatar label={participant.name} size={54} uri={participant.avatarUrl} />
            <Text numberOfLines={1} style={styles.voiceTileName}>{participant.name}</Text>
          </View>
        ))}
      </View>
      {totalCount > 0 ? (
        <Pressable onPress={onShowPeople} style={styles.allPeopleButton}>
          <Ionicons color={colors.white} name="people" size={18} />
          <Text style={styles.allPeopleText}>{t('peopleInCall')} ({totalCount})</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function WaitingVideoStage({
  isCameraOff,
  localCameraRenderVersion = 0,
  localCameraMirror = true,
  localTrack,
  previewVideoTrack,
  showLabels = true,
  title,
}: {
  isCameraOff: boolean;
  localCameraRenderVersion?: number;
  localCameraMirror?: boolean;
  localTrack?: TrackReference;
  previewVideoTrack: LocalVideoTrack | null;
  showLabels?: boolean;
  title: string;
}) {
  const styles = useCallRoomStyles();
  const hasCameraPreview = !!localTrack || !!previewVideoTrack;

  return (
    <View style={styles.videoGridStage}>
      <View style={[styles.videoTile, styles.videoTileOne]}>
        <View style={styles.remotePlaceholder}>
          <Avatar label={title} size={94} />
          {showLabels ? <Text numberOfLines={1} style={styles.videoWaitingText}>{t('waitingForVideo')}</Text> : null}
        </View>
      </View>
      <View style={[styles.localPreview, (isCameraOff || !hasCameraPreview) && styles.localPreviewOff]}>
        <LocalCameraPreview
          isCameraOff={isCameraOff}
          localCameraRenderVersion={localCameraRenderVersion}
          localCameraMirror={localCameraMirror}
          localTrack={localTrack}
          previewVideoTrack={previewVideoTrack}
          showLabels={showLabels}
        />
      </View>
    </View>
  );
}

export function LiveKitWaitingVideoStage({
  isCameraOff,
  localCameraRenderVersion = 0,
  localCameraMirror = true,
  previewVideoTrack,
  showLabels = true,
  title,
}: {
  isCameraOff: boolean;
  localCameraRenderVersion?: number;
  localCameraMirror?: boolean;
  previewVideoTrack: LocalVideoTrack | null;
  showLabels?: boolean;
  title: string;
}) {
  const localTrack = useLocalCameraTrack();

  return (
    <WaitingVideoStage
      isCameraOff={isCameraOff}
      localCameraRenderVersion={localCameraRenderVersion}
      localCameraMirror={localCameraMirror}
      localTrack={localTrack}
      previewVideoTrack={previewVideoTrack}
      showLabels={showLabels}
      title={title}
    />
  );
}

function useCameraTrackRefs() {
  const { localParticipant } = useLocalParticipant();
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ], { onlySubscribed: false });
  const trackRefs = tracks.filter(isTrackReference);
  const localTrackFromTracks = trackRefs.find((item) => (
    item.participant.identity === localParticipant.identity &&
    item.publication?.source === Track.Source.Camera &&
    !!item.publication?.track &&
    item.publication?.isMuted !== true
  ));
  const localCameraPublication = localParticipant.getTrackPublication(Track.Source.Camera);
  const localTrack = localTrackFromTracks ?? (
    localCameraPublication?.track && localCameraPublication.isMuted !== true
      ? {
        participant: localParticipant,
        publication: localCameraPublication,
        source: Track.Source.Camera,
      } as TrackReference
      : undefined
  );

  return { localTrack, trackRefs };
}

function useLocalCameraTrack() {
  return useCameraTrackRefs().localTrack;
}

function useRemoteCameraTrackRefresh(visibleParticipantIds: string[]) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const [remoteCameraVersion, setRemoteCameraVersion] = useState(0);
  const remoteCameraSignatureRef = useRef('');
  const visibleParticipantKey = visibleParticipantIds.join('|');

  useEffect(() => {
    const visibleParticipantSet = new Set(visibleParticipantKey ? visibleParticipantKey.split('|') : []);

    const inspectRemoteCameras = () => {
      const signatureParts: string[] = [];

      participants.forEach((participant) => {
        if (
          !visibleParticipantSet.has(participant.identity) ||
          participant.identity === localParticipant.identity
        ) {
          return;
        }

        const screenSharePublication = participant.getTrackPublication(Track.Source.ScreenShare) as RemoteTrackPublication | undefined;
        const cameraPublication = participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
        const preferredPublication = screenSharePublication && screenSharePublication.isMuted !== true
          ? screenSharePublication
          : cameraPublication;

        signatureParts.push([
          participant.identity,
          screenSharePublication?.trackSid ?? 'no-screen',
          screenSharePublication?.isMuted === true ? 'screen-muted' : 'screen-live',
          screenSharePublication?.isSubscribed === true ? 'screen-subscribed' : 'screen-unsubscribed',
          screenSharePublication?.track ? 'screen-track' : 'no-screen-track',
          cameraPublication?.trackSid ?? 'no-camera',
          cameraPublication?.isMuted === true ? 'camera-muted' : 'camera-live',
          cameraPublication?.isSubscribed === true ? 'camera-subscribed' : 'camera-unsubscribed',
          cameraPublication?.track ? 'camera-track' : 'no-camera-track',
        ].join(':'));

        if (!preferredPublication || preferredPublication.isMuted === true) {
          return;
        }
      });

      const signature = signatureParts.join('|');

      if (signature !== remoteCameraSignatureRef.current) {
        logCallRenderDebug('remote-camera-signature', {
          localParticipantId: localParticipant.identity,
          signature,
          visibleParticipantIds: Array.from(visibleParticipantSet),
        });
        remoteCameraSignatureRef.current = signature;
        setRemoteCameraVersion((current) => current + 1);
      }
    };

    inspectRemoteCameras();
    const interval = setInterval(inspectRemoteCameras, 250);
    const handleRemoteCameraUpdate = () => {
      inspectRemoteCameras();
    };

    room
      .on(RoomEvent.ParticipantConnected, handleRemoteCameraUpdate)
      .on(RoomEvent.TrackPublished, handleRemoteCameraUpdate)
      .on(RoomEvent.TrackSubscribed, handleRemoteCameraUpdate)
      .on(RoomEvent.TrackSubscriptionStatusChanged, handleRemoteCameraUpdate)
      .on(RoomEvent.TrackUnmuted, handleRemoteCameraUpdate)
      .on(RoomEvent.TrackUnsubscribed, handleRemoteCameraUpdate)
      .on(RoomEvent.TrackMuted, handleRemoteCameraUpdate);

    return () => {
      clearInterval(interval);
      room
        .off(RoomEvent.ParticipantConnected, handleRemoteCameraUpdate)
        .off(RoomEvent.TrackPublished, handleRemoteCameraUpdate)
        .off(RoomEvent.TrackSubscribed, handleRemoteCameraUpdate)
        .off(RoomEvent.TrackSubscriptionStatusChanged, handleRemoteCameraUpdate)
        .off(RoomEvent.TrackUnmuted, handleRemoteCameraUpdate)
        .off(RoomEvent.TrackUnsubscribed, handleRemoteCameraUpdate)
        .off(RoomEvent.TrackMuted, handleRemoteCameraUpdate);
    };
  }, [localParticipant.identity, participants, room, visibleParticipantKey]);

  return remoteCameraVersion;
}

function getCameraTrackRefForParticipant(participant: Participant | undefined, trackRefs: TrackReference[]) {
  if (!participant) {
    return undefined;
  }

  const screenShareTrackRef = trackRefs.find((item) => (
    item.participant.identity === participant.identity &&
    item.publication?.source === Track.Source.ScreenShare &&
    !!item.publication?.track &&
    item.publication?.isMuted !== true
  ));

  if (screenShareTrackRef) {
    return screenShareTrackRef;
  }

  const cameraTrackRef = trackRefs.find((item) => (
    item.participant.identity === participant.identity &&
    item.publication?.source === Track.Source.Camera &&
    !!item.publication?.track &&
    item.publication?.isMuted !== true
  ));

  if (cameraTrackRef) {
    return cameraTrackRef;
  }

  const screenSharePublication = participant.getTrackPublication(Track.Source.ScreenShare);

  if (screenSharePublication?.track && screenSharePublication.isMuted !== true) {
    return {
      participant,
      publication: screenSharePublication,
      source: Track.Source.ScreenShare,
    } as TrackReference;
  }

  const cameraPublication = participant.getTrackPublication(Track.Source.Camera);

  if (cameraPublication?.track && cameraPublication.isMuted !== true) {
    return {
      participant,
      publication: cameraPublication,
      source: Track.Source.Camera,
    } as TrackReference;
  }

  return undefined;
}

function getTrackRenderKey(prefix: string, trackRef: TrackReference, fallbackId = 'camera') {
  const publication = trackRef.publication;

  return [
    prefix,
    publication?.trackSid ?? fallbackId,
    publication?.source ?? trackRef.source ?? 'unknown-source',
  ].join(':');
}

function isScreenShareTrackRef(trackRef?: TrackReference) {
  return trackRef?.publication?.source === Track.Source.ScreenShare ||
    trackRef?.source === Track.Source.ScreenShare;
}

function VideoGridStage({
  enableIosPictureInPicture = false,
  hideLocalPreview = false,
  isAndroidSystemPictureInPicture = false,
  isCameraOff,
  isCompact,
  localCameraMirror = true,
  localCameraRenderVersion = 0,
  localPreviewVideoTrack,
  onRemoteScreenShareActiveChange,
  participants,
  showLabels = true,
  title,
}: {
  enableIosPictureInPicture?: boolean;
  hideLocalPreview?: boolean;
  isAndroidSystemPictureInPicture?: boolean;
  isCameraOff: boolean;
  isCompact?: boolean;
  localCameraMirror?: boolean;
  localCameraRenderVersion?: number;
  localPreviewVideoTrack: LocalVideoTrack | null;
  onRemoteScreenShareActiveChange?: (active: boolean) => void;
  participants: { avatarUrl?: string | null; id: string; name: string }[];
  showLabels?: boolean;
  title: string;
}) {
  const styles = useCallRoomStyles();
  const { localParticipant } = useLocalParticipant();
  const roomParticipants = useParticipants();
  const window = useWindowDimensions();
  const [localCameraVersion, setLocalCameraVersion] = useState(0);
  const localCameraSignatureRef = useRef('');
  const [isLocalVideoExpanded, setLocalVideoExpanded] = useState(false);
  const localPreviewPan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const localPreviewDragStartRef = useRef({ x: 0, y: 0 });
  const localPreviewOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const interval = setInterval(() => {
      const publication = localParticipant.getTrackPublication(Track.Source.Camera);
      const mediaTrack = publication?.track?.mediaStreamTrack;

      const signature = publication?.track && publication.isMuted !== true
        ? `${publication.trackSid ?? 'local'}:${mediaTrack?.id ?? 'no-media-track'}:${mediaTrack?.readyState ?? 'unknown'}:${publication.isMuted ? 'muted' : 'live'}`
        : 'none';

      if (signature !== localCameraSignatureRef.current) {
        localCameraSignatureRef.current = signature;
        setLocalCameraVersion((current) => current + 1);
      }
    }, 400);

    return () => clearInterval(interval);
  }, [localParticipant]);

  const { localTrack, trackRefs } = useCameraTrackRefs();
  void localCameraVersion;
  const visibleParticipants: ('waiting' | { avatarUrl?: string | null; id: string; name: string })[] = useMemo(
    () => participants.length > 0 ? participants : ['waiting'],
    [participants],
  );
  const visibleRemoteParticipantIds = visibleParticipants.reduce<string[]>((ids, participant) => {
    if (participant !== 'waiting' && participant.id !== localParticipant.identity) {
      ids.push(participant.id);
    }

    return ids;
  }, []);
  const remoteCameraVersion = useRemoteCameraTrackRefresh(visibleRemoteParticipantIds);
  void remoteCameraVersion;
  const visibleRemoteScreenShareActive = useMemo(() => visibleParticipants.some((participant) => {
    if (participant === 'waiting' || participant.id === localParticipant.identity) {
      return false;
    }

    const liveParticipant = roomParticipants.find((item) => item.identity === participant.id);
    return isScreenShareTrackRef(getCameraTrackRefForParticipant(liveParticipant, trackRefs));
  }), [localParticipant.identity, roomParticipants, trackRefs, visibleParticipants]);
  const shouldUseLocalPreview = !hideLocalPreview &&
    !isCompact &&
    visibleParticipants.filter((participant) => participant !== 'waiting').length <= 1 &&
    !visibleParticipants.some((participant) => participant !== 'waiting' && participant.id === localParticipant.identity);
  const canSwapOneToOneVideos = shouldUseLocalPreview &&
    visibleParticipants.length === 1 &&
    visibleParticipants[0] !== 'waiting';
  const shouldUseFullBleedMainVideo = !isCompact && visibleParticipants.length <= 1;
  const previewRemoteParticipant = canSwapOneToOneVideos && visibleParticipants[0] !== 'waiting'
    ? visibleParticipants[0]
    : null;
  const clampLocalPreviewOffset = useCallback((offset: ScreenPoint) => {
    const minX = -(window.width - LOCAL_PREVIEW_WIDTH - (LOCAL_PREVIEW_EDGE_MARGIN * 2));
    const minY = -(window.height - LOCAL_PREVIEW_HEIGHT - LOCAL_PREVIEW_CONTROLS_CLEARANCE - LOCAL_PREVIEW_EDGE_MARGIN);

    return {
      x: Math.max(minX, Math.min(0, offset.x)),
      y: Math.max(minY, Math.min(0, offset.y)),
    };
  }, [window.height, window.width]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 4 || Math.abs(gesture.dy) > 4,
    onStartShouldSetPanResponder: () => canSwapOneToOneVideos,
    onPanResponderGrant: () => {
      localPreviewDragStartRef.current = localPreviewOffsetRef.current;
    },
    onPanResponderMove: (_event, gesture) => {
      const nextOffset = clampLocalPreviewOffset({
        x: localPreviewDragStartRef.current.x + gesture.dx,
        y: localPreviewDragStartRef.current.y + gesture.dy,
      });
      localPreviewOffsetRef.current = nextOffset;
      localPreviewPan.setValue(nextOffset);
    },
    onPanResponderRelease: (_event, gesture) => {
      if (canSwapOneToOneVideos && Math.abs(gesture.dx) <= 4 && Math.abs(gesture.dy) <= 4) {
        setLocalVideoExpanded((current) => !current);
      }
    },
    onPanResponderTerminate: () => {
      localPreviewPan.setValue(localPreviewOffsetRef.current);
    },
  }), [canSwapOneToOneVideos, clampLocalPreviewOffset, localPreviewPan]);

  useEffect(() => {
    const nextOffset = clampLocalPreviewOffset(localPreviewOffsetRef.current);
    if (nextOffset.x !== localPreviewOffsetRef.current.x || nextOffset.y !== localPreviewOffsetRef.current.y) {
      localPreviewOffsetRef.current = nextOffset;
      localPreviewPan.setValue(nextOffset);
    }
  }, [clampLocalPreviewOffset, localPreviewPan]);

  useEffect(() => {
    if (!canSwapOneToOneVideos) {
      setLocalVideoExpanded(false);
    }
  }, [canSwapOneToOneVideos]);

  useEffect(() => {
    onRemoteScreenShareActiveChange?.(visibleRemoteScreenShareActive);
  }, [onRemoteScreenShareActiveChange, visibleRemoteScreenShareActive]);

  return (
    <View style={[styles.videoGridStage, isCompact && styles.videoStageCompact]}>
      {visibleParticipants.map((participant, participantIndex) => {
        const isWaiting = participant === 'waiting';
        const isExpandedLocalTile = canSwapOneToOneVideos && isLocalVideoExpanded && !isWaiting;
        const participantId = isWaiting
          ? 'waiting'
          : isExpandedLocalTile
            ? localParticipant.identity
            : participant.id;
        const isLocalParticipant = participantId === localParticipant.identity;
        const participantName = isWaiting ? title : isExpandedLocalTile ? t('you') : participant.name;
        const participantAvatarUrl = isWaiting || isExpandedLocalTile ? undefined : participant.avatarUrl;
        const liveParticipant = isWaiting
          ? undefined
          : isLocalParticipant
            ? localParticipant
            : roomParticipants.find((item) => item.identity === participantId);
        const trackRef = isWaiting
          ? undefined
          : isLocalParticipant
            ? localTrack
            : getCameraTrackRefForParticipant(liveParticipant, trackRefs);
        const trackRenderKey = trackRef
          ? `${getTrackRenderKey(participantId, trackRef)}${isLocalParticipant ? `:${localCameraRenderVersion}` : ''}`
          : undefined;
        const isScreenShareTrack = isScreenShareTrackRef(trackRef);
        const videoObjectFit = isScreenShareTrack
          ? 'contain'
          : isCompact || shouldUseFullBleedMainVideo ? 'cover' : 'contain';
        const shouldUseIosPictureInPicture = Platform.OS === 'ios' &&
          enableIosPictureInPicture &&
          !isLocalParticipant &&
          participantIndex === 0;

        return (
          <View key={participantId} style={[styles.videoTile, getVideoTileStyle(styles, visibleParticipants.length)]}>
            {trackRef && isAndroidSystemPictureInPicture ? (
              <CallAndroidPipVideoTrack
                key={`${trackRenderKey}:pip`}
                mirror={isLocalParticipant && !isScreenShareTrack ? localCameraMirror : false}
                objectFit={videoObjectFit}
                style={styles.remoteVideo}
                trackRef={trackRef}
              />
            ) : trackRef ? (
              <VideoTrack
                iosPIP={shouldUseIosPictureInPicture ? {
                  enabled: true,
                  preferredSize: { width: 9, height: 16 },
                  startAutomatically: true,
                  stopAutomatically: true,
                } : undefined}
                key={trackRenderKey}
                mirror={isLocalParticipant && !isScreenShareTrack ? localCameraMirror : false}
                objectFit={videoObjectFit}
                style={styles.remoteVideo}
                trackRef={trackRef}
                zOrder={0}
              />
            ) : isLocalParticipant && !isCameraOff && localPreviewVideoTrack?.mediaStreamTrack.readyState === 'live' ? (
              <VideoView
                key={`local-grid-preview:${localPreviewVideoTrack.mediaStreamTrack.id}:${localCameraRenderVersion}`}
                mirror={localCameraMirror}
                objectFit={isCompact || shouldUseFullBleedMainVideo ? 'cover' : 'contain'}
                videoTrack={localPreviewVideoTrack}
                style={styles.remoteVideo}
                zOrder={0}
              />
            ) : isLocalParticipant ? (
              <View style={[styles.remotePlaceholder, isCompact && styles.remotePlaceholderCompact]}>
                <Ionicons color={colors.white} name={isCameraOff ? 'videocam-off' : 'videocam'} size={isCompact ? 22 : 32} />
                {showLabels && !isCompact ? <Text numberOfLines={1} style={styles.videoWaitingText}>{t('you')}</Text> : null}
              </View>
            ) : (
              <View style={[styles.remotePlaceholder, isCompact && styles.remotePlaceholderCompact]}>
                <Avatar label={participantName} size={isCompact ? 42 : visibleParticipants.length > 2 ? 62 : 94} uri={participantAvatarUrl} />
                {showLabels && !isCompact ? <Text numberOfLines={1} style={styles.videoWaitingText}>{t('waitingForVideo')}</Text> : null}
              </View>
            )}
            {showLabels && !isWaiting && !isCompact && !isLocalParticipant ? (
              <View style={styles.videoNamePill}>
                <Avatar label={participantName} size={22} uri={participantAvatarUrl} />
                <Text numberOfLines={1} style={styles.videoNameText}>{participantName}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {shouldUseLocalPreview ? (
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.localPreview,
            isCameraOff && !isLocalVideoExpanded && styles.localPreviewOff,
            { transform: localPreviewPan.getTranslateTransform() },
          ]}
        >
          {isLocalVideoExpanded && previewRemoteParticipant ? (
            <RemoteCameraPreview
              enableIosPictureInPicture={enableIosPictureInPicture}
              participant={previewRemoteParticipant}
              trackRef={getCameraTrackRefForParticipant(
                roomParticipants.find((item) => item.identity === previewRemoteParticipant.id),
                trackRefs,
              )}
              showLabels={showLabels}
            />
          ) : (
            <LocalCameraPreview
              isCameraOff={isCameraOff}
              localCameraRenderVersion={localCameraRenderVersion}
              localCameraMirror={localCameraMirror}
              localTrack={localTrack}
              previewVideoTrack={localPreviewVideoTrack}
              showLabels={showLabels}
            />
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

function RemoteCameraPreview({
  enableIosPictureInPicture = false,
  participant,
  showLabels = true,
  trackRef,
}: {
  enableIosPictureInPicture?: boolean;
  participant: { avatarUrl?: string | null; id: string; name: string };
  showLabels?: boolean;
  trackRef?: TrackReference;
}) {
  const styles = useCallRoomStyles();

  if (trackRef) {
    return (
      <>
        <VideoTrack
          iosPIP={Platform.OS === 'ios' && enableIosPictureInPicture ? {
            enabled: true,
            preferredSize: { width: 9, height: 16 },
            startAutomatically: true,
            stopAutomatically: true,
          } : undefined}
          key={getTrackRenderKey(`remote-preview:${participant.id}`, trackRef)}
          objectFit={isScreenShareTrackRef(trackRef) ? 'contain' : 'cover'}
          style={styles.localVideo}
          trackRef={trackRef}
          zOrder={1}
        />
        {showLabels ? (
          <View style={styles.localPreviewTextContainer}>
            <Text numberOfLines={1} style={styles.localPreviewText}>{participant.name}</Text>
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={[styles.remotePlaceholder, styles.remotePlaceholderCompact]}>
      <Avatar label={participant.name} size={42} uri={participant.avatarUrl} />
      {showLabels ? <Text numberOfLines={1} style={styles.localPreviewText}>{participant.name}</Text> : null}
    </View>
  );
}

function CallAndroidPipVideoTrack({
  mirror,
  objectFit = 'cover',
  style,
  trackRef,
}: {
  mirror?: boolean;
  objectFit?: 'cover' | 'contain';
  style?: ViewStyle;
  trackRef: TrackReference;
}) {
  const videoTrack = trackRef.publication.track;
  const [elementInfo] = useState(() => new CallPipVideoElementInfo(trackRef.publication.trackSid));
  const [mediaStream, setMediaStream] = useState(videoTrack?.mediaStream);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    elementInfo.onLayout(event);
  }, [elementInfo]);

  useEffect(() => {
    setMediaStream(videoTrack?.mediaStream);

    const handleRestarted = (track: Track | null) => {
      setMediaStream(track?.mediaStream);
    };

    videoTrack?.on(TrackEvent.Restarted, handleRestarted);

    return () => {
      videoTrack?.off(TrackEvent.Restarted, handleRestarted);
    };
  }, [videoTrack]);

  useEffect(() => {
    if (!(videoTrack instanceof RemoteVideoTrack)) {
      return undefined;
    }

    elementInfo.pictureInPicture = true;
    elementInfo.onVisibility(true);
    videoTrack.observeElementInfo(elementInfo);

    return () => {
      videoTrack.stopObservingElementInfo(elementInfo);
    };
  }, [elementInfo, trackRef.publication.trackSid, videoTrack]);

  const streamURL = (mediaStream as { toURL?: () => string } | undefined)?.toURL?.() ?? '';

  return (
    <View onLayout={handleLayout} style={[style, pipVideoStyles.container]}>
      <RTCView
        mirror={mirror}
        objectFit={objectFit}
        streamURL={streamURL}
        style={pipVideoStyles.video}
        zOrder={2}
      />
    </View>
  );
}

class CallPipVideoElementInfo implements ElementInfo {
  element: object = {};
  id?: string;
  _height = 0;
  _observing = false;
  _width = 0;
  pictureInPicture = true;
  visible = true;
  visibilityChangedAt: number | undefined;
  handleResize?: (() => void) | undefined;
  handleVisibilityChanged?: (() => void) | undefined;

  constructor(id?: string) {
    this.id = id;
  }

  height = () => this._height;
  width = () => this._width;

  observe() {
    this._observing = true;
  }

  stopObserving() {
    this._observing = false;
  }

  onLayout(event: LayoutChangeEvent) {
    this._width = event.nativeEvent.layout.width;
    this._height = event.nativeEvent.layout.height;

    if (this._observing) {
      this.handleResize?.();
    }
  }

  onVisibility(isVisible: boolean) {
    if (this.visible !== isVisible) {
      this.visible = isVisible;
      this.visibilityChangedAt = Date.now();

      if (this._observing) {
        this.handleVisibilityChanged?.();
      }
    }
  }
}

const pipVideoStyles = StyleSheet.create({
  container: {},
  video: {
    flex: 1,
    width: '100%',
  },
});

function LocalCameraPreview({
  isCameraOff,
  localCameraRenderVersion = 0,
  localCameraMirror = true,
  localTrack,
  previewVideoTrack,
  showLabels = true,
}: {
  isCameraOff: boolean;
  localCameraRenderVersion?: number;
  localCameraMirror?: boolean;
  localTrack?: TrackReference;
  previewVideoTrack: LocalVideoTrack | null;
  showLabels?: boolean;
}) {
  const styles = useCallRoomStyles();

  if (!isCameraOff && localTrack) {
    return (
      <VideoTrack
        key={`${getTrackRenderKey('local-preview', localTrack)}:${localCameraRenderVersion}`}
        mirror={localCameraMirror}
        objectFit="cover"
        style={styles.localVideo}
        trackRef={localTrack}
        zOrder={1}
      />
    );
  }

  if (!isCameraOff && previewVideoTrack?.mediaStreamTrack.readyState === 'live') {
    return (
      <VideoView
        key={`local-preview-standalone:${previewVideoTrack.mediaStreamTrack.id}:${localCameraRenderVersion}`}
        mirror={localCameraMirror}
        objectFit="cover"
        videoTrack={previewVideoTrack}
        style={styles.localVideo}
        zOrder={1}
      />
    );
  }

  return (
    <>
      <Ionicons color={colors.white} name={isCameraOff ? 'videocam-off' : 'videocam'} size={22} />
      {showLabels ? <Text style={styles.localPreviewText}>{t('you')}</Text> : null}
    </>
  );
}

function getParticipantProfile(
  participant: { identity: string; name?: string },
  profiles: Map<string, CallParticipantProfile>,
  fallbackName: string,
) {
  return profiles.get(participant.identity) ?? {
    name: participant.name || fallbackName,
  };
}

export function PeopleInCallModal({ isVisible, onClose, profiles }: { isVisible: boolean; onClose: () => void; profiles: Map<string, CallParticipantProfile> }) {
  const styles = useCallRoomStyles();
  const participants = useParticipants();

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={isVisible}>
      <View style={styles.modalShade}>
        <View style={styles.addPeoplePanel}>
          <View style={styles.addPeopleHeader}>
            <Text style={styles.addPeopleTitle}>{t('peopleInCall')}</Text>
            <Pressable onPress={onClose} style={styles.modalCloseButton}>
              <Ionicons color={colors.textPrimary} name="close" size={24} />
            </Pressable>
          </View>
          <FlatList
            data={participants}
            keyExtractor={(item) => item.identity}
            style={styles.modalList}
            renderItem={({ item }) => {
              const profile = getParticipantProfile(item, profiles, item.name || item.identity);

              return (
                <View style={styles.personRow}>
                  <Avatar label={profile.name} size={40} uri={profile.avatarUrl} />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{profile.name}</Text>
                    <Text style={styles.personUsername}>{t('connected')}</Text>
                  </View>
                </View>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

function getVideoTileStyle(styles: CallRoomStyles, count: number) {
  if (count <= 1) {
    return styles.videoTileOne;
  }

  if (count === 2) {
    return styles.videoTileTwo;
  }

  if (count <= 4) {
    return styles.videoTileFour;
  }

  return styles.videoTileSix;
}

type CallControlProps = {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onLongPress?: () => void;
  onPress: () => void;
};

export function CallControl({ active, icon, label, onLongPress, onPress }: CallControlProps) {
  const styles = useCallRoomStyles();

  return (
    <Pressable onLongPress={onLongPress} onPress={onPress} style={[styles.controlButton, active && styles.controlActive]}>
      <Ionicons color={colors.white} name={icon} size={24} />
      <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={2} style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

export function IncomingControls({
  isVoiceChangerPremium = false,
  onAnswer,
  onDecline,
  onVoiceChanger,
}: {
  isVoiceChangerPremium?: boolean;
  onAnswer: () => void;
  onDecline: () => void;
  onVoiceChanger?: () => void;
}) {
  const styles = useCallRoomStyles();

  return (
    <View style={styles.incomingControlsWrap}>
      {onVoiceChanger ? (
        <Pressable
          onPress={onVoiceChanger}
          style={[
            styles.incomingVoiceChangerButton,
            !isVoiceChangerPremium && styles.incomingVoiceChangerButtonLocked,
          ]}
        >
          <Ionicons color={colors.white} name="sparkles" size={24} />
          <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.incomingVoiceChangerText}>
            {t('voiceChanger')}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.incomingControls}>
        <Pressable onPress={onDecline} style={[styles.roundCallButton, styles.declineButton]}>
          <Ionicons color={colors.white} name="call" size={30} style={styles.declineIcon} />
          <Text style={styles.incomingActionText}>{t('decline')}</Text>
        </Pressable>
        <Pressable onPress={onAnswer} style={[styles.roundCallButton, styles.answerButton]}>
          <Ionicons color={colors.white} name="call" size={30} />
          <Text style={styles.incomingActionText}>{t('answer')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function CallConnectionProblemModal({
  isVisible,
  message,
  title,
}: {
  isVisible: boolean;
  message: string;
  title: string;
}) {
  const styles = useCallRoomStyles();
  const insets = useSafeAreaInsets();

  if (!isVisible) {
    return null;
  }

  return (
    <View pointerEvents="none" style={styles.connectionModalShade}>
      <View style={[styles.connectionModalPanel, { top: insets.top + spacing.sm }]}>
        <View style={styles.connectionIconWrap}>
          <Ionicons color={colors.white} name="cloud-offline" size={18} />
        </View>
        <View style={styles.connectionModalText}>
          <Text numberOfLines={1} style={styles.connectionModalTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.connectionModalMessage}>{message}</Text>
          <View style={styles.connectionProgressRow}>
            <ActivityIndicator color={colors.white} size="small" />
            <Text numberOfLines={1} style={styles.connectionProgressText}>{t('reconnectingTrySeconds')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

export function WaitingIncomingCallModal({
  cancelLabel,
  isVisible,
  message,
  onCancel,
  onSwitch,
  switchLabel,
  topOffset,
  title,
}: {
  cancelLabel: string;
  isVisible: boolean;
  message: string;
  onCancel: () => void;
  onSwitch: () => void;
  switchLabel: string;
  topOffset: number;
  title: string;
}) {
  const styles = useCallRoomStyles();

  return (
    <Modal animationType="fade" transparent visible={isVisible}>
      <View pointerEvents="box-none" style={styles.waitingCallOverlay}>
        <View style={[styles.waitingCallBanner, { top: topOffset }]}>
          <View style={styles.waitingCallBannerText}>
            <View style={styles.waitingCallIconWrap}>
              <Ionicons color={colors.white} name="call" size={20} />
            </View>
            <View style={styles.waitingCallMessageWrap}>
              <Text style={styles.waitingCallTitle}>{title}</Text>
              <Text style={styles.waitingCallMessage}>{message}</Text>
            </View>
          </View>
          <View style={styles.waitingCallActions}>
            <Pressable accessibilityLabel={cancelLabel} onPress={onCancel} style={styles.waitingCallSecondaryButton}>
              <Ionicons color={colors.white} name="close" size={22} />
            </Pressable>
            <Pressable accessibilityLabel={switchLabel} onPress={onSwitch} style={styles.waitingCallPrimaryButton}>
              <Ionicons color={colors.white} name="swap-horizontal" size={22} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
