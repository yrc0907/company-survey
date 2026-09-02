import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GET } from "@/app/api/platform/projects/[id]/history/[commitId]/route";

/** 公开逐段 Diff 契约：未连接持久化或目标不是公开主分支时不能伪造版本内容。 */
async function run(): Promise<void> {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const response = await GET(new Request("http://localhost/api/platform/projects/project-huice/history/commit-missing"), { params: { id: "project-huice", commitId: "commit-missing" } });
    assert.equal(response.status, 404);
    const body = await response.json() as { error?: string };
    assert.equal(body.error, "公开版本不存在");

    const service = readFileSync(resolve(process.cwd(), "lib", "services", "platform", "public-history-detail-service.ts"), "utf8");
    assert.match(service, /b\.is_protected\s*=\s*TRUE/);
    assert.match(service, /k\.visibility\s*=\s*'public'/);
    assert.match(service, /k\.status\s*=\s*'published'/);
    assert.match(service, /LIMIT 200/);
    assert.match(service, /MAX_DIFF_TEXT = 20_000/);
    console.log("public-history-detail contract: passed");
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
