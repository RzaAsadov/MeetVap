import type { NavigatorScreenParams } from '@react-navigation/native';
import type { VoiceEffectId } from './voiceEffects';

export type RootStackParamList = {
  ServerSetup: undefined;
  AddContact: undefined;
  Contacts: undefined;
  Auth: undefined;
  Settings: undefined;
  Subscription: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  NewChat: undefined;
  NewGroup: { mode?: 'group' | 'voiceRoom' } | undefined;
  BlockedUsers: undefined;
  ChangePassword: undefined;
  Devices: undefined;
  SharedContact: {
    username: string;
  };
  SharedGroup: {
    code: string;
  };
  MeetingRoom: {
    autoJoin?: boolean;
    code: string;
    link?: string;
    mode?: 'voice' | 'video';
  };
  ShareTarget: {
    items: SharedIntentItem[];
  } | undefined;
  StorageUsage: undefined;
  ChatRoom: {
    conversationId: string;
    isGroup?: boolean;
    openReason?: 'chat-list' | 'notification';
    sharedItems?: SharedIntentItem[];
    targetMessageId?: string;
    title: string;
  };
  CallRoom: {
    answeredByNative?: boolean;
    autoJoin?: boolean;
    callAccess?: 'locked-call';
    callId?: string;
    callState?: 'active' | 'pending';
    conversationId?: string;
    direction?: 'incoming' | 'outgoing';
    initialInviteeIds?: string[];
    isGroupCall?: boolean;
    participantNames?: string[];
    resumeActiveCall?: boolean;
    title: string;
    mode: 'voice' | 'video';
    voiceEffectId?: VoiceEffectId;
  };
};

export type SharedIntentItem = {
  fileName?: string;
  kind: 'file' | 'text';
  mimeType?: string;
  sizeBytes?: number;
  text?: string;
  uri?: string;
};

export type MainTabParamList = {
  Chats: undefined;
  Calls: undefined;
  Status: { authorId?: string } | undefined;
  Catalog: undefined;
};
