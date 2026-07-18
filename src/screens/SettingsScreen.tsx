import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, InputAccessoryView, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { PinPad } from '../components/PinPad';
import { PremiumUserBadge } from '../components/PremiumUserBadge';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenBackground } from '../components/ScreenBackground';
import { AppLanguage, getLanguagePreferenceFlag, getLanguagePreferenceLabel, LANGUAGE_PREFERENCES, t } from '../i18n';
import { uploadMediaFile } from '../lib/backend';
import { requestLiveLocationPermissions } from '../lib/liveLocation';
import { containsMeetVapKeyword, isProhibitedMeetVapUsername } from '../lib/prohibitedNames';
import { addSecurityEventListener } from '../lib/securityEvents';
import { clearStoredErasePin, clearStoredErasePinAlertConfig, clearStoredLockPin, getStoredErasePin, getStoredErasePinAlertConfig, getStoredErasePinDeletePeers, getStoredLockPin, getStoredSubscriptionExpiryNoticeSeen, setStoredErasePin, setStoredErasePinAlertConfig, setStoredErasePinDeletePeers, setStoredLockPin, setStoredSubscriptionExpiryNoticeSeen, type ErasePinAlertConfig } from '../lib/storage';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { isMeetVapSystemUser } from '../lib/systemChat';
import { getNativeAppVersion } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { RootStackParamList } from '../types/navigation';
import type { SubscriptionStatus } from '../types/domain';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
const DELETE_COUNTDOWN_SECONDS = 10;
const APP_VERSION_FALLBACK = Constants.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown';
const ERASE_PIN_MESSAGE_INPUT_ACCESSORY_ID = 'erase-pin-message-input-accessory';
type PinSetupTarget = 'erase' | 'lock';
type IoniconName = keyof typeof Ionicons.glyphMap;
type SubscriptionDetails = {
  expiresLabel: string;
  features: string[];
  featuresTitle: string;
  icon: IoniconName;
  packageTitle: string;
  sourceLabel: string;
  statusLabel: string;
};

export function SettingsScreen() {
  useThemeColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const navigation = useNavigation<Navigation>();
  const user = useAppStore((state) => state.user);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const contacts = useAppStore((state) => state.contacts);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  styles = createStyles(isDarkMode);
  const language = useAppStore((state) => state.language);
  const languagePreference = useAppStore((state) => state.languagePreference);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const setDarkMode = useAppStore((state) => state.setDarkMode);
  const setLanguagePreference = useAppStore((state) => state.setLanguagePreference);
  const deleteAccountForever = useAppStore((state) => state.deleteAccountForever);
  const signOut = useAppStore((state) => state.signOut);
  const updateAvatar = useAppStore((state) => state.updateAvatar);
  const updateProfile = useAppStore((state) => state.updateProfile);
  const updatePrivacy = useAppStore((state) => state.updatePrivacy);
  const [profileEditorTarget, setProfileEditorTarget] = useState<'displayName' | 'username' | null>(null);
  const [profileDraft, setProfileDraft] = useState('');
  const [isSavingProfile, setSavingProfile] = useState(false);
  const [isLanguageModalVisible, setLanguageModalVisible] = useState(false);
  const [isSubscriptionDetailsVisible, setSubscriptionDetailsVisible] = useState(false);
  const [isDeleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteCountdown, setDeleteCountdown] = useState(DELETE_COUNTDOWN_SECONDS);
  const [isDeletingAccount, setDeletingAccount] = useState(false);
  const [isLockPinEnabled, setLockPinEnabled] = useState(false);
  const [isErasePinEnabled, setErasePinEnabled] = useState(false);
  const [erasePinAlertConfig, setErasePinAlertConfigState] = useState<ErasePinAlertConfig | null>(null);
  const [deleteChatsOnPeers, setDeleteChatsOnPeers] = useState(true);
  const [isErasePinTipVisible, setErasePinTipVisible] = useState(false);
  const [isErasePinAlertModalVisible, setErasePinAlertModalVisible] = useState(false);
  const [isErasePinRecipientsModalVisible, setErasePinRecipientsModalVisible] = useState(false);
  const [erasePinRecipientsSearch, setErasePinRecipientsSearch] = useState('');
  const [erasePinAlertMessageDraft, setErasePinAlertMessageDraft] = useState('');
  const [erasePinAlertSelectedUserIds, setErasePinAlertSelectedUserIds] = useState<string[]>([]);
  const [erasePinSendLiveLocation, setErasePinSendLiveLocation] = useState(false);
  const [pinSetupTarget, setPinSetupTarget] = useState<PinSetupTarget | null>(null);
  const [pinSetupStep, setPinSetupStep] = useState<'first' | 'confirm'>('first');
  const [pinSetupDraft, setPinSetupDraft] = useState('');
  const [pinSetupFirst, setPinSetupFirst] = useState('');
  const [pinSetupError, setPinSetupError] = useState('');
  const [appVersion, setAppVersion] = useState(APP_VERSION_FALLBACK);
  const canUsePremiumFeatures = hasPremiumAccess(subscriptionStatus);
  const subscriptionDetails = useMemo(
    () => getSubscriptionDetails(subscriptionStatus, language, canUsePremiumFeatures),
    [canUsePremiumFeatures, language, subscriptionStatus],
  );
  const subscriptionExpiryNoticeKey = useMemo(
    () => getSubscriptionExpiryNoticeKey(subscriptionStatus, canUsePremiumFeatures),
    [canUsePremiumFeatures, subscriptionStatus],
  );
  const effectiveErasePinEnabled = canUsePremiumFeatures && isErasePinEnabled;
  const effectivePreventPeerScreenshots = canUsePremiumFeatures && user?.preventPeerScreenshots !== false;
  const effectiveUseGroupAliases = canUsePremiumFeatures && user?.useGroupAliases !== false;

  useEffect(() => {
    let isActive = true;

    void getNativeAppVersion().then((version) => {
      if (isActive && version?.trim()) {
        setAppVersion(version.trim());
      }
    });

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!user?.id || !subscriptionExpiryNoticeKey) {
      return;
    }

    let isCancelled = false;

    void getStoredSubscriptionExpiryNoticeSeen(user.id, subscriptionExpiryNoticeKey)
      .then(async (wasSeen) => {
        if (isCancelled || wasSeen) {
          return;
        }

        await setStoredSubscriptionExpiryNoticeSeen(user.id, subscriptionExpiryNoticeKey);

        if (!isCancelled) {
          setSubscriptionDetailsVisible(true);
        }
      })
      .catch(() => undefined);

    return () => {
      isCancelled = true;
    };
  }, [subscriptionExpiryNoticeKey, user?.id]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable accessibilityLabel={t('language')} onPress={() => setLanguageModalVisible(true)} style={styles.headerLanguageButton}>
          <Ionicons color={colors.white} name="language-outline" size={22} />
        </Pressable>
      ),
    });
  }, [language, navigation]);

  const refreshPinSettings = useCallback(async () => {
    const [lockPin, erasePin, alertConfig, shouldDeletePeers] = await Promise.all([
      getStoredLockPin(),
      getStoredErasePin(),
      getStoredErasePinAlertConfig(),
      getStoredErasePinDeletePeers(),
    ]);

    setLockPinEnabled(!!lockPin);
    setErasePinEnabled(!!erasePin);
    setErasePinAlertConfigState(alertConfig);
    setDeleteChatsOnPeers(shouldDeletePeers);
  }, []);

  useEffect(() => {
    if (!isDeleteModalVisible || deleteCountdown <= 0) {
      return undefined;
    }

    const timeout = setTimeout(() => setDeleteCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => clearTimeout(timeout);
  }, [deleteCountdown, isDeleteModalVisible]);

  useFocusEffect(useCallback(() => {
    void refreshPinSettings().catch(() => undefined);
  }, [refreshPinSettings]));

  useEffect(() => addSecurityEventListener('erasePinCleared', () => {
    setLockPinEnabled(true);
    setErasePinEnabled(false);
  }), []);

  useEffect(() => addSecurityEventListener('backgroundLocationDisabled', () => {
    setErasePinSendLiveLocation(false);
  }), []);

  const erasePinAlertTargets = useMemo(() => contacts
    .filter((contact) => contact.id !== user?.id && !isMeetVapSystemUser(contact))
    .sort((left, right) => left.displayName.localeCompare(right.displayName)), [contacts, user?.id]);

  const erasePinAlertSelectedTargets = erasePinAlertSelectedUserIds
    .map((userId) => erasePinAlertTargets.find((contact) => contact.id === userId))
    .filter((item): item is NonNullable<typeof item> => !!item);
  const filteredErasePinAlertTargets = useMemo(() => {
    const normalizedSearch = erasePinRecipientsSearch.trim().toLocaleLowerCase();

    if (!normalizedSearch) {
      return erasePinAlertTargets;
    }

    return erasePinAlertTargets.filter((contact) => contact.displayName.toLocaleLowerCase().includes(normalizedSearch));
  }, [erasePinAlertTargets, erasePinRecipientsSearch]);

  async function toggleLastSeen(value: boolean) {
    try {
      await updatePrivacy({ showLastSeen: value });
    } catch (error) {
      Alert.alert(t('privacyUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function toggleHideFromSearch(value: boolean) {
    try {
      await updatePrivacy({ hideFromSearch: value });
    } catch (error) {
      Alert.alert(t('privacyUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function toggleOnlyContactsCanCall(value: boolean) {
    try {
      await updatePrivacy({ onlyContactsCanCall: value });
    } catch (error) {
      Alert.alert(t('privacyUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function toggleHideNickname(value: boolean) {
    try {
      await updatePrivacy({ hideNickname: value });
    } catch (error) {
      Alert.alert(t('privacyUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function togglePreventPeerScreenshots(value: boolean) {
    if (value && !canUsePremiumFeatures) {
      showPremiumRequired();
      return;
    }

    try {
      await updatePrivacy({ preventPeerScreenshots: value });
    } catch (error) {
      Alert.alert(t('privacyUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function toggleUseGroupAliases(value: boolean) {
    if (value && !canUsePremiumFeatures) {
      showPremiumRequired();
      return;
    }

    try {
      await updatePrivacy({ useGroupAliases: value });
    } catch (error) {
      Alert.alert(t('privacyUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function openDisplayNameEditor() {
    setProfileDraft(user?.displayName ?? '');
    setProfileEditorTarget('displayName');
  }

  function openNicknameEditor() {
    setProfileDraft(user?.username ?? '');
    setProfileEditorTarget('username');
  }

  function closeProfileEditor() {
    if (isSavingProfile) {
      return;
    }

    setProfileEditorTarget(null);
    setProfileDraft('');
  }

  async function saveProfile() {
    const value = profileDraft.trim();

    if (!profileEditorTarget) {
      return;
    }

    if (!value) {
      Alert.alert(
        profileEditorTarget === 'displayName' ? t('nameNeeded') : t('nicknameInvalid'),
        profileEditorTarget === 'displayName' ? t('enterDisplayName') : t('enterNickname'),
      );
      return;
    }

    if (profileEditorTarget === 'displayName') {
      if (containsMeetVapKeyword(value)) {
        Alert.alert(t('nameUpdateFailed'), t('meetvapNameProhibited'));
        return;
      }

      if (value === (user?.displayName ?? '')) {
        closeProfileEditor();
        return;
      }

      setSavingProfile(true);

      try {
        await updateProfile({ displayName: value });
        closeProfileEditor();
      } catch (error) {
        Alert.alert(t('nameUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      } finally {
        setSavingProfile(false);
      }

      return;
    }

    const username = value.toLowerCase();

    if (username.length < 6 || username.length > 32 || !/^[a-z0-9_]+$/.test(username)) {
      Alert.alert(t('nicknameInvalid'), t('nicknameInvalidDescription'));
      return;
    }

    if (isProhibitedMeetVapUsername(username)) {
      Alert.alert(t('nicknameUpdateFailed'), t('meetvapNameProhibited'));
      return;
    }

    if (username === (user?.username ?? '')) {
      closeProfileEditor();
      return;
    }

    setSavingProfile(true);

    try {
      await updateProfile({ username });
      closeProfileEditor();
    } catch (error) {
      Alert.alert(t('nicknameUpdateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePicture() {
    if (!serverUrl) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(t('permissionNeeded'), t('photoLibraryPermission'));
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ['images'],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) {
      return;
    }

    try {
      const asset = result.assets[0];
      const media = await uploadMediaFile(serverUrl, {
        mimeType: asset.mimeType ?? 'image/jpeg',
        originalName: asset.fileName ?? 'profile.jpg',
        uri: asset.uri,
      });

      await updateAvatar(`${serverUrl}/media/${media.id}/file`);
    } catch (error) {
      Alert.alert(t('pictureFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function showPictureActions() {
    Alert.alert(t('profilePicture'), t('choosePictureAction'), [
      { text: t('changePicture'), onPress: () => void changePicture() },
      ...(user?.avatarUrl ? [{ text: t('removePicture'), style: 'destructive' as const, onPress: () => void updateAvatar(null) }] : []),
      { text: t('cancel'), style: 'cancel' },
    ]);
  }

  function openDeleteAccountModal() {
    setDeletePassword('');
    setDeleteCountdown(DELETE_COUNTDOWN_SECONDS);
    setDeletingAccount(false);
    setDeleteModalVisible(true);
  }

  async function confirmDeleteAccount() {
    if (!deletePassword.trim()) {
      Alert.alert(t('passwordNeeded'), t('enterPasswordToDelete'));
      return;
    }

    setDeletingAccount(true);

    try {
      await deleteAccountForever(deletePassword);
      setDeleteModalVisible(false);
    } catch (error) {
      Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setDeletingAccount(false);
    }
  }

  function openPinSetup(target: PinSetupTarget) {
    if (target === 'erase' && !canUsePremiumFeatures) {
      showPremiumRequired();
      return;
    }

    setPinSetupTarget(target);
    setPinSetupStep('first');
    setPinSetupDraft('');
    setPinSetupFirst('');
    setPinSetupError('');
  }

  async function toggleLockPin(value: boolean) {
    if (value) {
      openPinSetup('lock');
      return;
    }

    await Promise.all([clearStoredLockPin(), clearStoredErasePin(), clearStoredErasePinAlertConfig()]);
    setLockPinEnabled(false);
    setErasePinEnabled(false);
    setErasePinAlertConfigState(null);
  }

  async function toggleErasePin(value: boolean) {
    if (value) {
      if (!canUsePremiumFeatures) {
        showPremiumRequired();
        setErasePinEnabled(false);
        return;
      }

      if (!isLockPinEnabled) {
        Alert.alert(t('enableLockPinFirst'), t('enableLockPinFirstDescription'));
        setErasePinEnabled(false);
        return;
      }

      openPinSetup('erase');
      return;
    }

    await clearStoredErasePin();
    setErasePinEnabled(false);
    setErasePinTipVisible(false);
    await clearStoredErasePinAlertConfig();
    setErasePinAlertConfigState(null);
  }

  async function toggleDeleteChatsOnPeers(value: boolean) {
    setDeleteChatsOnPeers(value);
    await setStoredErasePinDeletePeers(value);
  }

  function cancelPinSetup() {
    setPinSetupTarget(null);
    setPinSetupStep('first');
    setPinSetupDraft('');
    setPinSetupFirst('');
    setPinSetupError('');
  }

  async function continuePinSetup() {
    if (!/^\d{4}$/.test(pinSetupDraft)) {
      setPinSetupError(t('pinMustBe4Digits'));
      return;
    }

    if (pinSetupStep === 'first') {
      setPinSetupFirst(pinSetupDraft);
      setPinSetupDraft('');
      setPinSetupStep('confirm');
      setPinSetupError('');
      return;
    }

    if (pinSetupDraft !== pinSetupFirst) {
      setPinSetupStep('first');
      setPinSetupDraft('');
      setPinSetupFirst('');
      setPinSetupError(t('pinsDoNotMatch'));
      return;
    }

    if (pinSetupTarget === 'lock') {
      await setStoredLockPin(pinSetupDraft);
      setLockPinEnabled(true);
    } else if (pinSetupTarget === 'erase') {
      const lockPin = await getStoredLockPin();

      if (lockPin === pinSetupDraft) {
        setPinSetupStep('first');
        setPinSetupDraft('');
        setPinSetupFirst('');
        setPinSetupError(t('erasePinMustBeDifferent'));
        return;
      }

      await setStoredErasePin(pinSetupDraft);
      setErasePinEnabled(true);
      setErasePinTipVisible(true);
    }

    cancelPinSetup();
  }

  async function openErasePinAlertModal() {
    if (!canUsePremiumFeatures) {
      showPremiumRequired();
      return;
    }

    setErasePinTipVisible(false);
    await loadContacts().catch(() => undefined);
    const config = await getStoredErasePinAlertConfig();
    setErasePinAlertConfigState(config);
    setErasePinAlertSelectedUserIds(config?.targetUserIds ?? []);
    setErasePinAlertMessageDraft(config?.message ?? '');
    setErasePinSendLiveLocation(config?.sendLiveLocation === true);
    setErasePinAlertModalVisible(true);
  }

  function showPremiumRequired() {
    Alert.alert(t('premiumRequiredTitle'), t('premiumRequiredMessage'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('premiumSubscribe'), onPress: () => navigation.navigate('Subscription') },
    ]);
  }

  function closeErasePinAlertModal() {
    Keyboard.dismiss();
    setErasePinAlertModalVisible(false);
    setErasePinRecipientsSearch('');
    setErasePinRecipientsModalVisible(false);
  }

  function openErasePinRecipientsModal() {
    Keyboard.dismiss();
    setErasePinRecipientsSearch('');
    setErasePinRecipientsModalVisible(true);
    void loadContacts().catch(() => undefined);
  }

  function closeErasePinRecipientsModal() {
    Keyboard.dismiss();
    setErasePinRecipientsSearch('');
    setErasePinRecipientsModalVisible(false);
  }

  function toggleErasePinAlertRecipient(userId: string) {
    setErasePinAlertSelectedUserIds((current) => {
      if (current.includes(userId)) {
        return current.filter((id) => id !== userId);
      }

      if (current.length >= 2) {
        Alert.alert(t('erasePinAlertLimitTitle'), t('erasePinAlertLimitDescription'));
        return current;
      }

      return [...current, userId];
    });
  }

  function showErasePinAlertRecipientActions(userId: string, displayName: string) {
    Alert.alert(displayName, undefined, [
      {
        style: 'destructive',
        text: t('remove'),
        onPress: () => setErasePinAlertSelectedUserIds((current) => current.filter((id) => id !== userId)),
      },
      {
        style: 'cancel',
        text: t('cancel'),
      },
    ]);
  }

  async function saveErasePinAlertConfig() {
    const message = erasePinAlertMessageDraft.trim();
    const targetUserIds = erasePinAlertSelectedTargets.map((contact) => contact.id);

    if (targetUserIds.length === 0) {
      Alert.alert(t('erasePinAlertTargetsRequiredTitle'), t('erasePinAlertTargetsRequiredDescription'));
      return;
    }

    if (!message) {
      Alert.alert(t('erasePinAlertMessageRequiredTitle'), t('erasePinAlertMessageRequiredDescription'));
      return;
    }

    const config = {
      message,
      sendLiveLocation: erasePinSendLiveLocation,
      targetUserIds,
    };

    await setStoredErasePinAlertConfig(config);
    setErasePinAlertConfigState(config);
    closeErasePinAlertModal();
    Alert.alert(t('erasePinAlertSavedTitle'), t('erasePinAlertSavedDescription'));
  }

  async function toggleErasePinSendLiveLocation(value: boolean) {
    if (!value) {
      setErasePinSendLiveLocation(false);
      return;
    }

    if (!await requestLiveLocationPermissions()) {
      Alert.alert(t('permissionNeeded'), t('allowBackgroundLocationToShare'));
      setErasePinSendLiveLocation(false);
      return;
    }

    setErasePinSendLiveLocation(true);
  }

  return (
    <ScreenBackground style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <View style={styles.profile}>
          <Avatar label={user?.displayName ?? 'M'} onPress={showPictureActions} size={64} uri={user?.avatarUrl} />
          <View style={styles.profileText}>
            <View style={styles.nameRow}>
              {canUsePremiumFeatures ? <PremiumUserBadge size={19} /> : null}
              <Text numberOfLines={1} style={styles.name}>{user?.displayName}</Text>
              <Pressable onPress={openDisplayNameEditor} style={({ pressed }) => [styles.editNameButton, pressed && styles.editNameButtonPressed]}>
                <Ionicons color={colors.primary} name="create-outline" size={18} />
              </Pressable>
            </View>
            {canUsePremiumFeatures ? (
              <Text style={styles.premiumUserLabel}>{t('premiumUser')}</Text>
            ) : null}
            <View style={styles.usernameRow}>
              <Text style={styles.username}>@{user?.username}</Text>
              <Pressable onPress={openNicknameEditor} style={({ pressed }) => [styles.editNameButton, pressed && styles.editNameButtonPressed]}>
                <Ionicons color={colors.primary} name="create-outline" size={16} />
              </Pressable>
            </View>
            <Pressable onPress={() => navigation.navigate('ChangePassword')} style={({ pressed }) => [styles.shareProfileButton, pressed && styles.shareProfileButtonPressed]}>
              <Ionicons color={colors.primary} name="key-outline" size={16} />
              <Text style={styles.shareProfileText}>{t('changePassword')}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.settingsRow}>
          <View style={styles.settingsText}>
            <Text style={styles.label}>{t('darkMode')}</Text>
            <Text style={styles.value}>{t('useDarkerTheme')}</Text>
          </View>
          <Switch
            onValueChange={(value) => {
              void setDarkMode(value);
            }}
            thumbColor={colors.white}
            trackColor={{ false: colors.border, true: colors.primary }}
            value={isDarkMode}
          />
        </View>

        <View style={styles.settingsRow}>
          <View style={styles.settingsText}>
            <Text style={styles.label}>{t('enableLockPin')}</Text>
            <Text style={styles.value}>{t('enableLockPinDescription')}</Text>
          </View>
          <Switch
            onValueChange={(value) => {
              void toggleLockPin(value);
            }}
            thumbColor={colors.white}
            trackColor={{ false: colors.border, true: colors.primary }}
            value={isLockPinEnabled}
          />
        </View>

        <View style={styles.settingsRow}>
          <View style={styles.settingsText}>
            <Text style={styles.label}>{t('onlineAndLastSeen')}</Text>
            <Text style={styles.value}>{t('onlineAndLastSeenDescription')}</Text>
          </View>
          <Switch
            onValueChange={(value) => {
              void toggleLastSeen(value);
            }}
            thumbColor={colors.white}
            trackColor={{ false: colors.border, true: colors.primary }}
            value={user?.showLastSeen !== false}
          />
        </View>

        <View style={styles.settingsRow}>
          <View style={styles.settingsText}>
            <Text style={styles.label}>{t('hideMeFromSearch')}</Text>
            <Text style={styles.value}>{t('hideMeFromSearchDescription')}</Text>
          </View>
          <Switch
            onValueChange={(value) => {
              void toggleHideFromSearch(value);
            }}
            thumbColor={colors.white}
            trackColor={{ false: colors.border, true: colors.primary }}
            value={user?.hideFromSearch === true}
          />
        </View>

        <View style={styles.settingsRow}>
          <View style={styles.settingsText}>
            <Text style={styles.label}>{t('onlyContactsCanCall')}</Text>
            <Text style={styles.value}>{t('onlyContactsCanCallDescription')}</Text>
          </View>
          <Switch
            onValueChange={(value) => {
              void toggleOnlyContactsCanCall(value);
            }}
            thumbColor={colors.white}
            trackColor={{ false: colors.border, true: colors.primary }}
            value={user?.onlyContactsCanCall === true}
          />
        </View>

        <View style={styles.settingsRow}>
          <View style={styles.settingsText}>
            <Text style={styles.label}>{t('hideMyNickname')}</Text>
            <Text style={styles.value}>{t('hideMyNicknameDescription')}</Text>
          </View>
          <Switch
            onValueChange={(value) => {
              void toggleHideNickname(value);
            }}
            thumbColor={colors.white}
            trackColor={{ false: colors.border, true: colors.primary }}
            value={user?.hideNickname !== false}
          />
        </View>

        <View style={styles.premiumSettingsBox}>
          <View pointerEvents="none" style={styles.premiumCornerIcon}>
            <Ionicons color={colors.primary} name="sparkles" size={18} />
          </View>
          <View style={styles.premiumSettingsRow}>
            <View style={styles.settingsText}>
              <Text style={styles.label}>{t('enableErasePin')}</Text>
              <Text style={styles.value}>
                {erasePinAlertConfig?.targetUserIds.length
                  ? t('erasePinAlertConfigured', { count: erasePinAlertConfig.targetUserIds.length })
                  : t('enableErasePinDescription')}
              </Text>
            </View>
            {effectiveErasePinEnabled ? (
              <Pressable onPress={() => void openErasePinAlertModal()} style={({ pressed }) => [styles.inlineIconButton, pressed && styles.editNameButtonPressed]}>
                <Ionicons color={colors.primary} name="settings-outline" size={20} />
              </Pressable>
            ) : null}
            <Switch
              onValueChange={(value) => {
                void toggleErasePin(value);
              }}
              thumbColor={colors.white}
              trackColor={{ false: colors.border, true: colors.primary }}
              value={effectiveErasePinEnabled}
            />
          </View>
          {isErasePinTipVisible && effectiveErasePinEnabled ? (
            <Pressable
              onPress={() => {
                setErasePinTipVisible(false);
                void openErasePinAlertModal();
              }}
              style={({ pressed }) => [styles.erasePinTip, pressed && styles.shareProfileButtonPressed]}
            >
              <View style={styles.erasePinTipArrow} />
              <Ionicons color={colors.primary} name="information-circle-outline" size={18} />
              <Text style={styles.erasePinTipText}>{t('erasePinUrgentTip')}</Text>
            </Pressable>
          ) : null}
          <View style={styles.premiumSettingsDivider} />
          <View style={styles.premiumSettingsRow}>
            <View style={styles.settingsText}>
              <Text style={styles.label}>{t('preventPeerScreenshots')}</Text>
              <Text style={styles.value}>{t('preventPeerScreenshotsDescription')}</Text>
            </View>
            <Switch
              onValueChange={(value) => {
                void togglePreventPeerScreenshots(value);
              }}
              thumbColor={colors.white}
              trackColor={{ false: colors.border, true: colors.primary }}
              value={effectivePreventPeerScreenshots}
            />
          </View>
          <View style={styles.premiumSettingsDivider} />
          <View style={styles.premiumSettingsRow}>
            <View style={styles.settingsText}>
              <Text style={styles.label}>{t('useDifferentNameInGroups')}</Text>
              <Text style={styles.value}>{t('useDifferentNameInGroupsDescription')}</Text>
            </View>
            <Switch
              onValueChange={(value) => {
                void toggleUseGroupAliases(value);
              }}
              thumbColor={colors.white}
              trackColor={{ false: colors.border, true: colors.primary }}
              value={effectiveUseGroupAliases}
            />
          </View>
        </View>

        <Pressable onPress={() => navigation.navigate('StorageUsage')} style={({ pressed }) => [styles.settingsActionRow, pressed && styles.shareProfileButtonPressed]}>
          <View style={styles.settingsActionText}>
            <Ionicons color={colors.primary} name="server-outline" size={21} />
            <Text style={styles.settingsActionLabel}>{t('storageUsage')}</Text>
          </View>
          <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
        </Pressable>

        <Pressable onPress={() => navigation.navigate('BlockedUsers')} style={({ pressed }) => [styles.settingsActionRow, pressed && styles.shareProfileButtonPressed]}>
          <View style={styles.settingsActionText}>
            <Ionicons color={colors.primary} name="ban-outline" size={21} />
            <Text style={styles.settingsActionLabel}>{t('blockedUsers')}</Text>
          </View>
          <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
        </Pressable>

        <PrimaryButton onPress={signOut} title={t('signOut')} />
        <Pressable onPress={openDeleteAccountModal} style={styles.deleteAccountButton}>
          <Ionicons color={colors.danger} name="warning-outline" size={20} />
          <Text style={styles.deleteAccountText}>{t('deleteAccount')}</Text>
        </Pressable>
        <Pressable
          onPress={() => setSubscriptionDetailsVisible(true)}
          style={({ pressed }) => [styles.subscriptionFooterRow, pressed && styles.shareProfileButtonPressed]}
        >
          <View style={styles.subscriptionFooterText}>
            <Ionicons color={colors.primary} name={subscriptionDetails.icon} size={19} />
            <View style={styles.subscriptionFooterCopy}>
              <Text style={styles.subscriptionFooterLabel}>{t('subscriptionPackage')}</Text>
              <Text numberOfLines={1} style={styles.subscriptionFooterValue}>{subscriptionDetails.packageTitle}</Text>
            </View>
          </View>
          <Ionicons color={colors.textSecondary} name="chevron-forward" size={18} />
        </Pressable>
        <Text style={styles.versionText}>{t('version', { version: appVersion })}</Text>
      </ScrollView>

      <Modal animationType="fade" transparent visible={profileEditorTarget !== null} onRequestClose={closeProfileEditor}>
        <Pressable onPress={closeProfileEditor} style={styles.modalBackdrop}>
          <Pressable style={styles.nameModal}>
            <Text style={styles.modalTitle}>{profileEditorTarget === 'username' ? t('editNickname') : t('editDisplayName')}</Text>
            <TextInput
              autoCapitalize={profileEditorTarget === 'username' ? 'none' : 'words'}
              autoFocus
              autoCorrect={profileEditorTarget !== 'username'}
              maxLength={profileEditorTarget === 'username' ? 32 : 80}
              onChangeText={setProfileDraft}
              placeholder={profileEditorTarget === 'username' ? t('nickname') : t('displayName')}
              placeholderTextColor={colors.mutedText}
              style={styles.nameInput}
              value={profileDraft}
            />
            <View style={styles.modalActions}>
              <Pressable disabled={isSavingProfile} onPress={closeProfileEditor} style={styles.secondaryModalButton}>
                <Text style={styles.secondaryModalButtonText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable disabled={isSavingProfile} onPress={() => void saveProfile()} style={[styles.primaryModalButton, isSavingProfile && styles.primaryModalButtonDisabled]}>
                <Text style={styles.primaryModalButtonText}>{isSavingProfile ? t('saving') : t('save')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={isDeleteModalVisible} onRequestClose={() => setDeleteModalVisible(false)}>
        <Pressable onPress={() => setDeleteModalVisible(false)} style={styles.modalBackdrop}>
          <Pressable style={styles.deleteModal}>
            <Text style={styles.deleteTitle}>{t('deleteAccountForeverQuestion')}</Text>
            <Text style={styles.deleteBody}>
              {t('deleteAccountForeverBody')}
            </Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={setDeletePassword}
              placeholder={t('enterPassword')}
              placeholderTextColor={colors.mutedText}
              secureTextEntry
              style={styles.passwordInput}
              value={deletePassword}
            />
            <Pressable
              disabled={deleteCountdown > 0 || isDeletingAccount}
              onPress={() => void confirmDeleteAccount()}
              style={[
                styles.deleteForeverButton,
                (deleteCountdown > 0 || isDeletingAccount) && styles.deleteForeverButtonDisabled,
              ]}
            >
              <Text style={styles.deleteForeverText}>
                {isDeletingAccount ? t('deleting') : deleteCountdown > 0 ? `${t('deleteForever')} (${deleteCountdown})` : t('deleteForever')}
              </Text>
            </Pressable>
            <Pressable disabled={isDeletingAccount} onPress={() => setDeleteModalVisible(false)} style={styles.cancelDeleteButton}>
              <Text style={styles.cancelDeleteText}>{t('cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={isLanguageModalVisible} onRequestClose={() => setLanguageModalVisible(false)}>
        <Pressable onPress={() => setLanguageModalVisible(false)} style={styles.modalBackdrop}>
          <Pressable style={styles.nameModal}>
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

      <Modal animationType="fade" transparent visible={isSubscriptionDetailsVisible} onRequestClose={() => setSubscriptionDetailsVisible(false)}>
        <Pressable onPress={() => setSubscriptionDetailsVisible(false)} style={styles.modalBackdrop}>
          <Pressable style={styles.subscriptionModal}>
            <View style={styles.subscriptionModalHeader}>
              <View style={styles.subscriptionModalIcon}>
                <Ionicons color={colors.primary} name={subscriptionDetails.icon} size={24} />
              </View>
              <View style={styles.subscriptionModalHeaderText}>
                <Text style={styles.modalTitle}>{t('subscriptionDetailsTitle')}</Text>
                <Text style={styles.subscriptionModalSubtitle}>{subscriptionDetails.packageTitle}</Text>
              </View>
            </View>

            <View style={styles.subscriptionDetailBox}>
              <SubscriptionDetailRow label={t('subscriptionStatusLabel')} value={subscriptionDetails.statusLabel} />
              <SubscriptionDetailRow label={t('subscriptionExpiresLabel')} value={subscriptionDetails.expiresLabel} />
              <SubscriptionDetailRow label={t('subscriptionSourceLabel')} value={subscriptionDetails.sourceLabel} />
            </View>

            <View style={styles.subscriptionFeaturesBlock}>
              <Text style={styles.subscriptionFeaturesTitle}>{subscriptionDetails.featuresTitle}</Text>
              {subscriptionDetails.features.map((feature) => (
                <View key={feature} style={styles.subscriptionFeatureRow}>
                  <Ionicons color={canUsePremiumFeatures ? '#22c55e' : colors.textSecondary} name={canUsePremiumFeatures ? 'checkmark-circle' : 'lock-closed-outline'} size={18} />
                  <Text style={[styles.subscriptionFeatureText, !canUsePremiumFeatures && styles.subscriptionFeatureTextInactive]}>{feature}</Text>
                </View>
              ))}
            </View>

            <View style={styles.modalActions}>
              {!canUsePremiumFeatures ? (
                <Pressable
                  onPress={() => {
                    setSubscriptionDetailsVisible(false);
                    navigation.navigate('Subscription');
                  }}
                  style={styles.primaryModalButton}
                >
                  <Text style={styles.primaryModalButtonText}>{t('subscriptionGetSubscription')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => setSubscriptionDetailsVisible(false)}
                style={canUsePremiumFeatures ? styles.primaryModalButton : styles.secondaryModalButton}
              >
                <Text style={canUsePremiumFeatures ? styles.primaryModalButtonText : styles.secondaryModalButtonText}>{t('close')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal animationType="fade" transparent visible={!!pinSetupTarget} onRequestClose={cancelPinSetup}>
        <View style={styles.pinModalAvoider}>
          <Pressable onPress={cancelPinSetup} style={styles.pinModalBackdrop}>
            <Pressable style={styles.nameModal}>
              <Text style={styles.modalTitle}>
                {pinSetupTarget === 'erase' ? t('setupErasePin') : t('setupLockPin')}
              </Text>
              <Text style={styles.pinSetupText}>
                {pinSetupStep === 'first' ? t('enter4DigitPin') : t('confirm4DigitPin')}
              </Text>
              <PinPad
                onChange={(value) => {
                  setPinSetupError('');
                  setPinSetupDraft(value);
                }}
                value={pinSetupDraft}
              />
              {pinSetupError ? <Text style={styles.pinError}>{pinSetupError}</Text> : null}
              <View style={styles.modalActions}>
                <Pressable onPress={cancelPinSetup} style={styles.secondaryModalButton}>
                  <Text style={styles.secondaryModalButtonText}>{t('cancel')}</Text>
                </Pressable>
                <Pressable
                  disabled={pinSetupDraft.length !== 4}
                  onPress={() => void continuePinSetup()}
                  style={[styles.primaryModalButton, pinSetupDraft.length !== 4 && styles.primaryModalButtonDisabled]}
                >
                  <Text style={styles.primaryModalButtonText}>{pinSetupStep === 'first' ? t('continue') : t('save')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={isErasePinAlertModalVisible} onRequestClose={closeErasePinAlertModal}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.eraseModalBackdrop,
            {
              paddingBottom: Math.max(spacing.xl, insets.bottom + spacing.md),
              paddingTop: Math.max(spacing.xl, insets.top + spacing.md),
            },
          ]}
        >
          <Pressable onPress={closeErasePinAlertModal} style={StyleSheet.absoluteFill} />
          <View style={[
            styles.eraseAlertModal,
            {
              maxHeight: Math.max(320, windowHeight - insets.top - insets.bottom - spacing.xl * 2),
            },
          ]}>
            {isErasePinRecipientsModalVisible ? (
              <>
                <View style={styles.eraseRecipientsHeader}>
                  <Pressable accessibilityLabel={t('back')} onPress={closeErasePinRecipientsModal} style={styles.eraseRecipientsBackButton}>
                    <Ionicons color={colors.textPrimary} name="chevron-back" size={22} />
                  </Pressable>
                  <View style={styles.eraseModalHeaderText}>
                    <Text style={styles.modalTitle}>{t('erasePinAlertRecipients')}</Text>
                    <Text style={styles.pinSetupText}>{t('erasePinAlertRecipientsDescription')}</Text>
                  </View>
                </View>
                <View style={styles.eraseRecipientsSearchWrap}>
                  <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    onChangeText={setErasePinRecipientsSearch}
                    onSubmitEditing={Keyboard.dismiss}
                    placeholder={t('searchContacts')}
                    placeholderTextColor={colors.mutedText}
                    returnKeyType="done"
                    style={styles.eraseRecipientsSearchInput}
                    value={erasePinRecipientsSearch}
                  />
                  {erasePinRecipientsSearch ? (
                    <Pressable accessibilityLabel={t('clear')} onPress={() => setErasePinRecipientsSearch('')} style={styles.eraseRecipientsSearchClear}>
                      <Ionicons color={colors.textSecondary} name="close-circle" size={20} />
                    </Pressable>
                  ) : null}
                </View>
                <FlatList
                  contentContainerStyle={[
                    styles.eraseRecipientsListContent,
                    { paddingBottom: Math.max(spacing.md, insets.bottom) },
                  ]}
                  data={filteredErasePinAlertTargets}
                  initialNumToRender={16}
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                  keyboardShouldPersistTaps="handled"
                  keyExtractor={(contact) => contact.id}
                  maxToRenderPerBatch={24}
                  removeClippedSubviews
                  renderItem={({ item: contact }) => {
                    const isSelected = erasePinAlertSelectedUserIds.includes(contact.id);

                    return (
                      <Pressable key={contact.id} onPress={() => toggleErasePinAlertRecipient(contact.id)} style={({ pressed }) => [styles.eraseRecipientRow, pressed && styles.editNameButtonPressed]}>
                        <Avatar label={contact.displayName} size={42} uri={contact.avatarUrl} />
                        <View style={styles.eraseRecipientText}>
                          <Text numberOfLines={1} style={styles.value}>{contact.displayName}</Text>
                        </View>
                        <Ionicons color={isSelected ? colors.primary : colors.border} name={isSelected ? 'checkbox' : 'square-outline'} size={22} />
                      </Pressable>
                    );
                  }}
                  showsVerticalScrollIndicator
                  style={styles.eraseRecipientsList}
                  ListEmptyComponent={<Text style={styles.emptyText}>{erasePinRecipientsSearch.trim() ? t('noPeopleFound') : t('noContactsYet')}</Text>}
                  windowSize={7}
                />
                <View style={styles.modalActions}>
                  <Pressable onPress={closeErasePinRecipientsModal} style={styles.primaryModalButton}>
                    <Text style={styles.primaryModalButtonText}>{t('done')}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.eraseModalHeader}>
                  <View style={styles.eraseModalIcon}>
                    <Ionicons color={colors.primary} name="shield-checkmark-outline" size={24} />
                  </View>
                  <View style={styles.eraseModalHeaderText}>
                    <Text style={styles.modalTitle}>{t('erasePinSettingsTitle')}</Text>
                    <Text style={styles.pinSetupText}>{t('erasePinSettingsDescription')}</Text>
                  </View>
                </View>

                <ScrollView
                  contentContainerStyle={styles.eraseAlertModalScrollContent}
                  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                  style={styles.eraseAlertModalScroll}
                >
                  <Pressable onPress={openErasePinRecipientsModal} style={styles.selectionButton}>
                    <View style={styles.selectionButtonText}>
                      <Text style={styles.label}>{t('erasePinAlertRecipients')}</Text>
                      <Text style={styles.value}>{t('erasePinAlertRecipientsPlaceholder')}</Text>
                    </View>
                    <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
                  </Pressable>

                  {erasePinAlertSelectedTargets.length > 0 ? (
                    <View style={styles.selectedUsersRow}>
                      {erasePinAlertSelectedTargets.map((contact) => (
                        <Pressable key={contact.id} onPress={() => showErasePinAlertRecipientActions(contact.id, contact.displayName)} style={({ pressed }) => [styles.selectedUserChip, pressed && styles.editNameButtonPressed]}>
                          <Text numberOfLines={1} style={styles.selectedUserChipText}>{contact.displayName}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}

                  <TextInput
                    inputAccessoryViewID={Platform.OS === 'ios' ? ERASE_PIN_MESSAGE_INPUT_ACCESSORY_ID : undefined}
                    multiline
                    onChangeText={setErasePinAlertMessageDraft}
                    placeholder={t('erasePinAlertMessagePlaceholder')}
                    placeholderTextColor={colors.mutedText}
                    style={styles.eraseAlertMessageInput}
                    textAlignVertical="top"
                    value={erasePinAlertMessageDraft}
                  />

                  <View style={styles.eraseModalSettingRow}>
                    <View style={styles.settingsText}>
                      <Text style={styles.value}>{t('removeChatsFromPeers')}</Text>
                    </View>
                    <Switch
                      onValueChange={(value) => {
                        void toggleDeleteChatsOnPeers(value).catch(() => setDeleteChatsOnPeers(!value));
                      }}
                      thumbColor={colors.white}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={deleteChatsOnPeers}
                    />
                  </View>

                  <View style={styles.eraseModalSettingRow}>
                    <View style={styles.settingsText}>
                      <Text style={styles.value}>{t('erasePinSendLiveLocation')}</Text>
                    </View>
                    <Switch
                      onValueChange={(value) => void toggleErasePinSendLiveLocation(value)}
                      thumbColor={colors.white}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      value={erasePinSendLiveLocation}
                    />
                  </View>
                </ScrollView>

                <View style={styles.modalActions}>
                  <Pressable onPress={closeErasePinAlertModal} style={styles.secondaryModalButton}>
                    <Text style={styles.secondaryModalButtonText}>{t('cancel')}</Text>
                  </Pressable>
                  <Pressable onPress={() => void saveErasePinAlertConfig()} style={styles.primaryModalButton}>
                    <Text style={styles.primaryModalButtonText}>{t('save')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
          {Platform.OS === 'ios' ? (
            <InputAccessoryView nativeID={ERASE_PIN_MESSAGE_INPUT_ACCESSORY_ID}>
              <View style={styles.eraseMessageKeyboardAccessory}>
                <Pressable onPress={Keyboard.dismiss} style={styles.eraseMessageKeyboardDoneButton}>
                  <Text style={styles.eraseMessageKeyboardDoneText}>{t('done')}</Text>
                </Pressable>
              </View>
            </InputAccessoryView>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>
    </ScreenBackground>
  );
}

function SubscriptionDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.subscriptionDetailRow}>
      <Text style={styles.subscriptionDetailLabel}>{label}</Text>
      <Text style={styles.subscriptionDetailValue}>{value}</Text>
    </View>
  );
}

function getSubscriptionDetails(
  subscriptionStatus: SubscriptionStatus | null,
  language: AppLanguage,
  hasAccess: boolean,
): SubscriptionDetails {
  const entitlement = subscriptionStatus?.entitlement ?? null;
  const trialEndsAt = subscriptionStatus?.premiumTrialEndsAt ?? null;
  const trialExpiryTime = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN;
  const entitlementExpiryTime = entitlement?.expiresAt ? Date.parse(entitlement.expiresAt) : Number.NaN;
  const isActiveTrial = subscriptionStatus?.premiumAccessSource === 'trial' &&
    !!trialEndsAt &&
    trialExpiryTime > Date.now();
  const isActiveSubscription = !!entitlement &&
    subscriptionStatus?.hasActiveSubscription === true &&
    entitlementExpiryTime > Date.now();
  const isExpiredTrial = !hasAccess &&
    !!trialEndsAt &&
    Number.isFinite(trialExpiryTime) &&
    trialExpiryTime <= Date.now() &&
    !isActiveSubscription;
  const isExpiredSubscription = !hasAccess &&
    !!entitlement &&
    Number.isFinite(entitlementExpiryTime) &&
    entitlementExpiryTime <= Date.now();

  const packageTitle = isActiveTrial
    ? t('subscriptionTrialMode', {}, language)
    : isExpiredTrial
      ? t('subscriptionTrialExpired', {}, language)
      : isExpiredSubscription
        ? t('subscriptionExpired', {}, language)
        : entitlement
      ? getSubscriptionProductLabel(entitlement.productId, language)
      : t('subscriptionFreeMode', {}, language);
  const expiresLabel = isActiveTrial
    ? formatSubscriptionDate(trialEndsAt, language)
    : entitlement
      ? formatSubscriptionDate(entitlement.expiresAt, language)
      : t('subscriptionNoExpiry', {}, language);
  const sourceLabel = isActiveTrial
    ? t('subscriptionSourceTrial', {}, language)
    : entitlement
      ? getSubscriptionSourceLabel(entitlement.platform, language)
      : t('subscriptionSourceFree', {}, language);

  return {
    expiresLabel,
    features: [
      t('premiumTrialFeatureScreenshots', {}, language),
      t('premiumTrialFeaturePanicPin', {}, language),
      t('premiumTrialFeatureGroupNames', {}, language),
      t('premiumTrialFeatureVoiceChanger', {}, language),
    ],
    featuresTitle: hasAccess
      ? t('subscriptionEnabledSecurityOptions', {}, language)
      : t('subscriptionInactiveSecurityOptions', {}, language),
    icon: hasAccess ? 'shield-checkmark-outline' : 'shield-outline',
    packageTitle,
    sourceLabel,
    statusLabel: hasAccess || isActiveSubscription || isActiveTrial
      ? t('subscriptionStatusActive', {}, language)
      : isExpiredTrial
        ? t('subscriptionTrialExpired', {}, language)
        : isExpiredSubscription
          ? t('subscriptionExpired', {}, language)
      : t('subscriptionStatusInactive', {}, language),
  };
}

function getSubscriptionExpiryNoticeKey(subscriptionStatus: SubscriptionStatus | null, hasAccess: boolean) {
  if (hasAccess || !subscriptionStatus) {
    return null;
  }

  const now = Date.now();
  const entitlementExpiresAt = subscriptionStatus.entitlement?.expiresAt ?? null;
  const entitlementExpiryTime = entitlementExpiresAt ? Date.parse(entitlementExpiresAt) : Number.NaN;

  if (
    entitlementExpiresAt &&
    Number.isFinite(entitlementExpiryTime) &&
    entitlementExpiryTime <= now
  ) {
    return `subscription:${entitlementExpiresAt}`;
  }

  const trialEndsAt = subscriptionStatus.premiumTrialEndsAt ?? null;
  const trialExpiryTime = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN;

  if (
    trialEndsAt &&
    Number.isFinite(trialExpiryTime) &&
    trialExpiryTime <= now
  ) {
    return `trial:${trialEndsAt}`;
  }

  return null;
}

function getSubscriptionSourceLabel(platform: NonNullable<SubscriptionStatus['entitlement']>['platform'], language: AppLanguage) {
  if (platform === 'IOS') {
    return t('subscriptionSourceApple', {}, language);
  }

  if (platform === 'ANDROID') {
    return t('subscriptionSourceGoogle', {}, language);
  }

  if (platform === 'MANUAL') {
    return t('subscriptionSourceManual', {}, language);
  }

  return t('subscriptionSourceSubscription', {}, language);
}

function getSubscriptionProductLabel(productId: string, language: AppLanguage) {
  switch (productId) {
    case 'meetvap_monthly':
    case 'manual_1_month':
    case 'redeem_1_month':
      return t('subscriptionPlanMonthly', {}, language);
    case 'meetvap_3_month':
    case 'manual_3_month':
    case 'redeem_3_month':
      return t('subscriptionPlan3Month', {}, language);
    case 'meetvap_6_month':
    case 'manual_6_month':
    case 'redeem_6_month':
      return t('subscriptionPlan6Month', {}, language);
    case 'meetvap_yearly':
    case 'manual_12_month':
    case 'redeem_12_month':
      return t('subscriptionPlanYearly', {}, language);
    case 'manual_forever':
      return t('subscriptionPlanForever', {}, language);
    default:
      return productId;
  }
}

function formatSubscriptionDate(value: string | null | undefined, language: AppLanguage) {
  if (!value) {
    return t('subscriptionNoExpiry', {}, language);
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat(language, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp));
}

function createStyles(isDarkMode = false) {
  const eraseModalBorderColor = isDarkMode ? '#cbd5e1' : '#4b5563';

  return StyleSheet.create({
  content: {
    gap: spacing.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  eraseAlertMessageInput: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    minHeight: 120,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  eraseAlertModalScroll: {
    flexShrink: 1,
    minHeight: 0,
  },
  eraseAlertModalScrollContent: {
    gap: spacing.lg,
    paddingBottom: 2,
  },
  eraseAlertModal: {
    backgroundColor: colors.surface,
    borderColor: eraseModalBorderColor,
    borderRadius: 22,
    borderWidth: 1,
    elevation: 2,
    flexShrink: 1,
    gap: spacing.lg,
    maxWidth: 460,
    overflow: 'hidden',
    padding: spacing.xl,
    width: '100%',
    zIndex: 2,
  },
  eraseMessageKeyboardAccessory: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  eraseMessageKeyboardDoneButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: spacing.md,
  },
  eraseMessageKeyboardDoneText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '900',
  },
  eraseModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  eraseModalHeaderText: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  eraseModalIcon: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  eraseModalBackdrop: {
    alignItems: 'center',
    backgroundColor: isDarkMode ? 'rgba(0,0,0,0.82)' : 'rgba(15,23,42,0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  eraseModalSettingRow: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  erasePinTip: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: -spacing.sm,
    maxWidth: 330,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  erasePinTipArrow: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.primary,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 12,
    position: 'absolute',
    right: 70,
    top: -6,
    transform: [{ rotate: '45deg' }],
    width: 12,
  },
  erasePinTipText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  eraseRecipientRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 62,
    paddingVertical: spacing.sm,
  },
  eraseRecipientText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  emptyText: {
    color: colors.textSecondary,
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  eraseRecipientsBackButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  eraseRecipientsHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  eraseRecipientsList: {
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 120,
    minWidth: 0,
  },
  eraseRecipientsListContent: {
    flexGrow: 1,
  },
  eraseRecipientsSearchClear: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  eraseRecipientsSearchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: 42,
    padding: 0,
  },
  eraseRecipientsSearchWrap: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  headerLanguageButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  inlineIconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    marginRight: spacing.sm,
    width: 32,
  },
  settingsRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
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
  name: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '800',
  },
  editNameButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  editNameButtonPressed: {
    backgroundColor: colors.border,
  },
  nameInput: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  nameModal: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: spacing.md,
    padding: spacing.lg,
    width: '100%',
  },
  nameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: '100%',
  },
  profile: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.lg,
  },
  profileText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  premiumCornerIcon: {
    alignItems: 'center',
    backgroundColor: isDarkMode ? 'rgba(64, 158, 255, 0.18)' : 'rgba(64, 158, 255, 0.14)',
    borderColor: isDarkMode ? 'rgba(64, 158, 255, 0.38)' : 'rgba(64, 158, 255, 0.26)',
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: -1,
    top: -1,
    width: 32,
    zIndex: 1,
  },
  premiumUserLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '900',
  },
  premiumSettingsBox: {
    backgroundColor: isDarkMode ? 'rgba(64, 158, 255, 0.08)' : 'rgba(64, 158, 255, 0.06)',
    borderColor: isDarkMode ? 'rgba(64, 158, 255, 0.42)' : 'rgba(64, 158, 255, 0.34)',
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'visible',
    position: 'relative',
  },
  premiumSettingsDivider: {
    backgroundColor: isDarkMode ? 'rgba(64, 158, 255, 0.22)' : 'rgba(64, 158, 255, 0.18)',
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.lg,
  },
  premiumSettingsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    padding: spacing.lg,
    paddingRight: spacing.xl,
  },
  selectedUserChip: {
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.primary,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedUserChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: '700',
  },
  selectedUsersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  selectionButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  selectionButtonText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  settingsText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  settingsActionLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  settingsActionRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 56,
    padding: spacing.lg,
  },
  settingsActionText: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  shareProfileButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: 2,
  },
  shareProfileButtonPressed: {
    opacity: 0.72,
  },
  shareProfileText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  cancelDeleteButton: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  cancelDeleteText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '800',
  },
  deleteAccountButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 50,
  },
  deleteAccountText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '800',
  },
  versionText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    paddingVertical: spacing.sm,
    textAlign: 'center',
  },
  deleteBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  deleteForeverButton: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  deleteForeverButtonDisabled: {
    opacity: 0.42,
  },
  deleteForeverText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '900',
  },
  deleteModal: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: spacing.md,
    padding: spacing.lg,
    width: '100%',
  },
  deleteTitle: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: '900',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,32,51,0.42)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '900',
  },
  passwordInput: {
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  pinError: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '700',
  },
  pinModalAvoider: {
    flex: 1,
  },
  pinModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,15,28,0.76)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pinSetupText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  primaryModalButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  primaryModalButtonDisabled: {
    opacity: 0.56,
  },
  primaryModalButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryModalButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  secondaryModalButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '800',
  },
  subscriptionDetailBox: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  subscriptionDetailLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  subscriptionDetailRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  subscriptionDetailValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  subscriptionFeatureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 32,
  },
  subscriptionFeatureText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 19,
  },
  subscriptionFeatureTextInactive: {
    color: colors.textSecondary,
  },
  subscriptionFeaturesBlock: {
    gap: spacing.sm,
  },
  subscriptionFeaturesTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  subscriptionFooterCopy: {
    flex: 1,
    minWidth: 0,
  },
  subscriptionFooterLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '800',
  },
  subscriptionFooterRow: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    maxWidth: 360,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  subscriptionFooterText: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  subscriptionFooterValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '900',
  },
  subscriptionModal: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    gap: spacing.lg,
    maxWidth: 460,
    padding: spacing.lg,
    width: '100%',
  },
  subscriptionModalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  subscriptionModalHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  subscriptionModalIcon: {
    alignItems: 'center',
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  subscriptionModalSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  screen: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  username: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  usernameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  value: {
    color: colors.textPrimary,
    fontSize: 15,
  },
});
}

let styles = createStyles();
