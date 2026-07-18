import { Ionicons } from '@expo/vector-icons';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import type { WebView as WebViewType } from 'react-native-webview';

import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';

export function CatalogScreen() {
  useThemeColors();
  styles = createStyles();
  const navigation = useNavigation();
  const user = useAppStore((state) => state.user);
  const serverCatalogUrl = useAppStore((state) => state.catalogUrl);
  const catalogUrlLoadError = useAppStore((state) => state.catalogUrlLoadError);
  const isLoadingCatalogUrl = useAppStore((state) => state.isLoadingCatalogUrl);
  const loadCatalogUrl = useAppStore((state) => state.loadCatalogUrl);
  const webViewRef = useRef<WebViewType>(null);
  const [isLoading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [hasRequestedCatalogUrl, setHasRequestedCatalogUrl] = useState(false);
  const [webViewUrl, setWebViewUrl] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const catalogUrl = useMemo(() => buildCatalogUrl(serverCatalogUrl, user?.id), [serverCatalogUrl, user?.id]);

  useEffect(() => {
    setHasRequestedCatalogUrl(true);
    void loadCatalogUrl().catch(() => undefined);
  }, [loadCatalogUrl]);

  useLayoutEffect(() => {
    if (!catalogUrl) {
      return;
    }

    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityLabel={t('openCatalogStartPage')}
          onPress={() => {
            setHasError(false);
            setLoading(true);
            setWebViewUrl(catalogUrl);
            setReloadKey((prev) => prev + 1);
            webViewRef.current?.stopLoading();
          }}
          style={styles.headerButton}
        >
          <Ionicons color={colors.white} name="grid-outline" size={20} />
        </Pressable>
      ),
      headerTitle: '',
    });
  }, [catalogUrl, navigation]);

  useLayoutEffect(() => {
    setWebViewUrl(catalogUrl);
  }, [catalogUrl]);

  function retry() {
    setHasError(false);
    setLoading(true);
    if (catalogUrl) {
      setWebViewUrl(catalogUrl);
      setReloadKey((prev) => prev + 1);
    }
    webViewRef.current?.reload();
  }

  if (!catalogUrl && (!hasRequestedCatalogUrl || isLoadingCatalogUrl)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!catalogUrl && catalogUrlLoadError) {
    return (
      <View style={styles.centered}>
        <Ionicons color={colors.textSecondary} name="cloud-offline-outline" size={42} />
        <Text style={styles.errorTitle}>{t('catalogLoadFailed')}</Text>
        <Pressable onPress={() => void loadCatalogUrl().catch(() => undefined)} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>{t('retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (!catalogUrl) {
    return (
      <View style={styles.centered}>
        <Ionicons color={colors.textSecondary} name="grid-outline" size={42} />
        <Text style={styles.errorTitle}>{t('catalogUnavailable')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <WebView
        key={reloadKey}
        ref={webViewRef}
        allowsBackForwardNavigationGestures
        onError={() => {
          setHasError(true);
          setLoading(false);
        }}
        onHttpError={() => {
          setHasError(true);
          setLoading(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onLoadStart={() => {
          setHasError(false);
          setLoading(true);
        }}
        pullToRefreshEnabled
        source={{ uri: webViewUrl ?? catalogUrl ?? '' }}
        startInLoadingState={false}
        style={styles.webView}
      />
      {isLoading && !hasError ? (
        <View pointerEvents="none" style={styles.loadingOverlay}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      {hasError ? (
        <View style={styles.errorOverlay}>
          <Ionicons color={colors.textSecondary} name="cloud-offline-outline" size={44} />
          <Text style={styles.errorTitle}>{t('catalogLoadFailed')}</Text>
          <Pressable onPress={retry} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>{t('retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function buildCatalogUrl(baseUrl?: string | null, userId?: string) {
  if (!baseUrl || !userId) {
    return null;
  }

  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}id=${encodeURIComponent(userId)}`;
}

let styles = createStyles();

function createStyles() {
  return StyleSheet.create({
    centered: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      flex: 1,
      gap: spacing.md,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    errorOverlay: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      bottom: 0,
      gap: spacing.md,
      justifyContent: 'center',
      left: 0,
      padding: spacing.xl,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    headerButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 6,
      marginRight: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    errorTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '900',
      textAlign: 'center',
    },
    loadingOverlay: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.08)',
      bottom: 0,
      justifyContent: 'center',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    retryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 14,
      minHeight: 44,
      minWidth: 116,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    retryButtonText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '900',
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
    webView: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
  });
}
