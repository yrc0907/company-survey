import assert from "node:assert/strict";

import { MemoryNotificationRepository } from "@/lib/repositories/platform/memory-notification-repository";

/** 通知契约覆盖收件人隔离、游标分页、未读数和幂等已读。 */
async function run(): Promise<void> {
  const repository = new MemoryNotificationRepository();
  const base = { id: "n-1", kind: "comment_reply" as const, actor: null, project: null, targetType: "comment" as const, targetId: "c-1", payload: {}, readAt: null, createdAt: "2026-09-02T12:00:00.000Z" };
  repository.seed({ ...base, recipientUserId: "u-1" });
  repository.seed({ ...base, id: "n-2", targetId: "c-2", createdAt: "2026-09-02T11:00:00.000Z", recipientUserId: "u-1" });
  repository.seed({ ...base, id: "n-3", targetId: "c-3", createdAt: "2026-09-02T10:00:00.000Z", recipientUserId: "u-2" });
  const page = await repository.list({ userId: "u-1", limit: 1 });
  assert.equal(page.items.length, 1); assert.equal(page.unreadCount, 2); assert.ok(page.nextBefore);
  assert.equal((await repository.list({ userId: "u-2", limit: 10 })).items.length, 1, "通知必须按收件人隔离");
  assert.equal(await repository.markRead("u-1", "n-1"), true);
  assert.equal(await repository.markRead("u-1", "n-1"), true, "重复已读请求必须幂等");
  assert.equal((await repository.list({ userId: "u-1", limit: 10 })).unreadCount, 1);
  assert.equal(await repository.markAllRead("u-1"), 1);
  assert.equal((await repository.list({ userId: "u-1", limit: 10 })).unreadCount, 0);
  assert.equal(await repository.markRead("u-1", "n-3"), false, "不能标记其他用户通知");
  console.log("notification repository contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
