import { randomUUID } from "node:crypto";

import { AssetConflictError, AssetNotFoundError, IngestionLeaseLostError } from "@/lib/domain/assets";
import type { AssetRecord, IngestionArtifactRecord, IngestionJobRecord, IngestionStatus } from "@/lib/domain/assets";
import type { ApproveIngestionReviewInput, AssetRepository, CompleteIngestionInput, CreateAssetRecord, FailIngestionInput, IngestionClaim, NeedsReviewIngestionInput } from "@/lib/repositories/assets/assets-repository";

/** 上传契约使用的内存实现；只用于测试，生产工厂永远选择 PostgreSQL。 */
export class MemoryAssetsRepository implements AssetRepository {
  private readonly assets = new Map<string, AssetRecord>();
  private readonly jobs = new Map<string, IngestionJobRecord>();
  private readonly artifacts = new Map<string, IngestionArtifactRecord[]>();

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
  public async failAsset(assetId: string, ownerUserId: string, code: string, message: string): Promise<void> { const asset = await this.getOwnedAsset(assetId, ownerUserId); if (!asset) throw new AssetNotFoundError(); asset.status = "failed"; asset.updatedAt = new Date().toISOString(); this.assets.set(asset.id, asset); const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId); if (job) { job.status = "failed"; job.errorCode = code; job.errorMessage = message; job.updatedAt = asset.updatedAt; job.leaseOwner = null; job.leaseExpiresAt = null; this.jobs.set(job.id, job); } }
  public async retryIngestion(assetId: string, ownerUserId: string): Promise<IngestionJobRecord> { const asset = await this.getOwnedAsset(assetId, ownerUserId); if (!asset) throw new AssetNotFoundError(); if (asset.status !== "verified") throw new AssetConflictError("上传校验失败需创建新的上传意图"); const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId); if (!job) throw new AssetNotFoundError(); if (job.status !== "failed" && job.status !== "needs_review") throw new AssetConflictError("只有失败或待校对任务可以重试"); job.status = "queued"; job.errorCode = null; job.errorMessage = null; job.leaseOwner = null; job.leaseExpiresAt = null; job.updatedAt = new Date().toISOString(); this.jobs.set(job.id, job); return structuredClone(job); }
  public async updateIngestionStatus(assetId: string, status: IngestionStatus, error?: { code: string; message: string }): Promise<IngestionJobRecord | null> { const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId); if (!job) return null; job.status = status; job.updatedAt = new Date().toISOString(); if (status === "ready" || status === "needs_review") job.completedAt = job.updatedAt; if (status === "queued" || status === "ready" || status === "needs_review" || status === "failed") { job.leaseOwner = null; job.leaseExpiresAt = null; } if (error) { job.errorCode = error.code; job.errorMessage = error.message; } this.jobs.set(job.id, job); return structuredClone(job); }
  public async markDerivedAsset(input: { sourceAssetId: string; ownerUserId: string; derived: AssetRecord }): Promise<AssetRecord> { const source = await this.getOwnedAsset(input.sourceAssetId, input.ownerUserId); if (!source) throw new AssetNotFoundError(); this.assets.set(input.derived.id, structuredClone(input.derived)); const job = Array.from(this.jobs.values()).find((item) => item.assetId === source.id); if (job) { job.derivedAssetId = input.derived.id; job.status = "ready"; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt; this.jobs.set(job.id, job); } return structuredClone(input.derived); }

  /** 内存实现模拟 SELECT ... FOR UPDATE；契约测试不并发访问同一个 Map。 */
  public async claimNextIngestion(workerId: string, leaseSeconds: number): Promise<IngestionClaim | null> {
    const now = Date.now();
    const candidate = Array.from(this.jobs.values())
      .filter((job) => {
        const asset = this.assets.get(job.assetId);
        const expired = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) <= now : true;
        return asset?.status === "verified" && (job.status === "queued" || ((job.status === "processing" || job.status === "uploading") && expired));
      })
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))[0];
    if (!candidate) return null;
    const asset = this.assets.get(candidate.assetId)!;
    const leaseOwner = `${workerId}:${randomUUID()}`;
    const claimedAt = new Date().toISOString();
    candidate.status = "processing";
    candidate.attempt += 1;
    candidate.leaseOwner = leaseOwner;
    const boundedLease = Number.isFinite(leaseSeconds) ? Math.max(5, Math.min(900, Math.trunc(leaseSeconds))) : 120;
    candidate.leaseExpiresAt = new Date(now + boundedLease * 1_000).toISOString();
    candidate.startedAt = candidate.startedAt ?? claimedAt;
    candidate.updatedAt = claimedAt;
    this.jobs.set(candidate.id, candidate);
    return { asset: structuredClone(asset), job: structuredClone(candidate), leaseOwner };
  }

  public async completeIngestion(input: CompleteIngestionInput): Promise<IngestionJobRecord | null> {
    const job = this.jobs.get(input.jobId);
    if (!job || job.assetId !== input.assetId || job.status !== "processing" || job.leaseOwner !== input.leaseOwner || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new IngestionLeaseLostError();
    const prior = this.artifacts.get(input.artifact.ingestionJobId) ?? [];
    prior.push(structuredClone(input.artifact));
    this.artifacts.set(input.artifact.ingestionJobId, prior);
    job.status = "ready"; job.errorCode = null; job.errorMessage = null; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt; job.leaseOwner = null; job.leaseExpiresAt = null;
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  public async markIngestionNeedsReview(input: NeedsReviewIngestionInput): Promise<IngestionJobRecord | null> {
    const job = this.jobs.get(input.jobId);
    if (!job || job.assetId !== input.assetId || job.status !== "processing" || job.leaseOwner !== input.leaseOwner || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.now()) throw new IngestionLeaseLostError();
    const prior = this.artifacts.get(input.artifact.ingestionJobId) ?? [];
    prior.push(structuredClone(input.artifact));
    this.artifacts.set(input.artifact.ingestionJobId, prior);
    job.status = "needs_review"; job.errorCode = input.code; job.errorMessage = input.message; job.updatedAt = new Date().toISOString(); job.leaseOwner = null; job.leaseExpiresAt = null;
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  /** 内存仓储模拟人工确认状态机；与 PostgreSQL 使用相同的追加产物语义。 */
  public async approveIngestionReview(input: ApproveIngestionReviewInput): Promise<IngestionJobRecord | null> {
    const asset = await this.getOwnedAsset(input.assetId, input.ownerUserId);
    const job = asset ? await this.getIngestionJob(input.assetId, input.ownerUserId) : null;
    if (!asset || !job) return null;
    if (job.status === "ready") return structuredClone(job);
    if (job.status !== "needs_review") throw new AssetConflictError("只有待校对解析任务可以确认");
    const artifacts = this.artifacts.get(job.id) ?? [];
    const prior = artifacts.find((artifact) => artifact.id === input.expectedArtifactId && artifact.kind === "needs_review");
    if (!prior) throw new AssetConflictError("待校对产物已更新，请重新加载后确认");
    artifacts.push({ id: crypto.randomUUID(), ingestionJobId: job.id, assetId: input.assetId, attempt: job.attempt + 1, kind: "text", mimeType: "text/plain", content: input.content, contentHash: input.contentHash, metadata: structuredClone(input.metadata), createdAt: new Date().toISOString() });
    job.status = "ready"; job.errorCode = null; job.errorMessage = null; job.completedAt = new Date().toISOString(); job.updatedAt = job.completedAt;
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  public async failIngestion(input: FailIngestionInput): Promise<IngestionJobRecord | null> {
    const job = this.jobs.get(input.jobId);
    if (!job || job.assetId !== input.assetId || job.status !== "processing" || job.leaseOwner !== input.leaseOwner) return null;
    job.status = "failed"; job.errorCode = input.code; job.errorMessage = input.message; job.updatedAt = new Date().toISOString(); job.leaseOwner = null; job.leaseExpiresAt = null;
    this.jobs.set(job.id, job);
    return structuredClone(job);
  }

  public async getIngestionArtifact(assetId: string, ownerUserId: string): Promise<IngestionArtifactRecord | null> {
    const asset = await this.getOwnedAsset(assetId, ownerUserId);
    if (!asset) return null;
    const job = Array.from(this.jobs.values()).find((item) => item.assetId === assetId);
    const artifacts = job ? this.artifacts.get(job.id) : undefined;
    // 内存实现按追加顺序模拟 PostgreSQL created_at/id 的最新记录，避免同毫秒时间戳时随机返回旧草稿。
    const artifact = artifacts?.at(-1);
    return artifact ? structuredClone(artifact) : null;
  }
}
