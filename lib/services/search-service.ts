import type { SearchHit, SourceChunk, WorkbenchSnapshot } from "@/lib/domain/research";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { getRerankerProvider } from "@/lib/providers/rerank-provider";
import { ValidationError } from "@/lib/domain/errors";
import { DenseRetrievalService, type DenseRetriever } from "@/lib/services/dense-retrieval-service";

/** 将用户问题切为稳定关键词；中英文短语保留整体，避免中文按字符产生噪声。 */
function queryTerms(rawQuery: string): string[] {
  const normalized = rawQuery.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) throw new ValidationError("搜索词不能为空");
  if (normalized.length > 200) throw new ValidationError("搜索词不能超过 200 个字符");
  return Array.from(new Set([normalized, ...normalized.split(/[\s,，。；;、!?！？]+/).filter((item) => item.length >= 2)]));
}

/** 为全文/关键词检索计算可解释的轻量分数，不假装已经接入向量或重排模型。 */
function keywordScore(chunk: SourceChunk, terms: string[]): number {
  const haystack = `${chunk.contextualPrefix}\n${chunk.headingPath.join(" ")}\n${chunk.text}`.toLocaleLowerCase("zh-CN");
  return terms.reduce((score, term, index) => {
    const occurrences = haystack.split(term).length - 1;
    if (!occurrences) return score;
    return score + occurrences * (index === 0 ? 8 : 3) + (chunk.headingPath.join(" ").includes(term) ? 2 : 0);
  }, 0);
}

/**
 * V1 的确定性全文/关键词检索。
 * 只从 active 来源召回，随后返回父章节和相邻片段以实现 Parent Retrieval 的安全子集。
 */
export class SearchService {
  public constructor(private readonly repository: ResearchRepository, private readonly denseRetrieval: DenseRetriever = new DenseRetrievalService()) {}

  /** 在当前工作台已导入的资料中检索，不读取磁盘或调用互联网。 */
  public async search(query: string, options: { reportId?: string; limit?: number } = {}): Promise<SearchHit[]> {
    const snapshot = await this.repository.getSnapshot();
    const terms = queryTerms(query);
    const reportIds = options.reportId ? new Set([options.reportId]) : null;
    const sources = snapshot.sources.filter((source) => source.state === "active" && (!reportIds || reportIds.has(source.reportId)));
    const sourceMap = new Map(sources.map((source) => [source.id, source]));
    const chunksBySource = new Map<string, SourceChunk[]>();
    for (const chunk of snapshot.chunks) {
      const existing = chunksBySource.get(chunk.sourceId) ?? [];
      existing.push(chunk);
      chunksBySource.set(chunk.sourceId, existing);
    }

    const limit = Math.min(Math.max(options.limit ?? 12, 1), 30);
    const activeChunks = snapshot.chunks.filter((chunk) => sourceMap.has(chunk.sourceId));
    const keywordRanked = activeChunks
      .map((chunk) => ({ chunk, source: sourceMap.get(chunk.sourceId)!, score: keywordScore(chunk, terms) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.position - right.chunk.position)
      .map((candidate, index) => ({ ...candidate, keywordRank: index + 1 }));
    const dense = await this.denseRetrieval.rank(query, activeChunks);

    // RRF 只融合排名而不比较关键词分和余弦分。若 Dense 降级，候选仍来自确定性关键词排序。
    const candidatesByChunkId = new Map<string, { chunk: SourceChunk; source: (typeof keywordRanked)[number]["source"]; score: number }>();
    const addRrf = (chunk: SourceChunk, source: (typeof keywordRanked)[number]["source"], rank: number) => {
      const existing = candidatesByChunkId.get(chunk.id);
      const rrfScore = 1 / (60 + rank);
      candidatesByChunkId.set(chunk.id, { chunk, source, score: (existing?.score ?? 0) + rrfScore });
    };
    keywordRanked.forEach(({ chunk, source, keywordRank }) => addRrf(chunk, source, keywordRank));
    if (dense.status === "completed") {
      activeChunks.forEach((chunk) => {
        const rank = dense.ranks.get(chunk.id);
        if (rank) addRrf(chunk, sourceMap.get(chunk.sourceId)!, rank);
      });
    }
    const candidates = Array.from(candidatesByChunkId.values())
      .sort((left, right) => right.score - left.score || left.chunk.position - right.chunk.position)
      .slice(0, Math.min(Math.max(limit * 5, limit), 80));

    if (candidates.length === 0) return [];
    const rerank = await getRerankerProvider().rerank(
      query,
      candidates.map(({ chunk }) => `${chunk.contextualPrefix}\n${chunk.headingPath.join(" / ")}\n${chunk.text}`.trim()),
      limit,
    );

    return rerank.items
      .map(({ index, score }) => ({ candidate: candidates[index]!, score: rerank.status === "completed" ? score : candidates[index]!.score }))
      .map((candidate) => ({
        ...candidate.candidate,
        score: candidate.score,
        parentSection: candidate.candidate.chunk.parentSectionId ? snapshot.sections.find((section) => section.id === candidate.candidate.chunk.parentSectionId) ?? null : null,
        adjacentChunks: (chunksBySource.get(candidate.candidate.chunk.sourceId) ?? []).filter((item) => Math.abs(item.position - candidate.candidate.chunk.position) === 1),
        rerank: { status: rerank.status, model: rerank.model, reason: rerank.reason },
        dense: { status: dense.status, provider: dense.provider, model: dense.model, reason: dense.reason },
      }));
  }
}

/** 供上下文投影复用的只读对象查找，不导出可修改的仓储引用。 */
export function findReportSnapshot(snapshot: WorkbenchSnapshot, reportId: string) {
  return {
    report: snapshot.reports.find((item) => item.id === reportId) ?? null,
    sections: snapshot.sections.filter((item) => item.reportId === reportId).sort((left, right) => left.position - right.position),
  };
}
