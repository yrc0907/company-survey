import { randomUUID } from "node:crypto";

import { AccountConflictError } from "@/lib/domain/platform/errors";
import { ValidationError } from "@/lib/domain/errors";
import type { AuthorFollowState, KnowledgeBranchAccess, KnowledgeNodeState, KnowledgeProjectAccess, OAuthIdentityInput, PasswordAccount, PlatformAccount, PublicAuthorRecord } from "@/lib/domain/platform";
import type { CreatePasswordAccountRecord, CreatePrivateProjectRecordInput, ListPublicProjectActivityInput, PlatformRepository, PublicAuthorInput, PublicProjectActivityEvent, PublicProjectListInput, PublicProjectRecord, PublicProjectStarState, PublicProjectViewResult, PublicSearchResult, RecordPublicProjectViewInput, SetAuthorFollowInput, SetPublicProjectStarInput } from "@/lib/repositories/platform/platform-repository";

/** 契约测试使用的内存仓储；复制所有返回值，避免测试误改内部事实。 */
export class MemoryPlatformRepository implements PlatformRepository {
  private readonly accounts = new Map<string, PasswordAccount>();
  private readonly identities = new Map<string, string>();
  private readonly projects = new Map<string, KnowledgeProjectAccess>();
  private readonly branches = new Map<string, KnowledgeBranchAccess>();
  private readonly nodeStates = new Map<string, KnowledgeNodeState>();
  private readonly publicProjects = new Map<string, PublicProjectRecord>();
  private readonly projectReaders = new Map<string, Set<string>>();
  private readonly projectDailyViews = new Set<string>();
  private readonly projectStars = new Map<string, Map<string, boolean>>();
  private readonly authorFollows = new Map<string, Map<string, boolean>>();

  public async createPasswordAccount(record: CreatePasswordAccountRecord): Promise<PlatformAccount> {
    const email = record.account.email.toLowerCase();
    const username = record.account.username.toLowerCase();
    if (Array.from(this.accounts.values()).some((item) => item.email.toLowerCase() === email)) {
      throw new AccountConflictError("email", "该邮箱已注册");
    }
    if (Array.from(this.accounts.values()).some((item) => item.username.toLowerCase() === username)) {
      throw new AccountConflictError("username", "该用户名已被使用");
    }
    this.accounts.set(record.account.id, { ...structuredClone(record.account), passwordHash: record.passwordHash, lockedUntil: null });
    return structuredClone(record.account);
  }

  public async findPasswordAccountByIdentifier(identifier: string): Promise<PasswordAccount | null> {
    const normalized = identifier.toLowerCase();
    const account = Array.from(this.accounts.values()).find((item) => item.email.toLowerCase() === normalized || item.username.toLowerCase() === normalized);
    return account ? structuredClone(account) : null;
  }

  public async findAccountByEmail(email: string): Promise<PlatformAccount | null> {
    const normalized = email.trim().toLowerCase();
    const account = Array.from(this.accounts.values()).find((item) => item.email.toLowerCase() === normalized);
    return account ? this.findAccountById(account.id) : null;
  }

  public async findAccountByPhone(phoneE164: string): Promise<PlatformAccount | null> {
    const account = Array.from(this.accounts.values()).find((item) => item.phoneE164 === phoneE164 && item.phoneVerifiedAt);
    return account ? this.findAccountById(account.id) : null;
  }

  public async markEmailVerified(userId: string): Promise<PlatformAccount | null> {
    const account = this.accounts.get(userId);
    if (!account || account.status !== "active") return null;
    account.emailVerifiedAt ??= new Date().toISOString();
    account.updatedAt = new Date().toISOString();
    return this.findAccountById(userId);
  }

  public async bindVerifiedPhone(userId: string, phoneE164: string): Promise<PlatformAccount | null> {
    const existing = Array.from(this.accounts.values()).find((item) => item.phoneE164 === phoneE164 && item.id !== userId);
    if (existing) throw new AccountConflictError("phone", "该手机号已绑定其他账户");
    const account = this.accounts.get(userId);
    if (!account || account.status !== "active") return null;
    account.phoneE164 = phoneE164;
    account.phoneVerifiedAt = new Date().toISOString();
    account.updatedAt = new Date().toISOString();
    return this.findAccountById(userId);
  }

  public async setPasswordHash(userId: string, passwordHash: string): Promise<PlatformAccount | null> {
    const account = this.accounts.get(userId);
    if (!account || account.status !== "active") return null;
    account.passwordHash = passwordHash;
    account.lockedUntil = null;
    account.updatedAt = new Date().toISOString();
    return this.findAccountById(userId);
  }

  public async findAccountById(userId: string): Promise<PlatformAccount | null> {
    const account = this.accounts.get(userId);
    if (!account) return null;
    const { passwordHash: _passwordHash, lockedUntil: _lockedUntil, ...safeAccount } = account;
    return structuredClone(safeAccount);
  }

  public async findOrCreateOAuthAccount(input: OAuthIdentityInput): Promise<PlatformAccount> {
    const identityKey = `${input.provider}:${input.providerAccountId}`;
    const linkedUserId = this.identities.get(identityKey);
    if (linkedUserId) return (await this.findAccountById(linkedUserId))!;

    const existing = Array.from(this.accounts.values()).find((item) => item.email.toLowerCase() === input.email.toLowerCase());
    if (existing) {
      this.identities.set(identityKey, existing.id);
      return (await this.findAccountById(existing.id))!;
    }

    let username = input.usernameHint.toLowerCase();
    if (Array.from(this.accounts.values()).some((item) => item.username.toLowerCase() === username)) username = `${username}-${input.providerAccountId.slice(-6).toLowerCase()}`;
    const now = new Date().toISOString();
    const account: PasswordAccount = {
      id: randomUUID(), email: input.email.toLowerCase(), username, displayName: input.displayName?.trim() || username,
      avatarAssetId: null, role: "user", status: "active", emailVerifiedAt: now, createdAt: now, updatedAt: now,
      passwordHash: "", lockedUntil: null,
    };
    this.accounts.set(account.id, account);
    this.identities.set(identityKey, account.id);
    return (await this.findAccountById(account.id))!;
  }

  public async getProjectAccess(projectId: string, userId: string | null): Promise<KnowledgeProjectAccess | null> {
    const project = this.projects.get(projectId);
    if (!project) return null;
    if (!userId || (project.ownerUserId !== userId && project.memberRole === null)) return structuredClone({ ...project, memberRole: null });
    return structuredClone(project);
  }

  public async getBranchAccess(projectId: string, branchId: string): Promise<KnowledgeBranchAccess | null> {
    const branch = this.branches.get(`${projectId}:${branchId}`);
    return branch ? structuredClone(branch) : null;
  }

  public async getNodeState(projectId: string, branchId: string, nodeId: string): Promise<KnowledgeNodeState | null> {
    const state = this.nodeStates.get(`${projectId}:${branchId}:${nodeId}`);
    return state ? structuredClone(state) : null;
  }

  public async listPublicProjects(input: PublicProjectListInput): Promise<PublicProjectRecord[]> {
    const query = input.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
    const filtered = Array.from(this.publicProjects.values()).filter((project) => {
      if (project.visibility !== "public" || project.status !== "published") return false;
      return !query || [project.title, project.summary, project.slug, project.owner.username].some((field) => field.toLocaleLowerCase("zh-CN").includes(query));
    });
    const sorted = [...filtered].sort((left, right) => input.sort === "read" ? right.uniqueReaders - left.uniqueReaders : Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const offset = Math.max(0, input.offset ?? 0);
    return structuredClone(sorted.slice(offset, offset + Math.min(100, Math.max(1, input.limit ?? 50))));
  }

  /**
   * 内存搜索只用于本地契约/无数据库首页；范围与 PostgreSQL 保持一致，只遍历已发布公开项目、作者和公开章节。
   * 返回短摘要而不是整份正文，避免客户端把搜索接口误当作详情读取接口。
   */
  public async searchPublicContent(query: string, limit: number): Promise<PublicSearchResult[]> {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return [];
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
    const results: PublicSearchResult[] = [];
    const projects = Array.from(this.publicProjects.values()).filter((project) => project.visibility === "public" && project.status === "published");
    const includes = (value: string): boolean => value.toLocaleLowerCase("zh-CN").includes(normalized);
    const authors = new Set<string>();
    for (const project of projects) {
      if (includes(`${project.title} ${project.summary} ${project.slug} ${(project.tags ?? []).join(" ")}`)) {
        results.push({ kind: "project", id: project.id, title: project.title, description: project.summary, projectId: project.id, projectSlug: project.slug, projectTitle: project.title, authorUsername: project.owner.username, authorDisplayName: project.owner.displayName, score: 1 });
      }
      const authorKey = project.owner.id;
      if (!authors.has(authorKey) && includes(`${project.owner.username} ${project.owner.displayName}`)) {
        authors.add(authorKey);
        results.push({ kind: "author", id: authorKey, title: project.owner.displayName, description: `@${project.owner.username}`, projectId: null, projectSlug: null, projectTitle: null, authorUsername: project.owner.username, authorDisplayName: project.owner.displayName, score: 1 });
      }
      for (const section of project.sections ?? []) {
        if (!includes(`${section.heading} ${section.content}`)) continue;
        results.push({ kind: "document", id: section.id, title: section.heading, description: section.content.slice(0, 240), projectId: project.id, projectSlug: project.slug, projectTitle: project.title, authorUsername: project.owner.username, authorDisplayName: project.owner.displayName, score: 1 });
      }
    }
    return structuredClone(results.slice(0, boundedLimit));
  }

  public async getPublicProject(projectIdOrSlug: string): Promise<PublicProjectRecord | null> {
    const project = Array.from(this.publicProjects.values()).find((item) => item.id === projectIdOrSlug || item.slug === projectIdOrSlug);
    return project && project.visibility === "public" && project.status === "published" ? structuredClone(project) : null;
  }

  /** 内存仓储只供契约测试使用，但仍复刻 PostgreSQL 的跨天/同日去重语义。 */
  public async recordPublicProjectView(input: RecordPublicProjectViewInput): Promise<PublicProjectViewResult | null> {
    const project = await this.getPublicProject(input.projectIdOrSlug);
    if (!project) return null;
    const viewedOn = input.viewedOn ?? new Date().toISOString().slice(0, 10);
    const readerKey = `${project.id}:${input.viewerKeyHash}`;
    const dailyKey = `${readerKey}:${viewedOn}`;
    const readers = this.projectReaders.get(project.id) ?? new Set<string>();
    readers.add(input.viewerKeyHash);
    this.projectReaders.set(project.id, readers);
    const recorded = !this.projectDailyViews.has(dailyKey);
    this.projectDailyViews.add(dailyKey);
    const next = { ...project, uniqueReaders: readers.size };
    this.publicProjects.set(project.id, structuredClone(next));
    return { projectId: project.id, recorded, uniqueReaders: readers.size };
  }

  /** 内存仓储复刻公开 Star 的唯一用户关系，供契约测试验证 UI/API 幂等语义。 */
  public async getPublicProjectStarState(projectIdOrSlug: string, userId: string | null): Promise<PublicProjectStarState | null> {
    const project = await this.getPublicProject(projectIdOrSlug);
    if (!project) return null;
    const stars = this.projectStars.get(project.id) ?? new Map<string, boolean>();
    return { projectId: project.id, starred: userId ? stars.get(userId) === true : false, starCount: Array.from(stars.values()).filter(Boolean).length };
  }

  public async setPublicProjectStar(input: SetPublicProjectStarInput): Promise<PublicProjectStarState | null> {
    const project = await this.getPublicProject(input.projectIdOrSlug);
    if (!project) return null;
    const stars = this.projectStars.get(project.id) ?? new Map<string, boolean>();
    stars.set(input.userId, input.starred);
    this.projectStars.set(project.id, stars);
    const starCount = Array.from(stars.values()).filter(Boolean).length;
    this.publicProjects.set(project.id, structuredClone({ ...project, starCount }));
    return { projectId: project.id, starred: input.starred, starCount };
  }

  /** 内存仓储不伪造活动事件；真实时间线仅由 PostgreSQL 触发器产生。 */
  public async listPublicProjectActivity(input: ListPublicProjectActivityInput): Promise<PublicProjectActivityEvent[] | null> {
    const project = await this.getPublicProject(input.projectIdOrSlug);
    return project ? [] : null;
  }

  /** 内存仓储复刻公开作者主页，供契约测试验证匿名读取边界。 */
  public async getPublicAuthor(input: PublicAuthorInput): Promise<PublicAuthorRecord | null> {
    const account = this.findAuthor(input.username);
    if (!account || account.status !== "active") return null;
    const projects = Array.from(this.publicProjects.values()).filter((project) => project.owner.id === account.id && project.visibility === "public" && project.status === "published");
    const followerCount = this.activeFollowerCount(account.id);
    const followingCount = this.activeFollowingCount(account.id);
    const followedByCurrentUser = input.followerUserId ? this.authorFollows.get(input.followerUserId)?.get(account.id) === true : false;
    return {
      id: account.id, username: account.username, displayName: account.displayName, bio: "", avatarAssetId: account.avatarAssetId,
      createdAt: account.createdAt, projectCount: projects.length, followerCount, followingCount, followedByCurrentUser,
      projects: structuredClone(projects.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))),
    };
  }

  /** 内存仓储复刻匿名可读、登录可识别的关注状态。 */
  public async getAuthorFollowState(input: PublicAuthorInput): Promise<AuthorFollowState | null> {
    const account = this.findAuthor(input.username);
    if (!account || account.status !== "active") return null;
    return {
      authorUserId: account.id, username: account.username,
      following: input.followerUserId ? this.authorFollows.get(input.followerUserId)?.get(account.id) === true : false,
      followerCount: this.activeFollowerCount(account.id),
    };
  }

  /** 内存仓储只用于测试，但保持数据库唯一关系、自关注拒绝和幂等语义。 */
  public async setAuthorFollow(input: SetAuthorFollowInput): Promise<AuthorFollowState | null> {
    const account = this.findAuthor(input.username);
    if (!account || account.status !== "active") return null;
    if (account.id === input.followerUserId) throw new ValidationError("不能关注自己");
    const follower = await this.findAccountById(input.followerUserId);
    if (!follower || follower.status !== "active") throw new ValidationError("用户身份无效");
    const follows = this.authorFollows.get(input.followerUserId) ?? new Map<string, boolean>();
    follows.set(account.id, input.following);
    this.authorFollows.set(input.followerUserId, follows);
    return { authorUserId: account.id, username: account.username, following: input.following, followerCount: this.activeFollowerCount(account.id) };
  }

  private findAuthor(username: string): PlatformAccount | null {
    const normalized = username.trim().toLowerCase();
    const account = Array.from(this.accounts.values()).find((item) => item.username.toLowerCase() === normalized);
    if (account) return account;
    const projectOwner = Array.from(this.publicProjects.values()).find((project) => project.owner.username.toLowerCase() === normalized)?.owner;
    return projectOwner ? {
      id: projectOwner.id, email: "", username: projectOwner.username, displayName: projectOwner.displayName, avatarAssetId: projectOwner.avatarAssetId,
      role: "user", status: "active", emailVerifiedAt: null, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    } : null;
  }

  private activeFollowerCount(authorId: string): number {
    return Array.from(this.authorFollows.entries()).filter(([followerId, follows]) => this.accounts.get(followerId)?.status === "active" && follows.get(authorId) === true).length;
  }

  private activeFollowingCount(followerId: string): number {
    return Array.from(this.authorFollows.get(followerId)?.entries() ?? []).filter(([authorId, active]) => active && this.accounts.get(authorId)?.status === "active").length;
  }

  public async createPrivateProject(input: CreatePrivateProjectRecordInput): Promise<PublicProjectRecord> {
    const account = await this.findAccountById(input.ownerUserId);
    if (!account) throw new Error("项目所有者不存在");
    const record: PublicProjectRecord = {
      id: input.id, slug: input.slug, title: input.title, summary: input.summary, visibility: "private", status: "draft",
      owner: { id: account.id, username: account.username, displayName: account.displayName, avatarAssetId: account.avatarAssetId },
      publishedAt: null, updatedAt: input.createdAt, uniqueReaders: 0, starCount: 0, contributorCount: 1, sourceCount: 0,
      openMergeRequests: 0, version: 1, license: input.license, files: [], sections: [],
    };
    this.publicProjects.set(record.id, structuredClone(record));
    this.projects.set(record.id, { id: record.id, ownerUserId: account.id, visibility: "private", status: "draft", memberRole: "owner" });
    return structuredClone(record);
  }

  /** 仅供权限契约测试准备项目访问事实，不属于生产 API。 */
  public seedProject(project: KnowledgeProjectAccess): void {
    this.projects.set(project.id, structuredClone(project));
  }

  /** 仅供权限契约准备分支；key 同时包含 project，防止同 ID 跨项目命中。 */
  public seedBranch(branch: KnowledgeBranchAccess): void {
    this.branches.set(`${branch.projectId}:${branch.id}`, structuredClone(branch));
  }

  /** 仅供读取契约准备分支状态；同一 node 可在不同分支拥有不同树位置与名称。 */
  public seedNodeState(state: KnowledgeNodeState): void {
    this.nodeStates.set(`${state.projectId}:${state.branchId}:${state.nodeId}`, structuredClone(state));
  }

  /** 仅供公开项目契约测试准备 typed project；生产 API 不暴露该写入口。 */
  public seedPublicProject(project: PublicProjectRecord): void {
    this.publicProjects.set(project.id, structuredClone(project));
  }
}
