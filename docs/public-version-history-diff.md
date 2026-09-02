# 公开版本历史与逐段 Diff

更新时间：2026-09-03

## 目标

版本页不是只显示一串 Commit ID。访问者需要知道“谁在什么时候改了哪个文件、改前是什么、改后是什么、这次修改是否来自合并申请”，同时不能看到尚未审核的草稿。

## 读取边界

`GET /api/platform/projects/:projectId/history` 只列出公开项目保护分支上的 Commit 元数据。点击某个 Commit 后，
`GET /api/platform/projects/:projectId/history/:commitId` 再读取 `commit_change` 与两侧 `document_revision`：

- 项目必须同时满足 `visibility=public`、`status=published`；
- Commit 必须属于该项目的 `is_protected=true` 分支；
- 作者必须是 `platform_user.status=active`，只返回公开 profile；
- 查询最多返回 200 个文件变化；正文两侧各最多投影 20,000 个字符，LCS Diff 最多比较 400 行；超出时标记 `truncated`，不把 OSS 原件直接返回；
- 树操作（新增、删除、重命名、移动）没有正文 Revision 时，使用 Commit 的安全 metadata 展示名称/父目录变化；
- API 永远不返回草稿分支、私有项目、邮箱、凭据、OSS object key 或未审核正文。

## Diff 口径

正文使用现有确定性 `diffText` 逐行拆成 `equal/add/remove` 三类 hunk。UI 用文本前缀和低饱和语义色表达增删，文本本身仍由 React 转义渲染，避免把研究内容当作 HTML 执行。仅树结构变化显示“没有可比较文本”，而不是伪造空正文。

这不是三方合并 Diff：三方冲突仍由 Merge Request 的 `calculateMergeDiff` 计算并阻止未经处理的合并；公开历史只展示已经进入主分支的最终结果。维护者可在当前 HEAD 的详情中发起回滚，服务端会检查项目管理权限、HEAD 版本和树快照，再新增一条反向 Commit；旧 Commit 不被修改。历史中间点不能直接回滚，必须先处理后续版本。

## UI 行为

- 版本列表的 Commit 消息和展开按钮均可打开详情；当前选择项使用 `aria-expanded`，读取中、错误、空结果和关闭状态都有明确反馈。
- 详情按文件分组，显示文件名、操作类型、MR 关联（若存在）、逐行增删和安全截断提示。
- 维护者可点击“回滚此版本”；匿名或非项目 owner 会得到统一拒绝提示，回滚成功后重新加载版本列表。
- 作者名仍链接到公开作者主页；关闭详情不会改变主分支或浏览器历史。
- 匿名用户可以读取已发布 Diff；创建反向修订、提交 MR、审核和合并仍需要内测会话与维护者权限。

## 代码与验证

- 服务：`lib/services/platform/public-history-detail-service.ts`
- 路由：`app/api/platform/projects/[id]/history/[commitId]/route.ts`
- 回滚服务/路由：`lib/services/platform/public-revert-service.ts`、`app/api/platform/projects/[id]/history/[commitId]/revert/route.ts`
- UI：`components/platform/project-history.tsx`
- 契约：`lib/services/platform/public-history-detail.contract.ts`、`lib/services/platform/public-revert.contract.ts`

本地已通过 `pnpm exec tsx lib/services/platform/public-history-detail.contract.ts`、`pnpm typecheck` 和 `pnpm lint`。真实数据库回归仍需要在香港 ECS 使用内测 owner 验证“主分支可读、草稿不可读、跨项目 Commit 返回 404、非 HEAD 回滚拒绝、HEAD 回滚追加新 Commit”。
