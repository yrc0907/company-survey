import { PersistenceRequiredError, ValidationError } from "@/lib/domain/errors";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import type { PlatformRepository, PublicSearchResult } from "@/lib/repositories/platform/platform-repository";
import { seedProjects } from "@/lib/ui/platform-seed";

export interface GlobalSearchInput {
  query: string;
  limit?: number;
}

export interface GlobalSearchResult {
  data: PublicSearchResult[];
  source: "postgres" | "typed_seed";
}

/**
 * 公开平台全站搜索服务。查询词和数量在领域边界统一规范化，Repository 负责最终公开范围过滤。
 * 本地无数据库时只从明确的 typed seed 搜索，避免把客户端内存结果误报为持久化数据。
 */
export class GlobalSearchService {
  public constructor(private readonly repository?: PlatformRepository) {}

  public async search(input: GlobalSearchInput): Promise<GlobalSearchResult> {
    const query = input.query.trim();
    if (query.length < 1 || query.length > 120) throw new ValidationError("搜索词需为 1-120 个字符");
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 30)));
    if (!process.env.DATABASE_URL?.trim() && !this.repository) {
      const needle = query.toLocaleLowerCase("zh-CN");
      const results: PublicSearchResult[] = [];
      const seenAuthors = new Set<string>();
      for (const project of seedProjects) {
        if (project.title.toLocaleLowerCase("zh-CN").includes(needle) || project.summary.toLocaleLowerCase("zh-CN").includes(needle) || project.slug.toLocaleLowerCase("zh-CN").includes(needle) || project.tags.some((tag) => tag.toLocaleLowerCase("zh-CN").includes(needle))) {
          results.push({ kind: "project", id: project.id, title: project.title, description: project.summary, projectId: project.id, projectSlug: project.slug, projectTitle: project.title, authorUsername: project.owner.username, authorDisplayName: project.owner.displayName, score: 1 });
        }
        if (!seenAuthors.has(project.owner.id) && `${project.owner.username} ${project.owner.displayName}`.toLocaleLowerCase("zh-CN").includes(needle)) {
          seenAuthors.add(project.owner.id);
          results.push({ kind: "author", id: project.owner.id, title: project.owner.displayName, description: `@${project.owner.username}`, projectId: null, projectSlug: null, projectTitle: null, authorUsername: project.owner.username, authorDisplayName: project.owner.displayName, score: 1 });
        }
        for (const section of project.sections) {
          if (!`${section.heading} ${section.paragraphs.join(" ")}`.toLocaleLowerCase("zh-CN").includes(needle)) continue;
          results.push({ kind: "document", id: section.id, title: section.heading, description: section.paragraphs.join("\n").slice(0, 240), projectId: project.id, projectSlug: project.slug, projectTitle: project.title, authorUsername: project.owner.username, authorDisplayName: project.owner.displayName, score: 1 });
        }
      }
      return { data: results.slice(0, limit), source: "typed_seed" };
    }
    if (!this.repository && !process.env.DATABASE_URL?.trim()) throw new PersistenceRequiredError();
    const repository = this.repository ?? getPlatformRepository();
    return { data: await repository.searchPublicContent(query, limit), source: "postgres" };
  }
}
