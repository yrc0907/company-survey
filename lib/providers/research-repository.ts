import postgres, { type Sql, type TransactionSql } from "postgres";

import type {
  Citation,
  Company,
  Entity,
  RelationEdge,
  Report,
  ReportRevision,
  ReportSection,
  Source,
  SourceChunk,
  WorkbenchSnapshot,
} from "@/lib/domain/research";
import { PersistenceRequiredError, VersionConflictError } from "@/lib/domain/errors";

/**
 * 数据访问边界。领域服务只能依赖这个接口，因此演示内存数据与 PostgreSQL 可以安全替换。
 * 写入接口只接受服务已校验过的完整聚合，禁止 API 路由直接执行任意 SQL。
 */
export interface ResearchRepository {
  getSnapshot(): Promise<WorkbenchSnapshot>;
  getReport(reportId: string): Promise<Report | null>;
  createReport(report: Report, sections: ReportSection[], revision: ReportRevision): Promise<void>;
  saveReport(report: Report, sections: ReportSection[], revision: ReportRevision, expectedVersion: number): Promise<void>;
  createTextSource(source: Source, chunks: SourceChunk[]): Promise<void>;
  health(): Promise<{ ok: boolean; persistence: "memory_demo" | "postgres" }>;
}

/** 演示数据的构造函数类型，防止每个请求共享可变对象引用。 */
export type SnapshotFactory = () => WorkbenchSnapshot;

/**
 * 内存仓储用于未配置 DATABASE_URL 的本地演示。
 * 副作用仅存在于当前 Node 进程；生产部署必须使用 PostgreSQL。
 */
export class MemoryResearchRepository implements ResearchRepository {
  private snapshot: WorkbenchSnapshot;

  public constructor(seed: WorkbenchSnapshot | SnapshotFactory) {
    this.snapshot = structuredClone(typeof seed === "function" ? seed() : seed);
  }

  public async getSnapshot(): Promise<WorkbenchSnapshot> {
    return structuredClone(this.snapshot);
  }

  public async getReport(reportId: string): Promise<Report | null> {
    const report = this.snapshot.reports.find((item) => item.id === reportId);
    return report ? structuredClone(report) : null;
  }

  public async createReport(report: Report, sections: ReportSection[], revision: ReportRevision): Promise<void> {
    this.snapshot.reports.push(structuredClone(report));
    this.snapshot.sections.push(...structuredClone(sections));
    this.snapshot.revisions.push(structuredClone(revision));
  }

  public async saveReport(report: Report, sections: ReportSection[], revision: ReportRevision, expectedVersion: number): Promise<void> {
    const reportIndex = this.snapshot.reports.findIndex((item) => item.id === report.id);
    if (reportIndex === -1) {
      throw new Error(`无法保存不存在的报告 ${report.id}`);
    }

    const current = this.snapshot.reports[reportIndex];
    if (current.currentVersion !== expectedVersion) {
      throw new VersionConflictError(expectedVersion, current.currentVersion);
    }

    const priorSections = this.snapshot.sections.filter((item) => item.reportId === report.id);
    const incomingIds = new Set(sections.map((section) => section.id));
    const removedSectionIds = new Set(priorSections.filter((section) => !incomingIds.has(section.id)).map((section) => section.id));

    this.snapshot.reports[reportIndex] = structuredClone(report);
    // 保留章节 ID 时原 citation 保持关联；仅用户明确删除章节时才模拟数据库的 ON DELETE SET NULL 行为。
    this.snapshot.sections = [
      ...this.snapshot.sections.filter((item) => item.reportId !== report.id),
      ...structuredClone(sections),
    ];
    if (removedSectionIds.size > 0) {
      this.snapshot.citations = this.snapshot.citations.map((citation) => (
        citation.reportId === report.id && citation.sectionId && removedSectionIds.has(citation.sectionId)
          ? { ...citation, sectionId: null }
          : citation
      ));
    }
    this.snapshot.revisions.push(structuredClone(revision));
  }

  /**
   * 内存 Seed 在 App Router 的不同 route worker 间不共享，写入会制造“已保存”的错觉。
   * 因此手动资料导入必须明确拒绝，不能只写进当前进程的数组。
   */
  public async createTextSource(): Promise<void> {
    throw new PersistenceRequiredError();
  }

  /** 内存演示仓储无需外部连接，但明确标注为非持久化状态。 */
  public async health(): Promise<{ ok: boolean; persistence: "memory_demo" }> {
    return { ok: true, persistence: "memory_demo" };
  }
}

/** PostgreSQL 行映射共用的字段类型；保持 snake_case 仅在 Provider 内部。 */
type DatabaseRow = Record<string, unknown>;

/** 将 PostgreSQL 时间字段转换成 API 一致的 ISO 字符串。 */
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * PostgreSQL 仓储。
 * 该实现只访问固定表和固定字段；所有业务过滤与关系查询仍由领域服务完成。
 */
export class PostgresResearchRepository implements ResearchRepository {
  public constructor(private readonly sql: Sql) {}

  /** 从已配置的连接串创建仓储；调用方负责连接生命周期。 */
  public static fromConnectionString(connectionString: string): PostgresResearchRepository {
    return new PostgresResearchRepository(postgres(connectionString, { max: 3, idle_timeout: 20 }));
  }

  public async getSnapshot(): Promise<WorkbenchSnapshot> {
    const [companies, reports, sections, sources, chunks, citations, entities, edges, revisions] = await Promise.all([
      this.sql<DatabaseRow[]>`SELECT * FROM company ORDER BY updated_at DESC`,
      this.sql<DatabaseRow[]>`SELECT * FROM report ORDER BY updated_at DESC`,
      this.sql<DatabaseRow[]>`SELECT * FROM report_section ORDER BY report_id, position`,
      this.sql<DatabaseRow[]>`SELECT * FROM source ORDER BY captured_at DESC`,
      this.sql<DatabaseRow[]>`SELECT * FROM source_chunk ORDER BY source_id, position`,
      this.sql<DatabaseRow[]>`SELECT * FROM citation ORDER BY created_at DESC`,
      this.sql<DatabaseRow[]>`SELECT * FROM entity ORDER BY created_at ASC`,
      this.sql<DatabaseRow[]>`SELECT * FROM relation_edge ORDER BY created_at ASC`,
      this.sql<DatabaseRow[]>`SELECT * FROM report_revision ORDER BY report_id, version`,
    ]);

    return {
      companies: companies.map((row) => ({
        id: String(row.id), name: String(row.name), kind: row.kind as Company["kind"], summary: String(row.summary),
        tags: (row.tags as string[]) ?? [], createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
      })),
      reports: reports.map((row) => ({
        id: String(row.id), companyId: String(row.company_id), title: String(row.title), status: row.status as Report["status"],
        currentVersion: Number(row.current_version), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
      })),
      sections: sections.map((row) => ({
        id: String(row.id), reportId: String(row.report_id), parentSectionId: row.parent_section_id ? String(row.parent_section_id) : null,
        heading: String(row.heading), anchor: String(row.anchor), level: Number(row.level), position: Number(row.position),
        content: String(row.content), evidenceState: row.evidence_state as ReportSection["evidenceState"], updatedAt: toIso(row.updated_at),
      })),
      sources: sources.map((row) => ({
        id: String(row.id), reportId: String(row.report_id), title: String(row.title), kind: row.kind as Source["kind"],
        url: row.url ? String(row.url) : null, language: row.language as Source["language"], state: row.state as Source["state"],
        capturedAt: toIso(row.captured_at), contentHash: String(row.content_hash), snapshot: String(row.snapshot),
      })),
      chunks: chunks.map((row) => ({
        id: String(row.id), sourceId: String(row.source_id), parentSectionId: row.parent_section_id ? String(row.parent_section_id) : null,
        headingPath: (row.heading_path as string[]) ?? [], position: Number(row.position), page: row.page ? Number(row.page) : null,
        startOffset: Number(row.start_offset), endOffset: Number(row.end_offset), text: String(row.text),
        contextualPrefix: String(row.contextual_prefix), contentHash: String(row.content_hash),
      })),
      citations: citations.map((row) => ({
        id: String(row.id), reportId: String(row.report_id), sectionId: row.section_id ? String(row.section_id) : null,
        sourceId: String(row.source_id), chunkId: String(row.chunk_id), quote: String(row.quote),
        evidenceState: row.evidence_state as Citation["evidenceState"], createdAt: toIso(row.created_at),
      })),
      entities: entities.map((row) => ({
        id: String(row.id), reportId: String(row.report_id), kind: row.kind as Entity["kind"], name: String(row.name),
        normalizedName: String(row.normalized_name), sourceId: row.source_id ? String(row.source_id) : null,
        evidenceState: row.evidence_state as Entity["evidenceState"], attributes: (row.attributes as Record<string, string>) ?? {},
        createdAt: toIso(row.created_at),
      })),
      edges: edges.map((row) => ({
        id: String(row.id), reportId: String(row.report_id), fromEntityId: String(row.from_entity_id), toEntityId: String(row.to_entity_id),
        relation: String(row.relation), sourceId: row.source_id ? String(row.source_id) : null,
        evidenceState: row.evidence_state as RelationEdge["evidenceState"], createdAt: toIso(row.created_at),
      })),
      revisions: revisions.map((row) => ({
        id: String(row.id), reportId: String(row.report_id), version: Number(row.version), title: String(row.title),
        sections: row.sections as ReportSection[], author: row.author as ReportRevision["author"], createdAt: toIso(row.created_at),
      })),
    };
  }

  public async getReport(reportId: string): Promise<Report | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT * FROM report WHERE id = ${reportId} LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id), companyId: String(row.company_id), title: String(row.title), status: row.status as Report["status"],
      currentVersion: Number(row.current_version), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at),
    };
  }

  public async createReport(report: Report, sections: ReportSection[], revision: ReportRevision): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`INSERT INTO report (id, company_id, title, status, current_version, created_at, updated_at)
        VALUES (${report.id}, ${report.companyId}, ${report.title}, ${report.status}, ${report.currentVersion}, ${report.createdAt}, ${report.updatedAt})`;
      await this.upsertSections(transaction, sections);
      await this.insertRevision(transaction, revision);
    });
  }

  public async saveReport(report: Report, sections: ReportSection[], revision: ReportRevision, expectedVersion: number): Promise<void> {
    await this.sql.begin(async (transaction) => {
      const currentRows = await transaction<DatabaseRow[]>`SELECT current_version FROM report WHERE id = ${report.id} FOR UPDATE`;
      const current = currentRows[0];
      if (!current) {
        throw new Error(`无法保存不存在的报告 ${report.id}`);
      }
      if (Number(current.current_version) !== expectedVersion) {
        throw new VersionConflictError(expectedVersion, Number(current.current_version));
      }
      const existingRows = await transaction<DatabaseRow[]>`SELECT id FROM report_section WHERE report_id = ${report.id} FOR UPDATE`;
      const existingIds = new Set(existingRows.map((row) => String(row.id)));
      const incomingIds = new Set(sections.map((section) => section.id));
      const removedIds = Array.from(existingIds).filter((id) => !incomingIds.has(id));

      // 报告章节位置有唯一约束；先整体临时偏移避免用户拖拽重排时出现唯一键交换冲突。
      await transaction`UPDATE report_section SET position = position + 10000 WHERE report_id = ${report.id}`;
      await transaction`UPDATE report SET title = ${report.title}, status = ${report.status}, current_version = ${report.currentVersion}, updated_at = ${report.updatedAt}
        WHERE id = ${report.id}`;
      await this.upsertSections(transaction, sections);
      // 仅显式移除的章节会触发 citation.section_id 的 ON DELETE SET NULL；保留 ID 的引用不会断开。
      if (removedIds.length > 0) {
        await transaction`DELETE FROM report_section WHERE report_id = ${report.id} AND id = ANY(${transaction.array(removedIds)}::text[])`;
      }
      await this.insertRevision(transaction, revision);
    });
  }

  /**
   * 持久化一份人工粘贴的文本来源及其可检索 Chunk。
   * 来源与全部 Chunk 处于同一事务，避免页面显示 active 来源但检索表为空的半完成状态。
   */
  public async createTextSource(source: Source, chunks: SourceChunk[]): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`INSERT INTO source
        (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot)
        VALUES (${source.id}, ${source.reportId}, ${source.title}, ${source.kind}, ${source.url}, ${source.language}, ${source.state}, ${source.capturedAt}, ${source.contentHash}, ${source.snapshot})`;
      for (const chunk of chunks) {
        await transaction`INSERT INTO source_chunk
          (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
          VALUES (${chunk.id}, ${chunk.sourceId}, ${chunk.parentSectionId}, ${transaction.array(chunk.headingPath)}::text[], ${chunk.position}, ${chunk.page}, ${chunk.startOffset}, ${chunk.endOffset}, ${chunk.text}, ${chunk.contextualPrefix}, ${chunk.contentHash})`;
      }
    });
  }

  /** 真实数据库健康检查，不能只根据环境变量声称 PostgreSQL 可用。 */
  public async health(): Promise<{ ok: boolean; persistence: "postgres" }> {
    try {
      await this.sql`SELECT 1`;
      return { ok: true, persistence: "postgres" };
    } catch {
      return { ok: false, persistence: "postgres" };
    }
  }

  /** 写入固定结构章节，避免以字符串拼接动态列名或表名。 */
  private async upsertSections(transaction: TransactionSql, sections: ReportSection[]): Promise<void> {
    for (const section of sections) {
      await transaction`INSERT INTO report_section
        (id, report_id, parent_section_id, heading, anchor, level, position, content, evidence_state, updated_at)
        VALUES (${section.id}, ${section.reportId}, ${section.parentSectionId}, ${section.heading}, ${section.anchor}, ${section.level}, ${section.position}, ${section.content}, ${section.evidenceState}, ${section.updatedAt})
        ON CONFLICT (id) DO UPDATE SET
          parent_section_id = EXCLUDED.parent_section_id,
          heading = EXCLUDED.heading,
          anchor = EXCLUDED.anchor,
          level = EXCLUDED.level,
          position = EXCLUDED.position,
          content = EXCLUDED.content,
          evidence_state = EXCLUDED.evidence_state,
          updated_at = EXCLUDED.updated_at
        WHERE report_section.report_id = EXCLUDED.report_id`;
    }
  }

  /** 报告版本是不可变快照，后续改写必须追加而不是覆盖。 */
  private async insertRevision(transaction: TransactionSql, revision: ReportRevision): Promise<void> {
    await transaction`INSERT INTO report_revision (id, report_id, version, title, sections, author, created_at)
      VALUES (${revision.id}, ${revision.reportId}, ${revision.version}, ${revision.title}, ${JSON.stringify(revision.sections)}::jsonb, ${revision.author}, ${revision.createdAt})`;
  }
}
