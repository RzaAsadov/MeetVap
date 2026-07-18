import { useEffect, useState } from 'react';

import { HelpWebViewModal } from './HelpWebViewModal';
import { getStoredPremiumTrialIntroSeen, setStoredPremiumTrialIntroSeen } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import { useThemeColors } from '../theme/useThemeColors';

export function PremiumTrialIntro() {
  useThemeColors();
  const user = useAppStore((state) => state.user);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const [isSeen, setSeen] = useState(true);
  const shouldShowTrialIntro = subscriptionStatus?.premiumAccessSource === 'trial' &&
    (subscriptionStatus.premiumTrialDaysRemaining ?? 0) > 0;

  useEffect(() => {
    let isMounted = true;

    if (!user?.id || !shouldShowTrialIntro) {
      setSeen(true);
      return () => {
        isMounted = false;
      };
    }

    void getStoredPremiumTrialIntroSeen(user.id).then((value) => {
      if (isMounted) {
        setSeen(value === 'true');
      }
    }).catch(() => {
      if (isMounted) {
        setSeen(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [shouldShowTrialIntro, user?.id]);

  async function close() {
    if (user?.id) {
      await setStoredPremiumTrialIntroSeen(user.id).catch(() => undefined);
    }

    setSeen(true);
  }

  return (
    <HelpWebViewModal
      onClose={() => void close()}
      visible={!!user && shouldShowTrialIntro && !isSeen}
    />
  );
}
