# Complete Source Index

This index accounts for the production React Native, iOS, and Android source files in the documented scope. Public symbols are named where they form a reusable contract; private helpers are described with their owning file because they are implementation details.

## Application entry

- [`App.tsx`](../App.tsx) - initializes WebRTC/LiveKit, installation/language/storage migration, store bootstrap, deep links, lock/update gates, navigation, quick-reply credentials, and global bridges.
- [`app.json`](../app.json) - Expo identity, version/build, permissions, plugins, URL schemes, associated domains, and platform metadata.

## Components

- [`AppAttestationBridge.tsx`](../src/components/AppAttestationBridge.tsx) - schedules authenticated Play Integrity/App Attest runs.
- [`AppLockGate.tsx`](../src/components/AppLockGate.tsx) - PIN/erase-PIN overlay, app-state locking, biometric-aware/native-call exceptions.
- [`AppUpdateGate.tsx`](../src/components/AppUpdateGate.tsx) - minimum version and attestation enforcement/retry UI.
- [`AttachmentSheet.tsx`](../src/components/AttachmentSheet.tsx) - image, camera, video, document, location, and contact attachment commands.
- [`Avatar.tsx`](../src/components/Avatar.tsx) - avatar image with initials fallback.
- [`BackgroundLocationDisclosureBridge.tsx`](../src/components/BackgroundLocationDisclosureBridge.tsx) - queued consent modal before background location access.
- [`HelpWebViewModal.tsx`](../src/components/HelpWebViewModal.tsx) - server-configured help WebView with navigation/error state.
- [`MessageBubble.tsx`](../src/components/MessageBubble.tsx) - presentation and interaction for every message kind.
- [`PinPad.tsx`](../src/components/PinPad.tsx) - reusable lock keypad and error/loading states.
- [`PremiumTrialIntro.tsx`](../src/components/PremiumTrialIntro.tsx) - one-time premium trial explanation.
- [`PremiumUserBadge.tsx`](../src/components/PremiumUserBadge.tsx) - premium status marker.
- [`PrimaryButton.tsx`](../src/components/PrimaryButton.tsx) - themed command/loading button.
- [`PushNotificationBridge.tsx`](../src/components/PushNotificationBridge.tsx) - push registration, notification handlers, badge, message recovery, and call navigation; exports `handleIncomingCallUrl`.
- [`RealtimeBridge.tsx`](../src/components/RealtimeBridge.tsx) - Socket.IO lifecycle and realtime reducers.
- [`ScreenBackground.tsx`](../src/components/ScreenBackground.tsx) - shared application background.
- [`ShareIntentBridge.tsx`](../src/components/ShareIntentBridge.tsx) - native shared-item import and routing.
- [`TextField.tsx`](../src/components/TextField.tsx) - shared themed text input.
- [`VoiceRoomBridge.tsx`](../src/components/VoiceRoomBridge.tsx) - process-wide LiveKit voice-room host.
- [`VoiceRoomControls.tsx`](../src/components/chat/VoiceRoomControls.tsx) - voice-room join/mute/push-to-talk/leave controls.

## Hooks

- [`useChatAttachments.ts`](../src/hooks/useChatAttachments.ts) - selection, preparation, captions, drawing, scheduling, upload, and location/contact attachments.
- [`useChatHydration.ts`](../src/hooks/useChatHydration.ts) - conversation entry hydration and reconciliation.
- [`useChatKeyboardLift.ts`](../src/hooks/useChatKeyboardLift.ts) - keyboard overlap/lift state and controller contract.
- [`useChatTimelineWindow.ts`](../src/hooks/useChatTimelineWindow.ts) - bounded visible timeline and local history paging constants/actions.
- [`useChatVoiceRoom.ts`](../src/hooks/useChatVoiceRoom.ts) - maps group/voice-room state into chat commands.
- [`useConversationById.ts`](../src/hooks/useConversationById.ts) - stable current conversation selector.
- [`useNotificationMessageRecovery.ts`](../src/hooks/useNotificationMessageRecovery.ts) - targeted fetch when a notification-opened message is absent locally.
- [`useStableCallback.ts`](../src/hooks/useStableCallback.ts) - callback identity that always calls the latest implementation.
- [`useVoiceCallTip.tsx`](../src/hooks/useVoiceCallTip.tsx) - persisted educational call-tip flow.

## Core libraries: session, policy, and security

- [`activeCallSession.ts`](../src/lib/activeCallSession.ts) - get/set/subscribe active call route and identity comparison.
- [`activeMeetingSession.ts`](../src/lib/activeMeetingSession.ts) - get/set/subscribe active meeting.
- [`answeredCallKitLaunch.ts`](../src/lib/answeredCallKitLaunch.ts) - reconstructs answered native iOS calls during cold start and begins call-only access.
- [`api.ts`](../src/lib/api.ts) - `ApiError`, authenticated request transport, and server URL validation.
- [`appAttestation.ts`](../src/lib/appAttestation.ts) - Android/iOS attestation registration/assertion lifecycle.
- [`appClientInfo.ts`](../src/lib/appClientInfo.ts) - installation ID and version/platform/capability request headers.
- [`appLockAccess.ts`](../src/lib/appLockAccess.ts) - lock status events, call-only state, and foreground-operation guards.
- [`authSuspensionEvents.ts`](../src/lib/authSuspensionEvents.ts) - account/device suspension event bus.
- [`loginServerResolution.ts`](../src/lib/loginServerResolution.ts) - parses `username@domain`, resolves/falls back API hostname, and reports unreachable hosts.
- [`payloadMask.ts`](../src/lib/payloadMask.ts) - HTTP/socket payload mask constants and encode/decode.
- [`prohibitedNames.ts`](../src/lib/prohibitedNames.ts) - reserved MeetVap username checks.
- [`screenCaptureProtection.ts`](../src/lib/screenCaptureProtection.ts) - reason-based native protection reference counting.
- [`securityEvents.ts`](../src/lib/securityEvents.ts) - local security event bus.
- [`serverPolicy.ts`](../src/lib/serverPolicy.ts) - policy fetch/cache and attachment-size enforcement.
- [`socketMask.ts`](../src/lib/socketMask.ts) - wraps outgoing Socket.IO payload masking.
- [`storage.ts`](../src/lib/storage.ts) - SecureStore, AsyncStorage, SQLite delegation, preferences/cursors, migration, and erasure.
- [`subscriptionAccess.ts`](../src/lib/subscriptionAccess.ts) - canonical subscription/premium/bypass decisions.
- [`subscriptions.ts`](../src/lib/subscriptions.ts) - native store product/purchase/restore/finish lifecycle.
- [`systemChat.ts`](../src/lib/systemChat.ts) - MeetVap system user/conversation identity helpers.

## Core libraries: messaging and conversations

- [`backend.ts`](../src/lib/backend.ts) - complete typed mobile HTTP API and response/message mapping.
- [`backgroundPrefetch.ts`](../src/lib/backgroundPrefetch.ts) - low-priority conversation message prefetch.
- [`conversationList.ts`](../src/lib/conversationList.ts) - list filter type, stale interval, and server-filter test.
- [`conversationMute.ts`](../src/lib/conversationMute.ts) - mute durations/options and active mute calculation.
- [`disappearingMessages.ts`](../src/lib/disappearingMessages.ts) - supported expiration durations and labels.
- [`foregroundChatActivity.ts`](../src/lib/foregroundChatActivity.ts) - active chat ownership and listeners used to cancel background maintenance.
- [`format.ts`](../src/lib/format.ts) - byte, duration, and conversation activity formatting.
- [`mediaCache.ts`](../src/lib/mediaCache.ts) - media/thumbnail paths, resumable downloads, progress, pause/resume, and partial cleanup.
- [`messageDeliveryDiagnostics.ts`](../src/lib/messageDeliveryDiagnostics.ts) - local/remote message and call diagnostic buffering.
- [`messageLinks.ts`](../src/lib/messageLinks.ts) - app-domain matching and internal/external URL opening.
- [`messageNotifications.ts`](../src/lib/messageNotifications.ts) - foreground message notifications and cancellation.
- [`messageStore.ts`](../src/lib/messageStore.ts) - SQLite messages, media download/live-location records, call stats, dedupe, merging, and usage queries.
- [`reporting.ts`](../src/lib/reporting.ts) - report context notice and reason composition.
- [`shareLinks.ts`](../src/lib/shareLinks.ts) - contact/group web/app link generation and share text.

## Core libraries: calls, location, sharing, diagnostics

- [`backgroundLocationDisclosure.ts`](../src/lib/backgroundLocationDisclosure.ts) - disclosure persistence, request queue, and response subscription.
- [`callAnswerClient.ts`](../src/lib/callAnswerClient.ts) - stable mobile answer-client ID.
- [`callEvents.ts`](../src/lib/callEvents.ts) - in-process typed call event bus.
- [`incomingCallExpiry.ts`](../src/lib/incomingCallExpiry.ts) - incoming-call deep-link freshness test.
- [`liveKitRemoteSubscription.ts`](../src/lib/liveKitRemoteSubscription.ts) - remote audio/video subscription, quality, and decoder recovery.
- [`liveLocation.ts`](../src/lib/liveLocation.ts) - foreground/background location permission, task, persistence, update, stop, and reconciliation.
- [`pendingShareDraft.ts`](../src/lib/pendingShareDraft.ts) - one-shot shared draft storage.
- [`realtimeSocket.ts`](../src/lib/realtimeSocket.ts) - process-level current Socket.IO reference.
- [`shareIntentEvents.ts`](../src/lib/shareIntentEvents.ts) - shared-item event bus.
- [`shareTargetItems.ts`](../src/lib/shareTargetItems.ts) - validates/prepares imported items and formats summaries.
- [`uiPerformanceDiagnostics.ts`](../src/lib/uiPerformanceDiagnostics.ts) - gated UI event/stall logging.
- [`voiceRoomDiagnostics.ts`](../src/lib/voiceRoomDiagnostics.ts) - gated voice-room logs.
- [`voiceRoomSession.ts`](../src/lib/voiceRoomSession.ts) - voice-room state machine and active-call coordination.

## Native TypeScript facade

- [`CallNative.ts`](../src/native/CallNative.ts) - platform-safe wrappers for version/build, Play Integrity, App Attest, quick reply, CallKit/full-screen calls, shared items, voice processing/effects, PiP, audio routes, foreground service, proximity, screen protection, orientation, ringtone/ringback, notifications, file open/save/share, and image drawing.

## Navigation

- [`MainTabs.tsx`](../src/navigation/MainTabs.tsx) - Chats/Calls/Status/Catalog tabs and indicators.
- [`RootNavigator.tsx`](../src/navigation/RootNavigator.tsx) - authenticated/unauthenticated stack definitions.
- [`navigationRef.ts`](../src/navigation/navigationRef.ts) - queued global navigation, visible route inspection, and call/meeting/chat restoration.

## Screens

- [`AddContactScreen.tsx`](../src/screens/AddContactScreen.tsx) - search and add contact.
- [`AuthScreen.tsx`](../src/screens/AuthScreen.tsx) - login/register and domain server resolution.
- [`BlockedUsersScreen.tsx`](../src/screens/BlockedUsersScreen.tsx) - blocked-user list and unblock.
- [`CallRoomScreen.tsx`](../src/screens/CallRoomScreen.tsx) - complete call state/media/native lifecycle.
- [`CallsScreen.tsx`](../src/screens/CallsScreen.tsx) - call log, redial, and deletion.
- [`CatalogScreen.tsx`](../src/screens/CatalogScreen.tsx) - catalog/internal-domain WebView.
- [`ChangePasswordScreen.tsx`](../src/screens/ChangePasswordScreen.tsx) - authenticated password update.
- [`ChatRoomController.tsx`](../src/screens/ChatRoomController.tsx) - chat orchestration hook.
- [`ChatRoomDialogs.tsx`](../src/screens/ChatRoomDialogs.tsx) - header/info/gallery/member/forward/ownership dialogs and media action helpers.
- [`ChatRoomMediaViewer.tsx`](../src/screens/ChatRoomMediaViewer.tsx) - zoom image/video viewer and voice-room people modal.
- [`ChatRoomMessageActions.tsx`](../src/screens/ChatRoomMessageActions.tsx) - message menus, row, reactions, pinned UI, voice effect, captions, scheduling, drawing, editing.
- [`ChatRoomScreen.tsx`](../src/screens/ChatRoomScreen.tsx) - chat rendering, list, composer, header, overlays.
- [`ChatRoomVoiceRecorder.tsx`](../src/screens/ChatRoomVoiceRecorder.tsx) - hold/lock/cancel voice recording and audio restoration.
- [`ChatsScreen.tsx`](../src/screens/ChatsScreen.tsx) - main local-first conversation list and menus.
- [`ContactsScreen.tsx`](../src/screens/ContactsScreen.tsx) - contacts and actions.
- [`DevicesScreen.tsx`](../src/screens/DevicesScreen.tsx) - QR web pairing/device management.
- [`MeetingRoomScreen.tsx`](../src/screens/MeetingRoomScreen.tsx) - meeting lookup/join/LiveKit/tiles/host controls.
- [`NewChatScreen.tsx`](../src/screens/NewChatScreen.tsx) - direct conversation creation.
- [`NewGroupScreen.tsx`](../src/screens/NewGroupScreen.tsx) - normal group/voice-room creation.
- [`ServerSetupScreen.tsx`](../src/screens/ServerSetupScreen.tsx) - explicit API URL setup.
- [`SettingsScreen.tsx`](../src/screens/SettingsScreen.tsx) - profile, privacy, lock, language/theme, devices, subscription, storage, help, deletion.
- [`ShareTargetScreen.tsx`](../src/screens/ShareTargetScreen.tsx) - send imported native share items.
- [`SharedContactScreen.tsx`](../src/screens/SharedContactScreen.tsx) - public contact profile link.
- [`SharedGroupScreen.tsx`](../src/screens/SharedGroupScreen.tsx) - public group invite link.
- [`StatusScreen.tsx`](../src/screens/StatusScreen.tsx) - create/view/reply/delete statuses and audience/viewers.
- [`StorageUsageScreen.tsx`](../src/screens/StorageUsageScreen.tsx) - local usage metrics.
- [`SubscriptionScreen.tsx`](../src/screens/SubscriptionScreen.tsx) - in-app purchase and entitlement UI.

## Chat/call presentation and helpers

- [`CallRoomPresentation.tsx`](../src/screens/call/CallRoomPresentation.tsx) - call provider, stages, controls, people/add-member/problem/waiting modals, and mini-call bounds.
- [`CallRoomStyles.ts`](../src/screens/call/CallRoomStyles.ts) - dynamic call styles.
- [`ChatRoomStyles.ts`](../src/screens/chat/ChatRoomStyles.ts) - dynamic chat styles and refresh function.
- [`ChatMediaHelpers.ts`](../src/screens/lib/ChatMediaHelpers.ts) - MIME/file/media/recording/location/drawing/delete/render helpers.
- [`ChatMessagePreview.ts`](../src/screens/lib/ChatMessagePreview.ts) - message/reply/pin previews, forwarding filters, link extraction, member ranking/count.
- [`ChatMiscHelpers.ts`](../src/screens/lib/ChatMiscHelpers.ts) - timeline item/date builders, presence/time formatting, schedule parsing, drawing path, pagination.

## Store, data, types, theme, and localization

- [`useAppStore.ts`](../src/store/useAppStore.ts) - global state, domain commands, local-first synchronization, optimistic sends, persistence, receipts, and background maintenance.
- [`mockData.ts`](../src/data/mockData.ts) - development/demo users, conversations, messages, and calls; not part of production persistence.
- [`domain.ts`](../src/types/domain.ts) - user, conversation, message, voice-room, call-log, and subscription domain types.
- [`navigation.ts`](../src/types/navigation.ts) - stack/tab routes and shared intent type.
- [`voiceEffects.ts`](../src/types/voiceEffects.ts) - effect IDs, default, and normalization.
- [`colors.ts`](../src/theme/colors.ts) - light/dark palettes and mutable active palette.
- [`spacing.ts`](../src/theme/spacing.ts) - spacing scale.
- [`useThemeColors.ts`](../src/theme/useThemeColors.ts) - synchronizes active palette with store theme.
- [`i18n/index.ts`](../src/i18n/index.ts) - language resolution and translation functions.
- [`i18n/types.ts`](../src/i18n/types.ts) - supported languages/preferences and translation value type.
- [`i18n/en.ts`](../src/i18n/en.ts) - English dictionary and canonical translation shape.
- [`i18n/az.ts`](../src/i18n/az.ts) - Azerbaijani dictionary.
- [`i18n/de.ts`](../src/i18n/de.ts) - German dictionary.
- [`i18n/es.ts`](../src/i18n/es.ts) - Spanish dictionary.
- [`i18n/fr.ts`](../src/i18n/fr.ts) - French dictionary.
- [`i18n/it.ts`](../src/i18n/it.ts) - Italian dictionary.
- [`i18n/pt.ts`](../src/i18n/pt.ts) - Portuguese dictionary.
- [`i18n/ptBR.ts`](../src/i18n/ptBR.ts) - Brazilian Portuguese dictionary.
- [`i18n/ru.ts`](../src/i18n/ru.ts) - Russian dictionary.
- [`i18n/tr.ts`](../src/i18n/tr.ts) - Turkish dictionary.

## iOS main application

- [`AppDelegate.swift`](../ios/MeetVap/AppDelegate.swift) - Expo/React startup, LiveKit setup, links, and orientation delegation.
- [`CallNative.swift`](../ios/MeetVap/CallNative.swift) - native bridge plus App Attest, PushKit/CallKit, audio routes, voice processing, quick reply, sharing, drawing, capture protection, and ring audio.
- [`CallNativeBridge.m`](../ios/MeetVap/CallNativeBridge.m) - React Native extern method declarations.
- [`MeetVap-Bridging-Header.h`](../ios/MeetVap/MeetVap-Bridging-Header.h) - Objective-C/Swift bridge imports.
- [`Info.plist`](../ios/MeetVap/Info.plist) - app metadata, permissions, background modes, schemes, screen-share identifiers.
- [`MeetVap.entitlements`](../ios/MeetVap/MeetVap.entitlements) - production push, App Attest, associated domains, camera, and app group.
- [`MeetVap.debug.entitlements`](../ios/MeetVap/MeetVap.debug.entitlements) - development push/App Attest equivalents.
- [`Supporting/Expo.plist`](../ios/MeetVap/Supporting/Expo.plist) - Expo runtime configuration.
- [`project.pbxproj`](../ios/MeetVap.xcodeproj/project.pbxproj) - targets, build settings, signing, files, and dependencies.

## iOS share extension

- [`ShareViewController.swift`](../ios/MeetVapShareExtension/ShareViewController.swift) - reads/copies shared items, writes app-group manifest, launches app.
- [`Info.plist`](../ios/MeetVapShareExtension/Info.plist) - share activation types/counts.
- [`MeetVapShareExtension.entitlements`](../ios/MeetVapShareExtension/MeetVapShareExtension.entitlements) - shared app group.

## iOS screen-share extension

- [`Atomic.swift`](../ios/MeetVapScreenShareExtension/Atomic.swift) - lock-protected mutable value.
- [`SampleHandler.swift`](../ios/MeetVapScreenShareExtension/SampleHandler.swift) - ReplayKit broadcast lifecycle/sample dispatch.
- [`SampleUploader.swift`](../ios/MeetVapScreenShareExtension/SampleUploader.swift) - sample serialization/chunk upload.
- [`ScreenShareSocketConnection.swift`](../ios/MeetVapScreenShareExtension/ScreenShareSocketConnection.swift) - local stream connection and writes.
- [`Info.plist`](../ios/MeetVapScreenShareExtension/Info.plist) - ReplayKit upload extension declaration.
- [`MeetVapScreenShareExtension.entitlements`](../ios/MeetVapScreenShareExtension/MeetVapScreenShareExtension.entitlements) - screen-share app group.

## Android Kotlin

- [`MainApplication.kt`](../android/app/src/main/java/com/meetvap/messenger/MainApplication.kt) - Expo host, native package, LiveKit, voice processor, new architecture.
- [`MainActivity.kt`](../android/app/src/main/java/com/meetvap/messenger/MainActivity.kt) - intents, foreground state, PiP, orientation, React activity.
- [`CallNativePackage.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativePackage.kt) - bridge registration.
- [`CallNativeModule.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativeModule.kt) - full Android native bridge and voice processor.
- [`CallForegroundService.kt`](../android/app/src/main/java/com/meetvap/messenger/CallForegroundService.kt) - active call foreground notification/service.
- [`IncomingCallIntentStore.kt`](../android/app/src/main/java/com/meetvap/messenger/IncomingCallIntentStore.kt) - pending call URL handoff.
- [`IncomingCallNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/IncomingCallNotificationHelper.kt) - full-screen/heads-up call notification and payload freshness.
- [`MeetVapFirebaseMessagingService.kt`](../android/app/src/main/java/com/meetvap/messenger/MeetVapFirebaseMessagingService.kt) - raw FCM message/call/end handling and receipts.
- [`MessageNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/MessageNotificationHelper.kt) - message notifications, reply/read actions.
- [`QuickReplyApi.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyApi.kt) - native masked reply/read HTTP client.
- [`QuickReplyCredentials.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyCredentials.kt) - private native API credentials.
- [`QuickReplyReceiver.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyReceiver.kt) - notification action worker.
- [`ShareForwardActivity.kt`](../android/app/src/main/java/com/meetvap/messenger/ShareForwardActivity.kt) - Android share-target forwarding.

## Android configuration/resources

- [`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml) - production permissions, services, receivers, activities, links, and Android 15 restrictions.
- [`debug/AndroidManifest.xml`](../android/app/src/debug/AndroidManifest.xml) - debug manifest overlay.
- [`debugOptimized/AndroidManifest.xml`](../android/app/src/debugOptimized/AndroidManifest.xml) - optimized-debug manifest overlay.
- [`app/build.gradle`](../android/app/build.gradle) - Android application build, versions, signing, placeholders, dependencies.
- [`build.gradle`](../android/build.gradle) - root Android plugins/repositories/toolchain.
- [`settings.gradle`](../android/settings.gradle) - Gradle/Expo module setup.
- [`gradle.properties`](../android/gradle.properties) - architecture, Hermes/new-architecture and build properties.
- [`gradle-wrapper.properties`](../android/gradle/wrapper/gradle-wrapper.properties) - Gradle distribution version.
- [`strings.xml`](../android/app/src/main/res/values/strings.xml) - Android application/resource strings.
- [`styles.xml`](../android/app/src/main/res/values/styles.xml) - activity/splash themes.
- [`colors.xml`](../android/app/src/main/res/values/colors.xml) and [`values-night/colors.xml`](../android/app/src/main/res/values-night/colors.xml) - day/night native colors.
- [`ic_launcher.xml`](../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml), [`ic_launcher_round.xml`](../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml), and [`ic_launcher_background.xml`](../android/app/src/main/res/drawable/ic_launcher_background.xml) - adaptive launcher resources.
- [`rn_edit_text_material.xml`](../android/app/src/main/res/drawable/rn_edit_text_material.xml) - React Native edit-text background compatibility resource.
