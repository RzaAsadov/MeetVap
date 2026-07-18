import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { getStoredVoiceCallTipDismissed, setStoredVoiceCallTipDismissed } from '../lib/storage';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';

type Resolver = () => void;

export function useVoiceCallTip(userId?: string | null) {
  const resolverRef = useRef<Resolver | null>(null);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const [isVisible, setVisible] = useState(false);

  const closeTip = useCallback(async () => {
    if (userId && doNotShowAgain) {
      await setStoredVoiceCallTipDismissed(userId).catch(() => undefined);
    }

    setVisible(false);
    setDoNotShowAgain(false);
    resolverRef.current?.();
    resolverRef.current = null;
  }, [doNotShowAgain, userId]);

  const showVoiceCallTip = useCallback(async () => {
    if (isVisible || !userId || (await getStoredVoiceCallTipDismissed(userId))) {
      return;
    }

    await new Promise<void>((resolve) => {
      resolverRef.current = resolve;
      setDoNotShowAgain(false);
      setVisible(true);
    });
  }, [isVisible, userId]);

  const voiceCallTipModal = (
    <Modal animationType="fade" transparent visible={isVisible} onRequestClose={() => void closeTip()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons color={colors.white} name="sparkles-outline" size={30} />
          </View>
          <Text style={styles.title}>{t('voiceCallTipTitle')}</Text>
          <Text style={styles.body}>{t('voiceCallTipBody')}</Text>
          <Pressable onPress={() => setDoNotShowAgain((value) => !value)} style={styles.checkboxRow}>
            <View style={[styles.checkbox, doNotShowAgain && styles.checkboxChecked]}>
              {doNotShowAgain ? <Ionicons color={colors.white} name="checkmark" size={16} /> : null}
            </View>
            <Text style={styles.checkboxText}>{t('doNotShowAgain')}</Text>
          </Pressable>
          <Pressable onPress={() => void closeTip()} style={styles.button}>
            <Text style={styles.buttonText}>{t('gotIt')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  return { showVoiceCallTip, voiceCallTipModal };
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 13,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
    maxWidth: 360,
    padding: spacing.xl,
    width: '100%',
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 5,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  checkboxText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
  },
});
