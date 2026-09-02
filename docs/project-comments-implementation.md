# 项目级评论实现记录

## 范围

本阶段实现项目级讨论、段落锚点和图片/GIF 附件，不包含通知推送和实时协同编辑。评论正文与附件关系由真实登录用户写入 PostgreSQL；匿名用户只能读取已经发布且公开项目的评论，并通过短期预签名 URL 查看已验证附件。

## 数据与权限

- `db/migrations/015_project_comments.sql` 新增 `project_comment`：`project_id`、`author_user_id`、`parent_id`、正文、幂等键和 `deleted_at`。
- `(project_id, parent_id)` 约束父评论必须属于同一项目；索引按项目、父节点和创建时间读取。
- 删除是软删除：正文清空、`deleted_at` 写入，评论节点和子回复保留，客户端显示“该评论已删除”。
- `GET /api/platform/projects/:id/comments`：无需登录，但只返回 `public + published` 项目。
- `POST /api/platform/projects/:id/comments`：必须有 Auth.js Session；作者从 Session 读取，不能由请求体注入。支持 `parentId` 楼中楼和 `Idempotency-Key` 重试。
- `DELETE /api/platform/projects/:id/comments/:commentId`：作者本人或项目 owner/maintainer 可执行；同时校验 URL 项目 ID 与评论归属。
- 评论 POST 可携带最多 4 个 `attachmentAssetIds`；资产必须由当前 Session 用户拥有、已完成 OSS Head/大小/SHA-256 校验、MIME 为 PNG/JPEG/WebP/GIF，且未越过项目边界。
- `project_comment_attachment` 只保存评论、项目和资产关系，不保存签名 URL；GET 评论时服务层重新签发短期下载地址。删除评论会隐藏附件，原始 OSS 对象仍按不可变证据策略保留。
- 评论幂等指纹包含附件 ID；网络重试只能重放相同正文、锚点和附件集合，换附件会返回冲突而不会静默追加。

评论服务复用现有公开项目授权读取边界，删除角色直接从 `PlatformRepository` 查询，不在评论表复制权限。平台管理员不会因为全局角色自动获得项目内容删除权。

## UI 状态

`ProjectComments` 独立负责加载、空状态、失败/重试、发布中、发布成功、发布失败/重试、删除中和删除失败。评论按 `parentId` 组织，最多递归八层，异常孤儿节点降级到根层。未登录的发布按钮会打开登录入口，不产生写请求。

附件选择后只保留浏览器本地队列；提交评论时按现有 `/api/platform/uploads` → 私有 OSS PUT → `/complete` 三步完成直传，队列逐项显示待上传、上传中进度、已校验和失败状态。失败不会伪造成功，用户可移除失败项后重试；评论列表使用懒加载图片，签名 URL 失效时显示可重试的不可用状态而不暴露 Object Key。

项目公开摘要现在从 PostgreSQL 聚合 `commentCount`（只统计 `deleted_at IS NULL`），首页卡片和详情元信息仅在真实数据库投影提供该字段时显示；typed seed 不填虚构数字。详情页在评论加载、发布和软删除后用服务端返回列表同步更新元信息，不做客户端猜测自增。

## 段落锚点

评论可选携带 `nodeId`、`blockId` 和不超过 2000 字的 `quote`。三者必须成组出现，服务层和迁移 `017_comment_anchors.sql` 会确认节点属于当前项目；不满足条件的请求返回 `400` 或“评论锚点文件不存在”，不会写入跨项目定位。项目级评论仍使用空锚点，楼中楼 `parentId` 语义不变。

项目正文中有真实 `nodeId` 的章节显示“评论此段”，点击后滚动到评论区并带入引用片段；Seed 或无稳定节点的占位章节不显示该按钮，避免产生无法落库的假锚点。

## 验证记录

契约测试：`lib/services/collaboration/project-comments.contract.ts`

- 匿名读取返回 200；
- 登录用户作者取自 Session；
- 父评论和回复保留同一项目边界；
- 相同幂等键不会重复创建；
- 软删除保留子回复；
- 匿名写入返回 401。
- 登录用户可绑定已验证 GIF/图片，匿名 GET 返回短期签名 URL；跨用户、未验证或非图片资产不能绑定。

Playwright 真实交互：`E2E-PROJECT-003` 验证讨论区加载、输入和匿名发布时打开登录门槛；脚本会在 `pnpm test:e2e:platform` 中执行。

已运行：`pnpm typecheck`、`pnpm lint`、`pnpm test`（包含项目评论与附件契约）。
