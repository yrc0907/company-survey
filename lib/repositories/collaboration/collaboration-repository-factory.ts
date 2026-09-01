import type { CollaborationRepository } from "@/lib/repositories/collaboration/collaboration-repository";
import { PostgresCollaborationRepository } from "@/lib/repositories/collaboration/postgres-collaboration-repository";

let overrideRepository: CollaborationRepository | null = null;
let repository: CollaborationRepository | null = null;

/** 生产协作功能必须使用 PostgreSQL；仅契约测试允许注入替代仓储。 */
export function getCollaborationRepository(): CollaborationRepository {
  if (overrideRepository) return overrideRepository;
  if (repository) return repository;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("协作平台需要 DATABASE_URL");
  repository = PostgresCollaborationRepository.fromConnectionString(connectionString);
  return repository;
}

/** 只供测试注入，不得在运行时代码中调用。 */
export function setCollaborationRepositoryForTest(value: CollaborationRepository | null): void {
  overrideRepository = value;
}
