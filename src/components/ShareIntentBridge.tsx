import { useEffect, useRef } from 'react';
import { AppState, Linking, Platform } from 'react-native';

import { getActiveCallSession } from '../lib/activeCallSession';
import { emitShareIntentItems } from '../lib/shareIntentEvents';
import { consumeNativeSharedItems, hasPendingNativeSharedItems } from '../native/CallNative';
import { navigationRef } from '../navigation/navigationRef';
import { useAppStore } from '../store/useAppStore';
import { SharedIntentItem } from '../types/navigation';

const SHARE_URL_PREFIXES = ['meetvap://share', 'com.meetvap.app://share'];
const SHARE_CONSUME_RETRY_DELAY_MS = 250;
const SHARE_CONSUME_MAX_ATTEMPTS = 6;
const SHARE_IDLE_POLL_INTERVAL_MS = 2000;
const SHARE_FOREGROUND_POLL_INTERVAL_MS = 500;
const SHARE_FOREGROUND_POLL_DURATION_MS = 30000;

export function ShareIntentBridge() {
  const user = useAppStore((state) => state.user);
  const isDecoyOffline = useAppStore((state) => state.isDecoyOffline);
  const pendingItemsRef = useRef<SharedIntentItem[] | null>(null);
  const consumeInFlightRef = useRef(false);
  const consumeAgainRef = useRef(false);
  const canOpenShareTargetRef = useRef(false);
  const foregroundPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const foregroundPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idlePollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleConsumeRef = useRef<(() => void) | null>(null);
  const canOpenShareTarget = !!user && !isDecoyOffline;

  useEffect(() => {
    canOpenShareTargetRef.current = canOpenShareTarget;

    if (canOpenShareTarget) {
      setTimeout(() => scheduleConsumeRef.current?.(), 0);
    }
  }, [canOpenShareTarget]);

  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return undefined;
    }

    let isMounted = true;

    const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

    const consumeUntilAvailable = async () => {
      for (let attempt = 0; attempt < SHARE_CONSUME_MAX_ATTEMPTS; attempt += 1) {
        if (!canOpenShareTargetRef.current || !navigationRef.isReady()) {
          await sleep(SHARE_CONSUME_RETRY_DELAY_MS);
          continue;
        }

        const hasPendingItems = await hasPendingNativeSharedItems();

        if (!isMounted) {
          return;
        }

        if (!hasPendingItems) {
          await sleep(SHARE_CONSUME_RETRY_DELAY_MS);
          continue;
        }

        const items = await consumeNativeSharedItems();

        if (!isMounted) {
          return;
        }

        if (items.length > 0) {
          openShareTarget(items);
          return;
        }

        await sleep(SHARE_CONSUME_RETRY_DELAY_MS);
      }
    };

    const scheduleConsume = () => {
      if (!canOpenShareTargetRef.current) {
        return;
      }

      if (consumeInFlightRef.current) {
        consumeAgainRef.current = true;
        return;
      }

      consumeInFlightRef.current = true;

      void consumeUntilAvailable().finally(() => {
        consumeInFlightRef.current = false;

        if (!isMounted) {
          return;
        }

        if (consumeAgainRef.current) {
          consumeAgainRef.current = false;
          scheduleConsume();
          return;
        }

        flushPending();
      });
    };

    scheduleConsumeRef.current = scheduleConsume;

    const stopForegroundPolling = () => {
      if (foregroundPollIntervalRef.current) {
        clearInterval(foregroundPollIntervalRef.current);
        foregroundPollIntervalRef.current = null;
      }

      if (foregroundPollTimeoutRef.current) {
        clearTimeout(foregroundPollTimeoutRef.current);
        foregroundPollTimeoutRef.current = null;
      }
    };

    const startForegroundPolling = () => {
      scheduleConsume();

      if (foregroundPollIntervalRef.current) {
        return;
      }

      foregroundPollIntervalRef.current = setInterval(scheduleConsume, SHARE_FOREGROUND_POLL_INTERVAL_MS);
      foregroundPollTimeoutRef.current = setTimeout(stopForegroundPolling, SHARE_FOREGROUND_POLL_DURATION_MS);
    };

    const startIdlePolling = () => {
      if (idlePollIntervalRef.current) {
        return;
      }

      idlePollIntervalRef.current = setInterval(scheduleConsume, SHARE_IDLE_POLL_INTERVAL_MS);
    };

    const stopIdlePolling = () => {
      if (idlePollIntervalRef.current) {
        clearInterval(idlePollIntervalRef.current);
        idlePollIntervalRef.current = null;
      }
    };

    const openShareTarget = (items: SharedIntentItem[]) => {
      const activeCall = getActiveCallSession();
      const currentRoute = navigationRef.isReady() ? navigationRef.getCurrentRoute() : null;

      if (activeCall?.callState === 'active' || currentRoute?.name === 'CallRoom') {
        stopForegroundPolling();
        pendingItemsRef.current = null;
        emitShareIntentItems(items);
        return;
      }

      if (navigationRef.isReady()) {
        stopForegroundPolling();
        pendingItemsRef.current = null;
        navigationRef.navigate('ShareTarget', { items });
        return;
      }

      pendingItemsRef.current = items;
    };

    const flushPending = () => {
      if (pendingItemsRef.current && navigationRef.isReady()) {
        const items = pendingItemsRef.current;
        pendingItemsRef.current = null;
        stopForegroundPolling();
        openShareTarget(items);
      }
    };

    startForegroundPolling();
    startIdlePolling();

    void Linking.getInitialURL().then((url) => {
      if (isShareUrl(url)) {
        startForegroundPolling();
      }
    });

    const urlSubscription = Linking.addEventListener('url', (event) => {
      if (isShareUrl(event.url)) {
        startForegroundPolling();
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        startForegroundPolling();
        return;
      }

      stopForegroundPolling();
    });
    const interval = setInterval(flushPending, 250);

    return () => {
      isMounted = false;
      scheduleConsumeRef.current = null;
      stopForegroundPolling();
      stopIdlePolling();
      clearInterval(interval);
      appStateSubscription.remove();
      urlSubscription.remove();
    };
  }, []);

  return null;
}

function isShareUrl(url?: string | null) {
  return !!url && SHARE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
