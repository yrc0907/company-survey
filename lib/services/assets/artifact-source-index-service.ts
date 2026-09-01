import { createHash } from "node:crypto";

import { ValidationError } from "@/lib/domain/errors";
import { PermissionDeniedError, type AuthenticatedActor } from "@/lib/domain/platform";
import type { Source, SourceChunk } from "@/lib/domain/research";
import type { AssetRepository } from "@/lib/repositories/assets/assets-repository";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";

const MAX_CHUNK_CHARS = 1_200;
const MAX_CHUNKS = 4_096;
const SHA256 = /^[a-f0-9]{64}$/;

export interface ArtifactSourceIndexInput {
  /** 要索引的已验证资产；服务只取其最新 ready 产物。 */
  assetId: string;
  /** 目标 Research Workbench 报告；不能由模型或浏览器自行推断。 */
  reportId: string;
  /** 必须与上传资产的项目范围完全一致。 */
  projectId: string;
  branchId: string;
  sourceTitle?: string;
}

export interface ArtifactSourceIndexResult {
  status: "indexed" | "idempotent";
  source: Source;
  chunks: SourceChunk[];
  artifactId: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function languageOf(text: string): Source["language"] {
  if (/[一-鿿]/.test(text)) return "zh";
  if (/[A-Za-z]/.test(text)) return "en";
  return "other";
}

function sourceKind(extension: string): Source["kind"] {
  if (extension === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "image";
  return "text";
}

function safeTitle(value: string): string {
  const title = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!title || title.length > 255) throw new ValidationError("来源标题无效");
  return title;
}

/**
 * 按自然段和 Markdown 标题切分解析正文。
 * 偏移量仍指向同一份 artifact.content，Chunk 只是可重建索引，不会改变原件或产物。
 */
function splitChunks(text: string, sourceId: string, title: string): SourceChunk[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const chunks: SourceChunk[] = [];
  let headingPath: string[] = [];
  let cursor = 0;
  let position = 1;

  const append = (value: string, startOffset: number, endOffset: number, path: string[]) => {
    const part = value.trim();
    if (!part) return;
    const prefix = `文件：${title}${path.length ? `\n位置：${path.join(" / ")}` : ""}`;
    chunks.push({
      id: `${sourceId}-chunk-${position}`,
      sourceId,
      parentSectionId: null,
      headingPath: path,
      position,
      page: null,
      startOffset,
      endOffset,
      text: part,
      contextualPrefix: prefix,
      // Chunk 哈希只指向原文，不把可重建的上下文前缀混入正文指纹。
      contentHash: digest(part),
    });
    position += 1;
  };

  for (const paragraph of normalized.split(/\n{2,}/)) {
    const paragraphStart = normalized.indexOf(paragraph, cursor);
    const start = paragraphStart >= 0 ? paragraphStart : cursor;
    cursor = start + paragraph.length;
    const heading = paragraph.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      headingPath = headingPath.slice(0, level - 1);
      headingPath.push(heading[2]!.trim());
    }
    if (paragraph.length <= MAX_CHUNK_CHARS) {
      append(paragraph, start, start + paragraph.length, headingPath);
      if (chunks.length >= MAX_CHUNKS) throw new ValidationError("解析产物切片数量超过上限");
      continue;
    }
    for (let offset = 0; offset < paragraph.length; offset += MAX_CHUNK_CHARS) {
      append(paragraph.slice(offset, offset + MAX_CHUNK_CHARS), start + offset, Math.min(start + offset + MAX_CHUNK_CHARS, start + paragraph.length), headingPath);
      if (chunks.length >= MAX_CHUNKS) throw new ValidationError("解析产物切片数量超过上限");
    }
  }
  if (chunks.length === 0 && normalized.trim()) append(normalized, 0, normalized.length, headingPath);
  return chunks;
}

/**
 * 将 ready 文本产物注册为可检索来源。
 * 先做 owner/project/branch 与报告存在性校验，再由 ResearchRepository 以事务写入 source/source_chunk。
 * 重复 artifact 或相同报告内容只返回既有来源；任何路径都不覆盖 OSS 原件、解析产物或历史来源。
 */
export class ArtifactSourceIndexService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly assets: AssetRepository,
    platform: PlatformRepository,
    private readonly research: ResearchRepository,
  ) {
    this.authorization = new AuthorizationService(platform);
  }

  /** 校验当前 actor 与 Scope 后索引最新 ready 产物；返回 indexed 或幂等命中，不修改原始资产。 */
  public async indexReadyArtifact(actor: AuthenticatedActor, input: ArtifactSourceIndexInput): Promise<ArtifactSourceIndexResult> {
    if (!input.assetId.trim() || !input.reportId.trim() || !input.projectId.trim() || !input.branchId.trim()) throw new ValidationError("索引范围参数不能为空");
    const asset = await this.assets.getOwnedAsset(input.assetId, actor.userId);
    if (!asset) throw new PermissionDeniedError();
    if (asset.ownerUserId !== actor.userId || asset.projectId !== input.projectId || asset.branchId !== input.branchId) throw new PermissionDeniedError("上传资产不属于当前项目分支");
    await this.authorization.assertBranchAction(actor, input.projectId, input.branchId, "write_branch");

    const report = await this.research.getReport(input.reportId);
    if (!report) throw new ValidationError("目标报告不存在");
    const job = await this.assets.getIngestionJob(asset.id, actor.userId);
    const artifact = await this.assets.getIngestionArtifact(asset.id, actor.userId);
    if (!job || job.status !== "ready" || !artifact || artifact.assetId !== asset.id || artifact.kind !== "text" || !artifact.content || !artifact.contentHash || !SHA256.test(artifact.contentHash)) {
      throw new ValidationError("只有 ready 的文本解析产物可以进入检索索引");
    }
    if (digest(artifact.content) !== artifact.contentHash) throw new ValidationError("解析产物内容哈希校验失败");

    const snapshot = await this.research.getSnapshot();
    const byArtifact = snapshot.sources.find((source) => source.ingestionArtifactId === artifact.id);
    if (byArtifact) {
      if (byArtifact.reportId !== report.id) throw new ValidationError("解析产物已经索引到其他报告，不能跨报告复用");
      return { status: "idempotent", source: byArtifact, chunks: snapshot.chunks.filter((chunk) => chunk.sourceId === byArtifact.id), artifactId: artifact.id };
    }
    const byHash = snapshot.sources.find((source) => source.reportId === report.id && source.contentHash === artifact.contentHash);
    if (byHash) {
      // 旧来源可能没有项目血缘；不改写它，只将同哈希视为已存在，防止重复来源污染检索结果。
      if ((byHash.projectId && byHash.projectId !== input.projectId) || (byHash.branchId && byHash.branchId !== input.branchId) || (byHash.ownerUserId && byHash.ownerUserId !== actor.userId)) {
        throw new PermissionDeniedError("相同内容来源属于其他项目范围");
      }
      return { status: "idempotent", source: byHash, chunks: snapshot.chunks.filter((chunk) => chunk.sourceId === byHash.id), artifactId: artifact.id };
    }

    const title = safeTitle(input.sourceTitle ?? asset.filename);
    const sourceId = `source-artifact-${digest(`${report.id}:${artifact.contentHash}`).slice(0, 40)}`;
    const source: Source = {
      id: sourceId,
      reportId: report.id,
      title,
      kind: sourceKind(asset.extension),
      url: null,
      language: languageOf(artifact.content),
      state: "active",
      capturedAt: asset.verifiedAt ?? asset.createdAt,
      contentHash: artifact.contentHash,
      snapshot: artifact.content,
      ingestionArtifactId: artifact.id,
      ownerUserId: asset.ownerUserId,
      projectId: asset.projectId,
      branchId: asset.branchId,
    };
    const chunks = splitChunks(artifact.content, source.id, title);
    if (chunks.length === 0) throw new ValidationError("解析产物没有可检索正文");
    await this.research.createTextSource(source, chunks);
    return { status: "indexed", source, chunks, artifactId: artifact.id };
  }
}
