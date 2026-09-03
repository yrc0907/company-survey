# AI 助手记忆、上下文压缩与会话架构

> 状态：V1 记忆/会话/上下文硬化已实现，V1.5/V2 的语义索引和异步 consolidation 仍是目标架构。本文基于用户提供的五份本地源码快照进行代码与文档审查；这些目录是解压快照而非各自独立 Git checkout，因此不能从本地证明上游 Commit。引用只说明当前文件内容，不代表项目最新版本或未公开生产实现。

## 1. 结论

不存在能数学保证“模型永远不会忘记”的记忆方案。摘要可能遗漏、检索可能漏召回、过期记忆可能错误胜出。高标准系统能提供的是：

- 原始消息和工具事件持久化，不因压缩删除；
- 压缩摘要引用原始消息范围，可重新生成和审计；
- 当前任务每轮重新投影项目、权限、文件、分支和正式事实；
- 历史对话使用全文 + 向量 + 元数据过滤按需检索；
- 长期记忆带来源、作用域、版本、有效期和冲突状态；
- 用户可查看、修正、删除或禁止长期记忆；
- 检索失败时明确说明没有找到，而不是让模型补造“记得”；
- 用评测衡量记忆召回、错误注入、跨项目泄漏和压缩漂移。

本平台采用五层外部记忆，并将会话压缩与长期记忆彻底分开：

```text
L0 原始事件日志       完整消息、工具、Patch、引用，不可变
L1 当前工作上下文     最近消息、选区、当前文件、当前任务
L2 压缩检查点         被压缩区间的结构化摘要 + 原始 message_id 范围
L3 长期用户记忆       用户明确允许保存的偏好、稳定事实、决定
L4 项目正式知识       文件、分支、Commit、引用、Claim、Attribution
```

权威顺序为 `项目正式知识 > 当前用户明确输入 > 长期记忆 > 压缩摘要 > 模型推断`。摘要和长期记忆不能覆盖正式文件或已合并事实。

## 2. 本地源码审查

### 2.1 Codex 本地快照

许可：Apache-2.0。核心证据：

- `codex-rs/core/src/compact.rs`：压缩生成摘要后替换模型可见历史，重新注入 initial context，并重新计算 token；压缩失败时会从最旧历史开始有界裁剪重试；源码明确警告长线程和多次压缩会降低准确率；
- `codex-rs/thread-store/src/local/model_context.rs`：从持久化 rollout/lineage 逆向扫描最近可用 replacement-history checkpoint，用于 Resume 和 Fork；原始日志与模型可见上下文不是同一个概念；
- `codex-rs/memories/README.md`：长期记忆是异步两阶段管线。Phase 1 从近期 rollout 提取结构化 `raw_memory`/`rollout_summary`，有并发上限、租约、重试退避和密钥脱敏；Phase 2 在全局锁下按使用次数与新鲜度筛选，生成 workspace diff，再由隔离 consolidation agent 更新高层记忆；
- `codex-rs/core/src/state/auto_compact_window.rs`：按 compaction window 记录服务器实际或估算 token 基线，提醒与 fallback 每个窗口只领取一次；
- `codex-rs/core/AGENTS.md`：模型可见上下文要求增量构建、所有注入项有硬上限、单项不超过 10K token，并避免频繁修改前缀导致缓存失效。

可借鉴：原始日志与压缩历史分离、检查点 Resume、初始上下文重新注入、长期记忆异步提取/合并、并发租约、使用频率和新鲜度筛选、密钥脱敏。

不能照搬：Codex 的长期记忆面向开发 Agent rollout，不等于公开知识平台的用户聊天记忆；我们不能让 consolidation agent直接修改用户正式知识。

### 2.2 Claude Code 本地快照

许可文件为 Anthropic All Rights Reserved/商业条款。本地仓库主要包含插件、示例、README 和 CHANGELOG，不包含足以审计核心压缩算法的运行时源码，不能称为“Claude Code 泄露源码”。

可从公开变更记录证明的产品机制包括：`/compact` 与 auto-compact、`PreCompact` hook、`/resume`、命名会话、历史搜索、`/branch`、大 Session 恢复、陈旧大 Session Resume 前摘要、CLAUDE.md/规则注入、压缩失败熔断和 transcript chain 修复。

可借鉴：用户可见的新建/恢复/搜索/分支、压缩前 Hook、失败熔断、大历史按需加载。不能复制其实现代码，也不能从 CHANGELOG 推断未公开算法细节。

### 2.3 DeepSeek Harness 本地快照

许可：MIT。核心证据：

- `docs/subsystems/compaction.zh.md` 与 `packages/compaction/*`：压缩是独立能力 seam，不绑死 Agent Loop；
- 压缩以 `compaction/start -> compaction/summary -> replacement user/message -> compaction/end` 形成持久事务；遗留 start 可检测崩溃，不伪装完成；
- Summary 记录 shadowed range、精确 seq 列表、token、provider/model/usage，并用 surface replace 替换模型可见区间；
- 范围边界验证工具调用/结果配对，拒绝不平衡区间；
- 压力压缩前可先执行确定性 Tool Result Pruner，摘要不缩小时拒绝提交；
- 手动、压力和 context-overflow 触发分开，失败类别包含 busy、changed、summary、commit、persistence；
- `docs/user/guide/mcp-memory.zh.md` 明确第三方记忆 MCP 默认关闭，DSH 只提供互操作，不替记忆服务选择数据库、模型或 embedding。

可借鉴：压缩事务事件、崩溃可恢复、工具配对保护、先确定性裁剪再模型摘要、摘要必须真实缩小、能力接口与实现分离。

### 2.4 Headroom 本地快照

许可：Apache-2.0。核心证据：

- `docs/content/docs/memory.mdx`：User/Session/Agent/Turn 四级作用域；类别、语义搜索、手动增删、Temporal Supersession；SQLite + HNSW + FTS5 混合存储；
- `headroom/proxy/memory_injection.py`：注入默认有 1024 token、10 条、0.3 相似度下限，证明 Top-K 仍必须受总 token 预算约束；
- `headroom/proxy/memory_ranker.py`：在余弦分数上增加时间新鲜度，而非只按相似度；
- `tests/test_memory_handler_project_isolation.py`：不同项目路由到不同存储，项目解析失败时 fail closed，不回退到全局记忆，避免跨项目泄漏；
- `tests/test_memory_invariants.py`：记忆不能写入 system/instructions 热前缀，只能加在用户消息尾；每次搜索必须传完整 MemoryQuery；
- `docs/content/docs/context-management.mdx`：保护 system、工具定义和最近轮次；为输出预留 token；对最新 live zone 做类型感知、可逆压缩，旧前缀保持字节稳定以利用 Prompt Cache。

可借鉴：作用域隔离、时态 supersession、混合检索、时间加权、注入预算、项目解析 fail closed、热前缀稳定、可逆原文引用。

需要修正：内联要求模型输出 `<memory>` 并自动保存，容易把模型误判写成长记忆。本平台将自动提取只作为候选，用户可见且高风险类别需要确认。

### 2.5 Billion Context 本地快照

许可：MIT。核心证据：

- `README.zh-CN.md` 与 `src/*`：代理注入 `compress`、`decompress`、`search_context`、`acp_status`，模型选择压缩范围；
- 使用分层、小范围、可逆压缩，原文可通过引用按需取回；
- 保护 system/工具/最近消息，隐藏已消费的压缩调用，压缩提示每轮临时注入而非累积污染；
- 协议适配 OpenAI、Responses、Anthropic，并限制最多循环轮次，达到上限要优雅完成而不是返回空结果；
- 会话 ID 由协议、上游、API key 和显式 session 组合隔离；缺少显式 session 时首消息哈希存在碰撞风险，文档没有隐藏这一限制；
- README 明确项目仍处早期，mock 测试多于真实模型验证。

可借鉴：主动压缩/解压工具、可逆范围、保护区、临时提示、协议无关核心、会话隔离与循环熔断。

不能直接用于公开平台：它是模型 API 代理，不拥有用户权限、项目知识、隐私删除或公共内容治理；模型自行决定压缩范围也必须增加平台侧硬约束。

## 3. 我们采用的组合方案

```text
Codex:       原始 rollout、checkpoint resume、两阶段长期记忆
DeepSeek:    durable compaction transaction、tool pairing、prune-first
Headroom:    scope isolation、supersession、bounded hybrid retrieval、fail-closed
Billion:     reversible range、decompress/search tools、protected recent zone
Claude Code: 用户可见 resume/branch/search/hook/circuit-breaker 产品形态
```

这不是复制源码，而是复用公开机制，并按开放知识平台的数据、权限和审计要求重新实现。

## 4. 数据模型

```text
conversation
conversation_message
message_part
tool_execution
conversation_checkpoint
conversation_summary
memory_item
memory_version
memory_source
context_snapshot
conversation_search_chunk
ai_patch
```

| 表 | 关键字段 |
| --- | --- |
| `conversation` | user、project、branch、title、status、last_message_at、summary_version |
| `conversation_message` | role、content、sequence、token_estimate、parent_message_id、created_at |
| `message_part` | text、image、citation、tool_call、tool_result、reasoning metadata |
| `conversation_checkpoint` | compacted start/end seq、summary_id、token before/after、status、error |
| `conversation_summary` | goal、decisions、constraints、entities、claims、citations、todos、conflicts |
| `memory_item` | scope、category、content、importance、confidence、valid_from/until、current_version |
| `memory_version` | supersedes、content、reason、created_by、created_at |
| `memory_source` | message_id、commit_id、citation_id、extraction mode |
| `context_snapshot` | 本次模型实际使用的 scope、message/chunk/memory IDs、token budget 和模型 |
| `ai_patch` | conversation、branch、base revision、Patch、用户确认和 MR 关联 |

原始消息使用追加写；编辑消息创建新版本或分支，不原地覆盖。删除按用户策略执行软删除、索引删除和最终清除；公开项目审计与私人聊天保留期分开。

## 5. 每轮上下文投影

```text
固定规则与安全边界
  + 当前用户、权限、项目、分支
  + 当前选区 / 文件 / 文件夹
  + 当前项目检索证据
  + 最近 N 轮完整消息
  + 最新结构化压缩摘要
  + 按当前问题检索出的历史消息
  + 允许注入的长期记忆
  + 未完成待办、冲突和输出 Schema
```

所有部分分别设置 token 上限。当前 `ContextAssemblyService` 还为关键事实账本预留约 5% 的独立预算；摘要被预算挤出时账本仍单独投影，超预算则 fail closed，不静默丢掉 ID/金额/日期/待办。建议初始预算比例：固定规则 10%、当前文件/证据 35%、最近对话 25%、压缩摘要 10%、历史对话检索 10%、长期记忆 5%、关键事实 5%；运行时根据模型窗口和回答预算调整，而不是写死绝对 token。

前缀规则和工具定义保持稳定；易变化的检索证据与记忆放在用户消息尾，降低 Prompt Cache 失效。

## 6. AI 读取范围

AI 助手顶部必须显示当前 Scope，默认是“当前文件 + 当前项目按需检索”：

| Scope | 实际读取 |
| --- | --- |
| 当前选区 | 选区、相邻 Block、必要引用 |
| 当前文件 | 小文件全文；大文件目录、摘要和相关 Chunk |
| 当前文件夹 | 当前子树内检索，不越过文件夹 |
| 当前项目 | 当前分支内 FTS + pgvector + RRF + Reranker |
| 全站公开 | 所有公开主版本；必须显式选择 |

私人草稿只对其所有者和授权协作者可见。AI 助手当前必须登录，登录后只能读取授权的公开主版本或本人/协作者 Scope；项目 scope 无法解析时 fail closed，不回退到全站或其他项目。会话绑定的 project/branch 必须与请求 Scope 完全一致；公开 Scope 即使请求主体已登录也不会注入其他用户、项目或会话记忆。

## 7. 上下文压缩

### 7.0 当前实现的完整性护栏

`ConversationCompactionService` 在调用摘要 Provider 前，从待压缩原始消息生成确定性的 `criticalFacts` 账本，覆盖：

- 带标签的订单/客户/项目/报价/合同/运单/提单 ID；
- 金额和币种；
- ISO 或中文年月日日期；
- 显式 `冲突:`/`conflict:` 记录，以及同一 ID 字段出现多个值时自动生成的冲突记录；
- `待办:`/`todo:` 及 `open/done/blocked` 状态。

摘要 Provider 必须返回账本中每一条事实及其来源消息 ID；缺失、来源丢失或待办状态漂移会把检查点标记为 `critical_fact_drift`，原始消息不受影响。账本以规范 JSON 的 SHA-256 写入结构化摘要，Resume/上下文投影会再次校验哈希和来源消息是否仍存在。旧摘要没有账本字段时按 legacy 读取，但新生成摘要必须携带账本。

摘要、完成检查点和 `summary_version` 通过仓储的 `commitCompaction` 原子事务提交；PostgreSQL 以行锁和版本检查防止并发压缩，失败时事务回滚，不会留下可被读取的孤儿摘要。数据库同时对每个会话设置一个 `started` 检查点唯一租约。

工具调用和结果必须属于同一会话，调用角色为 `assistant/system`、结果角色为 `tool`；未登记结果、跨会话引用和未闭合调用都会阻止压缩。工具结果过大时仍先做可回取的 head/tail/hash 裁剪。

### 7.1 触发

- 用户手动压缩；
- 输入预算达到模型可用窗口的动态阈值；
- Provider 返回 context overflow；
- Resume 陈旧大对话前后台生成检查点。

为输出预留预算。连续三次压缩仍立即回填到阈值时触发熔断，提示新建对话或缩小 Scope，不继续烧模型调用。

### 7.2 顺序

1. 固定工具输出裁剪：大 JSON/日志保留 head、tail、hash 和取回 ID；
2. 验证选择区间不拆断 tool_call/tool_result；
3. 保护系统规则、工具定义、最近 2-5 轮、当前任务和未完成操作；
4. 对较旧闭合区间生成结构化摘要；
5. 摘要必须比原区间小，否则拒绝提交；
6. 单事务写入 start、summary、replacement checkpoint、end；
7. 保存原始 seq/message ID 和 token before/after；
8. 下一轮重新注入项目事实与权限，不依赖摘要保留正式数据。

摘要失败时保留原历史并降级；不能写一个“成功”状态。压缩不会删除原始消息，用户仍能搜索和查看。

## 8. 长期记忆

### 8.1 允许保存

- 用户显式偏好：语言、回答格式、默认 Scope；
- 稳定身份信息：仅用户主动提供且允许保存；
- 长期项目决定：必须引用 Commit/MR/消息；
- 未完成任务：有状态、责任人和过期时间。

### 8.2 不自动保存

- 模型推断的性格、健康、财务和敏感身份；
- 一次性问题或临时情绪；
- 未合并草稿中的项目事实；
- 其他用户私人聊天；
- 没有来源的模型结论。

自动提取先写 `candidate`。高置信、低风险偏好可以自动启用但必须在“记忆管理”中可见；项目决定、身份和敏感内容要求用户确认。事实变化使用 supersession 链，不覆盖旧记录。

### 8.3 检索与注入

```text
scope/permission filter
  -> PostgreSQL FTS + pgvector
  -> RRF
  -> relevance + recency + importance + usage decay
  -> 去重和冲突检查
  -> max entries + max tokens
  -> 注入用户消息尾
```

默认最多 8-10 条，且有总 token 上限。低于相似度阈值、已过期、被 supersede、来源无权访问或相互冲突的记忆不能静默注入。

## 9. 新对话、历史和搜索

新对话创建新的 `conversation_id`，清空最近消息和临时摘要，但保留当前项目/分支 Scope；不会自动携带旧对话完整内容。需要时通过历史检索取回相关消息。

V1 提供：

- 新建、自动命名、重命名、置顶、归档、删除对话；
- 最近对话按日期分组；
- 按标题、消息、项目、文件、分支、日期和模型筛选；
- 搜索结果跳到具体 message_id，并展示命中片段；
- 从任意消息分支新对话，记录 parent conversation/message；
- 查看一次 AI 回答实际读取了哪些文件、Chunk、历史消息和记忆；
- 将 AI 回答或 Patch 明确加入草稿，聊天本身默认私有。

对话搜索使用 PostgreSQL FTS + 摘要/消息 Embedding；向量结果必须回到原消息。匿名对话保存在 IndexedDB，登录后由用户选择是否迁移。

## 10. 前端

右侧助手头部：

```text
[新对话]  对话标题                         [历史]
范围：[当前文件 + 项目检索 ▼]   分支：我的草稿
```

历史 Sheet：搜索、最近对话、项目/日期过滤、置顶和归档。回答下方提供“查看上下文”，列出文件、引用、历史消息、长期记忆及 token 预算。长期记忆管理页允许编辑、禁用、删除、查看来源和历史版本。

压缩是后台行为，UI 只显示“已压缩较早对话，可查看原文”，不把摘要伪装成用户消息。Resume 时优先恢复最后完整状态；检查点损坏则回退扫描原始事件日志。

## 11. 安全与隐私

- 所有查询先做 user/project/branch 权限过滤，再做向量搜索；
- 项目无法解析时禁止注入长期项目记忆；
- 公共项目内容和私人聊天使用不同索引/过滤域；
- 记忆与摘要生成前脱敏凭据、Token、Cookie 和私钥；
- `context_snapshot` 只记录引用 ID 和预算，不复制敏感原文到日志；
- 删除用户数据时同步处理消息、记忆、向量、缓存和 OSS 派生物；
- 管理员不能默认读取私人 AI 对话，只有合规流程和审计授权才能访问；
- 第三方 Memory MCP 默认关闭，启用前必须评估数据流向和删除能力。

## 12. 评测

| 指标 | 目标问题 |
| --- | --- |
| Memory Recall@K | 应记住的信息能否被找到 |
| Memory Precision | 注入内容是否真正相关 |
| Stale Injection Rate | 过期/被替代记忆是否错误进入上下文 |
| Cross-Scope Leakage | 是否出现跨用户/项目/分支泄漏，目标必须为 0 |
| Compression Fact Retention | ID、数字、日期、决定、引用和待办压缩后是否保留 |
| Tool Pair Integrity | tool call/result 是否始终成对 |
| Resume Fidelity | Resume 后任务、分支和未完成状态是否一致 |
| Citation Traceability | 回答是否能回到原始文件或消息 |
| Token/Latency/Cost | 记忆和压缩收益是否大于额外成本 |

Golden Set 覆盖偏好更新、事实 supersession、同名项目、无 Scope、跨项目攻击、长工具结果、多次压缩、损坏检查点、删除记忆、匿名转登录和旧对话搜索。

当前已提供 `lib/services/memory/memory-evaluation-service.ts` 的确定性脱敏评测器与契约，先覆盖 Recall、Precision、Stale Injection、Compression Fact Retention、Resume Fidelity 和成本口径；生产标注集与跨设备真实 Resume 仍需接入后再报告真实准确率。

## 13. 分阶段实现

V1：原始对话持久化、新建/历史/搜索、项目 Scope、最近窗口、结构化摘要检查点、上下文查看器、匿名 IndexedDB、登录迁移、用户删除。

V1.5：长期记忆候选、用户确认、supersession、混合检索、注入预算、项目隔离和评测。

V2：主动 compress/decompress/search-context 工具、对话分支、大对话 Resume 优化、异步两阶段记忆 consolidation 和外部 Memory MCP 适配。

在 V1/V1.5 评测通过前，不宣称“永不忘记”或“最强记忆”。正确承诺是：原始历史可恢复、相关历史会被检索、记忆作用域可审计、失败不会伪装成功。
