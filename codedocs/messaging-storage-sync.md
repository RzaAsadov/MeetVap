# Messaging and Local Storage

## Local-first contract

Opening a conversation should not wait for the network. [`useChatHydration.ts`](../src/hooks/useChatHydration.ts) and store actions load recent messages from SQLite, render them, and then request server changes. Realtime events update the same store and persistence path.

The server is authoritative for membership, canonical message IDs, edits, deletes, and receipt state. The device is authoritative for whether content has actually been stored locally; content acknowledgements are sent only after persistence work is scheduled/completed by the store path.

## Message lifecycle

### Sending text

1. The composer invokes `sendTextMessage` from [`useAppStore.ts`](../src/store/useAppStore.ts).
2. A unique client ID identifies the optimistic message.
3. The optimistic message is inserted in memory and SQLite with `sending` status.
4. [`backend.ts`](../src/lib/backend.ts) posts the message.
5. The canonical server response is mapped and merged with the optimistic record.
6. Conversation preview and persistence are updated.
7. Socket receipt events advance status to delivered/read.

The same pattern is adapted for media, voice, forwarded, scheduled, location, and call messages.

### Receiving

[`RealtimeBridge.tsx`](../src/components/RealtimeBridge.tsx) maps `message:new` through `mapMessage`, filters reaction fallback records, and calls `store.receiveMessage`. The store deduplicates, persists, updates the conversation preview, queues delivered/content acknowledgements, and may cache a limited number of incoming media files.

Push notifications are not treated as the message database. They alert and trigger recovery; the canonical message must still be fetched or received and saved. [`useNotificationMessageRecovery.ts`](../src/hooks/useNotificationMessageRecovery.ts) performs targeted recovery for notification-open cases.

### Edits, deletions, and status updates

Realtime events are applied immediately:

- `message:edited` -> `applyMessageEdit`
- `message:deleted` -> `removeMessage`
- `message:delivered` -> `markConversationMessagesDelivered`
- `message:read` -> `markConversationMessagesRead`
- `message:reaction` -> `applyMessageReaction`

Durable server update queues are fetched through list/bulk-list endpoints in [`backend.ts`](../src/lib/backend.ts). Conversation delta cursors record progress. After changes are safely applied, acknowledgement endpoints tell the server that the client has consumed them.

## SQLite message database

[`messageStore.ts`](../src/lib/messageStore.ts) opens `meetvap_messages.db` in WAL mode and creates:

- `messages`: searchable columns plus the complete serialized message payload.
- `media_downloads`: resumable download state.
- `active_live_location_shares`: background location work that must survive restarts.
- `local_call_stats`: per-app-version call counters/durations used for feedback and usage views.

### Message identity and deduplication

The primary key is `(conversationId, dedupeKey)`. The dedupe key is chosen in priority order:

1. scheduled-message ID
2. live-location ID
3. call ID
4. message ID

Merge matching additionally considers client ID and delete key. This allows a local optimistic record and later server record to become one row even if their server IDs differ.

`mergeStoredMessageUpdate` preserves a complete local media URI over a remote URI, preserves nonempty historical body content when a sparse update arrives, merges metadata, and keeps the highest receipt status.

All normal message database writes are serialized by a promise queue. Transactions use an exclusive Expo SQLite transaction when available.

### Read APIs

- `getRecentMessagesFromDatabase`: fast tail hydration.
- `getOlderMessagesFromDatabase`: local pagination before requesting remote history.
- `getMessagesByIdsFromDatabase`: targeted recovery/jump support.
- `getLatestMessagesByConversationIdsFromDatabase`: conversation-preview consistency checks.
- `getMessagesFromDatabase`: complete conversation history when explicitly needed.

### Write APIs

- `saveMessagesToDatabase`: replace/save a conversation set.
- `upsertMessagesToDatabase`: reconcile changed messages while preserving local details.
- `removeMessageRecordsFromDatabase`, `removeMessagesFromDatabase`, and `removeAllMessagesFromDatabase`: scoped deletion.

## Lightweight storage

[`storage.ts`](../src/lib/storage.ts) uses:

- SecureStore for auth token, lock/erase PINs, and sensitive state.
- AsyncStorage for server URL, user snapshot, conversation summaries, cursors, preferences, call logs, favorites, recent emojis, played voice IDs, and disclosure/version flags.
- SQLite delegates for message records.

Legacy message migration reads previous AsyncStorage message blobs and moves them into SQLite before normal bootstrap. This prevents every launch from parsing large message arrays on the JavaScript thread.

## Conversation synchronization

The store tracks per-conversation cursors for edits, deletions, delivery/read status, and general deltas. `prepareConversationMessages` is the chat-entry orchestration point: hydrate locally, fetch current messages/deltas as needed, and perform acknowledgements.

Background conversation maintenance is deliberately low priority:

- It waits for React Native interactions.
- It does not run while a foreground chat is active.
- It limits concurrency and yields between conversations.
- It checks delta availability before expensive reconciliation.
- A generation token cancels obsolete work.

[`foregroundChatActivity.ts`](../src/lib/foregroundChatActivity.ts) is the cross-module signal used to stop maintenance when a chat becomes interactive.

## Receipts and acknowledgements

Delivery/read receipts are batched briefly to reduce render and request churn. Content acknowledgements are different from push delivery acknowledgements:

- Push delivery means the platform transport reached a device handler.
- Message delivered/read updates represent conversation semantics.
- Content acknowledgement means the client persisted message content and protects queued content from premature server cleanup.

The client identity distinguishes mobile and web on the server; the mobile app always sends installation/platform headers through [`appClientInfo.ts`](../src/lib/appClientInfo.ts).

## Media cache

[`mediaCache.ts`](../src/lib/mediaCache.ts) owns deterministic cache names, local/remote URI resolution, resumable download records, progress subscriptions, and pause/resume. Partial files remain represented in SQLite so interrupted downloads can continue.

The store limits automatic incoming caching to avoid saturating old devices. [`backgroundPrefetch.ts`](../src/lib/backgroundPrefetch.ts) prefetches selected conversation messages without replacing foreground chat hydration.

## Diagnostics

[`messageDeliveryDiagnostics.ts`](../src/lib/messageDeliveryDiagnostics.ts) records message/call delivery milestones and can upload diagnostics when enabled by server policy. [`uiPerformanceDiagnostics.ts`](../src/lib/uiPerformanceDiagnostics.ts) measures JavaScript-thread stalls for targeted performance investigations.

Diagnostics must not become the source of truth or perform heavy synchronous serialization in interaction paths.
