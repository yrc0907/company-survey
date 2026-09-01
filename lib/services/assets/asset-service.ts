import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";

import { ValidationError } from "@/lib/domain/errors";
import { AssetConflictError, AssetNotFoundError, AssetQuotaExceededError, AssetVerificationError, ASSET_MAX_BYTES, type AssetRecord, type CompleteUploadInput, type IngestionJobRecord, type UploadIntentInput, type UploadIntentResult } from "@/lib/domain/assets";
import type { AuthenticatedActor } from "@/lib/domain/platform";
import { assertAllowedUpload, createObjectKey } from "@/lib/providers/oss";
import type { OssObjectStorageProvider } from "@/lib/providers/oss";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";
import type { AssetRepository } from "@/lib/repositories/assets/assets-repository";

const DEFAULT_QUOTA_BYTES = 500 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const ETAG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;

function normalizeEtag(value: string): string { return value.trim().replace(/^"|"$/g, "").toLowerCase(); }
function safeFilename(value: string): string {
  const filename = value.trim();
  if (!filename || filename.length > 255 || /[\u0000-\u001f\\/]/.test(filename) || filename === "." || filename === "..") throw new ValidationError("文件名无效");
  return filename;
}
function hashForIdempotency(owner: string, clientId: string | undefined, sha256: string): string { return `${owner}:${clientId?.trim() || sha256}`; }

/** 负责登录上传的权限、配额、OSS 签名和转正校验；不解析文件内容，也不直接修改项目正文。 */
export class AssetService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly assets: AssetRepository, platform: PlatformRepository, private readonly oss: OssObjectStorageProvider, private readonly environment: Record<string, string | undefined> = process.env) { this.authorization = new AuthorizationService(platform); }

  /** 创建 quarantine 直传意图；项目上传必须明确写入的非保护分支，避免写错公开 main。 */
  public async createUploadIntent(actor: AuthenticatedActor, input: UploadIntentInput): Promise<UploadIntentResult> {
    const filename = safeFilename(input.filename);
    const extension = extname(filename).toLowerCase();
    const contentType = input.contentType.trim().toLowerCase();
    const sha256 = input.sha256.trim().toLowerCase();
    if (!SHA256.test(sha256)) throw new ValidationError("sha256 必须是 64 位小写 SHA-256");
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > ASSET_MAX_BYTES) throw new ValidationError("文件大小必须在 1 byte 到 25 MiB 之间");
    try { assertAllowedUpload(extension, contentType); } catch { throw new ValidationError("文件扩展名和 MIME 类型不匹配或不在白名单中"); }
    if (input.branchId && !input.projectId) throw new ValidationError("指定分支时必须指定项目");
    if (input.projectId && !input.branchId) throw new ValidationError("项目上传必须指定目标草稿分支");
    if (input.projectId) await this.authorization.assertBranchAction(actor, input.projectId, input.branchId!, "write_branch");

    const duplicate = await this.assets.findActiveByHash(actor.userId, input.projectId ?? null, sha256);
    // 幂等重试不再预占空间；先查重再做配额检查，避免已存在对象因配额变化无法继续上传/确认。
    const quota = Number(this.environment.PLATFORM_UPLOAD_USER_QUOTA_BYTES ?? DEFAULT_QUOTA_BYTES);
    if (!duplicate) {
      const reserved = await this.assets.getReservedBytes(actor.userId);
      if (Number.isFinite(quota) && quota > 0 && reserved + input.size > quota) throw new AssetQuotaExceededError();
    }
    const asset = duplicate ?? this.newAsset(actor.userId, input, filename, extension as AssetRecord["extension"], contentType, sha256);
    const idempotencyKey = hashForIdempotency(actor.userId, input.clientUploadId, sha256);
    const now = new Date().toISOString();
    const ingestion: IngestionJobRecord = duplicate ? (await this.assets.getIngestionJob(asset.id, actor.userId))! : { id: randomUUID(), assetId: asset.id, idempotencyKey, status: "queued", attempt: 0, errorCode: null, errorMessage: null, derivedAssetId: null, createdAt: now, startedAt: null, completedAt: null, updatedAt: now, leaseOwner: null, leaseExpiresAt: null };
    if (!ingestion) throw new AssetConflictError();
    const created = duplicate ? { asset, ingestion, created: false } : await this.assets.createIntent({ asset, ingestion });
    const upload = await this.oss.createUploadGrant({ objectKey: created.asset.objectKey, contentType: created.asset.mimeType, contentLength: created.asset.expectedSize, sha256: created.asset.expectedSha256 });
    return { asset: created.asset, upload, ingestion: created.ingestion };
  }

  private newAsset(ownerUserId: string, input: UploadIntentInput, filename: string, extension: AssetRecord["extension"], contentType: string, sha256: string): AssetRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    return { id, ownerUserId, projectId: input.projectId ?? null, branchId: input.branchId ?? null, originalAssetId: null, assetKind: "original", filename, extension, mimeType: contentType, objectKey: createObjectKey({ kind: "quarantine", ownerId: ownerUserId, uploadId: id, contentHash: sha256, extension }), expectedSize: input.size, expectedSha256: sha256, etag: null, actualSize: null, actualSha256: null, status: "pending_upload", createdAt: now, uploadedAt: null, verifiedAt: null, updatedAt: now };
  }

  /** 完成直传后用 OSS HEAD 的 ETag、长度和 x-oss-meta-sha256 三重校验，再排队解析。 */
  public async completeUpload(actor: AuthenticatedActor, assetId: string, input: CompleteUploadInput): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; idempotent: boolean }> {
    const ownerUserId = actor.userId;
    const asset = await this.assets.getOwnedAsset(assetId, ownerUserId);
    if (!asset) throw new AssetNotFoundError();
    if (!ETAG.test(normalizeEtag(input.etag))) throw new ValidationError("ETag 无效");
    if (!Number.isInteger(input.size) || input.size < 1 || input.size > ASSET_MAX_BYTES || !SHA256.test(input.sha256.toLowerCase())) throw new ValidationError("完成确认参数无效");
    if (asset.status === "verified") {
      const job = await this.assets.getIngestionJob(assetId, ownerUserId);
      if (!job) throw new AssetNotFoundError();
      return { asset, ingestion: job, idempotent: true };
    }
    let head;
    try { head = await this.oss.headObject(asset.objectKey); } catch { throw new AssetVerificationError("无法从私有 OSS 读取对象元数据，请稍后重试"); }
    const expectedEtag = normalizeEtag(input.etag);
    const actualEtag = normalizeEtag(head.etag ?? "");
    const sha256 = input.sha256.toLowerCase();
    const actualSha256 = head.sha256?.toLowerCase() ?? await this.oss.sha256Object(asset.objectKey).catch(() => null);
    if (!head.etag || head.contentLength === null || !actualSha256 || expectedEtag !== actualEtag || input.size !== asset.expectedSize || head.contentLength !== asset.expectedSize || sha256 !== asset.expectedSha256 || actualSha256 !== asset.expectedSha256) {
      await this.assets.failAsset(assetId, ownerUserId, "UPLOAD_VERIFICATION_FAILED", "ETag、大小或 SHA-256 与上传意图不一致");
      // 校验失败的隔离对象没有证据价值，立即尝试回收；若 OSS 暂时不可用，DELETE 接口仍可安全重试。
      try { await this.oss.deleteObject(asset.objectKey); } catch (cleanupError) { console.error("OSS quarantine cleanup failed", { assetId, cleanupError }); }
      throw new AssetVerificationError();
    }
    return this.assets.completeVerification({ assetId, ownerUserId, etag: actualEtag, actualSize: head.contentLength, actualSha256 });
  }

  public async getStatus(actor: AuthenticatedActor, assetId: string): Promise<{ asset: AssetRecord; ingestion: IngestionJobRecord; artifact: Awaited<ReturnType<AssetRepository["getIngestionArtifact"]>> }> { const asset = await this.assets.getOwnedAsset(assetId, actor.userId); if (!asset) throw new AssetNotFoundError(); const ingestion = await this.assets.getIngestionJob(assetId, actor.userId); if (!ingestion) throw new AssetNotFoundError(); return { asset, ingestion, artifact: await this.assets.getIngestionArtifact(assetId, actor.userId) }; }
  public async retry(actor: AuthenticatedActor, assetId: string): Promise<IngestionJobRecord> { return this.assets.retryIngestion(assetId, actor.userId); }
  /** 取消上传队列：未确认对象标记失败；已确认原件只取消解析 Job，不删除不可变原始证据。 */
  public async cancel(actor: AuthenticatedActor, assetId: string): Promise<void> {
    const asset = await this.assets.getOwnedAsset(assetId, actor.userId);
    if (!asset) throw new AssetNotFoundError();
    if (asset.status === "verified") {
      const job = await this.assets.getIngestionJob(assetId, actor.userId);
      if (!job) throw new AssetNotFoundError();
      await this.assets.updateIngestionStatus(assetId, "failed", { code: "INGESTION_CANCELLED", message: "用户从队列移除" });
      return;
    }
    // pending/uploaded/failed 只属于隔离区，取消前删除 OSS 对象；删除失败时保留状态，允许用户重试而不产生“假成功”。
    await this.oss.deleteObject(asset.objectKey);
    await this.assets.failAsset(assetId, actor.userId, "UPLOAD_CANCELLED", "用户取消上传");
  }
  public async createDownloadGrant(actor: AuthenticatedActor, assetId: string): Promise<{ url: string; expiresInSeconds: number }> { const asset = await this.assets.getAssetForActor(assetId, actor.userId); if (!asset || asset.status !== "verified") throw new AssetNotFoundError(); const grant = await this.oss.createDownloadGrant(asset.objectKey); return { url: grant.url, expiresInSeconds: grant.expiresInSeconds }; }
}

/** 仅供测试：确认 SHA-256 约束不会被 Node crypto 的默认大小写格式绕过。 */
export function sha256Hex(value: string): string { return createHash("sha256").update(value).digest("hex"); }
