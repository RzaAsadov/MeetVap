import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';

export function BlockedUsersScreen() {
  useThemeColors();
  styles = createStyles();
  const blockedUsers = useAppStore((state) => state.blockedUsers);
  const loadBlockedUsers = useAppStore((state) => state.loadBlockedUsers);
  const unblockUserById = useAppStore((state) => state.unblockUserById);
  const [isLoading, setLoading] = useState(false);

  const refreshBlockedUsers = useCallback(() => {
    setLoading(true);
    loadBlockedUsers()
      .catch((error) => {
        Alert.alert(t('couldNotLoadBlockedUsers'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      })
      .finally(() => setLoading(false));
  }, [loadBlockedUsers]);

  useFocusEffect(refreshBlockedUsers);

  function confirmUnblock(userId: string, title: string) {
    Alert.alert(t('unblockUserQuestion'), t('unblockUserMessage', { name: title }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('unblock'),
        onPress: () => {
          void unblockUserById(userId).catch((error) => {
            Alert.alert(t('unblockFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
          });
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={[styles.list, blockedUsers.length === 0 && styles.emptyList]}
        data={blockedUsers}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : (
              <>
                <Ionicons color={colors.primary} name="ban-outline" size={44} />
                <Text style={styles.emptyTitle}>{t('noBlockedUsers')}</Text>
              </>
            )}
          </View>
        }
        onRefresh={refreshBlockedUsers}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Avatar label={item.displayName || item.username} uri={item.avatarUrl} />
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.displayName || item.username}</Text>
              {item.username ? <Text style={styles.username}>@{item.username}</Text> : null}
            </View>
            <Pressable onPress={() => confirmUnblock(item.id, item.displayName || item.username)} style={styles.unblockButton}>
              <Text style={styles.unblockText}>{t('unblock')}</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  list: {
    backgroundColor: colors.surface,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  screen: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  unblockButton: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  unblockText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  username: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
}

let styles = createStyles();
