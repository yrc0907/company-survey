# 作者主页与关注垂直切片

## 范围

本切片把项目卡片上的 owner 变成真实可访问的作者主页，并提供真实用户关注关系。公开主页只展示 `platform_user.status = active` 的资料和 `knowledge_project.visibility = public AND status = published` 的项目；邮箱、权限、私有项目、草稿分支和会话永远不进入响应。

## 数据与一致性

- `db/migrations/014_author_follows.sql` 新增 `author_follow`。
- `(follower_user_id, followed_user_id)` 主键保证重复点击不会产生重复关系。
- `CHECK (follower_user_id <> followed_user_id)` 与服务层双重禁止自关注。
- 取消关注采用 `active = false`，保留创建/更新时间线；公开 follower 计数只统计 active 且仍为 active 的 follower。
- 关注切换在 PostgreSQL 事务中完成，响应中的 `followerCount` 从同一事务重新聚合，避免并发点击显示旧数字。
- 内存仓储只供契约测试，接口和幂等语义与 PostgreSQL 保持一致；没有数据库时主页可读但关注写入返回 `PERSISTENCE_REQUIRED`，不伪造成功。

## API

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/platform/authors/:username` | 匿名可读 | 作者资料、关注/粉丝数、公开项目列表；当前登录用户额外获得 `followedByCurrentUser` |
| GET | `/api/platform/authors/:username/follow` | 匿名可读 | 返回 `following` 与 `followerCount` |
| POST | `/api/platform/authors/:username/follow` | 必须登录 | 关注作者；请求体只能是 `{}` |
| DELETE | `/api/platform/authors/:username/follow` | 必须登录 | 幂等取消关注；请求体只能是 `{}` |

`/api/platform/users/:username` 及其 `/follow` 是同一实现的兼容别名。用户身份只来自签名 Auth.js Session，不能从请求体注入。

## UI 交互

- `/u/:username` 是 GitHub 风格作者主页，`/author/:username` 为兼容地址。
- 项目卡片 owner 头像/名称点击进入作者主页；主页项目卡片点击回到 `/?project=:id` 详情。
- 主页包含默认头像、显示名、用户名、简介、加入时间、公开项目数、关注者数、正在关注数。
- 关注按钮具有读取中、提交中、成功、失败/重试状态；匿名点击打开真实登录门槛。
- 主页首屏、项目列表和失败页面均有骨架屏或明确错误/重试反馈，支持键盘焦点和 Reduced Motion。

## 验证记录

契约脚本：`pnpm exec tsx lib/services/platform/author.contract.ts`

覆盖匿名主页读取、空项目作者、项目列表、匿名关注状态、未登录写入拒绝、登录关注、重复关注幂等、主页状态回显、重复取消和自关注拒绝。执行结果：`author follow contract: passed`；同时通过 `pnpm typecheck` 与 `pnpm lint`。

