# Notifications, Sharing, and Location

## Push notification bridge

[`PushNotificationBridge.tsx`](../src/components/PushNotificationBridge.tsx) is the React Native notification coordinator. It:

- configures foreground notification behavior and categories
- requests notification permission
- registers Expo/FCM/APNs and iOS VoIP tokens with the connected server
- handles notification receipt and response listeners
- routes message taps to chats and call actions to call-only navigation
- restores pending native incoming-call URLs after cold start
- synchronizes iOS application badge counts
- starts targeted message recovery when a notification references content not yet in SQLite

The bridge is mounted only for authenticated, non-decoy sessions.

## Native notification paths

### Android

[`MeetVapFirebaseMessagingService.kt`](../android/app/src/main/java/com/meetvap/messenger/MeetVapFirebaseMessagingService.kt) receives raw FCM data. It acknowledges delivery receipts, handles call-ended payloads, displays native message notifications when React is not foregrounded, validates incoming-call freshness, and delegates call UI.

[`MessageNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/MessageNotificationHelper.kt) builds message notifications with reply and mark-read actions. [`QuickReplyReceiver.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyReceiver.kt) performs asynchronous notification actions using [`QuickReplyApi.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyApi.kt). Credentials are stored by [`QuickReplyCredentials.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyCredentials.kt).

[`IncomingCallNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/IncomingCallNotificationHelper.kt) owns call notification channels, full-screen intents, accept/decline actions, timeout/cancel behavior, wake behavior, and stable notification IDs.

### iOS

Normal notifications are handled through Expo notifications plus native quick-reply support in [`CallNative.swift`](../ios/MeetVap/CallNative.swift). VoIP pushes are handled by PushKit/CallKit in the same file. Native pending-call storage survives process launch races.

## Notification delivery versus message delivery

A native push delivery receipt only confirms that platform code received the push. It does not mean the message is in SQLite. React recovery and normal conversation synchronization fetch the canonical message, persist it, and then send content/delivery acknowledgements with their own semantics.

## Sharing into MeetVap

[`ShareIntentBridge.tsx`](../src/components/ShareIntentBridge.tsx) consumes native shared items, converts them to `SharedIntentItem`, and sends the user to the share-target workflow or forwards them into an active call share picker.

[`shareTargetItems.ts`](../src/lib/shareTargetItems.ts) validates items, copies/prepares files, and creates human summaries. [`pendingShareDraft.ts`](../src/lib/pendingShareDraft.ts) provides a one-shot handoff between navigation surfaces. [`shareIntentEvents.ts`](../src/lib/shareIntentEvents.ts) broadcasts incoming shares to mounted consumers.

Native ingress:

- iOS [`ShareViewController.swift`](../ios/MeetVapShareExtension/ShareViewController.swift) reads up to 20 attachments/text/URLs, copies files into the app group, writes a manifest, and opens the containing app.
- Android [`ShareForwardActivity.kt`](../android/app/src/main/java/com/meetvap/messenger/ShareForwardActivity.kt) forwards SEND/SEND_MULTIPLE intents and URI grants to `MainActivity`, which exposes them to the native bridge.

[`ShareTargetScreen.tsx`](../src/screens/ShareTargetScreen.tsx) lists target conversations and sends prepared items.

## Sharing out of MeetVap

Chat media actions resolve a complete local file and call native save/share functions through [`CallNative.ts`](../src/native/CallNative.ts). iOS uses document/photo/activity coordinators; Android uses content URIs, MediaStore/document providers, and share intents.

Contact/group links are built by [`shareLinks.ts`](../src/lib/shareLinks.ts). External links in messages use [`messageLinks.ts`](../src/lib/messageLinks.ts), which compares the hostname with server-provided `appDomains` and opens matching domains in the in-app catalog WebView.

## Live location

[`liveLocation.ts`](../src/lib/liveLocation.ts) registers the Expo background task at module import, requests foreground/background permission, persists active shares in SQLite, starts/stops OS location updates, and posts updates to the server until expiry.

[`backgroundLocationDisclosure.ts`](../src/lib/backgroundLocationDisclosure.ts) stores disclosure acceptance and serializes consent requests. [`BackgroundLocationDisclosureBridge.tsx`](../src/components/BackgroundLocationDisclosureBridge.tsx) renders the disclosure and only continues permission work after explicit acceptance.

The app reconciles active shares after restart and disables tracking when authorization is lost. Android declares location foreground-service/background permissions; iOS declares location background mode and usage descriptions.

## Screen capture and orientation

[`screenCaptureProtection.ts`](../src/lib/screenCaptureProtection.ts) reference-counts protection requirements by reason. Native implementations apply secure-window/capture overlays:

- Android uses secure window flags.
- iOS uses secure text-field canvas containers and a capture overlay.

Call/chat privacy settings obtain server policy before enabling protection. [`CallNativeOrientationLock`](../ios/MeetVap/CallNative.swift) and Android requested orientation allow media/screen-share viewers to unlock orientation temporarily.

## Picture in picture and foreground services

Android call picture-in-picture is controlled through native bridge methods and `MainActivity`. Active calls start `CallForegroundService` with camera/microphone service types. The manifest explicitly removes boot receivers that could start restricted media-projection/foreground services on Android 15+.

iOS call presentation relies on CallKit and multitasking-camera support rather than the Android PiP bridge.
