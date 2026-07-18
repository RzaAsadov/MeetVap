import fs from 'fs';
import path from 'path';
import { Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import { z } from 'zod';

import { config } from './config';
import { prisma } from './prisma';
import { notifyServerLiveKitNodeHealthChanged } from './serverEventMessages';

export type LiveKitServerConfig = {
  apiKey: string;
  apiSecret: string;
  enabled: boolean;
  id: string;
  maxActiveCalls?: number;
  url: string;
  weight: number;
};

type SelectLiveKitServerInput = {
  assignedServerId?: string | null;
};

const liveKitServerSchema = z.object({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  enabled: z.boolean().default(true),
  id: z.string().min(1).max(80),
  maxActiveCalls: z.number().int().positive().optional(),
  url: z.string().url(),
  weight: z.number().positive().default(1),
});

const liveKitServers = parseLiveKitServers();
const LIVEKIT_HEALTH_CHECK_INTERVAL_MS = 10_000;
const LIVEKIT_HEALTH_CHECK_TIMEOUT_MS = 2_500;
const LIVEKIT_HEALTH_FAILURE_THRESHOLD = 1;
const LIVEKIT_HEALTH_RECOVERY_THRESHOLD = 1;

type LiveKitHealthState = {
  checkedAt?: Date;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  healthy: boolean;
  lastError?: string;
  status?: number;
};

const liveKitHealth = new Map<string, LiveKitHealthState>(
  liveKitServers.map((server) => [
    server.id,
    {
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      healthy: true,
    },
  ]),
);
let liveKitHealthMonitorStarted = false;
let liveKitHealthIo: Server | undefined;
const liveKitHealthRefreshes = new Map<string, Promise<void>>();

export function getConfiguredLiveKitServers() {
  return liveKitServers;
}

export function getLiveKitServerById(serverId: string) {
  return liveKitServers.find((server) => server.id === serverId) ?? null;
}

export function getLiveKitHealthSnapshot() {
  return liveKitServers.map((server) => ({
    checkedAt: liveKitHealth.get(server.id)?.checkedAt?.toISOString() ?? null,
    enabled: server.enabled,
    healthy: isLiveKitServerHealthy(server.id),
    id: server.id,
    lastError: liveKitHealth.get(server.id)?.lastError ?? null,
    status: liveKitHealth.get(server.id)?.status ?? null,
    url: server.url,
  }));
}

export function startLiveKitHealthMonitor(io?: Server) {
  liveKitHealthIo = io ?? liveKitHealthIo;

  if (liveKitHealthMonitorStarted || liveKitServers.length === 0) {
    return;
  }

  liveKitHealthMonitorStarted = true;

  void refreshLiveKitHealth().catch((error) => {
    console.error('Initial LiveKit health check failed', error);
  });

  const timer = setInterval(() => {
    void refreshLiveKitHealth().catch((error) => {
      console.error('LiveKit health check failed', error);
    });
  }, LIVEKIT_HEALTH_CHECK_INTERVAL_MS);
  timer.unref();
}

export async function selectLiveKitServer(input: SelectLiveKitServerInput) {
  if (input.assignedServerId) {
    const assignedServer = getLiveKitServerById(input.assignedServerId);

    if (!assignedServer || !assignedServer.enabled) {
      return null;
    }

    // Token issuance is on the call startup hot path. Do not block it on a
    // fresh health probe; the background monitor keeps this state current.
    void refreshLiveKitServerHealth(assignedServer).catch((error) => {
      console.warn(`LiveKit health refresh failed for ${assignedServer.id}`, error);
    });

    return isLiveKitServerHealthy(assignedServer.id) ? assignedServer : null;
  }

  return selectLeastLoadedEnabledServer();
}

export async function selectLiveKitServerForRoom(roomKey: string) {
  const enabledServers = liveKitServers
    .filter((server) => server.enabled)
    .sort((left, right) => left.id.localeCompare(right.id));

  if (enabledServers.length === 0) {
    return null;
  }

  const assignedServer = enabledServers[getStableRoomBucket(roomKey, enabledServers.length)];
  return selectLiveKitServer({ assignedServerId: assignedServer.id });
}

function getStableRoomBucket(value: string, bucketCount: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash % bucketCount;
}

async function selectLeastLoadedEnabledServer() {
  const enabledServers = liveKitServers.filter((server) => server.enabled);

  if (enabledServers.length === 0) {
    return null;
  }

  const activeCallCounts = await getActiveCallCounts(enabledServers);
  const candidates = enabledServers.filter((server) => {
    const activeCalls = activeCallCounts.get(server.id) ?? 0;

    return server.maxActiveCalls === undefined || activeCalls < server.maxActiveCalls;
  });

  if (candidates.length === 0) {
    return null;
  }

  const sortedCandidates = candidates.sort((left, right) => {
    const leftHealthy = isLiveKitServerHealthy(left.id);
    const rightHealthy = isLiveKitServerHealthy(right.id);

    if (leftHealthy !== rightHealthy) {
      return leftHealthy ? -1 : 1;
    }

    const leftLoad = (activeCallCounts.get(left.id) ?? 0) / left.weight;
    const rightLoad = (activeCallCounts.get(right.id) ?? 0) / right.weight;

    if (leftLoad !== rightLoad) {
      return leftLoad - rightLoad;
    }

    return left.id.localeCompare(right.id);
  });

  const healthyCandidate = sortedCandidates.find((candidate) => isLiveKitServerHealthy(candidate.id));

  if (healthyCandidate) {
    void refreshLiveKitServerHealth(healthyCandidate).catch((error) => {
      console.warn(`LiveKit health refresh failed for ${healthyCandidate.id}`, error);
    });
    return healthyCandidate;
  }

  return null;
}

async function getActiveCallCounts(servers: LiveKitServerConfig[]) {
  const counts = new Map<string, number>();
  const serverIds = servers.map((server) => server.id);

  if (serverIds.length === 0) {
    return counts;
  }

  const rows = await prisma.$queryRaw<Array<{ count: number; livekitServerId: string | null }>>(Prisma.sql`
    select "livekitServerId", sum("count")::int as count
    from (
      select c."livekitServerId", count(*)::int as count
      from "Call" c
      where c."endedAt" is null
        and c."livekitServerId" in (${Prisma.join(serverIds)})
        and exists (
          select 1
          from "CallParticipant" cp
          where cp."callId" = c.id
            and cp."joinedAt" is not null
            and cp."leftAt" is null
        )
      group by c."livekitServerId"
      union all
      select m."livekitServerId", count(*)::int as count
      from "Meeting" m
      where m."endedAt" is null
        and m."status" = 'ACTIVE'::"MeetingStatus"
        and m."livekitServerId" in (${Prisma.join(serverIds)})
        and exists (
          select 1
          from "MeetingParticipant" mp
          where mp."meetingId" = m.id
            and mp."leftAt" is null
        )
      group by m."livekitServerId"
    ) active_rooms
    group by "livekitServerId"
  `);

  rows.forEach((row) => {
    if (row.livekitServerId) {
      counts.set(row.livekitServerId, Number(row.count || 0));
    }
  });

  return counts;
}

async function refreshLiveKitHealth() {
  await Promise.all(liveKitServers.map((server) => refreshLiveKitServerHealth(server)));
}

async function refreshLiveKitServerHealth(server: LiveKitServerConfig) {
  const existingRefresh = liveKitHealthRefreshes.get(server.id);

  if (existingRefresh) {
    await existingRefresh;
    return;
  }

  const refresh = refreshLiveKitServerHealthOnce(server).finally(() => {
    liveKitHealthRefreshes.delete(server.id);
  });
  liveKitHealthRefreshes.set(server.id, refresh);
  await refresh;
}

async function refreshLiveKitServerHealthOnce(server: LiveKitServerConfig) {
  const previous = liveKitHealth.get(server.id) ?? {
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    healthy: true,
  };

  if (!server.enabled) {
    liveKitHealth.set(server.id, {
      ...previous,
      checkedAt: new Date(),
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      healthy: false,
      lastError: 'disabled',
      status: undefined,
    });
    return;
  }

  const result = await probeLiveKitServer(server);
  const checkedAt = new Date();

  if (result.ok) {
    const consecutiveSuccesses = previous.consecutiveSuccesses + 1;
    const nextHealthy = previous.healthy || consecutiveSuccesses >= LIVEKIT_HEALTH_RECOVERY_THRESHOLD;

    liveKitHealth.set(server.id, {
      checkedAt,
      consecutiveFailures: 0,
      consecutiveSuccesses,
      healthy: nextHealthy,
      lastError: undefined,
      status: result.status,
    });

    if (!previous.healthy && nextHealthy) {
      console.log(`LiveKit server recovered: ${server.id} (${server.url})`);
      void notifyServerLiveKitNodeHealthChanged({
        checkedAt,
        io: liveKitHealthIo,
        server: {
          id: server.id,
          url: server.url,
        },
        status: result.status ?? null,
        state: 'up',
      }).catch((error) => {
        console.warn('Could not send LiveKit recovery server event', error);
      });
    }
    return;
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  const nextHealthy = consecutiveFailures >= LIVEKIT_HEALTH_FAILURE_THRESHOLD ? false : previous.healthy;

  liveKitHealth.set(server.id, {
    checkedAt,
    consecutiveFailures,
    consecutiveSuccesses: 0,
    healthy: nextHealthy,
    lastError: result.error,
    status: result.status,
  });

  if (previous.healthy && !nextHealthy) {
    console.warn(`LiveKit server unhealthy: ${server.id} (${server.url}) - ${result.error}`);
    void notifyServerLiveKitNodeHealthChanged({
      checkedAt,
      error: result.error ?? null,
      io: liveKitHealthIo,
      server: {
        id: server.id,
        url: server.url,
      },
      status: result.status ?? null,
      state: 'down',
    }).catch((error) => {
      console.warn('Could not send LiveKit unhealthy server event', error);
    });
  }
}

async function probeLiveKitServer(server: LiveKitServerConfig): Promise<{ error?: string; ok: boolean; status?: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIVEKIT_HEALTH_CHECK_TIMEOUT_MS);

  try {
    const response = await fetch(liveKitHttpUrl(server.url), {
      cache: 'no-store',
      method: 'GET',
      signal: controller.signal,
    });

    return response.status < 500
      ? { ok: true, status: response.status }
      : { error: `HTTP ${response.status}`, ok: false, status: response.status };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isLiveKitServerHealthy(serverId: string) {
  return liveKitHealth.get(serverId)?.healthy !== false;
}

function liveKitHttpUrl(liveKitUrl: string) {
  return liveKitUrl
    .replace(/^wss:\/\//i, 'https://')
    .replace(/^ws:\/\//i, 'http://');
}

function parseLiveKitServers() {
  const pooledServers = parseLiveKitServerConfigFile() ?? [];

  if (pooledServers.length > 0) {
    return validateUniqueIds(pooledServers);
  }

  if (config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET) {
    return [
      {
        apiKey: config.LIVEKIT_API_KEY,
        apiSecret: config.LIVEKIT_API_SECRET,
        enabled: true,
        id: 'default',
        url: config.LIVEKIT_URL,
        weight: 1,
      },
    ];
  }

  return [];
}

function parseLiveKitServerConfigFile() {
  if (!config.LIVEKIT_SERVERS_CONFIG_PATH) {
    return null;
  }

  const configPath = path.resolve(config.LIVEKIT_SERVERS_CONFIG_PATH);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`LiveKit servers config file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return z.array(liveKitServerSchema).parse(parsed);
}
function validateUniqueIds(servers: LiveKitServerConfig[]) {
  const seenIds = new Set<string>();

  servers.forEach((server) => {
    if (seenIds.has(server.id)) {
      throw new Error(`LiveKit servers config contains duplicate server id: ${server.id}`);
    }

    seenIds.add(server.id);
  });

  return servers;
}
