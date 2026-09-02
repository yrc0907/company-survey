# 持久化社区场景 seed

`scripts/seed-community.mjs` 为内部验收和面试环境建立一批可回溯的社区场景记录。它不是企业事实资料包：企业名称、产品描述、价格和市场判断仍必须来自 `source`/`source_chunk` 的公开来源，社区互动不能证明真实客户或真实市场热度。

## 写入内容

- 49 个跨城市、行业和角色的 `platform_user`/`platform_profile`。邮箱使用 `.invalid` 保留域名，不具备外部投递能力；头像留空，读取端显示稳定的首字母默认头像。
- 12 个已有公开企业项目分配不同的场景 owner，并补充 maintainer/contributor 成员；原始 `u-yu` owner 会降为 maintainer，分配关系保存于 `community_seed_record`。
- 作者关注、项目 Star、按用户/日期去重阅读、项目级和锚点评论、两级回复、Commit、分支、Merge Request、Review、Merge、段落归因、站内通知。
- `activity_daily` 由 `activity_event` 与 `project_view_daily` 重建，供作者/项目热力图读取；脚本不向前端写静态统计数字。

## 运行

先执行迁移，再运行 seed。脚本只接受服务端 `DATABASE_URL`，没有连接时会失败，不会退回内存假实现：

```bash
pnpm db:migrate
pnpm community-seed
pnpm community-seed -- --check
```

生产 Compose 发布后，runner 镜像会保留 seed 入口；在香港 ECS 上显式执行一次（不要把 seed 作为常驻服务）：

```bash
docker compose --env-file .env run --rm app node scripts/seed-community.mjs
docker compose --env-file .env run --rm app node scripts/seed-community.mjs --check
```

`Dockerfile` 只复制 `seed-community.mjs`，不复制本地环境文件、契约夹具或任何凭据；发布脚本仍先执行备份和迁移。

默认批次为 `community-2026-09-v1`，可用 `--batch <batch>` 或 `COMMUNITY_SEED_BATCH` 指定。实体 ID 稳定、关系有唯一约束，重复运行不会重复增加 Star、关注、阅读或评论计数。静态边界检查：

```bash
pnpm community-seed:contract
```

## 清理与不可变历史

```bash
pnpm community-seed -- --clean
```

清理只退役当前批次的可变关系（Star、关注、阅读、通知）并软删除评论；`knowledge_commit`、`document_revision`、`merge_review` 和 `activity_event` 是 append-only 审计事实，不能物理删除。实体 ID 为稳定幂等键，因此同一数据库应继续使用同一批次重跑；要获得完全干净的新批次，请在隔离数据库恢复备份后再运行，不能只改批次名来掩盖旧历史。

`community_seed_record` 只供运维重建和审计使用，公开 API 不返回 `seed_batch`/`source_kind`，页面按正常用户、项目和互动展示。场景账号没有密码凭据，不能用于外部登录；真实账户仍必须通过注册和邮箱/手机验证流程产生。

## 验收口径

验收至少检查：

1. active 场景用户数量在 40-60 之间，12 个项目均为公开发布状态；
2. `project_reader`/`project_view_daily` 与 `project_stats.unique_readers` 一致；
3. Star/关注的 `(user, target)` 唯一，评论父子关系和锚点项目一致；
4. 每个 Merge Request 都能回跳 source branch、Commit、Review、merged Commit 与 attribution；
5. 通知 recipient、actor、project、target 均存在，`activity_daily` 可由事实表重复重建；
6. 运行两次 `pnpm community-seed` 后，各事实表数量与第一次相同（时间线 append-only 事件不重复创建）。

脚本不输出邮箱、密码、AccessKey、模型 Key 或其他凭据。
