import { Ionicons } from '@expo/vector-icons';
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';

const DIGIT_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['empty', '0', 'backspace'],
] as const;

type PinPadProps = {
  disabled?: boolean;
  length?: number;
  onChange: (value: string) => void;
  value: string;
};

export const PinPad = memo(function PinPad({
  disabled = false,
  length = 4,
  onChange,
  value,
}: PinPadProps) {
  const themeColors = useThemeColors();
  const styles = useMemo(() => createStyles(), [
    themeColors.border,
    themeColors.chatBackground,
    themeColors.primary,
    themeColors.textPrimary,
  ]);
  const valueRef = useRef(value);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const pinSlots = useMemo(() => Array.from({ length }), [length]);
  const appendDigit = useCallback((digit: string) => {
    const currentValue = valueRef.current;

    if (disabled || currentValue.length >= length) {
      return;
    }

    const nextValue = `${currentValue}${digit}`;
    valueRef.current = nextValue;
    onChange(nextValue);
  }, [disabled, length, onChange]);

  const removeDigit = useCallback(() => {
    const currentValue = valueRef.current;

    if (disabled || currentValue.length === 0) {
      return;
    }

    const nextValue = currentValue.slice(0, -1);
    valueRef.current = nextValue;
    onChange(nextValue);
  }, [disabled, onChange]);

  return (
    <View style={styles.container}>
      <View style={styles.dotsRow}>
        {pinSlots.map((_, index) => {
          const filled = index < value.length;

          return <View key={index} style={[styles.dot, filled && styles.dotFilled]} />;
        })}
      </View>

      <View style={styles.keypad}>
        {DIGIT_ROWS.map((row, rowIndex) => (
          <View key={rowIndex} style={styles.keypadRow}>
            {row.map((key) => {
              if (key === 'empty') {
                return <View key={key} style={styles.keyPlaceholder} />;
              }

              if (key === 'backspace') {
                return (
                  <PinKey
                    key={key}
                    accessibilityLabel={t('backspace')}
                    disabled={disabled}
                    icon="backspace-outline"
                    onPress={removeDigit}
                    styles={styles}
                  />
                );
              }

              return (
                <PinKey
                  key={key}
                  disabled={disabled}
                  label={key}
                  onPress={() => appendDigit(key)}
                  styles={styles}
                />
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
});

PinPad.displayName = 'PinPad';

type PinPadStyles = ReturnType<typeof createStyles>;

const PinKey = memo(function PinKey({
  accessibilityLabel,
  disabled,
  icon,
  label,
  onPress,
  styles,
}: {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  label?: string;
  onPress: () => void;
  styles: PinPadStyles;
}) {
  const pressableStyle = useCallback(({ pressed }: { pressed: boolean }) => [
    styles.keyButton,
    disabled && styles.keyButtonDisabled,
    pressed && !disabled && styles.keyButtonPressed,
  ], [disabled, styles]);

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={pressableStyle}
    >
      {icon ? <Ionicons color={colors.textPrimary} name={icon} size={22} /> : <Text style={styles.keyText}>{label}</Text>}
    </Pressable>
  );
});

PinKey.displayName = 'PinKey';

function createStyles() {
  return StyleSheet.create({
    container: {
      gap: spacing.lg,
    },
    dot: {
      backgroundColor: colors.border,
      borderRadius: 9,
      height: 18,
      width: 18,
    },
    dotFilled: {
      backgroundColor: colors.primary,
    },
    dotsRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'center',
      minHeight: 24,
    },
    keyButton: {
      alignItems: 'center',
      backgroundColor: colors.chatBackground,
      borderRadius: 20,
      height: 64,
      justifyContent: 'center',
      width: 64,
    },
    keyButtonDisabled: {
      opacity: 0.5,
    },
    keyButtonPressed: {
      backgroundColor: colors.border,
    },
    keyPlaceholder: {
      height: 64,
      width: 64,
    },
    keyText: {
      color: colors.textPrimary,
      fontSize: 28,
      fontWeight: '800',
    },
    keypad: {
      gap: spacing.sm,
    },
    keypadRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
    },
  });
}
