import type { AssetRecord, AssetStatus, IngestionArtifactRecord, IngestionJobRecord, IngestionStatus } from "@/lib/domain/assets";

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
  /** 在数据库锁下领取一个 verified 任务；过期租约可被其他 Worker 回收。 */
  claimNextIngestion(workerId: string, leaseSeconds: number): Promise<IngestionClaim | null>;
  /** 只有持有当前租约的 Worker 才能写入结果，返回 false 表示租约已失效。 */
  completeIngestion(input: CompleteIngestionInput): Promise<IngestionJobRecord | null>;
  markIngestionNeedsReview(input: NeedsReviewIngestionInput): Promise<IngestionJobRecord | null>;
  /** 所有者确认或编辑视觉草稿后，追加 text 产物并将任务转为 ready；旧待校对产物不可变。 */
  approveIngestionReview(input: ApproveIngestionReviewInput): Promise<IngestionJobRecord | null>;
  failIngestion(input: FailIngestionInput): Promise<IngestionJobRecord | null>;
  getIngestionArtifact(assetId: string, ownerUserId: string): Promise<IngestionArtifactRecord | null>;
}

export interface IngestionClaim {
  asset: AssetRecord;
  job: IngestionJobRecord;
  leaseOwner: string;
}

export interface CompleteIngestionInput {
  assetId: string;
  jobId: string;
  leaseOwner: string;
  artifact: IngestionArtifactRecord;
}

export interface NeedsReviewIngestionInput {
  assetId: string;
  jobId: string;
  leaseOwner: string;
  artifact: IngestionArtifactRecord;
  code: string;
  message: string;
}

export interface ApproveIngestionReviewInput {
  assetId: string;
  ownerUserId: string;
  expectedArtifactId: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
}

export interface FailIngestionInput {
  assetId: string;
  jobId: string;
  leaseOwner: string;
  code: string;
  message: string;
}

export type AssetStatusFilter = AssetStatus;
