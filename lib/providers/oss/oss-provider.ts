import type { OssConfig } from "@/lib/providers/oss/oss-config";
import { assertStorageObjectKey } from "@/lib/providers/oss/object-key";
import type { OssSigningClient } from "@/lib/providers/oss/oss-client";

export interface SignedUploadRequest {
  objectKey: string;
  contentType: string;
  contentLength: number;
}

export interface SignedUploadGrant {
  method: "PUT";
  url: string;
  expiresInSeconds: number;
  requiredHeaders: { "content-type": string };
  objectKey: string;
}

export interface SignedDownloadGrant {
  method: "GET";
  url: string;
  expiresInSeconds: number;
}

/** 上传签名的服务端边界；登录、项目权限和配额必须在调用 Provider 前完成。 */
export class OssObjectStorageProvider {
  public constructor(private readonly config: OssConfig, private readonly client: OssSigningClient) {}

  /** 为单个受控 Object Key 创建短期 PUT URL；上传完成后仍须通过 Head/哈希校验才能转正。 */
  public async createUploadGrant(request: SignedUploadRequest): Promise<SignedUploadGrant> {
    assertStorageObjectKey(request.objectKey);
    if (!request.contentType || request.contentType.length > 200) throw new Error("上传 Content-Type 无效。" );
    if (!Number.isInteger(request.contentLength) || request.contentLength < 1 || request.contentLength > 25 * 1024 * 1024) {
      throw new Error("上传文件必须在 1 byte 到 25 MiB 之间。" );
    }
    const url = await this.client.asyncSignatureUrl(request.objectKey, {
      method: "PUT",
      expires: this.config.signedUrlTtlSeconds,
      "Content-Type": request.contentType,
    });
    return {
      method: "PUT",
      url,
      expiresInSeconds: this.config.signedUrlTtlSeconds,
      requiredHeaders: { "content-type": request.contentType },
      objectKey: request.objectKey,
    };
  }

  /** 为已通过权限检查的对象创建短期 GET URL；数据库只保存 objectKey，不保存该 URL。 */
  public async createDownloadGrant(objectKey: string): Promise<SignedDownloadGrant> {
    assertStorageObjectKey(objectKey);
    const url = await this.client.asyncSignatureUrl(objectKey, { method: "GET", expires: this.config.signedUrlTtlSeconds });
    return { method: "GET", url, expiresInSeconds: this.config.signedUrlTtlSeconds };
  }
}
