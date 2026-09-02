import postgres, { type Sql } from "postgres";

import type { VerificationPurpose } from "@/lib/domain/platform";
import type { CreateVerificationChallengeInput, VerificationChallengeRecord, VerificationRepository } from "@/lib/repositories/auth/verification-repository";

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
      WHERE id = ${id} AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP AND attempt_count < 5`;
    return rows.count > 0;
  }

  public async setProviderResult(id: string, result: { status: "sent" | "failed"; providerMessageId?: string | null; failureCode?: string | null }): Promise<void> {
    await this.sql`UPDATE verification_challenge SET provider_status = ${result.status}, provider_message_id = ${result.providerMessageId ?? null}, failure_code = ${result.failureCode ?? null} WHERE id = ${id}`;
  }
}
