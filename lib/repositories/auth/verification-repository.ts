import type { VerificationChannel, VerificationPurpose } from "@/lib/domain/platform";

/** 验证挑战写入参数；验证码和目标均只接收服务层计算后的哈希或脱敏值。 */
export interface CreateVerificationChallengeInput {
  id: string;
  userId: string | null;
  channel: VerificationChannel;
  purpose: VerificationPurpose;
  destinationHash: string;
  maskedDestination: string;
  codeHash: string;
  expiresAt: string;
  resendAfter: string;
  requestIpHash: string | null;
  deviceHash: string | null;
}

export interface VerificationChallengeRecord extends CreateVerificationChallengeInput {
  consumedAt: string | null;
  attemptCount: number;
  providerMessageId: string | null;
  providerStatus: "pending" | "sent" | "failed";
  failureCode: string | null;
  createdAt: string;
}

/** 验证码风控桶；key 已由服务层 HMAC，仓储不接触邮箱、手机号或原始 IP。 */
export interface VerificationRateLimitInput {
  keyHash: string;
  windowSeconds: number;
  maxAttempts: number;
}

export interface VerificationRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** 验证挑战持久化边界；实现可以切换 PostgreSQL 或契约测试内存仓储。 */
export interface VerificationRepository {
  createChallenge(input: CreateVerificationChallengeInput): Promise<VerificationChallengeRecord>;
  findLatestActive(destinationHash: string, purpose: VerificationPurpose): Promise<VerificationChallengeRecord | null>;
  findChallenge(id: string): Promise<VerificationChallengeRecord | null>;
  incrementAttempt(id: string): Promise<VerificationChallengeRecord | null>;
  consumeChallenge(id: string): Promise<boolean>;
  setProviderResult(id: string, result: { status: "sent" | "failed"; providerMessageId?: string | null; failureCode?: string | null }): Promise<void>;
  /** 原子检查一组风控维度；任一维度拒绝时整组不增加计数。 */
  consumeRateLimits(inputs: VerificationRateLimitInput[]): Promise<VerificationRateLimitResult>;
}
