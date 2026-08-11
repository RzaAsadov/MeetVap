# Architecture

## Technology stack

- Expo SDK and React Native provide the application runtime.
- React Navigation provides native-stack and bottom-tab navigation.
- Zustand provides shared application state and domain actions.
- Expo SQLite stores durable messages, media download state, live-location work, and local call statistics.
- AsyncStorage stores preferences, conversation summaries, cursors, call logs, and other small records.
- Expo SecureStore stores secrets such as authentication tokens, lock PINs, and installation-scoped values.
- Socket.IO provides realtime message, receipt, presence, call, status, and account events.
- LiveKit provides call and meeting media transport.
- Swift and Kotlin implement platform behavior that JavaScript cannot reliably own: CallKit/PushKit, Android full-screen calls, foreground services, audio routing, voice processing, App Attest/Play Integrity, share targets, secure-screen behavior, and file export.

See [`package.json`](../package.json), [`app.json`](../app.json), [`App.tsx`](../App.tsx), and [`useAppStore.ts`](../src/store/useAppStore.ts).

## Runtime layers

### 1. Application composition

[`App.tsx`](../App.tsx) initializes LiveKit globals, installation identity, language, legacy message migration, and Zustand bootstrap. Once bootstrapped it mounts navigation inside app-lock and update gates and conditionally mounts authenticated lifecycle bridges.

The root component should remain composition-oriented. Feature-specific networking belongs in bridges or the store rather than directly in `App`.

### 2. Navigation

[`RootNavigator.tsx`](../src/navigation/RootNavigator.tsx) switches between unauthenticated and authenticated stacks based on `store.user`. [`MainTabs.tsx`](../src/navigation/MainTabs.tsx) owns Chats, Calls, Status, and Catalog tabs. [`navigationRef.ts`](../src/navigation/navigationRef.ts) lets native events, push handlers, and sockets navigate safely before or after the navigation container is ready.

### 3. Lifecycle bridges

Invisible bridge components translate process-wide events into domain actions:

- [`RealtimeBridge.tsx`](../src/components/RealtimeBridge.tsx): Socket.IO connection and server events.
- [`PushNotificationBridge.tsx`](../src/components/PushNotificationBridge.tsx): permission/token registration, notification taps, background messages, badges, and incoming calls.
- [`VoiceRoomBridge.tsx`](../src/components/VoiceRoomBridge.tsx): persistent LiveKit voice-room connection independent of a single screen.
- [`ShareIntentBridge.tsx`](../src/components/ShareIntentBridge.tsx): imports native share items and opens the forwarding UI.
- [`AppAttestationBridge.tsx`](../src/components/AppAttestationBridge.tsx): starts Play Integrity or App Attest after authentication.
- [`BackgroundLocationDisclosureBridge.tsx`](../src/components/BackgroundLocationDisclosureBridge.tsx): serializes user consent before background live location.
- [`AppLockGate.tsx`](../src/components/AppLockGate.tsx): overlays PIN/erase-PIN protection while permitting controlled incoming-call access.
- [`AppUpdateGate.tsx`](../src/components/AppUpdateGate.tsx): applies server minimum-version and integrity policy responses.

### 4. Shared state and domain orchestration

[`useAppStore.ts`](../src/store/useAppStore.ts) is the primary application service layer. It owns authenticated user state, conversations, messages loaded into memory, contacts, statuses, calls, subscription state, connection state, uploads, and all mutations.

The store coordinates three sources:

1. Local durable state for immediate rendering.
2. Server responses for authoritative changes.
3. Socket/push events for incremental updates.

Its public action surface is summarized in [API and state reference](api-state-reference.md).

### 5. Data access

[`backend.ts`](../src/lib/backend.ts) contains typed HTTP endpoint wrappers and server-to-domain mapping. [`api.ts`](../src/lib/api.ts) applies authentication, installation metadata, masking, timeouts, and normalized `ApiError` behavior.

Storage is split by purpose:

- [`messageStore.ts`](../src/lib/messageStore.ts): normalized-enough SQLite rows with the full message serialized as JSON.
- [`storage.ts`](../src/lib/storage.ts): secure credentials and lightweight AsyncStorage preferences/cursors/summaries.
- [`mediaCache.ts`](../src/lib/mediaCache.ts): durable media files, resumable download metadata, progress listeners, and pause/resume.

### 6. Presentation

Screens choose data and compose feature components. Expensive chat and call screens are split by responsibility:

- Chat state/orchestration: [`ChatRoomController.tsx`](../src/screens/ChatRoomController.tsx)
- Chat rendering: [`ChatRoomScreen.tsx`](../src/screens/ChatRoomScreen.tsx)
- Call lifecycle/media control: [`CallRoomScreen.tsx`](../src/screens/CallRoomScreen.tsx)
- Call presentation: [`CallRoomPresentation.tsx`](../src/screens/call/CallRoomPresentation.tsx)

### 7. Native integration

[`CallNative.ts`](../src/native/CallNative.ts) is the TypeScript facade over `NativeModules.CallNative`. Platform checks and safe fallbacks live here so callers do not need to know whether a function exists on one or both platforms.

- iOS implementation: [`CallNative.swift`](../ios/MeetVap/CallNative.swift), exported by [`CallNativeBridge.m`](../ios/MeetVap/CallNativeBridge.m).
- Android implementation: [`CallNativeModule.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativeModule.kt), registered by [`CallNativePackage.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativePackage.kt).

## Dependency direction

Preferred direction:

```text
screens/components -> hooks/store/lib -> native facade -> Swift/Kotlin
screens/components -> store -> backend/api -> server
store/lib -> storage/messageStore/mediaCache
```

Avoid importing screens from libraries, performing raw HTTP calls in screens, or accessing `NativeModules` outside the native facade. These rules keep UI changes from altering persistence or platform contracts accidentally.

## Core domain types

[`domain.ts`](../src/types/domain.ts) defines `AuthUser`, `Conversation`, `Message`, `VoiceRoomParticipant`, `CallLog`, and `SubscriptionStatus`. [`navigation.ts`](../src/types/navigation.ts) defines every route and its parameters. [`voiceEffects.ts`](../src/types/voiceEffects.ts) owns the supported effect IDs and normalization.

Messages carry a typed top-level shape plus extensible `metadata`. Metadata is used for client IDs, delete keys, replies, scheduled messages, calls, locations, media details, and other subtype-specific information. Code reading metadata must validate shape because historical records may predate current fields.

## Error and consistency model

- Server errors become `ApiError` with HTTP status and structured details.
- Optimistic sends use client IDs and are reconciled with server messages instead of appended blindly.
- SQLite writes are serialized to avoid overlapping transactions.
- Message status is monotonic: `sending < sent < delivered < read`.
- Deletion/edit/status cursors and acknowledgements prevent missing events while allowing the server to retire retained updates.
- Native calls use best-effort wrappers where absence is nonfatal, but call setup adds diagnostics and recovery when audio/video state is safety-critical.
