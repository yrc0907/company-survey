import type {
  KnowledgeBranchAccess,
  KnowledgeNodeState,
  KnowledgeProjectAccess,
  OAuthIdentityInput,
  PasswordAccount,
  PlatformAccount,
  PublicAuthorRecord,
  AuthorFollowState,
  IdentityAuditRecord,
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
  /** 当前公开版本被真实登录用户收藏的数量；匿名用户不能写入 Star。 */
  starCount: number;
  /** 当前公开项目未软删除的项目级评论数量；Seed 未接入真实评论时保持 undefined。 */
  commentCount?: number;
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

/** 全站公开搜索结果；正文只返回短摘要，详情仍需通过项目权限接口读取。 */
export interface PublicSearchResult {
  kind: "project" | "author" | "document";
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  projectSlug: string | null;
  projectTitle: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  score: number;
}

/** 公开阅读上报输入；哈希由服务层生成，Repository 不接触原始 Cookie/设备标识。 */
export interface RecordPublicProjectViewInput {
  projectIdOrSlug: string;
  viewerKeyHash: string;
  viewerUserId: string | null;
  viewedOn?: string;
}

/** 阅读事实写入结果；recorded=false 表示同一读者当天重复打开，没有增加去重人数。 */
export interface PublicProjectViewResult {
  projectId: string;
  recorded: boolean;
  uniqueReaders: number;
}

export interface PublicProjectStarState {
  projectId: string;
  starred: boolean;
  starCount: number;
}

/** 公开项目活动；来源是 PostgreSQL append-only activity_event，不携带私密正文。 */
export interface PublicProjectActivityEvent {
  id: string;
  eventType: "project_created" | "commit_created" | "merge_request_opened" | "merge_request_merged" | "review_submitted" | "comment_created" | "project_starred" | "project_unstarred";
  targetType: "project" | "commit" | "merge_request" | "review" | "comment" | "star";
  targetId: string;
  actor: PublicProjectOwnerRecord;
  project: { id: string; slug: string; title: string };
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface ListPublicProjectActivityInput {
  projectIdOrSlug: string;
  limit: number;
  before?: string;
}

export interface SetPublicProjectStarInput {
  projectIdOrSlug: string;
  userId: string;
  starred: boolean;
}

/** 作者主页读取参数；匿名请求不携带 follower 身份。 */
export interface PublicAuthorInput {
  username: string;
  followerUserId: string | null;
}

/** 关注切换参数；follower 身份必须来自已验证 Session。 */
export interface SetAuthorFollowInput {
  username: string;
  followerUserId: string;
  following: boolean;
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

export interface RecordIdentityAuditInput {
  id: string;
  userId: string;
  actorUserId: string | null;
  channel: "email" | "sms";
  action: "verify" | "bind" | "change";
  outcome: "success" | "conflict" | "rejected";
  previousDestinationHash: string | null;
  destinationHash: string;
  previousMaskedDestination: string | null;
  maskedDestination: string;
  challengeId: string | null;
  reasonCode: string | null;
}

/**
 * 开放平台数据访问边界。
 * 输入均为服务层规范化后的值，输出不泄漏任意 SQL；写入由实现保证事务性。
 */
export interface PlatformRepository {
  createPasswordAccount(record: CreatePasswordAccountRecord): Promise<PlatformAccount>;
  findPasswordAccountByIdentifier(identifier: string): Promise<PasswordAccount | null>;
  findAccountByEmail(email: string): Promise<PlatformAccount | null>;
  findAccountByPhone(phoneE164: string): Promise<PlatformAccount | null>;
  markEmailVerified(userId: string): Promise<PlatformAccount | null>;
  bindVerifiedPhone(userId: string, phoneE164: string): Promise<PlatformAccount | null>;
  changeVerifiedEmail(userId: string, email: string): Promise<PlatformAccount | null>;
  recordIdentityAudit(input: RecordIdentityAuditInput): Promise<IdentityAuditRecord>;
  listIdentityAudit(userId: string, limit?: number): Promise<IdentityAuditRecord[]>;
  setPasswordHash(userId: string, passwordHash: string): Promise<PlatformAccount | null>;
  findAccountById(userId: string): Promise<PlatformAccount | null>;
  findOrCreateOAuthAccount(input: OAuthIdentityInput): Promise<PlatformAccount>;
  getProjectAccess(projectId: string, userId: string | null): Promise<KnowledgeProjectAccess | null>;
  getBranchAccess(projectId: string, branchId: string): Promise<KnowledgeBranchAccess | null>;
  getNodeState(projectId: string, branchId: string, nodeId: string): Promise<KnowledgeNodeState | null>;
  listPublicProjects(input: PublicProjectListInput): Promise<PublicProjectRecord[]>;
  searchPublicContent(query: string, limit: number): Promise<PublicSearchResult[]>;
  getPublicProject(projectIdOrSlug: string): Promise<PublicProjectRecord | null>;
  recordPublicProjectView(input: RecordPublicProjectViewInput): Promise<PublicProjectViewResult | null>;
  getPublicProjectStarState(projectIdOrSlug: string, userId: string | null): Promise<PublicProjectStarState | null>;
  listPublicProjectActivity(input: ListPublicProjectActivityInput): Promise<PublicProjectActivityEvent[] | null>;
  setPublicProjectStar(input: SetPublicProjectStarInput): Promise<PublicProjectStarState | null>;
  getPublicAuthor(input: PublicAuthorInput): Promise<PublicAuthorRecord | null>;
  getAuthorFollowState(input: PublicAuthorInput): Promise<AuthorFollowState | null>;
  setAuthorFollow(input: SetAuthorFollowInput): Promise<AuthorFollowState | null>;
  createPrivateProject(input: CreatePrivateProjectRecordInput): Promise<PublicProjectRecord>;
}
