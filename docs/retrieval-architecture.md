# 高标准检索、GraphRAG-lite 与微上下文架构

> 目标：借鉴公开的企业检索实践，构建可追溯、可评测、可渐进部署的研究检索系统。本文定义的是本项目的目标架构，不声称等同于任何公司未公开的生产实现。

## 1. 结论

本项目不采用“固定长度 Chunk + 单向量 Top-K + 模型直接回答”的简化 RAG。目标链路为：

```text
文档理解
  -> 分层 Chunk 与父子结构
  -> 上下文增强索引
  -> 元数据/权限预过滤
  -> BM25 + Dense Vector + Graph 候选召回
  -> RRF 融合
  -> Reranker 精排
  -> Parent Retrieval 与去重
  -> 微上下文投影
  -> 模型回答 + 原始引用 + 结论状态
  -> 评测、反馈、索引更新
```

“最佳”取决于语料、语言、时效、成本和评测结果。上述方案是本项目在企业、政策、竞品和网页研究场景中的高标准目标；只有通过 Golden Set 和真实资料评测，才可以决定是否保留向量、Reranker、Graph 或更高级组件。

### 当前代码状态

当前已实现的是该链路的受限子集，而不是完整混合检索：

- `source_chunk` schema 有正文/上下文 FTS GIN 索引；PostgreSQL `SearchService` 通过仓储执行参数化 `to_tsvector`/`plainto_tsquery`，在 SQL 内过滤 `active` 来源和报告范围，内存仓储或查询异常时确定性降级为关键词评分。`ArtifactSourceIndexService` 已将 ready 文本解析产物按 owner/project/branch 权限和内容哈希写入 `source`/`source_chunk`，索引可重建且不覆盖原件；
- 命中会带 Parent Section 与相邻 Chunk；`contextual_prefix` 参与 PostgreSQL FTS 表达式，`heading_path` 继续由应用层关键词层补充，没有导入流水线自动生成它们；
- `GraphService` 只做报告内、有来源边、深度 2、最多 12 条路径的 BFS；没有图谱写入 API 或图谱 UI；
- `ContextProjectionService` 在每次助手请求重组当前报告、规则、选区或检索证据；无命中时返回拒答原因；
- pgvector、远程 embedding、RRF、远程 rerank、索引重建和 Golden Set 尚未接入应用。已独立验证的 Cloudmist API 只能说明 Provider 协议可用，不能说明工作台已有语义检索。

## 2. 公开参考方向

| 公开方向 | 可借鉴的机制 | 本项目采用方式 |
| --- | --- | --- |
| Anthropic Contextual Retrieval | 为每个 Chunk 附加文档/章节语义上下文，再进行关键词与语义检索 | 将标题、父章节、企业、政策、时间、来源范围拼入索引文本 |
| Microsoft GraphRAG | 实体关系、多跳问题、全局摘要和社区视角 | 使用 PostgreSQL `entity`/`relation_edge`；只用于跨对象问题 |
| 企业搜索系统 | 混合检索、元数据过滤、权限过滤、语义重排和引用 | 过滤优先，BM25/向量并行召回，Rerank 后返回引用 |
| Agent Harness | 按任务投影最小上下文，而不是加载全部历史 | 每轮模型调用都构造受控 Context Projection |

公开参考不代表复制其私有代码、训练数据或生产规模。

## 3. 文档理解与分层 Chunk

### 3.1 文档树

```text
Document
  -> Part / Chapter
    -> Section
      -> Paragraph / Table / Figure
        -> Evidence Span
```

每个 `source_chunk` 至少保存：

```text
source_id, source_hash, document_title, heading_path,
page_number, ordinal, language, captured_at, effective_at,
scope, original_text, contextual_text
```

### 3.2 切分规则

- 优先按标题、段落和表格边界切分，不按固定字符数硬切；
- 中文正文建议以约 300-900 个汉字为目标范围，过长章节再按自然段拆分；
- 表格单独保留列头、行名与页码，不能拼进相邻自然段；
- 每个 Child Chunk 能回到 Parent Section、原始页码和原文位置；
- 仅在章节连续语义确有断裂风险时使用小范围重叠，避免索引内重复泛滥。

### 3.3 Contextual Retrieval

索引文本不只有 Chunk 原文，还会附加短上下文：

```text
文档：十五五规划纲要
位置：第七篇 / 第二十二章 / 第一节
主题：跨境电商、数字贸易、海外仓
来源：中国政府网
发布时间：2026-03-13

Chunk 原文：……
```

该上下文用于关键词索引和向量嵌入，减少脱离章节后“这一段在讲什么”的信息损失。最终引用仍必须指向原文，而不是该模型生成的上下文描述。

## 4. 多路检索

### 4.1 过滤先行

所有检索先限制：

```text
workspace
-> 来源范围（domestic/global/global_or_unknown）
-> 语言
-> 文档状态、版本和生效期
-> 用户指定的企业/报告/政策对象
```

个人版当前没有多租户，当前 schema 也尚未写入 `workspace_id`；若未来需要工作区隔离，应先通过迁移明确该数据边界，不能假定它已存在。

### 4.2 召回与融合

| 路径 | 解决的问题 | 初版实现 |
| --- | --- | --- |
| PostgreSQL FTS / BM25 | 企业名、产品名、政策章节、日期、原句、价格等精确检索 | `source_chunk_contextual_fts_idx`（正文+上下文前缀）+ 参数化 `to_tsvector`/`plainto_tsquery` 已接入；标题路径由关键词层补充，BM25 扩展按评测决定 |
| Dense Vector | 同义表达、跨语言概念、自然语言研究问题 | 已有 `gemini-embedding-2-preview` 的有界运行时召回；pgvector 持久化待实现，本机 BGE-M3 是可选离线 Worker |
| GraphRAG-lite | 企业—产品—行业—竞品—政策—来源的多跳关系 | schema 与有界内存 BFS 已实现；写入、API 和 UI 待实现 |
| Parent Retrieval | 命中小段后补足其所属章节上下文 | 已实现：返回父章节与相邻 Chunk |

混合召回的推荐流程：

```text
FTS top 60
  + Dense Vector top 60
  + Graph 关联来源候选
  -> RRF 融合与去重
  -> Reranker top 50 -> top 8
  -> 展开 Parent Section
  -> 组装证据包
```

RRF（Reciprocal Rank Fusion）只合并不同检索器的排名，不直接比较不可比的 BM25 与向量分数。

### 4.3 Reranker

Reranker 输入是“用户问题 + 候选 Chunk”，用于从粗召回的几十条候选中挑出最值得进入上下文的少量证据。

- 目标默认：`qwen3-rerank` API 对融合后的候选精排；
- 目标降级：`429`、超时或 `5xx` 时依次尝试 `Pro/BAAI/bge-reranker-v2-m3` 与 `BAAI/bge-reranker-v2-m3`；
- 目标最终降级：所有远程 Reranker 都失败时，保留 RRF/元数据排序并明确标记 `degraded`；
- 不在 2 GiB 云服务器本地常驻大型 Cross Encoder；
- Reranker 只决定相关性，不能替代来源可信度、时间过滤和引用校验。

## 5. GraphRAG-lite

### 5.1 适用问题

```text
“慧策、店小秘、易仓分别与哪些十五五政策章节相关？”
“某企业产品、竞品、价格压力和来源之间有什么关系？”
“这条结论依赖哪些官网自述和哪些政策原文？”
```

普通单文档问答、选区解释和精确政策检索不需要 GraphRAG。

### 5.2 数据模型

```text
entity(id, type, canonical_name, aliases, status)
relation_edge(id, from_entity_id, to_entity_id, relation_type,
              source_id, citation_id, confidence, confirmation_status)
```

关系状态只有：

- `manual`：用户手工建立；
- `model_candidate`：模型提出，尚未确认；
- `confirmed`：有来源证据且用户确认。

模型候选关系不能作为最终事实写入报告。

## 6. 微上下文注入（Context Projection）

微上下文注入不是另一套检索器，而是检索结束后的任务级上下文组装。

```text
任务：比较慧策与店小秘的跨境竞争压力
对象：慧策 / 旺店通跨境 ERP / 店小秘
规则：官网资料标记为企业自述；没有公开价格不得猜测具体金额
结构化关系：竞争、产品覆盖、政策关联
证据：精排后的原文 Chunk、页码、URL、抓取时间
输出契约：结论必须区分 fact / inference / needs_verification / conflict
```

关键 ID、来源时间、企业名、政策章节、价格、日期与结论状态来自结构化记录，不依赖摘要。每轮请求重新投影当前需要的事实，避免历史压缩后丢失关键限定条件。

## 7. 在线检索 API 与本地 BGE-M3

当前线上运行时使用远程 API，使 2C2G 服务器在用户电脑关机时仍能完成有界语义检索：

```text
source_chunk / query
  -> gemini-embedding-2-preview (3072 dimensions)
  -> PostgreSQL pgvector
  -> qwen3-rerank
  -> BGE reranker fallback
```

API Key 只从进程环境读取。Embedding 与 Reranker 使用独立配置，避免未来更换其中一个模型时重建另一部分链路。迁移 `011_pgvector_optional.sql` 会始终加入向量元数据（模型、维度、版本、输入文本哈希和状态），只有数据库能提供 `vector` 扩展时才动态加入真实向量列和 HNSW/IVFFlat 索引。`PGVECTOR_ENABLED=auto`（默认）先探测扩展和列，`PGVECTOR_ENABLED=disabled` 可强制关闭；`PGVECTOR_WRITE_ENABLED=true` 才允许索引 Worker/批处理写入，用户检索不会隐式开启批量写入。

### 7.1 BGE-M3 本地 GPU 回退

BGE-M3 是适合本项目的多语言检索模型候选，可提供 Dense、Sparse 和 Multi-Vector 表示。初版只将其用于 Dense Embedding；Sparse/Multi-Vector/ColBERT 类能力需在评测显示收益后再启用。

```text
本地有 GPU 的开发机
  -> BGE-M3 Embedding Worker
  -> 生成或更新 source_chunk embeddings
  -> 写入 PostgreSQL pgvector

2C2G 云服务器
  -> 保存向量、执行过滤/相似度查询、调用外部模型
  -> 不加载 BGE-M3 权重
```

运行策略：

- `device=auto`，优先 CUDA；GPU 可用时启用 `fp16` 与批处理；
- GPU 不可用时允许 CPU 离线批处理，但不把 CPU Embedding 放在用户交互请求路径；
- 每条向量记录保存 `embedding_model`、维度、索引版本和文本哈希；
- 原文、Chunk 策略、上下文前缀或模型版本变化时，旧向量失效并进入重建队列；
- 向量模型和重排模型均通过 Provider 接口隔离，方便本地 GPU 与外部 API 切换。

在接入前应先检测本地 GPU、显存、CUDA 与模型权重位置，不能假设任意机器都能运行 BGE-M3。

### 7.2 当前 Dense + RRF 实现边界

现有 `DenseRetrievalService` 已接入搜索路径：默认优先按报告、active 来源、模型、维度、向量版本和逐 Chunk 文本哈希读取 pgvector；命中后再与关键词排名使用 RRF。没有持久化命中时，对当前工作区最多 48 个 `active` Chunk，将 `query + contextual embedding text` 发给配置的 Embedding Provider，按余弦相似度生成临时 Dense 排名。显式打开 `PGVECTOR_WRITE_ENABLED` 时，本次成功计算的 Chunk 向量会按同一元数据契约写回数据库，失败不会影响当前结果。

这是“可选持久化 + 确定性降级”的路径，而不是强制要求香港 2C2G 安装扩展。没有配置 Key、模型返回异常、扩展/列未安装或迁移不完整时，服务保留 FTS/关键词排序并标记 `dense=degraded`；已有向量的模型、维度、版本或输入文本哈希不匹配时绝不混用。向量 SQL 同时过滤 `source.state='active'`、报告 ID、允许的 source ID 和期望哈希，应用层还会二次确认返回的 Chunk 属于当前快照。扩展存在但没有 ANN 索引时允许受限精确扫描，并在能力结果中说明原因。

### 7.3 可选 pgvector 迁移与运行契约

| 场景 | 能力结果 | 行为 |
| --- | --- | --- |
| 标准 `postgres:16-alpine`，没有扩展 | `available=false`、`indexKind=none` | 迁移成功，FTS/关键词结果继续可用；不发送向量 SQL |
| 扩展与 `embedding` 列存在，写入关闭 | `available=true`、`canWrite=false` | 读取已完成向量；没有命中时回到临时 Dense 或确定性降级 |
| 扩展、列和写入开关均存在 | `available=true`、`canWrite=true` | 受控批处理按版本/哈希写入并可持久化复用 |
| 扩展刚被卸载或列被回滚 | 探测失败/`degraded` | 捕获 SQL 错误，保留 FTS，不把空结果当成语义无关 |

`source_chunk.embedding_text_hash` 覆盖 contextual prefix、标题路径和正文；任何这些输入变化都必须产生新版本或将状态置为 `stale`。向量写入契约不会删除历史正文，也不会跨 `report_id`、`source_id` 或权限 Scope 查询。

本地 worker 的运行、离线约束和切换配置见 [local-bge-m3-worker.md](local-bge-m3-worker.md)。

## 8. 检索评测与上线门槛

检索系统没有评测就不能称为“最佳”。初始 Golden Set 至少覆盖：

- 精确公司/产品/日期检索；
- 中文政策章节定位；
- 同义表达与跨语言问题；
- 跨企业竞品关系；
- 官网自述与独立来源的区分；
- 过期网页、来源冲突、无公开价格；
- 应拒答的问题。

最低记录指标：

```text
Recall@K
MRR / nDCG
Citation coverage
Citation correctness
Abstention correctness
Conflict detection rate
Embedding / retrieval / rerank / model latency
每次报告生成的成本
```

只有当 Dense Vector、Reranker 或 GraphRAG 能在 Golden Set 上改善召回、引用正确率或拒答质量，且成本与延迟可接受时，才保留该组件。

## 9. 暂缓的高级技术

| 技术 | 暂缓原因 | 启用条件 |
| --- | --- | --- |
| Late Chunking | 需要兼容模型与更高索引成本 | 长文跨 Chunk 语义在评测中持续失败 |
| RAPTOR 摘要树 | 摘要可能丢失限定条件或引入错误 | 出现高质量全局综述需求，且原文引用仍可回溯 |
| ColBERT / Multi-Vector 大规模检索 | 索引体积和计算成本更高 | 资料规模、语言混合和复杂匹配超过 pgvector 能力 |
| Neo4j | 个人研究图谱规模小 | PostgreSQL 关系查询成为可测瓶颈 |
| 多 Agent | 研究任务尚可由受控单 Agent 路由完成 | 多来源长任务需要暂停恢复且单链路评测受限 |

## 10. 参考

- Anthropic, [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)
- Microsoft, [GraphRAG](https://microsoft.github.io/graphrag/)
- BAAI, [BGE-M3](https://github.com/FlagOpen/FlagEmbedding/tree/master/FlagEmbedding/baai_general_embedding)
- DeepSeek, [Responses API](https://api-docs.deepseek.com/zh-cn/guides/responses_api)
