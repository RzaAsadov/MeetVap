# Exported Symbol Reference

This appendix is generated from the TypeScript source declarations. It provides exact public-symbol coverage; use the linked owning file together with [the complete source index](source-index.md) for responsibility and the domain guides for runtime logic. Private helpers are intentionally documented under their owning module rather than treated as cross-module API.

## [src/components/AppAttestationBridge.tsx](../src/components/AppAttestationBridge.tsx)

`AppAttestationBridge`

## [src/components/AppLockGate.tsx](../src/components/AppLockGate.tsx)

`AppLockGate`

## [src/components/AppUpdateGate.tsx](../src/components/AppUpdateGate.tsx)

`AppUpdateGate`

## [src/components/AttachmentSheet.tsx](../src/components/AttachmentSheet.tsx)

`AttachmentSheet`

## [src/components/Avatar.tsx](../src/components/Avatar.tsx)

`Avatar`

## [src/components/BackgroundLocationDisclosureBridge.tsx](../src/components/BackgroundLocationDisclosureBridge.tsx)

`BackgroundLocationDisclosureBridge`

## [src/components/HelpWebViewModal.tsx](../src/components/HelpWebViewModal.tsx)

`HelpWebViewModal`

## [src/components/MessageBubble.tsx](../src/components/MessageBubble.tsx)

`MessageBubble`

## [src/components/PinPad.tsx](../src/components/PinPad.tsx)

`PinPad`

## [src/components/PremiumTrialIntro.tsx](../src/components/PremiumTrialIntro.tsx)

`PremiumTrialIntro`

## [src/components/PremiumUserBadge.tsx](../src/components/PremiumUserBadge.tsx)

`PremiumUserBadge`

## [src/components/PrimaryButton.tsx](../src/components/PrimaryButton.tsx)

`PrimaryButton`

## [src/components/PushNotificationBridge.tsx](../src/components/PushNotificationBridge.tsx)

`PushNotificationBridge`, `handleIncomingCallUrl`

## [src/components/RealtimeBridge.tsx](../src/components/RealtimeBridge.tsx)

`RealtimeBridge`

## [src/components/ScreenBackground.tsx](../src/components/ScreenBackground.tsx)

`ScreenBackground`

## [src/components/ShareIntentBridge.tsx](../src/components/ShareIntentBridge.tsx)

`ShareIntentBridge`

## [src/components/TextField.tsx](../src/components/TextField.tsx)

`TextField`

## [src/components/VoiceRoomBridge.tsx](../src/components/VoiceRoomBridge.tsx)

`VoiceRoomBridge`

## [src/components/chat/VoiceRoomControls.tsx](../src/components/chat/VoiceRoomControls.tsx)

`VoiceRoomControls`

## [src/data/mockData.ts](../src/data/mockData.ts)

`currentUserId`, `conversations`, `messages`, `calls`

## [src/hooks/useChatAttachments.ts](../src/hooks/useChatAttachments.ts)

`PendingCaptionAttachment`, `useChatAttachments`

## [src/hooks/useChatHydration.ts](../src/hooks/useChatHydration.ts)

`useChatHydration`

## [src/hooks/useChatKeyboardLift.ts](../src/hooks/useChatKeyboardLift.ts)

`ChatKeyboardLiftController`, `useChatKeyboardLift`

## [src/hooks/useChatTimelineWindow.ts](../src/hooks/useChatTimelineWindow.ts)

`INITIAL_VISIBLE_MESSAGE_COUNT`, `INITIAL_LOCAL_MESSAGE_HYDRATE_LIMIT`, `TAIL_APPEND_VISIBLE_MESSAGE_LIMIT`, `VISIBLE_MESSAGE_PAGE_SIZE`, `ChatTimelineWindow`, `useChatTimelineWindow`

## [src/hooks/useChatVoiceRoom.ts](../src/hooks/useChatVoiceRoom.ts)

`useChatVoiceRoom`

## [src/hooks/useConversationById.ts](../src/hooks/useConversationById.ts)

`useConversationById`

## [src/hooks/useNotificationMessageRecovery.ts](../src/hooks/useNotificationMessageRecovery.ts)

`useNotificationMessageRecovery`

## [src/hooks/useStableCallback.ts](../src/hooks/useStableCallback.ts)

`useStableCallback`

## [src/hooks/useVoiceCallTip.tsx](../src/hooks/useVoiceCallTip.tsx)

`useVoiceCallTip`

## [src/i18n/az.ts](../src/i18n/az.ts)

`az`

## [src/i18n/de.ts](../src/i18n/de.ts)

`de`

## [src/i18n/en.ts](../src/i18n/en.ts)

`en`

## [src/i18n/es.ts](../src/i18n/es.ts)

`es`

## [src/i18n/fr.ts](../src/i18n/fr.ts)

`fr`

## [src/i18n/index.ts](../src/i18n/index.ts)

`getDeviceLanguage`, `isLanguagePreference`, `resolveLanguage`, `setI18nLanguage`, `getI18nLanguage`, `getLanguagePreferenceLabel`, `getLanguagePreferenceFlag`, `translate`, `t`

## [src/i18n/it.ts](../src/i18n/it.ts)

`it`

## [src/i18n/pt.ts](../src/i18n/pt.ts)

`pt`

## [src/i18n/ptBR.ts](../src/i18n/ptBR.ts)

`ptBR`

## [src/i18n/ru.ts](../src/i18n/ru.ts)

`ru`

## [src/i18n/tr.ts](../src/i18n/tr.ts)

`tr`

## [src/i18n/types.ts](../src/i18n/types.ts)

`APP_LANGUAGES`, `AppLanguage`, `LANGUAGE_PREFERENCES`, `LanguagePreference`, `TranslationValue`

## [src/lib/activeCallSession.ts](../src/lib/activeCallSession.ts)

`ActiveCallRoute`, `getActiveCallSession`, `setActiveCallSession`, `subscribeToActiveCallSession`, `isSameActiveCall`

## [src/lib/activeMeetingSession.ts](../src/lib/activeMeetingSession.ts)

`ActiveMeetingSession`, `getActiveMeetingSession`, `setActiveMeetingSession`, `subscribeToActiveMeetingSession`

## [src/lib/answeredCallKitLaunch.ts](../src/lib/answeredCallKitLaunch.ts)

`AnsweredCallKitLaunchResult`, `extractIncomingCallIdFromUrl`, `beginCallOnlyAccessFromIncomingCallUrl`, `resolveAnsweredCallKitLaunchUrl`, `launchAnsweredCallKitCallIfPending`

## [src/lib/api.ts](../src/lib/api.ts)

`ApiError`, `apiRequest`, `validateServerUrl`

## [src/lib/appAttestation.ts](../src/lib/appAttestation.ts)

`AppAttestationRunResult`, `runAppAttestation`

## [src/lib/appClientInfo.ts](../src/lib/appClientInfo.ts)

`initializeClientInstallationId`, `getClientRequestHeaders`

## [src/lib/appLockAccess.ts](../src/lib/appLockAccess.ts)

`addAppLockAccessListener`, `notifyAppLockRouteChanged`, `updateAppLockStatus`, `shouldOpenIncomingCallAsCallOnly`, `beginCallOnlyAccessIfLockPinEnabled`, `beginCallOnlyAccess`, `endCallOnlyAccess`, `getCallOnlyAccessCallId`, `isCallOnlyAccessActive`, `isCallOnlyAccessFor`, `beginAppLockForegroundOperation`, `setAppLockCurrentAppState`, `isAppLockForegroundOperationActive`

## [src/lib/authSuspensionEvents.ts](../src/lib/authSuspensionEvents.ts)

`AuthSuspension`, `notifyAuthSuspension`, `subscribeToAuthSuspension`

## [src/lib/backend.ts](../src/lib/backend.ts)

`CURRENT_TERMS_VERSION`, `BackendPinnedMessage`, `PinnedMessage`, `MessageEdit`, `MessageStatusUpdate`, `MessageReactionUpdate`, `ScheduledMessage`, `StatusKind`, `StatusAudience`, `StatusUpdate`, `StatusGroup`, `StatusViewer`, `MessageDeletionUpdate`, `ConversationDeltaCursor`, `ConversationDelta`, `AttestationChallengeResponse`, `AttestationSubmitResponse`, `register`, `checkUsernameAvailability`, `login`, `getWebDevices`, `logoutWebDevices`, `approveWebPairing`, `deleteAccount`, `getMe`, `getCatalogConfig`, `getHelpConfig`, `getRemoteDiagnosticsConfig`, `uploadRemoteDiagnostics`, `getSubscriptionStatus`, `createAttestationChallenge`, `submitAndroidPlayIntegrityAttestation`, `submitIosAppAttestRegistration`, `submitIosAppAttestAssertion`, `verifyAppleSubscription`, `verifyGoogleSubscription`, `redeemSubscriptionCode`, `searchUsers`, `getSharedUser`, `listBlockedUsers`, `listContacts`, `getStatusSummary`, `listStatuses`, `createStatus`, `markStatusViewed`, `deleteStatus`, `listStatusViewers`, `replyToStatus`, `addContact`, `deleteContact`, `blockUser`, `unblockUser`, `createDirectConversation`, `createGroupConversation`, `createVoiceRoomConversation`, `joinVoiceRoom`, `leaveVoiceRoom`, `listVoiceRoomParticipants`, `updateVoiceRoomParticipant`, `updateGroupAvatar`, `updateGroupTitle`, `updateGroupSettings`, `getPublicGroupInvite`, `joinPublicGroupInvite`, `addGroupMembers`, `addGroupAdmins`, `revokeGroupAdmin`, `transferGroupOwnership`, `deleteGroup`, `removeGroupMember`, `listConversations`, `listMessages`, `listPendingMessages`, `listMessageDeletions`, `listBulkMessageDeletions`, `listMessageEdits`, `listBulkMessageEdits`, `listConversationDeltas`, `listPinnedMessages`, `pinMessage`, `unpinMessage`, `acknowledgeMessageDeletions`, `acknowledgeBulkMessageDeletions`, `acknowledgeMessageEdits`, `acknowledgeBulkMessageEdits`, `listMessageStatusUpdates`, `listBulkMessageStatusUpdates`, `acknowledgeMessageStatusUpdates`, `acknowledgeBulkMessageStatusUpdates`, `acknowledgeMessageContent`, `markMessagesDelivered`, `createTextMessage`, `createScheduledMessage`, `deleteScheduledMessage`, `reactToMessage`, `openDisappearingMessage`, `createLiveLocation`, `updateLiveLocation`, `stopLiveLocation`, `createForwardedMessage`, `uploadMedia`, `uploadMediaFile`, `UploadCanceledError`, `isUploadCanceledError`, `cancelMediaUpload`, `createVoiceMessage`, `createMediaMessage`, `deleteMessage`, `editMessage`, `deleteCallMessageByCallId`, `deleteConversation`, `deleteConversationForAnyone`, `bulkDeleteConversations`, `acknowledgeConversationDeletion`, `updateConversationMute`, `updateDisappearingMessages`, `updateGroupAlias`, `declineGroupInvite`, `createCall`, `createMeeting`, `MeetingInfo`, `MeetingParticipantInfo`, `getMeeting`, `joinMeeting`, `leaveMeeting`, `endMeeting`, `answerCall`, `ringCall`, `endCall`, `getCallStatus`, `getCallToken`, `inviteCallParticipant`, `markConversationRead`, `markAllConversationsRead`, `registerPushToken`, `updateMyAvatar`, `updateMyProfile`, `updateMyPassword`, `getConversationScreenshotPrivacy`, `getCallScreenshotPrivacy`, `submitCallFeedback`, `updatePrivacy`, `reportContent`, `mapMessage`

## [src/lib/backgroundLocationDisclosure.ts](../src/lib/backgroundLocationDisclosure.ts)

`CURRENT_BACKGROUND_LOCATION_DISCLOSURE_VERSION`, `hasAcceptedCurrentBackgroundLocationDisclosure`, `markCurrentBackgroundLocationDisclosureAccepted`, `requestBackgroundLocationDisclosureConsent`, `respondToBackgroundLocationDisclosure`, `subscribeToBackgroundLocationDisclosure`, `isBackgroundLocationDisclosureRequested`

## [src/lib/backgroundPrefetch.ts](../src/lib/backgroundPrefetch.ts)

`prefetchConversationMessages`

## [src/lib/callAnswerClient.ts](../src/lib/callAnswerClient.ts)

`getMobileCallAnswerClientId`

## [src/lib/callEvents.ts](../src/lib/callEvents.ts)

`emitCallEvent`, `subscribeToCallEvent`

## [src/lib/conversationList.ts](../src/lib/conversationList.ts)

`ConversationListFilter`, `CONVERSATION_LIST_STALE_MS`, `isServerSideConversationFilter`

## [src/lib/conversationMute.ts](../src/lib/conversationMute.ts)

`ConversationMuteDurationMinutes`, `CONVERSATION_MUTE_OPTIONS`, `isConversationMuted`

## [src/lib/disappearingMessages.ts](../src/lib/disappearingMessages.ts)

`DisappearingMessagesDurationMinutes`, `DISAPPEARING_MESSAGES_OPTIONS`, `getDisappearingMessagesDurationLabelKey`

## [src/lib/foregroundChatActivity.ts](../src/lib/foregroundChatActivity.ts)

`getActiveForegroundChatConversationId`, `setActiveForegroundChatConversationId`, `clearActiveForegroundChatConversationId`, `isForegroundChatActive`, `addForegroundChatActivityListener`

## [src/lib/format.ts](../src/lib/format.ts)

`formatBytes`, `formatDuration`, `formatConversationActivityTime`

## [src/lib/incomingCallExpiry.ts](../src/lib/incomingCallExpiry.ts)

`isIncomingCallUrlExpired`

## [src/lib/liveKitRemoteSubscription.ts](../src/lib/liveKitRemoteSubscription.ts)

`ensureRemoteAudioPublicationSubscribed`, `ensureRemoteVideoPublicationSubscribed`, `recoverRemoteVideoPublicationIfDecoderStalled`

## [src/lib/liveLocation.ts](../src/lib/liveLocation.ts)

`LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS`, `requestLiveLocationPermissions`, `hasActiveLiveLocationShare`, `registerLiveLocationShare`, `stopTrackedLiveLocationShare`, `ensureLiveLocationTracking`, `hasLiveLocationBackgroundAuthorization`, `reconcileBackgroundLocationAccess`

## [src/lib/loginServerResolution.ts](../src/lib/loginServerResolution.ts)

`LoginHostUnavailableError`, `parseDomainLogin`, `resolveLoginServer`

## [src/lib/mediaCache.ts](../src/lib/mediaCache.ts)

`MediaDownloadProgress`, `sanitizeCacheFileName`, `getMessageMediaCacheUri`, `resolveCachedMessageMediaUri`, `getCachedVideoThumbnailUri`, `getRememberedCachedVideoThumbnailUri`, `isLocalMediaFileComplete`, `resolveLocalMediaFileUri`, `downloadRemoteMediaFile`, `subscribeToMediaDownloadProgress`, `getMediaDownloadProgress`, `pauseMediaDownload`, `resumeMediaDownload`, `removePartialMediaDownloadsForMessages`

## [src/lib/messageDeliveryDiagnostics.ts](../src/lib/messageDeliveryDiagnostics.ts)

`MESSAGE_DELIVERY_DIAGNOSTICS_ENABLED`, `logMessageDeliveryDiagnostic`, `logCallDiagnostic`, `refreshRemoteMessageDeliveryDiagnostics`, `isRemoteMessageDeliveryDiagnosticsEnabled`, `isRemoteCallDiagnosticsEnabled`, `flushRemoteMessageDeliveryDiagnostics`

## [src/lib/messageLinks.ts](../src/lib/messageLinks.ts)

`isConfiguredAppDomainUrl`, `openMessageUrl`

## [src/lib/messageNotifications.ts](../src/lib/messageNotifications.ts)

`showForegroundMessageNotification`, `dismissMessageNotificationsForConversation`, `dismissAllMessageNotifications`

## [src/lib/messageStore.ts](../src/lib/messageStore.ts)

`LocalUsageStats`, `LocalConversationUsageStats`, `MediaDownloadRecord`, `ActiveLiveLocationShare`, `listActiveLiveLocationShares`, `saveActiveLiveLocationShare`, `removeActiveLiveLocationShare`, `getMediaDownloadRecord`, `listPendingMediaDownloads`, `saveMediaDownloadRecord`, `removeMediaDownloadRecord`, `removeAllMediaDownloadRecords`, `getMessagesFromDatabase`, `getRecentMessagesFromDatabase`, `getMessagesByIdsFromDatabase`, `getOlderMessagesFromDatabase`, `getLatestMessagesByConversationIdsFromDatabase`, `saveMessagesToDatabase`, `upsertMessagesToDatabase`, `removeMessageRecordsFromDatabase`, `removeMessagesFromDatabase`, `removeAllMessagesFromDatabase`, `ensureMessageDatabaseReady`, `recordFinishedCallInDatabase`, `getLocalUsageStats`, `getLocalConversationUsageStats`

## [src/lib/payloadMask.ts](../src/lib/payloadMask.ts)

`MASK_HEADER`, `MASK_VERSION`, `MASK_SOCKET_AUTH_KEY`, `MASK_SOCKET_ARGS_KEY`, `MASK_SOCKET_VERSION_KEY`, `maskPayload`, `unmaskPayload`

## [src/lib/pendingShareDraft.ts](../src/lib/pendingShareDraft.ts)

`setPendingShareDraft`, `takePendingShareDraft`

## [src/lib/prohibitedNames.ts](../src/lib/prohibitedNames.ts)

`containsMeetVapKeyword`, `isProhibitedMeetVapUsername`

## [src/lib/realtimeSocket.ts](../src/lib/realtimeSocket.ts)

`setRealtimeSocket`, `getRealtimeSocket`

## [src/lib/reporting.ts](../src/lib/reporting.ts)

`getReportContextNotice`, `buildReportReason`

## [src/lib/screenCaptureProtection.ts](../src/lib/screenCaptureProtection.ts)

`setScreenCaptureProtectionRequirement`, `clearScreenCaptureProtectionRequirement`

## [src/lib/securityEvents.ts](../src/lib/securityEvents.ts)

`addSecurityEventListener`, `emitSecurityEvent`

## [src/lib/serverPolicy.ts](../src/lib/serverPolicy.ts)

`ClientPolicy`, `getClientPolicy`, `assertAttachmentsWithinPolicy`, `AttachmentPolicyError`

## [src/lib/shareIntentEvents.ts](../src/lib/shareIntentEvents.ts)

`emitShareIntentItems`, `subscribeToShareIntentItems`

## [src/lib/shareLinks.ts](../src/lib/shareLinks.ts)

`MEETVAP_WEB_HOST`, `buildSharedContactWebUrl`, `buildSharedContactAppUrl`, `buildSharedGroupWebUrl`, `buildSharedGroupAppUrl`, `buildSharedContactMessage`

## [src/lib/shareTargetItems.ts](../src/lib/shareTargetItems.ts)

`isUsableSharedItem`, `prepareSharedItem`, `formatShareSummary`, `formatShareSubtitle`

## [src/lib/socketMask.ts](../src/lib/socketMask.ts)

`maskSocketOutgoing`

## [src/lib/storage.ts](../src/lib/storage.ts)

`DEFAULT_SERVER_URL`, `ErasePinAlertConfig`, `StoredConversationSyncCursor`, `getServerUrl`, `setServerUrl`, `clearServerUrl`, `getAuthToken`, `setAuthToken`, `clearAuthToken`, `getStoredUser`, `setStoredUser`, `clearStoredUser`, `getStoredSubscriptionStatus`, `setStoredSubscriptionStatus`, `clearStoredSubscriptionStatus`, `getStoredPremiumTrialIntroSeen`, `setStoredPremiumTrialIntroSeen`, `getStoredSubscriptionExpiryNoticeSeen`, `setStoredSubscriptionExpiryNoticeSeen`, `getStoredVoiceCallTipDismissed`, `setStoredVoiceCallTipDismissed`, `getStoredMessages`, `getStoredRecentMessages`, `getStoredMessagesByIds`, `getStoredOlderMessages`, `getStoredLatestMessagesByConversationIds`, `setStoredMessages`, `upsertStoredMessages`, `removeStoredMessageRecords`, `removeStoredMessages`, `getStoredConversations`, `setStoredConversations`, `clearStoredConversations`, `getDeletedConversationAfter`, `getDeletedConversationAfters`, `setDeletedConversationAfter`, `clearDeletedConversationAfter`, `getStoredConversationSyncCursor`, `getStoredConversationSyncCursors`, `setStoredConversationSyncCursor`, `setStoredConversationSyncCursors`, `getStoredConversationMediaCacheCursor`, `setStoredConversationMediaCacheCursor`, `getStoredCallLogs`, `setStoredCallLogs`, `getStoredDarkMode`, `setStoredDarkMode`, `getStoredLanguage`, `setStoredLanguage`, `getStoredBackgroundLocationDisclosureVersion`, `setStoredBackgroundLocationDisclosureVersion`, `getStoredFavoriteConversationIds`, `setStoredFavoriteConversationIds`, `getStoredPlayedVoiceMessageIds`, `setStoredPlayedVoiceMessageIds`, `getStoredRecentEmojis`, `setStoredRecentEmojis`, `getStoredLockPin`, `setStoredLockPin`, `clearStoredLockPin`, `getStoredErasePin`, `setStoredErasePin`, `clearStoredErasePin`, `getStoredErasePinAlertConfig`, `setStoredErasePinAlertConfig`, `clearStoredErasePinAlertConfig`, `getStoredErasePinDeletePeers`, `setStoredErasePinDeletePeers`, `getStoredDecoyOffline`, `setStoredDecoyOffline`, `clearStoredDecoyOffline`, `MessageStorageMigrationProgress`, `MessageStorageMigrationResult`, `migrateLegacyMessageStorage`, `eraseLocalChatData`, `eraseLocalAppData`

## [src/lib/subscriptionAccess.ts](../src/lib/subscriptionAccess.ts)

`isSubscriptionBypassed`, `hasUsableSubscription`, `hasPremiumAccess`, `createEmptySubscriptionStatus`, `createBypassSubscriptionStatus`

## [src/lib/subscriptions.ts](../src/lib/subscriptions.ts)

`SUBSCRIPTION_PRODUCT_IDS`, `SubscriptionProductId`, `StoreSubscriptionProduct`, `StorePurchase`, `loadStoreSubscriptions`, `requestStoreSubscription`, `restoreStorePurchases`, `finishStorePurchase`, `closeStoreSubscriptions`

## [src/lib/systemChat.ts](../src/lib/systemChat.ts)

`MEETVAP_SYSTEM_USERNAME`, `MEETVAP_SYSTEM_TITLE`, `MEETVAP_SYSTEM_AVATAR_URL`, `isMeetVapSystemUser`, `isMeetVapSystemConversation`

## [src/lib/uiPerformanceDiagnostics.ts](../src/lib/uiPerformanceDiagnostics.ts)

`UI_PERFORMANCE_DIAGNOSTICS_ENABLED`, `logUiPerformanceDiagnostic`, `useUiPerformanceStallMonitor`

## [src/lib/voiceRoomDiagnostics.ts](../src/lib/voiceRoomDiagnostics.ts)

`MEETVAP_VOICE_ROOM_DEBUG`, `logVoiceRoomDiagnostic`

## [src/lib/voiceRoomSession.ts](../src/lib/voiceRoomSession.ts)

`VoiceRoomAudioRoute`, `VoiceRoomSessionState`, `getVoiceRoomSessionState`, `subscribeToVoiceRoomSession`, `joinVoiceRoomSession`, `leaveVoiceRoomSession`, `setVoiceRoomSelfMuted`, `setVoiceRoomAdminMuted`, `setVoiceRoomSpeakerMuted`, `setVoiceRoomPushToTalking`, `handleVoiceRoomActiveCallChange`, `subscribeVoiceRoomToActiveCalls`

## [src/native/CallNative.ts](../src/native/CallNative.ts)

`LiveVoiceEffectStatus`, `NativeSharedItem`, `AndroidIncomingCallPayload`, `CallAudioRoute`, `ImageDrawingPoint`, `ImageDrawingStroke`, `RenderedImageDrawing`, `getNativeAppVersion`, `getNativeAppBuildNumber`, `requestNativePlayIntegrityToken`, `generateNativeAppAttestKey`, `attestNativeAppAttestKey`, `generateNativeAppAttestAssertion`, `setNativeQuickReplyCredentials`, `clearNativeQuickReplyCredentials`, `waitForNativeCallKitAudioActivation`, `answerNativeIncomingCallKitCall`, `suppressNativeIncomingCallKitCall`, `peekNativePendingAnsweredCallKitCallId`, `peekNativePendingAnsweredCallKitUrl`, `consumeNativePendingIncomingCallUrl`, `peekNativePendingIncomingCallUrl`, `canUseNativeFullScreenIncomingCalls`, `openNativeFullScreenIncomingCallSettings`, `prepareNativeCallAudioSession`, `prepareNativeCallKitAudioSession`, `consumeNativeSharedItems`, `isIosMultitaskingCameraAccessSupported`, `hasPendingNativeSharedItems`, `processNativeVoiceMessage`, `setNativeLiveVoiceEffect`, `getNativeLiveVoiceEffect`, `getNativeLiveVoiceEffectStatus`, `beginNativeLiveVoiceEffectSession`, `setNativeLiveVoiceEffectAndWait`, `confirmNativeLiveVoiceEffectAttached`, `waitForNativeLiveVoiceProcessing`, `setCallPictureInPictureEnabled`, `enterCallPictureInPicture`, `closeCallPictureInPicture`, `startNativeCallService`, `setNativeCallAudioRoute`, `getNativeCallAudioRoutes`, `selectNativeCallAudioRoute`, `stopNativeCallService`, `setNativeProximityScreenOffEnabled`, `setNativeScreenCaptureProtection`, `setNativeMediaViewerOrientationUnlocked`, `startNativeIncomingRingtone`, `stopNativeIncomingRingtone`, `startNativeOutgoingRingback`, `stopNativeOutgoingRingback`, `showNativeAndroidIncomingCall`, `cancelNativeAndroidIncomingCall`, `cancelNativeMessageNotifications`, `registerIosVoipPushToken`, `endIosCallKitCall`, `openNativeAndroidFile`, `saveNativeAndroidFile`, `shareNativeAndroidFile`, `renderNativeImageDrawing`

## [src/navigation/MainTabs.tsx](../src/navigation/MainTabs.tsx)

`MainTabs`

## [src/navigation/RootNavigator.tsx](../src/navigation/RootNavigator.tsx)

`RootNavigator`

## [src/navigation/navigationRef.ts](../src/navigation/navigationRef.ts)

`navigationRef`, `flushPendingNavigation`, `navigateToCatalogUrl`, `navigateToIncomingCall`, `isCallRoomVisibleFor`, `getVisibleCallRoomParams`, `getVisibleChatRoomConversationId`, `restoreActiveCallIfNeeded`, `navigateToChat`, `navigateToChats`, `navigateToMeeting`, `restoreActiveMeetingIfNeeded`

## [src/screens/AddContactScreen.tsx](../src/screens/AddContactScreen.tsx)

`AddContactScreen`

## [src/screens/AuthScreen.tsx](../src/screens/AuthScreen.tsx)

`AuthScreen`

## [src/screens/BlockedUsersScreen.tsx](../src/screens/BlockedUsersScreen.tsx)

`BlockedUsersScreen`

## [src/screens/CallRoomScreen.tsx](../src/screens/CallRoomScreen.tsx)

`CallRoomScreen`

## [src/screens/CallsScreen.tsx](../src/screens/CallsScreen.tsx)

`CallsScreen`

## [src/screens/CatalogScreen.tsx](../src/screens/CatalogScreen.tsx)

`CatalogScreen`

## [src/screens/ChangePasswordScreen.tsx](../src/screens/ChangePasswordScreen.tsx)

`ChangePasswordScreen`

## [src/screens/ChatRoomController.tsx](../src/screens/ChatRoomController.tsx)

`useChatRoomController`

## [src/screens/ChatRoomDialogs.tsx](../src/screens/ChatRoomDialogs.tsx)

`ChatHeaderMenu`, `OptionPickerModal`, `ForwardMessageModal`, `ShareContactPickerModal`, `ChatGallerySection`, `AddSubscribersModal`, `GroupCallMemberPicker`, `ChatInfoModal`, `ensureSaveToPhonePermission`, `getShareableMediaUri`, `waitForIosModalDismissal`, `downloadMediaActionAttachment`

## [src/screens/ChatRoomMediaViewer.tsx](../src/screens/ChatRoomMediaViewer.tsx)

`MediaViewer`, `getPlayableVoiceUri`, `VoiceRoomPeopleModal`

## [src/screens/ChatRoomMessageActions.tsx](../src/screens/ChatRoomMessageActions.tsx)

`ComposerEditMenu`, `MessageRow`, `DateDivider`, `PinnedMessageBanner`, `PinnedMessagesModal`, `MessageActionMenuProps`, `MessageActionMenu`, `MediaActionMenuProps`, `MediaActionMenu`, `ActionMenuButton`, `EmojiPicker`, `VoiceEffectModal`, `AttachmentCaptionModal`, `EditMessageModal`, `SendOptionsModal`, `ImageDrawingModal`

## [src/screens/ChatRoomScreen.tsx](../src/screens/ChatRoomScreen.tsx)

`ChatRoomScreen`

## [src/screens/ChatRoomVoiceRecorder.tsx](../src/screens/ChatRoomVoiceRecorder.tsx)

`VoiceRecordingComposerState`, `HoldVoiceRecorderButton`, `restorePlaybackAudioMode`

## [src/screens/ChatsScreen.tsx](../src/screens/ChatsScreen.tsx)

`ChatsScreen`

## [src/screens/ContactsScreen.tsx](../src/screens/ContactsScreen.tsx)

`ContactsScreen`

## [src/screens/DevicesScreen.tsx](../src/screens/DevicesScreen.tsx)

`DevicesScreen`

## [src/screens/MeetingRoomScreen.tsx](../src/screens/MeetingRoomScreen.tsx)

`MeetingRoomScreen`

## [src/screens/NewChatScreen.tsx](../src/screens/NewChatScreen.tsx)

`NewChatScreen`

## [src/screens/NewGroupScreen.tsx](../src/screens/NewGroupScreen.tsx)

`NewGroupScreen`

## [src/screens/ServerSetupScreen.tsx](../src/screens/ServerSetupScreen.tsx)

`ServerSetupScreen`

## [src/screens/SettingsScreen.tsx](../src/screens/SettingsScreen.tsx)

`SettingsScreen`

## [src/screens/ShareTargetScreen.tsx](../src/screens/ShareTargetScreen.tsx)

`ShareTargetScreen`

## [src/screens/SharedContactScreen.tsx](../src/screens/SharedContactScreen.tsx)

`SharedContactScreen`

## [src/screens/SharedGroupScreen.tsx](../src/screens/SharedGroupScreen.tsx)

`SharedGroupScreen`

## [src/screens/StatusScreen.tsx](../src/screens/StatusScreen.tsx)

`StatusScreen`

## [src/screens/StorageUsageScreen.tsx](../src/screens/StorageUsageScreen.tsx)

`StorageUsageScreen`

## [src/screens/SubscriptionScreen.tsx](../src/screens/SubscriptionScreen.tsx)

`SubscriptionScreen`

## [src/screens/call/CallRoomPresentation.tsx](../src/screens/call/CallRoomPresentation.tsx)

`CallRoomPresentationProvider`, `InviteCandidate`, `CallParticipantProfile`, `ScreenPoint`, `ScreenBounds`, `AddPeopleModal`, `WaitingCallControls`, `MinimizedCallView`, `getMiniCallBounds`, `clampMiniCallPosition`, `ConnectedCallStage`, `WaitingVideoStage`, `LiveKitWaitingVideoStage`, `PeopleInCallModal`, `CallControl`, `IncomingControls`, `CallConnectionProblemModal`, `WaitingIncomingCallModal`

## [src/screens/call/CallRoomStyles.ts](../src/screens/call/CallRoomStyles.ts)

`createCallRoomStyles`

## [src/screens/chat/ChatRoomStyles.ts](../src/screens/chat/ChatRoomStyles.ts)

`createChatRoomStyles`, `chatRoomStyles`, `refreshChatRoomStyles`

## [src/screens/lib/ChatMediaHelpers.ts](../src/screens/lib/ChatMediaHelpers.ts)

`getMimeTypeFromFileName`, `getUsableMimeType`, `getMessageMimeType`, `getMessageFileName`, `getKnownFileSize`, `getSharedItemFileName`, `getSharedItemMessageKind`, `PendingCaptionAttachment`, `getSharedPendingAttachment`, `prepareOutgoingAttachment`, `ensureSaveToPhonePermission`, `getMessageRemoteMediaUri`, `getMediaActionCacheUri`, `downloadMediaActionAttachment`, `getShareableMediaUri`, `getPlayableVideoUri`, `getRenderableImageUri`, `getPlayableVoiceUri`, `stopRecorderIfNeeded`, `getRecorderStatusSafely`, `isReleasedRecorderError`, `getRecordingDurationSeconds`, `waitForRecordedFile`, `getLocationAddress`, `getVoiceRoomAudioRouteLabel`, `formatVoiceComposerEffectLabel`, `isShareableMediaMessage`, `isViewableImageMessage`, `createMessageDeleteKey`, `getMessageDeleteKey`, `shouldRemovePinnedMessageForDeletion`, `getInitialUploadProgress`, `getMessageRenderKey`

## [src/screens/lib/ChatMessagePreview.ts](../src/screens/lib/ChatMessagePreview.ts)

`getReplySenderName`, `getMessagePreview`, `getReplyPreview`, `getDisappearingSecondsAfterView`, `mergePinnedMessageWithLocalCopy`, `getMessageCaption`, `getMessageLocation`, `getPinnedMessageTitle`, `getPinnedMessageSearchText`, `getPinnedStaticMapUrl`, `formatPinnedDateTime`, `ForwardTargetLike`, `filterForwardTargets`, `filterForwardTargetsByAnySearch`, `getGroupMemberRank`, `extractChatLinks`, `getLinkHost`, `formatSubscriberCount`

## [src/screens/lib/ChatMiscHelpers.ts](../src/screens/lib/ChatMiscHelpers.ts)

`ChatDateDividerItem`, `ChatMessageListItem`, `ChatListItem`, `getMessageDate`, `getDateDividerKey`, `isSameCalendarDate`, `formatChatDateDivider`, `buildChatListItems`, `shouldRenderTimelineMessage`, `getChatListItemRenderKey`, `getGroupCallLimit`, `isToday`, `formatTimeAgo`, `formatPresenceSubtitle`, `formatDateInput`, `parseScheduledSendAt`, `ImageDrawingPoint`, `ImageDrawingStrokeLike`, `clamp`, `getDrawingPath`, `getPaginationItems`

## [src/store/useAppStore.ts](../src/store/useAppStore.ts)

`reconcileLoadedConversationsInBackground`, `AppState`, `useAppStore`

## [src/theme/colors.ts](../src/theme/colors.ts)

`lightColors`, `darkColors`, `ThemeColors`, `colors`

## [src/theme/spacing.ts](../src/theme/spacing.ts)

`spacing`

## [src/theme/useThemeColors.ts](../src/theme/useThemeColors.ts)

`useThemeColors`

## [src/types/domain.ts](../src/types/domain.ts)

`AuthUser`, `Conversation`, `VoiceRoomParticipant`, `MessageKind`, `Message`, `LiveLocation`, `CallLog`, `SubscriptionStatus`

## [src/types/navigation.ts](../src/types/navigation.ts)

`RootStackParamList`, `SharedIntentItem`, `MainTabParamList`

## [src/types/voiceEffects.ts](../src/types/voiceEffects.ts)

`VoiceEffectId`, `DEFAULT_VOICE_EFFECT_ID`, `normalizeVoiceEffectId`


