import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { getNativeAppVersion } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type PlatformVersionPolicy = {
  latest?: string;
  minimum?: string;
  storeUrl?: string;
};

type ClientPolicyResponse = {
  appVersions?: {
    android?: PlatformVersionPolicy;
    ios?: PlatformVersionPolicy;
  };
};

type UpdateState = {
  currentVersion: string;
  latestVersion: string;
  minimumVersion: string;
  required: boolean;
  storeUrl: string;
};

export function AppUpdateGate() {
  const insets = useSafeAreaInsets();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const isDecoyOffline = useAppStore((state) => state.isDecoyOffline);
  const [forcedUpdate, setForcedUpdate] = useState<UpdateState | null>(null);
  const [isOpeningStore, setOpeningStore] = useState(false);
  const checkInFlightRef = useRef<Promise<void> | null>(null);
  const dismissedSoftVersionRef = useRef<string | null>(null);
  const lastCheckAtRef = useRef(0);

  useEffect(() => {
    if (!serverUrl || isDecoyOffline) {
      return undefined;
    }

    void checkForUpdate({ force: true });

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void checkForUpdate({ force: false });
      }
    });

    return () => subscription.remove();

    async function checkForUpdate({ force }: { force: boolean }) {
      const currentServerUrl = serverUrl;

      if (!currentServerUrl) {
        return;
      }

      if (checkInFlightRef.current) {
        await checkInFlightRef.current;
        return;
      }

      const now = Date.now();

      if (!force && now - lastCheckAtRef.current < UPDATE_CHECK_INTERVAL_MS) {
        return;
      }

      const request = (async () => {
        lastCheckAtRef.current = now;
        const [policy, currentVersion] = await Promise.all([
          fetchClientPolicy(currentServerUrl),
          getCurrentAppVersion(),
        ]);
        const update = evaluateUpdatePolicy(policy, currentVersion);

        if (!update) {
          setForcedUpdate(null);
          return;
        }

        if (update.required) {
          setForcedUpdate(update);
          return;
        }

        if (dismissedSoftVersionRef.current === update.latestVersion) {
          return;
        }

        Alert.alert(
          t('appUpdateAvailableTitle'),
          t('appUpdateAvailableMessage', { version: update.latestVersion }),
          [
            {
              onPress: () => {
                dismissedSoftVersionRef.current = update.latestVersion;
              },
              style: 'cancel',
              text: t('later'),
            },
            {
              onPress: () => {
                dismissedSoftVersionRef.current = update.latestVersion;
                void openStore(update.storeUrl);
              },
              text: t('updateNow'),
            },
          ],
        );
      })().finally(() => {
        checkInFlightRef.current = null;
      });

      checkInFlightRef.current = request;
      await request;
    }
  }, [isDecoyOffline, serverUrl]);

  if (!forcedUpdate) {
    return null;
  }

  const openForcedStore = async () => {
    setOpeningStore(true);
    try {
      await openStore(forcedUpdate.storeUrl);
    } finally {
      setOpeningStore(false);
    }
  };

  return (
    <View style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, spacing.lg), paddingTop: Math.max(insets.top, spacing.xl) }]}>
      <View style={styles.panel}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>MV</Text>
        </View>
        <Text style={styles.title}>{t('appUpdateRequiredTitle')}</Text>
        <Text style={styles.message}>
          {t('appUpdateRequiredMessage', {
            minimum: forcedUpdate.minimumVersion,
            version: forcedUpdate.currentVersion,
          })}
        </Text>
        <Pressable disabled={isOpeningStore} onPress={openForcedStore} style={({ pressed }) => [
          styles.primaryButton,
          pressed && !isOpeningStore ? styles.primaryButtonPressed : null,
          isOpeningStore ? styles.primaryButtonDisabled : null,
        ]}>
          {isOpeningStore ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>{t('updateNow')}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

async function fetchClientPolicy(serverUrl: string) {
  const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/config/client`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });

  if (!response.ok) {
    throw new Error(`Update policy request failed: ${response.status}`);
  }

  return await response.json() as ClientPolicyResponse;
}

function evaluateUpdatePolicy(policy: ClientPolicyResponse, currentVersion: string | null): UpdateState | null {
  const platformPolicy = Platform.OS === 'ios'
    ? policy.appVersions?.ios
    : Platform.OS === 'android'
      ? policy.appVersions?.android
      : null;

  if (!platformPolicy || !currentVersion || !platformPolicy.storeUrl) {
    return null;
  }

  const minimumVersion = normalizeVersion(platformPolicy.minimum);
  const latestVersion = normalizeVersion(platformPolicy.latest);

  if (minimumVersion && compareVersions(currentVersion, minimumVersion) < 0) {
    return {
      currentVersion,
      latestVersion: latestVersion ?? minimumVersion,
      minimumVersion,
      required: true,
      storeUrl: platformPolicy.storeUrl,
    };
  }

  if (latestVersion && compareVersions(currentVersion, latestVersion) < 0) {
    return {
      currentVersion,
      latestVersion,
      minimumVersion: minimumVersion ?? latestVersion,
      required: false,
      storeUrl: platformPolicy.storeUrl,
    };
  }

  return null;
}

async function getCurrentAppVersion() {
  return normalizeVersion(await getNativeAppVersion());
}

function normalizeVersion(value?: string | null) {
  const normalized = value?.trim();

  return normalized && /^\d+(?:\.\d+){0,3}$/.test(normalized) ? normalized : null;
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue !== rightValue) {
      return leftValue > rightValue ? 1 : -1;
    }
  }

  return 0;
}

async function openStore(storeUrl: string) {
  await Linking.openURL(storeUrl);
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  badgeText: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '900',
  },
  message: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    paddingHorizontal: spacing.xl,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  panel: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.lg,
    maxWidth: 380,
    padding: spacing.xl,
    width: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.72,
  },
  primaryButtonPressed: {
    backgroundColor: colors.primaryDark,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
});
