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
