import { createHash, randomUUID } from "node:crypto";

import type { AuthenticatedActor } from "@/lib/domain/platform";
import { NotFoundError, PersistenceRequiredError, ValidationError } from "@/lib/domain/errors";
import { seedProjects, type SeedFileNode, type SeedProject } from "@/lib/ui/platform-seed";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import type { PlatformRepository, PublicProjectFileRecord, PublicProjectListInput, PublicProjectRecord, PublicProjectStarState, PublicProjectViewResult } from "@/lib/repositories/platform/platform-repository";

export interface PublicProjectQuery extends PublicProjectListInput {
  category?: "企业" | "政策" | "行业" | "技术";
}

export interface CreatePrivateProjectInput {
  title: string;
  summary?: string;
  slug?: string;
  license?: string;
}

export interface RecordProjectViewInput {
  projectIdOrSlug: string;
  /** 登录用户 ID 来自已验证 Session；匿名请求必须提供服务端签发的访客 Cookie。 */
  userId?: string | null;
  visitorId: string;
  viewedOn?: string;
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
    publishedAt: project.publishedAt, updatedAt: project.updatedAt, uniqueReaders: project.uniqueReaders, starCount: project.starCount ?? 0,
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

  /**
   * 公开项目阅读上报：将登录用户或匿名访客标识哈希后交给 Repository。
   * 原始 Cookie 永不进入数据库；没有 PostgreSQL 时明确拒绝持久化，避免把内存计数伪装成真实统计。
   */
  public async recordView(input: RecordProjectViewInput): Promise<ProjectServiceResult<PublicProjectViewResult>> {
    const projectIdOrSlug = input.projectIdOrSlug.trim();
    if (!projectIdOrSlug || projectIdOrSlug.length > 160) throw new ValidationError("项目 ID 或 slug 无效");
    const visitorId = input.visitorId.trim();
    if (!visitorId || visitorId.length > 128) throw new ValidationError("访客标识无效");
    if (!process.env.DATABASE_URL?.trim() && !this.repository) throw new PersistenceRequiredError("记录公开阅读需要连接 PostgreSQL");
    const salt = process.env.VIEWER_HASH_SALT?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "development-view-salt";
    const identity = input.userId?.trim() ? `user:${input.userId.trim()}` : `visitor:${visitorId}`;
    const viewerKeyHash = createHash("sha256").update(`${salt}:${identity}`, "utf8").digest("hex");
    const result = await this.configuredRepository.recordPublicProjectView({
      projectIdOrSlug, viewerKeyHash, viewerUserId: input.userId?.trim() || null, viewedOn: input.viewedOn,
    });
    if (!result) throw new NotFoundError("公开项目不存在");
    return { data: result, source: "postgres" };
  }

  /** 公开 Star 状态读取；匿名用户只能读取总数，不能伪造当前用户关系。 */
  public async getStarState(projectIdOrSlug: string, userId: string | null): Promise<ProjectServiceResult<PublicProjectStarState>> {
    const normalized = projectIdOrSlug.trim();
    if (!normalized || normalized.length > 160) throw new ValidationError("项目 ID 或 slug 无效");
    if (!process.env.DATABASE_URL?.trim() && !this.repository) throw new PersistenceRequiredError("读取项目 Star 需要连接 PostgreSQL");
    const result = await this.configuredRepository.getPublicProjectStarState(normalized, userId);
    if (!result) throw new NotFoundError("公开项目不存在");
    return { data: result, source: "postgres" };
  }

  /** 登录用户切换 Star；身份只接受已验证 Session 的 actor，不接受请求体中的 userId。 */
  public async setStar(actor: AuthenticatedActor, projectIdOrSlug: string, starred: boolean): Promise<ProjectServiceResult<PublicProjectStarState>> {
    if (!actor.userId) throw new ValidationError("用户身份无效");
    if (typeof starred !== "boolean") throw new ValidationError("Star 状态无效");
    const normalized = projectIdOrSlug.trim();
    if (!normalized || normalized.length > 160) throw new ValidationError("项目 ID 或 slug 无效");
    if (!process.env.DATABASE_URL?.trim() && !this.repository) throw new PersistenceRequiredError("修改项目 Star 需要连接 PostgreSQL");
    const result = await this.configuredRepository.setPublicProjectStar({ projectIdOrSlug: normalized, userId: actor.userId, starred });
    if (!result) throw new NotFoundError("公开项目不存在");
    return { data: result, source: "postgres" };
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
