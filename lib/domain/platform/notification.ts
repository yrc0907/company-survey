/** 站内通知只承载可公开展示的事件类型；正文和附件仍由目标资源按权限读取。 */
export type NotificationKind =
  | "comment_reply"
  | "comment_mention"
  | "comment_liked"
  | "project_starred"
  | "author_followed"
  | "merge_request_opened"
  | "merge_request_reviewed"
  | "merge_request_merged"
  | "system";

/** 通知列表的安全投影，不返回邮箱、私有正文或完整 payload 原文。 */
export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  actor: { id: string; username: string; displayName: string; avatarAssetId: string | null } | null;
  project: { id: string; slug: string; title: string } | null;
  targetType: "project" | "comment" | "merge_request" | "review" | "author";
  targetId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface ListNotificationsInput { userId: string; limit: number; before?: string; }
export interface NotificationPage { items: NotificationRecord[]; unreadCount: number; nextBefore: string | null; }
