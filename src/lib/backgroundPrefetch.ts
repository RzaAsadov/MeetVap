import * as FileSystem from 'expo-file-system/legacy';

import { acknowledgeMessageDeletions, acknowledgeMessageEdits, listConversations, listMessageDeletions, listMessageEdits, listMessages, markMessagesDelivered } from './backend';
import type { MessageEdit } from './backend';
import { logMessageDeliveryDiagnostic } from './messageDeliveryDiagnostics';
import { getAuthToken, getDeletedConversationAfter, getServerUrl, getStoredDecoyOffline, getStoredMessages, getStoredRecentMessages, getStoredUser, removeStoredMessageRecords, setStoredConversations, upsertStoredMessages } from './storage';
import type { AuthUser, Message } from '../types/domain';

type PrefetchState = {
  promise: Promise<void>;
  rerunRequested: boolean;
};

const activePrefetchesByConversation = new Map<string, PrefetchState>();

export async function prefetchConversationMessages(conversationId: string) {
  const activePrefetch = activePrefetchesByConversation.get(conversationId);

  if (activePrefetch) {
    activePrefetch.rerunRequested = true;
    logMessageDeliveryDiagnostic('background-prefetch-coalesced', {
      conversationId,
    });
    return activePrefetch.promise;
  }

  const prefetchState: PrefetchState = {
    promise: Promise.resolve(),
    rerunRequested: false,
  };

  prefetchState.promise = (async () => {
    try {
      do {
        prefetchState.rerunRequested = false;
        await runConversationMessagePrefetch(conversationId);
      } while (prefetchState.rerunRequested);
    } finally {
      if (activePrefetchesByConversation.get(conversationId) === prefetchState) {
        activePrefetchesByConversation.delete(conversationId);
      }
    }
  })();

  activePrefetchesByConversation.set(conversationId, prefetchState);
  return prefetchState.promise;
}

async function runConversationMessagePrefetch(conversationId: string) {
  const [serverUrl, token, isDecoyOffline, user] = await Promise.all([
    getServerUrl(),
    getAuthToken(),
    getStoredDecoyOffline(),
    getStoredUser<AuthUser>(),
  ]);

  if (isDecoyOffline || !serverUrl || !token || !user) {
    logMessageDeliveryDiagnostic('background-prefetch-skipped', {
      conversationId,
      hasServerUrl: !!serverUrl,
      hasToken: !!token,
      hasUser: !!user,
      isDecoyOffline,
    });
    return;
  }

  // Push delivery normally needs only the local tail cursor. Reading and parsing an
  // entire long conversation here blocked the JS thread on older Android phones.
  const cachedMessages = dedupeMessages(await getStoredRecentMessages(conversationId, 2));
  const latestCachedMessage = cachedMessages
    .filter((message) => !message.id.startsWith('local-') && message.createdAtIso)
    .at(-1);
  const deletedAfter = latestCachedMessage ? null : await getDeletedConversationAfter(conversationId);
  const [messageResponse, deletions, edits] = await Promise.all([
    listMessages(
      serverUrl,
      conversationId,
      getOverlappingMessageFetchAfter(latestCachedMessage?.createdAtIso) ?? deletedAfter ?? undefined,
    ),
    listMessageDeletions(serverUrl, conversationId).catch(() => []),
    listMessageEdits(serverUrl, conversationId).catch(() => []),
  ]);
  logMessageDeliveryDiagnostic('background-prefetch-fetched', {
    cachedCount: cachedMessages.length,
    conversationId,
    deletedCount: deletions.length,
    editCount: edits.length,
    fetchAfter: getOverlappingMessageFetchAfter(latestCachedMessage?.createdAtIso) ?? deletedAfter ?? null,
    latestCachedMessageId: latestCachedMessage?.id,
    remoteCount: messageResponse.messages.length,
    remoteIds: messageResponse.messages.slice(-8).map((message) => message.id),
  });
  const deletedMessageIds = deletions.map((deletion) => deletion.messageId).filter((id): id is string => !!id);
  const deletedMessageKeys = deletions.map((deletion) => deletion.messageKey).filter((key): key is string => !!key);
  const nextRemoteMessages = applyMessageEditsToMessages(
    messageResponse.messages.filter((message) => !shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys)),
    edits,
  ).messages;
  const latestStoredMessages = deletedMessageIds.length > 0 || deletedMessageKeys.length > 0 || edits.length > 0
    ? dedupeMessages(await getStoredMessages(conversationId))
    : cachedMessages;
  const editedStoredMessages = applyMessageEditsToMessages(
    latestStoredMessages.filter((message) => !shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys)),
    edits,
  ).messages.filter((message) => edits.some((edit) => isMessageEditTarget(message, edit)));
  const deletedStoredMessageIds = latestStoredMessages
    .filter((message) => shouldRemoveMessageForDeletion(message, deletedMessageIds, deletedMessageKeys))
    .map((message) => message.id);

  await removeStoredMessageRecords(conversationId, deletedStoredMessageIds);
  await upsertStoredMessages(conversationId, [...nextRemoteMessages, ...editedStoredMessages]);
  logMessageDeliveryDiagnostic('background-prefetch-persisted', {
    conversationId,
    deletedStoredCount: deletedStoredMessageIds.length,
    persistedCount: nextRemoteMessages.length + editedStoredMessages.length,
    remoteCount: nextRemoteMessages.length,
    remoteIds: nextRemoteMessages.slice(-8).map((message) => message.id),
  });

  const deliveredTextMessageIds = nextRemoteMessages
    .filter((message) => message.kind === 'text' && message.senderId !== user.id && !message.id.startsWith('local-'))
    .map((message) => message.id);

  // Delivery-only ACK: do not content-ACK or purge messages from background prefetch.
  // Keep headless delivery limited to text messages; media/file content is handled by foreground paths.
  await Promise.all([
    markMessagesDelivered(serverUrl, conversationId, deliveredTextMessageIds).catch(() => undefined),
    acknowledgeMessageDeletions(serverUrl, conversationId, deletedMessageIds, deletedMessageKeys).catch(() => undefined),
    acknowledgeMessageEdits(
      serverUrl,
      conversationId,
      edits.map((edit) => edit.messageId).filter((id): id is string => !!id),
      edits.map((edit) => edit.messageKey).filter((key): key is string => !!key),
    ).catch(() => undefined),
    listConversations(serverUrl).then((response) => setStoredConversations(response.conversations)).catch(() => undefined),
  ]);
  logMessageDeliveryDiagnostic('background-prefetch-acked-delivery', {
    conversationId,
    deliveredTextMessageCount: deliveredTextMessageIds.length,
    deliveredTextMessageIds: deliveredTextMessageIds.slice(-10),
  });
}

function shouldRemoveMessageForDeletion(message: Message, messageIds: string[], messageKeys: string[]) {
  const metadata = message.metadata;
  const deleteKey = metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string'
    ? metadata.deleteKey
    : undefined;

  return messageIds.includes(message.id) || (!!deleteKey && messageKeys.includes(deleteKey));
}

function getMessageDeleteKey(message: Message) {
  const metadata = message.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string'
    ? metadata.deleteKey
    : undefined;
}

function isMessageEditTarget(message: Message, edit: MessageEdit) {
  const messageKey = getMessageDeleteKey(message);

  return (!!edit.messageId && message.id === edit.messageId) || (!!edit.messageKey && messageKey === edit.messageKey);
}

function applyMessageEditsToMessages(messages: Message[], edits: MessageEdit[]) {
  let didApply = false;
  const nextMessages = messages.map((message) => {
    const edit = edits.find((item) => isMessageEditTarget(message, item));

    if (!edit) {
      return message;
    }

    didApply = true;
    return {
      ...message,
      body: edit.body,
      metadata: {
        ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
        ...(edit.metadata && typeof edit.metadata === 'object' ? edit.metadata : {}),
        deleteKey: edit.messageKey || getMessageDeleteKey(message),
      },
    };
  });

  return { didApply, messages: nextMessages };
}

function mergeMessages(currentMessages: Message[], nextMessages: Message[]) {
  return dedupeMessages([...currentMessages, ...nextMessages]).sort((left, right) => (
    getMessageTimestamp(left) - getMessageTimestamp(right)
  ));
}

function dedupeMessages(messages: Message[]) {
  const byId = new Map<string, Message>();

  messages.forEach((message) => {
    const key = getMessageDedupeKey(message);

    byId.set(key, mergeMessageUpdate(byId.get(key), message));
  });

  return [...byId.values()];
}

function mergeMessageUpdate(current: Message | undefined, next: Message): Message {
  if (!current) {
    const remoteMediaUri = getMessageRemoteMediaUri(next);
    return remoteMediaUri ? withRemoteMediaMetadata(next, remoteMediaUri) : next;
  }

  const currentCallId = getMessageCallIdFromMetadata(current);
  const nextCallId = getMessageCallIdFromMetadata(next);
  const isSameCallMessage = !!currentCallId && currentCallId === nextCallId;
  const canonicalMessage = isSameCallMessage && getMessageTimestamp(current) <= getMessageTimestamp(next)
    ? current
    : next;
  const remoteMediaUri = getMessageRemoteMediaUri(next) ?? getMessageRemoteMediaUri(current);
  const mediaUri = isLocalMediaUri(current.mediaUri) && !isLocalMediaUri(next.mediaUri)
    ? current.mediaUri
    : next.mediaUri;

  return {
    ...next,
    body: next.body || current.body,
    createdAt: canonicalMessage.createdAt,
    createdAtIso: canonicalMessage.createdAtIso,
    fileName: next.fileName ?? current.fileName,
    id: canonicalMessage.id,
    mediaUri,
    metadata: {
      ...(current.metadata && typeof current.metadata === 'object' ? current.metadata : {}),
      ...(next.metadata && typeof next.metadata === 'object' ? next.metadata : {}),
      ...(remoteMediaUri ? { remoteMediaUri } : {}),
    },
    mimeType: next.mimeType ?? current.mimeType,
    sender: canonicalMessage.sender,
    senderId: canonicalMessage.senderId,
    sizeBytes: next.sizeBytes ?? current.sizeBytes,
    status: getHighestMessageStatus(current.status, next.status),
  };
}

function getMessageDedupeKey(message: Message) {
  const callId = getMessageCallIdFromMetadata(message);

  return callId ? `call:${message.conversationId}:${callId}` : message.id;
}

function getMessageCallIdFromMetadata(message: Message) {
  const metadata = message.metadata;

  return message.kind === 'call' && metadata && typeof metadata === 'object' && 'callId' in metadata && typeof metadata.callId === 'string'
    ? metadata.callId
    : undefined;
}

const MESSAGE_STATUS_RANK: Record<Message['status'], number> = {
  delivered: 2,
  read: 3,
  sending: 0,
  sent: 1,
};

function getHighestMessageStatus(current: Message['status'], next: Message['status']) {
  return MESSAGE_STATUS_RANK[current] > MESSAGE_STATUS_RANK[next] ? current : next;
}

function getMessageRemoteMediaUri(message?: Message) {
  if (!message) {
    return undefined;
  }

  if (message.mediaUri && /^https?:\/\//i.test(message.mediaUri)) {
    return message.mediaUri;
  }

  const metadata = message.metadata;

  return metadata && typeof metadata === 'object' && 'remoteMediaUri' in metadata && typeof metadata.remoteMediaUri === 'string'
    ? metadata.remoteMediaUri
    : undefined;
}

function withRemoteMediaMetadata(message: Message, remoteMediaUri: string) {
  return {
    ...message,
    metadata: {
      ...(message.metadata && typeof message.metadata === 'object' ? message.metadata : {}),
      remoteMediaUri,
    },
  };
}

function getMessageTimestamp(message: Message) {
  return message.createdAtIso ? Date.parse(message.createdAtIso) : Date.parse(message.createdAt);
}

function getOverlappingMessageFetchAfter(createdAtIso?: string) {
  if (!createdAtIso) {
    return undefined;
  }

  const createdAtTime = Date.parse(createdAtIso);

  if (!Number.isFinite(createdAtTime)) {
    return undefined;
  }

  return new Date(Math.max(0, createdAtTime - 2000)).toISOString();
}

function isLocalMediaUri(uri?: string) {
  if (!uri) {
    return false;
  }

  if (/^(file|content):/i.test(uri)) {
    return true;
  }

  return [FileSystem.documentDirectory, FileSystem.cacheDirectory].some((directory) => (
    !!directory && uri.startsWith(directory)
  ));
}
