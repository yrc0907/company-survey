import { randomUUID } from "node:crypto";

/** OSS 允许的上传类型；真实 MIME 与扩展名必须同时命中同一条白名单。 */
const UPLOAD_TYPES = {
  ".md": ["text/markdown", "text/plain"],
  ".txt": ["text/plain"],
  ".pdf": ["application/pdf"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
} as const;

export type UploadExtension = keyof typeof UPLOAD_TYPES;
export type ObjectKind = "quarantine" | "project-original" | "project-derived" | "avatar";

export interface ObjectKeyInput {
  kind: ObjectKind;
  ownerId: string;
  projectId?: string;
  uploadId?: string;
  contentHash?: string;
  extension: UploadExtension;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

/** 同时验证扩展名和 MIME，禁止只相信浏览器提供的文件名或 Content-Type。 */
export function assertAllowedUpload(extension: string, contentType: string): asserts extension is UploadExtension {
  const normalized = extension.toLowerCase() as UploadExtension;
  const allowed = UPLOAD_TYPES[normalized] as readonly string[] | undefined;
  if (!allowed || !allowed.includes(contentType.toLowerCase())) throw new Error("上传文件类型不在白名单中。" );
}

/** 生成不可由用户控制路径的对象 Key，防止跨用户/项目覆盖和路径穿越。 */
export function createObjectKey(input: ObjectKeyInput): string {
  if (!ID_PATTERN.test(input.ownerId)) throw new Error("上传所有者 ID 无效。" );
  if (input.projectId && !ID_PATTERN.test(input.projectId)) throw new Error("项目 ID 无效。" );
  if (input.uploadId && !ID_PATTERN.test(input.uploadId)) throw new Error("上传任务 ID 无效。" );
  if (input.contentHash && !HASH_PATTERN.test(input.contentHash)) throw new Error("内容哈希必须是小写 SHA-256。" );

  const objectId = input.contentHash ?? randomUUID();
  switch (input.kind) {
    case "quarantine":
      return `quarantine/${input.ownerId}/${input.uploadId ?? randomUUID()}/${objectId}${input.extension}`;
    case "project-original":
      if (!input.projectId || !input.contentHash) throw new Error("项目原件必须包含 projectId 和 contentHash。" );
      return `projects/${input.projectId}/original/${input.contentHash}/source${input.extension}`;
    case "project-derived":
      if (!input.projectId) throw new Error("项目派生文件必须包含 projectId。" );
      return `projects/${input.projectId}/derived/${objectId}${input.extension}`;
    case "avatar":
      return `avatars/${input.ownerId}/${objectId}${input.extension}`;
  }
}

/** Provider 的最后一道防线：只允许平台拥有的前缀和安全字符。 */
export function assertStorageObjectKey(value: string): void {
  if (value.length < 3 || value.length > 1_024 || value.startsWith("/") || value.includes("..") || value.includes("\\")) {
    throw new Error("OSS Object Key 无效。" );
  }
  if (!/^(quarantine|projects|avatars)\/[A-Za-z0-9_./-]+$/.test(value)) throw new Error("OSS Object Key 不属于允许前缀。" );
}
