# 公开知识平台：真实数据、UI、协作与搜索规格

> 状态：V1 完整产品规格，作为 UI 和数据实现的唯一补充约束。
> 本文描述正式产品，不使用虚构用户、虚构阅读量或虚构贡献记录。所有公开用户、项目、评论、统计和文件都必须来自真实注册、真实上传、真实提交或真实合并事件。

## 1. 目标与边界

平台定位为“面向研究报告和可验证资料的 GitHub 式协作平台”。借鉴 GitHub 的发现、个人主页、关注、版本和审核模式，但不照搬代码托管功能。

核心闭环：

```text
真实用户注册
  -> 创建项目或上传资料
  -> 私有 OSS 原件 + PostgreSQL 元数据
  -> 解析为可阅读文档和来源
  -> 公开阅读、评论、收藏和关注
  -> 用户在草稿分支修改
  -> Commit / Diff / Merge Request
  -> 维护者审核并合并
  -> 版本、引用、贡献者和活动永久可追溯
```

### 1.1 不可妥协的真实数据规则

- 不生成“演示用户”、虚构头像、虚构粉丝或虚构贡献者。
- 不把静态 Seed 数字当作真实阅读量、点赞量或评论量。
- 初始公开内容只能来自用户有权发布的实际资料，或明确标记为平台官方公开资料。
- 没有数据时显示 `0`、`暂无` 或空状态，不用一个看起来真实的数字填空。
- 研究对象资料只记录公开可核验字段；价格、客户数、收入、市场份额、续费率等没有来源时保持 `needs_verification`，不得由模型补齐。
- PostgreSQL 是账户、项目、版本、评论、关系和统计事件的事实源；OSS 只保存原始文件和派生媒体对象。
- OSS Bucket 保持私有。公开阅读使用短期签名 URL 或私有回源，不把 Bucket 改成公共读写。

### 1.2 不属于 V1 的 GitHub 功能

Actions、Packages、Marketplace、Sponsors、代码扫描、代码依赖图、组织计费、私信和直播不进入 V1。它们与研究资料的核心闭环无关。

## 2. 信息架构与路由

```text
/                                      公开首页、全站搜索和活动摘要
/search?q=...                         全站搜索结果和高级筛选
/login                                登录
/register                             注册
/upload                               登录后上传资料并创建私有项目
/new                                  登录后创建空白项目
/u/[username]                         作者主页
/u/[username]/projects                作者发布的项目
/u/[username]/contributions           作者参与合并的贡献
/u/[username]/activity                作者活动时间线
/[owner]/[project]                    项目概览和文件工作台
/[owner]/[project]/file/[nodeId]     文件预览、引用和段落评论
/[owner]/[project]/changes             修改申请列表
/[owner]/[project]/changes/[id]        Diff、评论、审核和合并
/[owner]/[project]/discussions         项目讨论
/inbox                                 评论、关注、审核和系统通知
/settings                              账户、头像、隐私和安全
/admin                                 举报、下架、封禁和审计
```

所有页面都必须支持直接 URL 打开、浏览器后退/前进、刷新和权限失败提示。每一个看起来可点击的元素必须有真实跳转、弹窗、状态变化或明确错误反馈。

## 3. 视觉系统

### 3.1 黑白灰基调

整个界面使用中性黑白灰，不使用绿色作为品牌色、成功色或装饰色。必要的语义色只用于提示，不依赖颜色单独传达状态：

| Token | 值 | 用途 |
| --- | --- | --- |
| `--background` | `#FFFFFF` | 页面背景 |
| `--surface` | `#FAFAFA` | 侧栏、输入区和弱背景 |
| `--surface-raised` | `#F4F4F5` | Hover、选中和浮层 |
| `--foreground` | `#18181B` | 主标题和正文 |
| `--muted-foreground` | `#71717A` | 次要说明和时间 |
| `--border` | `#E4E4E7` | 分隔线、输入框和表格边界 |
| `--primary` | `#18181B` | 主按钮、当前 Tab 和关键操作 |
| `--link` | `#2563EB` | 链接、作者跳转和引用跳转 |
| `--warning` | `#B45309` | 待核验、索引延迟、需要注意 |
| `--danger` | `#B91C1C` | 删除、拒绝、举报和权限阻断 |
| `--focus` | `#2563EB` | 键盘焦点环 |

事实、推断、待核验、冲突使用“图标 + 文本 + 灰阶边框”表达；warning 和 danger 可使用必要的棕色/红色，但不能只靠颜色区分。

### 3.2 图标与图片

- 功能图标统一使用 `lucide-react`，其输出为内联 SVG。
- 不使用 Emoji、彩色圆点、文字模拟图标或手绘 SVG 代替按钮图标。
- 头像是用户上传的真实图片或稳定的首字母默认头像，不把默认头像当成真实用户资料。
- 图标按钮必须有 `aria-label` 和 tooltip；文字按钮也可配合 SVG 图标。
- 研究图片、PDF 页面截图和 GIF 是内容媒体，不属于功能图标，按照附件规则存储和审核。

### 3.3 动效

- 页面切换、Sheet、Dropdown、评论线程展开使用 120-220ms 的淡入、位移或高度动画。
- 上传进度、索引状态和 AI 检索使用轻量进度反馈，不使用无限旋转遮挡正文。
- 列表加载使用 Skeleton；加载完成后不改变主要布局尺寸。
- `prefers-reduced-motion: reduce` 时关闭非必要动画，保留状态变化和焦点移动。
- 不使用渐变背景、发光球、装饰性大面积动画或会影响阅读的视差。

## 4. 公开首页

### 4.1 桌面布局

```text
┌ 开源研报 ─── 全站搜索 ─────────────── 探索  提交研究  通知  头像 ┐
├──────────────────────────────────────────────────────────────┤
│ 推荐   最近更新   阅读最多   待核验   关注动态                   │
├──────────────┬──────────────────────────────┬────────────────┤
│ 内容筛选      │ 公开项目列表                  │ 热门主题/活动    │
│ 项目类型      │ 作者 + 标题 + 摘要             │ 最近合并         │
│ 作者          │ 标签 + 证据状态                │ 活跃作者         │
│ 标签          │ 阅读/赞/评论/收藏/贡献者/来源   │ 待解决问题       │
│ 更新时间      │                                │                │
└──────────────┴──────────────────────────────┴────────────────┘
```

- 顶栏高度约 56px，搜索是首要入口；头像点击进入当前用户主页或账户菜单。
- 左栏 220-250px，中心列表最小 640px，右栏 280-320px。
- 小屏保留搜索和列表，筛选、热门主题和活动进入 Sheet，不产生横向滚动。

### 4.2 项目列表项

每个项目使用列表式条目，不使用嵌套卡片。条目必须显示：

```text
拥有者头像 + 用户名 + 发布时间
项目标题 + 项目简介
分类 + 标签 + 核验状态
阅读人数 · 点赞数 · 评论数 · 收藏数
已合并贡献者数 · 有效来源数 · 待审核修改数
最新公开版本时间
贡献者头像堆叠（最多 4 个，剩余显示 +N）
```

交互规则：

- 点击标题/正文区域进入项目详情。
- 点击头像或用户名进入 `/u/[username]`。
- 点击标签进入带 `topic:` 条件的搜索页。
- 点击评论数进入项目讨论 Tab；点击贡献者头像进入贡献者主页。
- 点击 `+N` 或贡献者头像堆叠的空白区域，打开“全部贡献者”弹窗；弹窗支持搜索、角色筛选、贡献类型筛选和按最近贡献/合并次数排序。
- 弹窗中的每个头像、用户名和贡献次数都可点击：头像/用户名进入作者主页，贡献次数进入该作者在当前项目的贡献列表。
- 点击收藏、关注、点赞立即显示 pending 状态；请求失败时恢复原状态并显示原因。
- 统计由真实事件聚合，不在组件内硬编码。

贡献者弹窗在桌面端使用 Popover/Dialog，在移动端使用底部 Sheet。弹窗关闭后保留原页面滚动位置；搜索和筛选状态只作用于当前项目，不改变全站搜索条件。

### 4.3 首页筛选

基础筛选：企业、行业、政策、技术、全部。

高级筛选：

| 筛选 | 数据来源 |
| --- | --- |
| 作者 | `platform_profile.username` |
| 项目类型 | `knowledge_project.category` |
| 标签 | `project_tag` |
| 来源类型 | `source.kind` |
| 核验状态 | `project.verification_state`、章节证据状态 |
| 更新时间 | 最新公开 Merge Commit |
| 阅读/赞/评论/收藏 | 聚合统计，不允许客户端改写 |
| 贡献者数量 | 已合并不同 contributor 数 |
| 有待审核修改 | open Merge Request 数 |
| 是否包含 PDF、图片、Excel | 当前公开文件类型 |

URL 示例：

```text
/search?q=跨境电商&type=project&author=yu-research&status=verified&after=2026-08-01
```

## 5. 全站搜索与 AI 搜索

### 5.1 普通搜索

搜索对象包括项目、报告章节、文件、来源、作者、评论和标签。返回结果按类型分 Tab，默认按综合相关性排序。

```text
关键词解析
  -> 作者/类型/时间/权限过滤
  -> PostgreSQL FTS
  -> pgvector Dense 召回
  -> RRF 合并
  -> Reranker
  -> 结果摘要、来源、版本和作者
```

支持语法：

```text
author:yu-research
type:report | file | user | comment
topic:跨境电商
source:pdf | web | image | spreadsheet
status:verified | needs_verification | conflict
has:discussion | citation | open-review
after:2026-08-01 before:2026-09-01
```

### 5.2 AI 搜索

首页 AI 搜索不是普通聊天窗口，而是“搜索结果 + 有引用总结”：

1. 先返回匹配项目、作者、文件和来源；
2. 显示每条命中的标题、版本、作者和证据片段；
3. 再生成 3-5 条有引用的总结；
4. 证据不足时返回 `needs_verification` 或 `abstained`；
5. 不允许把私有草稿、私人会话或未授权文件带入全站结果。

项目内 AI 助手只读取当前项目/文件 Scope；它和首页全站 AI 搜索使用不同的权限边界和限流策略。

### 5.3 索引状态

每个文件显示：未索引、排队、处理中、已索引、失败、需重建。管理员或项目所有者可针对文件重新索引，删除文件时同步删除 FTS/向量索引和引用入口。

## 6. 项目详情与文件预览

### 6.1 顶部区域

```text
作者头像  owner / project-slug  公开或私有
项目简介  标签  许可证
关注项目  收藏  分享  复制到我的草稿  提交修改
阅读  赞  评论  收藏  贡献者  来源  当前版本
```

点击 owner、贡献者或评论作者均进入个人主页；分享复制的是稳定项目 URL，不复制临时 OSS 签名地址。

### 6.2 Tab

```text
概览 | 文件 | 来源 | 讨论 | 修改申请 | 历史 | 贡献者 | 活动
```

- 概览：项目摘要、关键结论、核验边界和热门章节。
- 文件：文件树和预览。
- 来源：来源状态、抓取时间、哈希、页码和引用数量。
- 讨论：项目级评论和问题线程。
- 修改申请：MR 列表、Diff、逐段评论、审核和合并。
- 历史：公开版本和回退入口。
- 贡献者：按合并贡献统计，不把仅浏览者算作贡献者。
- 活动：发布、评论、审核、合并和来源更新。

### 6.3 三栏工作区

```text
左：文件树和当前分支
中：正文/表格/PDF/图片预览
右：AI 助手、Scope、历史对话和引用
```

文件点击行为必须明确：

| 文件类型 | 中间区域行为 |
| --- | --- |
| Markdown/TXT | 渲染正文、目录、版本和段落评论锚点 |
| PDF | 页码预览、文本层、原始下载、引用定位 |
| PNG/JPEG/WebP | 图片预览、缩放、原始文件和来源 |
| GIF | 静态首帧，点击后播放；显示大小和上传者 |
| XLSX/CSV | 表格预览、工作表/字段、筛选、解析状态 |
| 未解析文件 | 原始文件信息、下载、失败原因和重试 |

不能只改变左侧选中背景而让中间正文不变化。任何文件点击都要更新标题、内容、来源和 URL 锚点。

## 7. 评论与讨论

### 7.1 两类评论

1. **项目级讨论**：显示在详情页“讨论” Tab，可讨论报告整体方向。
2. **锚点评论**：选中正文、表格行或来源片段后发表评论，评论绑定 `document_revision_id + block_id` 或 `source_chunk_id`。

### 7.2 楼中楼

评论行采用紧凑的抖音式信息密度，但不采用娱乐化配色：

```text
头像  用户名  时间  作者/维护者标记
评论正文
图片/GIF/证据附件缩略图
赞数  回复  引用  举报  更多
  └─ 回复 1
      └─ 回复 2（逻辑上仍属于同一线程，不无限缩进）
```

- UI 最多缩进两级，更多回复在同一 Thread 中展开。
- 支持最新、最热、未解决排序。
- 支持回复、@用户、引用上一条评论、置顶、编辑、删除、解决和重新打开。
- 用户名、头像和 @ 提及都可跳转到个人主页。
- 评论绑定版本；正文合并后锚点失效时显示“该评论对应旧版本”，不能悄悄移动到错误段落。
- 评论作者可以编辑/删除自己的评论；维护者可以隐藏违反规则的评论；管理员操作保留审计事件。

### 7.3 图片和 GIF

评论附件使用私有 OSS：

| 限制 | V1 默认值 |
| --- | --- |
| 类型 | JPG、PNG、WebP、GIF |
| 单个大小 | 8 MiB |
| 单条数量 | 4 个 |
| GIF 展示 | 静态首帧，用户点击后播放 |
| 原图 | 私有对象，短期签名访问 |
| 派生图 | 服务端生成缩略图，记录 `original_asset_id` |

上传前后必须检查扩展名、MIME magic、大小、像素尺寸、病毒扫描和 EXIF。评论图片可以是普通讨论媒体，也可以被用户明确标记为“证据附件”；只有证据附件才进入 AI 检索候选，且仍须人工核验。

### 7.4 评论互动与通知

- 项目和评论均支持“赞”；个人收藏与点赞分开统计。
- 评论、回复、@、点赞、置顶和解决触发站内通知。
- 未登录用户可以阅读公开评论，但发布、点赞、回复、关注和收藏需要登录。
- 反垃圾限流按用户、IP 和项目组合；失败请求不增加计数。

## 8. 作者主页与社交图谱

### 8.1 作者主页

```text
┌ 头像  显示名  @username  简介  研究领域  关注/取消关注 ┐
│ 项目  贡献  评论  活动  关注者  正在关注                  │
├─────────────────────────────────────────────────────────┤
│ 发布项目列表 / 参与贡献列表 / 最近活动                   │
└─────────────────────────────────────────────────────────┘
```

页面显示：

- 真实头像或默认首字母头像；
- 发布项目数量；
- 被合并贡献数量；
- 评论和讨论参与数；
- 关注者、正在关注和收藏数量；
- 最近发布、最近合并、最近评论；
- 项目卡片的阅读、赞、评论、收藏、来源和贡献者统计。

自己的主页额外显示私有草稿、上传队列、待审核 MR、通知和账户设置。其他用户永远看不到私有项目、私人会话和未授权草稿。

### 8.2 关注、收藏、点赞

| 动作 | 语义 | 是否公开 |
| --- | --- | --- |
| 关注作者 | 订阅作者公开活动 | 关注关系可按隐私设置隐藏 |
| 关注项目 | 订阅项目更新和合并 | 可按隐私设置隐藏 |
| 收藏项目 | 保存到个人收藏夹 | 默认私有 |
| 点赞内容 | 对项目或评论表达认可 | 计数公开，用户列表可限制 |

操作必须幂等，重复点击不能重复计数；取消操作不能删除历史审计事件。

### 8.3 贡献活动热力图

作者主页和项目“活动”页提供类似 GitHub 的按日贡献热力图，但颜色采用黑白灰强度，不使用绿色渐变。每个小方块代表一个自然日，颜色深浅对应真实事件数量，空白表示当天没有公开活动。

```text
贡献活动 · 2026
[全部] [发布] [合并] [评论] [审核]
周一  □ □ ▪ ▪ ■ □ □ ...
周三  □ ▪ □ ■ ■ ▪ □ ...
周五  □ □ □ ▪ □ □ □ ...
```

小方块的交互：

- 鼠标悬停显示 Tooltip：日期、事件总数、发布数、合并数、评论数和审核数。
- 点击小方块打开当天活动弹窗或右侧详情栏，列出真实活动事件。
- 每一条活动都可以继续跳转到项目、文件、章节、评论、Commit、Merge Request 或作者主页。
- 点击月份、星期标签或“更多”可以进入带日期条件的活动列表，例如 `/search?after=2026-08-12&before=2026-08-13&type=activity`。
- 没有活动时显示“当天没有公开活动”，不能生成随机方块。
- 事件被删除或隐藏后，热力图只统计仍满足公开权限的事件；统计延迟必须显示最后聚合时间。

热力图的数据来自 `activity_event` 的日聚合，不直接扫描页面渲染。建议增加：

```text
activity_daily
  actor_user_id, project_id_nullable, day,
  publish_count, merge_count, comment_count, review_count,
  total_count, public_event_version, updated_at
```

### 8.4 全站互链规则

| 当前对象 | 点击目标 |
| --- | --- |
| 首页项目标题/摘要 | 项目详情 |
| 项目拥有者头像/用户名 | 作者主页 |
| 项目标签 | 带标签条件的搜索 |
| 阅读/赞/评论/收藏 | 对应统计或讨论 Tab |
| 贡献者头像堆叠 / `+N` | 贡献者弹窗 |
| 贡献者弹窗中的作者 | 作者主页 |
| 文件夹 | 展开/收起文件树 |
| 文件 | 文件预览和固定文件 URL |
| 来源 | 来源详情、快照和引用列表 |
| 引用 | 原文页码/偏移或来源片段 |
| 段落贡献署名 | 作者主页和该 Commit |
| Commit | Commit 详情和变更文件 |
| Merge Request | Diff、评论、审核和合并状态 |
| 评论头像/用户名/@提及 | 作者主页 |
| 评论附件 | 附件预览和来源信息 |
| 活动热力图小方块 | 当天活动列表 |
| 活动列表事件 | 对应项目/文件/评论/Commit |
| 通知 | 具体项目、评论或审核对象 |

任何对象没有可用目标时，必须显示明确的禁用状态或错误说明，不能留下“点了没反应”的空按钮。

## 9. 真实数据模型

### 9.1 用户和关系

```text
platform_user
  id, email, global_role, status, email_verified_at, created_at, updated_at
platform_profile
  user_id, username, display_name, bio, avatar_asset_id, privacy, created_at, updated_at
user_follow
  follower_user_id, followed_user_id, created_at, deleted_at, unique(follower, followed)
project_follow
  user_id, project_id, created_at, deleted_at, unique(user, project)
project_star
  user_id, project_id, created_at, deleted_at, unique(user, project)
reaction
  user_id, target_type, target_id, kind, created_at, deleted_at, unique(user, target, kind)
```

### 9.2 内容、版本和引用

继续使用现有 `knowledge_project`、`knowledge_node`、`knowledge_node_state`、`document_revision`、`knowledge_branch`、`knowledge_commit`、`merge_request`、`merge_review` 和 `content_attribution`。

补充约束：

- 公开统计只读取 published 主分支；草稿操作不增加公开阅读和公开版本更新时间。
- 每个正文块有稳定 `block_id`，贡献归属指向 Commit 和 Merge Request。
- 每个来源保存 `captured_at`、`content_hash`、`state`、原始 URL、快照和来源类型。
- 每条引用保存 source、chunk、页码/偏移、引用文本和证据状态。

### 9.3 评论、媒体和通知

```text
comment_thread
  id, project_id, node_id, block_id, source_chunk_id, revision_id,
  root_comment_id, status, created_by, created_at, resolved_at
comment
  id, thread_id, parent_comment_id, author_user_id, content,
  version, edited_at, deleted_at, created_at
comment_attachment
  id, comment_id, asset_id, attachment_kind, alt_text, position
comment_mention
  comment_id, mentioned_user_id, created_at
notification
  id, recipient_user_id, kind, actor_user_id, project_id, target_type,
  target_id, read_at, created_at
activity_event
  id, actor_user_id, project_id, event_type, target_type, target_id,
  metadata, created_at
moderation_report
  id, reporter_user_id, target_type, target_id, reason, status,
  moderator_user_id, resolved_at, created_at
```

删除评论采用软删除，正文显示“该评论已删除”，附件对象按保留策略清理；审计和版本历史不删除。

### 9.4 真实统计

```text
project_view_event
  project_id, user_id_nullable, visitor_hash, day, user_agent_class, created_at
project_stats
  project_id, unique_readers, likes, comments, stars, followers,
  merged_contributors, source_count, open_merge_requests, updated_at
activity_daily
  actor_user_id, project_id_nullable, day, publish_count, merge_count,
  comment_count, review_count, total_count, public_event_version, updated_at
```

阅读统计按登录用户或签名访客按日去重，排除静态资源、健康检查、爬虫和重复刷新。点赞、收藏、关注由唯一约束保证幂等。`project_stats` 是异步聚合结果，不能由浏览器提交任意数字。

## 10. 泛微网络与深信服的首发资料

这两家公司可以作为真实公开研究项目加入，但必须先导入来源，再生成结论。不能直接把公司名称和宣传语写成已验证事实。

### 10.1 泛微网络

项目建议：`泛微网络：协同办公与企业数字化产品研究`。

首批公开来源：

| 来源 | 地址 | 可记录字段 |
| --- | --- | --- |
| 泛微网络官方站点 | [https://www.weaver.com.cn/](https://www.weaver.com.cn/) | 产品线、解决方案、公开功能描述、服务入口 |
| 公司公告/定期报告 | 以上市公司公告平台的最新原文为准 | 报告期、经营数据、风险提示、审计口径 |
| 官方产品文档或白皮书 | 从官网实际可访问页面导入 | 功能边界、部署方式、适用场景 |

报告字段：公司概况、产品线、目标客户、部署方式、行业方案、公开集成、交付模式、公开价格、竞争对象、证据状态、来源版本和待核验问题。

没有独立来源时，以下字段必须为空或 `needs_verification`：客户数量、市场占有率、续费率、单客收入、项目交付成本、产品优劣结论。

### 10.2 深信服

项目建议：`深信服：云计算、网络安全与企业服务研究`。

首批公开来源：

| 来源 | 地址 | 可记录字段 |
| --- | --- | --- |
| 深信服官方站点 | [https://www.sangfor.com.cn/](https://www.sangfor.com.cn/) | 产品分类、解决方案、公开能力描述、服务入口 |
| 官方公告/定期报告 | 以公司公告和交易所披露原文为准 | 报告期、经营数据、风险提示、审计口径 |
| 官方安全公告/白皮书 | 从官网实际可访问页面导入 | 安全能力、适用场景、版本和发布日期 |

报告字段：云服务与安全产品边界、目标行业、部署模式、服务方式、公开集成、产品版本、竞争线索、来源快照、核验状态和研究者推断。

不能从官网产品介绍直接推导客户规模、行业排名、攻击拦截数量或商业效果。AI 只能总结来源中明确写出的内容，并在回答中标注“企业自述”。

### 10.3 资料导入流程

```text
官方页面/PDF/报告
  -> 保存原始 URL、抓取时间和内容哈希
  -> 进入私有 OSS 原件区
  -> 解析为 source / source_chunk
  -> 人工确认标题、章节和证据状态
  -> 生成公开项目草稿
  -> 维护者审核引用和许可证
  -> 发布到公开 main
```

任何无法访问、需要登录、违反 robots/服务条款或没有公开授权的内容，都不能通过截图或爬虫伪装成正式来源。

## 11. API 约束

### 11.1 公开读取

```text
GET  /api/platform/projects
GET  /api/platform/projects/:id
GET  /api/platform/projects/:id/files/:nodeId
GET  /api/platform/search
GET  /api/platform/users/:username
GET  /api/platform/projects/:id/comments
GET  /api/platform/projects/:id/activity
```

### 11.2 登录写入

```text
POST   /api/platform/comments
PATCH  /api/platform/comments/:id
DELETE /api/platform/comments/:id
POST   /api/platform/comments/:id/reactions
POST   /api/platform/users/:id/follow
POST   /api/platform/projects/:id/follow
POST   /api/platform/projects/:id/star
GET    /api/platform/notifications
POST   /api/platform/notifications/:id/read
```

所有写请求：

- 从 Auth.js Session 获取 actor；
- 不信任 Body 中的 `userId`、`role`、`ownerId`；
- 使用 CSRF/同源检查、幂等键、权限校验和审计事件；
- 失败返回可读错误码，不能静默吞掉。

## 12. 验收清单

### 12.1 交互

- [ ] 首页项目、作者、标签、统计和排序均可点击或有明确动作。
- [ ] “官方资料.pdf”“公开访谈摘录.md”、图片、GIF、Excel 点击后显示真实预览或失败状态。
- [ ] 头像和用户名在所有位置都进入作者主页。
- [ ] 评论、回复、段落锚定、图片/GIF、点赞、举报和解决状态可用。
- [ ] 贡献者头像堆叠的 `+N` 可打开可搜索贡献者弹窗，头像/用户名/贡献记录可继续跳转。
- [ ] 作者主页贡献热力图按真实日事件生成；点击小方块可查看当天活动，活动可跳项目、文件、评论、Commit 或 MR。
- [ ] 项目详情的版本、Diff、MR、贡献者和来源 Tab 可用。
- [ ] 搜索支持普通关键词、高级筛选、URL 状态和 AI 引用结果。
- [ ] 所有 loading、empty、error、permission denied 和 deleted 状态可见。
- [ ] 首页、项目、文件、作者、评论、引用、活动和通知之间不存在无动作的可点击元素。

### 12.2 数据真实性

- [ ] 新用户必须通过真实注册产生，不生成系统用户。
- [ ] 项目、评论、关注、点赞、阅读和贡献均能回溯到数据库事件。
- [ ] 首页统计与明细事件抽样一致。
- [ ] 私有项目、草稿、对话和 OSS 原件跨用户不可读。
- [ ] 泛微网络、深信服每条结论都有来源、抓取时间、哈希和证据状态。
- [ ] 删除、举报、合并、回退和权限变更都有审计记录。

### 12.3 视觉

- [ ] 视觉基调为黑白灰，无绿色品牌色或装饰色。
- [ ] 功能图标均为 SVG，具有 tooltip 和 aria-label。
- [ ] 卡片不嵌套卡片，列表信息密度接近 GitHub 但保留研究语义。
- [ ] 动效不影响阅读，Reduced Motion 生效。
- [ ] 390px、768px、1440px 视口均无横向溢出和文字重叠。

## 13. 交付顺序

1. 先修复文件树点击和真实文件预览；
2. 将首页项目卡片和统计全部切换为 PostgreSQL 真实数据；
3. 接入作者主页、关注、收藏、点赞和活动事件；
4. 接入项目级/段落级评论和 OSS 媒体附件；
5. 接入全站搜索、高级筛选和 AI 搜索引用；
6. 导入并核验泛微网络、深信服和已有真实研究资料；
7. 完成通知、治理、备份、审计、权限和公网 E2E；
8. 通过真实性和权限验收后再公开更多项目。

完成第 8 步后，产品功能范围锁定。后续只做错误修复、性能、可访问性和安全改进，不再继续增加社交模块。
