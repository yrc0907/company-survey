import Credential, { Config as CredentialConfig } from "@alicloud/credentials";
import OSS from "ali-oss";
import { createHash } from "node:crypto";

import type { OssConfig } from "@/lib/providers/oss/oss-config";

/** 仅暴露对象签名所需的窄接口，业务服务不能调用 Bucket 管理或任意 OSS API。 */
export interface OssSigningClient {
  asyncSignatureUrl(name: string, options: OSS.SignatureUrlOptions): Promise<string>;
  /** 读取单个对象元数据，用于确认浏览器直传没有被替换或截断。 */
  asyncHeadObject?(name: string): Promise<OssObjectHead>;
  /** 25 MiB 白名单内对象可由服务端流式计算 SHA-256，避免仅信任客户端 header。 */
  asyncSha256Object?(name: string): Promise<string>;
  /** 删除隔离区对象；只由 Provider 在完成所有者校验后调用。 */
  asyncDeleteObject?(name: string): Promise<void>;
}

export interface OssObjectHead {
  etag: string | null;
  contentLength: number | null;
  sha256: string | null;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * 兼容不同 ali-oss 版本的 HEAD 用户元数据形状：SDK 通常把前缀剥成 `meta.sha256`，
 * 某些代理/版本只保留原始响应头。值必须是 64 位小写 SHA-256，异常元数据按缺失处理，
 * 由上层触发对象流式重算，而不是把不可信 header 当作完整性证据。
 */
export function extractOssSha256Metadata(
  metadata: Record<string, unknown> | null | undefined,
  headers: Record<string, unknown> | null | undefined,
): string | null {
  const read = (source: Record<string, unknown> | null | undefined, keys: string[]): string | null => {
    if (!source) return null;
    const keySet = new Set(keys.map((key) => key.toLowerCase()));
    const entry = Object.entries(source).find(([key]) => keySet.has(key.toLowerCase()));
    if (!entry) return null;
    const value = String(entry[1]).trim().replace(/^"|"$/g, "").toLowerCase();
    return SHA256_PATTERN.test(value) ? value : null;
  };
  return read(metadata, ["sha256", "x-oss-meta-sha256"]) ?? read(headers, ["x-oss-meta-sha256"]);
}

/** 使用 ECS IMDSv2 临时凭据创建 OSS 客户端；凭据只存在进程内并由 SDK 自动刷新。 */
export async function createOssSigningClient(config: OssConfig): Promise<OssSigningClient> {
  const credentialConfig = new CredentialConfig({
    type: "ecs_ram_role",
    roleName: config.roleName,
    disableIMDSv1: true,
    asyncCredentialUpdateEnabled: true,
  });
  const credential = new Credential(credentialConfig);
  const initial = await credential.getCredential();
  if (!initial.accessKeyId || !initial.accessKeySecret || !initial.securityToken) throw new Error("ECS RAM Role 未返回完整临时凭据。" );

  const client = new OSS({
    accessKeyId: initial.accessKeyId,
    accessKeySecret: initial.accessKeySecret,
    stsToken: initial.securityToken,
    bucket: config.bucket,
    endpoint: config.endpoint,
    secure: true,
    refreshSTSTokenInterval: 5 * 60 * 1_000,
    refreshSTSToken: async () => {
      const next = await credential.getCredential();
      if (!next.accessKeyId || !next.accessKeySecret || !next.securityToken) throw new Error("ECS RAM Role 临时凭据刷新失败。" );
      return { accessKeyId: next.accessKeyId, accessKeySecret: next.accessKeySecret, stsToken: next.securityToken };
    },
  });
  return {
    asyncSignatureUrl: (name, options) => client.asyncSignatureUrl(name, options),
    asyncHeadObject: async (name) => {
      const result = await client.head(name);
      const headers = result.res.headers as Record<string, unknown>;
      const metadata = (result.meta ?? {}) as Record<string, unknown>;
      const rawLength = headers["content-length"] ?? headers["Content-Length"];
      const contentLength = rawLength === undefined ? null : Number(rawLength);
      return {
        etag: String(headers.etag ?? headers.ETag ?? "").replace(/^"|"$/g, "") || null,
        contentLength: Number.isFinite(contentLength) ? contentLength : null,
        sha256: extractOssSha256Metadata(metadata, headers),
      };
    },
    asyncSha256Object: async (name) => {
      const result = await client.getStream(name);
      const hash = createHash("sha256");
      for await (const chunk of result.stream as AsyncIterable<Uint8Array>) hash.update(chunk);
      return hash.digest("hex");
    },
    asyncDeleteObject: async (name) => {
      // OSS DELETE 对不存在对象保持幂等，便于用户重复点击取消或清理失败重试。
      await client.delete(name);
    },
  };
}
