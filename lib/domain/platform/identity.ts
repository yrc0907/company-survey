/** 平台级角色只处理治理边界；项目内权限由 ProjectMemberRole 决定。 */
export type PlatformRole = "user" | "admin";
export type AccountStatus = "active" | "suspended" | "deleted";

/** 可进入会话的最小用户投影，不包含密码哈希或 OAuth 凭据。 */
export interface PlatformAccount {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarAssetId: string | null;
  role: PlatformRole;
  status: AccountStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 认证仓储内部使用的密码账户；禁止把 passwordHash 返回给 API。 */
export interface PasswordAccount extends PlatformAccount {
  passwordHash: string;
  lockedUntil: string | null;
}

/** 注册服务的受信输入，进入服务前仍会执行规范化和业务唯一性检查。 */
export interface RegisterAccountInput {
  email: string;
  username: string;
  displayName?: string;
  password: string;
}

/** OAuth 身份经过 Provider 验证后的最小资料。 */
export interface OAuthIdentityInput {
  provider: "github";
  providerAccountId: string;
  email: string;
  usernameHint: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

/** API 与服务共享的身份上下文；角色永远来自服务端会话。 */
export interface AuthenticatedActor {
  userId: string;
  role: PlatformRole;
}
