import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { ScreenBackground } from '../components/ScreenBackground';
import { useVoiceCallTip } from '../hooks/useVoiceCallTip';
import { buildSharedContactMessage } from '../lib/shareLinks';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { AuthUser } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function ContactsScreen() {
  useThemeColors();
  styles = createStyles();
  const navigation = useNavigation<Navigation>();
  const contacts = useAppStore((state) => state.contacts);
  const language = useAppStore((state) => state.language);
  const user = useAppStore((state) => state.user);
  const blockUserById = useAppStore((state) => state.blockUserById);
  const deleteContactById = useAppStore((state) => state.deleteContactById);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const prepareConversationMessages = useAppStore((state) => state.prepareConversationMessages);
  const startDirectConversation = useAppStore((state) => state.startDirectConversation);
  const [isLoading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedContact, setSelectedContact] = useState<AuthUser | null>(null);
  const { showVoiceCallTip, voiceCallTipModal } = useVoiceCallTip(user?.id);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitleAlign: 'left',
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel={t('addContact')} onPress={() => navigation.navigate('AddContact')} style={styles.headerButton}>
            <Ionicons color={colors.white} name="person-add-outline" size={23} />
          </Pressable>
        </View>
      ),
    });
  }, [language, navigation]);

  const refreshContacts = useCallback(() => {
    setLoading(true);
    loadContacts()
      .catch((error) => {
        Alert.alert(t('couldNotLoadContacts'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      })
      .finally(() => setLoading(false));
  }, [loadContacts]);

  const trimmedSearch = search.trim().toLowerCase();
  const isSearchActive = trimmedSearch.length >= 2;
  const visibleContacts = useMemo(() => {
    if (!isSearchActive) {
      return contacts;
    }

    return contacts.filter((contact) => {
      const displayName = (contact.displayName ?? '').toLowerCase();
      const username = contact.username.toLowerCase();

      return displayName.includes(trimmedSearch) || username.includes(trimmedSearch);
    });
  }, [contacts, isSearchActive, trimmedSearch]);

  useFocusEffect(refreshContacts);

  async function openContact(contact: AuthUser) {
    try {
      const conversation = await startDirectConversation(contact.id);
      await prepareConversationMessages(conversation.id, { limit: 80 }).catch(() => undefined);
      navigation.navigate('ChatRoom', { conversationId: conversation.id, title: conversation.title });
    } catch (error) {
      Alert.alert(t('couldNotOpenChat'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function callContact(contact: AuthUser, mode: 'voice' | 'video') {
    const title = contact.displayName || contact.username;

    if (mode === 'voice') {
      await showVoiceCallTip();
    }

    Alert.alert(
      mode === 'video' ? t('startVideoCallQuestion') : t('startVoiceCallQuestion'),
      t('callNameQuestion', { name: title }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('call'),
          onPress: () => {
            void startConfirmedContactCall(contact, mode);
          },
        },
      ],
    );
  }

  async function startConfirmedContactCall(contact: AuthUser, mode: 'voice' | 'video') {
    try {
      const conversation = await startDirectConversation(contact.id);
      navigation.navigate('CallRoom', {
        conversationId: conversation.id,
        direction: 'outgoing',
        mode,
        title: conversation.title,
      });
    } catch (error) {
      Alert.alert(t('couldNotStartCall'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function showContactMenu(contact: AuthUser) {
    setSelectedContact(contact);
  }

  function closeContactMenu() {
    setSelectedContact(null);
  }

  function runContactMenuAction(action: () => Promise<void> | void, failureTitle: string) {
    closeContactMenu();
    void Promise.resolve(action()).catch((error) => {
      Alert.alert(failureTitle, error instanceof Error ? error.message : t('pleaseTryAgain'));
    });
  }

  return (
    <ScreenBackground style={styles.screen}>
      <View style={styles.topTools}>
        <View style={styles.searchWrap}>
          <Ionicons color={colors.mutedText} name="search" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder={t('searchContacts')}
            placeholderTextColor={colors.mutedText}
            style={styles.searchInput}
            value={search}
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} style={styles.clearSearch}>
              <Ionicons color={colors.mutedText} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <FlatList
        contentContainerStyle={[styles.list, visibleContacts.length === 0 && styles.emptyList]}
        data={visibleContacts}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            {isLoading ? (
              <ActivityIndicator color={colors.primary} size="large" />
            ) : trimmedSearch.length > 0 && !isSearchActive ? (
              <>
                <Ionicons color={colors.primary} name="search-outline" size={44} />
                <Text style={styles.emptyTitle}>{t('typeAtLeast2Characters')}</Text>
                <Text style={styles.emptyText}>{t('typeAtLeast2CharactersToFind')}</Text>
              </>
            ) : isSearchActive ? (
              <>
                <Ionicons color={colors.primary} name="search-outline" size={44} />
                <Text style={styles.emptyTitle}>{t('noMatches')}</Text>
                <Text style={styles.emptyText}>{t('tryAnotherSearch')}</Text>
              </>
            ) : (
              <>
                <Ionicons color={colors.primary} name="people-outline" size={44} />
                <Text style={styles.emptyTitle}>{t('noContactsYet')}</Text>
                <Text style={styles.emptyText}>{t('contactsEmpty')}</Text>
              </>
            )}
          </View>
        }
        onRefresh={refreshContacts}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() => showContactMenu(item)}
            onPress={() => void openContact(item)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <Avatar label={item.displayName || item.username} uri={item.avatarUrl} />
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.displayName || item.username}</Text>
              {item.username ? <Text style={styles.username}>@{item.username}</Text> : null}
            </View>
            <View style={styles.actions}>
              <Pressable onPress={() => void openContact(item)} style={styles.actionButton}>
                <Ionicons color={colors.primary} name="chatbubble-outline" size={22} />
              </Pressable>
              <Pressable onPress={() => void callContact(item, 'voice')} style={styles.actionButton}>
                <Ionicons color={colors.primary} name="call-outline" size={22} />
              </Pressable>
              <Pressable onPress={() => void callContact(item, 'video')} style={styles.actionButton}>
                <Ionicons color={colors.primary} name="videocam-outline" size={23} />
              </Pressable>
            </View>
          </Pressable>
        )}
      />
      <Modal animationType="fade" transparent visible={!!selectedContact} onRequestClose={closeContactMenu}>
        <Pressable onPress={closeContactMenu} style={styles.menuBackdrop}>
          <Pressable style={styles.menuCard}>
            <Text numberOfLines={1} style={styles.menuTitle}>{selectedContact?.displayName || selectedContact?.username}</Text>
            <ContactMenuAction
              icon="share-social-outline"
              label={t('shareContact')}
              onPress={() => selectedContact && runContactMenuAction(async () => {
                const payload = buildSharedContactMessage(selectedContact);
                await Share.share(payload);
              }, t('shareFailed'))}
            />
            <ContactMenuAction
              destructive
              icon="trash-outline"
              label={t('deleteContact')}
              onPress={() => selectedContact && runContactMenuAction(() => deleteContactById(selectedContact.id), t('deleteFailed'))}
            />
            <ContactMenuAction
              destructive
              icon="ban-outline"
              label={t('blockUser')}
              onPress={() => selectedContact && runContactMenuAction(() => blockUserById(selectedContact.id), t('blockFailed'))}
            />
            <ContactMenuAction icon="close-outline" label={t('cancel')} onPress={closeContactMenu} />
          </Pressable>
        </Pressable>
      </Modal>
      {voiceCallTipModal}
    </ScreenBackground>
  );
}

function ContactMenuAction({
  destructive = false,
  icon,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuAction, pressed && styles.menuActionPressed]}>
      <Ionicons color={destructive ? colors.danger : colors.primary} name={icon} size={22} />
      <Text style={[styles.menuActionText, destructive && styles.menuActionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function createStyles() {
  return StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 34,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  blockedUsersButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.72)',
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    marginRight: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  blockedUsersButtonText: {
    color: colors.white,
    fontSize: 13,
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
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    maxWidth: 220,
  },
  headerButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  list: {
    backgroundColor: 'transparent',
  },
  menuAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuActionPressed: {
    backgroundColor: colors.appBackground,
  },
  menuActionText: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  menuActionTextDanger: {
    color: colors.danger,
  },
  menuBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  menuCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.xs,
    maxWidth: 360,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    width: '100%',
  },
  menuTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },
  clearSearch: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  rowText: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 2,
    paddingBottom: spacing.md,
  },
  screen: {
    backgroundColor: 'transparent',
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
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  topTools: {
    alignItems: 'center',
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
  },
  username: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
}

let styles = createStyles();
