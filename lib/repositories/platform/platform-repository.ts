import type {
  KnowledgeBranchAccess,
  KnowledgeNodeState,
  KnowledgeProjectAccess,
  OAuthIdentityInput,
  PasswordAccount,
  PlatformAccount,
} from "@/lib/domain/platform";

/** 公开项目所有者的最小资料；不包含邮箱、权限或任何私有字段。 */
export interface PublicProjectOwnerRecord {
  id: string;
  username: string;
  displayName: string;
  avatarAssetId: string | null;
}

/** 公开文件树节点；内容仍由项目详情按需返回，列表不会携带正文。 */
export interface PublicProjectFileRecord {
  id: string;
  name: string;
  kind: "folder" | "document" | "markdown" | "source" | "data";
  parentId: string | null;
  position: number;
}

/** 公开项目摘要与统计投影，所有计数均由数据库或 typed seed adapter 提供。 */
export interface PublicProjectRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  visibility: "private" | "public" | "unlisted";
  status: "draft" | "published" | "archived" | "suspended";
  owner: PublicProjectOwnerRecord;
  publishedAt: string | null;
  updatedAt: string;
  uniqueReaders: number;
  contributorCount: number;
  sourceCount: number;
  openMergeRequests: number;
  version: number;
  license: string;
  /** 首发 seed 可提供分类与核验标签；数据库没有这些字段时由服务端安全默认。 */
  category?: "企业" | "政策" | "行业" | "技术";
  tags?: string[];
  verification?: "verified" | "needs_verification";
  verificationNote?: string;
  assistantReportId?: string;
  files?: PublicProjectFileRecord[];
  sections?: Array<{
    id: string;
    nodeId: string;
    heading: string;
    content: string;
    evidenceState: "fact" | "inference" | "needs_verification" | "conflict";
    updatedAt: string;
  }>;
}

export interface PublicProjectListInput {
  query?: string;
  sort?: "recommended" | "latest" | "read";
  limit?: number;
  offset?: number;
}

export interface CreatePrivateProjectRecordInput {
  id: string;
  ownerUserId: string;
  slug: string;
  title: string;
  summary: string;
  license: string;
  createdAt: string;
}

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
  listPublicProjects(input: PublicProjectListInput): Promise<PublicProjectRecord[]>;
  getPublicProject(projectIdOrSlug: string): Promise<PublicProjectRecord | null>;
  createPrivateProject(input: CreatePrivateProjectRecordInput): Promise<PublicProjectRecord>;
}
