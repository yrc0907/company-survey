import { randomUUID } from "node:crypto";

import { AssetIngestionService } from "@/lib/services/assets/asset-ingestion-service";
import { getAssetsOssProvider } from "@/lib/services/assets/oss-provider-factory";
import { getAssetsRepository } from "@/lib/repositories/assets";

/**
 * 解析 Worker 可运行入口：默认处理一个任务；`ASSET_INGESTION_DRAIN=true` 时持续处理有限批次。
 * 该脚本只读取私有 OSS 和 PostgreSQL，不接受文件路径、URL 或 SQL 参数，避免扩大数据访问面。
 */
async function run(): Promise<void> {
  const repository = getAssetsRepository();
  const oss = await getAssetsOssProvider();
  const workerId = process.env.ASSET_INGESTION_WORKER_ID?.trim() || `asset-worker-${randomUUID()}`;
  const drain = process.env.ASSET_INGESTION_DRAIN === "true";
  const maxJobs = Math.min(Math.max(Number(process.env.ASSET_INGESTION_MAX_JOBS ?? (drain ? 100 : 1)), 1), 1_000);
  const service = new AssetIngestionService(repository, { readObject: (objectKey, maxBytes) => oss.readObject(objectKey, maxBytes) });
  let processed = 0;
  for (; processed < maxJobs; processed += 1) {
    const result = await service.processNext(workerId);
    if (!result) break;
    console.log(JSON.stringify({ event: "asset_ingestion_finished", assetId: result.asset.id, jobId: result.job.id, status: result.job.status, parser: result.outcome.metadata.parser }));
    if (!drain) break;
  }
  console.log(JSON.stringify({ event: "asset_ingestion_idle", workerId, processed }));
  const close = (repository as unknown as { end?: () => Promise<void> }).end;
  if (close) await close.call(repository);
}

void run().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "asset_ingestion_error", code: error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "WORKER_FAILED", message: error instanceof Error ? error.message : "解析 Worker 失败" }));
  process.exitCode = 1;
});
