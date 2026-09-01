/**
 * Embedding 与 Reranker Provider 边界。
 * 线上默认走远程 API；本地 BGE-M3 worker 仅是开发机离线回退，不加入云端 Compose。
 */

export type EnvironmentValues = Record<string, string | undefined>;
export type FetchImplementation = typeof fetch;

const DEFAULT_BASE_URL = "https://v2.cloudmist.cloud/v1";
const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2-preview";
const DEFAULT_RERANK_MODEL = "qwen3-rerank";
const DEFAULT_RERANK_FALLBACKS = ["Pro/BAAI/bge-reranker-v2-m3", "BAAI/bge-reranker-v2-m3"];
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_EMBEDDING_INPUTS = 64;
const MAX_RERANK_DOCUMENTS = 80;
const MAX_TEXT_LENGTH = 24_000;

/** 单条 Embedding 结果。维度由运行时响应校验，防止错误模型污染向量索引。 */
export interface EmbeddingResult {
  model: string;
  dimensions: number;
  vectors: number[][];
  provider: "remote" | "local_bge_m3";
}

/** 业务层只能提交受限文本，不能把文件路径、URL 或数据库对象发给 Provider。 */
export interface EmbeddingProvider {
  embed(texts: string[]): Promise<EmbeddingResult>;
}

/** Rerank 返回的 index 始终引用输入 documents 的原始顺序。 */
export interface RerankItem { index: number; score: number; }

/** 降级状态可审计，调用方不能把确定性排序伪装为模型精排。 */
export interface RerankResult {
  status: "completed" | "degraded";
  model: string | null;
  items: RerankItem[];
  reason: string | null;
}

export interface RerankerProvider {
  rerank(query: string, documents: string[], limit?: number): Promise<RerankResult>;
}

export interface RemoteEmbeddingProviderConfig {
  kind: "remote";
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  expectedDimensions: number | null;
  timeoutMs: number;
}

export interface LocalEmbeddingProviderConfig {
  kind: "local_bge_m3";
  workerUrl: string;
  token: string | null;
  model: string;
  timeoutMs: number;
}

export interface UnconfiguredEmbeddingProviderConfig { kind: "none"; reason: string; }
export type EmbeddingProviderConfig = RemoteEmbeddingProviderConfig | LocalEmbeddingProviderConfig | UnconfiguredEmbeddingProviderConfig;

export interface RemoteRerankerProviderConfig {
  kind: "remote";
  apiBaseUrl: string;
  apiKey: string;
  models: string[];
  timeoutMs: number;
}

export interface UnconfiguredRerankerProviderConfig { kind: "none"; reason: string; }
export type RerankerProviderConfig = RemoteRerankerProviderConfig | UnconfiguredRerankerProviderConfig;

/** 限制 timeout 范围，避免环境变量将请求变成无限等待。 */
function parseTimeout(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 && parsed <= 120_000 ? parsed : DEFAULT_TIMEOUT_MS;
}

/** 维度只作为写入向量库前的防错约束；未配置时保留服务返回的真实维度。 */
function parseDimensions(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 32_768 ? parsed : null;
}

/** 组装稳定的 Reranker 回退链，qwen3 始终优先，其余模型可通过环境变量替换。 */
function parseModelChain(primary: string, fallbacks: string | undefined): string[] {
  const configured = (fallbacks ?? DEFAULT_RERANK_FALLBACKS.join(","))
    .split(",").map((item) => item.trim()).filter(Boolean);
  return Array.from(new Set([primary, ...configured]));
}

/**
 * 默认远程 Provider 只有在 API Key 存在时出网。
 * `EMBEDDING_PROVIDER=local_bge_m3` 时只允许调用 loopback 的离线 worker。
 */
export function getEmbeddingProviderConfig(environment: EnvironmentValues = process.env): EmbeddingProviderConfig {
  const kind = environment.EMBEDDING_PROVIDER?.trim().toLowerCase() || "remote";
  const timeoutMs = parseTimeout(environment.EMBEDDING_TIMEOUT_MS);
  if (kind === "local_bge_m3") {
    const workerUrl = environment.LOCAL_BGE_M3_WORKER_URL?.trim() || "http://127.0.0.1:8787";
    try {
      const parsed = new URL(workerUrl);
      if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
        return { kind: "none", reason: "本地 BGE-M3 Worker 地址必须是 loopback 地址。" };
      }
    } catch {
      return { kind: "none", reason: "本地 BGE-M3 Worker 地址无效。" };
    }
    return {
      kind: "local_bge_m3", workerUrl,
      token: environment.LOCAL_BGE_M3_WORKER_TOKEN?.trim() || null,
      model: environment.LOCAL_BGE_M3_MODEL?.trim() || "BAAI/bge-m3", timeoutMs,
    };
  }
  if (kind !== "remote") return { kind: "none", reason: "EMBEDDING_PROVIDER 仅支持 remote 或 local_bge_m3。" };
  const apiKey = environment.EMBEDDING_API_KEY?.trim();
  if (!apiKey) return { kind: "none", reason: "未配置 EMBEDDING_API_KEY，未调用远程 Embedding API。" };
  return {
    kind: "remote", apiBaseUrl: environment.EMBEDDING_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    apiKey, model: environment.EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL,
    expectedDimensions: parseDimensions(environment.EMBEDDING_DIMENSIONS), timeoutMs,
  };
}

/** Reranker 默认复用 EMBEDDING_API_KEY，允许日后独立轮换 RERANK_API_KEY。 */
export function getRerankerProviderConfig(environment: EnvironmentValues = process.env): RerankerProviderConfig {
  if (environment.RERANK_ENABLED?.trim().toLowerCase() === "false") return { kind: "none", reason: "RERANK_ENABLED=false，保留融合排序。" };
  const apiKey = environment.RERANK_API_KEY?.trim() || environment.EMBEDDING_API_KEY?.trim();
  if (!apiKey) return { kind: "none", reason: "未配置 RERANK_API_KEY 或 EMBEDDING_API_KEY，保留融合排序。" };
  return {
    kind: "remote", apiKey,
    apiBaseUrl: environment.RERANK_API_BASE_URL?.trim() || environment.EMBEDDING_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    models: parseModelChain(environment.RERANK_MODEL?.trim() || DEFAULT_RERANK_MODEL, environment.RERANK_FALLBACK_MODELS),
    timeoutMs: parseTimeout(environment.RERANK_TIMEOUT_MS),
  };
}

/** 由可信环境配置拼出固定资源路径，业务层不能传入任意 endpoint。 */
function endpointFor(apiBaseUrl: string, resource: "embeddings" | "rerank"): URL {
  const base = new URL(apiBaseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("Provider 地址协议无效。");
  const path = base.pathname.replace(/\/+$/, "");
  return new URL(`${path.endsWith("/v1") ? path : `${path}/v1`}/${resource}`, base.origin);
}

/** 本地 worker 同样固定为 /v1/embeddings，不能成为 SSRF 转发器。 */
function localWorkerEndpoint(workerUrl: string): URL {
  const base = new URL(workerUrl);
  return new URL(`${base.pathname.replace(/\/+$/, "")}/v1/embeddings`, base.origin);
}

/** 发送前控制文本规模，限制成本、超时和敏感内容暴露范围。 */
function assertEmbeddingTexts(texts: string[]): void {
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_EMBEDDING_INPUTS) throw new Error(`Embedding 输入数量必须在 1 到 ${MAX_EMBEDDING_INPUTS} 之间。`);
  if (texts.some((text) => typeof text !== "string" || !text.trim() || text.length > MAX_TEXT_LENGTH)) throw new Error(`Embedding 单条文本必须非空且不超过 ${MAX_TEXT_LENGTH} 个字符。`);
}

/** Reranker 不接收全部来源快照，只处理前序过滤和融合后的有限候选。 */
function assertRerankInput(query: string, documents: string[]): void {
  if (!query.trim() || query.length > MAX_TEXT_LENGTH) throw new Error("Rerank 查询不能为空且不能过长。");
  if (!Array.isArray(documents) || documents.length === 0 || documents.length > MAX_RERANK_DOCUMENTS) throw new Error(`Rerank 候选数量必须在 1 到 ${MAX_RERANK_DOCUMENTS} 之间。`);
  if (documents.some((document) => !document.trim() || document.length > MAX_TEXT_LENGTH)) throw new Error(`Rerank 单条候选必须非空且不超过 ${MAX_TEXT_LENGTH} 个字符。`);
}

/** 有界网络请求，超时能被上层识别并切换下一个模型。 */
async function fetchWithTimeout(fetchImplementation: FetchImplementation, input: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 解析 OpenAI embeddings 的 data[index].embedding，校验顺序、数值和维度。 */
function parseEmbeddingPayload(payload: unknown, expectedCount: number): { model: string; vectors: number[][] } {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(data) || data.length !== expectedCount) throw new Error("Embedding 返回数量与请求不一致。");
  const sorted = [...data].sort((left, right) => Number((left as { index?: unknown }).index) - Number((right as { index?: unknown }).index));
  const vectors = sorted.map((item, expectedIndex) => {
    const candidate = item as { index?: unknown; embedding?: unknown };
    if (!candidate || Number(candidate.index) !== expectedIndex || !Array.isArray(candidate.embedding) || candidate.embedding.length === 0 || candidate.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("Embedding 向量格式无效。");
    }
    return candidate.embedding;
  });
  const dimensions = vectors[0]!.length;
  if (vectors.some((vector) => vector.length !== dimensions)) throw new Error("Embedding 向量维度不一致。");
  const model = payload && typeof payload === "object" && typeof (payload as { model?: unknown }).model === "string" ? (payload as { model: string }).model : "unknown";
  return { model, vectors };
}

/** 远程 OpenAI-compatible Embedding Provider。 */
export class RemoteEmbeddingProvider implements EmbeddingProvider {
  public constructor(private readonly config: RemoteEmbeddingProviderConfig, private readonly fetchImplementation: FetchImplementation = fetch) {}

  public async embed(texts: string[]): Promise<EmbeddingResult> {
    assertEmbeddingTexts(texts);
    const response = await fetchWithTimeout(this.fetchImplementation, endpointFor(this.config.apiBaseUrl, "embeddings"), {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({ model: this.config.model, input: texts, encoding_format: "float" }),
    }, this.config.timeoutMs);
    if (!response.ok) throw new Error(`远程 Embedding 服务返回 HTTP ${response.status}。`);
    const parsed = parseEmbeddingPayload(await response.json(), texts.length);
    const dimensions = parsed.vectors[0]!.length;
    if (this.config.expectedDimensions !== null && dimensions !== this.config.expectedDimensions) throw new Error(`Embedding 返回 ${dimensions} 维，与配置的 ${this.config.expectedDimensions} 维不一致。`);
    return { model: parsed.model === "unknown" ? this.config.model : parsed.model, dimensions, vectors: parsed.vectors, provider: "remote" };
  }
}

/** 本地 BGE-M3 worker 客户端；worker URL 已在配置阶段限制为 loopback。 */
export class LocalBgeM3EmbeddingProvider implements EmbeddingProvider {
  public constructor(private readonly config: LocalEmbeddingProviderConfig, private readonly fetchImplementation: FetchImplementation = fetch) {}

  public async embed(texts: string[]): Promise<EmbeddingResult> {
    assertEmbeddingTexts(texts);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.token) headers.authorization = `Bearer ${this.config.token}`;
    const response = await fetchWithTimeout(this.fetchImplementation, localWorkerEndpoint(this.config.workerUrl), {
      method: "POST", headers, body: JSON.stringify({ model: this.config.model, input: texts, encoding_format: "float" }),
    }, this.config.timeoutMs);
    if (!response.ok) throw new Error(`本地 BGE-M3 Worker 返回 HTTP ${response.status}。`);
    const parsed = parseEmbeddingPayload(await response.json(), texts.length);
    return { model: parsed.model === "unknown" ? this.config.model : parsed.model, dimensions: parsed.vectors[0]!.length, vectors: parsed.vectors, provider: "local_bge_m3" };
  }
}

/** 未配置时明确拒绝，不伪造向量也不向默认端点发送数据。 */
class UnconfiguredEmbeddingProvider implements EmbeddingProvider {
  public constructor(private readonly reason: string) {}
  public async embed(): Promise<EmbeddingResult> { throw new Error(this.reason); }
}

/** 根据环境创建 provider；Key 仅从进程环境读取，永不序列化给前端。 */
export function getEmbeddingProvider(environment: EnvironmentValues = process.env): EmbeddingProvider {
  const config = getEmbeddingProviderConfig(environment);
  if (config.kind === "remote") return new RemoteEmbeddingProvider(config);
  if (config.kind === "local_bge_m3") return new LocalBgeM3EmbeddingProvider(config);
  return new UnconfiguredEmbeddingProvider(config.reason);
}

/** 兼容 Cloudmist `/rerank` 的 results 或 data 格式，拒绝越界或重复 index。 */
function parseRerankPayload(payload: unknown, documentCount: number, limit: number): RerankItem[] {
  const rawItems = payload && typeof payload === "object" ? (payload as { results?: unknown; data?: unknown }).results ?? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("Rerank 未返回结果。");
  const seen = new Set<number>();
  const items = rawItems.map((item) => {
    const candidate = item as { index?: unknown; relevance_score?: unknown; score?: unknown };
    const index = Number(candidate.index);
    const score = Number(candidate.relevance_score ?? candidate.score);
    if (!Number.isInteger(index) || index < 0 || index >= documentCount || !Number.isFinite(score) || seen.has(index)) throw new Error("Rerank 返回的索引或分数无效。");
    seen.add(index);
    return { index, score };
  });
  return items.sort((left, right) => right.score - left.score || left.index - right.index).slice(0, limit);
}

/** 明确保留 FTS/RRF/元数据的原有顺序，不生成虚构的模型相关性分数。 */
export class DeterministicRerankerProvider implements RerankerProvider {
  public constructor(private readonly reason: string) {}
  public async rerank(query: string, documents: string[], limit = documents.length): Promise<RerankResult> {
    assertRerankInput(query, documents);
    const boundedLimit = Math.min(Math.max(limit, 1), documents.length);
    return { status: "degraded", model: null, items: documents.slice(0, boundedLimit).map((_, index) => ({ index, score: 0 })), reason: this.reason };
  }
}

/** 按 qwen3 -> Pro/BAAI -> BAAI 顺序精排；429、超时、5xx、格式错误会继续尝试下一个。 */
export class RemoteRerankerProvider implements RerankerProvider {
  public constructor(private readonly config: RemoteRerankerProviderConfig, private readonly fetchImplementation: FetchImplementation = fetch) {}

  public async rerank(query: string, documents: string[], limit = documents.length): Promise<RerankResult> {
    assertRerankInput(query, documents);
    const boundedLimit = Math.min(Math.max(limit, 1), documents.length);
    const failures: string[] = [];
    for (const model of this.config.models) {
      try {
        const response = await fetchWithTimeout(this.fetchImplementation, endpointFor(this.config.apiBaseUrl, "rerank"), {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
          body: JSON.stringify({ model, query, documents, top_n: boundedLimit }),
        }, this.config.timeoutMs);
        if (response.ok) return { status: "completed", model, items: parseRerankPayload(await response.json(), documents.length, boundedLimit), reason: null };
        if (response.status === 401 || response.status === 403) return new DeterministicRerankerProvider("Reranker 鉴权失败，保留融合排序。").rerank(query, documents, boundedLimit);
        failures.push(`${model}:HTTP${response.status}`);
      } catch (error) {
        failures.push(`${model}:${error instanceof Error ? error.name : "request_error"}`);
      }
    }
    return new DeterministicRerankerProvider(`远程 Reranker 不可用（${failures.join(";")}），保留融合排序。`).rerank(query, documents, boundedLimit);
  }
}

/** 未配置或所有远程模型失败时同样返回确定性降级实现。 */
export function getRerankerProvider(environment: EnvironmentValues = process.env): RerankerProvider {
  const config = getRerankerProviderConfig(environment);
  return config.kind === "remote" ? new RemoteRerankerProvider(config) : new DeterministicRerankerProvider(config.reason);
}
