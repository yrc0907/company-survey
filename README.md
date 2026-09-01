# Research Workbench

个人部署的企业、行业、竞品和政策调研工作台。

## 状态

当前处于产品规格阶段，尚未初始化前端或部署服务。实现目标是一个可在个人服务器运行的研究工具，而不是一个通用聊天站或不受控网页自动化工具。

## 核心能力

- 新建企业、行业、竞品和政策调研报告；
- 导入网页、PDF、图片和手动文本，并保留来源与引用位置；
- 对报告、来源和政策进行全文检索、RAG 问答与跨对象关系查询；
- 选中文字向 AI 提问，获得解释、补充来源或改写 Diff；
- 将结论标记为事实、推断、待核验或冲突；
- 保存报告版本、回滚、导出 Markdown/PDF；
- 进行企业横向比较与关系图浏览；
- 手动刷新来源，提示可能过期的结论。

## 范围边界

- 仅供个人使用，但公网部署仍需单账号保护。
- AI 仅能访问本项目的调研工作区，不能读取服务器任意文件或执行任意操作。
- 联网搜索与模型调用通过可配置 Provider 完成；未配置 Key 时必须显示未配置状态。
- 初版不包含团队协作、分享链接、自动外发、浏览器绕过、复杂 Agent、任务队列或 Kubernetes。

## 文档

- [产品规格](docs/product-spec.md)
- [开发护栏](AGENTS.md)
- [交付、Git 与模型集成规范](docs/delivery-and-integrations.md)
- [高标准检索、GraphRAG-lite 与微上下文架构](docs/retrieval-architecture.md)
- [开发 TODO](TODO.md)

## 目标部署

```text
Caddy/Nginx
  -> Next.js Web/API
  -> PostgreSQL
  -> 受控文件卷或 MinIO
  -> 搜索 Provider
  -> 模型 Provider
```

技术栈和阶段划分见 [产品规格](docs/product-spec.md)。
