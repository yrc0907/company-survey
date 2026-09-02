import { createHash, randomUUID } from "node:crypto";

import { IngestionLeaseLostError } from "@/lib/domain/assets";
import type { AssetRecord, IngestionArtifactRecord, IngestionJobRecord } from "@/lib/domain/assets";
import type { AssetRepository, IngestionClaim } from "@/lib/repositories/assets/assets-repository";
import { assertAssetMagic, parseAsset, type AssetParserResult } from "@/lib/services/assets/asset-parser";
import type { VisionParser } from "@/lib/providers/vision-provider";

const DEFAULT_LEASE_SECONDS = 120;
const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

export interface AssetObjectReader {
  /** 受限读取原始对象；实现必须在超过 maxBytes 时中止流。 */
  readObject(objectKey: string, maxBytes: number): Promise<Buffer>;
}

export interface AssetIngestionOptions { visionParser?: VisionParser | null; }

export interface IngestionProcessResult {
  asset: AssetRecord;
  job: IngestionJobRecord;
  outcome: AssetParserResult;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function asError(error: unknown): { code: string; message: string } {
  if (error && typeof error === "object" && "code" in error && "message" in error) return { code: String(error.code), message: String(error.message) };
  return { code: "PARSER_FAILED", message: error instanceof Error ? error.message : "解析失败，请稍后重试" };
}

/**
 * 解析任务编排器：领取租约 -> 读取并再次校验原件 -> 解析 -> 原子写入产物。
 * Worker 崩溃后租约过期即可重试；晚到结果被仓储条件更新拒绝，不会覆盖新一轮任务。
 */
export class AssetIngestionService {
  public constructor(private readonly assets: AssetRepository, private readonly objects: AssetObjectReader, private readonly leaseSeconds = DEFAULT_LEASE_SECONDS, private readonly options: AssetIngestionOptions = {}) {}

  /** 处理一个队列任务；无任务时返回 null，便于脚本轮询或一次性 drain。 */
  public async processNext(workerId: string): Promise<IngestionProcessResult | null> {
    const leaseOwner = `${workerId}:${randomUUID()}`;
    const claim = await this.assets.claimNextIngestion(leaseOwner, this.leaseSeconds);
    if (!claim) return null;
    return this.processClaim(claim, claim.leaseOwner);
  }

  /** 处理指定领取结果，供测试和未来队列适配器复用。 */
  public async processClaim(claim: IngestionClaim, leaseOwner = claim.leaseOwner): Promise<IngestionProcessResult> {
    const { asset, job } = claim;
    let outcome: AssetParserResult;
    try {
      if (asset.expectedSize > MAX_OBJECT_BYTES) throw new Error("原件超过解析读取上限");
      const bytes = await this.objects.readObject(asset.objectKey, asset.expectedSize);
      if (bytes.length !== asset.expectedSize || sha256(bytes) !== asset.expectedSha256) {
        throw new Error("OSS 原件在解析前校验失败，已拒绝生成正文");
      }
      assertAssetMagic(asset, bytes);
      outcome = parseAsset(asset, bytes);
      if (outcome.kind === "needs_review" && outcome.code === "PARSER_REQUIRES_VISION" && this.options.visionParser) {
        // 视觉结果仍保存为 needs_review metadata；不改变 Job 状态为 ready，避免未人工确认的 OCR 进入检索。
        outcome = await this.options.visionParser.parse({ asset, bytes });
      }
    } catch (error) {
      const failure = asError(error);
      const failed = await this.assets.failIngestion({ assetId: asset.id, jobId: job.id, leaseOwner, code: failure.code, message: failure.message });
      // 租约丢失说明另一个 Worker 已接管，不能把它当作解析失败返回给用户。
      if (!failed && !(error instanceof IngestionLeaseLostError)) throw new IngestionLeaseLostError();
      if (!failed) throw error;
      return { asset, job: failed, outcome: { kind: "needs_review", code: "PARSER_FAILED", message: failure.message, metadata: { parser: "worker", reason: "invalid" } } };
    }

    const artifact: IngestionArtifactRecord = {
      id: randomUUID(), ingestionJobId: job.id, assetId: asset.id, attempt: job.attempt, kind: outcome.kind,
      mimeType: outcome.kind === "text" ? outcome.mimeType : asset.mimeType,
      content: outcome.kind === "text" ? outcome.text : null,
      contentHash: outcome.kind === "text" ? sha256(Buffer.from(outcome.text, "utf8")) : null,
      metadata: outcome.metadata, createdAt: new Date().toISOString(),
    };
    const finished = outcome.kind === "text"
      ? await this.assets.completeIngestion({ assetId: asset.id, jobId: job.id, leaseOwner, artifact })
      : await this.assets.markIngestionNeedsReview({ assetId: asset.id, jobId: job.id, leaseOwner, artifact, code: outcome.code, message: outcome.message });
    if (!finished) throw new IngestionLeaseLostError();
    return { asset, job: finished, outcome };
  }
}
