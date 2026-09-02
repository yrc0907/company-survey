import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import type { AuthenticatedActor, PlatformAccount, VerificationChannel, VerificationPurpose, VerificationChallengeReceipt } from "@/lib/domain/platform";
import { AccountConflictError, InvalidVerificationCodeError, VerificationProviderError, VerificationRateLimitError } from "@/lib/domain/platform";
import { ValidationError } from "@/lib/domain/errors";
import type { CaptchaProvider } from "@/lib/providers/auth/captcha-provider";
import type { EmailProvider } from "@/lib/providers/auth/email-provider";
import type { SmsProvider } from "@/lib/providers/auth/sms-provider";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import type { VerificationRepository } from "@/lib/repositories/auth/verification-repository";

export interface RequestVerificationInput {
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  destination: string;
  actor: AuthenticatedActor | null;
  captchaTicket: string | null;
  clientIp: string | null;
  deviceId: string | null;
}

export interface VerifyChallengeInput {
  challengeId: string;
  destination: string;
  code: string;
  actorUserId?: string | null;
}

export interface VerificationServiceDependencies {
  accounts: PlatformRepository;
  challenges: VerificationRepository;
  emailProvider: EmailProvider | null;
  smsProvider: SmsProvider | null;
  captchaProvider: CaptchaProvider | null;
  environment?: Record<string, string | undefined>;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
  if (/^\+\d{8,15}$/.test(compact)) return compact;
  throw new ValidationError("手机号格式无效，请使用国内 11 位号码或 E.164 格式");
}

function normalizeDestination(channel: VerificationChannel, value: string): string {
  if (channel === "email") {
    const normalized = normalizeEmail(value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ValidationError("邮箱格式无效");
    return normalized;
  }
  return normalizePhone(value);
}

function maskDestination(channel: VerificationChannel, destination: string): string {
  if (channel === "email") {
    const [local, domain] = destination.split("@");
    const prefix = local!.length <= 2 ? `${local![0] ?? "*"}*` : `${local!.slice(0, 2)}***`;
    return `${prefix}@${domain}`;
  }
  return `${destination.slice(0, 3)}****${destination.slice(-4)}`;
}

function hashValue(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secretFrom(environment: Record<string, string | undefined>): string {
  const secret = environment.AUTH_CHALLENGE_PEPPER?.trim() || environment.NEXTAUTH_SECRET?.trim();
  if (secret) return secret;
  if (environment.NODE_ENV === "production") throw new VerificationProviderError("认证服务密钥未配置");
  return "local-development-only-verification-secret";
}

function purposeMatches(channel: VerificationChannel, purpose: VerificationPurpose): boolean {
  return channel === "email"
    ? purpose === "email_verification" || purpose === "email_login" || purpose === "password_reset" || purpose === "email_change"
    : purpose === "phone_login" || purpose === "phone_bind" || purpose === "phone_change";
}

function codeExpireMinutes(environment: Record<string, string | undefined>): number {
  const value = Number(environment.AUTH_CODE_EXPIRE_MINUTES ?? 10);
  return Number.isInteger(value) && value >= 1 && value <= 30 ? value : 10;
}

function boundedInteger(environment: Record<string, string | undefined>, name: string, fallback: number, min: number, max: number): number {
  const value = Number(environment[name] ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** 将同一请求的目标、IP、设备限制组成一组，仓储保证任一维度拒绝时不部分消费。 */
function rateLimitInputs(input: RequestVerificationInput, destinationHash: string, environment: Record<string, string | undefined>): Array<{ keyHash: string; windowSeconds: number; maxAttempts: number }> {
  const windowSeconds = boundedInteger(environment, "AUTH_RATE_LIMIT_WINDOW_SECONDS", 3600, 60, 86_400);
  const destinationMax = boundedInteger(environment, "AUTH_RATE_LIMIT_DESTINATION_MAX", 10, 1, 1000);
  const ipMax = boundedInteger(environment, "AUTH_RATE_LIMIT_IP_MAX", 40, 1, 5000);
  const deviceMax = boundedInteger(environment, "AUTH_RATE_LIMIT_DEVICE_MAX", 20, 1, 5000);
  const values = [
    { value: `destination:${input.channel}:${destinationHash}`, maxAttempts: destinationMax },
    input.clientIp ? { value: `ip:${stableHash(input.clientIp)}`, maxAttempts: ipMax } : null,
    input.deviceId ? { value: `device:${stableHash(input.deviceId)}`, maxAttempts: deviceMax } : null,
  ].filter((value): value is { value: string; maxAttempts: number } => value !== null);
  const pepper = secretFrom(environment);
  return values.map((value) => ({ keyHash: hashValue(value.value, pepper), windowSeconds, maxAttempts: value.maxAttempts }));
}

function genericAcceptedReceipt(input: RequestVerificationInput, destination: string, environment: Record<string, string | undefined>): VerificationChallengeReceipt {
  const now = Date.now();
  const expiresAt = new Date(now + codeExpireMinutes(environment) * 60_000).toISOString();
  return { challengeId: "", channel: input.channel, purpose: input.purpose, maskedDestination: maskDestination(input.channel, destination), expiresAt, resendAfter: new Date(now + 60_000).toISOString() };
}

/**
 * 统一邮箱/短信验证码编排：先做身份和图形验证，再持久化挑战，最后调用 Provider。
 * 失败不会返回“已发送”；验证码只保存 HMAC，校验成功后单次消费。
 */
export class VerificationService {
  private readonly environment: Record<string, string | undefined>;

  public constructor(private readonly dependencies: VerificationServiceDependencies) {
    this.environment = dependencies.environment ?? process.env;
  }

  public async requestCode(input: RequestVerificationInput): Promise<VerificationChallengeReceipt> {
    if (!purposeMatches(input.channel, input.purpose)) throw new ValidationError("验证码通道与用途不匹配");
    const destination = normalizeDestination(input.channel, input.destination);
    const actorUserId = input.actor?.userId ?? null;
    const account = input.channel === "email"
      ? await this.dependencies.accounts.findAccountByEmail(destination)
      : await this.dependencies.accounts.findAccountByPhone(destination);

    if (input.purpose === "email_verification") {
      if (!actorUserId || !account || account.id !== actorUserId || account.email !== destination) throw new ValidationError("只能为当前账户验证邮箱");
      if (account.emailVerifiedAt) return genericAcceptedReceipt(input, destination, this.environment);
    }
    if (input.purpose === "email_change") {
      if (!actorUserId) throw new ValidationError("换绑邮箱需要登录");
      if (account && account.id !== actorUserId) throw new ValidationError("该邮箱已绑定其他账户");
    }
    if (input.purpose === "phone_bind" || input.purpose === "phone_change") {
      if (!actorUserId) throw new ValidationError("绑定手机号需要登录");
      if (account && account.id !== actorUserId) throw new ValidationError("该手机号已绑定其他账户");
    }
    await this.assertCaptcha(input, actorUserId);
    const destinationHash = hashValue(`${input.channel}:${destination}`, secretFrom(this.environment));
    const active = await this.dependencies.challenges.findLatestActive(destinationHash, input.purpose);
    if (active && Date.parse(active.resendAfter) > Date.now()) throw new VerificationRateLimitError();

    const rateLimit = await this.dependencies.challenges.consumeRateLimits(rateLimitInputs(input, destinationHash, this.environment));
    if (!rateLimit.allowed) throw new VerificationRateLimitError(`操作过于频繁，请在 ${rateLimit.retryAfterSeconds} 秒后再试`);

    if ((input.purpose === "email_login" || input.purpose === "password_reset" || input.purpose === "phone_login") && !account) {
      // 登录/找回对未知目标保持统一响应，防止枚举账户；仍经过图形验证和限流，但不发送、不创建挑战。
      return genericAcceptedReceipt(input, destination, this.environment);
    }

    const code = String(randomInt(100000, 1_000_000));
    const expiresAt = new Date(Date.now() + codeExpireMinutes(this.environment) * 60_000).toISOString();
    const resendAfter = new Date(Date.now() + 60_000).toISOString();
    const challenge = await this.dependencies.challenges.createChallenge({
      id: randomUUID(), userId: account?.id ?? actorUserId, channel: input.channel, purpose: input.purpose,
      destinationHash, maskedDestination: maskDestination(input.channel, destination), codeHash: hashValue(`code:${code}`, secretFrom(this.environment)),
      expiresAt, resendAfter, requestIpHash: input.clientIp ? stableHash(input.clientIp) : null, deviceHash: input.deviceId ? stableHash(input.deviceId) : null,
    });

    try {
      const result = input.channel === "email"
        ? await this.sendEmail(input.purpose, destination, code)
        : await this.sendSms(destination, code, challenge.id);
      await this.dependencies.challenges.setProviderResult(challenge.id, { status: "sent", providerMessageId: result.providerMessageId });
    } catch (error) {
      await this.dependencies.challenges.setProviderResult(challenge.id, { status: "failed", failureCode: "PROVIDER_ERROR" });
      if (error instanceof VerificationProviderError) throw error;
      throw new VerificationProviderError();
    }

    return { challengeId: challenge.id, channel: input.channel, purpose: input.purpose, maskedDestination: challenge.maskedDestination, expiresAt, resendAfter };
  }

  public async verifyChallenge(input: VerifyChallengeInput): Promise<{ purpose: VerificationPurpose; account: PlatformAccount }> {
    if (!/^\d{6}$/.test(input.code)) throw new InvalidVerificationCodeError();
    const challenge = await this.dependencies.challenges.findChallenge(input.challengeId);
    if (!challenge || challenge.providerStatus !== "sent") throw new InvalidVerificationCodeError();
    if (input.actorUserId && challenge.userId && input.actorUserId !== challenge.userId) throw new InvalidVerificationCodeError();
    const destination = normalizeDestination(challenge.channel, input.destination);
    const secret = secretFrom(this.environment);
    const expectedDestinationHash = hashValue(`${challenge.channel}:${destination}`, secret);
    if (expectedDestinationHash !== challenge.destinationHash) throw new InvalidVerificationCodeError();
    const attempted = await this.dependencies.challenges.incrementAttempt(challenge.id);
    if (!attempted) throw new InvalidVerificationCodeError();
    const expected = Buffer.from(hashValue(`code:${input.code}`, secret), "utf8");
    const actual = Buffer.from(attempted.codeHash, "utf8");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new InvalidVerificationCodeError();
    if (!await this.dependencies.challenges.consumeChallenge(challenge.id)) throw new InvalidVerificationCodeError();

    if (!challenge.userId) throw new InvalidVerificationCodeError();
    let account: PlatformAccount | null = null;
    const before = await this.dependencies.accounts.findAccountById(challenge.userId);
    try {
      if (challenge.purpose === "email_verification") account = await this.dependencies.accounts.markEmailVerified(challenge.userId);
      else if (challenge.purpose === "email_change") account = await this.dependencies.accounts.changeVerifiedEmail(challenge.userId, destination);
      else if (challenge.purpose === "phone_bind" || challenge.purpose === "phone_change") account = await this.dependencies.accounts.bindVerifiedPhone(challenge.userId, destination);
      else account = before;
    } catch (error) {
      if (error instanceof AccountConflictError) {
        await this.writeIdentityAudit({ challenge, userId: challenge.userId, actorUserId: input.actorUserId ?? null, destination, outcome: "conflict", before, reasonCode: `ACCOUNT_CONFLICT_${error.field.toUpperCase()}` });
      }
      throw error;
    }
    if (!account || account.status !== "active") throw new InvalidVerificationCodeError();
    if (challenge.purpose === "email_verification" || challenge.purpose === "email_change" || challenge.purpose === "phone_bind" || challenge.purpose === "phone_change") {
      await this.writeIdentityAudit({ challenge, userId: challenge.userId, actorUserId: input.actorUserId ?? null, destination, outcome: "success", before });
    }
    return { purpose: challenge.purpose, account };
  }

  /** 审计写入失败不覆盖身份变更结果，但会在服务日志中保留可定位错误。 */
  private async writeIdentityAudit(input: { challenge: { id: string; channel: VerificationChannel; purpose: VerificationPurpose; destinationHash: string; maskedDestination: string }; userId: string; actorUserId: string | null; destination: string; outcome: "success" | "conflict" | "rejected"; before: PlatformAccount | null; reasonCode?: string }): Promise<void> {
    const secret = secretFrom(this.environment);
    try {
      await this.dependencies.accounts.recordIdentityAudit({
        id: randomUUID(), userId: input.userId, actorUserId: input.actorUserId, channel: input.challenge.channel,
        action: input.challenge.purpose === "email_verification" ? "verify" : input.before?.email && input.challenge.channel === "email" ? "change" : input.before?.phoneE164 ? "change" : "bind",
        outcome: input.outcome, previousDestinationHash: input.before ? hashValue(`${input.challenge.channel}:${input.challenge.channel === "email" ? input.before.email : input.before.phoneE164 ?? ""}`, secret) : null,
        destinationHash: input.challenge.destinationHash, previousMaskedDestination: input.before ? maskDestination(input.challenge.channel, input.challenge.channel === "email" ? input.before.email : input.before.phoneE164 ?? "") : null,
        maskedDestination: input.challenge.maskedDestination, challengeId: input.challenge.id, reasonCode: input.reasonCode ?? null,
      });
    } catch (error) {
      console.error("identity audit write failed", error instanceof Error ? error.message : "unknown error");
    }
  }

  public async resetPassword(input: VerifyChallengeInput & { newPasswordHash: string }): Promise<PlatformAccount> {
    const verified = await this.verifyChallenge(input);
    if (verified.purpose !== "password_reset") throw new ValidationError("验证码用途不允许重置密码");
    const account = await this.dependencies.accounts.setPasswordHash(verified.account.id, input.newPasswordHash);
    if (!account) throw new InvalidVerificationCodeError();
    return account;
  }

  private async assertCaptcha(input: RequestVerificationInput, actorUserId: string | null): Promise<void> {
    const required = (this.environment.CAPTCHA_REQUIRED ?? "true").toLowerCase() !== "false";
    if (!required) return;
    if (!this.dependencies.captchaProvider || !input.captchaTicket) throw new VerificationProviderError("图形验证尚未配置或缺少验证票据");
    try {
      if (!await this.dependencies.captchaProvider.verify({ ticket: input.captchaTicket, scene: `${input.channel}:${input.purpose}`, clientIp: input.clientIp, userId: actorUserId })) {
        throw new VerificationRateLimitError("图形验证未通过，请重新验证");
      }
    } catch (error) {
      if (error instanceof VerificationRateLimitError) throw error;
      throw new VerificationProviderError("图形验证服务暂时不可用");
    }
  }

  private async sendEmail(purpose: VerificationPurpose, destination: string, code: string): Promise<{ providerMessageId: string | null }> {
    if (!this.dependencies.emailProvider) throw new VerificationProviderError("邮件 Provider 尚未配置");
    const minutes = codeExpireMinutes(this.environment);
    const subject = purpose === "password_reset" ? "研见：重置密码验证码" : purpose === "email_verification" ? "研见：验证邮箱" : purpose === "email_change" ? "研见：换绑邮箱验证码" : "研见：登录验证码";
    return this.dependencies.emailProvider.send({
      to: destination, subject,
      text: `你的研见验证码是 ${code}，${minutes} 分钟内有效。请勿将验证码告知他人。`,
      html: `<p>你的研见验证码是 <strong>${code}</strong>，${minutes} 分钟内有效。</p><p>请勿将验证码告知他人。</p>`,
    });
  }

  private async sendSms(destination: string, code: string, idempotencyKey: string): Promise<{ providerMessageId: string | null }> {
    if (!this.dependencies.smsProvider) throw new VerificationProviderError("短信 Provider 尚未配置");
    return this.dependencies.smsProvider.send({ phoneE164: destination, code, codeExpireMinutes: codeExpireMinutes(this.environment), idempotencyKey });
  }
}
