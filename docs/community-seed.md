# 五家冻结企业的社区场景 seed

`scripts/seed-community.mjs` 只服务于五家冻结企业：慧策掌上先机、泛微网络、深信服、信锐科技和牧原食品。它不是企业资料包，企业名称、产品、价格、财务和市场判断仍必须来自 `source`/`source_chunk` 的公开来源，社区行为不能证明真实客户或真实市场热度。

## 真实账号边界

脚本不创建 `platform_user`、`platform_profile`、密码、邮箱或头像。它只读取已经通过正式注册流程产生的 active 账号：

- 默认读取所有 active 账号，并排除历史 `community-user-*` 与 `@community.research.invalid` 账号；
- 也可以用 `COMMUNITY_SEED_USER_IDS=id1,id2,id3` 显式指定参与账号；
- 至少需要三个不同的真实 active 账号，分别承担维护者、贡献者和审核者，账号不足时直接失败，不会创建虚构用户；
- 不写入账号的姓名、城市、行业或简介；已有头像为空时，页面沿用稳定的首字母默认头像。

脚本写入的评论、Star、关注、阅读和协作记录属于可回溯的内部场景批次，不能对外宣称为真实市场活跃度。页面统计仍只从 PostgreSQL 事实和 `activity_event` 聚合读取。

## 写入范围

- 五个公开项目的真实 owner/member 关系（不改变项目 owner）；
- 作者关注、项目 Star、按用户/日期去重阅读；
- 项目级/段落锚点评论和两级回复；
- Commit、贡献分支、Merge Request、Review、Merge、内容归因；
- 站内通知和 `activity_daily` 热力图日投影；
- `community_seed_record` 内部索引，便于审计、重建和清理。

## 运行

先完成公开范围迁移和备份，再执行：

```bash
pnpm db:migrate
COMMUNITY_SEED_USER_IDS=u-yu,real-user-2,real-user-3 pnpm community-seed
COMMUNITY_SEED_USER_IDS=u-yu,real-user-2,real-user-3 pnpm community-seed -- --check
```

未设置 `COMMUNITY_SEED_USER_IDS` 时，脚本自动选择数据库中所有 active 的非 synthetic 账号；生产环境建议显式指定，避免把未参与场景的账号加入成员或互动关系。runner 镜像包含入口，可在香港 ECS 上使用：

```bash
docker compose --env-file .env run --rm app node scripts/seed-community.mjs
docker compose --env-file .env run --rm app node scripts/seed-community.mjs --check
```

默认批次为 `community-2026-09-five-v1`；可用 `--batch <batch>` 或 `COMMUNITY_SEED_BATCH` 指定，但同一数据库建议沿用同一批次以保持稳定幂等 ID。

静态校验：

```bash
pnpm community-seed:contract
```

## 可回滚清理

发布前先执行 `scripts/backup.sh`，再清理当前批次：

```bash
docker compose --env-file .env run --rm app node scripts/seed-community.mjs --clean --batch community-2026-09-five-v1
```

清理会取消本批次的 Star、关注和阅读，删除本批次通知，软删除评论，并关闭未合并的协作分支/MR；`knowledge_commit`、`document_revision`、`merge_review`、`content_attribution` 和 `activity_event` 是 append-only 审计事实，不能物理删除。清理后可从备份恢复，或用同一批次 ID 重跑（实体 ID 稳定，重跑不会重复计数）。

历史版本若曾存在 `community-user-*` synthetic 账号，不能通过当前 seed 重新激活或参与互动。完成 PostgreSQL/OSS 备份并人工确认后，可随旧批次清理时显式传入 `--retire-legacy-users`：该选项只将固定前缀且 `.invalid` 保留域名的账号标为 `deleted`，不物理删除外键历史；需要恢复时从备份回滚，不手改 append-only 审计表。

2026-09-03 香港 ECS 已完成备份并清理旧批次 `community-2026-09-v1`：49 个 synthetic 账号已标记 `deleted`，旧评论、Star、关注和阅读等可变互动已按批次退役；Commit、Revision、Review、归因和活动审计仍保留。当前真实 active 账号不足三个，因此新的五家社区 seed 会 fail-closed，不会为了填充页面而创建或伪造用户。

## 验收口径

1. `community-seed:contract` 报告五家冻结项目且 `syntheticUsersCreated=false`；
2. seed 运行前后 active 账号数量不增加，且参与者均能在 `platform_user/profile` 查到；
3. 五个项目全部为 `public/published`，其他项目不会由本脚本写入；
4. Star/关注唯一，评论父子关系和锚点项目一致；
5. `project_stats.unique_readers` 与五个项目的 `project_reader` 计数一致；
6. 每个 MR 可回到 source branch、Commit、Review、merged Commit 和 attribution；
7. 重复运行两次计数相同，`--clean` 后可验证可变关系归零而 append-only 历史仍在。

脚本和文档不包含密码、AccessKey、模型 Key 或其他凭据。
