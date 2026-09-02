import type { ListNotificationsInput, NotificationPage } from "@/lib/domain/platform/notification";

/** 通知仓储边界；实现必须按 recipient_user_id 过滤，不能从请求体接收收件人。 */
export interface NotificationRepository {
  list(input: ListNotificationsInput): Promise<NotificationPage>;
  markRead(userId: string, notificationId: string): Promise<boolean>;
  markAllRead(userId: string): Promise<number>;
}
