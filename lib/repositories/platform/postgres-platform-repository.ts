import postgres, { type Sql, type TransactionSql } from "postgres";

import { AccountConflictError } from "@/lib/domain/platform/errors";
import { ValidationError } from "@/lib/domain/errors";
import type { AuthorFollowState, KnowledgeBranchAccess, KnowledgeNodeState, KnowledgeProjectAccess, OAuthIdentityInput, PasswordAccount, PlatformAccount, PlatformRole, PublicAuthorRecord } from "@/lib/domain/platform";
import type { CreatePasswordAccountRecord, CreatePrivateProjectRecordInput, PlatformRepository, PublicAuthorInput, PublicProjectFileRecord, PublicProjectListInput, PublicProjectRecord, PublicProjectStarState, PublicProjectViewResult, RecordPublicProjectViewInput, SetAuthorFollowInput, SetPublicProjectStarInput } from "@/lib/repositories/platform/platform-repository";

type DatabaseRow = Record<string, unknown>;
type Queryable = Sql | TransactionSql;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** 数据库行只在 Repository 内映射，API 永远看不到密码字段。 */
function mapAccount(row: DatabaseRow): PlatformAccount {
  return {
    id: String(row.id), email: String(row.email), username: String(row.username), displayName: String(row.display_name),
    avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null, role: row.global_role as PlatformRole,
    status: row.status as PlatformAccount["status"], emailVerifiedAt: row.email_verified_at ? iso(row.email_verified_at) : null,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

const ACCOUNT_SELECT = `
  SELECT u.id, u.email, u.global_role, u.status, u.email_verified_at, u.created_at, u.updated_at,
         p.username, p.display_name, p.avatar_asset_id
  FROM platform_user u JOIN platform_profile p ON p.user_id = u.id`;

function isUniqueViolation(error: unknown): error is { code: string; constraint_name?: string } {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";
}

function projectStatus(value: unknown): PublicProjectRecord["status"] {
  return value as PublicProjectRecord["status"];
}

function projectVisibility(value: unknown): PublicProjectRecord["visibility"] {
  return value as PublicProjectRecord["visibility"];
}

/** 将公开项目 SQL 投影映射为 API 可返回的最小资料；永远不带邮箱或草稿正文。 */
function mapPublicProject(row: DatabaseRow): PublicProjectRecord {
  return {
    id: String(row.id), slug: String(row.slug), title: String(row.title), summary: String(row.summary ?? ""),
    visibility: projectVisibility(row.visibility), status: projectStatus(row.status),
    owner: { id: String(row.owner_id), username: String(row.owner_username), displayName: String(row.owner_display_name), avatarAssetId: row.owner_avatar ? String(row.owner_avatar) : null },
    publishedAt: row.published_at ? iso(row.published_at) : null, updatedAt: iso(row.updated_at),
    uniqueReaders: Number(row.unique_readers ?? 0), starCount: Number(row.star_count ?? 0), contributorCount: Number(row.contributor_count ?? 0),
    sourceCount: Number(row.source_count ?? 0), openMergeRequests: Number(row.open_merge_requests ?? 0),
    version: Math.max(1, Number(row.version ?? 1)), license: String(row.license ?? "all-rights-reserved"),
    category: row.category === "企业" || row.category === "政策" || row.category === "行业" || row.category === "技术" ? row.category : "行业",
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    verification: row.verification === "verified" ? "verified" : "needs_verification",
    verificationNote: "数据库项目的核验状态由维护者在公开版本中维护。",
  };
}

const PUBLIC_PROJECT_SELECT = `
  SELECT p.id, p.slug, p.title, p.summary, p.visibility, p.status, p.license,
         p.published_at, p.updated_at,
         u.id AS owner_id, pr.username AS owner_username, pr.display_name AS owner_display_name,
         pr.avatar_asset_id AS owner_avatar,
         COALESCE((SELECT ps.unique_readers FROM project_stats ps WHERE ps.project_id = p.id), 0)::bigint AS unique_readers,
         (SELECT COUNT(*) FROM project_star ps WHERE ps.project_id = p.id AND ps.active = TRUE)::bigint AS star_count,
         (1::bigint + (SELECT COUNT(DISTINCT ca.contributor_user_id) FROM content_attribution ca
            WHERE ca.project_id = p.id AND ca.active = TRUE AND ca.contributor_user_id <> p.owner_user_id)) AS contributor_count,
         (SELECT COUNT(*) FROM knowledge_node source_node
            WHERE source_node.project_id = p.id AND source_node.kind = 'source') AS source_count,
         (SELECT COUNT(*) FROM merge_request mr
            WHERE mr.project_id = p.id AND mr.status IN ('open', 'changes_requested', 'approved')) AS open_merge_requests,
         (SELECT COUNT(*) FROM knowledge_commit kc
            WHERE kc.project_id = p.id AND kc.branch_id = main_branch.id) AS version
    FROM knowledge_project p
    JOIN platform_user u ON u.id = p.owner_user_id
    JOIN platform_profile pr ON pr.user_id = u.id
    LEFT JOIN knowledge_branch main_branch ON main_branch.project_id = p.id AND main_branch.name = p.default_branch_name`;

/** PostgreSQL 实现只使用固定 SQL，并通过事务保证账户与身份不会半写入。 */
export class PostgresPlatformRepository implements PlatformRepository {
  public constructor(private readonly sql: Sql) {}

  public static fromConnectionString(connectionString: string): PostgresPlatformRepository {
    return new PostgresPlatformRepository(postgres(connectionString, { max: 3, idle_timeout: 20 }));
  }

  public async createPasswordAccount(record: CreatePasswordAccountRecord): Promise<PlatformAccount> {
    try {
      await this.sql.begin(async (tx) => {
        const account = record.account;
        await tx`INSERT INTO platform_user (id, email, global_role, status, email_verified_at, created_at, updated_at)
          VALUES (${account.id}, ${account.email}, ${account.role}, ${account.status}, ${account.emailVerifiedAt}, ${account.createdAt}, ${account.updatedAt})`;
        await tx`INSERT INTO platform_profile (user_id, username, display_name, avatar_asset_id, created_at, updated_at)
          VALUES (${account.id}, ${account.username}, ${account.displayName}, ${account.avatarAssetId}, ${account.createdAt}, ${account.updatedAt})`;
        await tx`INSERT INTO platform_password_credential (user_id, password_hash, password_changed_at)
          VALUES (${account.id}, ${record.passwordHash}, ${account.createdAt})`;
      });
      return record.account;
    } catch (error) {
      if (isUniqueViolation(error)) {
        const constraint = error.constraint_name ?? "";
        if (constraint.includes("username")) throw new AccountConflictError("username", "该用户名已被使用");
        throw new AccountConflictError("email", "该邮箱已注册");
      }
      throw error;
    }
  }

  public async findPasswordAccountByIdentifier(identifier: string): Promise<PasswordAccount | null> {
    const rows = await this.sql.unsafe<DatabaseRow[]>(`${ACCOUNT_SELECT.replace("FROM platform_user", ", c.password_hash, c.locked_until FROM platform_user")}
      JOIN platform_password_credential c ON c.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1) OR LOWER(p.username) = LOWER($1)
      LIMIT 1`, [identifier]);
    const row = rows[0];
    return row ? { ...mapAccount(row), passwordHash: String(row.password_hash), lockedUntil: row.locked_until ? iso(row.locked_until) : null } : null;
  }

  public async findAccountById(userId: string): Promise<PlatformAccount | null> {
    const rows = await this.sql.unsafe<DatabaseRow[]>(`${ACCOUNT_SELECT} WHERE u.id = $1 LIMIT 1`, [userId]);
    return rows[0] ? mapAccount(rows[0]) : null;
  }

  public async findOrCreateOAuthAccount(input: OAuthIdentityInput): Promise<PlatformAccount> {
    return this.sql.begin(async (tx) => {
      const linked = await tx<DatabaseRow[]>`${tx.unsafe(ACCOUNT_SELECT)}
        JOIN platform_auth_identity i ON i.user_id = u.id
        WHERE i.provider = ${input.provider} AND i.provider_account_id = ${input.providerAccountId} LIMIT 1`;
      if (linked[0]) return mapAccount(linked[0]);

      const byEmail = await tx<DatabaseRow[]>`${tx.unsafe(ACCOUNT_SELECT)} WHERE LOWER(u.email) = LOWER(${input.email}) LIMIT 1`;
      let account = byEmail[0] ? mapAccount(byEmail[0]) : null;
      if (!account) account = await this.createOAuthUser(tx, input);

      try {
        await tx`INSERT INTO platform_auth_identity (id, user_id, provider, provider_account_id)
          VALUES (${crypto.randomUUID()}, ${account.id}, ${input.provider}, ${input.providerAccountId})`;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const winner = await tx<DatabaseRow[]>`${tx.unsafe(ACCOUNT_SELECT)}
          JOIN platform_auth_identity i ON i.user_id = u.id
          WHERE i.provider = ${input.provider} AND i.provider_account_id = ${input.providerAccountId} LIMIT 1`;
        if (!winner[0]) throw new AccountConflictError("identity", "OAuth 身份绑定冲突");
        account = mapAccount(winner[0]);
      }
      return account;
    });
  }

  private async createOAuthUser(tx: TransactionSql, input: OAuthIdentityInput): Promise<PlatformAccount> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const base = input.usernameHint.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "user";
    const candidate = (await tx<{ username: string }[]>`SELECT username FROM platform_profile WHERE LOWER(username) = LOWER(${base}) LIMIT 1`).length
      ? `${base}-${input.providerAccountId.slice(-6).toLowerCase()}` : base;
    await tx`INSERT INTO platform_user (id, email, global_role, status, email_verified_at, created_at, updated_at)
      VALUES (${id}, ${input.email.toLowerCase()}, 'user', 'active', ${now}, ${now}, ${now})`;
    await tx`INSERT INTO platform_profile (user_id, username, display_name, created_at, updated_at)
      VALUES (${id}, ${candidate}, ${input.displayName?.trim() || candidate}, ${now}, ${now})`;
    const rows = await tx<DatabaseRow[]>`${tx.unsafe(ACCOUNT_SELECT)} WHERE u.id = ${id} LIMIT 1`;
    return mapAccount(rows[0]!);
  }

  public async getProjectAccess(projectId: string, userId: string | null): Promise<KnowledgeProjectAccess | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT p.id, p.owner_user_id, p.visibility, p.status, m.role AS member_role
      FROM knowledge_project p
      LEFT JOIN project_member m ON m.project_id = p.id AND m.user_id = ${userId}
      WHERE p.id = ${projectId} LIMIT 1`;
    const row = rows[0];
    return row ? {
      id: String(row.id), ownerUserId: String(row.owner_user_id), visibility: row.visibility as KnowledgeProjectAccess["visibility"],
      status: row.status as KnowledgeProjectAccess["status"], memberRole: row.member_role ? row.member_role as KnowledgeProjectAccess["memberRole"] : null,
    } : null;
  }

  /** 分支查询同时限定 project_id，避免攻击者用其他项目的 branch id 穿透作用域。 */
  public async getBranchAccess(projectId: string, branchId: string): Promise<KnowledgeBranchAccess | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT id, project_id, owner_user_id, is_protected, status
      FROM knowledge_branch WHERE project_id = ${projectId} AND id = ${branchId} LIMIT 1`;
    const row = rows[0];
    return row ? {
      id: String(row.id), projectId: String(row.project_id), ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      isProtected: Boolean(row.is_protected), status: row.status as KnowledgeBranchAccess["status"],
    } : null;
  }

  /** 文件树读取必须同时命中 project、branch、node，绝不回退到其他分支状态。 */
  public async getNodeState(projectId: string, branchId: string, nodeId: string): Promise<KnowledgeNodeState | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at
      FROM knowledge_node_state
      WHERE project_id = ${projectId} AND branch_id = ${branchId} AND node_id = ${nodeId}
      LIMIT 1`;
    const row = rows[0];
    return row ? {
      projectId: String(row.project_id), branchId: String(row.branch_id), nodeId: String(row.node_id),
      parentNodeId: row.parent_node_id ? String(row.parent_node_id) : null, name: String(row.name), position: Number(row.position),
      deletedAt: row.deleted_at ? iso(row.deleted_at) : null, updatedAt: iso(row.updated_at),
    } : null;
  }

  /** 公开首页只查询 published/public 项目；搜索字段固定，避免将私有草稿暴露给匿名用户。 */
  public async listPublicProjects(input: PublicProjectListInput): Promise<PublicProjectRecord[]> {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const query = input.query?.trim() ?? "";
    const order = input.sort === "read" ? "unique_readers DESC, p.updated_at DESC" : input.sort === "recommended" ? "p.published_at DESC NULLS LAST, p.updated_at DESC" : "p.updated_at DESC";
    const rows = await this.sql.unsafe<DatabaseRow[]>(`${PUBLIC_PROJECT_SELECT}
      WHERE p.visibility = 'public' AND p.status = 'published'
        AND ($1 = '' OR p.title ILIKE '%' || $1 || '%' OR p.summary ILIKE '%' || $1 || '%' OR p.slug ILIKE '%' || $1 || '%' OR pr.username ILIKE '%' || $1 || '%')
      ORDER BY ${order} LIMIT $2 OFFSET $3`, [query, limit, offset]);
    return rows.map(mapPublicProject);
  }

  /** 公开详情同时返回 main 分支的非删除文件树和最新文档正文片段。 */
  public async getPublicProject(projectIdOrSlug: string): Promise<PublicProjectRecord | null> {
    const rows = await this.sql.unsafe<DatabaseRow[]>(`${PUBLIC_PROJECT_SELECT}
      WHERE p.visibility = 'public' AND p.status = 'published' AND (p.id = $1 OR p.slug = $1) LIMIT 1`, [projectIdOrSlug]);
    if (!rows[0]) return null;
    const project = mapPublicProject(rows[0]);
    const branchRows = await this.sql.unsafe<DatabaseRow[]>(`SELECT id FROM knowledge_branch WHERE project_id = $1 AND name = (SELECT default_branch_name FROM knowledge_project WHERE id = $1) LIMIT 1`, [project.id]);
    const branchId = branchRows[0] ? String(branchRows[0].id) : null;
    if (!branchId) return { ...project, files: [], sections: [] };

    const files = await this.sql.unsafe<DatabaseRow[]>(`SELECT ns.node_id, ns.name, n.kind, ns.parent_node_id, ns.position
      FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id AND n.project_id = ns.project_id
      WHERE ns.project_id = $1 AND ns.branch_id = $2 AND ns.deleted_at IS NULL ORDER BY ns.parent_node_id NULLS FIRST, ns.position, ns.name`, [project.id, branchId]);
    const revisions = await this.sql.unsafe<DatabaseRow[]>(`SELECT DISTINCT ON (ns.node_id) ns.node_id, ns.name, dr.content_text, dr.created_at
      FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id AND n.project_id = ns.project_id
      LEFT JOIN document_revision dr ON dr.project_id = ns.project_id AND dr.node_id = ns.node_id AND dr.branch_id = ns.branch_id
      WHERE ns.project_id = $1 AND ns.branch_id = $2 AND ns.deleted_at IS NULL AND n.kind IN ('document', 'markdown')
      ORDER BY ns.node_id, dr.created_at DESC NULLS LAST`, [project.id, branchId]);
    return {
      ...project,
      files: files.map((row) => ({ id: String(row.node_id), name: String(row.name), kind: row.kind as PublicProjectFileRecord["kind"], parentId: row.parent_node_id ? String(row.parent_node_id) : null, position: Number(row.position) })),
      sections: revisions.map((row) => ({ id: `section-${String(row.node_id)}`, nodeId: String(row.node_id), heading: String(row.name), content: String(row.content_text ?? ""), evidenceState: "needs_verification" as const, updatedAt: row.created_at ? iso(row.created_at) : project.updatedAt })),
    };
  }

  /**
   * 记录一次公开项目阅读并返回最新去重人数。
   * 同一项目、同一读者在同一自然日只插入一条 daily 事实；跨天仍由 project_reader
   * 保持全站唯一读者计数。事务内先写事实再更新聚合，避免并发请求重复增加统计。
   */
  public async recordPublicProjectView(input: RecordPublicProjectViewInput): Promise<PublicProjectViewResult | null> {
    const viewedOn = input.viewedOn ?? new Date().toISOString().slice(0, 10);
    return this.sql.begin(async (tx) => {
      const projectRows = await tx<DatabaseRow[]>`SELECT id FROM knowledge_project
        WHERE (id = ${input.projectIdOrSlug} OR slug = ${input.projectIdOrSlug})
          AND visibility = 'public' AND status = 'published' LIMIT 1`;
      const project = projectRows[0];
      if (!project) return null;
      const projectId = String(project.id);

      const newReader = await tx<DatabaseRow[]>`INSERT INTO project_reader
        (project_id, viewer_key_hash, viewer_user_id)
        VALUES (${projectId}, ${input.viewerKeyHash}, ${input.viewerUserId})
        ON CONFLICT (project_id, viewer_key_hash) DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted`;
      const insertedReader = Boolean(newReader[0]?.inserted);

      const dailyRows = await tx<DatabaseRow[]>`INSERT INTO project_view_daily
        (project_id, view_date, viewer_key_hash, viewer_user_id)
        VALUES (${projectId}, ${viewedOn}::date, ${input.viewerKeyHash}, ${input.viewerUserId})
        ON CONFLICT (project_id, view_date, viewer_key_hash)
        DO UPDATE SET last_seen_at = CURRENT_TIMESTAMP
        RETURNING (xmax = 0) AS inserted`;
      const recorded = Boolean(dailyRows[0]?.inserted);

      // 只有首次跨天读者才增加聚合数；同日重复访问和跨日回访都保持幂等。
      await tx`INSERT INTO project_stats (project_id, unique_readers, updated_at)
        VALUES (${projectId}, ${insertedReader ? 1 : 0}, CURRENT_TIMESTAMP)
        ON CONFLICT (project_id) DO UPDATE SET
          unique_readers = project_stats.unique_readers + ${insertedReader ? 1 : 0},
          updated_at = CURRENT_TIMESTAMP`;
      const stats = await tx<DatabaseRow[]>`SELECT unique_readers FROM project_stats WHERE project_id = ${projectId} LIMIT 1`;
      return { projectId, recorded, uniqueReaders: Number(stats[0]?.unique_readers ?? 0) };
    });
  }

  /** 读取公开项目 Star 状态；匿名读取只返回公开计数，不返回任何用户关系。 */
  public async getPublicProjectStarState(projectIdOrSlug: string, userId: string | null): Promise<PublicProjectStarState | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT p.id,
      (SELECT COUNT(*) FROM project_star ps WHERE ps.project_id = p.id AND ps.active = TRUE) AS star_count,
      ${userId}::text IS NOT NULL AND EXISTS (
        SELECT 1 FROM project_star mine WHERE mine.project_id = p.id AND mine.user_id = ${userId} AND mine.active = TRUE
      ) AS starred
      FROM knowledge_project p
      WHERE (p.id = ${projectIdOrSlug} OR p.slug = ${projectIdOrSlug})
        AND p.visibility = 'public' AND p.status = 'published' LIMIT 1`;
    const row = rows[0];
    return row ? { projectId: String(row.id), starred: Boolean(row.starred), starCount: Number(row.star_count ?? 0) } : null;
  }

  /** 登录用户才能切换 Star；事务内更新关系后读取计数，响应始终与数据库一致。 */
  public async setPublicProjectStar(input: SetPublicProjectStarInput): Promise<PublicProjectStarState | null> {
    return this.sql.begin(async (tx) => {
      const projects = await tx<DatabaseRow[]>`SELECT id FROM knowledge_project
        WHERE (id = ${input.projectIdOrSlug} OR slug = ${input.projectIdOrSlug})
          AND visibility = 'public' AND status = 'published' LIMIT 1`;
      const project = projects[0];
      if (!project) return null;
      const projectId = String(project.id);
      if (input.starred) {
        await tx`INSERT INTO project_star (project_id, user_id, active)
          VALUES (${projectId}, ${input.userId}, TRUE)
          ON CONFLICT (project_id, user_id) DO UPDATE SET active = TRUE, updated_at = CURRENT_TIMESTAMP`;
      } else {
        await tx`UPDATE project_star SET active = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE project_id = ${projectId} AND user_id = ${input.userId}`;
      }
      const rows = await tx<DatabaseRow[]>`SELECT
        (SELECT COUNT(*) FROM project_star ps WHERE ps.project_id = ${projectId} AND ps.active = TRUE) AS star_count,
        EXISTS (SELECT 1 FROM project_star mine WHERE mine.project_id = ${projectId} AND mine.user_id = ${input.userId} AND mine.active = TRUE) AS starred`;
      const row = rows[0];
      return { projectId, starred: Boolean(row?.starred), starCount: Number(row?.star_count ?? 0) };
    });
  }

  /** 读取作者主页；仅聚合 active/public 项目与关注关系，不返回邮箱或草稿。 */
  public async getPublicAuthor(input: PublicAuthorInput): Promise<PublicAuthorRecord | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT u.id, p.username, p.display_name, p.bio, p.avatar_asset_id,
        u.created_at,
        (SELECT COUNT(*) FROM knowledge_project kp WHERE kp.owner_user_id = u.id AND kp.visibility = 'public' AND kp.status = 'published') AS project_count,
        (SELECT COUNT(*) FROM author_follow af JOIN platform_user fu ON fu.id = af.follower_user_id AND fu.status = 'active'
          WHERE af.followed_user_id = u.id AND af.active = TRUE) AS follower_count,
        (SELECT COUNT(*) FROM author_follow af JOIN platform_user tu ON tu.id = af.followed_user_id AND tu.status = 'active'
          WHERE af.follower_user_id = u.id AND af.active = TRUE) AS following_count,
        (${input.followerUserId}::text IS NOT NULL AND EXISTS (
          SELECT 1 FROM author_follow mine WHERE mine.follower_user_id = ${input.followerUserId}
            AND mine.followed_user_id = u.id AND mine.active = TRUE
        )) AS followed_by_current_user
      FROM platform_user u JOIN platform_profile p ON p.user_id = u.id
      WHERE LOWER(p.username) = LOWER(${input.username}) AND u.status = 'active' LIMIT 1`;
    const row = rows[0];
    if (!row) return null;
    const projects = await this.sql.unsafe<DatabaseRow[]>(`${PUBLIC_PROJECT_SELECT}
      WHERE p.owner_user_id = $1 AND p.visibility = 'public' AND p.status = 'published'
      ORDER BY p.updated_at DESC LIMIT 100`, [String(row.id)]);
    return {
      id: String(row.id), username: String(row.username), displayName: String(row.display_name), bio: String(row.bio ?? ""),
      avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null, createdAt: iso(row.created_at),
      projectCount: Number(row.project_count ?? 0), followerCount: Number(row.follower_count ?? 0),
      followingCount: Number(row.following_count ?? 0), followedByCurrentUser: Boolean(row.followed_by_current_user),
      projects: projects.map(mapPublicProject),
    };
  }

  /** 读取关注按钮状态；匿名只能看到公开 follower 数量。 */
  public async getAuthorFollowState(input: PublicAuthorInput): Promise<AuthorFollowState | null> {
    const rows = await this.sql<DatabaseRow[]>`SELECT u.id, p.username,
        (SELECT COUNT(*) FROM author_follow af JOIN platform_user fu ON fu.id = af.follower_user_id AND fu.status = 'active'
          WHERE af.followed_user_id = u.id AND af.active = TRUE) AS follower_count,
        (${input.followerUserId}::text IS NOT NULL AND EXISTS (
          SELECT 1 FROM author_follow mine WHERE mine.follower_user_id = ${input.followerUserId}
            AND mine.followed_user_id = u.id AND mine.active = TRUE
        )) AS following
      FROM platform_user u JOIN platform_profile p ON p.user_id = u.id
      WHERE LOWER(p.username) = LOWER(${input.username}) AND u.status = 'active' LIMIT 1`;
    const row = rows[0];
    return row ? { authorUserId: String(row.id), username: String(row.username), following: Boolean(row.following), followerCount: Number(row.follower_count ?? 0) } : null;
  }

  /** 事务内幂等切换关注关系，并以数据库聚合结果返回最新计数。 */
  public async setAuthorFollow(input: SetAuthorFollowInput): Promise<AuthorFollowState | null> {
    return this.sql.begin(async (tx) => {
      const authorRows = await tx<DatabaseRow[]>`SELECT u.id, p.username FROM platform_user u JOIN platform_profile p ON p.user_id = u.id
        WHERE LOWER(p.username) = LOWER(${input.username}) AND u.status = 'active' LIMIT 1`;
      const author = authorRows[0];
      if (!author) return null;
      const authorId = String(author.id);
      if (authorId === input.followerUserId) throw new ValidationError("不能关注自己");
      const followerRows = await tx<DatabaseRow[]>`SELECT id FROM platform_user WHERE id = ${input.followerUserId} AND status = 'active' LIMIT 1`;
      if (!followerRows[0]) throw new ValidationError("用户身份无效");
      if (input.following) {
        await tx`INSERT INTO author_follow (follower_user_id, followed_user_id, active)
          VALUES (${input.followerUserId}, ${authorId}, TRUE)
          ON CONFLICT (follower_user_id, followed_user_id)
          DO UPDATE SET active = TRUE, updated_at = CURRENT_TIMESTAMP`;
      } else {
        await tx`UPDATE author_follow SET active = FALSE, updated_at = CURRENT_TIMESTAMP
          WHERE follower_user_id = ${input.followerUserId} AND followed_user_id = ${authorId}`;
      }
      const countRows = await tx<DatabaseRow[]>`SELECT COUNT(*) AS follower_count FROM author_follow af
        JOIN platform_user fu ON fu.id = af.follower_user_id AND fu.status = 'active'
        WHERE af.followed_user_id = ${authorId} AND af.active = TRUE`;
      return { authorUserId: authorId, username: String(author.username), following: input.following, followerCount: Number(countRows[0]?.follower_count ?? 0) };
    });
  }

  /** 创建空白私有项目与 owner/main 分支同事务写入；不接受客户端 userId。 */
  public async createPrivateProject(input: CreatePrivateProjectRecordInput): Promise<PublicProjectRecord> {
    try {
      return await this.sql.begin(async (tx) => {
        await tx`INSERT INTO knowledge_project (id, owner_user_id, slug, title, summary, visibility, status, license, published_at, created_at, updated_at)
          VALUES (${input.id}, ${input.ownerUserId}, ${input.slug}, ${input.title}, ${input.summary}, 'private', 'draft', ${input.license}, NULL, ${input.createdAt}, ${input.createdAt})`;
        await tx`INSERT INTO project_member (project_id, user_id, role, created_at) VALUES (${input.id}, ${input.ownerUserId}, 'owner', ${input.createdAt})`;
        await tx`INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, is_protected, created_at, updated_at)
          VALUES (${crypto.randomUUID()}, ${input.id}, 'main', NULL, TRUE, ${input.createdAt}, ${input.createdAt})`;
        const ownerRows = await tx.unsafe<DatabaseRow[]>(`SELECT p.id, p.slug, p.title, p.summary, p.visibility, p.status, p.license, p.published_at, p.updated_at,
          u.id AS owner_id, pr.username AS owner_username, pr.display_name AS owner_display_name, pr.avatar_asset_id AS owner_avatar,
          0::bigint AS unique_readers, 0::bigint AS star_count, 1::bigint AS contributor_count, 0::bigint AS source_count, 0::bigint AS open_merge_requests, 0::bigint AS version
          FROM knowledge_project p JOIN platform_user u ON u.id = p.owner_user_id JOIN platform_profile pr ON pr.user_id = u.id WHERE p.id = $1 LIMIT 1`, [input.id]);
        const row = ownerRows[0];
        if (!row) throw new Error("项目创建后读取失败");
        return mapPublicProject(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AccountConflictError("username", "项目 slug 已被当前用户使用");
      throw error;
    }
  }
}
