import { ValidationError } from "@/lib/domain/errors";
import { createOssSigningClient, getOssConfig, OssObjectStorageProvider } from "@/lib/providers/oss";

let override: OssObjectStorageProvider | null = null;
let provider: OssObjectStorageProvider | null = null;

/** 创建私有 OSS Provider；配置不完整时明确失败，不能退化到公共 Bucket 或本地假上传。 */
export async function getAssetsOssProvider(): Promise<OssObjectStorageProvider> {
  if (override) return override;
  if (provider) return provider;
  const config = getOssConfig();
  if (!config.configured) throw new ValidationError(config.reason);
  provider = new OssObjectStorageProvider(config.value, await createOssSigningClient(config.value));
  return provider;
}

/** 仅供上传契约注入 mock HeadObject/签名客户端。 */
export function setAssetsOssProviderForTest(value: OssObjectStorageProvider | null): void { override = value; }
