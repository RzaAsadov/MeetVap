import { useEffect } from 'react';
import { AppState } from 'react-native';

import { runAppAttestation } from '../lib/appAttestation';

type Props = {
  enabled: boolean;
  serverUrl?: string | null;
  userId?: string | null;
};

export function AppAttestationBridge({ enabled, serverUrl, userId }: Props) {
  useEffect(() => {
    if (!enabled || !serverUrl || !userId) {
      return undefined;
    }

    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const run = () => {
      void runAppAttestation(serverUrl, userId).then((result) => {
        if (!result?.nextRunAfterSeconds) {
          return;
        }

        if (retryTimer) {
          clearTimeout(retryTimer);
        }

        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (AppState.currentState === 'active') {
            run();
          }
        }, Math.max(30, result.nextRunAfterSeconds) * 1000);
      });
    };

    run();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        run();
      }
    });

    return () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      subscription.remove();
    };
  }, [enabled, serverUrl, userId]);

  return null;
}
