import assert from "node:assert/strict";

import {
  getEmbeddingProviderConfig,
  getRerankerProviderConfig,
  LocalBgeM3EmbeddingProvider,
  RemoteEmbeddingProvider,
  RemoteRerankerProvider,
  type FetchImplementation,
} from "@/lib/providers/embedding-provider";
import type { SourceChunk } from "@/lib/domain/research";
import { DenseRetrievalService } from "@/lib/services/dense-retrieval-service";

/** 构造无网络的响应式 fetch，契约测试不会读取环境真实 Key 或调用任何第三方。 */
function responseFetch(responses: Array<Response | Error>, requests: Array<{ url: string; init: RequestInit }>): FetchImplementation {
  return async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("测试响应不足");
    if (next instanceof Error) throw next;
    return next;
  };
}

async function run(): Promise<void> {
  const unconfigured = getEmbeddingProviderConfig({ EMBEDDING_PROVIDER: "remote" });
  assert.equal(unconfigured.kind, "none", "没有 Key 时 Embedding Provider 不能默认出网");
  const unsafeLocal = getEmbeddingProviderConfig({ EMBEDDING_PROVIDER: "local_bge_m3", LOCAL_BGE_M3_WORKER_URL: "https://example.com" });
  assert.equal(unsafeLocal.kind, "none", "本地 BGE worker 只能是 loopback 地址");

  const embeddingRequests: Array<{ url: string; init: RequestInit }> = [];
  const embeddingProvider = new RemoteEmbeddingProvider({
    kind: "remote", apiBaseUrl: "https://embedding.test/v1", apiKey: "test-only", model: "gemini-embedding-2-preview", expectedDimensions: 2, timeoutMs: 1_000,
  }, responseFetch([
    new Response(JSON.stringify({ model: "gemini-embedding-2-preview", data: [
      { index: 1, embedding: [0.2, 0.3] }, { index: 0, embedding: [0.1, 0.4] },
    ] }), { status: 200, headers: { "content-type": "application/json" } }),
  ], embeddingRequests));
  const embedding = await embeddingProvider.embed(["第一段", "第二段"]);
  assert.equal(embedding.dimensions, 2, "Embedding 必须暴露实际维度");
  assert.deepEqual(embedding.vectors[0], [0.1, 0.4], "Embedding 必须按 data.index 还原输入顺序");
  assert.equal(embeddingRequests[0]?.url, "https://embedding.test/v1/embeddings", "远程 Provider 只能调用固定 embeddings endpoint");

  const rerankRequests: Array<{ url: string; init: RequestInit }> = [];
  const reranker = new RemoteRerankerProvider({
    kind: "remote", apiBaseUrl: "https://embedding.test/v1", apiKey: "test-only",
    models: ["qwen3-rerank", "Pro/BAAI/bge-reranker-v2-m3", "BAAI/bge-reranker-v2-m3"], timeoutMs: 1_000,
  }, responseFetch([
    new Response(JSON.stringify({ error: "rate limit" }), { status: 429 }),
    new Response(JSON.stringify({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.2 }] }), { status: 200, headers: { "content-type": "application/json" } }),
  ], rerankRequests));
  const ranked = await reranker.rerank("查询", ["第一段", "第二段"]);
  assert.equal(ranked.status, "completed", "回退模型成功时应返回 completed");
  assert.equal(ranked.model, "Pro/BAAI/bge-reranker-v2-m3", "429 后必须按顺序切换第一个 BGE Reranker");
  assert.equal(rerankRequests.length, 2, "429 不应直接失败或伪造排序");

  const allFailed = new RemoteRerankerProvider({
    kind: "remote", apiBaseUrl: "https://embedding.test/v1", apiKey: "test-only", models: ["qwen3-rerank", "Pro/BAAI/bge-reranker-v2-m3"], timeoutMs: 1_000,
  }, responseFetch([new Error("timeout"), new Response("", { status: 503 })], []));
  const degraded = await allFailed.rerank("查询", ["原排序一", "原排序二"]);
  assert.equal(degraded.status, "degraded", "所有 Reranker 失败必须标记 degraded");
  assert.deepEqual(degraded.items.map((item) => item.index), [0, 1], "降级必须保留调用方原始融合顺序");

  const localRequests: Array<{ url: string; init: RequestInit }> = [];
  const local = new LocalBgeM3EmbeddingProvider({
    kind: "local_bge_m3", workerUrl: "http://127.0.0.1:8787", token: "local-test-token", model: "BAAI/bge-m3", timeoutMs: 1_000,
  }, responseFetch([new Response(JSON.stringify({ model: "BAAI/bge-m3", data: [{ index: 0, embedding: [0.5, 0.6] }] }), { status: 200 })], localRequests));
  await local.embed(["本地离线文本"]);
  assert.equal(localRequests[0]?.url, "http://127.0.0.1:8787/v1/embeddings", "本地 Provider 只能调用固定 loopback endpoint");
  assert.equal((localRequests[0]?.init.headers as Record<string, string>).authorization, "Bearer local-test-token", "本地可选 Token 必须以 Bearer 发送");

  const rerankConfig = getRerankerProviderConfig({ EMBEDDING_API_KEY: "test-only" });
  assert.equal(rerankConfig.kind, "remote", "Reranker 可复用 Embedding 环境 Key，避免重复配置");
  if (rerankConfig.kind === "remote") assert.deepEqual(rerankConfig.models, ["qwen3-rerank", "Pro/BAAI/bge-reranker-v2-m3", "BAAI/bge-reranker-v2-m3"]);

  const chunks: SourceChunk[] = [
    { id: "chunk-a", sourceId: "source", parentSectionId: null, headingPath: ["政策"], position: 1, page: null, startOffset: 0, endOffset: 2, text: "电商履约", contextualPrefix: "企业研究", contentHash: "a" },
    { id: "chunk-b", sourceId: "source", parentSectionId: null, headingPath: ["政策"], position: 2, page: null, startOffset: 0, endOffset: 2, text: "跨境物流", contextualPrefix: "企业研究", contentHash: "b" },
  ];
  const dense = new DenseRetrievalService(
    { EMBEDDING_API_KEY: "test-only", EMBEDDING_MODEL: "dense-test" },
    {
      embed: async () => ({ model: "dense-test", dimensions: 2, provider: "remote", vectors: [[1, 0], [0.1, 0.9], [0.9, 0.1]] }),
    },
    2,
  );
  const denseRanked = await dense.rank("跨境问题", chunks);
  assert.equal(denseRanked.status, "completed", "可用 Embedding 应产生可测 Dense 排名");
  assert.equal(denseRanked.ranks.get("chunk-b"), 1, "Dense 结果必须按余弦相似度排序");
  const denseCapped = await new DenseRetrievalService(
    { EMBEDDING_API_KEY: "test-only" },
    { embed: async () => { throw new Error("超过上限时不应调用 Provider"); } },
    1,
  ).rank("跨境问题", chunks);
  assert.equal(denseCapped.status, "degraded", "超过安全上限必须明确降级而非发送全量语料");

  console.log("embedding-provider contract: passed");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
