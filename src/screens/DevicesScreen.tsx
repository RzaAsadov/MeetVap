import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { approveWebPairing, getWebDevices, logoutWebDevices } from '../lib/backend';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';

export function DevicesScreen() {
  useThemeColors();
  styles = createStyles();
  const insets = useSafeAreaInsets();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const [permission, requestPermission] = useCameraPermissions();
  const [isLoading, setLoading] = useState(false);
  const [isScannerOpen, setScannerOpen] = useState(false);
  const [isApproving, setApproving] = useState(false);
  const [webSession, setWebSession] = useState<{
    createdAt: string;
    expiresAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!serverUrl) {
      return;
    }

    setLoading(true);
    try {
      const response = await getWebDevices(serverUrl);
      setWebSession(response.webSession);
    } catch (error) {
      Alert.alert(t('devices'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setLoading(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openScanner() {
    if (!permission?.granted) {
      const nextPermission = await requestPermission();
      if (!nextPermission.granted) {
        Alert.alert(t('cameraPermissionNeeded'), t('pleaseTryAgain'));
        return;
      }
    }

    setScannerOpen(true);
  }

  async function logoutWeb() {
    if (!serverUrl) {
      return;
    }

    setLoading(true);
    try {
      await logoutWebDevices(serverUrl);
      setWebSession(null);
    } catch (error) {
      Alert.alert(t('webLogoutFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setLoading(false);
    }
  }

  async function handleBarcode(result: BarcodeScanningResult) {
    if (isApproving || !serverUrl) {
      return;
    }

    const parsed = parseWebPairingCode(result.data);

    if (!parsed) {
      Alert.alert(t('invalidQrCode'), t('invalidWebPairingQr'));
      return;
    }

    setApproving(true);
    try {
      await approveWebPairing(serverUrl, parsed);
      setScannerOpen(false);
      Alert.alert(t('webAccessEnabled'), t('webAccessEnabledDescription'));
      await refresh();
    } catch (error) {
      Alert.alert(t('webPairingFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setApproving(false);
    }
  }

  if (isScannerOpen) {
    return (
      <View style={styles.scannerScreen}>
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={isApproving ? undefined : handleBarcode}
          style={StyleSheet.absoluteFill}
        />
        <View style={[styles.scannerTop, { paddingTop: insets.top + spacing.md }]}>
          <Pressable onPress={() => setScannerOpen(false)} style={styles.closeScannerButton}>
            <Ionicons color={colors.white} name="close" size={26} />
          </Pressable>
        </View>
        <View style={styles.scanFrame}>
          {isApproving ? <ActivityIndicator color={colors.white} size="large" /> : <Text style={styles.scanText}>{t('scanWebQrCode')}</Text>}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons color={colors.primary} name="desktop-outline" size={30} />
        </View>
        <Text style={styles.title}>{t('webAccess')}</Text>
        <Text style={styles.subtitle}>{webSession ? t('webAccessEnabled') : t('webAccessDisabled')}</Text>
        {webSession ? (
          <Text style={styles.meta}>
            {webSession.userAgent || t('webBrowser')}
          </Text>
        ) : null}
      </View>
      <Pressable disabled={isLoading} onPress={openScanner} style={styles.primaryButton}>
        <Ionicons color={colors.white} name="qr-code-outline" size={20} />
        <Text style={styles.primaryButtonText}>{t('scanQrCode')}</Text>
      </Pressable>
      <Pressable disabled={isLoading || !webSession} onPress={() => void logoutWeb()} style={[styles.secondaryButton, (!webSession || isLoading) && styles.disabledButton]}>
        {isLoading ? <ActivityIndicator color={colors.textPrimary} /> : <Ionicons color={colors.textPrimary} name="log-out-outline" size={20} />}
        <Text style={styles.secondaryButtonText}>{t('logoutWebAccess')}</Text>
      </Pressable>
    </View>
  );
}

function parseWebPairingCode(value: string) {
  try {
    const parsed = new URL(value);
    const pairingId = parsed.searchParams.get('pairingId') ?? '';
    const secret = parsed.searchParams.get('secret') ?? '';

    if (!pairingId || !secret) {
      return null;
    }

    return { pairingId, secret };
  } catch {
    return null;
  }
}

let styles = createStyles();

function createStyles() {
  return StyleSheet.create({
    card: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      gap: spacing.sm,
      padding: spacing.xl,
    },
    closeScannerButton: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.45)',
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    disabledButton: {
      opacity: 0.45,
    },
    iconWrap: {
      alignItems: 'center',
      backgroundColor: 'rgba(64, 158, 255, 0.14)',
      borderRadius: 28,
      height: 56,
      justifyContent: 'center',
      width: 56,
    },
    meta: {
      color: colors.textSecondary,
      fontSize: 13,
      textAlign: 'center',
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 14,
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      minHeight: 52,
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '900',
    },
    scanFrame: {
      alignItems: 'center',
      alignSelf: 'center',
      borderColor: colors.white,
      borderRadius: 24,
      borderWidth: 2,
      height: 260,
      justifyContent: 'center',
      marginTop: 180,
      width: 260,
    },
    scannerScreen: {
      backgroundColor: '#000000',
      flex: 1,
    },
    scannerTop: {
      paddingHorizontal: spacing.lg,
    },
    scanText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '900',
      textAlign: 'center',
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
      gap: spacing.md,
      padding: spacing.lg,
    },
    secondaryButton: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      minHeight: 52,
    },
    secondaryButtonText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 15,
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
