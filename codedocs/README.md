# MeetVap Mobile Code Documentation

This directory documents the React Native application and its native iOS and Android integrations. It is written for engineers who need to understand behavior before changing code, debugging production incidents, or adding features.

The documentation reflects the source tree as of 2026-08-11. Source links are relative to this directory and open the implementation discussed by each section.

## Reading order

1. [Architecture](architecture.md) - process boundaries, major modules, and dependency direction.
2. [Startup, state, and navigation](startup-state-navigation.md) - application boot, authentication state, navigation, and global bridges.
3. [Messaging and local storage](messaging-storage-sync.md) - local-first messages, SQLite, synchronization, acknowledgements, media caching, and realtime updates.
4. [Chat experience](chat-experience.md) - chat screen/controller division, timeline, composer, attachments, actions, dialogs, and performance design.
5. [Calls, meetings, and voice rooms](calls-meetings.md) - LiveKit call lifecycle, audio routing, CallKit, Android foreground calls, network adaptation, and voice effects.
6. [Notifications, sharing, and location](platform-services.md) - push handling, quick reply, share extensions, deep links, live location, and screen protection.
7. [Authentication, security, and subscriptions](security-auth-subscriptions.md) - server selection, credentials, app lock, attestation, update policy, privacy, and purchases.
8. [Screens and product features](screens-and-features.md) - purpose and behavior of every application screen.
9. [iOS native implementation](ios-native.md) - Swift bridge, AppDelegate, CallKit/PushKit, share extension, and screen-share extension.
10. [Android native implementation](android-native.md) - Kotlin bridge, FCM, incoming-call UI, foreground service, quick reply, and Android share flow.
11. [API and state reference](api-state-reference.md) - backend client families and Zustand action groups.
12. [Complete source index](source-index.md) - every React Native, iOS, and Android source file with its responsibility and public symbols.
13. [Exported symbol reference](exported-symbols.md) - every exported TypeScript function, component, hook, type, and constant.

## System at a glance

```text
Native OS events                    MeetVap server / LiveKit
  |                                          ^
  v                                          |
iOS Swift / Android Kotlin <-> CallNative.ts |
  |                                          |
  v                                          |
App.tsx -> lifecycle bridges -> Zustand store -> backend.ts / Socket.IO
                           |          |
                           |          +-> AsyncStorage / SecureStore
                           +------------> SQLite message database / media files
```

The application is deliberately local-first for conversations. The server remains authoritative, but a chat opens from SQLite and memory first; network deltas, websocket events, push-triggered recovery, edits, deletions, and delivery state are merged afterward.

## Scope

Included:

- React Native and TypeScript under [`src`](../src/)
- Root application entry point [`App.tsx`](../App.tsx)
- iOS application and extensions under [`ios`](../ios/)
- Android application code and manifest under [`android/app`](../android/app/)
- Native-facing configuration in [`app.json`](../app.json)

Excluded:

- Server, admin, website, and meet web application internals
- Generated Xcode Pods, Gradle outputs, and `node_modules`
- Static translation text repeated across language dictionaries; their role and ownership are documented instead

## Maintenance rule

When adding a production source file, add it to [source-index.md](source-index.md) and update the relevant domain guide. When changing a cross-layer contract, update both sides of the contract, for example `CallNative.ts` and the corresponding Swift/Kotlin method.
