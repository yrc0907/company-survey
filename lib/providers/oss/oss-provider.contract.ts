import assert from "node:assert/strict";

import { getOssConfig } from "@/lib/providers/oss/oss-config";
import { assertAllowedUpload, assertStorageObjectKey, createObjectKey } from "@/lib/providers/oss/object-key";
import { OssObjectStorageProvider } from "@/lib/providers/oss/oss-provider";

async function run(): Promise<void> {
  const missing = getOssConfig({});
  assert.equal(missing.configured, false, "未配置时不能创建默认公共 OSS 客户端");
  const staticKey = getOssConfig({ OSS_AUTH_MODE: "access_key" });
  assert.equal(staticKey.configured, false, "生产配置必须拒绝永久 AccessKey 模式");

  const configured = getOssConfig({
    OSS_AUTH_MODE: "ecs_ram_role",
    OSS_RAM_ROLE_NAME: "research-oss",
    OSS_BUCKET: "reaserch",
    OSS_REGION: "cn-shanghai",
    OSS_ENDPOINT: "https://oss-cn-shanghai.aliyuncs.com",
  });
  if (!configured.configured) throw new Error(configured.reason);
  assert.equal(configured.configured, true);

  assertAllowedUpload(".pdf", "application/pdf");
  assert.throws(() => assertAllowedUpload(".exe", "application/octet-stream"), /白名单/);
  const key = createObjectKey({
    kind: "quarantine",
    ownerId: "user_01",
    uploadId: "upload_01",
    contentHash: "a".repeat(64),
    extension: ".pdf",
  });
  assert.equal(key, `quarantine/user_01/upload_01/${"a".repeat(64)}.pdf`);
  assertStorageObjectKey(key);
  assert.throws(() => assertStorageObjectKey("../other-user/private.pdf"), /无效/);

  const signedCalls: Array<{ name: string; options: { method?: string; expires?: number; "Content-Type"?: string } }> = [];
  const deletedKeys: string[] = [];
  const provider = new OssObjectStorageProvider(configured.value, {
    asyncSignatureUrl: async (name, options) => {
      signedCalls.push({ name, options });
      return `https://signed.test/${encodeURIComponent(name)}`;
    },
    asyncDeleteObject: async (name) => { deletedKeys.push(name); },
  });
  const upload = await provider.createUploadGrant({ objectKey: key, contentType: "application/pdf", contentLength: 1024 });
  assert.equal(upload.method, "PUT");
  assert.equal(upload.requiredHeaders["content-type"], "application/pdf");
  assert.equal(signedCalls[0]?.options.expires, 900);
  assert.equal((await provider.createDownloadGrant(key)).method, "GET");
  await provider.deleteObject(key);
  assert.deepEqual(deletedKeys, [key], "删除必须只作用于经过 Object Key 校验的对象");
  await assert.rejects(() => provider.deleteObject("../other-user/private.pdf"), /无效/);
  await assert.rejects(() => provider.deleteObject("projects/project_01/original/source.pdf"), /隔离区/);
  await assert.rejects(() => provider.createUploadGrant({ objectKey: "projects/project_01/original/source.pdf", contentType: "application/pdf", contentLength: 1024 }), /隔离区/);
  await assert.rejects(() => provider.createUploadGrant({ objectKey: key, contentType: "application/pdf", contentLength: 30 * 1024 * 1024 }), /25 MiB/);

  console.log("oss-provider contract: passed");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
