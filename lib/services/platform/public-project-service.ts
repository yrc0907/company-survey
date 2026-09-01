import { randomUUID } from "node:crypto";

import type { AuthenticatedActor } from "@/lib/domain/platform";
import { PersistenceRequiredError, ValidationError } from "@/lib/domain/errors";
import { seedProjects, type SeedFileNode, type SeedProject } from "@/lib/ui/platform-seed";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import type { PlatformRepository, PublicProjectFileRecord, PublicProjectListInput, PublicProjectRecord } from "@/lib/repositories/platform/platform-repository";

export interface PublicProjectQuery extends PublicProjectListInput {
  category?: "企业" | "政策" | "行业" | "技术";
}

export interface CreatePrivateProjectInput {
  title: string;
  summary?: string;
  slug?: string;
  license?: string;
}

export interface ProjectServiceResult<T> {
  data: T;
  source: "postgres" | "typed_seed";
}

function flattenSeedFiles(nodes: SeedFileNode[], parentId: string | null = null): PublicProjectFileRecord[] {
  return nodes.flatMap((node, position) => [
    { id: node.id, name: node.name, kind: node.kind, parentId, position },
    ...(node.children ? flattenSeedFiles(node.children, node.id) : []),
  ]);
}

function fromSeed(project: SeedProject): PublicProjectRecord {
  return {
    id: project.id, slug: project.slug, title: project.title, summary: project.summary, visibility: "public", status: "published",
    owner: { id: project.owner.id, username: project.owner.username, displayName: project.owner.displayName, avatarAssetId: null },
    publishedAt: project.publishedAt, updatedAt: project.updatedAt, uniqueReaders: project.uniqueReaders,
    contributorCount: project.contributors.length, sourceCount: project.sourceCount, openMergeRequests: project.openMergeRequests,
    version: project.version, license: "cc-by-4.0", category: project.category, tags: [...project.tags], verification: project.verification,
    verificationNote: project.verificationNote, assistantReportId: project.assistantReportId, files: flattenSeedFiles(project.files),
    sections: project.sections.map((section) => ({ id: section.id, nodeId: section.id, heading: section.heading, content: section.paragraphs.join("\n\n"), evidenceState: section.state, updatedAt: project.updatedAt })),
  };
}

function normalizeSlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
  if (!slug || slug.length > 80) throw new ValidationError("slug 需为 1-80 位字母、数字、中文或短横线");
  return slug;
}

/** 公开项目服务：数据库优先，未配置数据库时只读 typed seed；不会把 seed 伪装成持久化写入。 */
export class PublicProjectService {
  public constructor(private readonly repository?: PlatformRepository) {}

  private get configuredRepository(): PlatformRepository {
    return this.repository ?? getPlatformRepository();
  }

  public async list(input: PublicProjectQuery = {}): Promise<ProjectServiceResult<PublicProjectRecord[]>> {
    if (!process.env.DATABASE_URL?.trim() && !this.repository) {
      const query = input.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
      const filtered = seedProjects.filter((project) => {
        const categoryMatches = !input.category || project.category === input.category;
        const textMatches = !query || [project.title, project.summary, project.slug, project.owner.username, ...project.tags].some((field) => field.toLocaleLowerCase("zh-CN").includes(query));
        return categoryMatches && textMatches;
      });
      const sorted = [...filtered].sort((left, right) => input.sort === "read" ? right.uniqueReaders - left.uniqueReaders : input.sort === "latest" ? Date.parse(right.updatedAt) - Date.parse(left.updatedAt) : 0);
      const offset = Math.max(0, input.offset ?? 0);
      const limit = Math.min(100, Math.max(1, input.limit ?? 50));
      return { data: sorted.slice(offset, offset + limit).map(fromSeed), source: "typed_seed" };
    }
    return { data: await this.configuredRepository.listPublicProjects(input), source: "postgres" };
  }

  public async get(projectIdOrSlug: string): Promise<ProjectServiceResult<PublicProjectRecord | null>> {
    const normalized = projectIdOrSlug.trim();
    if (!normalized) throw new ValidationError("项目 ID 或 slug 不能为空");
    if (!process.env.DATABASE_URL?.trim() && !this.repository) {
      const seed = seedProjects.find((project) => project.id === normalized || project.slug === normalized);
      return { data: seed ? fromSeed(seed) : null, source: "typed_seed" };
    }
    return { data: await this.configuredRepository.getPublicProject(normalized), source: "postgres" };
  }

  /** 创建空白私有项目，所有者来自签名 Session；匿名和 seed 模式都 fail closed。 */
  public async createPrivate(actor: AuthenticatedActor, input: CreatePrivateProjectInput): Promise<ProjectServiceResult<PublicProjectRecord>> {
    if (!actor.userId) throw new ValidationError("用户身份无效");
    if (!process.env.DATABASE_URL?.trim() && !this.repository) throw new PersistenceRequiredError("创建项目需要连接 PostgreSQL");
    const title = input.title.trim();
    if (title.length < 2 || title.length > 120) throw new ValidationError("项目标题需为 2-120 个字符");
    const slug = normalizeSlug(input.slug || title);
    const summary = (input.summary ?? "").trim();
    if (summary.length > 1000) throw new ValidationError("项目摘要不能超过 1000 个字符");
    const license = (input.license ?? "all-rights-reserved").trim();
    if (!/^[a-z0-9][a-z0-9.-]{1,63}$/.test(license)) throw new ValidationError("许可证标识无效");
    return { data: await this.configuredRepository.createPrivateProject({ id: randomUUID(), ownerUserId: actor.userId, slug, title, summary, license, createdAt: new Date().toISOString() }), source: "postgres" };
  }
}
