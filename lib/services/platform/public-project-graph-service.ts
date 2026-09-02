import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { getResearchRepository } from "@/lib/providers/repository-factory";
import { GraphService, type PublicGraph } from "@/lib/services/graph-service";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

/** 公开项目关系图返回值；source 说明数据来自 PostgreSQL 还是本地 typed seed。 */
export interface PublicProjectGraphResult {
  projectId: string;
  projectSlug: string;
  graph: PublicGraph;
  source: "postgres" | "typed_seed";
}

/**
 * 将公开项目稳定映射到 Research Workbench 的 report。
 * 首发企业项目采用 project-{slug} / report-{slug} 命名约定；不匹配时拒绝猜测，
 * 这样新增项目必须显式建立关系，而不会意外读到另一家企业的图谱。
 */
function reportIdForProject(projectId: string): string | null {
  const prefix = "project-";
  if (!projectId.startsWith(prefix) || projectId.length <= prefix.length) return null;
  return `report-${projectId.slice(prefix.length)}`;
}

/** 只读 GraphRAG-lite 服务；公开边界先过项目可见性，再读取同 report 的实体/关系。 */
export class PublicProjectGraphService {
  public constructor(private readonly projects = new PublicProjectService(), private readonly graph = new GraphService(getResearchRepository())) {}

  public async get(projectIdOrSlug: string): Promise<PublicProjectGraphResult> {
    const normalized = projectIdOrSlug.trim();
    if (!normalized || normalized.length > 160) throw new ValidationError("项目 ID 或 slug 无效");
    const projectResult = await this.projects.get(normalized);
    const project = projectResult.data;
    if (!project) throw new NotFoundError("公开项目不存在");
    const reportId = reportIdForProject(project.id);
    if (!reportId) {
      return {
        projectId: project.id, projectSlug: project.slug,
        graph: {
          reportId: "", nodes: [], edges: [], pendingEdges: [], generatedAt: new Date().toISOString(), available: false,
          note: "该项目尚未建立可核验的报告关系映射；系统不会跨项目猜测关系。",
        }, source: projectResult.source,
      };
    }
    return { projectId: project.id, projectSlug: project.slug, graph: await this.graph.getPublicGraph(reportId), source: projectResult.source };
  }
}

