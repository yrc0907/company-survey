import assert from "node:assert/strict";

import { GET as getActivity } from "@/app/api/platform/projects/[id]/activity/route";
import { MemoryPlatformRepository } from "@/lib/repositories/platform/memory-platform-repository";
import { setPlatformRepositoryForTest } from "@/lib/repositories/platform/platform-repository-factory";

/** 活动时间线契约：匿名只读、真实来源标记、无数据库不伪造成功、非法游标稳定失败。 */
async function run(): Promise<void> {
  const repository = new MemoryPlatformRepository();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "test://activity-contract";
    setPlatformRepositoryForTest(repository);
    const missing = await getActivity(new Request("http://localhost/api/platform/projects/nope/activity"), { params: { id: "nope" } });
    assert.equal(missing.status, 404);

    const invalid = await getActivity(new Request("http://localhost/api/platform/projects/project-huice/activity?before=invalid"), { params: { id: "project-huice" } });
    assert.equal(invalid.status, 400);

    setPlatformRepositoryForTest(null);
    delete process.env.DATABASE_URL;
    const noPersistence = await getActivity(new Request("http://localhost/api/platform/projects/project-huice/activity"), { params: { id: "project-huice" } });
    assert.equal(noPersistence.status, 409);
    console.log("public-activity contract: passed");
  } finally {
    setPlatformRepositoryForTest(null);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
