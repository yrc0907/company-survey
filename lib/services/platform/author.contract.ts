import assert from "node:assert/strict";

import { GET as getAuthor } from "@/app/api/platform/authors/[username]/route";
import { DELETE as deleteFollow, GET as getFollow, POST as postFollow } from "@/app/api/platform/authors/[username]/follow/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";
import { AccountService } from "@/lib/services/platform/account-service";
import { AuthorService } from "@/lib/services/platform/author-service";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

/** 作者主页与关注 API 契约：匿名读取、登录幂等、自关注拒绝和取消关系。 */
async function run(): Promise<void> {
  const repository = new MemoryPlatformRepository();
  const accounts = new AccountService(repository, { hash: async () => "hash", verify: async () => true });
  const author = await accounts.register({ email: "author@example.com", username: "author", displayName: "公开作者", password: "securePass123" });
  const follower = await accounts.register({ email: "follower@example.com", username: "follower", displayName: "关注者", password: "securePass123" });
  const emptyProfile = await new AuthorService(repository).getProfile("author", null);
  assert.equal(emptyProfile.data.projectCount, 0, "作者可以先创建主页，再逐步发布项目");
  const created = await new PublicProjectService(repository).createPrivate({ userId: author.id, role: "user" }, { title: "作者的公开研究" });
  repository.seedPublicProject({ ...created.data, visibility: "public", status: "published", publishedAt: created.data.updatedAt });
  setPlatformRepositoryForTest(repository);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "test://author-follow-contract";
  setAuthenticatedActorResolverForTest(async () => null);

  const anonymousProfile = await getAuthor(new Request("http://localhost/api/platform/authors/author"), { params: { username: "author" } });
  assert.equal(anonymousProfile.status, 200);
  const profileBody = await anonymousProfile.json() as { author: { projectCount: number; followerCount: number; followedByCurrentUser: boolean; projects: unknown[]; contributions: unknown[]; activity: unknown[] } };
  assert.equal(profileBody.author.projectCount, 1);
  assert.equal(profileBody.author.followerCount, 0);
  assert.equal(profileBody.author.followedByCurrentUser, false);
  assert.ok(Array.isArray(profileBody.author.activity), "作者主页必须返回可核验活动日聚合");
  assert.equal(profileBody.author.projects.length, 1);
  assert.deepEqual(profileBody.author.contributions, [], "内存模式不能伪造段落贡献行为");

  const anonymousState = await getFollow(new Request("http://localhost/api/platform/authors/author/follow"), { params: { username: "author" } });
  assert.equal(anonymousState.status, 200);
  assert.equal((await anonymousState.json() as { following: boolean }).following, false);
  const denied = await postFollow(new Request("http://localhost/api/platform/authors/author/follow", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: { username: "author" } });
  assert.equal(denied.status, 401);

  setAuthenticatedActorResolverForTest(async () => ({ userId: follower.id, role: "user" }));
  const first = await postFollow(new Request("http://localhost/api/platform/authors/author/follow", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: { username: "author" } });
  const repeated = await postFollow(new Request("http://localhost/api/platform/authors/author/follow", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: { username: "author" } });
  assert.equal(first.status, 200);
  assert.equal((await first.json() as { following: boolean; followerCount: number }).following, true);
  assert.equal((await repeated.json() as { followerCount: number }).followerCount, 1);
  const profileAfterFollow = await getAuthor(new Request("http://localhost/api/platform/authors/author"), { params: { username: "author" } });
  const profileAfterFollowBody = await profileAfterFollow.json() as { author: { followedByCurrentUser: boolean; followerCount: number } };
  assert.equal(profileAfterFollowBody.author.followedByCurrentUser, true);
  assert.equal(profileAfterFollowBody.author.followerCount, 1);

  const removed = await deleteFollow(new Request("http://localhost/api/platform/authors/author/follow", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }), { params: { username: "author" } });
  const repeatedRemoval = await deleteFollow(new Request("http://localhost/api/platform/authors/author/follow", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }), { params: { username: "author" } });
  assert.equal((await removed.json() as { following: boolean; followerCount: number }).following, false);
  assert.equal((await repeatedRemoval.json() as { followerCount: number }).followerCount, 0);

  setAuthenticatedActorResolverForTest(async () => ({ userId: author.id, role: "user" }));
  const selfFollow = await postFollow(new Request("http://localhost/api/platform/authors/author/follow", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), { params: { username: "author" } });
  assert.equal(selfFollow.status, 400);

  setAuthenticatedActorResolverForTest(null);
  setPlatformRepositoryForTest(null);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  console.log("author follow contract: passed");
}

void run().catch((error: unknown) => {
  setAuthenticatedActorResolverForTest(null);
  setPlatformRepositoryForTest(null);
  console.error(error);
  process.exitCode = 1;
});
