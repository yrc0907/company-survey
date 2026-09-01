import type { AssetRepository } from "@/lib/repositories/assets/assets-repository";
import { MemoryAssetsRepository } from "@/lib/repositories/assets/memory-assets-repository";
import { PostgresAssetsRepository } from "@/lib/repositories/assets/postgres-assets-repository";

let repository: AssetRepository | null = null;
let overrideRepository: AssetRepository | null = null;

/** 生产上传必须持久化；内存仓储仅可由契约测试注入。 */
export function getAssetsRepository(): AssetRepository {
  if (overrideRepository) return overrideRepository;
  if (repository) return repository;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("上传功能需要 DATABASE_URL");
  repository = PostgresAssetsRepository.fromConnectionString(url);
  return repository;
}
export function setAssetsRepositoryForTest(value: AssetRepository | null): void { overrideRepository = value; }
export { MemoryAssetsRepository, PostgresAssetsRepository };
