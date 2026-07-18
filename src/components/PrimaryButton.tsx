import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { useAppStore } from '../store/useAppStore';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
};

export function PrimaryButton({ title, onPress, disabled }: Props) {
  useThemeColors();
  styles = createStyles();
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={isDarkMode ? [colors.primary, colors.primaryDark] : [colors.primaryDark, colors.primary, colors.secondary]}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={styles.gradient}
      >
        <Text style={styles.title}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

function createStyles() {
  return StyleSheet.create({
  button: {
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  disabled: {
    opacity: 0.5,
  },
  gradient: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  title: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
}

let styles = createStyles();
