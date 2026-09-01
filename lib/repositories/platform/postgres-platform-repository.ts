import postgres, { type Sql, type TransactionSql } from "postgres";

import { AccountConflictError } from "@/lib/domain/platform/errors";
import type { KnowledgeBranchAccess, KnowledgeNodeState, KnowledgeProjectAccess, OAuthIdentityInput, PasswordAccount, PlatformAccount, PlatformRole } from "@/lib/domain/platform";
import type { CreatePasswordAccountRecord, PlatformRepository } from "@/lib/repositories/platform/platform-repository";

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
    const rows = await this.sql<DatabaseRow[]>`SELECT id, project_id, owner_user_id, is_protected
      FROM knowledge_branch WHERE project_id = ${projectId} AND id = ${branchId} LIMIT 1`;
    const row = rows[0];
    return row ? {
      id: String(row.id), projectId: String(row.project_id), ownerUserId: row.owner_user_id ? String(row.owner_user_id) : null,
      isProtected: Boolean(row.is_protected),
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
}
