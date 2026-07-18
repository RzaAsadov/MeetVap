import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { TextField } from '../components/TextField';
import { t } from '../i18n';
import { searchUsers } from '../lib/backend';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import { AuthUser } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'AddContact'>;

export function AddContactScreen({ navigation }: Props) {
  useThemeColors();
  styles = createStyles();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const contacts = useAppStore((state) => state.contacts);
  const user = useAppStore((state) => state.user);
  const addUserToContacts = useAppStore((state) => state.addUserToContacts);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [addedUserIds, setAddedUserIds] = useState<string[]>([]);
  const searchIdRef = useRef(0);
  const trimmedQuery = query.trim();
  const contactIds = useMemo(() => new Set(contacts.map((contact) => contact.id)), [contacts]);
  const excludedIds = useMemo(() => new Set([
    ...Array.from(contactIds),
    ...addedUserIds,
    ...(user?.id ? [user.id] : []),
  ]), [addedUserIds, contactIds, user?.id]);
  const visibleUsers = useMemo(
    () => users.filter((item) => !excludedIds.has(item.id)),
    [excludedIds, users],
  );

  useEffect(() => {
    void loadContacts().catch(() => undefined);
  }, [loadContacts]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, 450);

    return () => clearTimeout(timeout);
  }, [trimmedQuery]);

  useEffect(() => {
    const nextSearchId = searchIdRef.current + 1;
    searchIdRef.current = nextSearchId;

    if (!serverUrl || debouncedQuery.length < 2) {
      setUsers([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    searchUsers(serverUrl, debouncedQuery)
      .then((response) => {
        if (searchIdRef.current === nextSearchId) {
          setUsers(response.users);
        }
      })
      .catch((error) => {
        if (searchIdRef.current === nextSearchId) {
          Alert.alert(t('searchFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
        }
      })
      .finally(() => {
        if (searchIdRef.current === nextSearchId) {
          setSearching(false);
        }
      });
  }, [debouncedQuery, serverUrl]);

  async function addContact(userToAdd: AuthUser) {
    if (addingUserId) {
      return;
    }

    setAddingUserId(userToAdd.id);

    try {
      await addUserToContacts(userToAdd.id);
      setAddedUserIds((current) => current.includes(userToAdd.id) ? current : [...current, userToAdd.id]);
      Alert.alert(t('contactAdded'), t('contactAddedMessage', { name: userToAdd.displayName || userToAdd.username }), [
        { text: t('done'), onPress: () => navigation.goBack() },
        { text: t('addAnother'), style: 'cancel' },
      ]);
    } catch (error) {
      Alert.alert(t('couldNotAddContact'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setAddingUserId(null);
    }
  }

  function renderEmptyState() {
    if (trimmedQuery.length < 2) {
      return (
        <View style={styles.empty}>
          <Ionicons color={colors.primary} name="person-add-outline" size={44} />
          <Text style={styles.emptyTitle}>{t('searchContacts')}</Text>
          <Text style={styles.emptyText}>{t('typeAtLeast2CharactersToFind')}</Text>
        </View>
      );
    }

    if (isSearching) {
      return null;
    }

    return (
      <View style={styles.empty}>
        <Ionicons color={colors.primary} name="search-outline" size={44} />
        <Text style={styles.emptyTitle}>{t('noNewContacts')}</Text>
        <Text style={styles.emptyText}>{t('existingContactsHidden')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <TextField
        autoCapitalize="none"
        autoCorrect={false}
        label={t('searchByUsernameOrName')}
        onChangeText={setQuery}
        placeholder={t('typeAtLeast2Characters')}
        value={query}
      />
      {isSearching ? <ActivityIndicator color={colors.primary} /> : null}
      <FlatList
        contentContainerStyle={[styles.list, visibleUsers.length === 0 && styles.emptyList]}
        data={visibleUsers}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={renderEmptyState}
        renderItem={({ item }) => {
          const isAdding = addingUserId === item.id;

          return (
            <Pressable
              disabled={addingUserId !== null}
              onPress={() => void addContact(item)}
              style={({ pressed }) => [
                styles.row,
                pressed && styles.rowPressed,
                isAdding && styles.rowAdding,
              ]}
            >
              <Avatar label={item.displayName || item.username} uri={item.avatarUrl} />
              <View style={styles.userText}>
                <Text numberOfLines={1} style={styles.name}>{item.displayName || item.username}</Text>
                {item.username ? <Text numberOfLines={1} style={styles.username}>@{item.username}</Text> : null}
              </View>
              <View style={styles.addButton}>
                {isAdding ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Ionicons color={colors.primary} name="person-add-outline" size={24} />
                )}
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
  addButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  list: {
    gap: spacing.xs,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowAdding: {
    opacity: 0.65,
  },
  rowPressed: {
    opacity: 0.78,
  },
  screen: {
    backgroundColor: colors.appBackground,
    flex: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  username: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  userText: {
    flex: 1,
    gap: spacing.xs,
  },
});
}

let styles = createStyles();
