import type {
  KnowledgeBranchAccess,
  KnowledgeNodeState,
  KnowledgeProjectAccess,
  OAuthIdentityInput,
  PasswordAccount,
  PlatformAccount,
} from "@/lib/domain/platform";

/** 创建密码账户时由服务层生成的完整原子写入参数。 */
export interface CreatePasswordAccountRecord {
  account: PlatformAccount;
  passwordHash: string;
}

/**
 * 开放平台数据访问边界。
 * 输入均为服务层规范化后的值，输出不泄漏任意 SQL；写入由实现保证事务性。
 */
export interface PlatformRepository {
  createPasswordAccount(record: CreatePasswordAccountRecord): Promise<PlatformAccount>;
  findPasswordAccountByIdentifier(identifier: string): Promise<PasswordAccount | null>;
  findAccountById(userId: string): Promise<PlatformAccount | null>;
  findOrCreateOAuthAccount(input: OAuthIdentityInput): Promise<PlatformAccount>;
  getProjectAccess(projectId: string, userId: string | null): Promise<KnowledgeProjectAccess | null>;
  getBranchAccess(projectId: string, branchId: string): Promise<KnowledgeBranchAccess | null>;
  getNodeState(projectId: string, branchId: string, nodeId: string): Promise<KnowledgeNodeState | null>;
}
