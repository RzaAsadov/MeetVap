# Chat Experience

## Screen/controller split

The chat feature is intentionally split:

- [`ChatRoomController.tsx`](../src/screens/ChatRoomController.tsx) owns state, effects, commands, permissions, selection, call launch, group actions, scroll orchestration, typing, reply/edit/forward state, and synchronization.
- [`ChatRoomScreen.tsx`](../src/screens/ChatRoomScreen.tsx) renders the header, message list, composer, overlays, and connects controller values to presentation components.
- [`ChatRoomStyles.ts`](../src/screens/chat/ChatRoomStyles.ts) contains the large domain-specific style set.

This split keeps the visual component inspectable while avoiding a meaningless one-line screen wrapper: rendering remains in the screen, orchestration remains in the controller.

## Chat entry and hydration

[`useChatHydration.ts`](../src/hooks/useChatHydration.ts) coordinates local hydration and current-conversation preparation. [`useConversationById.ts`](../src/hooks/useConversationById.ts) selects the latest conversation object without requiring the screen to duplicate lookup behavior.

On focus, the controller:

1. Marks the conversation as the active foreground chat.
2. Hydrates recent local messages.
3. Starts targeted server reconciliation.
4. Joins the Socket.IO conversation room.
5. Marks visible messages read and dismisses matching notifications.
6. Applies screenshot policy and updates the navigation header.

On blur/unmount it leaves the room, clears typing state/timers, releases bounded history, and clears foreground-chat ownership.

## Timeline window and scrolling

[`useChatTimelineWindow.ts`](../src/hooks/useChatTimelineWindow.ts) limits the number of rendered messages. It supports initial tail rendering, tail append growth, and older-page expansion. This prevents a long chat from mounting every message bubble on old phones.

[`ChatMiscHelpers.ts`](../src/screens/lib/ChatMiscHelpers.ts) creates message/date-divider list items and stable render keys. [`ChatRoomController.tsx`](../src/screens/ChatRoomController.tsx) owns bottom anchoring and targeted message jumps. It retries a bounded number of times because a requested row may not be measured until FlatList mounts the relevant window.

The list loads older local SQLite pages first. Remote history is requested only when local history cannot satisfy the request.

## Keyboard and composer

[`useChatKeyboardLift.ts`](../src/hooks/useChatKeyboardLift.ts) computes keyboard overlap and composer lift with platform-specific event handling. The screen uses stable dimensions so keyboard appearance does not rebuild the whole timeline.

Draft updates are separated into immediate visual state and lower-priority typing/persistence work. This is important: typing, changing the send icon, and tapping call buttons must not wait for maintenance or message synchronization.

[`ComposerEditMenu`](../src/screens/ChatRoomMessageActions.tsx) handles native-like text edit commands. The main composer supports:

- text and emoji
- replies
- editing
- scheduled send options
- attachment captions
- disappearing-message context
- voice recording and voice effects

## Attachments

[`useChatAttachments.ts`](../src/hooks/useChatAttachments.ts) owns image/video/library/document/location selection, attachment preparation, caption state, upload commands, scheduling, and image drawing handoff.

[`ChatMediaHelpers.ts`](../src/screens/lib/ChatMediaHelpers.ts) normalizes MIME types, filenames, known sizes, shared items, playable/renderable URIs, download/share/save behavior, recorder state, location address text, and stable message keys.

Image annotation UI lives in [`ImageDrawingModal`](../src/screens/ChatRoomMessageActions.tsx); final raster rendering is delegated to native code through `renderNativeImageDrawing` to preserve resolution and file metadata.

## Voice messages

[`ChatRoomVoiceRecorder.tsx`](../src/screens/ChatRoomVoiceRecorder.tsx) implements hold-to-record, lock gesture, minimum duration, cancel/send state, and audio-session restoration. [`useChatVoiceRoom.ts`](../src/hooks/useChatVoiceRoom.ts) is separate; it controls persistent voice-room participation, not recorded messages.

When a voice effect is selected, recorded audio is processed by the native bridge before upload. Playback uses cached/local URI resolution and records played voice-message IDs in lightweight storage.

## Message rendering

[`MessageBubble.tsx`](../src/components/MessageBubble.tsx) renders all message kinds: text, image, video, file, voice, call, location/live location, contact/system/reply metadata, reactions, delivery state, and disappearing state. It is memoized through [`MessageRow`](../src/screens/ChatRoomMessageActions.tsx) so unrelated controller updates do not rerender every row.

Links are extracted and opened through [`messageLinks.ts`](../src/lib/messageLinks.ts). Domains listed by server policy open inside [`CatalogScreen.tsx`](../src/screens/CatalogScreen.tsx); other links use the operating system browser.

## Message actions

[`ChatRoomMessageActions.tsx`](../src/screens/ChatRoomMessageActions.tsx) provides:

- copy, reply, edit, delete, report
- forward and multi-select
- pin/unpin and pinned-message navigation
- reactions and full emoji selection
- media save/share actions
- voice-effect selection
- attachment captions and scheduling
- image drawing

Permissions are computed by the controller from sender identity, conversation type, group role, and message kind. Received messages in direct chats do not offer “delete for everyone”; group admins receive only the moderation actions allowed by server policy.

## Header and information dialogs

[`ChatRoomDialogs.tsx`](../src/screens/ChatRoomDialogs.tsx) owns:

- chat header overflow menu
- reusable option picker
- forwarding target selection
- contact sharing
- media/files/links gallery
- member/subscriber selection
- group call member selection
- direct-user and group information modal
- group settings, aliases, membership, admins, ownership transfer, and countdown confirmations

Gallery data is derived from locally stored chat messages. [`ChatMessagePreview.ts`](../src/screens/lib/ChatMessagePreview.ts) extracts links and builds human-readable previews, pinned-message text, and forward-target filters.

## Media viewer

[`ChatRoomMediaViewer.tsx`](../src/screens/ChatRoomMediaViewer.tsx) provides zoomable images, video playback, image navigation, disappearing-message handling, and the voice-room participant modal. It resolves cache state before rendering to avoid replacing a local playable URI with a remote one unnecessarily.

## Performance constraints

The chat interaction path must avoid:

- scanning complete message history on every keystroke
- synchronous AsyncStorage/SQLite work during keyboard animation
- restarting background maintenance while the chat is foregrounded
- unstable callbacks passed to every message row
- replacing complete message arrays for one receipt update when a targeted merge is possible

The current architecture addresses these through bounded timeline windows, SQLite tail reads, memoized rows, stable callbacks, delayed maintenance, batched receipts, and explicit foreground-chat cancellation.
