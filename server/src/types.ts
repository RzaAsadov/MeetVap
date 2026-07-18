import { User } from '@prisma/client';

export type AuthUser = Pick<User, 'id' | 'displayName' | 'username' | 'avatarUrl'> & Partial<Pick<User, 'hideFromSearch' | 'hideNickname' | 'lastSeenAt' | 'onlyContactsCanCall' | 'showLastSeen' | 'useGroupAliases'>> & {
  hasPremiumAccess?: boolean;
  preventPeerScreenshots?: boolean;
  publicShareCode?: string | null;
};

export type JwtPayload = {
  exp?: number;
  scope?: 'web';
  sub: string;
  username: string;
};

declare global {
  namespace Express {
    interface Request {
      messageClient?: string;
      user?: AuthUser;
    }
  }
}
