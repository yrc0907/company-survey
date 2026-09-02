import type { VerificationPurpose } from "@/lib/domain/platform";
import type { CreateVerificationChallengeInput, VerificationChallengeRecord, VerificationRepository } from "@/lib/repositories/auth/verification-repository";

/** 契约测试专用内存挑战仓储；模拟与 PostgreSQL 相同的消费和尝试次数边界。 */
export class MemoryVerificationRepository implements VerificationRepository {
  private readonly records = new Map<string, VerificationChallengeRecord>();

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
    if (!record || record.consumedAt || Date.parse(record.expiresAt) <= Date.now() || record.attemptCount >= 5) return false;
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
}
