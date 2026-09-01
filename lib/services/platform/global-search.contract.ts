import assert from "node:assert/strict";

import { GET as globalSearch } from "@/app/api/platform/search/route";

/** 全站公开搜索契约：匿名检索项目、作者和公开章节，错误输入有稳定 400 边界。 */
async function run(): Promise<void> {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const project = await globalSearch(new Request("http://localhost/api/platform/search?q=慧策&limit=20"));
    assert.equal(project.status, 200);
    const projectBody = await project.json() as { source: string; results: Array<{ kind: string; title: string; description: string }> };
    assert.equal(projectBody.source, "typed_seed");
    assert.ok(projectBody.results.some((result) => result.kind === "project" && result.title.includes("慧策")));
    assert.ok(projectBody.results.every((result) => result.description.length <= 240 || result.kind !== "document"));

    const author = await globalSearch(new Request("http://localhost/api/platform/search?q=yu-research"));
    const authorBody = await author.json() as { results: Array<{ kind: string; authorUsername: string | null }> };
    assert.ok(authorBody.results.some((result) => result.kind === "author" && result.authorUsername === "yu-research"));

    const empty = await globalSearch(new Request("http://localhost/api/platform/search?q="));
    assert.equal(empty.status, 400);
    const invalidLimit = await globalSearch(new Request("http://localhost/api/platform/search?q=慧策&limit=not-a-number"));
    assert.equal(invalidLimit.status, 400);
    console.log("global-search contract: passed");
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
