import * as SQLite from 'expo-sqlite';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

import { Message } from '../types/domain';

type MessageDatabaseExecutor = Pick<SQLite.SQLiteDatabase, 'getAllAsync' | 'runAsync'>;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;
let databaseWriteQueue: Promise<void> = Promise.resolve();
let mediaDatabaseWriteQueue: Promise<void> = Promise.resolve();
const COUNTER_ROW_ID = 'default';
const APP_VERSION = `${Constants.expoConfig?.version ?? Constants.nativeApplicationVersion ?? 'unknown'}:${Constants.nativeBuildVersion ?? '0'}`;

export type LocalUsageStats = {
  fileStorageBytes: number;
  mediaReceivedBytes: number;
  mediaSentBytes: number;
  messagesReceived: number;
  messagesSent: number;
  photoStorageBytes: number;
  videoStorageBytes: number;
  voiceCallCount: number;
  voiceCallDurationSeconds: number;
  videoCallCount: number;
  videoCallDurationSeconds: number;
};

export type LocalConversationUsageStats = LocalUsageStats & {
  conversationId: string;
};

export type MediaDownloadRecord = {
  downloadedBytes: number;
  expectedSizeBytes: number;
  localUri: string;
  messageId: string;
  remoteUri: string;
  status: 'downloading' | 'paused';
};

export type ActiveLiveLocationShare = {
  expiresAt: string;
  id: string;
};

export async function listActiveLiveLocationShares() {
  const database = await getDatabase();
  return database.getAllAsync<ActiveLiveLocationShare>(
    'select id, expiresAt from active_live_location_shares where expiresAt > ? order by expiresAt asc',
    [new Date().toISOString()],
  );
}

export async function saveActiveLiveLocationShare(share: ActiveLiveLocationShare) {
  const database = await getDatabase();
  await enqueueDatabaseWrite(() => database.runAsync(
    `insert into active_live_location_shares (id, expiresAt, updatedAtMs)
      values (?, ?, ?)
      on conflict(id) do update set expiresAt = excluded.expiresAt, updatedAtMs = excluded.updatedAtMs`,
    [share.id, share.expiresAt, Date.now()],
  ).then(() => undefined));
}

export async function removeActiveLiveLocationShare(id: string) {
  const database = await getDatabase();
  await enqueueDatabaseWrite(() => database.runAsync('delete from active_live_location_shares where id = ?', [id]).then(() => undefined));
}

export async function getMediaDownloadRecord(localUri: string) {
  const database = await getDatabase();
  return database.getFirstAsync<MediaDownloadRecord>(
    `select messageId, remoteUri, localUri, expectedSizeBytes, downloadedBytes, status
      from media_downloads where localUri = ?`,
    [localUri],
  );
}

export async function listPendingMediaDownloads() {
  const database = await getDatabase();
  return database.getAllAsync<MediaDownloadRecord>(
    `select messageId, remoteUri, localUri, expectedSizeBytes, downloadedBytes, status
      from media_downloads order by updatedAtMs asc`,
  );
}

export async function saveMediaDownloadRecord(record: MediaDownloadRecord) {
  const database = await getDatabase();
  await enqueueMediaDatabaseWrite(() => database.runAsync(
    `insert into media_downloads (
      localUri, messageId, remoteUri, expectedSizeBytes, downloadedBytes, status, updatedAtMs
    ) values (?, ?, ?, ?, ?, ?, ?)
    on conflict(localUri) do update set
      messageId = excluded.messageId,
      remoteUri = excluded.remoteUri,
      expectedSizeBytes = excluded.expectedSizeBytes,
      downloadedBytes = excluded.downloadedBytes,
      status = excluded.status,
      updatedAtMs = excluded.updatedAtMs`,
    [
      record.localUri,
      record.messageId,
      record.remoteUri,
      record.expectedSizeBytes,
      record.downloadedBytes,
      record.status,
      Date.now(),
    ],
  ).then(() => undefined));
}

export async function removeMediaDownloadRecord(localUri: string) {
  const database = await getDatabase();
  await enqueueMediaDatabaseWrite(() => database.runAsync(
    'delete from media_downloads where localUri = ?',
    [localUri],
  ).then(() => undefined));
}

export async function removeAllMediaDownloadRecords() {
  const database = await getDatabase();
  await enqueueMediaDatabaseWrite(() => database.runAsync('delete from media_downloads').then(() => undefined));
}

export async function getMessagesFromDatabase(conversationId: string) {
  const database = await getDatabase();
  await waitForPendingDatabaseWrites();
  const rows = await database.getAllAsync<{ payload: string }>(
    'select payload from messages where conversationId = ? order by createdAtMs asc, id asc',
    [conversationId],
  );

  return rows.map((row) => JSON.parse(row.payload) as Message);
}

export async function getRecentMessagesFromDatabase(conversationId: string, limit: number) {
  const database = await getDatabase();
  await waitForPendingDatabaseWrites();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await database.getAllAsync<{ payload: string }>(
    `select payload from messages
      where conversationId = ?
      order by createdAtMs desc, id desc
      limit ?`,
    [conversationId, safeLimit],
  );

  return rows
    .map((row) => JSON.parse(row.payload) as Message)
    .reverse();
}

export async function getMessagesByIdsFromDatabase(conversationId: string, messageIds: string[]) {
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);

  if (uniqueMessageIds.length === 0) {
    return [];
  }

  const database = await getDatabase();
  await waitForPendingDatabaseWrites();
  const messages: Message[] = [];

  for (const messageIdChunk of chunk(uniqueMessageIds, 200)) {
    const rows = await database.getAllAsync<{ payload: string }>(
      `select payload from messages
        where conversationId = ? and id in (${messageIdChunk.map(() => '?').join(', ')})`,
      [conversationId, ...messageIdChunk],
    );

    rows.forEach((row) => {
      try {
        messages.push(JSON.parse(row.payload) as Message);
      } catch {
        // Ignore malformed historical rows.
      }
    });
  }

  return messages;
}

export async function getOlderMessagesFromDatabase(conversationId: string, beforeCreatedAtMs: number, limit: number) {
  const database = await getDatabase();
  await waitForPendingDatabaseWrites();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await database.getAllAsync<{ payload: string }>(
    `select payload from messages
      where conversationId = ? and createdAtMs < ?
      order by createdAtMs desc, id desc
      limit ?`,
    [conversationId, beforeCreatedAtMs, safeLimit],
  );

  return rows
    .map((row) => JSON.parse(row.payload) as Message)
    .reverse();
}

export async function getLatestMessagesByConversationIdsFromDatabase(conversationIds: string[]) {
  const uniqueConversationIds = Array.from(new Set(conversationIds.filter(Boolean)));
  const latestMessagesByConversationId = new Map<string, Message>();

  if (uniqueConversationIds.length === 0) {
    return latestMessagesByConversationId;
  }

  const database = await getDatabase();
  await waitForPendingDatabaseWrites();

  for (const conversationIdChunk of chunk(uniqueConversationIds, 200)) {
    const placeholders = conversationIdChunk.map(() => '?').join(', ');
    const rows = await database.getAllAsync<{ conversationId: string; payload: string }>(
      `select m.conversationId, m.payload
        from messages m
        join (
          select conversationId, max(createdAtMs) as createdAtMs
          from messages
          where conversationId in (${placeholders})
          group by conversationId
        ) latest on latest.conversationId = m.conversationId and latest.createdAtMs = m.createdAtMs
        order by m.conversationId asc, m.createdAtMs desc, m.id desc`,
      conversationIdChunk,
    );

    rows.forEach((row) => {
      if (latestMessagesByConversationId.has(row.conversationId)) {
        return;
      }

      try {
        latestMessagesByConversationId.set(row.conversationId, JSON.parse(row.payload) as Message);
      } catch {
        // Ignore malformed historical rows.
      }
    });
  }

  return latestMessagesByConversationId;
}

export async function saveMessagesToDatabase(conversationId: string, messages: Message[]) {
  const database = await getDatabase();
  const dedupedMessages = dedupeMessages(messages);

  await enqueueDatabaseWrite(() => runDatabaseTransaction(database, async (executor) => {
    const rows = await executor.getAllAsync<{ payload: string }>(
      'select payload from messages where conversationId = ?',
      [conversationId],
    );
    let storedMessages = rows.map((row) => JSON.parse(row.payload) as Message);

    for (const message of dedupedMessages) {
      const matchingStoredMessage = storedMessages.find((storedMessage) => areMatchingMessages(storedMessage, message));
      const nextMessage = matchingStoredMessage ? mergeStoredMessageUpdate(matchingStoredMessage, message) : message;
      const nextDedupeKey = getMessageDedupeKey(nextMessage);
      const obsoleteDedupeKey = matchingStoredMessage ? getMessageDedupeKey(matchingStoredMessage) : null;

      if (obsoleteDedupeKey && obsoleteDedupeKey !== nextDedupeKey) {
        await executor.runAsync(
          'delete from messages where conversationId = ? and dedupeKey = ?',
          [conversationId, obsoleteDedupeKey],
        );
      }

      await upsertMessageRow(executor, conversationId, nextDedupeKey, nextMessage);
      storedMessages = [
        ...storedMessages.filter((storedMessage) => !areMatchingMessages(storedMessage, nextMessage)),
        nextMessage,
      ];
    }
  }));
}

export async function upsertMessagesToDatabase(conversationId: string, messages: Message[]) {
  const database = await getDatabase();
  const dedupedMessages = dedupeMessages(messages);

  if (dedupedMessages.length === 0) {
    return;
  }

  await enqueueDatabaseWrite(() => runDatabaseTransaction(database, async (executor) => {
    for (const message of dedupedMessages) {
      const matchingRows = await getPotentialMatchingStoredMessageRows(executor, conversationId, message);
      const matchingStoredMessages = matchingRows
        .map((row) => {
          try {
            return JSON.parse(row.payload) as Message;
          } catch {
            return null;
          }
        })
        .filter((storedMessage): storedMessage is Message => !!storedMessage);
      const matchingStoredMessage = matchingStoredMessages.find((storedMessage) => areMatchingMessages(storedMessage, message));
      const nextMessage = matchingStoredMessage ? mergeStoredMessageUpdate(matchingStoredMessage, message) : message;
      const nextDedupeKey = getMessageDedupeKey(nextMessage);
      const obsoleteDedupeKeys = matchingRows
        .map((row) => row.dedupeKey)
        .filter((dedupeKey) => dedupeKey !== nextDedupeKey);

      for (const obsoleteDedupeKey of obsoleteDedupeKeys) {
        await executor.runAsync(
          'delete from messages where conversationId = ? and dedupeKey = ?',
          [conversationId, obsoleteDedupeKey],
        );
      }

      await upsertMessageRow(executor, conversationId, nextDedupeKey, nextMessage);
    }
  }));
}

export async function removeMessageRecordsFromDatabase(conversationId: string, messageIds: string[]) {
  const database = await getDatabase();
  const uniqueMessageIds = [...new Set(messageIds)].filter(Boolean);

  if (uniqueMessageIds.length === 0) {
    return;
  }

  await enqueueDatabaseWrite(() => runDatabaseTransaction(database, async (executor) => {
    for (const messageIdChunk of chunk(uniqueMessageIds, 200)) {
      await executor.runAsync(
        `delete from messages where conversationId = ? and id in (${messageIdChunk.map(() => '?').join(', ')})`,
        [conversationId, ...messageIdChunk],
      );
    }
  }));
}

export async function removeMessagesFromDatabase(conversationId: string) {
  const database = await getDatabase();

  await enqueueDatabaseWrite(() => database.runAsync('delete from messages where conversationId = ?', [conversationId]).then(() => undefined));
}

export async function removeAllMessagesFromDatabase() {
  const database = await getDatabase();

  await enqueueDatabaseWrite(() => database.runAsync('delete from messages').then(() => undefined));
}

export async function ensureMessageDatabaseReady() {
  await getDatabase();
}

export async function recordFinishedCallInDatabase(mode: 'voice' | 'video', durationSeconds: number) {
  const database = await getDatabase();
  const now = Date.now();
  const normalizedDuration = Math.max(0, Math.floor(durationSeconds));

  await enqueueDatabaseWrite(() => database.runAsync(
    `update local_call_stats
      set feedbackCounter = feedbackCounter + 1,
          voiceCallCount = voiceCallCount + ?,
          videoCallCount = videoCallCount + ?,
          voiceCallDurationSeconds = voiceCallDurationSeconds + ?,
          videoCallDurationSeconds = videoCallDurationSeconds + ?,
          updatedAtMs = ?
      where id = ?`,
    [
      mode === 'voice' ? 1 : 0,
      mode === 'video' ? 1 : 0,
      mode === 'voice' ? normalizedDuration : 0,
      mode === 'video' ? normalizedDuration : 0,
      now,
      COUNTER_ROW_ID,
    ],
  ).then(() => undefined));

  const row = await database.getFirstAsync<{ feedbackCounter: number }>('select feedbackCounter from local_call_stats where id = ?', [COUNTER_ROW_ID]);
  return row?.feedbackCounter ?? 0;
}

export async function getLocalUsageStats(currentUserId?: string | null): Promise<LocalUsageStats> {
  const database = await getDatabase();
  const [callStats, rows] = await Promise.all([
    database.getFirstAsync<{
      videoCallCount: number;
      videoCallDurationSeconds: number;
      voiceCallCount: number;
      voiceCallDurationSeconds: number;
    }>('select voiceCallCount, videoCallCount, voiceCallDurationSeconds, videoCallDurationSeconds from local_call_stats where id = ?', [COUNTER_ROW_ID]),
    database.getAllAsync<{ payload: string }>('select payload from messages'),
  ]);
  const stats: LocalUsageStats = {
    fileStorageBytes: 0,
    mediaReceivedBytes: 0,
    mediaSentBytes: 0,
    messagesReceived: 0,
    messagesSent: 0,
    photoStorageBytes: 0,
    videoStorageBytes: 0,
    voiceCallCount: callStats?.voiceCallCount ?? 0,
    voiceCallDurationSeconds: callStats?.voiceCallDurationSeconds ?? 0,
    videoCallCount: callStats?.videoCallCount ?? 0,
    videoCallDurationSeconds: callStats?.videoCallDurationSeconds ?? 0,
  };
  const localMedia = new Map<string, Message>();

  rows.forEach((row) => {
    try {
      const message = JSON.parse(row.payload) as Message;
      const isMine = !!currentUserId && message.senderId === currentUserId;
      const sizeBytes = typeof message.sizeBytes === 'number' ? message.sizeBytes : 0;

      if (isMine) {
        stats.messagesSent += 1;
        stats.mediaSentBytes += sizeBytes;
      } else {
        stats.messagesReceived += 1;
        stats.mediaReceivedBytes += sizeBytes;
      }

      if (message.mediaUri && !/^https?:\/\//i.test(message.mediaUri)) {
        localMedia.set(message.mediaUri, message);
      }
    } catch {
      // Ignore malformed historical rows.
    }
  });

  await Promise.all([...localMedia.entries()].map(async ([uri, message]) => {
    const info = await FileSystem.getInfoAsync(uri).catch(() => null);
    const size = info?.exists && typeof info.size === 'number' ? info.size : 0;

    if (message.kind === 'image') {
      stats.photoStorageBytes += size;
    } else if (message.kind === 'video') {
      stats.videoStorageBytes += size;
    } else if (message.kind === 'file' || message.kind === 'voice') {
      stats.fileStorageBytes += size;
    }
  }));

  return stats;
}

export async function getLocalConversationUsageStats(currentUserId?: string | null): Promise<LocalConversationUsageStats[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ conversationId: string; payload: string }>('select conversationId, payload from messages');
  const statsByConversation = new Map<string, LocalConversationUsageStats>();
  const localMedia = new Map<string, { conversationId: string; message: Message }>();

  rows.forEach((row) => {
    const stats = getOrCreateConversationUsageStats(statsByConversation, row.conversationId);

    try {
      const message = JSON.parse(row.payload) as Message;
      const isMine = !!currentUserId && message.senderId === currentUserId;
      const sizeBytes = typeof message.sizeBytes === 'number' ? message.sizeBytes : 0;

      if (isMine) {
        stats.messagesSent += 1;
        stats.mediaSentBytes += sizeBytes;
      } else {
        stats.messagesReceived += 1;
        stats.mediaReceivedBytes += sizeBytes;
      }

      if (message.kind === 'call' && message.metadata && typeof message.metadata === 'object') {
        const mode = 'mode' in message.metadata && message.metadata.mode === 'VIDEO' ? 'video' : 'voice';
        const durationSeconds = 'durationSeconds' in message.metadata && typeof message.metadata.durationSeconds === 'number'
          ? Math.max(0, Math.floor(message.metadata.durationSeconds))
          : 0;

        if (mode === 'video') {
          stats.videoCallCount += 1;
          stats.videoCallDurationSeconds += durationSeconds;
        } else {
          stats.voiceCallCount += 1;
          stats.voiceCallDurationSeconds += durationSeconds;
        }
      }

      if (message.mediaUri && !/^https?:\/\//i.test(message.mediaUri)) {
        localMedia.set(`${row.conversationId}:${message.mediaUri}`, { conversationId: row.conversationId, message });
      }
    } catch {
      // Ignore malformed historical rows.
    }
  });

  await Promise.all([...localMedia.values()].map(async ({ conversationId, message }) => {
    const stats = getOrCreateConversationUsageStats(statsByConversation, conversationId);
    const info = message.mediaUri ? await FileSystem.getInfoAsync(message.mediaUri).catch(() => null) : null;
    const size = info?.exists && typeof info.size === 'number' ? info.size : 0;

    if (message.kind === 'image') {
      stats.photoStorageBytes += size;
    } else if (message.kind === 'video') {
      stats.videoStorageBytes += size;
    } else if (message.kind === 'file' || message.kind === 'voice') {
      stats.fileStorageBytes += size;
    }
  }));

  return [...statsByConversation.values()];
}

function getOrCreateConversationUsageStats(statsByConversation: Map<string, LocalConversationUsageStats>, conversationId: string) {
  const current = statsByConversation.get(conversationId);

  if (current) {
    return current;
  }

  const next: LocalConversationUsageStats = {
    conversationId,
    fileStorageBytes: 0,
    mediaReceivedBytes: 0,
    mediaSentBytes: 0,
    messagesReceived: 0,
    messagesSent: 0,
    photoStorageBytes: 0,
    videoStorageBytes: 0,
    voiceCallCount: 0,
    voiceCallDurationSeconds: 0,
    videoCallCount: 0,
    videoCallDurationSeconds: 0,
  };

  statsByConversation.set(conversationId, next);
  return next;
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabase().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

async function openDatabase() {
  const database = await SQLite.openDatabaseAsync('meetvap_messages.db');

  await database.execAsync(`
    pragma journal_mode = WAL;
    create table if not exists messages (
      id text not null,
      conversationId text not null,
      dedupeKey text not null,
      createdAtMs integer not null,
      kind text not null,
      senderId text not null,
      mediaUri text,
      remoteMediaUri text,
      payload text not null,
      updatedAtMs integer not null,
      primary key (conversationId, dedupeKey)
    );
    create index if not exists messages_conversation_created_idx
      on messages (conversationId, createdAtMs);
    create table if not exists local_call_stats (
      id text primary key not null,
      appVersion text not null,
      feedbackCounter integer not null default 0,
      voiceCallCount integer not null default 0,
      videoCallCount integer not null default 0,
      voiceCallDurationSeconds integer not null default 0,
      videoCallDurationSeconds integer not null default 0,
      updatedAtMs integer not null
    );
    create table if not exists media_downloads (
      localUri text primary key not null,
      messageId text not null,
      remoteUri text not null,
      expectedSizeBytes integer not null,
      downloadedBytes integer not null default 0,
      status text not null,
      updatedAtMs integer not null
    );
    create table if not exists active_live_location_shares (
      id text primary key not null,
      expiresAt text not null,
      updatedAtMs integer not null
    );
  `);
  await resetLocalCallStatsForNewAppVersion(database);

  return database;
}

async function resetLocalCallStatsForNewAppVersion(database: SQLite.SQLiteDatabase) {
  const row = await database.getFirstAsync<{ appVersion: string }>('select appVersion from local_call_stats where id = ?', [COUNTER_ROW_ID]);
  const now = Date.now();

  if (!row) {
    await database.runAsync(
      'insert into local_call_stats (id, appVersion, updatedAtMs) values (?, ?, ?)',
      [COUNTER_ROW_ID, APP_VERSION, now],
    );
    return;
  }

  if (row.appVersion !== APP_VERSION) {
    await database.runAsync(
      `update local_call_stats
        set appVersion = ?, feedbackCounter = 0, voiceCallCount = 0, videoCallCount = 0,
            voiceCallDurationSeconds = 0, videoCallDurationSeconds = 0, updatedAtMs = ?
        where id = ?`,
      [APP_VERSION, now, COUNTER_ROW_ID],
    );
  }
}

async function enqueueDatabaseWrite(operation: () => Promise<void>) {
  const run = databaseWriteQueue.catch(() => undefined).then(operation);
  databaseWriteQueue = run.catch(() => undefined);

  return run;
}

async function enqueueMediaDatabaseWrite(operation: () => Promise<void>) {
  const run = mediaDatabaseWriteQueue.catch(() => undefined).then(operation);
  mediaDatabaseWriteQueue = run.catch(() => undefined);

  return run;
}

async function waitForPendingDatabaseWrites() {
  await databaseWriteQueue.catch(() => undefined);
}

async function runDatabaseTransaction(database: SQLite.SQLiteDatabase, operation: (executor: MessageDatabaseExecutor) => Promise<void>) {
  const exclusiveTransaction = (database as SQLite.SQLiteDatabase & {
    withExclusiveTransactionAsync?: (task: (transaction: MessageDatabaseExecutor) => Promise<void>) => Promise<void>;
  }).withExclusiveTransactionAsync;

  if (exclusiveTransaction) {
    await exclusiveTransaction.call(database, operation);
    return;
  }

  await database.withTransactionAsync(() => operation(database));
}

function dedupeMessages(messages: Message[]) {
  const byKey = new Map<string, Message>();

  messages.forEach((message) => {
    byKey.set(getMessageDedupeKey(message), message);
  });

  return [...byKey.values()].sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
}

async function getPotentialMatchingStoredMessageRows(
  executor: MessageDatabaseExecutor,
  conversationId: string,
  message: Message,
) {
  const keys = getPotentialStorageLookupKeys(message);
  const placeholders = keys.map(() => '?').join(', ');

  return executor.getAllAsync<{ dedupeKey: string; payload: string }>(
    `select dedupeKey, payload from messages
      where conversationId = ? and (id in (${placeholders}) or dedupeKey in (${placeholders}))`,
    [conversationId, ...keys, ...keys],
  );
}

function getPotentialStorageLookupKeys(message: Message) {
  return Array.from(new Set([
    message.id,
    getMessageDedupeKey(message),
    getMessageClientId(message),
    getMessageDeleteKey(message),
    getMessageScheduledMessageId(message),
    getMessageLiveLocationId(message),
    getMessageCallId(message),
  ].filter((key): key is string => !!key)));
}

async function upsertMessageRow(
  executor: MessageDatabaseExecutor,
  conversationId: string,
  dedupeKey: string,
  message: Message,
) {
  await executor.runAsync(
    `insert into messages (
      id,
      conversationId,
      dedupeKey,
      createdAtMs,
      kind,
      senderId,
      mediaUri,
      remoteMediaUri,
      payload,
      updatedAtMs
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(conversationId, dedupeKey) do update set
      id = excluded.id,
      createdAtMs = excluded.createdAtMs,
      kind = excluded.kind,
      senderId = excluded.senderId,
      mediaUri = excluded.mediaUri,
      remoteMediaUri = excluded.remoteMediaUri,
      payload = excluded.payload,
      updatedAtMs = excluded.updatedAtMs`,
    [
      message.id,
      conversationId,
      dedupeKey,
      getMessageTimestamp(message),
      message.kind,
      message.senderId,
      message.mediaUri ?? null,
      getRemoteMediaUri(message) ?? null,
      JSON.stringify(message),
      Date.now(),
    ],
  );
}

function getMessageDedupeKey(message: Message) {
  const scheduledMessageId = getMessageScheduledMessageId(message);

  if (scheduledMessageId) {
    return `scheduled:${scheduledMessageId}`;
  }

  const liveLocationId = getMessageLiveLocationId(message);

  if (liveLocationId) {
    return `live-location:${liveLocationId}`;
  }

  const callId = getMessageCallId(message);

  return callId ? `call:${callId}` : message.id;
}

function getMessageCallId(message: Message) {
  const metadata = message.metadata;

  return message.kind === 'call' &&
    metadata &&
    typeof metadata === 'object' &&
    'callId' in metadata &&
    typeof metadata.callId === 'string'
    ? metadata.callId
    : undefined;
}

function getMessageLiveLocationId(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('liveLocation' in metadata)) {
    return undefined;
  }

  const liveLocation = metadata.liveLocation;

  return liveLocation &&
    typeof liveLocation === 'object' &&
    'id' in liveLocation &&
    typeof liveLocation.id === 'string'
    ? liveLocation.id
    : undefined;
}

function getMessageTimestamp(message: Message) {
  const timestamp = message.createdAtIso ? Date.parse(message.createdAtIso) : Date.parse(message.createdAt);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRemoteMediaUri(message: Message) {
  if (message.mediaUri && /^https?:\/\//i.test(message.mediaUri)) {
    return message.mediaUri;
  }

  const metadata = message.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'remoteMediaUri' in metadata &&
    typeof metadata.remoteMediaUri === 'string'
    ? metadata.remoteMediaUri
    : undefined;
}

function areMatchingMessages(left: Message, right: Message) {
  if (getMessageDedupeKey(left) === getMessageDedupeKey(right)) {
    return true;
  }

  const leftClientId = getMessageClientId(left);
  const rightClientId = getMessageClientId(right);

  if (leftClientId && leftClientId === rightClientId) {
    return true;
  }

  const leftDeleteKey = getMessageDeleteKey(left);
  const rightDeleteKey = getMessageDeleteKey(right);

  if (leftDeleteKey && leftDeleteKey === rightDeleteKey) {
    return true;
  }

  const leftScheduledMessageId = getMessageScheduledMessageId(left);
  const rightScheduledMessageId = getMessageScheduledMessageId(right);

  return !!leftScheduledMessageId && leftScheduledMessageId === rightScheduledMessageId;
}

function mergeStoredMessageUpdate(current: Message, next: Message): Message {
  const preferCurrentMedia = isLocalMediaUri(current.mediaUri) && !isLocalMediaUri(next.mediaUri);
  const preferCurrentBody = !!current.body && !next.body;
  const metadata = {
    ...(current.metadata && typeof current.metadata === 'object' ? current.metadata : {}),
    ...(next.metadata && typeof next.metadata === 'object' ? next.metadata : {}),
  };

  if ('liveLocation' in metadata) {
    delete metadata.liveLocationEstablishment;
  }

  return {
    ...next,
    body: preferCurrentBody ? current.body : next.body,
    fileName: next.fileName ?? current.fileName,
    mediaUri: preferCurrentMedia ? current.mediaUri : next.mediaUri,
    metadata,
    mimeType: next.mimeType ?? current.mimeType,
    sizeBytes: next.sizeBytes ?? current.sizeBytes,
    status: getHighestMessageStatus(current.status, next.status),
  };
}

function getMessageClientId(message: Message) {
  const metadata = message.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'clientId' in metadata &&
    typeof metadata.clientId === 'string'
    ? metadata.clientId
    : undefined;
}

function getMessageDeleteKey(message?: Message) {
  const metadata = message?.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'deleteKey' in metadata &&
    typeof metadata.deleteKey === 'string' &&
    /^[A-Za-z0-9]{16}$/.test(metadata.deleteKey)
    ? metadata.deleteKey
    : undefined;
}

function getMessageScheduledMessageId(message?: Message) {
  const metadata = message?.metadata;

  return metadata &&
    typeof metadata === 'object' &&
    'scheduledMessageId' in metadata &&
    typeof metadata.scheduledMessageId === 'string'
    ? metadata.scheduledMessageId
    : undefined;
}

function isLocalMediaUri(uri?: string) {
  return !!uri && !/^https?:\/\//i.test(uri);
}

function getHighestMessageStatus(current: Message['status'], next: Message['status']) {
  const ranks: Record<Message['status'], number> = {
    delivered: 2,
    read: 3,
    sending: 0,
    sent: 1,
  };

  return ranks[current] > ranks[next] ? current : next;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
