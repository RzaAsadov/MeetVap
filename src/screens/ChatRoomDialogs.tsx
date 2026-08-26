import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { useEffect,useMemo,useState } from 'react';
import { ActivityIndicator,Alert,Image,Modal,PermissionsAndroid,Platform,Pressable,ScrollView,StyleSheet,Switch,Text,TextInput,View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { PremiumUserBadge } from '../components/PremiumUserBadge';
import { t,type AppLanguage } from '../i18n';
import { getDisappearingMessagesDurationLabelKey } from '../lib/disappearingMessages';
import { formatBytes } from '../lib/format';
import { downloadRemoteMediaFile,getCachedVideoThumbnailUri,getMessageMediaCacheUri,getRememberedCachedVideoThumbnailUri,resolveLocalMediaFileUri } from '../lib/mediaCache';
import { containsMeetVapKeyword } from '../lib/prohibitedNames';
import { buildSharedGroupWebUrl } from '../lib/shareLinks';
import { getShareBaseUrl } from '../lib/serverPolicy';
import { hasPremiumAccess } from '../lib/subscriptionAccess';
import { getMessageVideoThumbnailUri } from '../lib/messageVideoThumbnail';
import { useAppStore } from '../store/useAppStore';
import { colors } from '../theme/colors';
import { spacing } from '../theme/spacing';
import { AuthUser,Conversation,Message } from '../types/domain';
import { chatRoomStyles as styles } from './chat/ChatRoomStyles';
import { ActionMenuButton } from './ChatRoomMessageActions';
import {
getMessageFileName,
getMessageRemoteMediaUri
} from './lib/ChatMediaHelpers';
import {
extractChatLinks,
filterForwardTargets,
filterForwardTargetsByAnySearch,
formatSubscriberCount,
getGroupMemberRank,
getLinkHost
} from './lib/ChatMessagePreview';
import {
formatPresenceSubtitle,
getGroupCallLimit,
getPaginationItems
} from './lib/ChatMiscHelpers';


type ForwardTarget = {
  conversationId?: string;
  title: string;
  user: AuthUser;
};
type ChatGalleryTab = 'media' | 'files' | 'links';
type ChatLinkItem = {
  id: string;
  message: Message;
  url: string;
};
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_MEMBERS: AuthUser[] = [];
const GROUP_MEMBER_PAGE_SIZE = 30;

type GroupHeaderMenuProps = {
  isGroup: boolean;
  isGroupAdmin?: boolean;
  isMuted: boolean;
  isOwner?: boolean;
  isSystem?: boolean;
  onClear: () => void;
  onBlock: () => void;
  onClose: () => void;
  onLeave: () => void;
  onReport: () => void;
  onToggleMute: () => void;
  visible: boolean;
};

export function ChatHeaderMenu({ isGroup, isGroupAdmin, isMuted, isOwner, isSystem, onBlock, onClear, onClose, onLeave, onReport, onToggleMute, visible }: GroupHeaderMenuProps) {
  const shouldHideAdminOwnerGroupActions = isGroup && (isGroupAdmin || isOwner);

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.actionBackdrop}>
        <Pressable style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{t(isGroup ? 'groupOptions' : 'chatOptions')}</Text>
          <ActionMenuButton
            icon={isMuted ? 'notifications-outline' : 'notifications-off-outline'}
            label={isMuted ? t(isGroup ? 'unmuteGroup' : 'unmuteChat') : t(isGroup ? 'muteGroup' : 'muteChat')}
            onPress={onToggleMute}
          />
          {isSystem || shouldHideAdminOwnerGroupActions ? null : <ActionMenuButton destructive icon="flag-outline" label={t(isGroup ? 'reportGroup' : 'reportUser')} onPress={onReport} />}
          {!isGroup && !isSystem ? <ActionMenuButton destructive icon="ban-outline" label={t('blockUser')} onPress={onBlock} /> : null}
          {shouldHideAdminOwnerGroupActions ? null : <ActionMenuButton destructive icon="trash-outline" label={t('clearChat')} onPress={onClear} />}
          {isGroup && !isOwner ? <ActionMenuButton destructive icon="exit-outline" label={t('leaveGroup')} onPress={onLeave} /> : null}
          <ActionMenuButton icon="close-outline" label={t('cancel')} onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function OptionPickerModal({
  description,
  onClose,
  options,
  title,
  visible,
}: {
  description?: string;
  onClose: () => void;
  options: { icon: keyof typeof Ionicons.glyphMap; key: string; label: string; onPress: () => void }[];
  title: string;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.actionBackdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.actionPanel}>
          <Text style={styles.actionTitle}>{title}</Text>
          {description ? <Text style={styles.optionPickerDescription}>{description}</Text> : null}
          {options.map((option) => (
            <ActionMenuButton icon={option.icon} key={option.key} label={option.label} onPress={option.onPress} />
          ))}
          <ActionMenuButton icon="close-outline" label={t('cancel')} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

type ForwardMessageModalProps = {
  chatTargets: ForwardTarget[];
  contactTargets: ForwardTarget[];
  messages: Message[];
  onClose: () => void;
  onSelect: (target: ForwardTarget) => void;
};

const MAX_FORWARD_TARGETS = 100;

export function ForwardMessageModal({ chatTargets, contactTargets, messages, onClose, onSelect }: ForwardMessageModalProps) {
  const insets = useSafeAreaInsets();
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const normalizedSearch = debouncedSearch.trim().toLowerCase();
  const filteredChatTargets = useMemo(() => filterForwardTargetsByAnySearch(chatTargets, normalizedSearch), [chatTargets, normalizedSearch]);
  const filteredContactTargets = useMemo(() => filterForwardTargetsByAnySearch(contactTargets, normalizedSearch), [contactTargets, normalizedSearch]);
  const visibleChatTargets = filteredChatTargets.slice(0, MAX_FORWARD_TARGETS);
  const visibleContactTargets = filteredContactTargets.slice(0, MAX_FORWARD_TARGETS - visibleChatTargets.length);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchDraft.trim());
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    if (messages.length === 0) {
      setSearchDraft('');
      setDebouncedSearch('');
    }
  }, [messages.length]);

  return (
    <Modal
      animationType="slide"
      navigationBarTranslucent
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={messages.length > 0}
    >
      <Pressable onPress={onClose} style={styles.infoBackdrop}>
        <Pressable style={[styles.forwardPanel, { paddingBottom: Math.max(spacing.lg, insets.bottom + spacing.lg) }]}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{messages.length > 1 ? `Forward ${messages.length} messages to` : 'Forward to'}</Text>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.modalSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchDraft}
              placeholder={t('searchPeople')}
              placeholderTextColor={colors.mutedText}
              style={styles.modalSearchInput}
              value={searchDraft}
            />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {visibleChatTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('chats')}</Text>
                {visibleChatTargets.map((target) => (
                  <ForwardTargetRow key={`chat-${target.user.id}`} target={target} onPress={() => onSelect(target)} />
                ))}
              </>
            ) : null}
            {visibleChatTargets.length > 0 && visibleContactTargets.length > 0 ? <View style={styles.forwardDivider} /> : null}
            {visibleContactTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('contacts')}</Text>
                {visibleContactTargets.map((target) => (
                  <ForwardTargetRow key={`contact-${target.user.id}`} target={target} onPress={() => onSelect(target)} />
                ))}
              </>
            ) : null}
            {visibleChatTargets.length === 0 && visibleContactTargets.length === 0 ? (
              <Text style={styles.forwardEmpty}>{normalizedSearch ? t('noPeopleFound') : t('noContactsToShare')}</Text>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ForwardTargetRow({ onPress, target }: { onPress: () => void; target: ForwardTarget }) {
  return (
    <Pressable onPress={onPress} style={styles.forwardRow}>
      <Avatar label={target.title} size={42} uri={target.user.avatarUrl} />
      <View style={styles.forwardRowText}>
        <Text numberOfLines={1} style={styles.forwardName}>{target.title}</Text>
        {target.user.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{target.user.username}</Text> : null}
      </View>
      <Ionicons color={colors.primary} name="send" size={18} />
    </Pressable>
  );
}

type ShareContactPickerModalProps = {
  contacts: AuthUser[];
  onClose: () => void;
  onSelect: (contact: AuthUser) => void;
  visible: boolean;
};

export function ShareContactPickerModal({ contacts, onClose, onSelect, visible }: ShareContactPickerModalProps) {
  const [searchDraft, setSearchDraft] = useState('');
  const normalizedSearch = searchDraft.trim().toLowerCase();
  const filteredContacts = useMemo(() => {
    if (normalizedSearch.length < 2) {
      return contacts;
    }

    return contacts.filter((contact) => (
      (contact.displayName || '').toLowerCase().includes(normalizedSearch) ||
      (contact.username || '').toLowerCase().includes(normalizedSearch)
    ));
  }, [contacts, normalizedSearch]);

  useEffect(() => {
    if (!visible) {
      setSearchDraft('');
    }
  }, [visible]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.infoBackdrop}>
        <Pressable style={styles.forwardPanel}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{t('chooseContactToShare')}</Text>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.modalSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchDraft}
              placeholder={t('searchContacts')}
              placeholderTextColor={colors.mutedText}
              style={styles.modalSearchInput}
              value={searchDraft}
            />
          </View>
          {searchDraft.trim().length > 0 && searchDraft.trim().length < 2 ? (
            <Text style={styles.modalSearchHint}>{t('enterAtLeast2CharactersToSearch')}</Text>
          ) : null}
          <ScrollView showsVerticalScrollIndicator={false}>
            {filteredContacts.length > 0 ? filteredContacts.map((contact) => (
              <Pressable key={contact.id} onPress={() => onSelect(contact)} style={styles.forwardRow}>
                <Avatar label={contact.displayName || contact.username || 'M'} size={42} uri={contact.avatarUrl} />
                <View style={styles.forwardRowText}>
                  <Text numberOfLines={1} style={styles.forwardName}>{contact.displayName || t('sharedContact')}</Text>
                  {contact.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{contact.username}</Text> : null}
                </View>
                <Ionicons color={colors.primary} name="send" size={18} />
              </Pressable>
            )) : (
              <Text style={styles.forwardEmpty}>{normalizedSearch.length >= 2 ? t('noPeopleFound') : t('noContactsToShare')}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ChatGallerySectionProps = {
  files: Message[];
  language: AppLanguage;
  links: ChatLinkItem[];
  media: Message[];
  onOpenFile: (message: Message) => void;
  onOpenMedia: (message: Message) => void;
  onOpenUrl: (url: string) => void;
  onSelectTab: (tab: ChatGalleryTab) => void;
  onShowInChat: (messageId: string) => void;
  selectedTab: ChatGalleryTab;
};

export function ChatGallerySection({
  files,
  language,
  links,
  media,
  onOpenFile,
  onOpenMedia,
  onOpenUrl,
  onSelectTab,
  onShowInChat,
  selectedTab,
}: ChatGallerySectionProps) {
  const emptyText = selectedTab === 'media'
    ? t('noMediaInChat', {}, language)
    : selectedTab === 'files'
      ? t('noFilesInChat', {}, language)
      : t('noLinksInChat', {}, language);

  return (
    <View style={styles.chatGallerySection}>
      <Text style={styles.chatGalleryTitle}>{t('gallery', {}, language)}</Text>
      <View style={styles.chatGalleryTabs}>
        <ChatGalleryTabButton count={media.length} isActive={selectedTab === 'media'} label={t('galleryMedia', {}, language)} onPress={() => onSelectTab('media')} />
        <ChatGalleryTabButton count={files.length} isActive={selectedTab === 'files'} label={t('galleryFiles', {}, language)} onPress={() => onSelectTab('files')} />
        <ChatGalleryTabButton count={links.length} isActive={selectedTab === 'links'} label={t('galleryLinks', {}, language)} onPress={() => onSelectTab('links')} />
      </View>
      {selectedTab === 'media' && media.length > 0 ? (
        <View style={styles.chatGalleryGrid}>
          {media.map((message) => (
            <Pressable
              key={message.id}
              onLongPress={() => showGalleryItemActions(message.id, language, onShowInChat)}
              onPress={() => onOpenMedia(message)}
              style={styles.chatGalleryMediaTile}
            >
              {message.kind === 'image' && message.mediaUri ? (
                <Image resizeMode="cover" source={{ uri: message.mediaUri }} style={styles.chatGalleryMediaImage} />
              ) : (
                <ChatGalleryVideoTile message={message} />
              )}
              {message.kind === 'video' ? (
                <View style={styles.chatGalleryPlayButton}>
                  <Ionicons color={colors.white} name="play" size={22} />
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      {selectedTab === 'files' && files.length > 0 ? (
        <View style={styles.chatGalleryList}>
          {files.map((message) => (
            <Pressable
              key={message.id}
              onLongPress={() => showGalleryItemActions(message.id, language, onShowInChat)}
              onPress={() => onOpenFile(message)}
              style={({ pressed }) => [styles.chatGalleryFileRow, pressed ? styles.chatGalleryRowPressed : undefined]}
            >
              <View style={styles.chatGalleryFileIcon}>
                <Ionicons color={colors.primary} name="document-text-outline" size={22} />
              </View>
              <View style={styles.chatGalleryFileText}>
                <Text numberOfLines={1} style={styles.chatGalleryFileName}>{message.fileName ?? 'File'}</Text>
                <Text style={styles.chatGalleryFileMeta}>{formatBytes(message.sizeBytes)}</Text>
              </View>
              <Ionicons color={colors.textSecondary} name="open-outline" size={18} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {selectedTab === 'links' && links.length > 0 ? (
        <View style={styles.chatGalleryList}>
          {links.map((item) => (
            <Pressable
              key={item.id}
              onLongPress={() => showGalleryItemActions(item.message.id, language, onShowInChat)}
              onPress={() => onOpenUrl(item.url)}
              style={({ pressed }) => [styles.chatGalleryLinkRow, pressed ? styles.chatGalleryRowPressed : undefined]}
            >
              <View style={styles.chatGalleryFileIcon}>
                <Ionicons color={colors.primary} name="link-outline" size={22} />
              </View>
              <View style={styles.chatGalleryFileText}>
                <Text numberOfLines={1} style={styles.chatGalleryFileName}>{getLinkHost(item.url)}</Text>
                <Text numberOfLines={2} style={styles.chatGalleryLinkUrl}>{item.url}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {(selectedTab === 'media' && media.length === 0) || (selectedTab === 'files' && files.length === 0) || (selectedTab === 'links' && links.length === 0) ? (
        <Text style={styles.chatGalleryEmpty}>{emptyText}</Text>
      ) : null}
    </View>
  );
}

function ChatGalleryTabButton({ count, isActive, label, onPress }: { count: number; isActive: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chatGalleryTab, isActive ? styles.chatGalleryTabActive : undefined]}>
      <Text style={[styles.chatGalleryTabText, isActive ? styles.chatGalleryTabTextActive : undefined]}>{label}</Text>
      <Text style={[styles.chatGalleryTabCount, isActive ? styles.chatGalleryTabTextActive : undefined]}>{count}</Text>
    </Pressable>
  );
}

function ChatGalleryVideoTile({ message }: { message: Message }) {
  const configuredServerThumbnailUri = getMessageVideoThumbnailUri(message);
  const [failedServerThumbnailUri, setFailedServerThumbnailUri] = useState<string | null>(null);
  const serverThumbnailUri = configuredServerThumbnailUri === failedServerThumbnailUri
    ? null
    : configuredServerThumbnailUri;
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(() => serverThumbnailUri ?? getRememberedCachedVideoThumbnailUri({
    messageId: message.id,
    quality: 0.72,
    sourceSizeBytes: message.sizeBytes,
    sourceUri: message.mediaUri,
    timeMs: 800,
  }));

  useEffect(() => {
    let isMounted = true;

    async function loadThumbnail() {
      if (serverThumbnailUri) {
        setThumbnailUri(serverThumbnailUri);
        return;
      }

      if (!message.mediaUri) {
        setThumbnailUri(null);
        return;
      }

      try {
        const sourceUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;
        const rememberedThumbnail = getRememberedCachedVideoThumbnailUri({
          messageId: message.id,
          quality: 0.72,
          sourceSizeBytes: message.sizeBytes,
          sourceUri,
          timeMs: 800,
        });

        if (rememberedThumbnail && isMounted) {
          setThumbnailUri(rememberedThumbnail);
        } else if (isMounted) {
          setThumbnailUri(null);
        }

        const thumbnail = await getCachedVideoThumbnailUri({
          messageId: message.id,
          quality: 0.72,
          sourceSizeBytes: message.sizeBytes,
          sourceUri,
          timeMs: 800,
        });

        if (isMounted) {
          setThumbnailUri(thumbnail);
        }
      } catch {
        if (isMounted) {
          setThumbnailUri(null);
        }
      }
    }

    void loadThumbnail();

    return () => {
      isMounted = false;
    };
  }, [message.id, message.mediaUri, message.sizeBytes, serverThumbnailUri]);

  if (thumbnailUri) {
    return (
      <Image
        onError={() => {
          if (configuredServerThumbnailUri && thumbnailUri === configuredServerThumbnailUri) {
            setFailedServerThumbnailUri(configuredServerThumbnailUri);
            setThumbnailUri(null);
          }
        }}
        resizeMode="cover"
        source={{ uri: thumbnailUri }}
        style={styles.chatGalleryMediaImage}
      />
    );
  }

  return (
    <View style={styles.chatGalleryVideoFallback}>
      <Ionicons color={colors.white} name="videocam" size={24} />
    </View>
  );
}

function showGalleryItemActions(messageId: string, language: AppLanguage, onShowInChat: (messageId: string) => void) {
  Alert.alert(
    t('itemOptions', {}, language),
    undefined,
    [
      { text: t('showInChat', {}, language), onPress: () => onShowInChat(messageId) },
      { text: t('cancel', {}, language), style: 'cancel' },
    ],
  );
}

type AddSubscribersModalProps = {
  bottomInset: number;
  chatTargets: ForwardTarget[];
  contactTargets: ForwardTarget[];
  emptyText?: string;
  isAdding: boolean;
  language: AppLanguage;
  onClose: () => void;
  onSubmit: () => void;
  onToggle: (userId: string) => void;
  selectedUserIds: string[];
  submitLabel?: string;
  title?: string;
  visible: boolean;
};

export function AddSubscribersModal({ bottomInset, chatTargets, contactTargets, emptyText, isAdding, language, onClose, onSubmit, onToggle, selectedUserIds, submitLabel, title, visible }: AddSubscribersModalProps) {
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const selectedUserIdSet = new Set(selectedUserIds);
  const selectedCount = selectedUserIds.length;
  const resolvedEmptyText = emptyText ?? t('noAvailablePeopleToAdd', {}, language);
  const resolvedSubmitLabel = submitLabel ?? t('add', {}, language);
  const resolvedTitle = title ?? t('addSubscribers', {}, language);
  const trimmedSearch = debouncedSearch.trim();
  const canFilter = trimmedSearch.length >= 2;
  const isSearchTooShort = searchDraft.trim().length > 0 && searchDraft.trim().length < 2;
  const filteredChatTargets = useMemo(() => (
    canFilter ? filterForwardTargets(chatTargets, trimmedSearch) : chatTargets
  ), [canFilter, chatTargets, trimmedSearch]);
  const filteredContactTargets = useMemo(() => (
    canFilter ? filterForwardTargets(contactTargets, trimmedSearch) : contactTargets
  ), [canFilter, contactTargets, trimmedSearch]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(searchDraft.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchDraft]);

  useEffect(() => {
    if (!visible) {
      setSearchDraft('');
      setDebouncedSearch('');
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable onPress={onClose} style={styles.addSubscribersOverlay}>
        <Pressable style={[styles.forwardPanel, { paddingBottom: Math.max(spacing.lg, bottomInset + spacing.lg) }]}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{resolvedTitle}</Text>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.modalSearchWrap}>
            <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchDraft}
              placeholder={t('searchPeople', {}, language)}
              placeholderTextColor={colors.mutedText}
              style={styles.modalSearchInput}
              value={searchDraft}
            />
          </View>
          {isSearchTooShort ? <Text style={styles.modalSearchHint}>{t('enterAtLeast2CharactersToSearch', {}, language)}</Text> : null}
          <ScrollView showsVerticalScrollIndicator={false}>
            {!isSearchTooShort && filteredChatTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('chats', {}, language)}</Text>
                {filteredChatTargets.map((target) => (
                  <SubscriberTargetRow
                    isSelected={selectedUserIdSet.has(target.user.id)}
                    key={`add-chat-${target.user.id}`}
                    onPress={() => onToggle(target.user.id)}
                    target={target}
                  />
                ))}
              </>
            ) : null}
            {!isSearchTooShort && filteredChatTargets.length > 0 && filteredContactTargets.length > 0 ? <View style={styles.forwardDivider} /> : null}
            {!isSearchTooShort && filteredContactTargets.length > 0 ? (
              <>
                <Text style={styles.forwardSectionTitle}>{t('contacts', {}, language)}</Text>
                {filteredContactTargets.map((target) => (
                  <SubscriberTargetRow
                    isSelected={selectedUserIdSet.has(target.user.id)}
                    key={`add-contact-${target.user.id}`}
                    onPress={() => onToggle(target.user.id)}
                    target={target}
                  />
                ))}
              </>
            ) : null}
            {!isSearchTooShort && filteredChatTargets.length === 0 && filteredContactTargets.length === 0 ? (
              <Text style={styles.forwardEmpty}>{canFilter ? t('noPeopleFound', {}, language) : resolvedEmptyText}</Text>
            ) : null}
          </ScrollView>
          <Pressable
            disabled={selectedCount === 0 || isAdding}
            onPress={onSubmit}
            style={[styles.addSubscribersButton, selectedCount === 0 || isAdding ? styles.addSubscribersButtonDisabled : undefined]}
          >
            {isAdding ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Ionicons color={colors.white} name="person-add-outline" size={19} />
            )}
            <Text style={styles.addSubscribersButtonText}>{selectedCount > 0 ? `${resolvedSubmitLabel} ${selectedCount}` : resolvedSubmitLabel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SubscriberTargetRow({ isSelected, onPress, target }: { isSelected: boolean; onPress: () => void; target: ForwardTarget }) {
  return (
    <Pressable onPress={onPress} style={styles.forwardRow}>
      <Avatar label={target.title} size={42} uri={target.user.avatarUrl} />
      <View style={styles.forwardRowText}>
        <Text numberOfLines={1} style={styles.forwardName}>{target.title}</Text>
        {target.user.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{target.user.username}</Text> : null}
      </View>
      <View style={[styles.subscriberCheckbox, isSelected ? styles.subscriberCheckboxSelected : undefined]}>
        {isSelected ? <Ionicons color={colors.white} name="checkmark" size={16} /> : null}
      </View>
    </Pressable>
  );
}

type GroupCallMemberPickerProps = {
  language: AppLanguage;
  members: AuthUser[];
  mode: 'voice' | 'video' | null;
  onClose: () => void;
  onStart: () => void;
  onToggle: (userId: string) => void;
  selectedMemberIds: string[];
};

export function GroupCallMemberPicker({ language, members, mode, onClose, onStart, onToggle, selectedMemberIds }: GroupCallMemberPickerProps) {
  const selectedMemberIdSet = new Set(selectedMemberIds);
  const maxInvitees = mode ? getGroupCallLimit(mode) - 1 : 0;

  return (
    <Modal animationType="slide" transparent visible={!!mode} onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.infoBackdrop}>
        <Pressable style={styles.forwardPanel}>
          <View style={styles.forwardHeader}>
            <View style={styles.forwardHeaderText}>
              <Text style={styles.forwardTitle}>{t('choosePeople', {}, language)}</Text>
              <Text style={styles.forwardSubtitle}>
                {t('groupCallLimit', { mode: t(mode === 'video' ? 'video' : 'voice', {}, language), selected: selectedMemberIds.length, max: maxInvitees }, language)}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {members.map((member) => {
              const isSelected = selectedMemberIdSet.has(member.id);

              return (
                <Pressable key={member.id} onPress={() => onToggle(member.id)} style={styles.forwardRow}>
                  <Avatar label={member.displayName || member.username} size={42} uri={member.avatarUrl} />
                  <View style={styles.forwardRowText}>
                    <Text numberOfLines={1} style={styles.forwardName}>{member.displayName || member.username}</Text>
                    {member.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{member.username}</Text> : null}
                  </View>
                  <View style={[styles.subscriberCheckbox, isSelected ? styles.subscriberCheckboxSelected : undefined]}>
                    {isSelected ? <Ionicons color={colors.white} name="checkmark" size={16} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            disabled={selectedMemberIds.length === 0}
            onPress={onStart}
            style={[styles.addSubscribersButton, selectedMemberIds.length === 0 ? styles.addSubscribersButtonDisabled : undefined]}
          >
            <Ionicons color={colors.white} name={mode === 'video' ? 'videocam-outline' : 'call-outline'} size={19} />
            <Text style={styles.addSubscribersButtonText}>{t('startCall', {}, language)}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ChatInfoModalProps = {
  bottomInset: number;
  chatTargets: ForwardTarget[];
  contactTargets: ForwardTarget[];
  conversation?: Conversation;
  fallbackTitle: string;
  isGroup: boolean;
  isGroupAdmin: boolean;
  isOwner: boolean;
  messages: Message[];
  onAddGroupAdmins: (conversationId: string, userIds: string[]) => Promise<Conversation>;
  onAddGroupMembers: (conversationId: string, userIds: string[]) => Promise<Conversation>;
  onChangeGroupPicture: () => void;
  onChangeGroupSettings: (conversationId: string, input: { hideMembers?: boolean; isPublic?: boolean; ownerOnlyMessages?: boolean; preventMediaSave?: boolean; preventScreenshots?: boolean; showAdmins?: boolean; showMemberCount?: boolean }) => Promise<Conversation>;
  onChangeGroupTitle: (conversationId: string, title: string) => Promise<Conversation>;
  onChangeDisappearingMessages: (enabled: boolean) => void;
  onClose: () => void;
  onDeleteGroup: (conversationId: string) => Promise<void>;
  onOpenFile: (message: Message) => void;
  onOpenMedia: (message: Message) => void;
  onOpenSubscription: () => void;
  onOpenUrl: (url: string) => void;
  onRemoveGroupMember: (conversationId: string, userId: string) => Promise<Conversation>;
  onRevokeGroupAdmin: (conversationId: string, userId: string) => Promise<Conversation>;
  onSearch: () => void;
  onShowInChat: (messageId: string) => void;
  onStartCall: (mode: 'voice' | 'video') => void;
  onTransferGroupOwnership: (conversationId: string, userId: string) => Promise<Conversation>;
  otherUser: AuthUser | null;
  visible: boolean;
};

export function ChatInfoModal(props: ChatInfoModalProps) {
  if (!props.visible) {
    return null;
  }

  return <ChatInfoModalContent {...props} />;
}

function ChatInfoModalContent({
  bottomInset,
  chatTargets,
  contactTargets,
  conversation,
  fallbackTitle,
  isGroup,
  isGroupAdmin,
  isOwner,
  messages,
  onAddGroupAdmins,
  onAddGroupMembers,
  onChangeGroupPicture,
  onChangeGroupSettings,
  onChangeGroupTitle,
  onChangeDisappearingMessages,
  onClose,
  onDeleteGroup,
  onOpenFile,
  onOpenMedia,
  onOpenSubscription,
  onOpenUrl,
  onRemoveGroupMember,
  onRevokeGroupAdmin,
  onSearch,
  onShowInChat,
  onStartCall,
  onTransferGroupOwnership,
  otherUser,
  visible,
}: ChatInfoModalProps) {
  const uiLanguage = useAppStore((state: { language: AppLanguage }) => state.language);
  const currentUserId = useAppStore((state) => state.user?.id);
  const subscriptionStatus = useAppStore((state) => state.subscriptionStatus);
  const serverUrl = useAppStore((state) => state.serverUrl);
  const canUsePremiumFeatures = hasPremiumAccess(subscriptionStatus);
  const title = isGroup ? (conversation?.title ?? fallbackTitle) : (otherUser?.displayName ?? fallbackTitle);
  const shouldShowTitlePremiumBadge = !isGroup && otherUser?.hasPremiumAccess === true;
  const members = isGroup ? conversation?.members ?? EMPTY_MEMBERS : EMPTY_MEMBERS;
  const memberCount = isGroup ? conversation?.memberCount ?? members.length : 0;
  const presenceSubtitle = formatPresenceSubtitle(otherUser, uiLanguage);
  const subtitle = isGroup ? formatSubscriberCount(members.length, uiLanguage) : [otherUser?.username ? `@${otherUser.username}` : '', presenceSubtitle].filter(Boolean).join(' · ');
  const avatarUri = isGroup ? conversation?.avatarUrl : otherUser?.avatarUrl;
  const displaySubtitle = isGroup && conversation?.showMemberCount === false ? '' : isGroup ? formatSubscriberCount(memberCount, uiLanguage) : subtitle;
  const canShowCallActions = conversation?.isVoiceRoom !== true;
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [isSavingTitle, setSavingTitle] = useState(false);
  const [savingSetting, setSavingSetting] = useState<'hideMembers' | 'isPublic' | 'ownerOnlyMessages' | 'preventMediaSave' | 'preventScreenshots' | 'showAdmins' | 'showMemberCount' | null>(null);
  const [isAddingMembers, setAddingMembers] = useState(false);
  const [isAddingSelectedMembers, setAddingSelectedMembers] = useState(false);
  const [selectedAddMemberIds, setSelectedAddMemberIds] = useState<string[]>([]);
  const [isTransferPickerVisible, setTransferPickerVisible] = useState(false);
  const [transferTarget, setTransferTarget] = useState<AuthUser | null>(null);
  const [isTransferringOwnership, setTransferringOwnership] = useState(false);
  const [makeAdminTarget, setMakeAdminTarget] = useState<AuthUser | null>(null);
  const [isMakingAdmin, setMakingAdmin] = useState(false);
  const [isDeleteGroupConfirmVisible, setDeleteGroupConfirmVisible] = useState(false);
  const [isDeletingGroup, setDeletingGroup] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isMemberSearchVisible, setMemberSearchVisible] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [debouncedMemberSearch, setDebouncedMemberSearch] = useState('');
  const [memberPage, setMemberPage] = useState(1);
  const [fullScreenPhotoUri, setFullScreenPhotoUri] = useState<string | null>(null);
  const [isGalleryModalVisible, setGalleryModalVisible] = useState(false);
  const [galleryTab, setGalleryTab] = useState<ChatGalleryTab>('media');
  const [shareBaseUrl, setShareBaseUrl] = useState<string | null>(null);
  const memberIds = useMemo(() => new Set(members.map((member) => member.id)), [members]);
  const adminIdSet = useMemo(() => new Set(conversation?.adminIds ?? []), [conversation?.adminIds]);
  const shouldShowAdminBadges = conversation?.showAdmins !== false;
  const addChatTargets = useMemo(() => (
    chatTargets.filter((target) => target.user.isSystem !== true && target.user.id !== conversation?.ownerId && !memberIds.has(target.user.id))
  ), [chatTargets, conversation?.ownerId, memberIds]);
  const addContactTargets = useMemo(() => (
    contactTargets.filter((target) => target.user.isSystem !== true && target.user.id !== conversation?.ownerId && !memberIds.has(target.user.id))
  ), [contactTargets, conversation?.ownerId, memberIds]);
  const transferableAdmins = useMemo(() => (
    members.filter((member) => member.id !== conversation?.ownerId && adminIdSet.has(member.id))
  ), [adminIdSet, conversation?.ownerId, members]);
  const sortedMembers = useMemo(() => (
    [...members].sort((left, right) => {
      const leftRank = getGroupMemberRank(left.id, conversation?.ownerId, adminIdSet);
      const rightRank = getGroupMemberRank(right.id, conversation?.ownerId, adminIdSet);

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return (left.displayName || left.username).localeCompare(right.displayName || right.username);
    })
  ), [adminIdSet, conversation?.ownerId, members]);
  const trimmedMemberSearch = debouncedMemberSearch.trim();
  const canSearchMembers = trimmedMemberSearch.length >= 2;
  const visibleMembers = useMemo(() => {
    if (!canSearchMembers) {
      return sortedMembers;
    }

    const query = trimmedMemberSearch.toLowerCase();

    return sortedMembers.filter((member) => (
      member.displayName.toLowerCase().includes(query) ||
      member.username.toLowerCase().includes(query)
    ));
  }, [canSearchMembers, sortedMembers, trimmedMemberSearch]);
  const totalMemberPages = Math.max(1, Math.ceil(visibleMembers.length / GROUP_MEMBER_PAGE_SIZE));
  const boundedMemberPage = Math.min(memberPage, totalMemberPages);
  const pagedMembers = visibleMembers.slice(
    (boundedMemberPage - 1) * GROUP_MEMBER_PAGE_SIZE,
    boundedMemberPage * GROUP_MEMBER_PAGE_SIZE,
  );
  const shouldPopulateGallery = visible && (!isGroup || isGalleryModalVisible);
  const galleryMediaMessages = useMemo(() => (
    shouldPopulateGallery
      ? messages.filter((message) => (message.kind === 'image' || message.kind === 'video') && !!message.mediaUri)
      : EMPTY_MESSAGES
  ), [messages, shouldPopulateGallery]);
  const galleryFileMessages = useMemo(() => (
    shouldPopulateGallery
      ? messages.filter((message) => message.kind === 'file' && !!message.mediaUri)
      : EMPTY_MESSAGES
  ), [messages, shouldPopulateGallery]);
  const galleryLinks = useMemo(
    () => shouldPopulateGallery ? extractChatLinks(messages) : [],
    [messages, shouldPopulateGallery],
  );
  const publicGroupLink = conversation?.publicInviteCode && shareBaseUrl
    ? buildSharedGroupWebUrl(conversation.publicInviteCode, shareBaseUrl)
    : '';
  const disappearingMessagesDurationLabelKey = getDisappearingMessagesDurationLabelKey(conversation?.disappearingMessagesDurationMinutes);
  const disappearingMessagesEnabled = !!conversation?.disappearingMessagesDurationMinutes;
  const disappearingMessagesEnabledByPeer = disappearingMessagesEnabled && conversation?.disappearingMessagesSetById !== currentUserId;

  useEffect(() => {
    let active = true;
    setShareBaseUrl(null);

    void getShareBaseUrl(serverUrl).then((resolvedUrl) => {
      if (active) {
        setShareBaseUrl(resolvedUrl);
      }
    });

    return () => {
      active = false;
    };
  }, [serverUrl]);

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(title);
    }
  }, [isEditingTitle, title]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedMemberSearch(memberSearch.trim());
    }, 300);

    return () => clearTimeout(timeout);
  }, [memberSearch]);

  useEffect(() => {
    setMemberPage(1);
  }, [debouncedMemberSearch, isMemberSearchVisible]);

  useEffect(() => {
    if (memberPage > totalMemberPages) {
      setMemberPage(totalMemberPages);
    }
  }, [memberPage, totalMemberPages]);

  useEffect(() => {
    if (!isGroupAdmin) {
      setAddingMembers(false);
      setSelectedAddMemberIds([]);
    }
  }, [isGroupAdmin]);

  useEffect(() => {
    if (!isOwner) {
      setTransferPickerVisible(false);
      setTransferTarget(null);
      setMakeAdminTarget(null);
      setDeleteGroupConfirmVisible(false);
    }
  }, [isOwner]);

  async function saveGroupTitle() {
    const nextTitle = titleDraft.trim();

    if (!conversation || !nextTitle || nextTitle === title) {
      setEditingTitle(false);
      setTitleDraft(title);
      return;
    }

    if (containsMeetVapKeyword(nextTitle)) {
      Alert.alert(t('couldNotRenameGroup', {}, uiLanguage), t('meetvapNameProhibited', {}, uiLanguage));
      return;
    }

    setSavingTitle(true);

    try {
      await onChangeGroupTitle(conversation.id, nextTitle);
      setEditingTitle(false);
    } catch (error) {
      Alert.alert(t('couldNotRenameGroup', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setSavingTitle(false);
    }
  }

  async function saveGroupSetting(key: 'hideMembers' | 'isPublic' | 'ownerOnlyMessages' | 'preventMediaSave' | 'preventScreenshots' | 'showAdmins' | 'showMemberCount', value: boolean) {
    if (!conversation) {
      return;
    }

    if (key === 'preventScreenshots' && value && !canUsePremiumFeatures) {
      Alert.alert(t('premiumRequiredTitle', {}, uiLanguage), t('premiumRequiredMessage', {}, uiLanguage), [
        { text: t('cancel', {}, uiLanguage), style: 'cancel' },
        { text: t('premiumSubscribe', {}, uiLanguage), onPress: onOpenSubscription },
      ]);
      return;
    }

    setSavingSetting(key);

    try {
      await onChangeGroupSettings(conversation.id, { [key]: value });
    } catch (error) {
      Alert.alert(t('couldNotUpdateGroupSetting', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setSavingSetting(null);
    }
  }

  function closeAddSubscribers() {
    if (isAddingSelectedMembers) {
      return;
    }

    setAddingMembers(false);
    setSelectedAddMemberIds([]);
  }

  function toggleAddSubscriber(userId: string) {
    setSelectedAddMemberIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  }

  async function addSelectedGroupMembers() {
    if (!conversation || selectedAddMemberIds.length === 0) {
      return;
    }

    setAddingSelectedMembers(true);

    try {
      await onAddGroupMembers(conversation.id, selectedAddMemberIds);
      setAddingMembers(false);
      setSelectedAddMemberIds([]);
    } catch (error) {
      Alert.alert(t('couldNotAddSubscribers', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setAddingSelectedMembers(false);
    }
  }

  async function makeGroupAdmin(member: AuthUser) {
    if (!conversation) {
      return;
    }

    setMakingAdmin(true);

    try {
      await onAddGroupAdmins(conversation.id, [member.id]);
      setMakeAdminTarget(null);
    } catch (error) {
      Alert.alert(t('couldNotAddAdmins', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setMakingAdmin(false);
    }
  }

  async function transferOwnership(userId: string) {
    if (!conversation) {
      return;
    }

    setTransferringOwnership(true);

    try {
      await onTransferGroupOwnership(conversation.id, userId);
      setTransferTarget(null);
      setTransferPickerVisible(false);
    } catch (error) {
      Alert.alert(t('couldNotTransferOwnership', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setTransferringOwnership(false);
    }
  }

  function confirmDeleteGroup() {
    if (!conversation || !isOwner || isDeletingGroup) {
      return;
    }

    setDeleteGroupConfirmVisible(true);
  }

  async function deleteGroupAfterCountdown() {
    if (!conversation || !isOwner || isDeletingGroup) {
      return;
    }

    setDeletingGroup(true);

    try {
      await onDeleteGroup(conversation.id);
      setDeleteGroupConfirmVisible(false);
    } catch (error) {
      Alert.alert(t('couldNotDeleteGroup', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
      setDeletingGroup(false);
    }
  }

  function showGroupMemberActions(member: AuthUser) {
    if (!conversation || member.id === conversation.ownerId) {
      return;
    }

    const canRevokeAdmin = isOwner && adminIdSet.has(member.id);
    const canMakeAdmin = isOwner && !adminIdSet.has(member.id);
    const canRemoveMember = isGroupAdmin && (!adminIdSet.has(member.id) || isOwner);

    if (!canMakeAdmin && !canRevokeAdmin && !canRemoveMember) {
      return;
    }

    Alert.alert(
      member.displayName || member.username,
      undefined,
      [
        ...(canMakeAdmin ? [{
          text: t('makeAdmin', {}, uiLanguage),
          onPress: () => setMakeAdminTarget(member),
        }] : []),
        ...(canRevokeAdmin ? [{
          text: t('revokeAdmin', {}, uiLanguage),
          onPress: () => void revokeGroupAdmin(member),
        }] : []),
        ...(canRemoveMember ? [{
          text: t('remove', {}, uiLanguage),
          style: 'destructive' as const,
          onPress: () => void removeGroupMember(member),
        }] : []),
        { text: t('cancel', {}, uiLanguage), style: 'cancel' as const },
      ],
    );
  }

  async function revokeGroupAdmin(member: AuthUser) {
    if (!conversation) {
      return;
    }

    setRemovingMemberId(member.id);

    try {
      await onRevokeGroupAdmin(conversation.id, member.id);
    } catch (error) {
      Alert.alert(t('couldNotRevokeAdmin', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setRemovingMemberId(null);
    }
  }

  async function removeGroupMember(member: AuthUser) {
    if (!conversation) {
      return;
    }

    setRemovingMemberId(member.id);

    try {
      await onRemoveGroupMember(conversation.id, member.id);
    } catch (error) {
      Alert.alert(t('couldNotRemoveSubscriber', {}, uiLanguage), error instanceof Error ? error.message : t('pleaseTryAgain', {}, uiLanguage));
    } finally {
      setRemovingMemberId(null);
    }
  }

  return (
    <>
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.infoBackdrop}>
        <Pressable onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.infoPanel, { paddingBottom: Math.max(spacing.xl, bottomInset + spacing.lg) }]}>
          <ScrollView
            contentContainerStyle={styles.infoContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            overScrollMode="always"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator
          >
            <Pressable
              disabled={isGroup ? !isGroupAdmin : !avatarUri}
              onPress={() => {
                if (isGroup) {
                  onChangeGroupPicture();
                  return;
                }

                if (avatarUri) {
                  setFullScreenPhotoUri(avatarUri);
                }
              }}
              style={styles.infoAvatarButton}
            >
              <Avatar label={title} size={92} uri={avatarUri} />
              {isGroup && isGroupAdmin ? (
                <View style={styles.infoAvatarCamera}>
                  <Ionicons color={colors.white} name="camera" size={19} />
                </View>
              ) : null}
            </Pressable>
            {isGroup && isGroupAdmin ? (
              <View style={styles.infoTitleRow}>
                {isEditingTitle ? (
                  <TextInput
                    autoFocus
                    editable={!isSavingTitle}
                    onChangeText={setTitleDraft}
                    onSubmitEditing={() => void saveGroupTitle()}
                    placeholder={t('groupName', {}, uiLanguage)}
                    placeholderTextColor={colors.mutedText}
                    returnKeyType="done"
                    style={styles.infoTitleInput}
                    value={titleDraft}
                  />
                ) : (
                  <Text numberOfLines={2} style={styles.infoTitle}>{title}</Text>
                )}
                <Pressable
                  disabled={isSavingTitle}
                  onPress={() => {
                    if (isEditingTitle) {
                      void saveGroupTitle();
                      return;
                    }

                    setTitleDraft(title);
                    setEditingTitle(true);
                  }}
                  style={styles.infoEditButton}
                >
                  <Ionicons color={colors.primary} name={isEditingTitle ? 'checkmark' : 'create-outline'} size={20} />
                </Pressable>
              </View>
            ) : (
              <View style={styles.infoTitleRow}>
                {shouldShowTitlePremiumBadge ? <PremiumUserBadge size={20} /> : null}
                <Text numberOfLines={2} style={styles.infoTitle}>{title}</Text>
              </View>
            )}
            {displaySubtitle ? <Text numberOfLines={1} style={styles.infoSubtitle}>{displaySubtitle}</Text> : null}
            <View style={styles.infoActions}>
              {canShowCallActions ? (
                <>
                  <InfoAction icon="call-outline" label={t('voiceCall')} onPress={() => onStartCall('voice')} />
                  <InfoAction icon="videocam-outline" label={t('videoCall')} onPress={() => onStartCall('video')} />
                </>
              ) : null}
              <InfoAction icon="search-outline" label={t('search')} onPress={onSearch} />
            </View>
            {!isGroup ? (
              <View style={styles.directChatSettingsSection}>
                <View style={styles.groupSettingRow}>
                  <View style={styles.directChatSettingText}>
                    <View style={styles.directChatSettingTitleRow}>
                      <Text style={styles.directChatSettingLabel}>{t('autoDisappearingMessages', {}, uiLanguage)}</Text>
                      {disappearingMessagesDurationLabelKey ? (
                        <Text style={styles.disappearingMessagesBadge}>{t(disappearingMessagesDurationLabelKey, {}, uiLanguage)}</Text>
                      ) : null}
                    </View>
                    {disappearingMessagesEnabledByPeer ? (
                      <Text style={styles.directChatSettingHint}>{t('disappearingMessagesEnabledByPeer', {}, uiLanguage)}</Text>
                    ) : null}
                  </View>
                  <CompactToggle
                    disabled={disappearingMessagesEnabledByPeer}
                    onValueChange={onChangeDisappearingMessages}
                    value={disappearingMessagesEnabled}
                  />
                </View>
              </View>
            ) : null}
            {isGroup ? (
              <Pressable onPress={() => setGalleryModalVisible(true)} style={styles.chatGalleryOpenButton}>
                <View style={styles.chatGalleryOpenIcon}>
                  <Ionicons color={colors.primary} name="images-outline" size={22} />
                </View>
                <View style={styles.chatGalleryOpenText}>
                  <Text style={styles.chatGalleryOpenTitle}>{t('gallery', {}, uiLanguage)}</Text>
                  <Text style={styles.chatGalleryOpenSubtitle}>
                    {galleryMediaMessages.length + galleryFileMessages.length + galleryLinks.length}
                  </Text>
                </View>
                <Ionicons color={colors.textSecondary} name="chevron-forward" size={20} />
              </Pressable>
            ) : (
              <ChatGallerySection
                files={galleryFileMessages}
                links={galleryLinks}
                media={galleryMediaMessages}
                onOpenFile={onOpenFile}
                onOpenMedia={onOpenMedia}
                onOpenUrl={onOpenUrl}
                onShowInChat={onShowInChat}
                selectedTab={galleryTab}
                onSelectTab={setGalleryTab}
                language={uiLanguage}
              />
            )}
            {isGroup && isOwner ? (
              <View style={styles.groupSettingsSection}>
                <Text style={styles.groupSettingsTitle}>{t('groupSettings', {}, uiLanguage)}</Text>
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={`${t('groupType', {}, uiLanguage)}: ${conversation?.isPublic ? t('publicGroup', {}, uiLanguage) : t('privateGroup', {}, uiLanguage)}`}
                  onValueChange={(value) => void saveGroupSetting('isPublic', value)}
                  value={conversation?.isPublic === true}
                />
                {conversation?.isPublic === true && publicGroupLink ? (
                  <View style={styles.groupLinkBox}>
                    <Text style={styles.groupLinkLabel}>{t('groupLink', {}, uiLanguage)}</Text>
                    <Pressable
                      onPress={() => {
                        void Clipboard.setStringAsync(publicGroupLink).then(() => {
                          Alert.alert(t('copied', {}, uiLanguage), publicGroupLink);
                        });
                      }}
                      style={styles.groupLinkInputWrap}
                    >
                      <Text numberOfLines={1} style={styles.groupLinkInput}>{publicGroupLink}</Text>
                      <Ionicons color={colors.primary} name="copy-outline" size={18} />
                    </Pressable>
                  </View>
                ) : null}
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('hideSubscriberList', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('hideMembers', value)}
                  value={conversation?.hideMembers === true}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('showAdmins', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('showAdmins', value)}
                  value={conversation?.showAdmins !== false}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('showUserCount', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('showMemberCount', value)}
                  value={conversation?.showMemberCount !== false}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('onlyAdminsCanSendMessages', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('ownerOnlyMessages', value)}
                  value={conversation?.ownerOnlyMessages === true}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('preventGroupMediaSave', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('preventMediaSave', value)}
                  value={conversation?.preventMediaSave === true}
                />
                <GroupSettingRow
                  disabled={savingSetting !== null}
                  label={t('preventGroupScreenshots', {}, uiLanguage)}
                  onValueChange={(value) => void saveGroupSetting('preventScreenshots', value)}
                  value={canUsePremiumFeatures && conversation?.preventScreenshots === true}
                />
              </View>
            ) : null}
            {isGroup ? (
              <View style={styles.memberSection}>
                <View style={styles.memberSectionHeader}>
                  <View>
                    <Text style={styles.memberSectionTitle}>{t('people', {}, uiLanguage)}</Text>
                    <Text style={styles.memberSectionCount}>{formatSubscriberCount(memberCount, uiLanguage)}</Text>
                  </View>
                  <View style={styles.memberHeaderActions}>
                    {isGroupAdmin ? (
                      <Pressable onPress={() => setAddingMembers(true)} style={styles.memberAddButton}>
                        <Ionicons color={colors.primary} name="person-add-outline" size={20} />
                      </Pressable>
                    ) : null}
                    {members.length > 0 ? (
                      <Pressable
                        onPress={() => {
                          setMemberSearchVisible((current) => !current);
                          setMemberSearch('');
                          setDebouncedMemberSearch('');
                        }}
                        style={styles.memberSearchButton}
                      >
                        <Ionicons color={colors.primary} name={isMemberSearchVisible ? 'close' : 'search-outline'} size={20} />
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {members.length === 0 && conversation?.hideMembers ? (
                  <Text style={styles.memberHiddenText}>{t('subscriberListHiddenByAdmin', {}, uiLanguage)}</Text>
                ) : null}
                {members.length > 0 ? (
                  <>
                    {isMemberSearchVisible ? (
                      <View style={styles.memberSearchWrap}>
                        <Ionicons color={colors.textSecondary} name="search-outline" size={18} />
                        <TextInput
                          autoCapitalize="none"
                          autoCorrect={false}
                          onChangeText={setMemberSearch}
                          placeholder={t('searchDisplayNameOrUsername', {}, uiLanguage)}
                          placeholderTextColor={colors.mutedText}
                          style={styles.memberSearchInput}
                          value={memberSearch}
                        />
                      </View>
                    ) : null}
                    {isMemberSearchVisible && memberSearch.trim().length > 0 && memberSearch.trim().length < 2 ? (
                      <Text style={styles.memberSearchHint}>{t('enterAtLeast2Characters', {}, uiLanguage)}</Text>
                    ) : null}
                    <View style={styles.memberListPane}>
                      <ScrollView
                        keyboardShouldPersistTaps="handled"
                        nestedScrollEnabled
                        overScrollMode="always"
                        scrollEventThrottle={16}
                        showsVerticalScrollIndicator
                      >
                        {pagedMembers.length > 0 ? pagedMembers.map((member) => {
                          const canMakeAdmin = isOwner && member.id !== conversation?.ownerId && !adminIdSet.has(member.id);
                          const canManageMember = canMakeAdmin || (isGroupAdmin &&
                            member.id !== conversation?.ownerId &&
                            (!adminIdSet.has(member.id) || isOwner));

                          return (
                            <Pressable
                              disabled={!canManageMember || removingMemberId === member.id}
                              key={member.id}
                              onLongPress={() => showGroupMemberActions(member)}
                              style={({ pressed }) => [
                                styles.memberRow,
                                pressed && canManageMember ? styles.memberRowPressed : undefined,
                              ]}
                            >
                              <Avatar label={member.displayName || member.username} size={42} uri={member.avatarUrl} />
                              <View style={styles.memberText}>
                                <Text numberOfLines={1} style={styles.memberName}>{member.displayName || member.username}</Text>
                                {member.username ? <Text numberOfLines={1} style={styles.memberUsername}>@{member.username}</Text> : null}
                              </View>
                              {shouldShowAdminBadges && member.id !== conversation?.ownerId && adminIdSet.has(member.id) ? (
                                <View style={styles.adminBadge}>
                                  <Ionicons color={colors.primary} name="shield-checkmark" size={13} />
                                  <Text style={styles.adminBadgeText}>{t('admin', {}, uiLanguage)}</Text>
                                </View>
                              ) : null}
                              {member.groupInvitePending === true ? (
                                <View style={styles.memberPendingBadge}>
                                  <Text style={styles.memberPendingBadgeText}>{t('pending', {}, uiLanguage)}</Text>
                                </View>
                              ) : null}
                              {removingMemberId === member.id ? (
                                <ActivityIndicator color={colors.primary} size="small" />
                              ) : null}
                            </Pressable>
                          );
                        }) : (
                          <Text style={styles.memberHiddenText}>{t('noSubscribersFound', {}, uiLanguage)}</Text>
                        )}
                      </ScrollView>
                    </View>
                    <MemberPagination
                      currentPage={boundedMemberPage}
                      language={uiLanguage}
                      onPageChange={setMemberPage}
                      totalPages={totalMemberPages}
                    />
                    <Text style={styles.memberPageSummary}>
                      {t('showingItemsOfTotal', {
                        from: pagedMembers.length === 0 ? 0 : ((boundedMemberPage - 1) * GROUP_MEMBER_PAGE_SIZE) + 1,
                        to: Math.min(boundedMemberPage * GROUP_MEMBER_PAGE_SIZE, visibleMembers.length),
                        total: visibleMembers.length,
                      }, uiLanguage)}
                    </Text>
                  </>
                ) : null}
                {isOwner ? (
                  <View style={styles.groupAdminActions}>
                    <Pressable
                      disabled={isTransferringOwnership}
                      onPress={() => {
                        if (transferableAdmins.length === 0) {
                          Alert.alert(t('transferOwnershipFirst', {}, uiLanguage), t('transferOwnershipNeedsAdmin', {}, uiLanguage));
                          return;
                        }

                        setTransferPickerVisible(true);
                      }}
                      style={styles.groupAdminActionButton}
                    >
                      <Ionicons color={colors.primary} name="key-outline" size={19} />
                    </Pressable>
                    <Pressable disabled={isDeletingGroup} onPress={confirmDeleteGroup} style={styles.groupDeleteButton}>
                      {isDeletingGroup ? <ActivityIndicator color={colors.danger} size="small" /> : <Ionicons color={colors.danger} name="trash-outline" size={19} />}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>
        </View>
	        <AddSubscribersModal
	          bottomInset={bottomInset}
	          chatTargets={addChatTargets}
	          contactTargets={addContactTargets}
          isAdding={isAddingSelectedMembers}
          language={uiLanguage}
          onClose={closeAddSubscribers}
          onSubmit={() => void addSelectedGroupMembers()}
          onToggle={toggleAddSubscriber}
	          selectedUserIds={selectedAddMemberIds}
	          visible={isGroupAdmin && isAddingMembers}
	        />
	        <CountdownConfirmOverlay
	          confirmLabel={t('deleteGroup', {}, uiLanguage)}
	          description={t('deleteGroupDescription', {}, uiLanguage)}
	          destructive
	          durationSeconds={10}
	          isSubmitting={isDeletingGroup}
	          onCancel={() => setDeleteGroupConfirmVisible(false)}
	          onConfirm={() => void deleteGroupAfterCountdown()}
	          title={t('deleteGroupQuestion', {}, uiLanguage)}
	          visible={isDeleteGroupConfirmVisible}
	        />
	      </View>
	    </Modal>
    <Modal
      animationType="fade"
      transparent
      visible={!!fullScreenPhotoUri}
      onRequestClose={() => setFullScreenPhotoUri(null)}
    >
      <Pressable onPress={() => setFullScreenPhotoUri(null)} style={styles.fullPhotoBackdrop}>
        {fullScreenPhotoUri ? (
          <Image resizeMode="contain" source={{ uri: fullScreenPhotoUri }} style={styles.fullPhotoImage} />
        ) : null}
        <Pressable onPress={() => setFullScreenPhotoUri(null)} style={styles.fullPhotoClose}>
          <Ionicons color={colors.white} name="close" size={28} />
        </Pressable>
      </Pressable>
    </Modal>
    <Modal animationType="slide" visible={isGalleryModalVisible} onRequestClose={() => setGalleryModalVisible(false)}>
      <View style={styles.galleryModalContainer}>
        <View style={styles.galleryModalHeader}>
          <Pressable onPress={() => setGalleryModalVisible(false)} style={styles.galleryModalBackButton}>
            <Ionicons color={colors.textPrimary} name="chevron-back" size={26} />
          </Pressable>
          <Text style={styles.galleryModalTitle}>{t('gallery', {}, uiLanguage)}</Text>
          <View style={styles.galleryModalHeaderSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.galleryModalContent} showsVerticalScrollIndicator>
          <ChatGallerySection
            files={galleryFileMessages}
            links={galleryLinks}
            media={galleryMediaMessages}
            onOpenFile={onOpenFile}
            onOpenMedia={onOpenMedia}
            onOpenUrl={onOpenUrl}
            onShowInChat={onShowInChat}
            selectedTab={galleryTab}
            onSelectTab={setGalleryTab}
            language={uiLanguage}
          />
        </ScrollView>
      </View>
    </Modal>
    <Modal animationType="slide" transparent visible={isOwner && isTransferPickerVisible} onRequestClose={() => setTransferPickerVisible(false)}>
      <Pressable onPress={() => setTransferPickerVisible(false)} style={styles.infoBackdrop}>
        <Pressable style={[styles.forwardPanel, { paddingBottom: Math.max(spacing.lg, bottomInset + spacing.lg) }]}>
          <View style={styles.forwardHeader}>
            <Text style={styles.forwardTitle}>{t('transferOwnership', {}, uiLanguage)}</Text>
            <Pressable onPress={() => setTransferPickerVisible(false)} style={styles.forwardClose}>
              <Ionicons color={colors.textSecondary} name="close" size={22} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {transferableAdmins.length > 0 ? transferableAdmins.map((member) => (
              <Pressable key={`transfer-${member.id}`} onPress={() => setTransferTarget(member)} style={styles.forwardRow}>
                <Avatar label={member.displayName || member.username} size={42} uri={member.avatarUrl} />
                <View style={styles.forwardRowText}>
                  <Text numberOfLines={1} style={styles.forwardName}>{member.displayName || member.username}</Text>
                  {member.username ? <Text numberOfLines={1} style={styles.forwardUsername}>@{member.username}</Text> : null}
                </View>
                <Ionicons color={colors.primary} name="chevron-forward" size={20} />
              </Pressable>
            )) : (
              <Text style={styles.forwardEmpty}>{t('addAnotherAdminBeforeTransfer', {}, uiLanguage)}</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
	    <CountdownConfirmModal
      confirmLabel={t('transfer', {}, uiLanguage)}
      description={t('transferOwnershipDescription', { name: transferTarget?.displayName || transferTarget?.username || t('thisAdmin', {}, uiLanguage) }, uiLanguage)}
      durationSeconds={10}
      isSubmitting={isTransferringOwnership}
      onCancel={() => setTransferTarget(null)}
      onConfirm={() => {
        if (transferTarget) {
          void transferOwnership(transferTarget.id);
        }
      }}
      title={t('transferOwnershipQuestion', {}, uiLanguage)}
      visible={!!transferTarget}
    />
    <CountdownConfirmModal
      confirmLabel={t('makeAdmin', {}, uiLanguage)}
      description={t('makeAdminDescription', { name: makeAdminTarget?.displayName || makeAdminTarget?.username || t('thisAdmin', {}, uiLanguage) }, uiLanguage)}
      durationSeconds={5}
      isSubmitting={isMakingAdmin}
      onCancel={() => setMakeAdminTarget(null)}
      onConfirm={() => {
        if (makeAdminTarget) {
          void makeGroupAdmin(makeAdminTarget);
        }
      }}
      title={t('makeAdminQuestion', {}, uiLanguage)}
      visible={!!makeAdminTarget}
    />
    </>
  );
}

type CountdownConfirmProps = {
  confirmLabel: string;
  description: string;
  destructive?: boolean;
  durationSeconds: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  visible: boolean;
};

function CountdownConfirmModal(props: CountdownConfirmProps) {
  const { onCancel, visible } = props;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onCancel}>
      <CountdownConfirmContent {...props} />
    </Modal>
  );
}

function CountdownConfirmOverlay(props: CountdownConfirmProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={props.isSubmitting ? undefined : props.onCancel}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={props.visible}
    >
      <CountdownConfirmContent {...props} />
    </Modal>
  );
}

function CountdownConfirmContent({
  confirmLabel,
  description,
  destructive = false,
  durationSeconds,
  isSubmitting,
  onCancel,
  onConfirm,
  title,
  visible,
}: CountdownConfirmProps) {
  const uiLanguage = useAppStore((state: { language: AppLanguage }) => state.language);
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);

  useEffect(() => {
    if (!visible) {
      setRemainingSeconds(durationSeconds);
      return;
    }

    setRemainingSeconds(durationSeconds);
    const interval = setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [durationSeconds, visible]);

  const isConfirmDisabled = remainingSeconds > 0 || isSubmitting;
  const actionLabel = remainingSeconds > 0 ? `${confirmLabel} (${remainingSeconds})` : confirmLabel;

  return (
    <Pressable onPress={isSubmitting ? undefined : onCancel} style={styles.countdownBackdrop}>
      <Pressable onPress={(event) => event.stopPropagation()} style={styles.countdownPanel}>
        <Text style={styles.countdownTitle}>{title}</Text>
        <Text style={styles.countdownDescription}>{description}</Text>
        <View style={styles.countdownActions}>
          <Pressable disabled={isSubmitting} onPress={onCancel} style={styles.countdownCancelButton}>
            <Text style={styles.countdownCancelText}>{t('cancel', {}, uiLanguage)}</Text>
          </Pressable>
          <Pressable
            disabled={isConfirmDisabled}
            onPress={onConfirm}
            style={[
              styles.countdownConfirmButton,
              destructive ? styles.countdownConfirmButtonDestructive : undefined,
              isConfirmDisabled ? styles.countdownConfirmButtonDisabled : undefined,
            ]}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.countdownConfirmText}>{actionLabel}</Text>
            )}
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

function GroupSettingRow({
  disabled,
  label,
  onValueChange,
  value,
}: {
  disabled: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <View style={styles.groupSettingRow}>
      <Text style={styles.groupSettingLabel}>{label}</Text>
      <Switch
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={value ? colors.white : colors.surface}
        trackColor={{ false: colors.border, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

function CompactToggle({
  disabled,
  onValueChange,
  value,
}: {
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  value: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.compactToggle,
        value ? styles.compactToggleEnabled : undefined,
        disabled ? styles.compactToggleDisabled : undefined,
      ]}
    >
      <View style={[styles.compactToggleThumb, value ? styles.compactToggleThumbEnabled : undefined]} />
    </Pressable>
  );
}

function MemberPagination({
  currentPage,
  language,
  onPageChange,
  totalPages,
}: {
  currentPage: number;
  language: AppLanguage;
  onPageChange: (page: number) => void;
  totalPages: number;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const items = getPaginationItems(currentPage, totalPages);

  return (
    <View style={styles.memberPagination}>
      <Pressable
        disabled={currentPage <= 1}
        onPress={() => onPageChange(Math.max(1, currentPage - 1))}
        style={[styles.memberPageButton, currentPage <= 1 ? styles.memberPageButtonDisabled : undefined]}
      >
        <Ionicons color={currentPage <= 1 ? colors.textSecondary : colors.primary} name="chevron-back" size={17} />
        <Text style={[styles.memberPageButtonText, currentPage <= 1 ? styles.memberPageButtonTextDisabled : undefined]}>{t('previousShort', {}, language)}</Text>
      </Pressable>
      <View style={styles.memberPageNumbers}>
        {items.map((item, index) => (
          item === 'ellipsis' ? (
            <Text key={`ellipsis-${index}`} style={styles.memberPageEllipsis}>...</Text>
          ) : (
            <Pressable
              key={item}
              onPress={() => onPageChange(item)}
              style={[styles.memberPageNumber, item === currentPage ? styles.memberPageNumberActive : undefined]}
            >
              <Text style={[styles.memberPageNumberText, item === currentPage ? styles.memberPageNumberTextActive : undefined]}>{item}</Text>
            </Pressable>
          )
        ))}
      </View>
      <Pressable
        disabled={currentPage >= totalPages}
        onPress={() => onPageChange(Math.min(totalPages, currentPage + 1))}
        style={[styles.memberPageButton, currentPage >= totalPages ? styles.memberPageButtonDisabled : undefined]}
      >
        <Text style={[styles.memberPageButtonText, currentPage >= totalPages ? styles.memberPageButtonTextDisabled : undefined]}>{t('nextShort', {}, language)}</Text>
        <Ionicons color={currentPage >= totalPages ? colors.textSecondary : colors.primary} name="chevron-forward" size={17} />
      </Pressable>
    </View>
  );
}

export async function ensureSaveToPhonePermission(message: Message) {
  if (Platform.OS === 'ios') {
    if (message.kind === 'file') {
      return true;
    }

    const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);
    return !!mediaPermission?.granted;
  }

  if (Platform.OS !== 'android') {
    return true;
  }

  const mediaPermission = await ImagePicker.requestMediaLibraryPermissionsAsync().catch(() => null);

  if (mediaPermission?.granted) {
    return true;
  }

  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    const permissions: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS][] = [];

    if (message.kind === 'image') {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    } else if (message.kind === 'video') {
      permissions.push(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO);
    } else {
      permissions.push(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
      );
    }

    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission as keyof typeof result] === PermissionsAndroid.RESULTS.GRANTED);
  }

  const legacyWritePermission = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;

  if (!legacyWritePermission) {
    return false;
  }

  const result = await PermissionsAndroid.request(legacyWritePermission);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function getShareableMediaUri(message: Message) {
  if (!message.mediaUri) {
    throw new Error(t('attachmentNotAvailableYet'));
  }

  if (Platform.OS === 'ios') {
    if (message.mediaUri.startsWith('file:')) {
      return await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;
    }

    if (/^https?:\/\//i.test(message.mediaUri)) {
      return downloadMediaActionAttachment(message);
    }

    return message.mediaUri;
  }

  if (Platform.OS !== 'android') {
    return message.mediaUri;
  }

  if (message.mediaUri.startsWith('file:')) {
    const resolvedLocalUri = await resolveLocalMediaFileUri(message.mediaUri, message.sizeBytes) ?? message.mediaUri;

    return FileSystem.getContentUriAsync(resolvedLocalUri);
  }

  if (message.mediaUri.startsWith('content:')) {
    return message.mediaUri;
  }

  if (/^https?:\/\//i.test(message.mediaUri)) {
    const localUri = await downloadMediaActionAttachment(message);

    return FileSystem.getContentUriAsync(localUri);
  }

  return message.mediaUri;
}

export function waitForIosModalDismissal() {
  return new Promise((resolve) => setTimeout(resolve, 220));
}

export async function downloadMediaActionAttachment(message: Message) {
  const localUri = await getMediaActionCacheUri(message);
  const remoteUri = getMessageRemoteMediaUri(message) ?? message.mediaUri;

  if (!remoteUri || !/^https?:\/\//i.test(remoteUri)) {
    throw new Error(t('mediaUnavailable'));
  }

  const cachedUri = await downloadRemoteMediaFile({
    expectedSizeBytes: message.sizeBytes,
    localUri,
    messageId: message.id,
    remoteUri,
  });

  if (!cachedUri) {
    throw new Error(t('mediaDownloadIncomplete'));
  }

  await useAppStore.getState().cacheDownloadedMessageMedia(
    message.conversationId,
    message.id,
    cachedUri,
    remoteUri,
  );

  return cachedUri;
}

async function getMediaActionCacheUri(message: Message) {
  return getMessageMediaCacheUri({
    fileName: getMessageFileName(message),
    kind: message.kind,
    messageId: message.id,
  });
}

function InfoAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.infoAction}>
      <View style={styles.infoActionIconWrap}>
        <Ionicons color={colors.primary} name={icon} size={24} />
      </View>
      <Text numberOfLines={2} style={styles.infoActionText}>{label}</Text>
    </Pressable>
  );
}
