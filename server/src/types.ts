import { User } from '@prisma/client';

export type AuthUser = Pick<User, 'id' | 'displayName' | 'username' | 'avatarUrl'> & Partial<Pick<User, 'hideFromSearch' | 'hideNickname' | 'lastSeenAt' | 'onlyContactsCanCall' | 'showLastSeen' | 'useGroupAliases'>> & {
  authVersion?: number;
  hasPremiumAccess?: boolean;
  preventPeerScreenshots?: boolean;
  publicShareCode?: string | null;
};

export type JwtPayload = {
  exp?: number;
  scope?: 'web';
  sub: string;
  username: string;
  authVersion?: number;
};

declare global {
  namespace Express {
    interface Request {
      messageClient?: string;
      user?: AuthUser;
    }
  }
}
