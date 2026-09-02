import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { POST } from "@/app/api/research/sources/[id]/refresh/route";
import { setAuthenticatedActorResolverForTest } from "@/lib/auth/session";

/** 来源刷新路由契约：先鉴权、再查来源，且只允许 owner 触发，防止公开接口变成任意 URL 抓取器。 */
async function run(): Promise<void> {
  setAuthenticatedActorResolverForTest(async () => null);
  try {
    const response = await POST(new Request("http://localhost/api/research/sources/source-a/refresh"), { params: { id: "source-a" } });
    assert.equal(response.status, 401);
    const body = await response.json() as { code?: string };
    assert.equal(body.code, "AUTHENTICATION_REQUIRED");
    const route = readFileSync(resolve(process.cwd(), "app", "api", "research", "sources", "[id]", "refresh", "route.ts"), "utf8");
    assert.match(route, /requireAuthenticatedActor/);
    assert.match(route, /source\.ownerUserId !== actor\.userId/);
    assert.match(route, /SearchSourceRefreshService/);
    console.log("source-refresh route contract: passed");
  } finally {
    setAuthenticatedActorResolverForTest(null);
  }
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
