import type { NotificationRepository } from "@/lib/repositories/platform/notification-repository";
import { PostgresNotificationRepository } from "@/lib/repositories/platform/postgres-notification-repository";

let repository: NotificationRepository | null = null;
/** 生产通知必须持久化到 PostgreSQL；未配置数据库时 fail closed。 */
export function getNotificationRepository(): NotificationRepository {
  if (repository) return repository;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("通知功能需要 DATABASE_URL");
  repository = PostgresNotificationRepository.fromConnectionString(connectionString);
  return repository;
}
