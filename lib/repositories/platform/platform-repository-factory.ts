import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { PostgresPlatformRepository } from "@/lib/repositories/platform/postgres-platform-repository";

let overrideRepository: PlatformRepository | null = null;
let repository: PlatformRepository | null = null;

/** 生产身份功能必须持久化；未配置数据库时明确失败，禁止退化为进程内用户。 */
export function getPlatformRepository(): PlatformRepository {
  if (overrideRepository) return overrideRepository;
  if (repository) return repository;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("开放平台身份功能需要 DATABASE_URL");
  repository = PostgresPlatformRepository.fromConnectionString(connectionString);
  return repository;
}

/** 契约测试注入仓储；测试结束必须传 null，避免污染其他路由用例。 */
export function setPlatformRepositoryForTest(value: PlatformRepository | null): void {
  overrideRepository = value;
}
