import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Platform } from 'react-native';

import { t } from '../i18n';
import { beginAppLockForegroundOperation } from '../lib/appLockAccess';
import { createLiveLocation, isUploadCanceledError } from '../lib/backend';
import { formatBytes } from '../lib/format';
import {
  hasActiveLiveLocationShare,
  LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS,
  registerLiveLocationShare,
  requestLiveLocationPermissions,
} from '../lib/liveLocation';
import { assertAttachmentsWithinPolicy, AttachmentPolicyError } from '../lib/serverPolicy';
import { buildSharedContactMessage } from '../lib/shareLinks';
import { renderNativeImageDrawing, type ImageDrawingStroke } from '../native/CallNative';
import { useAppStore, type AppState } from '../store/useAppStore';
import type { AuthUser, Message, MessageKind } from '../types/domain';
import type { SharedIntentItem } from '../types/navigation';
import {
  getKnownFileSize,
  getLocationAddress,
  getSharedItemFileName,
  getSharedItemMessageKind,
  getUsableMimeType,
  prepareOutgoingAttachment,
} from '../screens/lib/ChatMediaHelpers';
import { parseScheduledSendAt } from '../screens/lib/ChatMiscHelpers';

export type PendingCaptionAttachment = {
  body?: string;
  durationSeconds?: number;
  fileName: string;
  kind: 'image' | 'video' | 'file';
  mimeType: string;
  sizeBytes?: number;
  uri: string;
};

type LocalMessageInput = Omit<Message, 'id' | 'conversationId' | 'createdAt' | 'senderId' | 'status'>;

type UseChatAttachmentsInput = Pick<
  AppState,
  'addOptimisticMessage' | 'loadContacts' | 'scheduleMediaMessage' | 'sendMediaMessage' | 'sendTextMessage'
> & {
  addLocalMessage: (message: LocalMessageInput) => string | null;
  conversationId: string;
  disappearSecondsDraft: string;
  language: AppState['language'];
  removeLocalMessage: (messageId: string) => void;
  scheduleDateDraft: string;
  scheduleHourDraft: string;
  scheduleMinuteDraft: string;
  scheduleSecondDraft: string;
  serverUrl?: string | null;
  setEmojiPickerVisible: (visible: boolean) => void;
  setSendOptionsMode: (mode: null | 'menu' | 'schedule' | 'disappear') => void;
};

export function useChatAttachments({
  addLocalMessage,
  addOptimisticMessage,
  conversationId,
  disappearSecondsDraft,
  language,
  loadContacts,
  removeLocalMessage,
  scheduleDateDraft,
  scheduleHourDraft,
  scheduleMediaMessage,
  scheduleMinuteDraft,
  scheduleSecondDraft,
  sendMediaMessage,
  sendTextMessage,
  serverUrl,
  setEmojiPickerVisible,
  setSendOptionsMode,
}: UseChatAttachmentsInput) {
  const pendingCaptionOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawingOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStartingLiveLocationRef = useRef(false);
  const suppressNextCaptionSendPressRef = useRef(false);
  const [pendingCaptionAttachment, setPendingCaptionAttachment] = useState<PendingCaptionAttachment | null>(null);
  const [drawingAttachment, setDrawingAttachment] = useState<PendingCaptionAttachment | null>(null);
  const [isCaptionSuspendedForDrawing, setCaptionSuspendedForDrawing] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const [isAttachmentSheetVisible, setAttachmentSheetVisible] = useState(false);
  const [isContactSharePickerVisible, setContactSharePickerVisible] = useState(false);

  const clearPendingDrawingOpenTimer = useCallback(() => {
    if (drawingOpenTimerRef.current) {
      clearTimeout(drawingOpenTimerRef.current);
      drawingOpenTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearPendingDrawingOpenTimer();
    if (pendingCaptionOpenTimeoutRef.current) {
      clearTimeout(pendingCaptionOpenTimeoutRef.current);
    }
  }, [clearPendingDrawingOpenTimer]);

  function getImagePickerAttachment(asset: ImagePicker.ImagePickerAsset): PendingCaptionAttachment {
    const kind: MessageKind = asset.type === 'video' ? 'video' : 'image';

    return {
      durationSeconds: asset.duration ? asset.duration / 1000 : undefined,
      fileName: asset.fileName ?? (kind === 'video' ? 'video.mp4' : 'photo.jpg'),
      kind,
      sizeBytes: asset.fileSize,
      mimeType: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'),
      uri: asset.uri,
    };
  }

  function showAttachmentPolicyError(error: unknown) {
    if (!(error instanceof AttachmentPolicyError)) {
      return false;
    }

    Alert.alert(
      t('attachmentTooLargeTitle'),
      t(error.type === 'batch' ? 'attachmentBatchTooLarge' : 'attachmentTooLarge', {
        size: formatBytes(error.maximumBytes),
      }),
    );
    return true;
  }

  async function sendPickedMedia(input: {
    body?: string;
    durationSeconds?: number;
    fileName: string;
    kind: 'image' | 'video' | 'file';
    localId: string | null;
    metadata?: Message['metadata'];
    mimeType: string;
    sizeBytes?: number;
    uri: string;
  }) {
    try {
      const info = await FileSystem.getInfoAsync(input.uri);

      await sendMediaMessage({
        body: input.body,
        clientId: input.localId ?? undefined,
        conversationId,
        durationSeconds: input.durationSeconds,
        fileName: input.fileName,
        kind: input.kind,
        metadata: input.metadata,
        mimeType: input.mimeType,
        sizeBytes: (info.exists && 'size' in info ? info.size : input.sizeBytes) ?? 1,
        uri: input.uri,
      });
    } catch (error) {
      if (input.localId) {
        removeLocalMessage(input.localId);
      }
      if (isUploadCanceledError(error)) {
        return;
      }
      Alert.alert(t('attachmentFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
    }
  }

  async function sendAttachment(attachment: PendingCaptionAttachment, caption?: string, metadata?: Message['metadata']) {
    let uploadAttachment: PendingCaptionAttachment;

    try {
      uploadAttachment = await prepareOutgoingAttachment(attachment);
      await assertAttachmentsWithinPolicy(serverUrl ?? '', [uploadAttachment.sizeBytes]);
    } catch (error) {
      if (!showAttachmentPolicyError(error)) {
        Alert.alert(t('attachmentFailed', {}, language), error instanceof Error ? error.message : t('pleaseTryAgain', {}, language));
      }
      return;
    }

    const trimmedCaption = caption?.trim();
    const body = trimmedCaption || uploadAttachment.body || '';
    const localId = addLocalMessage({
      body,
      durationSeconds: uploadAttachment.durationSeconds,
      fileName: uploadAttachment.fileName,
      kind: uploadAttachment.kind,
      mediaUri: uploadAttachment.uri,
      metadata,
      mimeType: uploadAttachment.mimeType,
      sizeBytes: uploadAttachment.sizeBytes,
    });

    await sendPickedMedia({
      body,
      durationSeconds: uploadAttachment.durationSeconds,
      fileName: uploadAttachment.fileName,
      kind: uploadAttachment.kind,
      metadata,
      mimeType: uploadAttachment.mimeType,
      sizeBytes: uploadAttachment.sizeBytes,
      localId,
      uri: uploadAttachment.uri,
    });
  }

  const openCaptionComposer = useCallback((attachment: PendingCaptionAttachment, initialCaption = '') => {
    clearPendingDrawingOpenTimer();
    if (pendingCaptionOpenTimeoutRef.current) {
      clearTimeout(pendingCaptionOpenTimeoutRef.current);
      pendingCaptionOpenTimeoutRef.current = null;
    }
    Keyboard.dismiss();
    setAttachmentSheetVisible(false);
    setEmojiPickerVisible(false);
    setCaptionSuspendedForDrawing(false);
    setDrawingAttachment(null);
    setCaptionDraft(initialCaption);
    pendingCaptionOpenTimeoutRef.current = setTimeout(() => {
      pendingCaptionOpenTimeoutRef.current = null;
      setPendingCaptionAttachment(attachment);
    }, 180);
  }, [clearPendingDrawingOpenTimer, setEmojiPickerVisible]);

  const closeCaptionComposer = useCallback(() => {
    clearPendingDrawingOpenTimer();
    if (pendingCaptionOpenTimeoutRef.current) {
      clearTimeout(pendingCaptionOpenTimeoutRef.current);
      pendingCaptionOpenTimeoutRef.current = null;
    }
    setCaptionSuspendedForDrawing(false);
    setDrawingAttachment(null);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');
  }, [clearPendingDrawingOpenTimer]);

  function openImageDrawingComposer(attachment: PendingCaptionAttachment) {
    if (attachment.kind !== 'image') {
      return;
    }

    clearPendingDrawingOpenTimer();
    Keyboard.dismiss();

    if (Platform.OS === 'ios') {
      setCaptionSuspendedForDrawing(true);
      drawingOpenTimerRef.current = setTimeout(() => {
        drawingOpenTimerRef.current = null;
        setDrawingAttachment(attachment);
      }, 320);
      return;
    }

    setDrawingAttachment(attachment);
  }

  function closeImageDrawingComposer() {
    clearPendingDrawingOpenTimer();
    setDrawingAttachment(null);
    setCaptionSuspendedForDrawing(false);
  }

  async function pickFromGallery() {
    setAttachmentSheetVisible(false);
    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded', {}, language), t('photoLibraryPermissionNeeded', {}, language));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images', 'videos'],
        quality: 0.82,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      if (result.assets.length === 1) {
        openCaptionComposer(getImagePickerAttachment(result.assets[0]));
        return;
      }

      try {
        await assertAttachmentsWithinPolicy(serverUrl ?? '', result.assets.map((asset) => asset.fileSize));
      } catch (error) {
        showAttachmentPolicyError(error);
        return;
      }

      for (const asset of result.assets) {
        await sendAttachment(getImagePickerAttachment(asset));
      }
    } finally {
      endLockDeferral();
    }
  }

  async function openCamera() {
    setAttachmentSheetVisible(false);
    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded', {}, language), t('cameraPermissionNeeded', {}, language));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.82,
        videoMaxDuration: 60,
      });

      if (!result.canceled && result.assets[0]) {
        openCaptionComposer(getImagePickerAttachment(result.assets[0]));
      }
    } finally {
      endLockDeferral();
    }
  }

  async function getFileAttachment(file: DocumentPicker.DocumentPickerAsset): Promise<PendingCaptionAttachment> {
    const sizeBytes = await getKnownFileSize(file.uri, file.size);

    return {
      body: file.name,
      fileName: file.name,
      kind: 'file',
      mimeType: getUsableMimeType(file.mimeType, file.name),
      sizeBytes,
      uri: file.uri,
    };
  }

  async function pickFile() {
    setAttachmentSheetVisible(false);
    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const attachments = await Promise.all(result.assets.map(getFileAttachment));

      try {
        await assertAttachmentsWithinPolicy(serverUrl ?? '', attachments.map((attachment) => attachment.sizeBytes));
      } catch (error) {
        showAttachmentPolicyError(error);
        return;
      }

      if (attachments.length === 1) {
        openCaptionComposer(attachments[0]);
        return;
      }

      for (const attachment of attachments) {
        await sendAttachment(attachment);
      }
    } finally {
      endLockDeferral();
    }
  }

  async function openContactSharePicker() {
    setAttachmentSheetVisible(false);
    setContactSharePickerVisible(true);
    await loadContacts().catch(() => undefined);
  }

  async function sendSharedContact(contact: AuthUser) {
    try {
      const payload = buildSharedContactMessage(contact);
      await sendTextMessage(conversationId, payload.message);
      setContactSharePickerVisible(false);
    } catch (error) {
      Alert.alert(t('sendContactFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function getSharedPendingAttachment(item: SharedIntentItem): Promise<PendingCaptionAttachment> {
    if (item.kind !== 'file' || !item.uri) {
      throw new Error(t('sharedAttachmentUnavailable', {}, language));
    }

    const fileName = item.fileName || getSharedItemFileName(item.uri);
    const mimeType = getUsableMimeType(item.mimeType, fileName);
    const kind = getSharedItemMessageKind(mimeType);
    const sizeBytes = await getKnownFileSize(item.uri, item.sizeBytes);

    return {
      body: kind === 'file' ? fileName : undefined,
      fileName,
      kind,
      mimeType,
      sizeBytes,
      uri: item.uri,
    };
  }

  async function sendPendingCaptionAttachment() {
    if (suppressNextCaptionSendPressRef.current) {
      suppressNextCaptionSendPressRef.current = false;
      return;
    }

    if (!pendingCaptionAttachment) {
      return;
    }

    const attachment = pendingCaptionAttachment;
    const caption = captionDraft;
    setPendingCaptionAttachment(null);
    setCaptionDraft('');
    await sendAttachment(attachment, caption);
  }

  async function sendScheduledCaptionAttachment() {
    if (!pendingCaptionAttachment) {
      return;
    }

    const sendAt = parseScheduledSendAt(scheduleDateDraft, scheduleHourDraft, scheduleMinuteDraft, scheduleSecondDraft);

    if (!sendAt) {
      Alert.alert(t('scheduledMessage'), t('scheduledMessageInvalidDate'));
      return;
    }
    if (sendAt.getTime() <= Date.now() + 5000) {
      Alert.alert(t('scheduledMessage'), t('scheduledMessageFutureRequired'));
      return;
    }

    const attachment = pendingCaptionAttachment;
    const caption = captionDraft;
    setSendOptionsMode(null);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');

    try {
      const uploadAttachment = await prepareOutgoingAttachment(attachment);
      await assertAttachmentsWithinPolicy(serverUrl ?? '', [uploadAttachment.sizeBytes]);
      const trimmedCaption = caption.trim();
      await scheduleMediaMessage({
        body: trimmedCaption || uploadAttachment.body || '',
        clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        conversationId,
        durationSeconds: uploadAttachment.durationSeconds,
        fileName: uploadAttachment.fileName,
        kind: uploadAttachment.kind,
        mimeType: uploadAttachment.mimeType,
        sendAt: sendAt.toISOString(),
        sizeBytes: uploadAttachment.sizeBytes ?? 1,
        uri: uploadAttachment.uri,
      });
    } catch (error) {
      setPendingCaptionAttachment(attachment);
      setCaptionDraft(caption);
      if (!showAttachmentPolicyError(error)) {
        Alert.alert(t('scheduledMessageFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      }
    }
  }

  async function sendDisappearingCaptionAttachment() {
    if (!pendingCaptionAttachment) {
      return;
    }

    const seconds = Number(disappearSecondsDraft.trim());

    if (!Number.isInteger(seconds) || seconds < 1) {
      Alert.alert(t('disappearingMessage'), t('disappearingMessageInvalidSeconds'));
      return;
    }

    const attachment = pendingCaptionAttachment;
    const caption = captionDraft;
    setSendOptionsMode(null);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');

    try {
      await sendAttachment(attachment, caption, {
        disappearingAfterView: { seconds },
      });
    } catch (error) {
      setPendingCaptionAttachment(attachment);
      setCaptionDraft(caption);
      Alert.alert(t('actionFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    }
  }

  async function sendDrawnAttachment(strokes: ImageDrawingStroke[]) {
    const attachment = drawingAttachment ?? pendingCaptionAttachment;

    if (!attachment || attachment.kind !== 'image') {
      return;
    }

    const caption = captionDraft;
    let uploadAttachment = attachment;

    if (strokes.length > 0) {
      const rendered = await renderNativeImageDrawing(attachment.uri, strokes, attachment.fileName);
      uploadAttachment = {
        ...attachment,
        fileName: rendered.fileName,
        kind: 'image',
        mimeType: rendered.mimeType,
        sizeBytes: rendered.sizeBytes,
        uri: rendered.uri,
      };
    }

    setDrawingAttachment(null);
    setCaptionSuspendedForDrawing(false);
    setPendingCaptionAttachment(null);
    setCaptionDraft('');
    await sendAttachment(uploadAttachment, caption);
  }

  async function sendCurrentLocation() {
    setAttachmentSheetVisible(false);
    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(t('permissionNeeded'), t('allowLocationToShare'));
        return;
      }

      let localId: string | null = null;

      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const address = await getLocationAddress(position.coords);
        const metadata = {
          location: {
            address,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        };
        localId = addLocalMessage({ body: t('location'), kind: 'text', metadata });
        await sendTextMessage(conversationId, t('location'), localId ?? undefined, metadata);
      } catch (error) {
        if (localId) {
          removeLocalMessage(localId);
        }
        Alert.alert(t('locationFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      }
    } finally {
      endLockDeferral();
    }
  }

  function chooseLiveLocationDuration() {
    Alert.alert(t('liveLocation'), t('chooseLiveLocationDuration'), [
      { text: t('liveLocation15Minutes'), onPress: () => void startLiveLocation(15) },
      { text: t('liveLocation1Hour'), onPress: () => void startLiveLocation(60) },
      { text: t('liveLocation4Hours'), onPress: () => void startLiveLocation(240) },
      { text: t('liveLocation12Hours'), onPress: () => void startLiveLocation(720) },
      { style: 'cancel', text: t('cancel') },
    ]);
  }

  function chooseLocationType() {
    setAttachmentSheetVisible(false);
    Alert.alert(t('shareLocation'), t('chooseLocationType'), [
      { text: t('currentLocation'), onPress: () => void sendCurrentLocation() },
      { text: t('liveLocation'), onPress: chooseLiveLocationDuration },
      { style: 'cancel', text: t('cancel') },
    ]);
  }

  function updateLocalLiveLocationEstablishment(messageId: string, state: 'failed' | 'pending') {
    const message = useAppStore.getState().messagesByConversation[conversationId]?.find((item) => item.id === messageId);
    const metadata = message?.metadata;
    const establishment = metadata && typeof metadata === 'object' && 'liveLocationEstablishment' in metadata
      ? metadata.liveLocationEstablishment
      : null;

    if (!message || !establishment || typeof establishment !== 'object') {
      return;
    }

    addOptimisticMessage({
      ...message,
      metadata: {
        ...metadata,
        liveLocationEstablishment: {
          ...establishment,
          state,
        },
      },
    });
  }

  async function startLiveLocation(durationMinutes: 15 | 60 | 240 | 720) {
    if (!serverUrl) {
      Alert.alert(t('locationFailed'), t('pleaseTryAgain'));
      return;
    }
    if (isStartingLiveLocationRef.current) {
      Alert.alert(t('liveLocation'), t('liveLocationAlreadyActive'));
      return;
    }

    isStartingLiveLocationRef.current = true;
    let localId: string | null = null;
    let establishmentTimeout: ReturnType<typeof setTimeout> | null = null;
    const endLockDeferral = beginAppLockForegroundOperation();

    try {
      if (await hasActiveLiveLocationShare()) {
        Alert.alert(t('liveLocation'), t('liveLocationAlreadyActive'));
        return;
      }
      if (!await requestLiveLocationPermissions()) {
        Alert.alert(t('permissionNeeded'), t('allowBackgroundLocationToShare'));
        return;
      }

      localId = addLocalMessage({
        body: t('liveLocation'),
        kind: 'text',
        metadata: {
          liveLocationEstablishment: {
            durationMinutes,
            startedAt: new Date().toISOString(),
            state: 'pending',
          },
        },
      });
      const establishmentMessageId = localId;
      establishmentTimeout = establishmentMessageId
        ? setTimeout(() => updateLocalLiveLocationEstablishment(establishmentMessageId, 'failed'), LIVE_LOCATION_ESTABLISHMENT_TIMEOUT_MS)
        : null;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const address = await getLocationAddress(position.coords);
      const response = await createLiveLocation(serverUrl, {
        address,
        clientId: localId ?? undefined,
        conversationId,
        durationMinutes,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });

      if (establishmentTimeout) {
        clearTimeout(establishmentTimeout);
      }
      addOptimisticMessage(response.message);
      await registerLiveLocationShare(response.liveLocation);
    } catch (error) {
      if (establishmentTimeout) {
        clearTimeout(establishmentTimeout);
      }
      if (localId) {
        updateLocalLiveLocationEstablishment(localId, 'failed');
      }
      Alert.alert(t('locationFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
    } finally {
      isStartingLiveLocationRef.current = false;
      endLockDeferral();
    }
  }

  return {
    captionDraft,
    chooseLocationType,
    closeCaptionComposer,
    closeImageDrawingComposer,
    drawingAttachment,
    getSharedPendingAttachment,
    isAttachmentSheetVisible,
    isCaptionComposerVisible: !!pendingCaptionAttachment && !isCaptionSuspendedForDrawing,
    isCaptionSuspendedForDrawing,
    isContactSharePickerVisible,
    openCamera,
    openCaptionComposer,
    openContactSharePicker,
    openImageDrawingComposer,
    pendingCaptionAttachment,
    pickFile,
    pickFromGallery,
    sendDisappearingCaptionAttachment,
    sendDrawnAttachment,
    sendPendingCaptionAttachment,
    sendScheduledCaptionAttachment,
    sendSharedContact,
    setAttachmentSheetVisible,
    setCaptionDraft,
    setContactSharePickerVisible,
    suppressNextCaptionSendPressRef,
  };
}
