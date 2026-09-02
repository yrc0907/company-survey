import { randomUUID } from "node:crypto";

import { AccountConflictError, InvalidCredentialsError } from "@/lib/domain/platform/errors";
import type { OAuthIdentityInput, PlatformAccount, RegisterAccountInput, VerificationChannel } from "@/lib/domain/platform";
import { ValidationError } from "@/lib/domain/errors";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";

export interface PasswordHasher {
  hash(value: string): Promise<string>;
  verify(hash: string, value: string): Promise<boolean>;
}

// 固定的非账户 Argon2id 哈希用于不存在账号的等成本校验；它不是任何用户凭据或密钥。
const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$LrxArnRO8oYFv0gZ7UT7oA$acoKv7+CyH7DvCR52kWTD2c0lhnmoJhpIgrTS1Hg2MA";

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** 将已验证身份投影成稳定的默认用户名；冲突后由服务追加随机后缀。 */
function autoUsernameBase(channel: VerificationChannel, destination: string): string {
  const candidate = channel === "email" ? destination.split("@")[0]! : `user-${destination.replace(/\D/g, "").slice(-8)}`;
  const normalized = candidate.toLowerCase().replace(/[^a-z0-9_\-\u4e00-\u9fff]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized.length >= 3 ? normalized.slice(0, 32) : "user";
}

/** 手机优先账户尚未绑定真实邮箱时的内部占位地址；不会作为邮件投递目标。 */
function phonePlaceholderEmail(phoneE164: string): string {
  return `phone-${phoneE164.replace(/\D/g, "")}@phone.local`;
}

/**
 * 账户服务负责普通注册、密码认证与 OAuth 身份落库。
 * 输入会规范化；输出从不包含密码哈希；副作用仅通过 Repository 原子写入。
 */
export class AccountService {
  public constructor(private readonly repository: PlatformRepository, private readonly passwordHasher: PasswordHasher) {}

  /** 注册普通账户；唯一性最终由数据库唯一索引保证，避免并发检查后写入竞态。 */
  public async register(input: RegisterAccountInput): Promise<PlatformAccount> {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    if (!/^[a-z0-9_\-\u4e00-\u9fff]{3,32}$/.test(username)) {
      throw new ValidationError("用户名需为 3-32 位中文、字母、数字、下划线或短横线");
    }
    const displayName = input.displayName?.replace(/\s+/g, " ").trim() || username;
    const now = new Date().toISOString();
    const passwordHash = await this.passwordHasher.hash(input.password);
    return this.repository.createPasswordAccount({
      account: {
        id: randomUUID(), email, username, displayName, avatarAssetId: null, role: "user", status: "active",
        emailVerifiedAt: null, createdAt: now, updatedAt: now,
      },
      passwordHash,
    });
  }

  /**
   * 为已通过 OTP 的邮箱或手机号创建最小可登录账户。
   * 副作用：写入账户、资料与不可知的随机密码凭据；用户后续可绑定其他身份或通过找回密码设置密码。
   */
  public async provisionVerifiedIdentity(input: { channel: VerificationChannel; destination: string }): Promise<PlatformAccount> {
    const existing = input.channel === "email"
      ? await this.repository.findAccountByEmail(normalizeEmail(input.destination))
      : await this.repository.findAccountByPhone(input.destination);
    if (existing) return existing;

    const now = new Date().toISOString();
    const passwordHash = await this.passwordHasher.hash(`${randomUUID()}-${randomUUID()}`);
    const base = autoUsernameBase(input.channel, input.destination);
    const email = input.channel === "email" ? normalizeEmail(input.destination) : phonePlaceholderEmail(input.destination);

    // 用户名由数据库唯一索引裁决；只对用户名碰撞重试，避免吞掉邮箱/手机号身份冲突。
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${randomUUID().slice(0, 6)}`;
      const username = `${base.slice(0, 32 - suffix.length)}${suffix}`;
      const account: PlatformAccount = {
        id: randomUUID(), email, username, displayName: username, avatarAssetId: null, role: "user", status: "active",
        emailVerifiedAt: input.channel === "email" ? now : null,
        phoneE164: input.channel === "sms" ? input.destination : null,
        phoneVerifiedAt: input.channel === "sms" ? now : null,
        createdAt: now, updatedAt: now,
      };
      try {
        return await this.repository.createPasswordAccount({ account, passwordHash });
      } catch (error) {
        if (!(error instanceof AccountConflictError)) throw error;
        if (error.field === "username") continue;
        const winner = input.channel === "email"
          ? await this.repository.findAccountByEmail(normalizeEmail(input.destination))
          : await this.repository.findAccountByPhone(input.destination);
        if (winner) return winner;
        throw error;
      }
    }
    throw new AccountConflictError("username", "无法分配可用用户名，请重新获取验证码后再试");
  }

  /** 密码登录统一返回同一错误，避免用响应差异枚举邮箱或用户名。 */
  public async authenticate(identifier: string, password: string): Promise<PlatformAccount> {
    const account = await this.repository.findPasswordAccountByIdentifier(identifier.trim().toLowerCase());
    // 账号不存在时仍执行同规格 Argon2id，降低用响应时间枚举账号的信号。
    const valid = await this.passwordHasher.verify(account?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
    if (!account || !valid || account.status !== "active" || (account.lockedUntil && new Date(account.lockedUntil) > new Date())) {
      throw new InvalidCredentialsError();
    }
    const { passwordHash: _passwordHash, lockedUntil: _lockedUntil, ...safeAccount } = account;
    return safeAccount;
  }

  /** GitHub 已验证身份进入统一用户表；无邮箱时拒绝，避免创建不可恢复的幽灵账户。 */
  public async authenticateOAuth(input: OAuthIdentityInput): Promise<PlatformAccount> {
    if (!input.email.trim()) throw new InvalidCredentialsError();
    const account = await this.repository.findOrCreateOAuthAccount({ ...input, email: normalizeEmail(input.email) });
    if (account.status !== "active") throw new InvalidCredentialsError();
    return account;
  }
}
