import { createHash } from "node:crypto";

import { AssetConflictError, AssetNotFoundError } from "@/lib/domain/assets";
import { ValidationError } from "@/lib/domain/errors";
import type { AuthenticatedActor } from "@/lib/domain/platform";
import type { AssetRepository } from "@/lib/repositories/assets/assets-repository";

const MAX_REVIEW_TEXT = 120_000;

function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

/** 人工确认视觉草稿：保留原始待校对产物，追加可索引 text 产物，绝不修改 OSS 原件。 */
export class VisionReviewService {
  public constructor(private readonly assets: AssetRepository) {}

  public async approve(actor: AuthenticatedActor, assetId: string, input: { artifactId: string; text: string }): Promise<{ ingestion: Awaited<ReturnType<AssetRepository["getIngestionJob"]>>; artifactId: string }> {
    const normalizedId = assetId.trim();
    const artifactId = input.artifactId.trim();
    const content = input.text.replace(/\r\n?/g, "\n").trim();
    if (!normalizedId || normalizedId.length > 128 || !artifactId || artifactId.length > 160) throw new ValidationError("待校对资产或产物 ID 无效");
    if (!content) throw new ValidationError("校对正文不能为空");
    if (content.length > MAX_REVIEW_TEXT) throw new ValidationError(`校对正文不能超过 ${MAX_REVIEW_TEXT} 个字符`);
    const asset = await this.assets.getOwnedAsset(normalizedId, actor.userId);
    if (!asset) throw new AssetNotFoundError();
    const artifact = await this.assets.getIngestionArtifact(normalizedId, actor.userId);
    if (!artifact || artifact.id !== artifactId || artifact.kind !== "needs_review") throw new AssetConflictError("待校对产物已更新，请重新加载");
    const job = await this.assets.getIngestionJob(normalizedId, actor.userId);
    if (!job || job.status !== "needs_review") throw new AssetConflictError("当前解析任务不在待校对状态");
    const nextJob = await this.assets.approveIngestionReview({
      assetId: normalizedId, ownerUserId: actor.userId, expectedArtifactId: artifactId, content, contentHash: digest(content),
      metadata: { parser: "human-reviewed-v1", reviewedFromArtifactId: artifactId, reviewerUserId: actor.userId, reviewedAt: new Date().toISOString() },
    });
    if (!nextJob) throw new AssetConflictError("解析任务状态已变化，请重新加载");
    // 返回最新产物 ID，客户端可再次 GET 状态确认；不把正文重复回传。
    const latest = await this.assets.getIngestionArtifact(normalizedId, actor.userId);
    if (!latest) throw new AssetConflictError("校对已保存但无法读取新产物，请刷新任务状态");
    return { ingestion: nextJob, artifactId: latest.id };
  }
}

export const VISION_REVIEW_MAX_TEXT = MAX_REVIEW_TEXT;
