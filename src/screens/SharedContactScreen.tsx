import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { PrimaryButton } from '../components/PrimaryButton';
import { t } from '../i18n';
import { ApiError } from '../lib/api';
import { getSharedUser } from '../lib/backend';
import { buildSharedContactMessage } from '../lib/shareLinks';
import { type AppState, useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import { AuthUser } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'SharedContact'>;

export function SharedContactScreen({ navigation, route }: Props) {
  useThemeColors();
  styles = createStyles();
  const serverUrl = useAppStore((state: AppState) => state.serverUrl);
  const currentUser = useAppStore((state: AppState) => state.user);
  const addUserToContacts = useAppStore((state: AppState) => state.addUserToContacts);
  const startDirectConversation = useAppStore((state: AppState) => state.startDirectConversation);
  const [sharedUser, setSharedUser] = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [isStartingChat, setStartingChat] = useState(false);
  const [isSavingContact, setSavingContact] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const normalizedShareCode = useMemo(
    () => route.params.username.trim().replace(/^@+/, ''),
    [route.params.username],
  );
  const isOwnProfile = sharedUser?.id === currentUser?.id || normalizedShareCode === currentUser?.publicShareCode;

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: colors.chatHeader },
      headerTintColor: colors.white,
      title: t('sharedContact'),
    });
  }, [navigation]);

  useEffect(() => {
    if (!serverUrl || !normalizedShareCode) {
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setErrorMessage(null);

    getSharedUser(serverUrl, normalizedShareCode)
      .then((response) => {
        if (!isCancelled) {
          setSharedUser(response.user);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          if (error instanceof ApiError && error.status === 404) {
            setErrorMessage(t('sharedContactNotFound'));
          } else {
            setErrorMessage(error instanceof Error ? error.message : t('sharedContactOpenFailed'));
          }
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [normalizedShareCode, serverUrl]);

  async function openChat() {
    if (!sharedUser) {
      return;
    }

    if (!currentUser) {
      navigation.navigate('Auth');
      return;
    }

    if (isOwnProfile) {
      navigation.navigate('MainTabs');
      return;
    }

    setStartingChat(true);

    try {
      const conversation = await startDirectConversation(sharedUser.id);
      navigation.dispatch(CommonActions.reset({
        index: 1,
        routes: [
          { name: 'MainTabs', params: { screen: 'Chats' } },
          {
            name: 'ChatRoom',
            params: {
              conversationId: conversation.id,
              title: conversation.title || sharedUser.displayName || t('sharedContact'),
            },
          },
        ],
      }));
    } catch (error) {
      Alert.alert(t('couldNotOpenChat'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setStartingChat(false);
    }
  }

  async function saveContact() {
    if (!sharedUser || !currentUser || isOwnProfile || sharedUser.isContact) {
      return;
    }

    setSavingContact(true);

    try {
      await addUserToContacts(sharedUser.id);
      setSharedUser((current) => current ? { ...current, isContact: true } : current);
    } catch (error) {
      Alert.alert(t('couldNotAddContact'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setSavingContact(false);
    }
  }

  async function shareAgain() {
    if (!sharedUser) {
      return;
    }

    try {
      const payload = buildSharedContactMessage(sharedUser);
      await Share.share(payload);
    } catch {
      Alert.alert(t('shareFailed'), t('pleaseTryAgain'));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.avatarWrap}>
            <Avatar label={sharedUser?.displayName || 'M'} size={92} uri={sharedUser?.avatarUrl} />
        </View>
        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.stateText}>{t('sharedContactOpening')}</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateBox}>
            <Ionicons color={colors.danger} name="alert-circle-outline" size={42} />
            <Text style={styles.stateTitle}>{t('unavailable')}</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
          </View>
        ) : sharedUser ? (
          <>
            <Text style={styles.name}>{sharedUser.displayName || t('sharedContact')}</Text>
            <Text style={styles.description}>
              {isOwnProfile
                ? t('sharedContactOwnProfile')
                : currentUser
                  ? t('sharedContactSignedInDescription')
                  : t('sharedContactSignedOutDescription')}
            </Text>

            <View style={styles.actions}>
              <PrimaryButton
                disabled={isLoading || isStartingChat}
                onPress={() => void openChat()}
                title={
                  isStartingChat
                    ? t('opening')
                    : currentUser
                      ? (isOwnProfile ? t('openMeetVap') : t('message'))
                      : t('signIn')
                }
              />
              {!isOwnProfile && currentUser ? (
                <Pressable
                  disabled={isSavingContact || sharedUser.isContact}
                  onPress={() => void saveContact()}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    sharedUser.isContact ? styles.secondaryButtonDisabled : undefined,
                    pressed && !sharedUser.isContact ? styles.secondaryButtonPressed : undefined,
                  ]}
                >
                  <Ionicons color={sharedUser.isContact ? colors.textSecondary : colors.primary} name="person-add-outline" size={18} />
                  <Text style={[styles.secondaryButtonText, sharedUser.isContact ? styles.secondaryButtonTextDisabled : undefined]}>
                    {isSavingContact ? t('saving') : sharedUser.isContact ? t('savedToContacts') : t('addToContacts')}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => void shareAgain()} style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}>
                <Ionicons color={colors.primary} name="share-social-outline" size={18} />
                <Text style={styles.linkButtonText}>{t('shareThisContact')}</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function createStyles() {
  return StyleSheet.create({
    actions: {
      gap: spacing.md,
      marginTop: spacing.lg,
      width: '100%',
    },
    avatarWrap: {
      marginBottom: spacing.lg,
    },
    card: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: spacing.xl,
      width: '100%',
    },
    content: {
      padding: spacing.lg,
    },
    description: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    linkButton: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      paddingVertical: spacing.sm,
    },
    linkButtonPressed: {
      opacity: 0.75,
    },
    linkButtonText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    name: {
      color: colors.textPrimary,
      fontSize: 28,
      fontWeight: '800',
      textAlign: 'center',
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.sm,
      justifyContent: 'center',
      minHeight: 50,
      paddingHorizontal: spacing.lg,
    },
    secondaryButtonDisabled: {
      opacity: 0.72,
    },
    secondaryButtonPressed: {
      opacity: 0.82,
    },
    secondaryButtonText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    secondaryButtonTextDisabled: {
      color: colors.textSecondary,
    },
    stateBox: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg,
    },
    stateText: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
    },
    stateTitle: {
      color: colors.textPrimary,
      fontSize: 22,
      fontWeight: '800',
    },
    username: {
      color: colors.primary,
      fontSize: 16,
      fontWeight: '700',
      marginTop: spacing.xs,
    },
  });
}

let styles = createStyles();
