import assert from "node:assert/strict";

import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { POST as createUploadRoute } from "@/app/api/platform/uploads/route";
import { POST as completeUploadRoute, DELETE as cancelUploadRoute, GET as getUploadRoute } from "@/app/api/platform/uploads/[id]/route";
import { POST as retryUploadRoute } from "@/app/api/platform/uploads/[id]/retry/route";
import { getOssConfig } from "@/lib/providers/oss";
import { OssObjectStorageProvider } from "@/lib/providers/oss";
import { MemoryAssetsRepository, setAssetsRepositoryForTest } from "@/lib/repositories/assets";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";
import { AccountService } from "@/lib/services/platform/account-service";
import { argon2idPasswordHasher } from "@/lib/auth/password";
import { setAssetsOssProviderForTest } from "@/lib/services/assets/oss-provider-factory";

/** 上传 API 契约：未登录、跨项目、重复、Head 校验失败与幂等重试必须有稳定边界。 */
async function run(): Promise<void> {
  const platform = new MemoryPlatformRepository();
  const assets = new MemoryAssetsRepository();
  const alice = await new AccountService(platform, argon2idPasswordHasher).register({ email: "asset-alice@example.com", username: "asset-alice", password: "securePass123" });
  const bob = await new AccountService(platform, argon2idPasswordHasher).register({ email: "asset-bob@example.com", username: "asset-bob", password: "securePass123" });
  platform.seedProject({ id: "asset-project", ownerUserId: alice.id, visibility: "public", status: "published", memberRole: null });
  platform.seedBranch({ id: "asset-branch", projectId: "asset-project", ownerUserId: alice.id, isProtected: false });
  const config = getOssConfig({ OSS_AUTH_MODE: "ecs_ram_role", OSS_RAM_ROLE_NAME: "research-oss", OSS_BUCKET: "reaserch", OSS_REGION: "cn-shanghai", OSS_ENDPOINT: "https://oss-cn-shanghai.aliyuncs.com" });
  if (!config.configured) throw new Error(config.reason);
  let head = { etag: "e".repeat(32), contentLength: 12, sha256: "a".repeat(64) };
  const deletedKeys: string[] = [];
  setAssetsOssProviderForTest(new OssObjectStorageProvider(config.value, {
    asyncSignatureUrl: async (name) => `https://signed.test/${encodeURIComponent(name)}`,
    asyncHeadObject: async () => head,
    asyncDeleteObject: async (name) => { deletedKeys.push(name); },
  }));
  setPlatformRepositoryForTest(platform); setAssetsRepositoryForTest(assets);
  setAuthenticatedActorResolverForTest(async () => null);
  const unauth = await createUploadRoute(new Request("http://localhost/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "report.md", contentType: "text/markdown", size: 12, sha256: "a".repeat(64) }) }));
  assert.equal(unauth.status, 401, "未登录上传必须返回 401");

  setAuthenticatedActorResolverForTest(async () => ({ userId: alice.id, role: alice.role }));
  const request = () => new Request("http://localhost/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "report.md", contentType: "text/markdown", size: 12, sha256: "a".repeat(64) }) });
  const first = await createUploadRoute(request()); assert.equal(first.status, 201);
  const firstBody = await first.json() as { asset: { id: string }; upload: { requiredHeaders: Record<string, string> } };
  assert.equal(firstBody.upload.requiredHeaders["x-oss-meta-sha256"], "a".repeat(64), "签名上传必须声明 hash metadata");
  const duplicate = await createUploadRoute(request()); const duplicateBody = await duplicate.json() as { asset: { id: string } }; assert.equal(duplicateBody.asset.id, firstBody.asset.id, "重复 SHA 必须幂等返回已有对象");
  const complete = await completeUploadRoute(new Request("http://localhost/api/platform/uploads/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ etag: head.etag, size: 12, sha256: "a".repeat(64) }) }), { params: { id: firstBody.asset.id } });
  assert.equal(complete.status, 200, "三重元数据校验通过后应进入 verified");
  const status = await getUploadRoute(new Request("http://localhost/api/platform/uploads/x"), { params: { id: firstBody.asset.id } }); assert.equal(status.status, 200);

  head = { etag: "f".repeat(32), contentLength: 12, sha256: "b".repeat(64) };
  setAuthenticatedActorResolverForTest(async () => ({ userId: bob.id, role: bob.role }));
  const foreign = await getUploadRoute(new Request("http://localhost/api/platform/uploads/x"), { params: { id: firstBody.asset.id } }); assert.equal(foreign.status, 404, "跨用户状态读取不能泄露资产");
  const forbidden = await createUploadRoute(new Request("http://localhost/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "foreign.md", contentType: "text/markdown", size: 12, sha256: "b".repeat(64), projectId: "asset-project", branchId: "asset-branch" }) })); assert.equal(forbidden.status, 403, "非项目成员不能上传到他人分支");

  setAuthenticatedActorResolverForTest(async () => ({ userId: alice.id, role: alice.role }));
  const failedIntent = await createUploadRoute(new Request("http://localhost/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "bad.md", contentType: "text/markdown", size: 12, sha256: "c".repeat(64) }) })); const failedBody = await failedIntent.json() as { asset: { id: string; objectKey: string } };
  const failedComplete = await completeUploadRoute(new Request("http://localhost/api/platform/uploads/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ etag: "d".repeat(32), size: 12, sha256: "c".repeat(64) }) }), { params: { id: failedBody.asset.id } }); assert.equal(failedComplete.status, 400, "Head 校验失败不能转正");
  assert.deepEqual(deletedKeys, [failedBody.asset.objectKey], "校验失败的隔离对象应尝试立即回收");
  const verificationRetry = await retryUploadRoute(new Request("http://localhost/api/platform/uploads/x/retry", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: { id: failedBody.asset.id } }); assert.equal(verificationRetry.status, 400, "上传校验失败不能把坏对象当解析任务重试");
  await assets.updateIngestionStatus(firstBody.asset.id, "failed", { code: "PARSER_FAILED", message: "mock parser" });
  const retry = await retryUploadRoute(new Request("http://localhost/api/platform/uploads/x/retry", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: { id: firstBody.asset.id } }); assert.equal(retry.status, 200, "已验证对象的失败解析任务可显式重试");
  await assets.updateIngestionStatus(firstBody.asset.id, "failed", { code: "PARSER_FAILED", message: "mock parser" });
  const cancelled = await cancelUploadRoute(new Request("http://localhost/api/platform/uploads/x", { method: "DELETE", headers: { "content-type": "application/json" } }), { params: { id: firstBody.asset.id } }); assert.equal(cancelled.status, 200, "已验证对象可取消解析队列");
  assert.deepEqual(deletedKeys, [failedBody.asset.objectKey], "verified 原件不可因取消解析而删除");

  const pendingIntent = await createUploadRoute(new Request("http://localhost/api/platform/uploads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "pending.md", contentType: "text/markdown", size: 12, sha256: "d".repeat(64) }) }));
  assert.equal(pendingIntent.status, 201);
  const pendingBody = await pendingIntent.json() as { asset: { id: string; objectKey: string } };
  const pendingCancel = await cancelUploadRoute(new Request("http://localhost/api/platform/uploads/x", { method: "DELETE", headers: { "content-type": "application/json" } }), { params: { id: pendingBody.asset.id } });
  assert.equal(pendingCancel.status, 200, "未完成上传取消应成功");
  assert.deepEqual(deletedKeys, [failedBody.asset.objectKey, pendingBody.asset.objectKey], "隔离对象必须在失败或取消时清理");
  setAuthenticatedActorResolverForTest(null); setAssetsRepositoryForTest(null); setPlatformRepositoryForTest(null); setAssetsOssProviderForTest(null);
  console.log("asset-service contract: passed");
}
void run().catch((error: unknown) => { setAuthenticatedActorResolverForTest(null); setAssetsRepositoryForTest(null); setPlatformRepositoryForTest(null); setAssetsOssProviderForTest(null); console.error(error); process.exitCode = 1; });
