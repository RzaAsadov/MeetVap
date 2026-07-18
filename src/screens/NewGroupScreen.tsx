import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { t } from '../i18n';
import { containsMeetVapKeyword } from '../lib/prohibitedNames';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { AuthUser } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type NewGroupRoute = RouteProp<RootStackParamList, 'NewGroup'>;

type Candidate = AuthUser & { title: string };

export function NewGroupScreen() {
  useThemeColors();
  styles = createStyles();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<NewGroupRoute>();
  const insets = useSafeAreaInsets();
  const isVoiceRoom = route.params?.mode === 'voiceRoom';
  const contacts = useAppStore((state) => state.contacts);
  const conversations = useAppStore((state) => state.conversations);
  const user = useAppStore((state) => state.user);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const startGroupConversation = useAppStore((state) => state.startGroupConversation);
  const startVoiceRoomConversation = useAppStore((state) => state.startVoiceRoomConversation);
  const [groupName, setGroupName] = useState('');
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreating, setCreating] = useState(false);
  const candidates = useMemo(() => getGroupCandidates(contacts, conversations, user?.id), [contacts, conversations, user?.id]);
  const visibleCandidates = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return candidates;
    }

    return candidates.filter((candidate) => (
      candidate.title.toLowerCase().includes(normalized) ||
      candidate.username.toLowerCase().includes(normalized)
    ));
  }, [candidates, query]);

  useFocusEffect(
    useCallback(() => {
      void Promise.all([loadContacts(), loadConversations()]).catch(() => undefined);
    }, [loadContacts, loadConversations]),
  );

  function toggleUser(userId: string) {
    setSelectedIds((current) => (
      current.includes(userId)
        ? current.filter((item) => item !== userId)
        : [...current, userId]
    ));
  }

  async function createGroup() {
    const title = groupName.trim();

    if (!title) {
      Alert.alert(t('groupNameNeeded'), t('enterGroupName'));
      return;
    }

    if (containsMeetVapKeyword(title)) {
      Alert.alert(t('couldNotCreateGroup'), t('meetvapNameProhibited'));
      return;
    }

    if (selectedIds.length === 0) {
      Alert.alert(t('choosePeople'), t('addAtLeastOnePerson'));
      return;
    }

    setCreating(true);

    try {
      const conversation = isVoiceRoom
        ? await startVoiceRoomConversation({ title, userIds: selectedIds })
        : await startGroupConversation({ title, userIds: selectedIds });
      navigation.replace('ChatRoom', { conversationId: conversation.id, isGroup: true, title: conversation.title });
    } catch (error) {
      Alert.alert(t('couldNotCreateGroup'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.form}>
        <Text style={styles.nameLabel}>{t(isVoiceRoom ? 'enterVoiceRoomNameLabel' : 'enterGroupNameLabel')}</Text>
        <TextInput
          onChangeText={setGroupName}
          placeholder={t(isVoiceRoom ? 'voiceRoomName' : 'groupName')}
          placeholderTextColor={colors.mutedText}
          style={styles.nameInput}
          value={groupName}
        />
        <View style={styles.searchWrap}>
          <Ionicons color={colors.mutedText} name="search" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder={t('searchPeople')}
            placeholderTextColor={colors.mutedText}
            style={styles.searchInput}
            value={query}
          />
        </View>
      </View>
      <FlatList
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 88 }, visibleCandidates.length === 0 && styles.emptyList]}
        data={visibleCandidates}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons color={colors.primary} name="people-outline" size={44} />
            <Text style={styles.emptyTitle}>{t('noPeopleFound')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = selectedIds.includes(item.id);

          return (
            <Pressable onPress={() => toggleUser(item.id)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <Avatar label={item.title} uri={item.avatarUrl} />
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.title}</Text>
                {item.username ? <Text style={styles.username}>@{item.username}</Text> : null}
              </View>
              <View style={[styles.selectButton, isSelected && styles.selectButtonActive]}>
                <Ionicons color={isSelected ? colors.white : colors.primary} name={isSelected ? 'checkmark' : 'add'} size={22} />
              </View>
            </Pressable>
          );
        }}
      />
      <Pressable disabled={isCreating} onPress={() => void createGroup()} style={({ pressed }) => [styles.createButton, { marginBottom: Math.max(insets.bottom + spacing.md, spacing.lg) }, pressed && styles.createButtonPressed]}>
        {isCreating ? <ActivityIndicator color={colors.white} /> : <Text style={styles.createButtonText}>{t(isVoiceRoom ? 'createVoiceGroup' : 'createGroup')}</Text>}
      </Pressable>
    </View>
  );
}

function getGroupCandidates(contacts: AuthUser[], conversations: { members?: AuthUser[]; otherUserId?: string; title: string; type?: string }[], currentUserId?: string) {
  const contactCandidates = new Map<string, Candidate>();
  const chatCandidates = new Map<string, Candidate>();

  contacts.forEach((contact) => {
    if (contact.id === currentUserId || contact.isSystem === true) {
      return;
    }

    contactCandidates.set(contact.id, {
      ...contact,
      title: contact.displayName || contact.username,
    });
  });

  conversations.forEach((conversation) => {
    if (!conversation.otherUserId || conversation.otherUserId === currentUserId || contactCandidates.has(conversation.otherUserId)) {
      return;
    }

    const chatUser = conversation.members?.find((member) => member.id === conversation.otherUserId);

    if (!chatUser || chatUser.isSystem === true) {
      return;
    }

    chatCandidates.set(chatUser.id, {
      ...chatUser,
      title: chatUser.displayName || chatUser.username || conversation.title,
    });
  });

  const sortByTitle = (left: Candidate, right: Candidate) => left.title.localeCompare(right.title);

  return [
    ...Array.from(contactCandidates.values()).sort(sortByTitle),
    ...Array.from(chatCandidates.values()).sort(sortByTitle),
  ];
}

function createStyles() {
  return StyleSheet.create({
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 26,
    margin: spacing.lg,
    minHeight: 52,
    justifyContent: 'center',
  },
  createButtonPressed: {
    opacity: 0.86,
  },
  createButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '800',
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
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  form: {
    backgroundColor: colors.surface,
    gap: spacing.md,
    padding: spacing.lg,
  },
  list: {
    backgroundColor: colors.surface,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  nameInput: {
    borderColor: colors.textPrimary,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 18,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  nameLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: '#eef6ff',
  },
  rowText: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 2,
    paddingBottom: spacing.md,
  },
  screen: {
    backgroundColor: colors.surface,
    flex: 1,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    minHeight: 42,
    padding: 0,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderRadius: 20,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  selectButton: {
    alignItems: 'center',
    borderColor: colors.primary,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  selectButtonActive: {
    backgroundColor: colors.primary,
  },
  username: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
}

let styles = createStyles();
