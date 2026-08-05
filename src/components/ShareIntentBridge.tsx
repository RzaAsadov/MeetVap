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

export function ShareIntentBridge() {
  const user = useAppStore((state) => state.user);
  const isDecoyOffline = useAppStore((state) => state.isDecoyOffline);
  const pendingItemsRef = useRef<SharedIntentItem[] | null>(null);
  const consumeInFlightRef = useRef(false);
  const consumeAgainRef = useRef(false);
  const canOpenShareTargetRef = useRef(false);
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

    const openShareTarget = (items: SharedIntentItem[]) => {
      const activeCall = getActiveCallSession();
      const currentRoute = navigationRef.isReady() ? navigationRef.getCurrentRoute() : null;

      if (activeCall?.callState === 'active' || currentRoute?.name === 'CallRoom') {
        pendingItemsRef.current = null;
        emitShareIntentItems(items);
        return;
      }

      if (navigationRef.isReady()) {
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
        openShareTarget(items);
      }
    };

    scheduleConsume();

    void Linking.getInitialURL().then((url) => {
      if (isShareUrl(url)) {
        scheduleConsume();
      }
    });

    const urlSubscription = Linking.addEventListener('url', (event) => {
      if (isShareUrl(event.url)) {
        scheduleConsume();
      }
    });
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        scheduleConsume();
      }
    });

    return () => {
      isMounted = false;
      scheduleConsumeRef.current = null;
      appStateSubscription.remove();
      urlSubscription.remove();
    };
  }, []);

  return null;
}

function isShareUrl(url?: string | null) {
  return !!url && SHARE_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}
