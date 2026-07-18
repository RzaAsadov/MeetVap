import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { ScreenBackground } from '../components/ScreenBackground';
import { t } from '../i18n';
import { beginAppLockForegroundOperation } from '../lib/appLockAccess';
import { listStatusViewers, type StatusAudience, type StatusGroup, type StatusUpdate, type StatusViewer } from '../lib/backend';
import { saveNativeAndroidFile, shareNativeAndroidFile } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { useThemeColors } from '../theme/useThemeColors';
import type { AuthUser } from '../types/domain';
import type { MainTabParamList } from '../types/navigation';

const STATUS_TEXT_COLORS = ['#2563eb', '#0f766e', '#7c3aed', '#dc2626', '#ea580c', '#111827'];
const DEFAULT_STATUS_DURATION_MS = 5_000;

type PendingStatusMedia = {
  durationSeconds?: number;
  fileName: string;
  kind: 'image' | 'video';
  mimeType: string;
  sizeBytes?: number;
  uri: string;
};

type Navigation = BottomTabNavigationProp<MainTabParamList, 'Status'>;

type StatusListItem =
  | { id: string; type: 'my-status' }
  | { id: string; title: string; type: 'section' }
  | { group: StatusGroup; id: string; type: 'group' };

type AudienceContactPickerMode = 'except' | 'only';

export function StatusScreen() {
  useThemeColors();
  styles = createStyles();
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RouteProp<MainTabParamList, 'Status'>>();
  const insets = useSafeAreaInsets();
  const groups = useAppStore((state) => state.statusGroups);
  const isLoading = useAppStore((state) => state.isLoadingStatuses);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const user = useAppStore((state) => state.user);
  const loadStatuses = useAppStore((state) => state.loadStatuses);
  const createTextStatus = useAppStore((state) => state.createTextStatus);
  const createMediaStatus = useAppStore((state) => state.createMediaStatus);
  const contacts = useAppStore((state) => state.contacts);
  const loadContacts = useAppStore((state) => state.loadContacts);
  const markStatusViewed = useAppStore((state) => state.markStatusViewed);
  const deleteStatusById = useAppStore((state) => state.deleteStatusById);
  const replyToStatus = useAppStore((state) => state.replyToStatus);
  const [viewerGroup, setViewerGroup] = useState<StatusGroup | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [replyText, setReplyText] = useState('');
  const [isSendingReply, setSendingReply] = useState(false);
  const [textComposerVisible, setTextComposerVisible] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusColor, setStatusColor] = useState(STATUS_TEXT_COLORS[0]);
  const [isCreating, setCreating] = useState(false);
  const [isViewerPaused, setViewerPaused] = useState(false);
  const [viewerProgress, setViewerProgress] = useState(0);
  const [videoRestartNonce, setVideoRestartNonce] = useState(0);
  const [addMenuVisible, setAddMenuVisible] = useState(false);
  const [captionText, setCaptionText] = useState('');
  const [managerVisible, setManagerVisible] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingStatusMedia | null>(null);
  const [audienceMenuVisible, setAudienceMenuVisible] = useState(false);
  const [audienceContactPickerMode, setAudienceContactPickerMode] = useState<AudienceContactPickerMode | null>(null);
  const [statusAudience, setStatusAudience] = useState<StatusAudience>('CONTACTS');
  const [exceptUserIds, setExceptUserIds] = useState<string[]>([]);
  const [onlyUserIds, setOnlyUserIds] = useState<string[]>([]);
  const [draftAudienceUserIds, setDraftAudienceUserIds] = useState<string[]>([]);
  const [statusActionTarget, setStatusActionTarget] = useState<StatusUpdate | null>(null);
  const [statusActionViewers, setStatusActionViewers] = useState<StatusViewer[]>([]);
  const [isLoadingStatusViewers, setLoadingStatusViewers] = useState(false);
  const activeStatusIdRef = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    void loadStatuses().catch(() => undefined);
  }, [loadStatuses]));

  useEffect(() => {
    if (audienceContactPickerMode) {
      void loadContacts().catch(() => undefined);
    }
  }, [audienceContactPickerMode, loadContacts]);

  const myGroup = useMemo(() => groups.find((group) => group.author.id === user?.id) ?? null, [groups, user?.id]);
  const visibleGroups = useMemo(() => groups.filter((group) => group.author.id !== user?.id), [groups, user?.id]);
  const statusListItems = useMemo<StatusListItem[]>(() => {
    const unviewed = visibleGroups.filter((group) => group.hasUnviewed);
    const viewed = visibleGroups.filter((group) => !group.hasUnviewed);
    const items: StatusListItem[] = [{ id: 'my-status', type: 'my-status' }];

    if (unviewed.length > 0) {
      items.push({ id: 'section-new', title: t('newStatuses'), type: 'section' });
      items.push(...unviewed.map((group) => ({ group, id: `group-${group.author.id}`, type: 'group' as const })));
    }

    if (viewed.length > 0) {
      items.push({ id: 'section-viewed', title: t('viewedStatuses'), type: 'section' });
      items.push(...viewed.map((group) => ({ group, id: `group-${group.author.id}`, type: 'group' as const })));
    }

    return items;
  }, [visibleGroups]);
  const latestMyStatus = myGroup?.statuses[myGroup.statuses.length - 1] ?? null;
  const requestedStatusAuthorId = route.params?.authorId;
  const activeStatus = viewerGroup?.statuses[viewerIndex] ?? null;
  const isOwnStatus = !!activeStatus && activeStatus.authorId === user?.id;
  const hasReplyDraft = replyText.length > 0;
  const shouldPauseViewer = isViewerPaused || hasReplyDraft;
  const hadReplyDraftRef = useRef(false);

  useEffect(() => {
    if (!activeStatus) {
      activeStatusIdRef.current = null;
      setViewerProgress(0);
      setVideoRestartNonce((value) => value + 1);
      return;
    }

    if (activeStatusIdRef.current !== activeStatus.id) {
      activeStatusIdRef.current = activeStatus.id;
      setViewerProgress(0);
      setViewerPaused(false);
      setVideoRestartNonce((value) => value + 1);
      hadReplyDraftRef.current = false;
    }
  }, [activeStatus]);

  useEffect(() => {
    if (!activeStatus || shouldPauseViewer) {
      return undefined;
    }

    const durationMs = getStatusDurationMs(activeStatus);
    const startedAt = Date.now() - viewerProgress * durationMs;
    const interval = setInterval(() => {
      const nextProgress = Math.min(1, (Date.now() - startedAt) / durationMs);
      setViewerProgress(nextProgress);
      if (nextProgress >= 1) {
        clearInterval(interval);
        openNextStatus();
      }
    }, 80);

    return () => clearInterval(interval);
  }, [activeStatus, shouldPauseViewer, viewerProgress]);

  useEffect(() => {
    if (!activeStatus) {
      hadReplyDraftRef.current = false;
      return;
    }

    if (hasReplyDraft) {
      hadReplyDraftRef.current = true;
      return;
    }

    if (hadReplyDraftRef.current) {
      hadReplyDraftRef.current = false;
      setViewerProgress(0);
      setVideoRestartNonce((value) => value + 1);
    }
  }, [activeStatus, hasReplyDraft]);

  useEffect(() => {
    if (!requestedStatusAuthorId) {
      return;
    }

    const group = groups.find((item) => item.author.id === requestedStatusAuthorId);

    if (!group || group.statuses.length === 0) {
      return;
    }

    const firstUnviewedIndex = group.statuses.findIndex((status) => !status.viewedByMe);
    const nextIndex = firstUnviewedIndex >= 0 ? firstUnviewedIndex : 0;
    setViewerGroup(group);
    setViewerIndex(nextIndex);
    setReplyText('');
    setViewerProgress(0);
    const status = group.statuses[nextIndex];
    if (status && status.authorId !== user?.id) {
      void markStatusViewed(status.id).catch(() => undefined);
    }
    navigation.setParams({ authorId: undefined });
  }, [groups, markStatusViewed, navigation, requestedStatusAuthorId, user?.id]);

  function openGroup(group: StatusGroup) {
    const firstUnviewedIndex = group.statuses.findIndex((status) => !status.viewedByMe);
    const nextIndex = firstUnviewedIndex >= 0 ? firstUnviewedIndex : 0;
    setViewerGroup(group);
    setViewerIndex(nextIndex);
    setReplyText('');
    setViewerProgress(0);
    const status = group.statuses[nextIndex];
    if (status && status.authorId !== user?.id) {
      void markStatusViewed(status.id).catch(() => undefined);
    }
  }

  function openGroupAtIndex(group: StatusGroup, index: number) {
    const nextIndex = Math.max(0, Math.min(index, group.statuses.length - 1));
    setManagerVisible(false);
    setViewerGroup(group);
    setViewerIndex(nextIndex);
    setReplyText('');
    setViewerProgress(0);
    const status = group.statuses[nextIndex];
    if (status && status.authorId !== user?.id) {
      void markStatusViewed(status.id).catch(() => undefined);
    }
  }

  function openNextStatus() {
    if (!viewerGroup) {
      return;
    }

    const nextIndex = viewerIndex + 1;
    if (nextIndex >= viewerGroup.statuses.length) {
      setViewerGroup(null);
      return;
    }

    setViewerIndex(nextIndex);
    setReplyText('');
    setViewerProgress(0);
    const status = viewerGroup.statuses[nextIndex];
    if (status.authorId !== user?.id) {
      void markStatusViewed(status.id).catch(() => undefined);
    }
  }

  function openPreviousStatus() {
    if (!viewerGroup) {
      return;
    }

    const previousIndex = viewerIndex - 1;
    if (previousIndex < 0) {
      setViewerProgress(0);
      return;
    }

    setViewerIndex(previousIndex);
    setReplyText('');
    setViewerProgress(0);
    const status = viewerGroup.statuses[previousIndex];
    if (status.authorId !== user?.id) {
      void markStatusViewed(status.id).catch(() => undefined);
    }
  }

  async function pickMediaStatus() {
    resetStatusAudience();
    setAddMenuVisible(false);
    await waitForStatusModalTransition();

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('photoLibraryPermissionNeeded'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: false,
        mediaTypes: ['images', 'videos'],
        quality: 0.82,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setCreating(true);
      setPendingMedia(createPendingMediaFromAsset(asset));
      setCaptionText('');
    } finally {
      setCreating(false);
      endLockDeferral();
    }
  }

  async function captureMediaStatus() {
    resetStatusAudience();
    setAddMenuVisible(false);
    await waitForStatusModalTransition();

    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('cameraPermissionNeeded'));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.82,
        videoMaxDuration: 60,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      setCreating(true);
      setPendingMedia(createPendingMediaFromAsset(asset));
      setCaptionText('');
    } finally {
      setCreating(false);
      endLockDeferral();
    }
  }

  async function submitMediaStatus() {
    if (!pendingMedia) {
      return;
    }

    setCreating(true);
    try {
      await createMediaStatus({
        ...pendingMedia,
        body: captionText,
        ...getStatusAudiencePayload(),
      });
      setCaptionText('');
      setPendingMedia(null);
      resetStatusAudience();
    } catch (error) {
      Alert.alert(t('statusCreateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setCreating(false);
    }
  }

  async function submitTextStatus() {
    const body = statusText.trim();
    if (!body) {
      return;
    }

    setCreating(true);
    try {
      await createTextStatus(body, statusColor, getStatusAudiencePayload());
      setStatusText('');
      setTextComposerVisible(false);
      setAddMenuVisible(false);
      resetStatusAudience();
    } catch (error) {
      Alert.alert(t('statusCreateFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setCreating(false);
    }
  }

  async function sendReply() {
    if (!activeStatus || !replyText.trim()) {
      return;
    }

    setSendingReply(true);
    try {
      await replyToStatus(activeStatus.id, replyText.trim());
      setReplyText('');
      Alert.alert(t('sent'), t('statusReplySent'));
    } catch (error) {
      Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      setSendingReply(false);
    }
  }

  async function deleteActiveStatus() {
    if (!activeStatus) {
      return;
    }

    Alert.alert(t('deleteStatus'), t('deleteStatusQuestion'), [
      { style: 'cancel', text: t('cancel') },
      {
        style: 'destructive',
        text: t('delete'),
        onPress: () => {
          void deleteStatusById(activeStatus.id)
            .then(() => setViewerGroup(null))
            .catch((error) => Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain')));
        },
      },
    ]);
  }

  function openStatusActions(status: StatusUpdate) {
    setStatusActionTarget(status);
    setStatusActionViewers([]);

    if (!serverUrl) {
      return;
    }

    setLoadingStatusViewers(true);
    void listStatusViewers(serverUrl, status.id)
      .then(setStatusActionViewers)
      .catch(() => setStatusActionViewers([]))
      .finally(() => setLoadingStatusViewers(false));
  }

  function closeStatusActions() {
    setStatusActionTarget(null);
    setStatusActionViewers([]);
    setLoadingStatusViewers(false);
  }

  async function deleteStatusFromActions(status: StatusUpdate) {
    try {
      await deleteStatusById(status.id);
      closeStatusActions();
      await loadStatuses();
    } catch (error) {
      Alert.alert(t('deleteFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  function resetStatusAudience() {
    setStatusAudience('CONTACTS');
    setExceptUserIds([]);
    setOnlyUserIds([]);
  }

  function getStatusAudiencePayload() {
    if (statusAudience === 'CONTACTS_EXCEPT') {
      return {
        audience: statusAudience,
        exceptUserIds,
      };
    }

    if (statusAudience === 'ONLY_SHARE_WITH') {
      return {
        audience: statusAudience,
        onlyUserIds,
      };
    }

    return { audience: 'CONTACTS' as const };
  }

  function getStatusAudienceLabel() {
    if (statusAudience === 'CONTACTS_EXCEPT') {
      return t('statusAudienceExceptCount', { count: exceptUserIds.length });
    }

    if (statusAudience === 'ONLY_SHARE_WITH') {
      return t('statusAudienceOnlyCount', { count: onlyUserIds.length });
    }

    return t('contacts');
  }

  function openAudienceContactPicker(mode: AudienceContactPickerMode) {
    setAudienceMenuVisible(false);
    setAudienceContactPickerMode(mode);
    setDraftAudienceUserIds(mode === 'except' ? exceptUserIds : onlyUserIds);
  }

  function toggleDraftAudienceUser(userId: string) {
    setDraftAudienceUserIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  }

  function applyAudienceContactSelection() {
    if (audienceContactPickerMode === 'except') {
      setStatusAudience('CONTACTS_EXCEPT');
      setExceptUserIds(draftAudienceUserIds);
    } else if (audienceContactPickerMode === 'only') {
      setStatusAudience('ONLY_SHARE_WITH');
      setOnlyUserIds(draftAudienceUserIds);
    }

    setAudienceContactPickerMode(null);
  }

  async function saveStatusMedia(status: StatusUpdate) {
    try {
      if (!status.mediaUri || status.kind === 'TEXT') {
        throw new Error(t('mediaUnavailable'));
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);
      if (!permission?.granted) {
        Alert.alert(t('permissionNeeded'), t('saveToPhonePermission'));
        return;
      }

      const localUri = await getShareableStatusUri(status);
      const saved = await saveNativeAndroidFile(localUri, status.media?.mimeType, status.media?.originalName);
      if (!saved) {
        throw new Error(t('pleaseTryAgain'));
      }
      Alert.alert(t('saved'), t('statusSaved'));
    } catch (error) {
      Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function shareStatusMedia(status: StatusUpdate) {
    try {
      if (!status.mediaUri || status.kind === 'TEXT') {
        throw new Error(t('mediaUnavailable'));
      }

      const localUri = await getShareableStatusUri(status);
      const shared = await shareNativeAndroidFile(localUri, status.media?.mimeType, status.media?.originalName);
      if (!shared) {
        throw new Error(t('pleaseTryAgain'));
      }
    } catch (error) {
      Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  return (
    <ScreenBackground>
      <View style={styles.container}>
        {isLoading && groups.length === 0 ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}

        <FlatList
          contentContainerStyle={[styles.list, statusListItems.length === 0 && styles.emptyList]}
          data={statusListItems}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={!isLoading ? (
            <View style={styles.emptyState}>
              <Ionicons color={colors.textSecondary} name="ellipse-outline" size={46} />
              <Text style={styles.emptyTitle}>{t('noStatusesYet')}</Text>
              <Text style={styles.emptyText}>{t('noStatusesYetDescription')}</Text>
            </View>
          ) : null}
          renderItem={({ item }) => (
            item.type === 'my-status' ? (
              <MyStatusRow
                latestStatus={latestMyStatus}
                onAdd={() => setAddMenuVisible(true)}
                onPress={() => {
                  if (myGroup) {
                    setManagerVisible(true);
                  } else {
                    setAddMenuVisible(true);
                  }
                }}
              />
            ) : item.type === 'section' ? (
              <Text style={styles.sectionTitle}>{item.title}</Text>
            ) : (
              <StatusRow group={item.group} onPress={() => openGroup(item.group)} />
            )
          )}
        />
      </View>

      <Pressable disabled={isCreating} onPress={() => setAddMenuVisible(true)} style={[styles.fab, { bottom: Math.max(insets.bottom + spacing.lg, spacing.xl) }]}>
        <Ionicons color={colors.white} name="add" size={30} />
      </Pressable>

      <Modal animationType="fade" onRequestClose={() => setAddMenuVisible(false)} transparent visible={addMenuVisible}>
        <Pressable onPress={() => setAddMenuVisible(false)} style={styles.modalBackdrop}>
          <View style={styles.actionSheet}>
            <Text style={styles.modalTitle}>{t('addStatusUpdate')}</Text>
            <Pressable onPress={() => {
              resetStatusAudience();
              setTextComposerVisible(true);
            }} style={styles.actionSheetItem}>
              <Ionicons color={colors.primary} name="text-outline" size={22} />
              <Text style={styles.actionSheetText}>{t('textStatus')}</Text>
            </Pressable>
            <Pressable onPress={() => void pickMediaStatus()} style={styles.actionSheetItem}>
              <Ionicons color={colors.primary} name="images-outline" size={22} />
              <Text style={styles.actionSheetText}>{t('gallery')}</Text>
            </Pressable>
            <Pressable onPress={() => void captureMediaStatus()} style={styles.actionSheetItem}>
              <Ionicons color={colors.primary} name="camera-outline" size={22} />
              <Text style={styles.actionSheetText}>{t('camera')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setManagerVisible(false)} transparent visible={managerVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.managerSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('myStatus')}</Text>
              <Pressable onPress={() => setManagerVisible(false)} style={styles.iconButton}>
                <Ionicons color={colors.textPrimary} name="close" size={22} />
              </Pressable>
            </View>
            {(myGroup?.statuses ?? []).map((status, index) => (
              <Pressable key={status.id} onPress={() => myGroup && openGroupAtIndex(myGroup, index)} style={styles.managerItem}>
                <StatusMiniPreview status={status} />
                <View style={styles.statusInfo}>
                  <Text numberOfLines={1} style={styles.statusName}>{getStatusTitle(status)}</Text>
                  <Text numberOfLines={1} style={styles.statusMeta}>{formatStatusTime(status.createdAt)}</Text>
                </View>
                <Pressable onPress={() => openStatusActions(status)} style={styles.iconButton}>
                  <Ionicons color={colors.textSecondary} name="ellipsis-vertical" size={22} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={closeStatusActions} transparent visible={!!statusActionTarget}>
        <View style={styles.modalBackdrop}>
          <View style={styles.statusActionsSheet}>
            <View style={styles.statusActionsHeader}>
              <Pressable onPress={closeStatusActions} style={styles.iconButton}>
                <Ionicons color={colors.textPrimary} name="close" size={23} />
              </Pressable>
              <Text numberOfLines={1} style={styles.statusActionsTitle}>{t('statusOptions')}</Text>
              <View style={styles.iconButton} />
            </View>
            {statusActionTarget ? (
              <>
                <View style={styles.statusActionsRow}>
                  <StatusInlineAction
                    icon="download-outline"
                    label={t('save')}
                    onPress={() => void saveStatusMedia(statusActionTarget)}
                  />
                  <StatusInlineAction
                    icon="share-social-outline"
                    label={t('share')}
                    onPress={() => void shareStatusMedia(statusActionTarget)}
                  />
                  <StatusInlineAction
                    destructive
                    icon="trash-outline"
                    label={t('remove')}
                    onPress={() => void deleteStatusFromActions(statusActionTarget)}
                  />
                </View>
                <Text style={styles.statusViewersTitle}>{t('statusViews', { count: statusActionViewers.length })}</Text>
                {isLoadingStatusViewers ? (
                  <ActivityIndicator color={colors.primary} style={styles.statusViewersLoader} />
                ) : (
                  <FlatList
                    contentContainerStyle={[styles.statusViewersList, statusActionViewers.length === 0 && styles.statusViewersListEmpty]}
                    data={statusActionViewers}
                    keyExtractor={(item) => item.user.id}
                    ListEmptyComponent={(
                      <View style={styles.emptyState}>
                        <Ionicons color={colors.textSecondary} name="eye-off-outline" size={38} />
                        <Text style={styles.emptyText}>{t('noStatusViewsYet')}</Text>
                      </View>
                    )}
                    renderItem={({ item }) => <StatusViewerRow viewer={item} />}
                  />
                )}
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setPendingMedia(null)} visible={!!pendingMedia}>
        {pendingMedia ? (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.captionScreen}>
            <View style={styles.captionPreview}>
              {pendingMedia.kind === 'image' ? (
                <Image resizeMode="contain" source={{ uri: pendingMedia.uri }} style={styles.viewerMedia} />
              ) : (
                <StatusVideo uri={pendingMedia.uri} />
              )}
            </View>
            <View style={styles.captionAudienceRow}>
              <StatusAudienceButton label={getStatusAudienceLabel()} onPress={() => setAudienceMenuVisible(true)} />
            </View>
            <View style={[styles.captionInputRow, { paddingBottom: Math.max(insets.bottom + spacing.sm, spacing.md) }]}>
              <Pressable onPress={() => setPendingMedia(null)} style={styles.captionCloseButton}>
                <Ionicons color={colors.white} name="close" size={24} />
              </Pressable>
              <TextInput
                onChangeText={setCaptionText}
                placeholder={t('addCaption')}
                placeholderTextColor="rgba(255,255,255,0.6)"
                style={styles.captionInput}
                value={captionText}
              />
              <Pressable disabled={isCreating} onPress={() => void submitMediaStatus()} style={[styles.captionSend, isCreating && styles.disabledButton]}>
                <Ionicons color={colors.white} name="send" size={20} />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        ) : null}
      </Modal>

      <Modal animationType="fade" onRequestClose={() => setTextComposerVisible(false)} transparent visible={textComposerVisible}>
        <View style={styles.modalBackdrop}>
          <View style={styles.textComposer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('textStatus')}</Text>
              <Pressable onPress={() => setTextComposerVisible(false)} style={styles.iconButton}>
                <Ionicons color={colors.textPrimary} name="close" size={22} />
              </Pressable>
            </View>
            <TextInput
              multiline
              onChangeText={setStatusText}
              placeholder={t('typeStatus')}
              placeholderTextColor={colors.textSecondary}
              style={[styles.statusTextInput, { backgroundColor: statusColor }]}
              value={statusText}
            />
            <View style={styles.colorRow}>
              {STATUS_TEXT_COLORS.map((color) => (
                <Pressable
                  accessibilityLabel={t('chooseColor')}
                  key={color}
                  onPress={() => setStatusColor(color)}
                  style={[styles.colorDot, { backgroundColor: color }, color === statusColor && styles.colorDotSelected]}
                />
              ))}
            </View>
            <StatusAudienceButton label={getStatusAudienceLabel()} onPress={() => setAudienceMenuVisible(true)} />
            <Pressable disabled={isCreating || !statusText.trim()} onPress={() => void submitTextStatus()} style={[styles.primaryButton, (!statusText.trim() || isCreating) && styles.disabledButton]}>
              <Text style={styles.primaryButtonText}>{isCreating ? t('sending') : t('shareStatus')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal animationType="fade" onRequestClose={() => setAudienceMenuVisible(false)} transparent visible={audienceMenuVisible}>
        <Pressable onPress={() => setAudienceMenuVisible(false)} style={styles.modalBackdrop}>
          <View style={styles.audienceSheet}>
            <Text style={styles.modalTitle}>{t('statusAudienceTitle')}</Text>
            <AudienceOption
              active={statusAudience === 'CONTACTS'}
              icon="people-outline"
              label={t('contacts')}
              onPress={() => {
                setStatusAudience('CONTACTS');
                setAudienceMenuVisible(false);
              }}
            />
            <AudienceOption
              active={statusAudience === 'CONTACTS_EXCEPT'}
              icon="remove-circle-outline"
              label={t('statusAudienceContactsExcept')}
              onPress={() => openAudienceContactPicker('except')}
            />
            <AudienceOption
              active={statusAudience === 'ONLY_SHARE_WITH'}
              icon="checkmark-circle-outline"
              label={t('statusAudienceOnlySelected')}
              onPress={() => openAudienceContactPicker('only')}
            />
          </View>
        </Pressable>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setAudienceContactPickerMode(null)} visible={!!audienceContactPickerMode}>
        <ScreenBackground>
          <View style={[styles.contactPickerScreen, { paddingTop: Math.max(insets.top, spacing.lg) }]}>
            <View style={styles.contactPickerHeader}>
              <Pressable onPress={() => setAudienceContactPickerMode(null)} style={styles.iconButton}>
                <Ionicons color={colors.textPrimary} name="close" size={24} />
              </Pressable>
              <Text numberOfLines={1} style={styles.contactPickerTitle}>
                {audienceContactPickerMode === 'except' ? t('statusAudienceContactsExcept') : t('statusAudienceOnlySelected')}
              </Text>
              <Pressable onPress={applyAudienceContactSelection} style={styles.doneButton}>
                <Text style={styles.doneButtonText}>{t('done')}</Text>
              </Pressable>
            </View>
            <FlatList
              contentContainerStyle={[styles.contactPickerList, contacts.length === 0 && styles.emptyList]}
              data={contacts}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={(
                <View style={styles.emptyState}>
                  <Ionicons color={colors.textSecondary} name="people-outline" size={44} />
                  <Text style={styles.emptyTitle}>{t('noContactsYet')}</Text>
                </View>
              )}
              renderItem={({ item }) => (
                <StatusAudienceContactRow
                  contact={item}
                  isSelected={draftAudienceUserIds.includes(item.id)}
                  onPress={() => toggleDraftAudienceUser(item.id)}
                />
              )}
            />
          </View>
        </ScreenBackground>
      </Modal>

      <Modal animationType="fade" onRequestClose={() => setViewerGroup(null)} visible={!!activeStatus}>
        {activeStatus ? (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
            style={[styles.viewer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
          >
            <StatusProgressBar
              activeIndex={viewerIndex}
              progress={viewerProgress}
              statuses={viewerGroup?.statuses ?? []}
            />
            <View style={styles.viewerHeader}>
              <Avatar label={viewerGroup?.author.displayName ?? 'M'} size={42} uri={viewerGroup?.author.avatarUrl} />
              <View style={styles.viewerTitleWrap}>
                <Text style={styles.viewerTitle}>{isOwnStatus ? t('myStatus') : viewerGroup?.author.displayName}</Text>
                <Text style={styles.viewerSubtitle}>{formatStatusTime(activeStatus.createdAt)}</Text>
              </View>
              {isOwnStatus ? (
                <Pressable onPress={() => void deleteActiveStatus()} style={styles.iconButton}>
                  <Ionicons color={colors.white} name="trash-outline" size={22} />
                </Pressable>
              ) : null}
              <Pressable onPress={() => setViewerGroup(null)} style={styles.iconButton}>
                <Ionicons color={colors.white} name="close" size={26} />
              </Pressable>
            </View>
            <View style={styles.viewerBody}>
              <StatusViewerContent paused={shouldPauseViewer} restartSignal={videoRestartNonce} status={activeStatus} />
              <Pressable
                onLongPress={() => undefined}
                onPress={openPreviousStatus}
                onPressIn={() => setViewerPaused(true)}
                onPressOut={() => setViewerPaused(false)}
                style={styles.viewerTapLeft}
              />
              <Pressable
                onLongPress={() => undefined}
                onPress={openNextStatus}
                onPressIn={() => setViewerPaused(true)}
                onPressOut={() => setViewerPaused(false)}
                style={styles.viewerTapRight}
              />
            </View>
            {isOwnStatus ? (
              <Text style={styles.viewerCount}>{t('statusViews', { count: activeStatus.viewerCount ?? 0 })}</Text>
            ) : (
              <View style={styles.replyRow}>
                <TextInput
                  onChangeText={setReplyText}
                  placeholder={t('reply')}
                  placeholderTextColor="rgba(255,255,255,0.72)"
                  style={styles.replyInput}
                  value={replyText}
                />
                <Pressable disabled={isSendingReply || !replyText.trim()} onPress={() => void sendReply()} style={styles.replyButton}>
                  <Ionicons color={colors.white} name="send" size={20} />
                </Pressable>
              </View>
            )}
          </KeyboardAvoidingView>
        ) : null}
      </Modal>
    </ScreenBackground>
  );
}

function StatusAudienceButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.audienceButton, pressed && styles.statusRowPressed]}>
      <Ionicons color={colors.primary} name="people-outline" size={18} />
      <Text numberOfLines={1} style={styles.audienceButtonText}>{label}</Text>
      <Ionicons color={colors.textSecondary} name="chevron-down" size={16} />
    </Pressable>
  );
}

function AudienceOption({ active, icon, label, onPress }: { active: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.audienceOption, pressed && styles.statusRowPressed]}>
      <Ionicons color={active ? colors.primary : colors.textSecondary} name={icon} size={22} />
      <Text style={styles.audienceOptionText}>{label}</Text>
      {active ? <Ionicons color={colors.primary} name="checkmark" size={22} /> : null}
    </Pressable>
  );
}

function StatusAudienceContactRow({ contact, isSelected, onPress }: { contact: AuthUser; isSelected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.contactPickerRow, pressed && styles.statusRowPressed]}>
      <Avatar label={contact.displayName} size={46} uri={contact.avatarUrl} />
      <View style={styles.statusInfo}>
        <Text numberOfLines={1} style={styles.statusName}>{contact.displayName}</Text>
        {!contact.hideNickname ? <Text numberOfLines={1} style={styles.statusMeta}>@{contact.username}</Text> : null}
      </View>
      <View style={[styles.contactCheck, isSelected && styles.contactCheckSelected]}>
        {isSelected ? <Ionicons color={colors.white} name="checkmark" size={18} /> : null}
      </View>
    </Pressable>
  );
}

function StatusInlineAction({ destructive = false, icon, label, onPress }: { destructive?: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  const tintColor = destructive ? colors.danger : colors.primary;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.statusInlineAction, pressed && styles.statusRowPressed]}>
      <Ionicons color={tintColor} name={icon} size={21} />
      <Text numberOfLines={1} style={[styles.statusInlineActionText, destructive && styles.statusInlineActionTextDestructive]}>{label}</Text>
    </Pressable>
  );
}

function StatusViewerRow({ viewer }: { viewer: StatusViewer }) {
  return (
    <View style={styles.statusViewerRow}>
      <Avatar label={viewer.user.displayName} size={42} uri={viewer.user.avatarUrl} />
      <View style={styles.statusInfo}>
        <Text numberOfLines={1} style={styles.statusName}>{viewer.user.displayName}</Text>
        <Text numberOfLines={1} style={styles.statusMeta}>{formatStatusViewTime(viewer.viewedAt)}</Text>
      </View>
      <Ionicons color={colors.textSecondary} name="eye-outline" size={19} />
    </View>
  );
}

function MyStatusRow({ latestStatus, onAdd, onPress }: { latestStatus?: StatusUpdate | null; onAdd: () => void; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.myStatusRow, pressed && styles.statusRowPressed]}>
      <View style={[styles.statusRing, latestStatus ? styles.statusRingActive : styles.statusRingViewed]}>
        {latestStatus ? (
          <StatusThumbnail status={latestStatus} size={52} />
        ) : (
          <View style={styles.myStatusEmptyAvatar}>
            <Ionicons color={colors.white} name="add" size={25} />
          </View>
        )}
      </View>
      <View style={styles.statusInfo}>
        <Text numberOfLines={1} style={styles.statusName}>{t('myStatus')}</Text>
        <Text numberOfLines={1} style={styles.statusMeta}>{latestStatus ? formatStatusTime(latestStatus.createdAt) : t('addStatusUpdate')}</Text>
      </View>
      <Pressable
        hitSlop={10}
        onPress={(event) => {
          event.stopPropagation();
          onAdd();
        }}
        style={styles.myStatusAddButton}
      >
        <Ionicons color={colors.white} name="add" size={20} />
      </Pressable>
    </Pressable>
  );
}

function StatusRow({ group, onPress }: { group: StatusGroup; onPress: () => void }) {
  const latest = group.statuses[group.statuses.length - 1];

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.statusRow, pressed && styles.statusRowPressed]}>
      <View style={[styles.statusRing, group.hasUnviewed ? styles.statusRingActive : styles.statusRingViewed]}>
        <StatusThumbnail fallbackLabel={group.author.displayName} fallbackUri={group.author.avatarUrl} status={latest} size={52} />
      </View>
      <View style={styles.statusInfo}>
        <Text numberOfLines={1} style={styles.statusName}>{group.author.displayName}</Text>
        <Text numberOfLines={1} style={styles.statusMeta}>{formatStatusTime(latest?.createdAt)}</Text>
      </View>
      <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
    </Pressable>
  );
}

function StatusThumbnail({ fallbackLabel, fallbackUri, size, status }: { fallbackLabel?: string; fallbackUri?: string | null; size: number; status?: StatusUpdate | null }) {
  const borderRadius = Math.round(size / 2);

  if (status?.kind === 'IMAGE' && status.mediaUri) {
    return <Image source={{ uri: status.mediaUri }} style={{ borderRadius, height: size, width: size }} />;
  }

  if (status?.kind === 'VIDEO' && status.mediaUri) {
    return (
      <View style={[styles.videoThumbnailWrap, { borderRadius, height: size, width: size }]}>
        <StatusVideoThumbnail borderRadius={borderRadius} size={size} uri={status.mediaUri} />
        <View style={styles.videoThumbnailOverlay}>
          <Ionicons color={colors.white} name="play" size={Math.max(16, Math.round(size * 0.38))} />
        </View>
      </View>
    );
  }

  if (status?.kind === 'TEXT') {
    return (
      <View style={[styles.thumbnailFallback, { backgroundColor: status.backgroundColor ?? colors.primary, borderRadius, height: size, width: size }]}>
        <Ionicons color={colors.white} name="text" size={Math.max(16, Math.round(size * 0.38))} />
      </View>
    );
  }

  return <Avatar label={fallbackLabel ?? 'M'} size={size} uri={fallbackUri} />;
}

function StatusViewerContent({ paused, restartSignal, status }: { paused: boolean; restartSignal: number; status: StatusUpdate }) {
  if (status.kind === 'IMAGE' && status.mediaUri) {
    return (
      <>
        <Image resizeMode="contain" source={{ uri: status.mediaUri }} style={styles.viewerMedia} />
        {status.body.trim() ? <Text style={styles.mediaCaption}>{status.body.trim()}</Text> : null}
      </>
    );
  }

  if (status.kind === 'VIDEO' && status.mediaUri) {
    return (
      <>
        <StatusVideo paused={paused} restartSignal={restartSignal} uri={status.mediaUri} />
        {status.body.trim() ? <Text style={styles.mediaCaption}>{status.body.trim()}</Text> : null}
      </>
    );
  }

  return (
    <View style={[styles.textStatusViewer, { backgroundColor: status.backgroundColor ?? '#2563eb' }]}>
      <Text style={styles.textStatusViewerText}>{status.body}</Text>
    </View>
  );
}

function StatusMiniPreview({ status }: { status: StatusUpdate }) {
  if (status.kind === 'IMAGE' && status.mediaUri) {
    return <Image source={{ uri: status.mediaUri }} style={styles.miniPreview} />;
  }

  if (status.kind === 'VIDEO') {
    return (
      <View style={[styles.miniPreviewFallback, styles.videoThumbnailWrap]}>
        {status.mediaUri ? <StatusVideoThumbnail borderRadius={10} size={54} uri={status.mediaUri} /> : null}
        <View style={styles.videoThumbnailOverlay}>
          <Ionicons color={colors.white} name="play" size={20} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.miniPreviewFallback, { backgroundColor: status.backgroundColor ?? colors.primary }]}>
      <Ionicons color={colors.white} name="text" size={20} />
    </View>
  );
}

function StatusVideoThumbnail({ borderRadius, size, uri }: { borderRadius: number; size: number; uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.currentTime = 0;
    instance.pause();
  });

  useEffect(() => {
    try {
      player.currentTime = 0;
      player.pause();
    } catch {
      // Ignore native player readiness while rendering a small thumbnail.
    }
  }, [player, uri]);

  return (
    <VideoView
      contentFit="cover"
      nativeControls={false}
      player={player}
      style={{ borderRadius, height: size, width: size }}
    />
  );
}

function StatusVideo({ paused = false, restartSignal = 0, uri }: { paused?: boolean; restartSignal?: number; uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.play();
  });

  useEffect(() => {
    try {
      player.currentTime = 0;
      if (!paused) {
        player.play();
      }
    } catch {
      // Ignore transient player state changes while the native view is mounting.
    }
  }, [player, restartSignal]);

  useEffect(() => {
    try {
      if (paused) {
        player.pause();
      } else {
        player.play();
      }
    } catch {
      // Ignore transient player state changes while the native view is mounting.
    }
  }, [paused, player]);

  return <VideoView contentFit="contain" nativeControls player={player} style={styles.viewerMedia} />;
}

function StatusProgressBar({ activeIndex, progress, statuses }: { activeIndex: number; progress: number; statuses: StatusUpdate[] }) {
  return (
    <View style={styles.progressRow}>
      {statuses.map((status, index) => (
        <View key={status.id} style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: index < activeIndex
                  ? '100%'
                  : index === activeIndex ? `${Math.max(0, Math.min(1, progress)) * 100}%` : '0%',
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function getStatusDurationMs(status: StatusUpdate) {
  if (status.kind === 'VIDEO') {
    const durationSeconds = status.media?.durationSec;
    if (typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0) {
      return Math.max(1_000, durationSeconds * 1000);
    }

    return 15_000;
  }

  return DEFAULT_STATUS_DURATION_MS;
}

function formatStatusTime(value?: string) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatStatusViewTime(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfViewedDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfViewedDay) / 86_400_000);

  if (dayDiff === 0) {
    return time;
  }

  if (dayDiff === 1) {
    return `${t('yesterday')} ${time}`;
  }

  if (dayDiff > 1 && dayDiff < 7) {
    return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  }

  return `${date.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${time}`;
}

function createPendingMediaFromAsset(asset: ImagePicker.ImagePickerAsset): PendingStatusMedia {
  const kind = asset.type === 'video' ? 'video' : 'image';

  return {
    durationSeconds: asset.duration ? asset.duration / 1000 : undefined,
    fileName: asset.fileName ?? (kind === 'video' ? 'status-video.mp4' : 'status-photo.jpg'),
    kind,
    mimeType: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
    sizeBytes: asset.fileSize,
    uri: asset.uri,
  };
}

function waitForStatusModalTransition() {
  if (Platform.OS !== 'ios') {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    setTimeout(resolve, 260);
  });
}

function getStatusTitle(status: StatusUpdate) {
  if (status.body.trim()) {
    return status.body.trim();
  }

  return status.kind === 'VIDEO' ? t('video') : status.kind === 'IMAGE' ? t('image') : t('textStatus');
}

async function getShareableStatusUri(status: StatusUpdate) {
  if (!status.mediaUri) {
    throw new Error(t('mediaUnavailable'));
  }

  if (!/^https?:\/\//i.test(status.mediaUri)) {
    return status.mediaUri;
  }

  const fileName = status.media?.originalName || `${status.id}.${status.kind === 'VIDEO' ? 'mp4' : 'jpg'}`;
  const localUri = `${FileSystem.cacheDirectory ?? ''}status-${status.id}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const info = await FileSystem.getInfoAsync(localUri);

  if (info.exists) {
    return localUri;
  }

  const download = await FileSystem.downloadAsync(status.mediaUri, localUri);
  return download.uri;
}

let styles = createStyles();

function createStyles() {
  return StyleSheet.create({
    avatarWrap: {
      position: 'relative',
    },
    actionSheet: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      gap: spacing.sm,
      padding: spacing.lg,
      width: '100%',
    },
    actionSheetItem: {
      alignItems: 'center',
      borderRadius: 12,
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 52,
      paddingHorizontal: spacing.md,
    },
    actionSheetText: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    audienceButton: {
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: 1,
      flexDirection: 'row',
      gap: spacing.xs,
      minHeight: 36,
      paddingHorizontal: spacing.md,
    },
    audienceButtonText: {
      color: colors.textPrimary,
      fontSize: 13,
      fontWeight: '800',
      maxWidth: 180,
    },
    audienceOption: {
      alignItems: 'center',
      borderRadius: 12,
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 54,
      paddingHorizontal: spacing.sm,
    },
    audienceOptionText: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 16,
      fontWeight: '800',
    },
    audienceSheet: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      gap: spacing.xs,
      padding: spacing.lg,
      width: '100%',
    },
    captionCloseButton: {
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    captionInput: {
      backgroundColor: 'rgba(255,255,255,0.12)',
      borderRadius: 24,
      color: colors.white,
      flex: 1,
      fontSize: 16,
      minHeight: 48,
      paddingHorizontal: spacing.md,
    },
    captionInputRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    captionAudienceRow: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    captionPreview: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: spacing.md,
    },
    captionScreen: {
      backgroundColor: '#020617',
      flex: 1,
    },
    captionSend: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    colorDot: {
      borderColor: 'transparent',
      borderRadius: 16,
      borderWidth: 2,
      height: 32,
      width: 32,
    },
    colorDotSelected: {
      borderColor: colors.white,
    },
    colorRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginVertical: spacing.md,
    },
    container: {
      flex: 1,
    },
    createRow: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: 1,
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.md,
    },
    createSubtitle: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    createTextBlock: {
      flex: 1,
      gap: 3,
    },
    createTitle: {
      color: colors.textPrimary,
      fontSize: 17,
      fontWeight: '800',
    },
    contactCheck: {
      alignItems: 'center',
      borderColor: colors.border,
      borderRadius: 13,
      borderWidth: 2,
      height: 26,
      justifyContent: 'center',
      width: 26,
    },
    contactCheckSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    contactPickerHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    contactPickerList: {
      paddingBottom: spacing.xl,
    },
    contactPickerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 70,
      paddingHorizontal: spacing.md,
    },
    contactPickerScreen: {
      flex: 1,
    },
    contactPickerTitle: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 18,
      fontWeight: '800',
    },
    disabledButton: {
      opacity: 0.5,
    },
    doneButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 18,
      minHeight: 36,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    doneButtonText: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '800',
    },
    emptyList: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    emptyState: {
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.xl,
    },
    emptyText: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
    },
    emptyTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
    },
    fab: {
      alignItems: 'center',
      backgroundColor: '#16a34a',
      borderRadius: 30,
      elevation: 8,
      height: 60,
      justifyContent: 'center',
      position: 'absolute',
      right: spacing.lg,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.22,
      shadowRadius: 12,
      width: 60,
    },
    headerStatusButton: {
      alignItems: 'center',
      height: 44,
      justifyContent: 'center',
      marginRight: spacing.sm,
      width: 44,
    },
    headerStatusRing: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderColor: 'transparent',
      borderRadius: 18,
      borderWidth: 2,
      height: 36,
      justifyContent: 'center',
      overflow: 'hidden',
      padding: 1,
      width: 36,
    },
    headerStatusRingActive: {
      backgroundColor: 'transparent',
      borderColor: '#16a34a',
    },
    iconButton: {
      alignItems: 'center',
      height: 42,
      justifyContent: 'center',
      width: 42,
    },
    list: {
      paddingVertical: spacing.sm,
    },
    loader: {
      marginTop: spacing.lg,
    },
    modalBackdrop: {
      alignItems: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      flex: 1,
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    modalTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '800',
    },
    managerItem: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 70,
    },
    managerSheet: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      maxHeight: '78%',
      padding: spacing.lg,
      width: '100%',
    },
    mediaCaption: {
      backgroundColor: 'rgba(0,0,0,0.45)',
      borderRadius: 14,
      bottom: spacing.lg,
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
      left: spacing.lg,
      overflow: 'hidden',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      position: 'absolute',
      right: spacing.lg,
      textAlign: 'center',
    },
    miniPreview: {
      backgroundColor: colors.border,
      borderRadius: 10,
      height: 54,
      width: 54,
    },
    miniPreviewFallback: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 10,
      height: 54,
      justifyContent: 'center',
      width: 54,
    },
    myStatusAddButton: {
      alignItems: 'center',
      backgroundColor: '#16a34a',
      borderRadius: 18,
      height: 36,
      justifyContent: 'center',
      width: 36,
    },
    myStatusEmptyAvatar: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 26,
      height: 52,
      justifyContent: 'center',
      width: 52,
    },
    myStatusRow: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: 18,
      borderWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      gap: spacing.md,
      marginHorizontal: spacing.md,
      marginBottom: spacing.md,
      minHeight: 80,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    plusBadge: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderColor: colors.surface,
      borderRadius: 12,
      borderWidth: 2,
      bottom: -2,
      height: 24,
      justifyContent: 'center',
      position: 'absolute',
      right: -2,
      width: 24,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 12,
      minHeight: 48,
      justifyContent: 'center',
    },
    primaryButtonText: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '800',
    },
    progressFill: {
      backgroundColor: colors.white,
      borderRadius: 2,
      height: '100%',
    },
    progressRow: {
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
    },
    progressTrack: {
      backgroundColor: 'rgba(255,255,255,0.28)',
      borderRadius: 2,
      flex: 1,
      height: 3,
      overflow: 'hidden',
    },
    replyButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    replyInput: {
      backgroundColor: 'rgba(255,255,255,0.14)',
      borderRadius: 22,
      color: colors.white,
      flex: 1,
      minHeight: 44,
      paddingHorizontal: spacing.md,
    },
    replyRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    roundAction: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 22,
      height: 44,
      justifyContent: 'center',
      width: 44,
    },
    statusInfo: {
      flex: 1,
      gap: 3,
    },
    statusActionsHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    statusActionsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    statusActionsSheet: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      maxHeight: '82%',
      padding: spacing.lg,
      width: '100%',
    },
    statusActionsTitle: {
      color: colors.textPrimary,
      flex: 1,
      fontSize: 18,
      fontWeight: '900',
      textAlign: 'center',
    },
    statusInlineAction: {
      alignItems: 'center',
      backgroundColor: colors.appBackground,
      borderColor: colors.border,
      borderRadius: 13,
      borderWidth: StyleSheet.hairlineWidth,
      flex: 1,
      gap: 4,
      justifyContent: 'center',
      minHeight: 64,
      paddingHorizontal: spacing.xs,
    },
    statusInlineActionText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '900',
      textAlign: 'center',
    },
    statusInlineActionTextDestructive: {
      color: colors.danger,
    },
    sectionTitle: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '800',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
      paddingTop: spacing.md,
      textTransform: 'uppercase',
    },
    statusMeta: {
      color: colors.textSecondary,
      fontSize: 13,
    },
    statusName: {
      color: colors.textPrimary,
      fontSize: 16,
      fontWeight: '800',
    },
    statusRing: {
      borderRadius: 31,
      borderWidth: 3,
      padding: 2,
    },
    statusRingActive: {
      borderColor: colors.primary,
    },
    statusRingViewed: {
      borderColor: colors.border,
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 76,
      paddingHorizontal: spacing.md,
    },
    statusRowPressed: {
      backgroundColor: colors.border,
    },
    statusViewerRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      minHeight: 62,
    },
    statusViewersList: {
      paddingBottom: spacing.sm,
    },
    statusViewersListEmpty: {
      flexGrow: 1,
      justifyContent: 'center',
    },
    statusViewersLoader: {
      paddingVertical: spacing.xl,
    },
    statusViewersTitle: {
      color: colors.textPrimary,
      fontSize: 15,
      fontWeight: '900',
      marginBottom: spacing.sm,
    },
    statusTextInput: {
      borderRadius: 14,
      color: colors.white,
      fontSize: 24,
      fontWeight: '800',
      minHeight: 160,
      padding: spacing.md,
      textAlignVertical: 'top',
    },
    textComposer: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: spacing.lg,
      width: '100%',
    },
    textStatusViewer: {
      alignItems: 'center',
      borderRadius: 24,
      justifyContent: 'center',
      minHeight: 320,
      padding: spacing.xl,
      width: '100%',
    },
    textStatusViewerText: {
      color: colors.white,
      fontSize: 30,
      fontWeight: '800',
      textAlign: 'center',
    },
    thumbnailFallback: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      justifyContent: 'center',
    },
    videoThumbnailOverlay: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      backgroundColor: 'rgba(15,23,42,0.22)',
      justifyContent: 'center',
    },
    videoThumbnailWrap: {
      alignItems: 'center',
      backgroundColor: colors.border,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    viewer: {
      backgroundColor: '#020617',
      flex: 1,
      paddingTop: spacing.lg,
    },
    viewerBody: {
      alignItems: 'center',
      flex: 1,
      justifyContent: 'center',
      padding: spacing.md,
      position: 'relative',
    },
    viewerCount: {
      color: colors.white,
      fontSize: 14,
      fontWeight: '700',
      paddingBottom: spacing.md,
      textAlign: 'center',
    },
    viewerHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    viewerMedia: {
      height: '100%',
      width: '100%',
    },
    viewerSubtitle: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: 12,
    },
    viewerTitle: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '800',
    },
    viewerTitleWrap: {
      flex: 1,
    },
    viewerTapLeft: {
      bottom: 0,
      left: 0,
      position: 'absolute',
      top: 0,
      width: '38%',
    },
    viewerTapRight: {
      bottom: 0,
      position: 'absolute',
      right: 0,
      top: 0,
      width: '62%',
    },
  });
}
