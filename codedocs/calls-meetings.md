# Calls, Meetings, and Voice Rooms

## Three realtime media modes

MeetVap has three related but separate LiveKit experiences:

1. Direct/group calls in [`CallRoomScreen.tsx`](../src/screens/CallRoomScreen.tsx), backed by server call records and native incoming-call integration.
2. Invite-link meetings in [`MeetingRoomScreen.tsx`](../src/screens/MeetingRoomScreen.tsx), backed by meeting codes.
3. Persistent group voice rooms in [`voiceRoomSession.ts`](../src/lib/voiceRoomSession.ts) and [`VoiceRoomBridge.tsx`](../src/components/VoiceRoomBridge.tsx).

They share LiveKit but must not share lifecycle state accidentally. [`activeCallSession.ts`](../src/lib/activeCallSession.ts) and [`activeMeetingSession.ts`](../src/lib/activeMeetingSession.ts) persist/notify their respective sessions.

## Call lifecycle

[`CallRoomScreen.tsx`](../src/screens/CallRoomScreen.tsx) owns the call state machine:

1. Resolve/create the backend call and obtain LiveKit credentials.
2. Request microphone/camera permissions.
3. Prepare native audio and the selected voice effect.
4. Connect the LiveKit room, initially with audio/video publication controlled explicitly.
5. Publish microphone and camera only when the call state permits it.
6. Subscribe/recover remote tracks and adapt quality.
7. Coordinate ringtone/ringback, CallKit/Android notifications, audio routes, proximity, picture-in-picture, screen sharing, and app backgrounding.
8. End backend/native/LiveKit state idempotently and record the call log.

Outgoing unanswered calls expire after a bounded ring period. Incoming payloads also carry freshness checks in native and JavaScript code so a delayed push cannot create a ghost call hours later.

## LiveKit connection and publication

The room uses separate publisher/subscriber peer connections and disables LiveKit adaptive stream because MeetVap renders remote tracks itself. Dynacast and simulcast remain enabled.

`CallAudioPublisher` creates/reuses a microphone track, coordinates mute/upstream pause, retries after audio-session restoration, and verifies that a requested voice effect is attached and processing.

`CallVideoPublisher` publishes a preview track when available, controls camera direction/state, recovers stale native tracks, handles unsupported iOS background camera access, and applies network quality profiles.

`CallRemoteTrackSubscriptionMonitor` explicitly subscribes microphone, camera, and screen-share publications. [`liveKitRemoteSubscription.ts`](../src/lib/liveKitRemoteSubscription.ts) selects layers, enforces group limits, and recovers stalled decoders.

## Network adaptation

Calls sample LiveKit connection quality and WebRTC stats. Uplink/downlink profiles are `normal`, `degraded`, or `critical`. Inputs include packet loss, RTT, jitter, available outgoing bitrate, and bandwidth-limitation reason.

Downgrades reduce publishing/subscription quality quickly; recovery requires a stable interval to prevent oscillation. Startup grace avoids reacting to incomplete first reports before a track has decoded frames.

## Audio-session ownership

MeetVap calls `registerGlobals({ autoConfigureAudioSession: false })` in [`App.tsx`](../App.tsx). Native code is the single authority for call audio:

- iOS: `AVAudioSession`, CallKit activation callbacks, and WebRTC audio-session synchronization in [`CallNative.swift`](../ios/MeetVap/CallNative.swift).
- Android: communication audio mode, AudioManager routes, foreground service, and LiveKit audio processor in [`CallNativeModule.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativeModule.kt).

Voice calls default to earpiece unless the user explicitly selected speaker/external output. Video calls default to speaker. Route selection versions prevent stale asynchronous route work from overriding the newest user choice. Proximity changes use a stability threshold before changing screen/route behavior.

## Voice effects

Supported IDs are defined in [`voiceEffects.ts`](../src/types/voiceEffects.ts): normal, deep, bright, and helium.

The TypeScript facade in [`CallNative.ts`](../src/native/CallNative.ts) can:

- set and read the effect
- begin a new effect session
- verify that the native processor/factory is attached
- wait until processed frame counters prove the selected effect is actually handling live audio
- process recorded voice-message files

iOS implements an external LiveKit audio processor and AVAudioEngine-based file processing. Android installs a LiveKit audio processor with pitch/tone processing and exposes health counters. Call publication retries/restarts the mic if a non-normal effect is requested but not observed processing.

## Incoming calls

### iOS

PushKit wakes [`CallNativeCallManager`](../ios/MeetVap/CallNative.swift), which validates freshness, acknowledges ringing, reports to CallKit, and persists pending launch data. Answering creates an incoming-call deep link with `answeredByNative=true`. Call-only app-lock access permits the call route without exposing the rest of the app. CallKit `didActivate` hands the activated audio session to WebRTC.

### Android

[`MeetVapFirebaseMessagingService.kt`](../android/app/src/main/java/com/meetvap/messenger/MeetVapFirebaseMessagingService.kt) validates call pushes and invokes [`IncomingCallNotificationHelper.kt`](../android/app/src/main/java/com/meetvap/messenger/IncomingCallNotificationHelper.kt). It creates full-screen/heads-up notification actions and routes them through `MainActivity`. [`CallForegroundService.kt`](../android/app/src/main/java/com/meetvap/messenger/CallForegroundService.kt) keeps active camera/microphone calls compliant with foreground-service requirements.

## Call presentation

[`CallRoomPresentation.tsx`](../src/screens/call/CallRoomPresentation.tsx) contains reusable call UI: waiting/connected stages, participant tiles, local preview, controls, people/add-member modals, connection-problem modal, incoming controls, and minimized call position logic. [`CallRoomStyles.ts`](../src/screens/call/CallRoomStyles.ts) owns call-specific styles.

## Meetings

[`MeetingRoomScreen.tsx`](../src/screens/MeetingRoomScreen.tsx) loads a meeting by code, joins/leaves/ends it through backend APIs, persists active meeting state, connects LiveKit, publishes mic/camera, subscribes remote media, renders participant tiles, and shares/copies the invite link.

Meetings can be opened unauthenticated when the server allows the invite flow. They do not create ordinary call records or use CallKit.

## Voice rooms

[`voiceRoomSession.ts`](../src/lib/voiceRoomSession.ts) is a module-level session manager with subscribe/get/set APIs. It joins/leaves rooms, tracks participants and self/admin/speaker mute states, supports push-to-talk, and coordinates with active calls so call audio takes priority.

[`VoiceRoomBridge.tsx`](../src/components/VoiceRoomBridge.tsx) keeps the LiveKit room mounted while navigating between screens. [`useChatVoiceRoom.ts`](../src/hooks/useChatVoiceRoom.ts) maps a group chat into UI commands, and [`VoiceRoomControls.tsx`](../src/components/chat/VoiceRoomControls.tsx) renders those controls.

## Diagnostics

Call milestones and media state are logged through `logCallDiagnostic`. [`voiceRoomDiagnostics.ts`](../src/lib/voiceRoomDiagnostics.ts) has a separately gated voice-room logger. Diagnostics cover credentials, connection state, participant presence, publication/subscription, first bytes/frames, camera recovery, profile changes, audio attachment, and teardown.
