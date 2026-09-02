import type { Entity, GraphPath, RelationEdge, SourceState, WorkbenchSnapshot } from "@/lib/domain/research";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { ValidationError } from "@/lib/domain/errors";

/** GraphRAG-lite 的硬限制，防止“关系查询”变成无边界图遍历。 */
const MAX_DEPTH = 2;
const MAX_NODES = 12;
/** 公开关系图的响应上限，避免用户可编辑关系增长后造成无界 JSON/布局压力。 */
const MAX_PUBLIC_GRAPH_NODES = 200;
const MAX_PUBLIC_GRAPH_EDGES = 400;

/** 公开关系图中的节点投影；不返回 attributes，避免把未审核字段直接暴露到客户端。 */
export interface PublicGraphNode {
  id: string;
  kind: Entity["kind"];
  name: string;
  evidenceState: Entity["evidenceState"];
  sourceId: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceState: SourceState | null;
}

/** 公开关系图中的关系边；sourceState 用于区分可引用关系和待核验候选。 */
export interface PublicGraphEdge {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  relation: string;
  evidenceState: RelationEdge["evidenceState"];
  sourceId: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceState: SourceState | null;
}

export interface PublicGraph {
  reportId: string;
  nodes: PublicGraphNode[];
  edges: PublicGraphEdge[];
  /** 没有 active 来源的边仍保留为待核验，但不会参与“事实关系”连线。 */
  pendingEdges: PublicGraphEdge[];
  generatedAt: string;
  available: boolean;
  note: string;
}

/**
 * GraphRAG-lite 服务。
 * 仅遍历带 active 来源的关系边；没有来源的推断不会被伪装成可引用的图谱事实。
 */
export class GraphService {
  public constructor(private readonly repository: ResearchRepository) {}

  /** 从起始实体名称出发，在报告范围内返回短路径，不执行动态 Cypher/SQL。 */
  public async queryByEntityName(reportId: string, entityName: string, maxDepth = MAX_DEPTH): Promise<GraphPath[]> {
    const normalized = entityName.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) throw new ValidationError("关系查询需要实体名称");
    const snapshot = await this.repository.getSnapshot();
    return this.querySnapshot(snapshot, reportId, normalized, Math.min(Math.max(maxDepth, 1), MAX_DEPTH));
  }

  /**
   * 生成单报告的公开关系图投影。
   * 关系查询仍复用 ResearchRepository 的快照边界；只把报告内实体和其关系返回，
   * 有 active 来源的边才进入 edges，来源缺失/失效的边进入 pendingEdges，防止 UI 将候选关系伪装成事实。
   */
  public async getPublicGraph(reportId: string): Promise<PublicGraph> {
    const snapshot = await this.repository.getSnapshot();
    return this.projectPublicGraph(snapshot, reportId);
  }

  /** 纯函数投影供 API 与契约测试复用；不执行额外查询，也不改变快照。 */
  public projectPublicGraph(snapshot: WorkbenchSnapshot, reportId: string): PublicGraph {
    const normalizedReportId = reportId.trim();
    const sourceMap = new Map(snapshot.sources.filter((source) => source.reportId === normalizedReportId).map((source) => [source.id, source]));
    const allEntities = snapshot.entities.filter((entity) => entity.reportId === normalizedReportId);
    const entities = allEntities.slice(0, MAX_PUBLIC_GRAPH_NODES);
    const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
    const allEdges = snapshot.edges.filter((edge) => edge.reportId === normalizedReportId && entityMap.has(edge.fromEntityId) && entityMap.has(edge.toEntityId));
    const edges = allEdges.slice(0, MAX_PUBLIC_GRAPH_EDGES);
    const toPublicEdge = (edge: RelationEdge): PublicGraphEdge => {
      const source = edge.sourceId ? sourceMap.get(edge.sourceId) : undefined;
      return {
        id: edge.id, fromEntityId: edge.fromEntityId, toEntityId: edge.toEntityId, relation: edge.relation,
        evidenceState: edge.evidenceState, sourceId: edge.sourceId, sourceTitle: source?.title ?? null, sourceUrl: source?.url ?? null, sourceState: source?.state ?? null,
      };
    };
    const publicEdges = edges.filter((edge) => edge.sourceId !== null && sourceMap.get(edge.sourceId)?.state === "active").map(toPublicEdge);
    const pendingEdges = edges.filter((edge) => edge.sourceId === null || sourceMap.get(edge.sourceId)?.state !== "active").map(toPublicEdge);
    const nodes = entities.map((entity): PublicGraphNode => {
      const source = entity.sourceId ? sourceMap.get(entity.sourceId) : undefined;
      return {
        id: entity.id, kind: entity.kind, name: entity.name, evidenceState: entity.evidenceState,
        sourceId: entity.sourceId, sourceTitle: source?.title ?? null, sourceUrl: source?.url ?? null, sourceState: source?.state ?? null,
      };
    });
    const baseNote = entities.length === 0
      ? "该公开项目暂时没有可展示的关系实体；系统不会用模型猜测补齐关系。"
      : publicEdges.length === 0
        ? "当前关系边没有 active 来源；待核验候选已单独列出，不能作为正式事实引用。"
        : "关系边仅来自当前报告的 active 来源；待核验候选不会参与事实连线。";
    const note = allEntities.length > entities.length || allEdges.length > edges.length
      ? `${baseNote} 关系图按公开展示上限截取（实体 ${MAX_PUBLIC_GRAPH_NODES}、关系 ${MAX_PUBLIC_GRAPH_EDGES}）；完整内容仍在报告数据中。`
      : baseNote;
    return {
      reportId: normalizedReportId,
      nodes,
      edges: publicEdges,
      pendingEdges,
      generatedAt: new Date().toISOString(),
      available: entities.length > 0,
      note,
    };
  }

  /** 在已有快照内执行受限 BFS，供上下文投影避免额外数据库往返。 */
  public querySnapshot(snapshot: WorkbenchSnapshot, reportId: string, normalizedName: string, maxDepth = MAX_DEPTH): GraphPath[] {
    const sourceMap = new Map(snapshot.sources.map((source) => [source.id, source]));
    const entities = snapshot.entities.filter((entity) => entity.reportId === reportId);
    const entityMap = new Map(entities.map((entity) => [entity.id, entity]));
    const activeEdges = snapshot.edges.filter((edge) => {
      if (edge.reportId !== reportId || !edge.sourceId) return false;
      return sourceMap.get(edge.sourceId)?.state === "active" && entityMap.has(edge.fromEntityId) && entityMap.has(edge.toEntityId);
    });
    const startNodes = entities.filter((entity) => entity.normalizedName.includes(normalizedName) || entity.name.toLocaleLowerCase("zh-CN").includes(normalizedName));
    const paths: GraphPath[] = [];

    for (const start of startNodes.slice(0, 3)) {
      const queue: Array<{ node: Entity; nodes: Entity[]; edges: RelationEdge[]; depth: number }> = [{ node: start, nodes: [start], edges: [], depth: 0 }];
      while (queue.length > 0 && paths.length < MAX_NODES) {
        const current = queue.shift()!;
        if (current.edges.length > 0) {
          paths.push({
            nodes: current.nodes.map((node) => ({ id: node.id, kind: node.kind, name: node.name, evidenceState: node.evidenceState })),
            edges: current.edges.map((edge) => ({ id: edge.id, relation: edge.relation, evidenceState: edge.evidenceState, sourceId: edge.sourceId })),
          });
        }
        if (current.depth >= maxDepth) continue;

        for (const edge of activeEdges) {
          const nextId = edge.fromEntityId === current.node.id ? edge.toEntityId : edge.toEntityId === current.node.id ? edge.fromEntityId : null;
          if (!nextId || current.nodes.some((node) => node.id === nextId)) continue;
          const nextNode = entityMap.get(nextId);
          if (!nextNode) continue;
          queue.push({ node: nextNode, nodes: [...current.nodes, nextNode], edges: [...current.edges, edge], depth: current.depth + 1 });
        }
      }
    }
    return paths.slice(0, MAX_NODES);
  }
}
