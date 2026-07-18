import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '../i18n';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';

type AttachmentAction = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  actions: AttachmentAction[];
};

export function AttachmentSheet({ actions, onClose, visible }: Props) {
  useThemeColors();
  styles = createStyles();
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.lg) }]}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('sendAttachment')}</Text>
          <View style={styles.grid}>
            {actions.map((action) => (
              <Pressable key={action.label} onPress={action.onPress} style={styles.action}>
                <View style={styles.iconCircle}>
                  <Ionicons color={colors.white} name={action.icon} size={24} />
                </View>
                <Text style={styles.actionLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles() {
  return StyleSheet.create({
  action: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    minWidth: 86,
  },
  actionLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    justifyContent: 'space-between',
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 4,
    width: 44,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
});
}

let styles = createStyles();
