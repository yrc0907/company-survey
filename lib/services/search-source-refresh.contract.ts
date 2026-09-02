import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { SearchSourceRefreshService } from "@/lib/services/search-source-refresh-service";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import type { WorkbenchSnapshot } from "@/lib/domain/research";

const text = "原始正文";
const snapshot: WorkbenchSnapshot = {
  companies: [], reports: [], sections: [],
  sources: [{ id: "source-a", reportId: "report-a", title: "官网", kind: "web", url: "https://example.com/a", language: "zh", state: "active", capturedAt: "2026-01-01T00:00:00.000Z", contentHash: createHash("sha256").update(text).digest("hex"), snapshot: text }],
  chunks: [], citations: [], entities: [], edges: [], revisions: [],
};

async function run(): Promise<void> {
  const writes: string[] = [];
  const repository = {
    getSnapshot: async () => structuredClone(snapshot),
    createTextSource: async (source: { state: string }) => { writes.push(source.state); },
  } as unknown as ResearchRepository;
  const resolveHost = async () => [{ address: "93.184.216.34", family: 4 }];
  const unchanged = await new SearchSourceRefreshService(repository, async () => new Response(text, { headers: { "content-type": "text/plain" } }), resolveHost).refresh("source-a");
  assert.equal(unchanged.status, "unchanged");
  const changed = await new SearchSourceRefreshService(repository, async () => new Response("新正文", { headers: { "content-type": "text/plain" } }), resolveHost).refresh("source-a");
  assert.equal(changed.status, "needs_review");
  assert.equal(changed.source.state, "needs_review");
  assert.deepEqual(writes, ["needs_review"]);
  await assert.rejects(() => new SearchSourceRefreshService(repository, async () => new Response("redirect", { status: 302, headers: { location: "https://example.com/b" } }), resolveHost).refresh("source-a"), /不允许重定向/);
  await assert.rejects(() => new SearchSourceRefreshService(repository, async () => new Response(text), async () => [{ address: "10.0.0.8", family: 4 }]).refresh("source-a"), /本机或内网/);
  console.log("search-source-refresh contract: passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
