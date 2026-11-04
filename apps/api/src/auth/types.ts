import type { ApiEnv } from '../config/env.js';

export type UserType = 'customer' | 'internal';

export interface AuthUser {
  id: string;
  type: UserType;
  username: string;
  displayName: string;
  companyId?: string;
  companyCode?: string;
  companyName?: string;
  roles: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

export interface AuthContext {
  sessionId: string;
  sessionTokenHash: string;
  user: AuthUser;
}

export type AuthConfig = Pick<
  ApiEnv,
  | 'cookieSecure'
  | 'customerSessionIdleHours'
  | 'customerSessionAbsoluteDays'
  | 'internalSessionIdleHours'
  | 'internalSessionAbsoluteHours'
  | 'loginMaxAttempts'
  | 'loginWindowMinutes'
  | 'loginLockMinutes'
  | 'trustProxy'
>;
