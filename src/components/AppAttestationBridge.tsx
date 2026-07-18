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

    const run = () => {
      void runAppAttestation(serverUrl, userId);
    };

    run();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        run();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [enabled, serverUrl, userId]);

  return null;
}
