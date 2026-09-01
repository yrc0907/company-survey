import type { AssetRecord, AssetStatus, IngestionJobRecord, IngestionStatus } from "@/lib/domain/assets";

export interface CreateAssetRecord {
  asset: AssetRecord;
  ingestion: IngestionJobRecord;
}

export interface AssetRepository {
  /** 以用户、项目和 SHA-256 做幂等查重；失败对象不阻塞用户重试。 */
  findActiveByHash(ownerUserId: string, projectId: string | null, sha256: string): Promise<AssetRecord | null>;
  /** 统计未失败对象的预占空间，用于创建意图前的配额检查。 */
  getReservedBytes(ownerUserId: string): Promise<number>;
  createIntent(record: CreateAssetRecord): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; created: boolean }>;
  getOwnedAsset(assetId: string, ownerUserId: string): Promise<AssetRecord | null>;
  getAssetForActor(assetId: string, ownerUserId: string): Promise<AssetRecord | null>;
  getIngestionJob(assetId: string, ownerUserId: string): Promise<IngestionJobRecord | null>;
  /** 仅 queued/failed 可进入新一轮工作，状态转移由 SQL 条件保证幂等。 */
  completeVerification(input: { assetId: string; ownerUserId: string; etag: string; actualSize: number; actualSha256: string }): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; idempotent: boolean }>;
  failAsset(assetId: string, ownerUserId: string, code: string, message: string): Promise<void>;
  retryIngestion(assetId: string, ownerUserId: string): Promise<IngestionJobRecord>;
  updateIngestionStatus(assetId: string, status: IngestionStatus, error?: { code: string; message: string }): Promise<IngestionJobRecord | null>;
  markDerivedAsset(input: { sourceAssetId: string; ownerUserId: string; derived: AssetRecord }): Promise<AssetRecord>;
}

export type AssetStatusFilter = AssetStatus;
