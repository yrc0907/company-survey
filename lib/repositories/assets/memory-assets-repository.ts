import { AssetConflictError, AssetNotFoundError } from "@/lib/domain/assets";
import type { AssetRecord, IngestionJobRecord, IngestionStatus } from "@/lib/domain/assets";
import type { AssetRepository, CreateAssetRecord } from "@/lib/repositories/assets/assets-repository";

/** 上传契约使用的内存实现；只用于测试，生产工厂永远选择 PostgreSQL。 */
export class MemoryAssetsRepository implements AssetRepository {
  private readonly assets = new Map<string, AssetRecord>();
  private readonly jobs = new Map<string, IngestionJobRecord>();

  public async findActiveByHash(ownerUserId: string, projectId: string | null, sha256: string): Promise<AssetRecord | null> {
    const item = Array.from(this.assets.values()).find((asset) => asset.ownerUserId === ownerUserId && asset.projectId === projectId && asset.expectedSha256 === sha256 && asset.status !== "failed");
    return item ? structuredClone(item) : null;
  }
  public async getReservedBytes(ownerUserId: string): Promise<number> {
    return Array.from(this.assets.values()).filter((asset) => asset.ownerUserId === ownerUserId && asset.status !== "failed").reduce((total, asset) => total + asset.expectedSize, 0);
  }
  public async createIntent(record: CreateAssetRecord): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; created: boolean }> {
    const existing = this.assets.get(record.asset.id) ?? await this.findActiveByHash(record.asset.ownerUserId, record.asset.projectId, record.asset.expectedSha256);
    if (existing) return { asset: existing, ingestion: structuredClone(this.jobs.get(existing.id)!), created: false };
    this.assets.set(record.asset.id, structuredClone(record.asset));
    this.jobs.set(record.ingestion.id, structuredClone(record.ingestion));
    return { asset: structuredClone(record.asset), ingestion: structuredClone(record.ingestion), created: true };
  }
  public async getOwnedAsset(assetId: string, ownerUserId: string): Promise<AssetRecord | null> {
    const asset = this.assets.get(assetId);
    return asset?.ownerUserId === ownerUserId ? structuredClone(asset) : null;
  }
  public async getAssetForActor(assetId: string, ownerUserId: string): Promise<AssetRecord | null> { return this.getOwnedAsset(assetId, ownerUserId); }
  public async getIngestionJob(assetId: string, ownerUserId: string): Promise<IngestionJobRecord | null> {
    const asset = await this.getOwnedAsset(assetId, ownerUserId);
    if (!asset) return null;
    const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId);
    return job ? structuredClone(job) : null;
  }
  public async completeVerification(input: { assetId: string; ownerUserId: string; etag: string; actualSize: number; actualSha256: string }): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; idempotent: boolean }> {
    const asset = await this.getOwnedAsset(input.assetId, input.ownerUserId);
    if (!asset) throw new AssetNotFoundError();
    if (asset.status === "verified") return { asset, ingestion: structuredClone(Array.from(this.jobs.values()).find((job) => job.assetId === asset.id)!), idempotent: true };
    if (asset.status !== "pending_upload" && asset.status !== "uploaded") throw new AssetConflictError("该上传已失败，请创建新的上传意图");
    asset.etag = input.etag; asset.actualSize = input.actualSize; asset.actualSha256 = input.actualSha256; asset.status = "verified"; asset.uploadedAt = asset.uploadedAt ?? new Date().toISOString(); asset.verifiedAt = new Date().toISOString(); asset.updatedAt = asset.verifiedAt;
    this.assets.set(asset.id, asset);
    const job = Array.from(this.jobs.values()).find((item) => item.assetId === asset.id);
    if (!job) throw new AssetNotFoundError();
    job.status = "queued"; job.updatedAt = new Date().toISOString(); this.jobs.set(job.id, job);
    return { asset: structuredClone(asset), ingestion: structuredClone(job), idempotent: false };
  }
  public async failAsset(assetId: string, ownerUserId: string, code: string, message: string): Promise<void> { const asset = await this.getOwnedAsset(assetId, ownerUserId); if (!asset) throw new AssetNotFoundError(); asset.status = "failed"; asset.updatedAt = new Date().toISOString(); this.assets.set(asset.id, asset); const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId); if (job) { job.status = "failed"; job.errorCode = code; job.errorMessage = message; job.updatedAt = asset.updatedAt; this.jobs.set(job.id, job); } }
  public async retryIngestion(assetId: string, ownerUserId: string): Promise<IngestionJobRecord> { const asset = await this.getOwnedAsset(assetId, ownerUserId); if (!asset) throw new AssetNotFoundError(); if (asset.status !== "verified") throw new AssetConflictError("上传校验失败需创建新的上传意图"); const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId); if (!job) throw new AssetNotFoundError(); if (job.status !== "failed") throw new AssetConflictError("只有失败任务可以重试"); job.status = "queued"; job.attempt += 1; job.errorCode = null; job.errorMessage = null; job.updatedAt = new Date().toISOString(); this.jobs.set(job.id, job); return structuredClone(job); }
  public async updateIngestionStatus(assetId: string, status: IngestionStatus, error?: { code: string; message: string }): Promise<IngestionJobRecord | null> { const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId); if (!job) return null; job.status = status; job.updatedAt = new Date().toISOString(); if (error) { job.errorCode = error.code; job.errorMessage = error.message; } this.jobs.set(job.id, job); return structuredClone(job); }
  public async markDerivedAsset(input: { sourceAssetId: string; ownerUserId: string; derived: AssetRecord }): Promise<AssetRecord> { const source = await this.getOwnedAsset(input.sourceAssetId, input.ownerUserId); if (!source) throw new AssetNotFoundError(); this.assets.set(input.derived.id, structuredClone(input.derived)); const job = Array.from(this.jobs.values()).find((item) => item.assetId === source.id); if (job) { job.derivedAssetId = input.derived.id; job.status = "ready"; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt; this.jobs.set(job.id, job); } return structuredClone(input.derived); }
}
