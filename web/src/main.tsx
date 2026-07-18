import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import { io, Socket } from 'socket.io-client';
import { Ban, Bell, BellOff, BookUser, Camera, Check, CheckCheck, Contact, Copy, Download, Eye, File, Flag, Image, Link, LoaderCircle, Maximize2, MessageCircle, MessageCirclePlus, Mic, MicOff, Minimize2, MoreVertical, Paperclip, Pencil, Phone, PhoneCall, PhoneIncoming, PhoneOff, PhoneOutgoing, Pin, Plus, Reply, ScreenShare, Search, Send, Settings as SettingsIcon, Share2, Shield, Smile, Star, Trash2, Type, UserPlus, Users, Video, Volume2, VolumeX, X } from 'lucide-react';
import { Room, RoomEvent, Track, VideoPreset, VideoPresets, VideoQuality } from 'livekit-client';
import type { LocalTrack, LocalVideoTrack, RemoteTrack, RemoteTrackPublication, ScreenShareCaptureOptions, TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';

import './styles.css';
import outgoingRingbackUrl from './assets/ringing.mp3';
import ringtoneUrl from './assets/ringtone.wav';

const API_URL = import.meta.env.VITE_API_URL || 'https://meetvap.com';
const TOKEN_KEY = 'meetvap.web.token';
const INSTALLATION_ID_KEY = 'meetvap.web.installationId.v1';
const CALL_ANSWER_CLIENT_KEY = 'meetvap.web.callAnswerClientId';
const MEETING_GUEST_ID_KEY = 'meetvap.web.meetingGuestId';
const MESSAGE_CACHE_PREFIX = 'meetvap.web.messages.';
const MESSAGE_CACHE_LIMIT = 100;
const MEDIA_CACHE_DB_NAME = 'meetvap.web.media';
const MEDIA_CACHE_DB_VERSION = 2;
const MEDIA_CACHE_STORE_NAME = 'media';
const MEETVAP_CALL_STARTUP_DEBUG = false;
const WEB_CALL_REMOTE_STARTUP_SUBSCRIBE_MS = 20_000;
const WEB_CALL_REMOTE_STARTUP_SUBSCRIBE_INTERVAL_MS = 200;
const WEB_CALL_REMOTE_STARTUP_STALL_RESET_MS = 900;
const WEB_CALL_REMOTE_STARTUP_RESUBSCRIBE_DELAY_MS = 80;
const WEB_INSTALLATION_ID = getOrCreateWebInstallationId();

function getOrCreateWebInstallationId() {
  const existing = localStorage.getItem(INSTALLATION_ID_KEY)?.trim();

  if (existing && /^[A-Za-z0-9._-]{16,64}$/.test(existing)) {
    return existing;
  }

  const generated = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(INSTALLATION_ID_KEY, generated);
  return generated;
}
type WebCallNetworkProfile = 'normal' | 'degraded' | 'critical';
type WebCallRtcStatsPrevious = {
  packetsLost?: number;
  packetsReceived?: number;
  timestamp?: number;
};
const WEB_CALL_VIDEO_CAPTURE_OPTIONS: VideoCaptureOptions = {
  facingMode: 'user',
  frameRate: 15,
  resolution: {
    frameRate: 15,
    height: 360,
    width: 640,
  },
};

function logWebCallStartup(event: string, details?: Record<string, unknown>) {
  if (!MEETVAP_CALL_STARTUP_DEBUG) {
    return;
  }

  console.info('meetvap-web-call-startup', {
    ...details,
    event,
    timestamp: new Date().toISOString(),
  });
}
const WEB_CALL_VIDEO_PUBLISH_OPTIONS: TrackPublishOptions = {
  degradationPreference: 'maintain-framerate',
  simulcast: true,
  source: Track.Source.Camera,
  videoEncoding: { maxBitrate: 360_000, maxFramerate: 15 },
  videoSimulcastLayers: [VideoPresets.h90, new VideoPreset(320, 180, 130_000, 12)],
};
const WEB_CALL_SCREEN_SHARE_CAPTURE_OPTIONS: ScreenShareCaptureOptions = {
  audio: false,
  resolution: {
    frameRate: 15,
    height: 720,
    width: 1280,
  },
  selfBrowserSurface: 'include',
  surfaceSwitching: 'include',
  systemAudio: 'exclude',
  video: true,
};
const WEB_CALL_SCREEN_SHARE_PUBLISH_OPTIONS: TrackPublishOptions = {
  degradationPreference: 'maintain-resolution',
  simulcast: false,
  source: Track.Source.ScreenShare,
  videoEncoding: VideoPresets.h720.encoding,
};
const WEB_CALL_STATS_SAMPLE_INTERVAL_MS = 3_000;
const WEB_CALL_STATS_DEGRADE_BAD_SAMPLE_COUNT = 1;
const WEB_CALL_STATS_CRITICAL_BAD_SAMPLE_COUNT = 2;
const WEB_CALL_PROFILE_RECOVERY_STABLE_MS = 8_000;
const WEB_CALL_PROFILE_SWITCH_MIN_INTERVAL_MS = 8_000;
const WEB_CALL_DEGRADED_LOSS_RATIO = 0.04;
const WEB_CALL_CRITICAL_LOSS_RATIO = 0.10;
const WEB_CALL_DEGRADED_RTT_MS = 450;
const WEB_CALL_CRITICAL_RTT_MS = 900;
const WEB_CALL_DEGRADED_JITTER_SECONDS = 0.04;
const WEB_CALL_CRITICAL_JITTER_SECONDS = 0.10;
const WEB_CALL_DEGRADED_AVAILABLE_BITRATE_BPS = 220_000;
const WEB_CALL_CRITICAL_AVAILABLE_BITRATE_BPS = 110_000;
const MESSAGE_CACHE_STORE_NAME = 'messages';
const DEFAULT_WEB_MEDIA_CACHE_CONFIG = {
  maxSingleMediaBytes: 500 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024 * 1024,
};
const WEB_LANGUAGE_KEY = 'meetvap.web.language';
const EMOJI_GROUPS = [
  { key: 'smileys', label: 'Smileys', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😍', '😘', '😋', '😎', '🤩', '🥳', '😏', '😢', '😭', '😤', '😡', '🤔', '🤗', '🤫', '😴', '😱', '🥰'] },
  { key: 'people', label: 'People', emojis: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🫶', '🙏', '💪', '👋', '🤝', '👀', '🧠', '👑', '💃', '🕺', '🏃', '🚶', '👨‍💻', '👩‍💻', '🧑‍🚀'] },
  { key: 'symbols', label: 'Symbols', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❣️', '💕', '💞', '💯', '💢', '💥', '💫', '💦', '💨', '✅', '❌', '⚠️', '🔥', '⭐', '✨', '🎉', '🎁'] },
  { key: 'food', label: 'Food', emojis: ['🍏', '🍎', '🍌', '🍉', '🍇', '🍓', '🍒', '🥝', '🍅', '🥑', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🍜', '🍣', '🍰', '🍫', '🍿', '☕', '🍵', '🥤'] },
  { key: 'travel', label: 'Travel', emojis: ['🚗', '🚕', '🚌', '🏎️', '🚓', '🚑', '🚒', '🚚', '🚲', '✈️', '🚀', '🚁', '🚢', '🏠', '🏢', '🏝️', '⛰️', '🌍', '🌙', '☀️', '🌧️', '❄️'] },
] as const;
type Language = 'en' | 'tr' | 'ru';

const translations = {
  en: {
    answer: 'Answer',
    attachmentFailed: 'Could not send attachment',
    admin: 'Admin',
    addCaption: 'Add caption',
    camera: 'Camera',
    cancel: 'Cancel',
    calls: 'Calls',
    callConnecting: 'Connecting',
    callDialing: 'Calling',
    callRinging: 'Ringing',
    changePicture: 'Change picture',
    chats: 'Chats',
    chooseContact: 'Choose contact to share',
    contact: 'Contact',
    contactOptions: 'Contact options',
    copy: 'Copy',
    deleteContact: 'Delete contact',
    contactsEmpty: 'No contacts to share.',
    contacts: 'Contacts',
    contactsOnly: 'Contacts',
    contactsExcept: 'Contacts except',
    delete: 'Delete',
    deleteForEveryone: 'Delete for everyone',
    deleteForMe: 'Delete for me',
    decline: 'Decline',
    delivered: 'Delivered',
    end: 'End',
    file: 'File',
    download: 'Download',
    save: 'Save',
    done: 'Done',
    edit: 'Edit',
    forward: 'Forward',
    gallery: 'Photo/video - Gallery',
    incomingCall: 'Incoming call',
    incoming: 'Incoming',
    online: 'Online',
    loading: 'Loading...',
    logout: 'Logout',
    maximize: 'Maximize',
    message: 'Message',
    messageOptions: 'Message options',
    microphone: 'Microphone',
    recordVoice: 'Record voice',
    read: 'Read',
    pin: 'Pin',
    reply: 'Reply',
    report: 'Report',
    removePicture: 'Remove picture',
    restore: 'Restore',
    searchContacts: 'Search contacts',
    searchDirectory: 'Search MeetVap directory',
    share: 'Share',
    shareContact: 'Share contact',
    shareLink: 'Share link',
    copyLink: 'Copy link',
    searchPeople: 'Search by username or name',
    send: 'Send',
    sendAttachment: 'Send attachment',
    sending: 'Sending...',
    sent: 'Sent',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    displayName: 'Display name',
    nickname: 'Nickname',
    hideNickname: 'Hide my nickname',
    hideMembers: 'Hide members',
    createMeetLink: 'Create meet link',
    createMeetLinkDescription: 'Choose which meeting type you want to create.',
    createMeetLinkFailed: 'Could not create meet link',
    showLastSeen: 'Show last seen',
    showInSearch: 'Show me in search',
    language: 'Language',
    english: 'English',
    turkish: 'Turkish',
    russian: 'Russian',
    useGroupAliases: 'Use different name in groups',
    groupDetails: 'Group details',
    groupMembers: 'Group members',
    memberCount: 'Member count',
    members: 'members',
    muteChat: 'Mute chat',
    muteGroup: 'Mute group',
    ownerOnlyMessages: 'Only admins can send messages',
    reportUser: 'Report user',
    blockUser: 'Block user',
    unblockUser: 'Unblock user',
    deleteChat: 'Delete chat',
    unmuteChat: 'Unmute chat',
    unmuteGroup: 'Unmute group',
    addContact: 'Add contact',
    newChat: 'New chat',
    newStatuses: 'Recent updates',
    noStatusesYet: 'No status updates',
    noStatusViewsYet: 'No views yet',
    noCallsYet: 'No calls yet',
    noContactsYet: 'No contacts yet',
    notInContacts: 'not in contacts',
    outgoing: 'Outgoing',
    owner: 'Owner',
    pinnedMessage: 'Pinned message',
    pinnedMessages: 'Pinned messages',
    noPinnedMessages: 'No pinned messages',
    searchPinnedMessages: 'Search pinned messages',
    today: 'Today',
    yesterday: 'Yesterday',
    mute: 'Mute',
    unmute: 'Unmute',
    unpin: 'Unpin',
    addToContacts: 'Add to contacts',
    block: 'Block',
    unblock: 'Unblock',
    chatOptions: 'Chat options',
    startVideoCall: 'Start video call?',
    startVoiceCall: 'Start voice call?',
    videoCall: 'Video call',
    videoMeet: 'Video meeting',
    videoMeetDescription: 'Create a public video meeting link.',
    voiceCall: 'Voice call',
    voiceMeet: 'Voice meeting',
    voiceMeetDescription: 'Create a public voice meeting link.',
    joinMeet: 'Join meeting',
    meetingEnded: 'Meeting ended',
    meetingJoinFailed: 'Could not join meeting',
    meetingNotFound: 'Meeting not found',
    meetingOpenFailed: 'Could not open meeting',
    meetingRemaining: '{time} remaining',
    meetingNamePlaceholder: 'Your name',
    meetingSummaryTitle: 'Meeting ended',
    meetingSummaryBody: 'Thank you for using MeetVap Meet.',
    meetingSummarySpent: 'Time spent',
    meetingSummaryAvailable: 'Available time',
    meetingSummaryReset: 'Next reset',
    voiceMessage: 'Voice message',
    voiceRoomConnected: 'Voice room connected',
    voiceRoomConnecting: 'Connecting voice room...',
    shareScreen: 'Share screen',
    stopSharing: 'Stop sharing',
    settings: 'Settings',
    shareStatus: 'Share status',
    statusAudience: 'Audience',
    statusAudienceExceptCount: 'Except {count}',
    statusAudienceOnlyCount: 'Only {count}',
    statusAudienceOnlySelected: 'Only selected',
    statusReply: 'Reply to status',
    statusReplySent: 'Reply sent',
    statuses: 'Stories',
    statusOptions: 'Story options',
    statusViews: '{count} views',
    textStatus: 'Text story',
    typeStatus: 'Type a story',
    viewedStatuses: 'Viewed updates',
    waitingForScan: 'Waiting for scan...',
    webPairingHelp: 'Open MeetVap on your phone, go to Devices, then scan this QR code.',
  },
  tr: {
    answer: 'Yanıtla',
    attachmentFailed: 'Ek gönderilemedi',
    admin: 'Admin',
    addCaption: 'Açıklama ekle',
    camera: 'Kamera',
    cancel: 'İptal',
    calls: 'Aramalar',
    callConnecting: 'Bağlanıyor',
    callDialing: 'Aranıyor',
    callRinging: 'Çalıyor',
    changePicture: 'Resmi değiştir',
    chats: 'Sohbetler',
    chooseContact: 'Paylaşılacak kişiyi seç',
    contact: 'Kişi',
    contactOptions: 'Kişi seçenekleri',
    copy: 'Kopyala',
    deleteContact: 'Kişiyi sil',
    contactsEmpty: 'Paylaşılacak kişi yok.',
    contacts: 'Kişiler',
    contactsOnly: 'Kişiler',
    contactsExcept: 'Kişiler hariç',
    delete: 'Sil',
    deleteForEveryone: 'Herkes için sil',
    deleteForMe: 'Benim için sil',
    decline: 'Reddet',
    delivered: 'Teslim edildi',
    end: 'Bitir',
    file: 'Dosya',
    download: 'İndir',
    save: 'Kaydet',
    done: 'Tamam',
    edit: 'Düzenle',
    forward: 'İlet',
    gallery: 'Fotoğraf/video - Galeri',
    incomingCall: 'Gelen arama',
    incoming: 'Gelen',
    online: 'Çevrimiçi',
    loading: 'Yükleniyor...',
    logout: 'Çıkış',
    maximize: 'Büyüt',
    message: 'Mesaj',
    messageOptions: 'Mesaj seçenekleri',
    microphone: 'Mikrofon',
    recordVoice: 'Ses kaydet',
    read: 'Okundu',
    pin: 'Sabitle',
    reply: 'Yanıtla',
    report: 'Bildir',
    removePicture: 'Resmi kaldır',
    restore: 'Eski boyut',
    searchContacts: 'Kişilerde ara',
    searchDirectory: 'MeetVap dizininde ara',
    share: 'Paylaş',
    shareContact: 'Kişiyi paylaş',
    shareLink: 'Bağlantıyı paylaş',
    copyLink: 'Bağlantıyı kopyala',
    searchPeople: 'Rumuz veya ada göre ara',
    send: 'Gönder',
    sendAttachment: 'Ek gönder',
    sending: 'Gönderiliyor...',
    sent: 'Gönderildi',
    zoomIn: 'Yakınlaştır',
    zoomOut: 'Uzaklaştır',
    displayName: 'Görünen ad',
    nickname: 'Rumuz',
    hideNickname: 'Rumuzumu gizle',
    hideMembers: 'Üyeleri gizle',
    createMeetLink: 'Meet bağlantısı oluştur',
    createMeetLinkDescription: 'Oluşturmak istediğin toplantı türünü seç.',
    createMeetLinkFailed: 'Meet bağlantısı oluşturulamadı',
    showLastSeen: 'Son görülmeyi göster',
    showInSearch: 'Aramada göster',
    language: 'Dil',
    english: 'İngilizce',
    turkish: 'Türkçe',
    russian: 'Rusça',
    useGroupAliases: 'Gruplarda farklı ad kullan',
    groupDetails: 'Grup detayları',
    groupMembers: 'Grup üyeleri',
    memberCount: 'Üye sayısı',
    members: 'üye',
    muteChat: 'Sohbeti sessize al',
    muteGroup: 'Grubu sessize al',
    ownerOnlyMessages: 'Sadece adminler mesaj gönderebilir',
    reportUser: 'Kullanıcıyı bildir',
    blockUser: 'Kullanıcıyı engelle',
    unblockUser: 'Kullanıcı engelini kaldır',
    deleteChat: 'Sohbeti sil',
    unmuteChat: 'Sohbet sesini aç',
    unmuteGroup: 'Grup sesini aç',
    addContact: 'Kişi ekle',
    newChat: 'Yeni sohbet',
    newStatuses: 'Yeni durumlar',
    noStatusesYet: 'Henüz durum yok',
    noStatusViewsYet: 'Henüz görüntüleme yok',
    noCallsYet: 'Henüz arama yok',
    noContactsYet: 'Henüz kişi yok',
    notInContacts: 'kişilerde değil',
    outgoing: 'Giden',
    owner: 'Sahip',
    pinnedMessage: 'Sabit mesaj',
    pinnedMessages: 'Sabit mesajlar',
    noPinnedMessages: 'Sabit mesaj yok',
    searchPinnedMessages: 'Sabit mesajlarda ara',
    today: 'Bugün',
    yesterday: 'Dün',
    mute: 'Sessize al',
    unmute: 'Sesi aç',
    unpin: 'Sabitlemeyi kaldır',
    addToContacts: 'Kişilere ekle',
    block: 'Engelle',
    unblock: 'Engeli kaldır',
    chatOptions: 'Sohbet seçenekleri',
    startVideoCall: 'Video araması başlatılsın mı?',
    startVoiceCall: 'Sesli arama başlatılsın mı?',
    videoCall: 'Video araması',
    videoMeet: 'Video toplantı',
    videoMeetDescription: 'Bağlantıyla katılınabilen video toplantısı oluştur.',
    voiceCall: 'Sesli arama',
    voiceMeet: 'Sesli toplantı',
    voiceMeetDescription: 'Bağlantıyla katılınabilen sesli toplantı oluştur.',
    joinMeet: 'Toplantıya katıl',
    meetingEnded: 'Toplantı sona erdi',
    meetingJoinFailed: 'Toplantıya katılınamadı',
    meetingNotFound: 'Toplantı bulunamadı',
    meetingOpenFailed: 'Toplantı açılamadı',
    meetingRemaining: '{time} kaldı',
    meetingNamePlaceholder: 'Adın',
    meetingSummaryTitle: 'Toplantı sona erdi',
    meetingSummaryBody: 'MeetVap Meet kullandığın için teşekkür ederiz.',
    meetingSummarySpent: 'Kullanılan süre',
    meetingSummaryAvailable: 'Kalan süre',
    meetingSummaryReset: 'Sonraki sıfırlama',
    voiceMessage: 'Sesli mesaj',
    voiceRoomConnected: 'Ses odası bağlı',
    voiceRoomConnecting: 'Ses odasına bağlanılıyor...',
    shareScreen: 'Ekranı paylaş',
    stopSharing: 'Paylaşımı durdur',
    settings: 'Ayarlar',
    shareStatus: 'Durum paylaş',
    statusAudience: 'Gizlilik',
    statusAudienceExceptCount: 'Hariç {count}',
    statusAudienceOnlyCount: 'Sadece {count}',
    statusAudienceOnlySelected: 'Sadece seçilenler',
    statusReply: 'Duruma yanıt ver',
    statusReplySent: 'Yanıt gönderildi',
    statuses: 'Durumlar',
    statusOptions: 'Durum seçenekleri',
    statusViews: '{count} görüntüleme',
    textStatus: 'Yazılı durum',
    typeStatus: 'Durum yaz',
    viewedStatuses: 'Görülen durumlar',
    waitingForScan: 'Tarama bekleniyor...',
    webPairingHelp: 'Telefonunda MeetVap uygulamasını aç, Cihazlar bölümüne git ve bu QR kodunu tara.',
  },
  ru: {
    answer: 'Ответить',
    attachmentFailed: 'Не удалось отправить вложение',
    admin: 'Админ',
    addCaption: 'Добавить подпись',
    camera: 'Камера',
    cancel: 'Отмена',
    calls: 'Звонки',
    callConnecting: 'Подключение',
    callDialing: 'Вызов',
    callRinging: 'Звонит',
    changePicture: 'Изменить фото',
    chats: 'Чаты',
    chooseContact: 'Выберите контакт для отправки',
    contact: 'Контакт',
    contactOptions: 'Действия с контактом',
    copy: 'Копировать',
    deleteContact: 'Удалить контакт',
    contactsEmpty: 'Нет контактов для отправки.',
    contacts: 'Контакты',
    contactsOnly: 'Контакты',
    contactsExcept: 'Контакты кроме',
    delete: 'Удалить',
    deleteForEveryone: 'Удалить у всех',
    deleteForMe: 'Удалить у меня',
    decline: 'Отклонить',
    delivered: 'Доставлено',
    end: 'Завершить',
    file: 'Файл',
    download: 'Скачать',
    save: 'Сохранить',
    done: 'Готово',
    edit: 'Изменить',
    forward: 'Переслать',
    gallery: 'Фото/видео - Галерея',
    incomingCall: 'Входящий звонок',
    incoming: 'Входящий',
    online: 'Онлайн',
    loading: 'Загрузка...',
    logout: 'Выйти',
    maximize: 'Развернуть',
    message: 'Сообщение',
    messageOptions: 'Действия с сообщением',
    microphone: 'Микрофон',
    recordVoice: 'Записать голос',
    read: 'Прочитано',
    pin: 'Закрепить',
    reply: 'Ответить',
    report: 'Пожаловаться',
    removePicture: 'Удалить фото',
    restore: 'Восстановить',
    searchContacts: 'Поиск контактов',
    searchDirectory: 'Поиск в каталоге MeetVap',
    share: 'Поделиться',
    shareContact: 'Поделиться контактом',
    shareLink: 'Поделиться ссылкой',
    copyLink: 'Копировать ссылку',
    searchPeople: 'Поиск по имени или логину',
    send: 'Отправить',
    sendAttachment: 'Отправить вложение',
    sending: 'Отправка...',
    sent: 'Отправлено',
    zoomIn: 'Увеличить',
    zoomOut: 'Уменьшить',
    displayName: 'Отображаемое имя',
    nickname: 'Никнейм',
    hideNickname: 'Скрыть мой никнейм',
    hideMembers: 'Скрыть участников',
    createMeetLink: 'Создать ссылку Meet',
    createMeetLinkDescription: 'Выберите тип встречи.',
    createMeetLinkFailed: 'Не удалось создать ссылку Meet',
    showLastSeen: 'Показывать последний визит',
    showInSearch: 'Показывать в поиске',
    language: 'Язык',
    english: 'Английский',
    turkish: 'Турецкий',
    russian: 'Русский',
    useGroupAliases: 'Использовать другое имя в группах',
    groupDetails: 'Информация о группе',
    groupMembers: 'Участники группы',
    memberCount: 'Количество участников',
    members: 'участников',
    muteChat: 'Отключить уведомления чата',
    muteGroup: 'Отключить уведомления группы',
    ownerOnlyMessages: 'Писать могут только админы',
    reportUser: 'Пожаловаться на пользователя',
    blockUser: 'Заблокировать пользователя',
    unblockUser: 'Разблокировать пользователя',
    deleteChat: 'Удалить чат',
    unmuteChat: 'Включить уведомления чата',
    unmuteGroup: 'Включить уведомления группы',
    addContact: 'Добавить контакт',
    newChat: 'Новый чат',
    newStatuses: 'Новые статусы',
    noStatusesYet: 'Статусов пока нет',
    noStatusViewsYet: 'Просмотров пока нет',
    noCallsYet: 'Звонков пока нет',
    noContactsYet: 'Контактов пока нет',
    notInContacts: 'не в контактах',
    outgoing: 'Исходящий',
    owner: 'Владелец',
    pinnedMessage: 'Закрепленное сообщение',
    pinnedMessages: 'Закрепленные сообщения',
    noPinnedMessages: 'Нет закрепленных сообщений',
    searchPinnedMessages: 'Поиск закрепленных сообщений',
    today: 'Сегодня',
    yesterday: 'Вчера',
    mute: 'Отключить уведомления',
    unmute: 'Включить уведомления',
    unpin: 'Открепить',
    addToContacts: 'Добавить в контакты',
    block: 'Заблокировать',
    unblock: 'Разблокировать',
    chatOptions: 'Действия с чатом',
    startVideoCall: 'Начать видеозвонок?',
    startVoiceCall: 'Начать голосовой звонок?',
    videoCall: 'Видеозвонок',
    videoMeet: 'Видеовстреча',
    videoMeetDescription: 'Создать публичную ссылку на видеовстречу.',
    voiceCall: 'Голосовой звонок',
    voiceMeet: 'Голосовая встреча',
    voiceMeetDescription: 'Создать публичную ссылку на голосовую встречу.',
    joinMeet: 'Присоединиться',
    meetingEnded: 'Встреча завершена',
    meetingJoinFailed: 'Не удалось присоединиться',
    meetingNotFound: 'Встреча не найдена',
    meetingOpenFailed: 'Не удалось открыть встречу',
    meetingRemaining: 'Осталось {time}',
    meetingNamePlaceholder: 'Ваше имя',
    meetingSummaryTitle: 'Встреча завершена',
    meetingSummaryBody: 'Спасибо за использование MeetVap Meet.',
    meetingSummarySpent: 'Потрачено времени',
    meetingSummaryAvailable: 'Доступно времени',
    meetingSummaryReset: 'Следующий сброс',
    voiceMessage: 'Голосовое сообщение',
    voiceRoomConnected: 'Голосовая комната подключена',
    voiceRoomConnecting: 'Подключение голосовой комнаты...',
    shareScreen: 'Поделиться экраном',
    stopSharing: 'Остановить показ',
    settings: 'Настройки',
    shareStatus: 'Опубликовать статус',
    statusAudience: 'Аудитория',
    statusAudienceExceptCount: 'Кроме {count}',
    statusAudienceOnlyCount: 'Только {count}',
    statusAudienceOnlySelected: 'Только выбранные',
    statusReply: 'Ответить на статус',
    statusReplySent: 'Ответ отправлен',
    statuses: 'Статусы',
    statusOptions: 'Действия со статусом',
    statusViews: '{count} просмотров',
    textStatus: 'Текстовый статус',
    typeStatus: 'Напишите статус',
    viewedStatuses: 'Просмотренные статусы',
    waitingForScan: 'Ожидание сканирования...',
    webPairingHelp: 'Откройте MeetVap на телефоне, перейдите в раздел «Устройства» и отсканируйте этот QR-код.',
  },
} as const;

type TranslationKey = keyof typeof translations.en;

function getBrowserLanguage(): Language {
  const language = navigator.language.toLowerCase();

  return language.startsWith('tr') ? 'tr' : language.startsWith('ru') ? 'ru' : 'en';
}

function getStoredWebLanguage(): Language | null {
  const language = localStorage.getItem(WEB_LANGUAGE_KEY);

  return language === 'en' || language === 'tr' || language === 'ru' ? language : null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getWebCallVideoCaptureOptions(): VideoCaptureOptions {
  return WEB_CALL_VIDEO_CAPTURE_OPTIONS;
}

function getWebCallVideoPublishOptions(): TrackPublishOptions {
  return WEB_CALL_VIDEO_PUBLISH_OPTIONS;
}

function getWebCallPublishingQuality(profile: WebCallNetworkProfile) {
  if (profile === 'critical') {
    return VideoQuality.LOW;
  }

  if (profile === 'degraded') {
    return VideoQuality.MEDIUM;
  }

  return VideoQuality.HIGH;
}

function applyWebCallRemoteVideoQuality(
  publication: RemoteTrackPublication,
  profile: WebCallNetworkProfile,
  isStartup = false,
) {
  const quality = isStartup ? VideoQuality.LOW : getWebCallPublishingQuality(profile);
  publication.setVideoQuality(quality);

  if (publication.track) {
    publication.setVideoFPS(profile === 'critical' ? 8 : profile === 'degraded' ? 12 : 15);
  }
}

function getWebCallProfileRank(profile: WebCallNetworkProfile) {
  switch (profile) {
    case 'critical':
      return 2;
    case 'degraded':
      return 1;
    default:
      return 0;
  }
}

function getStatsNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getRtcStatsEntries(report: RTCStatsReport | undefined) {
  const entries: Array<Record<string, unknown>> = [];
  const maybeReport = report as unknown as {
    forEach?: (callback: (value: Record<string, unknown>) => void) => void;
    values?: () => Iterable<Record<string, unknown>>;
  };

  if (typeof maybeReport?.forEach === 'function') {
    maybeReport.forEach((value) => entries.push(value));
    return entries;
  }

  if (typeof maybeReport?.values === 'function') {
    return Array.from(maybeReport.values());
  }

  return entries;
}

async function collectWebCallRtcStatsSnapshot(
  room: Room,
  previousStatsByIdRef: React.MutableRefObject<Map<string, WebCallRtcStatsPrevious>>,
) {
  const pcManager = (room as unknown as {
    engine?: {
      pcManager?: {
        publisher?: { getStats?: () => Promise<RTCStatsReport> };
        subscriber?: { getStats?: () => Promise<RTCStatsReport> };
      };
    };
  }).engine?.pcManager;
  const transports = [pcManager?.publisher, pcManager?.subscriber].filter(
    (transport): transport is { getStats: () => Promise<RTCStatsReport> } => typeof transport?.getStats === 'function',
  );
  const snapshot: {
    availableOutgoingBitrate?: number;
    inboundJitterSeconds?: number;
    inboundPacketLossRatio?: number;
    outboundBandwidthLimited?: boolean;
    remoteInboundPacketLossRatio?: number;
    remoteInboundRttMs?: number;
  } = {};

  for (const [transportIndex, transport] of transports.entries()) {
    let report: RTCStatsReport | undefined;

    try {
      report = await transport.getStats();
    } catch {
      continue;
    }

    getRtcStatsEntries(report).forEach((stats) => {
      const id = typeof stats.id === 'string' ? stats.id : undefined;
      const type = typeof stats.type === 'string' ? stats.type : undefined;
      const kind = stats.kind ?? stats.mediaType;
      const isVideo = kind === 'video';
      const timestamp = getStatsNumber(stats.timestamp);

      if (!type) {
        return;
      }

      if (type === 'candidate-pair' && stats.state === 'succeeded' && stats.nominated !== false) {
        const availableOutgoingBitrate = getStatsNumber(stats.availableOutgoingBitrate);
        const currentRoundTripTime = getStatsNumber(stats.currentRoundTripTime);

        if (availableOutgoingBitrate !== undefined) {
          snapshot.availableOutgoingBitrate = snapshot.availableOutgoingBitrate === undefined
            ? availableOutgoingBitrate
            : Math.min(snapshot.availableOutgoingBitrate, availableOutgoingBitrate);
        }

        if (currentRoundTripTime !== undefined) {
          snapshot.remoteInboundRttMs = Math.max(snapshot.remoteInboundRttMs ?? 0, currentRoundTripTime * 1000);
        }
        return;
      }

      if (type === 'outbound-rtp' && isVideo) {
        snapshot.outboundBandwidthLimited ||= stats.qualityLimitationReason === 'bandwidth';
        return;
      }

      if ((type === 'remote-inbound-rtp' || type === 'inbound-rtp') && isVideo) {
        if (!id || !timestamp) {
          return;
        }

        const key = `${transportIndex}:${id}`;
        const previous = previousStatsByIdRef.current.get(key);
        const packetsLost = getStatsNumber(stats.packetsLost);
        const packetsReceived = getStatsNumber(stats.packetsReceived);
        let intervalLossRatio: number | undefined;

        if (
          previous?.timestamp && timestamp > previous.timestamp &&
          packetsLost !== undefined && previous.packetsLost !== undefined &&
          packetsReceived !== undefined && previous.packetsReceived !== undefined
        ) {
          const lostDelta = Math.max(0, packetsLost - previous.packetsLost);
          const receivedDelta = Math.max(0, packetsReceived - previous.packetsReceived);
          const packetDelta = lostDelta + receivedDelta;

          if (packetDelta > 0) {
            intervalLossRatio = lostDelta / packetDelta;
          }
        }

        previousStatsByIdRef.current.set(key, { packetsLost, packetsReceived, timestamp });

        if (type === 'remote-inbound-rtp') {
          const roundTripTime = getStatsNumber(stats.roundTripTime);
          const fractionLost = getStatsNumber(stats.fractionLost);

          if (roundTripTime !== undefined) {
            snapshot.remoteInboundRttMs = Math.max(snapshot.remoteInboundRttMs ?? 0, roundTripTime * 1000);
          }

          const lossRatio = intervalLossRatio ?? fractionLost;
          if (lossRatio !== undefined) {
            snapshot.remoteInboundPacketLossRatio = Math.max(snapshot.remoteInboundPacketLossRatio ?? 0, lossRatio);
          }
          return;
        }

        const jitter = getStatsNumber(stats.jitter);

        if (jitter !== undefined) {
          snapshot.inboundJitterSeconds = Math.max(snapshot.inboundJitterSeconds ?? 0, jitter);
        }

        if (intervalLossRatio !== undefined) {
          snapshot.inboundPacketLossRatio = Math.max(
            snapshot.inboundPacketLossRatio ?? 0,
            intervalLossRatio,
          );
        }
      }
    });
  }

  return snapshot;
}

function getWebCallUplinkProfileFromRtcStats(snapshot: Awaited<ReturnType<typeof collectWebCallRtcStatsSnapshot>>): WebCallNetworkProfile {
  const lossRatio = snapshot.remoteInboundPacketLossRatio ?? 0;
  const rttMs = snapshot.remoteInboundRttMs ?? 0;
  const availableBitrate = snapshot.availableOutgoingBitrate;

  if (
    lossRatio >= WEB_CALL_CRITICAL_LOSS_RATIO ||
    rttMs >= WEB_CALL_CRITICAL_RTT_MS ||
    (availableBitrate !== undefined && availableBitrate <= WEB_CALL_CRITICAL_AVAILABLE_BITRATE_BPS)
  ) {
    return 'critical';
  }

  if (
    lossRatio >= WEB_CALL_DEGRADED_LOSS_RATIO ||
    rttMs >= WEB_CALL_DEGRADED_RTT_MS ||
    snapshot.outboundBandwidthLimited === true ||
    (availableBitrate !== undefined && availableBitrate <= WEB_CALL_DEGRADED_AVAILABLE_BITRATE_BPS)
  ) {
    return 'degraded';
  }

  return 'normal';
}

function getWebCallDownlinkProfileFromRtcStats(snapshot: Awaited<ReturnType<typeof collectWebCallRtcStatsSnapshot>>): WebCallNetworkProfile {
  const lossRatio = snapshot.inboundPacketLossRatio ?? 0;
  const jitterSeconds = snapshot.inboundJitterSeconds ?? 0;

  if (lossRatio >= WEB_CALL_CRITICAL_LOSS_RATIO || jitterSeconds >= WEB_CALL_CRITICAL_JITTER_SECONDS) {
    return 'critical';
  }

  if (lossRatio >= WEB_CALL_DEGRADED_LOSS_RATIO || jitterSeconds >= WEB_CALL_DEGRADED_JITTER_SECONDS) {
    return 'degraded';
  }

  return 'normal';
}

function normalizeWebMediaCacheConfig(input: unknown): WebMediaCacheConfig {
  if (!input || typeof input !== 'object') {
    return DEFAULT_WEB_MEDIA_CACHE_CONFIG;
  }

  const source = input as Partial<WebMediaCacheConfig>;
  const maxSingleMediaBytes = Number(source.maxSingleMediaBytes);
  const maxTotalBytes = Number(source.maxTotalBytes);

  return {
    maxSingleMediaBytes: Number.isFinite(maxSingleMediaBytes) && maxSingleMediaBytes > 0
      ? maxSingleMediaBytes
      : DEFAULT_WEB_MEDIA_CACHE_CONFIG.maxSingleMediaBytes,
    maxTotalBytes: Number.isFinite(maxTotalBytes) && maxTotalBytes > 0
      ? maxTotalBytes
      : DEFAULT_WEB_MEDIA_CACHE_CONFIG.maxTotalBytes,
  };
}

function buildRequestSignature(values: string[]) {
  return [...new Set(values)].sort().join(',');
}

function isPageActivelyViewed() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

type AuthUser = {
  avatarUrl?: string | null;
  displayName: string;
  hasPremiumAccess?: boolean;
  hideFromSearch?: boolean;
  hideNickname?: boolean;
  id: string;
  isOnline?: boolean;
  isSystem?: boolean;
  lastSeenAt?: string | null;
  publicShareCode?: string | null;
  showLastSeen?: boolean;
  useGroupAliases?: boolean;
  username: string;
};

type Conversation = {
  adminIds?: string[];
  avatarUrl?: string | null;
  hideMembers?: boolean;
  id: string;
  isPublic?: boolean;
  isVoiceRoom?: boolean;
  isContact?: boolean;
  lastMessageId?: string;
  isMuted?: boolean;
  isSystem?: boolean;
  lastMessage?: string;
  lastMessageAt?: string;
  lastMessageKind?: Message['kind'];
  lastMessageSenderId?: string;
  lastMessageStatus?: Message['status'];
  memberCount?: number;
  members?: AuthUser[];
  myGroupAliasName?: string | null;
  otherUserId?: string | null;
  ownerId?: string | null;
  ownerOnlyMessages?: boolean;
  showAdmins?: boolean;
  showMemberCount?: boolean;
  title: string;
  type?: 'DIRECT' | 'GROUP';
  unreadCount?: number;
};

type Message = {
  body: string;
  conversationId: string;
  createdAt: string;
  id: string;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO' | 'FILE' | 'VOICE' | 'CALL';
  media?: {
    durationSec?: number | null;
    id?: string | null;
    mimeType: string;
    originalName: string;
    sizeBytes?: number;
    storageKey: string;
  } | null;
  mediaId?: string | null;
  metadata?: {
    callDirection?: 'INCOMING' | 'OUTGOING';
    callId?: string;
    callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED' | 'RINGING';
    durationSeconds?: number;
    mode?: 'VOICE' | 'VIDEO';
  } | Record<string, unknown>;
  sender?: AuthUser;
  senderId: string;
  status: 'SENDING' | 'SENT' | 'DELIVERED' | 'READ';
};

type CallLog = {
  conversationId: string;
  direction: 'incoming' | 'outgoing';
  happenedAt: string;
  id: string;
  mode: 'voice' | 'video';
  status?: 'answered' | 'cancelled' | 'declined' | 'missed';
  title: string;
};

type StatusAudience = 'CONTACTS' | 'CONTACTS_EXCEPT' | 'ONLY_SHARE_WITH';

type StatusUpdate = {
  audience: StatusAudience;
  authorId: string;
  backgroundColor?: string | null;
  body: string;
  createdAt: string;
  expiresAt: string;
  id: string;
  kind: 'TEXT' | 'IMAGE' | 'VIDEO';
  media?: {
    durationSec?: number | null;
    id: string;
    mimeType: string;
    originalName: string;
    sizeBytes?: number;
  } | null;
  mediaId?: string | null;
  mediaUri?: string;
  viewedByMe: boolean;
  viewerCount?: number;
};

type StatusGroup = {
  author: AuthUser;
  hasUnviewed: boolean;
  latestAt: string;
  statuses: StatusUpdate[];
};

type StatusViewer = {
  user: AuthUser;
  viewedAt: string;
};

type PanelTab = 'calls' | 'chats' | 'contacts' | 'settings' | 'statuses';

type PendingCaptionAttachment = {
  file: globalThis.File;
  kind: 'FILE' | 'IMAGE' | 'VIDEO';
  previewUrl: string | null;
};

type PendingStatusMedia = {
  file: globalThis.File;
  kind: 'IMAGE' | 'VIDEO';
  previewUrl: string;
};

type WebMediaCacheConfig = {
  maxSingleMediaBytes: number;
  maxTotalBytes: number;
};

type MediaViewerState = {
  caption?: string;
  kind: 'IMAGE' | 'VIDEO';
  media: NonNullable<Message['media']>;
  url: string;
};

type PinnedMessage = {
  message: Message;
  pinnedAt: string;
  scope: 'all' | 'me';
};

type MessageListRow =
  | { id: string; label: string; type: 'date' }
  | { message: Message; type: 'message' };

type ScreenPoint = {
  x: number;
  y: number;
};

type ContextMenuState =
  | { kind: 'chat'; conversation: Conversation; x: number; y: number }
  | { contact: AuthUser; kind: 'contact'; x: number; y: number }
  | { kind: 'message'; message: Message; x: number; y: number };

type CallState = {
  callId: string;
  conversationId?: string;
  connectedAt: number | null;
  direction: 'incoming' | 'outgoing';
  isMeetingHost?: boolean;
  kind?: 'call' | 'meeting';
  meetingCode?: string;
  participantId?: string;
  mode: 'voice' | 'video';
  phase: 'connecting' | 'connected' | 'dialing' | 'ringing';
  room: Room | null;
  title: string;
};

type MeetingInfo = {
  code: string;
  creator: { displayName: string; id: string; username: string };
  durationLimitSeconds: number;
  endedAt: string | null;
  id: string;
  link: string;
  maxEndsAt: string;
  mode: 'voice' | 'video';
  startedAt: string;
  status: 'active' | 'ended';
};

type MeetingParticipantInfo = {
  displayName: string;
  guestId: string | null;
  id: string;
  joinedAt: string;
  leftAt: string | null;
  role: 'HOST' | 'GUEST';
  userId: string | null;
};

type MeetingEndSummary = {
  availableSeconds: number;
  resetAt: string;
  spentSeconds: number;
};

type VoiceRoomParticipant = {
  adminMuted: boolean;
  isConnected: boolean;
  joinedAt: string;
  selfMuted: boolean;
  user: AuthUser;
  userId: string;
};

type VoiceRoomState = {
  conversationId: string;
  isConnecting: boolean;
  isSelfMuted: boolean;
  isSpeakerMuted: boolean;
  participants: VoiceRoomParticipant[];
  room: Room | null;
};

type IncomingCall = {
  callId: string;
  conversationId: string;
  fromDisplayName?: string;
  mode: 'VOICE' | 'VIDEO';
};

function getWebCallAnswerClientId() {
  const existing = localStorage.getItem(CALL_ANSWER_CLIENT_KEY);

  if (existing) {
    return existing;
  }

  const next = `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  localStorage.setItem(CALL_ANSWER_CLIENT_KEY, next);
  return next;
}

function getWebMeetingGuestId() {
  const existing = localStorage.getItem(MEETING_GUEST_ID_KEY);

  if (existing) {
    return existing;
  }

  const next = `web-guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  localStorage.setItem(MEETING_GUEST_ID_KEY, next);
  return next;
}

function getInitialMeetingCodeFromLocation() {
  const url = new URL(window.location.href);
  const queryCode = url.searchParams.get('meeting') || url.searchParams.get('meet') || url.searchParams.get('code');

  if (queryCode?.trim()) {
    return queryCode.trim();
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const meetIndex = segments.findIndex((segment) => ['meet', 'meeting', 'm'].includes(segment.toLowerCase()));

  if (meetIndex >= 0 && segments[meetIndex + 1]) {
    return decodeURIComponent(segments[meetIndex + 1]);
  }

  if (url.hostname.toLowerCase().startsWith('meet.')) {
    const firstSegment = segments[0];

    if (firstSegment && firstSegment.toLowerCase() !== 'web') {
      return decodeURIComponent(firstSegment);
    }
  }

  return null;
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>('chats');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>({});
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [draft, setDraft] = useState('');
  const [language, setLanguage] = useState<Language>(() => getStoredWebLanguage() ?? getBrowserLanguage());
  const [webMediaCacheConfig, setWebMediaCacheConfig] = useState<WebMediaCacheConfig>(DEFAULT_WEB_MEDIA_CACHE_CONFIG);
  const [isLoading, setLoading] = useState(false);
  const [isRecordingVoice, setRecordingVoice] = useState(false);
  const [voiceRecordingSeconds, setVoiceRecordingSeconds] = useState(0);
  const [isSendingVoice, setSendingVoice] = useState(false);
  const [isAttachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [isSendingAttachment, setSendingAttachment] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<AuthUser[]>([]);
  const [contactQuery, setContactQuery] = useState('');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directoryUsers, setDirectoryUsers] = useState<AuthUser[]>([]);
  const [isAddContactOpen, setAddContactOpen] = useState(false);
  const [isContactPickerOpen, setContactPickerOpen] = useState(false);
  const [isLoadingContacts, setLoadingContacts] = useState(false);
  const [isSearchingDirectory, setSearchingDirectory] = useState(false);
  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([]);
  const [isLoadingStatuses, setLoadingStatuses] = useState(false);
  const [isStatusComposerOpen, setStatusComposerOpen] = useState(false);
  const [statusComposerMode, setStatusComposerMode] = useState<'media' | 'text'>('media');
  const [pendingStatusMedia, setPendingStatusMedia] = useState<PendingStatusMedia | null>(null);
  const [statusBody, setStatusBody] = useState('');
  const [statusBackgroundColor, setStatusBackgroundColor] = useState('#2563eb');
  const [statusAudience, setStatusAudience] = useState<StatusAudience>('CONTACTS');
  const [statusExceptUserIds, setStatusExceptUserIds] = useState<string[]>([]);
  const [statusOnlyUserIds, setStatusOnlyUserIds] = useState<string[]>([]);
  const [statusAudiencePickerMode, setStatusAudiencePickerMode] = useState<'except' | 'only' | null>(null);
  const [statusViewerGroup, setStatusViewerGroup] = useState<StatusGroup | null>(null);
  const [statusViewerIndex, setStatusViewerIndex] = useState(0);
  const [statusViewerProgress, setStatusViewerProgress] = useState(0);
  const [isStatusViewerPaused, setStatusViewerPaused] = useState(false);
  const [statusReplyText, setStatusReplyText] = useState('');
  const [statusActionTarget, setStatusActionTarget] = useState<StatusUpdate | null>(null);
  const [statusActionViewers, setStatusActionViewers] = useState<StatusViewer[]>([]);
  const [isLoadingStatusViewers, setLoadingStatusViewers] = useState(false);
  const statusMediaInputRef = useRef<HTMLInputElement>(null);
  const [isNewChatOpen, setNewChatOpen] = useState(false);
  const [newChatQuery, setNewChatQuery] = useState('');
  const [newChatUsers, setNewChatUsers] = useState<AuthUser[]>([]);
  const [isSearchingUsers, setSearchingUsers] = useState(false);
  const [startingUserId, setStartingUserId] = useState<string | null>(null);
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [isPinnedMessagesOpen, setPinnedMessagesOpen] = useState(false);
  const [pinnedSearchQuery, setPinnedSearchQuery] = useState('');
  const [isEmojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [selectedEmojiGroupKey, setSelectedEmojiGroupKey] = useState<(typeof EMOJI_GROUPS)[number]['key']>(EMOJI_GROUPS[0].key);
  const [pendingCaptionAttachment, setPendingCaptionAttachment] = useState<PendingCaptionAttachment | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const [mediaViewer, setMediaViewer] = useState<MediaViewerState | null>(null);
  const [mediaViewerZoom, setMediaViewerZoom] = useState(1);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callState, setCallState] = useState<CallState | null>(null);
  const [voiceRoom, setVoiceRoom] = useState<VoiceRoomState | null>(null);
  const [isVoiceRoomPeopleOpen, setVoiceRoomPeopleOpen] = useState(false);
  const [isChatHeaderMenuOpen, setChatHeaderMenuOpen] = useState(false);
  const [isGroupDetailsOpen, setGroupDetailsOpen] = useState(false);
  const [callElapsedSeconds, setCallElapsedSeconds] = useState(0);
  const [callWindowPosition, setCallWindowPosition] = useState<ScreenPoint | null>(null);
  const [isCallMaximized, setCallMaximized] = useState(false);
  const [isScreenSharing, setScreenSharing] = useState(false);
  const [isStartingScreenShare, setStartingScreenShare] = useState(false);
  const [isMeetTypeMenuOpen, setMeetTypeMenuOpen] = useState(false);
  const [publicMeetingCode, setPublicMeetingCode] = useState<string | null>(() => getInitialMeetingCodeFromLocation());
  const [publicMeeting, setPublicMeeting] = useState<MeetingInfo | null>(null);
  const [publicMeetingRemainingSeconds, setPublicMeetingRemainingSeconds] = useState(0);
  const [publicMeetingName, setPublicMeetingName] = useState('');
  const [isPublicMeetingLoading, setPublicMeetingLoading] = useState(false);
  const [isPublicMeetingJoining, setPublicMeetingJoining] = useState(false);
  const [meetingEndSummary, setMeetingEndSummary] = useState<MeetingEndSummary | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const conversationRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callStateRef = useRef<CallState | null>(null);
  const activeCallConnectPromiseRef = useRef<Promise<void> | null>(null);
  const activeCallConnectCallIdRef = useRef<string | null>(null);
  const incomingRingtoneRef = useRef<HTMLAudioElement | null>(null);
  const outgoingRingbackRef = useRef<HTMLAudioElement | null>(null);
  const remoteMediaRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const screenSharePreviewRef = useRef<HTMLVideoElement>(null);
  const callWindowRef = useRef<HTMLDivElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceRecordingStartedAtRef = useRef(0);
  const voiceRecordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const contentAckInFlightRef = useRef(new Map<string, Promise<void>>());
  const readAckInFlightRef = useRef(new Map<string, Promise<void>>());
  const recentReadAckRef = useRef(new Map<string, { at: number; signature: string }>());
  const statusSyncInFlightRef = useRef(new Map<string, Promise<void>>());
  const statusSyncTimerRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const recentStatusSyncAtRef = useRef(new Map<string, number>());
  const screenShareRestoreCameraRef = useRef(false);
  const webCallUplinkProfileRef = useRef<WebCallNetworkProfile>('degraded');
  const webCallDownlinkProfileRef = useRef<WebCallNetworkProfile>('degraded');
  const webCallUplinkLastSwitchAtRef = useRef(0);
  const webCallDownlinkLastSwitchAtRef = useRef(0);
  const webCallUplinkStableSinceRef = useRef(0);
  const webCallDownlinkStableSinceRef = useRef(0);
  const webCallUplinkBadSamplesRef = useRef(0);
  const webCallDownlinkBadSamplesRef = useRef(0);
  const webCallRtcStatsPreviousByIdRef = useRef(new Map<string, WebCallRtcStatsPrevious>());
  const t = useCallback((key: TranslationKey) => translations[language][key], [language]);
  const formatLabel = useCallback((key: TranslationKey, values: Record<string, string | number>) => (
    Object.entries(values).reduce(
      (label, [name, value]) => label.replaceAll(`{${name}}`, String(value)),
      translations[language][key] as string,
    )
  ), [language]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  const switchWebCallUplinkProfile = useCallback((nextProfile: WebCallNetworkProfile, reason: string) => {
    const currentProfile = webCallUplinkProfileRef.current;

    if (currentProfile === nextProfile) {
      return;
    }

    const now = Date.now();
    const isDowngrade = getWebCallProfileRank(nextProfile) > getWebCallProfileRank(currentProfile);
    const minInterval = isDowngrade ? 2_000 : WEB_CALL_PROFILE_SWITCH_MIN_INTERVAL_MS;

    if (now - webCallUplinkLastSwitchAtRef.current < minInterval) {
      return;
    }

    webCallUplinkLastSwitchAtRef.current = now;
    webCallUplinkProfileRef.current = nextProfile;
    logWebCallStartup('uplink-profile-switch', { from: currentProfile, reason, to: nextProfile });

    const currentCall = callStateRef.current;
    const room = currentCall?.room;
    const cameraTrack = room?.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;

    if (room && currentCall.mode === 'video' && cameraTrack) {
      try {
        cameraTrack.setPublishingQuality(getWebCallPublishingQuality(nextProfile));
      } catch (error) {
        logWebCallStartup('uplink-quality-change-failed', {
          message: error instanceof Error ? error.message : 'unknown',
          profile: nextProfile,
        });
      }
    }
  }, []);

  const switchWebCallDownlinkProfile = useCallback((nextProfile: WebCallNetworkProfile, reason: string) => {
    const currentProfile = webCallDownlinkProfileRef.current;

    if (currentProfile === nextProfile) {
      return;
    }

    const now = Date.now();
    const isDowngrade = getWebCallProfileRank(nextProfile) > getWebCallProfileRank(currentProfile);
    const minInterval = isDowngrade ? 2_000 : WEB_CALL_PROFILE_SWITCH_MIN_INTERVAL_MS;

    if (now - webCallDownlinkLastSwitchAtRef.current < minInterval) {
      return;
    }

    webCallDownlinkLastSwitchAtRef.current = now;
    webCallDownlinkProfileRef.current = nextProfile;
    logWebCallStartup('downlink-profile-switch', { from: currentProfile, reason, to: nextProfile });

    const room = callStateRef.current?.room;
    room?.remoteParticipants.forEach((participant) => {
      participant.videoTrackPublications.forEach((publication) => {
        applyWebCallRemoteVideoQuality(publication, nextProfile);
      });
    });
  }, []);

  useEffect(() => {
    const room = callState?.room;

    if (!room || callState.mode !== 'video') {
      webCallUplinkBadSamplesRef.current = 0;
      webCallDownlinkBadSamplesRef.current = 0;
      webCallRtcStatsPreviousByIdRef.current.clear();
      webCallUplinkStableSinceRef.current = 0;
      webCallDownlinkStableSinceRef.current = 0;
      return undefined;
    }

    const activeRoom = room;
    let isCancelled = false;

    async function sampleRtcStats() {
      const snapshot = await collectWebCallRtcStatsSnapshot(activeRoom, webCallRtcStatsPreviousByIdRef).catch(() => ({}));

      if (isCancelled) {
        return;
      }

      const applySample = (
        direction: 'uplink' | 'downlink',
        statsProfile: WebCallNetworkProfile,
        profileRef: React.MutableRefObject<WebCallNetworkProfile>,
        badSamplesRef: React.MutableRefObject<number>,
        stableSinceRef: React.MutableRefObject<number>,
        switchProfile: (profile: WebCallNetworkProfile, reason: string) => void,
      ) => {
        if (statsProfile === 'normal') {
          badSamplesRef.current = 0;
          stableSinceRef.current ||= Date.now();

          if (
            profileRef.current !== 'normal' &&
            Date.now() - stableSinceRef.current >= WEB_CALL_PROFILE_RECOVERY_STABLE_MS
          ) {
            switchProfile('normal', `${direction}-rtc-stats-recovered`);
          }
          return;
        }

        stableSinceRef.current = 0;
        badSamplesRef.current += 1;

        if (statsProfile === 'critical' && badSamplesRef.current >= WEB_CALL_STATS_CRITICAL_BAD_SAMPLE_COUNT) {
          switchProfile('critical', `${direction}-rtc-stats-critical`);
          return;
        }

        if (badSamplesRef.current >= WEB_CALL_STATS_DEGRADE_BAD_SAMPLE_COUNT) {
          switchProfile('degraded', `${direction}-rtc-stats-${statsProfile}`);
        }
      };

      applySample(
        'uplink',
        getWebCallUplinkProfileFromRtcStats(snapshot),
        webCallUplinkProfileRef,
        webCallUplinkBadSamplesRef,
        webCallUplinkStableSinceRef,
        switchWebCallUplinkProfile,
      );
      applySample(
        'downlink',
        getWebCallDownlinkProfileFromRtcStats(snapshot),
        webCallDownlinkProfileRef,
        webCallDownlinkBadSamplesRef,
        webCallDownlinkStableSinceRef,
        switchWebCallDownlinkProfile,
      );
    }

    void sampleRtcStats();
    const interval = setInterval(() => {
      void sampleRtcStats();
    }, WEB_CALL_STATS_SAMPLE_INTERVAL_MS);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [callState?.mode, callState?.room, switchWebCallDownlinkProfile, switchWebCallUplinkProfile]);

  const messages = selectedConversationId ? messagesByConversation[selectedConversationId] ?? [] : [];
  const pinnedMessageIds = useMemo(() => new Set(pinnedMessages.map((pin) => pin.message.id)), [pinnedMessages]);
  const latestPinnedMessage = pinnedMessages[0]?.message ?? null;
  const filteredPinnedMessages = useMemo(() => {
    const query = pinnedSearchQuery.trim().toLowerCase();

    if (!query) {
      return pinnedMessages;
    }

    return pinnedMessages.filter((pin) => getMessagePreviewText(pin.message).toLowerCase().includes(query));
  }, [pinnedMessages, pinnedSearchQuery]);
  const myStatusGroup = useMemo(
    () => statusGroups.find((group) => group.author.id === user?.id) ?? null,
    [statusGroups, user?.id],
  );
  const otherStatusGroups = useMemo(
    () => statusGroups.filter((group) => group.author.id !== user?.id),
    [statusGroups, user?.id],
  );
  const newStatusGroups = useMemo(
    () => otherStatusGroups.filter((group) => group.hasUnviewed),
    [otherStatusGroups],
  );
  const viewedStatusGroups = useMemo(
    () => otherStatusGroups.filter((group) => !group.hasUnviewed),
    [otherStatusGroups],
  );
  const latestOwnStatus = myStatusGroup?.statuses[myStatusGroup.statuses.length - 1] ?? null;
  const activeStatus = statusViewerGroup?.statuses[statusViewerIndex] ?? null;
  const selectedEmojiGroup = EMOJI_GROUPS.find((group) => group.key === selectedEmojiGroupKey) ?? EMOJI_GROUPS[0];
  const messageRows = useMemo(() => buildMessageRows(messages, t), [messages, t]);
  const sortedGroupMembers = useMemo(() => sortUsersAlphabetically(selectedConversation?.members ?? []), [selectedConversation?.members]);
  const visibleContacts = useMemo(() => {
    const query = contactQuery.trim().toLowerCase();

    if (!query) {
      return contacts;
    }

    return contacts.filter((contact) => (
      contact.displayName.toLowerCase().includes(query) ||
      contact.username.toLowerCase().includes(query)
    ));
  }, [contactQuery, contacts]);
  const defaultNewChatUsers = useMemo(() => {
    const users = new Map<string, AuthUser>();

    conversations.forEach((conversation) => {
      if (conversation.type === 'DIRECT') {
        conversation.members?.forEach((member) => {
          if (member.id !== user?.id) {
            users.set(member.id, member);
          }
        });
      }
    });
    contacts.forEach((contact) => users.set(contact.id, contact));

    return [...users.values()];
  }, [contacts, conversations, user?.id]);
  const visibleNewChatUsers = newChatQuery.trim().length >= 2 ? newChatUsers : defaultNewChatUsers;
  const selectedPeer = selectedConversation?.type === 'DIRECT'
    ? getConversationPeer(selectedConversation, user?.id)
    : null;

  useEffect(() => {
    setChatHeaderMenuOpen(false);
    setGroupDetailsOpen(false);
  }, [selectedConversationId]);

  const stopIncomingRingtone = useCallback(() => {
    const player = incomingRingtoneRef.current;

    if (!player) {
      return;
    }

    player.pause();
    player.currentTime = 0;
    incomingRingtoneRef.current = null;
  }, []);

  const stopOutgoingRingback = useCallback(() => {
    const player = outgoingRingbackRef.current;

    if (!player) {
      return;
    }

    player.pause();
    player.currentTime = 0;
    outgoingRingbackRef.current = null;
  }, []);

  const playLoopingCallAudio = useCallback((audioRef: React.MutableRefObject<HTMLAudioElement | null>, sourceUrl: string, volume: number) => {
    if (audioRef.current) {
      return;
    }

    const player = new Audio(sourceUrl);
    player.loop = true;
    player.volume = volume;
    audioRef.current = player;
    void player.play().catch(() => {
      if (audioRef.current === player) {
        audioRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    if (activePanelTab !== 'chats' || !selectedConversationId) {
      return;
    }

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }, [activePanelTab, messages.length, selectedConversationId]);

  useEffect(() => {
    const textarea = composerTextareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    const maxHeight = 148;
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft, selectedConversationId]);

  useEffect(() => {
    if (incomingCall) {
      playLoopingCallAudio(incomingRingtoneRef, ringtoneUrl, 0.72);
      return;
    }

    stopIncomingRingtone();
  }, [incomingCall, playLoopingCallAudio, stopIncomingRingtone]);

  useEffect(() => {
    const shouldPlayRingback = callState?.direction === 'outgoing' &&
      (callState.phase === 'dialing' || callState.phase === 'ringing');

    if (shouldPlayRingback) {
      playLoopingCallAudio(outgoingRingbackRef, outgoingRingbackUrl, 0.62);
      return;
    }

    stopOutgoingRingback();
  }, [callState?.direction, callState?.phase, playLoopingCallAudio, stopOutgoingRingback]);

  const logout = useCallback(() => {
    stopIncomingRingtone();
    stopOutgoingRingback();
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setConversations([]);
    setSelectedConversationId(null);
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, [stopIncomingRingtone, stopOutgoingRingback]);

  const authedRequest = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    if (!token) {
      throw new Error('Missing token');
    }

    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-MeetVap-Installation-Id': WEB_INSTALLATION_ID,
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(parsed?.error || text || `Request failed: ${response.status}`);
    }

    return parsed as T;
  }, [token]);

  const apiRequest = useCallback(async <T,>(path: string, options: RequestInit = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-MeetVap-Installation-Id': WEB_INSTALLATION_ID,
        ...(options.headers ?? {}),
      },
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(parsed?.error || text || `Request failed: ${response.status}`);
    }

    return parsed as T;
  }, [token]);

  const loadConversations = useCallback(async (cacheUserId = user?.id, refreshWeakPreviews = false) => {
    const response = await authedRequest<{ conversations: Conversation[] }>('/conversations?limit=100');
    const cachedMessagesByConversation = response.conversations.reduce<Record<string, Message[]>>((items, conversation) => {
      const cachedMessages = getCachedConversationMessages(cacheUserId, conversation.id);

      if (cachedMessages.length > 0) {
        items[conversation.id] = cachedMessages;
      }

      return items;
    }, {});

    if (Object.keys(cachedMessagesByConversation).length > 0) {
      setMessagesByConversation((current) => {
        let didUpdate = false;
        const next = { ...current };

        Object.entries(cachedMessagesByConversation).forEach(([conversationId, cachedMessages]) => {
          const mergedMessages = mergeMessages(cachedMessages, current[conversationId] ?? [])
            .filter(isVisibleChatMessage);

          if (mergedMessages.length > 0) {
            next[conversationId] = mergedMessages;
            didUpdate = true;
          }
        });

        return didUpdate ? next : current;
      });
    }

    setConversations((current) => {
      const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));

      return sortConversationsByLastMessage(response.conversations.map((conversation) => {
        const existing = currentById.get(conversation.id);
        const cachedMessages = cachedMessagesByConversation[conversation.id] ?? [];

        if (!existing) {
          return applyLocalConversationPreview(conversation, cachedMessages);
        }

        const existingLastMessageAt = existing.lastMessageAt ? new Date(existing.lastMessageAt).getTime() : 0;
        const serverLastMessageAt = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).getTime() : 0;
        const serverPreviewText = getConversationPreviewText(conversation, t).trim();
        const existingPreviewText = getConversationPreviewText(existing, t).trim();
        const shouldKeepExistingPreview = existingLastMessageAt > serverLastMessageAt ||
          (existing.lastMessageStatus === 'SENDING' && existing.lastMessageSenderId === user?.id) ||
          (existingLastMessageAt === serverLastMessageAt && !!existing.lastMessageId && !conversation.lastMessageId) ||
          (existingLastMessageAt === serverLastMessageAt && !serverPreviewText && !!existingPreviewText);

        const mergedConversation = shouldKeepExistingPreview
          ? {
              ...conversation,
              lastMessage: existing.lastMessage,
              lastMessageAt: existing.lastMessageAt,
              lastMessageId: existing.lastMessageId,
              lastMessageKind: existing.lastMessageKind,
              lastMessageSenderId: existing.lastMessageSenderId,
              lastMessageStatus: existing.lastMessageStatus,
            }
          : conversation;

        return applyLocalConversationPreview(mergedConversation, cachedMessages);
      }));
    });
    setSelectedConversationId((current) => current ?? response.conversations[0]?.id ?? null);

    if (!refreshWeakPreviews) {
      return;
    }

    const previewRefreshCandidates = response.conversations
      .map((conversation) => applyLocalConversationPreview(
        conversation,
        cachedMessagesByConversation[conversation.id] ?? [],
      ))
      .filter((conversation) => shouldRefreshConversationPreview(
        conversation,
        cachedMessagesByConversation[conversation.id] ?? [],
        cacheUserId,
        t,
      ))
      .slice(0, 40);

    for (let index = 0; index < previewRefreshCandidates.length; index += 4) {
      const batch = previewRefreshCandidates.slice(index, index + 4);

      await Promise.all(batch.map(async (conversation) => {
        try {
          const messagesResponse = await authedRequest<{ messages: Message[] }>(
            `/conversations/${conversation.id}/messages?client=WEB&pendingContent=true`,
          );
          const visibleMessages = messagesResponse.messages.filter(isVisibleChatMessage);

          if (visibleMessages.length === 0) {
            return;
          }

          const mergedMessages = mergeMessages(
            getCachedConversationMessages(cacheUserId, conversation.id),
            visibleMessages,
          ).filter(isVisibleChatMessage);
          const latestMessage = findLatestMessage(mergedMessages);

          if (!latestMessage) {
            return;
          }

          cacheConversationMessages(cacheUserId, conversation.id, mergedMessages);
          setMessagesByConversation((current) => ({
            ...current,
            [conversation.id]: mergeMessages(current[conversation.id] ?? [], mergedMessages)
              .filter(isVisibleChatMessage),
          }));
          setConversations((current) => {
            let didUpdate = false;
            const nextConversations = current.map((currentConversation) => {
              if (currentConversation.id !== conversation.id) {
                return currentConversation;
              }

              const currentLastMessageAt = currentConversation.lastMessageAt
                ? new Date(currentConversation.lastMessageAt).getTime()
                : 0;
              const latestMessageAt = new Date(latestMessage.createdAt).getTime();

              if (latestMessageAt < currentLastMessageAt) {
                return currentConversation;
              }

              didUpdate = true;
              return applyMessageConversationPreview(currentConversation, latestMessage);
            });

            return didUpdate ? sortConversationsByLastMessage(nextConversations) : current;
          });

          const ackableMessageIds = visibleMessages
            .filter((message) => (
              !message.id.startsWith('local-') &&
              !message.mediaId &&
              !message.media?.id
            ))
            .map((message) => message.id);

          if (ackableMessageIds.length > 0) {
            await authedRequest(`/conversations/${conversation.id}/messages/acks`, {
              body: JSON.stringify({ client: 'WEB', messageIds: ackableMessageIds }),
              method: 'POST',
            }).catch(() => undefined);
          }

          const incomingMessageIds = visibleMessages
            .filter((message) => message.senderId !== cacheUserId && !message.id.startsWith('local-'))
            .map((message) => message.id);

          if (incomingMessageIds.length > 0) {
            await authedRequest(`/conversations/${conversation.id}/messages/delivered`, {
              body: JSON.stringify({ messageIds: incomingMessageIds }),
              method: 'POST',
            }).catch(() => undefined);
          }
        } catch {
          // A row preview refresh is opportunistic. Normal chat opening still loads the conversation.
        }
      }));
    }
  }, [authedRequest, t, user?.id]);

  const scheduleConversationRefresh = useCallback(() => {
    if (conversationRefreshTimerRef.current) {
      clearTimeout(conversationRefreshTimerRef.current);
    }

    conversationRefreshTimerRef.current = setTimeout(() => {
      conversationRefreshTimerRef.current = null;
      void loadConversations().catch(() => undefined);
    }, 1800);
  }, [loadConversations]);

  const loadCalls = useCallback(async () => {
    const response = await authedRequest<{ calls: Message[] }>('/web/calls');
    setCallLogs(response.calls.map((message) => messageToCallLog(message, conversations, user?.id)));
  }, [authedRequest, conversations, user?.id]);

  const loadContacts = useCallback(async () => {
    const response = await authedRequest<{ contacts: AuthUser[] }>('/users/contacts');
    setContacts(response.contacts);
  }, [authedRequest, user?.id]);

  const loadStatuses = useCallback(async () => {
    setLoadingStatuses(true);
    try {
      const response = await authedRequest<{ groups: StatusGroup[] }>('/statuses');
      setStatusGroups(response.groups.map((group) => ({
        ...group,
        statuses: group.statuses.map((status) => mapWebStatus(status)),
      })));
    } finally {
      setLoadingStatuses(false);
    }
  }, [authedRequest]);

  const mergeConversationMessages = useCallback((conversationId: string, incomingMessages: Message[]) => {
    setMessagesByConversation((current) => {
      const mergedMessages = mergeMessages(current[conversationId] ?? [], incomingMessages)
        .filter(isVisibleChatMessage);

      cacheConversationMessages(user?.id, conversationId, mergedMessages);
      return {
        ...current,
        [conversationId]: mergedMessages,
      };
    });
  }, [user?.id]);

  const updateConversationPreviewFromMessage = useCallback((message: Message) => {
    setConversations((current) => {
      let didUpdate = false;
      const nextConversations = current.map((conversation) => {
        if (conversation.id !== message.conversationId) {
          return conversation;
        }

        const conversationLastMessageAt = conversation.lastMessageAt
          ? new Date(conversation.lastMessageAt).getTime()
          : 0;
        const messageCreatedAt = new Date(message.createdAt).getTime();

        if (messageCreatedAt < conversationLastMessageAt) {
          return conversation;
        }

        didUpdate = true;
        return {
          ...conversation,
          lastMessage: getMessagePreviewText(message),
          lastMessageAt: message.createdAt,
          lastMessageId: message.id,
          lastMessageKind: message.kind,
          lastMessageSenderId: message.senderId,
          lastMessageStatus: message.status,
          unreadCount: message.senderId === user?.id ? conversation.unreadCount : conversation.unreadCount,
        };
      });

      return didUpdate ? sortConversationsByLastMessage(nextConversations) : current;
    });
  }, [user?.id]);

  const updateConversationLastMessageStatus = useCallback((
    conversationId: string,
    messageIds: string[] | undefined,
    messageKeys: string[] | undefined,
    status: Message['status'],
  ) => {
    if (!messageIds?.length && !messageKeys?.length) {
      return;
    }

    const targetIds = new Set(messageIds);
    const targetKeys = new Set(messageKeys);

    setConversations((current) => current.map((conversation) => (
      conversation.id === conversationId &&
      conversation.lastMessageId &&
      (targetIds.has(conversation.lastMessageId) || targetKeys.has(conversation.lastMessageId)) &&
      getMessageStatusRank(status) > getMessageStatusRank(conversation.lastMessageStatus ?? 'SENT')
        ? { ...conversation, lastMessageStatus: status }
        : conversation
    )));
  }, []);

  const addOptimisticMessage = useCallback((message: Message) => {
    mergeConversationMessages(message.conversationId, [message]);
    updateConversationPreviewFromMessage(message);
  }, [mergeConversationMessages, updateConversationPreviewFromMessage]);

  const replaceOptimisticMessage = useCallback((conversationId: string, optimisticId: string, message: Message) => {
    setMessagesByConversation((current) => {
      const nextMessages = mergeMessages(
        (current[conversationId] ?? []).filter((item) => item.id !== optimisticId),
        [message],
      );

      cacheConversationMessages(user?.id, conversationId, nextMessages);
      return {
        ...current,
        [conversationId]: nextMessages,
      };
    });
    updateConversationPreviewFromMessage(message);
  }, [updateConversationPreviewFromMessage, user?.id]);

  const markOptimisticMessageFailed = useCallback((conversationId: string, optimisticId: string) => {
    setMessagesByConversation((current) => {
      const nextMessages = (current[conversationId] ?? []).map((message) => (
        message.id === optimisticId ? { ...message, status: 'SENT' as const } : message
      ));

      cacheConversationMessages(user?.id, conversationId, nextMessages);
      return {
        ...current,
        [conversationId]: nextMessages,
      };
    });
  }, [user?.id]);

  const updateKnownUser = useCallback((userId: string, update: Partial<AuthUser>) => {
    setContacts((current) => current.map((contact) => (
      contact.id === userId ? { ...contact, ...update } : contact
    )));
    setConversations((current) => current.map((conversation) => ({
      ...conversation,
      members: conversation.members?.map((member) => (
        member.id === userId ? { ...member, ...update } : member
      )),
    })));
    setUser((current) => current?.id === userId ? { ...current, ...update } : current);
  }, []);

  const markMessagesReceived = useCallback(async (conversationId: string, messages: Message[], shouldMarkRead: boolean) => {
    const incomingMessageIds = messages
      .filter((message) => message.senderId !== user?.id)
      .map((message) => message.id);

    if (incomingMessageIds.length === 0) {
      return;
    }
    const requestSignature = `${shouldMarkRead ? 'read' : 'delivered'}:${buildRequestSignature(incomingMessageIds)}`;
    const requestKey = `${conversationId}:${requestSignature}`;
    const recentReadAck = recentReadAckRef.current.get(conversationId);

    if (
      recentReadAck?.signature === requestSignature &&
      Date.now() - recentReadAck.at < 4_000
    ) {
      return;
    }

    const activeRequest = readAckInFlightRef.current.get(requestKey);

    if (activeRequest) {
      await activeRequest;
      return;
    }

    const path = shouldMarkRead
      ? `/conversations/${conversationId}/read`
      : `/conversations/${conversationId}/messages/delivered`;
    const body = shouldMarkRead
      ? { messageIds: incomingMessageIds, source: 'chat_open' }
      : { messageIds: incomingMessageIds };

    const request = authedRequest(path, {
      body: JSON.stringify(body),
      method: 'POST',
    }).then(() => {
      recentReadAckRef.current.set(conversationId, {
        at: Date.now(),
        signature: requestSignature,
      });
    }).finally(() => {
      readAckInFlightRef.current.delete(requestKey);
    });

    readAckInFlightRef.current.set(requestKey, request);
    await request;

    if (shouldMarkRead) {
      setConversations((current) => current.map((conversation) => (
        conversation.id === conversationId
          ? { ...conversation, unreadCount: 0 }
          : conversation
      )));
    }
  }, [authedRequest, user?.id]);

  const acknowledgeWebMessageContent = useCallback(async (conversationId: string, messages: Message[], includeMedia = false) => {
    const ackableMessageIds = messages
      .filter((message) => (
        !message.id.startsWith('local-') &&
        (
          includeMedia ||
          (
            !message.mediaId &&
            !message.media?.id
          )
        )
      ))
      .map((message) => message.id);

    if (ackableMessageIds.length === 0) {
      return;
    }
    const requestKey = `${conversationId}:${buildRequestSignature(ackableMessageIds)}`;
    const activeRequest = contentAckInFlightRef.current.get(requestKey);

    if (activeRequest) {
      await activeRequest;
      return;
    }

    const request = authedRequest(`/conversations/${conversationId}/messages/acks`, {
      body: JSON.stringify({ client: 'WEB', messageIds: ackableMessageIds }),
      method: 'POST',
    }).then(() => undefined).finally(() => {
      contentAckInFlightRef.current.delete(requestKey);
    });

    contentAckInFlightRef.current.set(requestKey, request);
    await request;
  }, [authedRequest]);

  const syncMessageStatusUpdates = useCallback(async (conversationId: string) => {
    const activeRequest = statusSyncInFlightRef.current.get(conversationId);

    if (activeRequest) {
      await activeRequest;
      return;
    }

    const lastSyncAt = recentStatusSyncAtRef.current.get(conversationId) ?? 0;

    if (Date.now() - lastSyncAt < 1_200) {
      return;
    }

    const request = (async () => {
      const response = await authedRequest<{
        updates: Array<{
          messageId?: string | null;
          messageKey?: string | null;
          status: Message['status'];
        }>;
      }>(`/conversations/${conversationId}/status-updates`);

      if (response.updates.length === 0) {
        recentStatusSyncAtRef.current.set(conversationId, Date.now());
        return;
      }

      const deliveredMessageIds = response.updates
        .filter((update) => update.status === 'DELIVERED' && update.messageId)
        .map((update) => update.messageId as string);
      const deliveredMessageKeys = response.updates
        .filter((update) => update.status === 'DELIVERED' && update.messageKey)
        .map((update) => update.messageKey as string);
      const readMessageIds = response.updates
        .filter((update) => update.status === 'READ' && update.messageId)
        .map((update) => update.messageId as string);
      const readMessageKeys = response.updates
        .filter((update) => update.status === 'READ' && update.messageKey)
        .map((update) => update.messageKey as string);

      updateMessageStatuses(setMessagesByConversation, conversationId, deliveredMessageIds, deliveredMessageKeys, 'DELIVERED', user?.id);
      updateMessageStatuses(setMessagesByConversation, conversationId, readMessageIds, readMessageKeys, 'READ', user?.id);
      updateConversationLastMessageStatus(conversationId, deliveredMessageIds, deliveredMessageKeys, 'DELIVERED');
      updateConversationLastMessageStatus(conversationId, readMessageIds, readMessageKeys, 'READ');

      await authedRequest(`/conversations/${conversationId}/status-updates/ack`, {
        body: JSON.stringify({
          messageIds: [...new Set([...deliveredMessageIds, ...readMessageIds])],
          messageKeys: [...new Set([...deliveredMessageKeys, ...readMessageKeys])],
        }),
        method: 'POST',
      });
      recentStatusSyncAtRef.current.set(conversationId, Date.now());
    })().finally(() => {
      statusSyncInFlightRef.current.delete(conversationId);
    });

    statusSyncInFlightRef.current.set(conversationId, request);
    await request;
  }, [authedRequest, updateConversationLastMessageStatus, user?.id]);

  const scheduleStatusSync = useCallback((conversationId: string) => {
    const existingTimer = statusSyncTimerRef.current.get(conversationId);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      statusSyncTimerRef.current.delete(conversationId);
      void syncMessageStatusUpdates(conversationId).catch(() => undefined);
    }, 650);

    statusSyncTimerRef.current.set(conversationId, timer);
  }, [syncMessageStatusUpdates]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const response = await authedRequest<{ messages: Message[] }>(
      `/conversations/${conversationId}/messages?client=WEB&pendingContent=true`,
    );
    const visibleMessages = response.messages.filter(isVisibleChatMessage);
    const latestMessage = findLatestMessage(visibleMessages);

    mergeConversationMessages(conversationId, visibleMessages);
    if (latestMessage) {
      updateConversationPreviewFromMessage(latestMessage);
    }
    await acknowledgeWebMessageContent(conversationId, visibleMessages).catch(() => undefined);
    await syncMessageStatusUpdates(conversationId).catch(() => undefined);
    await markMessagesReceived(conversationId, visibleMessages, isPageActivelyViewed());
  }, [acknowledgeWebMessageContent, authedRequest, markMessagesReceived, mergeConversationMessages, syncMessageStatusUpdates, updateConversationPreviewFromMessage]);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    Promise.all([
      authedRequest<{ user: AuthUser }>('/auth/me'),
      fetch(`${API_URL}/config/client`)
        .then((response) => response.json())
        .catch(() => null),
      authedRequest<{ locale: Language | null }>('/web/preferences').catch(() => ({ locale: null })),
      authedRequest<{ contacts: AuthUser[] }>('/users/contacts').catch(() => ({ contacts: [] })),
      authedRequest<{ blockedUsers: AuthUser[] }>('/users/blocks').catch(() => ({ blockedUsers: [] })),
    ])
      .then(([response, clientConfig, preferences, contactsResponse, blocksResponse]) => {
        if (!cancelled) {
          setUser(response.user);
          setWebMediaCacheConfig(normalizeWebMediaCacheConfig(clientConfig?.webMediaCache));
          setLanguage(getStoredWebLanguage() ?? preferences.locale ?? getBrowserLanguage());
          setContacts(contactsResponse.contacts);
          setBlockedUserIds(new Set(blocksResponse.blockedUsers.map((blockedUser) => blockedUser.id)));
          return loadConversations(response.user.id, true);
        }
      })
      .catch(logout)
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authedRequest, loadConversations, logout, token]);

  useEffect(() => {
    if (!token || activePanelTab !== 'calls') {
      return;
    }

    void loadCalls().catch(() => undefined);
  }, [activePanelTab, loadCalls, token]);

  useEffect(() => {
    if (!token || activePanelTab !== 'contacts') {
      return;
    }

    void loadContacts().catch(() => undefined);
  }, [activePanelTab, loadContacts, token]);

  useEffect(() => {
    if (!token || activePanelTab !== 'statuses') {
      return;
    }

    void loadStatuses().catch(() => undefined);
    if (contacts.length === 0) {
      void loadContacts().catch(() => undefined);
    }
  }, [activePanelTab, contacts.length, loadContacts, loadStatuses, token]);

  useEffect(() => {
    if (!publicMeetingCode) {
      return undefined;
    }

    let cancelled = false;
    const meetingCode = publicMeetingCode;

    async function loadPublicMeeting() {
      setPublicMeetingLoading(true);
      try {
        const response = await apiRequest<{
          meeting: MeetingInfo;
          participants: MeetingParticipantInfo[];
          remainingSeconds: number;
        }>(`/meetings/${encodeURIComponent(meetingCode)}`);

        if (cancelled) {
          return;
        }

        setPublicMeeting(response.meeting);
        setPublicMeetingRemainingSeconds(response.remainingSeconds);
      } catch (error) {
        if (!cancelled) {
          setAttachmentError(error instanceof Error ? error.message : t('meetingOpenFailed'));
        }
      } finally {
        if (!cancelled) {
          setPublicMeetingLoading(false);
        }
      }
    }

    void loadPublicMeeting();

    return () => {
      cancelled = true;
    };
  }, [apiRequest, publicMeetingCode, t]);

  useEffect(() => {
    if (!publicMeeting || publicMeeting.status !== 'active') {
      return undefined;
    }

    const interval = setInterval(() => {
      setPublicMeetingRemainingSeconds(Math.max(0, Math.ceil((new Date(publicMeeting.maxEndsAt).getTime() - Date.now()) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [publicMeeting]);

  useEffect(() => {
    if (!token || !selectedConversationId) {
      return;
    }

    let cancelled = false;
    const cachedMessages = getCachedConversationMessages(user?.id, selectedConversationId);

    if (cachedMessages.length > 0) {
      setMessagesByConversation((current) => ({
        ...current,
        [selectedConversationId]: mergeMessages(cachedMessages, current[selectedConversationId] ?? []),
      }));
    }
    void getStoredConversationMessages(user?.id, selectedConversationId)
      .then((storedMessages) => {
        if (cancelled || storedMessages.length === 0) {
          return;
        }

        setMessagesByConversation((current) => ({
          ...current,
          [selectedConversationId]: mergeMessages(storedMessages, current[selectedConversationId] ?? [])
            .filter(isVisibleChatMessage),
        }));
        const latestMessage = findLatestMessage(storedMessages);

        if (latestMessage) {
          updateConversationPreviewFromMessage(latestMessage);
        }
      })
      .catch(() => undefined);
    void loadMessages(selectedConversationId);
    void authedRequest<{ pins: PinnedMessage[] }>(`/conversations/${selectedConversationId}/pins`)
      .then((response) => setPinnedMessages(response.pins))
      .catch(() => setPinnedMessages([]));
    socketRef.current?.emit('conversation:join', selectedConversationId);

    return () => {
      cancelled = true;
      socketRef.current?.emit('conversation:leave', selectedConversationId);
    };
  }, [authedRequest, loadMessages, selectedConversationId, token, updateConversationPreviewFromMessage, user?.id]);

  useEffect(() => {
    if (!token || !selectedConversation?.isVoiceRoom || callState) {
      void closeVoiceRoom(false);
      return;
    }

    if (voiceRoom?.conversationId === selectedConversation.id && (voiceRoom.room || voiceRoom.isConnecting)) {
      return;
    }

    void joinVoiceRoom(selectedConversation);
  }, [callState, selectedConversation, token]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    const socket = io(API_URL, {
      auth: { installationId: WEB_INSTALLATION_ID, token },
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('app:state', { isForeground: true, state: 'active' });
    });
    socket.on('message:new', (message: Message) => {
      mergeConversationMessages(message.conversationId, [message]);
      updateConversationPreviewFromMessage(message);
      void acknowledgeWebMessageContent(message.conversationId, [message]).catch(() => undefined);
      const isOpenConversation = isPageActivelyViewed() &&
        message.conversationId === selectedConversationId;
      void markMessagesReceived(message.conversationId, [message], isOpenConversation);
      if (!isOpenConversation) {
        showBrowserNotification(message);
      }
    });
    socket.on('message:delivered', (payload: { conversationId: string; messageIds?: string[]; messageKeys?: string[] }) => {
      updateMessageStatuses(setMessagesByConversation, payload.conversationId, payload.messageIds, payload.messageKeys, 'DELIVERED', user?.id);
      updateConversationLastMessageStatus(payload.conversationId, payload.messageIds, payload.messageKeys, 'DELIVERED');
      scheduleStatusSync(payload.conversationId);
    });
    socket.on('message:read', (payload: { conversationId: string; messageIds?: string[]; messageKeys?: string[] }) => {
      updateMessageStatuses(setMessagesByConversation, payload.conversationId, payload.messageIds, payload.messageKeys, 'READ', user?.id);
      updateConversationLastMessageStatus(payload.conversationId, payload.messageIds, payload.messageKeys, 'READ');
      scheduleStatusSync(payload.conversationId);
    });
    socket.on('message:deleted', (payload: { conversationId: string; messageId?: string }) => {
      if (!payload.messageId) {
        return;
      }

      setMessagesByConversation((current) => {
        const nextMessages = (current[payload.conversationId] ?? []).filter((message) => message.id !== payload.messageId);

        cacheConversationMessages(user?.id, payload.conversationId, nextMessages);
        return {
          ...current,
          [payload.conversationId]: nextMessages,
        };
      });
      setPinnedMessages((current) => current.filter((pin) => pin.message.id !== payload.messageId));
    });
    socket.on('message:pinned', (payload: { conversationId: string; message: Message; pinnedAt: string; scope: 'all' | 'me' }) => {
      if (payload.conversationId !== selectedConversationId) {
        return;
      }

      setPinnedMessages((current) => [
        { message: payload.message, pinnedAt: payload.pinnedAt, scope: payload.scope },
        ...current.filter((pin) => pin.message.id !== payload.message.id),
      ]);
    });
    socket.on('message:unpinned', (payload: { conversationId: string; messageId: string; scope: 'all' | 'me' }) => {
      if (payload.conversationId !== selectedConversationId) {
        return;
      }

      setPinnedMessages((current) => current.filter((pin) => pin.message.id !== payload.messageId || pin.scope !== payload.scope));
    });
    socket.on('conversation:updated', () => {
      scheduleConversationRefresh();
    });
    socket.on('status:updated', () => {
      void loadStatuses().catch(() => undefined);
    });
    socket.on('status:viewed', (payload: { statusId?: string; viewerId?: string }) => {
      setStatusGroups((current) => current.map((group) => ({
        ...group,
        statuses: group.statuses.map((status) => (
          status.id === payload.statusId && status.authorId === user?.id
            ? { ...status, viewerCount: Math.max(status.viewerCount ?? 0, 1) }
            : status
        )),
      })));
    });
    socket.on('presence:update', (payload: { isOnline: boolean; lastSeenAt?: string | null; showLastSeen?: boolean; userId: string }) => {
      updateKnownUser(payload.userId, {
        isOnline: payload.isOnline,
        lastSeenAt: payload.lastSeenAt ?? null,
        showLastSeen: payload.showLastSeen,
      });
    });
    socket.on('presence:privacy', (payload: { showLastSeen: boolean; userId: string }) => {
      updateKnownUser(payload.userId, {
        isOnline: payload.showLastSeen ? undefined : false,
        lastSeenAt: payload.showLastSeen ? undefined : null,
        showLastSeen: payload.showLastSeen,
      });
    });
    socket.on('user:updated', (payload: { user?: AuthUser }) => {
      if (!payload.user || payload.user.id !== user?.id) {
        return;
      }

      const updatedUser = payload.user;

      setUser(updatedUser);
      setContacts((current) => current.map((contact) => contact.id === updatedUser.id ? { ...contact, ...updatedUser } : contact));
      setConversations((current) => current.map((conversation) => ({
        ...conversation,
        avatarUrl: conversation.otherUserId === updatedUser.id ? updatedUser.avatarUrl : conversation.avatarUrl,
        members: conversation.members?.map((member) => member.id === updatedUser.id ? { ...member, ...updatedUser } : member),
        title: conversation.otherUserId === updatedUser.id ? updatedUser.displayName || updatedUser.username : conversation.title,
      })));
    });
    socket.on('voice-room:participants', (payload: { conversationId?: string }) => {
      if (payload.conversationId) {
        void refreshVoiceRoomParticipants(payload.conversationId);
      }
    });
    socket.on('call:invite', (payload: IncomingCall & { fromUserId?: string }) => {
      if (payload.fromUserId !== user?.id) {
        setIncomingCall(payload);
      }
    });
    socket.on('call:ringing', (payload: { callId: string; userId: string }) => {
      if (payload.userId === user?.id) {
        return;
      }

      setCallState((current) => current?.callId === payload.callId && current.phase === 'dialing'
        ? { ...current, phase: 'ringing' }
        : current);
    });
    socket.on('call:answered', (payload: { answerClientId?: string; callId: string; userId: string }) => {
      setIncomingCall((current) => {
        if (!current || current.callId !== payload.callId) {
          return current;
        }

        if (payload.userId === user?.id && payload.answerClientId === getWebCallAnswerClientId()) {
          return current;
        }

        return null;
      });

      const currentCall = callStateRef.current;

      if (currentCall?.callId === payload.callId && payload.userId !== user?.id) {
        stopOutgoingRingback();
        if (currentCall.room) {
          setCallState((current) => current?.callId === payload.callId
            ? { ...current, connectedAt: current.connectedAt ?? Date.now(), phase: 'connected' }
            : current);
        } else {
          void connectAnsweredOutgoingCall(currentCall).catch((error) => {
            setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
          });
        }
      }
    });
    socket.on('call:ended', (payload: { callId?: string }) => {
      stopIncomingRingtone();
      stopOutgoingRingback();
      setCallState((current) => {
        if (!current || (payload.callId && payload.callId !== current.callId)) {
          return current;
        }

        current.room?.disconnect();
        screenShareRestoreCameraRef.current = false;
        setScreenSharing(false);
        setStartingScreenShare(false);
        return null;
      });
      setCallWindowPosition(null);
      setCallMaximized(false);
    });
    socket.on('web:logged-out', logout);

    return () => {
      socket.disconnect();
      if (conversationRefreshTimerRef.current) {
        clearTimeout(conversationRefreshTimerRef.current);
        conversationRefreshTimerRef.current = null;
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [acknowledgeWebMessageContent, loadConversations, loadStatuses, logout, markMessagesReceived, mergeConversationMessages, scheduleConversationRefresh, scheduleStatusSync, selectedConversationId, stopIncomingRingtone, stopOutgoingRingback, t, token, updateConversationLastMessageStatus, updateConversationPreviewFromMessage, updateKnownUser, user?.id]);

  useEffect(() => {
    if (!selectedConversationId) {
      return undefined;
    }

    const markVisibleConversationRead = () => {
      if (!isPageActivelyViewed()) {
        return;
      }

      const visibleMessages = messagesByConversation[selectedConversationId] ?? [];
      void markMessagesReceived(selectedConversationId, visibleMessages, true);
    };

    markVisibleConversationRead();
    document.addEventListener('visibilitychange', markVisibleConversationRead);
    window.addEventListener('focus', markVisibleConversationRead);

    return () => {
      document.removeEventListener('visibilitychange', markVisibleConversationRead);
      window.removeEventListener('focus', markVisibleConversationRead);
    };
  }, [markMessagesReceived, messagesByConversation, selectedConversationId]);

  useEffect(() => {
    if (!callState?.room) {
      return undefined;
    }

    const room = callState.room;
    const startupStartedAt = Date.now();
    let hasSeenFirstRemoteVideo = false;
    const attachedTrackSids = new Set<string>();
    const startupMissingSinceByTrackSid = new Map<string, number>();
    const startupResetTrackSids = new Set<string>();
    const startupResubscribeTimers = new Set<ReturnType<typeof setTimeout>>();
    const reconcileRemoteVideoVisibility = () => {
      const activeScreenShareParticipants = new Set<string>();

      room.remoteParticipants.forEach((participant) => {
        const screenSharePublication = participant.getTrackPublication(Track.Source.ScreenShare);

        if (
          screenSharePublication?.track &&
          screenSharePublication.isMuted !== true &&
          screenSharePublication.track.mediaStreamTrack.readyState !== 'ended'
        ) {
          activeScreenShareParticipants.add(participant.identity);
        }
      });

      remoteMediaRef.current?.querySelectorAll<HTMLMediaElement>('[data-participant-identity][data-track-source]').forEach((element) => {
        const participantIdentity = element.dataset.participantIdentity;
        const source = element.dataset.trackSource;
        const shouldHideCamera = !!participantIdentity &&
          activeScreenShareParticipants.has(participantIdentity) &&
          source === Track.Source.Camera;

        element.classList.toggle('remote-track-hidden', shouldHideCamera);
      });
    };
    const attachTrack = (track: RemoteTrack, publication: RemoteTrackPublication, participantIdentity?: string) => {
      if (publication.kind !== Track.Kind.Video && publication.kind !== Track.Kind.Audio) {
        return;
      }

      const attachKey = publication.trackSid || `${publication.kind}:${track.sid}`;

      if (attachedTrackSids.has(attachKey)) {
        return;
      }

      const element = track.attach();
      element.className = publication.kind === Track.Kind.Video ? 'remote-video' : 'remote-audio';
      element.dataset.trackSid = attachKey;
      if (participantIdentity) {
        element.dataset.participantIdentity = participantIdentity;
      }
      if (publication.source) {
        element.dataset.trackSource = publication.source;
      }
      remoteMediaRef.current?.appendChild(element);
      attachedTrackSids.add(attachKey);
      reconcileRemoteVideoVisibility();

      if (publication.kind === Track.Kind.Video) {
        hasSeenFirstRemoteVideo = true;
        logWebCallStartup('remote-video-render-attached', {
          readyState: track.mediaStreamTrack.readyState,
          trackSid: publication.trackSid,
        });
      }
    };
    const detachTrack = (track: RemoteTrack) => {
      track.detach().forEach((element) => {
        const trackSid = element.dataset.trackSid;

        if (trackSid) {
          attachedTrackSids.delete(trackSid);
        }

        element.remove();
      });
      reconcileRemoteVideoVisibility();
    };
    const forceRemoteSubscriptions = () => {
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          if (publication.kind !== Track.Kind.Video && publication.kind !== Track.Kind.Audio) {
            return;
          }

          try {
            publication.setEnabled(true);

            if (!publication.isDesired) {
              publication.setSubscribed(true);
              logWebCallStartup('remote-track-subscribe-requested', {
                participantId: participant.identity,
                source: publication.source,
                trackKind: publication.kind,
                trackSid: publication.trackSid,
              });
            }

            if (publication.kind === Track.Kind.Video) {
              if (publication.source === Track.Source.ScreenShare) {
                applyWebCallRemoteVideoQuality(publication, webCallDownlinkProfileRef.current);
              } else {
                const isStartup = !hasSeenFirstRemoteVideo && Date.now() - startupStartedAt < 2_000;
                applyWebCallRemoteVideoQuality(publication, webCallDownlinkProfileRef.current, isStartup);
              }
            }

            if (publication.track) {
              startupMissingSinceByTrackSid.delete(publication.trackSid);
              attachTrack(publication.track, publication, participant.identity);
            } else if (
              publication.kind === Track.Kind.Video &&
              !hasSeenFirstRemoteVideo &&
              Date.now() - startupStartedAt < WEB_CALL_REMOTE_STARTUP_SUBSCRIBE_MS &&
              publication.isDesired
            ) {
              const missingSince = startupMissingSinceByTrackSid.get(publication.trackSid) ?? Date.now();
              startupMissingSinceByTrackSid.set(publication.trackSid, missingSince);

              if (
                !startupResetTrackSids.has(publication.trackSid) &&
                Date.now() - missingSince >= WEB_CALL_REMOTE_STARTUP_STALL_RESET_MS
              ) {
                startupResetTrackSids.add(publication.trackSid);
                publication.setSubscribed(false);
                const timer = setTimeout(() => {
                  startupResubscribeTimers.delete(timer);

                  try {
                    if (!publication.track && publication.isMuted !== true) {
                      publication.setSubscribed(true);
                    }
                  } catch {
                    // The participant can leave while the startup recovery is pending.
                  }
                }, WEB_CALL_REMOTE_STARTUP_RESUBSCRIBE_DELAY_MS);
                startupResubscribeTimers.add(timer);
              }
            }
          } catch (error) {
            logWebCallStartup('remote-track-subscribe-error', {
              message: error instanceof Error ? error.message : 'unknown',
              participantId: participant.identity,
              trackSid: publication.trackSid,
            });
          }
        });
      });
    };

    const handleTrackSubscribed = (track: RemoteTrack, publication: RemoteTrackPublication, participant?: { identity?: string }) => {
      logWebCallStartup('remote-track-subscribed', {
        participantId: participant?.identity,
        readyState: track.mediaStreamTrack.readyState,
        source: publication.source,
        trackKind: publication.kind,
        trackSid: publication.trackSid,
      });
      attachTrack(track, publication, participant?.identity);
      forceRemoteSubscriptions();
    };
    const handleRemoteTrackUpdate = () => {
      forceRemoteSubscriptions();
      reconcileRemoteVideoVisibility();
    };

    forceRemoteSubscriptions();
    const startupInterval = setInterval(() => {
      if (hasSeenFirstRemoteVideo || Date.now() - startupStartedAt >= WEB_CALL_REMOTE_STARTUP_SUBSCRIBE_MS) {
        clearInterval(startupInterval);
        return;
      }

      forceRemoteSubscriptions();
    }, WEB_CALL_REMOTE_STARTUP_SUBSCRIBE_INTERVAL_MS);

    room
      .on(RoomEvent.ParticipantConnected, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackPublished, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackMuted, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackUnmuted, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackSubscriptionStatusChanged, handleRemoteTrackUpdate)
      .on(RoomEvent.TrackSubscribed, handleTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, detachTrack);

    return () => {
      clearInterval(startupInterval);
      startupResubscribeTimers.forEach(clearTimeout);
      startupResubscribeTimers.clear();
      room
        .off(RoomEvent.ParticipantConnected, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackPublished, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackMuted, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackUnmuted, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackSubscriptionStatusChanged, handleRemoteTrackUpdate)
        .off(RoomEvent.TrackSubscribed, handleTrackSubscribed)
        .off(RoomEvent.TrackUnsubscribed, detachTrack);
    };
  }, [callState?.room]);

  useEffect(() => {
    if (!voiceRoom?.room) {
      return undefined;
    }

    const room = voiceRoom.room;
    const attachTrack = (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio) {
        return;
      }

      const element = track.attach();
      element.className = 'remote-audio';
      document.body.appendChild(element);
      setRemoteTrackVolume(track, voiceRoom.isSpeakerMuted ? 0 : 1);
    };
    const detachTrack = (track: RemoteTrack) => {
      track.detach().forEach((element) => element.remove());
    };

    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.TrackUnsubscribed, detachTrack);
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.track) {
          attachTrack(publication.track, publication);
        }
      });
    });

    return () => {
      room.off(RoomEvent.TrackSubscribed, attachTrack);
      room.off(RoomEvent.TrackUnsubscribed, detachTrack);
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((publication) => {
          publication.track?.detach().forEach((element) => element.remove());
        });
      });
    };
  }, [voiceRoom?.isSpeakerMuted, voiceRoom?.room]);

  useEffect(() => {
    if (!callState?.room || callState.mode !== 'video') {
      return undefined;
    }

    const room = callState.room;
    const attachLocalVideo = (track?: LocalTrack | null) => {
      if (track?.kind !== Track.Kind.Video || !localVideoRef.current) {
        return;
      }

      track.attach(localVideoRef.current);
    };
    const detachLocalVideo = (track?: LocalTrack | null) => {
      if (track?.kind === Track.Kind.Video && localVideoRef.current) {
        track.detach(localVideoRef.current);
      }
    };
    const handleLocalTrackPublished = (publication: { track?: LocalTrack | null }) => {
      attachLocalVideo(publication.track);
    };
    const handleLocalTrackUnpublished = (publication: { track?: LocalTrack | null }) => {
      detachLocalVideo(publication.track);
    };
    const cameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);

    attachLocalVideo(cameraPublication?.track);
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
      detachLocalVideo(room.localParticipant.getTrackPublication(Track.Source.Camera)?.track);
    };
  }, [callState?.mode, callState?.room]);

  useEffect(() => {
    if (!callState?.room || callState.mode !== 'video') {
      setScreenSharing(false);
      return undefined;
    }

    const room = callState.room;
    const handleLocalTrackPublished = (publication: { source?: Track.Source }) => {
      if (publication.source === Track.Source.ScreenShare) {
        setScreenSharing(true);
      }
    };
    const handleLocalTrackUnpublished = (publication: { source?: Track.Source }) => {
      if (publication.source === Track.Source.ScreenShare) {
        setScreenSharing(false);
        void restoreCameraAfterScreenShare(room).catch((error) => {
          setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
        });
      }
    };
    const screenSharePublication = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);

    setScreenSharing(!!screenSharePublication?.track && !screenSharePublication.isMuted);
    room.on(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
    room.on(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, handleLocalTrackPublished);
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
    };
  }, [callState?.mode, callState?.room, t]);

  useEffect(() => {
    if (!callState?.room || callState.mode !== 'video' || !isScreenSharing || !screenSharePreviewRef.current) {
      return undefined;
    }

    const track = callState.room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;

    if (track?.kind !== Track.Kind.Video) {
      return undefined;
    }

    track.attach(screenSharePreviewRef.current);

    return () => {
      if (screenSharePreviewRef.current) {
        track.detach(screenSharePreviewRef.current);
      }
    };
  }, [callState?.mode, callState?.room, isScreenSharing]);

  useEffect(() => {
    if (!callState?.connectedAt) {
      setCallElapsedSeconds(0);
      return undefined;
    }

    const updateElapsed = () => {
      setCallElapsedSeconds(Math.max(0, Math.floor((Date.now() - callState.connectedAt!) / 1000)));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [callState]);

  useEffect(() => {
    if (!activeStatus || isStatusViewerPaused) {
      return undefined;
    }

    const durationMs = getStatusDurationMs(activeStatus);
    const startedAt = Date.now() - statusViewerProgress * durationMs;
    const interval = setInterval(() => {
      const nextProgress = Math.min(1, (Date.now() - startedAt) / durationMs);
      setStatusViewerProgress(nextProgress);
      if (nextProgress >= 1) {
        clearInterval(interval);
        openNextStatus();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [activeStatus?.id, isStatusViewerPaused]);

  useEffect(() => () => {
    stopIncomingRingtone();
    stopOutgoingRingback();
    statusSyncTimerRef.current.forEach(clearTimeout);
    statusSyncTimerRef.current.clear();
    if (voiceRecordingTimerRef.current) {
      clearInterval(voiceRecordingTimerRef.current);
      voiceRecordingTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, [stopIncomingRingtone, stopOutgoingRingback]);

  async function sendMessage() {
    if (!selectedConversationId || !draft.trim()) {
      return;
    }

    const body = draft.trim();
    const optimisticId = createLocalMessageId();
    const optimisticMessage = createOptimisticMessage({
      body,
      conversationId: selectedConversationId,
      id: optimisticId,
      kind: 'TEXT',
      user,
    });

    setDraft('');
    addOptimisticMessage(optimisticMessage);
    const response = await authedRequest<{ message: Message }>(`/conversations/${selectedConversationId}/messages`, {
      body: JSON.stringify({
        body,
        kind: 'TEXT',
        metadata: replyingTo ? {
          replyTo: {
            body: replyingTo.body,
            id: replyingTo.id,
            kind: replyingTo.kind,
            senderName: replyingTo.sender?.displayName || replyingTo.sender?.username || '',
          },
        } : undefined,
      }),
      method: 'POST',
    }).catch((error) => {
      markOptimisticMessageFailed(selectedConversationId, optimisticId);
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
      return null;
    });
    setReplyingTo(null);
    if (response) {
      replaceOptimisticMessage(selectedConversationId, optimisticId, response.message);
    }
  }

  function openCaptionModal(file: globalThis.File, selectionType: 'file' | 'gallery') {
    setAttachmentMenuOpen(false);
    const mimeType = file.type.toLowerCase();
    const kind = selectionType === 'file'
      ? 'FILE'
      : mimeType.startsWith('image/')
        ? 'IMAGE'
        : mimeType.startsWith('video/')
          ? 'VIDEO'
          : 'FILE';

    setCaptionDraft(kind === 'FILE' ? file.name : '');
    setPendingCaptionAttachment({
      file,
      kind,
      previewUrl: kind === 'IMAGE' || kind === 'VIDEO' ? URL.createObjectURL(file) : null,
    });
  }

  function handleComposerPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!selectedConversation || isSendingAttachment) {
      return;
    }

    const pastedFile = getPastedGalleryFile(event.clipboardData);

    if (!pastedFile) {
      return;
    }

    event.preventDefault();
    openCaptionModal(pastedFile, 'gallery');
  }

  function closeCaptionModal() {
    if (pendingCaptionAttachment?.previewUrl) {
      URL.revokeObjectURL(pendingCaptionAttachment.previewUrl);
    }
    setPendingCaptionAttachment(null);
    setCaptionDraft('');
    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function uploadAndSendFile(file: globalThis.File, kind: 'FILE' | 'IMAGE' | 'VIDEO', caption: string) {
    if (!selectedConversationId) {
      return;
    }

    setAttachmentError(null);
    setSendingAttachment(true);
    const optimisticId = createLocalMessageId();
    const optimisticMessage = createOptimisticMessage({
      body: caption.trim() || (kind === 'FILE' ? file.name : ''),
      conversationId: selectedConversationId,
      id: optimisticId,
      kind,
      media: {
        id: null,
        mimeType: file.type || 'application/octet-stream',
        originalName: file.name || 'attachment',
        storageKey: '',
      },
      metadata: pendingCaptionAttachment?.previewUrl ? { previewUrl: pendingCaptionAttachment.previewUrl } : undefined,
      user,
    });

    addOptimisticMessage(optimisticMessage);

    try {
      const uploadResponse = await fetch(`${API_URL}/media/upload-binary`, {
        body: file,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-mime-type': file.type || 'application/octet-stream',
          'x-original-name': encodeURIComponent(file.name || 'attachment'),
        },
        method: 'POST',
      });
      const uploadText = await uploadResponse.text();
      const uploadPayload = uploadText ? JSON.parse(uploadText) : null;

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload?.error || t('attachmentFailed'));
      }

      const response = await authedRequest<{ message: Message }>(`/conversations/${selectedConversationId}/messages`, {
        body: JSON.stringify({
          body: caption.trim() || (kind === 'FILE' ? file.name : ''),
          kind,
          mediaId: uploadPayload.media.id,
        }),
        method: 'POST',
      });

      replaceOptimisticMessage(selectedConversationId, optimisticId, response.message);
      closeCaptionModal();
    } catch (error) {
      markOptimisticMessageFailed(selectedConversationId, optimisticId);
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setSendingAttachment(false);
    }
  }

  async function startVoiceRecording() {
    if (!selectedConversationId || isRecordingVoice || isSendingVoice) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAttachmentError(t('attachmentFailed'));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedVoiceMimeType();
      let recorder: MediaRecorder;

      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
        recorder = new MediaRecorder(stream);
      }

      voiceChunksRef.current = [];
      voiceRecordingStartedAtRef.current = Date.now();
      setVoiceRecordingSeconds(0);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start(500);
      voiceRecordingTimerRef.current = setInterval(() => {
        setVoiceRecordingSeconds(Math.max(0, Math.floor((Date.now() - voiceRecordingStartedAtRef.current) / 1000)));
      }, 250);
      setRecordingVoice(true);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    }
  }

  async function stopVoiceRecording(send: boolean) {
    const recorder = mediaRecorderRef.current;

    if (!recorder) {
      return;
    }

    if (voiceRecordingTimerRef.current) {
      clearInterval(voiceRecordingTimerRef.current);
      voiceRecordingTimerRef.current = null;
    }

    if (recorder.state === 'recording') {
      recorder.requestData();
    }

    const stopped = new Promise<void>((resolve) => {
      const previousStop = recorder.onstop;

      recorder.onstop = (event) => {
        previousStop?.call(recorder, event);
        resolve();
      };
    });

    if (recorder.state !== 'inactive') {
      recorder.stop();
      await stopped;
    }
    mediaRecorderRef.current = null;
    setRecordingVoice(false);
    setVoiceRecordingSeconds(0);

    if (!send || !selectedConversationId || voiceChunksRef.current.length === 0) {
      voiceChunksRef.current = [];
      return;
    }

    const blob = new Blob(voiceChunksRef.current, {
      type: recorder.mimeType || 'audio/webm',
    });
    const durationSeconds = Math.max(1, Math.round((Date.now() - voiceRecordingStartedAtRef.current) / 1000));

    voiceChunksRef.current = [];
    await sendVoiceBlob(blob, durationSeconds);
  }

  async function sendVoiceBlob(blob: Blob, durationSeconds: number) {
    if (!selectedConversationId) {
      return;
    }

    setSendingVoice(true);
    setAttachmentError(null);
    const optimisticId = createLocalMessageId();
    const previewUrl = URL.createObjectURL(blob);
    const optimisticMessage = createOptimisticMessage({
      body: '',
      conversationId: selectedConversationId,
      id: optimisticId,
      kind: 'VOICE',
      media: {
        durationSec: durationSeconds,
        id: null,
        mimeType: blob.type || 'audio/webm',
        originalName: `voice-message-${Date.now()}${getVoiceFileExtension(blob.type)}`,
        sizeBytes: blob.size,
        storageKey: '',
      },
      metadata: { previewUrl },
      user,
    });

    addOptimisticMessage(optimisticMessage);

    try {
      const extension = getVoiceFileExtension(blob.type);
      const uploadResponse = await fetch(`${API_URL}/media/upload-binary`, {
        body: blob,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': blob.type || 'audio/webm',
          'x-duration-sec': String(durationSeconds),
          'x-mime-type': blob.type || 'audio/webm',
          'x-original-name': encodeURIComponent(`voice-message-${Date.now()}${extension}`),
        },
        method: 'POST',
      });
      const uploadText = await uploadResponse.text();
      const uploadPayload = uploadText ? JSON.parse(uploadText) : null;

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload?.error || t('attachmentFailed'));
      }

      const response = await authedRequest<{ message: Message }>(`/conversations/${selectedConversationId}/messages`, {
        body: JSON.stringify({
          body: '',
          kind: 'VOICE',
          mediaId: uploadPayload.media.id,
        }),
        method: 'POST',
      });

      replaceOptimisticMessage(selectedConversationId, optimisticId, response.message);
    } catch (error) {
      markOptimisticMessageFailed(selectedConversationId, optimisticId);
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setSendingVoice(false);
    }
  }

  async function openContactPicker() {
    setAttachmentMenuOpen(false);
    setContactPickerOpen(true);
    setContactQuery('');

    if (contacts.length > 0) {
      return;
    }

    setLoadingContacts(true);
    try {
      const response = await authedRequest<{ contacts: AuthUser[] }>('/users/contacts');
      setContacts(response.contacts);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
      setContactPickerOpen(false);
    } finally {
      setLoadingContacts(false);
    }
  }

  async function openNewChat() {
    setNewChatOpen(true);
    setNewChatQuery('');
    setNewChatUsers([]);

    if (contacts.length === 0) {
      const response = await authedRequest<{ contacts: AuthUser[] }>('/users/contacts').catch(() => ({ contacts: [] }));
      setContacts(response.contacts);
    }
  }

  async function openContactsPanel() {
    setActivePanelTab('contacts');
    setContactPickerOpen(false);
    setAddContactOpen(false);
    setNewChatOpen(false);
    if (contacts.length === 0) {
      await loadContacts().catch(() => undefined);
    }
  }

  async function shareOwnMeetVapLink() {
    if (!user?.publicShareCode) {
      setAttachmentError(t('attachmentFailed'));
      return;
    }

    const url = `${API_URL}/c/${user.publicShareCode}`;
    const text = language === 'tr'
      ? `MeetVap'ta beni aç:\n${url}`
      : language === 'ru'
        ? `Откройте меня в MeetVap:\n${url}`
        : `Open me on MeetVap:\n${url}`;

    if (navigator.share) {
      await navigator.share({ text, title: user.displayName || user.username }).catch(() => undefined);
      return;
    }

    await navigator.clipboard.writeText(text);
  }

  function openStatusComposer(mode: 'media' | 'text') {
    setStatusComposerMode(mode);
    setStatusComposerOpen(true);
    setStatusBody('');
    setStatusAudience('CONTACTS');
    setStatusExceptUserIds([]);
    setStatusOnlyUserIds([]);
    if (mode === 'media') {
      setTimeout(() => statusMediaInputRef.current?.click(), 0);
    }
  }

  function getMeetingInviteText(displayName: string, link: string) {
    if (language === 'tr') {
      return `${displayName} seni MeetVap toplantısına davet ediyor. Katılmak için bağlantıya tıkla: ${link}`;
    }

    if (language === 'ru') {
      return `${displayName} приглашает вас на встречу MeetVap. Нажмите ссылку, чтобы присоединиться: ${link}`;
    }

    return `${displayName} invites you to a MeetVap meeting. Click the link to join: ${link}`;
  }

  async function createMeetLink(mode: 'voice' | 'video') {
    setMeetTypeMenuOpen(false);

    try {
      const response = await authedRequest<{ meeting: MeetingInfo; remainingSeconds: number }>('/meetings', {
        body: JSON.stringify({ mode: mode.toUpperCase() }),
        method: 'POST',
      });

      await joinMeetingFromInfo(response.meeting, true);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('createMeetLinkFailed'));
    }
  }

  async function shareMeetingLink(meeting: MeetingInfo) {
    const text = getMeetingInviteText(meeting.creator.displayName || user?.displayName || user?.username || 'MeetVap', meeting.link);

    if (navigator.share) {
      await navigator.share({ text, title: t('createMeetLink'), url: meeting.link }).catch(() => undefined);
      return;
    }

    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  async function copyMeetingLink(meeting: MeetingInfo) {
    const text = getMeetingInviteText(meeting.creator.displayName || user?.displayName || user?.username || 'MeetVap', meeting.link);

    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  async function joinMeetingFromInfo(meeting: MeetingInfo, autoShareLink = false) {
    const displayName = (user?.displayName || user?.username || publicMeetingName || 'Guest').trim();
    const response = await apiRequest<{
      guestId?: string;
      livekit: { roomName: string; token: string; url: string };
      meeting: MeetingInfo;
      participant: MeetingParticipantInfo;
      remainingSeconds: number;
    }>(`/meetings/${encodeURIComponent(meeting.code)}/join`, {
      body: JSON.stringify({
        displayName,
        guestId: user ? undefined : getWebMeetingGuestId(),
      }),
      method: 'POST',
    });

    setPublicMeeting(response.meeting);
    setPublicMeetingRemainingSeconds(response.remainingSeconds);
    setPublicMeetingCode(response.meeting.code);
    setCallWindowPosition(null);
    setCallMaximized(false);
    await connectCall(
      `meeting:${response.meeting.code}`,
      undefined,
      response.meeting.creator.displayName,
      response.meeting.mode,
      response.livekit,
      {
        direction: 'outgoing',
        isMeetingHost: response.participant.role === 'HOST',
        kind: 'meeting',
        markConnectedOnRoomConnect: true,
        meetingCode: response.meeting.code,
        participantId: response.participant.id,
      },
    );

    if (autoShareLink) {
      void shareMeetingLink(response.meeting);
    }
  }

  function closeStatusComposer() {
    if (pendingStatusMedia?.previewUrl) {
      URL.revokeObjectURL(pendingStatusMedia.previewUrl);
    }
    setPendingStatusMedia(null);
    setStatusBody('');
    setStatusComposerOpen(false);
    setStatusAudiencePickerMode(null);
    if (statusMediaInputRef.current) {
      statusMediaInputRef.current.value = '';
    }
  }

  function handleStatusMediaPicked(file: globalThis.File | undefined) {
    if (!file) {
      return;
    }

    if (pendingStatusMedia?.previewUrl) {
      URL.revokeObjectURL(pendingStatusMedia.previewUrl);
    }

    setPendingStatusMedia({
      file,
      kind: file.type.startsWith('video/') ? 'VIDEO' : 'IMAGE',
      previewUrl: URL.createObjectURL(file),
    });
    setStatusComposerMode('media');
    setStatusComposerOpen(true);
  }

  function getStatusAudiencePayload() {
    if (statusAudience === 'CONTACTS_EXCEPT') {
      return { audience: statusAudience, exceptUserIds: statusExceptUserIds };
    }

    if (statusAudience === 'ONLY_SHARE_WITH') {
      return { audience: statusAudience, onlyUserIds: statusOnlyUserIds };
    }

    return { audience: 'CONTACTS' as const };
  }

  function getStatusAudienceLabel() {
    if (statusAudience === 'CONTACTS_EXCEPT') {
      return formatLabel('statusAudienceExceptCount', { count: statusExceptUserIds.length });
    }

    if (statusAudience === 'ONLY_SHARE_WITH') {
      return formatLabel('statusAudienceOnlyCount', { count: statusOnlyUserIds.length });
    }

    return t('contactsOnly');
  }

  async function submitStatus() {
    try {
      if (statusComposerMode === 'text') {
        const body = statusBody.trim();
        if (!body) {
          return;
        }
        const response = await authedRequest<{ status: StatusUpdate }>('/statuses', {
          body: JSON.stringify({
            ...getStatusAudiencePayload(),
            backgroundColor: statusBackgroundColor,
            body,
            kind: 'TEXT',
          }),
          method: 'POST',
        });
        upsertStatus(response.status);
        closeStatusComposer();
        return;
      }

      if (!pendingStatusMedia) {
        statusMediaInputRef.current?.click();
        return;
      }

      const mediaId = await uploadWebMedia(pendingStatusMedia.file, pendingStatusMedia.kind);
      const response = await authedRequest<{ status: StatusUpdate }>('/statuses', {
        body: JSON.stringify({
          ...getStatusAudiencePayload(),
          body: statusBody.trim(),
          kind: pendingStatusMedia.kind,
          mediaId,
        }),
        method: 'POST',
      });
      upsertStatus(response.status);
      closeStatusComposer();
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    }
  }

  function upsertStatus(status: StatusUpdate) {
    const mappedStatus = mapWebStatus(status);
    setStatusGroups((current) => {
      const author = mappedStatus.authorId === user?.id ? user : current.find((group) => group.author.id === mappedStatus.authorId)?.author;
      if (!author) {
        void loadStatuses().catch(() => undefined);
        return current;
      }

      const existingGroup = current.find((group) => group.author.id === mappedStatus.authorId);
      const nextGroup: StatusGroup = {
        author,
        hasUnviewed: mappedStatus.authorId !== user?.id && !mappedStatus.viewedByMe,
        latestAt: mappedStatus.createdAt,
        statuses: [
          ...(existingGroup?.statuses ?? []).filter((item) => item.id !== mappedStatus.id),
          mappedStatus,
        ].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      };

      return sortStatusGroups([
        nextGroup,
        ...current.filter((group) => group.author.id !== mappedStatus.authorId),
      ], user?.id);
    });
  }

  function openStatusGroup(group: StatusGroup, index?: number) {
    const firstUnviewed = group.statuses.findIndex((status) => !status.viewedByMe);
    const nextIndex = typeof index === 'number'
      ? index
      : firstUnviewed >= 0 ? firstUnviewed : 0;

    setStatusViewerGroup(group);
    setStatusViewerIndex(Math.max(0, Math.min(nextIndex, group.statuses.length - 1)));
    setStatusViewerProgress(0);
    setStatusReplyText('');
    const status = group.statuses[nextIndex];
    if (status && status.authorId !== user?.id) {
      void markStatusViewed(status.id);
    }
  }

  async function markStatusViewed(statusId: string) {
    await authedRequest(`/statuses/${statusId}/view`, { method: 'POST' });
    setStatusGroups((current) => current.map((group) => {
      const nextStatuses = group.statuses.map((status) => status.id === statusId ? { ...status, viewedByMe: true } : status);
      return {
        ...group,
        hasUnviewed: nextStatuses.some((status) => status.authorId !== user?.id && !status.viewedByMe),
        statuses: nextStatuses,
      };
    }));
  }

  function openNextStatus() {
    if (!statusViewerGroup) {
      return;
    }

    const nextIndex = statusViewerIndex + 1;
    if (nextIndex >= statusViewerGroup.statuses.length) {
      setStatusViewerGroup(null);
      setStatusViewerIndex(0);
      setStatusViewerProgress(0);
      return;
    }

    setStatusViewerIndex(nextIndex);
    setStatusViewerProgress(0);
    const status = statusViewerGroup.statuses[nextIndex];
    if (status.authorId !== user?.id) {
      void markStatusViewed(status.id);
    }
  }

  function openPreviousStatus() {
    if (!statusViewerGroup) {
      return;
    }

    const nextIndex = Math.max(0, statusViewerIndex - 1);
    setStatusViewerIndex(nextIndex);
    setStatusViewerProgress(0);
    const status = statusViewerGroup.statuses[nextIndex];
    if (status.authorId !== user?.id) {
      void markStatusViewed(status.id);
    }
  }

  async function replyToActiveStatus() {
    if (!activeStatus || !statusReplyText.trim()) {
      return;
    }

    try {
      const response = await authedRequest<{ conversationId: string; message: Message }>(`/statuses/${activeStatus.id}/reply`, {
        body: JSON.stringify({ body: statusReplyText.trim() }),
        method: 'POST',
      });
      mergeConversationMessages(response.conversationId, [response.message]);
      updateConversationPreviewFromMessage(response.message);
      setStatusReplyText('');
      setStatusViewerGroup(null);
      setSelectedConversationId(response.conversationId);
      setActivePanelTab('chats');
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    }
  }

  async function deleteStatus(statusId: string) {
    await authedRequest(`/statuses/${statusId}`, { method: 'DELETE' });
    setStatusGroups((current) => current
      .map((group) => ({ ...group, statuses: group.statuses.filter((status) => status.id !== statusId) }))
      .filter((group) => group.statuses.length > 0));
    setStatusActionTarget(null);
  }

  async function openStatusActions(status: StatusUpdate) {
    setStatusActionTarget(status);
    setStatusActionViewers([]);
    setLoadingStatusViewers(true);
    try {
      const response = await authedRequest<{ viewers: StatusViewer[] }>(`/statuses/${status.id}/views`);
      setStatusActionViewers(response.viewers);
    } catch {
      setStatusActionViewers([]);
    } finally {
      setLoadingStatusViewers(false);
    }
  }

  async function downloadStatus(status: StatusUpdate) {
    if (!status.mediaUri || status.kind === 'TEXT') {
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = status.mediaUri;
    anchor.download = status.media?.originalName || 'status';
    anchor.click();
  }

  async function shareStatus(status: StatusUpdate) {
    if (!status.mediaUri || status.kind === 'TEXT') {
      return;
    }
    const text = status.body.trim() || status.media?.originalName || 'MeetVap status';
    if (navigator.share) {
      await navigator.share({ text, title: text, url: status.mediaUri }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(status.mediaUri);
  }

  async function searchNewChatUsers(value: string) {
    setNewChatQuery(value);

    if (value.trim().length < 2) {
      setNewChatUsers([]);
      return;
    }

    setSearchingUsers(true);
    try {
      const response = await authedRequest<{ users: AuthUser[] }>(`/users/search?q=${encodeURIComponent(value.trim())}`);
      setNewChatUsers(response.users);
    } catch (error) {
      setNewChatUsers([]);
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setSearchingUsers(false);
    }
  }

  async function searchDirectoryUsers(value: string) {
    setDirectoryQuery(value);

    if (value.trim().length < 2) {
      setDirectoryUsers([]);
      return;
    }

    setSearchingDirectory(true);
    try {
      const response = await authedRequest<{ users: AuthUser[] }>(`/users/search?q=${encodeURIComponent(value.trim())}`);
      const contactIds = new Set(contacts.map((contact) => contact.id));
      setDirectoryUsers(response.users.filter((item) => item.id !== user?.id && !contactIds.has(item.id)));
    } catch (error) {
      setDirectoryUsers([]);
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setSearchingDirectory(false);
    }
  }

  async function addContactFromDirectory(peer: AuthUser) {
    setStartingUserId(peer.id);
    try {
      const response = await authedRequest<{ contact: AuthUser }>('/users/contacts', {
        body: JSON.stringify({ userId: peer.id }),
        method: 'POST',
      });
      setContacts((current) => [
        response.contact,
        ...current.filter((contact) => contact.id !== response.contact.id),
      ]);
      setConversations((current) => current.map((conversation) => (
        conversation.otherUserId === response.contact.id ? { ...conversation, isContact: true } : conversation
      )));
      setDirectoryUsers((current) => current.filter((item) => item.id !== response.contact.id));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setStartingUserId(null);
    }
  }

  async function startDirectChat(peer: AuthUser) {
    setStartingUserId(peer.id);
    try {
      const response = await authedRequest<{ conversation: Conversation }>('/conversations/direct', {
        body: JSON.stringify({ userId: peer.id }),
        method: 'POST',
      });
      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ]);
      setSelectedConversationId(response.conversation.id);
      if (forwardingMessage) {
        await forwardMessageToConversation(response.conversation.id, forwardingMessage);
        setForwardingMessage(null);
      }
      setNewChatOpen(false);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setStartingUserId(null);
    }
  }

  async function updateWebProfile(field: 'displayName' | 'username') {
    if (!user) {
      return;
    }

    const currentValue = field === 'displayName' ? user.displayName : user.username;
    const nextValue = window.prompt(t(field === 'displayName' ? 'displayName' : 'nickname'), currentValue)?.trim();

    if (!nextValue || nextValue === currentValue) {
      return;
    }

    const response = await authedRequest<{ user: AuthUser }>('/users/me/profile', {
      body: JSON.stringify({ [field]: field === 'username' ? nextValue.toLowerCase() : nextValue }),
      method: 'PATCH',
    });

    setUser(response.user);
  }

  async function updateWebAvatar(file: globalThis.File) {
    setAttachmentError(null);

    try {
      const uploadResponse = await fetch(`${API_URL}/media/upload-binary`, {
        body: file,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'image/jpeg',
          'x-mime-type': file.type || 'image/jpeg',
          'x-original-name': encodeURIComponent(file.name || 'profile.jpg'),
        },
        method: 'POST',
      });
      const uploadText = await uploadResponse.text();
      const uploadPayload = uploadText ? JSON.parse(uploadText) : null;

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload?.error || t('attachmentFailed'));
      }

      const avatarUrl = `${API_URL}/media/${uploadPayload.media.id}/file`;
      const response = await authedRequest<{ user: AuthUser }>('/users/me/avatar', {
        body: JSON.stringify({ avatarUrl }),
        method: 'POST',
      });

      setUser(response.user);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      if (avatarInputRef.current) {
        avatarInputRef.current.value = '';
      }
    }
  }

  async function removeWebAvatar() {
    const response = await authedRequest<{ user: AuthUser }>('/users/me/avatar', {
      body: JSON.stringify({ avatarUrl: null }),
      method: 'POST',
    });

    setUser(response.user);
  }

  async function updateWebPrivacy(update: Partial<Pick<AuthUser, 'hideFromSearch' | 'hideNickname' | 'showLastSeen' | 'useGroupAliases'>>) {
    const response = await authedRequest<{ user: AuthUser }>('/users/me/privacy', {
      body: JSON.stringify(update),
      method: 'PATCH',
    });

    setUser(response.user);
  }

  function updateWebLanguage(nextLanguage: Language) {
    localStorage.setItem(WEB_LANGUAGE_KEY, nextLanguage);
    setLanguage(nextLanguage);
  }

  async function updateGroupSettings(conversation: Conversation, update: Partial<Pick<Conversation, 'hideMembers' | 'ownerOnlyMessages' | 'showMemberCount'>>) {
    const response = await authedRequest<{ conversation: Conversation }>(`/conversations/${conversation.id}/settings`, {
      body: JSON.stringify(update),
      method: 'PATCH',
    });

    setConversations((current) => current.map((item) => item.id === conversation.id ? response.conversation : item));
  }

  async function runChatHeaderAction(action: 'block' | 'delete' | 'group-details' | 'mute' | 'report' | 'unblock' | 'unmute', conversation: Conversation) {
    setChatHeaderMenuOpen(false);

    if (action === 'group-details') {
      setGroupDetailsOpen(true);
      return;
    }

    await runChatAction(action, conversation);
  }

  async function startContactCall(contact: AuthUser, mode: 'voice' | 'video') {
    if (!window.confirm(t(mode === 'video' ? 'startVideoCall' : 'startVoiceCall'))) {
      return;
    }

    const response = await authedRequest<{ conversation: Conversation }>('/conversations/direct', {
      body: JSON.stringify({ userId: contact.id }),
      method: 'POST',
    });
    setConversations((current) => [
      response.conversation,
      ...current.filter((conversation) => conversation.id !== response.conversation.id),
    ]);
    setSelectedConversationId(response.conversation.id);
    setActivePanelTab('chats');
    await startCallForConversation(response.conversation, mode);
  }

  async function startCallFromLog(callLog: CallLog, mode: 'voice' | 'video') {
    const conversation = conversations.find((item) => item.id === callLog.conversationId);

    if (!conversation) {
      return;
    }

    if (!window.confirm(t(mode === 'video' ? 'startVideoCall' : 'startVoiceCall'))) {
      return;
    }

    setSelectedConversationId(conversation.id);
    await startCallForConversation(conversation, mode);
  }

  async function forwardMessageToConversation(conversationId: string, message: Message) {
    let mediaId = message.mediaId ?? message.media?.id;

    async function sendForward(nextMediaId: string | null | undefined) {
      return authedRequest<{ message: Message }>(`/conversations/${conversationId}/messages`, {
        body: JSON.stringify({
          body: message.body,
          kind: message.kind,
          mediaId: nextMediaId,
          metadata: { forwarded: true },
        }),
        method: 'POST',
      });
    }

    let response: { message: Message };

    try {
      response = await sendForward(mediaId);
    } catch (error) {
      if (message.kind === 'TEXT' || !message.media?.id) {
        throw error;
      }

      const cachedBlob = await getCachedMediaBlob(message.media.id);

      if (!cachedBlob) {
        throw new Error('Media is no longer available');
      }

      const uploadResponse = await fetch(`${API_URL}/media/upload-binary`, {
        body: cachedBlob,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': cachedBlob.type || message.media.mimeType || 'application/octet-stream',
          'x-mime-type': cachedBlob.type || message.media.mimeType || 'application/octet-stream',
          'x-original-name': encodeURIComponent(message.media.originalName || 'attachment'),
        },
        method: 'POST',
      });
      const uploadText = await uploadResponse.text();
      const uploadPayload = uploadText ? JSON.parse(uploadText) : null;

      if (!uploadResponse.ok) {
        throw new Error(uploadPayload?.error || t('attachmentFailed'));
      }

      mediaId = uploadPayload.media.id;
      response = await sendForward(mediaId);
    }

    mergeConversationMessages(conversationId, [response.message]);
    updateConversationPreviewFromMessage(response.message);
  }

  async function runMessageAction(action: MessageContextAction, message: Message) {
    setContextMenu(null);

    if (action === 'copy') {
      await navigator.clipboard.writeText(message.body);
      return;
    }
    if (action === 'copy-image') {
      await copyImageMessageToClipboard(message, token);
      return;
    }
    if (action === 'reply') {
      setReplyingTo(message);
      setActivePanelTab('chats');
      setTimeout(() => composerTextareaRef.current?.focus(), 0);
      return;
    }
    if (action === 'forward') {
      setForwardingMessage(message);
      await openNewChat();
      return;
    }
    if (action === 'pin') {
      const pin = await authedRequest<PinnedMessage>(`/conversations/${message.conversationId}/messages/${message.id}/pin`, {
        body: JSON.stringify({ scope: 'me' }),
        method: 'POST',
      });
      setPinnedMessages((current) => [pin, ...current.filter((item) => item.message.id !== message.id)]);
      return;
    }
    if (action === 'unpin') {
      await authedRequest(`/conversations/${message.conversationId}/messages/${message.id}/pin`, {
        body: JSON.stringify({ scope: 'me' }),
        method: 'DELETE',
      });
      setPinnedMessages((current) => current.filter((item) => item.message.id !== message.id));
      return;
    }
    if (action === 'download' && message.media?.id) {
      const anchor = document.createElement('a');
      anchor.href = `${API_URL}/media/${message.media.id}/file`;
      anchor.download = message.media.originalName;
      anchor.click();
      return;
    }
    if (action === 'edit') {
      const body = window.prompt(t('edit'), message.body)?.trim();

      if (!body || body === message.body) {
        return;
      }
      await authedRequest(`/conversations/${message.conversationId}/messages/${message.id}`, {
        body: JSON.stringify({ body }),
        method: 'PATCH',
      });
      setMessagesByConversation((current) => {
        const nextMessages = (current[message.conversationId] ?? []).map((item) => item.id === message.id ? { ...item, body } : item);

        cacheConversationMessages(user?.id, message.conversationId, nextMessages);
        return {
          ...current,
          [message.conversationId]: nextMessages,
        };
      });
      return;
    }
    if (action === 'report') {
      await authedRequest('/reports', {
        body: JSON.stringify({
          conversationId: message.conversationId,
          reason: 'Reported from MeetVap Web',
          targetId: message.id,
          targetType: 'MESSAGE',
        }),
        method: 'POST',
      });
      return;
    }

    await authedRequest(`/conversations/${message.conversationId}/messages/${message.id}`, {
      body: JSON.stringify({ mode: action === 'delete-all' ? 'all' : 'me' }),
      method: 'DELETE',
    });
    setMessagesByConversation((current) => {
      const nextMessages = (current[message.conversationId] ?? []).filter((item) => item.id !== message.id);

      cacheConversationMessages(user?.id, message.conversationId, nextMessages);
      return {
        ...current,
        [message.conversationId]: nextMessages,
      };
    });
  }

  async function runChatAction(action: 'add-contact' | 'block' | 'delete' | 'mute' | 'report' | 'unblock' | 'unmute', conversation: Conversation) {
    setContextMenu(null);

    if (action === 'mute' || action === 'unmute') {
      const response = await authedRequest<{ conversation: Conversation }>(`/conversations/${conversation.id}/mute`, {
        body: JSON.stringify({ muted: action === 'mute' }),
        method: 'PATCH',
      });
      setConversations((current) => current.map((item) => item.id === conversation.id ? response.conversation : item));
      return;
    }
    if (action === 'delete') {
      if (!window.confirm(t('delete'))) {
        return;
      }
      await authedRequest(`/conversations/${conversation.id}`, {
        body: JSON.stringify({ mode: 'me' }),
        method: 'DELETE',
      });
      setConversations((current) => current.filter((item) => item.id !== conversation.id));
      if (selectedConversationId === conversation.id) {
        setSelectedConversationId(null);
      }
      return;
    }
    if (action === 'report') {
      await authedRequest('/reports', {
        body: JSON.stringify({
          conversationId: conversation.id,
          reason: 'Reported from MeetVap Web',
          targetId: conversation.type === 'GROUP' ? conversation.id : conversation.otherUserId,
          targetType: conversation.type === 'GROUP' ? 'GROUP' : 'USER',
        }),
        method: 'POST',
      });
      return;
    }

    const peerId = conversation.otherUserId;
    if (!peerId) {
      return;
    }
    if (action === 'add-contact') {
      await authedRequest('/users/contacts', {
        body: JSON.stringify({ userId: peerId }),
        method: 'POST',
      });
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, isContact: true } : item));
      return;
    }

    await authedRequest(action === 'block' ? '/users/blocks' : `/users/blocks/${peerId}`, {
      body: action === 'block' ? JSON.stringify({ userId: peerId }) : undefined,
      method: action === 'block' ? 'POST' : 'DELETE',
    });
    setBlockedUserIds((current) => {
      const next = new Set(current);
      action === 'block' ? next.add(peerId) : next.delete(peerId);
      return next;
    });
  }

  async function runContactAction(action: ContactContextAction, contact: AuthUser) {
    setContextMenu(null);

    if (action === 'chat') {
      await startDirectChat(contact);
      setActivePanelTab('chats');
      return;
    }
    if (action === 'voice' || action === 'video') {
      await startContactCall(contact, action);
      return;
    }
    if (action === 'share') {
      const url = contact.publicShareCode
        ? `https://meetvap.com/u/${encodeURIComponent(contact.publicShareCode)}`
        : '';
      const text = url ? `${contact.displayName || contact.username}\n${url}` : contact.displayName || contact.username;
      if (navigator.share) {
        await navigator.share({ text, title: contact.displayName || contact.username });
      } else {
        await navigator.clipboard.writeText(text);
      }
      return;
    }
    if (action === 'delete-contact') {
      await authedRequest(`/users/contacts/${contact.id}`, { method: 'DELETE' });
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      setConversations((current) => current.map((conversation) => (
        conversation.otherUserId === contact.id ? { ...conversation, isContact: false } : conversation
      )));
      return;
    }
    if (action === 'block') {
      await authedRequest('/users/blocks', {
        body: JSON.stringify({ userId: contact.id }),
        method: 'POST',
      });
      setBlockedUserIds((current) => new Set(current).add(contact.id));
      return;
    }
    await authedRequest('/reports', {
      body: JSON.stringify({
        reason: 'Reported from MeetVap Web',
        targetId: contact.id,
        targetType: 'USER',
      }),
      method: 'POST',
    });
  }

  async function sendContact(contact: AuthUser) {
    if (!selectedConversationId || !contact.publicShareCode) {
      setAttachmentError(t('attachmentFailed'));
      return;
    }

    setSendingAttachment(true);
    try {
      const url = `https://meetvap.com/u/${encodeURIComponent(contact.publicShareCode)}`;
      const body = language === 'tr'
        ? `${contact.displayName} kişisini MeetVap'ta aç:\n${url}`
        : language === 'ru'
          ? `Открыть ${contact.displayName} в MeetVap:\n${url}`
          : `Open ${contact.displayName} on MeetVap:\n${url}`;
      const response = await authedRequest<{ message: Message }>(`/conversations/${selectedConversationId}/messages`, {
        body: JSON.stringify({ body, kind: 'TEXT' }),
        method: 'POST',
      });

      mergeConversationMessages(selectedConversationId, [response.message]);
      updateConversationPreviewFromMessage(response.message);
      setContactPickerOpen(false);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setSendingAttachment(false);
    }
  }

  async function startCall(mode: 'voice' | 'video') {
    if (!selectedConversation) {
      return;
    }

    if (!window.confirm(t(mode === 'video' ? 'startVideoCall' : 'startVoiceCall'))) {
      return;
    }

    await startCallForConversation(selectedConversation, mode);
  }

  async function startCallForConversation(conversation: Conversation, mode: 'voice' | 'video') {
    const previousCall = callStateRef.current;

    if (previousCall) {
      await authedRequest(`/calls/${previousCall.callId}/end`, { method: 'POST' }).catch(() => undefined);
      closeCurrentCallLocally();
    }

    const response = await authedRequest<{ call: { id: string }; livekit?: { token: string; url: string } | null }>('/calls', {
      body: JSON.stringify({ conversationId: conversation.id, mode: mode.toUpperCase() }),
      method: 'POST',
    });

    setCallWindowPosition(null);
    setCallMaximized(false);
    setCallState({
      callId: response.call.id,
      connectedAt: null,
      conversationId: conversation.id,
      direction: 'outgoing',
      mode,
      phase: 'dialing',
      room: null,
      title: conversation.title,
    });

    if (response.livekit) {
      await connectCall(response.call.id, conversation.id, conversation.title, mode, response.livekit, {
        direction: 'outgoing',
        markConnectedOnRoomConnect: false,
      });
    }
  }

  async function answerIncomingCall() {
    if (!incomingCall) {
      return;
    }

    const response = await authedRequest<{ call: { id: string }; livekit?: { token: string; url: string } | null }>(`/calls/${incomingCall.callId}/answer`, {
      body: JSON.stringify({
        answerClientId: getWebCallAnswerClientId(),
        answerSurface: 'web',
      }),
      method: 'POST',
    });
    const conversation = conversations.find((item) => item.id === incomingCall.conversationId);
    const mode = incomingCall.mode.toLowerCase() as 'voice' | 'video';

    setIncomingCall(null);
    stopIncomingRingtone();
    setCallWindowPosition(null);
    setCallMaximized(false);
    setCallState({
      callId: incomingCall.callId,
      connectedAt: null,
      conversationId: incomingCall.conversationId,
      direction: 'incoming',
      mode,
      phase: 'connecting',
      room: null,
      title: conversation?.title ?? incomingCall.fromDisplayName ?? 'Call',
    });
    if (response.livekit) {
      await connectCall(incomingCall.callId, incomingCall.conversationId, conversation?.title ?? incomingCall.fromDisplayName ?? 'Call', mode, response.livekit, {
        direction: 'incoming',
        markConnectedOnRoomConnect: true,
      });
    }
  }

  async function declineIncomingCall() {
    const currentIncomingCall = incomingCall;

    if (!currentIncomingCall) {
      return;
    }

    setIncomingCall(null);
    stopIncomingRingtone();
    await authedRequest(`/calls/${currentIncomingCall.callId}/end`, {
      method: 'POST',
    }).catch(() => undefined);
  }

  async function connectCall(
    callId: string,
    conversationId: string | undefined,
    title: string,
    mode: 'voice' | 'video',
    livekit: { token: string; url: string },
    options?: {
      direction?: 'incoming' | 'outgoing';
      isMeetingHost?: boolean;
      kind?: 'call' | 'meeting';
      markConnectedOnRoomConnect?: boolean;
      meetingCode?: string;
      participantId?: string;
    },
  ) {
    if (activeCallConnectPromiseRef.current && activeCallConnectCallIdRef.current === callId) {
      await activeCallConnectPromiseRef.current;
      return;
    }

    await closeVoiceRoom(false);
    const existingCall = callStateRef.current;

    if (existingCall?.callId !== callId) {
      closeCurrentCallLocally();
      setCallWindowPosition(null);
      setCallMaximized(false);
    } else {
      existingCall.room?.disconnect();
    }

    setCallState({
      callId,
      connectedAt: null,
      conversationId,
      direction: options?.direction ?? existingCall?.direction ?? 'incoming',
      isMeetingHost: options?.isMeetingHost,
      kind: options?.kind ?? 'call',
      meetingCode: options?.meetingCode,
      mode,
      participantId: options?.participantId,
      phase: options?.markConnectedOnRoomConnect === false ? existingCall?.phase ?? 'dialing' : 'connecting',
      room: null,
      title,
    });

    const connectPromise = (async () => {
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          dtx: true,
          red: true,
          stopMicTrackOnMute: false,
        },
      });

      await room.connect(livekit.url, livekit.token);
      const microphonePublishPromise = room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
        setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
      });
      const cameraPublishPromise = mode === 'video'
        ? publishWebCallCamera(room).catch((error) => {
            setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
          })
        : Promise.resolve();

      setCallState((current) => {
        if (current?.callId !== callId) {
          room.disconnect();
          return current;
        }

        return {
          ...current,
          connectedAt: options?.markConnectedOnRoomConnect === false ? current.connectedAt : Date.now(),
          phase: options?.markConnectedOnRoomConnect === false ? current.phase : 'connected',
          room,
        };
      });
      await Promise.allSettled([microphonePublishPromise, cameraPublishPromise]);
    })();

    activeCallConnectPromiseRef.current = connectPromise;
    activeCallConnectCallIdRef.current = callId;

    try {
      await connectPromise;
    } finally {
      if (activeCallConnectPromiseRef.current === connectPromise) {
        activeCallConnectPromiseRef.current = null;
        activeCallConnectCallIdRef.current = null;
      }
    }
  }

  async function publishWebCallCamera(
    room: Room,
  ) {
    const existingCamera = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const publishingQuality = getWebCallPublishingQuality(webCallUplinkProfileRef.current);

    if (existingCamera?.track && !existingCamera.isMuted) {
      (existingCamera.track as LocalVideoTrack).setPublishingQuality(publishingQuality);
      return;
    }

    await room.localParticipant.setCameraEnabled(
      true,
      getWebCallVideoCaptureOptions(),
      getWebCallVideoPublishOptions(),
    );
    const publishedCamera = room.localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    publishedCamera?.setPublishingQuality(publishingQuality);
  }

  function isLocalCameraEnabled(room: Room) {
    const cameraPublication = room.localParticipant.getTrackPublication(Track.Source.Camera);

    return !!cameraPublication?.track &&
      !cameraPublication.isMuted &&
      cameraPublication.track.mediaStreamTrack.enabled !== false &&
      cameraPublication.track.mediaStreamTrack.readyState !== 'ended';
  }

  async function restoreCameraAfterScreenShare(room: Room) {
    setScreenSharing(false);
    setStartingScreenShare(false);

    if (!screenShareRestoreCameraRef.current) {
      return;
    }

    screenShareRestoreCameraRef.current = false;
    await publishWebCallCamera(room);
  }

  async function startScreenShare() {
    const currentCall = callStateRef.current;
    const room = currentCall?.room;

    if (!room || currentCall.mode !== 'video' || isStartingScreenShare || isScreenSharing) {
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setAttachmentError(t('attachmentFailed'));
      return;
    }

    setStartingScreenShare(true);
    const shouldRestoreCamera = isLocalCameraEnabled(room);
    screenShareRestoreCameraRef.current = shouldRestoreCamera;

    try {
      if (shouldRestoreCamera) {
        await room.localParticipant.setCameraEnabled(false);
      }

      await room.localParticipant.setScreenShareEnabled(
        true,
        WEB_CALL_SCREEN_SHARE_CAPTURE_OPTIONS,
        WEB_CALL_SCREEN_SHARE_PUBLISH_OPTIONS,
      );
      setScreenSharing(true);
    } catch (error) {
      screenShareRestoreCameraRef.current = false;
      if (shouldRestoreCamera) {
        await publishWebCallCamera(room).catch(() => undefined);
      }
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    } finally {
      setStartingScreenShare(false);
    }
  }

  async function stopScreenShare() {
    const currentCall = callStateRef.current;
    const room = currentCall?.room;

    if (!room) {
      setScreenSharing(false);
      setStartingScreenShare(false);
      return;
    }

    try {
      await room.localParticipant.setScreenShareEnabled(false);
      await restoreCameraAfterScreenShare(room);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    }
  }

  async function connectAnsweredOutgoingCall(call: CallState) {
    setCallState((current) => current?.callId === call.callId
      ? { ...current, phase: 'connecting' }
      : current);
    const livekit = await authedRequest<{ token: string; url: string }>(`/calls/${call.callId}/token`);

    await connectCall(call.callId, call.conversationId, call.title, call.mode, livekit, {
      direction: 'outgoing',
      markConnectedOnRoomConnect: true,
    });
  }

  async function joinVoiceRoom(conversation: Conversation) {
    setVoiceRoom((current) => ({
      conversationId: conversation.id,
      isConnecting: true,
      isSelfMuted: true,
      isSpeakerMuted: current?.conversationId === conversation.id ? current.isSpeakerMuted : false,
      participants: current?.conversationId === conversation.id ? current.participants : [],
      room: null,
    }));

    try {
      const response = await authedRequest<{
        participant: VoiceRoomParticipant;
        token: string;
        url: string;
      }>(`/conversations/${conversation.id}/voice-room/join`, { method: 'POST' });
      const room = new Room({ adaptiveStream: true, dynacast: true });

      await room.connect(response.url, response.token);
      await room.localParticipant.setMicrophoneEnabled(false);
      await refreshVoiceRoomParticipants(conversation.id);
      setVoiceRoom((current) => ({
        conversationId: conversation.id,
        isConnecting: false,
        isSelfMuted: response.participant.selfMuted,
        isSpeakerMuted: current?.isSpeakerMuted ?? false,
        participants: current?.participants ?? [response.participant],
        room,
      }));
    } catch (error) {
      setVoiceRoom(null);
      setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed'));
    }
  }

  async function refreshVoiceRoomParticipants(conversationId = voiceRoom?.conversationId) {
    if (!conversationId) {
      return;
    }

    const response = await authedRequest<{ participants: VoiceRoomParticipant[] }>(
      `/conversations/${conversationId}/voice-room/participants?limit=100`,
    );
    setVoiceRoom((current) => current && current.conversationId === conversationId
      ? { ...current, participants: response.participants }
      : current);
  }

  async function closeVoiceRoom(sendLeave = true) {
    const current = voiceRoom;

    if (!current) {
      return;
    }

    current.room?.disconnect();
    setVoiceRoom(null);
    if (sendLeave) {
      await authedRequest(`/conversations/${current.conversationId}/voice-room/leave`, { method: 'POST' }).catch(() => undefined);
    }
  }

  async function setVoiceRoomSelfMuted(nextMuted: boolean) {
    const current = voiceRoom;

    if (!current?.room) {
      return;
    }

    await current.room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setVoiceRoom((state) => state ? { ...state, isSelfMuted: nextMuted } : state);
    await authedRequest(`/conversations/${current.conversationId}/voice-room/participants/${user?.id}`, {
      body: JSON.stringify({ selfMuted: nextMuted }),
      method: 'PATCH',
    }).catch(() => undefined);
    void refreshVoiceRoomParticipants(current.conversationId);
  }

  function setVoiceRoomSpeakerMuted(nextMuted: boolean) {
    const current = voiceRoom;

    if (!current?.room) {
      return;
    }

    current.room.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications.forEach((publication) => {
        if (publication.track) {
          setRemoteTrackVolume(publication.track, nextMuted ? 0 : 1);
        }
      });
    });
    setVoiceRoom((state) => state ? { ...state, isSpeakerMuted: nextMuted } : state);
  }

  function closeCurrentCallLocally() {
    stopIncomingRingtone();
    stopOutgoingRingback();
    setCallState((current) => {
      current?.room?.disconnect();
      return null;
    });
    callStateRef.current = null;
    activeCallConnectCallIdRef.current = null;
    activeCallConnectPromiseRef.current = null;
    screenShareRestoreCameraRef.current = false;
    webCallUplinkProfileRef.current = 'degraded';
    webCallDownlinkProfileRef.current = 'degraded';
    webCallUplinkLastSwitchAtRef.current = 0;
    webCallDownlinkLastSwitchAtRef.current = 0;
    webCallUplinkStableSinceRef.current = 0;
    webCallDownlinkStableSinceRef.current = 0;
    webCallUplinkBadSamplesRef.current = 0;
    webCallDownlinkBadSamplesRef.current = 0;
    webCallRtcStatsPreviousByIdRef.current.clear();
    setScreenSharing(false);
    setStartingScreenShare(false);
    setCallWindowPosition(null);
    setCallMaximized(false);
  }

  async function endCurrentCall() {
    const currentCall = callState;

    if (!currentCall) {
      return;
    }

    if (currentCall.kind === 'meeting' && currentCall.meetingCode) {
      try {
        if (currentCall.isMeetingHost) {
          const response = await apiRequest<{ meeting: MeetingInfo; usage?: MeetingEndSummary }>(
            `/meetings/${encodeURIComponent(currentCall.meetingCode)}/end`,
            { method: 'POST' },
          );

          setPublicMeeting(response.meeting);
          closeCurrentCallLocally();
          if (response.usage) {
            setMeetingEndSummary(response.usage);
          }
        } else {
          await apiRequest(`/meetings/${encodeURIComponent(currentCall.meetingCode)}/leave`, {
            body: JSON.stringify({ participantId: currentCall.participantId }),
            method: 'POST',
          }).catch(() => undefined);
          closeCurrentCallLocally();
        }
      } catch (error) {
        setAttachmentError(error instanceof Error ? error.message : t('meetingOpenFailed'));
      }
      return;
    }

    const endRequest = authedRequest(`/calls/${currentCall.callId}/end`, {
      method: 'POST',
    });
    closeCurrentCallLocally();
    await endRequest.catch(() => undefined);
  }

  function beginDraggingCallWindow(event: React.PointerEvent<HTMLElement>) {
    if (isCallMaximized || !callWindowRef.current) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('button')) {
      return;
    }

    const bounds = callWindowRef.current.getBoundingClientRect();
    const offsetX = event.clientX - bounds.left;
    const offsetY = event.clientY - bounds.top;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    const handleMove = (moveEvent: PointerEvent) => {
      const maxX = Math.max(0, window.innerWidth - bounds.width);
      const maxY = Math.max(0, window.innerHeight - bounds.height);
      setCallWindowPosition({
        x: Math.min(maxX, Math.max(0, moveEvent.clientX - offsetX)),
        y: Math.min(maxY, Math.max(0, moveEvent.clientY - offsetY)),
      });
    };
    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  }

  if (!token && publicMeetingCode) {
    return (
      <div className="meeting-public-shell">
        <div className="meeting-lobby-card">
          <div className="meeting-lobby-icon">
            {publicMeeting?.mode === 'voice' ? <Phone aria-hidden size={34} /> : <Video aria-hidden size={34} />}
          </div>
          <h1>{publicMeeting?.creator.displayName ?? 'MeetVap'}</h1>
          <p>{isPublicMeetingLoading
            ? t('loading')
            : publicMeeting
              ? `${publicMeeting.mode === 'voice' ? t('voiceMeet') : t('videoMeet')} · ${formatLabel('meetingRemaining', { time: formatRecorderDuration(publicMeetingRemainingSeconds) })}`
              : t('meetingNotFound')}</p>
          {!callState ? (
            <>
              <input
                autoComplete="name"
                disabled={isPublicMeetingJoining}
                onChange={(event) => setPublicMeetingName(event.target.value)}
                placeholder={t('meetingNamePlaceholder')}
                value={publicMeetingName}
              />
              <button
                disabled={!publicMeeting || publicMeeting.status !== 'active' || isPublicMeetingJoining || !publicMeetingName.trim()}
                onClick={() => {
                  if (!publicMeeting) {
                    return;
                  }

                  setPublicMeetingJoining(true);
                  void joinMeetingFromInfo(publicMeeting)
                    .catch((error) => setAttachmentError(error instanceof Error ? error.message : t('meetingJoinFailed')))
                    .finally(() => setPublicMeetingJoining(false));
                }}
              >
                {isPublicMeetingJoining ? <LoaderCircle aria-hidden className="spin" size={18} /> : <PhoneIncoming aria-hidden size={18} />}
                <span>{t('joinMeet')}</span>
              </button>
            </>
          ) : null}
        </div>
        {callState ? (
          <div className={`call-overlay ${isCallMaximized ? 'maximized' : ''}`}>
            <div
              className={`call-window ${isCallMaximized ? 'maximized' : ''}`}
              ref={callWindowRef}
              style={callWindowPosition && !isCallMaximized ? {
                bottom: 'auto',
                left: callWindowPosition.x,
                right: 'auto',
                top: callWindowPosition.y,
              } : undefined}
            >
              <header className="call-window-header" onPointerDown={beginDraggingCallWindow}>
                <div className="call-title">
                  <strong>{callState.title}</strong>
                  <span>{callState.phase === 'connected'
                    ? formatRecorderDuration(callElapsedSeconds)
                    : t(callState.phase === 'ringing'
                      ? 'callRinging'
                      : callState.phase === 'connecting'
                        ? 'callConnecting'
                        : 'callDialing')}</span>
                </div>
                <div className="call-window-actions">
                  <button aria-label={isCallMaximized ? t('restore') : t('maximize')} className="icon-button secondary" onClick={() => setCallMaximized((current) => !current)} title={isCallMaximized ? t('restore') : t('maximize')}>
                    {isCallMaximized ? <Minimize2 aria-hidden size={18} /> : <Maximize2 aria-hidden size={18} />}
                  </button>
                  <button aria-label={t('end')} className="end-call-button" onClick={() => void endCurrentCall()} title={t('end')}>
                    <PhoneOff aria-hidden size={18} />
                    <span>{t('end')}</span>
                  </button>
                </div>
              </header>
              <div ref={remoteMediaRef} className="remote-media">
                {!callState.room ? (
                  <div className="call-waiting-state">
                    {callState.mode === 'video' ? <Video aria-hidden size={46} /> : <Phone aria-hidden size={46} />}
                    <strong>{callState.phase === 'connected' ? t('joinMeet') : t('callConnecting')}</strong>
                  </div>
                ) : null}
              </div>
              {callState.mode === 'video' && callState.room ? <video ref={localVideoRef} autoPlay muted playsInline className={`local-video ${isScreenSharing ? 'hidden' : ''}`} /> : null}
              {callState.mode === 'video' && callState.room && isScreenSharing ? (
                <div className="screen-share-preview">
                  <video ref={screenSharePreviewRef} autoPlay muted playsInline />
                  <button onClick={() => void stopScreenShare()}>
                    <X aria-hidden size={16} />
                    <span>{t('stopSharing')}</span>
                  </button>
                </div>
              ) : null}
              <footer>
                <button disabled={!callState.room} aria-label={t('microphone')} onClick={() => void callState.room?.localParticipant.setMicrophoneEnabled(!callState.room.localParticipant.isMicrophoneEnabled)} title={t('microphone')}>
                  <Mic aria-hidden size={18} />
                  <span>{t('microphone')}</span>
                </button>
                {callState.mode === 'video' ? (
                  <>
                    <button disabled={!callState.room || isScreenSharing} aria-label={t('camera')} onClick={() => void callState.room?.localParticipant.setCameraEnabled(!callState.room.localParticipant.isCameraEnabled)} title={t('camera')}>
                      <Video aria-hidden size={18} />
                      <span>{t('camera')}</span>
                    </button>
                    <button className={isScreenSharing ? 'screen-share-active' : ''} disabled={!callState.room || isStartingScreenShare} aria-label={isScreenSharing ? t('stopSharing') : t('shareScreen')} onClick={() => void (isScreenSharing ? stopScreenShare() : startScreenShare())} title={isScreenSharing ? t('stopSharing') : t('shareScreen')}>
                      {isStartingScreenShare ? <LoaderCircle aria-hidden className="spin" size={18} /> : <ScreenShare aria-hidden size={18} />}
                      <span>{isScreenSharing ? t('stopSharing') : t('shareScreen')}</span>
                    </button>
                  </>
                ) : null}
              </footer>
            </div>
          </div>
        ) : null}
        {attachmentError ? (
          <div className="attachment-error public-error">
            <span>{attachmentError}</span>
            <button onClick={() => setAttachmentError(null)}><X aria-hidden size={16} /></button>
          </div>
        ) : null}
        {meetingEndSummary ? (
          <MeetingEndSummaryModal
            onClose={() => setMeetingEndSummary(null)}
            summary={meetingEndSummary}
            t={t}
          />
        ) : null}
      </div>
    );
  }

  if (!token) {
    return <PairingScreen onPaired={(nextToken) => {
      localStorage.setItem(TOKEN_KEY, nextToken);
      setToken(nextToken);
    }} />;
  }

  return (
    <div className="app-shell">
      <aside className="conversation-panel">
        <div className="brand">
          <span>MeetVap Web</span>
          <div className="brand-actions">
            <button aria-label={t('createMeetLink')} onClick={() => setMeetTypeMenuOpen(true)} title={t('createMeetLink')}>
              <Video aria-hidden size={20} />
            </button>
            <button aria-label={t('contacts')} onClick={() => void openContactsPanel()} title={t('contacts')}>
              <BookUser aria-hidden size={20} />
            </button>
            {activePanelTab === 'contacts' ? (
            <button aria-label={t('addContact')} onClick={() => {
              setAddContactOpen(true);
              setDirectoryQuery('');
              setDirectoryUsers([]);
            }} title={t('addContact')}>
              <UserPlus aria-hidden size={21} />
            </button>
            ) : (
              <button aria-label={t('newChat')} onClick={() => void openNewChat()} title={t('newChat')}>
                <MessageCirclePlus aria-hidden size={21} />
              </button>
            )}
          </div>
        </div>
        <div className="panel-content">
          {activePanelTab === 'chats' ? conversations.map((conversation) => {
            const conversationMessages = messagesByConversation[conversation.id] ?? [];
            const latestLocalMessage = findLatestMessage(conversationMessages);
            const displayConversation = applyLocalConversationPreview(conversation, conversationMessages);
            const displayLastMessageStatus = getDisplayConversationLastMessageStatus(
              displayConversation,
              latestLocalMessage,
            );
            const previewText = getConversationPreviewTextWithLocalFallback(
              displayConversation,
              conversationMessages,
              t,
            );
            const peer = getConversationPeer(conversation, user?.id);
            const shouldShowOnlineDot = conversation.type === 'DIRECT' && peer?.isOnline === true;

            return (
              <button
                className={`conversation ${conversation.id === selectedConversationId ? 'active' : ''}`}
                key={conversation.id}
                onClick={() => setSelectedConversationId(conversation.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ conversation, kind: 'chat', x: event.clientX, y: event.clientY });
                }}
              >
                <span className="conversation-avatar-wrap">
                  <Avatar title={conversation.title} url={getConversationAvatarUrl(conversation, user?.id)} />
                  {shouldShowOnlineDot ? <span aria-label={t('online')} className="online-dot" title={t('online')} /> : null}
                </span>
                <span>
                  <strong className="conversation-title-line">
                    {displayConversation.isVoiceRoom ? (
                      <Volume2 aria-label="Voice room" className="conversation-kind-icon" size={16} />
                    ) : displayConversation.type === 'GROUP' ? (
                      <Users aria-label="Group" className="conversation-kind-icon" size={16} />
                    ) : shouldShowPremiumStar(displayConversation, user?.id) ? (
                      <Star aria-label="Premium" className="premium-star" fill="currentColor" size={15} />
                    ) : null}
                    <span>{displayConversation.title}</span>
                  </strong>
                  <small className="conversation-preview-line">
                    {displayConversation.lastMessageSenderId === user?.id && displayLastMessageStatus ? (
                      <MessageStatus status={displayLastMessageStatus} t={t} />
                    ) : null}
                    <span>{previewText}</span>
                  </small>
                </span>
                <div className="conversation-side">
                  <time>{formatConversationTime(displayConversation.lastMessageAt)}</time>
                  <div className="conversation-badges">
                    {getConversationRoleBadge(displayConversation, user?.id) ? <em>{getConversationRoleBadge(displayConversation, user?.id) === 'owner' ? t('owner') : t('admin')}</em> : null}
                    {shouldShowNotInContactsBadge(displayConversation) ? <em>{t('notInContacts')}</em> : null}
                    {displayConversation.unreadCount ? <b>{displayConversation.unreadCount}</b> : null}
                  </div>
                </div>
              </button>
            );
          }) : null}
          {activePanelTab === 'calls' ? (
            callLogs.length > 0 ? callLogs.map((callLog) => (
              <div className="side-row call-log-row" key={callLog.id}>
                <div className={`call-log-icon ${callLog.status && callLog.status !== 'answered' ? 'missed' : ''}`}>
                  {callLog.mode === 'video' ? <Video aria-hidden size={20} /> : <Phone aria-hidden size={20} />}
                </div>
                <span>
                  <strong>{callLog.title}</strong>
                  <small>
                    {callLog.direction === 'incoming' ? <PhoneIncoming aria-hidden size={13} /> : <PhoneOutgoing aria-hidden size={13} />}
                    {callLog.direction === 'incoming' ? t('incoming') : t('outgoing')} · {formatConversationTime(callLog.happenedAt)}
                  </small>
                </span>
                <div className="row-actions">
                  <button aria-label={t('voiceCall')} onClick={() => void startCallFromLog(callLog, 'voice')} title={t('voiceCall')}>
                    <Phone aria-hidden size={18} />
                  </button>
                  <button aria-label={t('videoCall')} onClick={() => void startCallFromLog(callLog, 'video')} title={t('videoCall')}>
                    <Video aria-hidden size={18} />
                  </button>
                </div>
              </div>
            )) : <div className="panel-empty">{t('noCallsYet')}</div>
          ) : null}
          {activePanelTab === 'contacts' ? (
            contacts.length > 0 ? contacts.map((contact) => (
              <button
                className="side-row contact-row"
                key={contact.id}
                onClick={() => void startDirectChat(contact)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ contact, kind: 'contact', x: event.clientX, y: event.clientY });
                }}
              >
                <Avatar title={contact.displayName || contact.username} url={contact.avatarUrl} />
                <span>
                  <strong>{contact.displayName || contact.username}</strong>
                  {contact.username ? <small>@{contact.username}</small> : null}
                </span>
                <div className="row-actions">
                  <button aria-label={t('voiceCall')} onClick={(event) => {
                    event.stopPropagation();
                    void startContactCall(contact, 'voice');
                  }} title={t('voiceCall')}>
                    <Phone aria-hidden size={18} />
                  </button>
                  <button aria-label={t('videoCall')} onClick={(event) => {
                    event.stopPropagation();
                    void startContactCall(contact, 'video');
                  }} title={t('videoCall')}>
                    <Video aria-hidden size={18} />
                  </button>
                </div>
              </button>
            )) : <div className="panel-empty">{t('noContactsYet')}</div>
          ) : null}
          {activePanelTab === 'statuses' ? (
            <div className="statuses-panel">
              <div className="status-top-actions">
                <button className="status-compose-button primary" onClick={() => openStatusComposer('media')}>
                  <Plus aria-hidden size={18} />
                  <span>{t('shareStatus')}</span>
                </button>
                <button className="status-compose-button" onClick={() => openStatusComposer('text')}>
                  <Type aria-hidden size={18} />
                  <span>{t('textStatus')}</span>
                </button>
              </div>
              {isLoadingStatuses ? <div className="panel-empty">{t('loading')}</div> : null}
              {myStatusGroup ? (
                <div className="status-row own">
                  <button className="status-row-main" onClick={() => openStatusGroup(myStatusGroup, 0)}>
                    <StatusThumb status={latestOwnStatus} user={user} />
                    <span>
                      <strong>{t('statuses')}</strong>
                      <small>{formatStatusTime(latestOwnStatus?.createdAt)}</small>
                    </span>
                  </button>
                  <button
                    aria-label={t('statusOptions')}
                    className="status-row-menu"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (latestOwnStatus) {
                        void openStatusActions(latestOwnStatus);
                      }
                    }}
                    title={t('statusOptions')}
                  >
                    <MoreVertical aria-hidden size={18} />
                  </button>
                </div>
              ) : null}
              {newStatusGroups.length > 0 ? <div className="status-section">{t('newStatuses')}</div> : null}
              {newStatusGroups.map((group) => (
                <StatusGroupRow group={group} key={group.author.id} onOpen={() => openStatusGroup(group)} />
              ))}
              {viewedStatusGroups.length > 0 ? <div className="status-section">{t('viewedStatuses')}</div> : null}
              {viewedStatusGroups.map((group) => (
                <StatusGroupRow group={group} key={group.author.id} onOpen={() => openStatusGroup(group)} />
              ))}
              {!isLoadingStatuses && statusGroups.length === 0 ? <div className="panel-empty">{t('noStatusesYet')}</div> : null}
            </div>
          ) : null}
        </div>
        <nav className="panel-tabs">
          <button className={activePanelTab === 'chats' ? 'active' : ''} onClick={() => setActivePanelTab('chats')}>
            <MessageCircle aria-hidden size={20} />
            <span>{t('chats')}</span>
          </button>
          <button className={activePanelTab === 'calls' ? 'active' : ''} onClick={() => setActivePanelTab('calls')}>
            <PhoneCall aria-hidden size={20} />
            <span>{t('calls')}</span>
          </button>
          <button className={activePanelTab === 'statuses' ? 'active has-statuses' : (newStatusGroups.length > 0 ? 'has-statuses' : '')} onClick={() => setActivePanelTab('statuses')}>
            <Contact aria-hidden size={20} />
            <span>{t('statuses')}</span>
          </button>
          <button className={activePanelTab === 'settings' ? 'active' : ''} onClick={() => setActivePanelTab('settings')}>
            <SettingsIcon aria-hidden size={20} />
            <span>{t('settings')}</span>
          </button>
        </nav>
      </aside>
      <main className="chat-panel">
        <header className="topbar">
          <div>
            <strong>{getMainPanelTitle(activePanelTab, selectedConversation, selectedPeer, t)}</strong>
            <span>{activePanelTab === 'chats' ? getConversationHeaderSubtitle(selectedConversation, selectedPeer, t, language) : ''}</span>
          </div>
          {activePanelTab === 'chats' ? <div className="topbar-actions">
            <button aria-label={t('voiceCall')} disabled={!selectedConversation} onClick={() => void startCall('voice')} title={t('voiceCall')}>
              <Phone aria-hidden size={18} />
              <span>{t('voiceCall')}</span>
            </button>
            <button aria-label={t('videoCall')} disabled={!selectedConversation} onClick={() => void startCall('video')} title={t('videoCall')}>
              <Video aria-hidden size={18} />
              <span>{t('videoCall')}</span>
            </button>
            <div className="chat-header-menu-wrap">
              <button
                aria-label={t('chatOptions')}
                disabled={!selectedConversation}
                onClick={() => setChatHeaderMenuOpen((current) => !current)}
                title={t('chatOptions')}
              >
                <MoreVertical aria-hidden size={19} />
              </button>
              {selectedConversation && isChatHeaderMenuOpen ? (
                <div className="chat-header-menu">
                  {selectedConversation.type === 'GROUP' ? (
                    <>
                      <button onClick={() => void runChatHeaderAction(selectedConversation.isMuted ? 'unmute' : 'mute', selectedConversation)}>
                        {selectedConversation.isMuted ? t('unmuteGroup') : t('muteGroup')}
                      </button>
                      <button onClick={() => void runChatHeaderAction('group-details', selectedConversation)}>{t('groupDetails')}</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => void runChatHeaderAction(selectedConversation.isMuted ? 'unmute' : 'mute', selectedConversation)}>
                        {selectedConversation.isMuted ? t('unmuteChat') : t('muteChat')}
                      </button>
                      <button onClick={() => void runChatHeaderAction('report', selectedConversation)}>{t('reportUser')}</button>
                      <button onClick={() => void runChatHeaderAction(selectedConversation.otherUserId && blockedUserIds.has(selectedConversation.otherUserId) ? 'unblock' : 'block', selectedConversation)}>
                        {selectedConversation.otherUserId && blockedUserIds.has(selectedConversation.otherUserId) ? t('unblockUser') : t('blockUser')}
                      </button>
                      <button className="danger" onClick={() => void runChatHeaderAction('delete', selectedConversation)}>{t('deleteChat')}</button>
                    </>
                  )}
                  <button onClick={() => setChatHeaderMenuOpen(false)}>{t('cancel')}</button>
                </div>
              ) : null}
            </div>
          </div> : null}
        </header>
        {activePanelTab === 'settings' ? (
          <section className="web-settings">
            <div className="settings-modal-card">
              <div className="settings-profile">
                <Avatar title={user?.displayName ?? 'M'} url={user?.avatarUrl} />
                <div>
                  <strong>{user?.displayName}</strong>
                  <span>@{user?.username}</span>
                </div>
                <div className="settings-profile-actions">
                  <button onClick={() => avatarInputRef.current?.click()}>{t('changePicture')}</button>
                  {user?.avatarUrl ? <button onClick={() => void removeWebAvatar()}>{t('removePicture')}</button> : null}
                </div>
              </div>
              <input
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    void updateWebAvatar(file);
                  }
                }}
                ref={avatarInputRef}
                type="file"
              />
              <div className="settings-section">
                <button className="settings-action" onClick={() => void updateWebProfile('displayName')}>
                  <span>{t('displayName')}</span>
                  <strong>{user?.displayName}</strong>
                </button>
                <button className="settings-action" onClick={() => void updateWebProfile('username')}>
                  <span>{t('nickname')}</span>
                  <strong>@{user?.username}</strong>
                </button>
                <label className="settings-field">
                  <span>{t('language')}</span>
                  <select onChange={(event) => updateWebLanguage(event.target.value as Language)} value={language}>
                    <option value="en">{t('english')}</option>
                    <option value="tr">{t('turkish')}</option>
                    <option value="ru">{t('russian')}</option>
                  </select>
                </label>
              </div>
              <div className="settings-section">
                <label className="settings-toggle">
                  <span>{t('hideNickname')}</span>
                  <input
                    checked={user?.hideNickname !== false}
                    onChange={(event) => void updateWebPrivacy({ hideNickname: event.target.checked })}
                    type="checkbox"
                  />
                </label>
                <label className="settings-toggle">
                  <span>{t('showLastSeen')}</span>
                  <input
                    checked={user?.showLastSeen !== false}
                    onChange={(event) => void updateWebPrivacy({ showLastSeen: event.target.checked })}
                    type="checkbox"
                  />
                </label>
                <label className="settings-toggle">
                  <span>{t('showInSearch')}</span>
                  <input
                    checked={user?.hideFromSearch !== true}
                    onChange={(event) => void updateWebPrivacy({ hideFromSearch: !event.target.checked })}
                    type="checkbox"
                  />
                </label>
                <label className="settings-toggle">
                  <span>{t('useGroupAliases')}</span>
                  <input
                    checked={user?.useGroupAliases !== false}
                    onChange={(event) => void updateWebPrivacy({ useGroupAliases: event.target.checked })}
                    type="checkbox"
                  />
                </label>
              </div>
              <button className="settings-logout" onClick={logout}>{t('logout')}</button>
            </div>
          </section>
        ) : activePanelTab === 'chats' ? (
        <section className="messages">
          {latestPinnedMessage ? (
            <button className="pinned-banner" onClick={() => {
              setPinnedSearchQuery('');
              setPinnedMessagesOpen(true);
            }}>
              <Pin aria-hidden size={17} />
              <span>
                <strong>{t('pinnedMessage')}</strong>
                <small>{getMessagePreviewText(latestPinnedMessage)}</small>
              </span>
            </button>
          ) : null}
          {isLoading ? <div className="center">{t('loading')}</div> : messageRows.map((row) => (
            row.type === 'date' ? (
              <div className="date-divider" key={row.id}>{row.label}</div>
            ) : (
              <div
                key={row.message.id}
                className={`message ${row.message.senderId === user?.id ? 'mine' : ''}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ kind: 'message', message: row.message, x: event.clientX, y: event.clientY });
                }}
              >
                <div className="sender">{row.message.sender?.displayName ?? row.message.sender?.username ?? ''}</div>
                <MessageContent
                  cacheConfig={webMediaCacheConfig}
                  message={row.message}
                  onOpenMedia={(viewer) => {
                    setMediaViewer(viewer);
                    setMediaViewerZoom(1);
                  }}
                  onContentReady={(message) => void acknowledgeWebMessageContent(message.conversationId, [message], true).catch(() => undefined)}
                  token={token}
                />
                <div className="message-meta">
                  <time>{new Date(row.message.createdAt).toLocaleTimeString()}</time>
                  {row.message.senderId === user?.id ? <MessageStatus status={row.message.status} t={t} /> : null}
                </div>
              </div>
            )
          ))}
          <div ref={messagesEndRef} />
        </section>
        ) : (
          <section className="empty-main-panel">
            <strong>{getMainPanelTitle(activePanelTab, selectedConversation, selectedPeer, t)}</strong>
          </section>
        )}
        {activePanelTab === 'chats' && replyingTo ? (
          <div className="reply-banner">
            <Reply aria-hidden size={18} />
            <div>
              <strong>{replyingTo.sender?.displayName || replyingTo.sender?.username || t('reply')}</strong>
              <span>{replyingTo.body || replyingTo.media?.originalName || replyingTo.kind}</span>
            </div>
            <button aria-label={t('cancel')} onClick={() => setReplyingTo(null)}>
              <X aria-hidden size={18} />
            </button>
          </div>
        ) : null}
        {activePanelTab === 'chats' && selectedConversation?.isVoiceRoom ? (
          <div className="voice-room-controls">
            <button
              className={voiceRoom?.isSelfMuted ? 'active' : ''}
              disabled={!voiceRoom?.room}
              onClick={() => void setVoiceRoomSelfMuted(!(voiceRoom?.isSelfMuted ?? true))}
              title={t('microphone')}
            >
              {voiceRoom?.isSelfMuted ? <MicOff aria-hidden size={18} /> : <Mic aria-hidden size={18} />}
            </button>
            <button
              className={voiceRoom?.isSpeakerMuted ? 'active' : ''}
              disabled={!voiceRoom?.room}
              onClick={() => setVoiceRoomSpeakerMuted(!(voiceRoom?.isSpeakerMuted ?? false))}
              title={t('voiceCall')}
            >
              {voiceRoom?.isSpeakerMuted ? <VolumeX aria-hidden size={18} /> : <Volume2 aria-hidden size={18} />}
            </button>
            <button
              className={voiceRoom?.isSelfMuted ? 'active' : ''}
              disabled={!voiceRoom?.room || !voiceRoom.isSelfMuted}
              onPointerDown={() => void setVoiceRoomSelfMuted(false)}
              onPointerLeave={() => {
                if (voiceRoom?.isSelfMuted === false) {
                  void setVoiceRoomSelfMuted(true);
                }
              }}
              onPointerUp={() => void setVoiceRoomSelfMuted(true)}
            >
              PT
            </button>
            <button onClick={() => setVoiceRoomPeopleOpen(true)} title={t('contacts')}>
              <Users aria-hidden size={18} />
              <span>{voiceRoom?.participants.length ?? 0}</span>
            </button>
            <span>{voiceRoom?.isConnecting ? t('voiceRoomConnecting') : voiceRoom?.room ? t('voiceRoomConnected') : t('voiceRoomConnecting')}</span>
          </div>
        ) : null}
        {activePanelTab === 'chats' && isEmojiPickerOpen ? (
          <div className="emoji-panel">
            <div className="emoji-tabs">
              {EMOJI_GROUPS.map((group) => (
                <button
                  className={selectedEmojiGroupKey === group.key ? 'active' : ''}
                  key={group.key}
                  onClick={() => setSelectedEmojiGroupKey(group.key)}
                >
                  {group.label}
                </button>
              ))}
            </div>
            <div className="emoji-grid">
              {selectedEmojiGroup.emojis.map((emoji) => (
                <button key={`${selectedEmojiGroup.key}-${emoji}`} onClick={() => setDraft((current) => `${current}${emoji}`)}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {activePanelTab === 'chats' ? <footer className="composer">
          <div className="attachment-control">
            <button
              aria-label={t('sendAttachment')}
              className="composer-icon-button"
              disabled={!selectedConversation || isSendingAttachment}
              onClick={() => setAttachmentMenuOpen((current) => !current)}
              title={t('sendAttachment')}
            >
              {isSendingAttachment ? <LoaderCircle aria-hidden className="spin" size={19} /> : <Paperclip aria-hidden size={19} />}
            </button>
            {isAttachmentMenuOpen ? (
              <div className="attachment-menu">
                <button onClick={() => galleryInputRef.current?.click()}>
                  <Image aria-hidden size={19} />
                  <span>{t('gallery')}</span>
                </button>
                <button onClick={() => fileInputRef.current?.click()}>
                  <File aria-hidden size={19} />
                  <span>{t('file')}</span>
                </button>
                <button onClick={() => void openContactPicker()}>
                  <Contact aria-hidden size={19} />
                  <span>{t('contact')}</span>
                </button>
              </div>
            ) : null}
          </div>
          <input
            accept="image/*,video/*"
            className="hidden-input"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0];
              if (selectedFile) {
                openCaptionModal(selectedFile, 'gallery');
              }
            }}
            ref={galleryInputRef}
            type="file"
          />
          <input
            className="hidden-input"
            onChange={(event) => {
              const selectedFile = event.target.files?.[0];
              if (selectedFile) {
                openCaptionModal(selectedFile, 'file');
              }
            }}
            ref={fileInputRef}
            type="file"
          />
          {isRecordingVoice ? (
            <button
              aria-label={t('cancel')}
              className="composer-icon-button"
              onClick={() => void stopVoiceRecording(false)}
              title={t('cancel')}
            >
              <X aria-hidden size={19} />
            </button>
          ) : null}
          {isRecordingVoice ? <span className="voice-recording-counter">{formatRecorderDuration(voiceRecordingSeconds)}</span> : null}
          <button
            aria-label="Emoji"
            className={`composer-icon-button ${isEmojiPickerOpen ? 'active' : ''}`}
            disabled={!selectedConversation}
            onClick={() => setEmojiPickerOpen((current) => !current)}
            title="Emoji"
          >
            <Smile aria-hidden size={19} />
          </button>
          <button
            aria-label={t('recordVoice')}
            className={`composer-icon-button ${isRecordingVoice ? 'recording' : ''}`}
            disabled={!selectedConversation || isSendingVoice}
            onClick={() => void (isRecordingVoice ? stopVoiceRecording(true) : startVoiceRecording())}
            title={t('recordVoice')}
          >
            {isSendingVoice ? <LoaderCircle aria-hidden className="spin" size={19} /> : isRecordingVoice ? <MicOff aria-hidden size={19} /> : <Mic aria-hidden size={19} />}
          </button>
          <textarea
            disabled={!selectedConversation}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            onPaste={handleComposerPaste}
            placeholder={t('message')}
            ref={composerTextareaRef}
            rows={1}
            value={draft}
          />
          <button aria-label={t('send')} disabled={!draft.trim()} onClick={() => void sendMessage()} title={t('send')}>
            <Send aria-hidden size={18} />
          </button>
        </footer> : null}
        {attachmentError ? (
          <div className="attachment-error">
            <span>{attachmentError}</span>
            <button aria-label={t('cancel')} onClick={() => setAttachmentError(null)}>
              <X aria-hidden size={16} />
            </button>
          </div>
        ) : null}
      </main>
      {incomingCall ? (
        <div className="incoming-call-backdrop">
          <div className="incoming-call-modal">
            <div className="incoming-call-avatar">
              {incomingCall.mode === 'VIDEO' ? <Video aria-hidden size={34} /> : <Phone aria-hidden size={34} />}
            </div>
            <span>{t('incomingCall')}</span>
            <strong>{incomingCall.fromDisplayName ?? t('incomingCall')}</strong>
            <small>{incomingCall.mode === 'VIDEO' ? t('videoCall') : t('voiceCall')}</small>
            <div className="incoming-call-actions">
              <button className="decline-call-button" onClick={() => void declineIncomingCall()}>
                <PhoneOff aria-hidden size={18} />
                <span>{t('decline')}</span>
              </button>
              <button className="answer-call-button" onClick={() => void answerIncomingCall()}>
                <Phone aria-hidden size={18} />
                <span>{t('answer')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {callState ? (
        <div className={`call-overlay ${isCallMaximized ? 'maximized' : ''}`}>
          <div
            className={`call-window ${isCallMaximized ? 'maximized' : ''}`}
            ref={callWindowRef}
            style={callWindowPosition && !isCallMaximized ? {
              bottom: 'auto',
              left: callWindowPosition.x,
              right: 'auto',
              top: callWindowPosition.y,
            } : undefined}
          >
            <header className="call-window-header" onPointerDown={beginDraggingCallWindow}>
              <div className="call-title">
                <strong>{callState.title}</strong>
                <span>{callState.phase === 'connected'
                  ? formatRecorderDuration(callElapsedSeconds)
                  : t(callState.phase === 'ringing'
                    ? 'callRinging'
                    : callState.phase === 'connecting'
                      ? 'callConnecting'
                      : 'callDialing')}</span>
              </div>
              <div className="call-window-actions">
                {callState.kind === 'meeting' && publicMeeting?.status === 'active' ? (
                  <>
                    <button aria-label={t('shareLink')} className="icon-button secondary" onClick={() => void shareMeetingLink(publicMeeting)} title={t('shareLink')}>
                      <Share2 aria-hidden size={18} />
                    </button>
                    <button aria-label={t('copyLink')} className="icon-button secondary" onClick={() => void copyMeetingLink(publicMeeting)} title={t('copyLink')}>
                      <Copy aria-hidden size={18} />
                    </button>
                  </>
                ) : null}
                <button
                  aria-label={isCallMaximized ? t('restore') : t('maximize')}
                  className="icon-button secondary"
                  onClick={() => setCallMaximized((current) => !current)}
                  title={isCallMaximized ? t('restore') : t('maximize')}
                >
                  {isCallMaximized ? <Minimize2 aria-hidden size={18} /> : <Maximize2 aria-hidden size={18} />}
                </button>
                <button aria-label={t('end')} className="end-call-button" onClick={() => void endCurrentCall()} title={t('end')}>
                  <PhoneOff aria-hidden size={18} />
                  <span>{t('end')}</span>
                </button>
              </div>
            </header>
            <div ref={remoteMediaRef} className="remote-media">
              {!callState.room ? (
                <div className="call-waiting-state">
                  {callState.mode === 'video' ? <Video aria-hidden size={46} /> : <Phone aria-hidden size={46} />}
                  <strong>{callState.phase === 'ringing'
                    ? t('callRinging')
                    : callState.phase === 'connecting'
                      ? t('callConnecting')
                      : t('callDialing')}</strong>
                </div>
              ) : null}
            </div>
            {callState.mode === 'video' && callState.room ? <video ref={localVideoRef} autoPlay muted playsInline className={`local-video ${isScreenSharing ? 'hidden' : ''}`} /> : null}
            {callState.mode === 'video' && callState.room && isScreenSharing ? (
              <div className="screen-share-preview">
                <video ref={screenSharePreviewRef} autoPlay muted playsInline />
                <button onClick={() => void stopScreenShare()}>
                  <X aria-hidden size={16} />
                  <span>{t('stopSharing')}</span>
                </button>
              </div>
            ) : null}
            <footer>
              <button disabled={!callState.room} aria-label={t('microphone')} onClick={() => void callState.room?.localParticipant.setMicrophoneEnabled(!callState.room.localParticipant.isMicrophoneEnabled)} title={t('microphone')}>
                <Mic aria-hidden size={18} />
                <span>{t('microphone')}</span>
              </button>
              {callState.mode === 'video' ? (
                <>
                  <button disabled={!callState.room || isScreenSharing} aria-label={t('camera')} onClick={() => void callState.room?.localParticipant.setCameraEnabled(!callState.room.localParticipant.isCameraEnabled)} title={t('camera')}>
                    <Video aria-hidden size={18} />
                    <span>{t('camera')}</span>
                  </button>
                  <button
                    className={isScreenSharing ? 'screen-share-active' : ''}
                    disabled={!callState.room || isStartingScreenShare}
                    aria-label={isScreenSharing ? t('stopSharing') : t('shareScreen')}
                    onClick={() => void (isScreenSharing ? stopScreenShare() : startScreenShare())}
                    title={isScreenSharing ? t('stopSharing') : t('shareScreen')}
                  >
                    {isStartingScreenShare ? <LoaderCircle aria-hidden className="spin" size={18} /> : <ScreenShare aria-hidden size={18} />}
                    <span>{isScreenSharing ? t('stopSharing') : t('shareScreen')}</span>
                  </button>
                </>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}
      {isMeetTypeMenuOpen ? (
        <div className="modal-backdrop">
          <div className="meet-type-modal">
            <header>
              <div>
                <strong>{t('createMeetLink')}</strong>
                <span>{t('createMeetLinkDescription')}</span>
              </div>
              <button aria-label={t('cancel')} className="modal-close" onClick={() => setMeetTypeMenuOpen(false)}>
                <X aria-hidden size={18} />
              </button>
            </header>
            <button onClick={() => void createMeetLink('video')}>
              <span className="meet-type-icon"><Video aria-hidden size={24} /></span>
              <span>
                <strong>{t('videoMeet')}</strong>
                <small>{t('videoMeetDescription')}</small>
              </span>
            </button>
            <button onClick={() => void createMeetLink('voice')}>
              <span className="meet-type-icon"><Phone aria-hidden size={24} /></span>
              <span>
                <strong>{t('voiceMeet')}</strong>
                <small>{t('voiceMeetDescription')}</small>
              </span>
            </button>
          </div>
        </div>
      ) : null}
      {meetingEndSummary ? (
        <MeetingEndSummaryModal
          onClose={() => setMeetingEndSummary(null)}
          summary={meetingEndSummary}
          t={t}
        />
      ) : null}
      {token && publicMeetingCode && publicMeeting && !callState ? (
        <div className="modal-backdrop">
          <div className="meeting-lobby-card modal-meeting-lobby">
            <button aria-label={t('cancel')} className="modal-close meeting-lobby-close" onClick={() => {
              setPublicMeetingCode(null);
              setPublicMeeting(null);
              window.history.replaceState(null, '', `${window.location.pathname}${window.location.search.replace(/[?&](meeting|meet|code)=[^&]+/, '')}`);
            }}>
              <X aria-hidden size={18} />
            </button>
            <div className="meeting-lobby-icon">
              {publicMeeting.mode === 'voice' ? <Phone aria-hidden size={34} /> : <Video aria-hidden size={34} />}
            </div>
            <h1>{publicMeeting.creator.displayName}</h1>
            <p>{publicMeeting.mode === 'voice' ? t('voiceMeet') : t('videoMeet')} · {formatLabel('meetingRemaining', { time: formatRecorderDuration(publicMeetingRemainingSeconds) })}</p>
            <div className="meeting-lobby-actions">
              {publicMeeting.status === 'active' ? (
                <>
                  <button onClick={() => void shareMeetingLink(publicMeeting)}>
                    <Share2 aria-hidden size={18} />
                    <span>{t('shareLink')}</span>
                  </button>
                  <button onClick={() => void copyMeetingLink(publicMeeting)}>
                    <Copy aria-hidden size={18} />
                    <span>{t('copyLink')}</span>
                  </button>
                </>
              ) : null}
              <button
                disabled={publicMeeting.status !== 'active' || isPublicMeetingJoining}
                onClick={() => {
                  setPublicMeetingJoining(true);
                  void joinMeetingFromInfo(publicMeeting)
                    .catch((error) => setAttachmentError(error instanceof Error ? error.message : t('meetingJoinFailed')))
                    .finally(() => setPublicMeetingJoining(false));
                }}
              >
                {isPublicMeetingJoining ? <LoaderCircle aria-hidden className="spin" size={18} /> : <PhoneIncoming aria-hidden size={18} />}
                <span>{t('joinMeet')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isContactPickerOpen ? (
        <div className="modal-backdrop">
          <div className="contact-picker">
            <header>
              <strong>{t('chooseContact')}</strong>
              <button aria-label={t('cancel')} className="modal-close" onClick={() => setContactPickerOpen(false)}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <input
              autoFocus
              onChange={(event) => setContactQuery(event.target.value)}
              placeholder={t('searchContacts')}
              value={contactQuery}
            />
            <div className="contact-list">
              {isLoadingContacts ? <div className="center">{t('loading')}</div> : null}
              {!isLoadingContacts && visibleContacts.length === 0 ? <div className="center">{t('contactsEmpty')}</div> : null}
              {visibleContacts.map((contact) => (
                <button disabled={isSendingAttachment} key={contact.id} onClick={() => void sendContact(contact)}>
                  <Avatar title={contact.displayName} url={contact.avatarUrl} />
                  <span>
                    <strong>{contact.displayName}</strong>
                    {contact.username ? <small>@{contact.username}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {pendingCaptionAttachment ? (
        <div className="modal-backdrop">
          <div className="caption-modal">
            <header>
              <strong>{t('addCaption')}</strong>
              <button aria-label={t('cancel')} className="modal-close" onClick={closeCaptionModal}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <div className="caption-preview">
              {pendingCaptionAttachment.kind === 'IMAGE' && pendingCaptionAttachment.previewUrl ? (
                <img alt={pendingCaptionAttachment.file.name} src={pendingCaptionAttachment.previewUrl} />
              ) : pendingCaptionAttachment.kind === 'VIDEO' && pendingCaptionAttachment.previewUrl ? (
                <video controls src={pendingCaptionAttachment.previewUrl} />
              ) : (
                <div className="caption-file">
                  <File aria-hidden size={32} />
                  <span>{pendingCaptionAttachment.file.name}</span>
                </div>
              )}
            </div>
            <div className="caption-input-row">
              <input
                autoFocus
                onChange={(event) => setCaptionDraft(event.target.value)}
                placeholder={t('addCaption')}
                value={captionDraft}
              />
              <button
                aria-label={t('send')}
                disabled={isSendingAttachment}
                onClick={() => void uploadAndSendFile(pendingCaptionAttachment.file, pendingCaptionAttachment.kind, captionDraft)}
              >
                {isSendingAttachment ? <LoaderCircle aria-hidden className="spin" size={18} /> : <Send aria-hidden size={18} />}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isPinnedMessagesOpen ? (
        <div className="modal-backdrop">
          <div className="contact-picker pinned-modal">
            <header>
              <strong>{t('pinnedMessages')}</strong>
              <button aria-label={t('cancel')} className="modal-close" onClick={() => setPinnedMessagesOpen(false)}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <input
              autoFocus
              onChange={(event) => setPinnedSearchQuery(event.target.value)}
              placeholder={t('searchPinnedMessages')}
              value={pinnedSearchQuery}
            />
            <div className="contact-list">
              {filteredPinnedMessages.length === 0 ? <div className="center">{t('noPinnedMessages')}</div> : null}
              {filteredPinnedMessages.map((pin) => (
                <div className="pinned-row" key={`${pin.message.id}-${pin.pinnedAt}-${pin.scope}`}>
                  <button onClick={() => {
                    setPinnedMessagesOpen(false);
                    setSelectedConversationId(pin.message.conversationId);
                  }}>
                    <Pin aria-hidden size={18} />
                    <span>
                      <strong>{getMessagePreviewText(pin.message)}</strong>
                      <small>{formatConversationTime(pin.pinnedAt)}</small>
                    </span>
                  </button>
                  <button
                    aria-label={t('unpin')}
                    className="pinned-remove"
                    onClick={() => void runMessageAction('unpin', pin.message)}
                    title={t('unpin')}
                  >
                    <Trash2 aria-hidden size={17} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {isNewChatOpen ? (
        <div className="modal-backdrop">
          <div className="contact-picker">
            <header>
              <strong>{t('newChat')}</strong>
              <button
                aria-label={t('cancel')}
                className="modal-close"
                onClick={() => {
                  setNewChatOpen(false);
                  setForwardingMessage(null);
                }}
              >
                <X aria-hidden size={20} />
              </button>
            </header>
            <input
              autoFocus
              onChange={(event) => void searchNewChatUsers(event.target.value)}
              placeholder={t('searchPeople')}
              value={newChatQuery}
            />
            <div className="contact-list">
              {isSearchingUsers ? <div className="center">{t('loading')}</div> : null}
              {!isSearchingUsers && visibleNewChatUsers.length === 0 ? <div className="center">{t('contactsEmpty')}</div> : null}
              {visibleNewChatUsers.map((peer) => (
                <button disabled={startingUserId !== null} key={peer.id} onClick={() => void startDirectChat(peer)}>
                  <Avatar title={peer.displayName || peer.username} url={peer.avatarUrl} />
                  <span>
                    <strong>{peer.displayName || peer.username}</strong>
                    {peer.username ? <small>@{peer.username}</small> : null}
                  </span>
                  {startingUserId === peer.id ? <LoaderCircle aria-hidden className="spin" size={18} /> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {isAddContactOpen ? (
        <div className="modal-backdrop">
          <div className="contact-picker">
            <header>
              <strong>{t('addContact')}</strong>
              <button
                aria-label={t('cancel')}
                className="modal-close"
                onClick={() => setAddContactOpen(false)}
              >
                <X aria-hidden size={20} />
              </button>
            </header>
            <div className="search-input-wrap">
              <Search aria-hidden size={18} />
              <input
                autoFocus
                onChange={(event) => void searchDirectoryUsers(event.target.value)}
                placeholder={t('searchDirectory')}
                value={directoryQuery}
              />
            </div>
            <div className="contact-list">
              {isSearchingDirectory ? <div className="center">{t('loading')}</div> : null}
              {!isSearchingDirectory && directoryQuery.trim().length > 0 && directoryQuery.trim().length < 2 ? (
                <div className="center">{t('searchPeople')}</div>
              ) : null}
              {!isSearchingDirectory && directoryQuery.trim().length >= 2 && directoryUsers.length === 0 ? (
                <div className="center">{t('contactsEmpty')}</div>
              ) : null}
              {directoryUsers.map((peer) => (
                <button disabled={startingUserId !== null} key={peer.id} onClick={() => void addContactFromDirectory(peer)}>
                  <Avatar title={peer.displayName || peer.username} url={peer.avatarUrl} />
                  <span>
                    <strong>{peer.displayName || peer.username}</strong>
                    {peer.username ? <small>@{peer.username}</small> : null}
                  </span>
                  {startingUserId === peer.id ? <LoaderCircle aria-hidden className="spin" size={18} /> : <UserPlus aria-hidden size={18} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {isGroupDetailsOpen && selectedConversation?.type === 'GROUP' ? (
        <div className="modal-backdrop">
          <div className="group-details-modal">
            <header>
              <div>
                <strong>{t('groupDetails')}</strong>
                <span>{selectedConversation.title}</span>
              </div>
              <button aria-label={t('cancel')} className="modal-close" onClick={() => setGroupDetailsOpen(false)}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <section className="group-details-hero">
              <Avatar title={selectedConversation.title} url={selectedConversation.avatarUrl} />
              <div>
                <strong>{selectedConversation.title}</strong>
                {selectedConversation.showMemberCount !== false ? <span>{selectedConversation.memberCount ?? 0} {t('members')}</span> : null}
              </div>
            </section>
            <section className="group-details-section">
              <div className="group-details-section-title">
                <Users aria-hidden size={18} />
                <strong>{t('groupMembers')}</strong>
              </div>
              <div className="group-members-list">
                {sortedGroupMembers.length > 0 ? sortedGroupMembers.map((member) => (
                  <div className="group-member-row" key={member.id}>
                    <Avatar title={member.displayName || member.username} url={member.avatarUrl} />
                    <span>
                      <strong>{member.displayName || member.username}</strong>
                      <small>@{member.username}</small>
                    </span>
                    {member.id === selectedConversation.ownerId ? <em>{t('owner')}</em> : selectedConversation.adminIds?.includes(member.id) ? <em>{t('admin')}</em> : null}
                  </div>
                )) : <div className="center">{selectedConversation.hideMembers ? t('hideMembers') : t('contactsEmpty')}</div>}
              </div>
            </section>
            {selectedConversation.ownerId === user?.id ? (
              <section className="group-details-section">
                <div className="group-details-section-title">
                  <Shield aria-hidden size={18} />
                  <strong>{t('settings')}</strong>
                </div>
                <label className="settings-toggle">
                  <span>{t('memberCount')}</span>
                  <input
                    checked={selectedConversation.showMemberCount !== false}
                    onChange={(event) => void updateGroupSettings(selectedConversation, { showMemberCount: event.target.checked })}
                    type="checkbox"
                  />
                </label>
                <label className="settings-toggle">
                  <span>{t('hideMembers')}</span>
                  <input
                    checked={selectedConversation.hideMembers === true}
                    onChange={(event) => void updateGroupSettings(selectedConversation, { hideMembers: event.target.checked })}
                    type="checkbox"
                  />
                </label>
                <label className="settings-toggle">
                  <span>{t('ownerOnlyMessages')}</span>
                  <input
                    checked={selectedConversation.ownerOnlyMessages === true}
                    onChange={(event) => void updateGroupSettings(selectedConversation, { ownerOnlyMessages: event.target.checked })}
                    type="checkbox"
                  />
                </label>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
      {isVoiceRoomPeopleOpen ? (
        <div className="modal-backdrop">
          <div className="contact-picker">
            <header>
              <strong>{t('contacts')}</strong>
              <button aria-label={t('cancel')} className="modal-close" onClick={() => setVoiceRoomPeopleOpen(false)}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <div className="contact-list">
              {(voiceRoom?.participants ?? []).map((participant) => (
                <div className="voice-room-person" key={participant.userId}>
                  <Avatar title={participant.user.displayName || participant.user.username} url={participant.user.avatarUrl} />
                  <span>
                    <strong>{participant.user.displayName || participant.user.username}</strong>
                    <small>{participant.adminMuted ? t('mute') : participant.selfMuted ? t('microphone') : t('voiceRoomConnected')}</small>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {mediaViewer ? (
        <div className="modal-backdrop media-viewer-backdrop" onClick={() => setMediaViewer(null)}>
          <div className="media-viewer-modal" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong>{mediaViewer.media.originalName}</strong>
                {mediaViewer.caption ? <span>{mediaViewer.caption}</span> : null}
              </div>
              <div className="media-viewer-actions">
                {mediaViewer.kind === 'IMAGE' ? (
                  <>
                    <button aria-label={t('zoomOut')} onClick={() => setMediaViewerZoom((current) => Math.max(0.5, Number((current - 0.25).toFixed(2))))} title={t('zoomOut')}>
                      -
                    </button>
                    <button aria-label={t('zoomIn')} onClick={() => setMediaViewerZoom((current) => Math.min(4, Number((current + 0.25).toFixed(2))))} title={t('zoomIn')}>
                      +
                    </button>
                    <button
                      aria-label={t('copy')}
                      onClick={() => {
                        void copyImageUrlToClipboard(mediaViewer.url)
                          .catch((error) => setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed')));
                      }}
                      title={t('copy')}
                    >
                      <Copy aria-hidden size={18} />
                    </button>
                  </>
                ) : null}
                <button aria-label={t('cancel')} className="modal-close" onClick={() => setMediaViewer(null)}>
                  <X aria-hidden size={20} />
                </button>
              </div>
            </header>
            <div className="media-viewer-stage">
              {mediaViewer.kind === 'IMAGE' ? (
                <img
                  alt={mediaViewer.media.originalName}
                  src={mediaViewer.url}
                  style={{ transform: `scale(${mediaViewerZoom})` }}
                />
              ) : (
                <video autoPlay controls src={mediaViewer.url} />
              )}
            </div>
          </div>
        </div>
      ) : null}
      <input
        accept="image/*,video/*"
        className="hidden-input"
        onChange={(event) => handleStatusMediaPicked(event.target.files?.[0])}
        ref={statusMediaInputRef}
        type="file"
      />
      {isStatusComposerOpen ? (
        <div className="modal-backdrop">
          <div className="status-composer-modal">
            <header>
              <strong>{t('shareStatus')}</strong>
              <button aria-label={t('cancel')} className="modal-close" onClick={closeStatusComposer}>
                <X aria-hidden size={20} />
              </button>
            </header>
            {statusComposerMode === 'text' ? (
              <div className="status-text-preview" style={{ background: statusBackgroundColor }}>
                <textarea
                  autoFocus
                  onChange={(event) => setStatusBody(event.target.value)}
                  placeholder={t('typeStatus')}
                  value={statusBody}
                />
                <div className="status-colors">
                  {['#2563eb', '#0f766e', '#be123c', '#7c3aed', '#c2410c', '#111827'].map((color) => (
                    <button
                      aria-label={color}
                      className={statusBackgroundColor === color ? 'active' : ''}
                      key={color}
                      onClick={() => setStatusBackgroundColor(color)}
                      style={{ background: color }}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="status-media-composer">
                {pendingStatusMedia ? (
                  pendingStatusMedia.kind === 'VIDEO' ? (
                    <video controls src={pendingStatusMedia.previewUrl} />
                  ) : (
                    <img alt="" src={pendingStatusMedia.previewUrl} />
                  )
                ) : (
                  <button className="status-pick-media" onClick={() => statusMediaInputRef.current?.click()}>
                    <Image aria-hidden size={28} />
                    <span>{t('gallery')}</span>
                  </button>
                )}
                <input
                  onChange={(event) => setStatusBody(event.target.value)}
                  placeholder={t('addCaption')}
                  value={statusBody}
                />
              </div>
            )}
            <section className="status-audience-box">
              <span>{t('statusAudience')}</span>
              <div className="status-audience-options">
                <button
                  className={statusAudience === 'CONTACTS' ? 'active' : ''}
                  onClick={() => {
                    setStatusAudience('CONTACTS');
                    setStatusExceptUserIds([]);
                    setStatusOnlyUserIds([]);
                  }}
                >
                  {t('contactsOnly')}
                </button>
                <button
                  className={statusAudience === 'CONTACTS_EXCEPT' ? 'active' : ''}
                  onClick={() => {
                    setStatusAudience('CONTACTS_EXCEPT');
                    setStatusAudiencePickerMode('except');
                  }}
                >
                  {statusAudience === 'CONTACTS_EXCEPT' ? getStatusAudienceLabel() : t('contactsExcept')}
                </button>
                <button
                  className={statusAudience === 'ONLY_SHARE_WITH' ? 'active' : ''}
                  onClick={() => {
                    setStatusAudience('ONLY_SHARE_WITH');
                    setStatusAudiencePickerMode('only');
                  }}
                >
                  {statusAudience === 'ONLY_SHARE_WITH' ? getStatusAudienceLabel() : t('statusAudienceOnlySelected')}
                </button>
              </div>
            </section>
            <button
              className="status-submit-button"
              disabled={statusComposerMode === 'text' ? !statusBody.trim() : !pendingStatusMedia}
              onClick={() => void submitStatus()}
            >
              <Send aria-hidden size={18} />
              <span>{t('send')}</span>
            </button>
          </div>
        </div>
      ) : null}
      {statusAudiencePickerMode ? (
        <div className="modal-backdrop">
          <div className="contact-picker status-audience-modal">
            <header>
              <strong>{statusAudiencePickerMode === 'except' ? t('contactsExcept') : t('statusAudienceOnlySelected')}</strong>
              <button aria-label={t('done')} className="modal-close" onClick={() => setStatusAudiencePickerMode(null)}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <div className="contact-list">
              {sortUsersAlphabetically(contacts).map((contact) => {
                const selectedIds = statusAudiencePickerMode === 'except' ? statusExceptUserIds : statusOnlyUserIds;
                const isSelected = selectedIds.includes(contact.id);

                return (
                  <button
                    className={isSelected ? 'selected' : ''}
                    key={contact.id}
                    onClick={() => {
                      if (statusAudiencePickerMode === 'except') {
                        setStatusExceptUserIds((current) => (
                          current.includes(contact.id)
                            ? current.filter((id) => id !== contact.id)
                            : [...current, contact.id]
                        ));
                      } else {
                        setStatusOnlyUserIds((current) => (
                          current.includes(contact.id)
                            ? current.filter((id) => id !== contact.id)
                            : [...current, contact.id]
                        ));
                      }
                    }}
                  >
                    <Avatar title={contact.displayName || contact.username} url={contact.avatarUrl} />
                    <span>
                      <strong>{contact.displayName || contact.username}</strong>
                      {contact.username ? <small>@{contact.username}</small> : null}
                    </span>
                    {isSelected ? <Check aria-hidden size={19} /> : null}
                  </button>
                );
              })}
            </div>
            <button className="status-done-button" onClick={() => setStatusAudiencePickerMode(null)}>{t('done')}</button>
          </div>
        </div>
      ) : null}
      {activeStatus && statusViewerGroup ? (
        <div
          className="status-viewer-backdrop"
          onPointerDown={() => setStatusViewerPaused(true)}
          onPointerLeave={() => setStatusViewerPaused(false)}
          onPointerUp={() => setStatusViewerPaused(false)}
        >
          <div className="status-viewer">
            <StatusProgress count={statusViewerGroup.statuses.length} index={statusViewerIndex} progress={statusViewerProgress} />
            <header>
              <Avatar title={statusViewerGroup.author.displayName || statusViewerGroup.author.username} url={statusViewerGroup.author.avatarUrl} />
              <span>
                <strong>{statusViewerGroup.author.displayName || statusViewerGroup.author.username}</strong>
                <small>{formatStatusTime(activeStatus.createdAt)}</small>
              </span>
              <button aria-label={t('cancel')} onClick={() => setStatusViewerGroup(null)}>
                <X aria-hidden size={20} />
              </button>
            </header>
            <button aria-label="Previous story" className="status-tap-zone left" onClick={openPreviousStatus} />
            <StatusViewerContent status={activeStatus} onVideoEnded={openNextStatus} />
            <button aria-label="Next story" className="status-tap-zone right" onClick={openNextStatus} />
            {activeStatus.authorId === user?.id ? (
              <footer className="status-own-footer">
                <button onClick={() => void openStatusActions(activeStatus)}>
                  <Eye aria-hidden size={18} />
                  <span>{formatLabel('statusViews', { count: activeStatus.viewerCount ?? 0 })}</span>
                </button>
                <button className="danger" onClick={() => void deleteStatus(activeStatus.id)}>
                  <Trash2 aria-hidden size={18} />
                  <span>{t('delete')}</span>
                </button>
              </footer>
            ) : (
              <footer className="status-reply-footer">
                <input
                  onChange={(event) => setStatusReplyText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void replyToActiveStatus();
                    }
                  }}
                  placeholder={t('statusReply')}
                  value={statusReplyText}
                />
                <button disabled={!statusReplyText.trim()} onClick={() => void replyToActiveStatus()}>
                  <Send aria-hidden size={18} />
                </button>
              </footer>
            )}
          </div>
        </div>
      ) : null}
      {statusActionTarget ? (
        <div className="modal-backdrop">
          <div className="status-actions-modal">
            <header>
              <button aria-label={t('cancel')} className="modal-close" onClick={() => setStatusActionTarget(null)}>
                <X aria-hidden size={20} />
              </button>
              <strong>{t('statusOptions')}</strong>
            </header>
            <div className="status-action-buttons">
              <button disabled={statusActionTarget.kind === 'TEXT'} onClick={() => void downloadStatus(statusActionTarget)}>
                <Download aria-hidden size={18} />
                <span>{t('save')}</span>
              </button>
              <button disabled={statusActionTarget.kind === 'TEXT'} onClick={() => void shareStatus(statusActionTarget)}>
                <Share2 aria-hidden size={18} />
                <span>{t('share')}</span>
              </button>
              <button className="danger" onClick={() => void deleteStatus(statusActionTarget.id)}>
                <Trash2 aria-hidden size={18} />
                <span>{t('delete')}</span>
              </button>
            </div>
            <section className="status-viewers-list">
              <strong>{formatLabel('statusViews', { count: statusActionViewers.length })}</strong>
              {isLoadingStatusViewers ? <div className="center">{t('loading')}</div> : null}
              {!isLoadingStatusViewers && statusActionViewers.length === 0 ? <div className="center">{t('noStatusViewsYet')}</div> : null}
              {statusActionViewers.map((viewer) => (
                <div className="status-viewer-row" key={`${viewer.user.id}-${viewer.viewedAt}`}>
                  <Avatar title={viewer.user.displayName || viewer.user.username} url={viewer.user.avatarUrl} />
                  <span>
                    <strong>{viewer.user.displayName || viewer.user.username}</strong>
                    <small>{formatStatusTime(viewer.viewedAt)}</small>
                  </span>
                </div>
              ))}
            </section>
          </div>
        </div>
      ) : null}
      {contextMenu ? (
        <ContextMenu
          context={contextMenu}
          currentUserId={user?.id}
          isBlocked={
            contextMenu.kind === 'chat'
              ? !!contextMenu.conversation.otherUserId && blockedUserIds.has(contextMenu.conversation.otherUserId)
              : contextMenu.kind === 'contact'
                ? blockedUserIds.has(contextMenu.contact.id)
                : false
          }
          isPinned={contextMenu.kind === 'message' && pinnedMessageIds.has(contextMenu.message.id)}
          onChatAction={(action, conversation) => {
            void runChatAction(action, conversation)
              .catch((error) => setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed')));
          }}
          onContactAction={(action, contact) => {
            void runContactAction(action, contact)
              .catch((error) => setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed')));
          }}
          onClose={() => setContextMenu(null)}
          onMessageAction={(action, message) => {
            void runMessageAction(action, message)
              .catch((error) => setAttachmentError(error instanceof Error ? error.message : t('attachmentFailed')));
          }}
          t={t}
        />
      ) : null}
    </div>
  );
}

type MessageContextAction = 'copy' | 'copy-image' | 'delete-all' | 'delete-me' | 'download' | 'edit' | 'forward' | 'pin' | 'reply' | 'report' | 'unpin';
type ChatContextAction = 'add-contact' | 'block' | 'delete' | 'mute' | 'report' | 'unblock' | 'unmute';
type ContactContextAction = 'block' | 'chat' | 'delete-contact' | 'report' | 'share' | 'video' | 'voice';

function ContextMenu({
  context,
  currentUserId,
  isBlocked,
  isPinned,
  onChatAction,
  onContactAction,
  onClose,
  onMessageAction,
  t,
}: {
  context: ContextMenuState;
  currentUserId?: string;
  isBlocked: boolean;
  isPinned: boolean;
  onChatAction: (action: ChatContextAction, conversation: Conversation) => void;
  onContactAction: (action: ContactContextAction, contact: AuthUser) => void;
  onClose: () => void;
  onMessageAction: (action: MessageContextAction, message: Message) => void;
  t: (key: TranslationKey) => string;
}) {
  const left = Math.min(context.x, Math.max(8, window.innerWidth - 250));
  const top = Math.min(context.y, Math.max(8, window.innerHeight - 390));

  return (
    <div className="context-menu-backdrop" onClick={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div className="context-menu" onClick={(event) => event.stopPropagation()} style={{ left, top }}>
        <strong>{t(context.kind === 'message' ? 'messageOptions' : context.kind === 'contact' ? 'contactOptions' : 'chatOptions')}</strong>
        {context.kind === 'message' ? (
          <>
            {context.message.kind === 'TEXT' && context.message.body ? (
              <ContextMenuButton icon={Copy} label={t('copy')} onClick={() => onMessageAction('copy', context.message)} />
            ) : null}
            {context.message.kind === 'IMAGE' && context.message.media?.id ? (
              <ContextMenuButton icon={Copy} label={t('copy')} onClick={() => onMessageAction('copy-image', context.message)} />
            ) : null}
            {context.message.senderId === currentUserId && context.message.kind === 'TEXT' ? (
              <ContextMenuButton icon={Pencil} label={t('edit')} onClick={() => onMessageAction('edit', context.message)} />
            ) : null}
            {context.message.kind !== 'CALL' ? (
              <ContextMenuButton icon={Send} label={t('forward')} onClick={() => onMessageAction('forward', context.message)} />
            ) : null}
            <ContextMenuButton
              icon={Pin}
              label={t(isPinned ? 'unpin' : 'pin')}
              onClick={() => onMessageAction(isPinned ? 'unpin' : 'pin', context.message)}
            />
            <ContextMenuButton icon={Reply} label={t('reply')} onClick={() => onMessageAction('reply', context.message)} />
            {context.message.media?.id ? (
              <ContextMenuButton icon={Download} label={t('download')} onClick={() => onMessageAction('download', context.message)} />
            ) : null}
            {context.message.senderId !== currentUserId ? (
              <ContextMenuButton destructive icon={Flag} label={t('report')} onClick={() => onMessageAction('report', context.message)} />
            ) : null}
            {context.message.senderId === currentUserId ? (
              <ContextMenuButton destructive icon={Trash2} label={t('deleteForEveryone')} onClick={() => onMessageAction('delete-all', context.message)} />
            ) : null}
            <ContextMenuButton destructive icon={Trash2} label={t('deleteForMe')} onClick={() => onMessageAction('delete-me', context.message)} />
          </>
        ) : context.kind === 'chat' ? (
          <>
            <ContextMenuButton
              icon={context.conversation.isMuted ? Bell : BellOff}
              label={t(context.conversation.isMuted ? 'unmute' : 'mute')}
              onClick={() => onChatAction(context.conversation.isMuted ? 'unmute' : 'mute', context.conversation)}
            />
            {context.conversation.type === 'DIRECT' && context.conversation.otherUserId && context.conversation.isContact === false && !context.conversation.isSystem ? (
              <ContextMenuButton icon={UserPlus} label={t('addToContacts')} onClick={() => onChatAction('add-contact', context.conversation)} />
            ) : null}
            {context.conversation.type === 'DIRECT' && context.conversation.otherUserId && !context.conversation.isSystem ? (
              <ContextMenuButton
                destructive={!isBlocked}
                icon={Ban}
                label={t(isBlocked ? 'unblock' : 'block')}
                onClick={() => onChatAction(isBlocked ? 'unblock' : 'block', context.conversation)}
              />
            ) : null}
            {!context.conversation.isSystem ? (
              <ContextMenuButton destructive icon={Flag} label={t('report')} onClick={() => onChatAction('report', context.conversation)} />
            ) : null}
            {!context.conversation.isSystem ? (
              <ContextMenuButton destructive icon={Trash2} label={t('delete')} onClick={() => onChatAction('delete', context.conversation)} />
            ) : null}
          </>
        ) : (
          <>
            <ContextMenuButton icon={MessageCircle} label={t('message')} onClick={() => onContactAction('chat', context.contact)} />
            <ContextMenuButton icon={Phone} label={t('voiceCall')} onClick={() => onContactAction('voice', context.contact)} />
            <ContextMenuButton icon={Video} label={t('videoCall')} onClick={() => onContactAction('video', context.contact)} />
            <ContextMenuButton icon={Share2} label={t('shareContact')} onClick={() => onContactAction('share', context.contact)} />
            <ContextMenuButton destructive icon={Trash2} label={t('deleteContact')} onClick={() => onContactAction('delete-contact', context.contact)} />
            <ContextMenuButton destructive icon={Ban} label={t(isBlocked ? 'block' : 'block')} onClick={() => onContactAction('block', context.contact)} />
            <ContextMenuButton destructive icon={Flag} label={t('report')} onClick={() => onContactAction('report', context.contact)} />
          </>
        )}
      </div>
    </div>
  );
}

function ContextMenuButton({
  destructive = false,
  icon: Icon,
  label,
  onClick,
}: {
  destructive?: boolean;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={destructive ? 'destructive' : undefined} onClick={onClick}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function StatusThumb({ status, user }: { status: StatusUpdate | null | undefined; user?: AuthUser | null }) {
  if (status?.kind === 'IMAGE' && status.media) {
    return (
      <span className="status-thumb has-ring">
        <StatusMedia media={status.media} mode="thumb" />
      </span>
    );
  }

  if (status?.kind === 'VIDEO' && status.media) {
    return (
      <span className="status-thumb has-ring">
        <StatusMedia media={status.media} mode="thumb" />
        <Video aria-hidden className="status-thumb-video-icon" size={15} />
      </span>
    );
  }

  if (status?.kind === 'TEXT') {
    return (
      <span className="status-thumb has-ring text" style={{ background: status.backgroundColor || '#2563eb' }}>
        <Type aria-hidden size={20} />
      </span>
    );
  }

  return (
    <span className="status-thumb">
      <Avatar title={user?.displayName || user?.username || 'M'} url={user?.avatarUrl} />
    </span>
  );
}

function StatusGroupRow({ group, onOpen }: { group: StatusGroup; onOpen: () => void }) {
  const latestStatus = group.statuses[group.statuses.length - 1];

  return (
    <button className={`status-row ${group.hasUnviewed ? 'unviewed' : ''}`} onClick={onOpen}>
      <StatusThumb status={latestStatus} user={group.author} />
      <span>
        <strong>{group.author.displayName || group.author.username}</strong>
        <small>{formatStatusTime(latestStatus?.createdAt)}</small>
      </span>
    </button>
  );
}

function StatusProgress({ count, index, progress }: { count: number; index: number; progress: number }) {
  return (
    <div className="status-progress">
      {Array.from({ length: Math.max(1, count) }).map((_, itemIndex) => (
        <span key={itemIndex}>
          <i style={{ width: `${itemIndex < index ? 100 : itemIndex === index ? Math.round(progress * 100) : 0}%` }} />
        </span>
      ))}
    </div>
  );
}

function StatusViewerContent({ onVideoEnded, status }: { onVideoEnded?: () => void; status: StatusUpdate }) {
  if (status.kind === 'TEXT') {
    return (
      <div className="status-viewer-content text" style={{ background: status.backgroundColor || '#2563eb' }}>
        <p>{status.body}</p>
      </div>
    );
  }

  if (status.kind === 'VIDEO' && status.media) {
    return (
      <div className="status-viewer-content media">
        <StatusMedia media={status.media} mode="video" onVideoEnded={onVideoEnded} />
        {status.body ? <p>{status.body}</p> : null}
      </div>
    );
  }

  if (status.kind === 'IMAGE' && status.media) {
    return (
      <div className="status-viewer-content media">
        <StatusMedia media={status.media} mode="image" />
        {status.body ? <p>{status.body}</p> : null}
      </div>
    );
  }

  return <div className="status-viewer-content text"><p>{status.body}</p></div>;
}

function StatusMedia({
  media,
  mode,
  onVideoEnded,
}: {
  media: NonNullable<StatusUpdate['media']>;
  mode: 'image' | 'thumb' | 'video';
  onVideoEnded?: () => void;
}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const mediaUrl = useAuthenticatedMediaUrl(media.id, token, undefined, undefined, DEFAULT_WEB_MEDIA_CACHE_CONFIG, {
    ...media,
    storageKey: '',
  });

  if (!mediaUrl) {
    return <span className="status-media-loading" />;
  }

  if (mode === 'video') {
    return <video autoPlay controls onEnded={onVideoEnded} playsInline src={mediaUrl} />;
  }

  if (mode === 'thumb' && media.mimeType.startsWith('video/')) {
    return <video muted playsInline preload="metadata" src={mediaUrl} />;
  }

  return <img alt={media.originalName || ''} src={mediaUrl} />;
}

function PairingScreen({ onPaired }: { onPaired: (token: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const language = getBrowserLanguage();
  const t = (key: TranslationKey) => translations[language][key];
  const [status, setStatus] = useState<string>(t('waitingForScan'));
  const [pairing, setPairing] = useState<{ pairingId: string; secret: string; url: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function createPairing() {
      const response = await fetch(`${API_URL}/web/pairing`, { method: 'POST' });
      const nextPairing = await response.json();

      if (cancelled) {
        return;
      }

      setPairing(nextPairing);
      await QRCode.toCanvas(canvasRef.current, nextPairing.url, {
        margin: 2,
        width: 280,
      });
    }

    void createPairing().catch((error) => setStatus(error instanceof Error ? error.message : 'Could not create QR'));

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pairing) {
      return undefined;
    }

    const interval = setInterval(async () => {
      const response = await fetch(`${API_URL}/web/pairing/${encodeURIComponent(pairing.pairingId)}?secret=${encodeURIComponent(pairing.secret)}`);
      const payload = await response.json();

      if (payload.status === 'approved' && payload.token) {
        clearInterval(interval);
        onPaired(payload.token);
      } else if (!response.ok) {
        setStatus(payload.error || 'QR expired. Refresh page.');
      }
    }, 1800);

    return () => clearInterval(interval);
  }, [onPaired, pairing]);

  return (
    <div className="pairing-screen">
      <div className="pairing-card">
        <h1>MeetVap Web</h1>
        <p>{t('webPairingHelp')}</p>
        <canvas ref={canvasRef} />
        <span>{status}</span>
      </div>
    </div>
  );
}

function MeetingEndSummaryModal({
  onClose,
  summary,
  t,
}: {
  onClose: () => void;
  summary: MeetingEndSummary;
  t: (key: TranslationKey) => string;
}) {
  return (
    <div className="modal-backdrop">
      <div className="meeting-summary-modal">
        <header>
          <div>
            <strong>{t('meetingSummaryTitle')}</strong>
            <span>{t('meetingSummaryBody')}</span>
          </div>
          <button aria-label={t('cancel')} className="modal-close" onClick={onClose}>
            <X aria-hidden size={18} />
          </button>
        </header>
        <div className="meeting-summary-grid">
          <div>
            <span>{t('meetingSummarySpent')}</span>
            <strong>{formatRecorderDuration(summary.spentSeconds)}</strong>
          </div>
          <div>
            <span>{t('meetingSummaryAvailable')}</span>
            <strong>{formatRecorderDuration(summary.availableSeconds)}</strong>
          </div>
          <div>
            <span>{t('meetingSummaryReset')}</span>
            <strong>{formatMeetingResetTime(summary.resetAt)}</strong>
          </div>
        </div>
        <button className="meeting-summary-close" onClick={onClose}>{t('done')}</button>
      </div>
    </div>
  );
}

function MessageContent({
  cacheConfig,
  message,
  onOpenMedia,
  onContentReady,
  token,
}: {
  cacheConfig: WebMediaCacheConfig;
  message: Message;
  onOpenMedia?: (viewer: MediaViewerState) => void;
  onContentReady?: (message: Message) => void;
  token: string | null;
}) {
  const previewUrl = getLocalPreviewUrl(message);
  const replyPreview = getReplyPreview(message);

  if (message.kind === 'CALL') {
    return (
      <>
        {replyPreview ? <MessageReplyPreview reply={replyPreview} /> : null}
        <p>{message.body || 'Call'}</p>
      </>
    );
  }

  if (message.kind === 'IMAGE' && message.media) {
    return (
      <>
        {replyPreview ? <MessageReplyPreview reply={replyPreview} /> : null}
        <AuthenticatedImageMedia cacheConfig={cacheConfig} caption={message.body} media={message.media} onContentReady={() => onContentReady?.(message)} onOpenMedia={onOpenMedia} previewUrl={previewUrl} token={token} />
      </>
    );
  }

  if (message.kind === 'VIDEO' && message.media) {
    return (
      <>
        {replyPreview ? <MessageReplyPreview reply={replyPreview} /> : null}
        <AuthenticatedVideoMedia cacheConfig={cacheConfig} caption={message.body} media={message.media} onContentReady={() => onContentReady?.(message)} onOpenMedia={onOpenMedia} previewUrl={previewUrl} token={token} />
      </>
    );
  }

  if (message.kind === 'VOICE' && message.media) {
    return (
      <>
        {replyPreview ? <MessageReplyPreview reply={replyPreview} /> : null}
        <AuthenticatedVoiceMedia media={message.media} onContentReady={() => onContentReady?.(message)} token={token} />
      </>
    );
  }

  if (message.kind === 'FILE' && message.media) {
    return (
      <>
        {replyPreview ? <MessageReplyPreview reply={replyPreview} /> : null}
        <AuthenticatedFileMedia media={message.media} onContentReady={() => onContentReady?.(message)} token={token} />
      </>
    );
  }

  return (
    <>
      {replyPreview ? <MessageReplyPreview reply={replyPreview} /> : null}
      <p>{message.body}</p>
    </>
  );
}

function MessageReplyPreview({ reply }: { reply: { body?: string; kind?: string; senderName?: string } }) {
  return (
    <div className="message-reply-preview">
      {reply.senderName ? <strong>{reply.senderName}</strong> : null}
      <span>{reply.body || reply.kind || 'Message'}</span>
    </div>
  );
}

function useAuthenticatedMediaUrl(
  mediaId: string | null | undefined,
  token: string | null,
  previewUrl?: string | null,
  onContentReady?: () => void,
  cacheConfig?: WebMediaCacheConfig,
  media?: NonNullable<Message['media']>,
) {
  const [mediaUrl, setMediaUrl] = useState(previewUrl ?? '');
  const onContentReadyRef = useRef(onContentReady);

  useEffect(() => {
    onContentReadyRef.current = onContentReady;
  }, [onContentReady]);

  useEffect(() => {
    if (previewUrl) {
      setMediaUrl(previewUrl);
      onContentReadyRef.current?.();
      return undefined;
    }

    if (!mediaId || !token) {
      setMediaUrl('');
      return undefined;
    }

    let isCancelled = false;
    let objectUrl = '';

    loadMediaBlob(mediaId, token, cacheConfig ?? DEFAULT_WEB_MEDIA_CACHE_CONFIG, media)
      .then((blob) => {
        if (isCancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setMediaUrl(objectUrl);
        onContentReadyRef.current?.();
      })
      .catch(() => {
        if (!isCancelled) {
          setMediaUrl('');
        }
      });

    return () => {
      isCancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [cacheConfig?.maxSingleMediaBytes, cacheConfig?.maxTotalBytes, media?.mimeType, media?.originalName, media?.sizeBytes, mediaId, previewUrl, token]);

  return mediaUrl;
}

type CachedMediaRecord = {
  blob: Blob;
  cachedAt: number;
  id: string;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
};

async function loadMediaBlob(
  mediaId: string,
  token: string,
  cacheConfig: WebMediaCacheConfig,
  media?: NonNullable<Message['media']>,
) {
  const cachedBlob = await getCachedMediaBlob(mediaId).catch(() => null);

  if (cachedBlob) {
    return cachedBlob;
  }

  const response = await fetch(`${API_URL}/media/${mediaId}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Media request failed: ${response.status}`);
  }

  const blob = await response.blob();

  if (shouldCacheMediaBlob(blob, media, cacheConfig)) {
    void putCachedMediaBlob(mediaId, blob, media, cacheConfig).catch(() => undefined);
  }

  return blob;
}

function shouldCacheMediaBlob(
  blob: Blob,
  media: NonNullable<Message['media']> | undefined,
  cacheConfig: WebMediaCacheConfig,
) {
  return blob.size > 0 &&
    blob.size <= cacheConfig.maxSingleMediaBytes;
}

async function getCachedMediaBlob(mediaId: string) {
  const db = await openMediaCacheDb();
  const record = await mediaCacheRequest<CachedMediaRecord | undefined>(
    db.transaction(MEDIA_CACHE_STORE_NAME, 'readonly')
      .objectStore(MEDIA_CACHE_STORE_NAME)
      .get(mediaId),
  );

  return record?.blob ?? null;
}

async function putCachedMediaBlob(
  mediaId: string,
  blob: Blob,
  media: NonNullable<Message['media']> | undefined,
  cacheConfig: WebMediaCacheConfig,
) {
  const db = await openMediaCacheDb();
  const record: CachedMediaRecord = {
    blob,
    cachedAt: Date.now(),
    id: mediaId,
    mimeType: media?.mimeType || blob.type || 'application/octet-stream',
    originalName: media?.originalName || 'media',
    sizeBytes: blob.size,
  };

  await mediaCacheRequest(
    db.transaction(MEDIA_CACHE_STORE_NAME, 'readwrite')
      .objectStore(MEDIA_CACHE_STORE_NAME)
      .put(record),
  );
  await pruneMediaCache(cacheConfig.maxTotalBytes);
}

async function pruneMediaCache(maxTotalBytes: number) {
  const db = await openMediaCacheDb();
  const records = await mediaCacheRequest<CachedMediaRecord[]>(
    db.transaction(MEDIA_CACHE_STORE_NAME, 'readonly')
      .objectStore(MEDIA_CACHE_STORE_NAME)
      .getAll(),
  );
  let totalBytes = records.reduce((sum, record) => sum + (record.sizeBytes || record.blob.size || 0), 0);

  if (totalBytes <= maxTotalBytes) {
    return;
  }

  const oldestRecords = [...records].sort((left, right) => left.cachedAt - right.cachedAt);
  const recordsToDelete: CachedMediaRecord[] = [];

  for (const record of oldestRecords) {
    if (totalBytes <= maxTotalBytes) {
      break;
    }

    recordsToDelete.push(record);
    totalBytes -= record.sizeBytes || record.blob.size || 0;
  }

  if (recordsToDelete.length === 0) {
    return;
  }

  const transaction = db.transaction(MEDIA_CACHE_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(MEDIA_CACHE_STORE_NAME);

  await Promise.all(recordsToDelete.map((record) => mediaCacheRequest(store.delete(record.id))));
}

let mediaCacheDbPromise: Promise<IDBDatabase> | null = null;

function openMediaCacheDb(): Promise<IDBDatabase> {
  if (mediaCacheDbPromise) {
    return mediaCacheDbPromise;
  }

  mediaCacheDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = indexedDB.open(MEDIA_CACHE_DB_NAME, MEDIA_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db) {
        return;
      }

      if (!db.objectStoreNames.contains(MEDIA_CACHE_STORE_NAME)) {
        const store = db.createObjectStore(MEDIA_CACHE_STORE_NAME, { keyPath: 'id' });
        store.createIndex('cachedAt', 'cachedAt');
      }
      if (!db.objectStoreNames.contains(MESSAGE_CACHE_STORE_NAME)) {
        const store = db.createObjectStore(MESSAGE_CACHE_STORE_NAME, { keyPath: 'id' });
        store.createIndex('userConversationKey', 'userConversationKey');
        store.createIndex('cachedAt', 'cachedAt');
      }
    };
    request.onsuccess = () => {
      if (!request.result) {
        reject(new Error('Could not open media cache'));
        return;
      }

      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open media cache'));
  }).catch((error) => {
    mediaCacheDbPromise = null;
    throw error;
  });

  return mediaCacheDbPromise;
}

function mediaCacheRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Media cache request failed'));
  });
}

async function copyImageMessageToClipboard(message: Message, token: string | null) {
  if (!message.media?.id || !token) {
    return;
  }

  const response = await fetch(`${API_URL}/media/${message.media.id}/file`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Media request failed: ${response.status}`);
  }

  await copyBlobToClipboard(await response.blob());
}

async function copyImageUrlToClipboard(imageUrl: string) {
  await copyBlobToClipboard(await fetch(imageUrl).then((response) => response.blob()));
}

async function copyBlobToClipboard(blob: Blob) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') {
    throw new Error('Clipboard image copy is not supported by this browser');
  }

  const imageBlob = await normalizeClipboardImageBlob(blob);

  await navigator.clipboard.write([
    new ClipboardItem({ [imageBlob.type]: imageBlob }),
  ]);
}

async function normalizeClipboardImageBlob(blob: Blob) {
  if (blob.type === 'image/png') {
    return blob;
  }

  if (!blob.type.startsWith('image/')) {
    throw new Error('Only images can be copied to clipboard');
  }

  const imageBitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');

  canvas.width = imageBitmap.width;
  canvas.height = imageBitmap.height;
  canvas.getContext('2d')?.drawImage(imageBitmap, 0, 0);
  imageBitmap.close();

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
      } else {
        reject(new Error('Could not convert image for clipboard'));
      }
    }, 'image/png');
  });

  return pngBlob;
}

function AuthenticatedImageMedia({ cacheConfig, caption, media, onContentReady, onOpenMedia, previewUrl, token }: { cacheConfig: WebMediaCacheConfig; caption?: string; media: NonNullable<Message['media']>; onContentReady?: () => void; onOpenMedia?: (viewer: MediaViewerState) => void; previewUrl?: string | null; token: string | null }) {
  const imageUrl = useAuthenticatedMediaUrl(media.id, token, previewUrl, onContentReady, cacheConfig, media);

  return (
    <button
      className="media-preview image-preview"
      disabled={!imageUrl}
      onClick={() => imageUrl && onOpenMedia?.({ caption, kind: 'IMAGE', media, url: imageUrl })}
      type="button"
    >
      {imageUrl ? <img alt={media.originalName} className="message-media" loading="lazy" src={imageUrl} /> : <div className="message-media media-loading" />}
      {caption ? <span>{caption}</span> : null}
    </button>
  );
}

function AuthenticatedVideoMedia({ cacheConfig, caption, media, onContentReady, onOpenMedia, previewUrl, token }: { cacheConfig: WebMediaCacheConfig; caption?: string; media: NonNullable<Message['media']>; onContentReady?: () => void; onOpenMedia?: (viewer: MediaViewerState) => void; previewUrl?: string | null; token: string | null }) {
  const videoUrl = useAuthenticatedMediaUrl(media.id, token, previewUrl, onContentReady, cacheConfig, media);

  return (
    <button
      className="media-preview video-preview"
      disabled={!videoUrl}
      onClick={() => videoUrl && onOpenMedia?.({ caption, kind: 'VIDEO', media, url: videoUrl })}
      type="button"
    >
      {videoUrl ? <video className="message-media" muted preload="metadata" src={videoUrl} /> : <div className="message-media media-loading" />}
      {caption ? <span>{caption}</span> : <span>{media.originalName}</span>}
    </button>
  );
}

function AuthenticatedVoiceMedia({ media, onContentReady, token }: { media: NonNullable<Message['media']>; onContentReady?: () => void; token: string | null }) {
  const voiceUrl = useAuthenticatedMediaUrl(media.id, token, undefined, onContentReady);

  return (
    <div className="voice-message">
      <Mic aria-hidden size={18} />
      <audio controls preload="metadata" src={voiceUrl} />
      {media.durationSec ? <span>{formatRecorderDuration(media.durationSec)}</span> : null}
    </div>
  );
}

function AuthenticatedFileMedia({ media, onContentReady, token }: { media: NonNullable<Message['media']>; onContentReady?: () => void; token: string | null }) {
  const fileUrl = useAuthenticatedMediaUrl(media.id, token, undefined, onContentReady);

  if (!fileUrl) {
    return <span>{media.originalName}</span>;
  }

  return <a download={media.originalName} href={fileUrl}>{media.originalName}</a>;
}

function MessageStatus({ status, t }: { status: Message['status']; t: (key: TranslationKey) => string }) {
  if (status === 'SENDING') {
    return (
      <span aria-label={t('sending')} className="message-status sending" title={t('sending')}>
        <LoaderCircle aria-hidden className="spin" size={14} />
      </span>
    );
  }

  const isRead = status === 'READ';
  const StatusIcon = status === 'SENT' ? Check : CheckCheck;
  const label = isRead ? t('read') : status === 'DELIVERED' ? t('delivered') : t('sent');

  return (
    <span
      aria-label={label}
      className={`message-status ${isRead ? 'read' : ''}`}
      title={label}
    >
      <StatusIcon aria-hidden size={16} />
    </span>
  );
}

function Avatar({ title, url }: { title: string; url?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [authenticatedImageUrl, setAuthenticatedImageUrl] = useState<string | null>(null);
  const [didTryAuthenticatedLoad, setDidTryAuthenticatedLoad] = useState(false);
  const authenticatedImageUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setImageFailed(false);
    setDidTryAuthenticatedLoad(false);
    if (authenticatedImageUrlRef.current) {
      URL.revokeObjectURL(authenticatedImageUrlRef.current);
      authenticatedImageUrlRef.current = null;
    }
    setAuthenticatedImageUrl(null);
  }, [url]);

  useEffect(() => () => {
    if (authenticatedImageUrlRef.current) {
      URL.revokeObjectURL(authenticatedImageUrlRef.current);
    }
  }, []);

  if (url && !imageFailed) {
    return (
      <img
        alt=""
        className="avatar"
        onError={() => {
          if (didTryAuthenticatedLoad || !isMeetVapMediaUrl(url)) {
            setImageFailed(true);
            return;
          }

          setDidTryAuthenticatedLoad(true);
          const token = localStorage.getItem(TOKEN_KEY);

          void fetch(resolveAssetUrl(url), {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          })
            .then((response) => {
              if (!response.ok) {
                throw new Error('Avatar failed');
              }

              return response.blob();
            })
            .then((blob) => {
              const objectUrl = URL.createObjectURL(blob);

              if (authenticatedImageUrlRef.current) {
                URL.revokeObjectURL(authenticatedImageUrlRef.current);
              }
              authenticatedImageUrlRef.current = objectUrl;
              setAuthenticatedImageUrl(objectUrl);
            })
            .catch(() => setImageFailed(true));
        }}
        src={authenticatedImageUrl ?? resolveAssetUrl(url)}
      />
    );
  }

  return <span className="avatar">{title.slice(0, 1).toUpperCase()}</span>;
}

function getConversationAvatarUrl(conversation: Conversation, currentUserId?: string) {
  if (conversation.avatarUrl) {
    return conversation.avatarUrl;
  }

  if (conversation.type !== 'DIRECT') {
    return null;
  }

  return conversation.members?.find((member) => (
    member.id === conversation.otherUserId ||
    (!!currentUserId && member.id !== currentUserId)
  ))?.avatarUrl ?? null;
}

function getConversationPeer(conversation: Conversation, currentUserId?: string) {
  return conversation.members?.find((member) => (
    member.id === conversation.otherUserId ||
    (!!currentUserId && member.id !== currentUserId)
  )) ?? null;
}

function shouldShowPremiumStar(conversation: Conversation, currentUserId?: string) {
  if (conversation.type === 'GROUP' || conversation.isSystem) {
    return false;
  }

  return getConversationPeer(conversation, currentUserId)?.hasPremiumAccess === true;
}

function shouldShowNotInContactsBadge(conversation: Conversation) {
  return conversation.type !== 'GROUP' &&
    conversation.isSystem !== true &&
    conversation.isVoiceRoom !== true &&
    !!conversation.otherUserId &&
    conversation.isContact === false;
}

function sortUsersAlphabetically(users: AuthUser[]) {
  return [...users].sort((left, right) => {
    const leftName = `${left.displayName || left.username || ''} ${left.username || ''} ${left.id}`.toLowerCase();
    const rightName = `${right.displayName || right.username || ''} ${right.username || ''} ${right.id}`.toLowerCase();

    return leftName.localeCompare(rightName);
  });
}

function getConversationRoleBadge(conversation: Conversation, currentUserId?: string) {
  if (!currentUserId || conversation.type !== 'GROUP') {
    return null;
  }

  if (conversation.ownerId === currentUserId) {
    return 'owner' as const;
  }

  return conversation.adminIds?.includes(currentUserId) === true ? 'admin' as const : null;
}

function getConversationHeaderTitle(conversation: Conversation | null, selectedPeer: AuthUser | null) {
  if (!conversation) {
    return 'MeetVap Web';
  }

  if (conversation.type !== 'DIRECT') {
    return conversation.title;
  }

  const title = selectedPeer?.displayName || conversation.title;
  const username = selectedPeer?.username?.trim();

  return username ? `${title} (@${username})` : title;
}

function getMainPanelTitle(
  activePanelTab: PanelTab,
  selectedConversation: Conversation | null,
  selectedPeer: AuthUser | null,
  t: (key: TranslationKey) => string,
) {
  if (activePanelTab === 'calls') {
    return t('calls');
  }

  if (activePanelTab === 'contacts') {
    return t('contacts');
  }

  if (activePanelTab === 'settings') {
    return t('settings');
  }

  if (activePanelTab === 'statuses') {
    return t('statuses');
  }

  return getConversationHeaderTitle(selectedConversation, selectedPeer);
}

function getConversationHeaderSubtitle(
  conversation: Conversation | null,
  selectedPeer: AuthUser | null,
  t: (key: TranslationKey) => string,
  language: Language,
) {
  if (!conversation) {
    return '';
  }

  if (conversation.type === 'DIRECT') {
    return formatPresenceSubtitle(selectedPeer, t, language);
  }

  const parts = [];

  if (conversation.showMemberCount !== false && typeof conversation.memberCount === 'number') {
    parts.push(`${conversation.memberCount} ${t('members')}`);
  }
  if (conversation.myGroupAliasName) {
    parts.push(conversation.myGroupAliasName);
  }

  return parts.join(' · ');
}

function formatPresenceSubtitle(user: AuthUser | null, t: (key: TranslationKey) => string, language: Language) {
  if (!user || user.showLastSeen === false) {
    return '';
  }

  if (user.isOnline) {
    return t('online');
  }

  if (!user.lastSeenAt) {
    return '';
  }

  const lastSeenDate = new Date(user.lastSeenAt);

  if (Number.isNaN(lastSeenDate.getTime())) {
    return '';
  }

  const time = lastSeenDate.toLocaleTimeString(getLocaleForLanguage(language), {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isSameCalendarDate(lastSeenDate, new Date())) {
    if (language === 'tr') {
      return `son görülme bugün ${time}`;
    }

    if (language === 'ru') {
      return `был(а) сегодня в ${time}`;
    }

    return `last seen today at ${time}`;
  }

  const date = lastSeenDate.toLocaleDateString(getLocaleForLanguage(language), {
    day: 'numeric',
    month: 'short',
  });

  if (language === 'tr') {
    return `son görülme ${date} ${time}`;
  }

  if (language === 'ru') {
    return `был(а) ${date} в ${time}`;
  }

  return `last seen ${date} at ${time}`;
}

function getLocaleForLanguage(language: Language) {
  if (language === 'tr') {
    return 'tr-TR';
  }

  if (language === 'ru') {
    return 'ru-RU';
  }

  return 'en-US';
}

function isSameCalendarDate(left: Date, right: Date) {
  return left.getDate() === right.getDate() &&
    left.getMonth() === right.getMonth() &&
    left.getFullYear() === right.getFullYear();
}

function messageToCallLog(message: Message, conversations: Conversation[], currentUserId?: string): CallLog {
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  const conversation = conversations.find((item) => item.id === message.conversationId);
  const mode = metadata && 'mode' in metadata && metadata.mode === 'VIDEO' ? 'video' : 'voice';
  const status = metadata && 'callStatus' in metadata && typeof metadata.callStatus === 'string'
    ? mapCallStatus(metadata.callStatus)
    : undefined;
  const direction = metadata && 'callDirection' in metadata && metadata.callDirection === 'INCOMING'
    ? 'incoming'
    : metadata && 'callDirection' in metadata && metadata.callDirection === 'OUTGOING'
      ? 'outgoing'
      : message.senderId === currentUserId
        ? 'outgoing'
        : 'incoming';

  return {
    conversationId: message.conversationId,
    direction,
    happenedAt: message.createdAt,
    id: typeof metadata.callId === 'string' ? metadata.callId : message.id,
    mode,
    status,
    title: conversation?.title || message.sender?.displayName || message.sender?.username || 'Call',
  };
}

function mapCallStatus(status: string): CallLog['status'] {
  if (status === 'CANCELLED') {
    return 'cancelled';
  }

  if (status === 'DECLINED') {
    return 'declined';
  }

  if (status === 'MISSED') {
    return 'missed';
  }

  return 'answered';
}

function mapWebStatus(status: StatusUpdate): StatusUpdate {
  return {
    ...status,
    mediaUri: status.media?.id ? `${API_URL}/media/${status.media.id}/file` : undefined,
  };
}

function sortStatusGroups(groups: StatusGroup[], currentUserId?: string | null) {
  return [...groups].sort((left, right) => {
    const leftOwn = left.author.id === currentUserId;
    const rightOwn = right.author.id === currentUserId;
    if (leftOwn !== rightOwn) {
      return leftOwn ? -1 : 1;
    }
    if (left.hasUnviewed !== right.hasUnviewed) {
      return left.hasUnviewed ? -1 : 1;
    }
    return right.latestAt.localeCompare(left.latestAt);
  });
}

async function uploadWebMedia(file: globalThis.File, kind: 'IMAGE' | 'VIDEO') {
  const uploadResponse = await fetch(`${API_URL}/media/upload-binary`, {
    body: file,
    headers: {
      Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ''}`,
      'Content-Type': file.type || (kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg'),
      'x-mime-type': file.type || (kind === 'VIDEO' ? 'video/mp4' : 'image/jpeg'),
      'x-original-name': encodeURIComponent(file.name || (kind === 'VIDEO' ? 'status-video.mp4' : 'status-photo.jpg')),
    },
    method: 'POST',
  });
  const uploadText = await uploadResponse.text();
  const uploadPayload = uploadText ? JSON.parse(uploadText) : null;

  if (!uploadResponse.ok) {
    throw new Error(uploadPayload?.error || 'Upload failed');
  }

  return uploadPayload.media.id as string;
}

function getStatusDurationMs(status: StatusUpdate) {
  if (status.kind === 'VIDEO') {
    return Math.max(5_000, Math.min(60_000, (status.media?.durationSec ?? 60) * 1000));
  }

  return 5_000;
}

function formatStatusTime(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (date.toDateString() === now.toDateString()) {
    return time;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${time}`;
  }

  return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

function formatMeetingResetTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString([], {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });
}

function setRemoteTrackVolume(track: RemoteTrack, volume: number) {
  const maybeVolumeTrack = track as RemoteTrack & { setVolume?: (nextVolume: number) => void };

  maybeVolumeTrack.setVolume?.(volume);
}

function isMeetVapMediaUrl(url: string) {
  try {
    return new URL(url, API_URL).pathname.startsWith('/media/');
  } catch {
    return url.startsWith('/media/');
  }
}

function mergeMessages(current: Message[], incoming: Message[]) {
  const messagesById = new Map(current.map((message) => [message.id, message]));

  incoming.forEach((message) => messagesById.set(message.id, message));

  return [...messagesById.values()].sort((left, right) => (
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  ));
}

function updateMessageStatuses(
  setMessages: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>,
  conversationId: string,
  messageIds: string[] | undefined,
  messageKeys: string[] | undefined,
  status: Message['status'],
  currentUserId?: string,
) {
  const targetIds = messageIds?.length ? new Set(messageIds) : null;
  const targetKeys = messageKeys?.length ? new Set(messageKeys) : null;

  if (!currentUserId || (!targetIds && !targetKeys)) {
    return;
  }

  setMessages((current) => {
    const conversationMessages = current[conversationId];

    if (!conversationMessages) {
      return current;
    }

    const nextMessages = conversationMessages.map((message) => (
      message.senderId === currentUserId &&
      (
        (!targetIds && !targetKeys) ||
        targetIds?.has(message.id) ||
        (!!targetKeys && !!getMessageDeleteKey(message) && targetKeys.has(getMessageDeleteKey(message) as string))
      ) && getMessageStatusRank(status) > getMessageStatusRank(message.status)
        ? { ...message, status }
        : message
    ));

    cacheConversationMessages(currentUserId, conversationId, nextMessages);
    return {
      ...current,
      [conversationId]: nextMessages,
    };
  });
}

function getMessageDeleteKey(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('deleteKey' in metadata)) {
    return undefined;
  }

  const deleteKey = metadata.deleteKey;

  return typeof deleteKey === 'string' ? deleteKey : undefined;
}

function getMessageStatusRank(status: Message['status']) {
  if (status === 'READ') {
    return 2;
  }

  if (status === 'DELIVERED') {
    return 1;
  }

  return status === 'SENT' ? 0 : -1;
}

function resolveAssetUrl(url: string) {
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }

  try {
    const parsedUrl = new URL(url, API_URL);

    if (parsedUrl.pathname.startsWith('/media/')) {
      return `${API_URL}${parsedUrl.pathname}${parsedUrl.search}`;
    }

    return parsedUrl.toString();
  } catch {
    return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  }
}

function getMessageCacheKey(userId: string | undefined, conversationId: string) {
  return `${MESSAGE_CACHE_PREFIX}${userId ?? 'anonymous'}.${conversationId}`;
}

function getCachedConversationMessages(userId: string | undefined, conversationId: string) {
  try {
    const cacheKeys = new Set<string>([
      getMessageCacheKey(userId, conversationId),
      getMessageCacheKey(undefined, conversationId),
    ]);

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);

      if (key?.startsWith(MESSAGE_CACHE_PREFIX) && key.endsWith(`.${conversationId}`)) {
        cacheKeys.add(key);
      }
    }

    const messages = Array.from(cacheKeys).flatMap((key) => {
      try {
        const raw = localStorage.getItem(key);
        const cachedMessages = raw ? JSON.parse(raw) as Message[] : [];

        return Array.isArray(cachedMessages) ? cachedMessages : [];
      } catch {
        return [];
      }
    });

    return mergeMessages([], messages)
      .filter(isVisibleChatMessage)
      .slice(-MESSAGE_CACHE_LIMIT);
  } catch {
    return [];
  }
}

type CachedMessageRecord = Message & {
  cachedAt: number;
  cacheUserId: string;
  userConversationKey: [string, string];
};

function getMessageCacheUserId(userId: string | undefined) {
  return userId ?? 'anonymous';
}

async function getStoredConversationMessages(userId: string | undefined, conversationId: string) {
  const db = await openMediaCacheDb();
  const cacheUserId = getMessageCacheUserId(userId);
  const records = await mediaCacheRequest<CachedMessageRecord[]>(
    db.transaction(MESSAGE_CACHE_STORE_NAME, 'readonly')
      .objectStore(MESSAGE_CACHE_STORE_NAME)
      .index('userConversationKey')
      .getAll(IDBKeyRange.only([cacheUserId, conversationId])),
  );
  const storedMessages = records
    .map(({ cacheUserId: _cacheUserId, cachedAt: _cachedAt, userConversationKey: _userConversationKey, ...message }) => message)
    .filter(isVisibleChatMessage);
  const legacyMessages = getCachedConversationMessages(userId, conversationId);

  return mergeMessages(storedMessages, legacyMessages).filter(isVisibleChatMessage);
}

async function replaceStoredConversationMessages(userId: string | undefined, conversationId: string, messages: Message[]) {
  const db = await openMediaCacheDb();
  const cacheUserId = getMessageCacheUserId(userId);
  const visibleMessages = messages.filter(isVisibleChatMessage);
  const records = await mediaCacheRequest<CachedMessageRecord[]>(
    db.transaction(MESSAGE_CACHE_STORE_NAME, 'readonly')
      .objectStore(MESSAGE_CACHE_STORE_NAME)
      .index('userConversationKey')
      .getAll(IDBKeyRange.only([cacheUserId, conversationId])),
  );
  const nextMessageIds = new Set(visibleMessages.map((message) => message.id));
  const transaction = db.transaction(MESSAGE_CACHE_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(MESSAGE_CACHE_STORE_NAME);

  await Promise.all([
    ...records
      .filter((record) => !nextMessageIds.has(record.id))
      .map((record) => mediaCacheRequest(store.delete(record.id))),
    ...visibleMessages.map((message) => {
      const record: CachedMessageRecord = {
        ...message,
        cachedAt: Date.now(),
        cacheUserId,
        userConversationKey: [cacheUserId, conversationId],
      };

      return mediaCacheRequest(store.put(record));
    }),
  ]);
}

function cacheConversationMessages(userId: string | undefined, conversationId: string, messages: Message[]) {
  try {
    const visibleMessages = messages.filter(isVisibleChatMessage);

    localStorage.setItem(
      getMessageCacheKey(userId, conversationId),
      JSON.stringify(visibleMessages.slice(-MESSAGE_CACHE_LIMIT)),
    );
    void replaceStoredConversationMessages(userId, conversationId, visibleMessages).catch(() => undefined);
  } catch {
    // Browser storage can be full or disabled. Fresh server loading still works.
  }
}

function isVisibleChatMessage(message: Message) {
  if (message.kind === 'CALL') {
    return true;
  }

  if (message.body?.trim()) {
    return true;
  }

  if (message.media || message.mediaId) {
    return true;
  }

  return false;
}

function getSupportedVoiceMimeType() {
  const options = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  return options.find((option) => MediaRecorder.isTypeSupported(option)) ?? '';
}

function getVoiceFileExtension(mimeType: string) {
  if (mimeType.includes('mp4')) {
    return '.m4a';
  }

  if (mimeType.includes('ogg')) {
    return '.ogg';
  }

  return '.webm';
}

function formatRecorderDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatConversationTime(value?: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
}

function getConversationPreviewText(conversation: Conversation, t: (key: TranslationKey) => string) {
  const lastMessage = conversation.lastMessage?.trim();

  if (lastMessage) {
    return lastMessage;
  }

  switch (conversation.lastMessageKind) {
    case 'IMAGE':
      return t('gallery');
    case 'VIDEO':
      return t('gallery');
    case 'FILE':
      return t('file');
    case 'VOICE':
      return t('voiceMessage');
    case 'CALL':
      return t('calls');
    default:
      return conversation.type === 'GROUP'
        ? `${conversation.memberCount ?? 0} members`
        : '';
  }
}

function getConversationPreviewTextWithLocalFallback(
  conversation: Conversation,
  messages: Message[],
  t: (key: TranslationKey) => string,
) {
  const explicitPreview = conversation.lastMessage?.trim();

  if (explicitPreview) {
    return explicitPreview;
  }

  const conversationPreview = getConversationPreviewText(conversation, t).trim();

  if (conversationPreview && conversation.lastMessageKind && conversation.lastMessageKind !== 'TEXT') {
    return conversationPreview;
  }

  const localLastMessage = findLocalConversationPreviewMessage(conversation, messages);

  if (localLastMessage) {
    return getMessagePreviewText(localLastMessage);
  }

  return conversationPreview;
}

function applyMessageConversationPreview(conversation: Conversation, message: Message) {
  return {
    ...conversation,
    lastMessage: getMessagePreviewText(message),
    lastMessageAt: message.createdAt,
    lastMessageId: message.id,
    lastMessageKind: message.kind,
    lastMessageSenderId: message.senderId,
    lastMessageStatus: message.status,
  };
}

function applyLocalConversationPreview(conversation: Conversation, messages: Message[]) {
  const localLastMessage = findLocalConversationPreviewMessage(conversation, messages);

  if (!localLastMessage) {
    return conversation;
  }

  const localLastMessageAt = new Date(localLastMessage.createdAt).getTime();
  const conversationLastMessageAt = conversation.lastMessageAt
    ? new Date(conversation.lastMessageAt).getTime()
    : 0;
  const isSameLastMessage = !!conversation.lastMessageId && conversation.lastMessageId === localLastMessage.id;
  const hasServerPreview = !!conversation.lastMessage?.trim();
  const shouldUseLocalPreview = localLastMessageAt > conversationLastMessageAt ||
    isSameLastMessage ||
    (!hasServerPreview && localLastMessageAt >= conversationLastMessageAt);

  if (!shouldUseLocalPreview) {
    return conversation;
  }

  return applyMessageConversationPreview(conversation, localLastMessage);
}

function findLocalConversationPreviewMessage(conversation: Conversation, messages: Message[]) {
  if (messages.length === 0) {
    return null;
  }

  if (conversation.lastMessageId) {
    const matchingMessage = messages.find((message) => message.id === conversation.lastMessageId);

    if (matchingMessage) {
      return matchingMessage;
    }
  }

  if (conversation.lastMessageAt) {
    const conversationLastMessageAt = new Date(conversation.lastMessageAt).getTime();
    const matchingPreviewMessage = messages.find((message) => {
      const messageCreatedAt = new Date(message.createdAt).getTime();

      return Math.abs(messageCreatedAt - conversationLastMessageAt) <= 1000 &&
        (!conversation.lastMessageSenderId || message.senderId === conversation.lastMessageSenderId) &&
        (!conversation.lastMessageKind || message.kind === conversation.lastMessageKind);
    });

    if (matchingPreviewMessage) {
      return matchingPreviewMessage;
    }
  }

  return messages.reduce<Message | null>((latest, message) => {
    if (!latest) {
      return message;
    }

    return new Date(message.createdAt).getTime() > new Date(latest.createdAt).getTime()
      ? message
      : latest;
  }, null);
}

function findLatestMessage(messages: Message[]) {
  return messages.reduce<Message | null>((latest, message) => {
    if (!latest) {
      return message;
    }

    return new Date(message.createdAt).getTime() > new Date(latest.createdAt).getTime()
      ? message
      : latest;
  }, null);
}

function shouldRefreshConversationPreview(
  conversation: Conversation,
  cachedMessages: Message[],
  currentUserId: string | undefined,
  t: (key: TranslationKey) => string,
) {
  const previewText = getConversationPreviewText(conversation, t).trim();

  if (!previewText) {
    return true;
  }

  const localPreviewMessage = findLocalConversationPreviewMessage(conversation, cachedMessages);

  if (localPreviewMessage) {
    const localLastMessageAt = new Date(localPreviewMessage.createdAt).getTime();
    const conversationLastMessageAt = conversation.lastMessageAt
      ? new Date(conversation.lastMessageAt).getTime()
      : 0;

    if (
      localLastMessageAt > conversationLastMessageAt &&
      localPreviewMessage.id !== conversation.lastMessageId
    ) {
      return true;
    }
  }

  return !!currentUserId;
}

function getDisplayConversationLastMessageStatus(conversation: Conversation, latestLocalMessage: Message | null) {
  if (!latestLocalMessage) {
    return conversation.lastMessageStatus;
  }

  const conversationLastMessageAt = conversation.lastMessageAt
    ? new Date(conversation.lastMessageAt).getTime()
    : 0;
  const localLastMessageAt = new Date(latestLocalMessage.createdAt).getTime();
  const isSameMessage = !!conversation.lastMessageId && conversation.lastMessageId === latestLocalMessage.id;
  const isSameMoment = Math.abs(localLastMessageAt - conversationLastMessageAt) <= 1000 &&
    (!conversation.lastMessageSenderId || conversation.lastMessageSenderId === latestLocalMessage.senderId);

  return isSameMessage || isSameMoment || localLastMessageAt >= conversationLastMessageAt
    ? latestLocalMessage.status
    : conversation.lastMessageStatus;
}

function sortConversationsByLastMessage(conversations: Conversation[]) {
  return [...conversations].sort((left, right) => (
    new Date(right.lastMessageAt ?? 0).getTime() - new Date(left.lastMessageAt ?? 0).getTime()
  ));
}

function buildMessageRows(messages: Message[], t: (key: TranslationKey) => string): MessageListRow[] {
  const rows: MessageListRow[] = [];
  let lastDateKey = '';

  messages.forEach((message) => {
    const date = new Date(message.createdAt);
    const dateKey = getDateKey(date);

    if (dateKey !== lastDateKey) {
      rows.push({
        id: `date-${dateKey}`,
        label: formatMessageDateDivider(date, t),
        type: 'date',
      });
      lastDateKey = dateKey;
    }

    rows.push({ message, type: 'message' });
  });

  return rows;
}

function getDateKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function formatMessageDateDivider(date: Date, t: (key: TranslationKey) => string) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDiff === 0) {
    return t('today');
  }

  if (dayDiff === 1) {
    return t('yesterday');
  }

  return date.toLocaleDateString();
}

function getMessagePreviewText(message: Message) {
  const body = message.body?.trim();

  if (body) {
    return body;
  }

  if (message.media?.originalName && message.kind === 'FILE') {
    return message.media.originalName;
  }

  return message.kind;
}

function createLocalMessageId() {
  return `web-local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createOptimisticMessage(input: {
  body: string;
  conversationId: string;
  id: string;
  kind: Message['kind'];
  media?: Message['media'];
  metadata?: Message['metadata'];
  user: AuthUser | null;
}): Message {
  return {
    body: input.body,
    conversationId: input.conversationId,
    createdAt: new Date().toISOString(),
    id: input.id,
    kind: input.kind,
    media: input.media,
    metadata: {
      ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
      clientId: input.id,
    },
    sender: input.user ?? undefined,
    senderId: input.user?.id ?? '',
    status: 'SENDING',
  };
}

function getLocalPreviewUrl(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('previewUrl' in metadata)) {
    return null;
  }

  return typeof metadata.previewUrl === 'string' ? metadata.previewUrl : null;
}

function getReplyPreview(message: Message) {
  const metadata = message.metadata;

  if (!metadata || typeof metadata !== 'object' || !('replyTo' in metadata)) {
    return null;
  }

  const replyTo = metadata.replyTo;

  if (!replyTo || typeof replyTo !== 'object') {
    return null;
  }

  const body = 'body' in replyTo && typeof replyTo.body === 'string' ? replyTo.body : undefined;
  const kind = 'kind' in replyTo && typeof replyTo.kind === 'string' ? replyTo.kind : undefined;
  const senderName = 'senderName' in replyTo && typeof replyTo.senderName === 'string' ? replyTo.senderName : undefined;

  return { body, kind, senderName };
}

function getPastedGalleryFile(clipboardData: DataTransfer) {
  const item = Array.from(clipboardData.items).find((clipboardItem) => (
    clipboardItem.kind === 'file' &&
    (clipboardItem.type.startsWith('image/') || clipboardItem.type.startsWith('video/'))
  ));
  const file = item?.getAsFile();

  if (!file) {
    return null;
  }

  const type = file.type || item?.type || 'image/png';
  const hasName = file.name && file.name.trim().length > 0;

  if (hasName) {
    return file;
  }

  const extension = getExtensionForMimeType(type);
  const prefix = type.startsWith('video/') ? 'pasted-video' : 'pasted-image';

  return new globalThis.File([file], `${prefix}-${Date.now()}.${extension}`, { type });
}

function getExtensionForMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    default:
      return mimeType.startsWith('video/') ? 'mp4' : 'png';
  }
}

function showBrowserNotification(message: Message) {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission === 'default') {
    void Notification.requestPermission();
    return;
  }

  if (Notification.permission === 'granted') {
    new Notification(message.sender?.displayName ?? 'MeetVap', {
      body: message.body || message.kind,
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
