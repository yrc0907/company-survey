import { randomUUID } from "node:crypto";

import { AccountConflictError } from "@/lib/domain/platform/errors";
import type { KnowledgeBranchAccess, KnowledgeNodeState, KnowledgeProjectAccess, OAuthIdentityInput, PasswordAccount, PlatformAccount } from "@/lib/domain/platform";
import type { CreatePasswordAccountRecord, PlatformRepository } from "@/lib/repositories/platform/platform-repository";

/** 契约测试使用的内存仓储；复制所有返回值，避免测试误改内部事实。 */
export class MemoryPlatformRepository implements PlatformRepository {
  private readonly accounts = new Map<string, PasswordAccount>();
  private readonly identities = new Map<string, string>();
  private readonly projects = new Map<string, KnowledgeProjectAccess>();
  private readonly branches = new Map<string, KnowledgeBranchAccess>();
  private readonly nodeStates = new Map<string, KnowledgeNodeState>();

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
}
