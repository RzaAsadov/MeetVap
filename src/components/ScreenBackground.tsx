import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function ScreenBackground({ children, style }: Props) {
  useThemeColors();
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  if (isDarkMode) {
    return <View style={[styles.fill, { backgroundColor: colors.appBackground }, style]}>{children}</View>;
  }

  return (
    <LinearGradient
      colors={['#fcfeff', '#eef4ff', '#e5efff']}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[styles.fill, style]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
