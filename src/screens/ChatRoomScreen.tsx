import { Ionicons } from '@expo/vector-icons';
import { AudioSession } from '@livekit/react-native';
import { createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, GestureResponderEvent, Image, Keyboard, KeyboardAvoidingView, LayoutChangeEvent, Linking, Modal, type ModalProps, PanResponder, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path as SvgPath } from 'react-native-svg';

import { AttachmentSheet } from '../components/AttachmentSheet';
import { Avatar } from '../components/Avatar';
import { VoiceRoomControls } from '../components/chat/VoiceRoomControls';
import { MessageBubble } from '../components/MessageBubble';
import { PremiumUserBadge } from '../components/PremiumUserBadge';
import { useChatKeyboardLift } from '../hooks/useChatKeyboardLift';
import { useChatHydration } from '../hooks/useChatHydration';
import {
  useChatTimelineWindow,
  VISIBLE_MESSAGE_PAGE_SIZE,
} from '../hooks/useChatTimelineWindow';
import { useVoiceCallTip } from '../hooks/useVoiceCallTip';
import { getActiveCallSession } from '../lib/activeCallSession';
import { beginAppLockForegroundOperation } from '../lib/appLockAccess';
import { createLiveLocation, getConversationScreenshotPrivacy, isUploadCanceledError, listPinnedMessages, listVoiceRoomParticipants, mapMessage, pinMessage, unpinMessage, updateVoiceRoomParticipant, uploadMediaFile, type PinnedMessage } from '../lib/backend';
import { formatBytes } from '../lib/format';
import { downloadRemoteMediaFile, getCachedVideoThumbnailUri, getMessageMediaCacheUri, getRememberedCachedVideoThumbnailUri, resolveLocalMediaFileUri } from '../lib/mediaCache';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { dismissMessageNotificationsForConversation } from '../lib/messageNotifications';
import { logVoiceRoomDiagnostic } from '../lib/voiceRoomDiagnostics';
import {
  hasActiveLiveLocationShare,
  LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS,
  registerLiveLocationShare,
  requestLiveLocationPermissions,
} from '../lib/liveLocation';
import { takePendingShareDraft } from '../lib/pendingShareDraft';
import { containsMeetVapKeyword } from '../lib/prohibitedNames';
import { buildSharedContactMessage, buildSharedGroupWebUrl } from '../lib/shareLinks';
import { getRealtimeSocket } from '../lib/realtimeSocket';
import { getVoiceRoomSessionState, joinVoiceRoomSession, leaveVoiceRoomSession, setVoiceRoomAdminMuted, setVoiceRoomPushToTalking, setVoiceRoomSelfMuted, setVoiceRoomSpeakerMuted, subscribeToVoiceRoomSession, type VoiceRoomSessionState } from '../lib/voiceRoomSession';
import { buildReportReason, getReportContextNotice } from '../lib/reporting';
import { getStoredPlayedVoiceMessageIds, getStoredRecentEmojis, setStoredPlayedVoiceMessageIds, setStoredRecentEmojis } from '../lib/storage';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { CONVERSATION_MUTE_OPTIONS, isConversationMuted } from '../lib/conversationMute';
import { DISAPPEARING_MESSAGES_OPTIONS, getDisappearingMessagesDurationLabelKey } from '../lib/disappearingMessages';
import { isMeetVapSystemConversation, isMeetVapSystemUser, MEETVAP_SYSTEM_AVATAR_URL } from '../lib/systemChat';
import { logUiPerformanceDiagnostic, useUiPerformanceStallMonitor } from '../lib/uiPerformanceDiagnostics';
import { getI18nLanguage, t, type AppLanguage } from '../i18n';
import { type ImageDrawingStroke, openNativeAndroidFile, processNativeVoiceMessage, renderNativeImageDrawing, saveNativeAndroidFile, setNativeLiveVoiceEffect, setNativeMediaViewerOrientationUnlocked, shareNativeAndroidFile } from '../native/CallNative';
import { clearScreenCaptureProtectionRequirement, setScreenCaptureProtectionRequirement } from '../lib/screenCaptureProtection';
import { assertAttachmentsWithinPolicy, AttachmentPolicyError } from '../lib/serverPolicy';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { AuthUser, Conversation, Message, MessageKind, VoiceRoomParticipant } from '../types/domain';
import { RootStackParamList, SharedIntentItem } from '../types/navigation';
import { DEFAULT_VOICE_EFFECT_ID, VoiceEffectId, normalizeVoiceEffectId } from '../types/voiceEffects';
import {
  buildChatListItems,
  formatDateInput,
  formatPresenceSubtitle,
  getChatListItemRenderKey,
  getGroupCallLimit,
  getPaginationItems,
  parseScheduledSendAt,
  shouldRenderTimelineMessage,
  type ChatListItem,
} from './lib/ChatMiscHelpers';
import {
  extractChatLinks,
  filterForwardTargets,
  filterForwardTargetsByAnySearch,
  formatPinnedDateTime,
  formatSubscriberCount,
  getDisappearingSecondsAfterView,
  getGroupMemberRank,
  getLinkHost,
  getMessageCaption,
  getMessageLocation,
  getMessagePreview,
  getPinnedMessageSearchText,
  getPinnedMessageTitle,
  getPinnedStaticMapUrl,
  getReplyPreview,
  getReplySenderName,
  mergePinnedMessageWithLocalCopy,
} from './lib/ChatMessagePreview';
import {
  createMessageDeleteKey,
  formatVoiceComposerEffectLabel,
  getInitialUploadProgress,
  getMessageDeleteKey,
  getMessageFileName,
  getMessageMimeType,
  getMessageRemoteMediaUri,
  getMessageRenderKey,
  getMimeTypeFromFileName,
  getKnownFileSize,
  getLocationAddress,
  getRecorderStatusSafely,
  getRecordingDurationSeconds,
  getSharedItemFileName,
  getSharedItemMessageKind,
  getUsableMimeType,
  getVoiceRoomAudioRouteLabel,
  isReleasedRecorderError,
  isShareableMediaMessage,
  isViewableImageMessage,
  prepareOutgoingAttachment,
  shouldRemovePinnedMessageForDeletion,
  stopRecorderIfNeeded,
  waitForRecordedFile,
} from './lib/ChatMediaHelpers';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;
type ForwardTarget = {
  conversationId?: string;
  title: string;
  user: AuthUser;
};
type PendingCaptionAttachment = {
  body?: string;
  durationSeconds?: number;
  fileName: string;
  kind: 'image' | 'video' | 'file';
  mimeType: string;
  sizeBytes?: number;
  uri: string;
};
type PendingVoiceMessage = Omit<Message, 'id' | 'conversationId' | 'createdAt' | 'senderId' | 'status'>;
type ImageViewerSession = {
  images: Message[];
  index: number;
};
type MessageJumpOptions = {
  animated?: boolean;
  viewPosition?: number;
};
type ScrollToIndexFailureInfo = {
  averageItemLength: number;
  highestMeasuredFrameIndex: number;
  index: number;
};
type ChatGalleryTab = 'media' | 'files' | 'links';

const DRAWING_COLORS = ['#ffffff', '#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'] as const;
const DRAWING_STROKE_WIDTH = 0.014;
type ChatLinkItem = {
  id: string;
  message: Message;
  url: string;
};
type VoiceRecordingComposerState = {
  durationMillis: number;
  isLocked: boolean;
  isPaused: boolean;
  isRecording: boolean;
};

function waitForComposerNativeTextFlush() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 48);
    });
  });
}

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_CONVERSATIONS: Conversation[] = [];
const EMPTY_MEMBERS: AuthUser[] = [];
const VOICE_RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  bitRate: 64000,
  numberOfChannels: 1,
  sampleRate: 44100,
  android: {
    audioEncoder: 'aac' as const,
    extension: '.m4a',
    outputFormat: 'mpeg4' as const,
  },
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: '.m4a',
  },
};
const MIN_VOICE_RECORDING_SECONDS = 0.7;
const VOICE_RECORDING_HOLD_THRESHOLD_MS = 260;
const VOICE_RECORDING_LOCK_DRAG_Y = 54;
const GROUP_MEMBER_PAGE_SIZE = 30;
const MESSAGE_JUMP_MAX_ATTEMPTS = 10;
const MESSAGE_JUMP_RETRY_DELAY_MS = 120;
const TOP_HISTORY_LOAD_THRESHOLD_PX = 240;
const LOCAL_HISTORY_PAGE_SIZE = 100;
const CHAT_SCROLL_DIAGNOSTICS_ENABLED = false;
const CHAT_LIFECYCLE_DIAGNOSTICS_ENABLED = false;
const HOUR_MS = 60 * 60 * 1000;
const MEDIA_VIEWER_SUPPORTED_ORIENTATIONS: NonNullable<ModalProps['supportedOrientations']> = [
  'portrait',
  'landscape-left',
  'landscape-right',
];
const VOICE_EFFECTS: { descriptionKey: string; icon: keyof typeof Ionicons.glyphMap; id: VoiceEffectId; titleKey: string }[] = [
  { descriptionKey: 'voiceEffectNormalDescription', icon: 'mic-outline', id: 'normal', titleKey: 'voiceEffectNormal' },
  { descriptionKey: 'voiceEffectDeepDescription', icon: 'radio-outline', id: 'deep', titleKey: 'voiceEffectDeep' },
  { descriptionKey: 'voiceEffectBrightDescription', icon: 'sparkles-outline', id: 'bright', titleKey: 'voiceEffectBright' },
  { descriptionKey: 'voiceEffectHeliumDescription', icon: 'balloon-outline', id: 'helium', titleKey: 'voiceEffectHelium' },
];
const EMOJI_GROUPS = [
  { icon: 'happy-outline' as const, key: 'smileys', labelKey: 'emojiSmileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😍', '😘', '😋', '😎', '🤩', '🥳', '😏', '😢', '😭', '😤', '😡', '🤔', '🤗', '🤫', '😴', '😱', '🥰'] },
  { icon: 'hand-left-outline' as const, key: 'people', labelKey: 'emojiPeople', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🫶', '🙏', '💪', '👋', '🤝', '👀', '🧠', '👑', '💃', '🕺', '🏃', '🚶', '👨‍💻', '👩‍💻', '🧑‍🚀'] },
  { icon: 'heart-outline' as const, key: 'symbols', labelKey: 'emojiSymbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💯', '💢', '💥', '💫', '💦', '💨', '✅', '❌', '⚠️', '🔥', '⭐', '✨', '🎉', '🎁'] },
  { icon: 'fast-food-outline' as const, key: 'food', labelKey: 'emojiFood', emojis: ['🍏', '🍎', '🍌', '🍉', '🍇', '🍓', '🍒', '🥝', '🍅', '🥑', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🍜', '🍣', '🍰', '🍫', '🍿', '☕', '🍵', '🥤'] },
  { icon: 'car-outline' as const, key: 'travel', labelKey: 'emojiTravel', emojis: ['🚗', '🚕', '🚌', '🏎️', '🚓', '🚑', '🚒', '🚚', '🚲', '✈️', '🚀', '🚁', '🚢', '🏠', '🏢', '🏝️', '⛰️', '🌍', '🌙', '☀️', '🌧️', '❄️'] },
] satisfies { emojis: string[]; icon: keyof typeof Ionicons.glyphMap; key: string; labelKey: string }[];
const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🤗'];

export function ChatRoomScreen({ navigation, route }: Props) {
  const themeColors = useThemeColors();
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  styles = useMemo(() => createStyles(), [isDarkMode]);
  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const voicePlaybackRef = useRef<{ hasFinished: boolean; interval?: ReturnType<typeof setInterval>; messageId: string; player: ReturnType<typeof createAudioPlayer> } | null>(null);
  const processedSharedItemsKeyRef = useRef<string | null>(null);
  const promptedGroupInviteIdRef = useRef<string | null>(null);
  const user = useAppStore((state) => state.user);
  const { showVoiceCallTip, voiceCallTipModal } = useVoiceCallTip(user?.id);
  const language = useAppStore((state) => state.language);
  const uiLanguage = getI18nLanguage();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const conversation = useAppStore((state) => state.conversations.find((item) => item.id === route.params.conversationId));
  const isSystemChat = isMeetVapSystemConversation(conversation, {
    fallbackTitle: route.params.title,
    isGroup: route.params.isGroup,
  });
  const remoteMessages = useAppStore((state) => state.messagesByConversation[route.params.conversationId] ?? EMPTY_MESSAGES);
  const screenMountedAtRef = useRef(Date.now());
  const initialRemoteMessageCountRef = useRef(remoteMessages.length);
  const hasLoggedFirstItemsReadyRef = useRef(false);
  const isScreenFocused = useIsFocused();
  const isGroupInvitePending = route.params.isGroup === true && conversation?.myGroupInvitePending === true;
  const loadMessages = useAppStore((state) => state.loadMessages);
  const loadOlderLocalMessages = useAppStore((state) => state.loadOlderLocalMessages);
  const prepareConversationMessages = useAppStore((state) => state.prepareConversationMessages);
  const releaseConversationHistory = useAppStore((state) => state.releaseConversationHistory);
  const markConversationReadNow = useAppStore((state) => state.markConversationReadNow);
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const editMessage = useAppStore((state) => state.editMessage);
  const clearLocalChat = useAppStore((state) => state.clearLocalChat);
  const deleteChat = useAppStore((state) => state.deleteChat);
  const forwardMessage = useAppStore((state) => state.forwardMessage);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const sendMediaMessage = useAppStore((state) => state.sendMediaMessage);
  const sendTextMessage = useAppStore((state) => state.sendTextMessage);
  const scheduleTextMessage = useAppStore((state) => state.scheduleTextMessage);
  const scheduleMediaMessage = useAppStore((state) => state.scheduleMediaMessage);
  const openDisappearingMessage = useAppStore((state) => state.openDisappearingMessage);
  const sendVoiceMessage = useAppStore((state) => state.sendVoiceMessage);
  const reactToMessage = useAppStore((state) => state.reactToMessage);
  const cancelUpload = useAppStore((state) => state.cancelUpload);
  const startDirectConversation = useAppStore((state) => state.startDirectConversation);
  const blockUserById = useAppStore((state) => state.blockUserById);
  const updateConversationMute = useAppStore((state) => state.updateConversationMute);
  const updateDisappearingMessages = useAppStore((state) => state.updateDisappearingMessages);
  const updateGroupAlias = useAppStore((state) => state.updateGroupAlias);
  const declineGroupInvite = useAppStore((state) => state.declineGroupInvite);
  const updateGroupAvatar = useAppStore((state) => state.updateGroupAvatar);
  const addGroupAdmins = useAppStore((state) => state.addGroupAdmins);
  const addGroupMembers = useAppStore((state) => state.addGroupMembers);
  const deleteGroup = useAppStore((state) => state.deleteGroup);
  const removeGroupMember = useAppStore((state) => state.removeGroupMember);
  const reportTarget = useAppStore((state) => state.reportTarget);
  const revokeGroupAdmin = useAppStore((state) => state.revokeGroupAdmin);
  const transferGroupOwnership = useAppStore((state) => state.transferGroupOwnership);
  const updateGroupSettings = useAppStore((state) => state.updateGroupSettings);
  const updateGroupTitle = useAppStore((state) => state.updateGroupTitle);
  const addUserToContacts = useAppStore((state) => state.addUserToContacts);
  const addOptimisticMessage = useAppStore((state) => state.addOptimisticMessage);
  const contacts = useAppStore((state) => state.contacts);
  const canUsePremiumFeatures = hasPremiumAccess(subscriptionStatus);
  const insets = useSafeAreaInsets();
  const windowLayout = useWindowDimensions();
  const listRef = useRef<FlatList<ChatListItem>>(null);
  const composerRef = useRef<View>(null);
  const hasInitialScrollRef = useRef(false);
  const isInitialScrollScheduledRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const isBottomAnchoringRef = useRef(false);
  const latestMessageCountRef = useRef(0);
  const latestTailMessageIdRef = useRef<string | null>(null);
  const lastAutoTailMessageIdRef = useRef<string | null>(null);
  const lastObservedTailMessageIdRef = useRef<string | null>(null);
  const lastScrolledMessageCountRef = useRef(0);
  const lastContentHeightRef = useRef(0);
  const listViewportHeightRef = useRef(0);
  const lastScrollOffsetYRef = useRef(0);
  const lastDistanceFromBottomRef = useRef(0);
  const initialScrollTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pendingTailScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTailSettleTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const pendingInstantTailReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBottomAnchorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBottomAnchorAttemptRef = useRef(0);
  const userScrollHistoryWindowRef = useRef(false);
  const userScrollHistoryResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const instantNextScrollRef = useRef(false);
  const forceTailUntilRef = useRef(0);
  const pendingInitialAlignmentRef = useRef(false);
  const selectedCallVoiceEffectIdRef = useRef<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const suppressNextCallPressRef = useRef(false);
  const diagnosticsScopeDetails = useMemo(() => ({
    conversationId: route.params.conversationId,
    screen: 'ChatRoomScreen',
  }), [route.params.conversationId]);
  useUiPerformanceStallMonitor('ChatRoomScreen', diagnosticsScopeDetails);

  useEffect(() => () => {
    releaseConversationHistory(route.params.conversationId);
  }, [releaseConversationHistory, route.params.conversationId]);
  const suppressNextCaptionSendPressRef = useRef(false);
  const pendingCaptionOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const pendingJumpOptionsRef = useRef<MessageJumpOptions | null>(null);
  const pendingJumpAttemptRef = useRef(0);
  const pendingJumpRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHistoryAnchorRef = useRef<{
    previousContentHeight: number;
    previousOffsetY: number;
  } | null>(null);
  const isControlledHistoryPrependRef = useRef(false);
  const isHistoryExpansionPendingRef = useRef(false);
  const isOlderLocalHistoryLoadingRef = useRef(false);
  const isOlderLocalHistoryExhaustedRef = useRef(false);
  const openHistoryGuardUntilRef = useRef(0);
  const isTailOpenLockedRef = useRef(false);
  const chatScrollDebugSequenceRef = useRef(0);
  const chatLifecycleDebugSequenceRef = useRef(0);
  const chatScrollDebugLastScrollAtRef = useRef(0);
  const chatScrollDebugLastDistanceRef = useRef<number | null>(null);
  const notificationRecoveryKeyRef = useRef<string | null>(null);
  const hasTailActivityDuringOpenRef = useRef(false);
  const hasShownScreenshotPrivacyWarningRef = useRef(false);
  const isStartingLiveLocationRef = useRef(false);
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [draftSelection, setDraftSelection] = useState({ end: 0, start: 0 });
  const [isSendingText, setSendingText] = useState(false);
  const [sendOptionsMode, setSendOptionsMode] = useState<null | 'menu' | 'schedule' | 'disappear'>(null);
  const [sendOptionsTarget, setSendOptionsTarget] = useState<'caption' | 'composer'>('composer');
  const [scheduleDateDraft, setScheduleDateDraft] = useState('');
  const [scheduleHourDraft, setScheduleHourDraft] = useState('');
  const [scheduleMinuteDraft, setScheduleMinuteDraft] = useState('');
  const [scheduleSecondDraft, setScheduleSecondDraft] = useState('');
  const [disappearSecondsDraft, setDisappearSecondsDraft] = useState('30');
  const [isComposerEditMenuVisible, setComposerEditMenuVisible] = useState(false);
  const composerLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateDraft = useCallback((nextDraft: string) => {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, []);

  useEffect(() => () => {
    if (composerLongPressTimerRef.current) {
      clearTimeout(composerLongPressTimerRef.current);
    }
    if (userScrollHistoryResetTimeoutRef.current) {
      clearTimeout(userScrollHistoryResetTimeoutRef.current);
      userScrollHistoryResetTimeoutRef.current = null;
    }
  }, []);
  const [isEmojiPickerVisible, setEmojiPickerVisible] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);
  const [selectedEmojiGroupKey, setSelectedEmojiGroupKey] = useState(EMOJI_GROUPS[0].key);
  const [pendingCaptionAttachment, setPendingCaptionAttachment] = useState<PendingCaptionAttachment | null>(null);
  const [drawingAttachment, setDrawingAttachment] = useState<PendingCaptionAttachment | null>(null);
  const [isCaptionSuspendedForDrawing, setCaptionSuspendedForDrawing] = useState(false);
  const isCaptionComposerVisible = !!pendingCaptionAttachment && !isCaptionSuspendedForDrawing;
  const drawingOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingVoiceMessage, setPendingVoiceMessage] = useState<PendingVoiceMessage | null>(null);
  const [selectedVoiceEffectId, setSelectedVoiceEffectId] = useState<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const [isVoiceEffectPickerVisible, setVoiceEffectPickerVisible] = useState(false);
  const [isProcessingVoiceEffect, setProcessingVoiceEffect] = useState(false);
  const [selectedCallVoiceEffectId, setSelectedCallVoiceEffectId] = useState<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const [groupCallVoiceEffectId, setGroupCallVoiceEffectId] = useState<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const [isCallVoiceEffectPickerVisible, setCallVoiceEffectPickerVisible] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [isAttachmentSheetVisible, setAttachmentSheetVisible] = useState(false);
  const [isContactSharePickerVisible, setContactSharePickerVisible] = useState(false);
  const [voiceRecorderSessionKey, setVoiceRecorderSessionKey] = useState(0);
  const [voiceRecordingState, setVoiceRecordingState] = useState<VoiceRecordingComposerState>({
    durationMillis: 0,
    isLocked: false,
    isPaused: false,
    isRecording: false,
  });

  useEffect(() => {
    if (canUsePremiumFeatures) {
      return;
    }

    selectedCallVoiceEffectIdRef.current = DEFAULT_VOICE_EFFECT_ID;
    setSelectedCallVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
    setSelectedVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
    setGroupCallVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
    setVoiceEffectPickerVisible(false);
    setCallVoiceEffectPickerVisible(false);
  }, [canUsePremiumFeatures]);

  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [viewerMessage, setViewerMessage] = useState<Message | null>(null);
  const [imageViewerSession, setImageViewerSession] = useState<ImageViewerSession | null>(null);
  const [isInitialScrollReady, setInitialScrollReady] = useState(false);
  const [isInfoVisible, setInfoVisible] = useState(false);
  const [messageActionMenu, setMessageActionMenu] = useState<Message | null>(null);
  const [mediaActionMessage, setMediaActionMessage] = useState<Message | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [isPinnedMessagesVisible, setPinnedMessagesVisible] = useState(false);
  const [pinnedSearchQuery, setPinnedSearchQuery] = useState('');

  useEffect(() => () => {
    if (drawingOpenTimerRef.current) {
      clearTimeout(drawingOpenTimerRef.current);
    }
  }, []);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [isSavingEdit, setSavingEdit] = useState(false);
  const [forwardingMessages, setForwardingMessages] = useState<Message[]>([]);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchVisible, setSearchVisible] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [pendingDeletedMessageIds, setPendingDeletedMessageIds] = useState<string[]>([]);
  const [pendingDeletedMessageKeys, setPendingDeletedMessageKeys] = useState<string[]>([]);
  const [isScrollToBottomVisible, setScrollToBottomVisible] = useState(false);
  const isScrollToBottomVisibleRef = useRef(false);
  const [isBottomAnchoringActive, setBottomAnchoringActive] = useState(false);
  const [isGroupAliasEditorOpen, setGroupAliasEditorOpen] = useState(false);
  const [groupAliasDraft, setGroupAliasDraft] = useState('');
  const [isSavingGroupAlias, setSavingGroupAlias] = useState(false);
  const [groupCallPickerMode, setGroupCallPickerMode] = useState<'voice' | 'video' | null>(null);
  const [isChatHeaderMenuVisible, setChatHeaderMenuVisible] = useState(false);
  const [isMuteDurationMenuVisible, setMuteDurationMenuVisible] = useState(false);
  const [isDisappearingMessagesDurationMenuVisible, setDisappearingMessagesDurationMenuVisible] = useState(false);
  const [isAddContactPromptDismissed, setAddContactPromptDismissed] = useState(false);
  const [isAddingChatContact, setAddingChatContact] = useState(false);
  const [selectedGroupCallMemberIds, setSelectedGroupCallMemberIds] = useState<string[]>([]);
  const [playedVoiceMessageIds, setPlayedVoiceMessageIds] = useState<Set<string>>(() => new Set());
  const [voiceProgressById, setVoiceProgressById] = useState<Record<string, number>>({});
  const [isOtherUserTyping, setOtherUserTyping] = useState(false);
  const [voiceRoomSession, setVoiceRoomSession] = useState<VoiceRoomSessionState>(() => getVoiceRoomSessionState());
  const [voiceRoomParticipants, setVoiceRoomParticipants] = useState<VoiceRoomParticipant[]>([]);
  const [voiceRoomParticipantsNextOffset, setVoiceRoomParticipantsNextOffset] = useState(0);
  const [hasMoreVoiceRoomParticipants, setHasMoreVoiceRoomParticipants] = useState(false);
  const [isVoiceRoomPeopleOpen, setVoiceRoomPeopleOpen] = useState(false);
  const [isVoiceRoomRoutePickerOpen, setVoiceRoomRoutePickerOpen] = useState(false);
  const [voiceRoomAudioRoutes, setVoiceRoomAudioRoutes] = useState<{ id: string; label: string }[]>([]);
  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIdleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSentTypingStartRef = useRef(false);

  const {
    archivedMessages,
    archivedMessagesRef,
    messages,
    resetVisibleWindow,
    setVisibleMessageCount,
    visibleMessageCount,
    visibleWindowStartIndex,
  } = useChatTimelineWindow({
    conversationId: route.params.conversationId,
    isControlledHistoryPrependRef,
    isDisabled: isGroupInvitePending,
    isTailOpenLockedRef,
    logLifecycle: logChatLifecycleDiagnostic,
    logScroll: logChatScrollDiagnostic,
    pendingDeletedMessageIds,
    pendingDeletedMessageKeys,
    remoteMessages,
    shouldRenderMessage: shouldRenderTimelineMessage,
  });
  const handleServerSyncError = useCallback((error: unknown) => {
    Alert.alert(t('couldNotLoadMessages', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
  }, [uiLanguage]);
  const chatListItems = useMemo(() => buildChatListItems(messages, uiLanguage), [messages, uiLanguage]);
  const renderedChatListItems = useMemo(() => [...chatListItems].reverse(), [chatListItems]);
  const isVoiceRoomConversation = conversation?.isVoiceRoom === true;
  const isCurrentVoiceRoomConnected = voiceRoomSession.conversationId === route.params.conversationId && !!voiceRoomSession.token;
  const isCurrentVoiceRoomConnecting = voiceRoomSession.conversationId === route.params.conversationId && voiceRoomSession.isConnecting;
  const canModerateVoiceRoom = route.params.isGroup === true && !!user?.id && (
    conversation?.ownerId === user.id ||
    conversation?.adminIds?.includes(user.id) === true
  );

  useEffect(() => {
    logUiPerformanceDiagnostic('chat-room-mounted', {
      conversationId: route.params.conversationId,
      initialRemoteMessages: initialRemoteMessageCountRef.current,
      isGroup: route.params.isGroup === true,
      openReason: route.params.openReason,
    });

    return () => {
      logUiPerformanceDiagnostic('chat-room-unmounted', {
        conversationId: route.params.conversationId,
        mountedForMs: Date.now() - screenMountedAtRef.current,
      });
    };
  }, [route.params.conversationId, route.params.isGroup, route.params.openReason]);

  useEffect(() => {
    if (hasLoggedFirstItemsReadyRef.current || chatListItems.length === 0) {
      return;
    }

    hasLoggedFirstItemsReadyRef.current = true;
    logUiPerformanceDiagnostic('chat-room-first-items-ready', {
      conversationId: route.params.conversationId,
      elapsedSinceMountMs: Date.now() - screenMountedAtRef.current,
      itemCount: chatListItems.length,
      remoteMessageCount: remoteMessages.length,
    });
  }, [chatListItems.length, remoteMessages.length, route.params.conversationId]);

  useEffect(() => subscribeToVoiceRoomSession(setVoiceRoomSession), []);

  const refreshVoiceRoomParticipants = useCallback(async (offset = 0, append = false) => {
    if (!serverUrl || !isVoiceRoomConversation) {
      logVoiceRoomDiagnostic('chat-participants-refresh-skip', {
        conversationId: route.params.conversationId,
        hasServerUrl: !!serverUrl,
        isVoiceRoomConversation,
        offset,
      });
      setVoiceRoomParticipants([]);
      setVoiceRoomParticipantsNextOffset(0);
      setHasMoreVoiceRoomParticipants(false);
      return;
    }

    logVoiceRoomDiagnostic('chat-participants-refresh-start', {
      append,
      conversationId: route.params.conversationId,
      offset,
    });

    try {
      const response = await listVoiceRoomParticipants(serverUrl, route.params.conversationId, { limit: 100, offset });
      logVoiceRoomDiagnostic('chat-participants-refresh-success', {
        append,
        conversationId: route.params.conversationId,
        hasMore: response.hasMore,
        nextOffset: response.nextOffset,
        participantCount: response.participants.length,
      });
      setVoiceRoomParticipants((current) => append ? [...current, ...response.participants] : response.participants);
      setVoiceRoomParticipantsNextOffset(response.nextOffset);
      setHasMoreVoiceRoomParticipants(response.hasMore);

      const me = response.participants.find((participant) => participant.userId === user?.id);
      if (me) {
        setVoiceRoomAdminMuted(me.adminMuted);
      }
    } catch (error) {
      logVoiceRoomDiagnostic('chat-participants-refresh-failed', {
        append,
        conversationId: route.params.conversationId,
        message: error instanceof Error ? error.message : String(error),
        offset,
      });
      throw error;
    }
  }, [isVoiceRoomConversation, route.params.conversationId, serverUrl, user?.id]);

  const joinCurrentVoiceRoom = useCallback(async () => {
    if (!serverUrl || !user?.id || !isVoiceRoomConversation) {
      logVoiceRoomDiagnostic('chat-join-skip', {
        conversationId: route.params.conversationId,
        hasServerUrl: !!serverUrl,
        hasUserId: !!user?.id,
        isVoiceRoomConversation,
      });
      return;
    }

    if (getActiveCallSession()?.callState === 'active') {
      logVoiceRoomDiagnostic('chat-join-blocked-active-call', {
        conversationId: route.params.conversationId,
      });
      Alert.alert(t('voiceRoomUnavailableDuringCallTitle'), t('voiceRoomUnavailableDuringCallMessage'));
      return;
    }

    logVoiceRoomDiagnostic('chat-join-start', {
      conversationId: route.params.conversationId,
      title: route.params.title,
      userId: user.id,
    });
    const didJoin = await joinVoiceRoomSession({
      conversationId: route.params.conversationId,
      serverUrl,
      title: route.params.title,
      userId: user.id,
    });
    logVoiceRoomDiagnostic('chat-join-finished', {
      conversationId: route.params.conversationId,
      didJoin,
    });

    if (didJoin) {
      void refreshVoiceRoomParticipants();
    }
  }, [isVoiceRoomConversation, refreshVoiceRoomParticipants, route.params.conversationId, route.params.title, serverUrl, user?.id]);

  useEffect(() => {
    if (!isVoiceRoomConversation || isGroupInvitePending) {
      return;
    }

    if (voiceRoomSession.conversationId === route.params.conversationId && (voiceRoomSession.token || voiceRoomSession.isConnecting)) {
      return;
    }

    void joinCurrentVoiceRoom();
  }, [isGroupInvitePending, isVoiceRoomConversation, joinCurrentVoiceRoom, route.params.conversationId, voiceRoomSession.conversationId, voiceRoomSession.isConnecting, voiceRoomSession.token]);

  useEffect(() => {
    if (!isVoiceRoomConversation) {
      return undefined;
    }

    const socket = getRealtimeSocket();
    const handleParticipantsChanged = (payload: { conversationId: string }) => {
      if (payload.conversationId === route.params.conversationId) {
        void refreshVoiceRoomParticipants();
      }
    };

    socket?.on('voice-room:participants', handleParticipantsChanged);
    void refreshVoiceRoomParticipants();

    return () => {
      socket?.off('voice-room:participants', handleParticipantsChanged);
    };
  }, [isVoiceRoomConversation, refreshVoiceRoomParticipants, route.params.conversationId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event) => {
      if (!isVoiceRoomConversation || voiceRoomSession.conversationId !== route.params.conversationId || !voiceRoomSession.token) {
        return;
      }

      event.preventDefault();
      Alert.alert(t('voiceRoomLeaveTitle'), t('voiceRoomLeaveMessage'), [
        {
          text: t('keepConnectedOutsideGroup'),
          onPress: () => navigation.dispatch(event.data.action),
        },
        {
          text: t('leaveRoomAndDisconnect'),
          style: 'destructive',
          onPress: () => {
            void leaveVoiceRoomSession().finally(() => navigation.dispatch(event.data.action));
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ]);
    });

    return unsubscribe;
  }, [isVoiceRoomConversation, navigation, route.params.conversationId, voiceRoomSession.conversationId, voiceRoomSession.token]);

  const messageListIndexById = useMemo(() => {
    const indexById = new Map<string, number>();

    renderedChatListItems.forEach((item, index) => {
      if (item.type === 'message') {
        indexById.set(item.message.id, index);
      }
    });

    return indexById;
  }, [renderedChatListItems]);
  const incomingMessageReadKey = useMemo(() => {
    if (!user?.id) {
      return '';
    }

    let incomingCount = 0;
    let latestIncomingMessageId = '';

    for (let index = archivedMessages.length - 1; index >= 0; index -= 1) {
      const message = archivedMessages[index];

      if (message.senderId === user.id || message.id.startsWith('local-')) {
        continue;
      }

      incomingCount += 1;
      if (!latestIncomingMessageId) {
        latestIncomingMessageId = message.id;
      }
    }

    return latestIncomingMessageId ? `${incomingCount}:${latestIncomingMessageId}` : '';
  }, [archivedMessages, user?.id]);
  const latestTailMessage = messages[messages.length - 1];
  const latestTailMessageId = latestTailMessage?.id ?? null;
  latestMessageCountRef.current = messages.length;
  latestTailMessageIdRef.current = latestTailMessageId;

  function logChatScrollDiagnostic(event: string, details: Record<string, unknown> = {}) {
    if (!CHAT_SCROLL_DIAGNOSTICS_ENABLED) {
      return;
    }

    const now = Date.now();
    const payload = {
      seq: ++chatScrollDebugSequenceRef.current,
      event,
      conversationId: route.params.conversationId,
      messageCount: messages.length,
      archivedCount: archivedMessages.length,
      visibleCount: visibleMessageCount,
      tailId: latestTailMessageIdRef.current,
      contentHeight: Math.round(lastContentHeightRef.current),
      viewportHeight: Math.round(listViewportHeightRef.current),
      offsetY: Math.round(lastScrollOffsetYRef.current),
      distanceBottom: Math.round(lastDistanceFromBottomRef.current),
      keyboardLift: Math.round(keyboardLiftRef.current),
      keyboardVisible: isKeyboardVisibleRef.current,
      nearBottom: isNearBottomRef.current,
      forcedMs: Math.max(0, forceTailUntilRef.current - now),
      instant: instantNextScrollRef.current,
      initialReady: hasInitialScrollRef.current,
      initialScheduled: isInitialScrollScheduledRef.current,
      bottomAnchoring: isBottomAnchoringRef.current,
      screenFocused: isScreenFocused,
      ...details,
    };

    console.log(`[MeetVapChatScroll] ${JSON.stringify(payload)}`);
  }

  function logChatLifecycleDiagnostic(event: string, details: Record<string, unknown> = {}) {
    if (!CHAT_LIFECYCLE_DIAGNOSTICS_ENABLED) {
      return;
    }

    const now = Date.now();
    const payload = {
      seq: ++chatLifecycleDebugSequenceRef.current,
      event,
      conversationId: route.params.conversationId,
      messageCount: messages.length,
      archivedCount: archivedMessages.length,
      visibleCount: visibleMessageCount,
      tailId: latestTailMessageIdRef.current,
      distanceBottom: Math.round(lastDistanceFromBottomRef.current),
      keyboardLift: Math.round(keyboardLiftRef.current),
      keyboardVisible: isKeyboardVisibleRef.current,
      forcedMs: Math.max(0, forceTailUntilRef.current - now),
      initialReady: hasInitialScrollRef.current,
      initialScheduled: isInitialScrollScheduledRef.current,
      bottomAnchoring: isBottomAnchoringRef.current,
      tailActivityDuringOpen: hasTailActivityDuringOpenRef.current,
      screenFocused: isScreenFocused,
      ...details,
    };

    console.log(`[MeetVapChatLifecycle] ${JSON.stringify(payload)}`);
  }

  const isSelectionMode = selectedMessageIds.length > 0;
  const selectedMessageIdSet = useMemo(() => new Set(selectedMessageIds), [selectedMessageIds]);
  const selectedMessages = useMemo(() => {
    if (selectedMessageIds.length === 0) {
      return [];
    }

    return archivedMessages.filter((message) => selectedMessageIdSet.has(message.id));
  }, [archivedMessages, selectedMessageIdSet, selectedMessageIds.length]);

  useEffect(() => {
    isScrollToBottomVisibleRef.current = isScrollToBottomVisible;
  }, [isScrollToBottomVisible]);

  useEffect(() => {
    logChatLifecycleDiagnostic(
      isInitialScrollReady ? 'opening-timeline-visible' : 'opening-timeline-hidden',
      { chatListItemCount: chatListItems.length },
    );
  }, [chatListItems.length, isInitialScrollReady]);

  useEffect(() => {
    const previousTailMessageId = lastObservedTailMessageIdRef.current;

    if (previousTailMessageId === latestTailMessageId) {
      return;
    }

    lastObservedTailMessageIdRef.current = latestTailMessageId;

    if (
      !previousTailMessageId ||
      !latestTailMessage ||
      latestTailMessage.senderId === user?.id ||
      latestTailMessage.id.startsWith('local-') ||
      !isScreenFocused
    ) {
      return;
    }

    if (!hasInitialScrollRef.current || isInitialScrollScheduledRef.current || pendingInitialAlignmentRef.current) {
      promoteTailReady('incoming-tail-before-initial-ready');
    }

    logChatLifecycleDiagnostic('incoming-tail-observed', {
      messageId: latestTailMessage.id,
      nearTail: isMeasuredNearTail(140),
    });

    const shouldKeepPeerMessageVisible =
      isMeasuredNearTail(140) ||
      isTailForced();

    if (!shouldKeepPeerMessageVisible) {
      return;
    }

    forceTailVisibility(1600);
    scheduleTailScroll({ reason: 'incoming-tail-message', settle: true });
  }, [isScreenFocused, latestTailMessage, latestTailMessageId, user?.id]);
  const shouldBuildConversationTargets = forwardingMessages.length > 0 || isContactSharePickerVisible || isInfoVisible;
  const conversations = useAppStore((state) => (
    shouldBuildConversationTargets ? state.conversations : EMPTY_CONVERSATIONS
  ));
  const directChatTargets = useMemo<ForwardTarget[]>(() => {
    if (!shouldBuildConversationTargets) {
      return [];
    }

    return conversations.reduce<ForwardTarget[]>((targets, item) => {
      if (item.type === 'GROUP' || !item.otherUserId || item.id === route.params.conversationId || isMeetVapSystemConversation(item)) {
        return targets;
      }

      const targetUser = item.members?.find((member) => member.id === item.otherUserId);

      if (targetUser && !isMeetVapSystemUser(targetUser)) {
        targets.push({ conversationId: item.id, title: targetUser.displayName || targetUser.username, user: targetUser });
      }

      return targets;
    }, []);
  }, [conversations, route.params.conversationId, shouldBuildConversationTargets]);
  const contactTargets = useMemo(() => {
    if (!shouldBuildConversationTargets) {
      return [];
    }

    const chatUserIds = new Set(directChatTargets.map((item) => item.user.id));

    return contacts
      .filter((contact) => contact.id !== user?.id && !chatUserIds.has(contact.id))
      .map((contact) => ({ title: contact.displayName || contact.username, user: contact }));
  }, [contacts, directChatTargets, shouldBuildConversationTargets, user?.id]);
  const groupMemberCount = route.params.isGroup === true ? conversation?.memberCount ?? conversation?.members?.length ?? 0 : 0;
  const groupCallCandidates = useMemo(
    () => route.params.isGroup === true ? conversation?.members?.filter((member) => member.id !== user?.id && member.isSystem !== true) ?? [] : [],
    [conversation?.members, route.params.isGroup, user?.id],
  );
  const otherUser = useMemo(() => {
    const conversationMember = conversation?.members?.find((member) => member.id !== user?.id) ?? null;
    const contactMember = contacts.find((contact) => contact.id === conversationMember?.id || contact.id === conversation?.otherUserId) ?? null;

    if (!conversationMember) {
      return contactMember;
    }

    if (conversationMember.hasPremiumAccess !== undefined || contactMember?.hasPremiumAccess !== true) {
      return conversationMember;
    }

    return {
      ...conversationMember,
      hasPremiumAccess: true,
    };
  }, [contacts, conversation?.members, conversation?.otherUserId, user?.id]);
  const shouldShowGroupMemberCount = route.params.isGroup === true && conversation?.showMemberCount !== false;
  const shouldShowGroupAliasPrompt = route.params.isGroup === true &&
    canUsePremiumFeatures &&
    user?.useGroupAliases === true &&
    !!conversation &&
    conversation.myGroupAliasPromptSeen !== true &&
    (!isGroupInvitePending || isGroupAliasEditorOpen);
  const headerTitle = conversation?.title ?? route.params.title;
  const shouldShowHeaderPremiumBadge = route.params.isGroup !== true && otherUser?.hasPremiumAccess === true;
  const hasDisappearingMessages = !!conversation?.disappearingMessagesDurationMinutes;
  const headerAvatarUri = route.params.isGroup === true
    ? conversation?.avatarUrl
    : isSystemChat
      ? conversation?.avatarUrl ?? otherUser?.avatarUrl ?? MEETVAP_SYSTEM_AVATAR_URL
      : otherUser?.avatarUrl;
  const isGroupAdmin = route.params.isGroup === true && !!user?.id && (
    conversation?.ownerId === user.id || conversation?.adminIds?.includes(user.id) === true
  );
  const isGroupMessageLockedForCurrentUser = route.params.isGroup === true && conversation?.ownerOnlyMessages === true && !isGroupAdmin;
  const canPinMessages = route.params.isGroup !== true || isGroupAdmin;
  const canSendMessages = !isGroupInvitePending && (route.params.isGroup !== true || conversation?.ownerOnlyMessages !== true || isGroupAdmin);
  const canUseMessageWriteActions = !isGroupMessageLockedForCurrentUser && canSendMessages;
  const canSaveMediaToPhone = route.params.isGroup !== true || isGroupAdmin || conversation?.preventMediaSave !== true;
  const shouldShowAddContactPrompt = route.params.isGroup !== true &&
    !isSystemChat &&
    !isAddContactPromptDismissed &&
    conversation?.isContact === false &&
    !!(conversation.otherUserId ?? otherUser?.id);
  const presenceSubtitle = useMemo(
    () => (isOtherUserTyping ? t('typing', {}, uiLanguage) : formatPresenceSubtitle(otherUser, uiLanguage, { compact: true })),
    [isOtherUserTyping, otherUser, uiLanguage],
  );

  useEffect(() => {
    if (!isGroupMessageLockedForCurrentUser) {
      return;
    }

    setAttachmentSheetVisible(false);
    setEmojiPickerVisible(false);
    setReplyingToMessage(null);
    Keyboard.dismiss();
  }, [isGroupMessageLockedForCurrentUser]);

  const searchMatches = useMemo(() => {
    if (!isSearchVisible) {
      return [];
    }

    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return [];
    }

    return archivedMessages.reduce<number[]>((matches, message, index) => {
      if (message.body.toLowerCase().includes(query)) {
        matches.push(index);
      }

      return matches;
    }, []);
  }, [archivedMessages, isSearchVisible, searchQuery]);
  const emojiGroups = useMemo(() => (
    recentEmojis.length > 0
      ? [{ icon: 'time-outline' as const, key: 'recent', label: t('emojiRecent', {}, language), emojis: recentEmojis }, ...EMOJI_GROUPS.map((group) => ({ ...group, label: t(group.labelKey, {}, language) }))]
      : EMOJI_GROUPS.map((group) => ({ ...group, label: t(group.labelKey, {}, language) }))
  ), [language, recentEmojis]);
  const selectedEmojiGroup = emojiGroups.find((group) => group.key === selectedEmojiGroupKey) ?? emojiGroups[0];
  const pinnedMessagesWithLocalContent = useMemo(() => {
    if (pinnedMessages.length === 0 || archivedMessages.length === 0) {
      return pinnedMessages;
    }

    const localMessageById = new Map(archivedMessages.map((message) => [message.id, message]));

    return pinnedMessages.map((item) => {
      const localMessage = localMessageById.get(item.message.id);

      if (!localMessage) {
        return item;
      }

      return {
        ...item,
        message: mergePinnedMessageWithLocalCopy(item.message, localMessage),
      };
    });
  }, [archivedMessages, pinnedMessages]);
  const sortedPinnedMessages = useMemo(
    () => [...pinnedMessagesWithLocalContent].sort((left, right) => Date.parse(right.pinnedAt) - Date.parse(left.pinnedAt)),
    [pinnedMessagesWithLocalContent],
  );
  const pinnedMessageIds = useMemo(() => new Set(sortedPinnedMessages.map((item) => item.message.id)), [sortedPinnedMessages]);
  const latestPinnedMessage = sortedPinnedMessages[0]?.message;
  const filteredPinnedMessages = useMemo(() => {
    const normalizedQuery = pinnedSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return sortedPinnedMessages;
    }

    return sortedPinnedMessages.filter((item) => getPinnedMessageSearchText(item.message, uiLanguage).includes(normalizedQuery));
  }, [pinnedSearchQuery, sortedPinnedMessages, uiLanguage]);

  const applyPeerScreenshotProtection = useCallback(async (isActive: () => boolean) => {
    const protectionReason = `chat:${route.params.conversationId}`;
    const shouldCheckPeer = !isSystemChat && (route.params.isGroup === true || !!otherUser?.id);

    if (!shouldCheckPeer) {
      clearScreenCaptureProtectionRequirement(protectionReason);
      hasShownScreenshotPrivacyWarningRef.current = false;
      return;
    }

    if (!serverUrl) {
      setScreenCaptureProtectionRequirement(protectionReason, true);
      if (!hasShownScreenshotPrivacyWarningRef.current && isActive()) {
        hasShownScreenshotPrivacyWarningRef.current = true;
        Alert.alert(t('privacy'), t('screenshotPrivacyCheckFailed'));
      }
      return;
    }

    if (route.params.isGroup === true && conversation?.preventScreenshots === true) {
      setScreenCaptureProtectionRequirement(protectionReason, true);
    }

    try {
      const privacy = await getConversationScreenshotPrivacy(serverUrl, route.params.conversationId);

      if (!isActive()) {
        return;
      }

      setScreenCaptureProtectionRequirement(protectionReason, privacy.preventPeerScreenshots === true);
      hasShownScreenshotPrivacyWarningRef.current = false;
    } catch {
      if (!isActive()) {
        return;
      }

      setScreenCaptureProtectionRequirement(protectionReason, true);
      if (!hasShownScreenshotPrivacyWarningRef.current) {
        hasShownScreenshotPrivacyWarningRef.current = true;
        Alert.alert(t('privacy'), t('screenshotPrivacyCheckFailed'));
      }
    }
  }, [conversation?.preventScreenshots, isSystemChat, otherUser?.id, route.params.conversationId, route.params.isGroup, serverUrl]);

  const confirmStartCall = useCallback(async (mode: 'voice' | 'video', voiceEffectId?: VoiceEffectId) => {
    const startedAt = Date.now();
    logUiPerformanceDiagnostic('call-confirm-start', {
      conversationId: route.params.conversationId,
      mode,
      voiceEffectId,
    });

    if (isSystemChat || isVoiceRoomConversation) {
      logUiPerformanceDiagnostic('call-confirm-blocked-chat-type', {
        conversationId: route.params.conversationId,
        elapsedMs: Date.now() - startedAt,
        mode,
      });
      return;
    }

    if (getActiveCallSession()?.callState === 'active') {
      logUiPerformanceDiagnostic('call-confirm-blocked-active-call', {
        conversationId: route.params.conversationId,
        elapsedMs: Date.now() - startedAt,
        mode,
      });
      Alert.alert(t('callUnavailableDuringActiveCallTitle'), t('callUnavailableDuringActiveCallMessage'));
      return;
    }

    Keyboard.dismiss();
    logUiPerformanceDiagnostic('call-confirm-keyboard-dismissed', {
      conversationId: route.params.conversationId,
      elapsedMs: Date.now() - startedAt,
      mode,
    });

    const resolvedVoiceEffectId = mode === 'voice' && canUsePremiumFeatures
      ? normalizeVoiceEffectId(voiceEffectId)
      : DEFAULT_VOICE_EFFECT_ID;

    if (mode === 'voice') {
      await showVoiceCallTip();
      logUiPerformanceDiagnostic('call-confirm-voice-tip-finished', {
        conversationId: route.params.conversationId,
        elapsedMs: Date.now() - startedAt,
        mode,
      });
      setNativeLiveVoiceEffect(resolvedVoiceEffectId);
    }

    const isGroup = route.params.isGroup === true;
    const maxParticipants = getGroupCallLimit(mode);
    const maxInvitees = maxParticipants - 1;

    if (isGroup && groupMemberCount > maxParticipants) {
      if (groupCallCandidates.length === 0) {
        logUiPerformanceDiagnostic('call-confirm-group-limit-alert', {
          conversationId: route.params.conversationId,
          elapsedMs: Date.now() - startedAt,
          mode,
        });
        Alert.alert(
          t('choosePeople'),
          t('groupCallLimitUnavailable'),
        );
        return;
      }

      setSelectedGroupCallMemberIds(groupCallCandidates.slice(0, maxInvitees).map((member) => member.id));
      setGroupCallVoiceEffectId(resolvedVoiceEffectId);
      setGroupCallPickerMode(mode);
      logUiPerformanceDiagnostic('call-confirm-group-picker-opened', {
        conversationId: route.params.conversationId,
        elapsedMs: Date.now() - startedAt,
        mode,
      });
      return;
    }

    logUiPerformanceDiagnostic('call-confirm-alert-show', {
      conversationId: route.params.conversationId,
      elapsedMs: Date.now() - startedAt,
      mode,
    });
    Alert.alert(
      isGroup
        ? (mode === 'video' ? t('startGroupVideoCallQuestion') : t('startGroupVoiceCallQuestion'))
        : (mode === 'video' ? t('startVideoCallQuestion') : t('startVoiceCallQuestion')),
      isGroup
        ? t('inviteGroupMembersQuestion', { name: route.params.title })
        : t('callNameQuestion', { name: route.params.title }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: isGroup ? t('invite') : t('call'),
          onPress: () => {
            logUiPerformanceDiagnostic('call-confirm-alert-accepted', {
              conversationId: route.params.conversationId,
              elapsedSinceConfirmStartMs: Date.now() - startedAt,
              mode,
            });
            navigation.navigate('CallRoom', {
              conversationId: route.params.conversationId,
              direction: 'outgoing',
              isGroupCall: isGroup,
              mode,
              title: route.params.title,
              voiceEffectId: resolvedVoiceEffectId,
            });
          },
        },
      ],
    );
  }, [canUsePremiumFeatures, groupCallCandidates, groupMemberCount, isSystemChat, isVoiceRoomConversation, navigation, route.params.conversationId, route.params.isGroup, route.params.title, showVoiceCallTip]);

  const selectCallVoiceEffect = useCallback((effectId: VoiceEffectId) => {
    const normalizedEffectId = normalizeVoiceEffectId(effectId);
    if (normalizedEffectId !== DEFAULT_VOICE_EFFECT_ID && !canUsePremiumFeatures) {
      Alert.alert(t('premiumRequiredTitle'), t('premiumRequiredMessage'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('premiumSubscribe'), onPress: () => navigation.navigate('Subscription') },
      ]);
      return;
    }

    selectedCallVoiceEffectIdRef.current = normalizedEffectId;
    setSelectedCallVoiceEffectId(normalizedEffectId);
  }, [canUsePremiumFeatures, navigation]);

  const openChatSearch = useCallback(() => {
    setInfoVisible(false);
    setSearchVisible(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectedMessageIds([]);
  }, []);

  const refreshPinnedMessages = useCallback(async () => {
    if (!serverUrl || isGroupInvitePending) {
      setPinnedMessages([]);
      return;
    }

    const pins = await listPinnedMessages(serverUrl, route.params.conversationId);
    setPinnedMessages(pins);
  }, [isGroupInvitePending, route.params.conversationId, serverUrl]);

  const markMessagesPendingDelete = useCallback((targetMessages: Message[]) => {
    const messageIds = targetMessages.map((message) => message.id);
    const messageKeys = targetMessages
      .map(getMessageDeleteKey)
      .filter((key): key is string => !!key);

    setPinnedMessages((current) => current.filter((item) => !shouldRemovePinnedMessageForDeletion(item.message, messageIds, messageKeys)));
    setPendingDeletedMessageIds((current) => Array.from(new Set([...current, ...messageIds])));
    setPendingDeletedMessageKeys((current) => Array.from(new Set([...current, ...messageKeys])));
    setMessageActionMenu((current) => current && messageIds.includes(current.id) ? null : current);
    setMediaActionMessage((current) => current && messageIds.includes(current.id) ? null : current);
    setViewerMessage((current) => current && messageIds.includes(current.id) ? null : current);
    setReplyingToMessage((current) => current && messageIds.includes(current.id) ? null : current);
    setSelectedMessageIds((current) => current.filter((messageId) => !messageIds.includes(messageId)));
  }, []);

  const unmarkMessagesPendingDelete = useCallback((targetMessages: Message[]) => {
    const messageIds = new Set(targetMessages.map((message) => message.id));
    const messageKeys = new Set(targetMessages.map(getMessageDeleteKey).filter((key): key is string => !!key));

    setPendingDeletedMessageIds((current) => current.filter((messageId) => !messageIds.has(messageId)));
    setPendingDeletedMessageKeys((current) => current.filter((messageKey) => !messageKeys.has(messageKey)));
  }, []);

  const startForwardingSelectedMessages = useCallback(() => {
    if (selectedMessages.length === 0) {
      return;
    }

    setForwardingMessages(selectedMessages);
  }, [selectedMessages]);

  const confirmDeleteSelectedMessages = useCallback(() => {
    if (!canUseMessageWriteActions) {
      return;
    }

    const count = selectedMessageIds.length;

    if (count === 0) {
      return;
    }

    const deleteSelectedMessages = (mode: 'all' | 'me') => {
      const targetMessages = selectedMessages;

      markMessagesPendingDelete(targetMessages);
      exitSelectionMode();

      void Promise.all(targetMessages.map((message) => deleteMessage(route.params.conversationId, message.id, mode)))
        .catch((error) => {
          unmarkMessagesPendingDelete(targetMessages);
          void refreshPinnedMessages().catch(() => undefined);
          Alert.alert(t('deleteFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
        });
    };

    Alert.alert(
      t('deleteMessagesQuestion', {}, language),
      count === 1
        ? t('deleteSingleMessageDescription', {}, language)
        : t('deleteSelectedMessagesDescription', { count }, language),
      [
        {
          text: t('deleteForAnyone', {}, language),
          style: 'destructive',
          onPress: () => deleteSelectedMessages('all'),
        },
        { text: t('deleteForMe', {}, language), onPress: () => deleteSelectedMessages('me') },
        { text: t('cancel', {}, language), style: 'cancel' },
      ],
    );
  }, [canUseMessageWriteActions, deleteMessage, exitSelectionMode, language, markMessagesPendingDelete, refreshPinnedMessages, route.params.conversationId, selectedMessageIds.length, selectedMessages, unmarkMessagesPendingDelete]);

  const changeGroupPicture = useCallback(async () => {
    if (!serverUrl || !conversation) {
      return;
    }

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded', {}, language), t('groupPhotoLibraryPermission', {}, language));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ['images'],
        quality: 0.85,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      const asset = result.assets[0];
      const media = await uploadMediaFile(serverUrl, {
        mimeType: asset.mimeType ?? 'image/jpeg',
        originalName: asset.fileName ?? 'group.jpg',
        uri: asset.uri,
      });

      await updateGroupAvatar(conversation.id, `${serverUrl}/media/${media.id}/file`);
    } catch (error) {
      Alert.alert(t('pictureFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    } finally {
      endLockDeferral();
    }
  }, [conversation, language, serverUrl, updateGroupAvatar]);

  const showGroupPictureActions = useCallback(() => {
    if (!conversation || !isGroupAdmin) {
      return;
    }

    Alert.alert(t('groupPicture', {}, language), t('chooseGroupPictureAction', {}, language), [
      { text: t('changePicture', {}, language), onPress: () => void changeGroupPicture() },
      ...(conversation.avatarUrl ? [{ text: t('removePicture', {}, language), style: 'destructive' as const, onPress: () => void updateGroupAvatar(conversation.id, null) }] : []),
      { text: t('cancel', {}, language), style: 'cancel' },
    ]);
  }, [changeGroupPicture, conversation, isGroupAdmin, language, updateGroupAvatar]);

  const confirmLeaveGroup = useCallback(() => {
    if (!conversation || !user || route.params.isGroup !== true) {
      return;
    }

    setChatHeaderMenuVisible(false);

    if (conversation.ownerId === user.id) {
      Alert.alert(t('transferOwnershipFirst', {}, language), t('transferOwnershipBeforeLeaving', {}, language));
      return;
    }

    Alert.alert(
      conversation.adminIds?.includes(user.id) === true ? t('leaveAdminGroupTitle', {}, language) : t('leaveGroupQuestion', {}, language),
      conversation.adminIds?.includes(user.id) === true
        ? t('leaveAdminGroupDescription', {}, language)
        : t('leaveGroupDescription', { name: conversation.title || route.params.title }, language),
      [
        { text: t('cancel', {}, language), style: 'cancel' },
        {
          text: t('leaveGroup', {}, language),
          style: 'destructive',
          onPress: async () => {
            try {
              if (conversation.adminIds?.includes(user.id) === true) {
                await revokeGroupAdmin(conversation.id, user.id);
              }
              await removeGroupMember(conversation.id, user.id);
              navigation.goBack();
            } catch (error) {
              Alert.alert(t('leaveGroupFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
            }
          },
        },
      ],
    );
  }, [conversation, language, navigation, removeGroupMember, revokeGroupAdmin, route.params.isGroup, route.params.title, user]);

  const toggleHeaderMute = useCallback(() => {
    if (!conversation) {
      return;
    }

    setChatHeaderMenuVisible(false);
    if (isConversationMuted(conversation)) {
      void updateConversationMute(conversation.id, false).catch((error) => {
        Alert.alert(t('unmuteFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
      });
      return;
    }

    setMuteDurationMenuVisible(true);
  }, [conversation, language, route.params.isGroup, updateConversationMute]);

  const confirmClearLocalChat = useCallback(() => {
    if (!conversation) {
      return;
    }

    setChatHeaderMenuVisible(false);
    Alert.alert(
      t('clearChatQuestion', {}, language),
      t('clearChatLocalDescription', {}, language),
      [
        { text: t('cancel', {}, language), style: 'cancel' },
        {
          text: t('clearChat', {}, language),
          style: 'destructive',
          onPress: () => {
            void clearLocalChat(conversation.id).catch((error) => {
              Alert.alert(t('clearFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
            });
          },
        },
      ],
    );
  }, [clearLocalChat, conversation]);

  function confirmReportCurrentChat() {
    if (!conversation) {
      return;
    }

    const isGroup = route.params.isGroup === true;
    const targetId = isGroup ? conversation.id : conversation.otherUserId ?? otherUser?.id;

    if (!targetId) {
      return;
    }

    setChatHeaderMenuVisible(false);
    Alert.alert(
      isGroup ? t('reportGroupQuestion') : t('reportUserQuestion'),
      getReportContextNotice(),
      [
        {
          text: t('report'),
          style: 'destructive',
          onPress: () => {
            void submitChatReport(targetId, isGroup, false);
          },
        },
        {
          text: isGroup ? t('reportAndBlockGroup') : t('reportAndBlockUser'),
          style: 'destructive',
          onPress: () => {
            void submitChatReport(targetId, isGroup, true);
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  }

  const confirmBlockCurrentUser = useCallback(() => {
    const targetId = conversation?.otherUserId ?? otherUser?.id;

    if (!targetId || route.params.isGroup === true || isSystemChat) {
      return;
    }

    setChatHeaderMenuVisible(false);
    Alert.alert(
      t('blockUserQuestion', {}, language),
      t('blockUserMessage', { name: conversation?.title || route.params.title }, language),
      [
        { text: t('cancel', {}, language), style: 'cancel' },
        {
          onPress: () => {
            void blockUserById(targetId).catch((error) => {
              Alert.alert(t('blockFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
            });
          },
          style: 'destructive',
          text: t('blockUser', {}, language),
        },
      ],
    );
  }, [blockUserById, conversation?.otherUserId, conversation?.title, isSystemChat, language, otherUser?.id, route.params.isGroup, route.params.title]);

  const changeDisappearingMessages = useCallback((enabled: boolean) => {
    if (!conversation || route.params.isGroup === true) {
      return;
    }

    if (!enabled) {
      void updateDisappearingMessages(conversation.id, null).catch((error) => {
        Alert.alert(t('disappearingMessagesUpdateFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
      });
      return;
    }

    setInfoVisible(false);
    setTimeout(() => {
      setDisappearingMessagesDurationMenuVisible(true);
    }, Platform.OS === 'ios' ? 320 : 0);
  }, [conversation, language, route.params.isGroup, updateDisappearingMessages]);

  const closeDisappearingMessagesDurationMenu = useCallback(() => {
    setDisappearingMessagesDurationMenuVisible(false);
    setTimeout(() => {
      setInfoVisible(true);
    }, Platform.OS === 'ios' ? 320 : 0);
  }, []);

  const chooseDisappearingMessagesDuration = useCallback((durationMinutes: 240 | 480 | 1440 | 10080, labelKey: string) => {
    if (!conversation) {
      return;
    }

    setDisappearingMessagesDurationMenuVisible(false);
    setTimeout(() => {
      Alert.alert(
        t('enableDisappearingMessagesQuestion', {}, language),
        t('enableDisappearingMessagesDescription', { duration: t(labelKey, {}, language) }, language),
        [
          { onPress: () => setInfoVisible(true), text: t('cancel', {}, language), style: 'cancel' },
          {
            onPress: () => {
              void updateDisappearingMessages(conversation.id, durationMinutes).catch((error) => {
                Alert.alert(t('disappearingMessagesUpdateFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
              });
              setInfoVisible(true);
            },
            text: t('confirm', {}, language),
          },
        ],
        {
          onDismiss: () => setInfoVisible(true),
        },
      );
    }, Platform.OS === 'ios' ? 320 : 0);
  }, [conversation, language, updateDisappearingMessages]);

  const clearInitialScrollTimeouts = useCallback(() => {
    initialScrollTimeoutsRef.current.forEach(clearTimeout);
    initialScrollTimeoutsRef.current = [];
    isInitialScrollScheduledRef.current = false;
  }, []);

  const clearTailScrollTimeouts = useCallback(() => {
    if (pendingTailScrollTimeoutRef.current) {
      clearTimeout(pendingTailScrollTimeoutRef.current);
      pendingTailScrollTimeoutRef.current = null;
    }
    pendingTailSettleTimeoutsRef.current.forEach(clearTimeout);
    pendingTailSettleTimeoutsRef.current = [];
  }, []);

  const clearInstantTailReleaseTimeout = useCallback(() => {
    if (pendingInstantTailReleaseTimeoutRef.current) {
      clearTimeout(pendingInstantTailReleaseTimeoutRef.current);
      pendingInstantTailReleaseTimeoutRef.current = null;
    }
  }, []);

  const clearBottomAnchorTimeout = useCallback(() => {
    if (pendingBottomAnchorTimeoutRef.current) {
      clearTimeout(pendingBottomAnchorTimeoutRef.current);
      pendingBottomAnchorTimeoutRef.current = null;
    }
  }, []);

  const clearPendingJumpRetry = useCallback(() => {
    if (pendingJumpRetryTimeoutRef.current) {
      clearTimeout(pendingJumpRetryTimeoutRef.current);
      pendingJumpRetryTimeoutRef.current = null;
    }
  }, []);

  const clearPendingMessageJump = useCallback(() => {
    clearPendingJumpRetry();
    pendingJumpMessageIdRef.current = null;
    pendingJumpOptionsRef.current = null;
    pendingJumpAttemptRef.current = 0;
  }, [clearPendingJumpRetry]);

  function isMeasuredAtTail(threshold = 4) {
    if (latestMessageCountRef.current === 0) {
      return true;
    }

    if (listViewportHeightRef.current <= 0 || lastContentHeightRef.current <= 0) {
      return true;
    }

    return lastDistanceFromBottomRef.current <= threshold;
  }

  function markInitialTailReady(reason: string) {
    initialScrollTimeoutsRef.current.forEach(clearTimeout);
    initialScrollTimeoutsRef.current = [];
    pendingBottomAnchorAttemptRef.current = 0;
    pendingInitialAlignmentRef.current = false;
    hasInitialScrollRef.current = true;
    isInitialScrollScheduledRef.current = false;
    isTailOpenLockedRef.current = false;
    isBottomAnchoringRef.current = false;
    isNearBottomRef.current = true;
    lastScrolledMessageCountRef.current = latestMessageCountRef.current;
    lastAutoTailMessageIdRef.current = latestTailMessageIdRef.current;
    setBottomAnchoringActive(false);
    setInitialScrollReady(true);
    setScrollToBottomVisible(false);
    logChatScrollDiagnostic('initial-anchor-ready', { reason });
    logChatLifecycleDiagnostic('initial-anchor-ready', { reason });
  }

  const scheduleBottomAnchorSettle = useCallback(() => {
    clearBottomAnchorTimeout();

    pendingBottomAnchorTimeoutRef.current = setTimeout(() => {
      pendingBottomAnchorTimeoutRef.current = null;

      if (pendingInitialAlignmentRef.current) {
        if (isMeasuredAtTail()) {
          markInitialTailReady('settled-at-tail');
          return;
        }

        if (pendingBottomAnchorAttemptRef.current < 6) {
          pendingBottomAnchorAttemptRef.current += 1;
          logChatScrollDiagnostic('initial-anchor-not-at-tail', {
            attempt: pendingBottomAnchorAttemptRef.current,
            distanceBottom: Math.round(lastDistanceFromBottomRef.current),
          });
          scrollTailToEnd();
          scheduleBottomAnchorSettle();
          return;
        }

        markInitialTailReady('settle-timeout');
        return;
      }

      pendingBottomAnchorAttemptRef.current = 0;
      isBottomAnchoringRef.current = false;
      setBottomAnchoringActive(false);
    }, 260);
  }, [clearBottomAnchorTimeout]);

  const anchorToBottom = useCallback((options?: { animated?: boolean; markInitialReady?: boolean }) => {
    const animated = options?.animated === true;
    const markInitialReady = options?.markInitialReady === true;

    logChatScrollDiagnostic('anchor-to-bottom', { animated, markInitialReady });

    clearInitialScrollTimeouts();
    clearBottomAnchorTimeout();

    if (latestMessageCountRef.current === 0) {
      hasInitialScrollRef.current = true;
      isNearBottomRef.current = true;
      isBottomAnchoringRef.current = false;
      isTailOpenLockedRef.current = false;
      setBottomAnchoringActive(false);
      pendingInitialAlignmentRef.current = false;
      lastScrolledMessageCountRef.current = 0;
      lastAutoTailMessageIdRef.current = null;
      setInitialScrollReady(true);
      setScrollToBottomVisible(false);
      return;
    }

    if (markInitialReady) {
      pendingInitialAlignmentRef.current = true;
      isInitialScrollScheduledRef.current = true;
      isTailOpenLockedRef.current = true;
      pendingBottomAnchorAttemptRef.current = 0;
      logChatLifecycleDiagnostic('opening-anchor-start');
    }

    isBottomAnchoringRef.current = true;
    setBottomAnchoringActive(true);
    isNearBottomRef.current = true;
    setScrollToBottomVisible(false);

    if (animated) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ animated: true, offset: 0 });
      });
    } else {
      scrollTailToEnd();
    }
    [40, 120, 240].forEach((delay) => {
      const timeout = setTimeout(() => {
        scrollTailToEnd();
      }, delay);
      initialScrollTimeoutsRef.current.push(timeout);
    });

    scheduleBottomAnchorSettle();
  }, [clearBottomAnchorTimeout, clearInitialScrollTimeouts, scheduleBottomAnchorSettle]);

  const scheduleOpenChatAlignment = useCallback(() => {
    anchorToBottom({ markInitialReady: true });
  }, [anchorToBottom]);

  function promoteTailReady(reason: string) {
    hasTailActivityDuringOpenRef.current = true;
    clearInitialScrollTimeouts();
    clearBottomAnchorTimeout();
    markInitialTailReady(reason);
    logChatLifecycleDiagnostic('promote-tail-ready', { reason });
    logChatScrollDiagnostic('promote-tail-ready', { reason });
  }

  function isOpenHistoryGuardActive() {
    return Date.now() < openHistoryGuardUntilRef.current;
  }

  const ensureMessageVisible = useCallback((messageId: string, options?: MessageJumpOptions) => {
    const scrollOptions = {
      animated: options?.animated ?? true,
      viewPosition: options?.viewPosition ?? 0.45,
    };
    const messageIndex = archivedMessages.findIndex((message) => message.id === messageId);

    if (messageIndex < 0) {
      return false;
    }

    if (pendingJumpMessageIdRef.current !== messageId) {
      pendingJumpAttemptRef.current = 0;
    }
    pendingJumpMessageIdRef.current = messageId;
    pendingJumpOptionsRef.current = scrollOptions;

    if (messageIndex < visibleWindowStartIndex) {
      const requiredVisibleCount = archivedMessages.length - messageIndex;
      clearPendingJumpRetry();
      isTailOpenLockedRef.current = false;
      isBottomAnchoringRef.current = false;
      setBottomAnchoringActive(false);
      setInitialScrollReady(true);
      setVisibleMessageCount((current) => Math.min(archivedMessages.length, Math.max(current, requiredVisibleCount)));
      return false;
    }

    const visibleIndex = messageListIndexById.get(messageId);

    if (visibleIndex === undefined) {
      return false;
    }

    clearPendingJumpRetry();
    isTailOpenLockedRef.current = false;
    isNearBottomRef.current = false;
    isBottomAnchoringRef.current = false;
    setBottomAnchoringActive(false);
    setInitialScrollReady(true);
    setScrollToBottomVisible(true);
    const attemptAtScroll = pendingJumpAttemptRef.current;

    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({
        animated: scrollOptions.animated,
        index: visibleIndex,
        viewPosition: scrollOptions.viewPosition,
      });

      setTimeout(() => {
        if (
          pendingJumpMessageIdRef.current === messageId &&
          pendingJumpAttemptRef.current === attemptAtScroll
        ) {
          clearPendingMessageJump();
        }
      }, 900);
    });

    return true;
  }, [archivedMessages, clearPendingJumpRetry, clearPendingMessageJump, messageListIndexById, visibleWindowStartIndex]);

  const showMessageFromInfo = useCallback((messageId: string) => {
    setInfoVisible(false);
    clearPendingMessageJump();
    setTimeout(() => {
      ensureMessageVisible(messageId, { animated: true, viewPosition: 0.35 });
    }, 260);
  }, [clearPendingMessageJump, ensureMessageVisible]);

  const openPinnedMessages = useCallback(() => {
    setPinnedSearchQuery('');
    setPinnedMessagesVisible(true);
  }, []);

  const showPinnedMessageInChat = useCallback((messageId: string) => {
    setPinnedMessagesVisible(false);
    clearPendingMessageJump();
    setTimeout(() => {
      ensureMessageVisible(messageId, { animated: true, viewPosition: 0.35 });
    }, 260);
  }, [clearPendingMessageJump, ensureMessageVisible]);

  useLayoutEffect(() => {
    const canGoBack = navigation.canGoBack();

    navigation.setOptions({
      headerLeft: isSelectionMode
        ? () => (
            <Pressable onPress={exitSelectionMode} style={styles.headerButton}>
              <Ionicons color={colors.white} name="close" size={24} />
            </Pressable>
          )
        : canGoBack
          ? () => (
              <Pressable onPress={() => navigation.goBack()} style={styles.headerButton}>
                <Ionicons color={colors.white} name="chevron-back" size={26} />
              </Pressable>
            )
          : undefined,
      headerTitle: () => (
        isSelectionMode ? (
          <View style={styles.headerTitleButton}>
            <Text numberOfLines={1} style={styles.headerTitleText}>{selectedMessageIds.length} selected</Text>
          </View>
        ) : (
          <Pressable disabled={isSystemChat} onPress={() => setInfoVisible(true)} style={styles.headerTitleButton}>
            <View style={hasDisappearingMessages ? styles.disappearingHeaderAvatar : undefined}>
              <Avatar label={headerTitle} size={34} uri={headerAvatarUri} />
              {hasDisappearingMessages ? (
                <View style={styles.disappearingHeaderClock}>
                  <Ionicons color={colors.white} name="time-outline" size={11} />
                </View>
              ) : null}
            </View>
            <View style={styles.headerTitleContent}>
              <View style={styles.headerTitleLine}>
                {shouldShowHeaderPremiumBadge ? <PremiumUserBadge size={16} /> : null}
                <Text numberOfLines={1} style={styles.headerTitleText}>{headerTitle}</Text>
              </View>
              {shouldShowGroupMemberCount ? (
                <Text numberOfLines={1} style={styles.headerSubtitleText}>{formatSubscriberCount(groupMemberCount, uiLanguage)}</Text>
              ) : presenceSubtitle ? (
                <Text numberOfLines={1} style={styles.headerSubtitleText}>{presenceSubtitle}</Text>
              ) : null}
            </View>
          </Pressable>
        )
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          {isSelectionMode ? (
            <>
              <Pressable onPress={startForwardingSelectedMessages} style={styles.headerButton}>
                <Ionicons color={colors.white} name="arrow-redo-outline" size={23} />
              </Pressable>
              {canUseMessageWriteActions ? (
                <Pressable onPress={confirmDeleteSelectedMessages} style={styles.headerButton}>
                  <Ionicons color={colors.white} name="trash-outline" size={23} />
                </Pressable>
              ) : null}
            </>
          ) : isSystemChat ? null : (
            <>
              {!isVoiceRoomConversation ? (
                <>
                  <Pressable
                    onPress={() => {
                      logUiPerformanceDiagnostic('call-header-button-pressed', {
                        conversationId: route.params.conversationId,
                        mode: 'video',
                      });
                      void confirmStartCall('video');
                    }}
                    style={styles.headerButton}
                  >
                    <Ionicons color={colors.white} name="videocam-outline" size={22} />
                  </Pressable>
                  <Pressable
                    onLongPress={() => {
                      logUiPerformanceDiagnostic('call-header-button-long-pressed', {
                        conversationId: route.params.conversationId,
                        mode: 'voice',
                      });
                      if (getActiveCallSession()?.callState === 'active') {
                        Alert.alert(t('callUnavailableDuringActiveCallTitle'), t('callUnavailableDuringActiveCallMessage'));
                        return;
                      }

                      if (!canUsePremiumFeatures) {
                        Alert.alert(t('premiumRequiredTitle'), t('premiumRequiredMessage'), [
                          { text: t('cancel'), style: 'cancel' },
                          { text: t('premiumSubscribe'), onPress: () => navigation.navigate('Subscription') },
                        ]);
                        return;
                      }

                      Keyboard.dismiss();
                      suppressNextCallPressRef.current = true;
                      selectedCallVoiceEffectIdRef.current = DEFAULT_VOICE_EFFECT_ID;
                      setSelectedCallVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
                      setCallVoiceEffectPickerVisible(true);
                    }}
                    onPress={() => {
                      logUiPerformanceDiagnostic('call-header-button-pressed', {
                        conversationId: route.params.conversationId,
                        mode: 'voice',
                      });
                      if (suppressNextCallPressRef.current) {
                        suppressNextCallPressRef.current = false;
                        return;
                      }

                      void confirmStartCall('voice');
                    }}
                    style={styles.headerButton}
                  >
                    <Ionicons color={colors.white} name="call-outline" size={21} />
                  </Pressable>
                </>
              ) : null}
              <Pressable onPress={() => setChatHeaderMenuVisible(true)} style={styles.headerButton}>
                <Ionicons color={colors.white} name="ellipsis-vertical" size={21} />
              </Pressable>
            </>
          )}
        </View>
      ),
    });
  }, [canUseMessageWriteActions, canUsePremiumFeatures, confirmDeleteSelectedMessages, confirmStartCall, exitSelectionMode, groupMemberCount, hasDisappearingMessages, headerAvatarUri, headerTitle, isSelectionMode, isSystemChat, isVoiceRoomConversation, navigation, presenceSubtitle, route.params.isGroup, selectedMessageIds.length, shouldShowHeaderPremiumBadge, startForwardingSelectedMessages, uiLanguage]);

  useEffect(() => {
    setSearchIndex(0);
  }, [searchQuery]);

  useEffect(() => {
    getStoredRecentEmojis()
      .then((emojis) => {
        const recent = emojis.filter((emoji) => typeof emoji === 'string' && emoji.length > 0).slice(0, 36);

        setRecentEmojis(recent);
        if (recent.length > 0) {
          setSelectedEmojiGroupKey('recent');
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    getStoredPlayedVoiceMessageIds()
      .then((messageIds) => {
        setPlayedVoiceMessageIds(new Set(messageIds));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (emojiGroups.some((group) => group.key === selectedEmojiGroupKey)) {
      return;
    }

    setSelectedEmojiGroupKey(emojiGroups[0].key);
  }, [emojiGroups, selectedEmojiGroupKey]);

  useEffect(() => {
    if (selectedMessageIds.length === 0) {
      return;
    }

    const archivedMessageIds = new Set(archivedMessages.map((message) => message.id));
    setSelectedMessageIds((current) => current.filter((id) => archivedMessageIds.has(id)));
  }, [archivedMessages, selectedMessageIds.length]);

  useEffect(() => {
    isHistoryExpansionPendingRef.current = false;
  }, [visibleWindowStartIndex]);

  useEffect(() => {
    clearPendingMessageJump();
    isHistoryExpansionPendingRef.current = false;
    isOlderLocalHistoryLoadingRef.current = false;
    isOlderLocalHistoryExhaustedRef.current = false;
  }, [clearPendingMessageJump, route.params.conversationId]);

  useEffect(() => {
    if (forwardingMessages.length > 0) {
      void loadContacts().catch(() => undefined);
    }
  }, [forwardingMessages.length, loadContacts]);

  useEffect(() => {
    if (isInfoVisible && route.params.isGroup === true && isGroupAdmin) {
      void loadContacts().catch(() => undefined);
    }
  }, [isGroupAdmin, isInfoVisible, loadContacts, route.params.isGroup]);

  useEffect(() => {
    if (!isSearchVisible || searchMatches.length === 0) {
      return;
    }

    const boundedIndex = Math.min(searchIndex, searchMatches.length - 1);
    const messageIndex = searchMatches[boundedIndex];
    const targetMessage = archivedMessages[messageIndex];

    if (!targetMessage) {
      return;
    }

    void ensureMessageVisible(targetMessage.id, { animated: true, viewPosition: 0.45 });
  }, [archivedMessages, ensureMessageVisible, isSearchVisible, searchIndex, searchMatches]);

  useEffect(() => {
    const pendingMessageId = pendingJumpMessageIdRef.current;

    if (!pendingMessageId) {
      return;
    }

    ensureMessageVisible(pendingMessageId, pendingJumpOptionsRef.current ?? { animated: true, viewPosition: 0.45 });
  }, [ensureMessageVisible, messages.length, visibleWindowStartIndex]);

  useEffect(() => {
    const sharedItems = route.params.sharedItems ?? takePendingShareDraft(route.params.conversationId);

    if (!sharedItems || sharedItems.length === 0) {
      processedSharedItemsKeyRef.current = null;
      return;
    }

    const sharedItemsKey = JSON.stringify(sharedItems.map((item) => ({
      kind: item.kind,
      text: item.text,
      uri: item.uri,
    })));

    if (processedSharedItemsKeyRef.current === sharedItemsKey) {
      return;
    }

    processedSharedItemsKeyRef.current = sharedItemsKey;

    void (async () => {
      const sharedTextItems = sharedItems.filter((item) => item.kind === 'text' && item.text?.trim());
      const sharedFileItems = sharedItems.filter((item) => item.kind === 'file' && item.uri);
      const combinedText = sharedTextItems.map((item) => item.text?.trim()).filter(Boolean).join('\n');

      if (sharedFileItems.length > 0) {
        try {
          const attachment = await getSharedPendingAttachment(sharedFileItems[0]);
          openCaptionComposer(attachment, combinedText);
        } catch (error) {
          Alert.alert(t('shareFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
        } finally {
          navigation.setParams({ sharedItems: undefined });
        }
        return;
      }

      if (combinedText) {
        updateDraft(combinedText);
        setDraftSelection({ end: combinedText.length, start: combinedText.length });
      }

      navigation.setParams({ sharedItems: undefined });
    })();
  }, [navigation, route.params.conversationId, route.params.sharedItems, updateDraft]);

  useEffect(() => {
    if (messages.length === 0 || hasInitialScrollRef.current || isInitialScrollScheduledRef.current) {
      return;
    }

    if (hasTailActivityDuringOpenRef.current) {
      promoteTailReady('messages-length-after-tail-activity');
      return;
    }

    logChatLifecycleDiagnostic('messages-length-open-alignment', {
      length: messages.length,
    });
    scheduleOpenChatAlignment();
  }, [messages.length, scheduleOpenChatAlignment]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    if (!socket) {
      return;
    }

    const joinConversation = () => {
      socket.emit('conversation:join', route.params.conversationId);
    };

    if (socket.connected) {
      joinConversation();
    }
    socket.on('connect', joinConversation);

    return () => {
      socket.emit('conversation:leave', route.params.conversationId);
      socket.off('connect', joinConversation);
    };
  }, [route.params.conversationId]);

  useEffect(() => {
    void refreshPinnedMessages()
      .catch(() => undefined);
  }, [refreshPinnedMessages]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    if (!socket || !serverUrl) {
      return;
    }

    const handlePinnedMessage = (payload: { conversationId: string; message: Parameters<typeof mapMessage>[0]; pinnedAt: string; scope: 'all' | 'me' }) => {
      if (payload.conversationId !== route.params.conversationId) {
        return;
      }

      const pinnedMessage = {
        message: mapMessage(payload.message, serverUrl),
        pinnedAt: payload.pinnedAt,
        scope: payload.scope,
      };

      setPinnedMessages((current) => [pinnedMessage, ...current.filter((item) => item.message.id !== pinnedMessage.message.id)]);
    };

    const handleUnpinnedMessage = (payload: { conversationId: string; messageId: string; scope: 'all' | 'me' }) => {
      if (payload.conversationId !== route.params.conversationId) {
        return;
      }

      void refreshPinnedMessages().catch(() => {
        setPinnedMessages((current) => current.filter((item) => item.message.id !== payload.messageId || item.scope !== payload.scope));
      });
    };

    socket.on('message:pinned', handlePinnedMessage);
    socket.on('message:unpinned', handleUnpinnedMessage);

    return () => {
      socket.off('message:pinned', handlePinnedMessage);
      socket.off('message:unpinned', handleUnpinnedMessage);
    };
  }, [refreshPinnedMessages, route.params.conversationId, serverUrl]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    if (!socket) {
      return;
    }

    const handleDeletedMessage = (payload: { conversationId: string; messageId?: string; messageKey?: string }) => {
      if (payload.conversationId !== route.params.conversationId) {
        return;
      }

      setPinnedMessages((current) => current.filter((item) => (
        !shouldRemovePinnedMessageForDeletion(
          item.message,
          payload.messageId ? [payload.messageId] : [],
          payload.messageKey ? [payload.messageKey] : [],
        )
      )));
    };

    socket.on('message:deleted', handleDeletedMessage);

    return () => {
      socket.off('message:deleted', handleDeletedMessage);
    };
  }, [route.params.conversationId]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    const otherUserId = otherUser?.id;

    if (!socket || route.params.isGroup === true || !otherUserId) {
      setOtherUserTyping(false);
      return;
    }

    const clearTypingSoon = () => {
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
      }

      typingStopTimeoutRef.current = setTimeout(() => {
        typingStopTimeoutRef.current = null;
        setOtherUserTyping(false);
      }, 3500);
    };

    const handleTypingStart = (payload: { conversationId: string; userId: string }) => {
      if (payload.conversationId !== route.params.conversationId || payload.userId !== otherUserId) {
        return;
      }

      setOtherUserTyping(true);
      clearTypingSoon();
    };

    const handleTypingStop = (payload: { conversationId: string; userId: string }) => {
      if (payload.conversationId !== route.params.conversationId || payload.userId !== otherUserId) {
        return;
      }

      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      setOtherUserTyping(false);
    };

    socket.on('typing:start', handleTypingStart);
    socket.on('typing:stop', handleTypingStop);

    return () => {
      socket.off('typing:start', handleTypingStart);
      socket.off('typing:stop', handleTypingStop);
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      setOtherUserTyping(false);
    };
  }, [otherUser?.id, route.params.conversationId, route.params.isGroup]);

  useEffect(() => {
    const socket = getRealtimeSocket();

    if (!socket || route.params.isGroup === true) {
      return;
    }

    const shouldEmitTyping = canSendMessages && draft.trim().length > 0 && !voiceRecordingState.isRecording;

    if (shouldEmitTyping) {
      if (!hasSentTypingStartRef.current) {
        socket.emit('typing:start', { conversationId: route.params.conversationId });
        hasSentTypingStartRef.current = true;
      }

      if (typingIdleTimeoutRef.current) {
        clearTimeout(typingIdleTimeoutRef.current);
      }

      typingIdleTimeoutRef.current = setTimeout(() => {
        socket.emit('typing:stop', { conversationId: route.params.conversationId });
        hasSentTypingStartRef.current = false;
        typingIdleTimeoutRef.current = null;
      }, 1400);
      return;
    }

    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }

    if (hasSentTypingStartRef.current) {
      socket.emit('typing:stop', { conversationId: route.params.conversationId });
      hasSentTypingStartRef.current = false;
    }
  }, [canSendMessages, draft, route.params.conversationId, route.params.isGroup, voiceRecordingState.isRecording]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }

      if (isGroupInvitePending) {
        return;
      }

      loadMessages(route.params.conversationId, { hydrate: false }).catch(() => undefined);
      void applyPeerScreenshotProtection(() => true);
    });

    return () => subscription.remove();
  }, [applyPeerScreenshotProtection, isGroupInvitePending, loadMessages, route.params.conversationId]);

  useEffect(() => {
    const targetMessageId = route.params.targetMessageId;

    if (
      route.params.openReason !== 'notification' ||
      !targetMessageId ||
      isGroupInvitePending
    ) {
      return;
    }

    const recoveryKey = `${route.params.conversationId}:${targetMessageId}`;
    const hasTargetMessage = (useAppStore.getState().messagesByConversation[route.params.conversationId] ?? [])
      .some((message) => message.id === targetMessageId);
    const currentMessages = useAppStore.getState().messagesByConversation[route.params.conversationId] ?? [];

    logChatLifecycleDiagnostic('notification-message-check', {
      hasTargetMessage,
      targetMessageId,
    });
    logMessageDeliveryDiagnostic('chat-notification-target-check', {
      conversationId: route.params.conversationId,
      currentCount: currentMessages.length,
      hasTargetMessage,
      messageIds: currentMessages.slice(-10).map((message) => message.id),
      targetMessageId,
    });

    if (hasTargetMessage || notificationRecoveryKeyRef.current === recoveryKey) {
      logMessageDeliveryDiagnostic('chat-notification-recovery-skipped', {
        conversationId: route.params.conversationId,
        hasTargetMessage,
        isDuplicateRecovery: notificationRecoveryKeyRef.current === recoveryKey,
        targetMessageId,
      });
      return;
    }

    notificationRecoveryKeyRef.current = recoveryKey;
    logChatLifecycleDiagnostic('notification-recovery-sync-start', { targetMessageId });
    logMessageDeliveryDiagnostic('chat-notification-recovery-start', {
      conversationId: route.params.conversationId,
      targetMessageId,
    });

    loadMessages(route.params.conversationId, { hydrate: false })
      .then(() => {
        const recoveredMessages = useAppStore.getState().messagesByConversation[route.params.conversationId] ?? [];
        const didRecoverTarget = recoveredMessages
          .some((message) => message.id === targetMessageId);

        logChatLifecycleDiagnostic('notification-recovery-sync-finished', {
          didRecoverTarget,
          targetMessageId,
        });
        logMessageDeliveryDiagnostic('chat-notification-recovery-finished', {
          conversationId: route.params.conversationId,
          didRecoverTarget,
          messageIds: recoveredMessages.slice(-10).map((message) => message.id),
          recoveredCount: recoveredMessages.length,
          targetMessageId,
        });
      })
      .catch((error) => {
        logChatLifecycleDiagnostic('notification-recovery-sync-failed', {
          message: error instanceof Error ? error.message : String(error),
          targetMessageId,
        });
        logMessageDeliveryDiagnostic('chat-notification-recovery-failed', {
          conversationId: route.params.conversationId,
          message: error instanceof Error ? error.message : String(error),
          targetMessageId,
        });
      });
  }, [
    isGroupInvitePending,
    loadMessages,
    route.params.conversationId,
    route.params.openReason,
    route.params.targetMessageId,
  ]);

  useFocusEffect(
    useCallback(() => {
      void dismissMessageNotificationsForConversation(route.params.conversationId);

      if (!isGroupInvitePending) {
        void markConversationReadNow(route.params.conversationId);
      }

      return undefined;
    }, [isGroupInvitePending, markConversationReadNow, route.params.conversationId]),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void applyPeerScreenshotProtection(() => active);

      return () => {
        active = false;
        clearScreenCaptureProtectionRequirement(`chat:${route.params.conversationId}`);
      };
    }, [applyPeerScreenshotProtection]),
  );

  useEffect(() => {
    if (!isScreenFocused || isGroupInvitePending || !incomingMessageReadKey) {
      return;
    }

    void markConversationReadNow(route.params.conversationId);
  }, [incomingMessageReadKey, isGroupInvitePending, isScreenFocused, markConversationReadNow, route.params.conversationId]);

  useEffect(() => () => {
    clearVoicePlayback();
    clearInitialScrollTimeouts();
    clearBottomAnchorTimeout();
    clearPendingMessageJump();
    clearTailScrollTimeouts();
    pendingHistoryAnchorRef.current = null;
    isControlledHistoryPrependRef.current = false;
    if (typingIdleTimeoutRef.current) {
      clearTimeout(typingIdleTimeoutRef.current);
      typingIdleTimeoutRef.current = null;
    }
    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
    const socket = getRealtimeSocket();
    if (socket && hasSentTypingStartRef.current) {
      socket.emit('typing:stop', { conversationId: route.params.conversationId });
    }
    hasSentTypingStartRef.current = false;
  }, [clearBottomAnchorTimeout, clearInitialScrollTimeouts, clearPendingMessageJump, clearTailScrollTimeouts]);

  function addLocalMessage(message: Omit<Message, 'id' | 'conversationId' | 'createdAt' | 'senderId' | 'status'>) {
    if (!user) {
      return null;
    }

    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    addOptimisticMessage({
      ...message,
      id,
      conversationId: route.params.conversationId,
      createdAt: 'Now',
      createdAtIso: new Date().toISOString(),
      metadata: {
        ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
        clientId: id,
        deleteKey: createMessageDeleteKey(),
      },
      senderId: user.id,
      status: 'sending',
    });
    logChatScrollDiagnostic('local-message-added', {
      kind: message.kind,
      localId: id,
    });
    logChatLifecycleDiagnostic('local-message-added', {
      kind: message.kind,
      localId: id,
    });
    if (!hasInitialScrollRef.current || isInitialScrollScheduledRef.current || pendingInitialAlignmentRef.current) {
      promoteTailReady('local-message-before-initial-ready');
    }
    forceTailVisibility();
    instantNextScrollRef.current = true;
    scheduleTailScroll({ reason: 'local-message-added', settle: true });

    return id;
  }

  const sendingRef = useRef(false);

  async function handleSendTextMessage() {
    if (sendingRef.current) {
      return;
    }

    sendingRef.current = true;
    setSendingText(true);
    await waitForComposerNativeTextFlush();
    const body = draftRef.current;

    if (!body.trim()) {
      sendingRef.current = false;
      setSendingText(false);
      return;
    }

    updateDraft('');
    setDraftSelection({ end: 0, start: 0 });
    setEmojiPickerVisible(false);
    const replyMetadata = replyingToMessage ? { replyTo: getReplyPreview(replyingToMessage, user?.id) } : undefined;
    setReplyingToMessage(null);
    const localId = addLocalMessage({
      body,
      kind: 'text',
      metadata: replyMetadata,
    });

    try {
      await sendTextMessage(route.params.conversationId, body, localId ?? undefined, replyMetadata);
    } catch (error) {
      updateDraft(body);
      setReplyingToMessage(replyingToMessage);
      if (localId) {
        removeLocalMessage(localId);
      }
      Alert.alert(t('messageFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    } finally {
      forceTailVisibility(1400);
      scheduleTailScroll({ reason: 'send-text-finally', settle: true });
      sendingRef.current = false;
      setSendingText(false);
    }
  }

  function openSendOptionsMenu() {
    if (isSendingText || !draftRef.current.trim()) {
      return;
    }

    setSendOptionsTarget('composer');
    prepareDefaultSendOptions();
    setSendOptionsMode('menu');
  }

  function openCaptionSendOptionsMenu() {
    if (!pendingCaptionAttachment) {
      return;
    }

    suppressNextCaptionSendPressRef.current = true;
    setSendOptionsTarget('caption');
    prepareDefaultSendOptions();
    setSendOptionsMode('menu');
  }

  function closeSendOptionsMenu() {
    suppressNextCaptionSendPressRef.current = false;
    setSendOptionsMode(null);
  }

  function prepareDefaultSendOptions() {
    const defaultSendAt = new Date(Date.now() + HOUR_MS);

    setScheduleDateDraft(formatDateInput(defaultSendAt));
    setScheduleHourDraft(String(defaultSendAt.getHours()).padStart(2, '0'));
    setScheduleMinuteDraft(String(defaultSendAt.getMinutes()).padStart(2, '0'));
    setScheduleSecondDraft(String(defaultSendAt.getSeconds()).padStart(2, '0'));
    setDisappearSecondsDraft('30');
  }

  async function sendScheduledTextMessage() {
    if (sendOptionsTarget === 'caption') {
      await sendScheduledCaptionAttachment();
      return;
    }

    if (sendingRef.current) {
      return;
    }

    const body = draftRef.current;
    const sendAt = parseScheduledSendAt(scheduleDateDraft, scheduleHourDraft, scheduleMinuteDraft, scheduleSecondDraft);

    if (!body.trim() || !sendAt) {
      Alert.alert(t('scheduledMessage'), t('scheduledMessageInvalidDate'));
      return;
    }

    if (sendAt.getTime() <= Date.now() + 5000) {
      Alert.alert(t('scheduledMessage'), t('scheduledMessageFutureRequired'));
      return;
    }

    sendingRef.current = true;
    setSendingText(true);
    setSendOptionsMode(null);
    suppressNextCaptionSendPressRef.current = false;
    updateDraft('');
    setDraftSelection({ end: 0, start: 0 });
    setEmojiPickerVisible(false);
    const replyMetadata = replyingToMessage ? { replyTo: getReplyPreview(replyingToMessage, user?.id) } : undefined;
    setReplyingToMessage(null);

    try {
      await scheduleTextMessage(route.params.conversationId, body, sendAt.toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone, replyMetadata);
    } catch (error) {
      updateDraft(body);
      setReplyingToMessage(replyingToMessage);
      Alert.alert(t('scheduledMessageFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      forceTailVisibility(1400);
      scheduleTailScroll({ reason: 'schedule-text-finally', settle: true });
      sendingRef.current = false;
      setSendingText(false);
    }
  }

  async function sendDisappearingTextMessage() {
    if (sendOptionsTarget === 'caption') {
      await sendDisappearingCaptionAttachment();
      return;
    }

    const seconds = Number(disappearSecondsDraft.trim());

    if (!Number.isInteger(seconds) || seconds < 1) {
      Alert.alert(t('disappearingMessage'), t('disappearingMessageInvalidSeconds'));
      return;
    }

    setSendOptionsMode(null);
    suppressNextCaptionSendPressRef.current = false;
    const metadata = {
      disappearingAfterView: {
        seconds,
      },
    };
    await handleSendTextMessageWithMetadata(metadata);
  }

  async function handleSendTextMessageWithMetadata(extraMetadata: Message['metadata']) {
    if (sendingRef.current) {
      return;
    }

    sendingRef.current = true;
    setSendingText(true);
    await waitForComposerNativeTextFlush();
    const body = draftRef.current;

    if (!body.trim()) {
      sendingRef.current = false;
      setSendingText(false);
      return;
    }

    updateDraft('');
    setDraftSelection({ end: 0, start: 0 });
    setEmojiPickerVisible(false);
    const replyMetadata = replyingToMessage ? { replyTo: getReplyPreview(replyingToMessage, user?.id) } : undefined;
    const metadata = {
      ...(replyMetadata ?? {}),
      ...(extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {}),
    };
    setReplyingToMessage(null);
    const localId = addLocalMessage({
      body,
      kind: 'text',
      metadata,
    });

    try {
      await sendTextMessage(route.params.conversationId, body, localId ?? undefined, metadata);
    } catch (error) {
      updateDraft(body);
      setReplyingToMessage(replyingToMessage);
      if (localId) {
        removeLocalMessage(localId);
      }
      Alert.alert(t('messageFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    } finally {
      sendingRef.current = false;
      setSendingText(false);
    }
  }

  function toggleEmojiPicker() {
    if (!canSendMessages || voiceRecordingState.isRecording) {
      return;
    }

    setEmojiPickerVisible((current) => {
      const next = !current;

      if (next) {
        Keyboard.dismiss();
        scrollTailToEnd();
      }

      return next;
    });
  }

  const handleVoiceRecorderStateChange = useCallback((state: VoiceRecordingComposerState) => {
    if (state.isRecording) {
      setEmojiPickerVisible(false);
    }

    setVoiceRecordingState((current) => (
      current.durationMillis === state.durationMillis &&
      current.isLocked === state.isLocked &&
      current.isPaused === state.isPaused &&
      current.isRecording === state.isRecording
        ? current
        : state
    ));
  }, []);

  function clearComposerLongPressTimer() {
    if (composerLongPressTimerRef.current) {
      clearTimeout(composerLongPressTimerRef.current);
      composerLongPressTimerRef.current = null;
    }
  }

  function scheduleComposerEditMenu() {
    clearComposerLongPressTimer();
    composerLongPressTimerRef.current = setTimeout(() => {
      composerLongPressTimerRef.current = null;
      setComposerEditMenuVisible(true);
    }, 450);
  }

  function replaceDraftSelection(replacement: string) {
    const start = Math.max(0, Math.min(draftSelection.start, draft.length));
    const end = Math.max(start, Math.min(draftSelection.end, draft.length));
    const nextDraft = `${draft.slice(0, start)}${replacement}${draft.slice(end)}`;
    const nextPosition = start + replacement.length;

    updateDraft(nextDraft);
    setDraftSelection({ end: nextPosition, start: nextPosition });
  }

  async function pasteIntoComposer() {
    setComposerEditMenuVisible(false);
    replaceDraftSelection(await Clipboard.getStringAsync());
  }

  async function copyComposerSelection() {
    const selectedText = draft.slice(draftSelection.start, draftSelection.end);

    setComposerEditMenuVisible(false);
    if (selectedText) {
      await Clipboard.setStringAsync(selectedText);
    }
  }

  async function cutComposerSelection() {
    const selectedText = draft.slice(draftSelection.start, draftSelection.end);

    setComposerEditMenuVisible(false);
    if (selectedText) {
      await Clipboard.setStringAsync(selectedText);
      replaceDraftSelection('');
    }
  }

  function insertEmoji(emoji: string) {
    const start = Math.max(0, Math.min(draftSelection.start, draft.length));
    const end = Math.max(start, Math.min(draftSelection.end, draft.length));
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    const nextPosition = start + emoji.length;
    const nextRecentEmojis = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 36);

    updateDraft(nextDraft);
    setDraftSelection({ end: nextPosition, start: nextPosition });
    setRecentEmojis(nextRecentEmojis);
    void setStoredRecentEmojis(nextRecentEmojis).catch(() => undefined);
  }

  async function pickFromGallery() {
    setAttachmentSheetVisible(false);

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded', {}, language), t('photoLibraryPermissionNeeded', {}, language));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images', 'videos'],
        quality: 0.82,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      if (result.assets.length === 1) {
        openCaptionComposer(getImagePickerAttachment(result.assets[0]));
        return;
      }

      try {
        await assertAttachmentsWithinPolicy(serverUrl ?? '', result.assets.map((asset) => asset.fileSize));
      } catch (error) {
        showAttachmentPolicyError(error);
        return;
      }

      for (const asset of result.assets) {
        await sendAttachment(getImagePickerAttachment(asset));
      }
    } finally {
      endLockDeferral();
    }
  }

  function getImagePickerAttachment(asset: ImagePicker.ImagePickerAsset): PendingCaptionAttachment {
    const kind: MessageKind = asset.type === 'video' ? 'video' : 'image';

    return {
      durationSeconds: asset.duration ? asset.duration / 1000 : undefined,
      fileName: asset.fileName ?? (kind === 'video' ? 'video.mp4' : 'photo.jpg'),
      kind,
      sizeBytes: asset.fileSize,
      mimeType: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      uri: asset.uri,
    };
  }

  async function openCamera() {
    setAttachmentSheetVisible(false);

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded', {}, language), t('cameraPermissionNeeded', {}, language));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.82,
        videoMaxDuration: 60,
      });

      if (result.canceled || !result.assets[0]) {
        return;
      }

      openCaptionComposer(getImagePickerAttachment(result.assets[0]));
    } finally {
      endLockDeferral();
    }
  }

  async function pickFile() {
    setAttachmentSheetVisible(false);

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const attachments = await Promise.all(result.assets.map(getFileAttachment));

      try {
        await assertAttachmentsWithinPolicy(serverUrl ?? '', attachments.map((attachment) => attachment.sizeBytes));
      } catch (error) {
        showAttachmentPolicyError(error);
        return;
      }

      if (attachments.length === 1) {
        openCaptionComposer(attachments[0]);
        return;
      }

      for (const attachment of attachments) {
        await sendAttachment(attachment);
      }
    } finally {
      endLockDeferral();
    }
  }

  async function openContactSharePicker() {
    setAttachmentSheetVisible(false);
    setContactSharePickerVisible(true);
    await loadContacts().catch(() => undefined);
  }

  async function sendSharedContact(contact: AuthUser) {
    try {
      const payload = buildSharedContactMessage(contact);
      await sendTextMessage(route.params.conversationId, payload.message);
      setContactSharePickerVisible(false);
    } catch (error) {
      Alert.alert(t('sendContactFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function getFileAttachment(file: DocumentPicker.DocumentPickerAsset): Promise<PendingCaptionAttachment> {
    const sizeBytes = await getKnownFileSize(file.uri, file.size);

    return {
      body: file.name,
      fileName: file.name,
      kind: 'file',
      mimeType: getUsableMimeType(file.mimeType, file.name),
      sizeBytes,
      uri: file.uri,
    };
  }

  async function getSharedPendingAttachment(item: SharedIntentItem): Promise<PendingCaptionAttachment> {
    if (item.kind !== 'file' || !item.uri) {
      throw new Error(t('sharedAttachmentUnavailable', {}, language));
    }

    const fileName = item.fileName || getSharedItemFileName(item.uri);
    const mimeType = getUsableMimeType(item.mimeType, fileName);
    const kind = getSharedItemMessageKind(mimeType);
    const sizeBytes = await getKnownFileSize(item.uri, item.sizeBytes);

    return {
      body: kind === 'file' ? fileName : undefined,
      fileName,
      kind,
      mimeType,
      sizeBytes,
      uri: item.uri,
    };
  }

  function openCaptionComposer(attachment: PendingCaptionAttachment, initialCaption = '') {
    clearPendingDrawingOpenTimer();
    if (pendingCaptionOpenTimeoutRef.current) {
      clearTimeout(pendingCaptionOpenTimeoutRef.current);
      pendingCaptionOpenTimeoutRef.current = null;
    }
    Keyboard.dismiss();
    setAttachmentSheetVisible(false);
    setEmojiPickerVisible(false);
    setCaptionSuspendedForDrawing(false);
    setDrawingAttachment(null);
    setCaptionDraft(initialCaption);
    pendingCaptionOpenTimeoutRef.current = setTimeout(() => {
      pendingCaptionOpenTimeoutRef.current = null;
      setPendingCaptionAttachment(attachment);
    }, 180);
  }

  function clearPendingDrawingOpenTimer() {
    if (drawingOpenTimerRef.current) {
      clearTimeout(drawingOpenTimerRef.current);
      drawingOpenTimerRef.current = null;
    }
  }

  function closeCaptionComposer() {
    clearPendingDrawingOpenTimer();
    if (pendingCaptionOpenTimeoutRef.current) {
      clearTimeout(pendingCaptionOpenTimeoutRef.current);
      pendingCaptionOpenTimeoutRef.current = null;
    }
    setCaptionSuspendedForDrawing(false);
    setDrawingAttachment(null);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');
  }

  function openImageDrawingComposer(attachment: PendingCaptionAttachment) {
    if (attachment.kind !== 'image') {
      return;
    }

    clearPendingDrawingOpenTimer();
    Keyboard.dismiss();

    if (Platform.OS === 'ios') {
      setCaptionSuspendedForDrawing(true);
      drawingOpenTimerRef.current = setTimeout(() => {
        drawingOpenTimerRef.current = null;
        setDrawingAttachment(attachment);
      }, 320);
      return;
    }

    setDrawingAttachment(attachment);
  }

  function closeImageDrawingComposer() {
    clearPendingDrawingOpenTimer();
    setDrawingAttachment(null);
    setCaptionSuspendedForDrawing(false);
  }

  async function sendAttachment(attachment: PendingCaptionAttachment, caption?: string, metadata?: Message['metadata']) {
    let uploadAttachment: PendingCaptionAttachment;

    try {
      uploadAttachment = await prepareOutgoingAttachment(attachment);
      await assertAttachmentsWithinPolicy(serverUrl ?? '', [uploadAttachment.sizeBytes]);
    } catch (error) {
      if (!showAttachmentPolicyError(error)) {
        Alert.alert(t('attachmentFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
      }
      return;
    }

    const trimmedCaption = caption?.trim();
    const body = trimmedCaption || uploadAttachment.body || '';
    const localId = addLocalMessage({
      body,
      durationSeconds: uploadAttachment.durationSeconds,
      fileName: uploadAttachment.fileName,
      kind: uploadAttachment.kind,
      mediaUri: uploadAttachment.uri,
      metadata,
      mimeType: uploadAttachment.mimeType,
      sizeBytes: uploadAttachment.sizeBytes,
    });

    await sendPickedMedia({
      body,
      durationSeconds: uploadAttachment.durationSeconds,
      fileName: uploadAttachment.fileName,
      kind: uploadAttachment.kind,
      metadata,
      mimeType: uploadAttachment.mimeType,
      sizeBytes: uploadAttachment.sizeBytes,
      localId,
      uri: uploadAttachment.uri,
    });
  }

  function showAttachmentPolicyError(error: unknown) {
    if (!(error instanceof AttachmentPolicyError)) {
      return false;
    }

    Alert.alert(
      t('attachmentTooLargeTitle'),
      t(error.type === 'batch' ? 'attachmentBatchTooLarge' : 'attachmentTooLarge', {
        size: formatBytes(error.maximumBytes),
      }),
    );
    return true;
  }

  async function sendPendingCaptionAttachment() {
    if (suppressNextCaptionSendPressRef.current) {
      suppressNextCaptionSendPressRef.current = false;
      return;
    }

    if (!pendingCaptionAttachment) {
      return;
    }

    const attachment = pendingCaptionAttachment;
    const caption = captionDraft;

    setPendingCaptionAttachment(null);
    setCaptionDraft('');

    await sendAttachment(attachment, caption);
  }

  async function sendScheduledCaptionAttachment() {
    if (!pendingCaptionAttachment) {
      return;
    }

    const sendAt = parseScheduledSendAt(scheduleDateDraft, scheduleHourDraft, scheduleMinuteDraft, scheduleSecondDraft);

    if (!sendAt) {
      Alert.alert(t('scheduledMessage'), t('scheduledMessageInvalidDate'));
      return;
    }

    if (sendAt.getTime() <= Date.now() + 5000) {
      Alert.alert(t('scheduledMessage'), t('scheduledMessageFutureRequired'));
      return;
    }

    const attachment = pendingCaptionAttachment;
    const caption = captionDraft;
    setSendOptionsMode(null);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');

    try {
      const uploadAttachment = await prepareOutgoingAttachment(attachment);
      await assertAttachmentsWithinPolicy(serverUrl ?? '', [uploadAttachment.sizeBytes]);
      const trimmedCaption = caption.trim();
      const body = trimmedCaption || uploadAttachment.body || '';
      await scheduleMediaMessage({
        body,
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        conversationId: route.params.conversationId,
        durationSeconds: uploadAttachment.durationSeconds,
        fileName: uploadAttachment.fileName,
        kind: uploadAttachment.kind,
        mimeType: uploadAttachment.mimeType,
        sendAt: sendAt.toISOString(),
        sizeBytes: uploadAttachment.sizeBytes ?? 1,
        uri: uploadAttachment.uri,
      });
    } catch (error) {
      setPendingCaptionAttachment(attachment);
      setCaptionDraft(caption);
      if (!showAttachmentPolicyError(error)) {
        Alert.alert(t('scheduledMessageFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      }
    }
  }

  async function sendDisappearingCaptionAttachment() {
    if (!pendingCaptionAttachment) {
      return;
    }

    const seconds = Number(disappearSecondsDraft.trim());

    if (!Number.isInteger(seconds) || seconds < 1) {
      Alert.alert(t('disappearingMessage'), t('disappearingMessageInvalidSeconds'));
      return;
    }

    const attachment = pendingCaptionAttachment;
    const caption = captionDraft;
    setSendOptionsMode(null);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');

    try {
      await sendAttachment(attachment, caption, {
        disappearingAfterView: {
          seconds,
        },
      });
    } catch (error) {
      setPendingCaptionAttachment(attachment);
      setCaptionDraft(caption);
      Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function sendDrawnAttachment(strokes: ImageDrawingStroke[]) {
    const attachment = drawingAttachment ?? pendingCaptionAttachment;

    if (!attachment || attachment.kind !== 'image') {
      return;
    }

    const caption = captionDraft;
    let uploadAttachment = attachment;

    if (strokes.length > 0) {
      const rendered = await renderNativeImageDrawing(attachment.uri, strokes, attachment.fileName);

      uploadAttachment = {
        ...attachment,
        fileName: rendered.fileName,
        kind: 'image',
        mimeType: rendered.mimeType,
        sizeBytes: rendered.sizeBytes,
        uri: rendered.uri,
      };
    }

    setDrawingAttachment(null);
    setCaptionSuspendedForDrawing(false);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');

    await sendAttachment(uploadAttachment, caption);
  }

  async function sendCurrentLocation() {
    setAttachmentSheetVisible(false);

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('allowLocationToShare'));
        return;
      }

      let localId: string | null = null;

      try {
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const address = await getLocationAddress(position.coords);
        const metadata = {
          location: {
            address,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        };
        localId = addLocalMessage({
          body: t('location'),
          kind: 'text',
          metadata,
        });

        await sendTextMessage(route.params.conversationId, t('location'), localId ?? undefined, metadata);
      } catch (error) {
        if (localId) {
          removeLocalMessage(localId);
        }
        Alert.alert(t('locationFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      }
    } finally {
      endLockDeferral();
    }
  }

  function chooseLocationType() {
    setAttachmentSheetVisible(false);
    Alert.alert(t('shareLocation'), t('chooseLocationType'), [
      { text: t('currentLocation'), onPress: () => void sendCurrentLocation() },
      { text: t('liveLocation'), onPress: chooseLiveLocationDuration },
      { style: 'cancel', text: t('cancel') },
    ]);
  }

  function chooseLiveLocationDuration() {
    Alert.alert(t('liveLocation'), t('chooseLiveLocationDuration'), [
      { text: t('liveLocation15Minutes'), onPress: () => void startLiveLocation(15) },
      { text: t('liveLocation1Hour'), onPress: () => void startLiveLocation(60) },
      { text: t('liveLocation4Hours'), onPress: () => void startLiveLocation(240) },
      { text: t('liveLocation12Hours'), onPress: () => void startLiveLocation(720) },
      { style: 'cancel', text: t('cancel') },
    ]);
  }

  async function startLiveLocation(durationMinutes: 15 | 60 | 240 | 720) {
    if (!serverUrl) {
      Alert.alert(t('locationFailed'), t('pleaseTryAgain'));
      return;
    }

    if (isStartingLiveLocationRef.current) {
      Alert.alert(t('liveLocation'), t('liveLocationAlreadyActive'));
      return;
    }

    isStartingLiveLocationRef.current = true;
    let localId: string | null = null;
    let establishmentTimeout: ReturnType<typeof setTimeout> | null = null;
    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      if (await hasActiveLiveLocationShare()) {
        Alert.alert(t('liveLocation'), t('liveLocationAlreadyActive'));
        return;
      }

      if (!await requestLiveLocationPermissions()) {
        Alert.alert(t('permissionNeeded'), t('allowBackgroundLocationToShare'));
        return;
      }

      localId = addLocalMessage({
        body: t('liveLocation'),
        kind: 'text',
        metadata: {
          liveLocationEstablishment: {
            durationMinutes,
            startedAt: new Date().toISOString(),
            state: 'pending',
          },
        },
      });
      const establishmentMessageId = localId;
      establishmentTimeout = establishmentMessageId
        ? setTimeout(() => {
            updateLocalLiveLocationEstablishment(establishmentMessageId, 'failed');
          }, LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS)
        : null;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const address = await getLocationAddress(position.coords);
      const response = await createLiveLocation(serverUrl, {
        address,
        clientId: localId ?? undefined,
        conversationId: route.params.conversationId,
        durationMinutes,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      if (establishmentTimeout) {
        clearTimeout(establishmentTimeout);
      }
      addOptimisticMessage(response.message);
      await registerLiveLocationShare(response.liveLocation);
    } catch (error) {
      if (establishmentTimeout) {
        clearTimeout(establishmentTimeout);
      }
      if (localId) {
        updateLocalLiveLocationEstablishment(localId, 'failed');
      }
      Alert.alert(t('locationFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      isStartingLiveLocationRef.current = false;
      endLockDeferral();
    }
  }

  function updateLocalLiveLocationEstablishment(messageId: string, state: 'failed' | 'pending') {
    const message = useAppStore.getState().messagesByConversation[route.params.conversationId]?.find((item) => item.id === messageId);
    const metadata = message?.metadata;
    const establishment = metadata && typeof metadata === 'object' && 'liveLocationEstablishment' in metadata
      ? metadata.liveLocationEstablishment
      : null;

    if (!message || !establishment || typeof establishment !== 'object') {
      return;
    }

    addOptimisticMessage({
      ...message,
      metadata: {
        ...metadata,
        liveLocationEstablishment: {
          ...establishment,
          state,
        },
      },
    });
  }

  const markVoiceMessagePlayed = useCallback((message: Message) => {
    if (message.kind !== 'voice' || message.senderId === user?.id) {
      return;
    }

    setPlayedVoiceMessageIds((current) => {
      if (current.has(message.id)) {
        return current;
      }

      const next = new Set(current);
      next.add(message.id);
      void setStoredPlayedVoiceMessageIds(Array.from(next));

      return next;
    });
  }, [user?.id]);

  async function playVoiceMessage(message: Message) {
    if (!message.mediaUri) {
      return;
    }

    if (voicePlaybackRef.current?.messageId === message.id && playingVoiceId === message.id) {
      stopActiveVoicePlayback();
      return;
    }

    if (voicePlaybackRef.current?.messageId !== message.id || voicePlaybackRef.current.hasFinished) {
      stopActiveVoicePlayback();
      let player: ReturnType<typeof createAudioPlayer>;

      try {
        await restorePlaybackAudioMode();
        const playableUri = await getPlayableVoiceUri(message);
        player = createAudioPlayer({ uri: playableUri }, { downloadFirst: false });
      } catch (error) {
        Alert.alert(t('voicePlaybackFailed'), error instanceof Error ? error.message : t('voicePlaybackTryAgain'));
        return;
      }

      voicePlaybackRef.current = {
        hasFinished: false,
        messageId: message.id,
        player,
      };
      setVoiceProgressById((current) => ({ ...current, [message.id]: 0 }));
    }

    const playback = voicePlaybackRef.current;

    if (!playback) {
      return;
    }

    const player = playback.player;
    playerRef.current = player;
    markVoiceMessagePlayed(message);
    setPlayingVoiceId(message.id);

    try {
      await restorePlaybackAudioMode();
      player.play();
    } catch (error) {
      clearVoicePlayback();
      Alert.alert(t('voicePlaybackFailed'), error instanceof Error ? error.message : t('voicePlaybackTryAgain'));
      return;
    }

    if (playback.interval) {
      clearInterval(playback.interval);
    }

    playback.interval = setInterval(() => {
      if (playerRef.current !== player) {
        return;
      }

      const status = player.currentStatus;
      const duration = status.duration || message.durationSeconds || 0;
      const progress = duration ? status.currentTime / duration : 0;

      setVoiceProgressById((current) => ({ ...current, [message.id]: progress }));

      if (status.didJustFinish || (duration > 0 && status.currentTime >= duration - 0.05)) {
        if (playback.interval) {
          clearInterval(playback.interval);
          playback.interval = undefined;
        }
        playback.hasFinished = true;
        if (playerRef.current === player) {
          setPlayingVoiceId(null);
        }
        setVoiceProgressById((current) => ({ ...current, [message.id]: 0 }));
      }
    }, 250);
  }

  function stopActiveVoicePlayback() {
    const playback = voicePlaybackRef.current;

    if (!playback) {
      return;
    }

    try {
      playback.player.pause();
    } catch {
      // The player may already be released during quick taps.
    }

    setVoiceProgressById((current) => ({ ...current, [playback.messageId]: 0 }));
    clearVoicePlayback();
  }

  function clearVoicePlayback() {
    if (voicePlaybackRef.current?.interval) {
      clearInterval(voicePlaybackRef.current.interval);
    }

    voicePlaybackRef.current?.player.remove();
    voicePlaybackRef.current = null;
    playerRef.current = null;
    setPlayingVoiceId(null);
  }

  function openCallMessage(message: Message) {
    const metadata = message.metadata;
    const callId = metadata && typeof metadata === 'object' && 'callId' in metadata && typeof metadata.callId === 'string'
      ? metadata.callId
      : undefined;
    const callStatus = metadata && typeof metadata === 'object' && 'callStatus' in metadata && typeof metadata.callStatus === 'string'
      ? metadata.callStatus
      : undefined;
    const mode = metadata && typeof metadata === 'object' && 'mode' in metadata && metadata.mode === 'VIDEO'
      ? 'video'
      : metadata && typeof metadata === 'object' && 'mode' in metadata && metadata.mode === 'VOICE'
        ? 'voice'
        : message.body.toLowerCase().includes('video')
          ? 'video'
          : 'voice';
    const hasEnded = !!(metadata && typeof metadata === 'object' && 'endedAt' in metadata && metadata.endedAt) ||
      callStatus === 'CANCELLED' ||
      callStatus === 'DECLINED' ||
      callStatus === 'ENDED' ||
      callStatus === 'MISSED';

    if (!callId) {
      if (!route.params.isGroup) {
        void confirmStartCall(mode);
      }
      return;
    }

    if (hasEnded) {
      if (!route.params.isGroup) {
        void confirmStartCall(mode);
        return;
      }

      Alert.alert(t('callEnded'), t('callAlreadyEnded'));
      return;
    }

    if (message.senderId !== user?.id && callStatus === 'RINGING') {
      navigation.navigate('CallRoom', {
        answeredByNative: true,
        callId,
        conversationId: route.params.conversationId,
        direction: 'incoming',
        isGroupCall: route.params.isGroup,
        mode,
        participantNames: conversation?.members
          ?.map((member) => member.displayName || member.username)
          .filter(Boolean),
        title: route.params.title,
      });
      return;
    }

    navigation.navigate('CallRoom', {
      callId,
      conversationId: route.params.conversationId,
      direction: 'outgoing',
      isGroupCall: route.params.isGroup,
      mode,
      title: route.params.title,
    });
  }

  async function sendPickedMedia(input: {
    body?: string;
    durationSeconds?: number;
    fileName: string;
    kind: 'image' | 'video' | 'file';
    localId: string | null;
    metadata?: Message['metadata'];
    mimeType: string;
    sizeBytes?: number;
    uri: string;
  }) {
    try {
      const info = await FileSystem.getInfoAsync(input.uri);

      await sendMediaMessage({
        body: input.body,
        clientId: input.localId ?? undefined,
        conversationId: route.params.conversationId,
        durationSeconds: input.durationSeconds,
        fileName: input.fileName,
        kind: input.kind,
        metadata: input.metadata,
        mimeType: input.mimeType,
        sizeBytes: (info.exists && 'size' in info ? info.size : input.sizeBytes) ?? 1,
        uri: input.uri,
      });
    } catch (error) {
      if (input.localId) {
        removeLocalMessage(input.localId);
      }
      if (isUploadCanceledError(error)) {
        return;
      }
      Alert.alert(t('attachmentFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    }
  }

  async function handleVoiceRecorded(message: Omit<Message, 'id' | 'conversationId' | 'createdAt' | 'senderId' | 'status'>, shouldSendNow = false) {
    if (!message.mediaUri) {
      Alert.alert(t('recordingFailed', {}, language), t('noVoiceMessageFile', {}, language));
      return;
    }

    setVoiceEffectPickerVisible(false);
    if (shouldSendNow) {
      await sendVoiceMessageFromSource(message);
      return;
    }

    setPendingVoiceMessage(message);
  }

  async function cancelPendingVoiceMessage() {
    const voiceMessage = pendingVoiceMessage;

    setPendingVoiceMessage(null);
    setSelectedVoiceEffectId('normal');
    setVoiceEffectPickerVisible(false);

    if (voiceMessage?.mediaUri) {
      await FileSystem.deleteAsync(voiceMessage.mediaUri, { idempotent: true }).catch(() => undefined);
    }
  }

  async function sendPendingVoiceMessage() {
    if (!pendingVoiceMessage?.mediaUri) {
      return;
    }

    await sendVoiceMessageFromSource(pendingVoiceMessage);
  }

  async function sendVoiceMessageFromSource(sourceMessage: PendingVoiceMessage) {
    if (!sourceMessage.mediaUri) {
      return;
    }

    const sourceUri = sourceMessage.mediaUri as string;
    let uploadUri = sourceUri;

    setProcessingVoiceEffect(true);

    try {
      if (canUsePremiumFeatures && selectedVoiceEffectId !== 'normal') {
        uploadUri = await processNativeVoiceMessage(sourceUri, selectedVoiceEffectId);
      }

      const preparedMessage = {
        ...sourceMessage,
        mediaUri: uploadUri,
      };
      const localId = addLocalMessage(preparedMessage);

      try {
        const info = await waitForRecordedFile(uploadUri);
        const sizeBytes = info.exists && 'size' in info ? info.size : 1;

        if (sizeBytes <= 0) {
          throw new Error(t('noVoiceMessageAudioRecorded', {}, language));
        }

        setPendingVoiceMessage(null);
        setSelectedVoiceEffectId('normal');
        setVoiceEffectPickerVisible(false);

        await sendVoiceMessage({
          conversationId: route.params.conversationId,
          clientId: localId ?? undefined,
          durationSeconds: preparedMessage.durationSeconds ?? 1,
          fileName: preparedMessage.fileName ?? 'voice-message.m4a',
          mimeType: preparedMessage.mimeType ?? 'audio/mp4',
          sizeBytes,
          uri: uploadUri,
        });
      } catch (error) {
        if (localId) {
          removeLocalMessage(localId);
        }
        if (isUploadCanceledError(error)) {
          return;
        }
        Alert.alert(t('voiceMessageFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
      }
    } finally {
      setProcessingVoiceEffect(false);
    }
  }

  function handleMessageActions(message: Message) {
    if (isSystemChat) {
      return;
    }

    if (isSelectionMode) {
      toggleSelectedMessage(message.id);
      return;
    }

    if (isShareableMediaMessage(message)) {
      setMediaActionMessage(message);
      return;
    }

    setMessageActionMenu(message);
  }

  async function saveMessageMedia(message: Message) {
    setMediaActionMessage(null);

    try {
      const permissionGranted = await ensureSaveToPhonePermission(message);

      if (!permissionGranted) {
        Alert.alert(t('permissionNeeded'), t('saveToPhonePermission'));
        return;
      }

      const uri = await getShareableMediaUri(message);
      const saved = await saveNativeAndroidFile(uri, getMessageMimeType(message), getMessageFileName(message));

      if (!saved) {
        throw new Error(t('saveFailed', {}, language));
      }

      Alert.alert(t('saved', {}, language), t('savedAttachment', {}, language));
    } catch (error) {
      Alert.alert(t('saveFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    }
  }

  async function shareMessageMedia(message: Message) {
    setMediaActionMessage(null);

    try {
      const uri = await getShareableMediaUri(message);

      if (Platform.OS === 'ios') {
        await waitForIosModalDismissal();
        const shared = await shareNativeAndroidFile(uri, getMessageMimeType(message), getMessageFileName(message));

        if (!shared) {
          throw new Error(t('noAppShareAttachment', {}, language));
        }
        return;
      }

      const shared = await shareNativeAndroidFile(uri, getMessageMimeType(message), getMessageFileName(message));

      if (!shared) {
        throw new Error(t('noAppShareAttachment', {}, language));
      }
    } catch (error) {
      Alert.alert(t('shareFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    }
  }

  async function openChatGalleryFile(message: Message) {
    try {
      const uri = await getShareableMediaUri(message);

      if (Platform.OS === 'android') {
        const opened = await openNativeAndroidFile(uri, getMessageMimeType(message));

        if (!opened) {
          throw new Error(t('noAppOpenAttachment', {}, language));
        }

        return;
      }

      await Linking.openURL(uri);
    } catch (error) {
      Alert.alert(t('cannotOpenFile', {}, language), error instanceof Error ? error.message : t('noAppOpenAttachment', {}, language));
    }
  }

  async function copyMessageText(message: Message) {
    setMessageActionMenu(null);

    if (message.kind !== 'text' || !message.body.trim()) {
      return;
    }

    await Clipboard.setStringAsync(message.body);
  }

  function openEditMessage(message: Message) {
    if (message.senderId !== user?.id || message.kind !== 'text' || message.id.startsWith('local-')) {
      return;
    }

    setMessageActionMenu(null);
    setEditDraft(message.body);
    setEditingMessage(message);
  }

  async function saveEditedMessage() {
    const message = editingMessage;
    const nextBody = editDraft.trim();

    if (!message || isSavingEdit || nextBody.length === 0) {
      return;
    }

    if (nextBody === message.body.trim()) {
      setEditingMessage(null);
      setEditDraft('');
      return;
    }

    setSavingEdit(true);

    try {
      await editMessage(route.params.conversationId, message.id, nextBody);
      setEditingMessage(null);
      setEditDraft('');
    } catch (error) {
      Alert.alert(t('messageEditFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    } finally {
      setSavingEdit(false);
    }
  }

  function reportSelectedMessage(message: Message) {
    if (message.senderId === user?.id || message.id.startsWith('local-')) {
      return;
    }

    setMessageActionMenu(null);
    setMediaActionMessage(null);
    Alert.alert(
      t('reportMessageQuestion'),
      getReportContextNotice(),
      [
        {
          text: t('report'),
          style: 'destructive',
          onPress: () => {
            void submitMessageReport(message, false);
          },
        },
        {
          text: t('reportAndBlockUser'),
          style: 'destructive',
          onPress: () => {
            void submitMessageReport(message, true);
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  }

  async function submitMessageReport(message: Message, shouldBlockUser: boolean) {
    try {
      await reportTarget({
        conversationId: route.params.conversationId,
        reason: buildReportReason(headerTitle, archivedMessages),
        targetId: message.id,
        targetType: 'MESSAGE',
      });

      if (shouldBlockUser) {
        await blockUserById(message.senderId);
      }

      Alert.alert(t('reportSent'), shouldBlockUser ? t('reportSentAndBlocked') : t('supportWillReview'));
    } catch (error) {
      Alert.alert(t('reportFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function submitChatReport(targetId: string, isGroup: boolean, shouldBlock: boolean) {
    try {
      await reportTarget({
        conversationId: route.params.conversationId,
        reason: buildReportReason(headerTitle, archivedMessages),
        targetId,
        targetType: isGroup ? 'GROUP' : 'USER',
      });

      if (shouldBlock) {
        if (isGroup) {
          await deleteChat(route.params.conversationId);
          navigation.goBack();
        } else {
          await blockUserById(targetId);
        }
      }

      Alert.alert(t('reportSent'), shouldBlock ? t('reportSentAndBlocked') : t('supportWillReview'));
    } catch (error) {
      Alert.alert(t('reportFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function startSelectingMessage(message: Message) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);
    setSelectedMessageIds([message.id]);
  }

  function toggleSelectedMessage(messageId: string) {
    setSelectedMessageIds((current) => (
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId]
    ));
  }

  function replyToSelectedMessage(message: Message) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);
    setReplyingToMessage(message);
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ animated: true, offset: 0 });
    });
  }

  function forwardSelectedMenuMessage(message: Message) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);
    setForwardingMessages([message]);
  }

  async function reactToSelectedMessage(message: Message, emoji: string) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);

    if (message.id.startsWith('local-')) {
      return;
    }

    const metadata = message.metadata;
    const currentReaction = metadata &&
      typeof metadata === 'object' &&
      'reactions' in metadata &&
      metadata.reactions &&
      typeof metadata.reactions === 'object' &&
      user?.id
      ? (metadata.reactions as Record<string, string>)[user.id]
      : undefined;

    try {
      await reactToMessage(route.params.conversationId, message.id, currentReaction === emoji ? null : emoji);
    } catch (error) {
      Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function pinSelectedMenuMessage(message: Message) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);

    if (!serverUrl || message.id.startsWith('local-') || !canPinMessages) {
      return;
    }

    if (route.params.isGroup === true) {
      void pinMessageWithScope(message, 'all');
      return;
    }

    Alert.alert(
      t('pin'),
      getPinnedMessageTitle(message, uiLanguage),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('pinForMe'), onPress: () => void pinMessageWithScope(message, 'me') },
        { text: t('pinForAll'), onPress: () => void pinMessageWithScope(message, 'all') },
      ],
    );
  }

  async function pinMessageWithScope(message: Message, scope: 'all' | 'me') {
    if (!serverUrl) {
      return;
    }

    try {
      const pinnedMessage = await pinMessage(serverUrl, route.params.conversationId, message.id, scope);
      setPinnedMessages((current) => [pinnedMessage, ...current.filter((item) => item.message.id !== pinnedMessage.message.id)]);
    } catch {
      Alert.alert(t('actionFailed'), t('pleaseTryAgain'));
    }
  }

  function confirmRemovePinnedMessage(item: PinnedMessage) {
    Alert.alert(
      t('removePinnedMessage'),
      getPinnedMessageTitle(item.message, uiLanguage),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'),
          style: 'destructive',
          onPress: () => void removePinnedMessage(item),
        },
      ],
    );
  }

  async function removePinnedMessage(item: PinnedMessage) {
    if (!serverUrl) {
      return;
    }

    try {
      await unpinMessage(serverUrl, route.params.conversationId, item.message.id, item.scope);
      await refreshPinnedMessages();
    } catch {
      Alert.alert(t('actionFailed'), t('pleaseTryAgain'));
    }
  }

  function unpinSelectedMenuMessage(message: Message) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);
    const pinnedMessage = sortedPinnedMessages.find((item) => item.message.id === message.id);

    if (!pinnedMessage) {
      return;
    }

    void removePinnedMessage(pinnedMessage);
  }

  function deleteSelectedMenuMessage(message: Message) {
    setMessageActionMenu(null);
    setMediaActionMessage(null);
    showDeleteMessageOptions([message], false);
  }

  function showDeleteMessageOptions(targetMessages: Message[], shouldExitSelectionMode: boolean) {
    const count = targetMessages.length;

    if (count === 0) {
      return;
    }

    const deleteMessages = (mode: 'all' | 'me') => {
      markMessagesPendingDelete(targetMessages);
      if (shouldExitSelectionMode) {
        exitSelectionMode();
      }

      void Promise.all(targetMessages.map((message) => deleteMessage(route.params.conversationId, message.id, mode)))
        .catch((error) => {
          unmarkMessagesPendingDelete(targetMessages);
          void refreshPinnedMessages().catch(() => undefined);
          Alert.alert(t('deleteFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
        });
    };

    Alert.alert(
      t('deleteMessagesQuestion', {}, language),
      count === 1
        ? t('deleteSingleMessageDescription', {}, language)
        : t('deleteSelectedMessagesDescription', { count }, language),
      [
        {
          text: t('deleteForAnyone', {}, language),
          style: 'destructive',
          onPress: () => deleteMessages('all'),
        },
        { text: t('deleteForMe', {}, language), onPress: () => deleteMessages('me') },
        { text: t('cancel', {}, language), style: 'cancel' },
      ],
    );
  }

  async function forwardSelectedMessage(target: ForwardTarget) {
    if (forwardingMessages.length === 0) {
      return;
    }

    try {
      const conversationId = target.conversationId ?? (await startDirectConversation(target.user.id)).id;

      const results = await Promise.allSettled(forwardingMessages.map((message) => forwardMessage(conversationId, message)));
      const count = results.filter((result) => result.status === 'fulfilled').length;
      const failedCount = results.length - count;

      if (count === 0) {
        const firstFailure = results.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
        throw new Error(firstFailure?.reason instanceof Error ? firstFailure.reason.message : t('noMessagesForwarded', {}, language));
      }

      setForwardingMessages([]);
      exitSelectionMode();
      Alert.alert(
        t('forwarded', {}, language),
        t('forwardedToTarget', { count, failedCount, target: target.title }, language),
      );
    } catch (error) {
      Alert.alert(t('forwardFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    }
  }

  function openRepliedMessage(messageId: string) {
    const targetMessage = archivedMessages.find((message) => message.id === messageId);

    if (!targetMessage) {
      Alert.alert(t('messageNotFoundDeleted', {}, language));
      return;
    }

    void ensureMessageVisible(targetMessage.id, { animated: true, viewPosition: 0.45 });
  }

  function scrollToLatestMessage(animated = false) {
    anchorToBottom({ animated });
  }

  function scrollTailToEnd() {
    requestAnimationFrame(() => {
      if (lastScrollOffsetYRef.current <= 2 && lastDistanceFromBottomRef.current <= 2) {
        logChatScrollDiagnostic('scroll-tail-skip', { targetOffset: 0 });
        return;
      }

      lastScrollOffsetYRef.current = 0;
      lastDistanceFromBottomRef.current = 0;
      logChatScrollDiagnostic('scroll-tail-offset', { targetOffset: 0 });
      listRef.current?.scrollToOffset({
        animated: false,
        offset: 0,
      });
    });
  }

  function isTailForced() {
    return Date.now() < forceTailUntilRef.current;
  }

  function isMeasuredNearTail(threshold = 96) {
    return lastDistanceFromBottomRef.current <= threshold;
  }

  function forceTailVisibility(durationMs = 3000) {
    forceTailUntilRef.current = Math.max(forceTailUntilRef.current, Date.now() + durationMs);
    isNearBottomRef.current = true;
    setScrollToBottomVisible(false);
    logChatScrollDiagnostic('force-tail', { durationMs });

    clearInstantTailReleaseTimeout();
    pendingInstantTailReleaseTimeoutRef.current = setTimeout(() => {
      pendingInstantTailReleaseTimeoutRef.current = null;
      if (!isTailForced()) {
        instantNextScrollRef.current = false;
        logChatScrollDiagnostic('instant-tail-released');
      }
    }, durationMs + 120);
  }

  function scheduleTailScroll(options?: { reason?: string; settle?: boolean }) {
    logChatScrollDiagnostic('schedule-tail', {
      reason: options?.reason ?? 'unknown',
      settle: options?.settle === true,
    });
    clearTailScrollTimeouts();
    pendingTailScrollTimeoutRef.current = setTimeout(() => {
      pendingTailScrollTimeoutRef.current = null;
      scrollTailToEnd();
    }, 40);

    if (options?.settle) {
      [140, 360].forEach((delay) => {
        const timeout = setTimeout(() => {
          scrollTailToEnd();
          if (isTailForced()) {
            isNearBottomRef.current = true;
            setScrollToBottomVisible(false);
          }
        }, delay);
        pendingTailSettleTimeoutsRef.current.push(timeout);
      });
    }
  }

  const {
    isKeyboardVisibleRef,
    keyboardBaselineViewportHeightRef,
    keyboardLift,
    keyboardLiftRef,
  } = useChatKeyboardLift({
    bottomInset: insets.bottom,
    isCaptionComposerVisible,
    isNearBottomRef,
    isTailForced,
    listViewportHeightRef,
    logLifecycle: logChatLifecycleDiagnostic,
    logScroll: logChatScrollDiagnostic,
    scheduleTailScroll,
    topInset: insets.top,
    windowHeight: windowLayout.height,
  });

  useChatHydration({
    clearBottomAnchorTimeout,
    clearInitialScrollTimeouts,
    clearInstantTailReleaseTimeout,
    clearPendingMessageJump,
    clearTailScrollTimeouts,
    conversationId: route.params.conversationId,
    forceTailUntilRef,
    hasInitialScrollRef,
    hasTailActivityDuringOpenRef,
    instantNextScrollRef,
    isBottomAnchoringRef,
    isGroupInvitePending,
    isInitialScrollScheduledRef,
    isNearBottomRef,
    isTailOpenLockedRef,
    lastAutoTailMessageIdRef,
    lastContentHeightRef,
    lastDistanceFromBottomRef,
    lastScrollOffsetYRef,
    lastScrolledMessageCountRef,
    loadMessages,
    logLifecycle: logChatLifecycleDiagnostic,
    logScroll: logChatScrollDiagnostic,
    onServerSyncError: handleServerSyncError,
    openHistoryGuardUntilRef,
    pendingInitialAlignmentRef,
    prepareConversationMessages,
    resetVisibleWindow,
    serverSyncDelayMs: route.params.openReason === 'notification' ? 250 : 4500,
    scheduleOpenChatAlignment,
    setBottomAnchoringActive,
    setInitialScrollReady,
  });

  function moveSearch(direction: 1 | -1) {
    if (searchMatches.length === 0) {
      return;
    }

    setSearchIndex((current) => (current + direction + searchMatches.length) % searchMatches.length);
  }

  function handleContentSizeChange(_width: number, height: number) {
    const previousHeight = lastContentHeightRef.current;
    const hasHeightChanged = Math.abs(height - lastContentHeightRef.current) > 1;
    lastContentHeightRef.current = height;

    if (hasHeightChanged || !hasInitialScrollRef.current) {
      logChatScrollDiagnostic('content-size', {
        height: Math.round(height),
        previousHeight: Math.round(previousHeight),
        hasHeightChanged,
        lastScrolledMessageCount: lastScrolledMessageCountRef.current,
      });
    }

    const pendingHistoryAnchor = pendingHistoryAnchorRef.current;

    if (pendingHistoryAnchor && hasHeightChanged) {
      const nextOffset = Math.max(0, pendingHistoryAnchor.previousOffsetY);

      pendingHistoryAnchorRef.current = null;
      lastScrollOffsetYRef.current = nextOffset;
      lastDistanceFromBottomRef.current = nextOffset;
      logChatScrollDiagnostic('history-anchor-preserve-applied', {
        heightDelta: Math.round(Math.max(0, height - pendingHistoryAnchor.previousContentHeight)),
        nextOffset: Math.round(nextOffset),
        previousOffsetY: Math.round(pendingHistoryAnchor.previousOffsetY),
      });
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({
          animated: false,
          offset: nextOffset,
        });
        isControlledHistoryPrependRef.current = false;
        isHistoryExpansionPendingRef.current = false;
        logChatLifecycleDiagnostic('history-controlled-prepend-finished');
      });
      return;
    }

    if (!hasInitialScrollRef.current) {
      if (messages.length > 0) {
        if (hasTailActivityDuringOpenRef.current) {
          promoteTailReady('content-size-after-tail-activity');
        } else {
          scheduleOpenChatAlignment();
        }
      }
      return;
    }

    if (isBottomAnchoringRef.current) {
      if (hasHeightChanged) {
        logChatScrollDiagnostic('content-size-bottom-anchor-scroll');
        scrollTailToEnd();
      }
      scheduleBottomAnchorSettle();
      return;
    }

    if (messages.length > lastScrolledMessageCountRef.current) {
      lastScrolledMessageCountRef.current = messages.length;
      const tailMessageId = messages[messages.length - 1]?.id ?? null;
      const didTailChange = !!tailMessageId && tailMessageId !== lastAutoTailMessageIdRef.current;
      const shouldAutoScroll = isMeasuredNearTail(140) || instantNextScrollRef.current || isTailForced();

      if (shouldAutoScroll && (didTailChange || instantNextScrollRef.current || isTailForced())) {
        lastAutoTailMessageIdRef.current = tailMessageId;
        scheduleTailScroll({
          reason: 'content-size-new-message',
          settle: instantNextScrollRef.current || isTailForced(),
        });
      }
      if (!isTailForced()) {
        instantNextScrollRef.current = false;
      }
      return;
    }

    const isKeyboardLayoutTransitionActive = Platform.OS === 'android'
      ? keyboardLiftRef.current > 0 || isKeyboardVisibleRef.current
      : isKeyboardVisibleRef.current;

    if (hasHeightChanged && !isKeyboardLayoutTransitionActive && (isNearBottomRef.current || isTailForced())) {
      scheduleTailScroll({ reason: 'content-size-height-change', settle: isTailForced() });
    }
  }

  function handleMessageListLayout(event: LayoutChangeEvent) {
    const previousViewportHeight = listViewportHeightRef.current;
    listViewportHeightRef.current = event.nativeEvent.layout.height;
    const didViewportChange = Math.abs(previousViewportHeight - event.nativeEvent.layout.height) > 2;

    if (Platform.OS === 'android' && !isKeyboardVisibleRef.current && event.nativeEvent.layout.height > 0) {
      keyboardBaselineViewportHeightRef.current = Math.max(
        keyboardBaselineViewportHeightRef.current,
        event.nativeEvent.layout.height,
      );
    }

    if (didViewportChange) {
      logChatScrollDiagnostic('list-layout', {
        previousViewportHeight: Math.round(previousViewportHeight),
        viewportHeight: Math.round(event.nativeEvent.layout.height),
      });
    }

    if (messages.length === 0) {
      return;
    }

    if (hasInitialScrollRef.current) {
      const isKeyboardLayoutTransitionActive = Platform.OS === 'ios' && isKeyboardVisibleRef.current;

      if (didViewportChange && !isKeyboardLayoutTransitionActive && (isMeasuredNearTail(140) || isTailForced())) {
        scheduleTailScroll({ reason: 'layout-viewport-change', settle: isTailForced() });
      }

      return;
    }

    if (!isInitialScrollScheduledRef.current) {
      if (hasTailActivityDuringOpenRef.current) {
        promoteTailReady('layout-after-tail-activity');
      } else {
        scheduleOpenChatAlignment();
      }
      return;
    }

    scrollTailToEnd();
  }

  function beginUserHistoryScroll() {
    if (userScrollHistoryResetTimeoutRef.current) {
      clearTimeout(userScrollHistoryResetTimeoutRef.current);
      userScrollHistoryResetTimeoutRef.current = null;
    }

    userScrollHistoryWindowRef.current = true;
  }

  function endUserHistoryScroll() {
    if (userScrollHistoryResetTimeoutRef.current) {
      clearTimeout(userScrollHistoryResetTimeoutRef.current);
    }

    userScrollHistoryResetTimeoutRef.current = setTimeout(() => {
      userScrollHistoryWindowRef.current = false;
      userScrollHistoryResetTimeoutRef.current = null;
    }, 700);
  }

  function loadOlderLocalHistoryFromTop() {
    if (isOlderLocalHistoryLoadingRef.current || isOlderLocalHistoryExhaustedRef.current || archivedMessages.length === 0) {
      return;
    }

    pendingHistoryAnchorRef.current = {
      previousContentHeight: lastContentHeightRef.current,
      previousOffsetY: lastScrollOffsetYRef.current,
    };
    isControlledHistoryPrependRef.current = true;
    isOlderLocalHistoryLoadingRef.current = true;
    logChatLifecycleDiagnostic('older-local-start', {
      previousContentHeight: Math.round(lastContentHeightRef.current),
      previousOffsetY: Math.round(lastScrollOffsetYRef.current),
    });
    logChatScrollDiagnostic('older-local-start', {
      previousContentHeight: Math.round(lastContentHeightRef.current),
      previousOffsetY: Math.round(lastScrollOffsetYRef.current),
    });

    let didAddHistory = false;

    void loadOlderLocalMessages(route.params.conversationId, { limit: LOCAL_HISTORY_PAGE_SIZE })
      .then((addedCount) => {
        logChatLifecycleDiagnostic('older-local-finished', { addedCount });
        logChatScrollDiagnostic('older-local-finished', { addedCount });
        if (addedCount <= 0) {
          pendingHistoryAnchorRef.current = null;
          isControlledHistoryPrependRef.current = false;
          isHistoryExpansionPendingRef.current = false;
          isOlderLocalHistoryExhaustedRef.current = true;
          return;
        }

        didAddHistory = true;
        setVisibleMessageCount((current) => Math.min(current + addedCount, current + LOCAL_HISTORY_PAGE_SIZE));
        setTimeout(() => {
          if (!didAddHistory || !pendingHistoryAnchorRef.current) {
            return;
          }

          pendingHistoryAnchorRef.current = null;
          isControlledHistoryPrependRef.current = false;
          isHistoryExpansionPendingRef.current = false;
          logChatLifecycleDiagnostic('history-controlled-prepend-fallback-clear');
        }, 900);
      })
      .finally(() => {
        if (!didAddHistory) {
          pendingHistoryAnchorRef.current = null;
          isControlledHistoryPrependRef.current = false;
          isHistoryExpansionPendingRef.current = false;
        }
        isOlderLocalHistoryLoadingRef.current = false;
      });
  }

  function requestOlderHistoryFromTop(reason: string) {
    if (
      !hasInitialScrollRef.current ||
      isHistoryExpansionPendingRef.current ||
      isBottomAnchoringRef.current ||
      isTailForced() ||
      instantNextScrollRef.current ||
      isOpenHistoryGuardActive() ||
      isTailOpenLockedRef.current ||
      !userScrollHistoryWindowRef.current
    ) {
      logChatLifecycleDiagnostic('history-load-skipped', {
        bottomAnchoring: isBottomAnchoringRef.current,
        guarded: isOpenHistoryGuardActive(),
        initialReady: hasInitialScrollRef.current,
        instant: instantNextScrollRef.current,
        pending: isHistoryExpansionPendingRef.current,
        reason,
        tailOpenLocked: isTailOpenLockedRef.current,
        userScroll: userScrollHistoryWindowRef.current,
      });
      return;
    }

    isHistoryExpansionPendingRef.current = true;
    logChatLifecycleDiagnostic('history-near-top', {
      reason,
      visibleWindowStartIndex,
    });

    if (visibleWindowStartIndex > 0) {
      logChatLifecycleDiagnostic('history-full-hydrate-skipped', {
        reason,
        visibleWindowStartIndex,
      });
      logChatLifecycleDiagnostic('history-expand-memory', {
        reason,
        visibleWindowStartIndex,
      });
      setVisibleMessageCount((current) => Math.min(archivedMessages.length, current + VISIBLE_MESSAGE_PAGE_SIZE));
      requestAnimationFrame(() => {
        isHistoryExpansionPendingRef.current = false;
      });
      return;
    }

    if (isOlderLocalHistoryLoadingRef.current || isOlderLocalHistoryExhaustedRef.current || archivedMessages.length === 0) {
      isHistoryExpansionPendingRef.current = false;
      logChatLifecycleDiagnostic('history-load-skipped', {
        archivedCount: archivedMessages.length,
        exhausted: isOlderLocalHistoryExhaustedRef.current,
        loading: isOlderLocalHistoryLoadingRef.current,
        reason,
      });
      return;
    }

    loadOlderLocalHistoryFromTop();
  }

  function handleMessageListScroll(event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const offsetY = Math.max(0, contentOffset.y);
    const distanceFromBottom = offsetY;
    const distanceFromHistoryTop = Math.max(0, contentSize.height - (offsetY + layoutMeasurement.height));
    if (Math.abs(contentSize.height - lastContentHeightRef.current) > 1) {
      lastContentHeightRef.current = contentSize.height;
    }
    if (Math.abs(layoutMeasurement.height - listViewportHeightRef.current) > 1) {
      listViewportHeightRef.current = layoutMeasurement.height;
    }
    const previousDistance = chatScrollDebugLastDistanceRef.current;
    const now = Date.now();
    const shouldLogScroll = previousDistance === null ||
      now - chatScrollDebugLastScrollAtRef.current > 500 ||
      Math.abs(distanceFromBottom - previousDistance) > 80;

    if (shouldLogScroll) {
      chatScrollDebugLastScrollAtRef.current = now;
      chatScrollDebugLastDistanceRef.current = distanceFromBottom;
      logChatScrollDiagnostic('scroll', {
        eventContentHeight: Math.round(contentSize.height),
        eventViewportHeight: Math.round(layoutMeasurement.height),
        eventOffsetY: Math.round(offsetY),
        eventDistanceBottom: Math.round(distanceFromBottom),
        eventDistanceHistoryTop: Math.round(distanceFromHistoryTop),
      });
    }

    const isScrollable = contentSize.height > layoutMeasurement.height + TOP_HISTORY_LOAD_THRESHOLD_PX;
    const canRequestOlderHistory =
      !isBottomAnchoringRef.current &&
      !isTailForced() &&
      !instantNextScrollRef.current &&
      !isOpenHistoryGuardActive() &&
      !isTailOpenLockedRef.current &&
      userScrollHistoryWindowRef.current;

    lastScrollOffsetYRef.current = offsetY;
    lastDistanceFromBottomRef.current = Math.max(0, distanceFromBottom);

    if (
      canRequestOlderHistory &&
      hasInitialScrollRef.current &&
      isScrollable &&
      distanceFromHistoryTop <= TOP_HISTORY_LOAD_THRESHOLD_PX &&
      !isHistoryExpansionPendingRef.current
    ) {
      requestOlderHistoryFromTop('active-top-scroll');
    }

    if (isTailForced()) {
      isNearBottomRef.current = true;
      setScrollToBottomVisible(false);
      return;
    }

    isNearBottomRef.current = distanceFromBottom < 180;
    setScrollToBottomVisible(distanceFromBottom >= 180);
  }

  function handleScrollToIndexFailed(info: ScrollToIndexFailureInfo) {
    const pendingMessageId = pendingJumpMessageIdRef.current;

    if (!pendingMessageId) {
      if (renderedChatListItems.length === 0) {
        return;
      }

      setTimeout(() => {
        listRef.current?.scrollToIndex({
          animated: true,
          index: Math.min(info.index, renderedChatListItems.length - 1),
          viewPosition: 0.45,
        });
      }, MESSAGE_JUMP_RETRY_DELAY_MS);
      return;
    }

    if (pendingJumpAttemptRef.current >= MESSAGE_JUMP_MAX_ATTEMPTS) {
      clearPendingMessageJump();
      return;
    }

    pendingJumpAttemptRef.current += 1;
    clearPendingJumpRetry();

    if (info.averageItemLength > 0) {
      listRef.current?.scrollToOffset({
        animated: false,
        offset: Math.max(0, info.averageItemLength * info.index),
      });
    }

    pendingJumpRetryTimeoutRef.current = setTimeout(() => {
      pendingJumpRetryTimeoutRef.current = null;
      ensureMessageVisible(pendingMessageId, pendingJumpOptionsRef.current ?? { animated: true, viewPosition: 0.45 });
    }, MESSAGE_JUMP_RETRY_DELAY_MS + Math.min(pendingJumpAttemptRef.current * 80, 500));
  }

  function removeLocalMessage(messageId: string) {
    setPinnedMessages((current) => current.filter((item) => item.message.id !== messageId));
    useAppStore.getState().removeMessage(route.params.conversationId, messageId);
  }

  async function saveGroupAlias(aliasName: string | null) {
    if (aliasName && !canUsePremiumFeatures) {
      Alert.alert(t('premiumRequiredTitle'), t('premiumRequiredMessage'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('premiumSubscribe'), onPress: () => navigation.navigate('Subscription') },
      ]);
      return;
    }

    if (aliasName && containsMeetVapKeyword(aliasName)) {
      Alert.alert(t('nameUpdateFailed'), t('meetvapNameProhibited'));
      return;
    }

    setSavingGroupAlias(true);

    try {
      await updateGroupAlias(route.params.conversationId, aliasName);
      setGroupAliasEditorOpen(false);
      setGroupAliasDraft('');
    } catch (error) {
      Alert.alert(t('nameUpdateFailed', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setSavingGroupAlias(false);
    }
  }

  async function declineCurrentGroupInvite(input: { blockGroup?: boolean; reportGroup?: boolean }) {
    try {
      await declineGroupInvite(route.params.conversationId, input);
      navigation.goBack();
    } catch (error) {
      Alert.alert(t('groupInviteActionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function showGroupInviteDeclineOptions() {
    Alert.alert(
      t('groupInviteDeclineTitle'),
      t('groupInviteDeclineSubtitle'),
      [
        {
          text: t('groupInviteBlock'),
          style: 'destructive',
          onPress: () => void declineCurrentGroupInvite({ blockGroup: true }),
        },
        {
          text: t('groupInviteBlockAndReport'),
          style: 'destructive',
          onPress: () => void declineCurrentGroupInvite({ blockGroup: true, reportGroup: true }),
        },
        {
          text: t('groupInviteLeaveOnly'),
          onPress: () => void declineCurrentGroupInvite({}),
        },
      ],
    );
  }

  useEffect(() => {
    if (!conversation || !isGroupInvitePending || promptedGroupInviteIdRef.current === conversation.id) {
      return;
    }

    promptedGroupInviteIdRef.current = conversation.id;
    Alert.alert(
      t('groupInviteQuestionTitle'),
      t('groupInviteQuestionSubtitle', { name: conversation.title || route.params.title }),
      [
        {
          text: t('yes'),
          onPress: () => {
            if (canUsePremiumFeatures && user?.useGroupAliases === true) {
              setGroupAliasDraft(conversation.myGroupAliasName || user.displayName || '');
              setGroupAliasEditorOpen(true);
              return;
            }

            void saveGroupAlias(null);
          },
        },
        {
          text: t('no'),
          style: 'cancel',
          onPress: showGroupInviteDeclineOptions,
        },
      ],
    );
  }, [canUsePremiumFeatures, conversation, isGroupInvitePending, route.params.title, user?.displayName, user?.useGroupAliases]);

  function closeGroupCallPicker() {
    setGroupCallPickerMode(null);
    setGroupCallVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
    setSelectedGroupCallMemberIds([]);
  }

  function toggleGroupCallMember(userId: string) {
    const mode = groupCallPickerMode;

    if (!mode) {
      return;
    }

    const maxInvitees = getGroupCallLimit(mode) - 1;

    setSelectedGroupCallMemberIds((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }

      if (current.length >= maxInvitees) {
        Alert.alert(
          t('limitReached', {}, language),
          t('callsCanInclude', { mode: t(mode === 'voice' ? 'voice' : 'video', {}, language), count: maxInvitees }, language),
        );
        return current;
      }

      return [...current, userId];
    });
  }

  function startSelectedGroupCall() {
    if (!groupCallPickerMode || selectedGroupCallMemberIds.length === 0) {
      return;
    }

    const mode = groupCallPickerMode;
    const inviteeIds = selectedGroupCallMemberIds;
    const voiceEffectId = canUsePremiumFeatures ? groupCallVoiceEffectId : DEFAULT_VOICE_EFFECT_ID;

    closeGroupCallPicker();
    navigation.navigate('CallRoom', {
      conversationId: route.params.conversationId,
      direction: 'outgoing',
      initialInviteeIds: inviteeIds,
      isGroupCall: true,
      mode,
      title: route.params.title,
      voiceEffectId: mode === 'voice' ? voiceEffectId : DEFAULT_VOICE_EFFECT_ID,
    });
  }

  function toggleVoiceRoomMic() {
    logVoiceRoomDiagnostic('chat-toggle-mic-press', {
      adminMuted: voiceRoomSession.adminMuted,
      conversationId: route.params.conversationId,
      isSelfMuted: voiceRoomSession.isSelfMuted,
    });

    if (voiceRoomSession.adminMuted) {
      Alert.alert(t('mutedByAdmin'), t('voiceRoomAdminMutedMessage'));
      return;
    }

    void setVoiceRoomSelfMuted(!voiceRoomSession.isSelfMuted).then(() => refreshVoiceRoomParticipants());
  }

  function beginVoiceRoomPushToTalk() {
    logVoiceRoomDiagnostic('chat-push-to-talk-begin', {
      adminMuted: voiceRoomSession.adminMuted,
      conversationId: route.params.conversationId,
      isSelfMuted: voiceRoomSession.isSelfMuted,
    });

    if (!voiceRoomSession.isSelfMuted || voiceRoomSession.adminMuted) {
      return;
    }

    setVoiceRoomPushToTalking(true);
  }

  function endVoiceRoomPushToTalk() {
    logVoiceRoomDiagnostic('chat-push-to-talk-end', {
      conversationId: route.params.conversationId,
    });
    setVoiceRoomPushToTalking(false);
  }

  function toggleVoiceRoomSpeakerMute() {
    logVoiceRoomDiagnostic('chat-toggle-speaker-mute', {
      conversationId: route.params.conversationId,
      isSpeakerMuted: voiceRoomSession.isSpeakerMuted,
    });
    setVoiceRoomSpeakerMuted(!voiceRoomSession.isSpeakerMuted);
  }

  async function addCurrentChatPeerToContacts() {
    const targetUserId = conversation?.otherUserId ?? otherUser?.id;

    if (!targetUserId || isAddingChatContact) {
      return;
    }

    setAddingChatContact(true);

    try {
      await addUserToContacts(targetUserId);
      setAddContactPromptDismissed(true);
    } catch (error) {
      Alert.alert(t('addContactFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setAddingChatContact(false);
    }
  }

  async function openVoiceRoomRoutePicker() {
    logVoiceRoomDiagnostic('chat-route-picker-open', {
      conversationId: route.params.conversationId,
    });
    const outputs = await AudioSession.getAudioOutputs().catch((error): string[] => {
      logVoiceRoomDiagnostic('chat-route-picker-outputs-failed', {
        conversationId: route.params.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    });
    logVoiceRoomDiagnostic('chat-route-picker-outputs', {
      conversationId: route.params.conversationId,
      outputs,
    });
    const routes = outputs.length > 0 ? outputs : ['force_speaker', 'speaker', 'earpiece'];
    setVoiceRoomAudioRoutes(routes.map((routeId) => ({
      id: routeId,
      label: getVoiceRoomAudioRouteLabel(routeId),
    })));
    setVoiceRoomRoutePickerOpen(true);
  }

  async function selectVoiceRoomAudioRoute(routeId: string) {
    logVoiceRoomDiagnostic('chat-route-select', {
      conversationId: route.params.conversationId,
      routeId,
    });
    setVoiceRoomRoutePickerOpen(false);
    await AudioSession.selectAudioOutput(routeId).catch((error) => {
      logVoiceRoomDiagnostic('chat-route-select-failed', {
        conversationId: route.params.conversationId,
        message: error instanceof Error ? error.message : String(error),
        routeId,
      });
    });
  }

  async function toggleVoiceRoomAdminMute(participant: VoiceRoomParticipant) {
    logVoiceRoomDiagnostic('chat-admin-mute-toggle', {
      canModerateVoiceRoom,
      conversationId: route.params.conversationId,
      participantAdminMuted: participant.adminMuted,
      participantSelfMuted: participant.selfMuted,
      participantUserId: participant.userId,
    });

    if (!serverUrl || !canModerateVoiceRoom || participant.userId === user?.id) {
      return;
    }

    if (participant.selfMuted && participant.adminMuted) {
      await updateVoiceRoomParticipant(serverUrl, route.params.conversationId, participant.userId, { adminMuted: false });
    } else if (!participant.selfMuted) {
      await updateVoiceRoomParticipant(serverUrl, route.params.conversationId, participant.userId, { adminMuted: !participant.adminMuted });
    }

    await refreshVoiceRoomParticipants();
  }

  function loadMoreVoiceRoomParticipants() {
    if (!hasMoreVoiceRoomParticipants) {
      return;
    }

    void refreshVoiceRoomParticipants(voiceRoomParticipantsNextOffset, true);
  }

  const openMediaViewer = useCallback((message: Message) => {
    if (message.kind === 'image') {
      const images = archivedMessagesRef.current.filter(isViewableImageMessage);
      const imageIndex = images.findIndex((item) => item.id === message.id);
      const imageMessages = imageIndex >= 0 ? images : [message];

      setViewerMessage(null);
      setImageViewerSession({
        images: imageMessages,
        index: Math.max(0, imageIndex),
      });
      return;
    }

    setImageViewerSession(null);
    setViewerMessage(message);
  }, []);

  const closeMediaViewer = useCallback(() => {
    setImageViewerSession(null);
    setViewerMessage(null);
  }, []);

  const openDisappearingMessageForView = useCallback((message: Message) => {
    const secondsAfterView = getDisappearingSecondsAfterView(message);

    void openDisappearingMessage(route.params.conversationId, message.id, secondsAfterView)
      .catch((error) => {
        Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      });
  }, [openDisappearingMessage, route.params.conversationId]);

  const renderChatListItem = useCallback(({ item }: { item: ChatListItem }) => {
    if (item.type === 'date') {
      return <DateDivider label={item.label} />;
    }

    const message = item.message;

    return (
      <MessageRow
        isMine={message.senderId === user?.id}
        isPinned={pinnedMessageIds.has(message.id)}
        isPlayingVoice={playingVoiceId === message.id}
        isSelected={selectedMessageIdSet.has(message.id)}
        isSelectionMode={isSelectionMode}
        message={message}
        canRedialCallMessage={!route.params.isGroup}
        onCancelUpload={cancelUpload}
        onLongPress={handleMessageActions}
        onOpenCall={openCallMessage}
        onOpenDisappearing={openDisappearingMessageForView}
        onOpenMedia={openMediaViewer}
        onOpenReply={openRepliedMessage}
        onPlayVoice={playVoiceMessage}
        onSwipeReply={canUseMessageWriteActions ? replyToSelectedMessage : undefined}
        onToggleSelected={toggleSelectedMessage}
        showSender={route.params.isGroup}
        voicePlayed={playedVoiceMessageIds.has(message.id)}
        voiceProgress={voiceProgressById[message.id] ?? 0}
      />
    );
  }, [
    cancelUpload,
    canUseMessageWriteActions,
    handleMessageActions,
    openMediaViewer,
    isSelectionMode,
    openCallMessage,
    openDisappearingMessageForView,
    openRepliedMessage,
    pinnedMessageIds,
    playedVoiceMessageIds,
    playingVoiceId,
    playVoiceMessage,
    replyToSelectedMessage,
    route.params.isGroup,
    selectedMessageIdSet,
    toggleSelectedMessage,
    user?.id,
    voiceProgressById,
  ]);

  const bottomAnchoringBatchSize = isBottomAnchoringActive
    ? Math.min(Math.max(renderedChatListItems.length, 24), 180)
    : 8;
  const bottomAnchoringWindowSize = isBottomAnchoringActive
    ? Math.min(Math.max(Math.ceil(renderedChatListItems.length / 8), 10), 24)
    : 7;
  const initialRenderCount = Math.min(Math.max(renderedChatListItems.length > 0 ? 18 : 0, 18), 24);

  return (
    <View style={styles.screen}>
      {isSearchVisible ? (
        <View style={styles.searchBar}>
          <TextInput
            autoFocus
            onChangeText={setSearchQuery}
            placeholder={t('searchMessages', {}, language)}
            placeholderTextColor={colors.mutedText}
            style={styles.searchInput}
            value={searchQuery}
          />
          <Text style={styles.searchCount}>
            {searchQuery.trim() ? `${searchMatches.length ? Math.min(searchIndex + 1, searchMatches.length) : 0}/${searchMatches.length}` : '0/0'}
          </Text>
          <Pressable onPress={() => moveSearch(-1)} style={styles.searchButton}>
            <Ionicons color={colors.textPrimary} name="chevron-up" size={20} />
          </Pressable>
          <Pressable onPress={() => moveSearch(1)} style={styles.searchButton}>
            <Ionicons color={colors.textPrimary} name="chevron-down" size={20} />
          </Pressable>
          <Pressable
            onPress={() => {
              setSearchVisible(false);
              setSearchQuery('');
            }}
            style={styles.searchButton}
          >
            <Ionicons color={colors.textPrimary} name="close" size={20} />
          </Pressable>
        </View>
      ) : null}

      {shouldShowGroupAliasPrompt ? (
        <View style={styles.groupAliasPrompt}>
          <View style={styles.groupAliasPromptText}>
            <Text style={styles.groupAliasTitle}>{t('groupAliasPromptTitle')}</Text>
            <Text style={styles.groupAliasSubtitle}>{t('groupAliasPromptSubtitle')}</Text>
          </View>
          {isGroupAliasEditorOpen ? (
            <View style={styles.groupAliasEditor}>
              <TextInput
                autoCapitalize="words"
                editable={!isSavingGroupAlias}
                maxLength={80}
                onChangeText={setGroupAliasDraft}
                placeholder={t('groupAliasInputPlaceholder')}
                placeholderTextColor={colors.mutedText}
                style={styles.groupAliasInput}
                value={groupAliasDraft}
              />
              <View style={styles.groupAliasActions}>
                <Pressable disabled={isSavingGroupAlias} onPress={() => {
                  if (isGroupInvitePending) {
                    showGroupInviteDeclineOptions();
                    return;
                  }

                  setGroupAliasEditorOpen(false);
                }} style={styles.groupAliasSecondaryButton}>
                  <Text style={styles.groupAliasSecondaryText}>{t('cancel')}</Text>
                </Pressable>
                <Pressable
                  disabled={isSavingGroupAlias || groupAliasDraft.trim().length === 0}
                  onPress={() => void saveGroupAlias(groupAliasDraft.trim())}
                  style={[
                    styles.groupAliasPrimaryButton,
                    (isSavingGroupAlias || groupAliasDraft.trim().length === 0) ? styles.groupAliasButtonDisabled : undefined,
                  ]}
                >
                  {isSavingGroupAlias ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.groupAliasPrimaryText}>{t('useName')}</Text>}
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.groupAliasActions}>
              <Pressable disabled={isSavingGroupAlias} onPress={() => void saveGroupAlias(null)} style={styles.groupAliasSecondaryButton}>
                <Text style={styles.groupAliasSecondaryText}>{t('useCardName')}</Text>
              </Pressable>
              <Pressable
                disabled={isSavingGroupAlias}
                onPress={() => {
                  setGroupAliasDraft(conversation?.myGroupAliasName || '');
                  setGroupAliasEditorOpen(true);
                }}
                style={styles.groupAliasPrimaryButton}
              >
                <Text style={styles.groupAliasPrimaryText}>{t('useAnotherName')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}

      {latestPinnedMessage ? (
        <PinnedMessageBanner
          language={uiLanguage}
          message={latestPinnedMessage}
          onPress={openPinnedMessages}
        />
      ) : null}

      {conversation?.disappearingMessagesDurationMinutes && conversation.disappearingMessagesExpiredAt ? (
        <View style={styles.disappearingMessagesNotice}>
          <Ionicons color={colors.primary} name="time-outline" size={17} />
          <Text style={styles.disappearingMessagesNoticeText}>{t('disappearingMessagesExpiredNotice', {}, uiLanguage)}</Text>
        </View>
      ) : null}

      {shouldShowAddContactPrompt ? (
        <View style={styles.addContactPrompt}>
          <View style={styles.addContactPromptText}>
            <Text numberOfLines={1} style={styles.addContactPromptTitle}>{otherUser?.displayName || headerTitle}</Text>
            <Text numberOfLines={1} style={styles.addContactPromptSubtitle}>{t('addContactPrompt')}</Text>
          </View>
          <Pressable disabled={isAddingChatContact} onPress={() => setAddContactPromptDismissed(true)} style={styles.addContactPromptSecondary}>
            <Text style={styles.addContactPromptSecondaryText}>{t('dismiss')}</Text>
          </Pressable>
          <Pressable disabled={isAddingChatContact} onPress={() => void addCurrentChatPeerToContacts()} style={styles.addContactPromptPrimary}>
            {isAddingChatContact ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.addContactPromptPrimaryText}>{t('add')}</Text>}
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        contentContainerStyle={[styles.messageList, styles.invertedMessageList, { paddingTop: Math.max(spacing.sm, insets.bottom + spacing.sm) }]}
        data={renderedChatListItems}
        initialNumToRender={initialRenderCount}
        inverted
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
        keyboardShouldPersistTaps="handled"
        keyExtractor={getChatListItemRenderKey}
        maxToRenderPerBatch={bottomAnchoringBatchSize}
        onContentSizeChange={handleContentSizeChange}
        onMomentumScrollEnd={endUserHistoryScroll}
        onLayout={handleMessageListLayout}
        onScroll={handleMessageListScroll}
        onScrollBeginDrag={beginUserHistoryScroll}
        onScrollEndDrag={endUserHistoryScroll}
        removeClippedSubviews={false}
        scrollEventThrottle={80}
        updateCellsBatchingPeriod={isBottomAnchoringActive ? 16 : 80}
        windowSize={bottomAnchoringWindowSize}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        renderItem={renderChatListItem}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />

      {isScrollToBottomVisible ? (
        <Pressable
          onPress={() => scrollToLatestMessage(true)}
          style={[styles.scrollToBottomButton, { bottom: Math.max(spacing.xl, keyboardLift + insets.bottom + 76) }]}
        >
          <Ionicons color={colors.white} name="chevron-down" size={20} />
        </Pressable>
      ) : null}

      {!isSystemChat && !isGroupMessageLockedForCurrentUser && voiceRecordingState.isRecording ? (
        <View style={[styles.recordingBar, voiceRecordingState.isLocked && styles.recordingBarLocked]}>
          <View style={styles.recordingDot} />
          {!voiceRecordingState.isLocked ? (
            <View style={styles.recordingLockHint}>
              <Ionicons color={colors.textSecondary} name="lock-closed-outline" size={14} />
              <Text style={styles.recordingLockHintText}>{t('slideUpToLock')}</Text>
            </View>
          ) : null}
          <Text style={styles.recordingTime}>{Math.round(voiceRecordingState.durationMillis / 1000)}s</Text>
        </View>
      ) : null}

      {isVoiceRoomConversation ? (
        <VoiceRoomControls
          adminMuted={voiceRoomSession.adminMuted}
          connectedLabel={t('voiceRoomConnected')}
          connectingLabel={t('voiceRoomConnecting')}
          isConnected={isCurrentVoiceRoomConnected}
          isConnecting={isCurrentVoiceRoomConnecting}
          isPushToTalking={voiceRoomSession.isPushToTalking}
          isSelfMuted={voiceRoomSession.isSelfMuted}
          isSpeakerMuted={voiceRoomSession.isSpeakerMuted}
          onBeginPushToTalk={beginVoiceRoomPushToTalk}
          onEndPushToTalk={endVoiceRoomPushToTalk}
          onOpenPeople={() => setVoiceRoomPeopleOpen(true)}
          onOpenRoutePicker={() => void openVoiceRoomRoutePicker()}
          onToggleMic={toggleVoiceRoomMic}
          onToggleSpeakerMute={toggleVoiceRoomSpeakerMute}
          participantCount={voiceRoomParticipants.length}
          themeColors={themeColors}
        />
      ) : null}

      {isGroupMessageLockedForCurrentUser ? null : (
      <View style={styles.composerKeyboardAvoider}>
        <View
          ref={composerRef}
          style={[
            styles.composer,
            {
              marginBottom: keyboardLift,
              paddingBottom: Math.max(spacing.sm, insets.bottom + spacing.sm),
            },
          ]}
        >
          <Pressable
            disabled={voiceRecordingState.isRecording || !canSendMessages}
            onPress={() => {
              setEmojiPickerVisible(false);
              setAttachmentSheetVisible(true);
            }}
            style={[styles.iconButton, !canSendMessages && styles.iconButtonDisabled]}
          >
            <Ionicons color={colors.textSecondary} name="attach" size={22} />
          </Pressable>
          {isSystemChat ? null : (
            <Pressable disabled={voiceRecordingState.isRecording || !canSendMessages} onPress={toggleEmojiPicker} style={[styles.iconButton, isEmojiPickerVisible ? styles.iconButtonActive : undefined, !canSendMessages && styles.iconButtonDisabled]}>
              <Ionicons color={isEmojiPickerVisible ? colors.white : colors.textSecondary} name="happy-outline" size={22} />
            </Pressable>
          )}
          <View style={styles.inputWrap}>
            {!canSendMessages ? (
              <View style={styles.readOnlyComposer}>
                <Text style={styles.readOnlyComposerText}>{isGroupInvitePending ? t('groupInviteQuestionTitle', {}, language) : t('onlyAdminsCanSendMessages', {}, language)}</Text>
              </View>
            ) : replyingToMessage ? (
            <View style={styles.composerReply}>
              <View style={styles.composerReplyText}>
                <Text numberOfLines={1} style={styles.composerReplyTitle}>
                  Replying to {getReplySenderName(replyingToMessage, user?.id)}
                </Text>
                <Text numberOfLines={3} style={styles.composerReplyBody}>{getMessagePreview(replyingToMessage, uiLanguage)}</Text>
              </View>
              <Pressable onPress={() => setReplyingToMessage(null)} style={styles.composerReplyClose}>
                <Ionicons color={colors.textSecondary} name="close" size={18} />
              </Pressable>
            </View>
            ) : null}
            {!isSystemChat && pendingVoiceMessage ? (
            <View style={styles.pendingVoiceBar}>
              <Pressable
                accessibilityLabel={t('discardVoiceMessage')}
                disabled={isProcessingVoiceEffect}
                onPress={() => void cancelPendingVoiceMessage()}
                style={styles.pendingVoiceDiscardButton}
              >
                <Ionicons color={colors.textSecondary} name="close" size={18} />
              </Pressable>
              <View style={styles.pendingVoiceText}>
                <Text numberOfLines={1} style={styles.pendingVoiceTitle}>{t('voiceMessageReady')}</Text>
                <Text style={styles.pendingVoiceSubtitle}>
                  {formatVoiceComposerEffectLabel(selectedVoiceEffectId)}
                  {pendingVoiceMessage.durationSeconds ? ` • ${Math.max(1, Math.round(pendingVoiceMessage.durationSeconds))}s` : ''}
                </Text>
              </View>
            </View>
            ) : !isSystemChat && voiceRecordingState.isRecording ? (
            <View style={styles.holdRecordingInput}>
              <Text style={styles.holdRecordingText}>{voiceRecordingState.isLocked ? '' : t('releaseToSend')}</Text>
            </View>
            ) : (
            <TextInput
              contextMenuHidden
              multiline
              onChangeText={updateDraft}
              onFocus={() => {
                setEmojiPickerVisible(false);
                if (isNearBottomRef.current || isTailForced()) {
                  scheduleTailScroll({ reason: 'composer-focus', settle: true });
                }
              }}
              onSelectionChange={(event) => setDraftSelection(event.nativeEvent.selection)}
              onTouchCancel={clearComposerLongPressTimer}
              onTouchEnd={clearComposerLongPressTimer}
              onTouchStart={scheduleComposerEditMenu}
              placeholder={t('message')}
              placeholderTextColor={colors.mutedText}
              selection={draftSelection}
              style={[styles.input, styles.inputInWrap]}
              value={draft}
            />
            )}
          </View>
          {!isSystemChat && pendingVoiceMessage ? (
          <View style={styles.pendingVoiceActions}>
            <Pressable
              accessibilityLabel={t('voiceEffectSettings')}
              disabled={isProcessingVoiceEffect}
              onPress={() => {
                if (!canUsePremiumFeatures) {
                  Alert.alert(t('premiumRequiredTitle'), t('premiumRequiredMessage'), [
                    { text: t('cancel'), style: 'cancel' },
                    { text: t('premiumSubscribe'), onPress: () => navigation.navigate('Subscription') },
                  ]);
                  return;
                }

                setVoiceEffectPickerVisible(true);
              }}
              style={[styles.pendingVoiceGearButton, isProcessingVoiceEffect ? styles.iconButtonDisabled : undefined]}
            >
              <Ionicons color={colors.textSecondary} name="settings-outline" size={20} />
            </Pressable>
            <Pressable disabled={isProcessingVoiceEffect} onPress={() => void sendPendingVoiceMessage()} style={[styles.sendButton, isProcessingVoiceEffect ? styles.sendButtonDisabled : undefined]}>
              {isProcessingVoiceEffect ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons color={colors.white} name="send" size={20} />}
            </Pressable>
          </View>
          ) : draft.trim() && canSendMessages ? (
          <Pressable disabled={isSendingText} onLongPress={openSendOptionsMenu} onPress={handleSendTextMessage} style={[styles.sendButton, isSendingText ? styles.sendButtonDisabled : undefined]}>
            {isSendingText ? <ActivityIndicator color={colors.white} size="small" /> : <Ionicons color={colors.white} name="send" size={20} />}
          </Pressable>
          ) : canSendMessages && !isSystemChat ? (
          <HoldVoiceRecorderButton
            key={`voice-recorder-${route.params.conversationId}-${voiceRecorderSessionKey}`}
            onOpenVoiceEffectPicker={() => {
              if (!canUsePremiumFeatures) {
                Alert.alert(t('premiumRequiredTitle'), t('premiumRequiredMessage'), [
                  { text: t('cancel'), style: 'cancel' },
                  { text: t('premiumSubscribe'), onPress: () => navigation.navigate('Subscription') },
                ]);
                return;
              }

              setVoiceEffectPickerVisible(true);
            }}
            onRecorded={(message, shouldSendNow) => {
              void handleVoiceRecorded(message, shouldSendNow);
            }}
            onSessionClosed={() => setVoiceRecorderSessionKey((current) => current + 1)}
            onStateChange={handleVoiceRecorderStateChange}
          />
          ) : !canSendMessages ? (
          <View style={[styles.sendButton, styles.sendButtonDisabled]}>
            <Ionicons color={colors.white} name="lock-closed" size={18} />
          </View>
          ) : null}
        </View>
      </View>
      )}

      {!isSystemChat && !isGroupMessageLockedForCurrentUser && isEmojiPickerVisible && canSendMessages ? (
        <EmojiPicker
          bottomInset={insets.bottom}
          groups={emojiGroups}
          onSelect={insertEmoji}
          onSelectGroup={setSelectedEmojiGroupKey}
          selectedGroup={selectedEmojiGroup}
          selectedGroupKey={selectedEmojiGroupKey}
        />
      ) : null}

      <AttachmentSheet
        actions={[
          { icon: 'images', label: t('gallery'), onPress: pickFromGallery },
          { icon: 'camera', label: t('camera'), onPress: openCamera },
          { icon: 'document-text', label: t('file'), onPress: pickFile },
          { icon: 'location', label: t('location'), onPress: chooseLocationType },
          { icon: 'person-circle-outline', label: t('contact'), onPress: () => void openContactSharePicker() },
        ]}
        onClose={() => setAttachmentSheetVisible(false)}
        visible={isAttachmentSheetVisible}
      />
      <ShareContactPickerModal
        contacts={contacts.filter((contact: AuthUser) => contact.isSystem !== true)}
        onClose={() => setContactSharePickerVisible(false)}
        onSelect={(contact) => void sendSharedContact(contact)}
        visible={isContactSharePickerVisible}
      />
      <AttachmentCaptionModal
        attachment={isCaptionSuspendedForDrawing ? null : pendingCaptionAttachment}
        bottomInset={insets.bottom}
        caption={captionDraft}
        onCancel={closeCaptionComposer}
        onChangeCaption={setCaptionDraft}
        onDraw={openImageDrawingComposer}
        onLongPressSend={openCaptionSendOptionsMenu}
        onSend={() => void sendPendingCaptionAttachment()}
      />
      <ImageDrawingModal
        attachment={drawingAttachment}
        onCancel={closeImageDrawingComposer}
        onSend={(strokes) => sendDrawnAttachment(strokes)}
      />
      <VoiceEffectModal
        bottomInset={insets.bottom}
        durationSeconds={pendingVoiceMessage?.durationSeconds ?? Math.max(1, Math.round(voiceRecordingState.durationMillis / 1000))}
        isProcessing={isProcessingVoiceEffect}
        onCancel={() => setVoiceEffectPickerVisible(false)}
        onSelect={setSelectedVoiceEffectId}
        onSend={voiceRecordingState.isLocked ? () => setVoiceEffectPickerVisible(false) : () => void sendPendingVoiceMessage()}
        primaryLabel={voiceRecordingState.isLocked ? t('done') : undefined}
        selectedEffectId={selectedVoiceEffectId}
        visible={canUsePremiumFeatures && (!!pendingVoiceMessage || voiceRecordingState.isLocked) && isVoiceEffectPickerVisible}
      />
      <VoiceEffectModal
        bottomInset={insets.bottom}
        isProcessing={false}
        onCancel={() => {
          suppressNextCallPressRef.current = false;
          selectedCallVoiceEffectIdRef.current = DEFAULT_VOICE_EFFECT_ID;
          setSelectedCallVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
          setCallVoiceEffectPickerVisible(false);
        }}
        onSelect={selectCallVoiceEffect}
        onSend={() => {
          const nextEffectId = selectedCallVoiceEffectIdRef.current;

          suppressNextCallPressRef.current = false;
          selectedCallVoiceEffectIdRef.current = DEFAULT_VOICE_EFFECT_ID;
          setSelectedCallVoiceEffectId(DEFAULT_VOICE_EFFECT_ID);
          setCallVoiceEffectPickerVisible(false);
          void confirmStartCall('voice', nextEffectId);
        }}
        primaryLabel={t('call')}
        selectedEffectId={selectedCallVoiceEffectId}
        subtitle={t('voiceEffectCallSubtitle')}
        visible={canUsePremiumFeatures && isCallVoiceEffectPickerVisible}
      />

      <SendOptionsModal
        dateDraft={scheduleDateDraft}
        disappearSecondsDraft={disappearSecondsDraft}
        hourDraft={scheduleHourDraft}
        minuteDraft={scheduleMinuteDraft}
        mode={sendOptionsMode}
        onCancel={closeSendOptionsMenu}
        onChangeDate={setScheduleDateDraft}
        onChangeDisappearSeconds={setDisappearSecondsDraft}
        onChangeHour={setScheduleHourDraft}
        onChangeMinute={setScheduleMinuteDraft}
        onChangeSecond={setScheduleSecondDraft}
        onOpenDisappear={() => setSendOptionsMode('disappear')}
        onOpenSchedule={() => setSendOptionsMode('schedule')}
        onSendDisappear={() => void sendDisappearingTextMessage()}
        onSendSchedule={() => void sendScheduledTextMessage()}
        secondDraft={scheduleSecondDraft}
      />

      {voiceCallTipModal}

      <VoiceRoomPeopleModal
        canModerate={canModerateVoiceRoom}
        currentUserId={user?.id}
        hasMore={hasMoreVoiceRoomParticipants}
        isVisible={isVoiceRoomPeopleOpen}
        onClose={() => setVoiceRoomPeopleOpen(false)}
        onLoadMore={loadMoreVoiceRoomParticipants}
        onToggleAdminMute={(participant) => void toggleVoiceRoomAdminMute(participant)}
        participants={voiceRoomParticipants}
      />
      <Modal animationType="fade" transparent visible={isVoiceRoomRoutePickerOpen} onRequestClose={() => setVoiceRoomRoutePickerOpen(false)}>
        <Pressable onPress={() => setVoiceRoomRoutePickerOpen(false)} style={styles.voiceRoomModalBackdrop}>
          <Pressable onPress={(event) => event.stopPropagation()} style={styles.voiceRoomRoutePanel}>
            <Text style={styles.voiceRoomModalTitle}>{t('audioOutput')}</Text>
            {voiceRoomAudioRoutes.map((routeItem) => (
              <Pressable key={routeItem.id} onPress={() => void selectVoiceRoomAudioRoute(routeItem.id)} style={styles.voiceRoomRouteRow}>
                <Ionicons color={colors.primary} name="volume-high-outline" size={20} />
                <Text style={styles.voiceRoomRouteText}>{routeItem.label}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <MediaViewer
        imageMessages={imageViewerSession?.images ?? EMPTY_MESSAGES}
        initialImageIndex={imageViewerSession?.index ?? 0}
        message={viewerMessage}
        onClose={closeMediaViewer}
      />
      <PinnedMessagesModal
        canRemove={canPinMessages}
        messages={filteredPinnedMessages}
        onChangeSearch={setPinnedSearchQuery}
        onClose={() => setPinnedMessagesVisible(false)}
        onRemove={confirmRemovePinnedMessage}
        onSelect={showPinnedMessageInChat}
        query={pinnedSearchQuery}
        visible={isPinnedMessagesVisible}
      />
      <EditMessageModal
        draft={editDraft}
        isSaving={isSavingEdit}
        onCancel={() => {
          if (isSavingEdit) {
            return;
          }
          setEditingMessage(null);
          setEditDraft('');
        }}
        onChangeDraft={setEditDraft}
        onSave={() => void saveEditedMessage()}
        visible={!!editingMessage}
      />
      <MessageActionMenu
        isPinned={messageActionMenu ? pinnedMessageIds.has(messageActionMenu.id) : false}
        canDelete={canUseMessageWriteActions}
        canEdit={canUseMessageWriteActions}
        canForwardAndSelect={canSaveMediaToPhone}
        localizationKey={[t('messageOptions'), t('edit'), t('pin'), t('unpin'), t('reply'), t('forward'), t('select'), t('report'), t('delete')].join('|')}
        labels={{
          copy: t('copy'),
          delete: t('delete'),
          edit: t('edit'),
          forward: t('forward'),
          messageOptions: t('messageOptions'),
          pin: t('pin'),
          reply: t('reply'),
          report: t('report'),
          select: t('select'),
          unpin: t('unpin'),
        }}
        onCopy={(message) => void copyMessageText(message)}
        message={isSystemChat ? null : messageActionMenu}
        onCancel={() => setMessageActionMenu(null)}
        onDelete={deleteSelectedMenuMessage}
        onEdit={openEditMessage}
        onForward={forwardSelectedMenuMessage}
        onPin={pinSelectedMenuMessage}
        onReact={reactToSelectedMessage}
        onReport={reportSelectedMessage}
        onReply={replyToSelectedMessage}
        onSelect={startSelectingMessage}
        onUnpin={unpinSelectedMenuMessage}
        canReply={canUseMessageWriteActions}
        canPin={canPinMessages}
        userId={user?.id}
      />
      <MediaActionMenu
        isPinned={mediaActionMessage ? pinnedMessageIds.has(mediaActionMessage.id) : false}
        canDelete={canUseMessageWriteActions}
        canForwardAndSelect={canSaveMediaToPhone}
        canSaveToPhone={canSaveMediaToPhone}
        localizationKey={[t('messageOptions'), t('pin'), t('unpin'), t('reply'), t('forward'), t('select'), t('saveInPhone'), t('share'), t('report'), t('delete')].join('|')}
        labels={{
          delete: t('delete'),
          forward: t('forward'),
          messageOptions: t('messageOptions'),
          pin: t('pin'),
          reply: t('reply'),
          report: t('report'),
          saveInPhone: t('saveInPhone'),
          select: t('select'),
          share: t('share'),
          unpin: t('unpin'),
        }}
        message={isSystemChat ? null : mediaActionMessage}
        onCancel={() => setMediaActionMessage(null)}
        onDelete={deleteSelectedMenuMessage}
        onForward={forwardSelectedMenuMessage}
        onPin={pinSelectedMenuMessage}
        onReact={reactToSelectedMessage}
        onReply={replyToSelectedMessage}
        onSave={(message) => void saveMessageMedia(message)}
        onShare={(message) => void shareMessageMedia(message)}
        onReport={reportSelectedMessage}
        onSelect={startSelectingMessage}
        onUnpin={unpinSelectedMenuMessage}
        canReply={canUseMessageWriteActions}
        canPin={canPinMessages}
        userId={user?.id}
      />
      <ForwardMessageModal
        chatTargets={directChatTargets}
        contactTargets={contactTargets}
        messages={forwardingMessages}
        onClose={() => setForwardingMessages([])}
        onSelect={(target) => void forwardSelectedMessage(target)}
      />
      <GroupCallMemberPicker
        language={language}
        members={groupCallCandidates}
        mode={groupCallPickerMode}
        onClose={closeGroupCallPicker}
        onStart={startSelectedGroupCall}
        onToggle={toggleGroupCallMember}
        selectedMemberIds={selectedGroupCallMemberIds}
      />
      <ChatHeaderMenu
        isGroupAdmin={isGroupAdmin}
        isGroup={route.params.isGroup === true}
        isMuted={isConversationMuted(conversation)}
        isOwner={conversation?.ownerId === user?.id}
        isSystem={isSystemChat}
        onClear={confirmClearLocalChat}
        onBlock={confirmBlockCurrentUser}
        onClose={() => setChatHeaderMenuVisible(false)}
        onLeave={confirmLeaveGroup}
        onReport={confirmReportCurrentChat}
        onToggleMute={toggleHeaderMute}
        visible={!isSystemChat && isChatHeaderMenuVisible}
      />
      <OptionPickerModal
        onClose={() => setMuteDurationMenuVisible(false)}
        options={CONVERSATION_MUTE_OPTIONS.map((option) => ({
          icon: 'notifications-off-outline' as const,
          key: option.labelKey,
          label: t(option.labelKey, {}, language),
          onPress: () => {
            setMuteDurationMenuVisible(false);
            if (!conversation) {
              return;
            }
            void updateConversationMute(conversation.id, true, option.durationMinutes).catch((error) => {
              Alert.alert(t('mutedFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
            });
          },
        }))}
        title={t(route.params.isGroup === true ? 'muteGroup' : 'muteChat', {}, language)}
        visible={isMuteDurationMenuVisible}
      />
      <ChatInfoModal
        bottomInset={insets.bottom}
        conversation={conversation}
        fallbackTitle={route.params.title}
        isGroup={route.params.isGroup === true}
        isGroupAdmin={isGroupAdmin}
        isOwner={conversation?.ownerId === user?.id}
        chatTargets={directChatTargets}
        contactTargets={contactTargets}
        onAddGroupAdmins={addGroupAdmins}
        onAddGroupMembers={addGroupMembers}
        onChangeGroupPicture={showGroupPictureActions}
        onChangeGroupSettings={updateGroupSettings}
        onChangeGroupTitle={updateGroupTitle}
        onChangeDisappearingMessages={changeDisappearingMessages}
        onClose={() => setInfoVisible(false)}
        onDeleteGroup={async (conversationId) => {
          await deleteGroup(conversationId);
          setInfoVisible(false);
          navigation.goBack();
        }}
        onRemoveGroupMember={removeGroupMember}
        onRevokeGroupAdmin={revokeGroupAdmin}
        onSearch={openChatSearch}
        onOpenFile={(message) => void openChatGalleryFile(message)}
        onOpenMedia={setViewerMessage}
        onOpenSubscription={() => navigation.navigate('Subscription')}
        onOpenUrl={(url) => void Linking.openURL(url).catch(() => undefined)}
        onShowInChat={showMessageFromInfo}
        onStartCall={(mode) => void confirmStartCall(mode)}
        onTransferGroupOwnership={transferGroupOwnership}
        messages={archivedMessages}
        otherUser={otherUser}
        visible={!isSystemChat && isInfoVisible}
      />
      <OptionPickerModal
        description={t('chooseDisappearingMessagesDuration', {}, language)}
        onClose={closeDisappearingMessagesDurationMenu}
        options={DISAPPEARING_MESSAGES_OPTIONS.map((option) => ({
          icon: 'time-outline' as const,
          key: option.labelKey,
          label: t(option.labelKey, {}, language),
          onPress: () => chooseDisappearingMessagesDuration(option.durationMinutes, option.labelKey),
        }))}
        title={t('autoDisappearingMessages', {}, language)}
        visible={isDisappearingMessagesDurationMenuVisible}
      />
      <ComposerEditMenu
        hasSelection={draftSelection.end > draftSelection.start}
        hasText={draft.length > 0}
        onClose={() => setComposerEditMenuVisible(false)}
        onCopy={() => void copyComposerSelection()}
        onCut={() => void cutComposerSelection()}
        onPaste={() => void pasteIntoComposer()}
        onSelectAll={() => {
          setComposerEditMenuVisible(false);
          setDraftSelection({ end: draft.length, start: 0 });
        }}
        visible={isComposerEditMenuVisible}
      />
    </View>
  );
}

function ComposerEditMenu({
  hasSelection,
  hasText,
  onClose,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  visible,
}: {
  hasSelection: boolean;
  hasText: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{t('textOptions')}</Text>
          <ActionMenuButton icon="clipboard-outline" label={t('paste')} onPress={onPaste} />
          {hasSelection ? <ActionMenuButton icon="copy-outline" label={t('copy')} onPress={onCopy} /> : null}
          {hasSelection ? <ActionMenuButton icon="cut-outline" label={t('cut')} onPress={onCut} /> : null}
          {hasText ? <ActionMenuButton icon="scan-outline" label={t('selectAll')} onPress={onSelectAll} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type MessageRowProps = {
  canRedialCallMessage: boolean;
  isMine: boolean;
  isPinned: boolean;
  isPlayingVoice: boolean;
  isSelected: boolean;
  isSelectionMode: boolean;
  message: Message;
  onCancelUpload: (messageId: string) => void;
  onLongPress: (message: Message) => void;
  onOpenCall: (message: Message) => void;
  onOpenDisappearing: (message: Message) => void;
  onOpenMedia: (message: Message) => void;
  onOpenReply: (messageId: string) => void;
  onPlayVoice: (message: Message) => void;
  onSwipeReply?: (message: Message) => void;
  onToggleSelected: (messageId: string) => void;
  showSender?: boolean;
  voicePlayed: boolean;
  voiceProgress: number;
};

const MessageRow = memo(function MessageRow({
  canRedialCallMessage,
  isMine,
  isPinned,
  isPlayingVoice,
  isSelected,
  isSelectionMode,
  message,
  onCancelUpload,
  onLongPress,
  onOpenCall,
  onOpenDisappearing,
  onOpenMedia,
  onOpenReply,
  onPlayVoice,
  onSwipeReply,
  onToggleSelected,
  showSender,
  voicePlayed,
  voiceProgress,
}: MessageRowProps) {
  const liveUploadProgress = useAppStore((state) => state.uploadProgressByMessageId[message.id]);
  const uploadProgress = liveUploadProgress ?? getInitialUploadProgress(message);

  return (
    <View style={styles.selectableMessageRow}>
      {isSelectionMode ? (
        <Pressable onPress={() => onToggleSelected(message.id)} style={styles.messageCheckbox}>
          <Ionicons color={isSelected ? colors.primary : colors.border} name={isSelected ? 'checkbox' : 'square-outline'} size={24} />
        </Pressable>
      ) : null}
      <Pressable
        disabled={!isSelectionMode}
        onPress={() => onToggleSelected(message.id)}
        style={styles.selectableMessageBubble}
      >
        <MessageBubble
          canRedialCallMessage={canRedialCallMessage}
          enableSwipeReply={!isSelectionMode && !!onSwipeReply}
          isMine={isMine}
          isPinned={isPinned}
          isPlayingVoice={isPlayingVoice}
          message={message}
          onCancelUpload={onCancelUpload}
          onLongPress={onLongPress}
          onOpenCall={onOpenCall}
          onOpenDisappearing={onOpenDisappearing}
          onOpenMedia={onOpenMedia}
          onOpenReply={onOpenReply}
          onPlayVoice={onPlayVoice}
          onSwipeReply={onSwipeReply}
          showSender={showSender}
          uploadProgress={uploadProgress}
          voicePlayed={voicePlayed}
          voiceProgress={voiceProgress}
        />
      </Pressable>
    </View>
  );
}, areMessageRowsEqual);

function areMessageRowsEqual(previous: Readonly<MessageRowProps>, next: Readonly<MessageRowProps>) {
  return previous.message === next.message &&
    previous.canRedialCallMessage === next.canRedialCallMessage &&
    previous.isMine === next.isMine &&
    previous.isPinned === next.isPinned &&
    previous.isPlayingVoice === next.isPlayingVoice &&
    previous.isSelected === next.isSelected &&
    previous.isSelectionMode === next.isSelectionMode &&
    previous.showSender === next.showSender &&
    previous.voicePlayed === next.voicePlayed &&
    previous.voiceProgress === next.voiceProgress;
}

const DateDivider = memo(function DateDivider({ label }: { label: string }) {
  return (
    <View style={styles.dateDividerRow}>
      <View style={styles.dateDividerPill}>
        <Text style={styles.dateDividerText}>{label}</Text>
      </View>
    </View>
  );
});

function PinnedMessageBanner({ language, message, onPress }: { language: AppLanguage; message: Message; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.pinnedBanner, pressed ? styles.pinnedBannerPressed : undefined]}>
      <View style={styles.pinnedBannerIcon}>
        <Ionicons color={colors.primary} name="pin" size={17} />
      </View>
      <View style={styles.pinnedBannerText}>
        <Text style={styles.pinnedBannerTitle}>{t('pinnedMessage', {}, language)}</Text>
        <Text numberOfLines={1} style={styles.pinnedBannerPreview}>{getPinnedMessageTitle(message, language)}</Text>
      </View>
      <Ionicons color={colors.textSecondary} name="chevron-forward" size={18} />
    </Pressable>
  );
}

function PinnedMessagesModal({
  canRemove,
  messages,
  onChangeSearch,
  onClose,
  onRemove,
  onSelect,
  query,
  visible,
}: {
  canRemove: boolean;
  messages: PinnedMessage[];
  onChangeSearch: (query: string) => void;
  onClose: () => void;
  onRemove: (item: PinnedMessage) => void;
  onSelect: (messageId: string) => void;
  query: string;
  visible: boolean;
}) {
  const language = getI18nLanguage();

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.pinnedModalBackdrop}>
        <Pressable style={styles.pinnedModalPanel}>
          <View style={styles.pinnedModalHeader}>
            <Text style={styles.pinnedModalTitle}>{t('pinnedMessages', {}, language)}</Text>
            <Pressable onPress={onClose} style={styles.pinnedModalClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.pinnedSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search" size={18} />
            <TextInput
              onChangeText={onChangeSearch}
              placeholder={t('searchPinnedMessages', {}, language)}
              placeholderTextColor={colors.mutedText}
              style={styles.pinnedSearchInput}
              value={query}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.pinnedList}>
            {messages.length > 0 ? messages.map((item) => (
              <View key={`${item.message.id}-${item.pinnedAt}-${item.scope}`} style={styles.pinnedRow}>
                <Pressable
                  onPress={() => onSelect(item.message.id)}
                  style={({ pressed }) => [styles.pinnedRowMain, pressed ? styles.pinnedRowPressed : undefined]}
                >
                  <PinnedMessageThumb message={item.message} />
                  <View style={styles.pinnedRowText}>
                    <Text numberOfLines={1} style={styles.pinnedRowTitle}>{getPinnedMessageTitle(item.message, language)}</Text>
                    <View style={styles.pinnedRowMeta}>
                      <Text style={styles.pinnedRowDate}>{formatPinnedDateTime(item.pinnedAt)}</Text>
                      <View style={styles.pinnedScopeBadge}>
                        <Text style={styles.pinnedScopeBadgeText}>{t(item.scope === 'all' ? 'pinnedForAll' : 'pinnedForMe', {}, language)}</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
                {canRemove ? (
                  <Pressable onPress={() => onRemove(item)} style={styles.pinnedRemoveButton}>
                    <Ionicons color={colors.danger} name="trash-outline" size={19} />
                  </Pressable>
                ) : null}
              </View>
            )) : (
              <Text style={styles.pinnedEmptyText}>{t('noPinnedMessages', {}, language)}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PinnedMessageThumb({ message }: { message: Message }) {
  const location = getMessageLocation(message);

  if ((message.kind === 'image' || message.kind === 'video') && message.mediaUri) {
    return (
      <View style={styles.pinnedThumb}>
        <Image resizeMode="cover" source={{ uri: message.mediaUri }} style={styles.pinnedThumbImage} />
        {message.kind === 'video' ? (
          <View style={styles.pinnedThumbOverlay}>
            <Ionicons color={colors.white} name="play" size={14} />
          </View>
        ) : null}
      </View>
    );
  }

  if (location) {
    return (
      <View style={styles.pinnedThumb}>
        <Image resizeMode="cover" source={{ uri: getPinnedStaticMapUrl(location) }} style={styles.pinnedThumbImage} />
        <View style={styles.pinnedThumbOverlay}>
          <Ionicons color={colors.white} name="location" size={14} />
        </View>
      </View>
    );
  }

  const icon: keyof typeof Ionicons.glyphMap = message.kind === 'voice'
    ? 'mic'
    : message.kind === 'file'
      ? 'document-text'
      : message.kind === 'text'
        ? 'chatbubble-outline'
        : 'document-text';

  return (
    <View style={styles.pinnedThumbIcon}>
      <Ionicons color={colors.primary} name={icon} size={20} />
    </View>
  );
}

type MessageActionMenuProps = {
  canDelete: boolean;
  canEdit: boolean;
  canForwardAndSelect: boolean;
  canPin: boolean;
  canReply: boolean;
  isPinned: boolean;
  labels: {
    copy: string;
    delete: string;
    edit: string;
    forward: string;
    messageOptions: string;
    pin: string;
    reply: string;
    report: string;
    select: string;
    unpin: string;
  };
  localizationKey: string;
  message: Message | null;
  onCancel: () => void;
  onCopy: (message: Message) => void;
  onDelete: (message: Message) => void;
  onEdit: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onReport: (message: Message) => void;
  onReply: (message: Message) => void;
  onSelect: (message: Message) => void;
  onUnpin: (message: Message) => void;
  userId?: string;
};

function MessageActionMenu({ canDelete, canEdit: canEditByPermission, canForwardAndSelect, canPin, canReply, isPinned, labels, localizationKey, message, onCancel, onCopy, onDelete, onEdit, onForward, onPin, onReact, onReport, onReply, onSelect, onUnpin, userId }: MessageActionMenuProps) {
  const canReport = !!message && message.senderId !== userId && !message.id.startsWith('local-');
  const canCopy = !!message && message.kind === 'text' && message.body.trim().length > 0;
  const canEdit = canEditByPermission && !!message && message.senderId === userId && message.kind === 'text' && !message.id.startsWith('local-');

  return (
    <Modal animationType="fade" key={`message-action-menu-${localizationKey}-${message?.id ?? 'none'}`} transparent visible={!!message} onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{labels.messageOptions}</Text>
          {message && !message.id.startsWith('local-') ? <ReactionQuickRow message={message} onReact={onReact} userId={userId} /> : null}
          {canCopy ? <ActionMenuButton icon="copy-outline" label={labels.copy} onPress={() => message && onCopy(message)} /> : null}
          {canEdit ? <ActionMenuButton icon="create-outline" label={labels.edit} onPress={() => message && onEdit(message)} /> : null}
          {canPin ? (
            isPinned
              ? <ActionMenuButton icon="pin" label={labels.unpin} onPress={() => message && onUnpin(message)} />
              : <ActionMenuButton icon="pin-outline" label={labels.pin} onPress={() => message && onPin(message)} />
          ) : null}
          {canReply ? <ActionMenuButton icon="arrow-undo-outline" label={labels.reply} onPress={() => message && onReply(message)} /> : null}
          {canForwardAndSelect ? (
            <>
              <ActionMenuButton icon="arrow-redo-outline" label={labels.forward} onPress={() => message && onForward(message)} />
              <ActionMenuButton icon="checkbox-outline" label={labels.select} onPress={() => message && onSelect(message)} />
            </>
          ) : null}
          {canReport ? <ActionMenuButton destructive icon="flag-outline" label={labels.report} onPress={() => message && onReport(message)} /> : null}
          {canDelete ? <ActionMenuButton destructive icon="trash-outline" label={labels.delete} onPress={() => message && onDelete(message)} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type MediaActionMenuProps = {
  canDelete: boolean;
  canForwardAndSelect: boolean;
  canPin: boolean;
  canReply: boolean;
  canSaveToPhone: boolean;
  isPinned: boolean;
  labels: {
    delete: string;
    forward: string;
    messageOptions: string;
    pin: string;
    reply: string;
    report: string;
    saveInPhone: string;
    select: string;
    share: string;
    unpin: string;
  };
  localizationKey: string;
  message: Message | null;
  onCancel: () => void;
  onDelete: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onReply: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  onReport: (message: Message) => void;
  onSelect: (message: Message) => void;
  onUnpin: (message: Message) => void;
  userId?: string;
};

function MediaActionMenu({ canDelete, canForwardAndSelect, canPin, canReply, canSaveToPhone, isPinned, labels, localizationKey, message, onCancel, onDelete, onForward, onPin, onReact, onReport, onReply, onSave, onShare, onSelect, onUnpin, userId }: MediaActionMenuProps) {
  const canReport = !!message && message.senderId !== userId && !message.id.startsWith('local-');

  return (
    <Modal animationType="fade" key={`media-action-menu-${localizationKey}-${message?.id ?? 'none'}`} transparent visible={!!message} onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{labels.messageOptions}</Text>
          {message ? (
            <>
              {!message.id.startsWith('local-') ? <ReactionQuickRow message={message} onReact={onReact} userId={userId} /> : null}
              {canPin ? (
                isPinned
                  ? <ActionMenuButton icon="pin" label={labels.unpin} onPress={() => onUnpin(message)} />
                  : <ActionMenuButton icon="pin-outline" label={labels.pin} onPress={() => onPin(message)} />
              ) : null}
              {canReply ? <ActionMenuButton icon="arrow-undo-outline" label={labels.reply} onPress={() => onReply(message)} /> : null}
              {canForwardAndSelect ? (
                <>
                  <ActionMenuButton icon="arrow-redo-outline" label={labels.forward} onPress={() => onForward(message)} />
                  <ActionMenuButton icon="checkbox-outline" label={labels.select} onPress={() => onSelect(message)} />
                </>
              ) : null}
              {canSaveToPhone ? (
                <>
                  <ActionMenuButton icon="download-outline" label={labels.saveInPhone} onPress={() => onSave(message)} />
                  <ActionMenuButton icon="share-social-outline" label={labels.share} onPress={() => onShare(message)} />
                </>
              ) : null}
              {canReport ? <ActionMenuButton destructive icon="flag-outline" label={labels.report} onPress={() => onReport(message)} /> : null}
              {canDelete ? <ActionMenuButton destructive icon="trash-outline" label={labels.delete} onPress={() => onDelete(message)} /> : null}
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionMenuButton({
  destructive = false,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.actionButton}>
      <Ionicons color={destructive ? colors.danger : colors.textPrimary} name={icon} size={21} />
      <Text style={[styles.actionButtonText, destructive ? styles.actionButtonTextDanger : undefined]}>{label}</Text>
    </Pressable>
  );
}

function ReactionQuickRow({
  message,
  onReact,
  userId,
}: {
  message: Message;
  onReact: (message: Message, emoji: string) => void;
  userId?: string;
}) {
  const metadata = message.metadata;
  const currentReaction = metadata &&
    typeof metadata === 'object' &&
    'reactions' in metadata &&
    metadata.reactions &&
    typeof metadata.reactions === 'object' &&
    userId
    ? (metadata.reactions as Record<string, string>)[userId]
    : undefined;

  return (
    <View style={styles.reactionQuickRow}>
      {QUICK_REACTION_EMOJIS.map((emoji) => (
        <Pressable
          accessibilityLabel={emoji}
          key={emoji}
          onPress={() => onReact(message, emoji)}
          style={[styles.reactionQuickButton, currentReaction === emoji ? styles.reactionQuickButtonActive : undefined]}
        >
          <Text style={styles.reactionQuickEmoji}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type EmojiGroup = {
  emojis: string[];
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
  label: string;
};

function EmojiPicker({
  bottomInset,
  groups,
  onSelect,
  onSelectGroup,
  selectedGroup,
  selectedGroupKey,
}: {
  bottomInset: number;
  groups: EmojiGroup[];
  onSelect: (emoji: string) => void;
  onSelectGroup: (key: string) => void;
  selectedGroup: EmojiGroup;
  selectedGroupKey: string;
}) {
  return (
    <View style={[styles.emojiPanel, { paddingBottom: Math.max(spacing.sm, bottomInset + spacing.xs) }]}>
      <View style={styles.emojiTabs}>
        {groups.map((group) => (
          <Pressable
            accessibilityLabel={group.label}
            key={group.key}
            onPress={() => onSelectGroup(group.key)}
            style={[styles.emojiTab, selectedGroupKey === group.key ? styles.emojiTabActive : undefined]}
          >
            <Ionicons color={selectedGroupKey === group.key ? colors.white : colors.textSecondary} name={group.icon} size={20} />
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {selectedGroup.emojis.map((emoji) => (
          <Pressable key={`${selectedGroup.key}-${emoji}`} onPress={() => onSelect(emoji)} style={styles.emojiButton}>
            <Text style={styles.emojiText}>{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function VoiceEffectModal({
  bottomInset,
  durationSeconds,
  isProcessing,
  onCancel,
  onSelect,
  onSend,
  primaryLabel,
  selectedEffectId,
  subtitle,
  visible,
}: {
  bottomInset: number;
  durationSeconds?: number;
  isProcessing: boolean;
  onCancel: () => void;
  onSelect: (effectId: VoiceEffectId) => void;
  onSend: () => void;
  primaryLabel?: string;
  selectedEffectId: VoiceEffectId;
  subtitle?: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <Pressable onPress={isProcessing ? undefined : onCancel} style={styles.captionBackdrop}>
        <Pressable style={[styles.voiceEffectPanel, { paddingBottom: Math.max(spacing.md, bottomInset + spacing.sm) }]}>
          <Text style={styles.voiceEffectTitle}>{t('voiceEffectTitle')}</Text>
          <Text style={styles.voiceEffectSubtitle}>
            {subtitle ?? (durationSeconds ? t('voiceEffectSubtitleWithDuration', { seconds: Math.max(1, Math.round(durationSeconds)) }) : t('voiceEffectSubtitle'))}
          </Text>
          <View style={styles.voiceEffectList}>
            {VOICE_EFFECTS.map((effect) => {
              const isSelected = selectedEffectId === effect.id;

              return (
                <Pressable
                  disabled={isProcessing}
                  key={effect.id}
                  onPress={() => onSelect(effect.id)}
                  style={[styles.voiceEffectOption, isSelected ? styles.voiceEffectOptionSelected : undefined]}
                >
                  <View style={styles.voiceEffectOptionIcon}>
                    <Ionicons color={isSelected ? colors.white : colors.primary} name={effect.icon} size={18} />
                  </View>
                  <View style={styles.voiceEffectOptionText}>
                    <Text style={[styles.voiceEffectOptionTitle, isSelected ? styles.voiceEffectOptionTitleSelected : undefined]}>
                      {t(effect.titleKey)}
                    </Text>
                    <Text style={[styles.voiceEffectOptionDescription, isSelected ? styles.voiceEffectOptionDescriptionSelected : undefined]}>
                      {t(effect.descriptionKey)}
                    </Text>
                  </View>
                  {isSelected ? <Ionicons color={colors.white} name="checkmark-circle" size={22} /> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.voiceEffectActions}>
            <Pressable disabled={isProcessing} onPress={onCancel} style={styles.voiceEffectSecondaryButton}>
              <Text style={styles.voiceEffectSecondaryButtonText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable disabled={isProcessing} onPress={onSend} style={[styles.voiceEffectPrimaryButton, isProcessing ? styles.voiceEffectPrimaryButtonDisabled : undefined]}>
              {isProcessing ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.voiceEffectPrimaryButtonText}>{primaryLabel ?? t('send')}</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const AttachmentCaptionModal = memo(function AttachmentCaptionModal({
  attachment,
  bottomInset,
  caption,
  onCancel,
  onChangeCaption,
  onDraw,
  onLongPressSend,
  onSend,
}: {
  attachment: PendingCaptionAttachment | null;
  bottomInset: number;
  caption: string;
  onCancel: () => void;
  onChangeCaption: (caption: string) => void;
  onDraw: (attachment: PendingCaptionAttachment) => void;
  onLongPressSend: () => void;
  onSend: () => void;
}) {
  const panelBottomPadding = spacing.lg + Math.max(bottomInset, Platform.OS === 'android' ? spacing.xl : spacing.sm);
  const inputRef = useRef<TextInput | null>(null);
  const visible = !!attachment;

  return (
    <Modal animationType="slide" navigationBarTranslucent statusBarTranslucent transparent visible={visible} onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.captionBackdrop}
      >
        <Pressable onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View style={[styles.captionPanel, { paddingBottom: panelBottomPadding }]}>
          <View style={styles.captionHeader}>
            <Text style={styles.captionTitle}>{t('addCaption')}</Text>
            <View style={styles.captionHeaderActions}>
              {attachment?.kind === 'image' ? (
                <Pressable accessibilityLabel={t('drawOnImage')} onPress={() => onDraw(attachment)} style={styles.captionToolButton}>
                  <Ionicons color={colors.primary} name="brush-outline" size={21} />
                </Pressable>
              ) : null}
              <Pressable accessibilityLabel={t('close')} onPress={onCancel} style={styles.forwardClose}>
                <Ionicons color={colors.textSecondary} name="close" size={22} />
              </Pressable>
            </View>
          </View>
          {attachment ? <AttachmentCaptionPreview attachment={attachment} /> : null}
          <View style={styles.captionInputRow}>
            <TextInput
              ref={inputRef}
              multiline
              onChangeText={onChangeCaption}
              placeholder={t('writeCaption')}
              placeholderTextColor={colors.mutedText}
              style={styles.captionInput}
              value={caption}
            />
            <Pressable
              accessibilityLabel={t('send')}
              onLongPress={() => {
                inputRef.current?.blur();
                onLongPressSend();
              }}
              onPress={onSend}
              style={styles.captionSendButton}
            >
              <Ionicons color={colors.white} name="send" size={20} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

function EditMessageModal({
  draft,
  isSaving,
  onCancel,
  onChangeDraft,
  onSave,
  visible,
}: {
  draft: string;
  isSaving: boolean;
  onCancel: () => void;
  onChangeDraft: (draft: string) => void;
  onSave: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const canSave = draft.trim().length > 0 && !isSaving;

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, Platform.OS === 'android' ? 260 : 120);

    return () => clearTimeout(focusTimer);
  }, [visible]);

  return (
    <Modal animationType="slide" navigationBarTranslucent statusBarTranslucent transparent visible={visible} onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.editMessageKeyboardAvoider}
      >
        <Pressable onPress={isSaving ? undefined : onCancel} style={styles.captionBackdrop}>
          <Pressable style={[styles.captionPanel, { paddingBottom: spacing.lg + Math.max(insets.bottom, spacing.sm) }]}>
            <View style={styles.captionHeader}>
              <Text style={styles.captionTitle}>{t('editMessage')}</Text>
              <Pressable disabled={isSaving} onPress={onCancel} style={styles.forwardClose}>
                <Ionicons color={colors.textSecondary} name="close" size={22} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              ref={inputRef}
              multiline
              onChangeText={onChangeDraft}
              placeholder={t('message')}
              placeholderTextColor={colors.mutedText}
              style={styles.editMessageInput}
              value={draft}
            />
            <View style={styles.editMessageActions}>
              <Pressable disabled={isSaving} onPress={onCancel} style={styles.editMessageSecondaryButton}>
                <Text style={styles.editMessageSecondaryText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={!canSave}
                onPress={onSave}
                style={[styles.editMessagePrimaryButton, !canSave && styles.editMessageButtonDisabled]}
              >
                {isSaving ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.editMessagePrimaryText}>{t('save')}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SendOptionsModal({
  dateDraft,
  disappearSecondsDraft,
  hourDraft,
  minuteDraft,
  mode,
  onCancel,
  onChangeDate,
  onChangeDisappearSeconds,
  onChangeHour,
  onChangeMinute,
  onChangeSecond,
  onOpenDisappear,
  onOpenSchedule,
  onSendDisappear,
  onSendSchedule,
  secondDraft,
}: {
  dateDraft: string;
  disappearSecondsDraft: string;
  hourDraft: string;
  minuteDraft: string;
  mode: null | 'menu' | 'schedule' | 'disappear';
  onCancel: () => void;
  onChangeDate: (value: string) => void;
  onChangeDisappearSeconds: (value: string) => void;
  onChangeHour: (value: string) => void;
  onChangeMinute: (value: string) => void;
  onChangeSecond: (value: string) => void;
  onOpenDisappear: () => void;
  onOpenSchedule: () => void;
  onSendDisappear: () => void;
  onSendSchedule: () => void;
  secondDraft: string;
}) {
  return (
    <Modal animationType="fade" transparent visible={!!mode} onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={styles.actionBackdrop}>
        <Pressable style={styles.sendOptionsPanel}>
          <View style={styles.captionHeader}>
            <Text style={styles.captionTitle}>{t('sendOptions')}</Text>
            <Pressable accessibilityLabel={t('close')} onPress={onCancel} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          {mode === 'menu' ? (
            <>
              <ActionMenuButton icon="time-outline" label={t('scheduledMessage')} onPress={onOpenSchedule} />
              <ActionMenuButton icon="eye-off-outline" label={t('disappearingMessage')} onPress={onOpenDisappear} />
            </>
          ) : null}
          {mode === 'schedule' ? (
            <View style={styles.sendOptionsForm}>
              <Text style={styles.sendOptionsHint}>{t('scheduledMessageHint')}</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                onChangeText={onChangeDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedText}
                style={styles.sendOptionsInput}
                value={dateDraft}
              />
              <View style={styles.sendOptionsTimeRow}>
                <SmallTimeInput label={t('hour')} onChangeText={onChangeHour} value={hourDraft} />
                <SmallTimeInput label={t('minute')} onChangeText={onChangeMinute} value={minuteDraft} />
                <SmallTimeInput label={t('second')} onChangeText={onChangeSecond} value={secondDraft} />
              </View>
              <Pressable onPress={onSendSchedule} style={styles.editMessagePrimaryButton}>
                <Text style={styles.editMessagePrimaryText}>{t('scheduleSend')}</Text>
              </Pressable>
            </View>
          ) : null}
          {mode === 'disappear' ? (
            <View style={styles.sendOptionsForm}>
              <Text style={styles.sendOptionsHint}>{t('disappearingMessageHint')}</Text>
              <TextInput
                keyboardType="number-pad"
                onChangeText={onChangeDisappearSeconds}
                placeholder={t('seconds')}
                placeholderTextColor={colors.mutedText}
                style={styles.sendOptionsInput}
                value={disappearSecondsDraft}
              />
              <Pressable onPress={onSendDisappear} style={styles.editMessagePrimaryButton}>
                <Text style={styles.editMessagePrimaryText}>{t('send')}</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SmallTimeInput({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) {
  return (
    <View style={styles.smallTimeInputWrap}>
      <Text style={styles.smallTimeInputLabel}>{label}</Text>
      <TextInput
        keyboardType="number-pad"
        maxLength={2}
        onChangeText={onChangeText}
        placeholder="00"
        placeholderTextColor={colors.mutedText}
        style={styles.smallTimeInput}
        value={value}
      />
    </View>
  );
}

function AttachmentCaptionPreview({ attachment }: { attachment: PendingCaptionAttachment }) {
  if (attachment.kind === 'image') {
    return <Image resizeMode="cover" source={{ uri: attachment.uri }} style={styles.captionImagePreview} />;
  }

  return (
    <View style={styles.captionFilePreview}>
      <Ionicons color={colors.primary} name={attachment.kind === 'video' ? 'videocam-outline' : 'document-text-outline'} size={34} />
      <View style={styles.captionFileText}>
        <Text numberOfLines={1} style={styles.captionFileName}>{attachment.fileName}</Text>
        <Text style={styles.captionFileMeta}>{attachment.kind === 'video' ? t('video') : formatBytes(attachment.sizeBytes)}</Text>
      </View>
    </View>
  );
}

function ImageDrawingModal({
  attachment,
  onCancel,
  onSend,
}: {
  attachment: PendingCaptionAttachment | null;
  onCancel: () => void;
  onSend: (strokes: ImageDrawingStroke[]) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [strokes, setStrokes] = useState<ImageDrawingStroke[]>([]);
  const [selectedColor, setSelectedColor] = useState<string>(DRAWING_COLORS[2]);
  const [colorRailWidth, setColorRailWidth] = useState(1);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [isSending, setSending] = useState(false);

  useEffect(() => {
    if (!attachment) {
      setStrokes([]);
      setSending(false);
      return undefined;
    }

    setStrokes([]);
    setSending(false);

    let isMounted = true;

    Image.getSize(
      attachment.uri,
      (width, height) => {
        if (isMounted && width > 0 && height > 0) {
          setImageAspectRatio(width / height);
        }
      },
      () => {
        if (isMounted) {
          setImageAspectRatio(1);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [attachment?.uri]);

  const availableWidth = Math.max(1, window.width - spacing.lg * 2);
  const availableHeight = Math.max(1, window.height - insets.top - insets.bottom - 172);
  let imageWidth = availableWidth;
  let imageHeight = imageWidth / Math.max(0.1, imageAspectRatio);

  if (imageHeight > availableHeight) {
    imageHeight = availableHeight;
    imageWidth = imageHeight * Math.max(0.1, imageAspectRatio);
  }

  const addStrokePoint = useCallback((event: GestureResponderEvent, createStroke: boolean) => {
    const point = normalizeDrawingPoint(event, imageWidth, imageHeight);

    if (!point) {
      return;
    }

    setStrokes((current) => {
      if (createStroke || current.length === 0) {
        return [...current, { color: selectedColor, points: [point], width: DRAWING_STROKE_WIDTH }];
      }

      const next = [...current];
      const lastStroke = next[next.length - 1];
      const lastPoint = lastStroke.points[lastStroke.points.length - 1];

      if (lastPoint && Math.abs(lastPoint.x - point.x) < 0.003 && Math.abs(lastPoint.y - point.y) < 0.003) {
        return current;
      }

      next[next.length - 1] = {
        ...lastStroke,
        points: [...lastStroke.points, point],
      };
      return next;
    });
  }, [imageHeight, imageWidth, selectedColor]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => addStrokePoint(event, true),
    onPanResponderMove: (event) => addStrokePoint(event, false),
    onStartShouldSetPanResponder: () => true,
  }), [addStrokePoint]);

  function selectColorFromRail(event: GestureResponderEvent) {
    const x = clamp(event.nativeEvent.locationX, 0, colorRailWidth);
    const ratio = colorRailWidth <= 0 ? 0 : x / colorRailWidth;
    const index = clamp(Math.round(ratio * (DRAWING_COLORS.length - 1)), 0, DRAWING_COLORS.length - 1);

    setSelectedColor(DRAWING_COLORS[index]);
  }

  async function sendEditedImage() {
    if (isSending) {
      return;
    }

    setSending(true);

    try {
      await onSend(strokes);
    } catch (error) {
      Alert.alert(t('imageDrawingFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      setSending(false);
    }
  }

  const selectedColorIndex = Math.max(0, DRAWING_COLORS.findIndex((color) => color === selectedColor));
  const colorThumbLeft = colorRailWidth <= 1
    ? 0
    : Math.max(0, (selectedColorIndex / (DRAWING_COLORS.length - 1)) * colorRailWidth - 10);

  return (
    <Modal animationType="slide" statusBarTranslucent visible={!!attachment} onRequestClose={() => {
      if (!isSending) {
        onCancel();
      }
    }}>
      <View style={[styles.drawingScreen, { paddingBottom: Math.max(insets.bottom, spacing.sm), paddingTop: Math.max(insets.top, spacing.md) }]}>
        <View style={styles.drawingHeader}>
          <Pressable disabled={isSending} onPress={onCancel} style={styles.drawingIconButton}>
            <Ionicons color={colors.white} name="close" size={24} />
          </Pressable>
          <Text numberOfLines={1} style={styles.drawingTitle}>{t('drawOnImage')}</Text>
          <View style={styles.drawingHeaderActions}>
            <Pressable disabled={isSending || strokes.length === 0} onPress={() => setStrokes((current) => current.slice(0, -1))} style={[styles.drawingIconButton, strokes.length === 0 && styles.drawingButtonDisabled]}>
              <Ionicons color={colors.white} name="arrow-undo" size={22} />
            </Pressable>
            <Pressable disabled={isSending} onPress={() => void sendEditedImage()} style={[styles.drawingSendButton, isSending && styles.drawingButtonDisabled]}>
              {isSending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.drawingSendText}>{t('send')}</Text>}
            </Pressable>
          </View>
        </View>

        <View style={styles.drawingCanvasWrap}>
          {attachment ? (
            <View style={[styles.drawingCanvas, { height: imageHeight, width: imageWidth }]} {...panResponder.panHandlers}>
              <Image resizeMode="contain" source={{ uri: attachment.uri }} style={StyleSheet.absoluteFillObject} />
              <Svg height={imageHeight} style={StyleSheet.absoluteFillObject} width={imageWidth}>
                {strokes.map((stroke, index) => (
                  <SvgPath
                    key={`${stroke.color}-${index}`}
                    d={getDrawingPath(stroke, imageWidth, imageHeight)}
                    fill="none"
                    stroke={stroke.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={Math.max(3, stroke.width * Math.min(imageWidth, imageHeight))}
                  />
                ))}
              </Svg>
            </View>
          ) : null}
        </View>

        <View style={styles.drawingTools}>
          <Text style={styles.drawingToolLabel}>{t('chooseColor')}</Text>
          <View
            onLayout={(event) => setColorRailWidth(Math.max(1, event.nativeEvent.layout.width))}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={selectColorFromRail}
            onResponderMove={selectColorFromRail}
            onStartShouldSetResponder={() => true}
            style={styles.drawingColorRailWrap}
          >
            <LinearGradient colors={DRAWING_COLORS} end={{ x: 1, y: 0 }} start={{ x: 0, y: 0 }} style={styles.drawingColorRail} />
            <View style={[styles.drawingColorThumb, { backgroundColor: selectedColor, left: colorThumbLeft }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function normalizeDrawingPoint(event: GestureResponderEvent, width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: clamp(event.nativeEvent.locationX / width, 0, 1),
    y: clamp(event.nativeEvent.locationY / height, 0, 1),
  };
}

function getDrawingPath(stroke: ImageDrawingStroke, width: number, height: number) {
  if (stroke.points.length === 0) {
    return '';
  }

  const [firstPoint, ...rest] = stroke.points;
  const firstX = firstPoint.x * width;
  const firstY = firstPoint.y * height;

  if (rest.length === 0) {
    return `M ${firstX} ${firstY} L ${firstX + 0.1} ${firstY + 0.1}`;
  }

  return rest.reduce(
    (path, point) => `${path} L ${point.x * width} ${point.y * height}`,
    `M ${firstX} ${firstY}`,
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

type GroupHeaderMenuProps = {
  isGroup: boolean;
  isGroupAdmin?: boolean;
  isMuted: boolean;
  isOwner?: boolean;
  isSystem?: boolean;
  onClear: () => void;
  onBlock: () => void;
  onClose: () => void;
  onLeave: () => void;
  onReport: () => void;
  onToggleMute: () => void;
  visible: boolean;
};

function ChatHeaderMenu({ isGroup, isGroupAdmin, isMuted, isOwner, isSystem, onBlock, onClear, onClose, onLeave, onReport, onToggleMute, visible }: GroupHeaderMenuProps) {
  const shouldHideAdminOwnerGroupActions = isGroup && (isGroupAdmin || isOwner);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{t(isGroup ? 'groupOptions' : 'chatOptions')}</Text>
          <ActionMenuButton
            icon={isMuted ? 'notifications-outline' : 'notifications-off-outline'}
            label={isMuted ? t(isGroup ? 'unmuteGroup' : 'unmuteChat') : t(isGroup ? 'muteGroup' : 'muteChat')}
            onPress={onToggleMute}
          />
          {isSystem || shouldHideAdminOwnerGroupActions ? null : <ActionMenuButton destructive icon="flag-outline" label={t(isGroup ? 'reportGroup' : 'reportUser')} onPress={onReport} />}
          {!isGroup && !isSystem ? <ActionMenuButton destructive icon="ban-outline" label={t('blockUser')} onPress={onBlock} /> : null}
          {shouldHideAdminOwnerGroupActions ? null : <ActionMenuButton destructive icon="trash-outline" label={t('clearChat')} onPress={onClear} />}
          {isGroup && !isOwner ? <ActionMenuButton destructive icon="exit-outline" label={t('leaveGroup')} onPress={onLeave} /> : null}
          <ActionMenuButton icon="close-outline" label={t('cancel')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function OptionPickerModal({
  description,
  onClose,
  options,
  title,
  visible,
}: {
  description?: string;
  onClose: () => void;
  options: Array<{ icon: keyof typeof Ionicons.glyphMap; key: string; label: string; onPress: () => void }>;
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.actionBackdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{title}</Text>
          {description ? <Text style={styles.optionPickerDescription}>{description}</Text> : null}
          {options.map((option) => (
            <ActionMenuButton icon={option.icon} key={option.key} label={option.label} onPress={option.onPress} />
          ))}
          <ActionMenuButton icon="close-outline" label={t('cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

type ForwardMessageModalProps = {
  chatTargets: ForwardTarget[];
  contactTargets: ForwardTarget[];
  messages: Message[];
  onClose: () => void;
  onSelect: (target: ForwardTarget) => void;
};

const MAX_FORWARD_TARGETS = 100;

function ForwardMessageModal({ chatTargets, contactTargets, messages, onClose, onSelect }: ForwardMessageModalProps) {
  const insets = useSafeAreaInsets();
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const normalizedSearch = debouncedSearch.trim().toLowerCase();
  const filteredChatTargets = useMemo(() => filterForwardTargetsByAnySearch(chatTargets, normalizedSearch), [chatTargets, normalizedSearch]);
  const filteredContactTargets = useMemo(() => filterForwardTargetsByAnySearch(contactTargets, normalizedSearch), [contactTargets, normalizedSearch]);
  const visibleChatTargets = filteredChatTargets.slice(0, MAX_FORWARD_TARGETS);
  const visibleContactTargets = filteredContactTargets.slice(0, MAX_FORWARD_TARGETS - visibleChatTargets.length);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchDraft.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    if (messages.length === 0) {
      setSearchDraft('');
      setDebouncedSearch('');
    }
  }, [messages.length]);

  return (
    <Modal
      animationType="slide"
      navigationBarTranslucent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={messages.length > 0}
    >
      <Pressable onPress={onClose} style={styles.infoBackdrop}>
        <Pressable style={[styles.forwardPanel, { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.lg) }]}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{messages.length > 1 ? `Forward ${messages.length} messages to` : 'Forward to'}</Text>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.modalSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchDraft}
              placeholder={t('searchPeople')}
              placeholderTextColor={colors.mutedText}
              style={styles.modalSearchInput}
              value={searchDraft}
            />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {visibleChatTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('chats')}</Text>
                {visibleChatTargets.map((target) => (
                  <ForwardTargetRow key={`chat-${target.user.id}`} target={target} onPress={() => onSelect(target)} />
                ))}
              </>
            ) : null}
            {visibleChatTargets.length > 0 && visibleContactTargets.length > 0 ? <View style={styles.forwardDivider} /> : null}
            {visibleContactTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('contacts')}</Text>
                {visibleContactTargets.map((target) => (
                  <ForwardTargetRow key={`contact-${target.user.id}`} target={target} onPress={() => onSelect(target)} />
                ))}
              </>
            ) : null}
            {visibleChatTargets.length === 0 && visibleContactTargets.length === 0 ? (
              <Text style={styles.forwardEmpty}>{normalizedSearch ? t('noPeopleFound') : t('noContactsToShare')}</Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ForwardTargetRow({ onPress, target }: { onPress: () => void; target: ForwardTarget }) {
  return (
    <Pressable onPress={onPress} style={styles.forwardRow}>
      <Avatar label={target.title} size={42} uri={target.user.avatarUrl} />
      <View style={styles.forwardRowText}>
        <Text numberOfLines={1} style={styles.forwardName}>{target.title}</Text>
        {target.user.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{target.user.username}</Text> : null}
      </View>
      <Ionicons color={colors.primary} name="send" size={18} />
    </Pressable>
  );
}

type ShareContactPickerModalProps = {
  contacts: AuthUser[];
  onClose: () => void;
  onSelect: (contact: AuthUser) => void;
  visible: boolean;
};

function ShareContactPickerModal({ contacts, onClose, onSelect, visible }: ShareContactPickerModalProps) {
  const [searchDraft, setSearchDraft] = useState('');
  const normalizedSearch = searchDraft.trim().toLowerCase();
  const filteredContacts = useMemo(() => {
    if (normalizedSearch.length < 2) {
      return contacts;
    }

    return contacts.filter((contact) => (
      (contact.displayName || '').toLowerCase().includes(normalizedSearch) ||
      (contact.username || '').toLowerCase().includes(normalizedSearch)
    ));
  }, [contacts, normalizedSearch]);

  useEffect(() => {
    if (!visible) {
      setSearchDraft('');
    }
  }, [visible]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.infoBackdrop}>
        <Pressable style={styles.forwardPanel}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{t('chooseContactToShare')}</Text>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.modalSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchDraft}
              placeholder={t('searchContacts')}
              placeholderTextColor={colors.mutedText}
              style={styles.modalSearchInput}
              value={searchDraft}
            />
          </View>
          {searchDraft.trim().length > 0 && searchDraft.trim().length < 2 ? (
            <Text style={styles.modalSearchHint}>{t('enterAtLeast2CharactersToSearch')}</Text>
          ) : null}
          <ScrollView showsVerticalScrollIndicator={false}>
            {filteredContacts.length > 0 ? filteredContacts.map((contact) => (
              <Pressable key={contact.id} onPress={() => onSelect(contact)} style={styles.forwardRow}>
                <Avatar label={contact.displayName || contact.username || 'M'} size={42} uri={contact.avatarUrl} />
                <View style={styles.forwardRowText}>
                  <Text numberOfLines={1} style={styles.forwardName}>{contact.displayName || t('sharedContact')}</Text>
                  {contact.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{contact.username}</Text> : null}
                </View>
                <Ionicons color={colors.primary} name="send" size={18} />
              </Pressable>
            )) : (
              <Text style={styles.forwardEmpty}>{normalizedSearch.length >= 2 ? t('noPeopleFound') : t('noContactsToShare')}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ChatGallerySectionProps = {
  files: Message[];
  language: AppLanguage;
  links: ChatLinkItem[];
  media: Message[];
  onOpenFile: (message: Message) => void;
  onOpenMedia: (message: Message) => void;
  onOpenUrl: (url: string) => void;
  onSelectTab: (tab: ChatGalleryTab) => void;
  onShowInChat: (messageId: string) => void;
  selectedTab: ChatGalleryTab;
};

function ChatGallerySection({
  files,
  language,
  links,
  media,
  onOpenFile,
  onOpenMedia,
  onOpenUrl,
  onSelectTab,
  onShowInChat,
  selectedTab,
}: ChatGallerySectionProps) {
  const emptyText = selectedTab === 'media'
    ? t('noMediaInChat', {}, language)
    : selectedTab === 'files'
      ? t('noFilesInChat', {}, language)
      : t('noLinksInChat', {}, language);

  return (
    <View style={styles.chatGallerySection}>
      <Text style={styles.chatGalleryTitle}>{t('gallery', {}, language)}</Text>
      <View style={styles.chatGalleryTabs}>
        <ChatGalleryTabButton count={media.length} isActive={selectedTab === 'media'} label={t('galleryMedia', {}, language)} onPress={() => onSelectTab('media')} />
        <ChatGalleryTabButton count={files.length} isActive={selectedTab === 'files'} label={t('galleryFiles', {}, language)} onPress={() => onSelectTab('files')} />
        <ChatGalleryTabButton count={links.length} isActive={selectedTab === 'links'} label={t('galleryLinks', {}, language)} onPress={() => onSelectTab('links')} />
      </View>
      {selectedTab === 'media' && media.length > 0 ? (
        <View style={styles.chatGalleryGrid}>
          {media.map((message) => (
            <Pressable
              key={message.id}
              onLongPress={() => showGalleryItemActions(message.id, language, onShowInChat)}
              onPress={() => onOpenMedia(message)}
              style={styles.chatGalleryMediaTile}
            >
              {message.kind === 'image' && message.mediaUri ? (
                <Image resizeMode="cover" source={{ uri: message.mediaUri }} style={styles.chatGalleryMediaImage} />
              ) : (
                <ChatGalleryVideoTile message={message} />
              )}
              {message.kind === 'video' ? (
                <View style={styles.chatGalleryPlayButton}>
                  <Ionicons color={colors.white} name="play" size={22} />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {selectedTab === 'files' && files.length > 0 ? (
        <View style={styles.chatGalleryList}>
          {files.map((message) => (
            <Pressable
              key={message.id}
              onLongPress={() => showGalleryItemActions(message.id, language, onShowInChat)}
              onPress={() => onOpenFile(message)}
              style={({ pressed }) => [styles.chatGalleryFileRow, pressed ? styles.chatGalleryRowPressed : undefined]}
            >
              <View style={styles.chatGalleryFileIcon}>
                <Ionicons color={colors.primary} name="document-text-outline" size={22} />
              </View>
              <View style={styles.chatGalleryFileText}>
                <Text numberOfLines={1} style={styles.chatGalleryFileName}>{message.fileName ?? 'File'}</Text>
                <Text style={styles.chatGalleryFileMeta}>{formatBytes(message.sizeBytes)}</Text>
              </View>
              <Ionicons color={colors.textSecondary} name="open-outline" size={18} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {selectedTab === 'links' && links.length > 0 ? (
        <View style={styles.chatGalleryList}>
          {links.map((item) => (
            <Pressable
              key={item.id}
              onLongPress={() => showGalleryItemActions(item.message.id, language, onShowInChat)}
              onPress={() => onOpenUrl(item.url)}
              style={({ pressed }) => [styles.chatGalleryLinkRow, pressed ? styles.chatGalleryRowPressed : undefined]}
            >
              <View style={styles.chatGalleryFileIcon}>
                <Ionicons color={colors.primary} name="link-outline" size={22} />
              </View>
              <View style={styles.chatGalleryFileText}>
                <Text numberOfLines={1} style={styles.chatGalleryFileName}>{getLinkHost(item.url)}</Text>
                <Text numberOfLines={2} style={styles.chatGalleryLinkUrl}>{item.url}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {(selectedTab === 'media' && media.length === 0) || (selectedTab === 'files' && files.length === 0) || (selectedTab === 'links' && links.length === 0) ? (
        <Text style={styles.chatGalleryEmpty}>{emptyText}</Text>
      ) : null}
    </View>
  );
}

function ChatGalleryTabButton({ count, isActive, label, onPress }: { count: number; isActive: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chatGalleryTab, isActive ? styles.chatGalleryTabActive : undefined]}>
      <Text style={[styles.chatGalleryTabText, isActive ? styles.chatGalleryTabTextActive : undefined]}>{label}</Text>
      <Text style={[styles.chatGalleryTabCount, isActive ? styles.chatGalleryTabTextActive : undefined]}>{count}</Text>
    </Pressable>
  );
}

function ChatGalleryVideoTile({ message }: { message: Message }) {
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(() => getRememberedCachedVideoThumbnailUri({
    messageId: message.id,
    quality: 0.72,
    sourceSizeBytes: message.sizeBytes,
    sourceUri: message.mediaUri,
    timeMs: 800,
  }));

  useEffect(() => {
    let isMounted = true;

    async function loadThumbnail() {
      if (!message.mediaUri) {
        setThumbnailUri(null);
        return;
      }

      try {
        const sourceUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;
        const rememberedThumbnail = getRememberedCachedVideoThumbnailUri({
          messageId: message.id,
          quality: 0.72,
          sourceSizeBytes: message.sizeBytes,
          sourceUri,
          timeMs: 800,
        });

        if (rememberedThumbnail && isMounted) {
          setThumbnailUri(rememberedThumbnail);
        } else if (isMounted) {
          setThumbnailUri(null);
        }

        const thumbnail = await getCachedVideoThumbnailUri({
          messageId: message.id,
          quality: 0.72,
          sourceSizeBytes: message.sizeBytes,
          sourceUri,
          timeMs: 800,
        });

        if (isMounted) {
          setThumbnailUri(thumbnail);
        }
      } catch {
        if (isMounted) {
          setThumbnailUri(null);
        }
      }
    }

    void loadThumbnail();

    return () => {
      isMounted = false;
    };
  }, [message.id, message.mediaUri, message.sizeBytes]);

  if (thumbnailUri) {
    return <Image resizeMode="cover" source={{ uri: thumbnailUri }} style={styles.chatGalleryMediaImage} />;
  }

  return (
    <View style={styles.chatGalleryVideoFallback}>
      <Ionicons color={colors.white} name="videocam" size={24} />
    </View>
  );
}

function showGalleryItemActions(messageId: string, language: AppLanguage, onShowInChat: (messageId: string) => void) {
  Alert.alert(
    t('itemOptions', {}, language),
    undefined,
    [
      { text: t('showInChat', {}, language), onPress: () => onShowInChat(messageId) },
      { text: t('cancel', {}, language), style: 'cancel' },
    ],
  );
}

type AddSubscribersModalProps = {
  bottomInset: number;
  chatTargets: ForwardTarget[];
  contactTargets: ForwardTarget[];
  emptyText?: string;
  isAdding: boolean;
  language: AppLanguage;
  onClose: () => void;
  onSubmit: () => void;
  onToggle: (userId: string) => void;
  selectedUserIds: string[];
  submitLabel?: string;
  title?: string;
  visible: boolean;
};

function AddSubscribersModal({ bottomInset, chatTargets, contactTargets, emptyText, isAdding, language, onClose, onSubmit, onToggle, selectedUserIds, submitLabel, title, visible }: AddSubscribersModalProps) {
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const selectedUserIdSet = new Set(selectedUserIds);
  const selectedCount = selectedUserIds.length;
  const resolvedEmptyText = emptyText ?? t('noAvailablePeopleToAdd', {}, language);
  const resolvedSubmitLabel = submitLabel ?? t('add', {}, language);
  const resolvedTitle = title ?? t('addSubscribers', {}, language);
  const trimmedSearch = debouncedSearch.trim();
  const canFilter = trimmedSearch.length >= 2;
  const isSearchTooShort = searchDraft.trim().length > 0 && searchDraft.trim().length < 2;
  const filteredChatTargets = useMemo(() => (
    canFilter ? filterForwardTargets(chatTargets, trimmedSearch) : chatTargets
  ), [canFilter, chatTargets, trimmedSearch]);
  const filteredContactTargets = useMemo(() => (
    canFilter ? filterForwardTargets(contactTargets, trimmedSearch) : contactTargets
  ), [canFilter, contactTargets, trimmedSearch]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchDraft.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    if (!visible) {
      setSearchDraft('');
      setDebouncedSearch('');
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.addSubscribersOverlay}>
        <Pressable style={[styles.forwardPanel, { paddingBottom: Math.max(spacing.lg, bottomInset + spacing.lg) }]}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{resolvedTitle}</Text>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.modalSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchDraft}
              placeholder={t('searchPeople', {}, language)}
              placeholderTextColor={colors.mutedText}
              style={styles.modalSearchInput}
              value={searchDraft}
            />
          </View>
          {isSearchTooShort ? <Text style={styles.modalSearchHint}>{t('enterAtLeast2CharactersToSearch', {}, language)}</Text> : null}
          <ScrollView showsVerticalScrollIndicator={false}>
            {!isSearchTooShort && filteredChatTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('chats', {}, language)}</Text>
                {filteredChatTargets.map((target) => (
                  <SubscriberTargetRow
                    isSelected={selectedUserIdSet.has(target.user.id)}
                    key={`add-chat-${target.user.id}`}
                    onPress={() => onToggle(target.user.id)}
                    target={target}
                  />
                ))}
              </>
            ) : null}
            {!isSearchTooShort && filteredChatTargets.length > 0 && filteredContactTargets.length > 0 ? <View style={styles.forwardDivider} /> : null}
            {!isSearchTooShort && filteredContactTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('contacts', {}, language)}</Text>
                {filteredContactTargets.map((target) => (
                  <SubscriberTargetRow
                    isSelected={selectedUserIdSet.has(target.user.id)}
                    key={`add-contact-${target.user.id}`}
                    onPress={() => onToggle(target.user.id)}
                    target={target}
                  />
                ))}
              </>
            ) : null}
            {!isSearchTooShort && filteredChatTargets.length === 0 && filteredContactTargets.length === 0 ? (
              <Text style={styles.forwardEmpty}>{canFilter ? t('noPeopleFound', {}, language) : resolvedEmptyText}</Text>
            ) : null}
          </ScrollView>
          <Pressable
            disabled={selectedCount === 0 || isAdding}
            onPress={onSubmit}
            style={[styles.addSubscribersButton, selectedCount === 0 || isAdding ? styles.addSubscribersButtonDisabled : undefined]}
          >
            {isAdding ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons color={colors.white} name="person-add-outline" size={19} />
            )}
            <Text style={styles.addSubscribersButtonText}>{selectedCount > 0 ? `${resolvedSubmitLabel} ${selectedCount}` : resolvedSubmitLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SubscriberTargetRow({ isSelected, onPress, target }: { isSelected: boolean; onPress: () => void; target: ForwardTarget }) {
  return (
    <Pressable onPress={onPress} style={styles.forwardRow}>
      <Avatar label={target.title} size={42} uri={target.user.avatarUrl} />
      <View style={styles.forwardRowText}>
        <Text numberOfLines={1} style={styles.forwardName}>{target.title}</Text>
        {target.user.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{target.user.username}</Text> : null}
      </View>
      <View style={[styles.subscriberCheckbox, isSelected ? styles.subscriberCheckboxSelected : undefined]}>
        {isSelected ? <Ionicons color={colors.white} name="checkmark" size={16} /> : null}
      </View>
    </Pressable>
  );
}

type GroupCallMemberPickerProps = {
  language: AppLanguage;
  members: AuthUser[];
  mode: 'voice' | 'video' | null;
  onClose: () => void;
  onStart: () => void;
  onToggle: (userId: string) => void;
  selectedMemberIds: string[];
};

function GroupCallMemberPicker({ language, members, mode, onClose, onStart, onToggle, selectedMemberIds }: GroupCallMemberPickerProps) {
  const selectedMemberIdSet = new Set(selectedMemberIds);
  const maxInvitees = mode ? getGroupCallLimit(mode) - 1 : 0;

  return (
    <Modal animationType="slide" transparent visible={!!mode} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.infoBackdrop}>
        <Pressable style={styles.forwardPanel}>
          <View style={styles.forwardHeader}>
            <View style={styles.forwardHeaderText}>
              <Text style={styles.forwardTitle}>{t('choosePeople', {}, language)}</Text>
              <Text style={styles.forwardSubtitle}>
                {t('groupCallLimit', { mode: t(mode === 'video' ? 'video' : 'voice', {}, language), selected: selectedMemberIds.length, max: maxInvitees }, language)}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {members.map((member) => {
              const isSelected = selectedMemberIdSet.has(member.id);

              return (
                <Pressable key={member.id} onPress={() => onToggle(member.id)} style={styles.forwardRow}>
                  <Avatar label={member.displayName || member.username} size={42} uri={member.avatarUrl} />
                  <View style={styles.forwardRowText}>
                    <Text numberOfLines={1} style={styles.forwardName}>{member.displayName || member.username}</Text>
                    {member.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{member.username}</Text> : null}
                  </View>
                  <View style={[styles.subscriberCheckbox, isSelected ? styles.subscriberCheckboxSelected : undefined]}>
                    {isSelected ? <Ionicons color={colors.white} name="checkmark" size={16} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            disabled={selectedMemberIds.length === 0}
            onPress={onStart}
            style={[styles.addSubscribersButton, selectedMemberIds.length === 0 ? styles.addSubscribersButtonDisabled : undefined]}
          >
            <Ionicons color={colors.white} name={mode === 'video' ? 'videocam-outline' : 'call-outline'} size={19} />
            <Text style={styles.addSubscribersButtonText}>{t('startCall', {}, language)}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ChatInfoModalProps = {
  bottomInset: number;
  chatTargets: ForwardTarget[];
  contactTargets: ForwardTarget[];
  conversation?: Conversation;
  fallbackTitle: string;
  isGroup: boolean;
  isGroupAdmin: boolean;
  isOwner: boolean;
  messages: Message[];
  onAddGroupAdmins: (conversationId: string, userIds: string[]) => Promise<Conversation>;
  onAddGroupMembers: (conversationId: string, userIds: string[]) => Promise<Conversation>;
  onChangeGroupPicture: () => void;
  onChangeGroupSettings: (conversationId: string, input: { hideMembers?: boolean; isPublic?: boolean; ownerOnlyMessages?: boolean; preventMediaSave?: boolean; preventScreenshots?: boolean; showAdmins?: boolean; showMemberCount?: boolean }) => Promise<Conversation>;
  onChangeGroupTitle: (conversationId: string, title: string) => Promise<Conversation>;
  onChangeDisappearingMessages: (enabled: boolean) => void;
  onClose: () => void;
  onDeleteGroup: (conversationId: string) => Promise<void>;
  onOpenFile: (message: Message) => void;
  onOpenMedia: (message: Message) => void;
  onOpenSubscription: () => void;
  onOpenUrl: (url: string) => void;
  onRemoveGroupMember: (conversationId: string, userId: string) => Promise<Conversation>;
  onRevokeGroupAdmin: (conversationId: string, userId: string) => Promise<Conversation>;
  onSearch: () => void;
  onShowInChat: (messageId: string) => void;
  onStartCall: (mode: 'voice' | 'video') => void;
  onTransferGroupOwnership: (conversationId: string, userId: string) => Promise<Conversation>;
  otherUser: AuthUser | null;
  visible: boolean;
};

function ChatInfoModal({
  bottomInset,
  chatTargets,
  contactTargets,
  conversation,
  fallbackTitle,
  isGroup,
  isGroupAdmin,
  isOwner,
  messages,
  onAddGroupAdmins,
  onAddGroupMembers,
  onChangeGroupPicture,
  onChangeGroupSettings,
  onChangeGroupTitle,
  onChangeDisappearingMessages,
  onClose,
  onDeleteGroup,
  onOpenFile,
  onOpenMedia,
  onOpenSubscription,
  onOpenUrl,
  onRemoveGroupMember,
  onRevokeGroupAdmin,
  onSearch,
  onShowInChat,
  onStartCall,
  onTransferGroupOwnership,
  otherUser,
  visible,
}: ChatInfoModalProps) {
  const uiLanguage = useAppStore((state: { language: AppLanguage }) => state.language);
  const currentUserId = useAppStore((state) => state.user?.id);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const canUsePremiumFeatures = hasPremiumAccess(subscriptionStatus);
  const title = isGroup ? (conversation?.title ?? fallbackTitle) : (otherUser?.displayName ?? fallbackTitle);
  const shouldShowTitlePremiumBadge = !isGroup && otherUser?.hasPremiumAccess === true;
  const members = isGroup ? conversation?.members ?? EMPTY_MEMBERS : EMPTY_MEMBERS;
  const memberCount = isGroup ? conversation?.memberCount ?? members.length : 0;
  const presenceSubtitle = formatPresenceSubtitle(otherUser, uiLanguage);
  const subtitle = isGroup ? formatSubscriberCount(members.length, uiLanguage) : [otherUser?.username ? `@${otherUser.username}` : '', presenceSubtitle].filter(Boolean).join(' · ');
  const avatarUri = isGroup ? conversation?.avatarUrl : otherUser?.avatarUrl;
  const displaySubtitle = isGroup && conversation?.showMemberCount === false ? '' : isGroup ? formatSubscriberCount(memberCount, uiLanguage) : subtitle;
  const canShowCallActions = conversation?.isVoiceRoom !== true;
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [isSavingTitle, setSavingTitle] = useState(false);
  const [savingSetting, setSavingSetting] = useState<'hideMembers' | 'isPublic' | 'ownerOnlyMessages' | 'preventMediaSave' | 'preventScreenshots' | 'showAdmins' | 'showMemberCount' | null>(null);
  const [isAddingMembers, setAddingMembers] = useState(false);
  const [isAddingSelectedMembers, setAddingSelectedMembers] = useState(false);
  const [selectedAddMemberIds, setSelectedAddMemberIds] = useState<string[]>([]);
  const [isTransferPickerVisible, setTransferPickerVisible] = useState(false);
  const [transferTarget, setTransferTarget] = useState<AuthUser | null>(null);
  const [isTransferringOwnership, setTransferringOwnership] = useState(false);
  const [makeAdminTarget, setMakeAdminTarget] = useState<AuthUser | null>(null);
  const [isMakingAdmin, setMakingAdmin] = useState(false);
  const [isDeleteGroupConfirmVisible, setDeleteGroupConfirmVisible] = useState(false);
  const [isDeletingGroup, setDeletingGroup] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isMemberSearchVisible, setMemberSearchVisible] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [fullScreenPhotoUri, setFullScreenPhotoUri] = useState<string | null>(null);
  const [isGalleryModalVisible, setGalleryModalVisible] = useState(false);
  const [galleryTab, setGalleryTab] = useState<ChatGalleryTab>('media');
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const adminIdSet = useMemo(() => new Set(conversation?.adminIds ?? []), [conversation?.adminIds]);
  const shouldShowAdminBadges = conversation?.showAdmins !== false;
  const addChatTargets = useMemo(() => (
    chatTargets.filter((target) => target.user.isSystem !== true && target.user.id !== conversation?.ownerId && !memberIds.has(target.user.id))
  ), [chatTargets, conversation?.ownerId, memberIds]);
  const addContactTargets = useMemo(() => (
    contactTargets.filter((target) => target.user.isSystem !== true && target.user.id !== conversation?.ownerId && !memberIds.has(target.user.id))
  ), [contactTargets, conversation?.ownerId, memberIds]);
  const transferableAdmins = useMemo(() => (
    members.filter((member) => member.id !== conversation?.ownerId && adminIdSet.has(member.id))
  ), [adminIdSet, conversation?.ownerId, members]);
  const sortedMembers = useMemo(() => (
    [...members].sort((left, right) => {
      const leftRank = getGroupMemberRank(left.id, conversation?.ownerId, adminIdSet);
      const rightRank = getGroupMemberRank(right.id, conversation?.ownerId, adminIdSet);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return (left.displayName || left.username).localeCompare(right.displayName || right.username);
    })
  ), [adminIdSet, conversation?.ownerId, members]);
  const trimmedMemberSearch = debouncedMemberSearch.trim();
  const canSearchMembers = trimmedMemberSearch.length >= 2;
  const visibleMembers = useMemo(() => {
    if (!canSearchMembers) {
      return sortedMembers;
    }

    const query = trimmedMemberSearch.toLowerCase();

    return sortedMembers.filter((member) => (
      member.displayName.toLowerCase().includes(query) ||
      member.username.toLowerCase().includes(query)
    ));
  }, [canSearchMembers, sortedMembers, trimmedMemberSearch]);
  const totalMemberPages = Math.max(1, Math.ceil(visibleMembers.length / GROUP_MEMBER_PAGE_SIZE));
  const boundedMemberPage = Math.min(memberPage, totalMemberPages);
  const pagedMembers = visibleMembers.slice(
    (boundedMemberPage - 1) * GROUP_MEMBER_PAGE_SIZE,
    boundedMemberPage * GROUP_MEMBER_PAGE_SIZE,
  );
  const galleryMediaMessages = useMemo(() => (
    isGalleryModalVisible
      ? messages.filter((message) => (message.kind === 'image' || message.kind === 'video') && !!message.mediaUri)
      : EMPTY_MESSAGES
  ), [isGalleryModalVisible, messages]);
  const galleryFileMessages = useMemo(() => (
    isGalleryModalVisible
      ? messages.filter((message) => message.kind === 'file' && !!message.mediaUri)
      : EMPTY_MESSAGES
  ), [isGalleryModalVisible, messages]);
  const galleryLinks = useMemo(() => isGalleryModalVisible ? extractChatLinks(messages) : [], [isGalleryModalVisible, messages]);
  const publicGroupLink = conversation?.publicInviteCode
    ? buildSharedGroupWebUrl(conversation.publicInviteCode)
    : '';
  const disappearingMessagesDurationLabelKey = getDisappearingMessagesDurationLabelKey(conversation?.disappearingMessagesDurationMinutes);
  const disappearingMessagesEnabled = !!conversation?.disappearingMessagesDurationMinutes;
  const disappearingMessagesEnabledByPeer = disappearingMessagesEnabled && conversation?.disappearingMessagesSetById !== currentUserId;

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(title);
    }
  }, [isEditingTitle, title]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedMemberSearch(memberSearch.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [memberSearch]);

  useEffect(() => {
    setMemberPage(1);
  }, [debouncedMemberSearch, isMemberSearchVisible]);

  useEffect(() => {
    if (memberPage > totalMemberPages) {
      setMemberPage(totalMemberPages);
    }
  }, [memberPage, totalMemberPages]);

  useEffect(() => {
    if (!isGroupAdmin) {
      setAddingMembers(false);
      setSelectedAddMemberIds([]);
    }
  }, [isGroupAdmin]);

  useEffect(() => {
    if (!isOwner) {
      setTransferPickerVisible(false);
      setTransferTarget(null);
      setMakeAdminTarget(null);
      setDeleteGroupConfirmVisible(false);
    }
  }, [isOwner]);

  async function saveGroupTitle() {
    const nextTitle = titleDraft.trim();

    if (!conversation || !nextTitle || nextTitle === title) {
      setEditingTitle(false);
      setTitleDraft(title);
      return;
    }

    if (containsMeetVapKeyword(nextTitle)) {
      Alert.alert(t('couldNotRenameGroup', {}, uiLanguage), t('meetvapNameProhibited', {}, uiLanguage));
      return;
    }

    setSavingTitle(true);

    try {
      await onChangeGroupTitle(conversation.id, nextTitle);
      setEditingTitle(false);
    } catch (error) {
      Alert.alert(t('couldNotRenameGroup', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setSavingTitle(false);
    }
  }

  async function saveGroupSetting(key: 'hideMembers' | 'isPublic' | 'ownerOnlyMessages' | 'preventMediaSave' | 'preventScreenshots' | 'showAdmins' | 'showMemberCount', value: boolean) {
    if (!conversation) {
      return;
    }

    if (key === 'preventScreenshots' && value && !canUsePremiumFeatures) {
      Alert.alert(t('premiumRequiredTitle', {}, uiLanguage), t('premiumRequiredMessage', {}, uiLanguage), [
        { text: t('cancel', {}, uiLanguage), style: 'cancel' },
        { text: t('premiumSubscribe', {}, uiLanguage), onPress: onOpenSubscription },
      ]);
      return;
    }

    setSavingSetting(key);

    try {
      await onChangeGroupSettings(conversation.id, { [key]: value });
    } catch (error) {
      Alert.alert(t('couldNotUpdateGroupSetting', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setSavingSetting(null);
    }
  }

  function closeAddSubscribers() {
    if (isAddingSelectedMembers) {
      return;
    }

    setAddingMembers(false);
    setSelectedAddMemberIds([]);
  }

  function toggleAddSubscriber(userId: string) {
    setSelectedAddMemberIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  }

  async function addSelectedGroupMembers() {
    if (!conversation || selectedAddMemberIds.length === 0) {
      return;
    }

    setAddingSelectedMembers(true);

    try {
      await onAddGroupMembers(conversation.id, selectedAddMemberIds);
      setAddingMembers(false);
      setSelectedAddMemberIds([]);
    } catch (error) {
      Alert.alert(t('couldNotAddSubscribers', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setAddingSelectedMembers(false);
    }
  }

  async function makeGroupAdmin(member: AuthUser) {
    if (!conversation) {
      return;
    }

    setMakingAdmin(true);

    try {
      await onAddGroupAdmins(conversation.id, [member.id]);
      setMakeAdminTarget(null);
    } catch (error) {
      Alert.alert(t('couldNotAddAdmins', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setMakingAdmin(false);
    }
  }

  async function transferOwnership(userId: string) {
    if (!conversation) {
      return;
    }

    setTransferringOwnership(true);

    try {
      await onTransferGroupOwnership(conversation.id, userId);
      setTransferTarget(null);
      setTransferPickerVisible(false);
    } catch (error) {
      Alert.alert(t('couldNotTransferOwnership', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setTransferringOwnership(false);
    }
  }

  function confirmDeleteGroup() {
    if (!conversation || !isOwner || isDeletingGroup) {
      return;
    }

    setDeleteGroupConfirmVisible(true);
  }

  async function deleteGroupAfterCountdown() {
    if (!conversation || !isOwner || isDeletingGroup) {
      return;
    }

    setDeletingGroup(true);

    try {
      await onDeleteGroup(conversation.id);
      setDeleteGroupConfirmVisible(false);
    } catch (error) {
      Alert.alert(t('couldNotDeleteGroup', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
      setDeletingGroup(false);
    }
  }

  function showGroupMemberActions(member: AuthUser) {
    if (!conversation || member.id === conversation.ownerId) {
      return;
    }

    const canRevokeAdmin = isOwner && adminIdSet.has(member.id);
    const canMakeAdmin = isOwner && !adminIdSet.has(member.id);
    const canRemoveMember = isGroupAdmin && (!adminIdSet.has(member.id) || isOwner);

    if (!canMakeAdmin && !canRevokeAdmin && !canRemoveMember) {
      return;
    }

    Alert.alert(
      member.displayName || member.username,
      undefined,
      [
        ...(canMakeAdmin ? [{
          text: t('makeAdmin', {}, uiLanguage),
          onPress: () => setMakeAdminTarget(member),
        }] : []),
        ...(canRevokeAdmin ? [{
          text: t('revokeAdmin', {}, uiLanguage),
          onPress: () => void revokeGroupAdmin(member),
        }] : []),
        ...(canRemoveMember ? [{
          text: t('remove', {}, uiLanguage),
          style: 'destructive' as const,
          onPress: () => void removeGroupMember(member),
        }] : []),
        { text: t('cancel', {}, uiLanguage), style: 'cancel' as const },
      ],
    );
  }

  async function revokeGroupAdmin(member: AuthUser) {
    if (!conversation) {
      return;
    }

    setRemovingMemberId(member.id);

    try {
      await onRevokeGroupAdmin(conversation.id, member.id);
    } catch (error) {
      Alert.alert(t('couldNotRevokeAdmin', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function removeGroupMember(member: AuthUser) {
    if (!conversation) {
      return;
    }

    setRemovingMemberId(member.id);

    try {
      await onRemoveGroupMember(conversation.id, member.id);
    } catch (error) {
      Alert.alert(t('couldNotRemoveSubscriber', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setRemovingMemberId(null);
    }
  }

  return (
    <>
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.infoBackdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.infoPanel, { paddingBottom: Math.max(spacing.xl, bottomInset + spacing.lg) }]}>
          <ScrollView
            contentContainerStyle={styles.infoContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            overScrollMode="always"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator
          >
            <Pressable
              disabled={isGroup ? !isGroupAdmin : !avatarUri}
              onPress={() => {
                if (isGroup) {
                  onChangeGroupPicture();
                  return;
                }

                if (avatarUri) {
                  setFullScreenPhotoUri(avatarUri);
                }
              }}
              style={styles.infoAvatarButton}
            >
              <Avatar label={title} size={92} uri={avatarUri} />
              {isGroup && isGroupAdmin ? (
                <View style={styles.infoAvatarCamera}>
                  <Ionicons color={colors.white} name="camera" size={19} />
                </View>
              ) : null}
            </Pressable>
            {isGroup && isGroupAdmin ? (
              <View style={styles.infoTitleRow}>
                {isEditingTitle ? (
                  <TextInput
                    autoFocus
                    editable={!isSavingTitle}
                    onChangeText={setTitleDraft}
                    onSubmitEditing={() => void saveGroupTitle()}
                    placeholder={t('groupName', {}, uiLanguage)}
                    placeholderTextColor={colors.mutedText}
                    returnKeyType="done"
                    style={styles.infoTitleInput}
                    value={titleDraft}
                  />
                ) : (
                  <Text numberOfLines={2} style={styles.infoTitle}>{title}</Text>
                )}
                <Pressable
                  disabled={isSavingTitle}
                  onPress={() => {
                    if (isEditingTitle) {
                      void saveGroupTitle();
                      return;
                    }

                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                  style={styles.infoEditButton}
                >
                  <Ionicons color={colors.primary} name={isEditingTitle ? 'checkmark' : 'create-outline'} size={20} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.infoTitleRow}>
                {shouldShowTitlePremiumBadge ? <PremiumUserBadge size={20} /> : null}
                <Text numberOfLines={2} style={styles.infoTitle}>{title}</Text>
              </View>
            )}
            {displaySubtitle ? <Text numberOfLines={1} style={styles.infoSubtitle}>{displaySubtitle}</Text> : null}
            <View style={styles.infoActions}>
              {canShowCallActions ? (
                <>
                  <InfoAction icon="call-outline" label={t('voiceCall')} onPress={() => onStartCall('voice')} />
                  <InfoAction icon="videocam-outline" label={t('videoCall')} onPress={() => onStartCall('video')} />
                </>
              ) : null}
              <InfoAction icon="search-outline" label={t('search')} onPress={onSearch} />
            </View>
            {!isGroup ? (
              <View style={styles.directChatSettingsSection}>
                <View style={styles.groupSettingRow}>
                  <View style={styles.directChatSettingText}>
                    <View style={styles.directChatSettingTitleRow}>
                      <Text style={styles.directChatSettingLabel}>{t('autoDisappearingMessages', {}, uiLanguage)}</Text>
                      {disappearingMessagesDurationLabelKey ? (
                        <Text style={styles.disappearingMessagesBadge}>{t(disappearingMessagesDurationLabelKey, {}, uiLanguage)}</Text>
                      ) : null}
                    </View>
                    {disappearingMessagesEnabledByPeer ? (
                      <Text style={styles.directChatSettingHint}>{t('disappearingMessagesEnabledByPeer', {}, uiLanguage)}</Text>
                    ) : null}
                  </View>
                  <CompactToggle
                    disabled={disappearingMessagesEnabledByPeer}
                    onValueChange={onChangeDisappearingMessages}
                    value={disappearingMessagesEnabled}
                  />
                </View>
              </View>
            ) : null}
            {isGroup ? (
              <Pressable onPress={() => setGalleryModalVisible(true)} style={styles.chatGalleryOpenButton}>
                <View style={styles.chatGalleryOpenIcon}>
                  <Ionicons color={colors.primary} name="images-outline" size={22} />
                </View>
                <View style={styles.chatGalleryOpenText}>
                  <Text style={styles.chatGalleryOpenTitle}>{t('gallery', {}, uiLanguage)}</Text>
                  <Text style={styles.chatGalleryOpenSubtitle}>
                    {galleryMediaMessages.length + galleryFileMessages.length + galleryLinks.length}
                  </Text>
                </View>
                <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
              </Pressable>
            ) : (
              <ChatGallerySection
                files={galleryFileMessages}
                links={galleryLinks}
                media={galleryMediaMessages}
                onOpenFile={onOpenFile}
                onOpenMedia={onOpenMedia}
                onOpenUrl={onOpenUrl}
                onShowInChat={onShowInChat}
                selectedTab={galleryTab}
                onSelectTab={setGalleryTab}
                language={uiLanguage}
              />
            )}
            {isGroup && isOwner ? (
              <View style={styles.groupSettingsSection}>
                <Text style={styles.groupSettingsTitle}>{t('groupSettings', {}, uiLanguage)}</Text>
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={`${t('groupType', {}, uiLanguage)}: ${conversation?.isPublic ? t('publicGroup', {}, uiLanguage) : t('privateGroup', {}, uiLanguage)}`}
                  onValueChange={(value) => void saveGroupSetting('isPublic', value)}
                  value={conversation?.isPublic === true}
                />
                {conversation?.isPublic === true && publicGroupLink ? (
                  <View style={styles.groupLinkBox}>
                    <Text style={styles.groupLinkLabel}>{t('groupLink', {}, uiLanguage)}</Text>
                    <Pressable
                      onPress={() => {
                        void Clipboard.setStringAsync(publicGroupLink).then(() => {
                          Alert.alert(t('copied', {}, uiLanguage), publicGroupLink);
                        });
                      }}
                      style={styles.groupLinkInputWrap}
                    >
                      <Text numberOfLines={1} style={styles.groupLinkInput}>{publicGroupLink}</Text>
                      <Ionicons color={colors.primary} name="copy-outline" size={18} />
                    </Pressable>
                  </View>
                ) : null}
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('hideSubscriberList', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('hideMembers', value)}
                  value={conversation?.hideMembers === true}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('showAdmins', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('showAdmins', value)}
                  value={conversation?.showAdmins !== false}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('showUserCount', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('showMemberCount', value)}
                  value={conversation?.showMemberCount !== false}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('onlyAdminsCanSendMessages', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('ownerOnlyMessages', value)}
                  value={conversation?.ownerOnlyMessages === true}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('preventGroupMediaSave', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('preventMediaSave', value)}
                  value={conversation?.preventMediaSave === true}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('preventGroupScreenshots', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('preventScreenshots', value)}
                  value={canUsePremiumFeatures && conversation?.preventScreenshots === true}
                />
              </View>
            ) : null}
            {isGroup ? (
              <View style={styles.memberSection}>
                <View style={styles.memberSectionHeader}>
                  <View>
                    <Text style={styles.memberSectionTitle}>{t('people', {}, uiLanguage)}</Text>
                    <Text style={styles.memberSectionCount}>{formatSubscriberCount(memberCount, uiLanguage)}</Text>
                  </View>
                  <View style={styles.memberHeaderActions}>
                    {isGroupAdmin ? (
                      <Pressable onPress={() => setAddingMembers(true)} style={styles.memberAddButton}>
                        <Ionicons color={colors.primary} name="person-add-outline" size={20} />
                      </Pressable>
                    ) : null}
                    {members.length > 0 ? (
                      <Pressable
                        onPress={() => {
                          setMemberSearchVisible((current) => !current);
                          setMemberSearch('');
                          setDebouncedMemberSearch('');
                        }}
                        style={styles.memberSearchButton}
                      >
                        <Ionicons color={colors.primary} name={isMemberSearchVisible ? 'close' : 'search-outline'} size={20} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {members.length === 0 && conversation?.hideMembers ? (
                  <Text style={styles.memberHiddenText}>{t('subscriberListHiddenByAdmin', {}, uiLanguage)}</Text>
                ) : null}
                {members.length > 0 ? (
                  <>
                    {isMemberSearchVisible ? (
                      <View style={styles.memberSearchWrap}>
                        <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          onChangeText={setMemberSearch}
                          placeholder={t('searchDisplayNameOrUsername', {}, uiLanguage)}
                          placeholderTextColor={colors.mutedText}
                          style={styles.memberSearchInput}
                          value={memberSearch}
                        />
                      </View>
                    ) : null}
                    {isMemberSearchVisible && memberSearch.trim().length > 0 && memberSearch.trim().length < 2 ? (
                      <Text style={styles.memberSearchHint}>{t('enterAtLeast2Characters', {}, uiLanguage)}</Text>
                    ) : null}
                    <View style={styles.memberListPane}>
                      <ScrollView
                        keyboardShouldPersistTaps="handled"
                        nestedScrollEnabled
                        overScrollMode="always"
                        scrollEventThrottle={16}
                        showsVerticalScrollIndicator
                      >
                        {pagedMembers.length > 0 ? pagedMembers.map((member) => {
                          const canMakeAdmin = isOwner && member.id !== conversation?.ownerId && !adminIdSet.has(member.id);
                          const canManageMember = canMakeAdmin || (isGroupAdmin &&
                            member.id !== conversation?.ownerId &&
                            (!adminIdSet.has(member.id) || isOwner));

                          return (
                            <Pressable
                              disabled={!canManageMember || removingMemberId === member.id}
                              key={member.id}
                              onLongPress={() => showGroupMemberActions(member)}
                              style={({ pressed }) => [
                                styles.memberRow,
                                pressed && canManageMember ? styles.memberRowPressed : undefined,
                              ]}
                            >
                              <Avatar label={member.displayName || member.username} size={42} uri={member.avatarUrl} />
                              <View style={styles.memberText}>
                                <Text numberOfLines={1} style={styles.memberName}>{member.displayName || member.username}</Text>
                                {member.username ? <Text numberOfLines={1} style={styles.memberUsername}>@{member.username}</Text> : null}
                              </View>
                              {shouldShowAdminBadges && member.id !== conversation?.ownerId && adminIdSet.has(member.id) ? (
                                <View style={styles.adminBadge}>
                                  <Ionicons color={colors.primary} name="shield-checkmark" size={13} />
                                  <Text style={styles.adminBadgeText}>{t('admin', {}, uiLanguage)}</Text>
                                </View>
                              ) : null}
                              {member.groupInvitePending === true ? (
                                <View style={styles.memberPendingBadge}>
                                  <Text style={styles.memberPendingBadgeText}>{t('pending', {}, uiLanguage)}</Text>
                                </View>
                              ) : null}
                              {removingMemberId === member.id ? (
                                <ActivityIndicator color={colors.primary} size="small" />
                              ) : null}
                            </Pressable>
                          );
                        }) : (
                          <Text style={styles.memberHiddenText}>{t('noSubscribersFound', {}, uiLanguage)}</Text>
                        )}
                      </ScrollView>
                    </View>
                    <MemberPagination
                      currentPage={boundedMemberPage}
                      language={uiLanguage}
                      onPageChange={setMemberPage}
                      totalPages={totalMemberPages}
                    />
                    <Text style={styles.memberPageSummary}>
                      {t('showingItemsOfTotal', {
                        from: pagedMembers.length === 0 ? 0 : ((boundedMemberPage - 1) * GROUP_MEMBER_PAGE_SIZE) + 1,
                        to: Math.min(boundedMemberPage * GROUP_MEMBER_PAGE_SIZE, visibleMembers.length),
                        total: visibleMembers.length,
                      }, uiLanguage)}
                    </Text>
                  </>
                ) : null}
                {isOwner ? (
                  <View style={styles.groupAdminActions}>
                    <Pressable
                      disabled={isTransferringOwnership}
                      onPress={() => {
                        if (transferableAdmins.length === 0) {
                          Alert.alert(t('transferOwnershipFirst', {}, uiLanguage), t('transferOwnershipNeedsAdmin', {}, uiLanguage));
                          return;
                        }

                        setTransferPickerVisible(true);
                      }}
                      style={styles.groupAdminActionButton}
                    >
                      <Ionicons color={colors.primary} name="key-outline" size={19} />
                    </Pressable>
                    <Pressable disabled={isDeletingGroup} onPress={confirmDeleteGroup} style={styles.groupDeleteButton}>
                      {isDeletingGroup ? <ActivityIndicator color={colors.danger} size="small" /> : <Ionicons color={colors.danger} name="trash-outline" size={19} />}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </View>
	        <AddSubscribersModal
	          bottomInset={bottomInset}
	          chatTargets={addChatTargets}
	          contactTargets={addContactTargets}
          isAdding={isAddingSelectedMembers}
          language={uiLanguage}
          onClose={closeAddSubscribers}
          onSubmit={() => void addSelectedGroupMembers()}
          onToggle={toggleAddSubscriber}
	          selectedUserIds={selectedAddMemberIds}
	          visible={isGroupAdmin && isAddingMembers}
	        />
	        <CountdownConfirmOverlay
	          confirmLabel={t('deleteGroup', {}, uiLanguage)}
	          description={t('deleteGroupDescription', {}, uiLanguage)}
	          destructive
	          durationSeconds={10}
	          isSubmitting={isDeletingGroup}
	          onCancel={() => setDeleteGroupConfirmVisible(false)}
	          onConfirm={() => void deleteGroupAfterCountdown()}
	          title={t('deleteGroupQuestion', {}, uiLanguage)}
	          visible={isDeleteGroupConfirmVisible}
	        />
	      </View>
	    </Modal>
    <Modal
      animationType="fade"
      transparent
      visible={!!fullScreenPhotoUri}
      onRequestClose={() => setFullScreenPhotoUri(null)}
    >
      <Pressable onPress={() => setFullScreenPhotoUri(null)} style={styles.fullPhotoBackdrop}>
        {fullScreenPhotoUri ? (
          <Image resizeMode="contain" source={{ uri: fullScreenPhotoUri }} style={styles.fullPhotoImage} />
        ) : null}
        <Pressable onPress={() => setFullScreenPhotoUri(null)} style={styles.fullPhotoClose}>
          <Ionicons color={colors.white} name="close" size={28} />
        </Pressable>
      </Pressable>
    </Modal>
    <Modal animationType="slide" visible={isGalleryModalVisible} onRequestClose={() => setGalleryModalVisible(false)}>
      <View style={styles.galleryModalContainer}>
        <View style={styles.galleryModalHeader}>
          <Pressable onPress={() => setGalleryModalVisible(false)} style={styles.galleryModalBackButton}>
            <Ionicons color={colors.textPrimary} name="chevron-back" size={26} />
          </Pressable>
          <Text style={styles.galleryModalTitle}>{t('gallery', {}, uiLanguage)}</Text>
          <View style={styles.galleryModalHeaderSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.galleryModalContent} showsVerticalScrollIndicator>
          <ChatGallerySection
            files={galleryFileMessages}
            links={galleryLinks}
            media={galleryMediaMessages}
            onOpenFile={onOpenFile}
            onOpenMedia={onOpenMedia}
            onOpenUrl={onOpenUrl}
            onShowInChat={onShowInChat}
            selectedTab={galleryTab}
            onSelectTab={setGalleryTab}
            language={uiLanguage}
          />
        </ScrollView>
      </View>
    </Modal>
    <Modal animationType="slide" transparent visible={isOwner && isTransferPickerVisible} onRequestClose={() => setTransferPickerVisible(false)}>
      <Pressable onPress={() => setTransferPickerVisible(false)} style={styles.infoBackdrop}>
        <Pressable style={[styles.forwardPanel, { paddingBottom: Math.max(spacing.lg, bottomInset + spacing.lg) }]}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{t('transferOwnership', {}, uiLanguage)}</Text>
            <Pressable onPress={() => setTransferPickerVisible(false)} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {transferableAdmins.length > 0 ? transferableAdmins.map((member) => (
              <Pressable key={`transfer-${member.id}`} onPress={() => setTransferTarget(member)} style={styles.forwardRow}>
                <Avatar label={member.displayName || member.username} size={42} uri={member.avatarUrl} />
                <View style={styles.forwardRowText}>
                  <Text numberOfLines={1} style={styles.forwardName}>{member.displayName || member.username}</Text>
                  {member.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{member.username}</Text> : null}
                </View>
                <Ionicons color={colors.primary} name="chevron-forward" size={20} />
              </Pressable>
            )) : (
              <Text style={styles.forwardEmpty}>{t('addAnotherAdminBeforeTransfer', {}, uiLanguage)}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
	    <CountdownConfirmModal
      confirmLabel={t('transfer', {}, uiLanguage)}
      description={t('transferOwnershipDescription', { name: transferTarget?.displayName || transferTarget?.username || t('thisAdmin', {}, uiLanguage) }, uiLanguage)}
      durationSeconds={10}
      isSubmitting={isTransferringOwnership}
      onCancel={() => setTransferTarget(null)}
      onConfirm={() => {
        if (transferTarget) {
          void transferOwnership(transferTarget.id);
        }
      }}
      title={t('transferOwnershipQuestion', {}, uiLanguage)}
      visible={!!transferTarget}
    />
    <CountdownConfirmModal
      confirmLabel={t('makeAdmin', {}, uiLanguage)}
      description={t('makeAdminDescription', { name: makeAdminTarget?.displayName || makeAdminTarget?.username || t('thisAdmin', {}, uiLanguage) }, uiLanguage)}
      durationSeconds={5}
      isSubmitting={isMakingAdmin}
      onCancel={() => setMakeAdminTarget(null)}
      onConfirm={() => {
        if (makeAdminTarget) {
          void makeGroupAdmin(makeAdminTarget);
        }
      }}
      title={t('makeAdminQuestion', {}, uiLanguage)}
      visible={!!makeAdminTarget}
    />
    </>
  );
}

type CountdownConfirmProps = {
  confirmLabel: string;
  description: string;
  destructive?: boolean;
  durationSeconds: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  visible: boolean;
};

function CountdownConfirmModal(props: CountdownConfirmProps) {
  const { onCancel, visible } = props;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <CountdownConfirmContent {...props} />
    </Modal>
  );
}

function CountdownConfirmOverlay(props: CountdownConfirmProps) {
  if (!props.visible) {
    return null;
  }

  return (
    <View style={styles.countdownInlineOverlay}>
      <CountdownConfirmContent {...props} />
    </View>
  );
}

function CountdownConfirmContent({
  confirmLabel,
  description,
  destructive = false,
  durationSeconds,
  isSubmitting,
  onCancel,
  onConfirm,
  title,
  visible,
}: CountdownConfirmProps) {
  const uiLanguage = useAppStore((state: { language: AppLanguage }) => state.language);
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);

  useEffect(() => {
    if (!visible) {
      setRemainingSeconds(durationSeconds);
      return;
    }

    setRemainingSeconds(durationSeconds);
    const interval = setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [durationSeconds, visible]);

  const isConfirmDisabled = remainingSeconds > 0 || isSubmitting;
  const actionLabel = remainingSeconds > 0 ? `${confirmLabel} (${remainingSeconds})` : confirmLabel;

  return (
    <Pressable onPress={isSubmitting ? undefined : onCancel} style={styles.countdownBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={styles.countdownPanel}>
        <Text style={styles.countdownTitle}>{title}</Text>
        <Text style={styles.countdownDescription}>{description}</Text>
        <View style={styles.countdownActions}>
          <Pressable disabled={isSubmitting} onPress={onCancel} style={styles.countdownCancelButton}>
            <Text style={styles.countdownCancelText}>{t('cancel', {}, uiLanguage)}</Text>
          </Pressable>
          <Pressable
            disabled={isConfirmDisabled}
            onPress={onConfirm}
            style={[
              styles.countdownConfirmButton,
              destructive ? styles.countdownConfirmButtonDestructive : undefined,
              isConfirmDisabled ? styles.countdownConfirmButtonDisabled : undefined,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.countdownConfirmText}>{actionLabel}</Text>
            )}
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

function GroupSettingRow({
  disabled,
  label,
  onValueChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.groupSettingRow}>
      <Text style={styles.groupSettingLabel}>{label}</Text>
      <Switch
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={value ? colors.white : colors.surface}
        trackColor={{ false: colors.border, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

function CompactToggle({
  disabled,
  onValueChange,
  value,
}: {
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.compactToggle,
        value ? styles.compactToggleEnabled : undefined,
        disabled ? styles.compactToggleDisabled : undefined,
      ]}
    >
      <View style={[styles.compactToggleThumb, value ? styles.compactToggleThumbEnabled : undefined]} />
    </Pressable>
  );
}

function MemberPagination({
  currentPage,
  language,
  onPageChange,
  totalPages,
}: {
  currentPage: number;
  language: AppLanguage;
  onPageChange: (page: number) => void;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const items = getPaginationItems(currentPage, totalPages);

  return (
    <View style={styles.memberPagination}>
      <Pressable
        disabled={currentPage <= 1}
        onPress={() => onPageChange(Math.max(1, currentPage - 1))}
        style={[styles.memberPageButton, currentPage <= 1 ? styles.memberPageButtonDisabled : undefined]}
      >
        <Ionicons color={currentPage <= 1 ? colors.textSecondary : colors.primary} name="chevron-back" size={17} />
        <Text style={[styles.memberPageButtonText, currentPage <= 1 ? styles.memberPageButtonTextDisabled : undefined]}>{t('previousShort', {}, language)}</Text>
      </Pressable>
      <View style={styles.memberPageNumbers}>
        {items.map((item, index) => (
          item === 'ellipsis' ? (
            <Text key={`ellipsis-${index}`} style={styles.memberPageEllipsis}>...</Text>
          ) : (
            <Pressable
              key={item}
              onPress={() => onPageChange(item)}
              style={[styles.memberPageNumber, item === currentPage ? styles.memberPageNumberActive : undefined]}
            >
              <Text style={[styles.memberPageNumberText, item === currentPage ? styles.memberPageNumberTextActive : undefined]}>{item}</Text>
            </Pressable>
          )
        ))}
      </View>
      <Pressable
        disabled={currentPage >= totalPages}
        onPress={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        style={[styles.memberPageButton, currentPage >= totalPages ? styles.memberPageButtonDisabled : undefined]}
      >
        <Text style={[styles.memberPageButtonText, currentPage >= totalPages ? styles.memberPageButtonTextDisabled : undefined]}>{t('nextShort', {}, language)}</Text>
        <Ionicons color={currentPage >= totalPages ? colors.textSecondary : colors.primary} name="chevron-forward" size={17} />
      </Pressable>
    </View>
  );
}

async function ensureSaveToPhonePermission(message: Message) {
  if (Platform.OS === 'ios') {
    if (message.kind === 'file') {
      return true;
    }

    const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);
    return !!mediaPermission?.granted;
  }

  if (Platform.OS !== 'android') {
    return true;
  }

  const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);

  if (mediaPermission?.granted) {
    return true;
  }

  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    const permissions: Array<(typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS]> = [];

    if (message.kind === 'image') {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    } else if (message.kind === 'video') {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
    } else {
      permissions.push(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      );
    }

    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission as keyof typeof result] === PermissionsAndroid.RESULTS.GRANTED);
  }

  const legacyWritePermission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

  if (!legacyWritePermission) {
    return false;
  }

  const result = await PermissionsAndroid.request(legacyWritePermission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

async function getShareableMediaUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('attachmentNotAvailableYet'));
  }

  if (Platform.OS === 'ios') {
    if (message.mediaUri.startsWith('file:')) {
      return await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;
    }

    if (/^https?:\/\//i.test(message.mediaUri)) {
      return downloadMediaActionAttachment(message);
    }

    return message.mediaUri;
  }

  if (Platform.OS !== 'android') {
    return message.mediaUri;
  }

  if (message.mediaUri.startsWith('file:')) {
    const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;

    return FileSystem.getContentUriAsync(resolvedLocalUri);
  }

  if (message.mediaUri.startsWith('content:')) {
    return message.mediaUri;
  }

  if (/^https?:\/\//i.test(message.mediaUri)) {
    const localUri = await downloadMediaActionAttachment(message);

    return FileSystem.getContentUriAsync(localUri);
  }

  return message.mediaUri;
}

function waitForIosModalDismissal() {
  return new Promise((resolve) => setTimeout(resolve, 220));
}

async function downloadMediaActionAttachment(message: Message) {
  const localUri = await getMediaActionCacheUri(message);
  const remoteUri = getMessageRemoteMediaUri(message) ?? message.mediaUri;

  if (!remoteUri || !/^https?:\/\//i.test(remoteUri)) {
    throw new Error(t('mediaUnavailable'));
  }

  const cachedUri = await downloadRemoteMediaFile({
    expectedSizeBytes: message.sizeBytes,
    localUri,
    messageId: message.id,
    remoteUri,
  });

  if (!cachedUri) {
    throw new Error(t('mediaDownloadIncomplete'));
  }

  return cachedUri;
}

async function getMediaActionCacheUri(message: Message) {
  return getMessageMediaCacheUri({
    fileName: getMessageFileName(message),
    kind: message.kind,
    messageId: message.id,
  });
}

function InfoAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.infoAction}>
      <View style={styles.infoActionIconWrap}>
        <Ionicons color={colors.primary} name={icon} size={24} />
      </View>
      <Text numberOfLines={2} style={styles.infoActionText}>{label}</Text>
    </Pressable>
  );
}

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

function MediaViewer({ imageMessages, initialImageIndex, message, onClose }: MediaViewerProps) {
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

async function getPlayableVoiceUri(message: Message) {
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

function VoiceRoomPeopleModal({
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

type HoldVoiceRecorderButtonProps = {
  onOpenVoiceEffectPicker: () => void;
  onRecorded: (message: Omit<Message, 'id' | 'conversationId' | 'createdAt' | 'senderId' | 'status'>, shouldSendNow?: boolean) => void;
  onSessionClosed: () => void;
  onStateChange: (state: VoiceRecordingComposerState) => void;
};

function HoldVoiceRecorderButton({ onOpenVoiceEffectPicker, onRecorded, onSessionClosed, onStateChange }: HoldVoiceRecorderButtonProps) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder);
  const [renderState, setRenderState] = useState({
    isLocked: false,
    isPaused: false,
    isRecording: false,
  });
  const [isTouchActive, setTouchActive] = useState(false);
  const isPreparingRef = useRef(false);
  const isHoldingRef = useRef(false);
  const isLockedRef = useRef(false);
  const isPausedRef = useRef(false);
  const isMountedRef = useRef(true);
  const shouldStopAfterPrepareRef = useRef(false);
  const shouldLockAfterStartRef = useRef(false);
  const startPressYRef = useRef<number | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const endLockDeferralRef = useRef<(() => void) | null>(null);

  const emitState = useCallback((patch?: Partial<VoiceRecordingComposerState>) => {
    const nextState = {
      durationMillis: recorderState.durationMillis,
      isLocked: isLockedRef.current,
      isPaused: isPausedRef.current,
      isRecording: recorderState.isRecording || isPreparingRef.current || isLockedRef.current,
      ...patch,
    };

    setRenderState((current) => (
      current.isLocked === nextState.isLocked
        && current.isPaused === nextState.isPaused
        && current.isRecording === nextState.isRecording
        ? current
        : {
            isLocked: nextState.isLocked,
            isPaused: nextState.isPaused,
            isRecording: nextState.isRecording,
          }
    ));
    onStateChange(nextState);
  }, [onStateChange, recorderState.durationMillis, recorderState.isRecording]);

  useEffect(() => {
    emitState();
  }, [emitState]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      isHoldingRef.current = false;
      isLockedRef.current = false;
      isPausedRef.current = false;
      shouldStopAfterPrepareRef.current = false;
      shouldLockAfterStartRef.current = false;
      endRecordingLockDeferral();
      clearStartTimer();
      setTouchActive(false);
      setRenderState({ isLocked: false, isPaused: false, isRecording: false });
      onStateChange({ durationMillis: 0, isLocked: false, isPaused: false, isRecording: false });
      void stopRecorderIfNeeded(recorder);
    };
  }, [onStateChange, recorder]);

  function isVoiceRecordingBlockedByActiveCall() {
    return getActiveCallSession()?.callState === 'active';
  }

  function showVoiceRecordingBlockedByActiveCall() {
    Alert.alert(t('voiceRecordingUnavailableDuringCallTitle'), t('voiceRecordingUnavailableDuringCallMessage'));
  }

  function scheduleHoldingRecording(pageY: number) {
    if (isHoldingRef.current || isPreparingRef.current || recorderState.isRecording || isLockedRef.current) {
      return;
    }

    if (isVoiceRecordingBlockedByActiveCall()) {
      showVoiceRecordingBlockedByActiveCall();
      return;
    }

    startPressYRef.current = pageY;
    clearStartTimer();
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      void startHoldingRecording();
    }, VOICE_RECORDING_HOLD_THRESHOLD_MS);
  }

  async function startHoldingRecording() {
    if (isVoiceRecordingBlockedByActiveCall()) {
      resetHoldingState();
      showVoiceRecordingBlockedByActiveCall();
      return;
    }

    const status = getRecorderStatusSafely(recorder);

    if (!isMountedRef.current || !status || isHoldingRef.current || isPreparingRef.current || status.isRecording) {
      return;
    }

    beginRecordingLockDeferral();
    isHoldingRef.current = true;
    isPausedRef.current = false;
    shouldStopAfterPrepareRef.current = false;
    isPreparingRef.current = true;
    startedAtRef.current = null;
    emitState({ durationMillis: 0, isPaused: false, isRecording: true });

    try {
      const permission = await requestRecordingPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('allowMicrophoneToRecordVoice'));
        resetHoldingState();
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      if (!isMountedRef.current) {
        resetHoldingState();
        return;
      }

      const preparedStatus = getRecorderStatusSafely(recorder);

      if (!preparedStatus) {
        resetHoldingState();
        await restorePlaybackAudioMode();
        return;
      }

      if (!preparedStatus.canRecord) {
        await recorder.prepareToRecordAsync(VOICE_RECORDING_OPTIONS);
      }

      if (!isMountedRef.current || !isHoldingRef.current || shouldStopAfterPrepareRef.current) {
        isPreparingRef.current = false;
        await stopHoldingRecording(false);
        return;
      }

      isPreparingRef.current = false;
      recorder.record();
      startedAtRef.current = Date.now();
      if (shouldLockAfterStartRef.current) {
        isLockedRef.current = true;
        isHoldingRef.current = false;
      }
      emitState({ isLocked: isLockedRef.current, isRecording: true });
    } catch (error) {
      if (!isReleasedRecorderError(error)) {
        Alert.alert(t('recordingFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      }
      resetHoldingState();
      await stopRecorderIfNeeded(recorder);
      await restorePlaybackAudioMode();
    } finally {
      isPreparingRef.current = false;
    }
  }

  function handlePressMove(pageY: number) {
    if (isLockedRef.current) {
      return;
    }

    const startY = startPressYRef.current;

    if (startY === null || startY - pageY < VOICE_RECORDING_LOCK_DRAG_Y) {
      return;
    }

    if (!isHoldingRef.current && !isPreparingRef.current && !recorderState.isRecording) {
      shouldLockAfterStartRef.current = true;
      return;
    }

    isLockedRef.current = true;
    isHoldingRef.current = false;
    shouldLockAfterStartRef.current = false;
    emitState({ isLocked: true, isRecording: true });
  }

  async function releaseHoldingRecording() {
    if (startTimerRef.current) {
      clearStartTimer();
      startPressYRef.current = null;
      shouldLockAfterStartRef.current = false;
      return;
    }

    if (isLockedRef.current) {
      return;
    }

    await stopHoldingRecording(false);
  }

  async function stopHoldingRecording(shouldSendNow: boolean) {
    const status = getRecorderStatusSafely(recorder);

    if (!isMountedRef.current || (!isHoldingRef.current && !isLockedRef.current && !isPreparingRef.current && !status?.isRecording && !status?.canRecord)) {
      return;
    }

    isHoldingRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;

    if (isPreparingRef.current) {
      shouldStopAfterPrepareRef.current = true;
      return;
    }

    try {
      const durationSeconds = getRecordingDurationSeconds(recorderState.durationMillis, startedAtRef.current);

      await stopRecorderIfNeeded(recorder);
      await restorePlaybackAudioMode();

      const uri = recorder.uri ?? recorderState.url;

      if (!uri || durationSeconds < MIN_VOICE_RECORDING_SECONDS) {
        resetHoldingState();
        return;
      }

      onRecorded({
        body: t('voiceMessage'),
        durationSeconds,
        fileName: 'voice-message.m4a',
        kind: 'voice',
        mediaUri: uri,
        mimeType: 'audio/mp4',
      }, shouldSendNow);
      onSessionClosed();
    } catch (error) {
      if (!isReleasedRecorderError(error)) {
        Alert.alert(t('recordingFailed'), t('pleaseTryAgain'));
      }
    } finally {
      resetHoldingState();
    }
  }

  function clearStartTimer() {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }

  function beginRecordingLockDeferral() {
    if (!endLockDeferralRef.current) {
      endLockDeferralRef.current = beginAppLockForegroundOperation();
    }
  }

  function endRecordingLockDeferral() {
    const endLockDeferral = endLockDeferralRef.current;

    if (!endLockDeferral) {
      return;
    }

    endLockDeferralRef.current = null;
    endLockDeferral();
  }

  function togglePause() {
    const status = getRecorderStatusSafely(recorder);

    if (!status?.canRecord) {
      return;
    }

    try {
      if (isPausedRef.current) {
        recorder.record();
        isPausedRef.current = false;
      } else if (status.isRecording) {
        recorder.pause();
        isPausedRef.current = true;
      }
      emitState({ isPaused: isPausedRef.current, isRecording: true });
    } catch (error) {
      if (!isReleasedRecorderError(error)) {
        Alert.alert(t('recordingFailed'), t('pleaseTryAgain'));
      }
    }
  }

  async function discardLockedRecording() {
    isHoldingRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;
    shouldLockAfterStartRef.current = false;
    clearStartTimer();

    const uri = recorder.uri ?? recorderState.url;
    await stopRecorderIfNeeded(recorder);
    await restorePlaybackAudioMode();
    if (uri) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
    resetHoldingState();
    onSessionClosed();
  }

  function resetHoldingState() {
    isHoldingRef.current = false;
    isLockedRef.current = false;
    isPausedRef.current = false;
    shouldStopAfterPrepareRef.current = false;
    shouldLockAfterStartRef.current = false;
    isPreparingRef.current = false;
    startedAtRef.current = null;
    startPressYRef.current = null;
    clearStartTimer();
    endRecordingLockDeferral();
    setTouchActive(false);
    setRenderState({ isLocked: false, isPaused: false, isRecording: false });
    onStateChange({ durationMillis: 0, isLocked: false, isPaused: false, isRecording: false });
  }

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => (
      Math.abs(gestureState.dy) > 2 || Math.abs(gestureState.dx) > 2 || isHoldingRef.current || isPreparingRef.current || renderState.isRecording
    ),
    onPanResponderGrant: (event) => {
      setTouchActive(true);
      scheduleHoldingRecording(event.nativeEvent.pageY);
    },
    onPanResponderMove: (event) => {
      handlePressMove(event.nativeEvent.pageY);
    },
    onPanResponderRelease: () => {
      setTouchActive(false);
      void releaseHoldingRecording();
    },
    onPanResponderTerminate: () => {
      setTouchActive(false);
      void releaseHoldingRecording();
    },
    onPanResponderTerminationRequest: () => false,
    onStartShouldSetPanResponder: () => true,
  }), [renderState.isRecording]);

  if (renderState.isLocked && !isTouchActive) {
    return (
      <View style={styles.lockedVoiceActions}>
        <Pressable onPress={() => void discardLockedRecording()} style={[styles.lockedVoiceButton, styles.lockedVoiceDeleteButton]}>
          <Ionicons color={colors.danger} name="trash-outline" size={20} />
        </Pressable>
        <Pressable onPress={togglePause} style={styles.lockedVoiceButton}>
          <Ionicons color={renderState.isPaused ? colors.danger : colors.textPrimary} name={renderState.isPaused ? 'mic' : 'pause'} size={20} />
        </Pressable>
        <Pressable onPress={onOpenVoiceEffectPicker} style={styles.lockedVoiceButton}>
          <Ionicons color={colors.textSecondary} name="settings-outline" size={20} />
        </Pressable>
        <Pressable onPress={() => void stopHoldingRecording(true)} style={styles.sendButton}>
          <Ionicons color={colors.white} name="send" size={20} />
        </Pressable>
      </View>
    );
  }

  return (
    <View
      {...panResponder.panHandlers}
      style={[styles.sendButton, renderState.isRecording && styles.recordingButton, isTouchActive && styles.micButtonPressed]}
    >
      <Ionicons color={colors.white} name={renderState.isRecording ? 'radio-button-on' : 'mic'} size={20} />
    </View>
  );
}

async function restorePlaybackAudioMode() {
  await setAudioModeAsync({
    allowsRecording: false,
    playsInSilentMode: true,
  });
}

function createStyles() {
  return StyleSheet.create({
  addSubscribersButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 44,
  },
  addSubscribersButtonDisabled: {
    opacity: 0.45,
  },
  addSubscribersButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  composer: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  composerKeyboardAvoider: {
    width: '100%',
  },
  composerKeyboardAvoiderContent: {
    width: '100%',
  },
  addContactPrompt: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addContactPromptPrimary: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  addContactPromptPrimaryText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  addContactPromptSecondary: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  addContactPromptSecondaryText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  addContactPromptSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  addContactPromptText: {
    flex: 1,
    minWidth: 0,
  },
  addContactPromptTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  voiceRoomAdminMuteButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  voiceRoomAdminMuteButtonActive: {
    backgroundColor: colors.danger,
  },
  voiceRoomCloseButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  voiceRoomControlButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  voiceRoomControlButtonActive: {
    backgroundColor: colors.danger,
  },
  voiceRoomControlButtonDisabled: {
    opacity: 0.45,
  },
  voiceRoomControls: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  voiceRoomLoadMoreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  voiceRoomLoadMoreText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  voiceRoomModalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  voiceRoomModalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
  },
  voiceRoomPeopleButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  voiceRoomPeopleHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  voiceRoomPeopleName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  voiceRoomPeoplePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '78%',
    padding: spacing.md,
  },
  voiceRoomPeopleRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 62,
  },
  voiceRoomPeopleSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  voiceRoomPeopleText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  voiceRoomPeopleTextWrap: {
    flex: 1,
  },
  voiceRoomPushToTalkButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    marginLeft: 'auto',
    width: 48,
  },
  voiceRoomPushToTalkButtonActive: {
    borderColor: colors.primary,
  },
  voiceRoomPushToTalkButtonHolding: {
    backgroundColor: colors.primary,
  },
  voiceRoomPushToTalkText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  voiceRoomRoutePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.md,
  },
  voiceRoomRouteRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 50,
  },
  voiceRoomRouteText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  voiceRoomStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minWidth: 18,
  },
  voiceRoomStatusLight: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  voiceRoomStatusLightOffline: {
    backgroundColor: colors.danger,
  },
  voiceRoomStatusLightOnline: {
    backgroundColor: '#22c55e',
  },
  captionBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.42)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  captionFileMeta: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  captionFileName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  captionFilePreview: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  captionFileText: {
    flex: 1,
  },
  captionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  captionHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  captionImagePreview: {
    alignSelf: 'center',
    aspectRatio: 1,
    backgroundColor: colors.border,
    borderRadius: 12,
    width: '72%',
  },
  captionInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    maxHeight: 110,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  captionInputRow: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderRadius: 24,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingLeft: spacing.xs,
  },
  captionPanel: {
    backgroundColor: colors.appBackground,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: spacing.md,
    padding: spacing.lg,
    zIndex: 1,
  },
  captionSendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  captionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  captionToolButton: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  drawingButtonDisabled: {
    opacity: 0.45,
  },
  drawingCanvas: {
    backgroundColor: '#000000',
    borderRadius: 8,
    overflow: 'hidden',
  },
  drawingCanvasWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  drawingColorRail: {
    borderRadius: 999,
    height: 24,
  },
  drawingColorRailWrap: {
    justifyContent: 'center',
    minHeight: 44,
  },
  drawingColorThumb: {
    borderColor: colors.white,
    borderRadius: 12,
    borderWidth: 3,
    height: 24,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    width: 24,
  },
  drawingHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  drawingHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  drawingIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  drawingScreen: {
    backgroundColor: '#000000',
    flex: 1,
  },
  drawingSendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 76,
    paddingHorizontal: spacing.md,
  },
  drawingSendText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  drawingTitle: {
    color: colors.white,
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
  },
  drawingToolLabel: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  drawingTools: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  editMessageActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  editMessageButtonDisabled: {
    opacity: 0.55,
  },
  editMessageInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.textPrimary,
    fontSize: 16,
    maxHeight: 180,
    minHeight: 110,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  editMessageKeyboardAvoider: {
    flex: 1,
  },
  editMessagePrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    minHeight: 40,
    minWidth: 92,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  editMessagePrimaryText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  editMessageSecondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 40,
    minWidth: 92,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  editMessageSecondaryText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  voiceEffectActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  voiceEffectList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  voiceEffectOption: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.sm + spacing.xs,
    paddingVertical: spacing.xs,
  },
  voiceEffectOptionDescription: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  voiceEffectOptionDescriptionSelected: {
    color: 'rgba(255,255,255,0.84)',
  },
  voiceEffectOptionIcon: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  voiceEffectOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  voiceEffectOptionText: {
    flex: 1,
  },
  voiceEffectOptionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  voiceEffectOptionTitleSelected: {
    color: colors.white,
  },
  voiceEffectPanel: {
    backgroundColor: colors.appBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  voiceEffectPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  voiceEffectPrimaryButtonDisabled: {
    opacity: 0.65,
  },
  voiceEffectPrimaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  voiceEffectSecondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  voiceEffectSecondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  voiceEffectSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  voiceEffectTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 24,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconButtonActive: {
    backgroundColor: colors.primary,
  },
  iconButtonDisabled: {
    opacity: 0.45,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  emojiButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  emojiPanel: {
    backgroundColor: colors.appBackground,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 260,
  },
  emojiTab: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  emojiTabActive: {
    backgroundColor: colors.primary,
  },
  emojiTabs: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emojiText: {
    fontSize: 27,
  },
  headerButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerTitleButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    maxWidth: 210,
  },
  headerTitleContent: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minWidth: 0,
  },
  headerSubtitleText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 1,
  },
  headerTitleText: {
    color: colors.white,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '800',
  },
  actionBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  actionButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  actionButtonText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  actionButtonTextDanger: {
    color: colors.danger,
  },
  actionPanel: {
    backgroundColor: colors.appBackground,
    borderRadius: 12,
    padding: spacing.sm,
    width: '100%',
  },
  actionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendOptionsForm: {
    gap: spacing.md,
    padding: spacing.md,
  },
  sendOptionsHint: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  sendOptionsInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  sendOptionsPanel: {
    backgroundColor: colors.appBackground,
    borderRadius: 12,
    padding: spacing.sm,
    width: '100%',
  },
  sendOptionsTimeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  smallTimeInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    textAlign: 'center',
  },
  smallTimeInputLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  smallTimeInputWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  reactionQuickButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  reactionQuickButtonActive: {
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.primary,
  },
  reactionQuickEmoji: {
    fontSize: 22,
  },
  reactionQuickRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addSubscribersOverlay: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    zIndex: 10,
  },
  pinnedBanner: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pinnedBannerIcon: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pinnedBannerPressed: {
    opacity: 0.78,
  },
  pinnedBannerPreview: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  pinnedBannerText: {
    flex: 1,
    minWidth: 0,
  },
  pinnedBannerTitle: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  pinnedEmptyText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  pinnedList: {
    marginTop: spacing.sm,
    maxHeight: 420,
  },
  pinnedModalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.34)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pinnedModalClose: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pinnedModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pinnedModalPanel: {
    backgroundColor: colors.appBackground,
    borderRadius: 18,
    maxHeight: '78%',
    padding: spacing.md,
  },
  pinnedModalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
  },
  pinnedRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 58,
  },
  pinnedRowMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  pinnedRowDate: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  pinnedRowMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 3,
  },
  pinnedRowPressed: {
    backgroundColor: colors.surface,
  },
  pinnedRowText: {
    flex: 1,
    minWidth: 0,
  },
  pinnedRowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  pinnedRemoveButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  pinnedScopeBadge: {
    backgroundColor: colors.outgoingBubble,
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  pinnedScopeBadgeText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
  },
  pinnedSearchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 40,
    padding: 0,
  },
  pinnedSearchWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  pinnedThumb: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    height: 42,
    overflow: 'hidden',
    position: 'relative',
    width: 42,
  },
  pinnedThumbIcon: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderRadius: 8,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  pinnedThumbImage: {
    height: '100%',
    width: '100%',
  },
  pinnedThumbOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  composerReply: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.primary,
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  composerReplyBody: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 17,
  },
  composerReplyClose: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  composerReplyText: {
    flex: 1,
  },
  composerReplyTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 1,
  },
  forwardClose: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  forwardDivider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.sm,
  },
  forwardEmpty: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  forwardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  forwardHeaderText: {
    flex: 1,
    gap: 2,
  },
  forwardName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  forwardPanel: {
    backgroundColor: colors.appBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 2,
    maxHeight: '78%',
    padding: spacing.lg,
    zIndex: 2,
  },
  forwardRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  forwardRowText: {
    flex: 1,
  },
  forwardSectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  forwardTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  forwardSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  forwardUsername: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  fullPhotoBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.94)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  fullPhotoClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.lg,
    top: spacing.xl,
    width: 44,
  },
  fullPhotoImage: {
    height: '82%',
    width: '100%',
  },
  hiddenList: {
    opacity: 0,
  },
  adminBadge: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  adminBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  chatGalleryEmpty: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  chatGalleryFileIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  chatGalleryFileMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  chatGalleryFileName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  chatGalleryFileRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 56,
    paddingVertical: spacing.sm,
  },
  chatGalleryFileText: {
    flex: 1,
    minWidth: 0,
  },
  chatGalleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    width: '100%',
  },
  chatGalleryLinkRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 62,
    paddingVertical: spacing.sm,
  },
  chatGalleryLinkUrl: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  chatGalleryList: {
    width: '100%',
  },
  chatGalleryMediaImage: {
    height: '100%',
    width: '100%',
  },
  chatGalleryOpenButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  chatGalleryOpenIcon: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  chatGalleryOpenSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  chatGalleryOpenText: {
    flex: 1,
    minWidth: 0,
  },
  chatGalleryOpenTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  chatGalleryMediaTile: {
    aspectRatio: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    position: 'relative',
    width: '32.9%',
  },
  chatGalleryPlayButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    left: '50%',
    marginLeft: -22,
    marginTop: -22,
    position: 'absolute',
    top: '50%',
    width: 44,
  },
  chatGalleryRowPressed: {
    backgroundColor: colors.surface,
  },
  chatGallerySection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
  },
  chatGalleryTab: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  chatGalleryTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chatGalleryTabCount: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '900',
  },
  chatGalleryTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    width: '100%',
  },
  chatGalleryTabText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  chatGalleryTabTextActive: {
    color: colors.white,
  },
  chatGalleryTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  chatGalleryVideoFallback: {
    alignItems: 'center',
    backgroundColor: '#111827',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  galleryModalBackButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  galleryModalContainer: {
    backgroundColor: colors.appBackground,
    flex: 1,
    paddingTop: spacing.xl,
  },
  galleryModalContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  galleryModalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
  },
  galleryModalHeaderSpacer: {
    width: 44,
  },
  galleryModalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  countdownActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },
  countdownBackdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  countdownCancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  countdownCancelText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  countdownConfirmButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 130,
    paddingHorizontal: spacing.lg,
  },
  countdownConfirmButtonDestructive: {
    backgroundColor: colors.danger,
  },
  countdownConfirmButtonDisabled: {
    opacity: 0.45,
  },
  countdownConfirmText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
  },
  countdownInlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    elevation: 30,
    zIndex: 30,
  },
  countdownDescription: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  countdownPanel: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  countdownTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '900',
  },
  groupSettingLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  groupSettingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 48,
    width: '100%',
  },
  groupAdminActionButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 42,
    width: 52,
  },
  groupAdminActionButtonDisabled: {
    opacity: 0.55,
  },
  groupAdminActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  groupAdminActionText: {
    color: colors.primary,
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
  },
  groupAdminActionTextDisabled: {
    color: colors.textSecondary,
  },
  groupDeleteButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 42,
    width: 52,
  },
  groupDeleteButtonText: {
    color: colors.danger,
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
  },
  groupAliasActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  groupAliasButtonDisabled: {
    opacity: 0.52,
  },
  groupAliasEditor: {
    gap: spacing.sm,
    width: '100%',
  },
  groupAliasInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  groupAliasPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  groupAliasPrimaryText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  groupAliasPrompt: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  groupAliasPromptText: {
    gap: 2,
  },
  groupAliasSecondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  groupAliasSecondaryText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '900',
  },
  groupAliasSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  groupAliasTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '900',
  },
  groupSettingsSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
  },
  groupSettingsTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
    marginBottom: spacing.xs,
  },
  directChatSettingsSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    width: '100%',
  },
  directChatSettingText: {
    flex: 1,
    gap: 3,
  },
  directChatSettingLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  directChatSettingTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  directChatSettingHint: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  compactToggle: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 15,
    borderWidth: 1,
    flexShrink: 0,
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 52,
  },
  compactToggleDisabled: {
    opacity: 0.55,
  },
  compactToggleEnabled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  compactToggleThumb: {
    backgroundColor: colors.white,
    borderRadius: 11,
    height: 22,
    width: 22,
  },
  compactToggleThumbEnabled: {
    alignSelf: 'flex-end',
  },
  disappearingHeaderAvatar: {
    borderColor: colors.primary,
    borderRadius: 21,
    borderWidth: 1.5,
    padding: 2,
  },
  disappearingHeaderClock: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 9,
    bottom: -3,
    height: 17,
    justifyContent: 'center',
    position: 'absolute',
    right: -5,
    width: 17,
  },
  disappearingMessagesBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    color: colors.white,
    fontSize: 10,
    fontWeight: '900',
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  disappearingMessagesNotice: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disappearingMessagesNoticeText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  groupLinkBox: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  groupLinkInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
  },
  groupLinkInputWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  groupLinkLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  infoAction: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 112,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  infoActionIconWrap: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  infoActionText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
    width: '100%',
  },
  optionPickerDescription: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  infoActions: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
    justifyContent: 'space-between',
    width: '100%',
  },
  infoBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.32)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  infoContent: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoPanel: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 2,
    gap: spacing.sm,
    maxHeight: '86%',
    padding: spacing.xl,
    zIndex: 2,
  },
  infoAvatarButton: {
    position: 'relative',
  },
  infoAvatarCamera: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
    borderColor: 'rgba(255,255,255,0.55)',
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 2,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    width: 34,
  },
  infoEditButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    minHeight: 36,
    width: 36,
  },
  infoSubtitle: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  infoTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  infoTitleInput: {
    borderBottomColor: colors.primary,
    borderBottomWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 20,
    fontWeight: '900',
    minHeight: 42,
    paddingHorizontal: spacing.xs,
    textAlign: 'center',
  },
  infoTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 1,
    justifyContent: 'center',
    width: '100%',
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    color: colors.textPrimary,
    fontSize: 16,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  inputFlex: {
    flex: 1,
  },
  holdRecordingInput: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  holdRecordingText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '900',
  },
  inputInWrap: {
    borderRadius: 0,
  },
  inputWrap: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    flex: 1,
    overflow: 'hidden',
  },
  list: {
    flex: 1,
  },
  dateDividerPill: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  dateDividerRow: {
    alignItems: 'center',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  dateDividerText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  messageList: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  invertedMessageList: {
    justifyContent: 'flex-start',
    paddingBottom: spacing.md,
  },
  messageCheckbox: {
    alignItems: 'center',
    alignSelf: 'center',
    height: 42,
    justifyContent: 'center',
    width: 34,
  },
  memberName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  memberPendingBadge: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  memberPendingBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
  },
  memberRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  memberRowPressed: {
    backgroundColor: colors.surface,
  },
  memberSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    width: '100%',
  },
  memberSectionCount: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  memberSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    width: '100%',
  },
  memberSectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  memberHiddenText: {
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: spacing.md,
    textAlign: 'center',
  },
  memberAddButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: 'center',
    minHeight: 36,
    width: 36,
  },
  memberHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  memberListPane: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: 320,
    minHeight: 96,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    width: '100%',
  },
  memberPageButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minHeight: 34,
    paddingHorizontal: spacing.xs,
  },
  memberPageButtonDisabled: {
    opacity: 0.45,
  },
  memberPageButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '900',
  },
  memberPageButtonTextDisabled: {
    color: colors.textSecondary,
  },
  memberPageEllipsis: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
    paddingHorizontal: 2,
  },
  memberPageNumber: {
    alignItems: 'center',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    minWidth: 28,
    paddingHorizontal: spacing.xs,
  },
  memberPageNumberActive: {
    backgroundColor: colors.primary,
  },
  memberPageNumbers: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 2,
    justifyContent: 'center',
  },
  memberPageNumberText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '900',
  },
  memberPageNumberTextActive: {
    color: colors.white,
  },
  memberPageSummary: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  memberPagination: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    width: '100%',
  },
  memberText: {
    flex: 1,
  },
  memberSearchButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  memberSearchHint: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    width: '100%',
  },
  memberSearchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 40,
    padding: 0,
  },
  memberSearchWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  modalSearchHint: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  modalSearchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 40,
    padding: 0,
  },
  modalSearchWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: '100%',
  },
  memberUsername: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  recordingBar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    padding: spacing.md,
  },
  recordingBarLocked: {
    borderColor: colors.primary,
  },
  recordingButton: {
    backgroundColor: colors.danger,
  },
  micButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 1.06 }],
  },
  recordingDot: {
    backgroundColor: colors.danger,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  recordingTime: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  scrollToBottomButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 22,
    elevation: 4,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    shadowColor: '#000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    width: 44,
    zIndex: 12,
  },
  recordingLockHint: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  recordingLockHintText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  lockedVoiceActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  lockedVoiceButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  lockedVoiceDeleteButton: {
    borderColor: colors.danger,
  },
  pendingVoiceActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pendingVoiceBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  pendingVoiceDiscardButton: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pendingVoiceGearButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pendingVoiceSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  pendingVoiceText: {
    flex: 1,
    minWidth: 0,
  },
  pendingVoiceTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  readOnlyComposer: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  readOnlyComposerText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
  },
  selectableMessageBubble: {
    flex: 1,
  },
  selectableMessageRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.xs,
    width: '100%',
  },
  screen: {
    backgroundColor: colors.chatBackground,
    flex: 1,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  sendButtonDisabled: {
    backgroundColor: colors.border,
  },
  searchBar: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  searchButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 34,
  },
  searchCount: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    minWidth: 42,
    textAlign: 'center',
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    height: 38,
    paddingHorizontal: spacing.md,
  },
  subscriberCheckbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  subscriberCheckboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  viewer: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
  },
  viewerRoot: {
    backgroundColor: '#000000',
    flex: 1,
  },
  viewerClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    left: spacing.md,
    position: 'absolute',
    top: spacing.xl,
    width: 52,
    zIndex: 1,
  },
  viewerCounter: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.46)',
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    position: 'absolute',
    top: spacing.xl + 8,
    zIndex: 1,
  },
  viewerCounterText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  viewerError: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: spacing.xl,
    textAlign: 'center',
  },
  viewerImage: {
    height: '100%',
    width: '100%',
  },
  viewerPager: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  viewerPagerCoverImage: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    width: '100%',
    zIndex: 2,
  },
  viewerPagerImage: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    width: '100%',
  },
  viewerVideo: {
    height: '100%',
    width: '100%',
  },
});
}

let styles = createStyles();
