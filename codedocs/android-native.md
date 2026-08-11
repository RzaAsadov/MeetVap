# Android Native Implementation

## Application startup

[`MainApplication.kt`](../android/app/src/main/java/com/meetvap/messenger/MainApplication.kt) creates the Expo React host, manually registers `CallNativePackage`, configures LiveKit communication audio, installs the voice-effect processor registry, enables the React Native new architecture, and forwards configuration changes to Expo.

[`CallNativePackage.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativePackage.kt) registers the `CallNativeModule` bridge.

## MainActivity

[`MainActivity.kt`](../android/app/src/main/java/com/meetvap/messenger/MainActivity.kt) is single-task and owns:

- Expo/React activity creation
- incoming-call intent normalization and pending storage
- share intent extraction/forwarding to the bridge
- app foreground tracking used by FCM
- picture-in-picture mode callbacks
- orientation and activity result behavior needed by call/media operations

[`IncomingCallIntentStore.kt`](../android/app/src/main/java/com/meetvap/messenger/IncomingCallIntentStore.kt) provides synchronized pending incoming-call URL storage across activity/React startup timing.

## CallNativeModule

[`CallNativeModule.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativeModule.kt) is the Android implementation behind [`CallNative.ts`](../src/native/CallNative.ts).

### Identity and integrity

- Returns native app version/build.
- Requests Google Play Integrity standard tokens for server nonces.
- Stores/clears quick-reply server credentials.

### Window and media behavior

- Locks/unlocks viewer orientation.
- Enables/disables `FLAG_SECURE` screen protection.
- Enters/closes picture in picture.
- Opens, saves, shares files using content resolvers/MediaStore/FileProvider-compatible URIs.
- Renders normalized image drawing strokes to an output bitmap.
- Consumes pending SEND/SEND_MULTIPLE items.

### Calls and audio

- Starts/stops the call foreground service.
- Enumerates and selects earpiece, speaker, Bluetooth, and wired routes.
- Uses communication-device APIs on newer Android and AudioManager fallback on older versions.
- Tracks explicit speaker selection and proximity state.
- Starts/stops native ringtone and spaced outgoing ringback.
- Shows/cancels incoming-call notifications.

### Voice effects

`MeetVapLiveVoiceEffectRegistry` installs the LiveKit audio processor factory. `LiveVoiceEffectProcessor` modifies PCM using pitch/tone filtering and tracks attached/factory/processed-frame status. The module also processes recorded voice-message files and exposes diagnostics used by JavaScript strict verification.

## Foreground call service

[`CallForegroundService.kt`](../android/app/src/main/java/com/meetvap/messenger/CallForegroundService.kt) creates a persistent active-call notification and starts with microphone/camera foreground service types. Session IDs prevent a stale stop request from terminating a newer call service.

## Firebase messaging

[`MeetVapFirebaseMessagingService.kt`](../android/app/src/main/java/com/meetvap/messenger/MeetVapFirebaseMessagingService.kt) handles raw data messages before React may exist. It posts push/ringing receipts, terminates ended call UI, displays message notifications only when the app is not foregrounded, validates incoming-call payload/freshness, and delegates incoming-call UI.

## IncomingCallNotificationHelper

[`IncomingCallNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/IncomingCallNotificationHelper.kt) builds call channels/notifications and `IncomingCallPayload`. It handles stable IDs, full-screen eligibility, accept/decline intents, timeout/cancellation, wake-screen behavior, and localization.

The helper never treats an expired call as answerable. End/cancel pushes remove native UI.

## Message quick reply

[`MessageNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/MessageNotificationHelper.kt) creates per-conversation message notifications with content, reply, and mark-read actions.

[`QuickReplyReceiver.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyReceiver.kt) uses `goAsync` and a worker thread to send replies/read state without starting React. [`QuickReplyApi.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyApi.kt) posts masked JSON either with a short-lived push quick-reply token or stored auth credentials. [`QuickReplyCredentials.kt`](../android/app/src/main/java/com/meetvap/messenger/QuickReplyCredentials.kt) stores active API URL/token in private preferences.

## Android share target

[`ShareForwardActivity.kt`](../android/app/src/main/java/com/meetvap/messenger/ShareForwardActivity.kt) is a transparent/no-history exported SEND target. It preserves MIME/data/ClipData/extras and URI grant flags while forwarding to `MainActivity`, then immediately finishes.

## Manifest and build configuration

[`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml) declares camera/audio/location/notification/full-screen/PiP permissions and components. Important constraints:

- `MainActivity` is single-task, resizable, and PiP-capable.
- `ShareForwardActivity` handles single/multiple shared content.
- MeetVap’s FCM service replaces Expo’s default service for raw message/call handling.
- `RECEIVE_BOOT_COMPLETED` and restricted reschedule receivers are removed to comply with Android 15 foreground-service launch rules.
- App/universal links cover contact, group, and meeting URLs.

[`build.gradle`](../android/app/build.gradle) owns package/application IDs, signing, version values, Maps key placeholder, dependencies, and release settings. Debug manifests add development-only behavior without changing production component ownership.
