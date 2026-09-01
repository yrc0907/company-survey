import Credential, { Config as CredentialConfig } from "@alicloud/credentials";
import OSS from "ali-oss";

import type { OssConfig } from "@/lib/providers/oss/oss-config";

/** 仅暴露对象签名所需的窄接口，业务服务不能调用 Bucket 管理或任意 OSS API。 */
export interface OssSigningClient {
  asyncSignatureUrl(name: string, options: OSS.SignatureUrlOptions): Promise<string>;
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

  return new OSS({
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
}
