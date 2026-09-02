import assert from "node:assert/strict";

import { MemoryResearchRepository } from "@/lib/providers/research-repository";
import { createDemoSnapshot } from "@/lib/providers/seed";
import { GraphService } from "@/lib/services/graph-service";

/** GraphRAG-lite 公开投影的最小契约：有来源边可引用、无来源边只能待核验、跨报告不可穿透。 */
async function run(): Promise<void> {
  const service = new GraphService(new MemoryResearchRepository(createDemoSnapshot));
  const graph = await service.getPublicGraph("report-huice");
  assert.equal(graph.available, true);
  assert.ok(graph.nodes.some((node) => node.name === "慧策"));
  assert.ok(graph.edges.some((edge) => edge.relation === "提供"));
  assert.ok(graph.pendingEdges.some((edge) => edge.relation === "潜在竞品"));
  assert.ok(graph.edges.every((edge) => edge.sourceState === "active"));
  assert.equal((await service.getPublicGraph("report-does-not-exist")).available, false);
  console.log("graph-service contract passed");
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

