import { createHash, randomUUID } from "node:crypto";
import postgres, { type Sql, type TransactionSql } from "postgres";

import { KnowledgeCommandRegistry } from "@/lib/commands/knowledge";
import type { KnowledgeBranchContext, KnowledgeCommandStore, KnowledgeNodeRecord, KnowledgeTreeChange } from "@/lib/commands/knowledge/types";
import { calculateDiff, CollaborationConflictError, CollaborationInvalidStateError, CollaborationNotFoundError, type BranchSummary, type CollaborationNodeSnapshot, type CollaborationSnapshot, type CommitSummary, type CreateBranchInput, type CreateMergeRequestInput, type CreateProjectCommentInput, type CreateProjectInput, type CreateReviewInput, type MergeRequestSummary, type ProjectCommentSummary, type ProjectSummary, type ReviewSummary, type CommentAttachmentRecord, applyDiff } from "@/lib/domain/collaboration";
import type { AuthenticatedActor, KnowledgeNodeKind } from "@/lib/domain/platform";
import type { CollaborationRepository, CollaborationQueryable } from "@/lib/repositories/collaboration/collaboration-repository";
import { collaborationIdempotencyFingerprint } from "@/lib/services/collaboration/idempotency";

type Row = Record<string, unknown>;
const text = (value: unknown): string => String(value ?? "");
const nullable = (value: unknown): string | null => value == null ? null : String(value);
const iso = (value: unknown): string => value instanceof Date ? value.toISOString() : text(value);
const bool = (value: unknown): boolean => value === true || value === "t";
const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505";

function mapProject(row: Row): ProjectSummary {
  return {
    id: text(row.id), ownerUserId: text(row.owner_user_id), ownerUsername: text(row.owner_username), ownerDisplayName: text(row.owner_display_name), ownerAvatarAssetId: nullable(row.owner_avatar_asset_id),
    slug: text(row.slug), title: text(row.title), summary: text(row.summary), visibility: row.visibility as ProjectSummary["visibility"], status: row.status as ProjectSummary["status"], license: text(row.license),
    publishedAt: nullable(row.published_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function mapBranch(row: Row): BranchSummary {
  return { id: text(row.id), projectId: text(row.project_id), name: text(row.name), ownerUserId: nullable(row.owner_user_id), baseBranchId: nullable(row.base_branch_id), baseCommitId: nullable(row.base_commit_id), headCommitId: nullable(row.head_commit_id), isProtected: bool(row.is_protected), status: row.status as BranchSummary["status"], version: Number(row.version ?? 0), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}

function mapCommit(row: Row): CommitSummary {
  return { id: text(row.id), projectId: text(row.project_id), branchId: text(row.branch_id), parentCommitId: nullable(row.parent_commit_id), authorUserId: text(row.author_user_id), message: text(row.message), aiAssisted: bool(row.ai_assisted), idempotencyKey: nullable(row.idempotency_key), createdAt: iso(row.created_at) };
}

function mapMerge(row: Row): MergeRequestSummary {
  return { id: text(row.id), projectId: text(row.project_id), sourceBranchId: text(row.source_branch_id), targetBranchId: text(row.target_branch_id), authorUserId: text(row.author_user_id), title: text(row.title), description: text(row.description), status: row.status as MergeRequestSummary["status"], baseCommitId: nullable(row.base_commit_id), headCommitId: nullable(row.head_commit_id), mergedCommitId: nullable(row.merged_commit_id), mergedByUserId: nullable(row.merged_by_user_id), targetVersion: Number(row.target_version ?? 0), conflictStatus: row.conflict_status as MergeRequestSummary["conflictStatus"], conflictDetails: (row.conflict_details ?? []) as MergeRequestSummary["conflictDetails"], createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), mergedAt: nullable(row.merged_at) };
}

function mapReview(row: Row): ReviewSummary {
  return { id: text(row.id), mergeRequestId: text(row.merge_request_id), reviewerUserId: text(row.reviewer_user_id), verdict: row.verdict as ReviewSummary["verdict"], body: text(row.body), nodeId: nullable(row.node_id), blockId: nullable(row.block_id), createdAt: iso(row.created_at) };
}

/** 评论行映射为公开投影；删除后正文不再从数据库返回，避免软删除重新泄漏。 */
function mapProjectComment(row: Row): ProjectCommentSummary {
  const deleted = row.deleted_at != null;
  return {
    id: text(row.id), projectId: text(row.project_id), parentId: nullable(row.parent_id),
    nodeId: nullable(row.node_id), blockId: nullable(row.block_id), quote: nullable(row.quote),
    authorUserId: text(row.author_user_id), authorUsername: text(row.author_username),
    authorDisplayName: text(row.author_display_name), authorAvatarAssetId: nullable(row.author_avatar_asset_id),
    body: deleted ? null : text(row.body), deleted, canDelete: false,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

function mapCommentAttachment(row: Row): CommentAttachmentRecord {
  return {
    id: text(row.id), commentId: text(row.comment_id), assetId: text(row.asset_id), filename: text(row.filename),
    mimeType: text(row.mime_type), size: Number(row.actual_size ?? row.expected_size ?? 0), objectKey: text(row.object_key),
  };
}

const PROJECT_SELECT = `SELECT p.id, p.owner_user_id, p.slug, p.title, p.summary, p.visibility, p.status, p.license, p.published_at, p.created_at, p.updated_at,
  pr.username AS owner_username, pr.display_name AS owner_display_name, pr.avatar_asset_id AS owner_avatar_asset_id
  FROM knowledge_project p JOIN platform_profile pr ON pr.user_id = p.owner_user_id`;
const MERGE_SELECT = `SELECT id, project_id, source_branch_id, target_branch_id, author_user_id, title, description, status, base_commit_id, head_commit_id, merged_commit_id, merged_by_user_id, target_version, conflict_status, conflict_details, idempotency_fingerprint, created_at, updated_at, merged_at FROM merge_request`;
const COMMENT_SELECT = `SELECT c.id, c.project_id, c.parent_id, c.node_id, c.block_id, c.quote, c.author_user_id, c.body, c.deleted_at, c.idempotency_key, c.idempotency_fingerprint, c.created_at, c.updated_at,
  pr.username AS author_username, pr.display_name AS author_display_name, pr.avatar_asset_id AS author_avatar_asset_id
  FROM project_comment c JOIN platform_user u ON u.id = c.author_user_id
  JOIN platform_profile pr ON pr.user_id = u.id`;

/** PostgreSQL 协作仓储：事务负责锁定 Branch/MR，所有结果经过固定 SQL 映射。 */
export class PostgresCollaborationRepository implements CollaborationRepository {
  public constructor(private readonly sql: Sql) {}
  public static fromConnectionString(connectionString: string): PostgresCollaborationRepository { return new PostgresCollaborationRepository(postgres(connectionString, { max: 5, idle_timeout: 20 })); }

  public async listPublicProjects(search?: string): Promise<ProjectSummary[]> {
    const rows = search?.trim() ? await this.sql<Row[]>`${this.sql.unsafe(PROJECT_SELECT)} WHERE p.status = 'published' AND p.visibility = 'public' AND (p.title ILIKE ${`%${search.trim()}%`} OR p.summary ILIKE ${`%${search.trim()}%`} OR p.slug ILIKE ${`%${search.trim()}%`}) ORDER BY p.updated_at DESC LIMIT 100` : await this.sql<Row[]>`${this.sql.unsafe(PROJECT_SELECT)} WHERE p.status = 'published' AND p.visibility = 'public' ORDER BY p.updated_at DESC LIMIT 100`;
    return rows.map(mapProject);
  }

  public async getProject(projectId: string): Promise<ProjectSummary | null> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(PROJECT_SELECT)} WHERE p.id = ${projectId} LIMIT 1`;
    return rows[0] ? mapProject(rows[0]) : null;
  }

  /** 只返回已发布公开项目的评论；匿名读取不会接触草稿或私有项目评论。 */
  public async listProjectComments(projectId: string): Promise<ProjectCommentSummary[]> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(COMMENT_SELECT)}
      JOIN knowledge_project kp ON kp.id = c.project_id
      WHERE c.project_id = ${projectId} AND kp.visibility = 'public' AND kp.status = 'published'
      ORDER BY c.created_at ASC, c.id ASC LIMIT 1000`;
    return rows.map(mapProjectComment);
  }

  /** 仅返回评论已绑定的资产元数据；objectKey 只留在服务端用于签发 URL。 */
  public async listCommentAttachments(commentIds: string[]): Promise<CommentAttachmentRecord[]> {
    const ids = Array.from(new Set(commentIds.filter(Boolean)));
    if (!ids.length) return [];
    const rows = await this.sql<Row[]>`SELECT pca.id, pca.comment_id, pca.asset_id, ua.filename, ua.mime_type, ua.actual_size, ua.expected_size, ua.object_key
      FROM project_comment_attachment pca JOIN uploaded_asset ua ON ua.id = pca.asset_id
      WHERE pca.comment_id = ANY(${this.sql.array(ids)}::text[]) AND ua.status = 'verified'
      ORDER BY pca.comment_id, pca.position ASC, pca.created_at ASC`;
    return rows.map(mapCommentAttachment);
  }

  /** 在单事务内确认资产所有者/状态/类型和项目范围后绑定，重复请求只返回已有关系。 */
  public async attachCommentAttachments(input: { projectId: string; commentId: string; assetIds: string[]; ownerUserId: string }): Promise<CommentAttachmentRecord[]> {
    const assetIds = Array.from(new Set(input.assetIds.filter(Boolean)));
    if (assetIds.length > 4) throw new CollaborationInvalidStateError("一条评论最多添加 4 个图片或 GIF 附件");
    if (!assetIds.length) return [];
    return this.sql.begin(async (tx: TransactionSql) => {
      const comments = await tx<Row[]>`SELECT id FROM project_comment WHERE id = ${input.commentId} AND project_id = ${input.projectId} FOR SHARE`;
      if (!comments[0]) throw new CollaborationNotFoundError("评论不存在");
      const assets = await tx<Row[]>`SELECT id, filename, mime_type, actual_size, expected_size, object_key
        FROM uploaded_asset
        WHERE id = ANY(${tx.array(assetIds)}::text[])
          AND owner_user_id = ${input.ownerUserId}
          AND status = 'verified'
          AND asset_kind = 'original'
          AND mime_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
          AND (project_id IS NULL OR project_id = ${input.projectId})
        FOR SHARE`;
      if (assets.length !== assetIds.length) throw new CollaborationInvalidStateError("附件不存在、未完成校验或不属于当前用户");
      for (let position = 0; position < assetIds.length; position += 1) {
        const assetId = assetIds[position]!;
        await tx`INSERT INTO project_comment_attachment (id, project_id, comment_id, asset_id, position)
          VALUES (${randomUUID()}, ${input.projectId}, ${input.commentId}, ${assetId}, ${position})
          ON CONFLICT (comment_id, asset_id) DO NOTHING`;
      }
      const rows = await tx<Row[]>`SELECT pca.id, pca.comment_id, pca.asset_id, ua.filename, ua.mime_type, ua.actual_size, ua.expected_size, ua.object_key
        FROM project_comment_attachment pca JOIN uploaded_asset ua ON ua.id = pca.asset_id
        WHERE pca.comment_id = ${input.commentId} AND ua.status = 'verified'
        ORDER BY pca.position ASC, pca.created_at ASC`;
      return rows.map(mapCommentAttachment);
    });
  }

  /** 通过固定 ID 查询单条评论，删除权限由服务层按项目角色二次判定。 */
  public async getProjectComment(commentId: string): Promise<ProjectCommentSummary | null> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(COMMENT_SELECT)} WHERE c.id = ${commentId} LIMIT 1`;
    return rows[0] ? mapProjectComment(rows[0]) : null;
  }

  /** 幂等读取必须绑定项目和作者，并校验请求指纹，防止复用键覆盖另一条评论。 */
  public async getProjectCommentByIdempotency(projectId: string, authorUserId: string, idempotencyKey: string, fingerprint?: string): Promise<ProjectCommentSummary | null> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(COMMENT_SELECT)}
      WHERE c.project_id = ${projectId} AND c.author_user_id = ${authorUserId} AND c.idempotency_key = ${idempotencyKey} LIMIT 1`;
    const row = rows[0];
    if (row && fingerprint && text(row.idempotency_fingerprint) !== fingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条评论");
    return row ? mapProjectComment(row) : null;
  }

  /** 在事务中校验公开项目与父评论归属后写入；父评论可软删除但不能跨项目引用。 */
  public async createProjectComment(input: CreateProjectCommentInput, actor: AuthenticatedActor, fingerprint?: string): Promise<ProjectCommentSummary> {
    const id = randomUUID();
    try {
      await this.sql.begin(async (tx: TransactionSql) => {
        const projects = await tx<Row[]>`SELECT id FROM knowledge_project WHERE id = ${input.projectId} AND visibility = 'public' AND status = 'published' FOR SHARE`;
        if (!projects[0]) throw new CollaborationNotFoundError("公开项目不存在");
        if (input.parentId) {
          const parent = await tx<Row[]>`SELECT id FROM project_comment WHERE id = ${input.parentId} AND project_id = ${input.projectId} FOR SHARE`;
          if (!parent[0]) throw new CollaborationNotFoundError("父评论不存在");
        }
        if (input.nodeId) {
          const node = await tx<Row[]>`SELECT id FROM knowledge_node WHERE id = ${input.nodeId} AND project_id = ${input.projectId} FOR SHARE`;
          if (!node[0]) throw new CollaborationNotFoundError("评论锚点文件不存在");
        }
        await tx`INSERT INTO project_comment (id, project_id, parent_id, node_id, block_id, quote, author_user_id, body, idempotency_key, idempotency_fingerprint)
          VALUES (${id}, ${input.projectId}, ${input.parentId ?? null}, ${input.nodeId ?? null}, ${input.blockId ?? null}, ${input.quote ?? null}, ${actor.userId}, ${input.body}, ${input.idempotencyKey ?? null}, ${fingerprint ?? null})`;
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const replay = await this.getProjectCommentByIdempotency(input.projectId, actor.userId, input.idempotencyKey, fingerprint);
        if (replay) return replay;
      }
      throw error;
    }
    const created = await this.getProjectComment(id);
    if (!created) throw new CollaborationNotFoundError("评论写入后无法读取");
    return created;
  }

  /** 软删除只清空正文并保留树节点，保证已有回复不会失去父级。 */
  public async softDeleteProjectComment(commentId: string, _actor: AuthenticatedActor): Promise<ProjectCommentSummary> {
    const updated = await this.sql.begin(async (tx: TransactionSql) => {
      const rows = await tx<Row[]>`SELECT id FROM project_comment WHERE id = ${commentId} FOR UPDATE`;
      if (!rows[0]) throw new CollaborationNotFoundError("评论不存在");
      await tx`UPDATE project_comment SET body = '', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ${commentId}`;
      const result = await tx<Row[]>`${tx.unsafe(COMMENT_SELECT)} WHERE c.id = ${commentId} LIMIT 1`;
      return result[0] ? mapProjectComment(result[0]) : null;
    });
    if (!updated) throw new CollaborationNotFoundError("评论删除后无法读取");
    return updated;
  }

  public async createProject(input: CreateProjectInput, owner: AuthenticatedActor): Promise<ProjectSummary> {
    const id = randomUUID(); const branchId = randomUUID(); const now = new Date().toISOString();
    try {
      await this.sql.begin(async (tx: TransactionSql) => {
        await tx`INSERT INTO knowledge_project (id, owner_user_id, slug, title, summary, visibility, status, license, published_at, created_at, updated_at) VALUES (${id}, ${owner.userId}, ${input.slug}, ${input.title}, ${input.summary ?? ""}, ${input.visibility ?? "private"}, 'draft', ${input.license ?? "all-rights-reserved"}, NULL, ${now}, ${now})`;
        await tx`INSERT INTO project_member (project_id, user_id, role) VALUES (${id}, ${owner.userId}, 'owner')`;
        await tx`INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, is_protected, status, version, created_at, updated_at) VALUES (${branchId}, ${id}, 'main', NULL, TRUE, 'active', 0, ${now}, ${now})`;
        await tx`UPDATE knowledge_project SET default_branch_name = 'main' WHERE id = ${id}`;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") throw new CollaborationInvalidStateError("该项目地址已被使用");
      throw error;
    }
    const project = await this.getProject(id); if (!project) throw new CollaborationNotFoundError("项目创建后无法读取"); return project;
  }

  public async getBranch(branchId: string): Promise<BranchSummary | null> {
    const rows = await this.sql<Row[]>`SELECT id, project_id, name, owner_user_id, base_branch_id, base_commit_id, head_commit_id, is_protected, status, version, created_at, updated_at FROM knowledge_branch WHERE id = ${branchId} LIMIT 1`;
    return rows[0] ? mapBranch(rows[0]) : null;
  }
  public async listBranches(projectId: string): Promise<BranchSummary[]> {
    const rows = await this.sql<Row[]>`SELECT id, project_id, name, owner_user_id, base_branch_id, base_commit_id, head_commit_id, is_protected, status, version, created_at, updated_at FROM knowledge_branch WHERE project_id = ${projectId} ORDER BY is_protected DESC, updated_at DESC`;
    return rows.map(mapBranch);
  }

  public async createBranch(input: CreateBranchInput, owner: AuthenticatedActor): Promise<BranchSummary> {
    const id = randomUUID(); const now = new Date().toISOString(); const baseId = input.baseBranchId ?? (await this.sql<Row[]>`SELECT id FROM knowledge_branch WHERE project_id = ${input.projectId} AND is_protected = TRUE ORDER BY created_at LIMIT 1`)[0]?.id;
    if (!baseId) throw new CollaborationNotFoundError("目标基线分支不存在");
    try {
      await this.sql.begin(async (tx: TransactionSql) => {
        const bases = await tx<Row[]>`SELECT id, project_id, head_commit_id, version FROM knowledge_branch WHERE id = ${String(baseId)} AND project_id = ${input.projectId} FOR SHARE`;
        const base = bases[0]; if (!base) throw new CollaborationNotFoundError("目标基线分支不存在");
        const name = input.name?.trim() || `draft/${owner.userId.slice(0, 8)}-${Date.now()}`;
        const baseSnapshot = await getSnapshot(tx, String(baseId));
        await tx`INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, base_branch_id, base_commit_id, head_commit_id, is_protected, status, version, base_snapshot, created_at, updated_at) VALUES (${id}, ${input.projectId}, ${name}, ${owner.userId}, ${String(baseId)}, ${nullable(base.head_commit_id)}, ${nullable(base.head_commit_id)}, FALSE, 'active', ${Number(base.version ?? 0)}, ${JSON.stringify(baseSnapshot)}::jsonb, ${now}, ${now})`;
        await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
          SELECT project_id, ${id}, node_id, parent_node_id, name, position, deleted_at, ${now} FROM knowledge_node_state WHERE branch_id = ${String(baseId)}`;
      });
    } catch (error) {
      if (error instanceof CollaborationNotFoundError) throw error;
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "23505") throw new CollaborationInvalidStateError("该分支名称已存在");
      throw error;
    }
    const branch = await this.getBranch(id); if (!branch) throw new CollaborationNotFoundError("分支创建后无法读取"); return branch;
  }

  public createCommandStore(options: { branchId: string; expectedVersion?: number; idempotencyKey?: string; idempotencyFingerprint?: string; message?: string; aiAssisted?: boolean }): KnowledgeCommandStore {
    return new PostgresKnowledgeCommandStore(this.sql, options);
  }
  public async getCommitByIdempotency(branchId: string, idempotencyKey: string, idempotencyFingerprint?: string): Promise<CommitSummary | null> {
    const rows = await this.sql<Row[]>`SELECT id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, created_at FROM knowledge_commit WHERE branch_id = ${branchId} AND idempotency_key = ${idempotencyKey} LIMIT 1`;
    if (rows[0] && idempotencyFingerprint) {
      if (!rows[0].idempotency_fingerprint) throw new CollaborationInvalidStateError("历史幂等记录缺少请求指纹，请使用新的幂等键");
      if (text(rows[0].idempotency_fingerprint) !== idempotencyFingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条不同的提交");
    }
    return rows[0] ? mapCommit(rows[0]) : null;
  }
  public async getCommit(branchId: string, commitId: string): Promise<CommitSummary | null> {
    const rows = await this.sql<Row[]>`SELECT id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, created_at FROM knowledge_commit WHERE branch_id = ${branchId} AND id = ${commitId} LIMIT 1`;
    return rows[0] ? mapCommit(rows[0]) : null;
  }

  public async getSnapshot(branchId: string): Promise<CollaborationSnapshot> {
    return getSnapshot(this.sql, branchId);
  }

  public async createMergeRequest(input: CreateMergeRequestInput, actor: AuthenticatedActor): Promise<MergeRequestSummary> {
    if (input.sourceBranchId === input.targetBranchId) throw new CollaborationInvalidStateError("源分支和目标分支不能相同");
    const id = randomUUID();
    let result: MergeRequestSummary;
    try {
      result = await this.sql.begin(async (tx: TransactionSql) => {
      const idempotencyFingerprint = input.idempotencyKey
        ? collaborationIdempotencyFingerprint("merge-request", { actorId: actor.userId, projectId: input.projectId, sourceBranchId: input.sourceBranchId, targetBranchId: input.targetBranchId, title: input.title, description: input.description ?? "" })
        : null;
      // 幂等重试必须先于状态校验返回原结果；否则 MR 合并后网络重试会被错误地报告为失败。
      if (input.idempotencyKey) {
        const prior = await tx<Row[]>`${tx.unsafe(MERGE_SELECT)} WHERE source_branch_id = ${input.sourceBranchId} AND target_branch_id = ${input.targetBranchId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
        if (prior[0]) {
          if (idempotencyFingerprint && !prior[0].idempotency_fingerprint) throw new CollaborationInvalidStateError("历史幂等记录缺少请求指纹，请使用新的幂等键");
          if (prior[0].idempotency_fingerprint && text(prior[0].idempotency_fingerprint) !== idempotencyFingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条不同的合并申请");
          return mapMerge(prior[0]);
        }
      }
      // 源/目标分支一起加行锁，串行化“检查 active -> 创建 MR -> 标记 submitted”，避免同一草稿产生两个不同 MR。
      const branches = await tx<Row[]>`SELECT id, project_id, base_branch_id, base_commit_id, base_snapshot, head_commit_id, version, is_protected, owner_user_id, status FROM knowledge_branch WHERE project_id = ${input.projectId} AND id IN (${input.sourceBranchId}, ${input.targetBranchId}) FOR UPDATE`;
      const source = branches.find((row) => text(row.id) === input.sourceBranchId); const target = branches.find((row) => text(row.id) === input.targetBranchId);
      if (!source || !target) throw new CollaborationNotFoundError("源或目标分支不存在");
      if (bool(source.is_protected) || !bool(target.is_protected)) throw new CollaborationInvalidStateError("MR 必须从非保护分支提交到保护分支");
      if (text(source.status) !== "active") throw new CollaborationInvalidStateError("该草稿分支已提交或关闭，请基于最新版本新建分支");
      if (text(target.status) !== "active") throw new CollaborationInvalidStateError("目标主分支当前不可接受新的修改申请");
      const sourceSnapshot = await getSnapshot(tx, input.sourceBranchId);
      const targetSnapshot = await getSnapshot(tx, input.targetBranchId);
      // 基线来自源分支创建时的 base_branch；这样目标分支已有内容不会被误判成冲突。
      const baseSnapshot = (source.base_snapshot && typeof source.base_snapshot === "object" && Object.keys(source.base_snapshot as object).length > 0)
        ? source.base_snapshot as CollaborationSnapshot
        : targetSnapshot;
      const initialDiff = calculateDiff(baseSnapshot, sourceSnapshot, targetSnapshot);
      const conflictDetails = initialDiff.flatMap((entry) => entry.conflicts);
      if (initialDiff.every((entry) => entry.operation === "unchanged")) throw new CollaborationInvalidStateError("没有可提交的变化");
      await tx`INSERT INTO merge_request (id, project_id, source_branch_id, target_branch_id, author_user_id, title, description, status, base_commit_id, head_commit_id, target_version, source_base_snapshot, target_base_snapshot, conflict_status, conflict_details, idempotency_fingerprint)
        VALUES (${id}, ${input.projectId}, ${input.sourceBranchId}, ${input.targetBranchId}, ${actor.userId}, ${input.title}, ${input.description ?? ""}, 'open', ${nullable(source.base_commit_id)}, ${nullable(source.head_commit_id)}, ${Number(target.version ?? 0)}, ${JSON.stringify(baseSnapshot)}, ${JSON.stringify(targetSnapshot)}, ${conflictDetails.length ? "conflict" : "clean"}, ${JSON.stringify(conflictDetails)}, ${idempotencyFingerprint})`;
      await tx`UPDATE knowledge_branch SET status = 'submitted', updated_at = CURRENT_TIMESTAMP WHERE id = ${input.sourceBranchId} AND status = 'active'`;
      const created = await tx<Row[]>`${tx.unsafe(MERGE_SELECT)} WHERE id = ${id}`;
      return mapMerge(created[0]!);
      });
    } catch (error) {
      // 两个并发首请求可能同时通过 SELECT；唯一索引胜出后，败者读取胜出的 MR 并按指纹判断是否可安全重放。
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const fingerprint = collaborationIdempotencyFingerprint("merge-request", { actorId: actor.userId, projectId: input.projectId, sourceBranchId: input.sourceBranchId, targetBranchId: input.targetBranchId, title: input.title, description: input.description ?? "" });
        const prior = await this.sql<Row[]>`${this.sql.unsafe(MERGE_SELECT)} WHERE source_branch_id = ${input.sourceBranchId} AND target_branch_id = ${input.targetBranchId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
        if (prior[0]) {
          if (!prior[0].idempotency_fingerprint || text(prior[0].idempotency_fingerprint) !== fingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条不同的合并申请");
          result = mapMerge(prior[0]);
        } else throw error;
      } else throw error;
    }
    return result;
  }

  public async getMergeRequest(mergeRequestId: string): Promise<MergeRequestSummary | null> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(MERGE_SELECT)} WHERE id = ${mergeRequestId} LIMIT 1`; return rows[0] ? mapMerge(rows[0]) : null;
  }
  public async listMergeRequests(projectId: string): Promise<MergeRequestSummary[]> {
    const rows = await this.sql<Row[]>`${this.sql.unsafe(MERGE_SELECT)} WHERE project_id = ${projectId} AND status <> 'draft' ORDER BY updated_at DESC LIMIT 100`;
    return rows.map(mapMerge);
  }
  public async listReviews(mergeRequestId: string): Promise<ReviewSummary[]> {
    const rows = await this.sql<Row[]>`SELECT id, merge_request_id, reviewer_user_id, verdict, body, node_id, block_id, created_at FROM merge_review WHERE merge_request_id = ${mergeRequestId} ORDER BY created_at ASC`; return rows.map(mapReview);
  }
  public async addReview(input: CreateReviewInput, actor: AuthenticatedActor): Promise<ReviewSummary> {
    const id = randomUUID();
    let result: ReviewSummary;
    try {
      result = await this.sql.begin(async (tx: TransactionSql) => {
      const mr = await tx<Row[]>`SELECT id, project_id, status, conflict_status FROM merge_request WHERE id = ${input.mergeRequestId} FOR UPDATE`; if (!mr[0]) throw new CollaborationNotFoundError("合并申请不存在");
      const idempotencyFingerprint = input.idempotencyKey
        ? collaborationIdempotencyFingerprint("merge-review", { actorId: actor.userId, mergeRequestId: input.mergeRequestId, verdict: input.verdict, body: input.body ?? "", nodeId: input.nodeId ?? null, blockId: input.blockId ?? null })
        : null;
      // 同一幂等键即使在 MR 已结束后重试，也必须返回原 Review，而不是制造误导性的状态错误。
      if (input.idempotencyKey) {
        const prior = await tx<Row[]>`SELECT id, merge_request_id, reviewer_user_id, verdict, body, node_id, block_id, idempotency_fingerprint, created_at FROM merge_review WHERE merge_request_id = ${input.mergeRequestId} AND reviewer_user_id = ${actor.userId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
        if (prior[0]) {
          if (idempotencyFingerprint && !prior[0].idempotency_fingerprint) throw new CollaborationInvalidStateError("历史幂等记录缺少请求指纹，请使用新的幂等键");
          if (prior[0].idempotency_fingerprint && text(prior[0].idempotency_fingerprint) !== idempotencyFingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条不同的审核");
          return mapReview(prior[0]);
        }
      }
      if (["merged", "closed"].includes(text(mr[0].status))) throw new CollaborationInvalidStateError("该合并申请已结束");
      if (input.verdict === "comment" && !input.body?.trim()) throw new CollaborationInvalidStateError("逐段评论必须填写内容");
      if (input.verdict === "approve" && text(mr[0].conflict_status) === "conflict") throw new CollaborationConflictError("存在未解决冲突，不能批准合并申请");
      const rows = await tx<Row[]>`INSERT INTO merge_review (id, merge_request_id, reviewer_user_id, verdict, body, node_id, block_id, idempotency_key, idempotency_fingerprint) VALUES (${id}, ${input.mergeRequestId}, ${actor.userId}, ${input.verdict}, ${input.body ?? ""}, ${input.nodeId ?? null}, ${input.blockId ?? null}, ${input.idempotencyKey ?? null}, ${idempotencyFingerprint}) RETURNING id, merge_request_id, reviewer_user_id, verdict, body, node_id, block_id, created_at`;
      const nextStatus = input.verdict === "approve" ? "approved" : input.verdict === "request_changes" ? "changes_requested" : input.verdict === "reject" ? "closed" : null;
      if (nextStatus) await tx`UPDATE merge_request SET status = ${nextStatus}, updated_at = CURRENT_TIMESTAMP WHERE id = ${input.mergeRequestId}`;
      if (input.verdict === "reject") await tx`UPDATE knowledge_branch SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT source_branch_id FROM merge_request WHERE id = ${input.mergeRequestId}) AND status = 'submitted'`;
      return mapReview(rows[0]!);
      });
    } catch (error) {
      // 并发重复审核由唯一索引裁决；败者读取已提交 Review，保证重试仍返回同一事实。
      if (isUniqueViolation(error) && input.idempotencyKey) {
        const fingerprint = collaborationIdempotencyFingerprint("merge-review", { actorId: actor.userId, mergeRequestId: input.mergeRequestId, verdict: input.verdict, body: input.body ?? "", nodeId: input.nodeId ?? null, blockId: input.blockId ?? null });
        const prior = await this.sql<Row[]>`SELECT id, merge_request_id, reviewer_user_id, verdict, body, node_id, block_id, idempotency_fingerprint, created_at FROM merge_review WHERE merge_request_id = ${input.mergeRequestId} AND reviewer_user_id = ${actor.userId} AND idempotency_key = ${input.idempotencyKey} LIMIT 1`;
        if (!prior[0] || !prior[0].idempotency_fingerprint || text(prior[0].idempotency_fingerprint) !== fingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条不同的审核");
        result = mapReview(prior[0]);
      } else throw error;
    }
    return result;
  }

  public async calculateMergeDiff(mergeRequestId: string): Promise<{ entries: import("@/lib/domain/collaboration").CollaborationDiffEntry[]; mergeRequest: MergeRequestSummary }> {
    const mergeRequest = await this.getMergeRequest(mergeRequestId); if (!mergeRequest) throw new CollaborationNotFoundError("合并申请不存在");
    const source = await this.getSnapshot(mergeRequest.sourceBranchId); const target = await this.getSnapshot(mergeRequest.targetBranchId);
    const rows = await this.sql<Row[]>`SELECT source_base_snapshot FROM merge_request WHERE id = ${mergeRequestId} LIMIT 1`;
    const base = (rows[0]?.source_base_snapshot ?? {}) as CollaborationSnapshot;
    const entries = calculateDiff(base, source, target);
    return { entries, mergeRequest };
  }

  public async mergeMergeRequest(mergeRequestId: string, actor: AuthenticatedActor): Promise<MergeRequestSummary> {
    const result = await this.sql.begin(async (tx: TransactionSql) => {
      const rows = await tx<Row[]>`${tx.unsafe(MERGE_SELECT)} WHERE id = ${mergeRequestId} FOR UPDATE`; const mr = rows[0]; if (!mr) throw new CollaborationNotFoundError("合并申请不存在");
      if (text(mr.status) === "merged") return mapMerge(mr);
      if (text(mr.status) !== "approved") throw new CollaborationInvalidStateError("合并申请尚未通过审核");
      const targets = await tx<Row[]>`SELECT id, project_id, head_commit_id, version FROM knowledge_branch WHERE id = ${text(mr.target_branch_id)} AND project_id = ${text(mr.project_id)} AND is_protected = TRUE FOR UPDATE`; const target = targets[0]; if (!target) throw new CollaborationNotFoundError("目标分支不存在");
      if (Number(target.version) !== Number(mr.target_version)) {
        const sourceSnapshot = await getSnapshot(tx, text(mr.source_branch_id)); const targetSnapshot = await getSnapshot(tx, text(mr.target_branch_id)); const base = (mr.source_base_snapshot ?? {}) as CollaborationSnapshot; const diff = calculateDiff(base, sourceSnapshot, targetSnapshot); const conflicts = diff.flatMap((entry) => entry.conflicts);
        await tx`UPDATE merge_request SET conflict_status = 'conflict', conflict_details = ${JSON.stringify(conflicts)}::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = ${mergeRequestId}`;
        throw new CollaborationConflictError("目标分支已更新，请重新检查冲突", conflicts);
      }
      const sourceSnapshot = await getSnapshot(tx, text(mr.source_branch_id)); const targetSnapshot = await getSnapshot(tx, text(mr.target_branch_id)); const base = (mr.source_base_snapshot ?? {}) as CollaborationSnapshot; const diff = calculateDiff(base, sourceSnapshot, targetSnapshot); const conflicts = diff.flatMap((entry) => entry.conflicts);
      if (conflicts.length) { await tx`UPDATE merge_request SET conflict_status = 'conflict', conflict_details = ${JSON.stringify(conflicts)}::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = ${mergeRequestId}`; throw new CollaborationConflictError("合并存在冲突", conflicts); }
      const merged = applyDiff(diff); const commitId = randomUUID(); const now = new Date().toISOString();
      await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, change_summary) VALUES (${commitId}, ${text(mr.project_id)}, ${text(mr.target_branch_id)}, ${nullable(target.head_commit_id)}, ${actor.userId}, ${`Merge !${mergeRequestId}`}, FALSE, ${JSON.stringify({ mergeRequestId, changedNodes: diff.filter((entry) => entry.operation !== "unchanged").map((entry) => entry.nodeId) })})`;
      let position = 0;
      for (const entry of diff.filter((item) => item.operation !== "unchanged")) {
        const chosen = merged[entry.nodeId]; if (!chosen) continue;
        const targetNode = entry.target;
        let afterRevisionId: string | null = null;
        if (chosen.kind !== "folder" && (entry.operation === "update_content" || entry.operation === "create_node" || !targetNode || chosen.contentHash !== targetNode.contentHash)) {
          afterRevisionId = randomUUID();
          await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at) VALUES (${afterRevisionId}, ${text(mr.project_id)}, ${chosen.nodeId}, ${text(mr.target_branch_id)}, ${commitId}, ${nullable(targetNode?.revisionId)}, ${JSON.stringify(chosen.content ?? {})}, ${chosen.contentText}, ${chosen.contentHash ?? createHash("sha256").update(chosen.contentText).digest("hex")}, ${actor.userId}, ${now})`;
        }
        await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at) VALUES (${text(mr.project_id)}, ${text(mr.target_branch_id)}, ${chosen.nodeId}, ${chosen.parentNodeId}, ${chosen.name}, ${chosen.position}, ${chosen.deleted ? now : null}, ${now}) ON CONFLICT (branch_id, node_id) DO UPDATE SET parent_node_id = EXCLUDED.parent_node_id, name = EXCLUDED.name, position = EXCLUDED.position, deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at`;
        await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position) VALUES (${randomUUID()}, ${commitId}, ${chosen.nodeId}, ${entry.operation === "conflict" ? "update_content" : entry.operation}, ${nullable(targetNode?.revisionId)}, ${afterRevisionId}, ${JSON.stringify({ mergeRequestId })}, ${position})`; position += 1;
         if (afterRevisionId) {
           // MR 作者可能是代提交的维护者；署名必须来自源分支该节点最近一次真实 Commit，回退到分支所有者。
           const sourceAuthorRows = await tx<Row[]>`SELECT kc.author_user_id
             FROM knowledge_commit kc JOIN commit_change cc ON cc.commit_id = kc.id
             WHERE kc.branch_id = ${text(mr.source_branch_id)} AND cc.node_id = ${chosen.nodeId}
             ORDER BY kc.created_at DESC LIMIT 1`;
           const sourceContributorUserId = sourceAuthorRows[0]?.author_user_id
             ? text(sourceAuthorRows[0].author_user_id)
             : text(mr.author_user_id);
           for (const blockId of extractBlockIds(chosen)) await tx`INSERT INTO content_attribution (id, project_id, node_id, block_id, origin_commit_id, last_touch_commit_id, contributor_user_id, reviewer_user_id, merge_request_id) VALUES (${randomUUID()}, ${text(mr.project_id)}, ${chosen.nodeId}, ${blockId}, ${nullable(mr.head_commit_id) ?? commitId}, ${commitId}, ${sourceContributorUserId}, ${actor.userId}, ${mergeRequestId}) ON CONFLICT DO NOTHING`;
         }
      }
      await tx`UPDATE knowledge_branch SET head_commit_id = ${commitId}, version = version + 1, updated_at = ${now} WHERE id = ${text(mr.target_branch_id)} AND version = ${Number(mr.target_version)}`;
      await tx`UPDATE knowledge_branch SET status = 'merged', updated_at = ${now} WHERE id = ${text(mr.source_branch_id)} AND status <> 'closed'`;
      await tx`UPDATE merge_request SET status = 'merged', merged_commit_id = ${commitId}, merged_by_user_id = ${actor.userId}, merged_at = ${now}, conflict_status = 'clean', conflict_details = '[]'::jsonb, updated_at = ${now} WHERE id = ${mergeRequestId}`;
      const mergedRows = await tx<Row[]>`${tx.unsafe(MERGE_SELECT)} WHERE id = ${mergeRequestId}`;
      return mapMerge(mergedRows[0]!);
    });
    return result;
  }
}

function extractBlockIds(snapshot: CollaborationNodeSnapshot): string[] {
  const content = snapshot.content as { content?: Array<{ attrs?: { blockId?: string; block_id?: string }; text?: string }> } | null;
  const ids = content?.content?.map((item, index) => item.attrs?.blockId ?? item.attrs?.block_id ?? `${snapshot.nodeId}:line:${index + 1}`).filter(Boolean) ?? [];
  return ids.length ? ids : [`${snapshot.nodeId}:document`];
}

/** 分支快照读取支持一层 base branch 回退，使新草稿无需复制历史 Revision 仍可参与文本 Diff。 */
async function getSnapshot(queryable: CollaborationQueryable, branchId: string): Promise<CollaborationSnapshot> {
  const rows = await queryable<Row[]>`SELECT ns.node_id, n.kind, ns.parent_node_id, ns.name, ns.position, ns.deleted_at,
    COALESCE(current_rev.content, base_rev.content, '{}'::jsonb) AS content,
    COALESCE(current_rev.content_text, base_rev.content_text, '') AS content_text,
    COALESCE(current_rev.content_hash, base_rev.content_hash) AS content_hash,
    COALESCE(current_rev.id, base_rev.id) AS revision_id
    FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id
    JOIN knowledge_branch b ON b.id = ns.branch_id
    LEFT JOIN LATERAL (SELECT dr.id, dr.content, dr.content_text, dr.content_hash FROM document_revision dr WHERE dr.branch_id = ns.branch_id AND dr.node_id = ns.node_id ORDER BY dr.created_at DESC LIMIT 1) current_rev ON TRUE
    LEFT JOIN LATERAL (SELECT dr.id, dr.content, dr.content_text, dr.content_hash FROM document_revision dr WHERE dr.branch_id = b.base_branch_id AND dr.node_id = ns.node_id ORDER BY dr.created_at DESC LIMIT 1) base_rev ON TRUE
    WHERE ns.branch_id = ${branchId}`;
  return Object.fromEntries(rows.map((row) => [text(row.node_id), { nodeId: text(row.node_id), kind: row.kind as KnowledgeNodeKind, parentNodeId: nullable(row.parent_node_id), name: text(row.name), position: Number(row.position ?? 0), deleted: row.deleted_at != null, content: row.content, contentText: text(row.content_text), contentHash: nullable(row.content_hash), revisionId: nullable(row.revision_id) }]));
}

/** Registry 使用的持久化 Store：检查分支版本后，以一个 Commit 原子落下树变更。 */
class PostgresKnowledgeCommandStore implements KnowledgeCommandStore {
  public constructor(private readonly sql: Sql, private readonly options: { branchId: string; expectedVersion?: number; idempotencyKey?: string; idempotencyFingerprint?: string; message?: string; aiAssisted?: boolean }) {}
  public async getBranch(branchId: string): Promise<KnowledgeBranchContext | null> {
    const rows = await this.sql<Row[]>`SELECT id, project_id, owner_user_id, is_protected, status FROM knowledge_branch WHERE id = ${branchId} LIMIT 1`; const row = rows[0]; if (!row) return null;
    return { id: text(row.id), projectId: text(row.project_id), ownerId: nullable(row.owner_user_id), storage: bool(row.is_protected) ? "published" : "server_draft", status: row.status as KnowledgeBranchContext["status"] };
  }
  public async getNode(branchId: string, nodeId: string): Promise<KnowledgeNodeRecord | null> { const rows = await this.sql<Row[]>`SELECT ns.node_id AS id, ns.project_id, ns.parent_node_id AS parent_id, n.kind, ns.name, ns.deleted_at FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id WHERE ns.branch_id = ${branchId} AND ns.node_id = ${nodeId} LIMIT 1`; const row = rows[0]; return row ? { id: text(row.id), projectId: text(row.project_id), parentId: nullable(row.parent_id), kind: row.kind as KnowledgeNodeRecord["kind"], name: text(row.name), deletedAt: nullable(row.deleted_at) } : null; }
  public async listChildren(branchId: string, parentId: string | null): Promise<KnowledgeNodeRecord[]> { const rows = await this.sql<Row[]>`SELECT ns.node_id AS id, ns.project_id, ns.parent_node_id AS parent_id, n.kind, ns.name, ns.deleted_at FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id WHERE ns.branch_id = ${branchId} AND ns.parent_node_id IS NOT DISTINCT FROM ${parentId} ORDER BY ns.position, ns.name`; return rows.map((row) => ({ id: text(row.id), projectId: text(row.project_id), parentId: nullable(row.parent_id), kind: row.kind as KnowledgeNodeRecord["kind"], name: text(row.name), deletedAt: nullable(row.deleted_at) })); }
  public async isDescendant(branchId: string, possibleDescendantId: string, ancestorId: string): Promise<boolean> { const rows = await this.sql<{ found: boolean }[]>`WITH RECURSIVE tree AS (SELECT node_id, parent_node_id FROM knowledge_node_state WHERE branch_id = ${branchId} AND node_id = ${possibleDescendantId} UNION ALL SELECT ns.node_id, ns.parent_node_id FROM knowledge_node_state ns JOIN tree t ON ns.node_id = t.parent_node_id WHERE ns.branch_id = ${branchId}) SELECT EXISTS (SELECT 1 FROM tree WHERE node_id = ${ancestorId}) AS found`; return Boolean(rows[0]?.found); }
  public async appendChange(change: KnowledgeTreeChange): Promise<void> {
    await this.sql.begin(async (tx: TransactionSql) => {
      const rows = await tx<Row[]>`SELECT id, project_id, head_commit_id, version, status, is_protected FROM knowledge_branch WHERE id = ${change.branchId} FOR UPDATE`; const branch = rows[0]; if (!branch) throw new CollaborationNotFoundError("分支不存在");
      if (bool(branch.is_protected)) throw new CollaborationInvalidStateError("保护分支只能通过合并写入");
      if (text(branch.status) !== "active") throw new CollaborationInvalidStateError("该草稿分支已提交或关闭，不能继续写入");
      if (this.options.idempotencyKey) {
        const prior = await tx<Row[]>`SELECT id, idempotency_fingerprint FROM knowledge_commit WHERE branch_id = ${change.branchId} AND idempotency_key = ${this.options.idempotencyKey} LIMIT 1`;
        if (prior[0]) {
          if (this.options.idempotencyFingerprint && !prior[0].idempotency_fingerprint) throw new CollaborationInvalidStateError("历史幂等记录缺少请求指纹，请使用新的幂等键");
          if (prior[0].idempotency_fingerprint && this.options.idempotencyFingerprint && text(prior[0].idempotency_fingerprint) !== this.options.idempotencyFingerprint) throw new CollaborationInvalidStateError("幂等键已用于另一条不同的提交");
          return;
        }
      }
      if (this.options.expectedVersion != null && Number(branch.version) !== this.options.expectedVersion) throw new CollaborationConflictError("草稿分支已被其他提交更新", { expected: this.options.expectedVersion, actual: Number(branch.version) });
      const now = change.createdAt;
      await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary) VALUES (${change.id}, ${change.projectId}, ${change.branchId}, ${nullable(branch.head_commit_id)}, ${change.actorId}, ${this.options.message ?? change.command.type}, ${this.options.aiAssisted ?? false}, ${this.options.idempotencyKey ?? null}, ${this.options.idempotencyFingerprint ?? null}, ${JSON.stringify(change.command)})`;
      const after = change.after; const before = change.before;
      if (after && (change.command.type === "create_node" || change.command.type === "duplicate_node")) await tx`INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at) VALUES (${after.id}, ${after.projectId}, ${after.kind === "document" ? "document" : "folder"}, ${change.actorId}, ${now}) ON CONFLICT (id) DO NOTHING`;
      if (after) await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at) VALUES (${after.projectId}, ${change.branchId}, ${after.id}, ${after.parentId}, ${after.name}, 0, ${after.deletedAt}, ${now}) ON CONFLICT (branch_id, node_id) DO UPDATE SET parent_node_id = EXCLUDED.parent_node_id, name = EXCLUDED.name, deleted_at = EXCLUDED.deleted_at, updated_at = EXCLUDED.updated_at`;
      const changedNodeId = change.after?.id ?? change.before?.id;
      if (!changedNodeId) throw new CollaborationInvalidStateError("命令缺少目标节点");
      await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position) VALUES (${randomUUID()}, ${change.id}, ${changedNodeId}, ${change.command.type}, NULL, NULL, ${JSON.stringify({ before, after })}, 0)`;
      await tx`UPDATE knowledge_branch SET head_commit_id = ${change.id}, version = version + 1, updated_at = ${now} WHERE id = ${change.branchId} AND version = ${Number(branch.version)}`;
    });
  }
}
