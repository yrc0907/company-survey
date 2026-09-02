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
  /** 手机身份只在通过验证码校验后用于认证；未绑定时为 null。 */
  phoneE164?: string | null;
  phoneVerifiedAt?: string | null;
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

/** 统一验证码通道；邮件和短信共用同一挑战状态机。 */
export type VerificationChannel = "email" | "sms";

/** 验证码业务用途，服务端会按用途限制可执行动作。 */
export type VerificationPurpose = "email_verification" | "email_login" | "password_reset" | "email_change" | "phone_login" | "phone_bind" | "phone_change";

/** 验证码挑战的非敏感公开投影；绝不包含验证码明文或哈希。 */
export interface VerificationChallengeReceipt {
  challengeId: string;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  maskedDestination: string;
  expiresAt: string;
  resendAfter: string;
}

/** 账户身份绑定审计；目标只保留哈希和脱敏值，不保存邮箱/手机号原文。 */
export interface IdentityAuditRecord {
  id: string;
  userId: string;
  actorUserId: string | null;
  channel: VerificationChannel;
  action: "verify" | "bind" | "change";
  outcome: "success" | "conflict" | "rejected";
  previousDestinationHash: string | null;
  destinationHash: string;
  previousMaskedDestination: string | null;
  maskedDestination: string;
  challengeId: string | null;
  reasonCode: string | null;
  createdAt: string;
}
