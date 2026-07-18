import { useMemo } from 'react';

import { useAppStore } from '../store/useAppStore';
import { colors, darkColors, lightColors } from './colors';

export function useThemeColors() {
  const isDarkMode = useAppStore((state) => state.isDarkMode);

  return useMemo(() => {
    Object.assign(colors, isDarkMode ? darkColors : lightColors);
    return colors;
  }, [isDarkMode]);
}
