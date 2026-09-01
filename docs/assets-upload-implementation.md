# 私有 OSS 上传实现

状态：后端上传闭环已实现，前端和解析 Worker 仍按 `TODO.md` 接入。

## 安全边界

- 所有上传意图都从 `requireAuthenticatedActor()` 获取用户身份；请求体不能声明 owner。
- 项目上传必须指定非保护草稿分支，并经 `AuthorizationService` 校验；游客不能上传文件。
- Bucket `reaserch` 保持私有、阻止公共访问；服务端用 ECS RAM Role 签发短期 PUT/GET URL。
- Object Key 固定在 `quarantine/{owner}/{uploadId}/{sha256}{extension}`，用户不能控制目录。
- 扩展名和 MIME 必须同时命中白名单：Markdown、文本、PDF、DOCX、PNG、JPEG、WebP；单文件上限 25 MiB。
- 默认头像由前端用户名首字符生成，不创建 OSS 对象。

## API

### `POST /api/platform/uploads`

登录后提交 `filename`、`contentType`、`size`、小写 `sha256`，项目文件还要提交 `projectId` 和非保护 `branchId`。返回 `asset`、短期 `upload` 和 `ingestion`。浏览器使用返回的 PUT URL，并带上两个请求头：

```text
content-type: <返回值>
x-oss-meta-sha256: <预期 SHA-256>
```

用户配额默认 500 MiB，可由 `PLATFORM_UPLOAD_USER_QUOTA_BYTES` 调整。相同用户、项目和 SHA 的未失败对象幂等返回，不重复创建对象或解析任务。

首次启用浏览器直传前，Bucket CORS 需要允许实际站点 Origin（不要填 `*`）、方法 `PUT`/`GET`/`HEAD`、请求头 `Content-Type` 与 `x-oss-meta-sha256`，并暴露响应头 `ETag`。CORS 只控制浏览器跨域，不会改变 Bucket 私有读写权限；未配置 `ExposeHeader: ETag` 时前端会在上传后明确提示配置，而不是把对象误报为已确认。

### `POST /api/platform/uploads/{assetId}`

直传完成后提交客户端 ETag、大小和 SHA-256。服务端调用私有 OSS `HeadObject`，比较 ETag、Content-Length 和对象 SHA 元数据；若没有可信 SHA 元数据，则流式读取对象重新计算 SHA-256。三项全部通过后，Asset 变为 `verified`，Job 进入 `queued`。

### `GET /api/platform/uploads/{assetId}`

只返回当前登录用户自己的资产和解析状态。其他用户统一返回 404。

### `POST /api/platform/uploads/{assetId}/retry`

只允许 `verified` 原件对应的解析 Job 在 `failed` 状态下重试；上传校验失败的对象必须新建上传意图，避免坏对象被重新当成解析任务。

### `GET /api/platform/assets/{assetId}`

仅资产所有者可以获得短期私有 GET URL。数据库只保存 `object_key`，不保存签名 URL。

## 状态与数据边界

```text
Asset: pending_upload -> verified | failed
Job: queued -> uploading -> processing -> ready | failed -> queued (retry)
```

`uploaded_asset` 保存不可变原始对象元数据；解析器生成的 Markdown/结构化文档必须创建独立 `asset_kind=derived` 记录，并通过 `original_asset_id` 关联，编辑派生内容不能覆盖原始证据。

解析 Worker 通过 `AssetRepository.updateIngestionStatus` 领取和更新任务；状态更新应使用条件 SQL、attempt 和幂等键，失败保留错误码和可恢复提示。当前 API 不声称解析已经完成。
