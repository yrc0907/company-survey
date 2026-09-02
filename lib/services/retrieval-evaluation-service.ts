/**
 * RAG Golden Set 的确定性评测器。
 * 输入是一次真实或契约检索运行的排名、引用和耗时；输出只做指标计算，
 * 不调用模型、不改数据库，也不会把评测夹具写入公开项目。
 */

export type RetrievalGoldenCategory = "exact" | "policy" | "semantic" | "multilingual" | "relation" | "conflict" | "stale" | "abstention";

export interface RetrievalGoldenCase {
  id: string;
  category: RetrievalGoldenCategory;
  expectedChunkIds: string[];
  returnedChunkIds: string[];
  expectedCitationIds?: string[];
  returnedCitationIds?: string[];
  shouldAbstain?: boolean;
  abstained?: boolean;
  latencyMs?: number;
  costUsd?: number;
}

export interface RetrievalEvaluationReport {
  caseCount: number;
  recallAtK: number;
  mrr: number;
  citationCoverage: number;
  abstentionAccuracy: number;
  averageLatencyMs: number;
  totalCostUsd: number;
  byCategory: Record<RetrievalGoldenCategory, { caseCount: number; recallAtK: number; mrr: number; abstentionAccuracy: number }>;
  failures: Array<{ caseId: string; reason: "miss" | "citation_gap" | "abstention_mismatch" }>;
}

const categories: RetrievalGoldenCategory[] = ["exact", "policy", "semantic", "multilingual", "relation", "conflict", "stale", "abstention"];

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function recall(expected: string[], returned: string[]): number {
  if (expected.length === 0) return 1;
  const actual = new Set(returned);
  return expected.filter((id) => actual.has(id)).length / expected.length;
}

function reciprocalRank(expected: string[], returned: string[]): number {
  if (expected.length === 0) return returned.length === 0 ? 1 : 0;
  const expectedSet = new Set(expected);
  const index = returned.findIndex((id) => expectedSet.has(id));
  return index < 0 ? 0 : 1 / (index + 1);
}

/** 计算一组 Golden Case；重复 ID 会被去重，空结果只能在 expected 为空时视为命中。 */
export function evaluateRetrievalGoldenSet(cases: RetrievalGoldenCase[], k = 5): RetrievalEvaluationReport {
  const limitedK = Math.max(1, Math.min(100, Math.trunc(k)));
  const failures: RetrievalEvaluationReport["failures"] = [];
  const categoryRows = new Map<RetrievalGoldenCategory, RetrievalGoldenCase[]>();
  for (const category of categories) categoryRows.set(category, []);

  let recallTotal = 0;
  let mrrTotal = 0;
  let citationTotal = 0;
  let citationCases = 0;
  let abstentionTotal = 0;
  let latencyTotal = 0;
  let latencyCases = 0;
  let costTotal = 0;

  for (const item of cases) {
    const expected = Array.from(new Set(item.expectedChunkIds.filter(Boolean)));
    const returned = Array.from(new Set(item.returnedChunkIds.filter(Boolean))).slice(0, limitedK);
    const rowRecall = recall(expected, returned);
    const rowMrr = reciprocalRank(expected, returned);
    const expectedCitations = Array.from(new Set(item.expectedCitationIds ?? []));
    const returnedCitations = new Set(item.returnedCitationIds ?? []);
    const rowCitation = expectedCitations.length === 0 ? null : expectedCitations.filter((id) => returnedCitations.has(id)).length / expectedCitations.length;
    const abstentionExpected = item.shouldAbstain === true;
    const abstentionActual = item.abstained === true;

    recallTotal += rowRecall;
    mrrTotal += rowMrr;
    if (rowCitation !== null) { citationTotal += rowCitation; citationCases += 1; }
    if (abstentionExpected === abstentionActual) abstentionTotal += 1;
    if (item.latencyMs !== undefined && Number.isFinite(item.latencyMs)) { latencyTotal += Math.max(0, item.latencyMs); latencyCases += 1; }
    costTotal += bounded(item.costUsd ?? 0);

    if (rowRecall < 1) failures.push({ caseId: item.id, reason: "miss" });
    if (rowCitation !== null && rowCitation < 1) failures.push({ caseId: item.id, reason: "citation_gap" });
    if (abstentionExpected !== abstentionActual) failures.push({ caseId: item.id, reason: "abstention_mismatch" });
    categoryRows.get(item.category)?.push(item);
  }

  const byCategory = Object.fromEntries(categories.map((category) => {
    const rows = categoryRows.get(category) ?? [];
    return [category, {
      caseCount: rows.length,
      recallAtK: rows.length ? rows.reduce((sum, row) => sum + recall(row.expectedChunkIds, Array.from(new Set(row.returnedChunkIds)).slice(0, limitedK)), 0) / rows.length : 0,
      mrr: rows.length ? rows.reduce((sum, row) => sum + reciprocalRank(row.expectedChunkIds, Array.from(new Set(row.returnedChunkIds)).slice(0, limitedK)), 0) / rows.length : 0,
      abstentionAccuracy: rows.length ? rows.filter((row) => (row.shouldAbstain === true) === (row.abstained === true)).length / rows.length : 0,
    }];
  })) as RetrievalEvaluationReport["byCategory"];

  return {
    caseCount: cases.length,
    recallAtK: cases.length ? recallTotal / cases.length : 0,
    mrr: cases.length ? mrrTotal / cases.length : 0,
    citationCoverage: citationCases ? citationTotal / citationCases : 1,
    abstentionAccuracy: cases.length ? abstentionTotal / cases.length : 1,
    averageLatencyMs: latencyCases ? latencyTotal / latencyCases : 0,
    totalCostUsd: costTotal,
    byCategory,
    failures,
  };
}

/** 覆盖八类风险的最小 Golden Set；ID 是测试夹具，不是公开业务记录。 */
export const retrievalGoldenSet: RetrievalGoldenCase[] = [
  { id: "gold-exact-001", category: "exact", expectedChunkIds: ["chunk-rate"], returnedChunkIds: ["chunk-rate", "chunk-other"], expectedCitationIds: ["source-rate"], returnedCitationIds: ["source-rate"], latencyMs: 12, costUsd: 0.001 },
  { id: "gold-policy-001", category: "policy", expectedChunkIds: ["chunk-policy"], returnedChunkIds: ["chunk-policy"], expectedCitationIds: ["source-policy"], returnedCitationIds: ["source-policy"], latencyMs: 18, costUsd: 0.001 },
  { id: "gold-semantic-001", category: "semantic", expectedChunkIds: ["chunk-fulfilment"], returnedChunkIds: ["chunk-fulfilment", "chunk-order"], latencyMs: 31, costUsd: 0.002 },
  { id: "gold-multilingual-001", category: "multilingual", expectedChunkIds: ["chunk-english"], returnedChunkIds: ["chunk-english"], expectedCitationIds: ["source-english"], returnedCitationIds: ["source-english"], latencyMs: 29, costUsd: 0.002 },
  { id: "gold-relation-001", category: "relation", expectedChunkIds: ["chunk-customer-order"], returnedChunkIds: ["chunk-customer-order"], latencyMs: 22, costUsd: 0.001 },
  { id: "gold-conflict-001", category: "conflict", expectedChunkIds: ["chunk-confirmed"], returnedChunkIds: ["chunk-confirmed"], expectedCitationIds: ["source-confirmed"], returnedCitationIds: ["source-confirmed"], latencyMs: 24, costUsd: 0.001 },
  { id: "gold-stale-001", category: "stale", expectedChunkIds: ["chunk-current"], returnedChunkIds: ["chunk-current"], expectedCitationIds: ["source-current"], returnedCitationIds: ["source-current"], latencyMs: 20, costUsd: 0.001 },
  { id: "gold-abstention-001", category: "abstention", expectedChunkIds: [], returnedChunkIds: [], shouldAbstain: true, abstained: true, latencyMs: 9, costUsd: 0 },
];
