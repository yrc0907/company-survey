import { NotFoundError, PersistenceRequiredError, ValidationError } from "@/lib/domain/errors";
import type { PublicProjectActivityEvent, PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";

export interface PublicActivityInput { projectIdOrSlug: string; limit?: number; before?: string; }
export interface PublicActivityResult { data: PublicProjectActivityEvent[]; source: "postgres"; }

/**
 * 公开活动服务：只暴露已发布项目的真实事件，游标以时间戳分页。
 * 不在服务层从评论/Star计数猜测活动，也不把 seed 或客户端事件伪装成持久事实。
 */
export class PublicActivityService {
  public constructor(private readonly repository?: PlatformRepository) {}

  public async list(input: PublicActivityInput): Promise<PublicActivityResult> {
    const projectIdOrSlug = input.projectIdOrSlug.trim();
    if (!projectIdOrSlug || projectIdOrSlug.length > 160) throw new ValidationError("项目 ID 或 slug 无效");
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 30)));
    if (input.before !== undefined && Number.isNaN(Date.parse(input.before))) throw new ValidationError("before 游标无效");
    if (!this.repository && !process.env.DATABASE_URL?.trim()) throw new PersistenceRequiredError("读取活动时间线需要连接 PostgreSQL");
    const events = await (this.repository ?? getPlatformRepository()).listPublicProjectActivity({ projectIdOrSlug, limit, before: input.before });
    if (events === null) throw new NotFoundError("公开项目不存在");
    return { data: events, source: "postgres" };
  }
}
