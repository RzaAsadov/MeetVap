import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '../components/PrimaryButton';
import { TextField } from '../components/TextField';
import { getLanguagePreferenceFlag, getLanguagePreferenceLabel, LANGUAGE_PREFERENCES, t } from '../i18n';
import { AccountLimitError } from '../lib/accountRegistry';
import { LoginAliasResolutionError, LoginHostUnavailableError } from '../lib/loginServerResolution';
import { containsMeetVapKeyword, isProhibitedMeetVapUsername } from '../lib/prohibitedNames';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Auth' | 'AddAccount'>;

// NEW: 'welcome' is the entry step shown before login/register.
type AuthMode = 'welcome' | 'login' | 'register';

export function AuthScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  useThemeColors();
  styles = createStyles();
  const language = useAppStore((state) => state.language);
  const languagePreference = useAppStore((state) => state.languagePreference);
  const checkRegistrationUsernameAvailability = useAppStore((state) => state.checkRegistrationUsernameAvailability);
  const signInWithPassword = useAppStore((state) => state.signInWithPassword);
  const registerWithPassword = useAppStore((state) => state.registerWithPassword);
  const setLanguagePreference = useAppStore((state) => state.setLanguagePreference);

  // CHANGED: mode now starts on 'welcome' instead of 'login'.
  const [mode, setMode] = useState<AuthMode>('welcome');
  const [registerStep, setRegisterStep] = useState<'credentials' | 'displayName'>('credentials');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordHidden, setPasswordHidden] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingUsername, setCheckingUsername] = useState(false);
  const [hasAcceptedTerms, setAcceptedTerms] = useState(false);
  const [isLanguageModalVisible, setLanguageModalVisible] = useState(false);
  const [unreachableHostname, setUnreachableHostname] = useState<string | null>(null);
  const [aliasResolutionError, setAliasResolutionError] = useState<LoginAliasResolutionError | null>(null);

  async function handleSubmit() {
    if (mode === 'register' && registerStep === 'credentials') {
      await handleRegisterCredentialsNext();
      return;
    }

    if (!username.trim() || !password.trim() || (mode === 'register' && !displayName.trim())) {
      Alert.alert(t('missingDetails'), t('fillRequiredFields'));
      return;
    }

    if (!hasAcceptedTerms) {
      Alert.alert(t('termsAcceptanceRequiredTitle'), t('termsAcceptanceRequiredDescription'));
      return;
    }

    if (mode === 'register' && username.trim().length < 6) {
      Alert.alert(t('usernameTooShort'), t('usernameMin6'));
      return;
    }

    if (mode === 'register' && containsMeetVapKeyword(displayName)) {
      Alert.alert(t('actionFailed'), t('meetvapNameProhibited'));
      return;
    }

    if (mode === 'register' && !isValidSignupPassword(password)) {
      Alert.alert(t('passwordTooWeak'), t('passwordSignupRule'));
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await signInWithPassword(username.trim(), password);
        if (route.name === 'AddAccount') {
          navigation.navigate('MainTabs');
        }
      } else {
        await registerWithPassword(displayName.trim(), normalizeUsername(username), password);
      }
    } catch (error) {
      if (error instanceof AccountLimitError) {
        Alert.alert(t('accountLimitTitle'), t('accountLimitReached'));
        return;
      }
      if (error instanceof LoginHostUnavailableError) {
        setUnreachableHostname(error.hostname);
        return;
      }
      if (error instanceof LoginAliasResolutionError) {
        setAliasResolutionError(error);
        return;
      }
      Alert.alert(t('authenticationFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegisterCredentialsNext() {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername || !password.trim()) {
      Alert.alert(t('missingDetails'), t('fillRequiredFields'));
      return;
    }

    if (!hasAcceptedTerms) {
      Alert.alert(t('termsAcceptanceRequiredTitle'), t('termsAcceptanceRequiredDescription'));
      return;
    }

    if (normalizedUsername.length < 6) {
      Alert.alert(t('usernameTooShort'), t('usernameMin6'));
      return;
    }

    if (normalizedUsername.length > 32 || !/^[a-z0-9_]+$/.test(normalizedUsername)) {
      Alert.alert(t('usernameInvalid'), t('usernameFormatRule'));
      return;
    }

    if (isProhibitedMeetVapUsername(normalizedUsername)) {
      Alert.alert(t('actionFailed'), t('meetvapNameProhibited'));
      return;
    }

    if (!isValidSignupPassword(password)) {
      Alert.alert(t('passwordTooWeak'), t('passwordSignupRule'));
      return;
    }

    setCheckingUsername(true);

    try {
      const result = await checkRegistrationUsernameAvailability(normalizedUsername);

      if (!result.available) {
        Alert.alert(t('usernameUnavailableTitle'), t('usernameUnavailableDescription'));
        return;
      }

      setUsername(result.username);
      setRegisterStep('displayName');
    } catch (error) {
      if (error instanceof LoginHostUnavailableError) {
        setUnreachableHostname(error.hostname);
        return;
      }
      Alert.alert(t('usernameAvailabilityCheckFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setCheckingUsername(false);
    }
  }

  function switchAuthMode() {
    setMode((current) => current === 'login' ? 'register' : 'login');
    setRegisterStep('credentials');
    setDisplayName('');
  }

  // NEW: navigate from the welcome step into register or login.
  function enterRegisterFromWelcome() {
    setRegisterStep('credentials');
    setDisplayName('');
    setMode('register');
  }

  function enterLoginFromWelcome() {
    setMode('login');
  }

  const isRegisterMode = mode === 'register';
  const isRegisterCredentialsStep = isRegisterMode && registerStep === 'credentials';
  const isRegisterDisplayNameStep = isRegisterMode && registerStep === 'displayName';
  const subtitle = isRegisterCredentialsStep
    ? t('signupCredentialsSubtitle')
    : isRegisterDisplayNameStep
      ? t('signupDisplayNameSubtitle')
      : t('signInToContinue');
  const primaryButtonTitle = isCheckingUsername
    ? t('checkingUsername')
    : isSubmitting
      ? t('pleaseWait')
      : isRegisterCredentialsStep
        ? t('continue')
        : mode === 'login'
          ? t('signIn')
          : t('register');

  function scrollToFocusedField(y: number) {
    setTimeout(() => {
      scrollRef.current?.scrollTo({ animated: true, y });
    }, 120);
  }

  // Shared language-picker modal, used by both the welcome step and the login/register form.
  function renderLanguageModal() {
    return (
      <Modal animationType="fade" transparent visible={isLanguageModalVisible} onRequestClose={() => setLanguageModalVisible(false)}>
        <Pressable onPress={() => setLanguageModalVisible(false)} style={styles.modalBackdrop}>
          <Pressable style={styles.languageModal}>
            <Text style={styles.modalTitle}>{t('language')}</Text>
            {LANGUAGE_PREFERENCES.map((preference) => (
              <Pressable
                key={preference}
                onPress={() => {
                  void setLanguagePreference(preference);
                  setLanguageModalVisible(false);
                }}
                style={styles.languageOption}
              >
                <View style={styles.languageOptionLabel}>
                  <Text style={styles.languageOptionFlag}>{getLanguagePreferenceFlag(preference)}</Text>
                  <Text style={styles.languageOptionText}>{getLanguagePreferenceLabel(preference)}</Text>
                </View>
                {languagePreference === preference ? <Ionicons color={colors.primary} name="checkmark" size={22} /> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  // NEW: the welcome step shown before login/register.
  if (mode === 'welcome') {
    return (
      <View style={styles.welcomeScreen}>
        <View style={[styles.welcomeHeader, { paddingTop: insets.top + spacing.md }]}>
          <Pressable accessibilityLabel={t('language')} onPress={() => setLanguageModalVisible(true)} style={styles.headerLanguageButton}>
            <Ionicons color={colors.white} name="language-outline" size={22} />
          </Pressable>
        </View>

        <View style={styles.welcomeBody}>
          <View style={styles.welcomeBrand}>
            <Image source={require('../../assets/splash-icon.png')} style={styles.welcomeLogo} />
            <Text style={styles.welcomeBrandText}>MeetVap</Text>
          </View>

          <View style={styles.welcomeCopy}>
            <Text style={styles.welcomeTitle}>{t('welcomeHeroTitle')}</Text>
            <Text style={styles.welcomeSubtitle}>{t('welcomeHeroSubtitle')}</Text>
          </View>
        </View>

        <View style={[styles.welcomeActions, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <PrimaryButton onPress={enterRegisterFromWelcome} title={t('welcomeNewUserCta')} />
          <Pressable onPress={enterLoginFromWelcome} style={styles.welcomeSecondaryButton}>
            <Text style={styles.welcomeSecondaryText}>{t('welcomeExistingUserCta')}</Text>
          </Pressable>
        </View>

        {renderLanguageModal()}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
      style={styles.screen}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, spacing.xl) + 148 }]}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            <Pressable accessibilityLabel={t('back')} onPress={() => setMode('welcome')} style={styles.headerBackButton}>
              <Ionicons color={colors.white} name="chevron-back" size={22} />
            </Pressable>
            <Text numberOfLines={2} style={styles.title}>{mode === 'login' ? t('welcomeBack') : t('createAccount')}</Text>
            <Pressable accessibilityLabel={t('language')} onPress={() => setLanguageModalVisible(true)} style={styles.headerLanguageButton}>
              <Ionicons color={colors.white} name="language-outline" size={22} />
            </Pressable>
          </View>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>

        <View style={styles.form}>
          {isRegisterMode ? (
            <View style={styles.stepProgress}>
              <View style={[styles.stepDot, styles.stepDotActive]} />
              <View style={[styles.stepLine, isRegisterDisplayNameStep ? styles.stepLineActive : undefined]} />
              <View style={[styles.stepDot, isRegisterDisplayNameStep ? styles.stepDotActive : undefined]} />
            </View>
          ) : null}

          {isRegisterDisplayNameStep ? (
            <>
              <View style={styles.infoPanel}>
                <View style={styles.infoIcon}>
                  <Ionicons color={colors.primary} name="id-card-outline" size={22} />
                </View>
                <View style={styles.infoTextBlock}>
                  <Text style={styles.infoTitle}>{t('signupDisplayNameInfoTitle')}</Text>
                  <Text style={styles.infoBody}>{t('signupDisplayNameInfoBody')}</Text>
                </View>
              </View>
              <TextField
                label={t('displayName')}
                onChangeText={setDisplayName}
                onFocus={() => scrollToFocusedField(270)}
                placeholder={t('yourName')}
                value={displayName}
              />
            </>
          ) : (
            <>
              {isRegisterMode ? (
                <View style={styles.infoPanel}>
                  <View style={styles.infoIcon}>
                    <Ionicons color={colors.primary} name="lock-closed-outline" size={22} />
                  </View>
                  <View style={styles.infoTextBlock}>
                    <Text style={styles.infoTitle}>{t('signupUsernameInfoTitle')}</Text>
                    <Text style={styles.infoBody}>{t('signupUsernameInfoBody')}</Text>
                  </View>
                </View>
              ) : null}
              <TextField
                autoCapitalize="none"
                label={t('username')}
                onChangeText={setUsername}
                onFocus={() => scrollToFocusedField(isRegisterMode ? 250 : 160)}
                placeholder={t('username')}
                value={username}
              />
              <View style={styles.passwordField}>
                <Text style={styles.passwordLabel}>{t('password')}</Text>
                <View style={styles.passwordInputWrap}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setPassword}
                    onFocus={() => scrollToFocusedField(isRegisterMode ? 330 : 240)}
                    placeholder={t('password')}
                    placeholderTextColor={colors.mutedText}
                    secureTextEntry={isPasswordHidden}
                    style={styles.passwordInput}
                    textContentType="password"
                    value={password}
                  />
                  <Pressable
                    onPress={() => setPasswordHidden((current) => !current)}
                    style={({ pressed }) => [styles.eyeButton, pressed && styles.eyeButtonPressed]}
                  >
                    <Ionicons color={colors.textSecondary} name={isPasswordHidden ? 'eye-outline' : 'eye-off-outline'} size={22} />
                  </Pressable>
                </View>
                {mode === 'register' ? (
                  <Text style={styles.passwordHint}>{t('passwordSignupHint')}</Text>
                ) : null}
              </View>
            </>
          )}
          {!isRegisterDisplayNameStep ? (
            <Pressable onPress={() => setAcceptedTerms((current) => !current)} style={styles.termsRow}>
              <Ionicons color={hasAcceptedTerms ? colors.primary : colors.textSecondary} name={hasAcceptedTerms ? 'checkbox' : 'square-outline'} size={23} />
              <Text style={styles.termsText}>
                {t('termsAcceptancePrefix')}{' '}
                <Text onPress={() => void Linking.openURL(`https://meetvap.com/terms?lang=${language}`)} style={styles.termsLink}>{t('termsOfUse')}</Text>
              </Text>
            </Pressable>
          ) : null}
          <PrimaryButton
            disabled={isSubmitting || isCheckingUsername || !hasAcceptedTerms}
            onPress={handleSubmit}
            title={primaryButtonTitle}
          />
          {isRegisterDisplayNameStep ? (
            <Pressable onPress={() => setRegisterStep('credentials')} style={styles.secondaryInlineButton}>
              <Ionicons color={colors.primary} name="chevron-back" size={17} />
              <Text style={styles.secondaryInlineText}>{t('back')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={switchAuthMode}>
            <Text style={styles.switchText}>
              {mode === 'login' ? t('needAccountRegister') : t('alreadyRegisteredSignIn')}
            </Text>
          </Pressable>
          <View style={styles.authBrand}>
            <Text style={styles.authBrandText}>MeetVap</Text>
            <Image source={require('../../assets/splash-icon.png')} style={styles.authBrandLogo} />
          </View>
        </View>
      </ScrollView>

      {renderLanguageModal()}
      <Modal animationType="fade" transparent visible={!!unreachableHostname} onRequestClose={() => setUnreachableHostname(null)}>
        <View style={styles.hostModalBackdrop}>
          <View style={styles.hostModal}>
            <View style={styles.hostModalIcon}>
              <Ionicons color={colors.danger} name="cloud-offline-outline" size={30} />
            </View>
            <Text style={styles.modalTitle}>{t('serverNotReachable')}</Text>
            <Text style={styles.hostModalBody}>{t('loginHostNotReachable')}</Text>
            <Text selectable style={styles.hostModalHostname}>{unreachableHostname}</Text>
            <View style={styles.hostModalActions}>
              <Pressable onPress={() => setUnreachableHostname(null)} style={styles.hostModalSecondary}>
                <Text style={styles.hostModalSecondaryText}>{t('close')}</Text>
              </Pressable>
              <Pressable onPress={() => { setUnreachableHostname(null); void handleSubmit(); }} style={styles.hostModalPrimary}>
                <Ionicons color={colors.white} name="refresh" size={18} />
                <Text style={styles.hostModalPrimaryText}>{t('retry')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal animationType="fade" transparent visible={!!aliasResolutionError} onRequestClose={() => setAliasResolutionError(null)}>
        <View style={styles.hostModalBackdrop}>
          <View style={styles.hostModal}>
            <View style={styles.hostModalIcon}>
              <Ionicons color={colors.danger} name="globe-outline" size={30} />
            </View>
            <Text style={styles.modalTitle}>{t('serverAliasNotFound')}</Text>
            <Text style={styles.hostModalBody}>{aliasResolutionError?.message}</Text>
            <Text selectable style={styles.hostModalHostname}>@{aliasResolutionError?.alias}</Text>
            <View style={styles.hostModalActions}>
              <Pressable onPress={() => setAliasResolutionError(null)} style={styles.hostModalSecondary}>
                <Text style={styles.hostModalSecondaryText}>{t('editUsername')}</Text>
              </Pressable>
              <Pressable onPress={() => { setAliasResolutionError(null); void handleSubmit(); }} style={styles.hostModalPrimary}>
                <Ionicons color={colors.white} name="refresh" size={18} />
                <Text style={styles.hostModalPrimaryText}>{t('retry')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function isValidSignupPassword(value: string) {
  return value.length >= 7 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function createStyles() {
  return StyleSheet.create({
    hostModal: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: spacing.md, maxWidth: 420, padding: spacing.xl, width: '100%' },
    hostModalActions: { flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end', marginTop: spacing.sm },
    hostModalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'center', padding: spacing.xl },
    hostModalBody: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    hostModalHostname: { backgroundColor: colors.appBackground, borderColor: colors.border, borderRadius: 8, borderWidth: 1, color: colors.textPrimary, fontSize: 14, padding: spacing.md, textAlign: 'center' },
    hostModalIcon: { alignItems: 'center', alignSelf: 'center', backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 },
    hostModalPrimary: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 8, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.lg },
    hostModalPrimaryText: { color: colors.white, fontSize: 15, fontWeight: '800' },
    hostModalSecondary: { alignItems: 'center', borderColor: colors.border, borderRadius: 8, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.lg },
    hostModalSecondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
    authBrand: {
      alignItems: 'center',
      flex: 1,
      gap: spacing.sm,
      justifyContent: 'center',
      minHeight: 178,
    },
    authBrandLogo: {
      height: 129,
      resizeMode: 'contain',
      width: 129,
    },
    authBrandText: {
      color: colors.textPrimary,
      fontSize: 24,
      fontWeight: '900',
    },
    eyeButton: {
      alignItems: 'center',
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      marginRight: spacing.sm,
      width: 36,
    },
    eyeButtonPressed: {
      backgroundColor: colors.border,
    },
    form: {
      flex: 1,
      gap: spacing.lg,
      padding: spacing.xl,
    },
    header: {
      backgroundColor: colors.chatHeader,
      gap: spacing.sm,
      paddingBottom: spacing.xl,
      paddingHorizontal: spacing.xl,
      paddingTop: 76,
    },
    headerBackButton: {
      alignItems: 'center',
      borderRadius: 16,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    headerLanguageButton: {
      alignItems: 'center',
      borderRadius: 16,
      height: 40,
      justifyContent: 'center',
      width: 40,
    },
    headerTitleRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
    },
    infoBody: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
    infoIcon: {
      alignItems: 'center',
      backgroundColor: 'rgba(59, 154, 245, 0.12)',
      borderRadius: 18,
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    infoPanel: {
      alignItems: 'flex-start',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 20,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.md,
      padding: spacing.lg,
    },
    infoTextBlock: {
      flex: 1,
      gap: spacing.xs,
    },
    infoTitle: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '900',
    },
    languageModal: {
      backgroundColor: colors.surface,
      borderRadius: 22,
      maxWidth: 420,
      padding: spacing.lg,
      width: '86%',
    },
    languageOption: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 48,
      paddingVertical: spacing.sm,
    },
    languageOptionFlag: {
      fontSize: 20,
    },
    languageOptionLabel: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    languageOptionText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    modalBackdrop: {
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.42)',
      flex: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '900',
      marginBottom: spacing.sm,
    },
    passwordField: {
      gap: spacing.sm,
    },
    passwordInput: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 16,
      minHeight: 54,
      paddingLeft: spacing.md,
    },
    passwordInputWrap: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      overflow: 'hidden',
    },
    passwordLabel: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginLeft: spacing.xs,
    },
    passwordHint: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 17,
      marginLeft: spacing.xs,
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
    },
    secondaryInlineButton: {
      alignItems: 'center',
      alignSelf: 'center',
      borderRadius: 18,
      flexDirection: 'row',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    secondaryInlineText: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '800',
    },
    stepDot: {
      backgroundColor: colors.border,
      borderRadius: 7,
      height: 14,
      width: 14,
    },
    stepDotActive: {
      backgroundColor: colors.primary,
    },
    stepLine: {
      backgroundColor: colors.border,
      flex: 1,
      height: 3,
    },
    stepLineActive: {
      backgroundColor: colors.primary,
    },
    stepProgress: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.xl,
    },
    subtitle: {
      color: '#d9f3ee',
      fontSize: 14,
    },
    switchText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
    },
    termsLink: {
      color: colors.primary,
      fontWeight: '800',
    },
    termsRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    termsText: {
      color: colors.textSecondary,
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
    },
    title: {
      color: colors.white,
      flex: 1,
      fontSize: 32,
      fontWeight: '800',
      textAlign: 'center',
    },

    // ---- NEW: welcome step styles ----
    welcomeScreen: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
    welcomeHeader: {
      alignItems: 'flex-end',
      paddingHorizontal: spacing.xl,
    },
    welcomeBody: {
      alignItems: 'center',
      flex: 1,
      gap: 40,
      justifyContent: 'center',
      paddingHorizontal: spacing.xl,
    },
    welcomeBrand: {
      alignItems: 'center',
      gap: spacing.md,
    },
    welcomeLogo: {
      height: 108,
      resizeMode: 'contain',
      width: 108,
    },
    welcomeBrandText: {
      color: colors.textPrimary,
      fontSize: 26,
      fontWeight: '900',
    },
    welcomeCopy: {
      alignItems: 'center',
      gap: spacing.sm,
    },
    welcomeTitle: {
      color: colors.textPrimary,
      fontSize: 28,
      fontWeight: '900',
      textAlign: 'center',
    },
    welcomeSubtitle: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      maxWidth: 320,
      textAlign: 'center',
    },
    welcomeActions: {
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
      paddingTop: spacing.lg,
    },
    welcomeSecondaryButton: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 54,
      paddingHorizontal: spacing.lg,
    },
    welcomeSecondaryText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
  });
}

let styles = createStyles();
