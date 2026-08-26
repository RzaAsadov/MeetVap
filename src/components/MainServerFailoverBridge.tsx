import { useEffect, useRef } from 'react';

import { getActiveCallSession } from '../lib/activeCallSession';
import { getActiveMeetingSession } from '../lib/activeMeetingSession';
import { getActiveAccountIdSync, updateSavedAccountServerEndpoint, type SavedAccount } from '../lib/accountRegistry';
import { discoverRuntimeMainServers, probeMainServerCandidate } from '../lib/loginServerResolution';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { reportServerConnectionSuccess, subscribeToServerConnectionEvents } from '../lib/serverConnectionEvents';
import { DEFAULT_SERVER_URL, setServerUrl } from '../lib/storage';
import { hasActiveMessageUploads, useAppStore } from '../store/useAppStore';

const SOCKET_FAILURE_GRACE_MS = 10_000;
const API_FAILURE_GRACE_MS = 3_000;
const API_FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 15_000;
const FAILOVER_RETRY_COOLDOWN_MS = 20_000;
const ENDPOINT_HOLD_MS = 60_000;

const failoverOperations = new Map<string, Promise<void>>();
const lastAttemptAtByAccount = new Map<string, number>();
const lastSwitchAtByAccount = new Map<string, number>();

export function MainServerFailoverBridge() {
  const activeAccountId = useAppStore((state) => state.activeAccountId);
  const accounts = useAppStore((state) => state.accounts);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const failureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureTimesRef = useRef<number[]>([]);
  const activeAccount = accounts.find((account) => account.accountId === activeAccountId);

  useEffect(() => {
    const clearFailureTimer = () => {
      if (failureTimerRef.current) clearTimeout(failureTimerRef.current);
      failureTimerRef.current = null;
    };

    if (!activeAccount || !serverUrl || !isMainPoolAccount(activeAccount)) {
      clearFailureTimer();
      failureTimesRef.current = [];
      return undefined;
    }

    const scheduleFailover = (delayMs: number) => {
      if (
        failureTimerRef.current ||
        Date.now() - (lastAttemptAtByAccount.get(activeAccount.accountId) ?? 0) < FAILOVER_RETRY_COOLDOWN_MS
      ) return;
      failureTimerRef.current = setTimeout(() => {
        failureTimerRef.current = null;
        const latest = useAppStore.getState();
        const account = latest.accounts.find((item) => item.accountId === latest.activeAccountId);
        if (!account || !latest.serverUrl || account.accountId !== activeAccount.accountId || !isMainPoolAccount(account)) return;
        lastAttemptAtByAccount.set(account.accountId, Date.now());
        void runAccountFailover(account, latest.serverUrl);
      }, delayMs);
    };

    const unsubscribe = subscribeToServerConnectionEvents((event) => {
      if (normalizeServerUrl(event.serverUrl) !== normalizeServerUrl(serverUrl)) return;

      if (event.status === 'success') {
        failureTimesRef.current = [];
        clearFailureTimer();
        return;
      }

      const now = Date.now();
      failureTimesRef.current = [...failureTimesRef.current, now].filter((at) => now - at <= FAILURE_WINDOW_MS);
      if (event.source === 'socket') {
        scheduleFailover(SOCKET_FAILURE_GRACE_MS);
      } else if (failureTimesRef.current.length >= API_FAILURE_THRESHOLD) {
        scheduleFailover(API_FAILURE_GRACE_MS);
      }
    });

    return () => {
      clearFailureTimer();
      unsubscribe();
    };
  }, [activeAccount, serverUrl]);

  return null;
}

async function runAccountFailover(
  account: SavedAccount,
  lastServerUrl: string,
) {
  const existing = failoverOperations.get(account.accountId);
  if (existing) return existing;

  const operation = (async () => {
    logMessageDeliveryDiagnostic('main-pool-connection-lost', {
      accountId: account.accountId,
      serverUrl: lastServerUrl,
    });
    const discovery = await discoverRuntimeMainServers(account.serverInstanceId);

    if (!discovery.dnsReachable) {
      logMessageDeliveryDiagnostic('main-pool-dns-failed', { accountId: account.accountId });
      const lastServer = await probeMainServerCandidate(lastServerUrl, account.serverInstanceId);
      if (lastServer) reportServerConnectionSuccess(lastServerUrl, 'api');
      return;
    }

    const selected = discovery.candidates[0];
    if (!selected) return;
    if (normalizeServerUrl(selected.serverUrl) === normalizeServerUrl(lastServerUrl)) {
      reportServerConnectionSuccess(lastServerUrl, 'api');
      return;
    }
    if (
      Date.now() - (lastSwitchAtByAccount.get(account.accountId) ?? 0) < ENDPOINT_HOLD_MS ||
      getActiveCallSession() ||
      getActiveMeetingSession() ||
      hasActiveMessageUploads()
    ) {
      logMessageDeliveryDiagnostic('main-pool-switch-deferred', {
        accountId: account.accountId,
        activeCall: !!getActiveCallSession(),
        activeMeeting: !!getActiveMeetingSession(),
        activeUpload: hasActiveMessageUploads(),
      });
      return;
    }
    if (getActiveAccountIdSync() !== account.accountId) return;

    const updated = await updateSavedAccountServerEndpoint(account.accountId, selected.serverUrl, 'main-dns-pool');
    if (!updated || getActiveAccountIdSync() !== account.accountId) return;
    await setServerUrl(selected.serverUrl);
    const accounts = useAppStore.getState().accounts.map((item) => (
      item.accountId === updated.accountId ? updated : item
    ));
    lastSwitchAtByAccount.set(account.accountId, Date.now());
    useAppStore.setState({ accounts, serverUrl: selected.serverUrl });
    reportServerConnectionSuccess(selected.serverUrl, 'api');
    logMessageDeliveryDiagnostic('main-pool-endpoint-switched', {
      accountId: account.accountId,
      from: lastServerUrl,
      responseTimeMs: selected.responseTimeMs,
      to: selected.serverUrl,
    });
  })().finally(() => {
    if (failoverOperations.get(account.accountId) === operation) failoverOperations.delete(account.accountId);
  });

  failoverOperations.set(account.accountId, operation);
  return operation;
}

function isMainPoolAccount(account: SavedAccount) {
  return account.serverRoutingMode === 'main-dns-pool' || (
    !account.serverRoutingMode && normalizeServerUrl(account.serverUrl) === normalizeServerUrl(DEFAULT_SERVER_URL)
  );
}

function normalizeServerUrl(value: string) {
  return value.trim().toLowerCase().replace(/\/+$/, '');
}
