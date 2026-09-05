# Multi-Agent Knowledge Workflow

> 版本：0.1；状态：Multi-Agent 编排 MVP 已接入助手 API，任务持久化、人工中断和完整工作流仍在后续交付。

## 1. 目标

Research Workbench 从 AI 问答与研究检索演进为平台级 Multi-Agent 知识工作系统。用户描述目标后，Orchestrator 根据任务动态选择具有独立职责、上下文和工具权限的 Agent；Agent 通过结构化 Task State 协作，结果经确定性校验和必要的人审后，才允许生成 AI Patch、Commit 或 Merge Request。

```text
用户目标 -> Orchestrator -> 受控 Agent -> 结构化 State
          -> 校验/人工审批 -> Patch/Commit/MR/发布
```

Agent 负责理解、规划、归纳和提出建议；权限、校验、持久化和高风险写入仍由确定性服务完成。Multi-Agent 不是多个聊天机器人自由对话，也不是任意 Shell、URL、文件或数据库访问。

## 2. 平台范围

| 工作流 | Agent | 结果 |
| --- | --- | --- |
| 研究分析 | Research、Evidence、Conflict、Writing | 带引用的研究草稿 |
| 文件入库 | Document、Extraction、Entity、Indexing | 来源、Chunk、实体和索引 |
| 文档编辑 | Intent、Writing、Citation、Patch | 可查看 Diff 的 Patch |
| 项目回顾 | Activity、Commit、Memory、Digest | 周报、变更摘要和待办 |
| 质量审核 | Citation、Fact、Security、Version | 审核结果和阻断原因 |
| 知识发布 | Diff、Review、Release、Attribution | MR、发布说明和贡献归因 |
| 记忆治理 | Memory、Conflict、Expiry | 记忆候选、更新和失效建议 |

调研是第一个重点工作流，不是 Multi-Agent 的产品边界。

## 3. Agent 角色

- `Orchestrator Agent`：任务分类、工作流选择、有限动态派发、结果汇总、重试和人审路由。
- `Document Agent`：文件解析、清洗、Chunk、来源创建和索引准备；原始文件不可变。
- `Research Agent`：拆解研究问题，调用当前 Scope 内的搜索、来源读取和 Graph 查询，输出候选证据。
- `Evidence Agent`：提取 Claim、Citation、事实状态和缺失证据；Claim 必须关联来源片段和哈希。
- `Review Agent`：检查引用、事实/推断、冲突、过期内容、跨 Scope 数据和版本冲突，只返回审核结果。
- `Writing Agent`：基于已验证证据生成章节、摘要、改写、周报和发布说明。
- `Memory Agent`：管理记忆候选、作用域、supersession、过期和用户确认。
- `Publishing Agent`：生成 Diff 摘要、Commit Message、MR、Release Note 和 Attribution 建议；不能自动 Merge。

## 4. 统一任务状态

Agent 不通过自由聊天传递主要结果，使用持久化、可校验的 `KnowledgeTaskState`：

```text
task_id, project_id, branch_id, actor_id
objective, workflow_type, scope, current_node
plan, documents, evidence, claims, entities
conflicts, missing_evidence, draft, patch, approval, errors
```

Workflow State 只保存任务运行状态和领域对象引用；正式事实仍归属于 `source`、`claim`、`entity`、`relation_edge`、`revision` 和 `attribution`。

## 5. 编排与技术选择

第一阶段采用固定工作流和有限动态路由；第二阶段由 Orchestrator 根据目标、Scope 和预算动态派发 Agent。复杂任务可以有限并行，但必须有最大步数、并发数、工具调用数、Token/成本预算、超时和循环检测。

- **LangGraph.js：采用。** 作为 State、Node、Edge、Checkpoint、Interrupt、Resume、重试和条件路由层；不负责权限和正式数据写入。
- **LangChain：非必需。** 如使用，仅复用模型适配、Tool Schema 和 Structured Output；现有 Provider、Service、Repository 和 Zod 仍是业务边界。
- **AutoGen：V1 不采用。** 平台优先需要结构化状态、可恢复工作流、人工审批和版本化 Patch，而不是多个 Agent 的自由对话。
- **ReAct：采用受限模式。** Agent 根据 State 选择下一步，但只能调用白名单动作，如 `search_sources`、`read_source`、`query_graph`、`validate_citations` 和 `propose_patch`。

## 6. 安全与交付

- 每次工具调用先解析 actor、project、branch 和 scope；Scope 无法解析时 fail closed。
- Agent 默认不共享完整上下文，只传结构化 State 和引用 ID。
- Agent 不得任意 Shell、SQL、URL、文件系统访问、自动 Merge 或自动外发。
- 所有写入通过统一 Command Registry、权限服务和追加式审计执行。
- 当前已交付助手 API 的 LangGraph StateGraph、Agent Registry、有限动态路由、并行子 Agent 发现结果，以及 `KnowledgeTask` 的创建、查询、执行、暂停、恢复、取消和事件记录；文件入库、报告编辑的完整固定工作流仍按后续阶段扩展。
- 验收覆盖正常完成、无权限、跨项目、无来源、来源冲突、Provider 失败、Checkpoint 恢复、Patch 拒绝和版本冲突。

## 7. 明确不做

V1 不做无限 Agent 对话、自动 Merge、全局共享记忆、无边界网页抓取、Agent 自由 SQL、Agent 自由 Shell，也不把每个简单问答都拆成多个 Agent。
