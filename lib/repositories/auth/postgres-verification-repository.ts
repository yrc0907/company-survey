import postgres, { type Sql } from "postgres";

import type { VerificationPurpose } from "@/lib/domain/platform";
import type { CreateVerificationChallengeInput, VerificationChallengeRecord, VerificationRateLimitInput, VerificationRateLimitResult, VerificationRepository } from "@/lib/repositories/auth/verification-repository";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapChallenge(row: Row): VerificationChallengeRecord {
  return {
    id: String(row.id), userId: row.user_id ? String(row.user_id) : null,
    channel: row.channel as VerificationChallengeRecord["channel"], purpose: row.purpose as VerificationPurpose,
    destinationHash: String(row.destination_hash), maskedDestination: String(row.masked_destination), codeHash: String(row.code_hash),
    expiresAt: iso(row.expires_at), resendAfter: iso(row.resend_after), consumedAt: row.consumed_at ? iso(row.consumed_at) : null,
    attemptCount: Number(row.attempt_count ?? 0), requestIpHash: row.request_ip_hash ? String(row.request_ip_hash) : null,
    deviceHash: row.device_hash ? String(row.device_hash) : null, providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
    providerStatus: row.provider_status as VerificationChallengeRecord["providerStatus"], failureCode: row.failure_code ? String(row.failure_code) : null,
    createdAt: iso(row.created_at),
  };
}

const SELECT = `SELECT id, user_id, channel, purpose, destination_hash, masked_destination, code_hash,
  expires_at, resend_after, consumed_at, attempt_count, request_ip_hash, device_hash,
  provider_message_id, provider_status, failure_code, created_at FROM verification_challenge`;

/** PostgreSQL 验证挑战仓储；所有更新均以未过期/未消费条件保护幂等和重放边界。 */
export class PostgresVerificationRepository implements VerificationRepository {
  public constructor(private readonly sql: Sql) {}

  public static fromConnectionString(connectionString: string): PostgresVerificationRepository {
    return new PostgresVerificationRepository(postgres(connectionString, { max: 3, idle_timeout: 20 }));
  }

  public async createChallenge(input: CreateVerificationChallengeInput): Promise<VerificationChallengeRecord> {
    const rows = await this.sql<Row[]>`INSERT INTO verification_challenge
      (id, user_id, channel, purpose, destination_hash, masked_destination, code_hash, expires_at, resend_after, request_ip_hash, device_hash)
      VALUES (${input.id}, ${input.userId}, ${input.channel}, ${input.purpose}, ${input.destinationHash}, ${input.maskedDestination}, ${input.codeHash}, ${input.expiresAt}, ${input.resendAfter}, ${input.requestIpHash}, ${input.deviceHash})
      RETURNING *`;
    return mapChallenge(rows[0]!);
  }

  public async findLatestActive(destinationHash: string, purpose: VerificationPurpose): Promise<VerificationChallengeRecord | null> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(SELECT)}
      WHERE destination_hash = ${destinationHash} AND purpose = ${purpose} AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at DESC LIMIT 1`;
    return rows[0] ? mapChallenge(rows[0]) : null;
  }

  public async findChallenge(id: string): Promise<VerificationChallengeRecord | null> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(SELECT)} WHERE id = ${id} LIMIT 1`;
    return rows[0] ? mapChallenge(rows[0]) : null;
  }

  public async incrementAttempt(id: string): Promise<VerificationChallengeRecord | null> {
    const rows = await this.sql<Row[]>`UPDATE verification_challenge SET attempt_count = attempt_count + 1
      WHERE id = ${id} AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempt_count < 5
      RETURNING *`;
    return rows[0] ? mapChallenge(rows[0]) : null;
  }

  public async consumeChallenge(id: string): Promise<boolean> {
    const rows = await this.sql`UPDATE verification_challenge SET consumed_at = CURRENT_TIMESTAMP
      WHERE id = ${id} AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempt_count <= 5`;
    return rows.count > 0;
  }

  public async setProviderResult(id: string, result: { status: "sent" | "failed"; providerMessageId?: string | null; failureCode?: string | null }): Promise<void> {
    await this.sql`UPDATE verification_challenge SET provider_status = ${result.status}, provider_message_id = ${result.providerMessageId ?? null}, failure_code = ${result.failureCode ?? null} WHERE id = ${id}`;
  }

  /**
   * 在同一事务中锁定所有风控桶，任一维度超过阈值时整组不增加计数。
   * advisory lock 防止“尚不存在的 key”在并发请求中同时通过；按 key 排序避免锁顺序死锁。
   */
  public async consumeRateLimits(inputs: VerificationRateLimitInput[]): Promise<VerificationRateLimitResult> {
    const unique = Array.from(new Map(inputs.map((input) => [input.keyHash, input])).values())
      .sort((left, right) => left.keyHash.localeCompare(right.keyHash));
    if (unique.length === 0) return { allowed: true, retryAfterSeconds: 0 };
    return this.sql.begin(async (tx) => {
      const now = Date.now();
      const states: Array<{ input: VerificationRateLimitInput; windowStartedAt: number; windowEndsAt: number; count: number }> = [];
      for (const input of unique) {
        // 用 SHA-256 前 8 个十六进制字符映射到 int4 advisory lock；SQL 文本固定，参数不会成为 SQL。
        const lockKey = Number.parseInt(input.keyHash.slice(0, 8), 16) | 0;
        await tx.unsafe("SELECT pg_advisory_xact_lock($1::integer)", [lockKey]);
        const windowMs = Math.max(1, Math.trunc(input.windowSeconds)) * 1000;
        const windowStartedAt = Math.floor(now / windowMs) * windowMs;
        const rows = await tx<{ window_started_at: Date; attempt_count: number }[]>`
          SELECT window_started_at, attempt_count
          FROM verification_rate_limit
          WHERE key_hash = ${input.keyHash}
          FOR UPDATE`;
        const row = rows[0];
        const storedWindow = row?.window_started_at?.getTime() ?? windowStartedAt;
        const count = row && storedWindow === windowStartedAt ? Number(row.attempt_count) : 0;
        states.push({ input, windowStartedAt, windowEndsAt: windowStartedAt + windowMs, count });
      }
      const denied = states.find((state) => state.count + 1 > state.input.maxAttempts);
      if (denied) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((denied.windowEndsAt - now) / 1000)) };
      }
      for (const state of states) {
        await tx`
          INSERT INTO verification_rate_limit (key_hash, window_started_at, attempt_count, updated_at)
          VALUES (${state.input.keyHash}, to_timestamp(${state.windowStartedAt / 1000}), 1, CURRENT_TIMESTAMP)
          ON CONFLICT (key_hash) DO UPDATE SET
            window_started_at = EXCLUDED.window_started_at,
            attempt_count = CASE
              WHEN verification_rate_limit.window_started_at = EXCLUDED.window_started_at
                THEN verification_rate_limit.attempt_count + 1
              ELSE 1
            END,
            updated_at = CURRENT_TIMESTAMP`;
      }
      return { allowed: true, retryAfterSeconds: 0 };
    });
  }
}
