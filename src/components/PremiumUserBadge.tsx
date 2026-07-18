import { Ionicons } from '@expo/vector-icons';
import { StyleProp, TextStyle } from 'react-native';

type PremiumUserBadgeProps = {
  size?: number;
  style?: StyleProp<TextStyle>;
};

export function PremiumUserBadge({ size = 18, style }: PremiumUserBadgeProps) {
  return <Ionicons color="#3b82f6" name="star" size={size} style={style} />;
}
