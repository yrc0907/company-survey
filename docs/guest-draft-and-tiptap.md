# TipTap 正文与游客草稿

报告章节在编辑态使用 TipTap，段落、标题、引用、列表和代码块均带 `data-block-id`。旧章节纯文本会按 `章节 ID + 序号` 确定性生成块 ID；新增块由 TipTap 客户端生成并在编辑器生命周期内保持，保存前导出为 Markdown 文本，兼容现有检索与版本表。

游客草稿通过 `lib/services/guest-draft-store.ts` 写入 IndexedDB `guest-drafts` 对象仓库，编辑器在有 `guestDraftId` 时以 600ms 防抖自动保存 `baseRevision`、标题和章节快照。登录迁移使用 `migrateGuestDraft`：目标账户回调成功后才写入 `migratedTo` 标记，因此刷新或重复触发不会重复提交；回调失败会保留原草稿供稍后重试。

IndexedDB 不可用（SSR、隐私模式或浏览器策略限制）时，编辑器继续可编辑，但不会伪称已本地保存。过期 `baseRevision` 由上层登录/提交流程检测并提示变基，本模块不会静默覆盖服务器版本。
