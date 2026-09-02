import { getResearchRepository } from "@/lib/providers/repository-factory";
import { SearchSourceRefreshService } from "@/lib/services/search-source-refresh-service";

/**
 * URL 来源刷新 one-shot Worker：只扫描数据库中已有的 URL 来源，不接受 URL/SQL
 * 参数；每次变更生成 needs_review 快照，供维护者人工确认后再进入 active。
 */
async function run(): Promise<void> {
  const repository = getResearchRepository();
  const snapshot = await repository.getSnapshot();
  const max = Math.min(Math.max(Number(process.env.SOURCE_REFRESH_MAX_JOBS ?? 20), 1), 200);
  const candidates = snapshot.sources
    .filter((source) => Boolean(source.url) && source.state === "active")
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id))
    .slice(0, max);
  const service = new SearchSourceRefreshService(repository);
  const results: Array<{ sourceId: string; status: string; reason?: string }> = [];
  for (const source of candidates) {
    try {
      const result = await service.refresh(source.id);
      results.push({ sourceId: source.id, status: result.status });
    } catch (error) {
      // 日志只保留来源 ID 和可读错误，不输出 URL 正文、凭据或响应内容。
      results.push({ sourceId: source.id, status: "failed", reason: error instanceof Error ? error.message : "来源刷新失败" });
    }
  }
  console.log(JSON.stringify({ event: "source_refresh_finished", scanned: candidates.length, results }));
}

void run().then(() => process.exit(0)).catch((error: unknown) => {
  console.error(JSON.stringify({ event: "source_refresh_error", message: error instanceof Error ? error.message : "来源刷新 Worker 失败" }));
  process.exit(1);
});
