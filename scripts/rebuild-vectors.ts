import { getEmbeddingProvider, getEmbeddingProviderConfig } from "@/lib/providers/embedding-provider";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { embeddingInputHash, getPgVectorConfig, planEmbeddingRebuild, type EmbeddingRebuildCandidate } from "@/lib/services/vector-persistence-service";
import type { PostgresResearchRepository } from "@/lib/providers/research-repository";

/**
 * 一次性向量重建 Worker：只处理 active 来源，按文本哈希/模型/版本识别 stale，
 * 写入失败即退出并保留原状态，不把失败伪装成 ready。默认最多处理 64 个 Chunk。
 */
async function run(): Promise<void> {
  const config = getPgVectorConfig(process.env);
  if (config.mode === "disabled" || !config.writeEnabled) {
    console.log(JSON.stringify({ event: "vector_rebuild_skipped", reason: "PGVECTOR_ENABLED/PGVECTOR_WRITE_ENABLED 未开启。" }));
    return;
  }
  const providerConfig = getEmbeddingProviderConfig(process.env);
  if (providerConfig.kind === "none") throw new Error(providerConfig.reason);
  const repository = getResearchRepository() as PostgresResearchRepository;
  if (!repository.listEmbeddingRebuildCandidates || !repository.upsertChunkEmbeddings) {
    throw new Error("当前仓储不支持向量重建。");
  }
  const limit = Math.min(Math.max(Number(process.env.VECTOR_REBUILD_MAX_CHUNKS ?? 64), 1), 500);
  const reportId = process.env.VECTOR_REBUILD_REPORT_ID?.trim() || undefined;
  const candidates = await repository.listEmbeddingRebuildCandidates({ reportId, limit });
  const expectedModel = providerConfig.model;
  const planned = planEmbeddingRebuild(candidates, { model: expectedModel, version: config.embeddingVersion });
  if (planned.length === 0) {
    console.log(JSON.stringify({ event: "vector_rebuild_idle", scanned: candidates.length, planned: 0 }));
    return;
  }
  const batchSize = Math.min(Math.max(Math.trunc(Number(process.env.VECTOR_REBUILD_BATCH_SIZE ?? 16) || 16), 1), 32);
  let written = 0;
  for (let offset = 0; offset < planned.length; offset += batchSize) {
    const batch = planned.slice(offset, offset + batchSize);
    const embedded = await getEmbeddingProvider(process.env).embed(batch.map(contextualText));
    const inputs = batch.map((candidate, index) => ({
      chunkId: candidate.chunkId,
      sourceId: candidate.sourceId,
      model: embedded.model,
      dimensions: embedded.dimensions,
      version: config.embeddingVersion,
      textHash: embeddingInputHash(contextualText(candidate)),
      vector: embedded.vectors[index]!,
    }));
    const result = await repository.upsertChunkEmbeddings(inputs);
    if (result.status === "degraded") throw new Error(result.reason ?? "向量写入降级。");
    written += result.written;
  }
  console.log(JSON.stringify({ event: "vector_rebuild_finished", scanned: candidates.length, planned: planned.length, written }));
}

function contextualText(candidate: EmbeddingRebuildCandidate): string {
  return `${candidate.contextualPrefix}\n${candidate.headingPath.join(" / ")}\n${candidate.text}`.trim();
}

void run().then(() => process.exit(0)).catch((error: unknown) => {
  console.error(JSON.stringify({ event: "vector_rebuild_error", message: error instanceof Error ? error.message : "向量重建失败。" }));
  process.exit(1);
});
