import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect } from 'react';
import { ActivityIndicator, Alert, FlatList, LayoutChangeEvent, Linking, Modal, Platform, Pressable, Share, Text, TextInput, View } from 'react-native';
import { AttachmentSheet } from '../components/AttachmentSheet';
import { VoiceRoomControls } from '../components/chat/VoiceRoomControls';
import { VISIBLE_MESSAGE_PAGE_SIZE } from '../hooks/useChatTimelineWindow';
import { useStableCallback } from '../hooks/useStableCallback';
import { t } from '../i18n';
import { pinMessage, unpinMessage, type PinnedMessage } from '../lib/backend';
import { CONVERSATION_MUTE_OPTIONS, isConversationMuted } from '../lib/conversationMute';
import { DISAPPEARING_MESSAGES_OPTIONS } from '../lib/disappearingMessages';
import { containsMeetVapKeyword } from '../lib/prohibitedNames';
import { buildReportReason, getReportContextNotice } from '../lib/reporting';
import { openNativeAndroidFile, saveNativeAndroidFile, shareNativeAndroidFile } from '../native/CallNative';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { AuthUser, Message } from '../types/domain';
import { RootStackParamList } from '../types/navigation';
import { DEFAULT_VOICE_EFFECT_ID } from '../types/voiceEffects';
import { chatRoomStyles as styles } from './chat/ChatRoomStyles';
import { ChatHeaderMenu, ChatInfoModal, ensureSaveToPhonePermission, ForwardMessageModal, getShareableMediaUri, GroupCallMemberPicker, OptionPickerModal, ShareContactPickerModal, waitForIosModalDismissal } from './ChatRoomDialogs';
import { MediaViewer, VoiceRoomPeopleModal } from './ChatRoomMediaViewer';
import { AttachmentCaptionModal, ComposerEditMenu, DateDivider, EditMessageModal, EmojiPicker, ImageDrawingModal, MediaActionMenu, MessageActionMenu, MessageRow, PinnedMessageBanner, PinnedMessagesModal, SendOptionsModal, VoiceEffectModal } from './ChatRoomMessageActions';
import { HoldVoiceRecorderButton } from './ChatRoomVoiceRecorder';
import { formatVoiceComposerEffectLabel, getMessageFileName, getMessageMimeType, isShareableMediaMessage, isViewableImageMessage } from './lib/ChatMediaHelpers';
import { getDisappearingSecondsAfterView, getMessagePreview, getPinnedMessageTitle, getReplySenderName } from './lib/ChatMessagePreview';
import { getChatListItemRenderKey, getGroupCallLimit, type ChatListItem } from './lib/ChatMiscHelpers';
import { useChatRoomController } from './ChatRoomController';

type Props = NativeStackScreenProps<RootStackParamList, 'ChatRoom'>;
type ForwardTarget = {
  conversationId?: string;
  title: string;
  user: AuthUser;
};
type ScrollToIndexFailureInfo = {
  averageItemLength: number;
  highestMeasuredFrameIndex: number;
  index: number;
};
const EMPTY_MESSAGES: Message[] = [];
const MESSAGE_JUMP_MAX_ATTEMPTS = 10;
const MESSAGE_JUMP_RETRY_DELAY_MS = 120;
const TOP_HISTORY_LOAD_THRESHOLD_PX = 240;
const LOCAL_HISTORY_PAGE_SIZE = 100;


export function ChatRoomScreen({ navigation, route }: Props) {
  const {
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
    draft, draftSelection, setDraftSelection, isSendingText, sendOptionsMode,
    setSendOptionsMode, scheduleDateDraft, setScheduleDateDraft, scheduleHourDraft, setScheduleHourDraft,
    scheduleMinuteDraft, setScheduleMinuteDraft, scheduleSecondDraft, setScheduleSecondDraft, disappearSecondsDraft,
    setDisappearSecondsDraft, isComposerEditMenuVisible, setComposerEditMenuVisible, updateDraft, isEmojiPickerVisible,
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
    insertEmoji, playVoiceMessage, openCallMessage, handleVoiceRecorded, cancelPendingVoiceMessage,
    sendPendingVoiceMessage, scrollTailToEnd, isTailForced, isMeasuredNearTail, scheduleTailScroll,
    isKeyboardVisibleRef, keyboardBaselineViewportHeightRef, keyboardLift, keyboardLiftRef,
  } = useChatRoomController({ navigation, route });

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
        await Share.share({
          message: message.body || getMessageFileName(message),
          title: getMessageFileName(message),
          url: uri,
        });
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

  const toggleVoiceRoomMic = voiceRoom.toggleMic;
  const beginVoiceRoomPushToTalk = voiceRoom.beginPushToTalk;
  const endVoiceRoomPushToTalk = voiceRoom.endPushToTalk;
  const toggleVoiceRoomSpeakerMute = voiceRoom.toggleSpeakerMute;

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

  const openVoiceRoomRoutePicker = voiceRoom.openRoutePicker;
  const selectVoiceRoomAudioRoute = voiceRoom.selectAudioRoute;
  const toggleVoiceRoomAdminMute = voiceRoom.toggleAdminMute;
  const loadMoreVoiceRoomParticipants = voiceRoom.loadMoreParticipants;
  const setVoiceRoomPeopleOpen = voiceRoom.setPeopleOpen;
  const setVoiceRoomRoutePickerOpen = voiceRoom.setRoutePickerOpen;

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
  const stableHandleMessageActions = useStableCallback(handleMessageActions);
  const stableOpenCallMessage = useStableCallback(openCallMessage);
  const stableOpenRepliedMessage = useStableCallback(openRepliedMessage);
  const stablePlayVoiceMessage = useStableCallback(playVoiceMessage);
  const stableReplyToSelectedMessage = useStableCallback(replyToSelectedMessage);
  const stableToggleSelectedMessage = useStableCallback(toggleSelectedMessage);

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
        onLongPress={stableHandleMessageActions}
        onOpenCall={stableOpenCallMessage}
        onOpenDisappearing={openDisappearingMessageForView}
        onOpenMedia={openMediaViewer}
        onOpenReply={stableOpenRepliedMessage}
        onPlayVoice={stablePlayVoiceMessage}
        onSwipeReply={canUseMessageWriteActions ? stableReplyToSelectedMessage : undefined}
        onToggleSelected={stableToggleSelectedMessage}
        showSender={route.params.isGroup}
        voicePlayed={playedVoiceMessageIds.has(message.id)}
        voiceProgress={voiceProgressById[message.id] ?? 0}
      />
    );
  }, [
    cancelUpload,
    canUseMessageWriteActions,
    openMediaViewer,
    isSelectionMode,
    openDisappearingMessageForView,
    pinnedMessageIds,
    playedVoiceMessageIds,
    playingVoiceId,
    route.params.isGroup,
    selectedMessageIdSet,
    stableHandleMessageActions,
    stableOpenCallMessage,
    stableOpenRepliedMessage,
    stablePlayVoiceMessage,
    stableReplyToSelectedMessage,
    stableToggleSelectedMessage,
    user?.id,
    voiceProgressById,
  ]);

  const bottomAnchoringBatchSize = isBottomAnchoringActive ? 16 : 8;
  const bottomAnchoringWindowSize = isBottomAnchoringActive ? 9 : 7;
  const initialRenderCount = renderedChatListItems.length > 0 ? 12 : 0;

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
        removeClippedSubviews={Platform.OS === 'android'}
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
              contextMenuHidden={Platform.OS !== 'ios'}
              multiline
              onChangeText={updateDraft}
              onFocus={() => {
                setEmojiPickerVisible(false);
                if (isNearBottomRef.current || isTailForced()) {
                  scheduleTailScroll({ reason: 'composer-focus', settle: true });
                }
              }}
              onSelectionChange={(event) => setDraftSelection(event.nativeEvent.selection)}
              onTouchCancel={Platform.OS === 'ios' ? undefined : clearComposerLongPressTimer}
              onTouchEnd={Platform.OS === 'ios' ? undefined : clearComposerLongPressTimer}
              onTouchStart={Platform.OS === 'ios' ? undefined : scheduleComposerEditMenu}
              placeholder={t('message')}
              placeholderTextColor={colors.mutedText}
              selection={Platform.OS === 'ios' ? undefined : draftSelection}
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
