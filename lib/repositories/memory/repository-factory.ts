import { PersistenceRequiredError } from "@/lib/domain/errors";
import type { MemoryRepository } from "@/lib/repositories/memory/memory-repository";
import { PostgresMemoryRepository } from "@/lib/repositories/memory/postgres-memory-repository";

let repository: MemoryRepository | null = null;

/** 返回生产记忆仓储；没有 DATABASE_URL 时拒绝持久化，不使用跨请求失效的内存假实现。 */
export function getMemoryRepository(): MemoryRepository {
  if (repository) return repository;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new PersistenceRequiredError("未配置 PostgreSQL；AI 会话和记忆不能伪装成已保存。");
  repository = PostgresMemoryRepository.fromConnectionString(connectionString);
  return repository;
}

/** 契约测试和应用组合根可注入同接口仓储；传 null 恢复生产选择。 */
export function setMemoryRepositoryForTest(next: MemoryRepository | null): void {
  repository = next;
}

