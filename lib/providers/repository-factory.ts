import type { ResearchRepository } from "@/lib/providers/research-repository";
import { MemoryResearchRepository, PostgresResearchRepository } from "@/lib/providers/research-repository";
import { createDemoSnapshot } from "@/lib/providers/seed";

/** 进程级仓储单例；本地未配置数据库时仅提供可明确识别的演示内存数据。 */
let repository: ResearchRepository | null = null;

/**
 * 返回当前运行环境的仓储实现。
 * 有 DATABASE_URL 时连接 PostgreSQL；否则使用仅进程内有效的演示仓储，不伪装成持久化。
 */
export function getResearchRepository(): ResearchRepository {
  if (repository) return repository;

  const databaseUrl = process.env.DATABASE_URL?.trim();
  repository = databaseUrl
    ? PostgresResearchRepository.fromConnectionString(databaseUrl)
    : new MemoryResearchRepository(createDemoSnapshot);
  return repository;
}

/** 当前是否真正启用了持久化数据库，供健康检查和 UI 告知用户数据边界。 */
export function isPostgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/** 执行仓储真实健康检查；PostgreSQL 配置存在但不可连接时必须返回失败。 */
export async function getResearchRepositoryHealth(): Promise<{ ok: boolean; persistence: "memory_demo" | "postgres" }> {
  return getResearchRepository().health();
}

/** 测试或集成环境可替换全局仓储；生产代码不应暴露任意数据访问入口。 */
export function setResearchRepositoryForTest(nextRepository: ResearchRepository | null): void {
  repository = nextRepository;
}
