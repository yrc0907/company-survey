import assert from "node:assert/strict";

import { GET as getAccountRoute } from "@/app/api/platform/account/route";
import { GET as getProjectAccessRoute } from "@/app/api/platform/account/project-access/route";
import { POST as registerRoute } from "@/app/api/platform/account/register/route";
import { argon2idPasswordHasher } from "@/lib/auth/password";
import { authOptions, projectJwtToSession, projectUserToJwt } from "@/lib/auth/options";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { AccountConflictError, PermissionDeniedError } from "@/lib/domain/platform";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";
import { AccountService } from "@/lib/services/platform/account-service";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";
import { BranchStateService } from "@/lib/services/platform/branch-state-service";

async function run(): Promise<void> {
  const repository = new MemoryPlatformRepository();
  const accounts = new AccountService(repository, argon2idPasswordHasher);
  setPlatformRepositoryForTest(repository);

  const alice = await accounts.register({ email: "Alice@example.com", username: "Alice_01", displayName: "Alice", password: "securePass123" });
  assert.equal(alice.email, "alice@example.com", "邮箱应规范化为小写");
  assert.equal(alice.username, "alice_01", "用户名应规范化为小写");
  assert.equal("passwordHash" in alice, false, "注册结果不能泄漏密码哈希");
  assert.equal((await accounts.authenticate("ALICE_01", "securePass123")).id, alice.id, "用户名登录必须大小写不敏感");
  assert.equal(authOptions.session?.strategy, "jwt", "Auth.js 必须使用加密 JWT Session");
  const token = projectUserToJwt({}, { id: alice.id, email: alice.email, name: alice.displayName, image: null, username: alice.username, role: alice.role });
  const session = projectJwtToSession({ expires: new Date(Date.now() + 60_000).toISOString(), user: { id: "", username: "", role: "user" } }, token);
  assert.equal(session.user.id, alice.id, "Session 必须包含数据库稳定用户 ID");
  assert.equal(session.user.role, "user", "Session 角色必须来自服务端用户投影");

  await assert.rejects(
    accounts.register({ email: "alice@example.com", username: "other-user", password: "securePass123" }),
    (error: unknown) => error instanceof AccountConflictError && error.field === "email",
    "重复邮箱必须稳定冲突",
  );
  await assert.rejects(
    accounts.register({ email: "other@example.com", username: "ALICE_01", password: "securePass123" }),
    (error: unknown) => error instanceof AccountConflictError && error.field === "username",
    "重复用户名必须稳定冲突",
  );
  await assert.rejects(accounts.authenticate("alice@example.com", "wrongPassword123"), /账号或密码错误/, "错误密码必须被拒绝");

  repository.seedProject({ id: "public-project", ownerUserId: alice.id, visibility: "public", status: "published", memberRole: null });
  repository.seedProject({ id: "private-project", ownerUserId: "different-owner", visibility: "private", status: "draft", memberRole: null });
  repository.seedBranch({ id: "main", projectId: "public-project", ownerUserId: null, isProtected: true });
  repository.seedBranch({ id: "alice-draft", projectId: "public-project", ownerUserId: alice.id, isProtected: false });
  repository.seedBranch({ id: "foreign-draft", projectId: "private-project", ownerUserId: "different-owner", isProtected: false });
  repository.seedNodeState({
    projectId: "public-project", branchId: "main", nodeId: "node-1", parentNodeId: null, name: "公开名称", position: 0,
    deletedAt: null, updatedAt: "2026-09-01T00:00:00.000Z",
  });
  repository.seedNodeState({
    projectId: "public-project", branchId: "alice-draft", nodeId: "node-1", parentNodeId: "folder-draft", name: "草稿改名", position: 2,
    deletedAt: null, updatedAt: "2026-09-02T00:00:00.000Z",
  });
  const authorization = new AuthorizationService(repository);
  await authorization.assertProjectAction(null, "public-project", "read_published");
  await assert.rejects(
    authorization.assertBranchAction({ userId: alice.id, role: "user" }, "private-project", "foreign-draft", "write_branch"),
    PermissionDeniedError,
    "非成员不能写入他人私有项目",
  );
  await authorization.assertBranchAction({ userId: alice.id, role: "user" }, "public-project", "alice-draft", "write_branch");
  await assert.rejects(
    authorization.assertBranchAction({ userId: alice.id, role: "user" }, "public-project", "main", "write_branch"),
    PermissionDeniedError,
    "保护分支即使是项目所有者也不能走普通写命令",
  );
  await authorization.assertProjectAction({ userId: alice.id, role: "user" }, "public-project", "manage_project");
  const branchStateService = new BranchStateService(repository);
  const draftState = await branchStateService.getNodeState({ userId: alice.id, role: "user" }, "public-project", "alice-draft", "node-1");
  const mainState = await branchStateService.getNodeState({ userId: alice.id, role: "user" }, "public-project", "main", "node-1");
  assert.equal(draftState?.name, "草稿改名", "草稿分支读取必须返回自己的 rename 状态");
  assert.equal(draftState?.parentNodeId, "folder-draft", "草稿 move 不能写入稳定 Node identity");
  assert.equal(mainState?.name, "公开名称", "读取 main 不能被草稿分支状态污染");

  const invalidRegistration = await registerRoute(new Request("http://localhost/api/platform/account/register", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "bad", username: "x", password: "short" }),
  }));
  assert.equal(invalidRegistration.status, 400, "注册 API 必须执行 Zod 验证");
  const malformedRegistration = await registerRoute(new Request("http://localhost/api/platform/account/register", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{",
  }));
  assert.equal(malformedRegistration.status, 400, "无法解析的 JSON 必须返回 400，而不是内部错误");

  const registration = await registerRoute(new Request("http://localhost/api/platform/account/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "bob@example.com", username: "bob_user", password: "anotherPass123" }),
  }));
  assert.equal(registration.status, 201, "有效注册应创建账户");
  const registrationBody = await registration.json() as { account: { id: string }; passwordHash?: string };
  assert.ok(registrationBody.account.id, "注册 API 应返回稳定用户 ID");
  assert.equal(registrationBody.passwordHash, undefined, "注册 API 不应返回密码哈希");

  const duplicate = await registerRoute(new Request("http://localhost/api/platform/account/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "BOB@example.com", username: "bob_other", password: "anotherPass123" }),
  }));
  assert.equal(duplicate.status, 409, "重复邮箱 API 应返回 409");

  setAuthenticatedActorResolverForTest(async () => null);
  assert.equal((await getAccountRoute()).status, 401, "账户 API 未登录必须返回 401");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=private-project&branchId=foreign-draft&action=write_branch"))).status, 401, "权限 API 未登录必须返回 401");

  setAuthenticatedActorResolverForTest(async () => ({ userId: alice.id, role: "user" }));
  assert.equal((await getAccountRoute()).status, 200, "有效 Session 应读取当前账户");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=private-project&action=unknown"))).status, 400, "权限 API 必须拒绝非白名单动作");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=private-project&action=write_branch"))).status, 400, "分支动作缺少 branchId 必须返回 400");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=private-project&branchId=foreign-draft&action=write_branch"))).status, 403, "越权分支动作必须返回 403");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=public-project&branchId=main&action=write_branch"))).status, 403, "保护分支普通写入必须返回 403");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=public-project&branchId=alice-draft&action=write_branch"))).status, 200, "分支所有者可写自己的非保护草稿");
  assert.equal((await getProjectAccessRoute(new Request("http://localhost/api/platform/account/project-access?projectId=public-project&action=manage_project"))).status, 200, "项目所有者应通过管理权限检查");

  setAuthenticatedActorResolverForTest(null);
  setPlatformRepositoryForTest(null);
  console.log("platform auth contract: passed");
}

void run().catch((error: unknown) => {
  setAuthenticatedActorResolverForTest(null);
  setPlatformRepositoryForTest(null);
  console.error(error);
  process.exitCode = 1;
});
