import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ChangePassword'>;
type PasswordField = 'current' | 'new' | 'confirm';

export function ChangePasswordScreen({ navigation }: Props) {
  useThemeColors();
  styles = createStyles();
  const updatePassword = useAppStore((state) => state.updatePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [visibleFields, setVisibleFields] = useState<Record<PasswordField, boolean>>({
    confirm: false,
    current: false,
    new: false,
  });

  function toggleVisible(field: PasswordField) {
    setVisibleFields((current) => ({
      ...current,
      [field]: !current[field],
    }));
  }

  async function savePassword() {
    if (!currentPassword.trim()) {
      Alert.alert(t('currentPasswordNeeded'), t('enterCurrentPassword'));
      return;
    }

    if (newPassword.length < 8) {
      Alert.alert(t('passwordTooShort'), t('newPasswordMin8'));
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert(t('passwordsDoNotMatch'), t('confirmNewPasswordAgain'));
      return;
    }

    setSaving(true);

    try {
      await updatePassword({ currentPassword, newPassword });
      Alert.alert(t('passwordChanged'), t('passwordUpdated'), [
        { text: t('ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (error) {
      Alert.alert(t('passwordUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.screen}>
      <PasswordInput
        label={t('currentPassword')}
        onChangeText={setCurrentPassword}
        onToggleVisible={() => toggleVisible('current')}
        secureTextEntry={!visibleFields.current}
        value={currentPassword}
      />
      <PasswordInput
        label={t('newPassword')}
        onChangeText={setNewPassword}
        onToggleVisible={() => toggleVisible('new')}
        secureTextEntry={!visibleFields.new}
        value={newPassword}
      />
      <PasswordInput
        label={t('confirmNewPassword')}
        onChangeText={setConfirmPassword}
        onToggleVisible={() => toggleVisible('confirm')}
        secureTextEntry={!visibleFields.confirm}
        value={confirmPassword}
      />
      <PrimaryButton disabled={isSaving} onPress={() => void savePassword()} title={isSaving ? t('saving') : t('changePassword')} />
    </View>
  );
}

function PasswordInput({
  label,
  onChangeText,
  onToggleVisible,
  secureTextEntry,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  onToggleVisible: () => void;
  secureTextEntry: boolean;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          style={styles.input}
          textContentType="password"
          value={value}
        />
        <Pressable onPress={onToggleVisible} style={({ pressed }) => [styles.eyeButton, pressed && styles.eyeButtonPressed]}>
          <Ionicons color={colors.textSecondary} name={secureTextEntry ? 'eye-outline' : 'eye-off-outline'} size={22} />
        </Pressable>
      </View>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    eyeButton: {
      alignItems: 'center',
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    eyeButtonPressed: {
      backgroundColor: colors.border,
    },
    field: {
      gap: spacing.sm,
    },
    input: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 16,
      minHeight: 48,
      paddingLeft: spacing.md,
    },
    inputWrap: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      paddingRight: spacing.sm,
    },
    label: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '800',
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
      gap: spacing.lg,
      padding: spacing.lg,
    },
  });
}

let styles = createStyles();
