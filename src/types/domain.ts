export type AuthUser = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
  groupAliasName?: string | null;
  groupAliasPromptSeen?: boolean;
  groupInvitePending?: boolean;
  hasPremiumAccess?: boolean;
  hideFromSearch?: boolean;
  hideNickname?: boolean;
  isBlocked?: boolean;
  isContact?: boolean;
  isOnline?: boolean;
  isSystem?: boolean;
  lastSeenAt?: string | null;
  onlyContactsCanCall?: boolean;
  preventPeerScreenshots?: boolean;
  publicShareCode?: string | null;
  showLastSeen?: boolean;
  useGroupAliases?: boolean;
};

export type Conversation = {
  adminIds?: string[];
  id: string;
  title: string;
  avatarLabel: string;
  avatarUrl?: string | null;
  disappearingMessagesDurationMinutes?: number | null;
  disappearingMessagesExpiredAt?: string | null;
  disappearingMessagesSetById?: string | null;
  hideMembers?: boolean;
  isContact?: boolean;
  isMuted?: boolean;
  mutedUntil?: string | null;
  isSystem?: boolean;
  isPublic?: boolean;
  isVoiceRoom?: boolean;
  memberCount?: number;
  members?: AuthUser[];
  myGroupInvitePending?: boolean;
  myGroupAliasName?: string | null;
  myGroupAliasPromptSeen?: boolean;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageAtIso?: string;
  lastMessageId?: string;
  lastMessageKind?: MessageKind;
  lastMessageSenderId?: string;
  lastMessageStatus?: Message['status'];
  otherUserId?: string;
  ownerId?: string | null;
  ownerOnlyMessages?: boolean;
  preventMediaSave?: boolean;
  preventScreenshots?: boolean;
  publicInviteCode?: string | null;
  searchSnippet?: string;
  showAdmins?: boolean;
  showMemberCount?: boolean;
  type?: 'DIRECT' | 'GROUP';
  unreadCount: number;
  isOnline?: boolean;
};

export type VoiceRoomParticipant = {
  adminMuted: boolean;
  isConnected: boolean;
  joinedAt: string;
  selfMuted: boolean;
  user: AuthUser;
  userId: string;
};

export type MessageKind = 'text' | 'image' | 'video' | 'file' | 'voice' | 'call';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  sender?: AuthUser;
  kind: MessageKind;
  body: string;
  createdAt: string;
  createdAtIso?: string;
  metadata?: {
    callDirection?: 'INCOMING' | 'OUTGOING';
    callId?: string;
    callStatus?: 'CANCELLED' | 'DECLINED' | 'ENDED' | 'MISSED' | 'RINGING';
    clientId?: string;
    connectedAt?: string;
    deleteKey?: string;
    durationSeconds?: number;
    editedAt?: string;
    endedAt?: string;
    forwarded?: boolean;
    mode?: 'VOICE' | 'VIDEO';
    replyTo?: {
      body: string;
      id: string;
      kind: MessageKind;
      senderName: string;
    };
    location?: {
      address?: string;
      latitude: number;
      longitude: number;
    };
    liveLocation?: LiveLocation;
    liveLocationEstablishment?: {
      durationMinutes: 15 | 60 | 240 | 720;
      state: 'failed' | 'pending';
      startedAt: string;
    };
    reactionFallback?: {
      emoji: string;
      messageId: string;
    };
    reactions?: Record<string, string>;
    remoteMediaUri?: string;
    scheduledMessageId?: string;
    scheduledSendAt?: string;
    disappearingAfterView?: {
      seconds: number;
    };
    disappearingDeleteAt?: string;
    disappearingOpenedAt?: string;
    startedAt?: string;
  } | Record<string, unknown>;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  mediaId?: string;
  mediaUri?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationSeconds?: number;
};

export type LiveLocation = {
  address?: string;
  expiresAt: string;
  id: string;
  latitude: number;
  longitude: number;
  startedAt: string;
  stoppedAt?: string;
  updatedAt: string;
};

export type CallLog = {
  id: string;
  conversationId?: string;
  title: string;
  happenedAt: string;
  happenedAtIso?: string;
  direction: 'incoming' | 'outgoing';
  status?: 'answered' | 'cancelled' | 'declined' | 'missed';
  mode: 'voice' | 'video';
};

export type SubscriptionStatus = {
  entitlement: {
    environment: 'SANDBOX' | 'PRODUCTION';
    expiresAt: string;
    platform: 'IOS' | 'ANDROID' | 'MANUAL';
    productId: string;
    status: string;
    willRenew: boolean;
  } | null;
  hasActiveSubscription: boolean;
  hasPremiumAccess?: boolean;
  premiumAccessSource?: 'none' | 'subscription' | 'trial';
  premiumTrialDays?: number;
  premiumTrialDaysRemaining?: number;
  premiumTrialEndsAt?: string | null;
  premiumTrialStartedAt?: string | null;
};
