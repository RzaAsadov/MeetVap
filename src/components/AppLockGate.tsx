import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import * as Location from 'expo-location';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { PinPad } from './PinPad';
import { launchAnsweredCallKitCallIfPending } from '../lib/answeredCallKitLaunch';
import { t } from '../i18n';
import { addAppLockAccessListener, getCallOnlyAccessCallId, isAppLockForegroundOperationActive, setAppLockCurrentAppState, updateAppLockStatus } from '../lib/appLockAccess';
import { emitSecurityEvent } from '../lib/securityEvents';
import { bulkDeleteConversations, createLiveLocation } from '../lib/backend';
import { hasLiveLocationBackgroundAuthorization, registerLiveLocationShare } from '../lib/liveLocation';
import { clearStoredErasePin, getStoredErasePin, getStoredErasePinAlertConfig, getStoredLockPin, setStoredErasePin, setStoredLockPin } from '../lib/storage';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { getVisibleCallRoomParams, isCallRoomVisibleFor } from '../navigation/navigationRef';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';

type LockState = 'checking' | 'locked' | 'unlocked';
const ERASE_PIN_LIVE_LOCATION_DURATION_MINUTES = 720;
const ERASE_PIN_LOCATION_TIMEOUT_MS = 15 * 1000;
const PIN_REFRESH_RETRY_DELAYS_MS = [180, 420, 900];

export function AppLockGate({ children, deferPinOverlay, userId }: { children: ReactNode; deferPinOverlay?: boolean; userId?: string }) {
  useThemeColors();
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  const styles = useMemo(() => createStyles(), [isDarkMode]);
  const setDecoyOfflineMode = useAppStore((state) => state.setDecoyOfflineMode);
  const wipeChatsOnlyData = useAppStore((state) => state.wipeChatsOnlyData);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const canUsePanicPin = hasPremiumAccess(subscriptionStatus);
  const [lockState, setLockState] = useState<LockState>('checking');
  const [isAppObscured, setAppObscured] = useState(true);
  const [hasMountedApp, setHasMountedApp] = useState(false);
  const [hasLockPin, setHasLockPin] = useState(false);
  const [callOnlyAccessCallId, setCallOnlyAccessCallId] = useState<string | null>(() => getCallOnlyAccessCallId());
  const [, setLockAccessRevision] = useState(0);
  const [isPinOverlayReady, setPinOverlayReady] = useState(false);
  const [isNativeAnsweredCallCheckPending, setNativeAnsweredCallCheckPending] = useState(Platform.OS === 'ios');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isCheckingPin, setCheckingPin] = useState(false);
  const lockPinRef = useRef<string | null>(null);
  const erasePinRef = useRef<string | null>(null);
  const hasUnlockedForegroundSessionRef = useRef(false);
  const lastAppStateRef = useRef(AppState.currentState);

  const refreshPins = useCallback(async (options?: { forceLock?: boolean }) => {
    if (!userId) {
      lockPinRef.current = null;
      erasePinRef.current = null;
      hasUnlockedForegroundSessionRef.current = false;
      setHasLockPin(false);
      setPin('');
      setError('');
      setLockState('unlocked');
      setAppObscured(false);
      setHasMountedApp(true);
      return;
    }

    const [lockPin, erasePin] = await Promise.all([
      getStoredLockPin(),
      getStoredErasePin(),
    ]);

    lockPinRef.current = lockPin;
    erasePinRef.current = canUsePanicPin ? erasePin : null;
    setHasLockPin(!!lockPin);
    setPin('');
    setError('');
    setLockState(lockPin && (!hasUnlockedForegroundSessionRef.current || options?.forceLock) ? 'locked' : 'unlocked');
    setAppObscured(false);
    setHasMountedApp(true);

    if (!lockPin) {
      hasUnlockedForegroundSessionRef.current = false;
    }
  }, [canUsePanicPin, userId]);

  const safelyRefreshPins = useCallback(async (options?: { forceLock?: boolean }) => {
    for (let retryIndex = 0; retryIndex <= PIN_REFRESH_RETRY_DELAYS_MS.length; retryIndex += 1) {
      try {
        await refreshPins(options);
        return;
      } catch {
        setPin('');
        setError('');
        setLockState('checking');
        setAppObscured(true);

        const retryDelay = PIN_REFRESH_RETRY_DELAYS_MS[retryIndex];

        if (retryDelay === undefined) {
          return;
        }

        await delay(retryDelay);
      }
    }
  }, [refreshPins]);

  useEffect(() => {
    hasUnlockedForegroundSessionRef.current = false;
    setAppObscured(true);
    setLockState('checking');
    void safelyRefreshPins({ forceLock: true });
  }, [safelyRefreshPins, userId]);

  useEffect(() => {
    setAppLockCurrentAppState(AppState.currentState);

    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = lastAppStateRef.current;
      lastAppStateRef.current = nextState;
      setAppLockCurrentAppState(nextState);
      const isForegroundOperationActive = isAppLockForegroundOperationActive();

      if (nextState === 'background') {
        if (isForegroundOperationActive) {
          setPin('');
          setError('');
          setAppObscured(true);
          return;
        }

        hasUnlockedForegroundSessionRef.current = false;
        setPin('');
        setError('');
        setAppObscured(true);

        if (lockPinRef.current) {
          setLockState('locked');
        }
        return;
      }

      if (nextState === 'inactive') {
        if (isForegroundOperationActive) {
          return;
        }

        setPin('');
        setError('');
        setAppObscured(true);
        return;
      }

      if (previousState === 'background') {
        if (isForegroundOperationActive) {
          setAppObscured(false);
          void safelyRefreshPins();
        } else {
          hasUnlockedForegroundSessionRef.current = false;
          void safelyRefreshPins({ forceLock: true });
        }
        return;
      }

      setAppObscured(false);
      void safelyRefreshPins();
    });

    return () => subscription.remove();
  }, [safelyRefreshPins]);

  useEffect(() => {
    return addAppLockAccessListener(() => {
      setCallOnlyAccessCallId(getCallOnlyAccessCallId());
      setLockAccessRevision((revision) => revision + 1);
    });
  }, []);

  useEffect(() => {
    let isCancelled = false;

    void launchAnsweredCallKitCallIfPending({ isCancelled: () => isCancelled })
      .then((result) => {
        if (isCancelled) {
          return;
        }

        if (result.status === 'launched') {
          setHasMountedApp(true);
          setAppObscured(false);
          setPinOverlayReady(false);
        }

        setCallOnlyAccessCallId(getCallOnlyAccessCallId());
        setLockAccessRevision((revision) => revision + 1);
      })
      .finally(() => {
        if (!isCancelled) {
          setNativeAnsweredCallCheckPending(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!callOnlyAccessCallId) {
      return;
    }

    setHasMountedApp(true);
    setAppObscured(false);
  }, [callOnlyAccessCallId]);

  useEffect(() => {
    updateAppLockStatus({
      hasLockPin,
      isUnlocked: lockState === 'unlocked',
    });
  }, [hasLockPin, lockState]);

  useEffect(() => {
    if (lockState !== 'locked' || isAppObscured || callOnlyAccessCallId || deferPinOverlay || isNativeAnsweredCallCheckPending) {
      setPinOverlayReady(false);
      return undefined;
    }

    const timeout = setTimeout(() => setPinOverlayReady(true), 350);

    return () => clearTimeout(timeout);
  }, [callOnlyAccessCallId, deferPinOverlay, isAppObscured, isNativeAnsweredCallCheckPending, lockState]);

  useEffect(() => {
    if (pin.length !== 4 || isCheckingPin || lockState !== 'locked') {
      return;
    }

    const timeout = setTimeout(() => {
      void verifyPin(pin);
    }, 40);

    return () => clearTimeout(timeout);
  }, [isCheckingPin, lockState, pin]);

  async function verifyPin(value: string) {
    setCheckingPin(true);

    try {
      const latestLockPin = lockPinRef.current;
      const latestErasePin = canUsePanicPin ? erasePinRef.current : null;
      const isDecoyOffline = useAppStore.getState().isDecoyOffline;

      if (isDecoyOffline && latestErasePin && value === latestErasePin) {
        setPin('');
        setError('');
        await Promise.all([
          setStoredLockPin(value),
          latestLockPin ? setStoredErasePin(latestLockPin) : clearStoredErasePin(),
          setDecoyOfflineMode(false),
        ]);
        lockPinRef.current = value;
        erasePinRef.current = latestLockPin;
        hasUnlockedForegroundSessionRef.current = true;
        setHasLockPin(true);
        setLockState('unlocked');
        setAppObscured(false);
        setHasMountedApp(true);
        return;
      }

      if (latestErasePin && value === latestErasePin) {
        setPin('');
        setError('');
        const wipePromise = wipeChatsOnlyData();
        await Promise.all([
          setStoredLockPin(value),
          latestLockPin ? setStoredErasePin(latestLockPin) : clearStoredErasePin(),
          setDecoyOfflineMode(true),
        ]);
        lockPinRef.current = value;
        erasePinRef.current = latestLockPin;
        hasUnlockedForegroundSessionRef.current = true;
        setHasLockPin(true);
        emitSecurityEvent('erasePinCleared');
        setLockState('unlocked');
        setAppObscured(false);
        setHasMountedApp(true);
        void runErasePinBackgroundWorkflow(wipePromise);
        return;
      }

      if (latestLockPin && value === latestLockPin) {
        setPin('');
        setError('');
        hasUnlockedForegroundSessionRef.current = true;
        setHasLockPin(true);
        setLockState('unlocked');
        setAppObscured(false);
        setHasMountedApp(true);
        return;
      }

      setPin('');
      setError(t('enteredPinIncorrect'));
    } catch {
      setPin('');
      setError(t('pleaseTryAgain'));
    } finally {
      setCheckingPin(false);
    }
  }

  const handlePinChange = useCallback((value: string) => {
    setError('');
    setPin(value);
  }, []);

  const handleUnlockPress = useCallback(() => {
    void verifyPin(pin);
  }, [pin]);

  async function sendErasePinAlertMessages() {
    const alertConfig = await getStoredErasePinAlertConfig();
    const message = alertConfig?.message?.trim();
    const targetUserIds = alertConfig?.targetUserIds ?? [];

    if (!message || targetUserIds.length === 0) {
      return [];
    }

    const { sendTextMessage, startDirectConversation } = useAppStore.getState();
    const coords = alertConfig?.sendLiveLocation === true && await hasLiveLocationBackgroundAuthorization()
      ? await getCurrentLocationWithTimeout().catch(() => null)
      : null;

    const results = await Promise.allSettled(targetUserIds.slice(0, 2).map(async (targetUserId) => {
      const conversation = await startDirectConversation(targetUserId);

      await Promise.allSettled([
        sendTextMessage(conversation.id, message),
        coords
          ? createLiveLocation(coords.serverUrl, {
              conversationId: conversation.id,
              durationMinutes: ERASE_PIN_LIVE_LOCATION_DURATION_MINUTES,
              latitude: coords.latitude,
              longitude: coords.longitude,
            }).then((response) => registerLiveLocationShare(response.liveLocation).catch(() => undefined))
          : Promise.resolve(),
      ]);

      return conversation.id;
    }));

    return results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map((result) => result.value);
  }

  async function runErasePinBackgroundWorkflow(wipePromise: Promise<void>) {
    await wipePromise.catch(() => undefined);
    const alertConversationIds = await sendErasePinAlertMessages().catch(() => []);
    const serverUrl = useAppStore.getState().serverUrl;

    if (!serverUrl || alertConversationIds.length === 0) {
      return;
    }

    await bulkDeleteConversations(serverUrl, {
      conversationIds: alertConversationIds,
      mode: 'me',
    }).catch(() => undefined);
  }

  const isCallOnlyRouteVisible = !!callOnlyAccessCallId && isCallRoomVisibleFor(callOnlyAccessCallId);
  const visibleCallRoomParams = getVisibleCallRoomParams();
  const isNativeAnsweredIncomingCallVisible = visibleCallRoomParams?.direction === 'incoming' &&
    visibleCallRoomParams.answeredByNative === true &&
    !!visibleCallRoomParams.callId;
  const isLockedCallRoomVisible = visibleCallRoomParams?.callAccess === 'locked-call' && !!visibleCallRoomParams.callId;
  const shouldBypassPinForCall = !!callOnlyAccessCallId || isNativeAnsweredIncomingCallVisible || isLockedCallRoomVisible;
  const isCallOnlyRoutePending = !!callOnlyAccessCallId && !isCallOnlyRouteVisible && !isNativeAnsweredIncomingCallVisible && (lockState === 'checking' || lockState === 'locked');
  const isPinOverlayPreparing = lockState === 'locked' && !isAppObscured && !isPinOverlayReady && !shouldBypassPinForCall;
  const shouldShowDeferredPinCheck = (deferPinOverlay || isNativeAnsweredCallCheckPending) && lockState !== 'unlocked';

  return (
    <View style={styles.container}>
      {hasMountedApp ? children : null}
      {(((lockState === 'checking' || isAppObscured || shouldShowDeferredPinCheck) && !shouldBypassPinForCall) || isCallOnlyRoutePending || isPinOverlayPreparing) ? (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.secondary} size="large" />
        </View>
      ) : null}
      {lockState === 'locked' && !isAppObscured && isPinOverlayReady && !shouldBypassPinForCall && !isCallOnlyRoutePending ? (
        <View style={styles.overlay}>
          <View style={styles.card}>
            <Text style={styles.title}>{t('enterAppPin')}</Text>
            <Text style={styles.subtitle}>{t('enterAppPinDescription')}</Text>
            <PinPad
              disabled={isCheckingPin}
              onChange={handlePinChange}
              value={pin}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable disabled={pin.length !== 4 || isCheckingPin} onPress={handleUnlockPress} style={[styles.button, (pin.length !== 4 || isCheckingPin) && styles.buttonDisabled]}>
              {isCheckingPin ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.buttonText}>{t('unlock')}</Text>}
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCurrentLocationWithTimeout() {
  const serverUrl = useAppStore.getState().serverUrl;

  if (!serverUrl) {
    throw new Error(t('serverUrlNotConfigured'));
  }

  const foregroundPermission = await Location.getForegroundPermissionsAsync();

  if (!foregroundPermission.granted) {
    throw new Error(t('locationPermissionUnavailable'));
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  const position = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(t('locationTimedOut'))), ERASE_PIN_LOCATION_TIMEOUT_MS);
    }),
  ]).catch(() => Location.getLastKnownPositionAsync()).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });

  if (!position) {
    throw new Error(t('locationUnavailable'));
  }

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    serverUrl,
  };
}

function createStyles() {
  return StyleSheet.create({
    button: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      height: 48,
      justifyContent: 'center',
      marginTop: spacing.sm,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    buttonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '800',
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      gap: spacing.md,
      padding: spacing.xl,
      width: '100%',
    },
    container: {
      flex: 1,
    },
    error: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
    },
    loading: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      flex: 1,
      justifyContent: 'center',
    },
    loadingOverlay: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    overlay: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      padding: spacing.xl,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    title: {
      color: colors.textPrimary,
      fontSize: 22,
      fontWeight: '900',
      textAlign: 'center',
    },
  });
}
