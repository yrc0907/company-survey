# URL 来源刷新实现

更新时间：2026-09-03

## 行为

已有 URL 来源可以由所有者触发刷新。刷新不是“抓到内容就覆盖”：服务端先验证 URL、DNS 公网解析、响应类型、重定向、超时和 2 MiB 大小上限，再计算正文 SHA-256。

- 哈希不变：返回 `unchanged`，沿用原 active 来源和 Chunk。
- 哈希变化：追加一条新的 `needs_review` 来源快照和 Chunk；旧 active 来源不变，维护者确认后才能进入 active。
- 失败：返回可恢复错误，不创建半成品来源，不把供应商响应或正文写入日志。

## API 与权限

`POST /api/research/sources/:id/refresh`

请求必须有 Auth.js Session，且来源 `owner_user_id` 必须等于当前 actor。没有 owner 的历史手工来源默认拒绝，避免把该入口变成任意 URL 抓取器。认证关闭时仍按统一认证门槛返回 401/403；不会因为刷新入口存在而打开公众写权限。

响应只返回状态、来源 ID、状态、采集时间、哈希和 Chunk 数，不回传完整正文。

## 定时刷新

`pnpm source:refresh` 运行 `scripts/refresh-url-sources.ts` one-shot Worker：扫描数据库中 `active` URL 来源，按最早采集时间排序，默认最多处理 20 条，可用 `SOURCE_REFRESH_MAX_JOBS` 调整（上限 200）。每条来源独立失败并继续下一条；调度器应在服务器使用 cron/systemd timer 调用，不把 Worker 暴露为公开 HTTP 服务。

## 安全边界

- 使用 `redirect: manual`，重定向不自动跟随，防止跳入私网。
- DNS 解析结果拒绝 loopback、RFC1918、链路本地和 IPv6 ULA 地址。
- 只接受 `text/html` 或 `text/plain`，不把 PDF、图片或任意二进制当作文本来源。
- 结果进入 `needs_review`，因此来源刷新不会绕过人工审核，也不会改变 active 检索事实。

## 验证

- `lib/services/search-source-refresh.contract.ts`：不变、变化、重定向和私网解析场景。
- `lib/services/source-refresh-route.contract.ts`：未登录拒绝和 owner 鉴权静态边界。
- `pnpm typecheck`、`pnpm lint`、`pnpm test` 覆盖路由和服务契约。
