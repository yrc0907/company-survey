# Research Workbench

个人部署的企业、行业、竞品和政策调研工作台。它的目标是让资料、证据、结论和报告版本留在同一个可审查的工作区，而不是做一个能任意访问系统或网页的通用 Agent。

## 当前实现状态

工作台已部署到香港 ECS 的 `/srv/research-workbench`，应用、PostgreSQL 和 Caddy 容器均健康；`https://research.webyrc.com` 的首页和 `/healthz` 已返回 200，公网 E2E 12/12 通过。旧版个人 Research API 继续由 Basic Auth 保护，PostgreSQL 使用命名卷持久化。没有 `DATABASE_URL` 的本地运行仍只加载不可持久化的演示数据。

已实现：

- Next.js 三栏工作台、演示对象导航、报告章节编辑、目录锚点和 `Ctrl/Cmd+K` 命令搜索；
- 报告创建/保存 API，带输入校验、事务和乐观锁冲突拒绝；
- 当前报告的手动文本资料导入：标题/正文校验、SHA-256、`active` 来源、连续 Chunk、PostgreSQL 原子写入和 memory_demo 明确拒绝；
- PostgreSQL schema/repository、真实数据库健康检查，以及与其同接口的内存演示 repository；
- 基于 active 来源的 PostgreSQL FTS + 可选 pgvector Dense RRF 检索，返回父章节、相邻 Chunk 和显式词法/语义降级状态；无扩展、未迁移或能力探测失败时仍使用确定性关键词降级；
- 有界 GraphRAG-lite 查询：关系边必须来自 active 来源，深度与返回路径数受限；
- Context Projection：选区只传选区，检索问题只传当前报告的精简证据和规则；
- LangGraph.js 驱动的受控 Multi-Agent 助手与持久化 Knowledge Task API，支持 Research/Document/Evidence/Writing/Review/Conflict/Publishing/Memory 动态路由、检查点、租约 Worker、暂停/恢复/取消和 owner 隔离；
- Publishing Agent 的结果只有在用户显式确认并提供源/目标分支后，才通过 `/api/ai/tasks/[id]/publish` 创建真实 MR；不会自动 Merge。
- 模型未配置或请求失败时显式降级，不伪造回答；
- Docker Compose、Caddy Basic Auth、HTTPS 配置和香港 ECS 4C8G 资源限制。
- 五家冻结企业的独立研究档案：每家均有 Yu 的核心判断、事实/推断/待核验分层、产品/客户/商业模式、竞争、政策、风险、合作与下一步核验问题；研究正文不是单段官网摘要，缺少可靠证据的数值不会被补造。

尚未实现或未验证：

- URL 来源刷新已接入 owner 鉴权路由和 one-shot Worker；私有文件上传与解析 Worker 已支持 Markdown/TXT、原生文字 PDF、DOCX，图片在显式开启视觉 Provider 后可生成 `needs_review` 待校对草稿，扫描 PDF 仍安全降级；
- pgvector 持久化已提供可选迁移、能力探测、版本/哈希校验、权限过滤和确定性降级；知识任务 Worker 使用 PostgreSQL 租约领取，不引入 AutoGen、RabbitMQ 或 Temporal；
- 企业 CRUD、图谱写入（公开关系图 API/UI 已实现）、版本 Diff/回滚、Markdown/PDF 导出；
- 应用内会话认证已实现；旧版 Research API 仍依赖 Caddy Basic Auth，公开平台写操作依赖 Auth.js/RBAC；
- 备份/发布/健康检查脚本和安全组只读计划已加入；公网 HTTPS 已验收。异机恢复、磁盘/流量告警以及 SSH/RDP 安全组收紧仍待人工变更和演练。

当前公开首发范围已冻结为慧策掌上先机、泛微网络、深信服、信锐科技和牧原食品五家；每家报告独立维护，
不做默认跨行业排名。登录、注册、上传、创建、编辑和贡献申请暂时关闭，点击后显示“登录功能暂未开放，
仅对内测用户开放”；公开阅读、搜索和限额 AI 仍可用。实现与回滚说明见
[企业研究范围冻结](docs/enterprise-scope-freeze.md) 和 [内测认证关闭模式](docs/public-auth-closed-mode.md)。

## 数据与 AI 边界

- 报告、来源、Chunk、引用、关系和版本是结构化记录；AI 只能在受限证据上下文中回答或提出建议。
- 外部网页、PDF、图片和模型输出均是不可信输入，不能变成系统指令。
- AI 不会直接写报告。用户确认的保存请求才会创建一个新的 `report_revision`。
- `source_chunk_contextual_fts_idx` 为正文和上下文前缀建立 GIN 索引；迁移 `011_pgvector_optional.sql` 以动态 DDL 尝试安装 pgvector/向量列，标准镜像缺扩展时仍可完成。PostgreSQL 模式由仓储执行参数化 FTS 与向量查询，向量只接受 active 来源、报告/source 范围、模型/维度/版本和逐 Chunk 文本哈希匹配；能力缺失时 SearchService 保留确定性降级。`PGVECTOR_WRITE_ENABLED=true` 才允许受控批处理写入。
- BGE-M3 是本机 GPU 的可选离线 embedding worker。线上 4C8G 服务器不运行任何本地模型，只存向量、查询数据库并调用外部 API。

## 远程模型与检索配置

默认 Base URL 为 `https://v2.cloudmist.cloud/v1`。实际密钥只放在 Git 忽略的本地/服务器环境文件中，仓库和文档绝不保存真实 Key。

| 用途 | 配置名 | 目标模型 | 当前状态 |
| --- | --- | --- | --- |
| 报告问答 | `MODEL_API_KEY` | `gpt-5.6-terra` | Provider 代码已实现，服务器调用待验收 |
| Dense Embedding | `EMBEDDING_API_KEY` | `gemini-embedding-2-preview` | 最多 48 个 active Chunk 的临时向量、余弦排序与 RRF 已实现；持久化待 pgvector |
| Rerank | `RERANK_API_KEY` | `qwen3-rerank` | 有界候选精排、429/超时/5xx 回退链与 deterministic degraded 已实现 |

Rerank 的目标降级顺序为：`qwen3-rerank` -> `Pro/BAAI/bge-reranker-v2-m3` -> `BAAI/bge-reranker-v2-m3` -> 保留确定性融合排序并标记 `degraded`。`429`、超时和 `5xx` 都不能被伪装成精排成功。

## 本地运行与部署

```bash
pnpm install
pnpm dev
```

本地无数据库时，只能查看内存演示数据。生产部署前须在服务器创建 `.env`，填写新的数据库密码、Caddy bcrypt 哈希和经过轮换的 Provider Key；不要把这些值提交、截图或发送到聊天。

部署架构：

```text
Internet
  -> Caddy (HTTPS + Basic Auth)
  -> Next.js Web/API
  -> PostgreSQL + Docker volumes
  -> 外部模型 / 搜索 / embedding / rerank Provider
```

详细步骤、实测证据与资源边界见 [部署说明](docs/deployment.md)。

## 文档

- [真实用户开放知识平台 UI、评论、搜索与数据规格](docs/public-knowledge-platform-ui-and-data-spec.md)
- [AI 生成面板与 ICP/香港部署决策](docs/generation-panel-and-icp-deployment.md)
- [前后端性能与交互验收记录](docs/performance-and-e2e-verification.md)
- [开放知识协作平台产品与架构规格](docs/open-knowledge-platform-spec.md)
- [开放知识平台 shadcn/ui 前端与动效规范](docs/open-knowledge-ui-motion.md)
- [公开企业首发数据包与证据边界](docs/public-company-seed.md)
- [公开项目 GraphRAG-lite 关系图](docs/public-project-graph.md)
- [五家企业研究范围冻结](docs/enterprise-scope-freeze.md)
- [公开版本历史与逐段 Diff](docs/public-version-history-diff.md)
- [URL 来源刷新实现](docs/source-refresh-implementation.md)
- [信锐科技 2026 独立研究](docs/enterprise-research/信锐科技-2026独立研究.md)
- [AI 助手发送按钮故障说明](docs/ai-assistant-send-button-fix.md)
- [内测认证关闭模式](docs/public-auth-closed-mode.md)
- [真实身份认证 Provider 与验收边界](docs/authentication-providers.md)
- [阿里云认证接入决策](docs/aliyun-auth-integration-decision.md)
- [阿里云短信认证服务接入](docs/aliyun-sms-authentication.md)
- [阿里云图形验证接入](docs/aliyun-captcha-integration.md)
- [阿里云企业邮箱接入](docs/aliyun-enterprise-email.md)
- [2026-09-02 验证记录](docs/verification-log-2026-09-02.md)
- [AI 助手记忆、上下文压缩与会话架构](docs/ai-memory-context-architecture.md)
- [Multi-Agent 知识工作流](docs/multi-agent-knowledge-workflow.md)
- [私有 OSS 上传与解析实现边界](docs/assets-upload-implementation.md)
- [产品规格与当前范围](docs/product-spec.md)
- [检索、GraphRAG-lite 与上下文投影](docs/retrieval-architecture.md)
- [本地 BGE-M3 worker 的离线边界与启动方式](docs/local-bge-m3-worker.md)
- [交付、Provider 和 Git 规范](docs/delivery-and-integrations.md)
- [部署说明](docs/deployment.md)
- [可核验任务清单](TODO.md)
- [开发护栏](AGENTS.md)
