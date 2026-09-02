# 五家企业研究范围冻结

更新时间：2026-09-03

## 目标

公开首发只保留以下五个独立研究项目：

- 慧策掌上先机（`project-huice`）
- 泛微网络（`project-weaver`）
- 深信服（`project-sangfor`）
- 信锐科技（`project-sundray`）
- 牧原食品（`project-muyuan`）

当前已知 seed 中的其他八个项目（有赞、纷享销客、金蝶、奇安信、安恒信息、启明星辰、钉钉、Lark）不再属于首发公开范围。

## 为什么不直接删除

项目的来源、文件树、Commit、Review、Merge、归因和活动事件之间有外键关系；其中 Commit/Review/activity_event 是追加式审计历史。直接 `DELETE` 既可能破坏社区评论/阅读时间线，也无法安全回滚。

因此清理采用两步：

1. 把已知的八个项目从 `public/published` 改为 `private/archived`。公开项目列表、公开搜索、项目详情、来源和统计投影都会按项目状态过滤，不再展示这些项目。
2. 在 `enterprise_scope_freeze_batch` 和 `enterprise_scope_retirement` 写入批次、原状态和 JSON 快照。原始来源/文件树/互动历史保留在数据库中，供审计和回滚使用；社区用户及其全局关注关系不改动。

脚本不会按 `owner_user_id`、标题或通配符猜项目，只处理代码内列出的已知 seed ID。发现未列入清单但仍公开的“企业”项目时，`--apply` 会拒绝执行，先要求人工确认，避免误伤真实用户项目。

## 操作

先应用迁移（生产发布流程会自动执行）：

```bash
pnpm db:migrate
```

默认只读预览，不写数据库：

```bash
pnpm enterprise-scope:freeze
# 等价：node scripts/freeze-enterprise-scope.mjs --check
```

预览确认五家项目齐全、待归档项目 ID 正确且没有未纳入清单的公开企业后，显式执行：

```bash
pnpm enterprise-scope:freeze -- --apply --batch enterprise-scope-freeze-2026-09-03
```

`--apply` 在单事务和 advisory lock 中运行；同一个批次重复执行不会覆盖快照，也不会重复归档。执行结果会打印归档 ID 和数量，不打印凭据。

出现需要恢复的情况：

```bash
pnpm enterprise-scope:freeze -- --rollback enterprise-scope-freeze-2026-09-03
```

回滚只恢复该批次保存的 `visibility/status/verification` 字段；如果项目已经被用户主动改成其他状态，脚本会拒绝覆盖并回滚整个事务。已回滚的批次不可再次复用，避免破坏审计链。

## 验收口径

- 五个保留项目仍为 `visibility=public AND status=published`。
- 八个已知旧项目为 `visibility=private AND status=archived`，且每个都有一条未恢复的 `enterprise_scope_retirement` 记录。
- `platform_user`、`author_follow`、`project_comment`（以及其 append-only `activity_event`）不因范围冻结被删除或改写。
- 公开项目列表和全站公开搜索只返回五家项目；旧项目数据仅作为回滚/审计存储。
- 迁移校验和不可修改；后续若要新增首发企业，应先更新清单、评审范围，再新增迁移或新的批次，不能把脚本改成通配符删除。

契约检查：

```bash
pnpm enterprise-scope:contract
node --check scripts/freeze-enterprise-scope.mjs
```
