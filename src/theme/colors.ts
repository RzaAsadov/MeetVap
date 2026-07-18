export const lightColors = {
  appBackground: '#f4f8ff',
  border: '#d4e0f2',
  chatBackground: '#edf4ff',
  chatHeader: '#1664d9',
  danger: '#c84f55',
  incomingBubble: '#ffffff',
  mutedText: '#7286a3',
  outgoingBubble: '#e4efff',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  secondary: '#60a5fa',
  surface: '#fdfefe',
  textPrimary: '#162235',
  textSecondary: '#5a6f8b',
  white: '#ffffff',
};

export const darkColors = {
  appBackground: '#0e1621',
  border: '#243447',
  chatBackground: '#0b141a',
  chatHeader: '#111f2c',
  danger: '#f15b5b',
  incomingBubble: '#182533',
  mutedText: '#8ba1b8',
  outgoingBubble: '#0f3b57',
  primary: '#45a3ff',
  primaryDark: '#82c4ff',
  secondary: '#2bb8ff',
  surface: '#162232',
  textPrimary: '#edf5ff',
  textSecondary: '#b4c4d6',
  white: '#ffffff',
};

export type ThemeColors = typeof lightColors;

export const colors: ThemeColors = { ...lightColors };
