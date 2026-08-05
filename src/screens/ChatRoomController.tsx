import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createAudioPlayer } from 'expo-audio';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, FlatList, Keyboard, Platform, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { PremiumUserBadge } from '../components/PremiumUserBadge';
import { useChatHydration } from '../hooks/useChatHydration';
import { useChatAttachments } from '../hooks/useChatAttachments';
import { useChatKeyboardLift } from '../hooks/useChatKeyboardLift';
import { useChatTimelineWindow } from '../hooks/useChatTimelineWindow';
import { useNotificationMessageRecovery } from '../hooks/useNotificationMessageRecovery';
import { useChatVoiceRoom } from '../hooks/useChatVoiceRoom';
import { useVoiceCallTip } from '../hooks/useVoiceCallTip';
import { getI18nLanguage, t } from '../i18n';
import { getActiveCallSession } from '../lib/activeCallSession';
import { beginAppLockForegroundOperation } from '../lib/appLockAccess';
import { getConversationScreenshotPrivacy, isUploadCanceledError, listPinnedMessages, mapMessage, uploadMediaFile, type PinnedMessage } from '../lib/backend';
import { isConversationMuted } from '../lib/conversationMute';
import { clearActiveForegroundChatConversationId, setActiveForegroundChatConversationId } from '../lib/foregroundChatActivity';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { dismissMessageNotificationsForConversation } from '../lib/messageNotifications';
import { takePendingShareDraft } from '../lib/pendingShareDraft';
import { getRealtimeSocket } from '../lib/realtimeSocket';
import { buildReportReason, getReportContextNotice } from '../lib/reporting';
import { clearScreenCaptureProtectionRequirement, setScreenCaptureProtectionRequirement } from '../lib/screenCaptureProtection';
import { getStoredPlayedVoiceMessageIds, getStoredRecentEmojis, setStoredPlayedVoiceMessageIds, setStoredRecentEmojis } from '../lib/storage';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { isMeetVapSystemConversation, isMeetVapSystemUser, MEETVAP_SYSTEM_AVATAR_URL } from '../lib/systemChat';
import { logUiPerformanceDiagnostic, useUiPerformanceStallMonitor } from '../lib/uiPerformanceDiagnostics';
import { processNativeVoiceMessage, setNativeLiveVoiceEffect } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { AuthUser, Conversation, Message } from '../types/domain';
import { RootStackParamList } from '../types/navigation';
import { DEFAULT_VOICE_EFFECT_ID, normalizeVoiceEffectId, VoiceEffectId } from '../types/voiceEffects';
import { refreshChatRoomStyles, chatRoomStyles as styles } from './chat/ChatRoomStyles';
import { getPlayableVoiceUri } from './ChatRoomMediaViewer';
import { restorePlaybackAudioMode } from './ChatRoomVoiceRecorder';
import { createMessageDeleteKey, getMessageDeleteKey, shouldRemovePinnedMessageForDeletion, waitForRecordedFile } from './lib/ChatMediaHelpers';
import { formatSubscriberCount, getPinnedMessageSearchText, getReplyPreview, mergePinnedMessageWithLocalCopy } from './lib/ChatMessagePreview';
import { buildChatListItems, formatDateInput, formatPresenceSubtitle, getGroupCallLimit, parseScheduledSendAt, shouldRenderTimelineMessage, type ChatListItem } from './lib/ChatMiscHelpers';


type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;
type ForwardTarget = {
  conversationId?: string;
  title: string;
  user: AuthUser;
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
type VoiceRecordingComposerState = {
  durationMillis: number;
  isLocked: boolean;
  isPaused: boolean;
  isRecording: boolean;
};

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_CONVERSATIONS: Conversation[] = [];
const CHAT_SCROLL_DIAGNOSTICS_ENABLED = false;
const CHAT_LIFECYCLE_DIAGNOSTICS_ENABLED = false;
const HOUR_MS = 60 * 60 * 1000;
const EMOJI_GROUPS = [
  { icon: 'happy-outline' as const, key: 'smileys', labelKey: 'emojiSmileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😍', '😘', '😋', '😎', '🤩', '🥳', '😏', '😢', '😭', '😤', '😡', '🤔', '🤗', '🤫', '😴', '😱', '🥰'] },
  { icon: 'hand-left-outline' as const, key: 'people', labelKey: 'emojiPeople', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🫶', '🙏', '💪', '👋', '🤝', '👀', '🧠', '👑', '💃', '🕺', '🏃', '🚶', '👨‍💻', '👩‍💻', '🧑‍🚀'] },
  { icon: 'heart-outline' as const, key: 'symbols', labelKey: 'emojiSymbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💯', '💢', '💥', '💫', '💦', '💨', '✅', '❌', '⚠️', '🔥', '⭐', '✨', '🎉', '🎁'] },
  { icon: 'fast-food-outline' as const, key: 'food', labelKey: 'emojiFood', emojis: ['🍏', '🍎', '🍌', '🍉', '🍇', '🍓', '🍒', '🥝', '🍅', '🥑', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🍜', '🍣', '🍰', '🍫', '🍿', '☕', '🍵', '🥤'] },
  { icon: 'car-outline' as const, key: 'travel', labelKey: 'emojiTravel', emojis: ['🚗', '🚕', '🚌', '🏎️', '🚓', '🚑', '🚒', '🚚', '🚲', '✈️', '🚀', '🚁', '🚢', '🏠', '🏢', '🏝️', '⛰️', '🌍', '🌙', '☀️', '🌧️', '❄️'] },
] satisfies { emojis: string[]; icon: keyof typeof Ionicons.glyphMap; key: string; labelKey: string }[];

export function useChatRoomController({ navigation, route }: Props) {
  const themeColors = useThemeColors();
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  useMemo(() => refreshChatRoomStyles(), [isDarkMode]);
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
  const composerTextInputRef = useRef<TextInput>(null);
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

  useFocusEffect(
    useCallback(() => {
      const conversationId = route.params.conversationId;
      setActiveForegroundChatConversationId(conversationId);

      return () => {
        clearActiveForegroundChatConversationId(conversationId);
      };
    }, [route.params.conversationId]),
  );

  useEffect(() => () => {
    releaseConversationHistory(route.params.conversationId);
  }, [releaseConversationHistory, route.params.conversationId]);
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
  const hasTailActivityDuringOpenRef = useRef(false);
  const hasShownScreenshotPrivacyWarningRef = useRef(false);
  const draftRef = useRef('');
  const pendingNativeDraftClearRef = useRef<string | null>(null);
  const draftSelectionRef = useRef({ end: 0, start: 0 });
  const [draftSelection, setDraftSelectionState] = useState({ end: 0, start: 0 });
  const [hasDraft, setHasDraft] = useState(false);
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
  const composerTypingActivityRef = useRef<(nextDraft: string) => void>(() => undefined);
  const updateDraftPresence = useCallback((nextDraft: string) => {
    const nextHasDraft = nextDraft.trim().length > 0;

    setHasDraft((current) => current === nextHasDraft ? current : nextHasDraft);
  }, []);
  const handleDraftChange = useCallback((nextDraft: string) => {
    const pendingClearedDraft = pendingNativeDraftClearRef.current;

    if (pendingClearedDraft !== null) {
      if (nextDraft === '') {
        pendingNativeDraftClearRef.current = null;
      } else if (nextDraft === pendingClearedDraft && draftRef.current === '') {
        // An onChange event queued before the imperative clear can arrive late
        // on a busy device. Do not resurrect the message that was just sent.
        composerTextInputRef.current?.clear();
        return;
      } else {
        pendingNativeDraftClearRef.current = null;
      }
    }

    draftRef.current = nextDraft;
    updateDraftPresence(nextDraft);
    composerTypingActivityRef.current(nextDraft);
  }, [updateDraftPresence]);
  const updateDraft = useCallback((nextDraft: string) => {
    const previousDraft = draftRef.current;

    draftRef.current = nextDraft;
    if (nextDraft === '') {
      pendingNativeDraftClearRef.current = previousDraft || null;
      composerTextInputRef.current?.clear();
    } else {
      pendingNativeDraftClearRef.current = null;
      composerTextInputRef.current?.setNativeProps({ text: nextDraft });
    }
    updateDraftPresence(nextDraft);
    composerTypingActivityRef.current(nextDraft);
  }, [updateDraftPresence]);
  const handleDraftSelectionChange = useCallback((selection: { end: number; start: number }) => {
    draftSelectionRef.current = selection;
  }, []);
  const setDraftSelection = useCallback((selection: { end: number; start: number }) => {
    draftSelectionRef.current = selection;
    setDraftSelectionState(selection);
    requestAnimationFrame(() => composerTextInputRef.current?.setNativeProps({ selection }));
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
  const [pendingVoiceMessage, setPendingVoiceMessage] = useState<PendingVoiceMessage | null>(null);
  const [selectedVoiceEffectId, setSelectedVoiceEffectId] = useState<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const [isVoiceEffectPickerVisible, setVoiceEffectPickerVisible] = useState(false);
  const [isProcessingVoiceEffect, setProcessingVoiceEffect] = useState(false);
  const [selectedCallVoiceEffectId, setSelectedCallVoiceEffectId] = useState<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const [groupCallVoiceEffectId, setGroupCallVoiceEffectId] = useState<VoiceEffectId>(DEFAULT_VOICE_EFFECT_ID);
  const [isCallVoiceEffectPickerVisible, setCallVoiceEffectPickerVisible] = useState(false);
  const [voiceRecorderSessionKey, setVoiceRecorderSessionKey] = useState(0);
  const [voiceRecordingState, setVoiceRecordingState] = useState<VoiceRecordingComposerState>({
    durationMillis: 0,
    isLocked: false,
    isPaused: false,
    isRecording: false,
  });
  const {
    captionDraft,
    chooseLocationType,
    closeCaptionComposer,
    closeImageDrawingComposer,
    drawingAttachment,
    getSharedPendingAttachment,
    isAttachmentSheetVisible,
    isCaptionComposerVisible,
    isCaptionSuspendedForDrawing,
    isContactSharePickerVisible,
    openCamera,
    openCaptionComposer,
    openContactSharePicker,
    openImageDrawingComposer,
    pendingCaptionAttachment,
    pickFile,
    pickFromGallery,
    sendDisappearingCaptionAttachment,
    sendDrawnAttachment,
    sendPendingCaptionAttachment,
    sendScheduledCaptionAttachment,
    sendSharedContact,
    setAttachmentSheetVisible,
    setCaptionDraft,
    setContactSharePickerVisible,
    suppressNextCaptionSendPressRef,
  } = useChatAttachments({
    addLocalMessage,
    addOptimisticMessage,
    conversationId: route.params.conversationId,
    disappearSecondsDraft,
    language,
    loadContacts,
    removeLocalMessage,
    scheduleDateDraft,
    scheduleHourDraft,
    scheduleMediaMessage,
    scheduleMinuteDraft,
    scheduleSecondDraft,
    sendMediaMessage,
    sendTextMessage,
    serverUrl,
    setEmojiPickerVisible,
    setSendOptionsMode,
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
    logMessageDeliveryDiagnostic('chat-silent-sync-failed', {
      conversationId: route.params.conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
  }, [route.params.conversationId]);
  const chatListItems = useMemo(() => buildChatListItems(messages, uiLanguage), [messages, uiLanguage]);
  const renderedChatListItems = useMemo(() => [...chatListItems].reverse(), [chatListItems]);
  const isVoiceRoomConversation = conversation?.isVoiceRoom === true;
  const canModerateVoiceRoom = route.params.isGroup === true && !!user?.id && (
    conversation?.ownerId === user.id ||
    conversation?.adminIds?.includes(user.id) === true
  );
  const voiceRoom = useChatVoiceRoom({
    canModerate: canModerateVoiceRoom,
    conversationId: route.params.conversationId,
    isGroupInvitePending,
    isVoiceRoom: isVoiceRoomConversation,
    navigation,
    serverUrl,
    title: route.params.title,
    userId: user?.id,
  });
  const voiceRoomSession = voiceRoom.session;
  const voiceRoomParticipants = voiceRoom.participants;
  const hasMoreVoiceRoomParticipants = voiceRoom.hasMoreParticipants;
  const isVoiceRoomPeopleOpen = voiceRoom.isPeopleOpen;
  const isVoiceRoomRoutePickerOpen = voiceRoom.isRoutePickerOpen;
  const voiceRoomAudioRoutes = voiceRoom.audioRoutes;
  const isCurrentVoiceRoomConnected = voiceRoom.isConnected;
  const isCurrentVoiceRoomConnecting = voiceRoom.isConnecting;

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

    const canDeleteForEveryone = selectedMessages.every((message) => (
      message.senderId === user?.id || (route.params.isGroup === true && isGroupAdmin)
    ));

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
        ...(canDeleteForEveryone ? [{
          text: t('deleteForAnyone', {}, language),
          style: 'destructive' as const,
          onPress: () => deleteSelectedMessages('all'),
        }] : []),
        { text: t('deleteForMe', {}, language), onPress: () => deleteSelectedMessages('me') },
        { text: t('cancel', {}, language), style: 'cancel' as const },
      ],
    );
  }, [canUseMessageWriteActions, deleteMessage, exitSelectionMode, isGroupAdmin, language, markMessagesPendingDelete, refreshPinnedMessages, route.params.conversationId, route.params.isGroup, selectedMessageIds.length, selectedMessages, unmarkMessagesPendingDelete, user?.id]);

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

        if (pendingBottomAnchorAttemptRef.current < 2) {
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
    }, 180);
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
    [80].forEach((delay) => {
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
  }, [navigation, route.params.conversationId, route.params.sharedItems, setDraftSelection, updateDraft]);

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

  const updateComposerTypingActivity = useCallback((nextDraft: string) => {
    const socket = getRealtimeSocket();

    if (!socket || route.params.isGroup === true) {
      return;
    }

    const shouldEmitTyping = canSendMessages && nextDraft.trim().length > 0 && !voiceRecordingState.isRecording;

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
  }, [canSendMessages, route.params.conversationId, route.params.isGroup, voiceRecordingState.isRecording]);
  composerTypingActivityRef.current = updateComposerTypingActivity;

  useEffect(() => {
    updateComposerTypingActivity(draftRef.current);
  }, [updateComposerTypingActivity]);

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

  useNotificationMessageRecovery({
    conversationId: route.params.conversationId,
    isDisabled: isGroupInvitePending,
    loadMessages,
    logLifecycle: logChatLifecycleDiagnostic,
    openReason: route.params.openReason,
    targetMessageId: route.params.targetMessageId,
  });

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

  function hasAuthoritativeMessageForClientId(clientId: string) {
    return (useAppStore.getState().messagesByConversation[route.params.conversationId] ?? []).some((message) => (
      !message.id.startsWith('local-') &&
      message.metadata &&
      typeof message.metadata === 'object' &&
      'clientId' in message.metadata &&
      message.metadata.clientId === clientId
    ));
  }

  async function waitForAuthoritativeMessage(clientId: string, timeoutMs = 800) {
    if (hasAuthoritativeMessageForClientId(clientId)) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (wasAccepted: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(wasAccepted);
      };
      const unsubscribe = useAppStore.subscribe(() => {
        if (hasAuthoritativeMessageForClientId(clientId)) {
          finish(true);
        }
      });
      const timeout = setTimeout(() => finish(hasAuthoritativeMessageForClientId(clientId)), timeoutMs);
    });
  }

  function restoreDraftAfterSendFailure(body: string) {
    // Never replace text entered while the failed request was in flight.
    if (draftRef.current === '') {
      updateDraft(body);
    }
  }

  async function handleSendTextMessage() {
    if (sendingRef.current) {
      return;
    }

    const body = draftRef.current;

    if (!body.trim()) {
      return;
    }

    sendingRef.current = true;
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
    setSendingText(true);

    try {
      await sendTextMessage(route.params.conversationId, body, localId ?? undefined, replyMetadata);
    } catch (error) {
      if (localId && await waitForAuthoritativeMessage(localId)) {
        logChatLifecycleDiagnostic('send-text-reconciled-after-request-error', { localId });
        return;
      }

      restoreDraftAfterSendFailure(body);
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
      restoreDraftAfterSendFailure(body);
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

    const body = draftRef.current;

    if (!body.trim()) {
      return;
    }

    sendingRef.current = true;
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
    setSendingText(true);

    try {
      await sendTextMessage(route.params.conversationId, body, localId ?? undefined, metadata);
    } catch (error) {
      if (localId && await waitForAuthoritativeMessage(localId)) {
        logChatLifecycleDiagnostic('send-text-reconciled-after-request-error', { localId });
        return;
      }

      restoreDraftAfterSendFailure(body);
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
      setDraftSelectionState(draftSelectionRef.current);
      setComposerEditMenuVisible(true);
    }, 450);
  }

  function replaceDraftSelection(replacement: string) {
    const draft = draftRef.current;
    const selection = draftSelectionRef.current;
    const start = Math.max(0, Math.min(selection.start, draft.length));
    const end = Math.max(start, Math.min(selection.end, draft.length));
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
    const draft = draftRef.current;
    const selection = draftSelectionRef.current;
    const selectedText = draft.slice(selection.start, selection.end);

    setComposerEditMenuVisible(false);
    if (selectedText) {
      await Clipboard.setStringAsync(selectedText);
    }
  }

  async function cutComposerSelection() {
    const draft = draftRef.current;
    const selection = draftSelectionRef.current;
    const selectedText = draft.slice(selection.start, selection.end);

    setComposerEditMenuVisible(false);
    if (selectedText) {
      await Clipboard.setStringAsync(selectedText);
      replaceDraftSelection('');
    }
  }

  function insertEmoji(emoji: string) {
    const draft = draftRef.current;
    const selection = draftSelectionRef.current;
    const start = Math.max(0, Math.min(selection.start, draft.length));
    const end = Math.max(start, Math.min(selection.end, draft.length));
    const nextDraft = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    const nextPosition = start + emoji.length;
    const nextRecentEmojis = [emoji, ...recentEmojis.filter((item) => item !== emoji)].slice(0, 36);

    updateDraft(nextDraft);
    setDraftSelection({ end: nextPosition, start: nextPosition });
    setRecentEmojis(nextRecentEmojis);
    void setStoredRecentEmojis(nextRecentEmojis).catch(() => undefined);
  }

  function selectAllComposerText() {
    setComposerEditMenuVisible(false);
    setDraftSelection({ end: draftRef.current.length, start: 0 });
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
    keyboardLift,
    keyboardLiftRef,
  } = useChatKeyboardLift({
    bottomInset: insets.bottom,
    isCaptionComposerVisible,
    isNearBottomRef,
    isTailForced,
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
    serverSyncDelayMs: route.params.openReason === 'notification' ? 0 : 100,
    scheduleOpenChatAlignment,
    setBottomAnchoringActive,
    setInitialScrollReady,
  });


  function removeLocalMessage(messageId: string) {
    setPinnedMessages((current) => current.filter((item) => item.message.id !== messageId));
    useAppStore.getState().removeMessage(route.params.conversationId, messageId);
  }


  return {
    themeColors, promptedGroupInviteIdRef, user, voiceCallTipModal, language,
    uiLanguage, serverUrl, conversation, isSystemChat, isGroupInvitePending,
    loadOlderLocalMessages, deleteMessage, editMessage, forwardMessage, openDisappearingMessage,
    reactToMessage, cancelUpload, startDirectConversation, blockUserById, updateConversationMute,
    updateGroupAlias, declineGroupInvite, addGroupAdmins, addGroupMembers, deleteGroup,
    removeGroupMember, reportTarget, revokeGroupAdmin, transferGroupOwnership, updateGroupSettings,
    updateGroupTitle, addUserToContacts, contacts, canUsePremiumFeatures, insets,
    listRef, composerRef, hasInitialScrollRef, isInitialScrollScheduledRef, isNearBottomRef,
    isBottomAnchoringRef, lastAutoTailMessageIdRef, lastScrolledMessageCountRef, lastContentHeightRef, listViewportHeightRef,
    lastScrollOffsetYRef, lastDistanceFromBottomRef, userScrollHistoryWindowRef, userScrollHistoryResetTimeoutRef, instantNextScrollRef,
    selectedCallVoiceEffectIdRef, suppressNextCallPressRef, pendingJumpMessageIdRef, pendingJumpOptionsRef, pendingJumpAttemptRef,
    pendingJumpRetryTimeoutRef, pendingHistoryAnchorRef, isControlledHistoryPrependRef, isHistoryExpansionPendingRef, isOlderLocalHistoryLoadingRef,
    isOlderLocalHistoryExhaustedRef, isTailOpenLockedRef, chatScrollDebugLastScrollAtRef, chatScrollDebugLastDistanceRef, hasTailActivityDuringOpenRef,
    composerTextInputRef, draftSelection, handleDraftChange, handleDraftSelectionChange, hasDraft, isSendingText, sendOptionsMode,
    setSendOptionsMode, scheduleDateDraft, setScheduleDateDraft, scheduleHourDraft, setScheduleHourDraft,
    scheduleMinuteDraft, setScheduleMinuteDraft, scheduleSecondDraft, setScheduleSecondDraft, disappearSecondsDraft,
    setDisappearSecondsDraft, isComposerEditMenuVisible, setComposerEditMenuVisible, isEmojiPickerVisible,
    setEmojiPickerVisible, selectedEmojiGroupKey, setSelectedEmojiGroupKey, pendingVoiceMessage, selectedVoiceEffectId,
    setSelectedVoiceEffectId, isVoiceEffectPickerVisible, setVoiceEffectPickerVisible, isProcessingVoiceEffect, selectedCallVoiceEffectId,
    setSelectedCallVoiceEffectId, groupCallVoiceEffectId, setGroupCallVoiceEffectId, isCallVoiceEffectPickerVisible, setCallVoiceEffectPickerVisible,
    voiceRecorderSessionKey, setVoiceRecorderSessionKey, voiceRecordingState, captionDraft, chooseLocationType,
    closeCaptionComposer, closeImageDrawingComposer, drawingAttachment, isAttachmentSheetVisible, isCaptionSuspendedForDrawing,
    isContactSharePickerVisible, openCamera, openContactSharePicker, openImageDrawingComposer, pendingCaptionAttachment,
    pickFile, pickFromGallery, sendDrawnAttachment, sendPendingCaptionAttachment, sendSharedContact,
    setAttachmentSheetVisible, setCaptionDraft, setContactSharePickerVisible, playingVoiceId, viewerMessage,
    setViewerMessage, imageViewerSession, setImageViewerSession, isInfoVisible, setInfoVisible,
    messageActionMenu, setMessageActionMenu, mediaActionMessage, setMediaActionMessage, setPinnedMessages,
    isPinnedMessagesVisible, setPinnedMessagesVisible, pinnedSearchQuery, setPinnedSearchQuery, editingMessage,
    setEditingMessage, editDraft, setEditDraft, isSavingEdit, setSavingEdit,
    forwardingMessages, setForwardingMessages, replyingToMessage, setReplyingToMessage, searchIndex,
    setSearchIndex, searchQuery, setSearchQuery, isSearchVisible, setSearchVisible,
    setSelectedMessageIds, isScrollToBottomVisible, setScrollToBottomVisible, isBottomAnchoringActive, isGroupAliasEditorOpen,
    setGroupAliasEditorOpen, groupAliasDraft, setGroupAliasDraft, isSavingGroupAlias, setSavingGroupAlias,
    groupCallPickerMode, setGroupCallPickerMode, isChatHeaderMenuVisible, setChatHeaderMenuVisible, isMuteDurationMenuVisible,
    setMuteDurationMenuVisible, isDisappearingMessagesDurationMenuVisible, setAddContactPromptDismissed, isAddingChatContact, setAddingChatContact,
    selectedGroupCallMemberIds, setSelectedGroupCallMemberIds, playedVoiceMessageIds, voiceProgressById, archivedMessages,
    archivedMessagesRef, messages, setVisibleMessageCount, visibleWindowStartIndex, renderedChatListItems,
    isVoiceRoomConversation, canModerateVoiceRoom, voiceRoom, voiceRoomSession, voiceRoomParticipants,
    hasMoreVoiceRoomParticipants, isVoiceRoomPeopleOpen, isVoiceRoomRoutePickerOpen, voiceRoomAudioRoutes, isCurrentVoiceRoomConnected,
    isCurrentVoiceRoomConnecting, logChatScrollDiagnostic, logChatLifecycleDiagnostic, isSelectionMode, selectedMessageIdSet,
    directChatTargets, contactTargets, groupCallCandidates, otherUser, shouldShowGroupAliasPrompt,
    headerTitle, isGroupAdmin, isGroupMessageLockedForCurrentUser, canPinMessages, canSendMessages,
    canUseMessageWriteActions, canSaveMediaToPhone, shouldShowAddContactPrompt, searchMatches, emojiGroups,
    selectedEmojiGroup, sortedPinnedMessages, pinnedMessageIds, latestPinnedMessage, filteredPinnedMessages,
    confirmStartCall, selectCallVoiceEffect, openChatSearch, exitSelectionMode, refreshPinnedMessages,
    markMessagesPendingDelete, unmarkMessagesPendingDelete, showGroupPictureActions, confirmLeaveGroup, toggleHeaderMute,
    confirmClearLocalChat, confirmReportCurrentChat, confirmBlockCurrentUser, changeDisappearingMessages, closeDisappearingMessagesDurationMenu,
    chooseDisappearingMessagesDuration, clearPendingJumpRetry, clearPendingMessageJump, scheduleBottomAnchorSettle, anchorToBottom,
    scheduleOpenChatAlignment, promoteTailReady, isOpenHistoryGuardActive, ensureMessageVisible, showMessageFromInfo,
    openPinnedMessages, showPinnedMessageInChat, handleSendTextMessage, openSendOptionsMenu, openCaptionSendOptionsMenu,
    closeSendOptionsMenu, sendScheduledTextMessage, sendDisappearingTextMessage, toggleEmojiPicker, handleVoiceRecorderStateChange,
    clearComposerLongPressTimer, scheduleComposerEditMenu, pasteIntoComposer, copyComposerSelection, cutComposerSelection,
    insertEmoji, selectAllComposerText, playVoiceMessage, openCallMessage, handleVoiceRecorded, cancelPendingVoiceMessage,
    sendPendingVoiceMessage, scrollTailToEnd, isTailForced, isMeasuredNearTail, scheduleTailScroll,
    isKeyboardVisibleRef, keyboardLift, keyboardLiftRef,
  };
}
