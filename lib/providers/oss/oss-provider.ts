import type OSS from "ali-oss";
import type { OssConfig } from "@/lib/providers/oss/oss-config";
import { assertStorageObjectKey } from "@/lib/providers/oss/object-key";
import type { OssObjectHead, OssSigningClient } from "@/lib/providers/oss/oss-client";

export interface SignedUploadRequest {
  objectKey: string;
  contentType: string;
  contentLength: number;
  /** 客户端直传时写入 x-oss-meta-sha256；缺失时只能由完成接口拒绝转正。 */
  sha256?: string;
}

export interface SignedUploadGrant {
  method: "PUT";
  url: string;
  expiresInSeconds: number;
  requiredHeaders: { "content-type": string; "x-oss-meta-sha256": string };
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
    if (!request.objectKey.startsWith("quarantine/")) throw new Error("直传对象只能写入隔离区。");
    if (!request.contentType || request.contentType.length > 200) throw new Error("上传 Content-Type 无效。" );
    if (!Number.isInteger(request.contentLength) || request.contentLength < 1 || request.contentLength > 25 * 1024 * 1024) {
      throw new Error("上传文件必须在 1 byte 到 25 MiB 之间。" );
    }
    const signingOptions = {
      method: "PUT",
      expires: this.config.signedUrlTtlSeconds,
      "Content-Type": request.contentType,
      ...(request.sha256 ? { "x-oss-meta-sha256": request.sha256 } : {}),
    } as OSS.SignatureUrlOptions;
    const url = await this.client.asyncSignatureUrl(request.objectKey, signingOptions);
    return {
      method: "PUT",
      url,
      expiresInSeconds: this.config.signedUrlTtlSeconds,
      requiredHeaders: { "content-type": request.contentType, "x-oss-meta-sha256": request.sha256 ?? "" },
      objectKey: request.objectKey,
    };
  }

  /** 读取元数据；测试可以注入 mock client，生产必须由 ECS RAM Role 调用 OSS HeadObject。 */
  public async headObject(objectKey: string): Promise<OssObjectHead> {
    assertStorageObjectKey(objectKey);
    if (!this.client.asyncHeadObject) throw new Error("OSS Provider 未配置 HeadObject 能力。");
    return this.client.asyncHeadObject(objectKey);
  }

  /** 当对象未保存可信 SHA 元数据时读取私有对象并流式重算；失败则由服务层拒绝转正。 */
  public async sha256Object(objectKey: string): Promise<string> {
    assertStorageObjectKey(objectKey);
    if (!this.client.asyncSha256Object) throw new Error("OSS Provider 未配置 SHA-256 校验能力。");
    return this.client.asyncSha256Object(objectKey);
  }

  /** 删除已通过所有者校验的隔离对象；verified 原件由服务层禁止调用此能力。 */
  public async deleteObject(objectKey: string): Promise<void> {
    assertStorageObjectKey(objectKey);
    if (!objectKey.startsWith("quarantine/")) throw new Error("只能删除隔离区对象，正式原件不可删除。");
    if (!this.client.asyncDeleteObject) throw new Error("OSS Provider 未配置 DeleteObject 能力。");
    await this.client.asyncDeleteObject(objectKey);
  }

  /** 为已通过权限检查的对象创建短期 GET URL；数据库只保存 objectKey，不保存该 URL。 */
  public async createDownloadGrant(objectKey: string): Promise<SignedDownloadGrant> {
    assertStorageObjectKey(objectKey);
    const url = await this.client.asyncSignatureUrl(objectKey, { method: "GET", expires: this.config.signedUrlTtlSeconds });
    return { method: "GET", url, expiresInSeconds: this.config.signedUrlTtlSeconds };
  }
}
