import type { Entity, GraphPath, RelationEdge, WorkbenchSnapshot } from "@/lib/domain/research";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { ValidationError } from "@/lib/domain/errors";

/** GraphRAG-lite 的硬限制，防止“关系查询”变成无边界图遍历。 */
const MAX_DEPTH = 2;
const MAX_NODES = 12;

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
