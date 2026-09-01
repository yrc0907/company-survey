import postgres, { type Sql, type TransactionSql } from "postgres";

import { AssetConflictError, AssetNotFoundError, IngestionLeaseLostError } from "@/lib/domain/assets";
import type { AssetRecord, IngestionArtifactRecord, IngestionJobRecord, IngestionStatus } from "@/lib/domain/assets";
import type { AssetRepository, CompleteIngestionInput, CreateAssetRecord, FailIngestionInput, IngestionClaim, NeedsReviewIngestionInput } from "@/lib/repositories/assets/assets-repository";

type Row = Record<string, unknown>;
type Queryable = Sql | TransactionSql;

function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
function nullable(value: unknown): string | null { return value === null || value === undefined ? null : String(value); }
function isUnique(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505"; }

function mapAsset(row: Row): AssetRecord {
  return {
    id: String(row.id), ownerUserId: String(row.owner_user_id), projectId: nullable(row.project_id), branchId: nullable(row.branch_id), originalAssetId: nullable(row.original_asset_id),
    assetKind: row.asset_kind as AssetRecord["assetKind"], filename: String(row.filename), extension: row.extension as AssetRecord["extension"], mimeType: String(row.mime_type), objectKey: String(row.object_key),
    expectedSize: Number(row.expected_size), expectedSha256: String(row.expected_sha256), etag: nullable(row.etag), actualSize: row.actual_size === null ? null : Number(row.actual_size), actualSha256: nullable(row.actual_sha256), status: row.status as AssetRecord["status"],
    createdAt: iso(row.created_at), uploadedAt: row.uploaded_at ? iso(row.uploaded_at) : null, verifiedAt: row.verified_at ? iso(row.verified_at) : null, updatedAt: iso(row.updated_at),
  };
}

function mapJob(row: Row): IngestionJobRecord {
  return {
    id: String(row.id), assetId: String(row.asset_id), idempotencyKey: String(row.idempotency_key), status: row.status as IngestionStatus, attempt: Number(row.attempt),
    errorCode: nullable(row.error_code), errorMessage: nullable(row.error_message), derivedAssetId: nullable(row.derived_asset_id), createdAt: iso(row.created_at), startedAt: row.started_at ? iso(row.started_at) : null, completedAt: row.completed_at ? iso(row.completed_at) : null, updatedAt: iso(row.updated_at), leaseOwner: nullable(row.lease_owner), leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
  };
}

function mapArtifact(row: Row): IngestionArtifactRecord {
  return {
    id: String(row.id), ingestionJobId: String(row.ingestion_job_id), assetId: String(row.asset_id), attempt: Number(row.attempt ?? 0), kind: row.kind as IngestionArtifactRecord["kind"],
    mimeType: String(row.mime_type), content: row.content === null || row.content === undefined ? null : String(row.content), contentHash: nullable(row.content_hash),
    metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>, createdAt: iso(row.created_at),
  };
}

const ASSET_COLUMNS = `id, owner_user_id, project_id, branch_id, original_asset_id, asset_kind, filename, extension, mime_type, object_key, expected_size, expected_sha256, etag, actual_size, actual_sha256, status, created_at, uploaded_at, verified_at, updated_at`;
const JOB_COLUMNS = `id, asset_id, idempotency_key, status, attempt, error_code, error_message, derived_asset_id, created_at, started_at, completed_at, updated_at, lease_owner, lease_expires_at`;
// claimNextIngestion 使用 UPDATE ... FROM；RETURNING 必须限定目标别名，避免与 candidate.id 冲突。
const JOB_COLUMNS_FOR_UPDATE = `j.id AS id, j.asset_id AS asset_id, j.idempotency_key AS idempotency_key, j.status AS status, j.attempt AS attempt, j.error_code AS error_code, j.error_message AS error_message, j.derived_asset_id AS derived_asset_id, j.created_at AS created_at, j.started_at AS started_at, j.completed_at AS completed_at, j.updated_at AS updated_at, j.lease_owner AS lease_owner, j.lease_expires_at AS lease_expires_at`;

/** PostgreSQL 上传仓储；所有状态变化使用条件 UPDATE，重复确认和重试不会重复创建 Job。 */
export class PostgresAssetsRepository implements AssetRepository {
  public constructor(private readonly sql: Sql) {}
  public static fromConnectionString(connectionString: string): PostgresAssetsRepository { return new PostgresAssetsRepository(postgres(connectionString, { max: 3, idle_timeout: 20 })); }
  /** Worker 一次性运行结束时释放连接；Web 请求生命周期不调用此方法。 */
  public async end(): Promise<void> { await this.sql.end({ timeout: 5 }); }

  public async findActiveByHash(ownerUserId: string, projectId: string | null, sha256: string): Promise<AssetRecord | null> {
    const rows = await this.sql.unsafe<Row[]>(`SELECT ${ASSET_COLUMNS} FROM uploaded_asset WHERE owner_user_id = $1 AND COALESCE(project_id, '') = COALESCE($2, '') AND expected_sha256 = $3 AND status <> 'failed' ORDER BY created_at DESC LIMIT 1`, [ownerUserId, projectId, sha256]);
    return rows[0] ? mapAsset(rows[0]) : null;
  }
  public async getReservedBytes(ownerUserId: string): Promise<number> {
    const rows = await this.sql<Row[]>`SELECT COALESCE(SUM(expected_size), 0) AS total FROM uploaded_asset WHERE owner_user_id = ${ownerUserId} AND status <> 'failed'`;
    return Number(rows[0]?.total ?? 0);
  }
  public async createIntent(record: CreateAssetRecord): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; created: boolean }> {
    try {
      return await this.sql.begin(async (tx) => {
        await tx`INSERT INTO uploaded_asset (id, owner_user_id, project_id, branch_id, original_asset_id, asset_kind, filename, extension, mime_type, object_key, expected_size, expected_sha256, status, created_at, updated_at)
          VALUES (${record.asset.id}, ${record.asset.ownerUserId}, ${record.asset.projectId}, ${record.asset.branchId}, ${record.asset.originalAssetId}, ${record.asset.assetKind}, ${record.asset.filename}, ${record.asset.extension}, ${record.asset.mimeType}, ${record.asset.objectKey}, ${record.asset.expectedSize}, ${record.asset.expectedSha256}, ${record.asset.status}, ${record.asset.createdAt}, ${record.asset.updatedAt})`;
        await tx`INSERT INTO ingestion_job (id, asset_id, idempotency_key, status, attempt, created_at, updated_at)
          VALUES (${record.ingestion.id}, ${record.ingestion.assetId}, ${record.ingestion.idempotencyKey}, ${record.ingestion.status}, ${record.ingestion.attempt}, ${record.ingestion.createdAt}, ${record.ingestion.updatedAt})`;
        return { asset: record.asset, ingestion: record.ingestion, created: true };
      });
    } catch (error) {
      if (!isUnique(error)) throw error;
      const existing = await this.findActiveByHash(record.asset.ownerUserId, record.asset.projectId, record.asset.expectedSha256);
      if (!existing) throw new AssetConflictError();
      const job = await this.getIngestionJob(record.asset.id, record.asset.ownerUserId) ?? await this.getIngestionJob(existing.id, record.asset.ownerUserId);
      if (!job) throw new AssetConflictError();
      return { asset: existing, ingestion: job, created: false };
    }
  }
  public async getOwnedAsset(assetId: string, ownerUserId: string): Promise<AssetRecord | null> {
    const rows = await this.sql<Row[]>`SELECT ${this.sql.unsafe(ASSET_COLUMNS)} FROM uploaded_asset WHERE id = ${assetId} AND owner_user_id = ${ownerUserId} LIMIT 1`;
    return rows[0] ? mapAsset(rows[0]) : null;
  }
  public async getAssetForActor(assetId: string, ownerUserId: string): Promise<AssetRecord | null> { return this.getOwnedAsset(assetId, ownerUserId); }
  public async getIngestionJob(assetId: string, ownerUserId: string): Promise<IngestionJobRecord | null> {
    const rows = await this.sql<Row[]>`SELECT ${this.sql.unsafe(JOB_COLUMNS)} FROM ingestion_job j JOIN uploaded_asset a ON a.id = j.asset_id WHERE j.asset_id = ${assetId} AND a.owner_user_id = ${ownerUserId} LIMIT 1`;
    return rows[0] ? mapJob(rows[0]) : null;
  }
  public async completeVerification(input: { assetId: string; ownerUserId: string; etag: string; actualSize: number; actualSha256: string }): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; idempotent: boolean }> {
    return this.sql.begin(async (tx) => {
      const existing = await tx<Row[]>`SELECT ${tx.unsafe(ASSET_COLUMNS)} FROM uploaded_asset WHERE id = ${input.assetId} AND owner_user_id = ${input.ownerUserId} FOR UPDATE`;
      if (!existing[0]) throw new AssetNotFoundError();
      const already = existing[0].status === "verified";
      if (!already && existing[0].status !== "pending_upload" && existing[0].status !== "uploaded") throw new AssetConflictError("该上传已失败，请创建新的上传意图");
      if (!already) {
        await tx`UPDATE uploaded_asset SET status = 'verified', etag = ${input.etag}, actual_size = ${input.actualSize}, actual_sha256 = ${input.actualSha256}, uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP), verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ${input.assetId} AND owner_user_id = ${input.ownerUserId} AND status IN ('pending_upload', 'uploaded')`;
      }
      const jobs = await tx<Row[]>`SELECT ${tx.unsafe(JOB_COLUMNS)} FROM ingestion_job WHERE asset_id = ${input.assetId} FOR UPDATE`;
      if (!jobs[0]) throw new AssetNotFoundError();
      if (!already && (jobs[0].status === "queued" || jobs[0].status === "failed")) await tx`UPDATE ingestion_job SET status = 'queued', error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ${input.assetId}`;
      const assetRows = await tx<Row[]>`SELECT ${tx.unsafe(ASSET_COLUMNS)} FROM uploaded_asset WHERE id = ${input.assetId}`;
      const jobRows = await tx<Row[]>`SELECT ${tx.unsafe(JOB_COLUMNS)} FROM ingestion_job WHERE asset_id = ${input.assetId}`;
      return { asset: mapAsset(assetRows[0]!), ingestion: mapJob(jobRows[0]!), idempotent: already };
    });
  }
  public async failAsset(assetId: string, ownerUserId: string, code: string, message: string): Promise<void> {
    const result = await this.sql`UPDATE uploaded_asset SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ${assetId} AND owner_user_id = ${ownerUserId} AND status <> 'verified'`;
    if (result.count === 0 && !(await this.getOwnedAsset(assetId, ownerUserId))) throw new AssetNotFoundError();
    await this.sql`UPDATE ingestion_job SET status = 'failed', error_code = ${code}, error_message = ${message}, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ${assetId}`;
  }
  public async retryIngestion(assetId: string, ownerUserId: string): Promise<IngestionJobRecord> {
    const rows = await this.sql<Row[]>`UPDATE ingestion_job j SET status = 'queued', error_code = NULL, error_message = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP FROM uploaded_asset a WHERE j.asset_id = ${assetId} AND a.id = j.asset_id AND a.owner_user_id = ${ownerUserId} AND a.status = 'verified' AND j.status IN ('failed', 'needs_review') RETURNING ${this.sql.unsafe(JOB_COLUMNS)}`;
    if (!rows[0]) { const asset = await this.getOwnedAsset(assetId, ownerUserId); if (!asset) throw new AssetNotFoundError(); if (asset.status !== "verified") throw new AssetConflictError("上传校验失败需创建新的上传意图"); throw new AssetConflictError("只有失败或待校对的解析任务可以重试"); }
    return mapJob(rows[0]);
  }
  public async updateIngestionStatus(assetId: string, status: IngestionStatus, error?: { code: string; message: string }): Promise<IngestionJobRecord | null> {
    const rows = await this.sql<Row[]>`UPDATE ingestion_job SET status = ${status}, error_code = ${error?.code ?? null}, error_message = ${error?.message ?? null}, started_at = CASE WHEN ${status} IN ('uploading', 'processing') THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END, completed_at = CASE WHEN ${status} IN ('ready', 'needs_review') THEN CURRENT_TIMESTAMP ELSE completed_at END, lease_owner = CASE WHEN ${status} IN ('queued', 'ready', 'needs_review', 'failed') THEN NULL ELSE lease_owner END, lease_expires_at = CASE WHEN ${status} IN ('queued', 'ready', 'needs_review', 'failed') THEN NULL ELSE lease_expires_at END, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ${assetId} RETURNING ${this.sql.unsafe(JOB_COLUMNS)}`;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  /**
   * 用 `FOR UPDATE SKIP LOCKED` 领取单个任务；processing/uploading 的过期租约可恢复，
   * 同一任务同一时刻只能被一个 Worker 持有。attempt 在领取时递增，手动 retry 只重新排队。
   */
  public async claimNextIngestion(workerId: string, leaseSeconds: number): Promise<IngestionClaim | null> {
    const boundedLease = Number.isFinite(leaseSeconds) ? Math.min(Math.max(Math.trunc(leaseSeconds), 5), 900) : 120;
    return this.sql.begin(async (tx) => {
      const jobs = await tx.unsafe<Row[]>(`WITH candidate AS (
          SELECT j.id
          FROM ingestion_job j
          JOIN uploaded_asset a ON a.id = j.asset_id
          WHERE a.status = 'verified'
            AND (j.status = 'queued' OR (j.status IN ('uploading', 'processing') AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= CURRENT_TIMESTAMP)))
          ORDER BY j.updated_at ASC, j.id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE ingestion_job j
        SET status = 'processing',
            attempt = j.attempt + 1,
            lease_owner = $1,
            lease_expires_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),
            started_at = COALESCE(j.started_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        FROM candidate c
        WHERE j.id = c.id
          RETURNING ${JOB_COLUMNS_FOR_UPDATE}`, [workerId, boundedLease]);
      const row = jobs[0];
      if (!row) return null;
      const assets = await tx<Row[]>`SELECT ${tx.unsafe(ASSET_COLUMNS)} FROM uploaded_asset WHERE id = ${String(row.asset_id)} LIMIT 1`;
      if (!assets[0]) return null;
      return { asset: mapAsset(assets[0]), job: mapJob(row), leaseOwner: workerId };
    });
  }

  /** 持有租约的 Worker 写入文本产物并原子地把 Job 置为 ready；重复完成返回当前状态。 */
  public async completeIngestion(input: CompleteIngestionInput): Promise<IngestionJobRecord | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<Row[]>`SELECT ${tx.unsafe(JOB_COLUMNS)} FROM ingestion_job WHERE id = ${input.jobId} AND asset_id = ${input.assetId} FOR UPDATE`;
      const current = rows[0];
      if (!current) return null;
      if (current.status === "ready") return mapJob(current);
      if (current.status !== "processing" || String(current.lease_owner ?? "") !== input.leaseOwner || !current.lease_expires_at || new Date(String(current.lease_expires_at)).getTime() <= Date.now()) throw new IngestionLeaseLostError();
      await tx`INSERT INTO ingestion_artifact (id, ingestion_job_id, asset_id, attempt, kind, mime_type, content, content_hash, metadata, created_at)
        VALUES (${input.artifact.id}, ${input.artifact.ingestionJobId}, ${input.artifact.assetId}, ${input.artifact.attempt}, ${input.artifact.kind}, ${input.artifact.mimeType}, ${input.artifact.content}, ${input.artifact.contentHash}, ${JSON.stringify(input.artifact.metadata)}::jsonb, ${input.artifact.createdAt})`;
      const updated = await tx<Row[]>`UPDATE ingestion_job SET status = 'ready', error_code = NULL, error_message = NULL, completed_at = CURRENT_TIMESTAMP, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ${input.jobId} AND asset_id = ${input.assetId} AND status = 'processing' AND lease_owner = ${input.leaseOwner} RETURNING ${tx.unsafe(JOB_COLUMNS)}`;
      return updated[0] ? mapJob(updated[0]) : null;
    });
  }

  /** 图片/扫描 PDF 无视觉 Provider 时进入 needs_review，并保留机器可读原因而不是伪造正文。 */
  public async markIngestionNeedsReview(input: NeedsReviewIngestionInput): Promise<IngestionJobRecord | null> {
    return this.sql.begin(async (tx) => {
      const rows = await tx<Row[]>`SELECT ${tx.unsafe(JOB_COLUMNS)} FROM ingestion_job WHERE id = ${input.jobId} AND asset_id = ${input.assetId} FOR UPDATE`;
      const current = rows[0];
      if (!current) return null;
      if (current.status === "needs_review") return mapJob(current);
      if (current.status !== "processing" || String(current.lease_owner ?? "") !== input.leaseOwner || !current.lease_expires_at || new Date(String(current.lease_expires_at)).getTime() <= Date.now()) throw new IngestionLeaseLostError();
      await tx`INSERT INTO ingestion_artifact (id, ingestion_job_id, asset_id, attempt, kind, mime_type, content, content_hash, metadata, created_at)
        VALUES (${input.artifact.id}, ${input.artifact.ingestionJobId}, ${input.artifact.assetId}, ${input.artifact.attempt}, 'needs_review', ${input.artifact.mimeType}, NULL, NULL, ${JSON.stringify(input.artifact.metadata)}::jsonb, ${input.artifact.createdAt})`;
      const updated = await tx<Row[]>`UPDATE ingestion_job SET status = 'needs_review', error_code = ${input.code}, error_message = ${input.message}, completed_at = CURRENT_TIMESTAMP, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ${input.jobId} AND asset_id = ${input.assetId} AND status = 'processing' AND lease_owner = ${input.leaseOwner} RETURNING ${tx.unsafe(JOB_COLUMNS)}`;
      return updated[0] ? mapJob(updated[0]) : null;
    });
  }

  /** 解析异常仅由持有且未过期的租约标记失败；晚到 Worker 不能覆盖新一轮任务。 */
  public async failIngestion(input: FailIngestionInput): Promise<IngestionJobRecord | null> {
    const rows = await this.sql<Row[]>`UPDATE ingestion_job SET status = 'failed', error_code = ${input.code}, error_message = ${input.message}, lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ${input.jobId} AND asset_id = ${input.assetId} AND status = 'processing' AND lease_owner = ${input.leaseOwner} AND lease_expires_at > CURRENT_TIMESTAMP RETURNING ${this.sql.unsafe(JOB_COLUMNS)}`;
    return rows[0] ? mapJob(rows[0]) : null;
  }

  /** 只有资产所有者可读取解析产物，避免借 Asset ID 探测他人的内容。 */
  public async getIngestionArtifact(assetId: string, ownerUserId: string): Promise<IngestionArtifactRecord | null> {
    const rows = await this.sql<Row[]>`SELECT ia.id, ia.ingestion_job_id, ia.asset_id, ia.attempt, ia.kind, ia.mime_type, ia.content, ia.content_hash, ia.metadata, ia.created_at
      FROM ingestion_artifact ia JOIN uploaded_asset a ON a.id = ia.asset_id
      WHERE ia.asset_id = ${assetId} AND a.owner_user_id = ${ownerUserId} ORDER BY ia.created_at DESC, ia.id DESC LIMIT 1`;
    return rows[0] ? mapArtifact(rows[0]) : null;
  }
  public async markDerivedAsset(input: { sourceAssetId: string; ownerUserId: string; derived: AssetRecord }): Promise<AssetRecord> {
    return this.sql.begin(async (tx) => {
      const source = await tx<Row[]>`SELECT id FROM uploaded_asset WHERE id = ${input.sourceAssetId} AND owner_user_id = ${input.ownerUserId} FOR UPDATE`;
      if (!source[0]) throw new AssetNotFoundError();
      await tx`INSERT INTO uploaded_asset (id, owner_user_id, project_id, branch_id, original_asset_id, asset_kind, filename, extension, mime_type, object_key, expected_size, expected_sha256, actual_size, actual_sha256, status, created_at, uploaded_at, verified_at, updated_at)
        VALUES (${input.derived.id}, ${input.derived.ownerUserId}, ${input.derived.projectId}, ${input.derived.branchId}, ${input.sourceAssetId}, 'derived', ${input.derived.filename}, ${input.derived.extension}, ${input.derived.mimeType}, ${input.derived.objectKey}, ${input.derived.expectedSize}, ${input.derived.expectedSha256}, ${input.derived.actualSize}, ${input.derived.actualSha256}, 'verified', ${input.derived.createdAt}, ${input.derived.uploadedAt}, ${input.derived.verifiedAt}, ${input.derived.updatedAt}) ON CONFLICT (id) DO NOTHING`;
      await tx`UPDATE ingestion_job SET derived_asset_id = ${input.derived.id}, status = 'ready', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ${input.sourceAssetId}`;
      return input.derived;
    });
  }
}
