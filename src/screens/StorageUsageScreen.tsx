import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { t } from '../i18n';
import { getLocalConversationUsageStats, getLocalUsageStats, type LocalConversationUsageStats, type LocalUsageStats } from '../lib/messageStore';
import { isMeetVapSystemConversation } from '../lib/systemChat';
import { useAppStore, type AppState as AppStoreState } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import type { Conversation } from '../types/domain';

type StorageMetric = 'voiceCalls' | 'videoCalls' | 'media' | 'messages' | 'photos' | 'videos' | 'files';

type DetailItem = {
  conversation: Conversation;
  stats: LocalConversationUsageStats;
  value: string;
  weight: number;
};

let styles = createStyles();

export function StorageUsageScreen() {
  useThemeColors();
  styles = createStyles();
  const navigation = useNavigation();
  const userId = useAppStore((state: AppStoreState) => state.user?.id);
  const conversations = useAppStore((state: AppStoreState) => state.conversations) as Conversation[];
  const clearLocalChat = useAppStore((state: AppStoreState) => state.clearLocalChat) as AppStoreState['clearLocalChat'];
  const [stats, setStats] = useState<LocalUsageStats | null>(null);
  const [conversationStats, setConversationStats] = useState<LocalConversationUsageStats[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [activeMetric, setActiveMetric] = useState<StorageMetric | null>(null);

  const refreshStats = useCallback(async () => {
    const [nextStats, nextConversationStats] = await Promise.all([
      getLocalUsageStats(userId),
      getLocalConversationUsageStats(userId),
    ]);

    setStats(nextStats);
    setConversationStats(nextConversationStats);
  }, [userId]);

  useFocusEffect(useCallback(() => {
    let isMounted = true;

    setLoading(true);
    refreshStats()
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshStats]));

  const visibleConversationStats = useMemo(() => (
    conversationStats.filter((item) => {
      const conversation = conversations.find((candidate) => candidate.id === item.conversationId);
      return !isMeetVapSystemConversation(conversation);
    })
  ), [conversationStats, conversations]);
  const visibleStats = useMemo(() => sumConversationUsageStats(visibleConversationStats), [visibleConversationStats]);

  const detailItems = useMemo(() => {
    if (!activeMetric) {
      return [];
    }

    const conversationById = new Map(conversations.map((conversation) => [conversation.id, conversation]));

    return visibleConversationStats
      .map((item): DetailItem | null => {
        const conversation = conversationById.get(item.conversationId);

        if (!conversation) {
          return null;
        }

        const value = formatMetricValue(activeMetric, item);
        const weight = getMetricWeight(activeMetric, item);

        return { conversation, stats: item, value, weight };
      })
      .filter((item): item is DetailItem => !!item && item.weight > 0)
      .sort((left, right) => right.weight - left.weight || left.conversation.title.localeCompare(right.conversation.title));
  }, [activeMetric, visibleConversationStats, conversations]);

  const activeMetricTitle = activeMetric ? getMetricTitle(activeMetric) : '';

  async function clearConversation(item: DetailItem) {
    Alert.alert(
      t('clearStorageForChatQuestion'),
      t('clearStorageForChatDescription', { name: item.conversation.title }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('clearChat'),
          style: 'destructive',
          onPress: () => {
            void clearLocalChat(item.conversation.id)
              .then(refreshStats)
              .catch((error: unknown) => {
                Alert.alert(t('clearStorageFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
              });
          },
        },
      ],
    );
  }

  if (isLoading || !stats) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
        <Pressable accessibilityLabel={t('close')} onPress={() => navigation.goBack()} style={({ pressed }) => [styles.screenCloseButton, pressed ? styles.rowPressed : undefined]}>
          <Ionicons color={colors.textPrimary} name="close" size={22} />
        </Pressable>
        <StorageStatRow icon="call-outline" label={t('totalVoiceCalls')} onPress={() => setActiveMetric('voiceCalls')} value={t('callsCountAndDuration', { count: visibleStats.voiceCallCount, duration: formatDuration(visibleStats.voiceCallDurationSeconds) })} />
        <StorageStatRow icon="videocam-outline" label={t('totalVideoCalls')} onPress={() => setActiveMetric('videoCalls')} value={t('callsCountAndDuration', { count: visibleStats.videoCallCount, duration: formatDuration(visibleStats.videoCallDurationSeconds) })} />
        <StorageStatRow icon="images-outline" label={t('mediaSentReceived')} onPress={() => setActiveMetric('media')} value={t('sentReceivedMegabytes', { received: formatMegabytes(visibleStats.mediaReceivedBytes), sent: formatMegabytes(visibleStats.mediaSentBytes) })} />
        <StorageStatRow icon="chatbubble-ellipses-outline" label={t('messagesSentReceived')} onPress={() => setActiveMetric('messages')} value={t('sentReceivedCount', { received: visibleStats.messagesReceived, sent: visibleStats.messagesSent })} />
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('currentStorageUsage')}</Text>
          <StorageStatRow icon="image-outline" label={t('photos')} onPress={() => setActiveMetric('photos')} value={formatMegabytes(visibleStats.photoStorageBytes)} />
          <StorageStatRow icon="film-outline" label={t('videos')} onPress={() => setActiveMetric('videos')} value={formatMegabytes(visibleStats.videoStorageBytes)} />
          <StorageStatRow icon="document-text-outline" label={t('files')} onPress={() => setActiveMetric('files')} value={formatMegabytes(visibleStats.fileStorageBytes)} />
        </View>
      </ScrollView>
      <Modal animationType="slide" transparent visible={!!activeMetric} onRequestClose={() => setActiveMetric(null)}>
        <View style={styles.modalBackdrop}>
          <Pressable onPress={() => setActiveMetric(null)} style={StyleSheet.absoluteFill} />
          <View style={styles.detailPanel}>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{activeMetricTitle}</Text>
              <Pressable onPress={() => setActiveMetric(null)} style={styles.closeButton}>
                <Ionicons color={colors.textSecondary} name="close" size={22} />
              </Pressable>
            </View>
            <FlatList
              contentContainerStyle={detailItems.length === 0 ? styles.detailEmptyList : styles.detailList}
              data={detailItems}
              keyExtractor={(item) => item.conversation.id}
              ListEmptyComponent={<Text style={styles.emptyText}>{t('noStorageUsageFound')}</Text>}
              renderItem={({ item }) => (
                <View style={styles.detailRow}>
                  <View style={styles.detailText}>
                    <Text numberOfLines={1} style={styles.detailName}>{item.conversation.title}</Text>
                    <Text style={styles.detailKind}>{t(item.conversation.type === 'GROUP' ? 'group' : 'privateChat')}</Text>
                    <Text style={styles.detailValue}>{item.value}</Text>
                  </View>
                  <Pressable onPress={() => clearConversation(item)} style={styles.clearButton}>
                    <Ionicons color={colors.danger} name="trash-outline" size={18} />
                    <Text style={styles.clearButtonText}>{t('clear')}</Text>
                  </Pressable>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function StorageStatRow({ icon, label, onPress, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; value: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : undefined]}>
      <View style={styles.iconWrap}>
        <Ionicons color={colors.primary} name={icon} size={22} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{value}</Text>
      </View>
      <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
    </Pressable>
  );
}

function getMetricTitle(metric: StorageMetric) {
  switch (metric) {
    case 'voiceCalls':
      return t('totalVoiceCalls');
    case 'videoCalls':
      return t('totalVideoCalls');
    case 'media':
      return t('mediaSentReceived');
    case 'messages':
      return t('messagesSentReceived');
    case 'photos':
      return t('photos');
    case 'videos':
      return t('videos');
    case 'files':
      return t('files');
  }
}

function getMetricWeight(metric: StorageMetric, stats: LocalConversationUsageStats) {
  switch (metric) {
    case 'voiceCalls':
      return stats.voiceCallCount;
    case 'videoCalls':
      return stats.videoCallCount;
    case 'media':
      return stats.mediaSentBytes + stats.mediaReceivedBytes;
    case 'messages':
      return stats.messagesSent + stats.messagesReceived;
    case 'photos':
      return stats.photoStorageBytes;
    case 'videos':
      return stats.videoStorageBytes;
    case 'files':
      return stats.fileStorageBytes;
  }
}

function formatMetricValue(metric: StorageMetric, stats: LocalConversationUsageStats) {
  switch (metric) {
    case 'voiceCalls':
      return t('callsCountAndDuration', { count: stats.voiceCallCount, duration: formatDuration(stats.voiceCallDurationSeconds) });
    case 'videoCalls':
      return t('callsCountAndDuration', { count: stats.videoCallCount, duration: formatDuration(stats.videoCallDurationSeconds) });
    case 'media':
      return t('sentReceivedMegabytes', { received: formatMegabytes(stats.mediaReceivedBytes), sent: formatMegabytes(stats.mediaSentBytes) });
    case 'messages':
      return t('sentReceivedCount', { received: stats.messagesReceived, sent: stats.messagesSent });
    case 'photos':
      return formatMegabytes(stats.photoStorageBytes);
    case 'videos':
      return formatMegabytes(stats.videoStorageBytes);
    case 'files':
      return formatMegabytes(stats.fileStorageBytes);
  }
}

function sumConversationUsageStats(items: LocalConversationUsageStats[]): LocalUsageStats {
  return items.reduce<LocalUsageStats>((total, item) => ({
    fileStorageBytes: total.fileStorageBytes + item.fileStorageBytes,
    mediaReceivedBytes: total.mediaReceivedBytes + item.mediaReceivedBytes,
    mediaSentBytes: total.mediaSentBytes + item.mediaSentBytes,
    messagesReceived: total.messagesReceived + item.messagesReceived,
    messagesSent: total.messagesSent + item.messagesSent,
    photoStorageBytes: total.photoStorageBytes + item.photoStorageBytes,
    videoStorageBytes: total.videoStorageBytes + item.videoStorageBytes,
    voiceCallCount: total.voiceCallCount + item.voiceCallCount,
    voiceCallDurationSeconds: total.voiceCallDurationSeconds + item.voiceCallDurationSeconds,
    videoCallCount: total.videoCallCount + item.videoCallCount,
    videoCallDurationSeconds: total.videoCallDurationSeconds + item.videoCallDurationSeconds,
  }), {
    fileStorageBytes: 0,
    mediaReceivedBytes: 0,
    mediaSentBytes: 0,
    messagesReceived: 0,
    messagesSent: 0,
    photoStorageBytes: 0,
    videoStorageBytes: 0,
    voiceCallCount: 0,
    voiceCallDurationSeconds: 0,
    videoCallCount: 0,
    videoCallDurationSeconds: 0,
  });
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createStyles() {
  return StyleSheet.create({
    clearButton: {
      alignItems: 'center',
      borderColor: colors.danger,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.xs,
      minHeight: 40,
      paddingHorizontal: spacing.md,
    },
    clearButtonText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '900',
    },
    closeButton: {
      alignItems: 'center',
      borderRadius: 16,
      height: 34,
      justifyContent: 'center',
      width: 34,
    },
    content: {
      gap: spacing.md,
      padding: spacing.lg,
    },
    detailEmptyList: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: spacing.xl,
    },
    detailHeader: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingBottom: spacing.md,
    },
    detailKind: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    detailList: {
      gap: spacing.sm,
      paddingTop: spacing.md,
    },
    detailName: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '900',
    },
    detailPanel: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      maxHeight: '82%',
      minHeight: '48%',
      padding: spacing.lg,
    },
    detailRow: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 16,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.md,
      padding: spacing.md,
    },
    detailText: {
      flex: 1,
      gap: 3,
      minWidth: 0,
    },
    detailTitle: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 20,
      fontWeight: '900',
    },
    detailValue: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '800',
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 15,
      fontWeight: '800',
      textAlign: 'center',
    },
    iconWrap: {
      alignItems: 'center',
      backgroundColor: colors.outgoingBubble,
      borderRadius: 16,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    label: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '900',
    },
    loadingScreen: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      flex: 1,
      justifyContent: 'center',
    },
    modalBackdrop: {
      backgroundColor: 'rgba(0,0,0,0.45)',
      flex: 1,
      justifyContent: 'flex-end',
    },
    row: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: spacing.md,
      padding: spacing.lg,
    },
    rowPressed: {
      opacity: 0.72,
    },
    rowText: {
      flex: 1,
      gap: 4,
    },
    screen: {
      backgroundColor: colors.appBackground,
    },
    screenCloseButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      height: 38,
      justifyContent: 'center',
      width: 38,
    },
    section: {
      gap: spacing.md,
      marginTop: spacing.sm,
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '900',
      paddingHorizontal: spacing.xs,
      textTransform: 'uppercase',
    },
    value: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
