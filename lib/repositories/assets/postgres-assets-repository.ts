import postgres, { type Sql, type TransactionSql } from "postgres";

import { AssetConflictError, AssetNotFoundError } from "@/lib/domain/assets";
import type { AssetRecord, IngestionJobRecord, IngestionStatus } from "@/lib/domain/assets";
import type { AssetRepository, CreateAssetRecord } from "@/lib/repositories/assets/assets-repository";

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
    errorCode: nullable(row.error_code), errorMessage: nullable(row.error_message), derivedAssetId: nullable(row.derived_asset_id), createdAt: iso(row.created_at), startedAt: row.started_at ? iso(row.started_at) : null, completedAt: row.completed_at ? iso(row.completed_at) : null, updatedAt: iso(row.updated_at),
  };
}

const ASSET_COLUMNS = `id, owner_user_id, project_id, branch_id, original_asset_id, asset_kind, filename, extension, mime_type, object_key, expected_size, expected_sha256, etag, actual_size, actual_sha256, status, created_at, uploaded_at, verified_at, updated_at`;
const JOB_COLUMNS = `id, asset_id, idempotency_key, status, attempt, error_code, error_message, derived_asset_id, created_at, started_at, completed_at, updated_at`;

/** PostgreSQL 上传仓储；所有状态变化使用条件 UPDATE，重复确认和重试不会重复创建 Job。 */
export class PostgresAssetsRepository implements AssetRepository {
  public constructor(private readonly sql: Sql) {}
  public static fromConnectionString(connectionString: string): PostgresAssetsRepository { return new PostgresAssetsRepository(postgres(connectionString, { max: 3, idle_timeout: 20 })); }

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
    const rows = await this.sql<Row[]>`UPDATE ingestion_job j SET status = 'queued', attempt = j.attempt + 1, error_code = NULL, error_message = NULL, updated_at = CURRENT_TIMESTAMP FROM uploaded_asset a WHERE j.asset_id = ${assetId} AND a.id = j.asset_id AND a.owner_user_id = ${ownerUserId} AND a.status = 'verified' AND j.status = 'failed' RETURNING ${this.sql.unsafe(JOB_COLUMNS)}`;
    if (!rows[0]) { const asset = await this.getOwnedAsset(assetId, ownerUserId); if (!asset) throw new AssetNotFoundError(); if (asset.status !== "verified") throw new AssetConflictError("上传校验失败需创建新的上传意图"); throw new AssetConflictError("只有失败的解析任务可以重试"); }
    return mapJob(rows[0]);
  }
  public async updateIngestionStatus(assetId: string, status: IngestionStatus, error?: { code: string; message: string }): Promise<IngestionJobRecord | null> {
    const rows = await this.sql<Row[]>`UPDATE ingestion_job SET status = ${status}, error_code = ${error?.code ?? null}, error_message = ${error?.message ?? null}, started_at = CASE WHEN ${status} IN ('uploading', 'processing') THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END, completed_at = CASE WHEN ${status} = 'ready' THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at = CURRENT_TIMESTAMP WHERE asset_id = ${assetId} RETURNING ${this.sql.unsafe(JOB_COLUMNS)}`;
    return rows[0] ? mapJob(rows[0]) : null;
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
