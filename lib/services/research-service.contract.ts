import assert from "node:assert/strict";
import type { Sql } from "postgres";

import { POST as createManualTextSourceRoute } from "@/app/api/research/reports/[id]/sources/route";
import { PersistenceRequiredError, VersionConflictError } from "@/lib/domain/errors";
import { MemoryResearchRepository, PostgresResearchRepository, type ResearchRepository } from "@/lib/providers/research-repository";
import { setResearchRepositoryForTest } from "@/lib/providers/repository-factory";
import { createDemoSnapshot } from "@/lib/providers/seed";
import { assertSafeSourceUrl } from "@/lib/security/source-url";
import { ContextProjectionService } from "@/lib/services/context-projection-service";
import type { DenseRetriever } from "@/lib/services/dense-retrieval-service";
import { GraphService } from "@/lib/services/graph-service";
import { ManualTextSourceService } from "@/lib/services/manual-text-source-service";
import { ReportService, WorkbenchService } from "@/lib/services/research-service";
import { SearchService } from "@/lib/services/search-service";

/**
 * 最小服务契约测试。
 * 覆盖正常保存、版本冲突、失效来源过滤、无来源关系拒绝与选区上下文不全库检索等核心边界。
 */
async function run(): Promise<void> {
  const repository = new MemoryResearchRepository(createDemoSnapshot);
  const reportService = new ReportService(repository);
  const searchService = new SearchService(repository);
  const graphService = new GraphService(repository);
  const contextService = new ContextProjectionService(repository);
  const initial = await repository.getSnapshot();
  const report = initial.reports[0];
  assert.ok(report, "演示数据应包含报告");

  const saved = await reportService.saveReport(report.id, {
    title: "慧策调研（人工确认版）",
    expectedVersion: report.currentVersion,
    sections: initial.sections.filter((section) => section.reportId === report.id).map((section) => ({
      id: section.id, parentSectionId: section.parentSectionId, heading: section.heading, anchor: section.anchor,
      level: section.level, position: section.position, content: section.content, evidenceState: section.evidenceState,
    })),
  });
  assert.equal(saved.report.currentVersion, 2, "保存后必须递增版本");

  await assert.rejects(
    () => reportService.saveReport(report.id, {
      title: "旧页面覆盖", expectedVersion: 1,
      sections: saved.sections.map((section) => ({
        id: section.id, parentSectionId: section.parentSectionId, heading: section.heading, anchor: section.anchor,
        level: section.level, position: section.position, content: section.content, evidenceState: section.evidenceState,
      })),
    }),
    VersionConflictError,
    "旧版本必须被拒绝，不能静默覆盖",
  );

  const hits = await searchService.search("跨境电商", { reportId: report.id });
  assert.ok(hits.length > 0 && hits.every((hit) => hit.source.state === "active"), "检索只能返回 active 来源");
  assert.ok(hits.every((hit) => hit.rerank.status === "degraded"), "未配置 Reranker 时必须保留粗排并公开 degraded 状态");

  const denseStub: DenseRetriever = {
    rank: async (_query, chunks) => ({
      status: "completed", provider: "remote", model: "dense-contract",
      ranks: new Map(chunks.map((chunk, index) => [chunk.id, chunks.length - index])), reason: null,
    }),
  };
  const hybridHits = await new SearchService(repository, denseStub).search("跨境电商", { reportId: report.id });
  assert.ok(hybridHits.length > 0 && hybridHits.every((hit) => hit.dense.status === "completed"), "Dense + RRF 路径必须向调用方暴露实际完成状态");

  const graphPaths = await graphService.queryByEntityName(report.id, "慧策");
  assert.ok(graphPaths.length > 0, "带来源的关系应可被受限图查询找到");
  assert.ok(graphPaths.flatMap((path) => path.edges).every((edge) => edge.sourceId), "无来源关系不能作为图事实返回");

  const selectionProjection = await contextService.project({
    reportId: report.id, question: "解释这句话", selectedSectionId: saved.sections[0].id, selectedText: "政策契合不等于监管合规。",
  });
  assert.equal(selectionProjection.mode, "selection", "选区提问必须走直接上下文");
  assert.equal(selectionProjection.evidence.length, 0, "选区提问不做全库 RAG");

  assert.throws(() => assertSafeSourceUrl("http://127.0.0.1:5432/private"), /不允许导入本机或内网来源/);
  assert.equal(assertSafeSourceUrl("https://www.gov.cn/plan").hostname, "www.gov.cn");

  const staleSnapshot = createDemoSnapshot();
  staleSnapshot.sources.forEach((source) => { source.state = "stale"; });
  const staleHits = await new SearchService(new MemoryResearchRepository(staleSnapshot)).search("跨境电商");
  assert.equal(staleHits.length, 0, "失效来源不能被静默当作证据召回");

  // 人工文本导入的正常闭环：服务生成 active 来源和连续 Chunk，随后搜索能立即命中。
  const sourceSnapshot = createDemoSnapshot();
  const sourceRepository: ResearchRepository = {
    getSnapshot: async () => structuredClone(sourceSnapshot),
    getReport: async (reportId) => {
      const found = sourceSnapshot.reports.find((item) => item.id === reportId);
      return found ? structuredClone(found) : null;
    },
    createReport: async () => undefined,
    saveReport: async () => undefined,
    createTextSource: async (source, chunks) => {
      sourceSnapshot.sources.push(structuredClone(source));
      sourceSnapshot.chunks.push(...structuredClone(chunks));
    },
    health: async () => ({ ok: true, persistence: "postgres" }),
  };
  const manualSourceService = new ManualTextSourceService(sourceRepository);
  const imported = await manualSourceService.import(report.id, {
    title: "人工访谈纪要",
    text: "第一段是人工粘贴的资料。\r\n\r\n第二段包含可检索关键词：资料入库验收。",
  });
  assert.equal(imported.source.kind, "text", "手动导入必须固定为 text 来源");
  assert.equal(imported.source.state, "active", "新导入资料必须显式标记为 active");
  assert.ok(imported.chunks.length > 0 && imported.chunks.every((chunk) => chunk.sourceId === imported.source.id), "每个 Chunk 必须归属新来源");
  assert.ok(imported.chunks.every((chunk) => chunk.endOffset > chunk.startOffset && chunk.contentHash.length === 64), "Chunk 必须保留合法定位和 SHA-256 哈希");
  const importedHits = await new SearchService(sourceRepository).search("资料入库验收", { reportId: report.id });
  assert.ok(importedHits.some((hit) => hit.source.id === imported.source.id), "保存后的手动资料必须可被当前报告搜索到");
  await assert.rejects(
    () => manualSourceService.import(report.id, { title: "重复副本", text: "第一段是人工粘贴的资料。\n\n第二段包含可检索关键词：资料入库验收。" }),
    /已导入相同正文/,
    "同一报告相同正文不能重复导入",
  );
  await assert.rejects(
    () => manualSourceService.import("missing-report", { title: "不存在", text: "正文" }),
    /报告不存在/,
    "资料不能写入不存在的报告",
  );
  await assert.rejects(
    () => new ManualTextSourceService(repository).import(report.id, { title: "演示资料", text: "正文" }),
    PersistenceRequiredError,
    "memory_demo 必须明确拒绝资料持久化",
  );

  // API 层只返回来源预览，并把内存演示模式映射为可恢复的持久化拒绝。
  setResearchRepositoryForTest(sourceRepository);
  const routeResponse = await createManualTextSourceRoute(new Request(`http://localhost/api/research/reports/${report.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "API 导入资料", text: "通过 API 写入的资料可以被搜索。" }),
  }), { params: { id: report.id } });
  assert.equal(routeResponse.status, 201, "手动文本来源 API 应返回 201");
  const routePayload = await routeResponse.json() as { source: { snapshot: string } };
  assert.equal(routePayload.source.snapshot, "通过 API 写入的资料可以被搜索。", "API 只能返回来源预览，不应返回 Chunk 正文");
  setResearchRepositoryForTest(repository);
  const memoryRouteResponse = await createManualTextSourceRoute(new Request(`http://localhost/api/research/reports/${report.id}/sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "内存演示资料", text: "不会被写入。" }),
  }), { params: { id: report.id } });
  assert.equal(memoryRouteResponse.status, 409, "memory_demo API 必须拒绝持久化写入");
  assert.equal((await memoryRouteResponse.json() as { code: string }).code, "PERSISTENCE_REQUIRED", "内存拒绝必须返回稳定错误码");
  setResearchRepositoryForTest(null);

  // 生产仓储契约：保留的 section id 必须用 UPSERT 保存，不能 DELETE 全部导致 citation.section_id 被置空。
  const statements: string[] = [];
  const fakeTransaction = Object.assign(
    async (strings: TemplateStringsArray) => {
      const statement = strings.join("?").replace(/\s+/g, " ").trim();
      statements.push(statement);
      if (statement.startsWith("SELECT current_version")) return [{ current_version: 1 }];
      if (statement.startsWith("SELECT id FROM report_section")) return [{ id: "section-overview" }, { id: "section-evidence" }];
      return [];
    },
    { array: (values: readonly string[]) => values },
  );
  const fakeSql = {
    begin: async (callback: (transaction: typeof fakeTransaction) => Promise<unknown>) => callback(fakeTransaction),
  } as unknown as Sql;
  const postgresRepository = new PostgresResearchRepository(fakeSql);
  const originalSections = createDemoSnapshot().sections;
  await postgresRepository.saveReport(
    { ...report, currentVersion: 2, updatedAt: "2026-09-01T09:00:00.000Z" },
    originalSections,
    { id: "revision-production-v2", reportId: report.id, version: 2, title: report.title, sections: originalSections, author: "user", createdAt: "2026-09-01T09:00:00.000Z" },
    1,
  );
  assert.equal(statements.some((statement) => statement === "DELETE FROM report_section WHERE report_id = ?"), false, "生产保存不能删除报告的全部章节");
  assert.ok(statements.some((statement) => statement.includes("ON CONFLICT (id) DO UPDATE")), "生产保存必须 UPSERT 稳定章节 ID");
  assert.equal(initial.citations[0]?.sectionId, "section-overview", "保留章节后既有引用仍应关联原章节");
  await postgresRepository.createTextSource(imported.source, imported.chunks);
  assert.ok(statements.some((statement) => statement.startsWith("INSERT INTO source")), "PostgreSQL 必须写入来源记录");
  assert.ok(statements.some((statement) => statement.startsWith("INSERT INTO source_chunk")), "PostgreSQL 必须在同一事务写入检索 Chunk");

  // PostgreSQL FTS 契约：查询必须在数据库中执行，并把 active/报告范围作为 SQL 边界，而不是拉全量快照后再评分。
  const ftsStatements: Array<{ query: string; parameters: readonly unknown[] }> = [];
  const ftsSql = {
    unsafe: async (query: string, parameters: readonly unknown[] = []) => {
      ftsStatements.push({ query, parameters });
      return [{ chunk_id: "chunk-plan-cross-border", source_id: "source-plan", lexical_score: "0.75" }];
    },
  } as unknown as Sql;
  const ftsRepository = new PostgresResearchRepository(ftsSql);
  const ftsRows = await ftsRepository.searchSourceChunks("跨境电商", { reportId: report.id, limit: 12 });
  assert.deepEqual(ftsRows, [{ chunkId: "chunk-plan-cross-border", sourceId: "source-plan", lexicalScore: 0.75 }], "PostgreSQL FTS 行应映射为稳定的领域结果");
  assert.equal(ftsStatements.length, 1, "一次 PostgreSQL FTS 检索只能执行一条参数化查询");
  assert.match(ftsStatements[0]!.query, /to_tsvector\('simple'/, "FTS 必须构造 to_tsvector");
  assert.match(ftsStatements[0]!.query, /plainto_tsquery\('simple', \$1\)/, "FTS 必须使用参数化 plainto_tsquery");
  assert.match(ftsStatements[0]!.query, /source_record\.state = 'active'/, "FTS 必须在 SQL 内过滤 active 来源");
  assert.match(ftsStatements[0]!.query, /source_record\.report_id = \$2/, "FTS 必须在 SQL 内限制报告范围");
  assert.deepEqual(ftsStatements[0]!.parameters, ["跨境电商", report.id, 12], "查询词、报告 ID 和上限必须作为参数传入");

  // SearchService 必须消费仓储 FTS 排名，并向调用方公开真实词法执行状态。
  const ftsSearchSnapshot = createDemoSnapshot();
  const ftsSearchRepository: ResearchRepository = {
    getSnapshot: async () => structuredClone(ftsSearchSnapshot),
    getReport: async (reportId) => ftsSearchSnapshot.reports.find((item) => item.id === reportId) ?? null,
    createReport: async () => undefined,
    saveReport: async () => undefined,
    createTextSource: async () => undefined,
    searchSourceChunks: async () => [{ chunkId: "chunk-plan-cross-border", sourceId: "source-plan", lexicalScore: 0.9 }],
    health: async () => ({ ok: true, persistence: "postgres" }),
  };
  const ftsSearchHits = await new SearchService(ftsSearchRepository).search("跨境电商", { reportId: report.id, limit: 1 });
  assert.equal(ftsSearchHits[0]?.lexical.status, "completed", "SearchService 应公开 PostgreSQL FTS 已完成状态");
  assert.equal(ftsSearchHits[0]?.lexical.provider, "postgres_fts", "SearchService 应标记 PostgreSQL FTS Provider");
  const failingFtsRepository: ResearchRepository = {
    ...ftsSearchRepository,
    searchSourceChunks: async () => { throw new Error("simulated FTS outage"); },
  };
  const degradedFtsHits = await new SearchService(failingFtsRepository).search("跨境电商", { reportId: report.id, limit: 1 });
  assert.ok(degradedFtsHits.length > 0, "FTS 故障时必须保留确定性关键词结果");
  assert.equal(degradedFtsHits[0]?.lexical.status, "degraded", "FTS 故障必须公开降级状态");
  assert.equal(degradedFtsHits[0]?.lexical.provider, "keyword_fallback", "FTS 故障必须标记关键词降级 Provider");

  const healthStatements: string[] = [];
  const healthSql = Object.assign(
    async (strings: TemplateStringsArray) => {
      healthStatements.push(strings.join("?").replace(/\s+/g, " ").trim());
      return [];
    },
    { begin: async () => [] },
  ) as unknown as Sql;
  assert.deepEqual(await new PostgresResearchRepository(healthSql).health(), { ok: true, persistence: "postgres" }, "Postgres 健康检查必须真实执行查询");
  assert.ok(healthStatements.includes("SELECT 1"), "健康检查必须执行 SELECT 1");

  const privateSourceSnapshot = createDemoSnapshot();
  privateSourceSnapshot.sources[0]!.snapshot = "敏感来源原文".repeat(200);
  const clientSnapshot = await new WorkbenchService(new MemoryResearchRepository(privateSourceSnapshot)).getClientSnapshot();
  assert.equal(clientSnapshot.chunks.length, 0, "工作台初始化 API 不应返回所有原始 Chunk");
  assert.ok(clientSnapshot.sources[0]!.snapshot.length <= 321, "工作台初始化 API 只能返回来源预览");

  console.log("research-service contract: passed");
}

void run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
