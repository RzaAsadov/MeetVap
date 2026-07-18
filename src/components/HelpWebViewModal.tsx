import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebView as WebViewType } from 'react-native-webview';

import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

type Props = {
  callFrom?: string;
  onClose: () => void;
  visible: boolean;
};

export function HelpWebViewModal({ callFrom, onClose, visible }: Props) {
  const user = useAppStore((state) => state.user);
  const language = useAppStore((state) => state.language);
  const helpUrl = useAppStore((state) => state.helpUrl);
  const helpUrlLoadError = useAppStore((state) => state.helpUrlLoadError);
  const isLoadingHelpUrl = useAppStore((state) => state.isLoadingHelpUrl);
  const loadHelpUrl = useAppStore((state) => state.loadHelpUrl);
  const webViewRef = useRef<WebViewType>(null);
  const [isLoadingPage, setLoadingPage] = useState(true);
  const [hasPageError, setPageError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [unixTimestamp, setUnixTimestamp] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!visible) {
      return;
    }

    setUnixTimestamp(Math.floor(Date.now() / 1000));
    setLoadingPage(true);
    setPageError(false);
    setReloadKey((current) => current + 1);
    void loadHelpUrl().catch(() => undefined);
  }, [loadHelpUrl, visible]);

  const webViewUrl = useMemo(() => {
    if (!helpUrl || !user?.id) {
      return null;
    }

    const params = [
      ['userid', user.id],
      ['unix_timestamp', String(unixTimestamp)],
      ['lang', language],
    ];

    if (callFrom) {
      params.push(['call_from', callFrom]);
    }

    const separator = helpUrl.includes('?') ? '&' : '?';
    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');

    return `${helpUrl}${separator}${query}`;
  }, [callFrom, helpUrl, language, unixTimestamp, user?.id]);

  function retry() {
    setPageError(false);
    setLoadingPage(true);
    setUnixTimestamp(Math.floor(Date.now() / 1000));
    setReloadKey((current) => current + 1);

    if (!helpUrl) {
      void loadHelpUrl().catch(() => undefined);
      return;
    }

    webViewRef.current?.reload();
  }

  const shouldShowConfigLoading = !webViewUrl && isLoadingHelpUrl && !helpUrlLoadError;
  const shouldShowConfigError = !webViewUrl && !isLoadingHelpUrl;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.webFrame}>
            {webViewUrl ? (
              <>
                <WebView
                  key={reloadKey}
                  ref={webViewRef}
                  onError={() => {
                    setPageError(true);
                    setLoadingPage(false);
                  }}
                  onHttpError={() => {
                    setPageError(true);
                    setLoadingPage(false);
                  }}
                  onLoadEnd={() => setLoadingPage(false)}
                  onLoadStart={() => {
                    setPageError(false);
                    setLoadingPage(true);
                  }}
                  source={{ uri: webViewUrl }}
                  startInLoadingState={false}
                  style={styles.webView}
                />
                {isLoadingPage && !hasPageError ? (
                  <View pointerEvents="none" style={styles.loadingOverlay}>
                    <ActivityIndicator color={colors.primary} />
                  </View>
                ) : null}
                {hasPageError ? (
                  <View style={styles.errorOverlay}>
                    <Ionicons color={colors.textSecondary} name="cloud-offline-outline" size={42} />
                    <Text style={styles.errorTitle}>{t('helpIntroLoadFailed', {}, language)}</Text>
                    <Pressable onPress={retry} style={styles.retryButton}>
                      <Text style={styles.retryButtonText}>{t('retry', {}, language)}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
            {shouldShowConfigLoading ? (
              <View style={styles.errorOverlay}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
            {shouldShowConfigError ? (
              <View style={styles.errorOverlay}>
                <Ionicons color={colors.textSecondary} name="help-circle-outline" size={42} />
                <Text style={styles.errorTitle}>{t('helpIntroUnavailable', {}, language)}</Text>
                <Pressable onPress={retry} style={styles.retryButton}>
                  <Text style={styles.retryButtonText}>{t('retry', {}, language)}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          <Pressable onPress={onClose} style={({ pressed }) => [styles.closeButton, pressed && styles.buttonPressed]}>
            <Ionicons color={colors.white} name="close-outline" size={21} />
            <Text style={styles.closeButtonText}>{t('close', {}, language)}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 7, 18, 0.72)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    height: '82%',
    maxHeight: 720,
    maxWidth: 430,
    overflow: 'hidden',
    padding: spacing.md,
    width: '100%',
  },
  closeButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: 16,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  closeButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  errorOverlay: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    bottom: 0,
    gap: spacing.md,
    justifyContent: 'center',
    left: 0,
    padding: spacing.lg,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 17,
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
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 116,
    paddingHorizontal: spacing.lg,
  },
  retryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  webFrame: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    overflow: 'hidden',
  },
  webView: {
    backgroundColor: colors.appBackground,
    flex: 1,
  },
});
