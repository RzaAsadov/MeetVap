# iOS Native Implementation

## Targets

The Xcode project contains:

- Main application `com.meetvap.app`
- Share extension `com.meetvap.app.ShareExtension`
- ReplayKit upload extension `com.meetvap.app.ScreenShareExtension`

Target wiring, build settings, signing profiles, versions, source membership, and dependencies live in [`project.pbxproj`](../ios/MeetVap.xcodeproj/project.pbxproj).

## AppDelegate

[`AppDelegate.swift`](../ios/MeetVap/AppDelegate.swift) constructs the Expo React Native factory, registers LiveKit/WebRTC, enables multitasking camera access where supported, and bootstraps native call services before React starts. It forwards custom URLs/universal links and delegates supported orientation to `CallNativeOrientationLock`.

The React delegate loads Metro in Debug and bundled `main.jsbundle` in Release.

## Bridge surface

[`CallNativeBridge.m`](../ios/MeetVap/CallNativeBridge.m) declares Objective-C selectors exported from [`CallNative.swift`](../ios/MeetVap/CallNative.swift). [`CallNative.ts`](../src/native/CallNative.ts) is the JavaScript-facing facade. Selector name/parameter order must remain identical across all three files.

Top-level `CallNative` methods expose:

- app version/build
- quick-reply credentials and notification cancellation
- CallKit answer/suppress/pending-call state
- App Attest key creation, registration attestation, and assertions
- VoIP token registration
- multitasking-camera capability
- shared-item import
- voice-message processing and live voice effects
- file save/share and image drawing
- call end, audio preparation/routes, proximity, capture protection, orientation
- incoming ringtone and outgoing ringback

## Internal services in CallNative.swift

### CallNativeOrientationLock

Tracks whether media viewing may use all orientations and asks presented view controllers/windows to refresh supported orientations.

### CallNativeQuickReplyCredentials / Handler

Stores API credentials in Keychain, registers notification actions, handles text replies/mark-read, masks request payloads, and uses background tasks so an action can finish while the app is suspended.

### CallNativeOutgoingRingback

Owns ringback `AVAudioPlayer`, audio-session routing, route/interruption observers, replay spacing, and recovery timer.

### CallNativeAudioRouteManager

Configures `AVAudioSession` category/mode/options for voice/video and CallKit-managed calls, enumerates speaker/receiver/Bluetooth/wired routes, applies explicit preference, and clears route state.

### CallNativeScreenCaptureProtection

Wraps protectable windows in secure text-field canvas views and shows/removes a capture overlay during screen capture or transient system/background transitions.

### MediaSaveCoordinator / MediaShareCoordinator

Resolve local file URLs, save images/videos to Photos where appropriate, present a document exporter for other files, and present `UIActivityViewController` for sharing. Temporary exported files are cleaned up.

### ImageDrawingRenderer

Loads the source image, converts normalized stroke coordinates to image pixels, renders anti-aliased paths at original resolution, and writes a new image file returned to React.

### Live voice processing

`CallNativeLiveVoiceEffectController` stores requested effect/session state and registers the LiveKit external audio processor. `CallNativeLiveVoiceEffectProcessor` processes live PCM buffers, tracks attachment/processed-frame diagnostics, applies pitch/tone/de-essing/smoothing, and resets state between sessions. `VoiceMessageProcessor` applies an AVAudioEngine time-pitch effect to recorded files.

### SharedImportStore

Reads and removes the app-group manifest/files produced by the share extension and returns normalized shared items to React.

### PendingIncomingCallLaunchStore

Persists incoming-call and answered-CallKit deep links so cold starts do not lose native call actions before React/navigation is ready.

### CallNativeCallManager

Owns `PKPushRegistry`, `CXProvider`, and `CXCallController`. It registers VoIP tokens, validates incoming payload freshness, acknowledges receipts, reports calls to CallKit, handles answer/end actions, coordinates pending links, and synchronizes CallKit audio activation with WebRTC.

## App Attest

Native methods use `DCAppAttestService`:

- `generateAppAttestKey` creates a hardware/service-backed key ID.
- `attestAppAttestKey` hashes decoded server challenge bytes and asks Apple for the attestation object.
- `generateAppAttestAssertion` hashes challenge bytes and signs the assertion with the registered key.

Production and Debug environments are separated by [`MeetVap.entitlements`](../ios/MeetVap/MeetVap.entitlements) and [`MeetVap.debug.entitlements`](../ios/MeetVap/MeetVap.debug.entitlements). Provisioning profiles must contain the matching entitlement.

## Share extension

[`ShareViewController.swift`](../ios/MeetVapShareExtension/ShareViewController.swift) processes extension items, chooses preferred text/file type identifiers, copies file/data attachments into the shared app-group directory, records MIME/name/size metadata, writes the manifest, and attempts several legal app-opening paths before completing the extension request.

[`MeetVapShareExtension.entitlements`](../ios/MeetVapShareExtension/MeetVapShareExtension.entitlements) grants the shared application group. [`Info.plist`](../ios/MeetVapShareExtension/Info.plist) declares accepted text, URL, file, image, and movie inputs with maximum counts.

## Screen-share extension

[`SampleHandler.swift`](../ios/MeetVapScreenShareExtension/SampleHandler.swift) is the ReplayKit lifecycle entry point. It opens a local socket connection and sends video sample buffers.

[`SampleUploader.swift`](../ios/MeetVapScreenShareExtension/SampleUploader.swift) serializes pixel buffers into bounded chunks and applies display scale metadata. [`ScreenShareSocketConnection.swift`](../ios/MeetVapScreenShareExtension/ScreenShareSocketConnection.swift) manages stream connection/write state. [`Atomic.swift`](../ios/MeetVapScreenShareExtension/Atomic.swift) protects small shared state with a lock.

LiveKit’s main-app screen-capture path receives those samples through the configured app-group/socket integration.

## iOS configuration

[`Info.plist`](../ios/MeetVap/Info.plist) declares URL schemes, usage descriptions, app group/screen-share identifiers, background audio/VoIP/notification/location modes, supported orientations, and ATS policy. [`Supporting/Expo.plist`](../ios/MeetVap/Supporting/Expo.plist) contains Expo runtime settings.
