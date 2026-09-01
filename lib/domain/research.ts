/**
 * 调研工作台的领域模型。
 * 所有可被 AI 引用的内容都必须保留来源、时间与内容哈希；这些类型不承载模型生成的未核验事实。
 */

/** 报告结论的证据状态，决定 UI 展示和后续人工复核要求。 */
export const evidenceStates = ["fact", "inference", "needs_verification", "conflict"] as const;
export type EvidenceState = (typeof evidenceStates)[number];

/** 研究对象类型。 */
export const companyKinds = ["company", "industry", "competitor", "policy"] as const;
export type CompanyKind = (typeof companyKinds)[number];

/** 图谱节点类型；白名单避免把任意输入当作可执行对象。 */
export const entityKinds = [
  "company",
  "product",
  "industry",
  "competitor",
  "policy",
  "source",
  "claim",
] as const;
export type EntityKind = (typeof entityKinds)[number];

/** 来源的可用性，失效或冲突来源不能被静默当作证据。 */
export const sourceStates = ["active", "stale", "conflict", "archived"] as const;
export type SourceState = (typeof sourceStates)[number];

/** 企业、行业、竞品或政策档案。 */
export interface Company {
  id: string;
  name: string;
  kind: CompanyKind;
  summary: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 可编辑报告元数据；正文由 Section 单独保存，便于精确引用与检索。 */
export interface Report {
  id: string;
  companyId: string;
  title: string;
  status: "draft" | "review" | "published";
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** 报告的层级章节。 */
export interface ReportSection {
  id: string;
  reportId: string;
  parentSectionId: string | null;
  heading: string;
  anchor: string;
  level: number;
  position: number;
  content: string;
  evidenceState: EvidenceState;
  updatedAt: string;
}

/** 已导入或手工保存的可追溯来源。 */
export interface Source {
  id: string;
  reportId: string;
  title: string;
  kind: "web" | "pdf" | "image" | "text" | "note";
  url: string | null;
  language: "zh" | "en" | "other";
  state: SourceState;
  capturedAt: string;
  contentHash: string;
  snapshot: string;
  /** 文件解析产物的血缘与项目范围；手工/历史来源没有这些字段。 */
  ingestionArtifactId?: string | null;
  ownerUserId?: string | null;
  projectId?: string | null;
  branchId?: string | null;
}

/** 适合检索和引用的来源片段，并保留父章节和原始定位。 */
export interface SourceChunk {
  id: string;
  sourceId: string;
  parentSectionId: string | null;
  headingPath: string[];
  position: number;
  page: number | null;
  startOffset: number;
  endOffset: number;
  text: string;
  contextualPrefix: string;
  contentHash: string;
}

/** 结论到来源片段的不可伪造引用映射。 */
export interface Citation {
  id: string;
  reportId: string;
  sectionId: string | null;
  sourceId: string;
  chunkId: string;
  quote: string;
  evidenceState: EvidenceState;
  createdAt: string;
}

/** GraphRAG-lite 的实体节点。 */
export interface Entity {
  id: string;
  reportId: string;
  kind: EntityKind;
  name: string;
  normalizedName: string;
  sourceId: string | null;
  evidenceState: EvidenceState;
  attributes: Record<string, string>;
  createdAt: string;
}

/** GraphRAG-lite 的有来源关系边。 */
export interface RelationEdge {
  id: string;
  reportId: string;
  fromEntityId: string;
  toEntityId: string;
  relation: string;
  sourceId: string | null;
  evidenceState: EvidenceState;
  createdAt: string;
}

/** 报告的不可变版本快照，修改必须经用户确认后才生成。 */
export interface ReportRevision {
  id: string;
  reportId: string;
  version: number;
  title: string;
  sections: ReportSection[];
  author: "user" | "system";
  createdAt: string;
}

/** 用于工作台首页的一致性快照。 */
export interface WorkbenchSnapshot {
  companies: Company[];
  reports: Report[];
  sections: ReportSection[];
  sources: Source[];
  chunks: SourceChunk[];
  citations: Citation[];
  entities: Entity[];
  edges: RelationEdge[];
  revisions: ReportRevision[];
}

/** 新建报告的最小输入。 */
export interface CreateReportInput {
  companyId: string;
  title: string;
  firstSection?: Partial<Pick<ReportSection, "heading" | "content" | "evidenceState">>;
}

/** 保存报告时使用乐观锁，拒绝覆盖其他已保存版本。 */
export interface SaveReportInput {
  title: string;
  expectedVersion: number;
  sections: Array<Pick<ReportSection, "id" | "parentSectionId" | "heading" | "anchor" | "level" | "position" | "content" | "evidenceState">>;
}

/** 可安全返回给客户端的检索片段。 */
export interface SearchHit {
  chunk: SourceChunk;
  source: Source;
  score: number;
  parentSection: ReportSection | null;
  adjacentChunks: SourceChunk[];
  /** 词法召回的实际执行路径；degraded 表示本次未使用 PostgreSQL FTS。 */
  lexical: { status: "completed" | "degraded"; provider: "postgres_fts" | "keyword_fallback"; reason: string | null };
  /** 当前请求的精排状态；degraded 表示保留 FTS/RRF 既有顺序，绝不伪称模型已精排。 */
  rerank: { status: "completed" | "degraded"; model: string | null; reason: string | null };
  /** dense=degraded 表示本次未使用语义结果，不能被 UI 或回答层误认为混合检索成功。 */
  dense: { status: "completed" | "degraded"; provider: "remote" | "local_bge_m3" | null; model: string | null; reason: string | null };
}

/** 受限图查询结果；不暴露数据库语句或任意属性。 */
export interface GraphPath {
  nodes: Array<Pick<Entity, "id" | "kind" | "name" | "evidenceState">>;
  edges: Array<Pick<RelationEdge, "id" | "relation" | "evidenceState" | "sourceId">>;
}

/** 模型/搜索 Provider 的安全配置状态；绝不返回密钥。 */
export interface AiConfigurationStatus {
  model: {
    configured: boolean;
    provider: "openai_compatible" | "deepseek" | "none";
    model: string | null;
    reasoningEffort: "low" | "medium" | "high" | null;
  };
  search: { configured: boolean; provider: "deepseek_native" | "bocha" | "none"; scope: "international" | "domestic" | "none" };
}
