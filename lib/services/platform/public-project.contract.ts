import assert from "node:assert/strict";

import { GET as getProjects, POST as createProject } from "@/app/api/platform/projects/route";
import { GET as getProject } from "@/app/api/platform/projects/[id]/route";
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
