# Research Workbench TODO

> 目标：先完成个人可部署版，再按评测决定是否增加高级检索组件。`[x]` 必须有代码、测试或可运行配置证据，不能用文档代替实现。

## 0. 项目与交付

- [ ] 初始化 Git 首次提交，并配置 GitHub `main` 与 Gitee `master` 双远端同步
- [x] 写入产品规格、交付规范、检索架构与开发护栏
- [x] 建立 `.env.example`，所有模型与搜索 Key 保持空值
- [ ] 配置双来源搜索路由：DeepSeek 原生 `web_search`、可选国内 Provider
- [ ] 配置 YMO `gpt5.6-Terra` 模型 Provider 与可选思考强度
- [ ] 在轮换后的服务器环境验证模型、搜索和视觉输入，不提交凭据

## 1. 前端工作台 V1

- [ ] 三栏桌面布局：资料库、报告编辑区、AI 侧边栏
- [ ] 企业、行业、竞品、政策对象的本地 Seed 与导航
- [ ] 新建企业/报告对话框、报告模板选择和表单错误状态
- [ ] Markdown 报告预览、可点击目录、章节锚点和全文搜索跳转
- [ ] 选中文字工具栏：问 AI、解释、补来源、改写
- [ ] AI 回答状态：未配置、思考、工具调用、完成、错误、重试
- [ ] 引用卡片：来源范围、URL、页码/段落、抓取时间与来源状态
- [ ] 改写 Diff、确认保存、版本时间线和回滚交互
- [ ] 个人级设置：模型状态、搜索范围、资料刷新和导出
- [ ] 桌面、平板、窄屏响应式与键盘快捷键 `Ctrl/Cmd+K`、`Ctrl/Cmd+S`

## 2. 数据与 API V1

- [ ] PostgreSQL schema：company、report、section、source、chunk、citation、revision、entity、edge、job
- [ ] 服务器端单账号认证与会话保护
- [ ] 企业/报告 CRUD API，带版本号与冲突拒绝
- [ ] 报告全文搜索 API，返回标题层级与段落定位
- [ ] URL/文本/PDF/图片来源导入 API，限制类型、大小、URL 与内网地址
- [ ] 原生文本 PDF 解析；扫描 PDF/图片走可配置视觉 Provider
- [ ] 来源快照、哈希、抓取时间、刷新与变化检测
- [ ] 文本 Chunk、父章节、页码和引用写入
- [ ] 报告 Diff 与审计记录 API

## 3. RAG 与 GraphRAG-lite

- [ ] PostgreSQL FTS、来源范围/语言/时间/版本过滤
- [ ] Parent Retrieval：命中 Chunk 后返回父章节与相邻段落
- [ ] Contextual Retrieval：构造并保存结构化上下文前缀
- [ ] 关系图 CRUD：企业、产品、竞品、行业、政策、来源和结论
- [ ] 受限关系查询：深度、节点数、来源状态和返回字段均有限制
- [ ] RAG 回答必须携带引用、证据状态和拒答原因
- [ ] 选区问答走选区上下文，不做全库检索
- [ ] 微上下文投影：任务、对象、规则、结构化事实和精排证据包

## 4. BGE-M3 与高标准混合检索

- [ ] 检测本地 GPU、CUDA、显存与 BGE-M3 权重位置
- [ ] BGE-M3 Embedding Worker：`device=auto`、GPU fp16、CPU 离线回退
- [ ] pgvector 与向量版本字段；文本/模型变化后失效并重建
- [ ] Dense 检索与 PostgreSQL FTS 并行召回
- [ ] RRF 融合、去重和元数据过滤
- [ ] 可配置 Reranker Provider；未配置时使用确定性降级
- [ ] Golden Set：精确、语义、多语言、关系、冲突、过期和拒答案例
- [ ] 记录 Recall@K、Citation Coverage、Citation Correctness、Abstention 与延迟
- [ ] 根据评测决定是否接入 BGE-M3 Sparse/Multi-Vector、Late Chunking、RAPTOR 或 ColBERT

## 5. 部署与运维

- [ ] Dockerfile 与 Docker Compose：Caddy、Web、PostgreSQL、文件卷
- [ ] Caddy HTTPS、单账号保护、健康检查和安全响应头
- [ ] Ubuntu 2C2G 优化：1 GiB swap、PostgreSQL 内存限制、上传大小限制、容器资源限制
- [ ] 本地构建镜像或 CI 构建，避免在 2 GiB 服务器构建 OOM
- [ ] 服务器 `.env` 配置、密钥轮换、模型/搜索连通测试
- [ ] 数据库与上传文件定期备份、恢复演练、磁盘和流量告警
- [ ] 安全组检查：SSH 来源限制、仅开放 80/443、域名与 DNS 配置

## 6. 验收

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] 服务与 API 契约测试
- [ ] 浏览器 E2E：新建企业 -> 导入来源 -> 检索 -> 引用 -> 改写 Diff -> 保存版本 -> 导出
- [ ] RAG Golden Set 评测与无证据拒答验证
- [ ] Docker Compose 启动、健康检查、备份恢复与低内存回归
- [ ] GitHub/Gitee 双远端均同步到最新已验证提交
