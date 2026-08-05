import { Alert, Linking } from 'react-native';

import { t } from '../i18n';
import { navigateToCatalogUrl } from '../navigation/navigationRef';
import { useAppStore } from '../store/useAppStore';

export function isConfiguredAppDomainUrl(url: string, domains: string[]) {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

    return domains.some((domain) => {
      const normalizedDomain = domain.trim().toLowerCase().replace(/\.$/, '');
      return normalizedDomain.length > 0 && (
        hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)
      );
    });
  } catch {
    return false;
  }
}

export async function openMessageUrl(url: string) {
  const appDomains = useAppStore.getState().appDomains;

  if (isConfiguredAppDomainUrl(url, appDomains)) {
    navigateToCatalogUrl(url);
    return;
  }

  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(t('actionFailed'), url);
  }
}
