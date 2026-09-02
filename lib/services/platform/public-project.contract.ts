import assert from "node:assert/strict";

import { GET as getProjects, POST as createProject } from "@/app/api/platform/projects/route";
import { GET as getProject } from "@/app/api/platform/projects/[id]/route";
import { GET as exportProject } from "@/app/api/platform/projects/[id]/export/route";
import { POST as recordView } from "@/app/api/platform/projects/[id]/view/route";
import { DELETE as deleteStar, GET as getStarState, POST as postStar } from "@/app/api/platform/projects/[id]/star/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import { AccountService } from "@/lib/services/platform/account-service";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";

/** 公开项目 API 最小契约：匿名 seed 读取、未知项目 404、创建必须有签名 actor。 */
async function run(): Promise<void> {
  const list = await getProjects(new Request("http://localhost/api/platform/projects?q=慧策"));
  assert.equal(list.status, 200);
  const listBody = await list.json() as { projects: Array<{ id: string }>; source: string };
  assert.equal(listBody.source, "typed_seed");
  assert.equal(listBody.projects.length, 1);

  const detail = await getProject(new Request("http://localhost/api/platform/projects/project-huice"), { params: { id: "project-huice" } });
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as { project: { files: unknown[]; sections: unknown[] } };
  assert.ok(detailBody.project.files.length > 0);
  assert.ok(detailBody.project.sections.length > 0);
  const markdownExport = await exportProject(new Request("http://localhost/api/platform/projects/project-huice/export?format=markdown"), { params: { id: "project-huice" } });
  assert.equal(markdownExport.status, 200);
  assert.match(markdownExport.headers.get("content-type") ?? "", /text\/markdown; charset=utf-8/);
  assert.match(markdownExport.headers.get("content-disposition") ?? "", /filename\*=UTF-8''/);
  const markdownBody = await markdownExport.text();
  assert.match(markdownBody, /慧策掌上先机/);
  assert.match(markdownBody, /## 公开正文/);
  assert.doesNotMatch(markdownBody, /avatarAssetId|objectKey|签名/);
  assert.equal((await exportProject(new Request("http://localhost/api/platform/projects/project-huice/export?format=html"), { params: { id: "project-huice" } })).status, 400);
  assert.equal((await getProject(new Request("http://localhost/api/platform/projects/nope"), { params: { id: "nope" } })).status, 404);

  setAuthenticatedActorResolverForTest(async () => null);
  assert.equal((await createProject(new Request("http://localhost/api/platform/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "不可匿名创建" }) }))).status, 401);

  const repository = new MemoryPlatformRepository();
  const account = await new AccountService(repository, { hash: async () => "hash", verify: async () => true }).register({ email: "owner@example.com", username: "owner", password: "securePass123" });
  setPlatformRepositoryForTest(repository);
  setAuthenticatedActorResolverForTest(async () => ({ userId: account.id, role: "user" }));
  const created = await new PublicProjectService(repository).createPrivate({ userId: account.id, role: "user" }, { title: "我的私有项目" });
  assert.equal(created.data.status, "draft");
  assert.equal(created.data.visibility, "private");
  // 即使替换仓储误返回私有对象，服务层导出也必须 fail closed。
  assert.equal((await new PublicProjectService(repository).exportMarkdown(created.data.id)).data, null);

  // 公开阅读统计必须是真实去重语义：同一访客同日重复打开不增加人数，跨天回访也不重复增加全站读者。
  const publicProject = { ...created.data, visibility: "public" as const, status: "published" as const, publishedAt: created.data.updatedAt };
  repository.seedPublicProject(publicProject);
  const projectService = new PublicProjectService(repository);
  const countedProject = { ...publicProject, commentCount: 3 };
  repository.seedPublicProject(countedProject);
  assert.equal((await projectService.get(countedProject.id)).data?.commentCount, 3, "真实评论聚合必须通过公开项目投影传递");
  const firstView = await projectService.recordView({ projectIdOrSlug: publicProject.id, visitorId: "visitor-a", viewedOn: "2026-09-02" });
  const repeatedView = await projectService.recordView({ projectIdOrSlug: publicProject.id, visitorId: "visitor-a", viewedOn: "2026-09-02" });
  const secondVisitor = await projectService.recordView({ projectIdOrSlug: publicProject.slug, visitorId: "visitor-b", viewedOn: "2026-09-02" });
  const nextDayReturn = await projectService.recordView({ projectIdOrSlug: publicProject.id, visitorId: "visitor-a", viewedOn: "2026-09-03" });
  assert.equal(firstView.data.recorded, true);
  assert.equal(repeatedView.data.recorded, false);
  assert.equal(secondVisitor.data.uniqueReaders, 2);
  assert.equal(nextDayReturn.data.uniqueReaders, 2);

  // API 会给匿名访客签发 HttpOnly Cookie；后续请求沿用 Cookie 后仍由服务端每日去重。
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "test://platform-view-contract";
  setPlatformRepositoryForTest(repository);
  setAuthenticatedActorResolverForTest(async () => null);
  const apiView = await recordView(new Request("http://localhost/api/platform/projects/my-private-project/view", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" }, body: "{}" }), { params: { id: publicProject.id } });
  assert.equal(apiView.status, 200);
  assert.ok(apiView.headers.get("set-cookie")?.includes("research_visitor_id="));
  const botView = await recordView(new Request("http://localhost/api/platform/projects/view", { method: "POST", headers: { "content-type": "application/json", "user-agent": "HealthCheckBot/1.0" }, body: "{}" }), { params: { id: publicProject.id } });
  assert.equal(botView.status, 200);
  assert.equal((await botView.json() as { ignored?: string }).ignored, "automated_client");

  // Star 只允许真实登录用户写入；重复 POST/DELETE 必须保持同一计数。
  const anonymousStars = await getStarState(new Request(`http://localhost/api/platform/projects/${publicProject.id}/star`), { params: { id: publicProject.id } });
  assert.equal(anonymousStars.status, 200);
  assert.equal((await anonymousStars.json() as { starCount?: number; starred?: boolean }).starred, false);
  setAuthenticatedActorResolverForTest(async () => null);
  const deniedStar = await postStar(new Request("http://localhost/api/platform/projects/star", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ starred: true }) }), { params: { id: publicProject.id } });
  assert.equal(deniedStar.status, 401);
  setAuthenticatedActorResolverForTest(async () => ({ userId: account.id, role: "user" }));
  const firstStar = await postStar(new Request("http://localhost/api/platform/projects/star", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ starred: true }) }), { params: { id: publicProject.id } });
  const repeatedStar = await postStar(new Request("http://localhost/api/platform/projects/star", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ starred: true }) }), { params: { id: publicProject.id } });
  assert.equal(firstStar.status, 200);
  assert.equal((await firstStar.json() as { starCount?: number; starred?: boolean }).starCount, 1);
  assert.equal((await repeatedStar.json() as { starCount?: number; starred?: boolean }).starCount, 1);
  const currentStar = await getStarState(new Request("http://localhost/api/platform/projects/star"), { params: { id: publicProject.id } });
  assert.equal((await currentStar.json() as { starred?: boolean }).starred, true);
  const removedStar = await deleteStar(new Request("http://localhost/api/platform/projects/star", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }), { params: { id: publicProject.id } });
  const repeatedRemoval = await deleteStar(new Request("http://localhost/api/platform/projects/star", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }), { params: { id: publicProject.id } });
  assert.equal((await removedStar.json() as { starCount?: number; starred?: boolean }).starCount, 0);
  assert.equal((await repeatedRemoval.json() as { starCount?: number; starred?: boolean }).starCount, 0);
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  setAuthenticatedActorResolverForTest(null);
  setPlatformRepositoryForTest(null);
  console.log("public project contract: passed");
}

void run().catch((error: unknown) => {
  setAuthenticatedActorResolverForTest(null);
  setPlatformRepositoryForTest(null);
  console.error(error);
  process.exitCode = 1;
});
