/**
 * AI 记忆回归评测器。
 * 评测输入来自脱敏 Golden Case，不读取生产会话；服务只计算记忆召回、精确度、
 * 过期注入、压缩事实保留、恢复一致性与成本，便于在 Provider 替换后比较行为。
 */

export interface MemoryGoldenCase {
  id: string;
  expectedMemoryIds: string[];
  retrievedMemoryIds: string[];
  staleMemoryIds?: string[];
  injectedMemoryIds?: string[];
  criticalFactsBefore?: string[];
  criticalFactsAfter?: string[];
  resumedStateBefore?: string;
  resumedStateAfter?: string;
  costUsd?: number;
}

export interface MemoryEvaluationReport {
  caseCount: number;
  recall: number;
  precision: number;
  staleInjectionRate: number;
  compressionFactRetention: number;
  resumeFidelity: number;
  totalCostUsd: number;
  failures: Array<{ caseId: string; reason: "recall" | "precision" | "stale_injection" | "fact_loss" | "resume_mismatch" }>;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function overlap(expected: string[], actual: string[]): number {
  const set = new Set(actual);
  return expected.filter((id) => set.has(id)).length;
}

/** 计算一组记忆 Golden Case；空的期望集合按“正确不注入”处理。 */
export function evaluateMemoryGoldenSet(cases: MemoryGoldenCase[]): MemoryEvaluationReport {
  let recallTotal = 0;
  let precisionTotal = 0;
  let staleInjected = 0;
  let staleCases = 0;
  let retentionTotal = 0;
  let retentionCases = 0;
  let resumeTotal = 0;
  let resumeCases = 0;
  let totalCostUsd = 0;
  const failures: MemoryEvaluationReport["failures"] = [];

  for (const item of cases) {
    const expected = Array.from(new Set(item.expectedMemoryIds.filter(Boolean)));
    const retrieved = Array.from(new Set(item.retrievedMemoryIds.filter(Boolean)));
    const hitCount = overlap(expected, retrieved);
    const rowRecall = ratio(hitCount, expected.length);
    const rowPrecision = ratio(hitCount, retrieved.length);
    recallTotal += rowRecall;
    precisionTotal += rowPrecision;
    if (rowRecall < 1) failures.push({ caseId: item.id, reason: "recall" });
    if (rowPrecision < 1) failures.push({ caseId: item.id, reason: "precision" });

    if (item.staleMemoryIds !== undefined) {
      staleCases += 1;
      const stale = new Set(item.staleMemoryIds);
      const injected = item.injectedMemoryIds ?? [];
      const hasStaleInjection = injected.some((id) => stale.has(id));
      if (hasStaleInjection) { staleInjected += 1; failures.push({ caseId: item.id, reason: "stale_injection" }); }
    }

    if (item.criticalFactsBefore !== undefined && item.criticalFactsAfter !== undefined) {
      retentionCases += 1;
      const retention = ratio(overlap(item.criticalFactsBefore, item.criticalFactsAfter), item.criticalFactsBefore.length);
      retentionTotal += retention;
      if (retention < 1) failures.push({ caseId: item.id, reason: "fact_loss" });
    }

    if (item.resumedStateBefore !== undefined && item.resumedStateAfter !== undefined) {
      resumeCases += 1;
      if (item.resumedStateBefore === item.resumedStateAfter) resumeTotal += 1;
      else failures.push({ caseId: item.id, reason: "resume_mismatch" });
    }
    totalCostUsd += Number.isFinite(item.costUsd) ? Math.max(0, item.costUsd ?? 0) : 0;
  }

  return {
    caseCount: cases.length,
    recall: ratio(recallTotal, cases.length),
    precision: ratio(precisionTotal, cases.length),
    staleInjectionRate: ratio(staleInjected, staleCases),
    compressionFactRetention: ratio(retentionTotal, retentionCases),
    resumeFidelity: ratio(resumeTotal, resumeCases),
    totalCostUsd,
    failures,
  };
}

/** 最小脱敏夹具；内容是稳定 ID，不包含用户对话正文。 */
export const memoryGoldenSet: MemoryGoldenCase[] = [
  { id: "memory-recall-001", expectedMemoryIds: ["pref-language"], retrievedMemoryIds: ["pref-language"], costUsd: 0.0001 },
  { id: "memory-precision-001", expectedMemoryIds: ["decision-rate"], retrievedMemoryIds: ["decision-rate"], costUsd: 0.0001 },
  { id: "memory-stale-001", expectedMemoryIds: ["current-policy"], retrievedMemoryIds: ["current-policy"], staleMemoryIds: ["old-policy"], injectedMemoryIds: ["current-policy"], costUsd: 0.0001 },
  { id: "memory-compression-001", expectedMemoryIds: [], retrievedMemoryIds: [], criticalFactsBefore: ["customer-id", "quote-date", "currency"], criticalFactsAfter: ["customer-id", "quote-date", "currency"], costUsd: 0.0002 },
  { id: "memory-resume-001", expectedMemoryIds: [], retrievedMemoryIds: [], resumedStateBefore: "checkpoint-v3", resumedStateAfter: "checkpoint-v3", costUsd: 0.0002 },
];
