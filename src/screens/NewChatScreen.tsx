import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { TextField } from '../components/TextField';
import { t } from '../i18n';
import { searchUsers } from '../lib/backend';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { AuthUser } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'NewChat'>;

export function NewChatScreen({ navigation }: Props) {
  useThemeColors();
  styles = createStyles();
  const serverUrl = useAppStore((state) => state.serverUrl);
  const contacts = useAppStore((state) => state.contacts);
  const conversations = useAppStore((state) => state.conversations);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const startDirectConversation = useAppStore((state) => state.startDirectConversation);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [isSearching, setSearching] = useState(false);
  const [startingUserId, setStartingUserId] = useState<string | null>(null);
  const defaultUsers = useMemo(() => {
    const chatUsers = conversations.reduce<AuthUser[]>((items, conversation) => {
      if (conversation.type === 'GROUP' || !conversation.otherUserId) {
        return items;
      }

      const otherUser = conversation.members?.find((member) => member.id === conversation.otherUserId);

      if (otherUser && !items.some((item) => item.id === otherUser.id)) {
        items.push({ ...otherUser, isContact: conversation.isContact ?? otherUser.isContact });
      }

      return items;
    }, []);
    const chatUserIds = new Set(chatUsers.map((item) => item.id));
    const contactUsers = contacts
      .filter((contact) => !chatUserIds.has(contact.id))
      .map((contact) => ({ ...contact, isContact: true }));

    return [...chatUsers, ...contactUsers];
  }, [contacts, conversations]);
  const visibleUsers = query.trim().length >= 2 ? users : defaultUsers;

  useEffect(() => {
    void Promise.all([loadConversations(), loadContacts()]).catch(() => undefined);
  }, [loadContacts, loadConversations]);

  async function handleSearch(value: string) {
    setQuery(value);

    if (!serverUrl || value.trim().length < 2) {
      setUsers([]);
      return;
    }

    setSearching(true);

    try {
      const response = await searchUsers(serverUrl, value.trim());
      setUsers(response.users);
    } catch (error) {
      Alert.alert(t('searchFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setSearching(false);
    }
  }

  function chooseUserAction(user: AuthUser) {
    if (startingUserId) {
      return;
    }

    void startChat(user);
  }

  async function startChat(user: AuthUser) {
    if (startingUserId) {
      return;
    }

    setStartingUserId(user.id);

    try {
      const conversation = await startDirectConversation(user.id);
      navigation.replace('ChatRoom', {
        conversationId: conversation.id,
        title: conversation.title || user.displayName || user.username,
      });
    } catch (error) {
      Alert.alert(t('couldNotStartChat'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setStartingUserId(null);
    }
  }

  return (
    <View style={styles.screen}>
      <TextField
        autoCapitalize="none"
        autoCorrect={false}
        label={t('searchByUsernameOrName')}
        onChangeText={handleSearch}
        placeholder={t('typeAtLeast2Characters')}
        value={query}
      />
      {isSearching ? <ActivityIndicator color={colors.primary} /> : null}
      <FlatList
        data={visibleUsers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            disabled={startingUserId !== null}
            onPress={() => chooseUserAction(item)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
              startingUserId === item.id && styles.rowStarting,
            ]}
          >
            <Avatar label={item.displayName || item.username} uri={item.avatarUrl} />
            <View style={styles.userText}>
              <Text style={styles.name}>{item.displayName || item.username}</Text>
              {item.username || item.isContact ? <Text style={styles.username}>{item.username ? `@${item.username}` : ''}{item.isContact ? `${item.username ? ' · ' : ''}contact` : ''}</Text> : null}
            </View>
            {startingUserId === item.id ? <ActivityIndicator color={colors.primary} /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
  name: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    opacity: 0.75,
  },
  rowStarting: {
    opacity: 0.65,
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
    gap: spacing.xs,
  },
});
}

let styles = createStyles();
