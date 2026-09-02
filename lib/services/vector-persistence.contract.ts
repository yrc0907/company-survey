import assert from "node:assert/strict";
import type { Sql } from "postgres";

import { PostgresResearchRepository } from "@/lib/providers/research-repository";
import { DenseRetrievalService } from "@/lib/services/dense-retrieval-service";
import {
  embeddingInputHash,
  getPgVectorConfig,
  planEmbeddingRebuild,
  toPgVectorLiteral,
  type ChunkEmbeddingInput,
  type PgVectorStore,
} from "@/lib/services/vector-persistence-service";
import type { SourceChunk } from "@/lib/domain/research";

/**
 * pgvector 可选能力契约：覆盖无扩展降级、特征开关、哈希版本和 SQL 权限过滤。
 * 测试使用假的 SQL，不读取真实数据库或环境密钥。
 */
async function run(): Promise<void> {
  assert.deepEqual(getPgVectorConfig({}), { mode: "auto", writeEnabled: false, embeddingVersion: "v1" });
  assert.equal(getPgVectorConfig({ PGVECTOR_ENABLED: "disabled", PGVECTOR_WRITE_ENABLED: "true" }).writeEnabled, false);
  assert.deepEqual(getPgVectorConfig({ PGVECTOR_ENABLED: "enabled", PGVECTOR_WRITE_ENABLED: "true", PGVECTOR_EMBEDDING_VERSION: "2026.09" }), {
    mode: "enabled", writeEnabled: true, embeddingVersion: "2026.09",
  });
  assert.equal(getPgVectorConfig({ PGVECTOR_ENABLED: "unexpected" }).mode, "disabled", "未知开关必须 fail closed");
  assert.equal(embeddingInputHash("上下文\n正文").length, 64);
  assert.equal(toPgVectorLiteral([0.1, -2, 3]), "[0.1,-2,3]");
  assert.throws(() => toPgVectorLiteral([Number.NaN]), /维度或数值无效/);
  const rebuildCandidate = {
    chunkId: "chunk-a", sourceId: "source-a", text: "正文", contextualPrefix: "文档上下文", headingPath: ["章节"],
    status: "ready" as const, embeddingModel: "test-model", embeddingDimensions: 2, embeddingVersion: "v1",
    embeddingTextHash: embeddingInputHash("文档上下文\n章节\n正文"),
  };
  assert.equal(planEmbeddingRebuild([rebuildCandidate], { model: "test-model", version: "v1", dimensions: 2 }).length, 0);
  assert.equal(planEmbeddingRebuild([{ ...rebuildCandidate, text: "正文已变更" }], { model: "test-model", version: "v1", dimensions: 2 }).length, 1,
    "来源正文变化必须使 ready 向量进入重建计划");

  const noExtensionSql = Object.assign(
    async (_strings: TemplateStringsArray) => [{ extension_version: null, embedding_type: null, index_kind: null }],
    { begin: async () => undefined },
  ) as unknown as Sql;
  const noExtension = new PostgresResearchRepository(noExtensionSql, { PGVECTOR_ENABLED: "auto" });
  const unavailable = await noExtension.getPgVectorCapability();
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.indexKind, "none");
  assert.match(unavailable.reason ?? "", /未安装 pgvector/);

  const statements: Array<{ query: string; parameters: readonly unknown[] }> = [];
  const transaction = Object.assign(
    async (strings: TemplateStringsArray) => {
      const query = strings.join("?").replace(/\s+/g, " ").trim();
      statements.push({ query, parameters: [] });
      return [{ id: "chunk-a" }];
    },
    { array: (values: readonly string[]) => values },
  );
  const vectorSql = Object.assign(
    async (strings: TemplateStringsArray) => [{ extension_version: "0.8.0", embedding_type: "vector", index_kind: "hnsw" }],
    {
      begin: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
      unsafe: async (query: string, parameters: readonly unknown[]) => {
        statements.push({ query: query.replace(/\s+/g, " ").trim(), parameters });
        return [{ chunk_id: "chunk-a", source_id: "source-a", similarity: "0.87" }];
      },
    },
  ) as unknown as Sql;
  const repository = new PostgresResearchRepository(vectorSql, {
    PGVECTOR_ENABLED: "enabled", PGVECTOR_WRITE_ENABLED: "true", PGVECTOR_EMBEDDING_VERSION: "v1",
  });
  const capability = await repository.getPgVectorCapability();
  assert.equal(capability.available, true);
  assert.equal(capability.canWrite, true);
  const input: ChunkEmbeddingInput = {
    chunkId: "chunk-a", sourceId: "source-a", model: "test-model", dimensions: 2, version: "v1",
    textHash: "a".repeat(64), vector: [0.2, 0.8],
  };
  const writeResult = await repository.upsertChunkEmbeddings([input]);
  assert.deepEqual(writeResult, { status: "completed", written: 1, reason: null });
  const rows = await repository.searchSimilarChunks([0.2, 0.8], {
    reportId: "report-a", sourceIds: ["source-a"], expectedChunks: [{ chunkId: "chunk-a", textHash: input.textHash }],
    model: "test-model", dimensions: 2, version: "v1", limit: 8,
  });
  assert.deepEqual(rows, [{ chunkId: "chunk-a", sourceId: "source-a", similarity: 0.87, rank: 1 }]);
  const query = statements.find((item) => item.query.includes("unnest($3::text[], $4::text[])"));
  assert.ok(query, "向量查询必须按 chunkId+textHash 成对过滤");
  assert.match(query!.query, /source_record\.state = 'active'/);
  assert.match(query!.query, /source_record\.report_id = \$5/);
  assert.match(query!.query, /chunk\.source_id = ANY\(\$2::text\[\]\)/);
  assert.deepEqual(query!.parameters.slice(1, 5), [["source-a"], ["chunk-a"], [input.textHash], "report-a"]);

  const readOnly = new PostgresResearchRepository(vectorSql, { PGVECTOR_ENABLED: "enabled", PGVECTOR_WRITE_ENABLED: "false" });
  const readOnlyWrite = await readOnly.upsertChunkEmbeddings([input]);
  assert.equal(readOnlyWrite.status, "degraded", "未打开写入开关不能写向量");

  const chunks: SourceChunk[] = [{
    id: "chunk-a", sourceId: "source-a", parentSectionId: null, headingPath: ["章节"], position: 1, page: null,
    startOffset: 0, endOffset: 2, text: "正文", contextualPrefix: "文档上下文", contentHash: "b".repeat(64),
  }];
  let embedCalls = 0;
  const store: PgVectorStore = {
    getPgVectorCapability: async () => ({ mode: "enabled", enabled: true, available: true, canWrite: false, extensionVersion: "0.8.0", indexKind: "hnsw", reason: null }),
    upsertChunkEmbeddings: async () => ({ status: "completed", written: 0, reason: null }),
    searchSimilarChunks: async (_vector, options) => {
      assert.equal(options.reportId, "report-a");
      assert.equal(options.expectedChunks[0]?.textHash, embeddingInputHash("文档上下文\n章节\n正文"));
      return [{ chunkId: "chunk-a", sourceId: "source-a", similarity: 0.9, rank: 1 }];
    },
  };
  const persistent = new DenseRetrievalService(
    { EMBEDDING_API_KEY: "test-only", PGVECTOR_ENABLED: "enabled" },
    { embed: async () => { embedCalls += 1; return { model: "test-model", dimensions: 2, provider: "remote", vectors: [[1, 0]] }; } },
    48,
    store,
  );
  const dense = await persistent.rank("问题", chunks, { reportId: "report-a" });
  assert.equal(dense.status, "completed");
  assert.equal(dense.ranks.get("chunk-a"), 1);
  assert.equal(embedCalls, 1, "持久化命中只需为查询生成一次向量");

  console.log("vector-persistence contract: passed");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
