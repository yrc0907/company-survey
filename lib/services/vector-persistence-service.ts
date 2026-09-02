import { createHash } from "node:crypto";

/** pgvector 的运行模式；auto 只在数据库确认扩展和向量列均存在时启用。 */
export type PgVectorMode = "auto" | "enabled" | "disabled";

/**
 * pgvector 配置只读取服务端环境变量，不能由请求参数覆盖。
 * 写入默认关闭，避免在未准备索引 Worker 时把用户请求变成昂贵的批量索引任务。
 */
export interface PgVectorConfig {
  mode: PgVectorMode;
  writeEnabled: boolean;
  embeddingVersion: string;
}

/** 数据库能力探测结果；degraded 原因会回传给检索层而不是伪装成无结果。 */
export interface PgVectorCapability {
  mode: PgVectorMode;
  enabled: boolean;
  available: boolean;
  canWrite: boolean;
  extensionVersion: string | null;
  indexKind: "hnsw" | "ivfflat" | "none";
  reason: string | null;
}

/** 由索引 Worker 或受控批处理写入的一条不可变输入指纹。 */
export interface ChunkEmbeddingInput {
  chunkId: string;
  sourceId: string;
  model: string;
  dimensions: number;
  version: string;
  textHash: string;
  vector: number[];
}

/** 数据库相似度查询返回的最小投影，正文仍由上层受限快照映射。 */
export interface PersistedVectorSearchResult {
  chunkId: string;
  sourceId: string;
  similarity: number;
  rank: number;
}

/** 可选向量仓储的稳定契约；未实现或不可用时调用方必须走确定性降级。 */
export interface PgVectorStore {
  getPgVectorCapability(): Promise<PgVectorCapability>;
  upsertChunkEmbeddings(input: ChunkEmbeddingInput[]): Promise<VectorWriteResult>;
  searchSimilarChunks(input: number[], options: VectorSearchOptions): Promise<PersistedVectorSearchResult[]>;
}

export interface VectorWriteResult {
  status: "completed" | "degraded";
  written: number;
  reason: string | null;
}

/** 向量重建 Worker 需要的最小候选；正文哈希由调用方按同一 Contextual 文本规则计算。 */
export interface EmbeddingRebuildCandidate {
  chunkId: string;
  sourceId: string;
  text: string;
  contextualPrefix: string;
  headingPath: string[];
  status: "missing" | "queued" | "ready" | "stale" | "failed";
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  embeddingVersion: string | null;
  embeddingTextHash: string | null;
}

/**
 * 只把缺失、失败、过期或指纹/模型/版本不匹配的 Chunk 交给重建 Worker。
 * 这是纯函数，便于在没有 PostgreSQL/模型凭据的环境验证来源变更检测。
 */
export function planEmbeddingRebuild(
  candidates: EmbeddingRebuildCandidate[],
  expected: { model: string; version: string; dimensions?: number },
): EmbeddingRebuildCandidate[] {
  return candidates.filter((candidate) => {
    const text = `${candidate.contextualPrefix}\n${candidate.headingPath.join(" / ")}\n${candidate.text}`.trim();
    const hash = embeddingInputHash(text);
    return candidate.status !== "ready"
      || candidate.embeddingModel !== expected.model
      || candidate.embeddingVersion !== expected.version
      || (expected.dimensions !== undefined && candidate.embeddingDimensions !== expected.dimensions)
      || candidate.embeddingTextHash !== hash;
  });
}

/** 查询必须携带 scope 与期望文本哈希，防止跨报告或过期向量穿透。 */
export interface VectorSearchOptions {
  reportId?: string;
  sourceIds: string[];
  expectedChunks: Array<{ chunkId: string; textHash: string }>;
  model: string;
  dimensions: number;
  version: string;
  limit: number;
}

/** 读取 pgvector 相关环境变量；未知值 fail closed 为 disabled。 */
export function getPgVectorConfig(environment: Record<string, string | undefined> = process.env): PgVectorConfig {
  const rawMode = environment.PGVECTOR_ENABLED?.trim().toLowerCase() || "auto";
  const mode: PgVectorMode = rawMode === "true" || rawMode === "1" || rawMode === "enabled"
    ? "enabled"
    : rawMode === "false" || rawMode === "0" || rawMode === "disabled"
      ? "disabled"
      : rawMode === "auto"
        ? "auto"
        : "disabled";
  const writeRaw = environment.PGVECTOR_WRITE_ENABLED?.trim().toLowerCase();
  const writeEnabled = mode !== "disabled" && (writeRaw === "true" || writeRaw === "1" || writeRaw === "enabled");
  const configuredVersion = environment.PGVECTOR_EMBEDDING_VERSION?.trim();
  const embeddingVersion = configuredVersion && /^[a-zA-Z0-9._-]{1,64}$/.test(configuredVersion) ? configuredVersion : "v1";
  return { mode, writeEnabled, embeddingVersion };
}

/**
 * 向量输入指纹必须覆盖上下文前缀和正文，而不是只覆盖正文。
 * 任何正文、标题路径或 Contextual Retrieval 前缀改变都会使旧向量失效。
 */
export function embeddingInputHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 将有限浮点数组编码为 pgvector 文本格式；不接受 NaN、Infinity 或空向量。 */
export function toPgVectorLiteral(vector: number[]): string {
  if (vector.length === 0 || vector.length > 32_768 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("Embedding 向量维度或数值无效。");
  }
  return `[${vector.map((value) => Number(value).toString()).join(",")}]`;
}

/** 无扩展、未迁移或查询失败时的统一可审计状态。 */
export function degradedPgVectorCapability(config: PgVectorConfig, reason: string): PgVectorCapability {
  return {
    mode: config.mode,
    enabled: false,
    available: false,
    canWrite: false,
    extensionVersion: null,
    indexKind: "none",
    reason,
  };
}
