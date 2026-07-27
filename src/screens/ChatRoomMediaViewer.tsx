import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer,VideoView } from 'expo-video';
import { useCallback,useEffect,useMemo,useState } from 'react';
import { ActivityIndicator,FlatList,Image,Modal,PanResponder,Pressable,Text,useWindowDimensions,View,type ModalProps } from 'react-native';
import { Gesture,GestureDetector,GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated,{ runOnJS,useAnimatedStyle,useSharedValue,withTiming } from 'react-native-reanimated';

import { Avatar } from '../components/Avatar';
import { t } from '../i18n';
import { resolveLocalMediaFileUri } from '../lib/mediaCache';
import { setNativeMediaViewerOrientationUnlocked } from '../native/CallNative';
import { colors } from '../theme/colors';
import { Message,VoiceRoomParticipant } from '../types/domain';
import { chatRoomStyles as styles } from './chat/ChatRoomStyles';
import {
getMessageRemoteMediaUri
} from './lib/ChatMediaHelpers';

import { downloadMediaActionAttachment } from './ChatRoomDialogs';

const MEDIA_VIEWER_SUPPORTED_ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = [
  'portrait',
  'portrait-upside-down',
  'landscape-left',
  'landscape-right',
];

type MediaViewerProps = {
  imageMessages: Message[];
  initialImageIndex: number;
  message: Message | null;
  onClose: () => void;
};

function ZoomableViewerImage({
  canGoNext,
  canGoPrevious,
  nextUri,
  onClose,
  onNavigate,
  previousUri,
  uri,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  nextUri?: string | null;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
  previousUri?: string | null;
  uri: string;
}) {
  const viewport = useWindowDimensions();
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);
  const swipeTranslateX = useSharedValue(0);
  const [transitionCoverUri, setTransitionCoverUri] = useState<string | null>(null);

  useEffect(() => {
    scale.value = 1;
    startScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    startTranslateX.value = 0;
    startTranslateY.value = 0;
    swipeTranslateX.value = 0;
  }, [scale, startScale, startTranslateX, startTranslateY, swipeTranslateX, translateX, translateY, uri]);

  const completeNavigation = useCallback((direction: -1 | 1) => {
    const coverUri = direction === 1 ? nextUri : previousUri;

    if (coverUri) {
      setTransitionCoverUri(coverUri);
    }

    onNavigate(direction);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTransitionCoverUri(null);
      });
    });
  }, [nextUri, onNavigate, previousUri]);

  const pinchGesture = useMemo(() => Gesture.Pinch()
    .onBegin(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(4, Math.max(1, startScale.value * event.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
      }
    }), [scale, startScale, translateX, translateY]);

  const panGesture = useMemo(() => Gesture.Pan()
    .minDistance(2)
    .onBegin(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
      swipeTranslateX.value = 0;
    })
    .onUpdate((event) => {
      if (scale.value <= 1) {
        if (Math.abs(event.translationY) > Math.abs(event.translationX) * 1.25 && event.translationY > 0) {
          translateY.value = event.translationY * 0.45;
          return;
        }

        if (Math.abs(event.translationX) > Math.abs(event.translationY) * 1.15) {
          const canSwipeInDirection = event.translationX < 0 ? canGoNext : canGoPrevious;
          swipeTranslateX.value = canSwipeInDirection ? event.translationX : event.translationX * 0.25;
        }
        return;
      }

      const maxX = viewport.width * (scale.value - 1) / 2;
      const maxY = viewport.height * (scale.value - 1) / 2;
      translateX.value = Math.min(maxX, Math.max(-maxX, startTranslateX.value + event.translationX));
      translateY.value = Math.min(maxY, Math.max(-maxY, startTranslateY.value + event.translationY));
    })
    .onEnd((event) => {
      if (scale.value <= 1) {
        const shouldClose = event.translationY > 110 || (event.velocityY > 750 && event.translationY > 40);

        if (shouldClose && Math.abs(event.translationY) > Math.abs(event.translationX) * 1.1) {
          runOnJS(onClose)();
          return;
        }

        translateY.value = withTiming(0, { duration: 160 });

        const threshold = Math.max(64, viewport.width * 0.16);
        const shouldGoNext = canGoNext && (
          event.translationX <= -threshold ||
          (event.velocityX < -650 && event.translationX < -24)
        );
        const shouldGoPrevious = canGoPrevious && (
          event.translationX >= threshold ||
          (event.velocityX > 650 && event.translationX > 24)
        );

        if (shouldGoNext || shouldGoPrevious) {
          const direction = shouldGoNext ? 1 : -1;
          const target = direction === 1 ? -viewport.width : viewport.width;
          swipeTranslateX.value = withTiming(target, { duration: 180 }, (finished) => {
            if (finished) {
              runOnJS(completeNavigation)(direction);
            }
          });
          return;
        }

        swipeTranslateX.value = withTiming(0, { duration: 160 });
      }
    }), [canGoNext, canGoPrevious, completeNavigation, onClose, scale, startTranslateX, startTranslateY, swipeTranslateX, translateX, translateY, viewport.height, viewport.width]);

  const doubleTapGesture = useMemo(() => Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(scale.value > 1 ? 1 : 2);
      translateX.value = withTiming(0);
      translateY.value = withTiming(0);
    }), [scale, translateX, translateY]);

  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value + swipeTranslateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));
  const previousImageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeTranslateX.value - viewport.width }],
  }));
  const nextImageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeTranslateX.value + viewport.width }],
  }));
  const gesture = useMemo(
    () => Gesture.Race(doubleTapGesture, Gesture.Simultaneous(pinchGesture, panGesture)),
    [doubleTapGesture, panGesture, pinchGesture],
  );

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.viewerPager}>
        {previousUri ? (
          <Animated.Image resizeMode="contain" source={{ uri: previousUri }} style={[styles.viewerPagerImage, previousImageStyle]} />
        ) : null}
        <Animated.Image resizeMode="contain" source={{ uri }} style={[styles.viewerPagerImage, imageStyle]} />
        {nextUri ? (
          <Animated.Image resizeMode="contain" source={{ uri: nextUri }} style={[styles.viewerPagerImage, nextImageStyle]} />
        ) : null}
        {transitionCoverUri ? (
          <Image resizeMode="contain" source={{ uri: transitionCoverUri }} style={styles.viewerPagerCoverImage} />
        ) : null}
      </View>
    </GestureDetector>
  );
}

export function MediaViewer({ imageMessages, initialImageIndex, message, onClose }: MediaViewerProps) {
  if (imageMessages.length === 0 && !message) {
    return null;
  }

  return (
    <MediaViewerContent
      imageMessages={imageMessages}
      initialImageIndex={initialImageIndex}
      message={message}
      onClose={onClose}
    />
  );
}

function MediaViewerContent({ imageMessages, initialImageIndex, message, onClose }: MediaViewerProps) {
  const imageMessagesKey = useMemo(() => imageMessages.map((imageMessage) => imageMessage.id).join('|'), [imageMessages]);
  const [currentImageIndex, setCurrentImageIndex] = useState(initialImageIndex);
  const [imageUriById, setImageUriById] = useState<Record<string, string | null>>({});
  const [playableUri, setPlayableUri] = useState<string | null>(null);
  const [isPreparingVideo, setPreparingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const currentImageMessage = imageMessages[currentImageIndex] ?? null;
  const previousImageMessage = imageMessages[currentImageIndex - 1] ?? null;
  const nextImageMessage = imageMessages[currentImageIndex + 1] ?? null;
  const displayImageUri = currentImageMessage ? imageUriById[currentImageMessage.id] : null;
  const previousImageUri = previousImageMessage ? imageUriById[previousImageMessage.id] : null;
  const nextImageUri = nextImageMessage ? imageUriById[nextImageMessage.id] : null;

  useEffect(() => {
    setCurrentImageIndex(Math.min(Math.max(initialImageIndex, 0), Math.max(0, imageMessages.length - 1)));
    setImageUriById({});
  }, [imageMessages.length, imageMessagesKey, initialImageIndex]);

  useEffect(() => {
    let isMounted = true;

    async function prepareMedia() {
      setPlayableUri(null);
      setVideoError(null);

      if (!message?.mediaUri || message.kind === 'image') {
        setPreparingVideo(false);
        return;
      }

      if (message.kind !== 'video') {
        setPreparingVideo(false);
        return;
      }

      setPreparingVideo(true);

      try {
        const uri = await getPlayableVideoUri(message);

        if (isMounted) {
          setPlayableUri(uri);
        }
      } catch (error) {
        if (isMounted) {
          setVideoError(error instanceof Error ? error.message : 'Video could not be opened.');
        }
      } finally {
        if (isMounted) {
          setPreparingVideo(false);
        }
      }
    }

    void prepareMedia();

    return () => {
      isMounted = false;
    };
  }, [message]);

  useEffect(() => {
    let isMounted = true;
    const preloadMessages = [
      imageMessages[currentImageIndex],
      imageMessages[currentImageIndex - 1],
      imageMessages[currentImageIndex + 1],
    ].filter((item): item is Message => !!item);

    preloadMessages.forEach((imageMessage) => {
      if (imageUriById[imageMessage.id] !== undefined) {
        return;
      }

      void getRenderableImageUri(imageMessage)
        .then((uri) => {
          if (!isMounted) {
            return;
          }

          setImageUriById((current) => ({
            ...current,
            [imageMessage.id]: uri,
          }));

          if (/^https?:\/\//i.test(uri)) {
            void Image.prefetch(uri).catch(() => undefined);
          }
        })
        .catch(() => {
          if (isMounted) {
            setImageUriById((current) => ({
              ...current,
              [imageMessage.id]: imageMessage.mediaUri ?? null,
            }));
          }
        });
    });

    return () => {
      isMounted = false;
    };
  }, [currentImageIndex, imageMessages, imageUriById]);

  const navigateImage = useCallback((direction: -1 | 1) => {
    setCurrentImageIndex((current) => Math.min(Math.max(current + direction, 0), Math.max(0, imageMessages.length - 1)));
  }, [imageMessages.length]);
  const closePanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      gestureState.dy > 14 &&
      Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2
    ),
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dy > 90 || (gestureState.vy > 0.75 && gestureState.dy > 36)) {
        onClose();
      }
    },
  }), [onClose]);

  const isImageViewerVisible = imageMessages.length > 0;
  const isVideoViewerVisible = !!message && message.kind === 'video';
  const isViewerVisible = isImageViewerVisible || isVideoViewerVisible;

  useEffect(() => {
    setNativeMediaViewerOrientationUnlocked(isViewerVisible);

    return () => {
      setNativeMediaViewerOrientationUnlocked(false);
    };
  }, [isViewerVisible]);

  return (
    <Modal
      animationType="fade"
      presentationStyle="fullScreen"
      supportedOrientations={MEDIA_VIEWER_SUPPORTED_ORIENTATIONS}
      visible={isViewerVisible}
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.viewerRoot}>
        <View {...closePanResponder.panHandlers} style={styles.viewer}>
          <Pressable onPress={onClose} style={styles.viewerClose}>
            <Ionicons color={colors.white} name="close" size={28} />
          </Pressable>
          {isImageViewerVisible && imageMessages.length > 1 ? (
            <View pointerEvents="none" style={styles.viewerCounter}>
              <Text style={styles.viewerCounterText}>{currentImageIndex + 1} / {imageMessages.length}</Text>
            </View>
          ) : null}
          {isImageViewerVisible && displayImageUri ? (
            <ZoomableViewerImage
              canGoNext={!!nextImageUri}
              canGoPrevious={!!previousImageUri}
              nextUri={nextImageUri}
              onClose={onClose}
              onNavigate={navigateImage}
              previousUri={previousImageUri}
              uri={displayImageUri}
            />
          ) : null}
          {isImageViewerVisible && !displayImageUri ? (
            <ActivityIndicator color={colors.white} size="large" />
          ) : null}
          {message?.kind === 'video' && isPreparingVideo ? (
            <ActivityIndicator color={colors.white} size="large" />
          ) : null}
          {message?.kind === 'video' && videoError ? (
            <Text style={styles.viewerError}>{videoError}</Text>
          ) : null}
          {message?.kind === 'video' && playableUri ? <VideoPlayer uri={playableUri} /> : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

async function getPlayableVideoUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('videoNotAvailableYet'));
  }

  if (!/^https?:\/\//i.test(message.mediaUri)) {
    if (message.status !== 'sending' && /^file:/i.test(message.mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return downloadMediaActionAttachment({ ...message, mediaUri: remoteUri });
      }

      throw new Error(t('videoStillDownloadingMoment'));
    }

    return message.mediaUri;
  }

  return downloadMediaActionAttachment(message);
}

async function getRenderableImageUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('imageNotAvailableYet'));
  }

  if (!/^https?:\/\//i.test(message.mediaUri)) {
    if (message.status !== 'sending' && /^file:/i.test(message.mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return remoteUri;
      }

      throw new Error(t('imageStillDownloadingMoment'));
    }

    return message.mediaUri;
  }

  return message.mediaUri;
}

export async function getPlayableVoiceUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('voicePlaybackTryAgain'));
  }

  if (!/^https?:\/\//i.test(message.mediaUri)) {
    if (message.status !== 'sending' && /^file:/i.test(message.mediaUri)) {
      const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes);

      if (resolvedLocalUri) {
        return resolvedLocalUri;
      }

      const remoteUri = getMessageRemoteMediaUri(message);

      if (remoteUri) {
        return downloadMediaActionAttachment({ ...message, mediaUri: remoteUri });
      }

      throw new Error(t('voicePlaybackTryAgain'));
    }

    return message.mediaUri;
  }

  return downloadMediaActionAttachment(message);
}

function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });

  return <VideoView contentFit="contain" nativeControls player={player} style={styles.viewerVideo} />;
}

export function VoiceRoomPeopleModal({
  canModerate,
  currentUserId,
  hasMore,
  isVisible,
  onClose,
  onLoadMore,
  onToggleAdminMute,
  participants,
}: {
  canModerate: boolean;
  currentUserId?: string;
  hasMore: boolean;
  isVisible: boolean;
  onClose: () => void;
  onLoadMore: () => void;
  onToggleAdminMute: (participant: VoiceRoomParticipant) => void;
  participants: VoiceRoomParticipant[];
}) {
  if (!isVisible) {
    return null;
  }

  return (
    <Modal animationType="fade" transparent visible={isVisible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.voiceRoomModalBackdrop}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.voiceRoomPeoplePanel}>
          <View style={styles.voiceRoomPeopleHeader}>
            <Text style={styles.voiceRoomModalTitle}>{t('connectedPeople')}</Text>
            <Pressable onPress={onClose} style={styles.voiceRoomCloseButton}>
              <Ionicons color={colors.textSecondary} name="close" size={20} />
            </Pressable>
          </View>
          <FlatList
            data={participants}
            keyExtractor={(item) => item.userId}
            ListFooterComponent={hasMore ? (
              <Pressable onPress={onLoadMore} style={styles.voiceRoomLoadMoreButton}>
                <Text style={styles.voiceRoomLoadMoreText}>{t('loadMore')}</Text>
              </Pressable>
            ) : null}
            renderItem={({ item }) => {
              const canToggle = canModerate && item.userId !== currentUserId && (!item.selfMuted || item.adminMuted);
              const isMuted = item.selfMuted || item.adminMuted;

              return (
                <View style={styles.voiceRoomPeopleRow}>
                  <Avatar label={item.user.displayName || item.user.username} size={42} uri={item.user.avatarUrl} />
                  <View style={styles.voiceRoomPeopleTextWrap}>
                    <Text numberOfLines={1} style={styles.voiceRoomPeopleName}>{item.user.displayName || item.user.username}</Text>
                    <Text numberOfLines={1} style={styles.voiceRoomPeopleSubtitle}>
                      {item.adminMuted ? t('mutedByAdmin') : item.selfMuted ? t('muted') : t('speakingAllowed')}
                    </Text>
                  </View>
                  {canModerate ? (
                    <Pressable
                      disabled={!canToggle}
                      onPress={() => onToggleAdminMute(item)}
                      style={[styles.voiceRoomAdminMuteButton, item.adminMuted && styles.voiceRoomAdminMuteButtonActive, !canToggle && styles.voiceRoomControlButtonDisabled]}
                    >
                      <Ionicons color={colors.white} name={isMuted ? 'mic-off' : 'mic'} size={18} />
                    </Pressable>
                  ) : (
                    <Ionicons color={isMuted ? colors.textSecondary : colors.primary} name={isMuted ? 'mic-off-outline' : 'mic-outline'} size={20} />
                  )}
                </View>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
