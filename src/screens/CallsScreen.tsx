import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenBackground } from '../components/ScreenBackground';
import { useVoiceCallTip } from '../hooks/useVoiceCallTip';
import { t } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { useThemeColors } from '../theme/useThemeColors';
import { spacing } from '../theme/spacing';
import { CallLog } from '../types/domain';
import { RootStackParamList } from '../types/navigation';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export function CallsScreen() {
  useThemeColors();
  styles = createStyles();
  const navigation = useNavigation<Navigation>();
  const callLogs = useAppStore((state) => state.callLogs);
  const language = useAppStore((state) => state.language);
  const user = useAppStore((state) => state.user);
  const deleteCallLog = useAppStore((state) => state.deleteCallLog);
  const loadCallLogs = useAppStore((state) => state.loadCallLogs);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { showVoiceCallTip, voiceCallTipModal } = useVoiceCallTip(user?.id);

  useFocusEffect(
    useCallback(() => {
      void loadCallLogs();
    }, [loadCallLogs]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('calls', {}, language),
    });
  }, [language, navigation]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search.trim().toLowerCase());
    }, 350);

    return () => clearTimeout(timeout);
  }, [search]);

  const isSearchActive = debouncedSearch.length >= 2;
  const visibleCallLogs = useMemo(() => {
    if (!isSearchActive) {
      return callLogs;
    }

    return callLogs.filter((callLog) => callLog.title.toLowerCase().includes(debouncedSearch));
  }, [callLogs, debouncedSearch, isSearchActive]);

  async function startCall(callLog: CallLog, mode: 'voice' | 'video') {
    if (!callLog.conversationId) {
      return;
    }

    if (mode === 'voice') {
      await showVoiceCallTip();
    }

    Alert.alert(
      mode === 'video' ? t('startVideoCallQuestion') : t('startVoiceCallQuestion'),
      t('callNameQuestion', { name: callLog.title }),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('call'),
          onPress: () => {
            navigation.navigate('CallRoom', {
              conversationId: callLog.conversationId!,
              direction: 'outgoing',
              mode,
              title: callLog.title,
            });
          },
        },
      ],
    );
  }

  function showCallMenu(callLog: CallLog) {
    const deleteCall = (mode: 'all' | 'me') => {
      void deleteCallLog(callLog.id, mode).catch((error) => {
        Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      });
    };

    Alert.alert(callLog.title, t('chooseAction'), [
      {
        text: t('deleteForAnyone'),
        style: 'destructive',
        onPress: () => deleteCall('all'),
      },
      { text: t('deleteForMe'), onPress: () => deleteCall('me') },
      { text: t('cancel'), style: 'cancel' },
    ]);
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
          {search ? (
            <Pressable onPress={() => setSearch('')} style={styles.clearSearch}>
              <Ionicons color={colors.mutedText} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>
      <FlatList
        contentContainerStyle={[styles.list, visibleCallLogs.length === 0 && styles.emptyList]}
        data={visibleCallLogs}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons color={colors.primary} name={debouncedSearch.length > 0 ? 'search-outline' : 'call-outline'} size={44} />
            <Text style={styles.emptyTitle}>
              {debouncedSearch.length > 0 && debouncedSearch.length < 2
                ? t('typeAtLeast2Characters')
                : isSearchActive
                  ? t('noMatches')
                  : t('noCallsYet')}
            </Text>
            {debouncedSearch.length > 0 ? (
              <Text style={styles.emptyText}>
                {debouncedSearch.length < 2 ? t('typeAtLeast2CharactersToFind') : t('tryAnotherSearch')}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => showCallMenu(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={styles.callIcon}>
              <Ionicons color={getOutcomeColor(item)} name={getCallIcon(item)} size={22} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.title}</Text>
              <View style={styles.badgeLine}>
                <View style={styles.directionBadge}>
                  <Text style={styles.directionBadgeText}>{getDirectionLabel(item.direction)}</Text>
                </View>
                {item.status && item.status !== 'answered' ? (
                  <View style={styles.outcomeBadge}>
                    <Text style={styles.outcomeBadgeText}>{getStatusLabel(item.status)}</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.metaLine}>
                <Ionicons color={getDirectionColor(item.direction)} name={getDirectionIcon(item.direction)} size={14} />
                <Text style={styles.meta}>{getDirectionLabel(item.direction)} · {item.happenedAt}</Text>
              </View>
            </View>
            <Pressable disabled={!item.conversationId} onPress={() => void startCall(item, 'voice')} style={styles.actionButton}>
              <Ionicons color={colors.primary} name="call-outline" size={23} />
            </Pressable>
            <Pressable disabled={!item.conversationId} onPress={() => void startCall(item, 'video')} style={styles.actionButton}>
              <Ionicons color={colors.primary} name="videocam-outline" size={24} />
            </Pressable>
          </Pressable>
        )}
      />
      {voiceCallTipModal}
    </ScreenBackground>
  );
}

function getDirectionIcon(direction: CallLog['direction']): keyof typeof Ionicons.glyphMap {
  if (direction === 'incoming') {
    return 'arrow-down-left-box';
  }

  return 'arrow-up-right-box';
}

function getDirectionColor(direction: CallLog['direction']) {
  return direction === 'incoming' ? colors.secondary : colors.primary;
}

function getDirectionLabel(direction: CallLog['direction']) {
  if (direction === 'incoming') {
    return t('incoming');
  }

  return t('outgoing');
}

function getOutcomeColor(callLog: CallLog) {
  return callLog.status && callLog.status !== 'answered' ? colors.danger : colors.primary;
}

function getCallIcon(callLog: CallLog): keyof typeof Ionicons.glyphMap {
  if (callLog.status === 'cancelled') {
    return 'close-circle';
  }

  if (callLog.status === 'declined') {
    return 'remove-circle';
  }

  if (callLog.status === 'missed') {
    return 'alert-circle';
  }

  return callLog.mode === 'video' ? 'videocam' : 'call';
}

function getStatusLabel(status: CallLog['status']) {
  if (status === 'cancelled') {
    return t('cancelled');
  }

  if (status === 'declined') {
    return t('declined');
  }

  if (status === 'missed') {
    return t('notAnswered');
  }

  return t('answered');
}

function createStyles() {
  return StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  callIcon: {
    alignItems: 'center',
    backgroundColor: '#e0f5ed',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  badgeLine: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  directionBadge: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  directionBadgeText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '900',
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
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
  },
  list: {
    backgroundColor: 'transparent',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  metaLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  outcomeBadge: {
    borderColor: colors.danger,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  outcomeBadgeText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '900',
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
  rowPressed: {
    backgroundColor: colors.surface,
  },
  clearSearch: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  rowText: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    gap: 4,
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
});
}

let styles = createStyles();
