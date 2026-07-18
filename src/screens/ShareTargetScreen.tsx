import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '../components/Avatar';
import { t } from '../i18n';
import { setPendingShareDraft } from '../lib/pendingShareDraft';
import { formatShareSubtitle, formatShareSummary, isUsableSharedItem, prepareSharedItem } from '../lib/shareTargetItems';
import { consumeNativeSharedItems, hasPendingNativeSharedItems } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { Conversation } from '../types/domain';
import { RootStackParamList, SharedIntentItem } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ShareTarget'>;
const SHARE_SCREEN_CONSUME_RETRY_DELAY_MS = 250;
const SHARE_SCREEN_CONSUME_MAX_ATTEMPTS = 12;

export function ShareTargetScreen({ navigation, route }: Props) {
  useThemeColors();
  styles = createStyles();
  const conversations = useAppStore((state) => state.conversations);
  const loadConversations = useAppStore((state) => state.loadConversations);
  const user = useAppStore((state) => state.user);
  const [query, setQuery] = useState('');
  const [isSending, setSending] = useState(false);
  const [nativeItems, setNativeItems] = useState<SharedIntentItem[] | null>(null);
  const [isLoadingNativeItems, setLoadingNativeItems] = useState(!route.params?.items);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  const items = (route.params?.items ?? nativeItems ?? []).filter(isUsableSharedItem);
  const textItems = items.filter((item) => item.kind === 'text' && item.text);
  const fileItems = items.filter((item) => item.kind === 'file' && item.uri);
  const searchableConversations = useMemo(() => conversations.filter((conversation) => conversation.type !== 'DIRECT' || !!conversation.otherUserId), [conversations]);
  const visibleConversations = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return searchableConversations;
    }

    return searchableConversations.filter((conversation) => (
      conversation.title.toLowerCase().includes(normalizedQuery) ||
      conversation.searchSnippet?.toLowerCase().includes(normalizedQuery)
    ));
  }, [query, searchableConversations]);

  useEffect(() => {
    void loadConversations().catch(() => undefined);
  }, [loadConversations]);

  useEffect(() => {
    if (route.params?.items) {
      setNativeItems(route.params.items);
      setLoadingNativeItems(false);
      return undefined;
    }

    let isMounted = true;

    const loadNativeItems = async () => {
      for (let attempt = 0; attempt < SHARE_SCREEN_CONSUME_MAX_ATTEMPTS; attempt += 1) {
        const hasPendingItems = await hasPendingNativeSharedItems();

        if (!isMounted) {
          return;
        }

        if (hasPendingItems) {
          const consumedItems = await consumeNativeSharedItems();

          if (!isMounted) {
            return;
          }

          setNativeItems(consumedItems);
          setLoadingNativeItems(false);
          return;
        }

        await sleep(SHARE_SCREEN_CONSUME_RETRY_DELAY_MS);
      }

      if (isMounted) {
        setNativeItems([]);
        setLoadingNativeItems(false);
      }
    };

    void loadNativeItems();

    return () => {
      isMounted = false;
    };
  }, [route.params?.items]);

  async function sendToConversation(conversation: Conversation) {
    if (isSending || !user) {
      return;
    }

    setSelectedConversationId(conversation.id);
    setSending(true);

    const preparedItems = await Promise.all(items.map((item) => prepareSharedItem(item)));

    setPendingShareDraft(conversation.id, preparedItems);
    navigation.replace('ChatRoom', {
      conversationId: conversation.id,
      isGroup: conversation.type === 'GROUP',
      title: conversation.title,
    });
  }

  return (
    <View style={styles.screen}>
      {isLoadingNativeItems ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}

      <View style={styles.summary}>
        <View style={styles.summaryIcon}>
          <Ionicons color={colors.white} name={fileItems.length > 0 ? 'attach' : 'text'} size={22} />
        </View>
        <View style={styles.summaryText}>
          <Text numberOfLines={1} style={styles.summaryTitle}>{formatShareSummary(textItems, fileItems)}</Text>
          <Text numberOfLines={2} style={styles.summarySubtitle}>{formatShareSubtitle(textItems, fileItems)}</Text>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons color={colors.textSecondary} name="search" size={18} />
        <TextInput
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder={t('searchChats')}
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
          value={query}
        />
      </View>

      <FlatList
        contentContainerStyle={visibleConversations.length === 0 ? styles.emptyList : styles.list}
        data={visibleConversations}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t('noChatsFound')}</Text>
            <Text style={styles.emptySubtitle}>{t('startChatFirstThenShare')}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const isThisSending = isSending && selectedConversationId === item.id;

          return (
            <Pressable
              disabled={isSending}
              onPress={() => void sendToConversation(item)}
              style={({ pressed }) => [styles.row, pressed && !isSending ? styles.rowPressed : undefined]}
            >
              <Avatar label={item.title} size={46} uri={item.avatarUrl} />
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
                <Text numberOfLines={1} style={styles.rowSubtitle}>{item.type === 'GROUP' ? 'Group' : 'Private chat'}</Text>
              </View>
              {isThisSending ? <ActivityIndicator color={colors.primary} /> : <Ionicons color={colors.textSecondary} name="send" size={20} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function createStyles() {
  return StyleSheet.create({
    emptyList: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    emptyState: {
      alignItems: 'center',
      gap: spacing.xs,
    },
    emptySubtitle: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '900',
    },
    list: {
      paddingBottom: spacing.xl,
    },
    loadingState: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      justifyContent: 'center',
      zIndex: 2,
    },
    row: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 68,
      paddingHorizontal: spacing.lg,
    },
    rowPressed: {
      backgroundColor: colors.surface,
    },
    rowSubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
      marginTop: 2,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
    },
    screen: {
      backgroundColor: colors.appBackground,
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
      borderRadius: 20,
      flexDirection: 'row',
      gap: spacing.sm,
      margin: spacing.lg,
      marginBottom: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    summary: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      flexDirection: 'row',
      gap: spacing.md,
      margin: spacing.lg,
      marginBottom: 0,
      padding: spacing.md,
    },
    summaryIcon: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    summarySubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    summaryText: {
      flex: 1,
    },
    summaryTitle: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
    },
  });
}

let styles = createStyles();
