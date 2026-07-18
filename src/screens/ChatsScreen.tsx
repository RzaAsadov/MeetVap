import { Ionicons } from '@expo/vector-icons';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { CompositeNavigationProp } from '@react-navigation/native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, InteractionManager, Modal, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { HelpWebViewModal } from '../components/HelpWebViewModal';
import { PremiumUserBadge } from '../components/PremiumUserBadge';
import { ScreenBackground } from '../components/ScreenBackground';
import { t, type AppLanguage } from '../i18n';
import { createMeeting } from '../lib/backend';
import { getActiveMeetingSession, setActiveMeetingSession } from '../lib/activeMeetingSession';
import { buildReportReason, getReportContextNotice } from '../lib/reporting';
import { buildSharedContactMessage } from '../lib/shareLinks';
import { CONVERSATION_LIST_STALE_MS, isServerSideConversationFilter, type ConversationListFilter } from '../lib/conversationList';
import { getStoredFavoriteConversationIds, setStoredFavoriteConversationIds } from '../lib/storage';
import { CONVERSATION_MUTE_OPTIONS, isConversationMuted } from '../lib/conversationMute';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { isMeetVapSystemConversation, MEETVAP_SYSTEM_AVATAR_URL } from '../lib/systemChat';
import { logUiPerformanceDiagnostic, useUiPerformanceStallMonitor } from '../lib/uiPerformanceDiagnostics';
import { useConversationById } from '../hooks/useConversationById';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { AuthUser, Conversation, SubscriptionStatus } from '../types/domain';
import { MainTabParamList, RootStackParamList } from '../types/navigation';

type Navigation = CompositeNavigationProp<
  BottomTabNavigationProp<MainTabParamList, 'Chats'>,
  NativeStackNavigationProp<RootStackParamList>
>;

type ChatFilter = ConversationListFilter;

type ChatMenuState = {
  conversationId: string;
  isBlocked: boolean;
  isContact?: boolean;
  isFavorite: boolean;
  isGroupAdmin?: boolean;
  isGroupOwner?: boolean;
  isMuted: boolean;
  isSystem?: boolean;
  otherUserId?: string;
  title: string;
  type?: Conversation['type'];
};

const CHAT_FILTERS: { key: ChatFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'unread', label: 'unread' },
  { key: 'groups', label: 'groups' },
  { key: 'favorites', label: 'favorites' },
];
const APP_FEATURES_ICON_COLOR = '#facc15';
const DATE_LOCALE_BY_LANGUAGE: Record<AppLanguage, string> = {
  az: 'az-AZ',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  'pt-BR': 'pt-BR',
  ru: 'ru-RU',
  tr: 'tr-TR',
};

export function ChatsScreen() {
  useThemeColors();
  const navigation = useNavigation<Navigation>();
  const blockedUsers = useAppStore((state) => state.blockedUsers);
  const contacts = useAppStore((state) => state.contacts);
  const conversations = useAppStore((state) => state.conversations);
  const conversationsFilter = useAppStore((state) => state.conversationsFilter);
  const hasLoadedConversations = useAppStore((state) => state.hasLoadedConversations);
  const hasMoreConversations = useAppStore((state) => state.hasMoreConversations);
  const isDarkMode = useAppStore((state) => state.isDarkMode);
  styles = useMemo(() => createStyles(), [isDarkMode]);
  const isRefreshingConversations = useAppStore((state) => state.isRefreshingConversations);
  const language = useAppStore((state) => state.language);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const statusGroups = useAppStore((state) => state.statusGroups);
  const user = useAppStore((state) => state.user);
  const addUserToContacts = useAppStore((state) => state.addUserToContacts);
  const blockUserById = useAppStore((state) => state.blockUserById);
  const deleteChat = useAppStore((state) => state.deleteChat);
  const declineGroupInvite = useAppStore((state) => state.declineGroupInvite);
  const isLoadingConversations = useAppStore((state) => state.isLoadingConversations);
  const isLoadingMoreConversations = useAppStore((state) => state.isLoadingMoreConversations);
  const loadBlockedUsers = useAppStore((state) => state.loadBlockedUsers);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const loadMoreConversations = useAppStore((state) => state.loadMoreConversations);
  const loadMessages = useAppStore((state) => state.loadMessages);
  const loadStatuses = useAppStore((state) => state.loadStatuses);
  const markAllConversationsReadNow = useAppStore((state) => state.markAllConversationsReadNow);
  const reportTarget = useAppStore((state) => state.reportTarget);
  const revokeGroupAdmin = useAppStore((state) => state.revokeGroupAdmin);
  const unblockUserById = useAppStore((state) => state.unblockUserById);
  const updateConversationMute = useAppStore((state) => state.updateConversationMute);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ChatFilter>('all');
  const [blockGroupMenu, setBlockGroupMenu] = useState<ChatMenuState | null>(null);
  const [chatMenu, setChatMenu] = useState<ChatMenuState | null>(null);
  const [muteMenu, setMuteMenu] = useState<ChatMenuState | null>(null);
  const [favoriteConversationIds, setFavoriteConversationIds] = useState<string[]>([]);
  const [isHeaderMenuVisible, setHeaderMenuVisible] = useState(false);
  const [isMeetTypeMenuVisible, setMeetTypeMenuVisible] = useState(false);
  const [isShareMyContactModalVisible, setShareMyContactModalVisible] = useState(false);
  const [isSubscriptionInfoVisible, setSubscriptionInfoVisible] = useState(false);
  const [isSupportModalVisible, setSupportModalVisible] = useState(false);
  const debouncedSearchRef = useRef('');
  const hasLoadedFocusedConversationsRef = useRef(false);
  const lastChatOpenRef = useRef<{ conversationId: string; openedAt: number } | null>(null);
  const pendingShareMyContactRef = useRef(false);
  const trimmedSearch = search.trim();
  const emptyTitle = getEmptyTitle(trimmedSearch, activeFilter, language);
  const emptyText = getEmptyText(trimmedSearch, activeFilter, language);
  const blockedUserIds = useMemo(() => new Set(blockedUsers.map((blockedUser) => blockedUser.id)), [blockedUsers]);
  const contactsById = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const canUsePremiumFeatures = hasPremiumAccess(subscriptionStatus);
  const diagnosticsScopeDetails = useMemo(() => ({
    conversationCount: conversations.length,
    screen: 'ChatsScreen',
  }), [conversations.length]);
  useUiPerformanceStallMonitor('ChatsScreen', diagnosticsScopeDetails);
  const subscriptionDetails = useMemo(
    () => getChatSubscriptionDetails(subscriptionStatus, language, canUsePremiumFeatures),
    [canUsePremiumFeatures, language, subscriptionStatus],
  );
  const unviewedStatusAuthorIds = useMemo(() => new Set(
    statusGroups
      .filter((group) => group.hasUnviewed && group.author.id !== user?.id)
      .map((group) => group.author.id),
  ), [statusGroups, user?.id]);
  const unviewedStatusAuthorKey = useMemo(
    () => [...unviewedStatusAuthorIds].sort().join(','),
    [unviewedStatusAuthorIds],
  );

  useFocusEffect(
    useCallback(() => {
      hasLoadedFocusedConversationsRef.current = true;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let isActive = true;
      const interaction = InteractionManager.runAfterInteractions(() => {
        timeout = setTimeout(() => {
          if (!isActive) {
            return;
          }

          const { conversationsFilter: currentFilter, conversationsLastFetchedAt: lastFetchedAt } = useAppStore.getState();
          if (Date.now() - lastFetchedAt >= CONVERSATION_LIST_STALE_MS) {
            void loadConversations(debouncedSearchRef.current, currentFilter);
          }
          void loadBlockedUsers();
          void loadStatuses();
        }, 450);
      });

      return () => {
        isActive = false;
        interaction.cancel();
        if (timeout) {
          clearTimeout(timeout);
        }
      };
    }, [loadBlockedUsers, loadConversations, loadStatuses]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          accessibilityLabel={t('subscriptionDetailsTitle')}
          onPress={() => setSubscriptionInfoVisible(true)}
          style={({ pressed }) => [styles.brandHeader, pressed && styles.headerMenuButtonPressed]}
        >
          <Text style={styles.brandHeaderTitle}>MeetVap</Text>
          {canUsePremiumFeatures ? <Text style={styles.brandHeaderPremium}>Premium</Text> : null}
        </Pressable>
      ),
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel={t('shareMyContact')} onPress={() => setShareMyContactModalVisible(true)} style={styles.headerMenuButton}>
            <Ionicons color={colors.white} name="share-social-outline" size={22} />
          </Pressable>
          <Pressable accessibilityLabel={t('contacts')} onPress={() => navigation.navigate('Contacts')} style={styles.headerMenuButton}>
            <Ionicons color={colors.white} name="book-outline" size={23} />
          </Pressable>
          <Pressable accessibilityLabel={t('moreOptions')} onPress={() => setHeaderMenuVisible(true)} style={styles.headerMenuButton}>
            <Ionicons color={colors.white} name="ellipsis-vertical" size={22} />
          </Pressable>
        </View>
      ),
    });
  }, [canUsePremiumFeatures, language, navigation]);

  useEffect(() => {
    void getStoredFavoriteConversationIds().then(setFavoriteConversationIds).catch(() => undefined);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(trimmedSearch);
    }, 250);

    return () => clearTimeout(timeout);
  }, [trimmedSearch]);

  useEffect(() => {
    debouncedSearchRef.current = debouncedSearch;

    if (!hasLoadedFocusedConversationsRef.current) {
      return;
    }

    if (activeFilter === 'favorites') {
      if (conversationsFilter !== 'all') {
        void loadConversations(debouncedSearch, 'all');
      }
      return;
    }

    void loadConversations(debouncedSearch, activeFilter);
  }, [activeFilter, conversationsFilter, debouncedSearch, loadConversations]);

  const displayedConversations = useMemo(() => {
    if (activeFilter === 'favorites') {
      return conversations.filter((conversation) => favoriteConversationIds.includes(conversation.id));
    }

    if (isServerSideConversationFilter(activeFilter) && conversationsFilter === activeFilter) {
      return conversations;
    }

    if (activeFilter === 'all') {
      return conversations;
    }

    return conversations.filter((conversation) => matchesChatFilter(conversation, activeFilter, favoriteConversationIds));
  }, [activeFilter, conversations, conversationsFilter, favoriteConversationIds]);
  const displayedConversationIds = useMemo(
    () => displayedConversations.map((conversation) => conversation.id),
    [displayedConversations],
  );
  const listContentStyle = useMemo(
    () => [styles.list, styles.listWithFab, displayedConversationIds.length === 0 && styles.emptyList],
    [displayedConversationIds.length, isDarkMode],
  );
  const isSearchPending = trimmedSearch !== debouncedSearch || (isLoadingConversations && trimmedSearch.length > 0);

  const handleFilterChange = useCallback((filter: ChatFilter) => {
    setActiveFilter(filter);
  }, []);

  const showChatMenu = useCallback((conversation: Conversation) => {
    const conversationId = conversation.id;
    const isGroup = conversation.type === 'GROUP';
    const otherUserId = isGroup ? undefined : conversation.otherUserId;
    const isBlocked = !isGroup && !!otherUserId && blockedUsers.some((blockedUser) => blockedUser.id === otherUserId);
    const isFavorite = favoriteConversationIds.includes(conversationId);
    const isGroupAdmin = isGroup && !!user?.id && conversation.adminIds?.includes(user.id) === true;
    const isGroupOwner = isGroup && !!user?.id && conversation.ownerId === user.id;
    const isSystem = isMeetVapSystemConversation(conversation);
    setChatMenu({
      conversationId,
      isBlocked,
      isContact: conversation.isContact,
      isFavorite,
      isGroupAdmin,
      isGroupOwner,
      isMuted: isConversationMuted(conversation),
      isSystem,
      otherUserId,
      title: conversation.title,
      type: conversation.type,
    });
  }, [blockedUsers, favoriteConversationIds, user?.id]);

  function closeChatMenu() {
    setChatMenu(null);
  }

  function closeBlockGroupMenu() {
    setBlockGroupMenu(null);
  }

  function runChatMenuAction(action: () => Promise<void>, failureTitle: string) {
    closeChatMenu();
    void action().catch((error) => {
      Alert.alert(failureTitle, error instanceof Error ? error.message : t('pleaseTryAgain'));
    });
  }

  function confirmDeleteChat(menu: ChatMenuState) {
    closeChatMenu();

    if (menu.type === 'GROUP' || !menu.otherUserId) {
      if (menu.type === 'GROUP' && menu.isGroupAdmin && user?.id) {
        Alert.alert(
          t('removeAdminChatTitle'),
          t('removeAdminChatDescription'),
          [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('deleteChat'),
              style: 'destructive',
              onPress: async () => {
                try {
                  await revokeGroupAdmin(menu.conversationId, user.id);
                  await deleteChat(menu.conversationId);
                } catch (error) {
                  Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
                }
              },
            },
          ],
        );
        return;
      }

      void deleteChat(menu.conversationId).catch((error) => {
        Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      });
      return;
    }

    Alert.alert(
      t('deleteChat'),
      menu.title,
      [
        {
          text: t('deleteForAnyone'),
          style: 'destructive',
          onPress: () => {
            void deleteChat(menu.conversationId, 'all').catch((error) => {
              Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
            });
          },
        },
        {
          text: t('deleteForMe'),
          onPress: () => {
            void deleteChat(menu.conversationId, 'me').catch((error) => {
              Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
            });
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  }

  function closeHeaderMenu() {
    setHeaderMenuVisible(false);
  }

  function runHeaderMenuAction(action: () => void | Promise<void>, failureTitle = t('actionFailed')) {
    closeHeaderMenu();
    void Promise.resolve(action()).catch((error) => {
      Alert.alert(failureTitle, error instanceof Error ? error.message : t('pleaseTryAgain'));
    });
  }

  function shareMyContact() {
    if (!user) {
      return;
    }

    try {
      const payload = buildSharedContactMessage(user);
      void Share.share(payload).catch(() => {
        Alert.alert(t('shareFailed'), t('pleaseTryAgain'));
      });
    } catch {
      Alert.alert(t('shareFailed'), t('pleaseTryAgain'));
    }
  }

  function requestShareMyContact() {
    if (Platform.OS === 'ios' && isShareMyContactModalVisible) {
      pendingShareMyContactRef.current = true;
      setShareMyContactModalVisible(false);
      return;
    }

    shareMyContact();
  }

  function flushPendingShareMyContact() {
    if (!pendingShareMyContactRef.current) {
      return;
    }

    pendingShareMyContactRef.current = false;
    setTimeout(shareMyContact, 80);
  }

  function openMeetLinkFlow() {
    const activeMeeting = getActiveMeetingSession();

    if (activeMeeting) {
      navigation.navigate('MeetingRoom', {
        ...activeMeeting,
        autoJoin: true,
      });
      return;
    }

    setMeetTypeMenuVisible(true);
  }

  async function createAndOpenMeet(mode: 'voice' | 'video') {
    setMeetTypeMenuVisible(false);

    if (!serverUrl) {
      Alert.alert(t('createMeetLinkFailed'), t('pleaseTryAgain'));
      return;
    }

    try {
      const response = await createMeeting(serverUrl, mode);
      const session = {
        autoJoin: true,
        code: response.meeting.code,
        link: response.meeting.link,
        mode: response.meeting.mode,
      };

      setActiveMeetingSession(session);
      navigation.navigate('MeetingRoom', session);
    } catch (error) {
      Alert.alert(t('createMeetLinkFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function closeMeetTypeMenu() {
    setMeetTypeMenuVisible(false);
  }

  function renderMeetTypeMenu() {
    return (
      <Modal animationType="fade" transparent visible={isMeetTypeMenuVisible} onRequestClose={closeMeetTypeMenu}>
        <Pressable onPress={closeMeetTypeMenu} style={styles.menuBackdrop}>
          <Pressable style={styles.meetTypeCard}>
            <Text style={styles.meetTypeTitle}>{t('createMeetLink')}</Text>
            <Text style={styles.meetTypeSubtitle}>{t('createMeetLinkDescription')}</Text>
            <View style={styles.meetTypeOptions}>
              <Pressable onPress={() => void createAndOpenMeet('video')} style={({ pressed }) => [styles.meetTypeOption, pressed && styles.meetTypeOptionPressed]}>
                <View style={styles.meetTypeIcon}>
                  <Ionicons color={colors.white} name="videocam" size={28} />
                </View>
                <View style={styles.meetTypeText}>
                  <Text style={styles.meetTypeOptionTitle}>{t('videoMeet')}</Text>
                  <Text style={styles.meetTypeOptionSubtitle}>{t('videoMeetDescription')}</Text>
                </View>
                <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
              </Pressable>
              <Pressable onPress={() => void createAndOpenMeet('voice')} style={({ pressed }) => [styles.meetTypeOption, pressed && styles.meetTypeOptionPressed]}>
                <View style={styles.meetTypeIcon}>
                  <Ionicons color={colors.white} name="call" size={27} />
                </View>
                <View style={styles.meetTypeText}>
                  <Text style={styles.meetTypeOptionTitle}>{t('voiceMeet')}</Text>
                  <Text style={styles.meetTypeOptionSubtitle}>{t('voiceMeetDescription')}</Text>
                </View>
                <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
              </Pressable>
            </View>
            <Pressable onPress={closeMeetTypeMenu} style={styles.meetTypeCancel}>
              <Text style={styles.meetTypeCancelText}>{t('cancel')}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  async function toggleFavoriteConversation(conversationId: string) {
    const nextIds = favoriteConversationIds.includes(conversationId)
      ? favoriteConversationIds.filter((id) => id !== conversationId)
      : [...favoriteConversationIds, conversationId];

    setFavoriteConversationIds(nextIds);
    await setStoredFavoriteConversationIds(nextIds);
  }

  function confirmReportChat() {
    if (!chatMenu) {
      return;
    }

    const menu = chatMenu;
    const isGroup = chatMenu.type === 'GROUP';
    const targetId = isGroup ? chatMenu.conversationId : chatMenu.otherUserId;

    if (!targetId) {
      return;
    }

    closeChatMenu();

    Alert.alert(
      isGroup ? t('reportGroupQuestion') : t('reportUserQuestion'),
      getReportContextNotice(),
      [
        {
          text: t('report'),
          style: 'destructive',
          onPress: () => {
            void reportChat(menu, targetId, isGroup, false);
          },
        },
        {
          text: isGroup ? t('reportAndBlockGroup') : t('reportAndBlockUser'),
          style: 'destructive',
          onPress: () => {
            void reportChat(menu, targetId, isGroup, true);
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ],
    );
  }

  async function reportChat(menu: ChatMenuState, targetId: string, isGroup: boolean, shouldBlock: boolean) {
    try {
      const reason = await getChatReportReason(menu.conversationId, menu.title);

      await reportTarget({
        conversationId: menu.conversationId,
        reason,
        targetId,
        targetType: isGroup ? 'GROUP' : 'USER',
      });

      if (shouldBlock) {
        if (isGroup) {
          await deleteChat(menu.conversationId);
        } else {
          await blockUserById(targetId);
        }
      }

      Alert.alert(t('reportSent'), shouldBlock ? t('reportSentAndBlocked') : t('supportWillReview'));
    } catch (error) {
      Alert.alert(t('reportFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function openBlockGroupMenu(menu: ChatMenuState) {
    setChatMenu(null);
    setBlockGroupMenu(menu);
  }

  function blockGroup(menu: ChatMenuState, shouldReport: boolean) {
    closeBlockGroupMenu();
    void declineGroupInvite(menu.conversationId, { blockGroup: true, reportGroup: shouldReport }).catch((error) => {
      Alert.alert(t('blockFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    });
  }

  function confirmToggleUserBlock(menu: ChatMenuState) {
    if (!menu.otherUserId || menu.type === 'GROUP' || menu.isSystem) {
      return;
    }

    closeChatMenu();

    const isBlocked = menu.isBlocked;
    const title = isBlocked ? t('unblockUserQuestion') : t('blockUserQuestion');
    const message = isBlocked
      ? t('unblockUserMessage', { name: menu.title })
      : t('blockUserMessage', { name: menu.title });
    const actionLabel = isBlocked ? t('unblock') : t('blockUser');
    const failureTitle = isBlocked ? t('unblockFailed') : t('blockFailed');

    Alert.alert(
      title,
      message,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: actionLabel,
          style: isBlocked ? 'default' : 'destructive',
          onPress: () => {
            void (isBlocked ? unblockUserById(menu.otherUserId!) : blockUserById(menu.otherUserId!)).catch((error) => {
              Alert.alert(failureTitle, error instanceof Error ? error.message : t('pleaseTryAgain'));
            });
          },
        },
      ],
    );
  }

  function chooseMuteDuration(menu: ChatMenuState) {
    closeChatMenu();
    setMuteMenu(menu);
  }

  function muteConversation(menu: ChatMenuState, durationMinutes?: 15 | 60 | 240 | 480 | 1440) {
    setMuteMenu(null);
    void updateConversationMute(menu.conversationId, true, durationMinutes).catch((error) => {
      Alert.alert(t('mutedFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    });
  }

  async function getChatReportReason(conversationId: string, title: string) {
    await loadMessages(conversationId).catch(() => undefined);

    const messages = useAppStore.getState().messagesByConversation[conversationId] ?? [];
    return buildReportReason(title, messages);
  }

  const openChat = useCallback((conversation: Conversation) => {
    const now = Date.now();
    const lastOpen = lastChatOpenRef.current;

    if (lastOpen?.conversationId === conversation.id && now - lastOpen.openedAt < 700) {
      logUiPerformanceDiagnostic('chat-row-press-ignored-duplicate', {
        conversationId: conversation.id,
        elapsedMs: now - lastOpen.openedAt,
      });
      return;
    }

    lastChatOpenRef.current = { conversationId: conversation.id, openedAt: now };
    logUiPerformanceDiagnostic('chat-row-pressed', {
      conversationId: conversation.id,
      conversationCount: useAppStore.getState().conversations.length,
      hasLiveMessages: (useAppStore.getState().messagesByConversation[conversation.id] ?? []).length > 0,
      isGroup: conversation.type === 'GROUP',
      pendingInvite: conversation.myGroupInvitePending === true,
    });

    navigation.navigate('ChatRoom', {
      conversationId: conversation.id,
      isGroup: conversation.type === 'GROUP',
      openReason: 'chat-list',
      title: conversation.title,
    });
    logUiPerformanceDiagnostic('chat-navigation-start', {
      conversationId: conversation.id,
      elapsedSincePressMs: Date.now() - now,
    });

  }, [navigation]);

  const openUnreadStatus = useCallback((authorId: string) => {
    navigation.navigate('Status', { authorId });
  }, [navigation]);

  const keyExtractor = useCallback((item: string) => item, []);

  const renderConversationRow = useCallback(({ item }: { item: string }) => (
    <ConnectedChatRow
      blockedUserIds={blockedUserIds}
      conversationId={item}
      contactsById={contactsById}
      currentUserId={user?.id}
      language={language}
      onLongPress={showChatMenu}
      onPress={openChat}
      onStatusPress={openUnreadStatus}
      themeKey={isDarkMode ? 'dark' : 'light'}
      unviewedStatusAuthorIds={unviewedStatusAuthorIds}
    />
  ), [blockedUserIds, contactsById, isDarkMode, language, openChat, openUnreadStatus, showChatMenu, unviewedStatusAuthorIds, user?.id]);

  const refreshConversations = useCallback(
    () => loadConversations(trimmedSearch, activeFilter, { refresh: true }),
    [activeFilter, loadConversations, trimmedSearch],
  );
  const loadNextConversationPage = useCallback(() => {
    if (isLoadingConversations || isLoadingMoreConversations || !hasMoreConversations || activeFilter === 'favorites') {
      return;
    }

    void loadMoreConversations(debouncedSearchRef.current, activeFilter);
  }, [activeFilter, hasMoreConversations, isLoadingConversations, isLoadingMoreConversations, loadMoreConversations]);

  if (isLoadingConversations && conversations.length === 0 && !hasLoadedConversations) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
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
            placeholder={t('search')}
            placeholderTextColor={colors.mutedText}
            style={styles.searchInput}
            value={search}
          />
          {isSearchPending ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : search ? (
            <Pressable onPress={() => setSearch('')} style={styles.clearSearch}>
              <Ionicons color={colors.mutedText} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.filterRow}>
        {CHAT_FILTERS.map((filter) => {
          const isActive = activeFilter === filter.key;

          return (
            <Pressable
              key={filter.key}
              onPress={() => handleFilterChange(filter.key)}
              style={({ pressed }) => [styles.filterChip, isActive && styles.filterChipActive, pressed && styles.filterChipPressed]}
            >
              <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>{t(filter.label)}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        contentContainerStyle={listContentStyle}
        data={displayedConversationIds}
        extraData={`${isDarkMode}:${activeFilter}:${language}:${unviewedStatusAuthorKey}`}
        initialNumToRender={12}
        keyExtractor={keyExtractor}
        maxToRenderPerBatch={10}
        removeClippedSubviews
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons color={colors.primary} name="chatbubbles-outline" size={44} />
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyText}>{emptyText}</Text>
            {!trimmedSearch && activeFilter === 'all' ? (
              <Pressable onPress={() => navigation.navigate('NewChat')} style={styles.emptyActionButton}>
                <Text style={styles.emptyActionButtonText}>{t('newChat')}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
        ListFooterComponent={isLoadingMoreConversations ? (
          <View style={styles.listFooterLoader}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        onEndReached={loadNextConversationPage}
        onEndReachedThreshold={0.45}
        renderItem={renderConversationRow}
        refreshing={isRefreshingConversations}
        onRefresh={refreshConversations}
        windowSize={8}
      />
      <Pressable onPress={() => navigation.navigate('NewChat')} style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}>
        <Ionicons color={colors.white} name="chatbubble-ellipses" size={26} />
      </Pressable>
      <Modal animationType="fade" transparent visible={isHeaderMenuVisible} onRequestClose={closeHeaderMenu}>
        <Pressable onPress={closeHeaderMenu} style={styles.headerMenuBackdrop}>
          <Pressable style={styles.headerMenuCard}>
            <MenuAction
              icon="people-outline"
              label={t('createGroup')}
              onPress={() => runHeaderMenuAction(() => navigation.navigate('NewGroup'))}
            />
            <MenuAction
              icon="radio-outline"
              label={t('createVoiceGroup')}
              onPress={() => runHeaderMenuAction(() => navigation.navigate('NewGroup', { mode: 'voiceRoom' }))}
            />
            <MenuAction
              icon="videocam-outline"
              label={t('createMeetLink')}
              onPress={() => runHeaderMenuAction(openMeetLinkFlow)}
            />
            <MenuAction
              icon="checkmark-done-outline"
              label={t('readAll')}
              onPress={() => runHeaderMenuAction(markAllConversationsReadNow, t('readAllFailed'))}
            />
            <MenuAction
              icon="desktop-outline"
              label={t('devices')}
              onPress={() => runHeaderMenuAction(() => navigation.navigate('Devices'))}
            />
            <MenuAction
              icon="settings-outline"
              label={t('settings')}
              onPress={() => runHeaderMenuAction(() => navigation.navigate('Settings'))}
            />
            <MenuAction
              icon="phone-portrait-outline"
              iconColor={APP_FEATURES_ICON_COLOR}
              label={t('appFeatures')}
              onPress={() => {
                closeHeaderMenu();
                setSupportModalVisible(true);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      {renderMeetTypeMenu()}
      <Modal animationType="fade" transparent visible={isSubscriptionInfoVisible} onRequestClose={() => setSubscriptionInfoVisible(false)}>
        <Pressable onPress={() => setSubscriptionInfoVisible(false)} style={styles.menuBackdrop}>
          <Pressable style={styles.subscriptionInfoCard}>
            <View style={styles.subscriptionInfoHeader}>
              <PremiumUserBadge size={32} />
              <View style={styles.subscriptionInfoHeaderText}>
                <Text style={styles.subscriptionInfoTitle}>{t('subscriptionDetailsTitle')}</Text>
                <Text numberOfLines={1} style={styles.subscriptionInfoSubtitle}>{subscriptionDetails.packageTitle}</Text>
              </View>
            </View>
            <View style={styles.subscriptionInfoBox}>
              <SubscriptionInfoRow label={t('subscriptionStatusLabel')} value={subscriptionDetails.statusLabel} />
              <SubscriptionInfoRow label={t('subscriptionExpiresLabel')} value={subscriptionDetails.expiresLabel} />
              <SubscriptionInfoRow label={t('subscriptionSourceLabel')} value={subscriptionDetails.sourceLabel} />
            </View>
            {!canUsePremiumFeatures ? (
              <Pressable
                onPress={() => {
                  setSubscriptionInfoVisible(false);
                  navigation.navigate('Subscription');
                }}
                style={styles.subscriptionInfoPrimaryButton}
              >
                <Text style={styles.subscriptionInfoPrimaryText}>{t('subscriptionGetSubscription')}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => setSubscriptionInfoVisible(false)} style={styles.subscriptionInfoSecondaryButton}>
                <Text style={styles.subscriptionInfoSecondaryText}>{t('close')}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <HelpWebViewModal
        callFrom="support"
        onClose={() => setSupportModalVisible(false)}
        visible={isSupportModalVisible}
      />
      <Modal animationType="fade" onDismiss={flushPendingShareMyContact} transparent visible={isShareMyContactModalVisible} onRequestClose={() => setShareMyContactModalVisible(false)}>
        <Pressable onPress={() => setShareMyContactModalVisible(false)} style={styles.menuBackdrop}>
          <Pressable style={styles.menuCard}>
            <Text style={styles.menuTitle}>{t('shareMyContact')}</Text>
            <Text style={styles.shareContactDescription}>{t('shareMyContactModalDescription')}</Text>
            <View style={styles.modalActionsRow}>
              <Pressable onPress={() => setShareMyContactModalVisible(false)} style={styles.modalSecondaryButton}>
                <Text style={styles.modalSecondaryButtonText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  requestShareMyContact();
                }}
                style={styles.modalPrimaryButton}
              >
                <Text style={styles.modalPrimaryButtonText}>{t('share')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal animationType="fade" transparent visible={!!chatMenu} onRequestClose={closeChatMenu}>
        <Pressable onPress={closeChatMenu} style={styles.menuBackdrop}>
          <Pressable style={styles.menuCard}>
            <Text numberOfLines={1} style={styles.menuTitle}>{chatMenu?.title}</Text>
            {chatMenu?.type === 'GROUP' ? null : (
              <MenuAction
                icon={chatMenu?.isFavorite ? 'star' : 'star-outline'}
                label={chatMenu?.isFavorite ? t('removeFavorite') : t('addFavorite')}
                onPress={() => chatMenu && runChatMenuAction(() => toggleFavoriteConversation(chatMenu.conversationId), t('favoriteFailed'))}
              />
            )}
            <MenuAction
              icon={chatMenu?.isMuted ? 'notifications-outline' : 'notifications-off-outline'}
              label={chatMenu?.isMuted ? t('unmute') : t('mute')}
              onPress={() => chatMenu && (chatMenu.isMuted
                ? runChatMenuAction(() => updateConversationMute(chatMenu.conversationId, false), t('unmuteFailed'))
                : chooseMuteDuration(chatMenu))}
            />
            {chatMenu?.isSystem || chatMenu?.isGroupOwner ? null : (
              <MenuAction
                icon="trash-outline"
                label={t('deleteChat')}
                destructive
                onPress={() => chatMenu && confirmDeleteChat(chatMenu)}
              />
            )}
            {chatMenu?.type !== 'GROUP' && chatMenu?.otherUserId && !chatMenu.isSystem && !chatMenu.isContact && !chatMenu.isBlocked ? (
              <MenuAction
                icon="person-add-outline"
                label={t('addToContacts')}
                onPress={() => runChatMenuAction(() => addUserToContacts(chatMenu.otherUserId!), t('addContactFailed'))}
              />
            ) : null}
            {chatMenu?.type !== 'GROUP' && chatMenu?.otherUserId && !chatMenu.isSystem ? (
              <MenuAction
                destructive={!chatMenu.isBlocked}
                icon={chatMenu.isBlocked ? 'checkmark-circle-outline' : 'ban-outline'}
                label={chatMenu.isBlocked ? t('unblock') : t('blockUser')}
                onPress={() => chatMenu && confirmToggleUserBlock(chatMenu)}
              />
            ) : null}
            {chatMenu?.type === 'GROUP' && !chatMenu.isGroupAdmin && !chatMenu.isGroupOwner ? (
              <MenuAction
                destructive
                icon="ban-outline"
                label={t('blockGroup')}
                onPress={() => chatMenu && openBlockGroupMenu(chatMenu)}
              />
            ) : null}
            {(chatMenu?.type === 'GROUP' || chatMenu?.otherUserId) && !chatMenu?.isSystem && !(chatMenu?.type === 'GROUP' && (chatMenu.isGroupAdmin || chatMenu.isGroupOwner)) ? (
              <MenuAction
                destructive
                icon="flag-outline"
                label={chatMenu.type === 'GROUP' ? t('reportGroup') : t('reportUser')}
                onPress={confirmReportChat}
              />
            ) : null}
            <MenuAction icon="close-outline" label={t('cancel')} onPress={closeChatMenu} />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal animationType="fade" transparent visible={!!muteMenu} onRequestClose={() => setMuteMenu(null)}>
        <View style={styles.menuBackdrop}>
          <Pressable onPress={() => setMuteMenu(null)} style={StyleSheet.absoluteFill} />
          <View style={styles.menuCard}>
            <Text numberOfLines={1} style={styles.menuTitle}>{t(muteMenu?.type === 'GROUP' ? 'muteGroup' : 'muteChat')}</Text>
            {CONVERSATION_MUTE_OPTIONS.map((option) => (
              <MenuAction
                icon="notifications-off-outline"
                key={option.labelKey}
                label={t(option.labelKey)}
                onPress={() => muteMenu && muteConversation(muteMenu, option.durationMinutes)}
              />
            ))}
            <MenuAction icon="close-outline" label={t('cancel')} onPress={() => setMuteMenu(null)} />
          </View>
        </View>
      </Modal>
      <Modal animationType="fade" transparent visible={!!blockGroupMenu} onRequestClose={closeBlockGroupMenu}>
        <Pressable onPress={closeBlockGroupMenu} style={styles.menuBackdrop}>
          <Pressable style={styles.menuCard}>
            <Text numberOfLines={1} style={styles.menuTitle}>{blockGroupMenu?.title}</Text>
            <MenuAction
              destructive
              icon="ban-outline"
              label={t('blockOnly')}
              onPress={() => blockGroupMenu && blockGroup(blockGroupMenu, false)}
            />
            <MenuAction
              destructive
              icon="flag-outline"
              label={t('blockAndReport')}
              onPress={() => blockGroupMenu && blockGroup(blockGroupMenu, true)}
            />
            <MenuAction icon="close-outline" label={t('cancel')} onPress={closeBlockGroupMenu} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenBackground>
  );
}

function MenuAction({
  destructive = false,
  icon,
  iconColor,
  label,
  onPress,
}: {
  destructive?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.menuAction, pressed && styles.menuActionPressed]}>
      <Ionicons color={iconColor ?? (destructive ? colors.danger : colors.primary)} name={icon} size={22} />
      <Text style={[styles.menuActionText, destructive && styles.menuActionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

function SubscriptionInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.subscriptionInfoRow}>
      <Text style={styles.subscriptionInfoLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.subscriptionInfoValue}>{value}</Text>
    </View>
  );
}

function getChatSubscriptionDetails(subscriptionStatus: SubscriptionStatus | null, language: AppLanguage, hasAccess: boolean) {
  const entitlement = subscriptionStatus?.entitlement ?? null;
  const trialEndsAt = subscriptionStatus?.premiumTrialEndsAt ?? null;
  const trialExpiryTime = trialEndsAt ? Date.parse(trialEndsAt) : Number.NaN;
  const isActiveTrial = subscriptionStatus?.premiumAccessSource === 'trial' &&
    !!trialEndsAt &&
    trialExpiryTime > Date.now();
  const isActiveSubscription = subscriptionStatus?.hasActiveSubscription === true &&
    !!entitlement &&
    new Date(entitlement.expiresAt).getTime() > Date.now();
  const isExpiredTrial = !hasAccess &&
    !!trialEndsAt &&
    Number.isFinite(trialExpiryTime) &&
    trialExpiryTime <= Date.now();
  const isExpiredSubscription = !hasAccess &&
    !!entitlement?.expiresAt &&
    new Date(entitlement.expiresAt).getTime() <= Date.now();

  return {
    expiresLabel: isActiveTrial
      ? formatSubscriptionInfoDate(trialEndsAt, language)
      : entitlement?.expiresAt
        ? formatSubscriptionInfoDate(entitlement.expiresAt, language)
        : t('subscriptionNoExpiry', {}, language),
    packageTitle: isActiveTrial
      ? t('subscriptionTrialMode', {}, language)
      : isExpiredTrial
        ? t('subscriptionTrialExpired', {}, language)
        : isExpiredSubscription
          ? t('subscriptionExpired', {}, language)
          : hasAccess
            ? t('subscriptionStatusActive', {}, language)
            : t('subscriptionFreeMode', {}, language),
    sourceLabel: isActiveTrial
      ? t('subscriptionSourceTrial', {}, language)
      : entitlement?.platform
        ? getSubscriptionInfoSourceLabel(entitlement.platform, language)
        : t('subscriptionSourceFree', {}, language),
    statusLabel: hasAccess || isActiveSubscription || isActiveTrial
      ? t('subscriptionStatusActive', {}, language)
      : isExpiredTrial
        ? t('subscriptionTrialExpired', {}, language)
        : isExpiredSubscription
          ? t('subscriptionExpired', {}, language)
          : t('subscriptionStatusInactive', {}, language),
  };
}

function getSubscriptionInfoSourceLabel(platform: NonNullable<SubscriptionStatus['entitlement']>['platform'], language: AppLanguage) {
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

function formatSubscriptionInfoDate(value: string | null | undefined, language: AppLanguage) {
  if (!value) {
    return t('subscriptionNoExpiry', {}, language);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(DATE_LOCALE_BY_LANGUAGE[language], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function createStyles() {
  return StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.secondary,
    borderRadius: 999,
    minWidth: 22,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
  blockedBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    borderColor: colors.danger,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  blockedBadgeText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '900',
  },
  contactBadge: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  contactBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '800',
  },
  invitedBadge: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  invitedBadgeText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  bottomLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  avatarSlot: {
    alignItems: 'center',
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  avatarPressable: {
    borderRadius: 29,
  },
  center: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    flex: 1,
    justifyContent: 'center',
  },
  content: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: spacing.xs,
    paddingBottom: spacing.md,
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
  fab: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 28,
    bottom: spacing.xl,
    elevation: 5,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xl,
    shadowColor: '#000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    width: 56,
  },
  fabPressed: {
    opacity: 0.86,
  },
  filterChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipPressed: {
    opacity: 0.82,
  },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  filterChipTextActive: {
    color: colors.white,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 40,
  },
  brandHeader: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: 42,
    minWidth: 116,
  },
  brandHeaderTitle: {
    color: colors.white,
    fontSize: 24,
    fontWeight: '700',
  },
  brandHeaderPremium: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 11,
    marginTop: -3,
    paddingLeft: 1,
  },
  headerMenuBackdrop: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(16,32,51,0.12)',
    flex: 1,
    paddingRight: spacing.sm,
    paddingTop: spacing.xl + spacing.xl,
  },
  headerMenuButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  headerMenuButtonPressed: {
    opacity: 0.68,
  },
  headerPremiumButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  headerMenuCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    elevation: 8,
    minWidth: 220,
    overflow: 'hidden',
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  list: {
    backgroundColor: 'transparent',
  },
  listWithFab: {
    paddingBottom: 96,
  },
  emptyActionButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyActionButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '800',
  },
  menuAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  menuActionPressed: {
    backgroundColor: colors.appBackground,
  },
  menuActionText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  menuActionTextDanger: {
    color: colors.danger,
  },
  menuBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(16,32,51,0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  menuCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    elevation: 8,
    maxWidth: 360,
    overflow: 'hidden',
    paddingVertical: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    width: '100%',
  },
  meetTypeCancel: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.md,
    minHeight: 46,
  },
  meetTypeCancelText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '900',
  },
  meetTypeCard: {
    backgroundColor: colors.surface,
    borderColor: 'rgba(64, 158, 255, 0.28)',
    borderRadius: 22,
    borderWidth: 1,
    elevation: 12,
    gap: spacing.md,
    maxWidth: 440,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    width: '100%',
  },
  meetTypeIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  meetTypeOption: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 78,
    padding: spacing.md,
  },
  meetTypeOptionPressed: {
    opacity: 0.78,
  },
  meetTypeOptions: {
    gap: spacing.md,
  },
  meetTypeOptionSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  meetTypeOptionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '900',
  },
  meetTypeSubtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  meetTypeText: {
    flex: 1,
    gap: 3,
  },
  meetTypeTitle: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '900',
    textAlign: 'center',
  },
  menuTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  modalPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  modalPrimaryButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  modalSecondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  modalSecondaryButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '800',
  },
  supportDescription: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  subscriptionInfoBox: {
    backgroundColor: colors.appBackground,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  subscriptionInfoCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    elevation: 8,
    gap: spacing.lg,
    maxWidth: 380,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    width: '100%',
  },
  subscriptionInfoHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  subscriptionInfoHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  subscriptionInfoLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  subscriptionInfoPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 46,
  },
  subscriptionInfoPrimaryText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  subscriptionInfoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  subscriptionInfoSecondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 46,
  },
  subscriptionInfoSecondaryText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '900',
  },
  subscriptionInfoSubtitle: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '900',
  },
  subscriptionInfoTitle: {
    color: colors.textPrimary,
    fontSize: 19,
    fontWeight: '900',
  },
  subscriptionInfoValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'right',
  },
  preview: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14,
  },
  previewRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 4,
    minWidth: 0,
  },
  row: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  listFooterLoader: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  roleBadge: {
    backgroundColor: colors.outgoingBubble,
    borderColor: colors.primary,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  roleBadgeText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  clearSearch: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  screen: {
    backgroundColor: 'transparent',
    flex: 1,
  },
  shareContactDescription: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
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
  time: {
    color: colors.mutedText,
    fontSize: 12,
  },
  messageStatusIcon: {
    marginRight: 2,
  },
  onlineDot: {
    backgroundColor: '#22c55e',
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
  },
  systemTitle: {
    color: '#16a34a',
    fontWeight: '800',
  },
  systemAvatarInner: {
    alignItems: 'center',
    backgroundColor: colors.appBackground,
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  systemAvatarRing: {
    alignItems: 'center',
    borderRadius: 29,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  statusAvatarRing: {
    alignItems: 'center',
    borderColor: '#22c55e',
    borderRadius: 29,
    borderStyle: 'dotted',
    borderWidth: 2,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  supportBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
    borderColor: '#16a34a',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  supportBadgeText: {
    color: '#16a34a',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  topLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  topTools: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.md,
  },
});
}

let styles = createStyles();

const ConnectedChatRow = memo(function ConnectedChatRow({
  blockedUserIds,
  conversationId,
  contactsById,
  currentUserId,
  language,
  onLongPress,
  onPress,
  onStatusPress,
  themeKey,
  unviewedStatusAuthorIds,
}: {
  blockedUserIds: Set<string>;
  conversationId: string;
  contactsById: Map<string, AuthUser>;
  currentUserId?: string;
  language: AppLanguage;
  onLongPress: (conversation: Conversation) => void;
  onPress: (conversation: Conversation) => void;
  onStatusPress: (authorId: string) => void;
  themeKey: 'dark' | 'light';
  unviewedStatusAuthorIds: Set<string>;
}) {
  const conversation = useConversationById(conversationId);

  if (!conversation) {
    return null;
  }

  const isSystemChat = isMeetVapSystemConversation(conversation);
  const directContactPeer = conversation.type !== 'GROUP' && conversation.otherUserId
    ? contactsById.get(conversation.otherUserId)
    : undefined;
  const hasUnviewedStatus = conversation.type !== 'GROUP'
    && conversation.isContact !== false
    && !!conversation.otherUserId
    && unviewedStatusAuthorIds.has(conversation.otherUserId);

  return (
    <ChatRow
      conversation={conversation}
      currentUserId={currentUserId}
      directContactPeer={directContactPeer}
      hasUnviewedStatus={hasUnviewedStatus}
      isBlocked={conversation.type !== 'GROUP' && !!conversation.otherUserId && blockedUserIds.has(conversation.otherUserId)}
      isOtherUserOnline={conversation.type !== 'GROUP' && getConversationOtherUser(conversation)?.isOnline === true}
      isSystemChat={isSystemChat}
      language={language}
      messageTimeText={conversation.lastMessageAt}
      onLongPress={() => {
        if (isSystemChat) {
          return;
        }

        onLongPress(conversation);
      }}
      onPress={() => onPress(conversation)}
      onStatusPress={hasUnviewedStatus && conversation.otherUserId ? () => onStatusPress(conversation.otherUserId as string) : undefined}
      themeKey={themeKey}
    />
  );
});

const ChatRow = memo(function ChatRow({
  conversation,
  currentUserId,
  directContactPeer,
  hasUnviewedStatus,
  isBlocked,
  isOtherUserOnline,
  isSystemChat,
  language,
  messageTimeText,
  onLongPress,
  onPress,
  onStatusPress,
  themeKey: _themeKey,
}: {
  conversation: Conversation;
  currentUserId?: string;
  directContactPeer?: AuthUser;
  hasUnviewedStatus: boolean;
  isBlocked: boolean;
  isOtherUserOnline: boolean;
  isSystemChat: boolean;
  language: AppLanguage;
  messageTimeText: string;
  onLongPress: () => void;
  onPress: () => void;
  onStatusPress?: () => void;
  themeKey: 'dark' | 'light';
}) {
  const roleLabel = getGroupRoleLabel(conversation, currentUserId);
  const isInvited = conversation.myGroupInvitePending === true;
  const directPeer = conversation.type !== 'GROUP'
    ? conversation.members?.find((member) => member.id !== currentUserId)
    : null;
  const shouldShowPremiumBadge = !isSystemChat && (
    directPeer?.hasPremiumAccess !== undefined
      ? directPeer.hasPremiumAccess === true
      : directContactPeer?.hasPremiumAccess === true
  );
  const unreadBadgeCount = isInvited ? Math.max(1, conversation.unreadCount) : conversation.unreadCount;
  const previewText = isInvited ? t('groupInviteQuestionTitle', {}, language) : conversation.searchSnippet ? `${t('message', {}, language)}: ${conversation.searchSnippet}` : getConversationPreview(conversation, language);
  const latestMessageStatus = !isInvited && !conversation.searchSnippet
    ? getConversationPreviewStatus(conversation, currentUserId)
    : null;
  const avatarContent = (
    <View style={hasUnviewedStatus ? styles.statusAvatarRing : styles.avatarSlot}>
      <Avatar label={conversation.avatarLabel} uri={conversation.avatarUrl} />
    </View>
  );

  return (
    <Pressable
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {isSystemChat ? (
        <LinearGradient
          colors={['#22c55e', '#38bdf8', '#a3e635']}
          end={{ x: 1, y: 1 }}
          start={{ x: 0, y: 0 }}
          style={styles.systemAvatarRing}
        >
          <View style={styles.systemAvatarInner}>
            <Avatar label={conversation.avatarLabel} uri={conversation.avatarUrl ?? MEETVAP_SYSTEM_AVATAR_URL} />
          </View>
        </LinearGradient>
      ) : (
        onStatusPress ? (
          <Pressable
            hitSlop={8}
            onPress={(event) => {
              event.stopPropagation();
              onStatusPress();
            }}
            style={styles.avatarPressable}
          >
            {avatarContent}
          </Pressable>
        ) : avatarContent
      )}
      <View style={styles.content}>
        <View style={styles.topLine}>
          {conversation.isVoiceRoom ? (
            <Ionicons color={colors.primary} name="volume-high" size={16} />
          ) : conversation.type === 'GROUP' ? (
            <Ionicons color={colors.primary} name="people" size={16} />
          ) : null}
          {shouldShowPremiumBadge ? <PremiumUserBadge size={17} /> : null}
          <Text numberOfLines={1} style={[styles.title, isSystemChat ? styles.systemTitle : undefined]}>{conversation.title}</Text>
          {isSystemChat ? (
            <View style={styles.supportBadge}>
              <Text style={styles.supportBadgeText}>{t('support', {}, language)}</Text>
            </View>
          ) : null}
          {roleLabel ? (
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{roleLabel}</Text>
            </View>
          ) : null}
          {isInvited ? (
            <View style={styles.invitedBadge}>
              <Text style={styles.invitedBadgeText}>{t('invited', {}, language)}</Text>
            </View>
          ) : null}
          {isOtherUserOnline ? (
            <View style={styles.onlineDot} />
          ) : (
            <Text style={styles.time}>{messageTimeText}</Text>
          )}
        </View>
        <View style={styles.bottomLine}>
          <View style={styles.previewRow}>
            {latestMessageStatus ? <MessageStatusMark status={latestMessageStatus} /> : null}
            <Text numberOfLines={1} style={styles.preview}>
              {previewText}
            </Text>
          </View>
          {conversation.type !== 'GROUP' && conversation.otherUserId && conversation.isContact === false ? (
            <View style={styles.contactBadge}>
              <Text style={styles.contactBadgeText}>{t('notInContacts')}</Text>
            </View>
          ) : null}
          {isBlocked ? (
            <View style={styles.blockedBadge}>
              <Text style={styles.blockedBadgeText}>{t('blocked', {}, language)}</Text>
            </View>
          ) : null}
          {isConversationMuted(conversation) ? <Ionicons color={colors.mutedText} name="notifications-off-outline" size={16} /> : null}
          {conversation.disappearingMessagesDurationMinutes ? <Ionicons color={colors.primary} name="time-outline" size={16} /> : null}
          {unreadBadgeCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadBadgeCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}, areChatRowsEqual);

function MessageStatusMark({ status }: { status: NonNullable<Conversation['lastMessageStatus']> }) {
  if (status === 'sending') {
    return <Ionicons color={colors.mutedText} name="time-outline" size={16} style={styles.messageStatusIcon} />;
  }

  const isRead = status === 'read';
  const isDelivered = status === 'delivered';
  const iconName = isRead || isDelivered ? 'checkmark-done' : 'checkmark';
  const iconColor = isRead ? '#34b7f1' : '#22c55e';

  return (
    <Ionicons
      color={iconColor}
      name={iconName}
      size={17}
      style={styles.messageStatusIcon}
    />
  );
}

function getConversationPreviewStatus(
  conversation: Conversation,
  currentUserId?: string,
): Conversation['lastMessageStatus'] | null {
  const previewMessageSenderId = conversation.lastMessageSenderId;
  const previewMessageStatus = conversation.lastMessageStatus;

  if (!currentUserId) {
    return previewMessageStatus ?? null;
  }

  if (previewMessageSenderId === currentUserId) {
    return previewMessageStatus ?? null;
  }

  if (previewMessageSenderId) {
    return null;
  }

  return null;
}

function getConversationPreview(conversation: Conversation, language: AppLanguage) {
  if (!conversation.lastMessageKind) {
    return localizeConversationPreviewText(conversation.lastMessage, language);
  }

  if (conversation.lastMessageKind === 'call') {
    return getLocalizedConversationCallPreview(conversation.lastMessage, language);
  }

  if (conversation.lastMessage) {
    return localizeConversationPreviewText(conversation.lastMessage, language);
  }

  if (conversation.lastMessageKind === 'voice') {
    return t('voiceMessage', {}, language);
  }

  if (conversation.lastMessageKind === 'image') {
    return t('photo', {}, language);
  }

  if (conversation.lastMessageKind === 'video') {
    return t('video', {}, language);
  }

  if (conversation.lastMessageKind === 'file') {
    return t('file', {}, language);
  }

  return localizeConversationPreviewText(conversation.lastMessage, language);
}

function localizeConversationPreviewText(text: string, language: AppLanguage) {
  if (text === 'No messages yet') {
    return t('noMessagesYet', {}, language);
  }

  if (text === 'New message') {
    return t('message', {}, language);
  }

  if (text === 'Voice message' || text === 'Sesli mesaj' || text === 'Голосовое сообщение') {
    return t('voiceMessage', {}, language);
  }

  if (text === 'Photo' || text === 'Fotoğraf' || text === 'Фото') {
    return t('photo', {}, language);
  }

  if (text === 'Video' || text === 'Видео') {
    return t('video', {}, language);
  }

  if (text === 'File' || text === 'Dosya' || text === 'Файл') {
    return t('file', {}, language);
  }

  if (text === 'Location' || text === 'Konum' || text === 'Местоположение') {
    return t('location', {}, language);
  }

  return text;
}

function getLocalizedConversationCallPreview(rawText: string, language: AppLanguage) {
  const normalized = rawText.toLowerCase();
  const baseLabel = normalized.includes('video')
    ? t('videoCall', {}, language)
    : normalized.includes('voice')
      ? t('voiceCall', {}, language)
      : t('call', {}, language);

  const durationMatch = rawText.match(/-\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);

  if (!durationMatch) {
    return baseLabel;
  }

  const minutes = Number(durationMatch[1] ?? 0);
  const seconds = Number(durationMatch[2] ?? 0);
  const totalSeconds = (minutes * 60) + seconds;

  if (totalSeconds <= 0) {
    return baseLabel;
  }

  return `${baseLabel} - ${formatConversationCallDuration(totalSeconds, language)}`;
}

function formatConversationCallDuration(totalSeconds: number, language: AppLanguage) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  if (language === 'tr') {
    return minutes > 0 ? `${minutes} dk ${seconds} sn` : `${seconds} sn`;
  }

  if (language === 'ru') {
    return minutes > 0 ? `${minutes} мин ${seconds} сек` : `${seconds} сек`;
  }

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function getGroupRoleLabel(conversation: Conversation | undefined, currentUserId?: string) {
  if (!conversation || conversation.type !== 'GROUP' || !currentUserId) {
    return null;
  }

  if (conversation.ownerId === currentUserId) {
    return t('owner');
  }

  return conversation.adminIds?.includes(currentUserId) ? t('admin') : null;
}

function areChatRowsEqual(
  previous: Readonly<{
    conversation: Conversation;
    currentUserId?: string;
    directContactPeer?: AuthUser;
    hasUnviewedStatus: boolean;
    isBlocked: boolean;
    isOtherUserOnline: boolean;
    isSystemChat: boolean;
    language: AppLanguage;
    messageTimeText: string;
    onLongPress: () => void;
    onPress: () => void;
    onStatusPress?: () => void;
    themeKey: 'dark' | 'light';
  }>,
  next: Readonly<{
    conversation: Conversation;
    currentUserId?: string;
    directContactPeer?: AuthUser;
    hasUnviewedStatus: boolean;
    isBlocked: boolean;
    isOtherUserOnline: boolean;
    isSystemChat: boolean;
    language: AppLanguage;
    messageTimeText: string;
    onLongPress: () => void;
    onPress: () => void;
    onStatusPress?: () => void;
    themeKey: 'dark' | 'light';
  }>,
) {
  return previous.currentUserId === next.currentUserId
    && previous.themeKey === next.themeKey
    && previous.isBlocked === next.isBlocked
    && previous.hasUnviewedStatus === next.hasUnviewedStatus
    && previous.isOtherUserOnline === next.isOtherUserOnline
    && previous.isSystemChat === next.isSystemChat
    && previous.language === next.language
    && previous.messageTimeText === next.messageTimeText
    && previous.conversation.id === next.conversation.id
    && previous.conversation.title === next.conversation.title
    && previous.conversation.avatarLabel === next.conversation.avatarLabel
    && previous.conversation.avatarUrl === next.conversation.avatarUrl
    && previous.conversation.lastMessage === next.conversation.lastMessage
    && previous.conversation.lastMessageAt === next.conversation.lastMessageAt
    && previous.conversation.searchSnippet === next.conversation.searchSnippet
    && previous.conversation.lastMessageId === next.conversation.lastMessageId
    && previous.conversation.lastMessageKind === next.conversation.lastMessageKind
    && previous.conversation.lastMessageSenderId === next.conversation.lastMessageSenderId
    && previous.conversation.lastMessageStatus === next.conversation.lastMessageStatus
    && previous.conversation.unreadCount === next.conversation.unreadCount
    && previous.conversation.myGroupInvitePending === next.conversation.myGroupInvitePending
    && previous.conversation.isMuted === next.conversation.isMuted
    && previous.conversation.disappearingMessagesDurationMinutes === next.conversation.disappearingMessagesDurationMinutes
    && previous.conversation.isContact === next.conversation.isContact
    && previous.conversation.isSystem === next.conversation.isSystem
    && previous.conversation.type === next.conversation.type
    && previous.conversation.otherUserId === next.conversation.otherUserId
    && previous.conversation.ownerId === next.conversation.ownerId
    && previous.conversation.members?.find((member) => member.id !== previous.currentUserId)?.hasPremiumAccess === next.conversation.members?.find((member) => member.id !== next.currentUserId)?.hasPremiumAccess
    && previous.directContactPeer?.hasPremiumAccess === next.directContactPeer?.hasPremiumAccess
    && (previous.conversation.adminIds ?? []).join(',') === (next.conversation.adminIds ?? []).join(',');
}

function getConversationOtherUser(conversation: Conversation) {
  return conversation.members?.find((member) => member.id === conversation.otherUserId) ?? null;
}

function matchesChatFilter(conversation: Conversation, filter: ChatFilter, favoriteConversationIds: string[]) {
  switch (filter) {
    case 'unread':
      return conversation.unreadCount > 0 || conversation.myGroupInvitePending === true;
    case 'groups':
      return conversation.type === 'GROUP';
    case 'favorites':
      return favoriteConversationIds.includes(conversation.id);
    case 'all':
    default:
      return true;
  }
}

function getEmptyTitle(search: string, filter: ChatFilter, language: AppLanguage) {
  if (search) {
    return t('noMatches', {}, language);
  }

  if (filter === 'unread') {
    return t('noUnreadChats', {}, language);
  }

  if (filter === 'groups') {
    return t('noGroups', {}, language);
  }

  if (filter === 'favorites') {
    return t('noFavorites', {}, language);
  }

  return t('noChatsYet', {}, language);
}

function getEmptyText(search: string, filter: ChatFilter, language: AppLanguage) {
  if (search) {
    return t('tryAnotherSearch', {}, language);
  }

  if (filter === 'unread') {
    return t('unreadChatsEmpty', {}, language);
  }

  if (filter === 'groups') {
    return t('groupsEmpty', {}, language);
  }

  if (filter === 'favorites') {
    return t('favoritesEmpty', {}, language);
  }

  return t('chatsEmpty', {}, language);
}
