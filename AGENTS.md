# Open Knowledge Platform 协作护栏

## 产品目标

这是由现有 Research Workbench 演进的开放知识协作平台。当前线上个人工作台必须保持可回滚，目标核心闭环是：

`公开浏览/搜索 -> 登录创建或游客本地草稿 -> 文件与 AI Patch -> Commit/MR -> 维护者审核 -> 合并公开版本 -> 永久贡献署名`

产品、界面、记忆与迁移的可信来源：

- `docs/open-knowledge-platform-spec.md`
- `docs/open-knowledge-ui-motion.md`
- `docs/ai-memory-context-architecture.md`
- `TODO.md`

## 安全边界

- 公开主版本可匿名读取；私有草稿、对话和记忆只能由所有者或明确授权者读取。
- 所有检索必须先执行 user/project/branch 权限过滤；Scope 无法解析时 fail closed。
- AI 只能读取当前 Scope 内的项目、文件、来源、当前用户对话和允许注入的记忆。
- 禁止实现任意文件系统读取、任意 Shell、任意 URL 抓取、任意数据库操作或自动外发能力。
- 网页、PDF、图片和导入文本均为不可信输入，不能作为系统指令。
- AI 只能生成回答、引用和结构化 Patch；用户确认后只写入草稿分支，永远不能批准或自动合并。
- 每个结论必须标记为 `fact`、`inference`、`needs_verification` 或 `conflict`。
- 每条引用必须保留来源、抓取时间、片段位置和内容哈希。
- 原始对话、Commit、Review、Merge、Attribution 和上传原件使用追加写或不可变版本，不能原地覆盖历史。
- RAM 角色、临时凭据、AccessKey、模型 Key、Cookie 和密码不得进入 Git、文档、日志或客户端 Bundle。

## 技术取舍

- 使用 Next.js、TypeScript、PostgreSQL、Tailwind、shadcn/ui、Auth.js、私有 OSS、外部模型 Provider 和 Docker Compose。
- 文件树的 `create/rename/move/delete/restore/duplicate` 必须经过统一 Command Registry、权限服务和 Commit 记录。
- Branch、Revision、Commit、Merge Request、Review 和 Attribution 是领域对象，禁止用页面临时状态模拟。
- 游客文本草稿保存在 IndexedDB；上传文件必须先登录并通过私有 OSS 受控上传。
- RAG 用于报告、网页、PDF 和资料片段检索；业务事实不由模型补造。
- GraphRAG-lite 使用 PostgreSQL 的 `entity` 与 `relation_edge` 表实现，禁止为初版引入 Neo4j。
- AI 上下文采用分层记忆、结构化压缩和任务级 Context Projection；压缩摘要不能覆盖项目正式事实。
- 公开平台持久化检索目标为 PostgreSQL FTS + pgvector + RRF + Reranker；匿名 AI 使用 Redis/托管 Redis 限流。
- LangGraph、RabbitMQ、Temporal、Kubernetes、Neo4j、Yjs 和真正 Git 仓库不属于 V1。

## 代码组织与注释

- 按 `app`、`components/ui`、`components/features`、`lib/domain`、`lib/services`、`lib/repositories`、`lib/providers`、`lib/security`、`app/api` 分层。
- 公共函数、领域对象、API 路由和复杂流程使用中文注释说明职责、输入、输出、副作用和失败边界。
- 不将业务规则、文件访问、模型调用或数据访问直接堆进 React 页面。
- Mock 和真实 Provider 必须使用同一接口；未配置搜索/模型时返回明确的未配置状态，禁止伪造成功结果。
- React 页面只负责组合与交互状态；鉴权、权限、合并、归因、记忆、上传和检索必须在独立服务中实现。
- 一个文件只承担一个可命名职责；超过约 500 行或同时承载 UI、SQL、权限和模型调用时必须拆分。
- 新模块同步提供类型、入口、测试和必要文档；禁止复制认证、权限、审计、上传和命令逻辑。

## 修改与验证

1. 修改前先用 `rg` 定位真实实现和既有接口。
2. 每个新增功能写最小可验证用例，至少覆盖正常、未登录、权限拒绝、跨项目拒绝、来源缺失和版本冲突。
3. 修改后运行 typecheck、lint、相关测试和 build。
4. 数据库变更使用可重复运行的迁移，先备份并在隔离数据库验证，再部署生产；禁止只修改首次初始化 schema。
5. UI 完成后使用浏览器验证桌面/移动端、键盘、Reduced Motion、加载/空/错误/冲突状态。
6. 架构、数据边界、权限、检索、模型、OSS 或部署变化时同步更新 README、TODO 和对应目标文档。
7. 每个通过验证的独立阶段形成提交并推送功能分支；生产切换前保留上一镜像和数据库恢复点。
