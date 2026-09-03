# 企业完整 Markdown 导入

当前首发研究内容采用“一家公司 = 一个项目 = 一个根级 Markdown 文件”。仓库中的七份报告位于 `docs/enterprise-research/`，不再按章节拆成文件夹。

## 导入行为

`pnpm enterprise:dossier-import` 需要服务器 `.env` 中的 `DATABASE_URL`，由发布人员在服务器执行。脚本会：

1. 将七个固定项目恢复或创建为 `public/published`；
2. 将旧文件夹、章节和来源的公开文件树节点标记为删除（审计和来源表不删除）；
3. 为每个项目创建一个根级 `*-2026独立研究.md` 节点；
4. 将完整 Markdown 原文写入 `document_revision`，并保存 SHA-256、Commit 和归因；
5. 重复执行时按固定 Commit 和内容哈希幂等跳过，不创建重复用户或虚假社区数据。

## 验收

```bash
pnpm enterprise:dossier-import
```

执行后只读检查：

```sql
SELECT p.id, p.visibility, p.status, ns.name, n.kind
  FROM knowledge_project p
  JOIN knowledge_branch b ON b.project_id = p.id AND b.name = p.default_branch_name
  JOIN knowledge_node_state ns ON ns.project_id = p.id AND ns.branch_id = b.id AND ns.deleted_at IS NULL
  JOIN knowledge_node n ON n.id = ns.node_id
 WHERE p.id IN ('project-huice','project-weaver','project-sangfor','project-sundray','project-muyuan')
 ORDER BY p.id;
```

预期每个项目只有一个公开文件树节点，`kind=markdown`，名称对应报告文件。`source`、旧 Revision 和审计 Commit 仍保留在数据库中供 AI 检索和历史追溯，但不会作为文件树重复展示。iCourt 使用固定 `project-icourt`/`report-icourt`/`branch-icourt-main` 标识；语核使用 `project-yuhe`/`report-yuhe`/`branch-yuhe-main`。

导入前必须执行 PostgreSQL + OSS 成对备份。脚本只处理固定五个项目 ID，不接受通配符，也不会删除用户、评论、阅读、Star 或关注记录。
