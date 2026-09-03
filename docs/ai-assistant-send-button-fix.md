# AI 助手发送按钮故障说明

更新时间：2026-09-03

## 根因

发送按钮并不是浏览器事件失效。项目详情 API 的 `PublicProjectRecord` 没有投影对应的 `assistantReportId`，前端 `AssistantPanel.sendQuestion` 在任何网络请求前执行：

```text
没有 assistantReportId -> 显示“项目尚未关联可检索报告” -> 直接返回
```

因此用户看到点击无效，`/api/research/assistant` 实际没有被调用。公网直接提交 `report-huice` 的请求已证明模型和 AI 路由可用。

## 修复

PostgreSQL 的公开项目查询现在通过稳定项目 ID 映射报告：

```sql
assistant_report.id = 'report-' || substring(p.id from 9)
```

并将 `assistant_report_id` 投影给前端。映射只读取项目对应的报告，不把全库报告暴露给客户端。报告不存在时仍保持空值并给出明确错误，不能伪造 AI 上下文。

## 当前策略

匿名 AI 继续可用，不改成强制登录。登录只负责保存会话历史；AI 回答仍只能使用当前报告的 active 来源和受限上下文。认证关闭、模型未配置、无证据和限流状态分别返回明确提示。

## 验收

- 直接调用公网 `/api/research/assistant`（有效 `reportId`）返回 `context_ready`；
- 公开项目投影契约检查 `assistant_report_id` 查询和稳定映射；
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 通过后再发布；
- 发布后打开项目，发送按钮应能进入“检索并重排证据”状态；无可用项目时不会误显示旧企业报告。
