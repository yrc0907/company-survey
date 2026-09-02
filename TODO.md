# Research Workbench TODO

> 本清单按当前工作区代码核对。`[x]` 代表已有源码、测试或可运行配置；`[~]` 代表有明确的部分实现但尚不构成完整用户闭环；`[ ]` 代表尚未实现或未做运行验收。不能用设计文档替代实现证据。

> 公开平台的真实用户、黑白灰 UI、文件预览、评论楼中楼、图片/GIF 附件、作者主页、关注/收藏/点赞、活动通知和全站搜索的产品字段与统计口径，统一以 [真实用户开放知识平台 UI、评论、搜索与数据规格](docs/public-knowledge-platform-ui-and-data-spec.md) 为准。规格中的泛微网络、深信服资料必须先保存公开来源和哈希，再进入正式版本；不得用虚构用户或静态数字填充。

> AI 生成结果面板、统一成功/失败反馈、排序筛选规则、ICP 与香港部署参数见 [AI 生成面板与 ICP/香港部署决策](docs/generation-panel-and-icp-deployment.md)。

> 已验证的首页/项目交互、拖放和移动端 E2E，以及前后端性能边界记录在 [前后端性能与交互验收记录](docs/performance-and-e2e-verification.md)；后续优先复跑脚本，不重复人工点击。

## 下一步优先级

1. **P0: 收紧公网运维边界并建立备份。** HTTPS、Basic Auth、PostgreSQL 持久化和模型链路已上线；下一步限制 SSH 来源、删除无用 RDP 规则，并完成首轮异机备份与恢复演练。
2. **P1: 按开放知识平台规格重建身份、项目和协作边界。** 当前单用户 Basic Auth 不能承载公开阅读、用户草稿、MR、审核和贡献署名；先完成 Auth.js、项目/文件树、权限和不可变版本模型。
3. **P1: 补齐公开首发数据。** 以可核验的企业官网、年报/公告、政策原文和公开访谈建立多项目资料包；每条事实保留来源、抓取时间、哈希和证据状态。
4. **P2: 落地 shadcn/ui 公开首页与项目工作区。** 第一屏是列表和搜索，项目页为文件树/正文/AI 三栏；动效只表达状态和空间变化。
5. **P3: 把有界运行时检索升级为公开平台的持久化检索。** 接入 PostgreSQL FTS SQL、pgvector、索引 Worker、权限过滤、向量版本和 Golden Set。

## 开放知识平台迁移（目标，尚未实现）

- [x] 完成开放知识平台产品、权限、版本、合并、署名和技术架构文档
- [x] 完成 shadcn/ui 页面、组件、响应式、状态和动效规范文档
- [~] Auth.js 邮箱/密码注册、登录和 Session/RBAC 校验已实现；GitHub OAuth 可配置状态已公开，邮箱验证与找回密码仍待接入真实邮件 Provider
 - [~] 接入阿里云企业邮箱真实发信：SMTP 适配器、验证邮件/密码找回/登录验证码模板和超时边界已实现；仍需在服务器配置专用发件账号并做真实投递/退信联调，应用不得使用管理员密码
- [ ] 在 ESA DNS 区核验邮箱 MX、SPF、DKIM、DMARC 与发件域名对齐；邮件主机记录保持 DNS 解析，不走 CDN 代理，并记录投递成功率与退信原因
 - [~] 接入阿里云短信真实 Provider：签名“恒创联众”、模板 `100001`、验证码哈希/过期/消费、429/5xx 重试和挑战幂等键已实现；仍需按控制台 API 端点配置服务器并做最小额度联调，`AccessKey`/`appKey` 不进入代码、文档、镜像或日志
 - [~] 接入阿里云图形验证真实服务端校验：前端票据桥接、服务端场景校验和 fail-closed 边界已实现；仍需配置真实校验端点并联调票据过期/重复/超时
- [x] 邮箱/手机号字段、唯一约束、验证时间、绑定/换绑状态机、跨账户冲突拒绝和追加式审计查询已由 `021_identity_verification.sql`、`026_identity_binding_audit.sql` 与服务契约覆盖；跨账户合并仍明确禁止
 - [x] 建立统一 `verification_challenge` 数据模型和 API：邮箱/短信共用状态机，记录用途、哈希、过期时间、尝试次数、消费时间、请求 IP/设备哈希和供应商消息 ID，不保存验证码明文
 - [~] 增加验证码与登录风控：目标/IP/设备 HMAC 桶、60 秒重发、5 次错误上限和同响应防账号枚举已实现，PostgreSQL 迁移 `023_verification_rate_limits.sql` 提供原子兜底；异常封禁与公开规模 Redis 适配仍待接入
- [ ] 完成真实 Provider 沙箱/生产联调与回归：注册邮箱验证、邮箱验证码登录、手机号验证码登录、密码找回、绑定/换绑、过期/重复/错误验证码、图形验证失败和供应商 429/5xx
- [ ] 将真实认证配置写入香港 ECS 受限 `.env` 并通过发布脚本部署；上线前执行短信/邮件最小额度测试，失败时可切回密码登录，不得把密钥提交到双远端
- [~] Caddy 已只保护旧版 `/api/research/*`，公开读与平台写接口由应用会话/权限处理；完整公网身份治理仍待补齐
- [x] 建立用户、项目、成员、文件树、Branch、Commit、Revision、MR、Review、Attribution schema 与迁移（002/025 已在香港数据库执行并复核）
- [~] 建立 `uploaded_asset`、`ingestion_job`、`project_view_daily`、`project_stats` schema 与聚合任务；公开阅读统计已通过 `project_reader` + `project_view_daily` + `project_stats` 同步幂等聚合，项目评论数已由 `project_comment` 实时聚合，点赞/关注统计仍待实现
- [x] 接入 TipTap，正文 Block 使用稳定 ID，支持 Markdown 导入导出（`components/report-editor.tsx` 与 `tiptap-document` 契约已通过）
- [~] 登录后创建空白项目、创建私有草稿分支和 OSS 隔离上传入口已实现；真实账号上传正向 E2E 与解析后自动进入工作台仍待联调
- [~] Markdown/TXT/PDF/DOCX/PNG/JPEG 白名单、MIME magic、大小、哈希、重复检测、解析状态和幂等重试；解析 Worker 已支持文本/原生 PDF/DOCX，图片与扫描 PDF 进入 `needs_review`；ready 文本可通过受权限约束的索引接口写入 source/source_chunk
- [x] 原始上传文件不可变，可编辑派生正文与原始证据分离；`uploaded_asset.original_asset_id`、`ingestion_artifact` 和 source 索引契约已验证，向他人项目写入仍受个人分支/MR 权限约束
- [~] 游客 IndexedDB 草稿与防抖自动保存已实现并有契约；登录迁移回调、过期 base revision 变基 UI 仍待补齐
- [~] Diff、三方合并、冲突处理、审核和单事务合并；项目级楼中楼、段落锚点和图片/GIF 附件已完成，实时协同仍待实现
- [ ] 段落级贡献追踪、用户贡献历史和 AI 辅助标记
- [~] 公开首页、全站搜索（项目/作者/公开文档 API）、项目详情、编辑、审核、用户主页、收件箱和管理员页面；全站搜索 UI 结果面板与收件箱/管理员页面仍待补齐
- [x] 已执行迁移 `022_public_company_seed.sql`、`024_public_company_seed_additional.sql`、`025_public_research_file_tree.sql`；香港数据库已复核 12 个项目、12 个研究文件夹和 96 个章节文档
- [x] 建立公开首发数据包清单：慧策、泛微网络、深信服、信锐科技、有赞、纷享销客、金蝶、奇安信、安恒信息、启明星辰、钉钉、Lark，均记录项目 ID、来源 URL、摘要、SHA-256、来源类型、抓取时间和待核验边界
- [~] 十二个首发项目已具备公开 URL/摘要、来源元数据和 `needs_verification` 状态；年报/公告、公开访谈、价格、竞品与独立行业证据仍待后续资料包补充
- [~] 已通过迁移 `025_public_research_file_tree.sql` 为十二个首发项目建立研究文件夹和八类章节模板；章节正文仍需由真实来源导入并经审核，引用必须能回跳到来源和段落
- [~] 企业、产品、行业、竞品、政策与关系边已写入统一 entity/relation_edge 模型并由 GraphRAG-lite 查询；跨报告同名合并仍要求人工确认
- [~] 公开首发 manifest 校验脚本已加入（重复 ID/slug、HTTPS、来源类型、哈希格式、待核验边界和社区统计污染检查）；网络可达性、许可证人工确认与生产导入审批仍待补齐
- [x] 首页展示真实数据库项目和真实聚合统计；公网 E2E 已验证公开项目、来源和真实统计投影，空统计保持明确空状态
- [ ] 建立来源刷新与变更检测，企业官网/政策更新后生成待复核任务，不自动覆盖已发布正文
- [~] 首页列表式卡片展示 owner、published_at、main 最新合并、去重阅读、已合并贡献者、来源与 open MR；去重阅读已由真实 PostgreSQL 统计提供，作者主页、关注、项目级评论与段落锚点评论已完成，评论点赞仍待实现
- [~] 项目 Star 已完成真实用户唯一关系、GET/POST/DELETE API 和详情页反馈；作者主页、关注关系与 GET/POST/DELETE API 已完成，项目评论已完成，段落评论/评论点赞等社交功能仍待实现
- [~] 匿名 AI 已接入签名 Cookie、访客/IP 双桶限流和明确 429；Redis 共享限流、额度计费和跨实例滥用防护仍待接入
- [ ] 阿里云 OSS 文件/头像存储、许可证、举报、下架和审计
- [~] 私有 Bucket `reaserch` 已创建，ECS 已绑定 `research-oss` 且 IMDSv2 临时凭据状态为 `Success`；OSS SDK、预签名读写、隔离对象删除、所有者边界和 ECS 临时对象 Put/Head/Delete 已验证，目标 Bucket CORS、浏览器直传权限 E2E 仍待接入；解析 Worker 已实现租约、重试、明确待校对降级和 ready 文本的 source/source_chunk 索引接口
- [~] 默认头像已使用用户名首字符和稳定背景色；用户头像的 MIME/大小校验、EXIF 清理、WebP 派生和私有 OSS 受控访问仍待实现
- [~] PostgreSQL FTS、可选 pgvector、RRF、Reranker 降级和哈希驱动向量重建 Worker 已实现；大规模调度、ANN 线上重建和真实 Golden Set 仍待完成
- [~] 权限拒绝、版本冲突、署名一致性、移动端、Reduced Motion 和公网 E2E 已有契约/12 项公网 E2E；游客草稿迁移和完整署名回放仍待补齐
- [x] 审查 Codex、Claude Code、DeepSeek Harness、Headroom 与 Billion Context 本地快照，并形成记忆/压缩/会话架构文档
- [~] 建立 conversation/message/part/tool/checkpoint/summary/context_snapshot/ai_patch schema 和迁移；`message_part` 与完整 Resume 仍待补齐
- [~] 新对话、自动命名、历史列表、搜索、重命名、置顶、归档、删除与匿名 IndexedDB 迁移；跨设备迁移仍待验证
- [~] 实现当前选区/文件/文件夹/项目/全站 Scope 选择、权限过滤和上下文查看器；完整 UI 接线仍待补齐
- [~] 实现最近窗口、确定性 Tool Result 裁剪、结构化摘要检查点、工具配对保护、压缩失败回滚和连续失败熔断；自动触发策略仍待接入
- [~] 建立 memory_item/version/source、候选确认、supersession、有效期、混合检索、时间加权和注入 token 上限；pgvector 持久化仍待实现
- [~] 实现项目 Scope fail-closed、跨用户/项目/分支泄漏测试、记忆删除和敏感信息脱敏；删除清理任务仍待接入
- [x] 建立 Memory Recall/Precision、Stale Injection、Compression Fact Retention、Resume Fidelity 和成本 Golden Set（确定性脱敏夹具与契约已覆盖）

## 0. 项目与交付

- [x] Git 已初始化，`main` 已配置 GitHub `origin` 与 Gitee `gitee` 双远端
- [x] 写入产品规格、交付规范、检索架构与开发护栏
- [x] `.env.example` 保持 Key 为空，并将部署密码保留为占位符
- [x] 实现 OpenAI-compatible 模型 Provider、显式未配置降级和思考强度白名单
- [~] DeepSeek 原生 `web_search` 请求构造已存在；没有执行搜索的 Job、路由或来源落库
- [x] 实测 Cloudmist 模型目录、`gemini-embedding-2-preview` Embedding 与三种 Reranker API
- [~] 轮换后的服务器环境已验证模型、Embedding、Rerank 三个 Provider；原生联网搜索和视觉输入尚未作为完整用户闭环验收，且凭据未提交
- [x] 当前实现已提交为 `20229c7`，并同步到 GitHub `main` 与 Gitee `master`

## 1. 前端工作台 V1

- [x] 三栏桌面工作台：对象/报告导航、报告阅读编辑、证据型 AI 助手
- [x] 演示 Seed、企业/行业/竞品/政策导航及报告切换
- [~] 仅支持新建**报告**，有表单校验；尚无企业新建、模板选择或归档 UI
- [~] 章节编辑、可点击目录、锚点跳转和命令搜索已实现；不是 Markdown 渲染/编辑器
- [x] 选中文字工具栏：问 AI、解释、补来源、改写，并把选区交给受限上下文 API
- [~] AI 状态覆盖未配置、准备上下文、结果和错误；没有真实工具调用时间线、流式输出或重试策略
- [~] 已展示已有引用、来源 URL、页码和摘要；没有来源范围、刷新状态或引用编辑 UI
- [x] 当前报告可打开“添加文本资料”对话框，粘贴标题和正文后刷新来源列表；内存演示模式明确禁用
- [~] 保存会生成不可变 revision 且乐观锁拒绝冲突；没有 Diff、版本浏览、回滚 UI 或 API
- [~] 设置、来源刷新；Markdown 导出已通过公开投影完成，PDF 导出仍待实现
- [~] `Ctrl/Cmd+K`、窄屏 CSS 和 reduced-motion 已有；旧报告编辑器已接入真实 `Ctrl/Cmd+S -> onSave` 并有契约覆盖；公开平台正文仍是只读投影，键盘全流程和公开编辑器 E2E 待正文编辑 UI 挂载后验收

## 2. 数据与 API V1

- [~] PostgreSQL schema 已有 `company`、`report`、`report_section`、`source`、`source_chunk`、`citation`、`report_revision`、`entity`、`relation_edge`；尚无 `workspace`、`research_job`、迁移机制或生产数据初始化
- [x] PostgreSQL Repository、真实 `SELECT 1` 健康检查、内存演示 Repository 与统一接口
- [~] 报告创建/保存 API、版本冲突 `409` 和事务写入已实现；没有企业 CRUD、报告归档或删除 API
- [x] 已导入资料的受限搜索 API，返回命中、父章节和相邻 Chunk
- [x] 手动文本来源导入 API：输入上限、SHA-256、`active` 状态、连续 Chunk、PostgreSQL 事务写入与 memory_demo 拒绝
- [ ] URL/PDF/图片来源导入 API，以及 URL 重定向/DNS 级 SSRF 防护；现有 `assertSafeSourceUrl` 只是可复用校验函数
- [~] 原生文本 PDF、DOCX 解析、扫描 PDF/图片视觉解析边界、文件上传存储与任务状态；当前扫描件/图片不调用视觉模型，写入 `needs_review` 并允许显式重试
- [~] 手动文本已写入来源快照、内容哈希、时间和 `active` 状态；来源刷新、变更检测和状态迁移待实现
- [~] 手动文本已写入带偏移和上下文前缀的 Chunk；页码、文件解析、引用和图谱的写入流水线待实现
- [~] revision 数据已持久化；没有 Diff 计算、审计查询、回滚 API 或 UI
- [~] Auth.js Session、注册和项目授权 API 已实现；公开平台 Caddy 仅保护旧 `/api/research/*`，密码找回、邮箱验证和完整治理流程仍待实现

## 3. 当前检索、GraphRAG-lite 与上下文

- [x] PostgreSQL schema 已创建正文/上下文 FTS GIN 索引；Postgres `SearchService` 通过仓储执行参数化 `to_tsvector`/`plainto_tsquery`，仅召回 `active` 来源并限制报告；异常时公开确定性关键词降级
- [x] Parent Retrieval：搜索命中携带父章节和相邻 Chunk
- [x] `contextual_prefix` 已进入领域模型、演示数据、关键词评分和手动文本导入；URL/PDF/图片导入时的上下文生成待实现
- [~] `entity`/`relation_edge` schema 与有界 BFS 查询已实现；没有图谱写入、HTTP API、跨报告查询或图谱 UI
- [x] 图查询限制深度 2、最多 12 条路径，并过滤无来源或非 active 来源的关系边
- [~] RAG 助手把当前报告的命中证据、拒答原因和受限规则交给模型；模型回答中的引用格式尚未程序化校验
- [x] 选区问答只传选区和相关章节，不触发全库检索
- [x] Context Projection：每次请求重新投影任务、报告、规则、证据和受限图路径

## 4. 远程混合检索与 BGE-M3

- [x] 已实现最多 48 个 active Chunk 的远程 `gemini-embedding-2-preview` 临时 Dense 召回、余弦排名与 RRF；迁移 `011_pgvector_optional.sql` 提供可选 pgvector 持久化、能力探测、模型版本/维度/文本哈希校验和 FTS 降级
- [~] pgvector 向量列与 HNSW/IVFFlat 索引在扩展可用时动态创建；无扩展环境保持迁移成功，ANN 重建 Worker 和大规模评测仍待实现
- [x] 当前内存快照可执行关键词 + Dense RRF；PostgreSQL FTS 与可选 pgvector Dense 并行召回，向量 SQL 在报告/source/active/hash 范围内过滤，缺能力时确定性降级
- [x] 接入 `qwen3-rerank`：`429`、超时或 `5xx` 时依次尝试 `Pro/BAAI/bge-reranker-v2-m3`、`BAAI/bge-reranker-v2-m3`；均失败时确定性跳过重排
- [x] 检测本机 GPU、CUDA、显存和 BGE-M3 权重，创建 `device=auto`、CUDA fp16、CPU 离线回退、仅 loopback 的 Embedding Worker；当前缓存仅有 refs 指针，未加载权重
- [ ] BGE-M3 只在本机 GPU 作为可选离线 Worker 运行；线上 4C8G 服务器绝不加载模型权重，只保存向量、查询 PostgreSQL/pgvector 并调用外部 API
- [x] Golden Set：精确、中文政策、语义、多语言、关系、冲突、过期和无证据拒答案例（确定性评测器与契约已覆盖八类）
- [~] Recall@K、MRR、Citation Coverage、Abstention、延迟和成本计算器已加入确定性评测；真实线上运行指标采集仍待接入
- [ ] 根据评测决定是否启用 BGE-M3 Sparse/Multi-Vector、Late Chunking、RAPTOR 或 ColBERT

## 5. 部署与运维

- [x] Dockerfile、Compose、Caddy、PostgreSQL、命名卷、健康检查和部署预检脚本
- [x] Compose 中为 4C8G 设置 Caddy/App/PostgreSQL 内存与 CPU 上限；服务器实测已启用 4 GiB swap
- [x] 香港源站已解析并放行 `80/443`，Caddy 容器健康；`https://research.webyrc.com` 公网 `/healthz`、首页和 12 项 E2E 已通过
- [x] 服务器 `.env` 权限 `600`、轮换密码/Key 的运行时配置、模型/Embedding/Rerank 连通性、PostgreSQL seed 与 named-volume 持久化已验收
- [~] 已加入 `scripts/backup.sh`（PostgreSQL + uploads 成对备份、SHA-256 清单）、`scripts/health-check.sh`（容器/私有端口/公网 HTTPS）和 `scripts/release.sh`（备份→迁移→发布→验收）；首次异机复制、恢复演练与告警仍需在香港 ECS 人工执行
- [~] `scripts/aliyun-security-group.ps1` 默认只读计划，可显式确认后新增 80/443/指定 22；删除 3389、收紧 SSH 来源和默认安全组仍需人工变更
- [~] `3000/5432` 未对公网发布，`80/443` 已正确放行；仍需把 SSH `22` 限制到可信来源，并删除 Linux 实例不需要的公网 RDP `3389`

## 6. 验收

- [x] 服务契约测试覆盖保存、版本冲突、手动文本导入/重复拒绝/报告不存在、memory_demo 持久化拒绝、active 来源过滤、图边过滤、选区隔离、SSRF 基础拒绝和客户端快照裁剪
- [x] `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 已在提交 `20229c7` 前全部通过
- [~] 已在服务器 PostgreSQL 模式完成浏览器资料导入、混合检索、带引用 AI 回答，以及 API 保存/版本冲突验收；新建报告 UI、Diff 和导出待对应功能完成后纳入
- [x] Docker Compose 启动、`postgres/app/caddy` 健康检查、数据库 seed、4C8G 构建、源站持久化和 ESA 公网 HTTPS 均已验收
- [~] RAG Golden Set 与无证据拒答评测已通过确定性契约；Reranker 降级和向量重建仍待接入真实评测任务
