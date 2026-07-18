import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import {
  isBackgroundLocationDisclosureRequested,
  respondToBackgroundLocationDisclosure,
  subscribeToBackgroundLocationDisclosure,
} from '../lib/backgroundLocationDisclosure';
import { reconcileBackgroundLocationAccess } from '../lib/liveLocation';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';

const DISCLOSURE_DISMISS_DELAY_MS = 250;

export function BackgroundLocationDisclosureBridge({ enabled }: { enabled: boolean }) {
  useThemeColors();
  styles = createStyles();
  useAppStore((state) => state.language);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [isVisible, setVisible] = useState(isBackgroundLocationDisclosureRequested());

  useEffect(() => subscribeToBackgroundLocationDisclosure(() => {
    setVisible(isBackgroundLocationDisclosureRequested());
  }), []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void reconcileBackgroundLocationAccess().catch(() => undefined);
  }, [enabled]);

  function respond(didConsent: boolean) {
    setVisible(false);
    setTimeout(() => respondToBackgroundLocationDisclosure(didConsent), DISCLOSURE_DISMISS_DELAY_MS);
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => respond(false)}
      statusBarTranslucent
      transparent
      visible={isVisible}
    >
      <Pressable
        onPress={() => respond(false)}
        style={[
          styles.backdrop,
          {
            paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.lg),
            paddingTop: Math.max(spacing.xl, insets.top + spacing.lg),
          },
        ]}
      >
        <Pressable
          accessibilityRole="alert"
          onPress={() => undefined}
          style={[
            styles.card,
            { maxHeight: Math.max(360, windowHeight - insets.top - insets.bottom - spacing.xl * 2) },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator
            style={styles.body}
          >
            <View style={styles.icon}>
              <Ionicons color={colors.primary} name="location-outline" size={30} />
            </View>

            <View style={styles.heading}>
              <Text style={styles.title}>{t('backgroundLocationDisclosureTitle')}</Text>
              <Text style={styles.message}>{t('backgroundLocationDisclosureMessage')}</Text>
            </View>

            <View style={styles.featureList}>
              <DisclosureFeature icon="navigate-circle-outline" text={t('backgroundLocationDisclosureLiveLocationFeature')} />
              <DisclosureFeature icon="shield-checkmark-outline" text={t('backgroundLocationDisclosurePanicFeature')} />
            </View>

            <Text style={styles.privacy}>{t('backgroundLocationDisclosurePrivacy')}</Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable onPress={() => respond(false)} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>{t('notNow')}</Text>
            </Pressable>
            <Pressable onPress={() => respond(true)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t('backgroundLocationDisclosureAllow')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DisclosureFeature({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>
        <Ionicons color={colors.primary} name={icon} size={20} />
      </View>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(4,10,20,0.78)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  body: {
    flexShrink: 1,
    minHeight: 0,
  },
  bodyContent: {
    gap: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.lg,
    maxWidth: 460,
    padding: spacing.xl,
    width: '100%',
  },
  feature: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  featureIcon: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  featureList: {
    gap: spacing.sm,
  },
  featureText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 19,
  },
  heading: {
    gap: spacing.sm,
  },
  icon: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.primary,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  privacy: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 19,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 21,
    fontWeight: '900',
  },
});
}

let styles = createStyles();
