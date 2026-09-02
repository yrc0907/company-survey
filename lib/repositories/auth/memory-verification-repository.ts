import type { VerificationPurpose } from "@/lib/domain/platform";
import type { CreateVerificationChallengeInput, VerificationChallengeRecord, VerificationRateLimitInput, VerificationRateLimitResult, VerificationRepository } from "@/lib/repositories/auth/verification-repository";

/** 契约测试专用内存挑战仓储；模拟与 PostgreSQL 相同的消费和尝试次数边界。 */
export class MemoryVerificationRepository implements VerificationRepository {
  private readonly records = new Map<string, VerificationChallengeRecord>();
  private readonly rateLimits = new Map<string, { windowStartedAt: number; count: number }>();

  public async createChallenge(input: CreateVerificationChallengeInput): Promise<VerificationChallengeRecord> {
    const record: VerificationChallengeRecord = { ...structuredClone(input), consumedAt: null, attemptCount: 0, providerMessageId: null, providerStatus: "pending", failureCode: null, createdAt: new Date().toISOString() };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  public async findLatestActive(destinationHash: string, purpose: VerificationPurpose): Promise<VerificationChallengeRecord | null> {
    const now = Date.now();
    const values = Array.from(this.records.values()).filter((record) => record.destinationHash === destinationHash && record.purpose === purpose && !record.consumedAt && Date.parse(record.expiresAt) > now);
    values.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    return values[0] ? structuredClone(values[0]) : null;
  }

  public async findChallenge(id: string): Promise<VerificationChallengeRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  public async incrementAttempt(id: string): Promise<VerificationChallengeRecord | null> {
    const record = this.records.get(id);
    if (!record || record.consumedAt || Date.parse(record.expiresAt) <= Date.now() || record.attemptCount >= 5) return null;
    record.attemptCount += 1;
    return structuredClone(record);
  }

  public async consumeChallenge(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || record.consumedAt || Date.parse(record.expiresAt) <= Date.now() || record.attemptCount > 5) return false;
    record.consumedAt = new Date().toISOString();
    return true;
  }

  public async setProviderResult(id: string, result: { status: "sent" | "failed"; providerMessageId?: string | null; failureCode?: string | null }): Promise<void> {
    const record = this.records.get(id);
    if (!record) return;
    record.providerStatus = result.status;
    record.providerMessageId = result.providerMessageId ?? null;
    record.failureCode = result.failureCode ?? null;
  }

  /** 内存实现按与 PostgreSQL 相同的“全组成功才提交”语义运行，供契约测试验证失败不增计数。 */
  public async consumeRateLimits(inputs: VerificationRateLimitInput[]): Promise<VerificationRateLimitResult> {
    const now = Date.now();
    const pending = new Map<string, { windowStartedAt: number; count: number }>();
    let retryAfterSeconds = 0;
    for (const input of inputs) {
      const windowMs = input.windowSeconds * 1000;
      const windowStartedAt = Math.floor(now / windowMs) * windowMs;
      const current = this.rateLimits.get(input.keyHash);
      const state = current && current.windowStartedAt === windowStartedAt ? current : { windowStartedAt, count: 0 };
      const nextCount = state.count + 1;
      if (nextCount > input.maxAttempts) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((windowStartedAt + windowMs - now) / 1000));
      }
      pending.set(input.keyHash, { windowStartedAt, count: nextCount });
    }
    if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds };
    pending.forEach((value, key) => this.rateLimits.set(key, value));
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
