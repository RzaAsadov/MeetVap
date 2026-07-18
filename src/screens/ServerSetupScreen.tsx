import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { PrimaryButton } from '../components/PrimaryButton';
import { TextField } from '../components/TextField';
import { t } from '../i18n';
import { validateServerUrl } from '../lib/api';
import { DEFAULT_SERVER_URL } from '../lib/storage';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ServerSetup'>;

export function ServerSetupScreen({ navigation }: Props) {
  useThemeColors();
  styles = createStyles();
  const saveServerUrl = useAppStore((state) => state.saveServerUrl);
  const currentServerUrl = useAppStore((state) => state.serverUrl);
  const [serverUrl, setServerUrl] = useState(currentServerUrl ?? DEFAULT_SERVER_URL);
  const [isSaving, setIsSaving] = useState(false);

  async function handleContinue() {
    setIsSaving(true);

    try {
      const normalizedUrl = await validateServerUrl(serverUrl);
      await saveServerUrl(normalizedUrl);
      if (navigation.canGoBack()) {
        navigation.goBack();
      }
    } catch (error) {
      Alert.alert(t('serverNotReachable'), error instanceof Error ? error.message : t('pleaseCheckUrl'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.select({ ios: 'padding' })} style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.brand}>MeetVap</Text>
        <Text style={styles.subtitle}>{t('serverSetupSubtitle')}</Text>
      </View>

      <View style={styles.card}>
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          label={t('serverUrl')}
          onChangeText={setServerUrl}
          placeholder="https://chat.example.com"
          value={serverUrl}
        />
        <PrimaryButton
          disabled={!serverUrl.trim() || isSaving}
          onPress={handleContinue}
          title={isSaving ? t('checkingServer') : t('continue')}
        />
        <Text style={styles.hint}>{t('serverSetupHint')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles() {
  return StyleSheet.create({
  brand: {
    color: colors.white,
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  card: {
    backgroundColor: colors.appBackground,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    flex: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  hero: {
    backgroundColor: colors.chatHeader,
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.xl,
    paddingTop: 84,
  },
  hint: {
    color: colors.mutedText,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  screen: {
    backgroundColor: colors.chatHeader,
    flex: 1,
  },
  subtitle: {
    color: '#d9f3ee',
    fontSize: 16,
    lineHeight: 23,
  },
});
}

let styles = createStyles();
