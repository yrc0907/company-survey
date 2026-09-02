import type { AuthenticatedActor, AuthorFollowState, PublicAuthorRecord } from "@/lib/domain/platform";
import { NotFoundError, PersistenceRequiredError, ValidationError } from "@/lib/domain/errors";
import { getPlatformRepository } from "@/lib/repositories/platform/platform-repository-factory";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { PublicProjectService } from "@/lib/services/platform/public-project-service";

export interface AuthorServiceResult<T> {
  data: T;
  source: "postgres" | "typed_seed";
}

function normalizeUsername(value: string): string {
  const username = value.trim();
  if (!username || username.length > 64) throw new ValidationError("作者用户名无效");
  return username;
}

/**
 * 作者服务负责公开主页与关注关系；主页仅读取公开项目，关注写入只接受 Session actor。
 * 页面不直接访问仓储，未配置数据库时主页可读但关注写入明确返回持久化要求。
 */
export class AuthorService {
  public constructor(private readonly repository?: PlatformRepository) {}

  private get configuredRepository(): PlatformRepository {
    return this.repository ?? getPlatformRepository();
  }

  /** 构造无数据库时的只读作者投影，明确标记来源，不把 seed 当真实关注数据。 */
  private async seedProfile(username: string, viewerId: string | null): Promise<PublicAuthorRecord | null> {
    const projects = (await new PublicProjectService().list({ limit: 100 })).data;
    const owned = projects.filter((project) => project.owner.username.toLowerCase() === username.toLowerCase());
    if (!owned.length) return null;
    const owner = owned[0]!.owner;
    return {
      id: owner.id, username: owner.username, displayName: owner.displayName, bio: "",
      avatarAssetId: owner.avatarAssetId, createdAt: owned[0]!.publishedAt ?? owned[0]!.updatedAt,
      projectCount: owned.length, followerCount: 0, followingCount: 0, followedByCurrentUser: false,
      projects: owned, contributions: [], // seed 没有可写关注事实，因此不伪造 following 状态。
    };
  }

  public async getProfile(usernameInput: string, viewerId: string | null): Promise<AuthorServiceResult<PublicAuthorRecord>> {
    const username = normalizeUsername(usernameInput);
    if (!process.env.DATABASE_URL?.trim() && !this.repository) {
      const profile = await this.seedProfile(username, viewerId);
      if (!profile) throw new NotFoundError("作者不存在");
      return { data: profile, source: "typed_seed" };
    }
    const profile = await this.configuredRepository.getPublicAuthor({ username, followerUserId: viewerId });
    if (!profile) throw new NotFoundError("作者不存在");
    return { data: profile, source: "postgres" };
  }

  public async getFollowState(usernameInput: string, viewerId: string | null): Promise<AuthorServiceResult<AuthorFollowState>> {
    const username = normalizeUsername(usernameInput);
    if (!process.env.DATABASE_URL?.trim() && !this.repository) throw new PersistenceRequiredError("读取作者关注需要连接 PostgreSQL");
    const state = await this.configuredRepository.getAuthorFollowState({ username, followerUserId: viewerId });
    if (!state) throw new NotFoundError("作者不存在");
    return { data: state, source: "postgres" };
  }

  /** 关注/取消关注都幂等；服务层先拒绝自关注，再由数据库 CHECK 作为最后防线。 */
  public async setFollow(actor: AuthenticatedActor, usernameInput: string, following: boolean): Promise<AuthorServiceResult<AuthorFollowState>> {
    if (!actor.userId) throw new ValidationError("用户身份无效");
    if (typeof following !== "boolean") throw new ValidationError("关注状态无效");
    const username = normalizeUsername(usernameInput);
    if (!process.env.DATABASE_URL?.trim() && !this.repository) throw new PersistenceRequiredError("修改作者关注需要连接 PostgreSQL");
    const profile = await this.configuredRepository.getPublicAuthor({ username, followerUserId: actor.userId });
    if (!profile) throw new NotFoundError("作者不存在");
    if (profile.id === actor.userId) throw new ValidationError("不能关注自己");
    const state = await this.configuredRepository.setAuthorFollow({ username, followerUserId: actor.userId, following });
    if (!state) throw new NotFoundError("作者不存在");
    return { data: state, source: "postgres" };
  }
}
