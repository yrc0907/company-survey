# pgvector 可选持久化与降级契约

## 目标

这份文档定义 `source_chunk` 语义向量的可选持久化边界。香港 ECS 默认使用 `postgres:16-alpine`，不强制安装 pgvector；没有扩展时 PostgreSQL FTS、关键词排序和已有 RRF 仍可用。只有扩展、迁移列和运行开关全部满足时，才读取或写入持久化向量。

## 配置

```dotenv
# auto（默认）先探测数据库；enabled 要求扩展和列真实存在；disabled 强制停用
PGVECTOR_ENABLED=auto
# 只给索引 Worker 或显式批处理开启，交互检索不会默认写数据库
PGVECTOR_WRITE_ENABLED=false
# 输入正文/上下文改变或模型升级时递增该版本
PGVECTOR_EMBEDDING_VERSION=v1
```

未知的 `PGVECTOR_ENABLED` 值按 `disabled` 处理。配置只从服务端环境读取，HTTP 请求不能覆盖。

## 迁移行为

`db/migrations/011_pgvector_optional.sql` 的顺序是：

1. 无条件增加 `embedding_model`、`embedding_dimensions`、`embedding_version`、`embedding_text_hash`、`embedding_status` 和 `embedding_updated_at` 元数据列；这些列不依赖扩展。
2. 创建 `retrieval_vector_capability` 探测快照表和状态索引。
3. 在动态 SQL 中尝试 `CREATE EXTENSION vector`。缺少 control 文件或权限时只记录不可用，不让迁移失败。
4. 只有扩展真实存在时才动态创建 `source_chunk.embedding vector`。优先创建 HNSW，旧版扩展不支持时尝试 IVFFlat，两个索引都失败则保留受限精确扫描。

因此，在未安装扩展的标准镜像上执行迁移是安全的；不能把“迁移通过”解释为“向量能力已启用”。

## 写入契约

`upsertChunkEmbeddings` 只接受服务端生成的 `chunkId`、`sourceId`、模型、维度、版本、文本哈希和有限浮点数组。事务内每条更新均以 `id + source_id` 定位，并写入 `embedding_status='ready'`。写入前必须满足：

- 能力探测 `available=true` 且 `PGVECTOR_WRITE_ENABLED=true`；
- `vector.length === embedding_dimensions`，所有元素为有限数；
- `embedding_text_hash` 是 contextual prefix、标题路径和正文拼接文本的 SHA-256；
- 模型、维度、版本来自实际 Embedding Provider 响应，而不是客户端声明。

未满足任意条件时返回 `status=degraded` 和原因，不删除正文、不覆盖旧版本、不伪造写入成功。

## 查询与权限过滤

`searchSimilarChunks` 的 SQL 同时执行：

- `source.state = 'active'`；
- 调用方传入的 `report_id`（若有）和允许的 `source_id[]`；
- `embedding_status='ready'`；
- 模型、维度和版本匹配；
- `unnest(chunk_id[], text_hash[])` 成对匹配当前 Chunk 的期望哈希。

应用层还会把返回 ID 与当前 active 快照再次求交。这样即使旧向量、错误 source ID 或跨报告参数进入请求，也不能成为检索证据。当前个人版的权限 Scope 以报告/source 边界表达；未来多租户必须在 SQL 增加 workspace/member/RLS 过滤，不能依赖调用方自觉传参。

## 确定性降级

以下任一情况都不会返回空的“语义成功”：

- `PGVECTOR_ENABLED=disabled`；
- 扩展或 `embedding` 列不存在；
- 探测、查询或写入 SQL 异常；
- 模型/维度/版本/文本哈希不匹配；
- 没有持久化命中。

前四项返回 `dense=degraded` 并保留 FTS/关键词排序；最后一项允许当前有界 `DenseRetrievalService` 临时计算（最多 48 个 Chunk），临时计算失败同样返回 `degraded`。`indexKind=none` 仍可读取小规模向量，但能力结果会说明使用受限精确扫描。

## 运维检查

在目标服务器执行迁移后，可用以下只读查询确认能力，不输出任何密钥：

也可以直接运行仓库内的检查脚本（无扩展仍返回成功并打印 `available:false`；只有 `--require` 才将缺失视为失败）：

```bash
pnpm db:check:pgvector
pnpm db:check:pgvector -- --require
```

```sql
SELECT capability_key, extension_available, extension_version,
       vector_column_available, index_kind, reason, checked_at
FROM retrieval_vector_capability
WHERE capability_key = 'source_chunk';

SELECT column_name, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'source_chunk'
  AND column_name IN ('embedding', 'embedding_text_hash', 'embedding_version');
```

若结果显示 `extension_available=false`，这是受支持的降级状态，不需要修改香港 2C2G 的 PostgreSQL 镜像。只有资料规模和 Golden Set 评测证明收益后，才在独立备份和恢复点之后安装扩展并打开写入开关。
