# Screens and Product Features

## Authentication and onboarding

### AuthScreen

[`AuthScreen.tsx`](../src/screens/AuthScreen.tsx) renders login/registration, validates usernames/passwords, parses domain-selector login, reports unreachable hosts, and delegates session creation to the store. Successful authentication changes `store.user`, causing `RootNavigator` to replace the unauthenticated stack.

### ServerSetupScreen

[`ServerSetupScreen.tsx`](../src/screens/ServerSetupScreen.tsx) validates and persists a custom API URL. Most normal users rely on default/domain login rather than this explicit setup route.

### SharedContactScreen and SharedGroupScreen

[`SharedContactScreen.tsx`](../src/screens/SharedContactScreen.tsx) resolves public username links, displays a profile, and allows authenticated users to add/start a conversation. [`SharedGroupScreen.tsx`](../src/screens/SharedGroupScreen.tsx) resolves public group invites and joins eligible users. Both can render before authentication for link previews.

## Main tabs

### ChatsScreen

[`ChatsScreen.tsx`](../src/screens/ChatsScreen.tsx) is the main conversation list. It supports local-first rendering, server filters/search/pagination, pull refresh, favorites, unread state, group invites, row menus, contact sharing, add-contact navigation, create chat/group/voice room, mute/delete/leave actions, and subscription/account menus.

Rows are memoized (`ConnectedChatRow`/`ChatRow`) and select conversation data by ID so one preview/presence change does not recreate every row. The unread tab badge is derived from `store.unreadConversationIds`, the shared source of truth.

### CallsScreen

[`CallsScreen.tsx`](../src/screens/CallsScreen.tsx) renders locally stored call logs, groups visual status by direction/outcome, starts redial calls, and deletes logs locally or for peers where supported.

### StatusScreen

[`StatusScreen.tsx`](../src/screens/StatusScreen.tsx) loads grouped ephemeral statuses, creates text/image/video status, controls audience exclusions/inclusions, displays timed status playback/progress, marks views, shows viewers, replies, and deletes owned statuses.

### CatalogScreen

[`CatalogScreen.tsx`](../src/screens/CatalogScreen.tsx) loads the server catalog URL and hosts a WebView. It also receives approved message links whose domains are listed in server `appDomains`, preserving navigation inside the catalog surface.

## Conversation creation and people

### ContactsScreen and AddContactScreen

[`ContactsScreen.tsx`](../src/screens/ContactsScreen.tsx) refreshes contacts, starts chats, shares contacts, and exposes contact actions. [`AddContactScreen.tsx`](../src/screens/AddContactScreen.tsx) debounces server search, excludes invalid/self candidates, and adds a selected user.

### NewChatScreen

[`NewChatScreen.tsx`](../src/screens/NewChatScreen.tsx) searches known/server users and creates or reuses a direct conversation.

### NewGroupScreen

[`NewGroupScreen.tsx`](../src/screens/NewGroupScreen.tsx) derives unique candidates from contacts and conversation members and creates either a normal group or voice-room conversation with selected users.

### BlockedUsersScreen

[`BlockedUsersScreen.tsx`](../src/screens/BlockedUsersScreen.tsx) loads server block state and allows unblock.

## Chat and media

### ChatRoomScreen

[`ChatRoomScreen.tsx`](../src/screens/ChatRoomScreen.tsx) is the interactive conversation surface. Full behavior is documented in [Chat experience](chat-experience.md).

### ShareTargetScreen

[`ShareTargetScreen.tsx`](../src/screens/ShareTargetScreen.tsx) consumes imported native text/files, shows target conversations, prepares each shared item, sends it, and retries briefly while iOS/Android finishes handing off files.

### StorageUsageScreen

[`StorageUsageScreen.tsx`](../src/screens/StorageUsageScreen.tsx) reads SQLite/file usage statistics globally and per conversation, sorts by chosen metric, and formats message/media/call totals.

## Calling

### CallRoomScreen

[`CallRoomScreen.tsx`](../src/screens/CallRoomScreen.tsx) owns backend call state, LiveKit, native audio/call integration, media publication/subscription, controls, network adaptation, and teardown. See [Calls, meetings, and voice rooms](calls-meetings.md).

### MeetingRoomScreen

[`MeetingRoomScreen.tsx`](../src/screens/MeetingRoomScreen.tsx) joins invite-link meetings, manages host/participant lifecycle, publishes/subscribes LiveKit tracks, and renders tiles.

## Account and settings

### SettingsScreen

[`SettingsScreen.tsx`](../src/screens/SettingsScreen.tsx) is the central settings surface. It handles profile/avatar, username/display name, language/theme, privacy, app lock and erase PINs, panic behavior, background-location authorization, blocked users, web devices, storage usage, subscription details, help, password change, sign-out, and permanent account deletion with countdown.

### ChangePasswordScreen

[`ChangePasswordScreen.tsx`](../src/screens/ChangePasswordScreen.tsx) validates current/new password and calls the authenticated password update action.

### DevicesScreen

[`DevicesScreen.tsx`](../src/screens/DevicesScreen.tsx) scans/parses web pairing codes, verifies that the pairing server matches the active API, approves web sessions, displays current web-device state, and logs web devices out.

### SubscriptionScreen

[`SubscriptionScreen.tsx`](../src/screens/SubscriptionScreen.tsx) loads store products, purchases/restores subscriptions, verifies receipts server-side, finishes transactions, and presents entitlement state and legal links.

## Shared UI components

- [`Avatar.tsx`](../src/components/Avatar.tsx): remote/local avatar with fallback initials.
- [`PrimaryButton.tsx`](../src/components/PrimaryButton.tsx): consistent primary command/loading state.
- [`TextField.tsx`](../src/components/TextField.tsx): themed input wrapper.
- [`ScreenBackground.tsx`](../src/components/ScreenBackground.tsx): application surface background.
- [`AttachmentSheet.tsx`](../src/components/AttachmentSheet.tsx): chat attachment choices.
- [`HelpWebViewModal.tsx`](../src/components/HelpWebViewModal.tsx): server-configured help content.
- [`PinPad.tsx`](../src/components/PinPad.tsx): PIN entry keypad and status.
- [`MessageBubble.tsx`](../src/components/MessageBubble.tsx): all chat message presentations.
- [`PremiumTrialIntro.tsx`](../src/components/PremiumTrialIntro.tsx): one-time trial introduction.
- [`PremiumUserBadge.tsx`](../src/components/PremiumUserBadge.tsx): compact premium indicator.
