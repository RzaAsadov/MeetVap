import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useState } from 'react';

import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';

const meetVapLogo = require('../../assets/icon.png');
const MEETVAP_LOGO_URI = 'meetvap://logo';

type Props = {
  label?: string | null;
  onPress?: () => void;
  size?: number;
  uri?: string | null;
};

export function Avatar({ label, onPress, size = 48, uri }: Props) {
  useThemeColors();
  styles = createStyles();
  const [hasImageError, setImageError] = useState(false);
  const initial = label?.trim().slice(0, 1).toUpperCase() || '?';
  const shouldUseMeetVapLogo = uri === MEETVAP_LOGO_URI;
  const shouldShowImage = shouldUseMeetVapLogo || (!!uri && !hasImageError);

  useEffect(() => {
    setImageError(false);
  }, [uri]);

  const content = (
    <View style={[styles.avatar, { height: size, width: size, borderRadius: size / 2 }]}>
      {shouldShowImage ? (
        <Image
          onError={() => setImageError(true)}
          source={shouldUseMeetVapLogo ? meetVapLogo : { uri: uri ?? '' }}
          style={[styles.image, { height: size, width: size, borderRadius: size / 2 }]}
        />
      ) : (
        <Text style={[styles.label, { fontSize: size * 0.42 }]}>{initial}</Text>
      )}
    </View>
  );

  if (onPress) {
    return <Pressable onPress={onPress}>{content}</Pressable>;
  }

  return content;
}

function createStyles() {
  return StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    backgroundColor: colors.border,
  },
  label: {
    color: colors.white,
    fontWeight: '700',
  },
});
}

let styles = createStyles();
