/** OSS 认证模式。公开平台生产环境只允许 ECS RAM Role，避免在服务器保存永久 AccessKey。 */
export type OssAuthMode = "ecs_ram_role";

/** 创建 OSS Provider 所需的非敏感配置。 */
export interface OssConfig {
  authMode: OssAuthMode;
  roleName: string;
  bucket: string;
  region: string;
  endpoint: string;
  secure: true;
  signedUrlTtlSeconds: number;
}

/** 未配置时返回明确原因，调用方不能回退到公共 Bucket 或静态密钥。 */
export type OssConfigResult = { configured: true; value: OssConfig } | { configured: false; reason: string };
export type OssEnvironment = Record<string, string | undefined>;

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ROLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** 从进程环境读取并验证 OSS 配置；不会读取或支持永久 AccessKey。 */
export function getOssConfig(environment: OssEnvironment = process.env): OssConfigResult {
  const authMode = environment.OSS_AUTH_MODE?.trim();
  if (!authMode) return { configured: false, reason: "未配置 OSS_AUTH_MODE，上传功能不可用。" };
  if (authMode !== "ecs_ram_role") return { configured: false, reason: "OSS 只允许 ecs_ram_role 认证模式。" };

  const roleName = environment.OSS_RAM_ROLE_NAME?.trim() ?? "";
  const bucket = environment.OSS_BUCKET?.trim() ?? "";
  const region = environment.OSS_REGION?.trim() ?? "";
  const endpointValue = environment.OSS_ENDPOINT?.trim() ?? "";
  if (!ROLE_PATTERN.test(roleName)) return { configured: false, reason: "OSS RAM Role 名称无效。" };
  if (!BUCKET_PATTERN.test(bucket)) return { configured: false, reason: "OSS Bucket 名称无效。" };
  if (!/^[a-z]{2}-[a-z]+(?:-[a-z]+)?$/.test(region)) return { configured: false, reason: "OSS Region ID 无效。" };

  let endpoint: URL;
  try {
    endpoint = new URL(endpointValue);
  } catch {
    return { configured: false, reason: "OSS Endpoint 无效。" };
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.pathname !== "/") {
    return { configured: false, reason: "OSS Endpoint 必须是无凭据、无路径的 HTTPS Origin。" };
  }

  const parsedTtl = Number(environment.OSS_SIGNED_URL_TTL_SECONDS ?? "900");
  const signedUrlTtlSeconds = Number.isInteger(parsedTtl) && parsedTtl >= 60 && parsedTtl <= 3_600 ? parsedTtl : 900;
  return {
    configured: true,
    value: { authMode, roleName, bucket, region, endpoint: endpoint.origin, secure: true, signedUrlTtlSeconds },
  };
}
