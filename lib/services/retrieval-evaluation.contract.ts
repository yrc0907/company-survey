import assert from "node:assert/strict";

import { evaluateRetrievalGoldenSet, retrievalGoldenSet } from "@/lib/services/retrieval-evaluation-service";

/** Golden Set 契约：验证八类案例、引用覆盖、拒答和成本/延迟指标可重放。 */
function run(): void {
  const report = evaluateRetrievalGoldenSet(retrievalGoldenSet, 5);
  assert.equal(report.caseCount, 8);
  assert.equal(report.recallAtK, 1);
  assert.equal(report.mrr, 1);
  assert.equal(report.citationCoverage, 1);
  assert.equal(report.abstentionAccuracy, 1);
  assert.equal(report.failures.length, 0);
  assert.ok(report.averageLatencyMs > 0);
  assert.ok(report.totalCostUsd > 0);
  assert.equal(report.byCategory.policy.caseCount, 1);

  const failed = evaluateRetrievalGoldenSet([{ id: "broken", category: "exact", expectedChunkIds: ["expected"], returnedChunkIds: ["wrong"], expectedCitationIds: ["source"], returnedCitationIds: [], shouldAbstain: true, abstained: false }]);
  assert.deepEqual(failed.failures.map((item) => item.reason), ["miss", "citation_gap", "abstention_mismatch"]);
  console.log("retrieval-evaluation contract: passed");
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
