import { PersistenceRequiredError } from "@/lib/domain/errors";
import type { KnowledgeTaskRepository } from "@/lib/repositories/agents/knowledge-task-repository";
import { PostgresKnowledgeTaskRepository } from "@/lib/repositories/agents/postgres-knowledge-task-repository";

let repository: KnowledgeTaskRepository | null = null;

/** 返回生产任务仓储；任务不能在无数据库时伪装成持久化成功。 */
export function getKnowledgeTaskRepository(): KnowledgeTaskRepository {
  if (repository) return repository;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new PersistenceRequiredError("未配置 PostgreSQL；Multi-Agent 任务不能伪装成已保存。");
  repository = PostgresKnowledgeTaskRepository.fromConnectionString(connectionString);
  return repository;
}

/** 契约测试注入仓储；传 null 恢复生产选择。 */
export function setKnowledgeTaskRepositoryForTest(next: KnowledgeTaskRepository | null): void {
  repository = next;
}
