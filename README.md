# Research Workbench

个人部署的企业、行业、竞品和政策调研工作台。它的目标是让资料、证据、结论和报告版本留在同一个可审查的工作区，而不是做一个能任意访问系统或网页的通用 Agent。

## 当前实现状态

工作台和 API 已部署到 `https://research.webyrc.com`，由 Caddy HTTPS 与 Basic Auth 保护，PostgreSQL 使用命名卷持久化。没有 `DATABASE_URL` 的本地运行仍只加载不可持久化的演示数据，并在 UI 中禁用新建和保存。

已实现：

- Next.js 三栏工作台、演示对象导航、报告章节编辑、目录锚点和 `Ctrl/Cmd+K` 命令搜索；
- 报告创建/保存 API，带输入校验、事务和乐观锁冲突拒绝；
- 当前报告的手动文本资料导入：标题/正文校验、SHA-256、`active` 来源、连续 Chunk、PostgreSQL 原子写入和 memory_demo 明确拒绝；
- PostgreSQL schema/repository、真实数据库健康检查，以及与其同接口的内存演示 repository；
- 基于 active 来源的关键词 + 有界 Dense RRF 检索，返回父章节、相邻 Chunk 和显式降级状态；
- 有界 GraphRAG-lite 查询：关系边必须来自 active 来源，深度与返回路径数受限；
- Context Projection：选区只传选区，检索问题只传当前报告的精简证据和规则；
- 模型未配置或请求失败时显式降级，不伪造回答；
- Docker Compose、Caddy Basic Auth、HTTPS 配置和 2C2G 资源限制。

尚未实现或未验证：

- URL/PDF/图片导入、文件上传、PDF/视觉解析、来源刷新和变化检测；手动文本是当前唯一支持的导入类型；
- 真正的 PostgreSQL FTS 查询、pgvector 持久化/ANN、检索评测；远程 Embedding、Dense RRF 与 Rerank 已有有界运行时实现；
- 企业 CRUD、图谱写入/API/UI、版本 Diff/回滚、Markdown/PDF 导出；
- 应用内会话认证，当前公网访问依赖 Caddy Basic Auth；
- 备份恢复、磁盘/流量告警和 SSH/RDP 安全组收紧；服务器 HTTPS、持久化、模型调用和核心公网验收已完成。

## 数据与 AI 边界

- 报告、来源、Chunk、引用、关系和版本是结构化记录；AI 只能在受限证据上下文中回答或提出建议。
- 外部网页、PDF、图片和模型输出均是不可信输入，不能变成系统指令。
- AI 不会直接写报告。用户确认的保存请求才会创建一个新的 `report_revision`。
- `source_chunk_text_fts_idx` 已在 schema 中定义，但现有搜索服务尚未执行 PostgreSQL FTS；它在最多 48 个 active Chunk 的明确边界内执行远程 Dense + RRF，超限或 Provider 故障时返回 `degraded`，不能声称已经有生产级混合 RAG。
- BGE-M3 是本机 GPU 的可选离线 embedding worker。线上 2C2G 服务器不运行任何本地模型，只存向量、查询数据库并调用外部 API。

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

- [开放知识协作平台产品与架构规格](docs/open-knowledge-platform-spec.md)
- [开放知识平台 shadcn/ui 前端与动效规范](docs/open-knowledge-ui-motion.md)
- [AI 助手记忆、上下文压缩与会话架构](docs/ai-memory-context-architecture.md)
- [私有 OSS 上传与解析实现边界](docs/assets-upload-implementation.md)
- [产品规格与当前范围](docs/product-spec.md)
- [检索、GraphRAG-lite 与上下文投影](docs/retrieval-architecture.md)
- [本地 BGE-M3 worker 的离线边界与启动方式](docs/local-bge-m3-worker.md)
- [交付、Provider 和 Git 规范](docs/delivery-and-integrations.md)
- [部署说明](docs/deployment.md)
- [可核验任务清单](TODO.md)
- [开发护栏](AGENTS.md)
