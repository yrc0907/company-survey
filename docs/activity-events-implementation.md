# 公开活动时间线

## 范围

`GET /api/platform/projects/:id/activity` 提供公开项目最近活动。只返回 `visibility=public` 且 `status=published` 的项目；匿名可读，未登录不会获得任何额外权限。响应中的 `source=postgres` 表示事件来自数据库追加账本。

## 真实事件来源

迁移 `018_activity_events.sql` 新增 `activity_event`，并用 PostgreSQL `AFTER` 触发器监听项目创建、Commit、MR 创建/合并、Review、评论、Star/取消 Star。事件保存操作者、目标、项目、时间和最小 metadata；活动账本禁止 UPDATE/DELETE。关注作者没有项目归属，因此不会出现在项目活动接口。

## 分层实现

- `lib/repositories/platform/platform-repository.ts`：声明活动事件和分页查询契约。
- `lib/repositories/platform/postgres-platform-repository.ts`：校验公开项目并按 `occurred_at DESC` 读取，过滤已删除/暂停用户。
- `lib/services/platform/public-activity-service.ts`：规范化项目标识、limit 和时间游标；无 PostgreSQL 时拒绝伪造持久活动。
- `app/api/platform/projects/[id]/activity/route.ts`：只负责 HTTP 参数解析和统一错误响应。

## 分页与边界

`limit` 限制为 1-100；`before` 为 ISO 时间游标。事件没有正文，metadata 仅包含标题、分支、父评论 ID、MR 状态等最小导航信息，避免把私有正文带入公开时间线。事件没有时返回空数组；项目不存在或不公开返回 404。

## 验证

`lib/services/platform/public-activity.contract.ts` 覆盖匿名读取边界、非法游标 400、未知项目 404，以及未连接 PostgreSQL 时 409。真实数据库部署后应再验证触发器：创建评论、重复 Star、Commit 和合并各产生一次对应事件，并检查活动账本不可变约束。
