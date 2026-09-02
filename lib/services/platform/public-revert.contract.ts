import assert from "node:assert/strict";

import { POST } from "@/app/api/platform/projects/[id]/history/[commitId]/revert/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";
import { inverseOperation } from "@/lib/services/platform/public-revert-service";

/** 回滚契约：操作映射确定，未登录不能触发保护分支写入。 */
async function run(): Promise<void> {
  assert.equal(inverseOperation("create_node"), "delete_node");
  assert.equal(inverseOperation("delete_node"), "restore_node");
  assert.equal(inverseOperation("rename_node"), "rename_node");
  assert.equal(inverseOperation("move_node"), "move_node");
  setAuthenticatedActorResolverForTest(async () => null);
  try {
    const response = await POST(new Request("http://localhost/api/platform/projects/project-huice/history/commit-x/revert", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: "{}" }), { params: { id: "project-huice", commitId: "commit-x" } });
    assert.equal(response.status, 401);
  } finally { setAuthenticatedActorResolverForTest(null); }
  console.log("public-revert contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
