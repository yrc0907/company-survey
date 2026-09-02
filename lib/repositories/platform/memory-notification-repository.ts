import type { NotificationRecord, ListNotificationsInput, NotificationPage } from "@/lib/domain/platform/notification";
import type { NotificationRepository } from "@/lib/repositories/platform/notification-repository";

/** 契约测试通知仓储；按收件人筛选并复刻游标/幂等已读语义。 */
export class MemoryNotificationRepository implements NotificationRepository {
  private readonly records: Array<NotificationRecord & { recipientUserId: string }> = [];
  public seed(record: NotificationRecord & { recipientUserId: string }): void { this.records.push(structuredClone(record)); }
  public async list(input: ListNotificationsInput): Promise<NotificationPage> {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit)));
    const sorted = this.records.filter((item) => item.recipientUserId === input.userId && (!input.before || Date.parse(item.createdAt) < Date.parse(input.before))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    const page = sorted.slice(0, limit);
    return { items: structuredClone(page), unreadCount: this.records.filter((item) => item.recipientUserId === input.userId && !item.readAt).length, nextBefore: sorted.length > limit ? page.at(-1)!.createdAt : null };
  }
  public async markRead(userId: string, notificationId: string): Promise<boolean> { const item = this.records.find((record) => record.recipientUserId === userId && record.id === notificationId); if (!item) return false; item.readAt ??= new Date().toISOString(); return true; }
  public async markAllRead(userId: string): Promise<number> { let count = 0; for (const item of this.records) if (item.recipientUserId === userId && !item.readAt) { item.readAt = new Date().toISOString(); count += 1; } return count; }
}
