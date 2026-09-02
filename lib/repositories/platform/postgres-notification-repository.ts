import postgres, { type Sql } from "postgres";

import type { NotificationRecord, ListNotificationsInput, NotificationPage } from "@/lib/domain/platform/notification";
import type { NotificationRepository } from "@/lib/repositories/platform/notification-repository";

type Row = Record<string, unknown>;
function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
function parsePayload(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function map(row: Row): NotificationRecord {
  return {
    id: String(row.id), kind: row.kind as NotificationRecord["kind"],
    actor: row.actor_id ? { id: String(row.actor_id), username: String(row.actor_username), displayName: String(row.actor_display_name), avatarAssetId: row.actor_avatar ? String(row.actor_avatar) : null } : null,
    project: row.project_id ? { id: String(row.project_id), slug: String(row.project_slug), title: String(row.project_title) } : null,
    targetType: row.target_type as NotificationRecord["targetType"], targetId: String(row.target_id), payload: parsePayload(row.payload),
    readAt: row.read_at ? iso(row.read_at) : null, createdAt: iso(row.created_at),
  };
}

/** PostgreSQL 通知仓储：列表和写入标记均以收件人约束，支持稳定游标分页。 */
export class PostgresNotificationRepository implements NotificationRepository {
  public constructor(private readonly sql: Sql) {}
  public static fromConnectionString(connectionString: string): PostgresNotificationRepository { return new PostgresNotificationRepository(postgres(connectionString, { max: 3, idle_timeout: 20 })); }

  public async list(input: ListNotificationsInput): Promise<NotificationPage> {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
    const rows = await this.sql<Row[]>`SELECT n.id, n.kind, n.target_type, n.target_id, n.payload, n.read_at, n.created_at,
        actor.id AS actor_id, actor_profile.username AS actor_username, actor_profile.display_name AS actor_display_name, actor_profile.avatar_asset_id AS actor_avatar,
        project.id AS project_id, project.slug AS project_slug, project.title AS project_title
      FROM platform_notification n
      LEFT JOIN platform_user actor ON actor.id = n.actor_user_id AND actor.status = 'active'
      LEFT JOIN platform_profile actor_profile ON actor_profile.user_id = actor.id
      LEFT JOIN knowledge_project project ON project.id = n.project_id
      WHERE n.recipient_user_id = ${input.userId}
        AND (${input.before ?? null}::timestamptz IS NULL OR n.created_at < ${input.before ?? null}::timestamptz)
      ORDER BY n.created_at DESC, n.id DESC LIMIT ${limit + 1}`;
    const hasNext = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const unreadRows = await this.sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM platform_notification WHERE recipient_user_id = ${input.userId} AND read_at IS NULL`;
    return { items: pageRows.map(map), unreadCount: Number(unreadRows[0]?.count ?? 0), nextBefore: hasNext ? iso(pageRows.at(-1)!.created_at) : null };
  }

  public async markRead(userId: string, notificationId: string): Promise<boolean> {
    const result = await this.sql`UPDATE platform_notification SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ${notificationId} AND recipient_user_id = ${userId}`;
    return result.count > 0;
  }

  public async markAllRead(userId: string): Promise<number> {
    const result = await this.sql`UPDATE platform_notification SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = ${userId} AND read_at IS NULL`;
    return result.count;
  }
}
