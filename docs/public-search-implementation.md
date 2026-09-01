# 全站公开搜索实现

## 范围

`GET /api/platform/search?q=...&limit=...` 是公开入口，返回三类结果：项目、作者和公开文档。结果只带标题、短摘要、项目定位和作者定位，正文仍通过项目详情接口按公开权限读取。

PostgreSQL 模式使用参数化 `plainto_tsquery('simple', ...)` 与 `ILIKE` 双路径。每个查询分支先限定 `knowledge_project.visibility = 'public'`、`status = 'published'`；文档只查询默认保护分支的最新 `document_revision`，删除节点、草稿分支和私有项目不会进入结果。`ILIKE` 是中文分词或短词查询的确定性兜底，不接受 SQL 片段。

本地未配置 `DATABASE_URL` 时，服务只返回明确的 typed seed，响应带 `source: "typed_seed"`；不能把浏览器内存过滤或 seed 统计说成生产搜索。

## 失败与边界

- `q` 为空或超过 120 个字符：返回 `400 / VALIDATION_ERROR`。
- `limit` 不是整数：返回 `400 / VALIDATION_ERROR`；服务端将有效值限制在 1-100。
- 数据库或查询失败：返回 `500 / SEARCH_UNAVAILABLE`，不泄露 SQL、连接串或私有对象路径。
- 搜索结果不会返回 `content_text` 全文、邮箱、草稿分支或来源血缘字段；详情跳转必须再次经过项目公开权限。

## 验证

契约测试：`lib/services/platform/global-search.contract.ts`。它覆盖项目/作者命中、空查询和非法数量；PostgreSQL 生产验收还应抽样验证私有项目、草稿文档和删除节点不可命中。
