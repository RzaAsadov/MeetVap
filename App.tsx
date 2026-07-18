import 'react-native-gesture-handler';
import './src/lib/liveLocation';
import { registerGlobals, setLogLevel } from '@livekit/react-native';

import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Appearance, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { flushPendingNavigation, navigateToMeeting, navigationRef, restoreActiveMeetingIfNeeded } from './src/navigation/navigationRef';
import { AppLockGate } from './src/components/AppLockGate';
import { AppAttestationBridge } from './src/components/AppAttestationBridge';
import { AppUpdateGate } from './src/components/AppUpdateGate';
import { BackgroundLocationDisclosureBridge } from './src/components/BackgroundLocationDisclosureBridge';
import { RealtimeBridge } from './src/components/RealtimeBridge';
import { VoiceRoomBridge } from './src/components/VoiceRoomBridge';
import { PushNotificationBridge, handleIncomingCallUrl } from './src/components/PushNotificationBridge';
import { ShareIntentBridge } from './src/components/ShareIntentBridge';
import { beginCallOnlyAccess, notifyAppLockRouteChanged } from './src/lib/appLockAccess';
import { beginCallOnlyAccessFromIncomingCallUrl, launchAnsweredCallKitCallIfPending } from './src/lib/answeredCallKitLaunch';
import { colors } from './src/theme/colors';
import { useThemeColors } from './src/theme/useThemeColors';
import { useAppStore } from './src/store/useAppStore';
import { getAuthToken, getServerUrl, getStoredLanguage, migrateLegacyMessageStorage } from './src/lib/storage';
import { resolveLanguage, setI18nLanguage, t, type LanguagePreference } from './src/i18n';
import { clearNativeQuickReplyCredentials, setNativeQuickReplyCredentials } from './src/native/CallNative';
import { initializeClientInstallationId } from './src/lib/appClientInfo';

registerGlobals();
setLogLevel('error');

type StartupMigrationState = {
  status: 'checking' | 'running' | 'success' | 'failed' | 'done';
  done: number;
  total: number;
  error?: string;
};

export default function App() {
  useThemeColors();
  styles = createStyles();
  const linking = useMemo(() => ({
    config: {
      screens: {
        SharedGroup: 'g/:code',
        SharedContact: 'u/:username',
      },
    },
    prefixes: ['meetvap://', 'com.meetvap.app://', 'https://meetvap.com', 'https://www.meetvap.com'],
  }), []);
  const navigationTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colors.appBackground,
      primary: colors.primary,
      card: colors.surface,
      text: colors.textPrimary,
      border: colors.border,
    },
  };
  const bootstrap = useAppStore((state) => state.bootstrap);
  const clearConnectionNotice = useAppStore((state) => state.clearConnectionNotice);
  const connectionNotice = useAppStore((state) => state.connectionNotice);
  const connectionStatus = useAppStore((state) => state.connectionStatus);
  const isBootstrapping = useAppStore((state) => state.isBootstrapping);
  const isDecoyOffline = useAppStore((state) => state.isDecoyOffline);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const syncSystemDarkMode = useAppStore((state) => state.syncSystemDarkMode);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const user = useAppStore((state) => state.user);
  const [isInitialCallUrlCheckPending, setInitialCallUrlCheckPending] = useState(Platform.OS === 'ios');
  const [isInitialNotificationResponseCheckPending, setInitialNotificationResponseCheckPending] = useState(true);
  const [migrationAttempt, setMigrationAttempt] = useState(0);
  const [messageMigration, setMessageMigration] = useState<StartupMigrationState>({
    status: 'checking',
    done: 0,
    total: 0,
  });

  useEffect(() => {
    let isCancelled = false;

    async function startApp() {
      setMessageMigration({ status: 'checking', done: 0, total: 0 });

      try {
        await initializeClientInstallationId();
        const storedLanguage = await getStoredLanguage().catch(() => null);
        const languagePreference = isLanguagePreference(storedLanguage) ? storedLanguage : 'system';
        setI18nLanguage(resolveLanguage(languagePreference));

        setMessageMigration({ status: 'running', done: 0, total: 0 });
        const result = await migrateLegacyMessageStorage((progress) => {
          if (!isCancelled) {
            setMessageMigration({ status: 'running', ...progress });
          }
        });
        if (isCancelled) {
          return;
        }

        if (result.total > 0) {
          setMessageMigration({ status: 'success', done: result.done, total: result.total });
          await delay(1200);
        }

        if (isCancelled) {
          return;
        }

        setMessageMigration({ status: 'done', done: result.done, total: result.total });
        await bootstrap();
      } catch (error) {
        if (!isCancelled) {
          setMessageMigration({
            status: 'failed',
            done: 0,
            total: 0,
            error: getErrorMessage(error),
          });
        }
      }
    }

    void startApp();

    return () => {
      isCancelled = true;
    };
  }, [bootstrap, migrationAttempt]);

  useEffect(() => {
    let isCancelled = false;

    const isCallLaunchUrl = (url: string) => {
      try {
        const parsed = new URL(url);
        return (parsed.protocol === 'meetvap:' || parsed.protocol === 'com.meetvap.app:') &&
          (parsed.hostname === 'incoming-call' || parsed.hostname === 'chats');
      } catch {
        return false;
      }
    };
    const getMeetingCodeFromUrl = (url: string) => {
      try {
        const parsed = new URL(url);

        if (parsed.protocol === 'https:' && parsed.hostname === 'meet.meetvap.com') {
          return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
        }

        if (
          (parsed.protocol === 'meetvap:' || parsed.protocol === 'com.meetvap.app:') &&
          parsed.hostname === 'meet'
        ) {
          return parsed.pathname.split('/').filter(Boolean)[0] ?? null;
        }
      } catch {
        return null;
      }

      return null;
    };

    const beginCallOnlyAccessFromUrl = beginCallOnlyAccessFromIncomingCallUrl;

    const handleCallUrl = async (url: string | null) => {
      if (
        isCancelled ||
        !url ||
        (!isCallLaunchUrl(url) && !getMeetingCodeFromUrl(url))
      ) {
        return;
      }

      const meetingCode = getMeetingCodeFromUrl(url);

      if (meetingCode) {
        navigateToMeeting(meetingCode);
        return;
      }

      beginCallOnlyAccessFromUrl(url);
      const storedServerUrl = useAppStore.getState().serverUrl ?? await getServerUrl().catch(() => null);
      await handleIncomingCallUrl(url, storedServerUrl);
    };

    const subscription = Linking.addEventListener('url', (event) => {
      if (isCallLaunchUrl(event.url)) {
        beginCallOnlyAccessFromUrl(event.url);
        setInitialCallUrlCheckPending(true);
      }

      void handleCallUrl(event.url).finally(() => {
        if (!isCancelled) {
          setInitialCallUrlCheckPending(false);
        }
      });
    });

    void Promise.all([
      launchAnsweredCallKitCallIfPending({ isCancelled: () => isCancelled }),
      Linking.getInitialURL().then(handleCallUrl),
    ])
      .finally(() => {
        if (!isCancelled) {
          setInitialCallUrlCheckPending(false);
        }
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        restoreActiveMeetingIfNeeded();
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function prepareInitialCallNotificationAccess() {
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        const data = response?.notification.request.content.data;
        const actionIdentifier = response?.actionIdentifier;
        const callId = typeof data?.callId === 'string' ? data.callId : '';
        const isAcceptedIncomingCall = data?.type === 'incoming-call' && actionIdentifier === 'accept' && !!callId;

        if (isAcceptedIncomingCall) {
          beginCallOnlyAccess(callId);
        }
      } catch {
        // Notification response availability is best-effort during cold start.
      } finally {
        if (!isCancelled) {
          setInitialNotificationResponseCheckPending(false);
        }
      }
    }

    void prepareInitialCallNotificationAccess();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      syncSystemDarkMode(colorScheme === 'dark');
    });

    return () => subscription.remove();
  }, [syncSystemDarkMode]);

  useEffect(() => {
    let isCancelled = false;

    async function syncQuickReplyCredentials() {
      const token = await getAuthToken().catch(() => null);

      if (isCancelled) {
        return;
      }

      if (serverUrl && token && user && !isDecoyOffline) {
        setNativeQuickReplyCredentials(serverUrl, token);
        return;
      }

      clearNativeQuickReplyCredentials();
    }

    void syncQuickReplyCredentials();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void syncQuickReplyCredentials();
      }
    });

    return () => {
      isCancelled = true;
      subscription.remove();
    };
  }, [isDecoyOffline, serverUrl, user]);

  if (messageMigration.status !== 'done') {
    const shouldShowMigrationPanel = messageMigration.status === 'failed'
      || messageMigration.status === 'success'
      || messageMigration.total > 0;

    return (
      <View style={styles.startupSurface}>
        {shouldShowMigrationPanel ? <View style={styles.migrationPanel}>
          {messageMigration.status === 'failed' ? (
            <>
              <Text style={styles.migrationTitle}>{t('messageStorageMigrationFailedTitle')}</Text>
              <Text style={styles.migrationText}>{t('messageStorageMigrationFailedMessage')}</Text>
              {messageMigration.error ? <Text style={styles.migrationError}>{messageMigration.error}</Text> : null}
              <Pressable
                onPress={() => setMigrationAttempt((attempt) => attempt + 1)}
                style={styles.migrationButton}
              >
                <Text style={styles.migrationButtonText}>{t('retry')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.secondary} size="large" />
              <Text style={styles.migrationTitle}>
                {messageMigration.status === 'success'
                  ? t('messageStorageMigrationSuccessTitle')
                  : t('messageStorageMigrationTitle')}
              </Text>
              <Text style={styles.migrationText}>
                {messageMigration.status === 'success'
                  ? t('messageStorageMigrationSuccessMessage')
                  : messageMigration.total > 0
                    ? t('messageStorageMigrationProgress', {
                      done: messageMigration.done,
                      total: messageMigration.total,
                    })
                    : t('messageStorageMigrationMessage')}
              </Text>
            </>
          )}
        </View> : null}
      </View>
    );
  }

  if (isBootstrapping) {
    return <View style={styles.startupSurface} />;
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer
        linking={linking}
        onReady={() => {
          flushPendingNavigation();
          notifyAppLockRouteChanged();
        }}
        onStateChange={notifyAppLockRouteChanged}
        ref={navigationRef}
        theme={navigationTheme}
      >
        <AppLockGate deferPinOverlay={isInitialCallUrlCheckPending || isInitialNotificationResponseCheckPending} userId={user?.id}>
          {user && !isDecoyOffline ? <PushNotificationBridge /> : null}
          {user && !isDecoyOffline ? <RealtimeBridge /> : null}
          {user && !isDecoyOffline ? <VoiceRoomBridge /> : null}
          <AppAttestationBridge enabled={!!user && !isDecoyOffline} serverUrl={serverUrl} userId={user?.id} />
          <ShareIntentBridge />
          <RootNavigator />
          <BackgroundLocationDisclosureBridge enabled={!!user && !isDecoyOffline} />
          {connectionNotice ? (
            <Pressable
              onPress={clearConnectionNotice}
              style={[
                styles.connectionBanner,
                connectionStatus === 'online' ? styles.connectionBannerOnline : styles.connectionBannerOffline,
              ]}
            >
              <Text style={styles.connectionBannerText}>{connectionNotice}</Text>
            </Pressable>
          ) : null}
        </AppLockGate>
        <AppUpdateGate />
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

function isLanguagePreference(value: string | null): value is LanguagePreference {
  return value === 'system' || value === 'en' || value === 'tr' || value === 'ru';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createStyles() {
  return StyleSheet.create({
  startupSurface: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  migrationButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.secondary,
    borderRadius: 8,
    marginTop: 6,
    minWidth: 120,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  migrationButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
  migrationError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  migrationPanel: {
    alignItems: 'center',
    gap: 12,
    maxWidth: 360,
  },
  migrationText: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  migrationTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '900',
    textAlign: 'center',
  },
  connectionBanner: {
    bottom: 0,
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'absolute',
    right: 0,
  },
  connectionBannerOffline: {
    backgroundColor: '#20364d',
  },
  connectionBannerOnline: {
    backgroundColor: '#128c7e',
  },
  connectionBannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
});
}

let styles = createStyles();
