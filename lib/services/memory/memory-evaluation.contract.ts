import assert from "node:assert/strict";

import { evaluateMemoryGoldenSet, memoryGoldenSet } from "@/lib/services/memory/memory-evaluation-service";

/** 记忆 Golden Set 契约：验证召回/精确、过期注入、压缩保留和 Resume 指标。 */
function run(): void {
  const report = evaluateMemoryGoldenSet(memoryGoldenSet);
  assert.equal(report.caseCount, 5);
  assert.equal(report.recall, 1);
  assert.equal(report.precision, 1);
  assert.equal(report.staleInjectionRate, 0);
  assert.equal(report.compressionFactRetention, 1);
  assert.equal(report.resumeFidelity, 1);
  assert.equal(report.failures.length, 0);
  assert.ok(report.totalCostUsd > 0);

  const failed = evaluateMemoryGoldenSet([{ id: "broken", expectedMemoryIds: ["a"], retrievedMemoryIds: ["wrong"], staleMemoryIds: ["old"], injectedMemoryIds: ["old"], criticalFactsBefore: ["date"], criticalFactsAfter: [], resumedStateBefore: "v1", resumedStateAfter: "v2" }]);
  assert.deepEqual(failed.failures.map((item) => item.reason), ["recall", "precision", "stale_injection", "fact_loss", "resume_mismatch"]);
  console.log("memory-evaluation contract: passed");
}

try { run(); } catch (error) { console.error(error); process.exitCode = 1; }
