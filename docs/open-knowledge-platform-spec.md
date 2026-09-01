# 开放知识协作平台产品与架构规格

> 状态：目标产品规格，尚未实现。当前已上线的 Research Workbench 保持为个人调研工具和首个参考应用，不能把本文功能描述成已交付能力。

## 1. 产品定义

平台面向公开研究报告、行业资料、政策解读和可验证知识协作。核心闭环是：

```text
公开浏览与搜索
  -> 阅读项目、文件、引用和版本
  -> 用户或 AI 在个人草稿中提出修改
  -> 提交合并申请
  -> 项目维护者审核 Diff、来源和风险
  -> 合并到公开主版本
  -> 永久保留贡献者、审核者、版本与引用血缘
```

平台不是“所有人直接修改同一份正文”，也不是普通投稿网站。任何公开内容都必须能回答：谁提出、依据什么、谁审核、何时合并、被哪些内容依赖。

## 2. 产品原则

- 公开内容默认可读，公开页面不要求登录；
- 游客可使用有限额 AI，也可创建本地草稿；提交审核时必须登录；
- 登录用户修改他人项目时只生成个人分支，不能直接写入公开主版本；
- AI 只能回答、审查和生成 Patch，不能批准或自动合并；
- 正式版本、Commit、Review、Merge 和 Attribution 均不可变；
- 引用、作者、上传者和贡献者是不同身份，不能相互覆盖；
- 被拒绝的修改不进入公开正文，但提交者仍可在个人空间查看记录；
- 公开上传必须有许可证、举报、下架、审计和数据删除边界。

## 3. 角色与权限

| 角色 | 公开阅读/搜索 | AI 问答 | 创建草稿 | 提交合并申请 | 审核 | 合并 | 项目设置 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 游客 | 是 | 限额 | 浏览器本地 | 登录后 | 否 | 否 | 否 |
| 注册用户 | 是 | 是 | 服务器持久化 | 是 | 否 | 否 | 否 |
| 贡献者 | 是 | 是 | 是 | 是 | 可评论 | 否 | 否 |
| 维护者 | 是 | 是 | 是 | 是 | 是 | 是 | 部分 |
| 所有者 | 是 | 是 | 是 | 是 | 是 | 是 | 全部 |
| 平台管理员 | 是 | 受审计 | 不代写 | 不代提交 | 仅治理 | 否 | 举报、封禁、下架 |

公开读权限与写权限必须分离。Caddy 不再使用全站 Basic Auth；应用会话保护写接口、私有草稿、审核和管理端点。

## 4. 核心领域对象

```text
User / Profile
KnowledgeProject
  -> ProjectMember
  -> KnowledgeNode (folder | document)
  -> Branch
  -> Commit
       -> CommitChange
  -> MergeRequest
       -> Review / ReviewThread
  -> Attribution
  -> Source / Citation / Claim
  -> ProjectActivity / Notification
AnonymousDraft
ModerationReport / ModerationAction
```

| 对象 | 关键职责 |
| --- | --- |
| `knowledge_project` | 公开知识项目、所有者、许可证、状态和主分支 |
| `knowledge_node` | 带稳定 ID 的文件夹或文件；移动/改名不改变身份 |
| `document_revision` | 文件的不可变内容快照；正文采用稳定 `block_id` |
| `branch` | 基于某个主版本创建的个人或团队草稿 |
| `commit` | 一次有作者、时间、说明和父版本的原子修改 |
| `commit_change` | 文件/Block 的新增、修改、移动和删除 |
| `merge_request` | 草稿分支合并到目标分支的申请、状态和检查结果 |
| `review` | 批准、要求修改、拒绝以及逐段评论 |
| `attribution` | 当前段落和历史内容的原作者、贡献者、审核者与合并来源 |
| `claim` | 可独立追踪的结论、证据状态与引用关系；V1 可只预留字段 |

禁止只保存 `updated_by`。每个可归因正文块至少保存 `block_id`、`origin_commit_id` 和 `last_touch_commit_id`；合并后通过 Attribution 索引查询完整贡献历史。

## 5. 核心流程

### 5.1 游客编辑与登录迁移

```text
游客打开公开项目
  -> 基于 main@version 创建浏览器 IndexedDB 草稿
  -> 新建/移动/编辑文件，AI 生成 Patch 后由游客确认加入草稿
  -> 自动保存本地变更与 base revision
  -> 点击“提交审核”
  -> 登录或注册
  -> 服务端校验 base revision
  -> 导入本地草稿为用户分支
  -> 显示 Diff 后提交 Merge Request
```

本地草稿迁移必须幂等。登录失败、刷新或跨页面跳转不能丢失内容；过期草稿需要提示重新基于最新主版本变基。

### 5.2 审核与合并

```text
贡献者提交 MR
  -> 自动检查引用、失效链接、AI 辅助标记、敏感内容和版本冲突
  -> 维护者逐文件/逐段评论
  -> 批准 / 要求修改 / 拒绝
  -> 合并前再次检查目标分支版本
  -> 单事务写入 Merge Commit、正式 Revision、Attribution 和 Activity
```

没有实时多人编辑时不引入 CRDT。V1 采用 `base_revision_id` 乐观锁与三方合并；结构化正文优先按稳定 `block_id` 合并，纯文本文件使用 diff3，无法自动解决的内容必须人工处理。

### 5.3 贡献署名

公开文件顶部展示主要作者和贡献者集合；章节边缘显示最后贡献者；“贡献追踪”模式逐段显示：

```text
张三创建 · Merge Request #28 · 李四审核并合并 · 2026-09-01
```

AI 不作为人类贡献者。界面显示“张三提交 · AI 辅助生成 · 李四审核”，责任仍归提交者和审核者。文件删除后 Attribution 仍保存在历史版本中。

## 6. 登录注册

Auth.js 负责 Provider、Session、Cookie、CSRF 与 OAuth 流程，但不自动提供完整注册、找回密码和账号治理。

V1 登录方式：

- GitHub OAuth；
- 邮箱 + 密码；密码只保存 Argon2id 哈希；
- 邮箱验证、密码重置 Token、登录/注册限流；
- 用户名唯一，头像保存到对象存储；
- 第三方账号与密码账号可绑定到同一个用户；
- 管理员、维护者权限只来自数据库，不从客户端声明。

如果不提供邮箱，必须提供一次性恢复码，否则无法安全找回密码。手机号和 MFA 暂不属于 V1。

## 7. AI 与检索

AI 有三种明确模式：

1. `Ask`：只读取用户有权访问的已发布内容、当前草稿和引用；
2. `Contribute`：输出结构化 Patch，用户确认后写入个人草稿；
3. `Review`：检查引用缺失、限定条件删除、冲突、过期和风险，但不能批准 MR。

公开平台检索不能继续使用“最多 48 个 Chunk 的请求时临时向量”。目标链路：

```text
PostgreSQL FTS + pgvector 持久化 Dense
  -> 元数据/权限过滤
  -> RRF
  -> Reranker
  -> Parent Retrieval
  -> 带 Attribution 与 Citation 的证据包
```

索引任务由 PostgreSQL Job 表和独立 Worker 处理；规模和并发证明需要后，再引入专用队列或搜索服务。

匿名 AI 必须使用签名访客 Cookie、IP/设备限额、每日额度、并发限制和成本记录。匿名请求只能读取公开主版本，不能访问他人草稿。

## 8. 技术栈

| 领域 | V1 选择 |
| --- | --- |
| Web/API | Next.js、React、TypeScript |
| UI | Tailwind CSS、shadcn/ui、Radix UI、Lucide |
| 编辑器 | TipTap / ProseMirror，稳定 Block ID，Markdown 导入导出 |
| 认证 | Auth.js、GitHub OAuth、Credentials、Argon2id |
| 数据库 | PostgreSQL、迁移工具、RLS |
| 检索 | PostgreSQL FTS、pgvector、RRF、远程 Reranker |
| Diff | `diff-match-patch` 或 `jsdiff`；文本冲突使用 diff3 |
| 文件 | 阿里云 OSS；数据库只保存元数据、哈希与受控文本 |
| 限流 | Redis 或托管 Redis；单机内存限流不能作为公开生产方案 |
| 后台任务 | PostgreSQL Job 表 + 独立 Worker |
| 部署 | Caddy、Next.js、PostgreSQL、Worker；OSS/Redis 使用托管服务 |

V1 不使用 LangGraph、RabbitMQ、Temporal、Kubernetes、Neo4j、Yjs 或真正 Git 仓库。

## 9. V1 页面与路由

```text
/                              公开项目列表和全站搜索
/login  /register              登录注册
/u/[username]                  用户主页与贡献历史
/[owner]/[project]             项目内容
/[owner]/[project]/edit/[id]   草稿分支编辑
/[owner]/[project]/changes/[id] 合并申请与审核
/inbox                         审核、评论和通知
/settings                      账号与安全
/admin                         举报与内容治理
```

## 10. V1 必做与暂缓

V1 必做：公开列表、搜索、用户与头像、项目/文件树、草稿、Commit、Diff、MR、Review、Merge、段落署名、游客本地草稿、匿名限额 AI、通知收件箱、许可证、举报和管理员治理。

暂缓：实时多人编辑、Fork、研究悬赏、知识关系图、积分排行榜、私信、动态广场、组织空间、付费订阅和公开 API。

## 11. 迁移与交付顺序

1. 保持 `research.webyrc.com` 现有个人工作台可用，在独立分支和新子域开发；
2. 建立用户、项目、文件树、权限和 Auth.js；
3. 建立不可变 Revision、Branch、Commit、MR、Review 和 Attribution；
4. 接入 TipTap 草稿编辑、本地游客草稿与登录迁移；
5. 改造检索为 PostgreSQL FTS + pgvector，并将 AI 输出改为 Patch；
6. 完成公开列表、个人主页、审核收件箱和内容治理；
7. 进行权限、冲突、匿名限流、移动端和公网安全 E2E；
8. 内测通过后再切换公开流量。

可信内测版预计需要约 7-12 个有效开发日；只有页面可点击的演示版可以更快，但不能据此声称多人协作、权限和合并机制已完成。
