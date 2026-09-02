import type { VerificationRepository } from "@/lib/repositories/auth/verification-repository";
import { PostgresVerificationRepository } from "@/lib/repositories/auth/postgres-verification-repository";

let repository: VerificationRepository | null = null;
let overrideRepository: VerificationRepository | null = null;

/** 生产验证码必须使用 PostgreSQL；测试可注入内存实现，避免把验证码写入进程状态。 */
export function getVerificationRepository(): VerificationRepository {
  if (overrideRepository) return overrideRepository;
  if (repository) return repository;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("验证码服务需要 DATABASE_URL");
  repository = PostgresVerificationRepository.fromConnectionString(connectionString);
  return repository;
}

/** 契约测试注入仓储；生产代码不调用此方法。 */
export function setVerificationRepositoryForTest(value: VerificationRepository | null): void {
  overrideRepository = value;
}
