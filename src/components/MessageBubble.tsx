import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { type ComponentProps, type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { resolveLanguage, t, type AppLanguage } from '../i18n';
import { formatBytes, formatDuration } from '../lib/format';
import { downloadRemoteMediaFile, getCachedVideoThumbnailUri, getMediaDownloadProgress, getMessageMediaCacheUri, getRememberedCachedVideoThumbnailUri, isLocalMediaFileComplete, MediaDownloadProgress, pauseMediaDownload, resolveCachedMessageMediaUri, resolveLocalMediaFileUri, subscribeToMediaDownloadProgress } from '../lib/mediaCache';
import { LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS, stopTrackedLiveLocationShare } from '../lib/liveLocation';
import { openNativeAndroidFile } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { Message } from '../types/domain';

type Props = {
  message: Message;
  canRedialCallMessage?: boolean;
  isMine: boolean;
  isPinned?: boolean;
  showSender?: boolean;
  onPlayVoice: (message: Message) => void;
  onOpenMedia?: (message: Message) => void;
  onOpenCall?: (message: Message) => void;
  onOpenDisappearing?: (message: Message) => void;
  onCancelUpload?: (messageId: string) => void;
  onLongPress?: (message: Message) => void;
  onOpenReply?: (messageId: string) => void;
  isPlayingVoice?: boolean;
  enableSwipeReply?: boolean;
  onSwipeReply?: (message: Message) => void;
  uploadProgress?: { sentBytes: number; totalBytes: number };
  voicePlayed?: boolean;
  voiceProgress?: number;
};

const MESSAGE_PREVIEW_LINE_LIMIT = 7;
const SWIPE_REPLY_HINT_DISTANCE = 12;
const SWIPE_REPLY_TRIGGER_DISTANCE = 86;
const SWIPE_REPLY_MAX_TRANSLATE = 108;
const UNPLAYED_VOICE_ACCENT = '#22c55e';
type IoniconName = ComponentProps<typeof Ionicons>['name'];
type MapModule = {
  default: ComponentType<any>;
  Marker: ComponentType<any>;
  PROVIDER_GOOGLE?: string;
};
type MapRegion = {
  latitude: number;
  latitudeDelta: number;
  longitude: number;
  longitudeDelta: number;
};
const mapModule = loadMapModule();
const MapView = mapModule?.default;
const MapMarker = mapModule?.Marker;
const GOOGLE_MAP_PROVIDER = mapModule?.PROVIDER_GOOGLE;

export function MessageBubble({ canRedialCallMessage = false, enableSwipeReply = false, isMine, isPinned = false, isPlayingVoice, message, onCancelUpload, onLongPress, onOpenCall, onOpenDisappearing, onOpenMedia, onOpenReply, onPlayVoice, onSwipeReply, showSender = false, uploadProgress, voicePlayed = false, voiceProgress = 0 }: Props) {
  const themeColors = useThemeColors();
  styles = useMemo(() => createStyles(), [
    themeColors.appBackground,
    themeColors.border,
    themeColors.chatBackground,
    themeColors.danger,
    themeColors.incomingBubble,
    themeColors.mutedText,
    themeColors.outgoingBubble,
    themeColors.primary,
    themeColors.primaryDark,
    themeColors.surface,
    themeColors.textPrimary,
    themeColors.textSecondary,
    themeColors.white,
  ]);
  const languagePreference = useAppStore((state) => state.languagePreference);
  const language = resolveLanguage(languagePreference);
  const isUploading = message.status === 'sending' && message.kind !== 'text';
  const callEnded = hasCallEnded(message);
  const callId = message.kind === 'call' ? getCallId(message) : undefined;
  const canOpenCallMessage = (!!callId && !callEnded) || canRedialCallMessage;
  const callHint = message.kind === 'call' && (callId || canRedialCallMessage)
    ? (callEnded || !callId
        ? (canRedialCallMessage ? t('tapToCall', {}, language) : t('ended', {}, language))
        : t('tapToJoin', {}, language))
    : null;
  const replyTo = getReplyTo(message);
  const isForwarded = isForwardedMessage(message);
  const location = getLocation(message);
  const liveLocation = getLiveLocation(message);
  const liveLocationEstablishment = getLiveLocationEstablishment(message);
  const liveLocationEstablishmentStartedAt = liveLocationEstablishment?.startedAt;
  const liveLocationEstablishmentState = liveLocationEstablishment?.state;
  const disappearingAfterView = getDisappearingAfterView(message);
  const disappearingDeleteAt = getDisappearingDeleteAt(message);
  const isDisappearingConcealed = !!disappearingAfterView && !isMine && !disappearingDeleteAt;
  const [isExpandedTextVisible, setExpandedTextVisible] = useState(false);
  const [isMessageOverflowing, setMessageOverflowing] = useState(false);
  const [hasMeasuredMessage, setHasMeasuredMessage] = useState(false);
  const [messageTextWidth, setMessageTextWidth] = useState(0);
  const [downloadProgress, setDownloadProgress] = useState<MediaDownloadProgress | null>(() => getMediaDownloadProgress(message.id));
  const [isLiveLocationViewerVisible, setLiveLocationViewerVisible] = useState(false);
  const [, setLiveLocationTick] = useState(0);
  const [, setLiveLocationEstablishmentTick] = useState(0);
  const swipeTranslateX = useRef(new Animated.Value(0)).current;
  const hasTriggeredSwipeReplyRef = useRef(false);
  const shouldShowMessagePreview = !isDisappearingConcealed && !liveLocationEstablishment && shouldRenderMessageBody(message, liveLocation ?? location);
  const shouldClampMessagePreview = shouldShowMessagePreview && (!hasMeasuredMessage || isMessageOverflowing);
  const reactionEmojis = getMessageReactionEmojis(message);
  const isScheduledMessage = isMessageScheduled(message);
  const handleDownloadPress = useCallback(() => {
    if (!downloadProgress) {
      return false;
    }

    if (downloadProgress.status === 'downloading') {
      pauseMediaDownload(message.id);
      return true;
    }

    if (downloadProgress.status === 'paused') {
      void downloadAttachmentToCache(message).catch(() => undefined);
      return true;
    }

    return false;
  }, [downloadProgress, message]);
  const shouldMeasureMessage = useMemo(() => (
    shouldShowMessagePreview &&
    message.body.trim().length > 0 &&
    messageTextWidth > 0 &&
    !hasMeasuredMessage
  ), [hasMeasuredMessage, message.body, messageTextWidth, shouldShowMessagePreview]);
  const voiceAccentColor = message.kind === 'voice' && !isMine && !voicePlayed
    ? UNPLAYED_VOICE_ACCENT
    : colors.primary;

  useEffect(() => {
    setExpandedTextVisible(false);
    setMessageOverflowing(false);
    setHasMeasuredMessage(false);
    setMessageTextWidth(0);
  }, [message.body, message.id]);

  useEffect(() => {
    setDownloadProgress(getMediaDownloadProgress(message.id));
    return subscribeToMediaDownloadProgress((progress) => {
      if (progress.messageId === message.id) {
        setDownloadProgress(progress.status === 'complete' ? null : progress);
      }
    });
  }, [message.id]);

  useEffect(() => {
    if (!liveLocation || isLiveLocationEnded(liveLocation)) {
      return;
    }

    const interval = setInterval(() => setLiveLocationTick((current) => current + 1), 60 * 1000);
    return () => clearInterval(interval);
  }, [liveLocation?.expiresAt, liveLocation?.id, liveLocation?.stoppedAt]);

  useEffect(() => {
    if (!liveLocationEstablishmentStartedAt || liveLocationEstablishmentState !== 'pending') {
      return;
    }

    const remainingMs = getLiveLocationEstablishmentRemainingMs({ startedAt: liveLocationEstablishmentStartedAt });

    if (remainingMs <= 0) {
      return;
    }

    const timeout = setTimeout(() => setLiveLocationEstablishmentTick((current) => current + 1), remainingMs);
    return () => clearTimeout(timeout);
  }, [liveLocationEstablishmentStartedAt, liveLocationEstablishmentState]);

  const resetSwipePosition = useCallback(() => {
    Animated.spring(swipeTranslateX, {
      bounciness: 0,
      speed: 22,
      toValue: 0,
      useNativeDriver: true,
    }).start(() => {
      hasTriggeredSwipeReplyRef.current = false;
    });
  }, [swipeTranslateX]);

  const triggerSwipeReply = useCallback(() => {
    if (hasTriggeredSwipeReplyRef.current || !enableSwipeReply || !onSwipeReply) {
      return;
    }

    hasTriggeredSwipeReplyRef.current = true;
    onSwipeReply(message);
    resetSwipePosition();
  }, [enableSwipeReply, message, onSwipeReply, resetSwipePosition]);

  const shouldClaimSwipeReplyGesture = useCallback((gestureState: { dx: number; dy: number }) => (
      enableSwipeReply &&
      !hasTriggeredSwipeReplyRef.current &&
      gestureState.dx > 8 &&
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.2
  ), [enableSwipeReply]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => shouldClaimSwipeReplyGesture(gestureState),
    onMoveShouldSetPanResponderCapture: (_, gestureState) => shouldClaimSwipeReplyGesture(gestureState),
    onPanResponderGrant: () => {
      swipeTranslateX.stopAnimation();
    },
    onPanResponderMove: (_, gestureState) => {
      const clampedDx = Math.max(0, Math.min(gestureState.dx, SWIPE_REPLY_MAX_TRANSLATE));
      swipeTranslateX.setValue(clampedDx);
    },
    onPanResponderRelease: (_, gestureState) => {
      if (hasTriggeredSwipeReplyRef.current) {
        return;
      }

      if (gestureState.dx >= SWIPE_REPLY_TRIGGER_DISTANCE || (gestureState.vx > 0.55 && gestureState.dx > SWIPE_REPLY_HINT_DISTANCE)) {
        triggerSwipeReply();
        return;
      }

      resetSwipePosition();
    },
    onPanResponderTerminate: resetSwipePosition,
    onPanResponderTerminationRequest: () => false,
  }), [resetSwipePosition, shouldClaimSwipeReplyGesture, swipeTranslateX, triggerSwipeReply]);

  const swipeReplyIconOpacity = swipeTranslateX.interpolate({
    inputRange: [0, SWIPE_REPLY_HINT_DISTANCE, SWIPE_REPLY_TRIGGER_DISTANCE],
    outputRange: [0, 0.55, 1],
    extrapolate: 'clamp',
  });

  const swipeReplyIconScale = swipeTranslateX.interpolate({
    inputRange: [0, SWIPE_REPLY_HINT_DISTANCE, SWIPE_REPLY_TRIGGER_DISTANCE],
    outputRange: [0.82, 0.94, 1],
    extrapolate: 'clamp',
  });

  return (
    <>
      <View style={styles.swipeReplyWrap}>
        {enableSwipeReply ? (
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.swipeReplyActionWrap,
              {
                opacity: swipeReplyIconOpacity,
                transform: [{ scale: swipeReplyIconScale }],
              },
            ]}
          >
            <Pressable
              accessibilityLabel={t('reply', {}, language)}
              hitSlop={10}
              onPress={triggerSwipeReply}
              style={styles.swipeReplyButton}
            >
              <Ionicons color={colors.primary} name="arrow-undo-outline" size={18} />
            </Pressable>
          </Animated.View>
        ) : null}
        <Animated.View
          style={enableSwipeReply ? [styles.swipeReplyAnimated, { transform: [{ translateX: swipeTranslateX }] }] : undefined}
          {...(enableSwipeReply ? panResponder.panHandlers : {})}
        >
      <Pressable onLongPress={() => onLongPress?.(message)} style={[styles.bubble, isMine ? styles.outgoing : styles.incoming]}>
        {showSender && !isMine && message.sender ? (
          <Text style={styles.senderName}>{message.sender.displayName || message.sender.username}</Text>
        ) : null}
        {isForwarded ? <Text style={styles.forwardedLabel}>{t('forwarded', {}, language)}</Text> : null}
        {replyTo ? (
          <Pressable onPress={() => onOpenReply?.(replyTo.id)} style={({ pressed }) => [styles.replyPreview, pressed && styles.replyPreviewPressed]}>
            <Text numberOfLines={1} style={styles.replySender}>{replyTo.senderName}</Text>
            <Text numberOfLines={2} style={styles.replyBody}>{getMessagePreview(replyTo, language)}</Text>
          </Pressable>
        ) : null}
        {isDisappearingConcealed ? (
          <Pressable onPress={() => onOpenDisappearing?.(message)} style={styles.disappearingRevealCard}>
            <View style={styles.disappearingRevealIcon}>
              <Ionicons color={colors.white} name="eye-off-outline" size={20} />
            </View>
            <View style={styles.disappearingRevealText}>
              <Text style={styles.disappearingRevealTitle}>{t('clickToView', {}, language)}</Text>
            </View>
          </Pressable>
        ) : null}
        {!isDisappearingConcealed && message.kind === 'call' ? (
          <Pressable onLongPress={() => onLongPress?.(message)} onPress={() => (canOpenCallMessage ? onOpenCall?.(message) : undefined)} style={({ pressed }) => [styles.callRow, pressed && canOpenCallMessage && styles.callRowPressed]}>
            <Ionicons color={getCallStatusColor(message)} name={getCallMode(message) === 'VIDEO' ? 'videocam-outline' : 'call-outline'} size={18} />
            <View style={styles.callTextWrap}>
              <View style={styles.callBadgeRow}>
                <View style={styles.callBadge}>
                  <Text style={styles.callBadgeText}>{isMine ? t('outgoing', {}, language) : t('incoming', {}, language)}</Text>
                </View>
                {getCallStatusLabel(message, language, isMine) ? (
                  <View style={styles.callOutcomeBadge}>
                    <Text style={styles.callOutcomeBadgeText}>{getCallStatusLabel(message, language, isMine)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.callText}>{getCallBodyLabel(message, language)}</Text>
              {callHint ? <Text style={styles.callHint}>{callHint}</Text> : null}
            </View>
          </Pressable>
        ) : null}
        {!isDisappearingConcealed && message.kind === 'image' && message.mediaUri ? (
          <Pressable onLongPress={() => onLongPress?.(message)} onPress={() => {
            if (handleDownloadPress()) return;
            onOpenMedia?.(message);
          }}>
            {shouldHideRemoteMediaUntilDownloaded(message, downloadProgress) ? (
              <View style={styles.mediaPreviewPlaceholder} />
            ) : (
              <ImagePreview message={message} />
            )}
            {isUploading ? <UploadOverlay messageId={message.id} onCancel={onCancelUpload} progress={uploadProgress} /> : null}
            {!isUploading && downloadProgress ? <DownloadOverlay language={language} progress={downloadProgress} /> : null}
          </Pressable>
        ) : null}

        {!isDisappearingConcealed && message.kind === 'video' ? (
          <Pressable onLongPress={() => onLongPress?.(message)} onPress={() => {
            if (handleDownloadPress()) return;
            onOpenMedia?.(message);
          }} style={styles.videoPreviewWrap}>
            {message.mediaUri && !shouldHideRemoteMediaUntilDownloaded(message, downloadProgress) ? <VideoPreview message={message} /> : null}
            <View style={styles.videoOverlay}>
              {isUploading ? (
                <UploadProgressControl messageId={message.id} onCancel={onCancelUpload} progress={uploadProgress} />
              ) : downloadProgress ? (
                <DownloadProgressControl language={language} progress={downloadProgress} />
              ) : (
                <Ionicons color={colors.white} name="play" size={26} />
              )}
            </View>
            <Text numberOfLines={1} style={styles.videoLabel}>{message.fileName ?? t('video', {}, language)}</Text>
          </Pressable>
        ) : null}

        {!isDisappearingConcealed && message.kind === 'file' ? (
          <Pressable onLongPress={() => onLongPress?.(message)} onPress={() => {
            if (handleDownloadPress()) return;
            void openFile(message);
          }} style={styles.fileRow}>
            {isUploading ? (
              <UploadProgressControl dark messageId={message.id} onCancel={onCancelUpload} progress={uploadProgress} />
            ) : downloadProgress ? (
              <DownloadProgressControl dark language={language} progress={downloadProgress} />
            ) : (
              <Ionicons color={colors.primaryDark} name="document-text" size={22} />
            )}
            <View style={styles.fileText}>
              <Text style={styles.fileName}>{message.fileName ?? t('file', {}, language)}</Text>
              <Text style={styles.fileMeta}>{formatBytes(message.sizeBytes)}</Text>
            </View>
          </Pressable>
        ) : null}

        {!isDisappearingConcealed && liveLocationEstablishment && !liveLocation ? (
          <View style={styles.liveLocationEstablishmentCard}>
            {!isLiveLocationEstablishmentFailed(liveLocationEstablishment) ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Ionicons color={colors.danger} name="alert-circle" size={22} />
            )}
            <View style={styles.liveLocationEstablishmentText}>
              <Text style={styles.locationTitle}>{t('liveLocation', {}, language)}</Text>
              <Text style={styles.locationAddress}>
                {!isLiveLocationEstablishmentFailed(liveLocationEstablishment)
                  ? t('liveLocationEstablishing', {}, language)
                  : t('liveLocationEstablishmentFailed', {}, language)}
              </Text>
            </View>
          </View>
        ) : null}

        {!isDisappearingConcealed && (location || liveLocation) ? (
          <Pressable
            onLongPress={() => onLongPress?.(message)}
            onPress={() => {
              if (liveLocation) {
                setLiveLocationViewerVisible(true);
                return;
              }

              openLocation(location!);
            }}
            style={({ pressed }) => [styles.locationCard, pressed && styles.locationCardPressed]}
          >
            <Image source={{ uri: getStaticMapUrl(liveLocation ?? location!) }} style={styles.locationMap} />
            <View style={styles.locationPin}>
              <Ionicons color={colors.white} name="location" size={18} />
            </View>
            <View style={styles.locationInfo}>
              <Text style={styles.locationTitle}>{liveLocation ? t('liveLocation', {}, language) : t('location', {}, language)}</Text>
              <Text numberOfLines={1} style={styles.locationAddress}>{(liveLocation ?? location!)?.address || formatCoordinates(liveLocation ?? location!)}</Text>
              {liveLocation ? <Text style={styles.locationAddress}>{getLiveLocationStatus(liveLocation, language)}</Text> : null}
              {liveLocation && isMine && !isLiveLocationEnded(liveLocation) ? (
                <Pressable onPress={() => void stopTrackedLiveLocationShare(liveLocation.id)} style={styles.liveLocationStopButton}>
                  <Text style={styles.liveLocationStopText}>{t('stopSharing', {}, language)}</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        ) : null}

        {!isDisappearingConcealed && message.kind === 'voice' ? (
          <Pressable onLongPress={() => onLongPress?.(message)} onPress={() => onPlayVoice(message)} style={styles.voiceRow}>
            <View style={[styles.playButton, { backgroundColor: voiceAccentColor }]}>
              {isUploading ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Ionicons color={colors.white} name={isPlayingVoice ? 'pause' : 'play'} size={18} />
              )}
            </View>
            <View style={[styles.voiceTrack, { backgroundColor: withAlpha(voiceAccentColor, 0.26) }]}>
              <View style={[styles.voiceProgress, { backgroundColor: voiceAccentColor, width: `${Math.min(1, Math.max(0, voiceProgress)) * 100}%` }]} />
            </View>
            <Text style={styles.voiceTime}>{formatDuration(message.durationSeconds)}</Text>
          </Pressable>
        ) : null}

        {shouldShowMessagePreview ? (
          <View
            onLayout={(event) => {
              const nextWidth = Math.round(event.nativeEvent.layout.width);

              if (nextWidth > 0 && nextWidth !== messageTextWidth) {
                setMessageTextWidth(nextWidth);
                setHasMeasuredMessage(false);
              }
            }}
            style={styles.messageTextWrap}
          >
            <Text
              ellipsizeMode="tail"
              numberOfLines={shouldClampMessagePreview ? MESSAGE_PREVIEW_LINE_LIMIT : undefined}
              style={styles.messageText}
            >
              <LinkifiedMessageText linkStyle={styles.messageLink} text={message.body} />
            </Text>
            {shouldMeasureMessage ? (
              <View pointerEvents="none" style={[styles.messageTextMeasureWrap, { width: messageTextWidth }]}>
                <Text
                  onTextLayout={(event) => {
                    const nextOverflow = event.nativeEvent.lines.length > MESSAGE_PREVIEW_LINE_LIMIT;
                    setMessageOverflowing(nextOverflow);
                    setHasMeasuredMessage(true);
                  }}
                  style={styles.messageTextMeasure}
                >
                  {message.body}
                </Text>
              </View>
            ) : null}
            {isMessageOverflowing ? (
              <Pressable onPress={() => setExpandedTextVisible(true)} style={styles.readMoreButton}>
                <Text style={styles.readMoreText}>{t('readMore', {}, language)}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={styles.metaRow}>
          {isScheduledMessage ? <Ionicons color={colors.textSecondary} name="time-outline" size={11} /> : null}
          {isPinned ? <Ionicons color={colors.textSecondary} name="pin" size={11} /> : null}
          <Text style={styles.meta}>{message.createdAt}</Text>
          {isMine ? <MessageTicks language={language} status={message.status} /> : null}
        </View>
        {reactionEmojis.length > 0 ? (
          <View style={[styles.reactionPill, isMine ? styles.reactionPillOutgoing : styles.reactionPillIncoming]}>
            <Text style={styles.reactionPillText}>{reactionEmojis.join(' ')}</Text>
          </View>
        ) : null}
      </Pressable>
        </Animated.View>
      </View>

      {liveLocation ? (
        <LiveLocationMapViewer
          isMine={isMine}
          language={language}
          location={liveLocation}
          onClose={() => setLiveLocationViewerVisible(false)}
          visible={isLiveLocationViewerVisible}
        />
      ) : null}

      <Modal animationType="slide" transparent visible={isExpandedTextVisible} onRequestClose={() => setExpandedTextVisible(false)}>
        <View style={styles.expandedTextShade}>
          <View style={styles.expandedTextPanel}>
            <View style={styles.expandedTextHeader}>
              <Pressable onPress={() => setExpandedTextVisible(false)} style={styles.expandedTextCloseButton}>
                <Text style={styles.expandedTextCloseText}>{t('close', {}, language)}</Text>
              </Pressable>
              <Text style={styles.expandedTextTitle}>{t('message', {}, language)}</Text>
              <View style={styles.expandedTextHeaderSpacer} />
            </View>
            <ScrollView contentContainerStyle={styles.expandedTextScrollContent} style={styles.expandedTextScroll}>
              <Text selectable style={styles.expandedTextBody}>
                <LinkifiedMessageText linkStyle={styles.messageLink} text={message.body} />
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function LiveLocationMapViewer({
  isMine,
  language,
  location,
  onClose,
  visible,
}: {
  isMine: boolean;
  language: AppLanguage;
  location: {
    address?: string;
    expiresAt: string;
    id: string;
    latitude: number;
    longitude: number;
    stoppedAt?: string;
    updatedAt?: string;
  };
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<{ animateToRegion?: (region: MapRegion, duration?: number) => void } | null>(null);
  const region = useMemo(() => getLiveLocationMapRegion(location), [location.latitude, location.longitude]);
  const canRenderNativeMap = !!MapView && !!MapMarker;

  useEffect(() => {
    if (!visible || !canRenderNativeMap) {
      return;
    }

    const timeout = setTimeout(() => {
      mapRef.current?.animateToRegion?.(region, 550);
    }, 80);

    return () => clearTimeout(timeout);
  }, [region, visible]);

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <View style={styles.liveLocationViewer}>
        {canRenderNativeMap ? (
          <MapView
            key={location.id}
            ref={mapRef as any}
            initialRegion={region}
            onMapReady={() => mapRef.current?.animateToRegion?.(region, 0)}
            provider={Platform.OS === 'android' ? GOOGLE_MAP_PROVIDER : undefined}
            showsCompass
            showsScale
            style={styles.liveLocationMapView}
            toolbarEnabled={false}
          >
            <MapMarker
              coordinate={{ latitude: location.latitude, longitude: location.longitude }}
              description={location.address || formatCoordinates(location)}
              title={t('liveLocation', {}, language)}
            />
          </MapView>
        ) : (
          <View style={styles.liveLocationMapFallback}>
            <View style={styles.liveLocationMapFallbackIcon}>
              <Ionicons color={colors.primary} name="map-outline" size={46} />
            </View>
            <Text style={styles.liveLocationMapFallbackTitle}>{t('liveLocation', {}, language)}</Text>
            <Text style={styles.liveLocationMapFallbackText}>{formatCoordinates(location)}</Text>
            <Pressable onPress={() => openLocation(location)} style={styles.liveLocationMapFallbackButton}>
              <Ionicons color={colors.white} name="navigate" size={18} />
              <Text style={styles.liveLocationMapFallbackButtonText}>{t('liveLocationOpenInMaps', {}, language)}</Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.liveLocationViewerHeader, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable accessibilityLabel={t('close', {}, language)} onPress={onClose} style={styles.liveLocationViewerIconButton}>
            <Ionicons color={colors.textPrimary} name="close" size={24} />
          </Pressable>
          <View style={styles.liveLocationViewerTitleWrap}>
            <Text numberOfLines={1} style={styles.liveLocationViewerTitle}>{t('liveLocation', {}, language)}</Text>
            <Text numberOfLines={1} style={styles.liveLocationViewerStatus}>{getLiveLocationStatus(location, language)}</Text>
          </View>
          <Pressable accessibilityLabel={t('liveLocationOpenInMaps', {}, language)} onPress={() => openLocation(location)} style={styles.liveLocationViewerIconButton}>
            <Ionicons color={colors.primary} name="navigate" size={22} />
          </Pressable>
        </View>

        <View style={[styles.liveLocationViewerSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.liveLocationViewerAddressRow}>
            <View style={styles.liveLocationViewerPin}>
              <Ionicons color={colors.white} name="location" size={18} />
            </View>
            <View style={styles.liveLocationViewerAddressText}>
              <Text numberOfLines={2} style={styles.liveLocationViewerAddress}>{location.address || t('location', {}, language)}</Text>
              <Text style={styles.liveLocationViewerCoordinates}>{formatCoordinates(location)}</Text>
            </View>
          </View>

          <View style={styles.liveLocationViewerActions}>
            <Pressable onPress={() => openLocation(location)} style={styles.liveLocationViewerSecondaryButton}>
              <Ionicons color={colors.primary} name="open-outline" size={18} />
              <Text style={styles.liveLocationViewerSecondaryText}>{t('liveLocationOpenInMaps', {}, language)}</Text>
            </Pressable>
            {isMine && !isLiveLocationEnded(location) ? (
              <Pressable onPress={() => void stopTrackedLiveLocationShare(location.id)} style={styles.liveLocationViewerStopButton}>
                <Ionicons color={colors.white} name="stop-circle-outline" size={18} />
                <Text style={styles.liveLocationViewerStopText}>{t('stopSharing', {}, language)}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ImagePreview({ message }: { message: Message }) {
  const [resolvedUri, setResolvedUri] = useState<string | null>(message.mediaUri ?? null);

  useEffect(() => {
    let isMounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    async function resolveImageUri(shouldRetry = true) {
      const nextUri = await getRenderableImageUri(message).catch(() => message.mediaUri ?? null);

      if (isMounted) {
        setResolvedUri(nextUri);
      }

      if (!nextUri && shouldRetry && isMounted) {
        retryTimeout = setTimeout(() => {
          void resolveImageUri(false);
        }, 700);
      }
    }

    setResolvedUri(message.mediaUri ?? null);
    void resolveImageUri();

    return () => {
      isMounted = false;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [message]);

  if (!resolvedUri) {
    return <View style={styles.mediaPreviewPlaceholder} />;
  }

  return <Image source={{ uri: resolvedUri }} style={styles.mediaPreview} />;
}

function VideoPreview({ message }: { message: Message }) {
  const { fileName, id, kind, mediaUri, metadata, sizeBytes, status } = message;
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(() => getRememberedCachedVideoThumbnailUri({
    messageId: id,
    quality: 0.72,
    sourceSizeBytes: sizeBytes,
    sourceUri: mediaUri,
    timeMs: 350,
  }));
  const [hasFailed, setFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    async function loadThumbnail(shouldRetry = true) {
      setFailed(false);

      try {
        const localUri = await getThumbnailSourceUri({ fileName, id, kind, mediaUri, metadata, sizeBytes, status });
        const rememberedThumbnail = getRememberedCachedVideoThumbnailUri({
          messageId: id,
          quality: 0.72,
          sourceSizeBytes: sizeBytes,
          sourceUri: localUri,
          timeMs: 350,
        });

        if (rememberedThumbnail && isMounted) {
          setThumbnailUri(rememberedThumbnail);
        }

        const thumbnail = await getCachedVideoThumbnailUri({
          messageId: id,
          quality: 0.72,
          sourceSizeBytes: sizeBytes,
          sourceUri: localUri,
          timeMs: 350,
        });

        if (!thumbnail) {
          throw new Error(t('videoThumbnailFailed'));
        }

        if (isMounted) {
          setThumbnailUri(thumbnail);
        }
      } catch {
        if (isMounted) {
          setFailed(true);
        }

        if (shouldRetry && isMounted) {
          retryTimeout = setTimeout(() => {
            void loadThumbnail(false);
          }, 900);
        }
      }
    }

    void loadThumbnail();

    return () => {
      isMounted = false;
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [fileName, id, kind, mediaUri, metadata, sizeBytes, status]);

  if (thumbnailUri) {
    return <Image source={{ uri: thumbnailUri }} style={styles.videoPreview} />;
  }

  return (
    <View style={[styles.videoPreview, styles.videoPreviewFallback]}>
      {hasFailed ? (
        <Ionicons color={colors.white} name="videocam" size={34} />
      ) : (
        <ActivityIndicator color={colors.white} size="small" />
      )}
    </View>
  );
}

async function getRenderableImageUri(message: Pick<Message, 'mediaUri' | 'metadata' | 'sizeBytes' | 'status'>) {
  const uri = message.mediaUri;

  if (!uri) {
    throw new Error(t('imageNotAvailableYet'));
  }

  if (!/^https?:\/\//i.test(uri)) {
    if (message.status !== 'sending' && /^file:/i.test(uri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(uri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return remoteUri;
      }

      throw new Error(t('imageStillDownloading'));
    }

    return uri;
  }

  return uri;
}

async function getThumbnailSourceUri(message: Pick<Message, 'fileName' | 'id' | 'kind' | 'mediaUri' | 'metadata' | 'sizeBytes' | 'status'>) {
  const uri = message.mediaUri;

  if (!uri) {
    throw new Error(t('videoNotAvailableYet'));
  }

  if (!/^https?:\/\//i.test(uri)) {
    if (message.status !== 'sending' && /^file:/i.test(uri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(uri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        const cachedMediaUri = await resolveCachedMessageMediaUri({
          expectedSizeBytes: message.sizeBytes,
          fileName: message.fileName,
          kind: message.kind,
          messageId: message.id,
        });

        if (cachedMediaUri) {
          return cachedMediaUri;
        }
      }

      throw new Error(t('videoStillDownloading'));
    }

    return uri;
  }

  const cachedUri = await resolveCachedMessageMediaUri({
    expectedSizeBytes: message.sizeBytes,
    fileName: message.fileName,
    kind: message.kind,
    messageId: message.id,
  });

  if (!cachedUri) {
    throw new Error(t('videoStillDownloading'));
  }

  return cachedUri;
}

function LinkifiedMessageText({
  linkStyle,
  text,
}: {
  linkStyle: StyleProp<TextStyle>;
  text: string;
}) {
  const parts = useMemo(() => parseMessageLinks(text), [text]);

  return (
    <>
      {parts.map((part) => {
        const href = part.href;

        return href ? (
          <Text key={part.key} onPress={() => void openMessageLink(href)} style={linkStyle}>
            {part.text}
          </Text>
        ) : <Text key={part.key}>{part.text}</Text>;
      })}
    </>
  );
}

type MessageTextPart = {
  href?: string;
  key: string;
  text: string;
};

const MESSAGE_URL_PATTERN = /(^|[^A-Z0-9@._-])((?:https?:\/\/|www\.)[^\s<>()]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#][^\s<>()]*)?)/gi;
const TRAILING_URL_PUNCTUATION = '.,!?;:';
const OPENING_BRACKETS: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
};

function parseMessageLinks(text: string): MessageTextPart[] {
  const parts: MessageTextPart[] = [];
  let lastIndex = 0;

  MESSAGE_URL_PATTERN.lastIndex = 0;

  for (const match of text.matchAll(MESSAGE_URL_PATTERN)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? '';
    const rawUrl = match[2] ?? '';
    const matchIndex = match.index ?? 0;
    const urlStart = matchIndex + prefix.length;

    if (!rawUrl || urlStart < lastIndex) {
      continue;
    }

    if (urlStart > lastIndex) {
      parts.push({
        key: `text-${lastIndex}`,
        text: text.slice(lastIndex, urlStart),
      });
    }

    const { trailingText, urlText } = trimTrailingUrlPunctuation(rawUrl);

    parts.push({
      href: normalizeMessageUrl(urlText),
      key: `link-${urlStart}`,
      text: urlText,
    });

    if (trailingText) {
      parts.push({
        key: `text-${urlStart + urlText.length}`,
        text: trailingText,
      });
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      key: `text-${lastIndex}`,
      text: text.slice(lastIndex),
    });
  }

  return parts.length > 0 ? parts : [{ key: 'text-0', text }];
}

function trimTrailingUrlPunctuation(rawUrl: string) {
  let urlText = rawUrl;
  let trailingText = '';

  while (urlText.length > 0) {
    const lastCharacter = urlText.charAt(urlText.length - 1);

    if (TRAILING_URL_PUNCTUATION.includes(lastCharacter) || isUnmatchedClosingBracket(urlText, lastCharacter)) {
      trailingText = lastCharacter + trailingText;
      urlText = urlText.slice(0, -1);
      continue;
    }

    break;
  }

  return { trailingText, urlText };
}

function isUnmatchedClosingBracket(value: string, lastCharacter: string) {
  const openingBracket = OPENING_BRACKETS[lastCharacter];

  if (!openingBracket) {
    return false;
  }

  return value.split(lastCharacter).length > value.split(openingBracket).length;
}

function normalizeMessageUrl(urlText: string) {
  return /^https?:\/\//i.test(urlText) ? urlText : `https://${urlText}`;
}

async function openMessageLink(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(t('actionFailed'), url);
  }
}

function UploadOverlay({ messageId, onCancel, progress }: { messageId: string; onCancel?: (messageId: string) => void; progress?: { sentBytes: number; totalBytes: number } }) {
  return (
    <View style={styles.uploadOverlay}>
      <UploadProgressControl messageId={messageId} onCancel={onCancel} progress={progress} />
    </View>
  );
}

function DownloadOverlay({ language, progress }: { language: AppLanguage; progress: MediaDownloadProgress }) {
  return (
    <View style={styles.uploadOverlay}>
      <DownloadProgressControl language={language} progress={progress} />
    </View>
  );
}

function DownloadProgressControl({ dark = false, language, progress }: { dark?: boolean; language: AppLanguage; progress: MediaDownloadProgress }) {
  return (
    <UploadProgressControl
      dark={dark}
      messageId={progress.messageId}
      progress={{ sentBytes: progress.downloadedBytes, totalBytes: progress.totalBytes }}
      progressLabel={getDownloadProgressLabel(progress, language)}
      progressIconName={progress.status === 'paused' ? 'play' : 'cloud-download-outline'}
    />
  );
}

function UploadProgressControl({
  dark = false,
  messageId,
  onCancel,
  progress,
  progressIconName,
  progressLabel,
}: {
  dark?: boolean;
  messageId: string;
  onCancel?: (messageId: string) => void;
  progress?: { sentBytes: number; totalBytes: number };
  progressIconName?: IoniconName;
  progressLabel?: string;
}) {
  const totalBytes = progress?.totalBytes ?? 0;
  const sentBytes = progress?.sentBytes ?? 0;
  const ratio = totalBytes ? Math.min(1, Math.max(0, sentBytes / totalBytes)) : 0;
  const size = 48;
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeColor = dark ? colors.primaryDark : colors.white;
  const mutedStroke = dark ? 'rgba(7, 94, 84, 0.18)' : 'rgba(255,255,255,0.32)';

  return (
    <View style={styles.uploadProgressWrap}>
      <Svg height={size} width={size} style={styles.uploadProgressSvg}>
        <Circle cx={size / 2} cy={size / 2} fill="transparent" r={radius} stroke={mutedStroke} strokeWidth={strokeWidth} />
        <Circle
          cx={size / 2}
          cy={size / 2}
          fill="transparent"
          r={radius}
          stroke={strokeColor}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - ratio)}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
        />
      </Svg>
      {onCancel ? (
        <Pressable onPress={() => onCancel(messageId)} style={[styles.uploadCancelButton, dark && styles.uploadCancelButtonDark]}>
          <Ionicons color={dark ? colors.primaryDark : colors.white} name="close" size={18} />
        </Pressable>
      ) : (
        <View style={[styles.uploadCancelButton, dark && styles.uploadCancelButtonDark]}>
          <Ionicons color={dark ? colors.primaryDark : colors.white} name={progressIconName ?? 'cloud-download-outline'} size={18} />
        </View>
      )}
      {totalBytes > 0 ? (
        <Text style={[styles.uploadProgressText, dark && styles.uploadProgressTextDark]}>
          {progressLabel ?? `${formatProgressBytes(sentBytes)} / ${formatProgressBytes(totalBytes)}`}
        </Text>
      ) : (
        <ActivityIndicator color={strokeColor} size="small" />
      )}
    </View>
  );
}

function getDownloadProgressLabel(progress: MediaDownloadProgress, language: AppLanguage) {
  const downloadedBytes = Math.max(0, progress.downloadedBytes);
  const totalBytes = Math.max(downloadedBytes, progress.totalBytes);
  const remainingBytes = Math.max(0, totalBytes - downloadedBytes);

  return t('downloadProgressRemaining', {
    downloaded: formatProgressBytes(downloadedBytes),
    remaining: formatProgressBytes(remainingBytes),
  }, language);
}

function formatProgressBytes(bytes: number) {
  return bytes <= 0 ? '0 B' : formatBytes(bytes);
}

function getCallId(message: Message) {
  const metadata = message.metadata;

  if (metadata && typeof metadata === 'object' && 'callId' in metadata && typeof metadata.callId === 'string') {
    return metadata.callId;
  }

  return undefined;
}

function shouldHideRemoteMediaUntilDownloaded(message: Message, progress: MediaDownloadProgress | null) {
  return !!progress;
}

function hasCallEnded(message: Message) {
  const metadata = message.metadata;
  const status = getCallStatus(message);

  return !!(metadata && typeof metadata === 'object' && 'endedAt' in metadata && metadata.endedAt) ||
    status === 'CANCELLED' ||
    status === 'DECLINED' ||
    status === 'ENDED' ||
    status === 'MISSED';
}

function getCallStatus(message: Message) {
  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'callStatus' in metadata && typeof metadata.callStatus === 'string'
    ? metadata.callStatus
    : undefined;
}

function getCallStatusLabel(message: Message, language: AppLanguage, isMine: boolean) {
  const status = getCallStatus(message);

  if (status === 'CANCELLED') {
    return isMine ? t('cancelled', {}, language) : t('missedCall', {}, language);
  }

  if (status === 'DECLINED') {
    return t('declined', {}, language);
  }

  if (status === 'MISSED') {
    return t('missedCall', {}, language);
  }

  return undefined;
}

function getCallBodyLabel(message: Message, language: AppLanguage) {
  const mode = getCallMode(message);
  const durationSeconds = getCallDurationSeconds(message);
  const label = mode === 'VIDEO'
    ? t('videoCall', {}, language)
    : mode === 'VOICE'
      ? t('voiceCall', {}, language)
      : getLegacyCallBodyLabel(message.body, language);

  return durationSeconds === undefined
    ? label
    : `${label} - ${formatLocalizedCallDuration(durationSeconds, language)}`;
}

function getCallStatusColor(message: Message) {
  const status = getCallStatus(message);

  return status === 'CANCELLED' || status === 'DECLINED' || status === 'MISSED'
    ? colors.danger
    : colors.primary;
}

function getCallMode(message: Message) {
  const metadata = message.metadata;

  if (metadata && typeof metadata === 'object' && 'mode' in metadata && (metadata.mode === 'VOICE' || metadata.mode === 'VIDEO')) {
    return metadata.mode;
  }

  const body = message.body.toLowerCase();

  if (body.includes('video')) {
    return 'VIDEO';
  }

  if (body.includes('voice')) {
    return 'VOICE';
  }

  return undefined;
}

function getCallDurationSeconds(message: Message) {
  const metadata = message.metadata;

  if (metadata && typeof metadata === 'object' && 'durationSeconds' in metadata && typeof metadata.durationSeconds === 'number') {
    return metadata.durationSeconds;
  }

  const durationMatch = message.body.match(/-\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);

  if (!durationMatch) {
    return undefined;
  }

  const minutes = Number(durationMatch[1] ?? 0);
  const seconds = Number(durationMatch[2] ?? 0);
  const totalSeconds = (minutes * 60) + seconds;

  return totalSeconds > 0 ? totalSeconds : undefined;
}

function getLegacyCallBodyLabel(body: string, language: AppLanguage) {
  const normalizedBody = body.toLowerCase();

  if (normalizedBody.includes('video')) {
    return t('videoCall', {}, language);
  }

  if (normalizedBody.includes('voice')) {
    return t('voiceCall', {}, language);
  }

  return t('call', {}, language);
}

function formatLocalizedCallDuration(totalSeconds: number, language: AppLanguage) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (language === 'tr') {
    return minutes > 0 ? `${minutes} dk ${seconds} sn` : `${seconds} sn`;
  }

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function getReplyTo(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('replyTo' in metadata)) {
    return null;
  }

  const replyTo = metadata.replyTo;

  if (!replyTo || typeof replyTo !== 'object' || !('id' in replyTo) || !('body' in replyTo) || !('kind' in replyTo) || !('senderName' in replyTo)) {
    return null;
  }

  return replyTo as { body: string; id: string; kind: Message['kind']; senderName: string };
}

function isForwardedMessage(message: Message) {
  const metadata = message.metadata;

  return !!(metadata && typeof metadata === 'object' && 'forwarded' in metadata && metadata.forwarded === true);
}

function getMessageReactionEmojis(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('reactions' in metadata) || !metadata.reactions || typeof metadata.reactions !== 'object') {
    return [];
  }

  return Array.from(new Set(Object.values(metadata.reactions as Record<string, unknown>)
    .filter((emoji): emoji is string => typeof emoji === 'string' && emoji.trim().length > 0)));
}

function isMessageScheduled(message: Message) {
  const metadata = message.metadata;

  return !!(
    metadata &&
    typeof metadata === 'object' &&
    'scheduledSendAt' in metadata &&
    typeof metadata.scheduledSendAt === 'string'
  );
}

function getDisappearingAfterView(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('disappearingAfterView' in metadata)) {
    return null;
  }

  const config = metadata.disappearingAfterView;

  if (!config || typeof config !== 'object' || !('seconds' in config) || typeof config.seconds !== 'number' || !Number.isFinite(config.seconds)) {
    return null;
  }

  return { seconds: Math.max(1, Math.floor(config.seconds)) };
}

function getDisappearingDeleteAt(message: Message) {
  const metadata = message.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'disappearingDeleteAt' in metadata &&
    typeof metadata.disappearingDeleteAt === 'string'
    ? metadata.disappearingDeleteAt
    : null;
}

function getLocation(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('location' in metadata)) {
    return null;
  }

  const location = metadata.location;

  if (!location || typeof location !== 'object' || !('latitude' in location) || !('longitude' in location)) {
    return null;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    address: 'address' in location && typeof location.address === 'string' ? location.address : undefined,
    latitude,
    longitude,
  };
}

function getLiveLocation(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('liveLocation' in metadata)) {
    return null;
  }

  const location = metadata.liveLocation;

  if (!location || typeof location !== 'object' || !('id' in location) || !('latitude' in location) || !('longitude' in location) || !('expiresAt' in location)) {
    return null;
  }

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || typeof location.id !== 'string' || typeof location.expiresAt !== 'string') {
    return null;
  }

  return {
    address: 'address' in location && typeof location.address === 'string' ? location.address : undefined,
    expiresAt: location.expiresAt,
    id: location.id,
    latitude,
    longitude,
    stoppedAt: 'stoppedAt' in location && typeof location.stoppedAt === 'string' ? location.stoppedAt : undefined,
  };
}

function getLiveLocationEstablishment(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('liveLocationEstablishment' in metadata)) {
    return null;
  }

  const establishment = metadata.liveLocationEstablishment;

  if (!establishment || typeof establishment !== 'object' || !('state' in establishment)) {
    return null;
  }

  return (establishment.state === 'pending' || establishment.state === 'failed') && 'startedAt' in establishment && typeof establishment.startedAt === 'string'
    ? { startedAt: establishment.startedAt, state: establishment.state as 'failed' | 'pending' }
    : null;
}

function isLiveLocationEstablishmentFailed(establishment: { startedAt: string; state: 'failed' | 'pending' }) {
  return establishment.state === 'failed' || getLiveLocationEstablishmentRemainingMs(establishment) <= 0;
}

function getLiveLocationEstablishmentRemainingMs(establishment: { startedAt: string }) {
  const startedAtMs = Date.parse(establishment.startedAt);

  return Number.isFinite(startedAtMs)
    ? Math.max(0, startedAtMs + LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS - Date.now())
    : 0;
}

function isLiveLocationEnded(location: { expiresAt: string; stoppedAt?: string }) {
  return !!location.stoppedAt || Date.parse(location.expiresAt) <= Date.now();
}

function getLiveLocationStatus(location: { expiresAt: string; stoppedAt?: string }, language: AppLanguage) {
  if (isLiveLocationEnded(location)) {
    return t('liveLocationEnded', {}, language);
  }

  const minutes = Math.max(1, Math.ceil((Date.parse(location.expiresAt) - Date.now()) / 60000));
  return t('liveLocationMinutesRemaining', { count: minutes }, language);
}

function getStaticMapUrl(location: { latitude: number; longitude: number; updatedAt?: string }) {
  const center = `${location.latitude},${location.longitude}`;
  const marker = `${location.latitude},${location.longitude},red-pushpin`;
  const cacheKey = location.updatedAt ? `&updated=${encodeURIComponent(location.updatedAt)}` : '';

  return `https://staticmap.openstreetmap.de/staticmap.php?center=${center}&zoom=15&size=460x240&maptype=mapnik&markers=${encodeURIComponent(marker)}${cacheKey}`;
}

function loadMapModule(): MapModule | null {
  try {
    return require('react-native-maps') as MapModule;
  } catch {
    return null;
  }
}

function getLiveLocationMapRegion(location: { latitude: number; longitude: number }): MapRegion {
  return {
    latitude: location.latitude,
    latitudeDelta: 0.008,
    longitude: location.longitude,
    longitudeDelta: 0.008,
  };
}

function openLocation(location: { address?: string; latitude: number; longitude: number }) {
  const label = encodeURIComponent(location.address || 'Shared location');
  const url = Platform.OS === 'ios'
    ? `http://maps.apple.com/?ll=${location.latitude},${location.longitude}&q=${label}`
    : `geo:${location.latitude},${location.longitude}?q=${location.latitude},${location.longitude}(${label})`;

  void Linking.openURL(url).catch(() => {
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`);
  });
}

async function openFile(message: Message) {
  if (!message.mediaUri) {
    return;
  }

  try {
    const uri = await getOpenableFileUri(message);

    if (Platform.OS === 'android') {
      const opened = await openNativeAndroidFile(uri, getUsableMimeType(message.mimeType, message.fileName));

      if (!opened) {
        throw new Error(t('noAppOpenAttachment'));
      }

      return;
    }

    await Linking.openURL(uri);
  } catch {
    Alert.alert(t('cannotOpenFile'), t('noAppOpenAttachment'));
  }
}

async function getOpenableFileUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('attachmentNotAvailableYet'));
  }

  if (Platform.OS !== 'android') {
    return message.mediaUri;
  }

  if (message.mediaUri.startsWith('file:')) {
    if (!(await isLocalMediaFileComplete(message.mediaUri, message.sizeBytes))) {
      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        const localUri = await downloadAttachmentToCache({ ...message, mediaUri: remoteUri });
        return FileSystem.getContentUriAsync(localUri);
      }
    }

    return FileSystem.getContentUriAsync(message.mediaUri);
  }

  if (message.mediaUri.startsWith('content:')) {
    const localUri = await copyAttachmentToCache(message);

    return FileSystem.getContentUriAsync(localUri);
  }

  if (/^https?:\/\//i.test(message.mediaUri)) {
    const localUri = await downloadAttachmentToCache(message);

    return FileSystem.getContentUriAsync(localUri);
  }

  return message.mediaUri;
}

async function copyAttachmentToCache(message: Message) {
  const localUri = await getAttachmentCacheUri(message);
  const existingIsComplete = await isLocalMediaFileComplete(localUri, message.sizeBytes);

  if (!existingIsComplete) {
    await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => undefined);
    await FileSystem.copyAsync({ from: message.mediaUri!, to: localUri });
  }

  return localUri;
}

async function downloadAttachmentToCache(message: Message) {
  const localUri = await getAttachmentCacheUri(message);
  const remoteUri = getMessageRemoteMediaUri(message) ?? message.mediaUri;

  if (!remoteUri || !/^https?:\/\//i.test(remoteUri)) {
    throw new Error(t('attachmentNotAvailableYet'));
  }

  const cachedUri = await downloadRemoteMediaFile({
    expectedSizeBytes: message.sizeBytes,
    localUri,
    messageId: message.id,
    remoteUri,
  });

  if (!cachedUri) {
    throw new Error(t('attachmentDownloadIncomplete'));
  }

  void useAppStore.getState()
    .cacheDownloadedMessageMedia(message.conversationId, message.id, cachedUri, remoteUri)
    .catch(() => undefined);

  return cachedUri;
}

function getMessageRemoteMediaUri(message: Pick<Message, 'mediaUri' | 'metadata'>) {
  if (message.mediaUri && /^https?:\/\//i.test(message.mediaUri)) {
    return message.mediaUri;
  }

  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'remoteMediaUri' in metadata && typeof metadata.remoteMediaUri === 'string'
    ? metadata.remoteMediaUri
    : undefined;
}

async function getAttachmentCacheUri(message: Message) {
  return getMessageMediaCacheUri({
    fileName: getMessageFileName(message),
    kind: message.kind,
    messageId: message.id,
  });
}

function getMessageFileName(message: Message) {
  if (message.fileName) {
    return message.fileName;
  }

  if (message.kind === 'image') {
    return `${message.id}.jpg`;
  }

  if (message.kind === 'video') {
    return `${message.id}.mp4`;
  }

  if (message.kind === 'voice') {
    return `${message.id}.m4a`;
  }

  return `${message.id}.bin`;
}

function getMimeTypeFromFileName(fileName?: string) {
  const extension = fileName?.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'apk':
      return 'application/vnd.android.package-archive';
    case 'pdf':
      return 'application/pdf';
    case 'doc':
      return 'application/msword';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xls':
      return 'application/vnd.ms-excel';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'ppt':
      return 'application/vnd.ms-powerpoint';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'txt':
      return 'text/plain';
    case 'csv':
      return 'text/csv';
    case 'zip':
      return 'application/zip';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'm4v':
      return 'video/x-m4v';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    default:
      return '*/*';
  }
}

function getUsableMimeType(mimeType?: string | null, fileName?: string) {
  const inferredMimeType = getMimeTypeFromFileName(fileName);

  if (!mimeType || mimeType === 'application/octet-stream' || mimeType === '*/*') {
    return inferredMimeType;
  }

  return mimeType;
}

function formatCoordinates(location: { latitude: number; longitude: number }) {
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}

function withAlpha(color: string, alpha: number) {
  const normalized = color.trim();
  const clampedAlpha = Math.min(1, Math.max(0, alpha));

  if (/^#[0-9a-f]{6}$/i.test(normalized)) {
    const red = Number.parseInt(normalized.slice(1, 3), 16);
    const green = Number.parseInt(normalized.slice(3, 5), 16);
    const blue = Number.parseInt(normalized.slice(5, 7), 16);

    return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
  }

  return normalized;
}

function shouldRenderMessageBody(message: Message, location?: { address?: string; latitude: number; longitude: number } | null) {
  if (location) {
    return false;
  }

  if (message.kind === 'text') {
    return true;
  }

  if (message.kind === 'call' || !message.body) {
    return false;
  }

  if (message.kind === 'file') {
    return message.body.trim() !== (message.fileName ?? '').trim();
  }

  if (message.kind === 'voice') {
    return !isVoicePlaceholderBody(message.body);
  }

  return true;
}

function getMessagePreview(message: { body: string; kind: Message['kind']; metadata?: Message['metadata'] }, language: AppLanguage) {
  if (message.kind === 'call') {
    return getCallBodyLabel(message as Message, language);
  }

  if (message.body) {
    if (message.kind === 'voice' && isVoicePlaceholderBody(message.body)) {
      return t('voiceMessage', {}, language);
    }

    if (message.kind === 'text' && isLocationPlaceholderBody(message.body, message.metadata)) {
      return t('location', {}, language);
    }

    return message.body;
  }

  if (message.kind === 'voice') {
    return t('voiceMessage', {}, language);
  }

  if (message.kind === 'image') {
    return t('photo', {}, language);
  }

  if (message.kind === 'video') {
    return t('video', {}, language);
  }

  if (message.kind === 'file') {
    return t('file', {}, language);
  }

  return t('message', {}, language);
}

function isVoicePlaceholderBody(body: string) {
  const normalized = body.trim().toLowerCase();
  return normalized === 'voice message' || normalized === 'sesli mesaj';
}

function isLocationPlaceholderBody(body: string, metadata?: Message['metadata']) {
  const normalized = body.trim().toLowerCase();

  if (normalized !== 'location' && normalized !== 'konum') {
    return false;
  }

  return !!metadata && typeof metadata === 'object' && 'location' in metadata;
}

function MessageTicks({ language, status }: { language: AppLanguage; status: Message['status'] }) {
  if (status === 'sending') {
    return <Text style={styles.sendingBadge}>{t('sending', {}, language)}</Text>;
  }

  const isRead = status === 'read';
  const isDelivered = status === 'delivered';
  const iconName = isRead || isDelivered ? 'checkmark-done' : 'checkmark';
  const iconColor = isRead ? '#34b7f1' : '#22c55e';

  return (
    <Ionicons
      color={iconColor}
      name={iconName}
      size={16}
    />
  );
}

function createStyles() {
  return StyleSheet.create({
  bubble: {
    borderRadius: 12,
    marginBottom: spacing.sm,
    maxWidth: '84%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reactionPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: -12,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
    position: 'absolute',
  },
  reactionPillIncoming: {
    right: spacing.sm,
  },
  reactionPillOutgoing: {
    left: spacing.sm,
  },
  reactionPillText: {
    fontSize: 13,
    lineHeight: 16,
  },
  disappearingRevealCard: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 210,
    padding: spacing.sm,
  },
  disappearingRevealIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  disappearingRevealText: {
    flex: 1,
  },
  disappearingRevealTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  callRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 190,
  },
  callBadge: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  callBadgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  callBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
  },
  callOutcomeBadge: {
    borderColor: colors.danger,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  callOutcomeBadgeText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '900',
  },
  callRowPressed: {
    opacity: 0.72,
  },
  callText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  callHint: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  callTextWrap: {
    flex: 1,
    gap: 2,
  },
  fileMeta: {
    color: colors.mutedText,
    fontSize: 12,
  },
  expandedTextBody: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 24,
  },
  expandedTextCloseButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  expandedTextCloseText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  expandedTextHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  expandedTextHeaderSpacer: {
    minWidth: 76,
  },
  expandedTextPanel: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    maxHeight: '78%',
    padding: spacing.lg,
    width: '92%',
  },
  expandedTextScroll: {
    maxHeight: '100%',
  },
  expandedTextScrollContent: {
    paddingBottom: spacing.sm,
  },
  expandedTextShade: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  expandedTextTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
    flex: 1,
    marginHorizontal: spacing.md,
    textAlign: 'center',
  },
  fileName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  fileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 210,
  },
  fileText: {
    flex: 1,
    gap: 2,
  },
  forwardedLabel: {
    color: colors.mutedText,
    fontSize: 12,
    fontStyle: 'italic',
    fontWeight: '700',
    marginBottom: 3,
  },
  incoming: {
    alignSelf: 'flex-start',
    backgroundColor: colors.incomingBubble,
  },
  locationAddress: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  locationCard: {
    backgroundColor: colors.appBackground,
    borderRadius: 12,
    marginBottom: spacing.xs,
    overflow: 'hidden',
    width: 240,
  },
  locationCardPressed: {
    opacity: 0.78,
  },
  locationInfo: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  locationMap: {
    backgroundColor: colors.border,
    height: 126,
    width: '100%',
  },
  locationPin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.white,
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -18,
    marginTop: -18,
    position: 'absolute',
    top: 63,
    width: 36,
  },
  locationTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  liveLocationStopButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  liveLocationEstablishmentCard: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    width: 240,
  },
  liveLocationEstablishmentText: {
    flex: 1,
  },
  liveLocationStopText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '800',
  },
  liveLocationViewer: {
    backgroundColor: colors.appBackground,
    flex: 1,
  },
  liveLocationMapView: {
    ...StyleSheet.absoluteFillObject,
  },
  liveLocationMapFallback: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  liveLocationMapFallbackIcon: {
    alignItems: 'center',
    backgroundColor: withAlpha(colors.primary, 0.14),
    borderRadius: 42,
    height: 84,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 84,
  },
  liveLocationMapFallbackTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
  },
  liveLocationMapFallbackText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  liveLocationMapFallbackButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.lg,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  liveLocationMapFallbackButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  liveLocationViewerHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: 0,
  },
  liveLocationViewerIconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    elevation: 4,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    width: 48,
  },
  liveLocationViewerTitleWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    elevation: 4,
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
  },
  liveLocationViewerTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  liveLocationViewerStatus: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  liveLocationViewerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    bottom: 0,
    elevation: 10,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
  },
  liveLocationViewerAddressRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  liveLocationViewerPin: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  liveLocationViewerAddressText: {
    flex: 1,
  },
  liveLocationViewerAddress: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  liveLocationViewerCoordinates: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  liveLocationViewerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  liveLocationViewerSecondaryButton: {
    alignItems: 'center',
    backgroundColor: withAlpha(colors.primary, 0.14),
    borderRadius: 16,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  liveLocationViewerSecondaryText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  liveLocationViewerStopButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 16,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  liveLocationViewerStopText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  mediaPreview: {
    backgroundColor: colors.border,
    borderRadius: 10,
    height: 190,
    marginBottom: spacing.sm,
    width: 230,
  },
  mediaPreviewPlaceholder: {
    backgroundColor: colors.border,
    borderRadius: 10,
    height: 190,
    marginBottom: spacing.sm,
    width: 230,
  },
  uploadOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: 10,
    bottom: spacing.sm,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  uploadCancelButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.24)',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    top: 8,
    width: 32,
  },
  uploadCancelButtonDark: {
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  uploadProgressSvg: {
    transform: [{ rotate: '-90deg' }],
  },
  uploadProgressText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '800',
    maxWidth: 112,
    textAlign: 'center',
  },
  uploadProgressTextDark: {
    color: colors.textSecondary,
  },
  uploadProgressWrap: {
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    minWidth: 68,
  },
  messageText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  messageLink: {
    color: colors.primary,
    fontWeight: '700',
  },
  messageTextMeasure: {
    color: 'transparent',
    fontSize: 16,
    lineHeight: 22,
    opacity: 0,
  },
  messageTextMeasureWrap: {
    left: 0,
    opacity: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: -1,
  },
  messageTextWrap: {
    position: 'relative',
  },
  meta: {
    color: colors.mutedText,
    fontSize: 11,
  },
  metaRow: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
  },
  readMoreButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  readMoreText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  sendingBadge: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: '800',
  },
  senderName: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 3,
  },
  outgoing: {
    alignSelf: 'flex-end',
    backgroundColor: colors.outgoingBubble,
  },
  playButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  replyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 17,
  },
  swipeReplyActionWrap: {
    bottom: 0,
    justifyContent: 'center',
    left: spacing.xs,
    position: 'absolute',
    top: 0,
    zIndex: 0,
  },
  swipeReplyAnimated: {
    zIndex: 1,
  },
  swipeReplyButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  swipeReplyWrap: {
    position: 'relative',
    width: '100%',
  },
  replyPreview: {
    backgroundColor: colors.appBackground,
    borderLeftColor: colors.primary,
    borderLeftWidth: 3,
    borderRadius: 8,
    marginBottom: spacing.xs,
    minWidth: 180,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  replyPreviewPressed: {
    opacity: 0.68,
  },
  replySender: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 1,
  },
  voiceRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 230,
  },
  voiceTime: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  voiceProgress: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 4,
  },
  voiceTrack: {
    backgroundColor: colors.border,
    borderRadius: 999,
    flex: 1,
    height: 4,
    overflow: 'hidden',
  },
  videoLabel: {
    bottom: spacing.sm,
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    left: spacing.sm,
    position: 'absolute',
    right: spacing.sm,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { height: 1, width: 0 },
    textShadowRadius: 2,
  },
  videoOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  videoPreview: {
    height: '100%',
    width: '100%',
  },
  videoPreviewFallback: {
    alignItems: 'center',
    backgroundColor: '#162f44',
    justifyContent: 'center',
  },
  videoPreviewWrap: {
    backgroundColor: colors.border,
    borderRadius: 10,
    height: 190,
    marginBottom: spacing.sm,
    overflow: 'hidden',
    width: 230,
  },
});
}

let styles = createStyles();
