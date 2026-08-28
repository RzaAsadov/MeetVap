import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { getActiveCallSession } from '../lib/activeCallSession';
import { getActiveMeetingSession } from '../lib/activeMeetingSession';
import { getAccountSession, getActiveAccountIdSync, updateSavedAccountServerEndpoint, type SavedAccount } from '../lib/accountRegistry';
import {
  discoverRuntimeMainServers,
  isMainServerEndpointQuarantined,
  recordMainServerEndpointFailure,
  recordMainServerEndpointSuccess,
  refreshMainServerPoolCacheIfNeeded,
  requiresMainServerEndpointRecoveryConfirmation,
  validateAuthenticatedMainServerCandidate,
} from '../lib/loginServerResolution';
import { logMessageDeliveryDiagnostic } from '../lib/messageDeliveryDiagnostics';
import { syncNativeAccountCredentials } from '../lib/nativeAccountCredentials';
import { subscribeToServerConnectionEvents } from '../lib/serverConnectionEvents';
import { DEFAULT_SERVER_URL, setServerUrl } from '../lib/storage';
import { hasActiveMessageUploads, useAppStore } from '../store/useAppStore';

const SOCKET_FAILURE_GRACE_MS = 10_000;
const API_FAILURE_GRACE_MS = 3_000;
const API_FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 15_000;
const FAILOVER_RETRY_COOLDOWN_MS = 20_000;
const MIN_CACHE_TIMER_MS = 30_000;
const RECOVERY_CONFIRMATION_DELAY_MS = 1_200;

const failoverOperations = new Map<string, Promise<void>>();
const lastAttemptAtByAccount = new Map<string, number>();

export function MainServerFailoverBridge() {
  const activeAccountId = useAppStore((state) => state.activeAccountId);
  const accounts = useAppStore((state) => state.accounts);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const apiFailureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketFailureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiFailureTimesRef = useRef<number[]>([]);
  const activeAccount = accounts.find((account) => account.accountId === activeAccountId);
  const hasMainPoolAccounts = accounts.some(isMainPoolAccount);

  useEffect(() => {
    if (!hasMainPoolAccounts) return undefined;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = async () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      if (AppState.currentState !== 'active') return;
      const result = await refreshMainServerPoolCacheIfNeeded().catch(() => null);
      if (cancelled || !result) return;
      const delay = Math.max(MIN_CACHE_TIMER_MS, result.refreshAfter - Date.now());
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void scheduleRefresh();
      }, delay);
    };
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void scheduleRefresh();
    });

    void scheduleRefresh();
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      appStateSubscription.remove();
    };
  }, [hasMainPoolAccounts]);

  useEffect(() => {
    const clearApiFailureTimer = () => {
      if (apiFailureTimerRef.current) clearTimeout(apiFailureTimerRef.current);
      apiFailureTimerRef.current = null;
    };
    const clearSocketFailureTimer = () => {
      if (socketFailureTimerRef.current) clearTimeout(socketFailureTimerRef.current);
      socketFailureTimerRef.current = null;
    };

    if (!activeAccount || !serverUrl || !isMainPoolAccount(activeAccount)) {
      clearApiFailureTimer();
      clearSocketFailureTimer();
      apiFailureTimesRef.current = [];
      return undefined;
    }

    const scheduleFailover = (source: 'api' | 'socket', delayMs: number) => {
      const timerRef = source === 'api' ? apiFailureTimerRef : socketFailureTimerRef;
      if (
        timerRef.current ||
        Date.now() - (lastAttemptAtByAccount.get(activeAccount.accountId) ?? 0) < FAILOVER_RETRY_COOLDOWN_MS
      ) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (Date.now() - (lastAttemptAtByAccount.get(activeAccount.accountId) ?? 0) < FAILOVER_RETRY_COOLDOWN_MS) return;
        const latest = useAppStore.getState();
        const account = latest.accounts.find((item) => item.accountId === latest.activeAccountId);
        if (!account || !latest.serverUrl || account.accountId !== activeAccount.accountId || !isMainPoolAccount(account)) return;
        lastAttemptAtByAccount.set(account.accountId, Date.now());
        void runAccountFailover(account, latest.serverUrl, source);
      }, delayMs);
    };

    const unsubscribe = subscribeToServerConnectionEvents((event) => {
      if (normalizeServerUrl(event.serverUrl) !== normalizeServerUrl(serverUrl)) return;

      if (event.source === 'socket') {
        if (event.status === 'success') {
          clearSocketFailureTimer();
        } else {
          scheduleFailover('socket', SOCKET_FAILURE_GRACE_MS);
        }
        return;
      }

      if (event.status === 'success') {
        apiFailureTimesRef.current = [];
        clearApiFailureTimer();
        return;
      }

      const now = Date.now();
      apiFailureTimesRef.current = [...apiFailureTimesRef.current, now]
        .filter((at) => now - at <= FAILURE_WINDOW_MS);
      if (apiFailureTimesRef.current.length >= API_FAILURE_THRESHOLD) {
        scheduleFailover('api', API_FAILURE_GRACE_MS);
      }
    });

    return () => {
      clearApiFailureTimer();
      clearSocketFailureTimer();
      unsubscribe();
    };
  }, [activeAccount, serverUrl]);

  return null;
}

async function runAccountFailover(
  account: SavedAccount,
  failedServerUrl: string,
  source: 'api' | 'socket',
) {
  const existing = failoverOperations.get(account.accountId);
  if (existing) return existing;

  const operation = (async () => {
    const network = await NetInfo.fetch().catch(() => null);
    if (network && (network.isConnected === false || network.isInternetReachable === false)) {
      logMessageDeliveryDiagnostic('main-pool-device-offline', { accountId: account.accountId, source });
      return;
    }

    const session = await getAccountSession(account.accountId);
    if (!session || session.authState !== 'authenticated') return;
    if (!isStillCurrentEndpoint(account.accountId, failedServerUrl)) return;

    logMessageDeliveryDiagnostic('main-pool-connection-lost', {
      accountId: account.accountId,
      serverUrl: failedServerUrl,
      source,
    });

    const recoveredCurrent = await validateAuthenticatedMainServerCandidate({
      expectedServerInstanceId: account.serverInstanceId,
      expectedUserId: account.userId,
      serverUrl: failedServerUrl,
      token: session.token,
    });
    if (recoveredCurrent) {
      await recordMainServerEndpointSuccess(
        account.serverInstanceId,
        recoveredCurrent.serverUrl,
        recoveredCurrent.responseTimeMs,
      );
      logMessageDeliveryDiagnostic('main-pool-current-endpoint-recovered', {
        accountId: account.accountId,
        responseTimeMs: recoveredCurrent.responseTimeMs,
        serverUrl: failedServerUrl,
      });
      return;
    }

    await recordMainServerEndpointFailure(account.serverInstanceId, failedServerUrl);
    const discovery = await discoverRuntimeMainServers(account.serverInstanceId);
    logMessageDeliveryDiagnostic(discovery.dnsReachable ? 'main-pool-dns-ready' : 'main-pool-dns-cache-used', {
      accountId: account.accountId,
      candidateCount: discovery.candidates.length,
    });

    for (const candidate of discovery.candidates) {
      if (normalizeServerUrl(candidate.serverUrl) === normalizeServerUrl(failedServerUrl)) continue;
      if (await isMainServerEndpointQuarantined(account.serverInstanceId, candidate.serverUrl)) continue;
      if (!isStillCurrentEndpoint(account.accountId, failedServerUrl)) return;

      let validated = await validateAuthenticatedMainServerCandidate({
        expectedServerInstanceId: account.serverInstanceId,
        expectedUserId: account.userId,
        serverUrl: candidate.serverUrl,
        token: session.token,
      });
      if (
        validated &&
        await requiresMainServerEndpointRecoveryConfirmation(account.serverInstanceId, candidate.serverUrl)
      ) {
        await delay(RECOVERY_CONFIRMATION_DELAY_MS);
        validated = isStillCurrentEndpoint(account.accountId, failedServerUrl)
          ? await validateAuthenticatedMainServerCandidate({
              expectedServerInstanceId: account.serverInstanceId,
              expectedUserId: account.userId,
              serverUrl: candidate.serverUrl,
              token: session.token,
            })
          : null;
      }
      if (!validated) {
        await recordMainServerEndpointFailure(account.serverInstanceId, candidate.serverUrl);
        logMessageDeliveryDiagnostic('main-pool-candidate-rejected', {
          accountId: account.accountId,
          serverUrl: candidate.serverUrl,
        });
        continue;
      }

      if (getActiveCallSession() || getActiveMeetingSession() || hasActiveMessageUploads()) {
        logMessageDeliveryDiagnostic('main-pool-switch-deferred', {
          accountId: account.accountId,
          activeCall: !!getActiveCallSession(),
          activeMeeting: !!getActiveMeetingSession(),
          activeUpload: hasActiveMessageUploads(),
          serverUrl: validated.serverUrl,
        });
        return;
      }
      if (!isStillCurrentEndpoint(account.accountId, failedServerUrl)) return;

      const updated = await updateSavedAccountServerEndpoint(
        account.accountId,
        validated.serverUrl,
        'main-dns-pool',
        failedServerUrl,
      );
      if (!updated || !isStillCurrentEndpoint(account.accountId, failedServerUrl)) return;
      await setServerUrl(validated.serverUrl).catch(() => undefined);
      const latest = useAppStore.getState();
      const accounts = latest.accounts.map((item) => item.accountId === updated.accountId ? updated : item);
      useAppStore.setState({
        accounts,
        appDomains: [],
        catalogUrl: null,
        catalogUrlLoadError: null,
        connectionNotice: null,
        connectionStatus: 'unknown',
        helpUrl: null,
        helpUrlLoadError: null,
        serverUrl: validated.serverUrl,
      });
      await recordMainServerEndpointSuccess(
        account.serverInstanceId,
        validated.serverUrl,
        validated.responseTimeMs,
      );
      await syncNativeAccountCredentials();
      void useAppStore.getState().loadCatalogUrl().catch(() => undefined);
      void useAppStore.getState().loadHelpUrl().catch(() => undefined);
      logMessageDeliveryDiagnostic('main-pool-endpoint-switched', {
        accountId: account.accountId,
        from: failedServerUrl,
        responseTimeMs: validated.responseTimeMs,
        to: validated.serverUrl,
      });
      return;
    }

    logMessageDeliveryDiagnostic('main-pool-no-validated-candidate', {
      accountId: account.accountId,
      serverUrl: failedServerUrl,
    });
  })().finally(() => {
    if (failoverOperations.get(account.accountId) === operation) failoverOperations.delete(account.accountId);
  });

  failoverOperations.set(account.accountId, operation);
  return operation;
}

function isStillCurrentEndpoint(accountId: string, expectedServerUrl: string) {
  const state = useAppStore.getState();
  return getActiveAccountIdSync() === accountId &&
    state.activeAccountId === accountId &&
    !!state.serverUrl &&
    normalizeServerUrl(state.serverUrl) === normalizeServerUrl(expectedServerUrl);
}

function isMainPoolAccount(account: SavedAccount) {
  return account.serverRoutingMode === 'main-dns-pool' || (
    !account.serverRoutingMode && normalizeServerUrl(account.serverUrl) === normalizeServerUrl(DEFAULT_SERVER_URL)
  );
}

function normalizeServerUrl(value: string) {
  return value.trim().toLowerCase().replace(/\/+$/, '');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
