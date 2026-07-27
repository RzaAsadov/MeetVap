import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { memo,useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { ActivityIndicator,Alert,GestureResponderEvent,Image,KeyboardAvoidingView,Modal,PanResponder,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,useWindowDimensions,View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg,{ Path as SvgPath } from 'react-native-svg';

import { MessageBubble } from '../components/MessageBubble';
import { getI18nLanguage,t,type AppLanguage } from '../i18n';
import { type PinnedMessage } from '../lib/backend';
import { formatBytes } from '../lib/format';
import { type ImageDrawingStroke } from '../native/CallNative';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { Message } from '../types/domain';
import { VoiceEffectId } from '../types/voiceEffects';
import { chatRoomStyles as styles } from './chat/ChatRoomStyles';
import {
getInitialUploadProgress
} from './lib/ChatMediaHelpers';
import {
formatPinnedDateTime,
getMessageLocation,
getPinnedMessageTitle,
getPinnedStaticMapUrl
} from './lib/ChatMessagePreview';


type PendingCaptionAttachment = {
  body?: string;
  durationSeconds?: number;
  fileName: string;
  kind: 'image' | 'video' | 'file';
  mimeType: string;
  sizeBytes?: number;
  uri: string;
};

const DRAWING_COLORS = ['#ffffff', '#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'] as const;
const DRAWING_STROKE_WIDTH = 0.014;
const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🤗'];
const VOICE_EFFECTS: { descriptionKey: string; icon: keyof typeof Ionicons.glyphMap; id: VoiceEffectId; titleKey: string }[] = [
  { descriptionKey: 'voiceEffectNormalDescription', icon: 'mic-outline', id: 'normal', titleKey: 'voiceEffectNormal' },
  { descriptionKey: 'voiceEffectDeepDescription', icon: 'radio-outline', id: 'deep', titleKey: 'voiceEffectDeep' },
  { descriptionKey: 'voiceEffectBrightDescription', icon: 'sparkles-outline', id: 'bright', titleKey: 'voiceEffectBright' },
  { descriptionKey: 'voiceEffectHeliumDescription', icon: 'balloon-outline', id: 'helium', titleKey: 'voiceEffectHelium' },
];

export function ComposerEditMenu({
  hasSelection,
  hasText,
  onClose,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  visible,
}: {
  hasSelection: boolean;
  hasText: boolean;
  onClose: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  visible: boolean;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{t('textOptions')}</Text>
          <ActionMenuButton icon="clipboard-outline" label={t('paste')} onPress={onPaste} />
          {hasSelection ? <ActionMenuButton icon="copy-outline" label={t('copy')} onPress={onCopy} /> : null}
          {hasSelection ? <ActionMenuButton icon="cut-outline" label={t('cut')} onPress={onCut} /> : null}
          {hasText ? <ActionMenuButton icon="scan-outline" label={t('selectAll')} onPress={onSelectAll} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type MessageRowProps = {
  canRedialCallMessage: boolean;
  isMine: boolean;
  isPinned: boolean;
  isPlayingVoice: boolean;
  isSelected: boolean;
  isSelectionMode: boolean;
  message: Message;
  onCancelUpload: (messageId: string) => void;
  onLongPress: (message: Message) => void;
  onOpenCall: (message: Message) => void;
  onOpenDisappearing: (message: Message) => void;
  onOpenMedia: (message: Message) => void;
  onOpenReply: (messageId: string) => void;
  onPlayVoice: (message: Message) => void;
  onSwipeReply?: (message: Message) => void;
  onToggleSelected: (messageId: string) => void;
  showSender?: boolean;
  voicePlayed: boolean;
  voiceProgress: number;
};

export const MessageRow = memo(function MessageRow({
  canRedialCallMessage,
  isMine,
  isPinned,
  isPlayingVoice,
  isSelected,
  isSelectionMode,
  message,
  onCancelUpload,
  onLongPress,
  onOpenCall,
  onOpenDisappearing,
  onOpenMedia,
  onOpenReply,
  onPlayVoice,
  onSwipeReply,
  onToggleSelected,
  showSender,
  voicePlayed,
  voiceProgress,
}: MessageRowProps) {
  const liveUploadProgress = useAppStore((state) => state.uploadProgressByMessageId[message.id]);
  const uploadProgress = liveUploadProgress ?? getInitialUploadProgress(message);

  return (
    <View style={styles.selectableMessageRow}>
      {isSelectionMode ? (
        <Pressable onPress={() => onToggleSelected(message.id)} style={styles.messageCheckbox}>
          <Ionicons color={isSelected ? colors.primary : colors.border} name={isSelected ? 'checkbox' : 'square-outline'} size={24} />
        </Pressable>
      ) : null}
      <Pressable
        disabled={!isSelectionMode}
        onPress={() => onToggleSelected(message.id)}
        style={styles.selectableMessageBubble}
      >
        <MessageBubble
          canRedialCallMessage={canRedialCallMessage}
          enableSwipeReply={!isSelectionMode && !!onSwipeReply}
          isMine={isMine}
          isPinned={isPinned}
          isPlayingVoice={isPlayingVoice}
          message={message}
          onCancelUpload={onCancelUpload}
          onLongPress={onLongPress}
          onOpenCall={onOpenCall}
          onOpenDisappearing={onOpenDisappearing}
          onOpenMedia={onOpenMedia}
          onOpenReply={onOpenReply}
          onPlayVoice={onPlayVoice}
          onSwipeReply={onSwipeReply}
          showSender={showSender}
          uploadProgress={uploadProgress}
          voicePlayed={voicePlayed}
          voiceProgress={voiceProgress}
        />
      </Pressable>
    </View>
  );
}, areMessageRowsEqual);

function areMessageRowsEqual(previous: Readonly<MessageRowProps>, next: Readonly<MessageRowProps>) {
  return previous.message === next.message &&
    previous.canRedialCallMessage === next.canRedialCallMessage &&
    previous.isMine === next.isMine &&
    previous.isPinned === next.isPinned &&
    previous.isPlayingVoice === next.isPlayingVoice &&
    previous.isSelected === next.isSelected &&
    previous.isSelectionMode === next.isSelectionMode &&
    previous.showSender === next.showSender &&
    previous.voicePlayed === next.voicePlayed &&
    previous.voiceProgress === next.voiceProgress;
}

export const DateDivider = memo(function DateDivider({ label }: { label: string }) {
  return (
    <View style={styles.dateDividerRow}>
      <View style={styles.dateDividerPill}>
        <Text style={styles.dateDividerText}>{label}</Text>
      </View>
    </View>
  );
});

export function PinnedMessageBanner({ language, message, onPress }: { language: AppLanguage; message: Message; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.pinnedBanner, pressed ? styles.pinnedBannerPressed : undefined]}>
      <View style={styles.pinnedBannerIcon}>
        <Ionicons color={colors.primary} name="pin" size={17} />
      </View>
      <View style={styles.pinnedBannerText}>
        <Text style={styles.pinnedBannerTitle}>{t('pinnedMessage', {}, language)}</Text>
        <Text numberOfLines={1} style={styles.pinnedBannerPreview}>{getPinnedMessageTitle(message, language)}</Text>
      </View>
      <Ionicons color={colors.textSecondary} name="chevron-forward" size={18} />
    </Pressable>
  );
}

export function PinnedMessagesModal({
  canRemove,
  messages,
  onChangeSearch,
  onClose,
  onRemove,
  onSelect,
  query,
  visible,
}: {
  canRemove: boolean;
  messages: PinnedMessage[];
  onChangeSearch: (query: string) => void;
  onClose: () => void;
  onRemove: (item: PinnedMessage) => void;
  onSelect: (messageId: string) => void;
  query: string;
  visible: boolean;
}) {
  const language = getI18nLanguage();

  if (!visible) {
    return null;
  }

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.pinnedModalBackdrop}>
        <Pressable style={styles.pinnedModalPanel}>
          <View style={styles.pinnedModalHeader}>
            <Text style={styles.pinnedModalTitle}>{t('pinnedMessages', {}, language)}</Text>
            <Pressable onPress={onClose} style={styles.pinnedModalClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.pinnedSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search" size={18} />
            <TextInput
              onChangeText={onChangeSearch}
              placeholder={t('searchPinnedMessages', {}, language)}
              placeholderTextColor={colors.mutedText}
              style={styles.pinnedSearchInput}
              value={query}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.pinnedList}>
            {messages.length > 0 ? messages.map((item) => (
              <View key={`${item.message.id}-${item.pinnedAt}-${item.scope}`} style={styles.pinnedRow}>
                <Pressable
                  onPress={() => onSelect(item.message.id)}
                  style={({ pressed }) => [styles.pinnedRowMain, pressed ? styles.pinnedRowPressed : undefined]}
                >
                  <PinnedMessageThumb message={item.message} />
                  <View style={styles.pinnedRowText}>
                    <Text numberOfLines={1} style={styles.pinnedRowTitle}>{getPinnedMessageTitle(item.message, language)}</Text>
                    <View style={styles.pinnedRowMeta}>
                      <Text style={styles.pinnedRowDate}>{formatPinnedDateTime(item.pinnedAt)}</Text>
                      <View style={styles.pinnedScopeBadge}>
                        <Text style={styles.pinnedScopeBadgeText}>{t(item.scope === 'all' ? 'pinnedForAll' : 'pinnedForMe', {}, language)}</Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
                {canRemove ? (
                  <Pressable onPress={() => onRemove(item)} style={styles.pinnedRemoveButton}>
                    <Ionicons color={colors.danger} name="trash-outline" size={19} />
                  </Pressable>
                ) : null}
              </View>
            )) : (
              <Text style={styles.pinnedEmptyText}>{t('noPinnedMessages', {}, language)}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PinnedMessageThumb({ message }: { message: Message }) {
  const location = getMessageLocation(message);

  if ((message.kind === 'image' || message.kind === 'video') && message.mediaUri) {
    return (
      <View style={styles.pinnedThumb}>
        <Image resizeMode="cover" source={{ uri: message.mediaUri }} style={styles.pinnedThumbImage} />
        {message.kind === 'video' ? (
          <View style={styles.pinnedThumbOverlay}>
            <Ionicons color={colors.white} name="play" size={14} />
          </View>
        ) : null}
      </View>
    );
  }

  if (location) {
    return (
      <View style={styles.pinnedThumb}>
        <Image resizeMode="cover" source={{ uri: getPinnedStaticMapUrl(location) }} style={styles.pinnedThumbImage} />
        <View style={styles.pinnedThumbOverlay}>
          <Ionicons color={colors.white} name="location" size={14} />
        </View>
      </View>
    );
  }

  const icon: keyof typeof Ionicons.glyphMap = message.kind === 'voice'
    ? 'mic'
    : message.kind === 'file'
      ? 'document-text'
      : message.kind === 'text'
        ? 'chatbubble-outline'
        : 'document-text';

  return (
    <View style={styles.pinnedThumbIcon}>
      <Ionicons color={colors.primary} name={icon} size={20} />
    </View>
  );
}

export type MessageActionMenuProps = {
  canDelete: boolean;
  canEdit: boolean;
  canForwardAndSelect: boolean;
  canPin: boolean;
  canReply: boolean;
  isPinned: boolean;
  labels: {
    copy: string;
    delete: string;
    edit: string;
    forward: string;
    messageOptions: string;
    pin: string;
    reply: string;
    report: string;
    select: string;
    unpin: string;
  };
  localizationKey: string;
  message: Message | null;
  onCancel: () => void;
  onCopy: (message: Message) => void;
  onDelete: (message: Message) => void;
  onEdit: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onReport: (message: Message) => void;
  onReply: (message: Message) => void;
  onSelect: (message: Message) => void;
  onUnpin: (message: Message) => void;
  userId?: string;
};

export function MessageActionMenu({ canDelete, canEdit: canEditByPermission, canForwardAndSelect, canPin, canReply, isPinned, labels, localizationKey, message, onCancel, onCopy, onDelete, onEdit, onForward, onPin, onReact, onReport, onReply, onSelect, onUnpin, userId }: MessageActionMenuProps) {
  if (!message) {
    return null;
  }

  const canReport = !!message && message.senderId !== userId && !message.id.startsWith('local-');
  const canCopy = !!message && message.kind === 'text' && message.body.trim().length > 0;
  const canEdit = canEditByPermission && !!message && message.senderId === userId && message.kind === 'text' && !message.id.startsWith('local-');

  return (
    <Modal animationType="fade" key={`message-action-menu-${localizationKey}-${message?.id ?? 'none'}`} transparent visible={!!message} onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{labels.messageOptions}</Text>
          {message && !message.id.startsWith('local-') ? <ReactionQuickRow message={message} onReact={onReact} userId={userId} /> : null}
          {canCopy ? <ActionMenuButton icon="copy-outline" label={labels.copy} onPress={() => message && onCopy(message)} /> : null}
          {canEdit ? <ActionMenuButton icon="create-outline" label={labels.edit} onPress={() => message && onEdit(message)} /> : null}
          {canPin ? (
            isPinned
              ? <ActionMenuButton icon="pin" label={labels.unpin} onPress={() => message && onUnpin(message)} />
              : <ActionMenuButton icon="pin-outline" label={labels.pin} onPress={() => message && onPin(message)} />
          ) : null}
          {canReply ? <ActionMenuButton icon="arrow-undo-outline" label={labels.reply} onPress={() => message && onReply(message)} /> : null}
          {canForwardAndSelect ? (
            <>
              <ActionMenuButton icon="arrow-redo-outline" label={labels.forward} onPress={() => message && onForward(message)} />
              <ActionMenuButton icon="checkbox-outline" label={labels.select} onPress={() => message && onSelect(message)} />
            </>
          ) : null}
          {canReport ? <ActionMenuButton destructive icon="flag-outline" label={labels.report} onPress={() => message && onReport(message)} /> : null}
          {canDelete ? <ActionMenuButton destructive icon="trash-outline" label={labels.delete} onPress={() => message && onDelete(message)} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type MediaActionMenuProps = {
  canDelete: boolean;
  canForwardAndSelect: boolean;
  canPin: boolean;
  canReply: boolean;
  canSaveToPhone: boolean;
  isPinned: boolean;
  labels: {
    delete: string;
    forward: string;
    messageOptions: string;
    pin: string;
    reply: string;
    report: string;
    saveInPhone: string;
    select: string;
    share: string;
    unpin: string;
  };
  localizationKey: string;
  message: Message | null;
  onCancel: () => void;
  onDelete: (message: Message) => void;
  onForward: (message: Message) => void;
  onPin: (message: Message) => void;
  onReact: (message: Message, emoji: string) => void;
  onReply: (message: Message) => void;
  onSave: (message: Message) => void;
  onShare: (message: Message) => void;
  onReport: (message: Message) => void;
  onSelect: (message: Message) => void;
  onUnpin: (message: Message) => void;
  userId?: string;
};

export function MediaActionMenu({ canDelete, canForwardAndSelect, canPin, canReply, canSaveToPhone, isPinned, labels, localizationKey, message, onCancel, onDelete, onForward, onPin, onReact, onReport, onReply, onSave, onShare, onSelect, onUnpin, userId }: MediaActionMenuProps) {
  if (!message) {
    return null;
  }

  const canReport = !!message && message.senderId !== userId && !message.id.startsWith('local-');

  return (
    <Modal animationType="fade" key={`media-action-menu-${localizationKey}-${message?.id ?? 'none'}`} transparent visible={!!message} onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{labels.messageOptions}</Text>
          {message ? (
            <>
              {!message.id.startsWith('local-') ? <ReactionQuickRow message={message} onReact={onReact} userId={userId} /> : null}
              {canPin ? (
                isPinned
                  ? <ActionMenuButton icon="pin" label={labels.unpin} onPress={() => onUnpin(message)} />
                  : <ActionMenuButton icon="pin-outline" label={labels.pin} onPress={() => onPin(message)} />
              ) : null}
              {canReply ? <ActionMenuButton icon="arrow-undo-outline" label={labels.reply} onPress={() => onReply(message)} /> : null}
              {canForwardAndSelect ? (
                <>
                  <ActionMenuButton icon="arrow-redo-outline" label={labels.forward} onPress={() => onForward(message)} />
                  <ActionMenuButton icon="checkbox-outline" label={labels.select} onPress={() => onSelect(message)} />
                </>
              ) : null}
              {canSaveToPhone ? (
                <>
                  <ActionMenuButton icon="download-outline" label={labels.saveInPhone} onPress={() => onSave(message)} />
                  <ActionMenuButton icon="share-social-outline" label={labels.share} onPress={() => onShare(message)} />
                </>
              ) : null}
              {canReport ? <ActionMenuButton destructive icon="flag-outline" label={labels.report} onPress={() => onReport(message)} /> : null}
              {canDelete ? <ActionMenuButton destructive icon="trash-outline" label={labels.delete} onPress={() => onDelete(message)} /> : null}
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ActionMenuButton({
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
    <Pressable onPress={onPress} style={styles.actionButton}>
      <Ionicons color={destructive ? colors.danger : colors.textPrimary} name={icon} size={21} />
      <Text style={[styles.actionButtonText, destructive ? styles.actionButtonTextDanger : undefined]}>{label}</Text>
    </Pressable>
  );
}

function ReactionQuickRow({
  message,
  onReact,
  userId,
}: {
  message: Message;
  onReact: (message: Message, emoji: string) => void;
  userId?: string;
}) {
  const metadata = message.metadata;
  const currentReaction = metadata &&
    typeof metadata === 'object' &&
    'reactions' in metadata &&
    metadata.reactions &&
    typeof metadata.reactions === 'object' &&
    userId
    ? (metadata.reactions as Record<string, string>)[userId]
    : undefined;

  return (
    <View style={styles.reactionQuickRow}>
      {QUICK_REACTION_EMOJIS.map((emoji) => (
        <Pressable
          accessibilityLabel={emoji}
          key={emoji}
          onPress={() => onReact(message, emoji)}
          style={[styles.reactionQuickButton, currentReaction === emoji ? styles.reactionQuickButtonActive : undefined]}
        >
          <Text style={styles.reactionQuickEmoji}>{emoji}</Text>
        </Pressable>
      ))}
    </View>
  );
}

type EmojiGroup = {
  emojis: string[];
  icon: keyof typeof Ionicons.glyphMap;
  key: string;
  label: string;
};

export function EmojiPicker({
  bottomInset,
  groups,
  onSelect,
  onSelectGroup,
  selectedGroup,
  selectedGroupKey,
}: {
  bottomInset: number;
  groups: EmojiGroup[];
  onSelect: (emoji: string) => void;
  onSelectGroup: (key: string) => void;
  selectedGroup: EmojiGroup;
  selectedGroupKey: string;
}) {
  return (
    <View style={[styles.emojiPanel, { paddingBottom: Math.max(spacing.sm, bottomInset + spacing.xs) }]}>
      <View style={styles.emojiTabs}>
        {groups.map((group) => (
          <Pressable
            accessibilityLabel={group.label}
            key={group.key}
            onPress={() => onSelectGroup(group.key)}
            style={[styles.emojiTab, selectedGroupKey === group.key ? styles.emojiTabActive : undefined]}
          >
            <Ionicons color={selectedGroupKey === group.key ? colors.white : colors.textSecondary} name={group.icon} size={20} />
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.emojiGrid} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {selectedGroup.emojis.map((emoji) => (
          <Pressable key={`${selectedGroup.key}-${emoji}`} onPress={() => onSelect(emoji)} style={styles.emojiButton}>
            <Text style={styles.emojiText}>{emoji}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function VoiceEffectModal({
  bottomInset,
  durationSeconds,
  isProcessing,
  onCancel,
  onSelect,
  onSend,
  primaryLabel,
  selectedEffectId,
  subtitle,
  visible,
}: {
  bottomInset: number;
  durationSeconds?: number;
  isProcessing: boolean;
  onCancel: () => void;
  onSelect: (effectId: VoiceEffectId) => void;
  onSend: () => void;
  primaryLabel?: string;
  selectedEffectId: VoiceEffectId;
  subtitle?: string;
  visible: boolean;
}) {
  if (!visible) {
    return null;
  }

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onCancel}>
      <Pressable onPress={isProcessing ? undefined : onCancel} style={styles.captionBackdrop}>
        <Pressable style={[styles.voiceEffectPanel, { paddingBottom: Math.max(spacing.md, bottomInset + spacing.sm) }]}>
          <Text style={styles.voiceEffectTitle}>{t('voiceEffectTitle')}</Text>
          <Text style={styles.voiceEffectSubtitle}>
            {subtitle ?? (durationSeconds ? t('voiceEffectSubtitleWithDuration', { seconds: Math.max(1, Math.round(durationSeconds)) }) : t('voiceEffectSubtitle'))}
          </Text>
          <View style={styles.voiceEffectList}>
            {VOICE_EFFECTS.map((effect) => {
              const isSelected = selectedEffectId === effect.id;

              return (
                <Pressable
                  disabled={isProcessing}
                  key={effect.id}
                  onPress={() => onSelect(effect.id)}
                  style={[styles.voiceEffectOption, isSelected ? styles.voiceEffectOptionSelected : undefined]}
                >
                  <View style={styles.voiceEffectOptionIcon}>
                    <Ionicons color={isSelected ? colors.white : colors.primary} name={effect.icon} size={18} />
                  </View>
                  <View style={styles.voiceEffectOptionText}>
                    <Text style={[styles.voiceEffectOptionTitle, isSelected ? styles.voiceEffectOptionTitleSelected : undefined]}>
                      {t(effect.titleKey)}
                    </Text>
                    <Text style={[styles.voiceEffectOptionDescription, isSelected ? styles.voiceEffectOptionDescriptionSelected : undefined]}>
                      {t(effect.descriptionKey)}
                    </Text>
                  </View>
                  {isSelected ? <Ionicons color={colors.white} name="checkmark-circle" size={22} /> : null}
                </Pressable>
              );
            })}
          </View>
          <View style={styles.voiceEffectActions}>
            <Pressable disabled={isProcessing} onPress={onCancel} style={styles.voiceEffectSecondaryButton}>
              <Text style={styles.voiceEffectSecondaryButtonText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable disabled={isProcessing} onPress={onSend} style={[styles.voiceEffectPrimaryButton, isProcessing ? styles.voiceEffectPrimaryButtonDisabled : undefined]}>
              {isProcessing ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.voiceEffectPrimaryButtonText}>{primaryLabel ?? t('send')}</Text>}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const AttachmentCaptionModal = memo(function AttachmentCaptionModal({
  attachment,
  bottomInset,
  caption,
  onCancel,
  onChangeCaption,
  onDraw,
  onLongPressSend,
  onSend,
}: {
  attachment: PendingCaptionAttachment | null;
  bottomInset: number;
  caption: string;
  onCancel: () => void;
  onChangeCaption: (caption: string) => void;
  onDraw: (attachment: PendingCaptionAttachment) => void;
  onLongPressSend: () => void;
  onSend: () => void;
}) {
  const panelBottomPadding = spacing.lg + Math.max(bottomInset, Platform.OS === 'android' ? spacing.xl : spacing.sm);
  const inputRef = useRef<TextInput | null>(null);
  const visible = !!attachment;

  if (!visible) {
    return null;
  }

  return (
    <Modal animationType="slide" navigationBarTranslucent statusBarTranslucent transparent visible={visible} onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.captionBackdrop}
      >
        <Pressable onPress={onCancel} style={StyleSheet.absoluteFill} />
        <View style={[styles.captionPanel, { paddingBottom: panelBottomPadding }]}>
          <View style={styles.captionHeader}>
            <Text style={styles.captionTitle}>{t('addCaption')}</Text>
            <View style={styles.captionHeaderActions}>
              {attachment?.kind === 'image' ? (
                <Pressable accessibilityLabel={t('drawOnImage')} onPress={() => onDraw(attachment)} style={styles.captionToolButton}>
                  <Ionicons color={colors.primary} name="brush-outline" size={21} />
                </Pressable>
              ) : null}
              <Pressable accessibilityLabel={t('close')} onPress={onCancel} style={styles.forwardClose}>
                <Ionicons color={colors.textSecondary} name="close" size={22} />
              </Pressable>
            </View>
          </View>
          {attachment ? <AttachmentCaptionPreview attachment={attachment} /> : null}
          <View style={styles.captionInputRow}>
            <TextInput
              ref={inputRef}
              multiline
              onChangeText={onChangeCaption}
              placeholder={t('writeCaption')}
              placeholderTextColor={colors.mutedText}
              style={styles.captionInput}
              value={caption}
            />
            <Pressable
              accessibilityLabel={t('send')}
              onLongPress={() => {
                inputRef.current?.blur();
                onLongPressSend();
              }}
              onPress={onSend}
              style={styles.captionSendButton}
            >
              <Ionicons color={colors.white} name="send" size={20} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

export function EditMessageModal({
  draft,
  isSaving,
  onCancel,
  onChangeDraft,
  onSave,
  visible,
}: {
  draft: string;
  isSaving: boolean;
  onCancel: () => void;
  onChangeDraft: (draft: string) => void;
  onSave: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const canSave = draft.trim().length > 0 && !isSaving;

  useEffect(() => {
    if (!visible) {
      return undefined;
    }

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, Platform.OS === 'android' ? 260 : 120);

    return () => clearTimeout(focusTimer);
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal animationType="slide" navigationBarTranslucent statusBarTranslucent transparent visible={visible} onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={styles.editMessageKeyboardAvoider}
      >
        <Pressable onPress={isSaving ? undefined : onCancel} style={styles.captionBackdrop}>
          <Pressable style={[styles.captionPanel, { paddingBottom: spacing.lg + Math.max(insets.bottom, spacing.sm) }]}>
            <View style={styles.captionHeader}>
              <Text style={styles.captionTitle}>{t('editMessage')}</Text>
              <Pressable disabled={isSaving} onPress={onCancel} style={styles.forwardClose}>
                <Ionicons color={colors.textSecondary} name="close" size={22} />
              </Pressable>
            </View>
            <TextInput
              autoFocus
              ref={inputRef}
              multiline
              onChangeText={onChangeDraft}
              placeholder={t('message')}
              placeholderTextColor={colors.mutedText}
              style={styles.editMessageInput}
              value={draft}
            />
            <View style={styles.editMessageActions}>
              <Pressable disabled={isSaving} onPress={onCancel} style={styles.editMessageSecondaryButton}>
                <Text style={styles.editMessageSecondaryText}>{t('cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={!canSave}
                onPress={onSave}
                style={[styles.editMessagePrimaryButton, !canSave && styles.editMessageButtonDisabled]}
              >
                {isSaving ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.editMessagePrimaryText}>{t('save')}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function SendOptionsModal({
  dateDraft,
  disappearSecondsDraft,
  hourDraft,
  minuteDraft,
  mode,
  onCancel,
  onChangeDate,
  onChangeDisappearSeconds,
  onChangeHour,
  onChangeMinute,
  onChangeSecond,
  onOpenDisappear,
  onOpenSchedule,
  onSendDisappear,
  onSendSchedule,
  secondDraft,
}: {
  dateDraft: string;
  disappearSecondsDraft: string;
  hourDraft: string;
  minuteDraft: string;
  mode: null | 'menu' | 'schedule' | 'disappear';
  onCancel: () => void;
  onChangeDate: (value: string) => void;
  onChangeDisappearSeconds: (value: string) => void;
  onChangeHour: (value: string) => void;
  onChangeMinute: (value: string) => void;
  onChangeSecond: (value: string) => void;
  onOpenDisappear: () => void;
  onOpenSchedule: () => void;
  onSendDisappear: () => void;
  onSendSchedule: () => void;
  secondDraft: string;
}) {
  if (!mode) {
    return null;
  }

  return (
    <Modal animationType="fade" transparent visible={!!mode} onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={styles.actionBackdrop}>
        <Pressable style={styles.sendOptionsPanel}>
          <View style={styles.captionHeader}>
            <Text style={styles.captionTitle}>{t('sendOptions')}</Text>
            <Pressable accessibilityLabel={t('close')} onPress={onCancel} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          {mode === 'menu' ? (
            <>
              <ActionMenuButton icon="time-outline" label={t('scheduledMessage')} onPress={onOpenSchedule} />
              <ActionMenuButton icon="eye-off-outline" label={t('disappearingMessage')} onPress={onOpenDisappear} />
            </>
          ) : null}
          {mode === 'schedule' ? (
            <View style={styles.sendOptionsForm}>
              <Text style={styles.sendOptionsHint}>{t('scheduledMessageHint')}</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="numbers-and-punctuation"
                onChangeText={onChangeDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={colors.mutedText}
                style={styles.sendOptionsInput}
                value={dateDraft}
              />
              <View style={styles.sendOptionsTimeRow}>
                <SmallTimeInput label={t('hour')} onChangeText={onChangeHour} value={hourDraft} />
                <SmallTimeInput label={t('minute')} onChangeText={onChangeMinute} value={minuteDraft} />
                <SmallTimeInput label={t('second')} onChangeText={onChangeSecond} value={secondDraft} />
              </View>
              <Pressable onPress={onSendSchedule} style={styles.editMessagePrimaryButton}>
                <Text style={styles.editMessagePrimaryText}>{t('scheduleSend')}</Text>
              </Pressable>
            </View>
          ) : null}
          {mode === 'disappear' ? (
            <View style={styles.sendOptionsForm}>
              <Text style={styles.sendOptionsHint}>{t('disappearingMessageHint')}</Text>
              <TextInput
                keyboardType="number-pad"
                onChangeText={onChangeDisappearSeconds}
                placeholder={t('seconds')}
                placeholderTextColor={colors.mutedText}
                style={styles.sendOptionsInput}
                value={disappearSecondsDraft}
              />
              <Pressable onPress={onSendDisappear} style={styles.editMessagePrimaryButton}>
                <Text style={styles.editMessagePrimaryText}>{t('send')}</Text>
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SmallTimeInput({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) {
  return (
    <View style={styles.smallTimeInputWrap}>
      <Text style={styles.smallTimeInputLabel}>{label}</Text>
      <TextInput
        keyboardType="number-pad"
        maxLength={2}
        onChangeText={onChangeText}
        placeholder="00"
        placeholderTextColor={colors.mutedText}
        style={styles.smallTimeInput}
        value={value}
      />
    </View>
  );
}

function AttachmentCaptionPreview({ attachment }: { attachment: PendingCaptionAttachment }) {
  if (attachment.kind === 'image') {
    return <Image resizeMode="cover" source={{ uri: attachment.uri }} style={styles.captionImagePreview} />;
  }

  return (
    <View style={styles.captionFilePreview}>
      <Ionicons color={colors.primary} name={attachment.kind === 'video' ? 'videocam-outline' : 'document-text-outline'} size={34} />
      <View style={styles.captionFileText}>
        <Text numberOfLines={1} style={styles.captionFileName}>{attachment.fileName}</Text>
        <Text style={styles.captionFileMeta}>{attachment.kind === 'video' ? t('video') : formatBytes(attachment.sizeBytes)}</Text>
      </View>
    </View>
  );
}

export function ImageDrawingModal({
  attachment,
  onCancel,
  onSend,
}: {
  attachment: PendingCaptionAttachment | null;
  onCancel: () => void;
  onSend: (strokes: ImageDrawingStroke[]) => Promise<void>;
}) {
  if (!attachment) {
    return null;
  }

  return <ImageDrawingModalContent attachment={attachment} onCancel={onCancel} onSend={onSend} />;
}

function ImageDrawingModalContent({
  attachment,
  onCancel,
  onSend,
}: {
  attachment: PendingCaptionAttachment;
  onCancel: () => void;
  onSend: (strokes: ImageDrawingStroke[]) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [strokes, setStrokes] = useState<ImageDrawingStroke[]>([]);
  const [selectedColor, setSelectedColor] = useState<string>(DRAWING_COLORS[2]);
  const [colorRailWidth, setColorRailWidth] = useState(1);
  const [imageAspectRatio, setImageAspectRatio] = useState(1);
  const [isSending, setSending] = useState(false);

  useEffect(() => {
    setStrokes([]);
    setSending(false);

    let isMounted = true;

    Image.getSize(
      attachment.uri,
      (width, height) => {
        if (isMounted && width > 0 && height > 0) {
          setImageAspectRatio(width / height);
        }
      },
      () => {
        if (isMounted) {
          setImageAspectRatio(1);
        }
      },
    );

    return () => {
      isMounted = false;
    };
  }, [attachment.uri]);

  const availableWidth = Math.max(1, window.width - spacing.lg * 2);
  const availableHeight = Math.max(1, window.height - insets.top - insets.bottom - 172);
  let imageWidth = availableWidth;
  let imageHeight = imageWidth / Math.max(0.1, imageAspectRatio);

  if (imageHeight > availableHeight) {
    imageHeight = availableHeight;
    imageWidth = imageHeight * Math.max(0.1, imageAspectRatio);
  }

  const addStrokePoint = useCallback((event: GestureResponderEvent, createStroke: boolean) => {
    const point = normalizeDrawingPoint(event, imageWidth, imageHeight);

    if (!point) {
      return;
    }

    setStrokes((current) => {
      if (createStroke || current.length === 0) {
        return [...current, { color: selectedColor, points: [point], width: DRAWING_STROKE_WIDTH }];
      }

      const next = [...current];
      const lastStroke = next[next.length - 1];
      const lastPoint = lastStroke.points[lastStroke.points.length - 1];

      if (lastPoint && Math.abs(lastPoint.x - point.x) < 0.003 && Math.abs(lastPoint.y - point.y) < 0.003) {
        return current;
      }

      next[next.length - 1] = {
        ...lastStroke,
        points: [...lastStroke.points, point],
      };
      return next;
    });
  }, [imageHeight, imageWidth, selectedColor]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => addStrokePoint(event, true),
    onPanResponderMove: (event) => addStrokePoint(event, false),
    onStartShouldSetPanResponder: () => true,
  }), [addStrokePoint]);

  function selectColorFromRail(event: GestureResponderEvent) {
    const x = clamp(event.nativeEvent.locationX, 0, colorRailWidth);
    const ratio = colorRailWidth <= 0 ? 0 : x / colorRailWidth;
    const index = clamp(Math.round(ratio * (DRAWING_COLORS.length - 1)), 0, DRAWING_COLORS.length - 1);

    setSelectedColor(DRAWING_COLORS[index]);
  }

  async function sendEditedImage() {
    if (isSending) {
      return;
    }

    setSending(true);

    try {
      await onSend(strokes);
    } catch (error) {
      Alert.alert(t('imageDrawingFailed'), error instanceof Error ? error.message : t('pleaseTryAgain'));
      setSending(false);
    }
  }

  const selectedColorIndex = Math.max(0, DRAWING_COLORS.findIndex((color) => color === selectedColor));
  const colorThumbLeft = colorRailWidth <= 1
    ? 0
    : Math.max(0, (selectedColorIndex / (DRAWING_COLORS.length - 1)) * colorRailWidth - 10);

  return (
    <Modal animationType="slide" statusBarTranslucent visible={!!attachment} onRequestClose={() => {
      if (!isSending) {
        onCancel();
      }
    }}>
      <View style={[styles.drawingScreen, { paddingBottom: Math.max(insets.bottom, spacing.sm), paddingTop: Math.max(insets.top, spacing.md) }]}>
        <View style={styles.drawingHeader}>
          <Pressable disabled={isSending} onPress={onCancel} style={styles.drawingIconButton}>
            <Ionicons color={colors.white} name="close" size={24} />
          </Pressable>
          <Text numberOfLines={1} style={styles.drawingTitle}>{t('drawOnImage')}</Text>
          <View style={styles.drawingHeaderActions}>
            <Pressable disabled={isSending || strokes.length === 0} onPress={() => setStrokes((current) => current.slice(0, -1))} style={[styles.drawingIconButton, strokes.length === 0 && styles.drawingButtonDisabled]}>
              <Ionicons color={colors.white} name="arrow-undo" size={22} />
            </Pressable>
            <Pressable disabled={isSending} onPress={() => void sendEditedImage()} style={[styles.drawingSendButton, isSending && styles.drawingButtonDisabled]}>
              {isSending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.drawingSendText}>{t('send')}</Text>}
            </Pressable>
          </View>
        </View>

        <View style={styles.drawingCanvasWrap}>
          {attachment ? (
            <View style={[styles.drawingCanvas, { height: imageHeight, width: imageWidth }]} {...panResponder.panHandlers}>
              <Image resizeMode="contain" source={{ uri: attachment.uri }} style={StyleSheet.absoluteFillObject} />
              <Svg height={imageHeight} style={StyleSheet.absoluteFillObject} width={imageWidth}>
                {strokes.map((stroke, index) => (
                  <SvgPath
                    key={`${stroke.color}-${index}`}
                    d={getDrawingPath(stroke, imageWidth, imageHeight)}
                    fill="none"
                    stroke={stroke.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={Math.max(3, stroke.width * Math.min(imageWidth, imageHeight))}
                  />
                ))}
              </Svg>
            </View>
          ) : null}
        </View>

        <View style={styles.drawingTools}>
          <Text style={styles.drawingToolLabel}>{t('chooseColor')}</Text>
          <View
            onLayout={(event) => setColorRailWidth(Math.max(1, event.nativeEvent.layout.width))}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={selectColorFromRail}
            onResponderMove={selectColorFromRail}
            onStartShouldSetResponder={() => true}
            style={styles.drawingColorRailWrap}
          >
            <LinearGradient colors={DRAWING_COLORS} end={{ x: 1, y: 0 }} start={{ x: 0, y: 0 }} style={styles.drawingColorRail} />
            <View style={[styles.drawingColorThumb, { backgroundColor: selectedColor, left: colorThumbLeft }]} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function normalizeDrawingPoint(event: GestureResponderEvent, width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: clamp(event.nativeEvent.locationX / width, 0, 1),
    y: clamp(event.nativeEvent.locationY / height, 0, 1),
  };
}

function getDrawingPath(stroke: ImageDrawingStroke, width: number, height: number) {
  if (stroke.points.length === 0) {
    return '';
  }

  const [firstPoint, ...rest] = stroke.points;
  const firstX = firstPoint.x * width;
  const firstY = firstPoint.y * height;

  if (rest.length === 0) {
    return `M ${firstX} ${firstY} L ${firstX + 0.1} ${firstY + 0.1}`;
  }

  return rest.reduce(
    (path, point) => `${path} L ${point.x * width} ${point.y * height}`,
    `M ${firstX} ${firstY}`,
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
