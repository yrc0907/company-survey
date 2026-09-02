# 私有 OSS 上传实现

状态：后端私有 OSS 上传、下载、隔离对象清理和解析 Worker 闭环已实现。文本/原生文字 PDF/DOCX 会生成独立解析产物；图片和无文字层 PDF 明确进入 `needs_review`，不会伪造 OCR 正文。

## 安全边界

- 所有上传意图都从 `requireAuthenticatedActor()` 获取用户身份；请求体不能声明 owner。
- 项目上传必须指定非保护草稿分支，并经 `AuthorizationService` 校验；游客不能上传文件。
- Bucket `reaserch` 保持私有、阻止公共访问；服务端用 ECS RAM Role 签发短期 PUT/GET URL。
- Object Key 固定在 `quarantine/{owner}/{uploadId}/{sha256}{extension}`，用户不能控制目录。
- 扩展名和 MIME 必须同时命中白名单：Markdown、文本、PDF、DOCX、PNG、JPEG、WebP；单文件上限 25 MiB。
- 默认头像由前端用户名首字符生成，不创建 OSS 对象。
- 头像 Asset 在转正前执行 2 MiB 上限、MIME/文件签名一致性和 EXIF 拒绝校验；当前不做原地重写，带 EXIF 的对象进入失败并清理隔离对象。契约：`pnpm exec tsx lib/services/assets/avatar-validation.contract.ts`。

## API

### `POST /api/platform/uploads`

登录后提交 `filename`、`contentType`、`size`、小写 `sha256`，项目文件还要提交 `projectId` 和非保护 `branchId`。返回 `asset`、短期 `upload` 和 `ingestion`。浏览器使用返回的 PUT URL，并带上两个请求头：

```text
content-type: <返回值>
x-oss-meta-sha256: <预期 SHA-256>
```

`ali-oss` 的 `head()` 通常会把该用户元数据从 `x-oss-meta-sha256` 映射为 `result.meta.sha256`；适配器同时兼容 SDK 未解析时的原始 `x-oss-meta-sha256` 响应头，并只接受 64 位 SHA-256。临时验证脚本必须在 PUT 请求中显式携带该 header（仅带 `Content-Type` 的 PUT 不会产生用户元数据），否则完成接口会读取对象流重新计算哈希。

用户配额默认 500 MiB，可由 `PLATFORM_UPLOAD_USER_QUOTA_BYTES` 调整。相同用户、项目和 SHA 的未失败对象幂等返回，不重复创建对象或解析任务。

首次启用浏览器直传前，Bucket CORS 需要允许实际站点 Origin（不要填 `*`）、方法 `PUT`/`GET`/`HEAD`、请求头 `Content-Type` 与 `x-oss-meta-sha256`，并暴露响应头 `ETag`。CORS 只控制浏览器跨域，不会改变 Bucket 私有读写权限；未配置 `ExposeHeader: ETag` 时前端会在上传后明确提示配置，而不是把对象误报为已确认。

### `POST /api/platform/uploads/{assetId}`

直传完成后提交客户端 ETag、大小和 SHA-256。服务端调用私有 OSS `HeadObject`，比较 ETag、Content-Length 和对象 SHA 元数据；若没有可信 SHA 元数据，则流式读取对象重新计算 SHA-256。三项全部通过后，Asset 变为 `verified`，Job 进入 `queued`。

### `GET /api/platform/uploads/{assetId}`

只返回当前登录用户自己的资产、解析状态和（若存在）解析产物。其他用户统一返回 404。

### `POST /api/platform/uploads/{assetId}/retry`

只允许 `verified` 原件对应的解析 Job 在 `failed` 状态下重试；上传校验失败的对象必须新建上传意图，避免坏对象被重新当成解析任务。

### `DELETE /api/platform/uploads/{assetId}`

仅当前登录用户可以取消自己的上传。对 `pending_upload`、`uploaded` 或 `failed` 的隔离对象，服务端先调用受控 `DeleteObject` 再将资产标记为 `failed`；OSS 删除失败时接口返回错误，不报告“已取消”，方便客户端重试。对 `verified` 原件，接口只取消解析 Job，不删除不可变原始证据。

### `GET /api/platform/assets/{assetId}`

仅资产所有者可以获得短期私有 GET URL。数据库只保存 `object_key`，不保存签名 URL。

## 状态与数据边界

```text
Asset: pending_upload -> verified | failed
Job: queued -> processing -> ready | needs_review | failed -> queued (retry)
```

`uploaded_asset` 保存不可变原始对象元数据；Worker 先把文本结果按 attempt 追加到独立 `ingestion_artifact`，读取接口只返回最新产物，后续 source/source_chunk 索引可从该产物重建。正式派生文件仍必须创建独立 `asset_kind=derived` 记录并通过 `original_asset_id` 关联，编辑派生内容不能覆盖原始证据。`DeleteObject` 只允许隔离前缀，不能删除 `verified` 原件；已取消或校验失败对象的 OSS 清理可安全幂等重试。

## 解析 Worker

`AssetIngestionService.processNext(workerId)` 使用 `AssetRepository.claimNextIngestion` 领取一个 `verified` 原件：

1. PostgreSQL `FOR UPDATE SKIP LOCKED` 分配任务并写入租约；`processing/uploading` 的过期租约可被回收。
2. Worker 从私有 OSS 受限流式读取对象，并再次比较长度和 SHA-256；校验失败只记录 `PARSER_FAILED`。
   对 PDF/DOCX/PNG/JPEG/WebP 还会检查文件签名（magic bytes），仅凭客户端 MIME/扩展名不能绕过该边界。
3. `.md/.txt` 使用严格 UTF-8；原生文字 PDF 使用有限 PDF text operator 提取；DOCX 仅读取 `word/document.xml`，支持 ZIP stored/deflate，不执行宏或外部实体。
4. 图片、扫描 PDF、无支持解析器的格式写入 `kind=needs_review` 产物并将 Job 置为 `needs_review`，错误码为 `PARSER_REQUIRES_VISION` 或 `PARSER_REQUIRES_DOCUMENT_PARSER`。
5. 只有持有租约且未过期的 Worker 能够 `completeIngestion`/`markIngestionNeedsReview`；晚到结果被条件更新拒绝。重复完成不会覆盖已有产物。

当前 Worker 不调用视觉模型，也不声称图片 OCR 已完成；配置视觉解析器后可对 `needs_review` Job 使用原有重试接口。

契约测试：`pnpm test` 中的 `lib/services/assets/asset-ingestion.contract.ts` 覆盖文本完成、图片待校对、PDF 文字层/扫描降级、OSS 完整性失败、显式重试和重复消费边界。

### 运行方式

在已加载服务器 `.env` 的应用/Worker 运行环境执行：

```text
pnpm asset:ingestion
```

默认只领取一个任务；批量排空可设置 `ASSET_INGESTION_DRAIN=true` 和 `ASSET_INGESTION_MAX_JOBS=100`。脚本无任务时以成功状态退出并输出处理数量；错误日志只包含资产/任务 ID、错误码和可读原因，不输出 OSS 凭据或对象内容。生产容器应以独立 one-shot/定时 Worker 运行该入口，不要把它暴露成公开 HTTP 接口。

## 解析产物进入 RAG 索引

`ArtifactSourceIndexService.indexReadyArtifact` 是解析与检索之间的受控边界。它只接受当前登录用户在指定项目/分支拥有的 `ready` 文本产物，并再次校验产物内容哈希、目标报告存在性和分支 `write_branch` 权限；图片或 `needs_review` 产物不会生成可检索正文。服务按自然段（超长段落每 1200 字符）生成 `source_chunk`，保留文件名、标题路径、偏移和每个 Chunk 的 SHA-256。

迁移 `016_artifact_source_index.sql` 为 `source` 增加 `ingestion_artifact_id`、`owner_user_id`、`project_id`、`branch_id` 血缘字段，并以产物 ID 和报告内容哈希建立幂等索引。`source`/`source_chunk` 是可重建的派生检索数据：重复消费只返回既有来源，不覆盖来源快照、解析产物或 OSS 原件；旧的手工来源没有项目血缘，也不会被改写。索引服务不接受浏览器传入 owner，所有 owner 由资产记录和 Auth.js Session 决定。
