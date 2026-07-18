import { CallLog, Conversation, Message } from '../types/domain';

export const currentUserId = 'me';

export const conversations: Conversation[] = [
  {
    id: 'c1',
    title: 'Aylin',
    avatarLabel: 'A',
    lastMessage: 'Let me know when the server is ready.',
    lastMessageAt: '14:42',
    unreadCount: 2,
    isOnline: true,
  },
  {
    id: 'c2',
    title: 'Ops Team',
    avatarLabel: 'O',
    lastMessage: 'Docker compose file looks good.',
    lastMessageAt: '12:08',
    unreadCount: 0,
  },
  {
    id: 'c3',
    title: 'Mert',
    avatarLabel: 'M',
    lastMessage: 'Voice message',
    lastMessageAt: 'Yesterday',
    unreadCount: 0,
  },
];

export const messages: Message[] = [
  {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'u1',
    kind: 'text',
    body: 'We should keep the first version simple and fast.',
    createdAt: '14:37',
    status: 'read',
  },
  {
    id: 'm2',
    conversationId: 'c1',
    senderId: currentUserId,
    kind: 'text',
    body: 'Agreed. Text chat first, then files, then calls.',
    createdAt: '14:39',
    status: 'read',
  },
  {
    id: 'm3',
    conversationId: 'c1',
    senderId: 'u1',
    kind: 'text',
    body: 'Let me know when the server is ready.',
    createdAt: '14:42',
    status: 'delivered',
  },
];

export const calls: CallLog[] = [
  {
    id: 'call1',
    title: 'Aylin',
    happenedAt: 'Today, 13:20',
    direction: 'incoming',
    mode: 'voice',
  },
  {
    id: 'call2',
    title: 'Ops Team',
    happenedAt: 'Yesterday, 18:04',
    direction: 'outgoing',
    mode: 'video',
  },
];
