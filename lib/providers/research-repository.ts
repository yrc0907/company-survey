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
import {
  degradedPgVectorCapability,
  getPgVectorConfig,
  toPgVectorLiteral,
  type ChunkEmbeddingInput,
  type EmbeddingRebuildCandidate,
  type PgVectorCapability,
  type PgVectorStore,
  type PersistedVectorSearchResult,
  type VectorSearchOptions,
  type VectorWriteResult,
} from "@/lib/services/vector-persistence-service";

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
  /**
   * 通过 PostgreSQL FTS 召回候选 Chunk；未实现该可选能力的仓储由领域服务确定性降级。
   * 方法只返回 Chunk/来源 ID 与数据库词法分数，权限和 active 过滤必须在 SQL 内完成。
   */
  searchSourceChunks?(query: string, options: { reportId?: string; limit: number }): Promise<SourceChunkSearchResult[]>;
  /** pgvector 是可选能力；未迁移或无扩展时必须返回明确降级，不影响 PostgreSQL FTS。 */
  getPgVectorCapability?(): Promise<PgVectorCapability>;
  /** 仅索引 Worker 可调用的向量写入；服务端请求默认不打开写入开关。 */
  upsertChunkEmbeddings?(input: ChunkEmbeddingInput[]): Promise<VectorWriteResult>;
  /** 带 active/source/report/hash 过滤的向量召回；正文仍由快照映射。 */
  searchSimilarChunks?(vector: number[], options: VectorSearchOptions): Promise<PersistedVectorSearchResult[]>;
  /** 受限列出 active 来源中待重建的向量候选；仅 Worker 使用。 */
  listEmbeddingRebuildCandidates?(options: { reportId?: string; limit: number }): Promise<EmbeddingRebuildCandidate[]>;
  health(): Promise<{ ok: boolean; persistence: "memory_demo" | "postgres" }>;
}

/** PostgreSQL 词法召回的最小结果，正文仍由受限快照映射，避免绕过领域边界泄漏数据。 */
export interface SourceChunkSearchResult {
  chunkId: string;
  sourceId: string;
  lexicalScore: number;
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
export class PostgresResearchRepository implements ResearchRepository, PgVectorStore {
  public constructor(private readonly sql: Sql, private readonly environment: Record<string, string | undefined> = process.env) {}

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
        ingestionArtifactId: row.ingestion_artifact_id ? String(row.ingestion_artifact_id) : null,
        ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
        projectId: row.project_id ? String(row.project_id) : null,
        branchId: row.branch_id ? String(row.branch_id) : null,
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
      // 同一报告的相同内容只保留一份来源；冲突时只读取既有记录，不覆盖原来源的标题、快照或归属。
      const sourceRows = await transaction<DatabaseRow[]>`INSERT INTO source
        (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot,
         ingestion_artifact_id, owner_user_id, project_id, branch_id)
        VALUES (${source.id}, ${source.reportId}, ${source.title}, ${source.kind}, ${source.url}, ${source.language}, ${source.state}, ${source.capturedAt}, ${source.contentHash}, ${source.snapshot},
          ${source.ingestionArtifactId ?? null}, ${source.ownerUserId ?? null}, ${source.projectId ?? null}, ${source.branchId ?? null})
        ON CONFLICT (report_id, content_hash) DO NOTHING
        RETURNING id`;
      const sourceId = sourceRows[0]?.id
        ? String(sourceRows[0].id)
        : String((await transaction<DatabaseRow[]>`SELECT id FROM source WHERE report_id = ${source.reportId} AND content_hash = ${source.contentHash} LIMIT 1`)[0]?.id ?? source.id);
      for (const chunk of chunks) {
        await transaction`INSERT INTO source_chunk
          (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
          VALUES (${chunk.id}, ${sourceId}, ${chunk.parentSectionId}, ${transaction.array(chunk.headingPath)}::text[], ${chunk.position}, ${chunk.page}, ${chunk.startOffset}, ${chunk.endOffset}, ${chunk.text}, ${chunk.contextualPrefix}, ${chunk.contentHash})
          ON CONFLICT (source_id, content_hash) DO NOTHING`;
      }
    });
  }

  /**
   * PostgreSQL `to_tsvector` + `plainto_tsquery` 词法检索。
   * SQL 先过滤 active 来源和报告范围，再计算排名；参数化查询避免把查询词当作 SQL 片段。
   * contextual_prefix 纳入表达式索引；heading_path 仍由应用层确定性关键词层补充，
   * 避免 PostgreSQL 非 IMMUTABLE 数组格式化函数阻止索引创建。
   */
  public async searchSourceChunks(query: string, options: { reportId?: string; limit: number }): Promise<SourceChunkSearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(options.limit), 1), 80);
    const vectorExpression = "to_tsvector('simple', coalesce(chunk.text, '') || ' ' || coalesce(chunk.contextual_prefix, ''))";
    const rows = options.reportId
      ? await this.sql.unsafe<DatabaseRow[]>(`SELECT chunk.id AS chunk_id, chunk.source_id AS source_id,
          ts_rank_cd(${vectorExpression}, plainto_tsquery('simple', $1)) AS lexical_score
        FROM source_chunk AS chunk
        JOIN source AS source_record ON source_record.id = chunk.source_id
        WHERE source_record.state = 'active'
          AND source_record.report_id = $2
          AND ${vectorExpression} @@ plainto_tsquery('simple', $1)
        ORDER BY lexical_score DESC, chunk.position ASC, chunk.id ASC
        LIMIT $3`, [normalizedQuery, options.reportId, boundedLimit])
      : await this.sql.unsafe<DatabaseRow[]>(`SELECT chunk.id AS chunk_id, chunk.source_id AS source_id,
          ts_rank_cd(${vectorExpression}, plainto_tsquery('simple', $1)) AS lexical_score
        FROM source_chunk AS chunk
        JOIN source AS source_record ON source_record.id = chunk.source_id
        WHERE source_record.state = 'active'
          AND ${vectorExpression} @@ plainto_tsquery('simple', $1)
        ORDER BY lexical_score DESC, chunk.position ASC, chunk.id ASC
        LIMIT $2`, [normalizedQuery, boundedLimit]);

    return rows.map((row) => ({
      chunkId: String(row.chunk_id),
      sourceId: String(row.source_id),
      lexicalScore: Number(row.lexical_score) || 0,
    }));
  }

  /**
   * 探测迁移后的 pgvector 能力，而不是根据环境变量直接假定可用。
   * 只读查询在标准 postgres 镜像上也能成功；缺扩展时返回可审计的 degraded 能力。
   */
  public async getPgVectorCapability(): Promise<PgVectorCapability> {
    const config = getPgVectorConfig(this.environment);
    if (config.mode === "disabled") return degradedPgVectorCapability(config, "PGVECTOR_ENABLED=disabled，保持 FTS/确定性检索。");
    try {
      const rows = await this.sql<DatabaseRow[]>`SELECT
        (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS extension_version,
        (SELECT udt_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'source_chunk' AND column_name = 'embedding'
          LIMIT 1) AS embedding_type,
        (SELECT CASE
          WHEN indexdef ILIKE '%USING hnsw%' THEN 'hnsw'
          WHEN indexdef ILIKE '%USING ivfflat%' THEN 'ivfflat'
          ELSE 'none'
        END
          FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'source_chunk' AND indexname = 'source_chunk_embedding_idx'
          LIMIT 1) AS index_kind`;
      const row = rows[0];
      const extensionVersion = row?.extension_version ? String(row.extension_version) : null;
      const embeddingType = row?.embedding_type ? String(row.embedding_type) : null;
      const indexKind = row?.index_kind === "hnsw" || row?.index_kind === "ivfflat" ? row.index_kind : "none";
      if (!extensionVersion) return degradedPgVectorCapability(config, "数据库未安装 pgvector 扩展，保留 FTS/确定性检索。");
      if (embeddingType !== "vector") return degradedPgVectorCapability(config, "pgvector 扩展存在但 source_chunk.embedding 列未完成迁移。");
      return {
        mode: config.mode,
        enabled: true,
        available: true,
        canWrite: config.writeEnabled,
        extensionVersion,
        indexKind,
        reason: config.writeEnabled ? null : "PGVECTOR_WRITE_ENABLED 未开启，仅允许读取已建立的向量。",
      };
    } catch {
      return degradedPgVectorCapability(config, "pgvector 能力探测失败，保留 FTS/确定性检索。");
    }
  }

  /**
   * 以文本哈希、模型、维度和版本成组写入向量。
   * WHERE 同时限定 chunk/source，避免错误的调用者把向量写入别的来源；事务失败整体降级。
   */
  public async upsertChunkEmbeddings(input: ChunkEmbeddingInput[]): Promise<VectorWriteResult> {
    if (input.length === 0) return { status: "completed", written: 0, reason: null };
    const capability = await this.getPgVectorCapability();
    if (!capability.available || !capability.canWrite) {
      return { status: "degraded", written: 0, reason: capability.reason ?? "pgvector 不可写。" };
    }
    try {
      const prepared = input.map((item) => {
        if (!/^[a-f0-9]{64}$/.test(item.textHash) || !/^[a-zA-Z0-9._-]{1,64}$/.test(item.version)) {
          throw new Error("向量文本哈希或版本格式无效。");
        }
        if (!item.model.trim() || item.model.length > 160) throw new Error("向量模型标识无效。");
        if (!Number.isInteger(item.dimensions) || item.dimensions <= 0 || item.vector.length !== item.dimensions) {
          throw new Error("向量维度与元数据不一致。");
        }
        return { ...item, literal: toPgVectorLiteral(item.vector) };
      });
      let written = 0;
      await this.sql.begin(async (transaction) => {
        for (const item of prepared) {
          const rows = await transaction<DatabaseRow[]>`UPDATE source_chunk
            SET embedding = ${item.literal}::vector,
                embedding_model = ${item.model},
                embedding_dimensions = ${item.dimensions},
                embedding_version = ${item.version},
                embedding_text_hash = ${item.textHash},
                embedding_status = 'ready',
                embedding_updated_at = CURRENT_TIMESTAMP
            WHERE id = ${item.chunkId} AND source_id = ${item.sourceId}
            RETURNING id`;
          written += rows.length;
        }
      });
      return { status: "completed", written, reason: null };
    } catch (error) {
      return { status: "degraded", written: 0, reason: error instanceof Error ? error.message : "向量写入失败，保留确定性检索。" };
    }
  }

  /**
   * 只读取 active 来源和必要正文列；Worker 会再次按模型/版本/文本哈希计划重建，
   * 因此不会把 archived/stale 来源重新写回可检索状态。
   */
  public async listEmbeddingRebuildCandidates(options: { reportId?: string; limit: number }): Promise<EmbeddingRebuildCandidate[]> {
    const limit = Math.min(Math.max(Math.trunc(options.limit), 1), 500);
    const rows = options.reportId
      ? await this.sql<DatabaseRow[]>`SELECT chunk.id AS chunk_id, chunk.source_id, chunk.text, chunk.contextual_prefix,
          chunk.heading_path, chunk.embedding_status, chunk.embedding_model, chunk.embedding_dimensions,
          chunk.embedding_version, chunk.embedding_text_hash
        FROM source_chunk AS chunk JOIN source AS source_record ON source_record.id = chunk.source_id
        WHERE source_record.state = 'active' AND source_record.report_id = ${options.reportId}
        ORDER BY CASE WHEN chunk.embedding_status = 'stale' THEN 0 WHEN chunk.embedding_status = 'missing' THEN 1 ELSE 2 END,
          chunk.position ASC, chunk.id ASC LIMIT ${limit}`
      : await this.sql<DatabaseRow[]>`SELECT chunk.id AS chunk_id, chunk.source_id, chunk.text, chunk.contextual_prefix,
          chunk.heading_path, chunk.embedding_status, chunk.embedding_model, chunk.embedding_dimensions,
          chunk.embedding_version, chunk.embedding_text_hash
        FROM source_chunk AS chunk JOIN source AS source_record ON source_record.id = chunk.source_id
        WHERE source_record.state = 'active'
        ORDER BY CASE WHEN chunk.embedding_status = 'stale' THEN 0 WHEN chunk.embedding_status = 'missing' THEN 1 ELSE 2 END,
          chunk.position ASC, chunk.id ASC LIMIT ${limit}`;
    return rows.map((row) => ({
      chunkId: String(row.chunk_id), sourceId: String(row.source_id), text: String(row.text),
      contextualPrefix: String(row.contextual_prefix ?? ""), headingPath: (row.heading_path as string[]) ?? [],
      status: (row.embedding_status as EmbeddingRebuildCandidate["status"]) ?? "missing",
      embeddingModel: row.embedding_model ? String(row.embedding_model) : null,
      embeddingDimensions: row.embedding_dimensions === null || row.embedding_dimensions === undefined ? null : Number(row.embedding_dimensions),
      embeddingVersion: row.embedding_version ? String(row.embedding_version) : null,
      embeddingTextHash: row.embedding_text_hash ? String(row.embedding_text_hash) : null,
    }));
  }

  /**
   * 余弦距离召回只读取 active 来源，并以报告、source ID、模型、版本和每个 Chunk 的期望哈希过滤。
   * expectedChunks 用 unnest 成对连接，避免仅按 hash 集合过滤造成错配或过期向量穿透。
   */
  public async searchSimilarChunks(vector: number[], options: VectorSearchOptions): Promise<PersistedVectorSearchResult[]> {
    if (vector.length === 0 || options.sourceIds.length === 0 || options.expectedChunks.length === 0) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(options.limit), 1), 100);
    if (!Number.isInteger(options.dimensions) || vector.length !== options.dimensions) return [];
    if (!options.model.trim() || options.model.length > 160 || !/^[a-zA-Z0-9._-]{1,64}$/.test(options.version)) return [];
    if (options.expectedChunks.some((item) => !/^[a-f0-9]{64}$/.test(item.textHash))) return [];
    let literal: string;
    try {
      literal = toPgVectorLiteral(vector);
    } catch {
      return [];
    }
    const chunkIds = options.expectedChunks.map((item) => item.chunkId);
    const textHashes = options.expectedChunks.map((item) => item.textHash);
    try {
      const rows = await this.sql.unsafe<DatabaseRow[]>(`SELECT chunk.id AS chunk_id, chunk.source_id AS source_id,
          1 - (chunk.embedding <=> $1::vector) AS similarity
        FROM source_chunk AS chunk
        JOIN source AS source_record ON source_record.id = chunk.source_id
        JOIN unnest($3::text[], $4::text[]) AS expected(chunk_id, text_hash)
          ON expected.chunk_id = chunk.id AND expected.text_hash = chunk.embedding_text_hash
        WHERE source_record.state = 'active'
          AND chunk.source_id = ANY($2::text[])
          AND ($5::text IS NULL OR source_record.report_id = $5)
          AND chunk.embedding_status = 'ready'
          AND chunk.embedding_model = $6
          AND chunk.embedding_dimensions = $7
          AND chunk.embedding_version = $8
          AND chunk.embedding IS NOT NULL
        ORDER BY chunk.embedding <=> $1::vector ASC, chunk.position ASC, chunk.id ASC
        LIMIT $9`, [literal, options.sourceIds, chunkIds, textHashes, options.reportId ?? null, options.model, options.dimensions, options.version, boundedLimit]);
      return rows.map((row, index) => ({
        chunkId: String(row.chunk_id),
        sourceId: String(row.source_id),
        similarity: Number(row.similarity) || 0,
        rank: index + 1,
      }));
    } catch {
      // 扩展缺失、迁移尚未完成或索引竞争均不能阻断 FTS；调用方会回到确定性 Dense/关键词路径。
      return [];
    }
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
