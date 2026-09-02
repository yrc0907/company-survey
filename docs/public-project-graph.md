# 公开项目关系图

公开项目详情的“关系图”Tab 是 GraphRAG-lite 的只读可视化投影，不是一个可随意编辑的图数据库。

## 数据边界

- 请求先通过 `PublicProjectService` 的 `public + published` 过滤，再将 `project-{name}` 映射到同名 `report-{name}`。
- 实体和关系只来自 `entity`、`relation_edge` 的该报告范围；不会用企业名称或模型输出跨项目猜测。
- 关系边的 `source_id` 必须命中同一报告的 `source.state = active` 才进入 `edges`，可在图上作为可引用关系展示。
- 来源缺失、来源已失效或来源不属于该报告的边进入 `pendingEdges`，界面显示“待核验”，不会参与事实连线或 AI 引用。
- 节点不返回 `attributes`，客户端只看到名称、实体类型、证据状态和来源摘要；原始来源仍按既有公开读取边界处理。

## HTTP 接口

```text
GET /api/platform/projects/{id-or-slug}/graph
```

匿名可读，返回：

- `projectId`、`projectSlug`
- `graph.reportId`
- `graph.nodes`：实体公开投影
- `graph.edges`：active 来源关系
- `graph.pendingEdges`：待核验关系
- `graph.note`：空图或待核验说明
- `source`：`postgres` 或 `typed_seed`

项目没有稳定 report 映射、没有实体，或没有 active 关系时，接口仍返回结构化空状态，不伪造节点、边或“关系发现成功”。

## UI 行为

- 节点支持鼠标和键盘 Enter/Space 选择，右侧显示实体类型、证据状态和来源。
- 搜索框只过滤当前项目实体，不触发全站检索，也不改变数据库事实。
- 可引用关系以实线展示；待核验关系折叠在图下方，以虚线边界和缺少来源提示区分。
- 新增或修订关系必须走草稿、Commit、审核和 Merge 流程；该 Tab 没有写入能力。

## 验证

`pnpm graph:contract` 覆盖：active 关系可见、无来源关系进入待核验、跨报告读取为空。构建、类型检查和 lint 也必须通过后才可部署。

