# API and State Reference

## HTTP foundation

[`api.ts`](../src/lib/api.ts) exports:

- `ApiError`: normalized error with status and structured details.
- `apiRequest`: authenticated/masked JSON request helper with client headers and suspension/error handling.
- `validateServerUrl`: normalizes and validates an API base URL.

[`backend.ts`](../src/lib/backend.ts) is the endpoint catalog. It maps wire enums/uppercase fields into mobile domain shapes and resolves media URLs against the active server.

## Backend API families

### Authentication and account

`register`, `checkUsernameAvailability`, `login`, `deleteAccount`, `getMe`, `updateMyAvatar`, `updateMyProfile`, `updateMyPassword`, and `updatePrivacy`.

### Web pairing/devices

`getWebDevices`, `approveWebPairing`, and `logoutWebDevices`.

### Policy, help, diagnostics, and attestation

`getCatalogConfig`, `getHelpConfig`, `getRemoteDiagnosticsConfig`, `uploadRemoteDiagnostics`, `createAttestationChallenge`, `submitAndroidPlayIntegrityAttestation`, `submitIosAppAttestRegistration`, and `submitIosAppAttestAssertion`.

### Subscription

`getSubscriptionStatus`, `verifyAppleSubscription`, `verifyGoogleSubscription`, and `redeemSubscriptionCode`.

### Users and contacts

`searchUsers`, `getSharedUser`, `listContacts`, `addContact`, `deleteContact`, `listBlockedUsers`, `blockUser`, and `unblockUser`.

### Status

`getStatusSummary`, `listStatuses`, `createStatus`, `markStatusViewed`, `deleteStatus`, `listStatusViewers`, and `replyToStatus`.

### Conversations and groups

`createDirectConversation`, `createGroupConversation`, `createVoiceRoomConversation`, `updateGroupAvatar`, `updateGroupTitle`, `updateGroupSettings`, `getPublicGroupInvite`, `joinPublicGroupInvite`, `addGroupMembers`, `addGroupAdmins`, `revokeGroupAdmin`, `transferGroupOwnership`, `deleteGroup`, `removeGroupMember`, `updateGroupAlias`, `declineGroupInvite`, `updateConversationMute`, and `updateDisappearingMessages`.

### Voice rooms

`joinVoiceRoom`, `leaveVoiceRoom`, `listVoiceRoomParticipants`, and `updateVoiceRoomParticipant`.

### Message queries and durable update queues

`listConversations`, `listMessages`, `listPendingMessages`, `listMessageDeletions`, `listBulkMessageDeletions`, `listMessageEdits`, `listBulkMessageEdits`, `listConversationDeltas`, `listMessageStatusUpdates`, and `listBulkMessageStatusUpdates`.

### Acknowledgements and receipts

`acknowledgeMessageDeletions`, `acknowledgeBulkMessageDeletions`, `acknowledgeMessageEdits`, `acknowledgeBulkMessageEdits`, `acknowledgeMessageStatusUpdates`, `acknowledgeBulkMessageStatusUpdates`, `acknowledgeMessageContent`, `markMessagesDelivered`, `markConversationRead`, and `markAllConversationsRead`.

### Message commands

`createTextMessage`, `createScheduledMessage`, `deleteScheduledMessage`, `reactToMessage`, `openDisappearingMessage`, `createLiveLocation`, `updateLiveLocation`, `stopLiveLocation`, `createForwardedMessage`, `createVoiceMessage`, `createMediaMessage`, `deleteMessage`, `editMessage`, `deleteCallMessageByCallId`, `pinMessage`, `unpinMessage`, and `listPinnedMessages`.

### Uploads

`uploadMedia`, `uploadMediaFile`, `cancelMediaUpload`, `UploadCanceledError`, and `isUploadCanceledError` implement direct/chunked upload, progress, cancellation, and response mapping.

### Conversation deletion

`deleteConversation`, `deleteConversationForAnyone`, `bulkDeleteConversations`, and `acknowledgeConversationDeletion`.

### Calls

`createCall`, `answerCall`, `ringCall`, `endCall`, `getCallStatus`, `getCallToken`, `inviteCallParticipant`, `getCallScreenshotPrivacy`, and `submitCallFeedback`.

### Meetings

`createMeeting`, `getMeeting`, `joinMeeting`, `leaveMeeting`, and `endMeeting`.

### Privacy/reporting and mapping

`getConversationScreenshotPrivacy`, `reportContent`, and `mapMessage`.

## Store commands

[`useAppStore.ts`](../src/store/useAppStore.ts) groups state transitions around these actions.

### Session/preferences

`bootstrap`, `saveServerUrl`, `signInWithPassword`, `registerWithPassword`, `signOut`, `deleteAccountForever`, `setDarkMode`, `syncSystemDarkMode`, `setLanguagePreference`, `setDecoyOfflineMode`, `clearConnectionNotice`, `wipeChatsOnlyData`.

### Conversation list/history

`loadConversations`, `loadMoreConversations`, `prepareConversationMessages`, `loadMessages`, `loadOlderLocalMessages`, `releaseConversationHistory`, `markConversationReadNow`, `markAllConversationsReadNow`, `deleteChat`, `removeChatLocally`, and `clearLocalChat`.

### Message creation/mutation

`sendTextMessage`, `scheduleTextMessage`, `sendMediaMessage`, `scheduleMediaMessage`, `sendVoiceMessage`, `forwardMessage`, `addOptimisticMessage`, `editMessage`, `deleteMessage`, `reactToMessage`, `openDisappearingMessage`, and `cancelUpload`.

### Realtime reducers

`receiveMessage`, `applyMessageEdit`, `applyMessageReaction`, `removeMessage`, `markCallMessageReadByCallId`, `markConversationMessagesDelivered`, `markConversationMessagesRead`, and `cacheDownloadedMessageMedia`.

These are safe entry points for bridges. They merge/persist state rather than assuming the UI currently has a conversation loaded.

### Group/conversation settings

`updateConversationMute`, `updateDisappearingMessages`, `updateGroupAvatar`, `updateGroupAlias`, `updateGroupTitle`, `updateGroupSettings`, `addGroupMembers`, `addGroupAdmins`, `revokeGroupAdmin`, `transferGroupOwnership`, `removeGroupMember`, `deleteGroup`, and `declineGroupInvite`.

### User/social

`updateAvatar`, `updateProfile`, `updatePassword`, `updatePrivacy`, `updateCurrentUser`, `updateUserPresence`, `loadContacts`, `addUserToContacts`, `deleteContactById`, `loadBlockedUsers`, `blockUserById`, `unblockUserById`, and `reportTarget`.

### Status

`loadStatuses`, `refreshStatusSummary`, `createTextStatus`, `createMediaStatus`, `markStatusViewed`, `deleteStatusById`, and `replyToStatus`.

### Policy/subscription/catalog/help

`refreshSubscriptionStatus`, `setSubscriptionStatus`, `loadCatalogUrl`, and `loadHelpUrl`.

### Calls and conversation creation

`loadCallLogs`, `recordCallLog`, `deleteCallLog`, `startDirectConversation`, `startGroupConversation`, and `startVoiceRoomConversation`.

## Supporting service APIs

- Active calls/meetings: [`activeCallSession.ts`](../src/lib/activeCallSession.ts), [`activeMeetingSession.ts`](../src/lib/activeMeetingSession.ts).
- Audio rooms: [`voiceRoomSession.ts`](../src/lib/voiceRoomSession.ts).
- Media: [`mediaCache.ts`](../src/lib/mediaCache.ts).
- Persistence: [`storage.ts`](../src/lib/storage.ts), [`messageStore.ts`](../src/lib/messageStore.ts).
- Live location: [`liveLocation.ts`](../src/lib/liveLocation.ts).
- Server policy: [`serverPolicy.ts`](../src/lib/serverPolicy.ts).
- Native bridge: [`CallNative.ts`](../src/native/CallNative.ts).

## Change checklist for an API contract

When changing a server field or endpoint:

1. Update the wire type and endpoint wrapper in `backend.ts`.
2. Update `mapMessage` or related mapper if the field enters domain state.
3. Update domain types in `types/domain.ts`.
4. Update store merge/persistence logic, including historical missing-field handling.
5. Update socket/push mapping if the same field arrives realtime.
6. Update local SQLite dedupe/merge rules if identity or retention semantics changed.
7. Update this reference and the relevant domain guide.
