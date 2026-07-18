import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { PrimaryButton } from '../components/PrimaryButton';
import { t } from '../i18n';
import { ApiError } from '../lib/api';
import { getPublicGroupInvite, joinPublicGroupInvite } from '../lib/backend';
import { type AppState, useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'SharedGroup'>;

type PublicGroupInvite = {
  avatarUrl?: string | null;
  id: string;
  memberCount: number;
  title: string;
};

export function SharedGroupScreen({ navigation, route }: Props) {
  useThemeColors();
  styles = createStyles();
  const serverUrl = useAppStore((state: AppState) => state.serverUrl);
  const currentUser = useAppStore((state: AppState) => state.user);
  const loadConversations = useAppStore((state: AppState) => state.loadConversations);
  const [group, setGroup] = useState<PublicGroupInvite | null>(null);
  const [isJoining, setJoining] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inviteCode = useMemo(() => route.params.code.trim(), [route.params.code]);

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: colors.chatHeader },
      headerTintColor: colors.white,
      title: t('groupInvite'),
    });
  }, [navigation]);

  useEffect(() => {
    if (!serverUrl || !inviteCode) {
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setErrorMessage(null);

    getPublicGroupInvite(serverUrl, inviteCode)
      .then((response) => {
        if (!isCancelled) {
          setGroup(response.group);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setErrorMessage(error instanceof ApiError && error.status === 404
            ? t('groupInviteNotFound')
            : error instanceof Error ? error.message : t('groupInviteOpenFailed'));
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
  }, [inviteCode, serverUrl]);

  async function joinGroup() {
    if (!serverUrl || !group) {
      return;
    }

    if (!currentUser) {
      navigation.navigate('Auth');
      return;
    }

    setJoining(true);

    try {
      const conversation = await joinPublicGroupInvite(serverUrl, inviteCode);
      await loadConversations().catch(() => undefined);
      navigation.dispatch(CommonActions.reset({
        index: 1,
        routes: [
          { name: 'MainTabs', params: { screen: 'Chats' } },
          {
            name: 'ChatRoom',
            params: {
              conversationId: conversation.id,
              isGroup: true,
              title: conversation.title || group.title,
            },
          },
        ],
      }));
    } catch (error) {
      Alert.alert(t('groupInviteJoinFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setJoining(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.card}>
        <Avatar label={group?.title || 'M'} size={92} uri={group?.avatarUrl} />
        {isLoading ? (
          <View style={styles.stateBox}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.stateText}>{t('groupInviteOpening')}</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateBox}>
            <Ionicons color={colors.danger} name="alert-circle-outline" size={42} />
            <Text style={styles.stateTitle}>{t('unavailable')}</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
          </View>
        ) : group ? (
          <>
            <Text style={styles.name}>{group.title}</Text>
            <Text style={styles.description}>{t('groupInviteDescription', { count: group.memberCount })}</Text>
            <View style={styles.actions}>
              <PrimaryButton
                disabled={isJoining}
                onPress={() => void joinGroup()}
                title={isJoining ? t('joining') : currentUser ? t('joinGroup') : t('signIn')}
              />
              <Pressable onPress={() => navigation.navigate('MainTabs')} style={({ pressed }) => [styles.linkButton, pressed && styles.linkButtonPressed]}>
                <Text style={styles.linkButtonText}>{t('notNow')}</Text>
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
      marginTop: spacing.lg,
      textAlign: 'center',
    },
    screen: {
      backgroundColor: colors.appBackground,
      flex: 1,
    },
    stateBox: {
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    stateText: {
      color: colors.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
    },
    stateTitle: {
      color: colors.textPrimary,
      fontSize: 20,
      fontWeight: '800',
    },
  });
}

let styles = createStyles();
