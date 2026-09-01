import type { SourceChunk } from "@/lib/domain/research";
import { getEmbeddingProvider, getEmbeddingProviderConfig, type EmbeddingProvider, type EnvironmentValues } from "@/lib/providers/embedding-provider";

const MAX_DENSE_CHUNKS = 48;
// 3072 维向量在 JS 数组中开销较高；个人 2C2G 部署只保留小型进程内热缓存。
const MAX_CACHE_ENTRIES = 256;
const MAX_TEXT_LENGTH = 24_000;

/** 单次语义召回的可审计状态；degraded 时调用方必须保留 FTS/RRF 的确定性结果。 */
export interface DenseRetrievalResult {
  status: "completed" | "degraded";
  provider: "remote" | "local_bge_m3" | null;
  model: string | null;
  ranks: Map<string, number>;
  reason: string | null;
}

/** 允许搜索服务在契约测试中注入确定性 Dense 结果，而不请求真实模型。 */
export interface DenseRetriever {
  rank(query: string, chunks: SourceChunk[]): Promise<DenseRetrievalResult>;
}

/** 为 Embedding 构造 Contextual Retrieval 文本，保留标题路径但不混入无关来源快照。 */
export function contextualEmbeddingText(chunk: SourceChunk): string {
  return `${chunk.contextualPrefix}\n${chunk.headingPath.join(" / ")}\n${chunk.text}`.trim();
}

/** 简单稳定哈希只用于进程内缓存键；来源真实性仍依赖数据库保存的 content_hash。 */
function cacheTextHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

/** 余弦相似度对未归一化 API 向量同样可用；零向量或维度不一致视为服务故障。 */
function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) throw new Error("语义向量维度不一致。");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) throw new Error("语义向量不能为零向量。");
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/**
 * 当前的最小 Dense 召回闭环。
 * 只对有限的 active chunk 临时计算 query/chunk vectors，适合个人小资料库的可测过渡方案；
 * 超过上限明确降级，pgvector 持久化/ANN 索引尚未实现前不能假称适合大规模语料。
 */
export class DenseRetrievalService implements DenseRetriever {
  private readonly vectorCache = new Map<string, number[]>();

  public constructor(
    private readonly environment: EnvironmentValues = process.env,
    private readonly provider: EmbeddingProvider = getEmbeddingProvider(environment),
    private readonly maxChunks = MAX_DENSE_CHUNKS,
  ) {}

  /** 返回 chunkId -> 语义排名（1 为最佳）；失败不会阻断已有全文检索。 */
  public async rank(query: string, chunks: SourceChunk[]): Promise<DenseRetrievalResult> {
    const config = getEmbeddingProviderConfig(this.environment);
    if (config.kind === "none") return this.degraded(config.reason);
    if (!query.trim() || query.length > MAX_TEXT_LENGTH) return this.degraded("查询不满足语义检索输入限制，保留全文排序。");
    if (chunks.length === 0) return this.degraded("没有 active 来源片段可用于语义检索。");
    if (chunks.length > this.maxChunks) return this.degraded(`当前 active Chunk 数量为 ${chunks.length}，超过临时语义召回上限 ${this.maxChunks}；保留全文排序。`);

    const payloads = chunks.map((chunk) => ({ chunk, text: contextualEmbeddingText(chunk) }));
    if (payloads.some(({ text }) => !text || text.length > MAX_TEXT_LENGTH)) {
      return this.degraded("存在超出语义检索输入限制的 Chunk，保留全文排序。");
    }

    const cachePrefix = config.kind === "remote" ? `remote:${config.model}` : `local:${config.model}`;
    const cacheKeys = payloads.map(({ text }) => `${cachePrefix}:${cacheTextHash(text)}`);
    const missingIndexes = cacheKeys.flatMap((key, index) => this.vectorCache.has(key) ? [] : [index]);
    try {
      // query 与未缓存 Chunk 一次请求，减少远程往返；缓存命中时只发送当前用户查询。
      const embedded = await this.provider.embed([query, ...missingIndexes.map((index) => payloads[index]!.text)]);
      const queryVector = embedded.vectors[0];
      if (!queryVector) return this.degraded("语义服务未返回查询向量，保留全文排序。");
      for (let offset = 0; offset < missingIndexes.length; offset += 1) {
        const sourceIndex = missingIndexes[offset]!;
        const vector = embedded.vectors[offset + 1];
        if (!vector) return this.degraded("语义服务未返回完整 Chunk 向量，保留全文排序。");
        this.remember(cacheKeys[sourceIndex]!, vector);
      }

      const scored = payloads.map(({ chunk }, index) => ({
        chunkId: chunk.id,
        score: cosineSimilarity(queryVector, this.vectorCache.get(cacheKeys[index]!)!),
      })).sort((left, right) => right.score - left.score || left.chunkId.localeCompare(right.chunkId));
      return {
        status: "completed", provider: embedded.provider, model: embedded.model,
        ranks: new Map(scored.map((item, index) => [item.chunkId, index + 1])), reason: null,
      };
    } catch {
      return this.degraded("语义检索服务不可用或响应无效，保留全文排序。");
    }
  }

  /** 限制每个 Node 进程的临时缓存，避免长期运行时以资料内容无限占用内存。 */
  private remember(key: string, vector: number[]): void {
    this.vectorCache.set(key, vector);
    while (this.vectorCache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.vectorCache.keys().next().value as string | undefined;
      if (!oldest) return;
      this.vectorCache.delete(oldest);
    }
  }

  private degraded(reason: string): DenseRetrievalResult {
    return { status: "degraded", provider: null, model: null, ranks: new Map(), reason };
  }
}
