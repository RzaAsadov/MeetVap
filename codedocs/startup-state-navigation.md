# Startup, State, and Navigation

## Startup sequence

[`App.tsx`](../App.tsx) performs startup in this order:

1. Import `liveLocation.ts` so the background location task is registered at module load time.
2. Register React Native WebRTC globals and disable LiveKit automatic iOS audio-session ownership. MeetVap native code owns that session to coordinate with CallKit.
3. Initialize the installation ID through [`appClientInfo.ts`](../src/lib/appClientInfo.ts).
4. Restore language and configure the translation singleton.
5. Migrate legacy message storage into SQLite through `migrateLegacyMessageStorage`.
6. Run `useAppStore.bootstrap()` to restore server URL, token, user, preferences, conversation summaries, subscription state, and local services.
7. Resolve cold-start links and notification actions, especially answered CallKit calls that must bypass the normal lock screen.
8. Mount navigation, app lock, update policy, and authenticated lifecycle bridges.

The migration UI intentionally blocks the normal application until migration succeeds, preventing partial histories from being treated as complete.

## Zustand state ownership

[`useAppStore.ts`](../src/store/useAppStore.ts) exports one store. Major state families are:

- Session: `serverUrl`, `user`, bootstrap and connection status.
- Preferences: language, theme, decoy-offline mode.
- Conversation list: summaries, query/filter, pagination, unread IDs, freshness timestamps.
- Chat: `messagesByConversation` and upload progress.
- Social: contacts and blocked users.
- Status: grouped statuses, unviewed indicator, loading state.
- Calls: local call logs.
- Server policy: app domains, catalog/help URLs, subscription status.

Store actions are both commands and reconciliation boundaries. For example, `sendTextMessage` creates an optimistic local message, calls the server, merges the canonical response, persists it, and updates the conversation preview. Socket handlers call `receiveMessage` rather than editing arrays themselves.

## Bootstrap behavior

Bootstrap restores local state first. When credentials exist it validates/restores the account, refreshes policy and subscription data, and begins remote loading unless decoy-offline mode is active. Native quick-reply credentials are synchronized from `App.tsx` whenever authentication, server, or foreground state changes.

Signing out clears authentication and user-scoped state, disconnects bridges through conditional unmounting, clears native quick-reply credentials, and resets active call state. Local-data erase functions are separate because settings support chat-only erasure, full local erasure, and panic/erase PIN behavior.

## Navigation structure

[`RootNavigator.tsx`](../src/navigation/RootNavigator.tsx) has two route sets.

Unauthenticated:

- `Auth`
- public `SharedContact` and `SharedGroup`
- `MeetingRoom` for invite links

Authenticated:

- `MainTabs`
- subscription, contacts, devices, settings, group creation, share target, chat, call, blocked users, password, storage, shared links, and meetings

[`MainTabs.tsx`](../src/navigation/MainTabs.tsx) renders:

- Chats, with unread conversation count from the store
- Calls
- Status, with an unviewed-status indicator
- Catalog

## Navigation from outside React screens

[`navigationRef.ts`](../src/navigation/navigationRef.ts) queues navigation until the container is ready. It supports:

- Catalog URLs
- Incoming calls
- Visible call/chat inspection
- Restoring persisted active calls and meetings
- Opening chats from notifications or share actions
- Returning to the chat list

This indirection prevents native events from racing initial React navigation setup.

## Deep links

The app accepts `meetvap://`, `com.meetvap.app://`, and selected HTTPS universal/app links. Contact and group links route through React Navigation. Meeting and incoming-call links have explicit handling in `App.tsx` and `navigationRef.ts` because they may arrive before authentication or while the app is locked.

Native declarations live in:

- iOS URL schemes and associated domains: [`Info.plist`](../ios/MeetVap/Info.plist) and [`app.json`](../app.json)
- Android intent filters: [`AndroidManifest.xml`](../android/app/src/main/AndroidManifest.xml)

## Theme and localization

[`colors.ts`](../src/theme/colors.ts) exposes a mutable `colors` object backed by light/dark palettes. [`useThemeColors.ts`](../src/theme/useThemeColors.ts) updates it for current store theme. Screens recreate styles when needed because style objects that capture palette values do not update automatically.

[`i18n/index.ts`](../src/i18n/index.ts) chooses system or explicit language, provides `t`, and loads dictionaries defined by [`i18n/types.ts`](../src/i18n/types.ts). Language files are data modules and must share the same translation key shape.
