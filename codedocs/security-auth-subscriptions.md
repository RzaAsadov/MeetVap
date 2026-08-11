# Authentication, Security, and Subscriptions

## Server selection and login

[`AuthScreen.tsx`](../src/screens/AuthScreen.tsx) supports registration and login. [`loginServerResolution.ts`](../src/lib/loginServerResolution.ts) implements domain-selector usernames:

- `username` without `@` uses only the configured default/current server.
- `username@selector` sends the selector to the main server, receives the mapped API hostname, removes the suffix from the username, and logs in against that server.
- If the main lookup server is unavailable, the selector may be treated as a direct hostname.
- Unreachable resolved hosts produce a user-facing host-unavailable error.

[`api.ts`](../src/lib/api.ts) validates HTTPS server URLs. [`ServerSetupScreen.tsx`](../src/screens/ServerSetupScreen.tsx) provides explicit server configuration when that route is used.

## Request identity

[`appClientInfo.ts`](../src/lib/appClientInfo.ts) creates a stable installation ID and returns request headers containing platform, app version/build, capabilities, and installation identity. These headers let the server distinguish sessions and enforce compatibility/attestation policy.

[`payloadMask.ts`](../src/lib/payloadMask.ts) and [`socketMask.ts`](../src/lib/socketMask.ts) implement the application’s payload masking protocol for HTTP and Socket.IO. Masking is protocol obfuscation, not a replacement for TLS.

## Authentication storage

The access token is stored in SecureStore through [`storage.ts`](../src/lib/storage.ts). The user snapshot and server URL are restored during bootstrap. Native quick-reply handlers receive a copy of server URL/token only while an authenticated non-decoy session exists; sign-out clears them.

Account suspension events from HTTP or Socket.IO flow through [`authSuspensionEvents.ts`](../src/lib/authSuspensionEvents.ts), force sign-out, and display the server/admin reason.

## App lock and erase PIN

[`AppLockGate.tsx`](../src/components/AppLockGate.tsx) watches app foreground/background transitions and route changes. It overlays [`PinPad.tsx`](../src/components/PinPad.tsx) without dismantling the underlying navigator.

[`appLockAccess.ts`](../src/lib/appLockAccess.ts) maintains controlled exceptions:

- incoming calls may open in call-only mode without revealing chats
- a short foreground operation guard prevents lock races during system transitions
- ending the call returns to locked state

Settings can configure a normal lock PIN and a separate erase PIN. Erase behavior can wipe local data and optionally request peer-side deletion according to stored settings. Security events notify mounted settings UI when PIN/location state changes.

## Decoy offline mode

Decoy-offline mode keeps local access while intentionally unmounting push/realtime/voice-room bridges and suppressing authenticated network activity. It is a user state, not evidence that the physical network is offline.

## Device attestation

[`AppAttestationBridge.tsx`](../src/components/AppAttestationBridge.tsx) invokes [`runAppAttestation`](../src/lib/appAttestation.ts) after login and on its renewal schedule.

Android flow:

1. Request one-time challenge from the connected server.
2. Ask native [`CallNativeModule.kt`](../android/app/src/main/java/com/meetvap/messenger/CallNativeModule.kt) for a Google Play Integrity token.
3. Submit token/challenge for server verification.

iOS flow:

1. Reuse a server-scoped App Attest key or create one with `DCAppAttestService`.
2. Request a registration challenge and submit Apple’s attestation object for a new key.
3. For a registered key, request an assertion challenge and submit a signed assertion.
4. Replace a local key when the server reports that it was never registered.

Local key names are scoped by API server, platform, and user so child/main server accounts cannot reuse the wrong key.

[`AppUpdateGate.tsx`](../src/components/AppUpdateGate.tsx) interprets attestation/update policy errors. Observe mode records failures without blocking; enforce mode applies grace, retry, update-required, and untrusted-device UX from server responses.

## Update policy

[`serverPolicy.ts`](../src/lib/serverPolicy.ts) fetches/caches server policy: minimum/latest versions, attestation parameters, attachment limits, premium settings, app domains, and media-cache limits. `AppUpdateGate` compares native version/build values exposed by `CallNative` and blocks only when policy requires it.

## Privacy and reporting

Settings update search visibility, nickname visibility, last seen, contacts-only calls, screenshot prevention, and group aliases through store/backend actions. [`reporting.ts`](../src/lib/reporting.ts) builds report context and reason text. Blocking and unblocking use server endpoints and refresh local contact/conversation state.

## Subscriptions

[`subscriptions.ts`](../src/lib/subscriptions.ts) wraps `react-native-iap` for product loading, purchase requests, restoration, finishing transactions, and connection cleanup. [`SubscriptionScreen.tsx`](../src/screens/SubscriptionScreen.tsx) presents products and sends Apple/Google purchase evidence to the server.

[`subscriptionAccess.ts`](../src/lib/subscriptionAccess.ts) centralizes entitlement decisions and bypass handling. UI code should call `hasPremiumAccess` rather than infer premium status from individual receipt fields.

[`PremiumTrialIntro.tsx`](../src/components/PremiumTrialIntro.tsx) and [`PremiumUserBadge.tsx`](../src/components/PremiumUserBadge.tsx) provide trial onboarding and premium identity UI.

## Secure transport and platform permissions

Production APIs and attestation require HTTPS. iOS ATS disables arbitrary loads but permits local development networking. Android currently permits cleartext traffic for configured development/child deployments; production endpoints should still use HTTPS.

Entitlements and permissions are declared in [`MeetVap.entitlements`](../ios/MeetVap/MeetVap.entitlements), [`MeetVap.debug.entitlements`](../ios/MeetVap/MeetVap.debug.entitlements), [`Info.plist`](../ios/MeetVap/Info.plist), and [`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml).
