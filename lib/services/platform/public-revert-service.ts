import { randomUUID } from "node:crypto";
import postgres, { type TransactionSql } from "postgres";

import { PermissionDeniedError, type AuthenticatedActor } from "@/lib/domain/platform";
import { ValidationError } from "@/lib/domain/errors";
import type { PlatformRepository } from "@/lib/repositories/platform/platform-repository";
import { AuthorizationService } from "@/lib/services/platform/authorization-service";

type Row = Record<string, unknown>;
type Snapshot = { id?: string; name?: string; parentId?: string | null; deletedAt?: string | null; position?: number; kind?: string };

export interface PublicRevertResult {
  commit: { id: string; projectId: string; branchId: string; parentCommitId: string | null; authorUserId: string; message: string; createdAt: string };
  revertedCommitId: string;
  changedFiles: number;
}

function text(value: unknown): string { return value == null ? "" : String(value); }
function nullable(value: unknown): string | null { return value == null || value === "" ? null : String(value); }
function snapshot(value: unknown): Snapshot | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Snapshot : null; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

/** 反向 Commit 的操作类型；旧历史不被修改，只追加一条可审计的新提交。 */
export function inverseOperation(operation: string): "delete_node" | "restore_node" | "rename_node" | "move_node" | "update_content" {
  if (operation === "create_node" || operation === "duplicate_node" || operation === "restore_node") return "delete_node";
  if (operation === "delete_node") return "restore_node";
  if (operation === "rename_node") return "rename_node";
  if (operation === "move_node") return "move_node";
  if (operation === "update_content") return "update_content";
  throw new ValidationError("该 Commit 含有不支持回滚的操作");
}

/**
 * 只允许维护者回滚当前 main HEAD，避免对历史中间点做不安全的覆盖式恢复。
 * 回滚通过新 Commit 追加 before Revision/树快照；旧 Commit、来源和署名永不修改。
 */
export class PublicRevertService {
  private readonly authorization: AuthorizationService;

  public constructor(platform: PlatformRepository) { this.authorization = new AuthorizationService(platform); }

  public async revert(projectIdOrSlug: string, commitId: string, actor: AuthenticatedActor): Promise<PublicRevertResult> {
    const projectKey = projectIdOrSlug.trim(); const commitKey = commitId.trim();
    if (!projectKey || projectKey.length > 160 || !commitKey || commitKey.length > 160) throw new ValidationError("项目或 Commit ID 无效");
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new ValidationError("回滚需要连接 PostgreSQL");
    // 回滚是项目管理动作，普通 contributor/maintainer 不能绕过审核直接写保护分支。
    const projectRows = await this.lookupProject(databaseUrl, projectKey);
    if (!projectRows) throw new ValidationError("公开项目不存在");
    await this.authorization.assertProjectAction(actor, projectRows.id, "manage_project");
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 5 });
    try { return await sql.begin((tx) => this.revertInTransaction(tx, projectRows.id, commitKey, actor)); }
    finally { await sql.end({ timeout: 5 }); }
  }

  private async lookupProject(databaseUrl: string, projectKey: string): Promise<{ id: string } | null> {
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 5 });
    try {
      const rows = await sql<{ id: string }[]>`SELECT id FROM knowledge_project WHERE (id=${projectKey} OR slug=${projectKey}) AND visibility='public' AND status='published' LIMIT 1`;
      return rows[0] ? { id: String(rows[0].id) } : null;
    } finally { await sql.end({ timeout: 5 }); }
  }

  private async revertInTransaction(tx: TransactionSql, projectId: string, commitId: string, actor: AuthenticatedActor): Promise<PublicRevertResult> {
    await tx`SET CONSTRAINTS ALL DEFERRED`;
    const branches = await tx<Row[]>`SELECT id, head_commit_id, version, name FROM knowledge_branch WHERE project_id=${projectId} AND name=(SELECT default_branch_name FROM knowledge_project WHERE id=${projectId}) AND is_protected=TRUE FOR UPDATE`;
    const branch = branches[0];
    if (!branch) throw new ValidationError("公开主分支不存在");
    if (text(branch.head_commit_id) !== commitId) throw new ValidationError("只允许回滚当前公开主分支最新 Commit；请先处理后续版本");
    const commits = await tx<Row[]>`SELECT id, parent_commit_id, message, author_user_id, created_at FROM knowledge_commit WHERE id=${commitId} AND project_id=${projectId} AND branch_id=${text(branch.id)} LIMIT 1`;
    if (!commits[0]) throw new ValidationError("公开版本不存在");
    const changes = await tx<Row[]>`SELECT cc.id, cc.node_id, cc.operation, cc.before_revision_id, cc.after_revision_id, cc.metadata, cc.position,
        before_rev.content AS before_content, before_rev.content_text AS before_content_text, before_rev.content_hash AS before_content_hash,
        after_rev.content_hash AS after_content_hash
      FROM commit_change cc
      LEFT JOIN document_revision before_rev ON before_rev.id=cc.before_revision_id
      LEFT JOIN document_revision after_rev ON after_rev.id=cc.after_revision_id
      WHERE cc.commit_id=${commitId} ORDER BY cc.position ASC, cc.id ASC`;
    if (!changes.length) throw new ValidationError("该 Commit 没有可回滚的文件变化");
    for (const change of changes) {
      inverseOperation(text(change.operation));
      const metadata = object(change.metadata);
      const before = snapshot(metadata.before);
      const operation = text(change.operation);
      if (["rename_node", "move_node", "delete_node", "restore_node"].includes(operation) && !before) throw new ValidationError("该 Commit 缺少树结构快照，无法安全回滚");
    }
    const now = new Date().toISOString(); const newCommitId = randomUUID();
    await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, change_summary, created_at)
      VALUES (${newCommitId}, ${projectId}, ${text(branch.id)}, ${nullable(branch.head_commit_id)}, ${actor.userId}, ${`回滚 ${commitId.slice(0, 8)}`}, FALSE, ${JSON.stringify({ revertedCommitId: commitId, reason: "explicit_owner_revert" })}::jsonb, ${now})`;
    let position = 0;
    for (const change of changes) {
      const operation = text(change.operation); const inverse = inverseOperation(operation); const metadata = object(change.metadata); const before = snapshot(metadata.before);
      const nodeId = text(change.node_id);
      const states = await tx<Row[]>`SELECT name, parent_node_id, position, deleted_at FROM knowledge_node_state WHERE branch_id=${text(branch.id)} AND node_id=${nodeId} FOR UPDATE`;
      if (!states[0]) throw new ValidationError("回滚目标文件已不存在，事务已取消");
      if (operation === "create_node" || operation === "duplicate_node") {
        await tx`UPDATE knowledge_node_state SET deleted_at=${now}, updated_at=${now} WHERE branch_id=${text(branch.id)} AND node_id=${nodeId}`;
      } else if (before) {
        const name = typeof before.name === "string" && before.name.trim() ? before.name : text(states[0].name);
        const parentId = before.parentId === undefined ? nullable(states[0].parent_node_id) : before.parentId ?? null;
        const deletedAt = before.deletedAt === undefined ? nullable(states[0].deleted_at) : before.deletedAt ?? null;
        const nodePosition = Number.isInteger(before.position) ? Number(before.position) : Number(states[0].position ?? 0);
        await tx`UPDATE knowledge_node_state SET name=${name}, parent_node_id=${parentId}, position=${nodePosition}, deleted_at=${deletedAt}, updated_at=${now} WHERE branch_id=${text(branch.id)} AND node_id=${nodeId}`;
      }
      let afterRevisionId: string | null = null;
      if (change.before_revision_id) {
        const currentRows = await tx<Row[]>`SELECT id FROM document_revision WHERE branch_id=${text(branch.id)} AND node_id=${nodeId} ORDER BY created_at DESC, id DESC LIMIT 1`;
        const contentText = text(change.before_content_text); const contentHash = text(change.before_content_hash);
        if (!contentHash) throw new ValidationError("回滚 Revision 缺少内容哈希");
        afterRevisionId = randomUUID();
        await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
          VALUES (${afterRevisionId}, ${projectId}, ${nodeId}, ${text(branch.id)}, ${newCommitId}, ${nullable(currentRows[0]?.id)}, ${JSON.stringify(change.before_content ?? {})}::jsonb, ${contentText}, ${contentHash}, ${actor.userId}, ${now})`;
      }
      await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
        VALUES (${randomUUID()}, ${newCommitId}, ${nodeId}, ${inverse}, ${nullable(change.after_revision_id)}, ${afterRevisionId}, ${JSON.stringify({ revertedCommitId: commitId, originalChangeId: text(change.id) })}::jsonb, ${position})`;
      position += 1;
    }
    const updated = await tx<Row[]>`UPDATE knowledge_branch SET head_commit_id=${newCommitId}, version=version+1, updated_at=${now} WHERE id=${text(branch.id)} AND version=${Number(branch.version)} RETURNING id, version`;
    if (!updated[0]) throw new ValidationError("主分支版本已变化，请重新加载后回滚");
    return { commit: { id: newCommitId, projectId, branchId: text(branch.id), parentCommitId: nullable(branch.head_commit_id), authorUserId: actor.userId, message: `回滚 ${commitId.slice(0, 8)}`, createdAt: now }, revertedCommitId: commitId, changedFiles: position };
  }
}
