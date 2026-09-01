# 问题、方案与性能记录

> 每个已复现异常使用稳定 `scenario_id`。本文只记录实际观察、根因、修复提交和复验结果；目标指标未实测前不写成 SLA。

## DEPLOY-FTS-001：表达式索引迁移失败

- **场景**：香港 ECS 执行迁移 `007_source_chunk_fts.sql`。
- **现象**：PostgreSQL 报 `functions in index expression must be marked IMMUTABLE`，发布脚本在迁移阶段停止。
- **根因**：索引表达式使用 `array_to_string(heading_path, ' ')`，该函数不能作为此处的不可变索引表达式。
- **方案**：索引只覆盖正文和 `contextual_prefix`；标题路径保留在应用层确定性关键词补充。查询表达式与索引保持一致，并保留迁移失败即停边界。
- **修复**：`90de7a9`。
- **复验**：香港迁移成功，`schema_migration` 已记录 `007_source_chunk_fts.sql`；搜索 API 返回 `lexical=postgres_fts`。
- **性能影响**：FTS 使用 GIN 表达式索引；标题路径不进入索引，避免迁移失败，应用层仅处理已受限快照。

## DEPLOY-IMAGE-001：应用镜像误构建为 Worker

- **场景**：Dockerfile 新增可选 `ingestion` stage 后执行 `docker compose build app migrate`。
- **现象**：`app` 容器启动解析 Worker，日志出现 `asset_ingestion_error`，健康检查不通过。
- **根因**：Dockerfile 最后一个 stage 默认成为无 target 构建结果，覆盖了原本的 Next.js runner。
- **方案**：Compose 的 `app/migrate` 显式 `target: runner`，Dockerfile 追加 `FROM runner AS default`；Worker 只能通过 `ingestion` profile 启动。
- **修复**：`778e371`。
- **复验**：香港 ECS `app/postgres/caddy` 均 healthy，应用内部 `/api/healthz` 通过；Worker 未常驻。
- **性能影响**：默认镜像不携带 Worker 全量运行时，维持应用内存上限；按需 Worker 为 one-shot，避免常驻额外进程。

## DEPLOY-HEALTH-001：Compose `port` 对 `expose` 误报

- **场景**：发布脚本检查应用 `3000`/PostgreSQL `5432` 是否对公网发布。
- **现象**：`docker compose port app 3000` 返回值导致脚本误判，尽管容器没有 HostPort 映射。
- **根因**：不同 Compose 版本会把 `expose` 端口显示在 `port` 输出中，不能作为宿主机发布事实。
- **方案**：读取 Docker `HostConfig.PortBindings`，仅存在真实 HostPort 时失败。
- **修复**：`ad53e58`。
- **复验**：香港 `health-check.sh --skip-external` 通过，明确报告 `3000/5432 未发布`。
- **性能影响**：只读一次容器元数据，无网络额外请求。

## EDGE-ESA-001：ESA ICP/源站证书阻塞

- **场景**：通过 `research.webyrc.com` 访问香港源站。
- **现象**：ESA HTTP 返回 `403 Non-compliance ICP Filing`；ESA HTTPS 回源在源站证书未签发时返回 `525`。
- **根因**：云边代理的合规拦截和 HTTPS 回源握手发生在应用外部，代码与 Docker 无法绕过。
- **方案**：人工在 ESA 暂时关闭代理（DNS-only）或把回源临时设为 HTTP，待 Caddy ACME 证书签发后再恢复 HTTPS；切换前后复跑公网验收。
- **状态**：待人工控制台操作；仓库脚本不会自动切换 DNS/ESA/备案。
- **性能影响**：切换期间公网不可用；源站容器和 SSH 隧道验收不受影响。

## OSS-E2E-001：临时对象元数据读取差异

- **场景**：ECS RAM Role 对私有 OSS 隔离对象执行 PUT/HEAD/DELETE。
- **现象**：测试若从 `head.meta['x-oss-meta-sha256']` 读取会误报缺失。
- **根因**：`ali-oss.head()` 会把用户元数据映射为 `result.meta.sha256`，不同 SDK/代理还可能只保留原始响应头。
- **方案**：适配器兼容标准字段、带前缀字段和原始响应头，非法值触发流式 SHA-256 重算；签名 PUT 强制声明同一 `x-oss-meta-sha256`。
- **修复**：`4d611d9`、`a94ad8a`。
- **复验**：香港 ECS 临时对象真实 Put/Head/Delete 通过，未保留对象或签名 URL。
- **性能影响**：正常路径只读 HEAD 元数据；缺失元数据时才流式读取对象，受 25 MiB 上限约束。

## ASSET-WORKER-002：one-shot Worker 使用旧镜像或无法退出

- **场景**：源码修复后直接执行 `docker compose --profile ingestion run --rm ingestion`。
- **现象**：若未传 `--build`，Compose 复用旧 ingestion 镜像，继续报告已修复前的 SQL 错误；修复后即使输出 `asset_ingestion_idle`，STS/OSS 刷新定时器仍可能让进程挂起。
- **根因**：Worker 镜像与 App 镜像使用不同 target/tag，`run` 不会因工作树变化自动重建；one-shot 进程还继承了长生命周期凭据刷新定时器。
- **方案**：发布/验收显式使用 `docker compose --profile ingestion run --build --rm ingestion`；Worker 完成数据库关闭和日志写出后显式 `process.exit(0/1)`，常驻 App 不采用该退出路径。
- **修复**：`3773a23`（领取 SQL）、`90cfd7d`（one-shot 生命周期）。
- **复验**：香港 ECS Worker 输出 `asset_ingestion_idle`、`processed=0` 后正常退出；未留下 ingestion 容器。
- **性能影响**：按需构建耗时约数分钟但不增加常驻内存；空队列运行不调用模型、不读取大对象。

## COLLAB-IDEMP-001：重试幂等键携带不同内容

- **场景**：网络超时后，客户端使用同一 `Idempotency-Key` 重试，但修改了命令、MR 描述或 Review 内容。
- **现象**：仅按键查找会把第二个请求静默当成第一次成功，造成用户以为内容已写入，实际审计记录却不是这次请求。
- **根因**：幂等键只能识别请求身份，不能证明请求载荷相同；并发首请求还可能同时通过预查询。
- **方案**：服务端对规范化载荷生成 SHA-256 指纹，数据库保存指纹并以唯一索引裁决并发；指纹缺失或不一致返回 `409 INVALID_STATE`，一致请求返回原 Commit/MR/Review。
- **修复**：迁移 `009_collaboration_hardening.sql`、`lib/services/collaboration/idempotency.ts`。
- **性能影响**：每个带幂等键的写请求增加一次本地 SHA-256（载荷仅为结构化命令/元数据）；重试不再执行第二次树校验或写入。

## COLLAB-MR-002：无变化或已冲突的修改申请进入审核

- **场景**：草稿与目标主分支没有差异，或三方 Diff 已发现同一节点冲突，仍尝试创建/批准 MR。
- **现象**：空 MR 占用审核收件箱；审核者可能批准一个必然无法合并的申请。
- **方案**：创建 MR 时要求源分支为 `active`、目标分支为可写保护分支且至少存在一项变化；无冲突明确标记 `clean`，已知冲突禁止 `approve`，冲突只能在人工修正后重新提交。
- **修复**：`CollaborationService` 与 PostgreSQL 协作仓储。
- **性能影响**：复用已有三方 Diff，不增加额外全库扫描；失败在事务内回滚，不产生分支/MR 副作用。

## COLLAB-HISTORY-003：历史 Commit/Revision/Review 被原地覆盖

- **场景**：误用后台脚本或 ORM 更新审计事实，导致贡献署名、审核意见或正文版本改变。
- **现象**：同一 MR 的历史页面前后读取结果不一致，无法解释谁在何时做了什么。
- **方案**：迁移创建 PostgreSQL append-only 触发器；修订只能追加新 Commit/Revision/Review，MR/Branch 状态仍通过受限事务推进。
- **修复**：迁移 `009_collaboration_hardening.sql`。
- **性能影响**：仅在禁止的 UPDATE/DELETE 路径执行触发器；正常追加写无额外查询。

## COLLAB-ATTR-004：代提交维护者覆盖真实贡献者署名

- **场景**：维护者代贡献者发起 MR，或维护者在贡献者分支上补充内容。
- **现象**：若直接使用 MR 作者写入 `content_attribution`，公开页面会把正文错误归给审核/代提交人。
- **方案**：合并时按源分支节点最近一次 Commit 的真实 `author_user_id` 归因；无节点 Commit 时回退到 MR 作者。审核者只写入 `reviewer_user_id`，不覆盖贡献者。
- **修复**：PostgreSQL 协作仓储的合并事务。
- **性能影响**：每个有正文修订的变化增加一次受索引约束的节点 Commit 作者查询；不扫描全项目历史。

## MEMORY-SCOPE-001：同一用户的会话记忆串入另一会话

- **场景**：用户在项目 A 的会话 1 产生 conversation-scoped 记忆，随后在同项目会话 2 询问相似问题。
- **现象**：若只按 owner/project 查询，临时决定可能被错误注入会话 2。
- **根因**：项目相同不代表会话相同；检索调用方还可能传入不存在或属于其他用户的 conversation ID。
- **方案**：`MemoryRetrievalService` 在 FTS 前验证会话归属和 project 一致性；仓储查询始终同时携带 owner/project/conversation，conversation scope 只匹配精确会话。Scope 不一致或会话无法确认时 fail closed。
- **复验**：`memory-service.contract.ts` 的跨会话召回和缺失会话场景通过。
- **性能影响**：每次带 conversation ID 的检索增加一次按主键/owner 的会话查询；避免无界全库读取。

## MEMORY-CONTEXT-002：公开 Scope 注入私人记忆

- **场景**：已登录用户在全站公开 Scope 询问问题。
- **现象**：如果仅凭 ownerUserId 查询记忆，用户偏好或项目决定会进入公开上下文。
- **根因**：身份认证不等于当前 Scope 允许读取私人记忆。
- **方案**：`ContextAssemblyService` 对 public Scope 跳过长期记忆检索，并拒绝携带项目、分支、文件或选区引用；会话绑定的 project/branch 必须与私人 Scope 完全一致。
- **复验**：`memory-service.contract.ts` 的 public context 和项目错配场景通过。
- **性能影响**：公开请求少一次记忆查询，降低延迟和隐私风险。

## MEMORY-COMPACTION-003：摘要丢失 ID/金额/日期/待办状态

- **场景**：长会话压缩时，摘要 Provider 返回了结构合法但遗漏订单 ID、金额、日期或待办状态的摘要。
- **现象**：摘要看似成功，后续回答可能把缺失事实当作未知或重新猜测。
- **根因**：仅校验数组字段存在，无法证明关键事实在压缩前后保持不变。
- **方案**：压缩前从原始消息生成 `criticalFacts` 账本；摘要必须携带每条事实、来源 message ID 和最新待办状态。账本写入规范 JSON SHA-256，缺失或漂移标记 `critical_fact_drift`，保留原始消息并拒绝提交。
- **复验**：契约测试使用故意丢事实的 Provider，确认摘要为空、检查点失败且原始消息数量不变。
- **性能影响**：仅扫描待压缩消息并做正则/哈希，避免额外模型调用；账本体积受上下文事实预算约束。

## MEMORY-COMPACTION-004：摘要写入后检查点提交失败

- **场景**：摘要 INSERT 成功，但 checkpoint 或 conversation `summary_version` 更新因网络/约束失败。
- **现象**：数据库出现“孤儿摘要”，下一次读取可能误把它当成最新摘要。
- **根因**：分步写入缺少事务和乐观版本检查。
- **方案**：新增 `commitCompaction` 原子仓储契约；PostgreSQL 使用事务与会话行锁，InMemory 先完成全部前置校验再替换副本。失败时事务回滚，服务将 started checkpoint 置为 failed；每会话只允许一个 started checkpoint。
- **复验**：契约测试注入提交失败，确认没有摘要、检查点为 failed，原始消息保持完整。
- **性能影响**：压缩成功路径增加一次事务和行锁；换取一致性，且不会执行第二次摘要调用。

## MEMORY-TOOL-005：工具调用和结果不成对

- **场景**：工具结果来自另一会话、角色错误，或结果消息未登记到 `ToolExecution`。
- **现象**：压缩范围把孤立结果当普通文本，Resume 无法重建工具状态。
- **根因**：外键只保证消息存在，不保证同会话、角色和状态的语义配对。
- **方案**：压缩前验证 call/result 同会话、call 为 assistant/system、result 为 tool；已结束调用必须有结果，未登记 tool 消息直接拒绝。PostgreSQL 迁移 009 增加触发器和 InMemory 同接口校验。
- **复验**：工具边界契约和数据库迁移在隔离环境执行；不闭合范围返回明确 ValidationError。
- **性能影响**：每次压缩线性扫描当前会话消息和工具事件；不读取其他会话。
