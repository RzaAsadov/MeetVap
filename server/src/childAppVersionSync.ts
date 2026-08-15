import { z } from 'zod';

import {
  appVersionsSchema,
  operationalConfig,
  updateOperationalAppVersions,
} from './operationalConfig';

const CHILD_APP_VERSION_SYNC_INTERVAL_MS = 10 * 60_000;
const childAppVersionsResponseSchema = z.object({
  appVersions: appVersionsSchema,
});
let syncRunning = false;
let responseEtag: string | null = null;

export function startChildAppVersionSyncWorker() {
  if (operationalConfig.serverRole !== 'child') {
    return;
  }

  const run = async () => {
    if (syncRunning) {
      return;
    }

    syncRunning = true;
    try {
      await synchronizeChildAppVersions();
    } finally {
      syncRunning = false;
    }
  };

  void run().catch(logSynchronizationError);
  const timer = setInterval(() => {
    void run().catch(logSynchronizationError);
  }, CHILD_APP_VERSION_SYNC_INTERVAL_MS);
  timer.unref();
}

async function synchronizeChildAppVersions() {
  const response = await fetch(`${getMainServerBaseUrl()}/internal/child-config/app-versions`, {
    headers: {
      'x-meetvap-main-server-key': operationalConfig.mainServerKey!,
      ...(responseEtag ? { 'If-None-Match': responseEtag } : {}),
    },
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 304) {
    return;
  }
  if (!response.ok) {
    throw new Error(`Main app-version sync returned ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  }

  const payload = childAppVersionsResponseSchema.parse(await response.json());
  const changed = await updateOperationalAppVersions(payload.appVersions);
  responseEtag = response.headers.get('etag');

  if (changed) {
    console.info('Child app-version policy synchronized from main server', payload.appVersions);
  }
}

function getMainServerBaseUrl() {
  return operationalConfig.mainServerHost!.replace(/\/+$/, '');
}

function logSynchronizationError(error: unknown) {
  console.error('Child app-version policy synchronization failed', error instanceof Error ? error.message : error);
}
