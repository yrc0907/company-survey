import postgres from "postgres";

import { diffText } from "@/lib/domain/collaboration/diff";
import type { TextDiffHunk } from "@/lib/domain/collaboration/types";

/** 公开版本 Diff 的一侧；只包含已进入保护分支的公开修订，不暴露 OSS 原件。 */
export interface PublicHistoryChangeSide {
  revisionId: string | null;
  name: string | null;
  parentNodeId: string | null;
  contentText: string;
  contentHash: string | null;
  truncated: boolean;
}

/** 公开 Commit 的单个文件/节点变化。metadata 只保留可导航的合并申请 ID。 */
export interface PublicHistoryChange {
  id: string;
  nodeId: string;
  operation: string;
  currentName: string | null;
  before: PublicHistoryChangeSide | null;
  after: PublicHistoryChangeSide | null;
  hunks: TextDiffHunk[];
  mergeRequestId: string | null;
}

export interface PublicHistoryCommitDetail {
  projectId: string;
  commit: {
    id: string;
    parentCommitId: string | null;
    message: string;
    aiAssisted: boolean;
    author: { id: string; username: string; displayName: string };
    createdAt: string;
  };
  changes: PublicHistoryChange[];
  source: "postgres";
}

type Row = Record<string, unknown>;

const MAX_DIFF_TEXT = 20_000;
const MAX_DIFF_LINES = 400;

function text(value: unknown): string { return value == null ? "" : String(value); }
function nullable(value: unknown): string | null { return value == null || value === "" ? null : String(value); }
function bool(value: unknown): boolean { return value === true || value === "true"; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

function clipped(value: unknown): { value: string; truncated: boolean } {
  const source = text(value);
  return source.length > MAX_DIFF_TEXT ? { value: source.slice(0, MAX_DIFF_TEXT), truncated: true } : { value: source, truncated: false };
}

/** diffText 使用确定性 LCS；行数上限避免恶意换行正文造成 O(n²) 内存峰值。 */
function diffInput(value: string): string {
  return value.slice(0, MAX_DIFF_TEXT).split("\n").slice(0, MAX_DIFF_LINES).join("\n");
}

function side(row: Row, prefix: "before" | "after"): PublicHistoryChangeSide | null {
  const revisionId = nullable(row[`${prefix}_revision_id`]);
  const metadata = object(row.metadata);
  const snapshot = object(metadata[prefix]);
  const content = clipped(row[`${prefix}_content_text`]);
  const name = nullable(snapshot.name) ?? nullable(row[`${prefix}_name`]);
  const parentNodeId = nullable(snapshot.parentId) ?? nullable(snapshot.parent_node_id) ?? nullable(row[`${prefix}_parent_node_id`]);
  const contentHash = nullable(row[`${prefix}_content_hash`]) ?? nullable(snapshot.contentHash) ?? nullable(snapshot.content_hash);
  // rename/move/delete 等树操作没有 Revision，但 metadata 仍有 before/after 快照，需保留该侧以便审核者理解变化。
  if (!revisionId && !name && !parentNodeId && !content.value) return null;
  return { revisionId, name, parentNodeId, contentText: content.value, contentHash, truncated: content.truncated };
}

/**
 * 读取公开主分支单个 Commit 的逐文件 Diff。
 * 只接受 public/published 项目的 protected branch；草稿分支、私有项目和
 * 不活跃账号统一返回 null，避免把未审核正文通过历史接口泄漏出去。
 */
export class PublicHistoryDetailService {
  public async get(projectIdOrSlug: string, commitId: string): Promise<PublicHistoryCommitDetail | null> {
    const projectKey = projectIdOrSlug.trim();
    const commitKey = commitId.trim();
    if (!projectKey || projectKey.length > 160 || !commitKey || commitKey.length > 160) return null;
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) return null;
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 5 });
    try {
      const commitRows = await sql<Row[]>`
        SELECT c.id, c.project_id, c.parent_commit_id, c.message, c.ai_assisted, c.created_at,
          u.id AS author_id, p.username, p.display_name
        FROM knowledge_commit c
        JOIN knowledge_branch b ON b.id = c.branch_id AND b.project_id = c.project_id AND b.is_protected = TRUE
        JOIN knowledge_project k ON k.id = c.project_id AND k.visibility = 'public' AND k.status = 'published'
          AND (k.id = ${projectKey} OR k.slug = ${projectKey})
        JOIN platform_user u ON u.id = c.author_user_id AND u.status = 'active'
        JOIN platform_profile p ON p.user_id = u.id
        WHERE c.id = ${commitKey}
        LIMIT 1`;
      const commit = commitRows[0];
      if (!commit) return null;

      const rows = await sql<Row[]>`
        SELECT cc.id, cc.node_id, cc.operation, cc.metadata,
          ns.name AS current_name,
          before_rev.id AS before_revision_id, before_rev.content_text AS before_content_text,
          before_rev.content_hash AS before_content_hash,
          after_rev.id AS after_revision_id, after_rev.content_text AS after_content_text,
          after_rev.content_hash AS after_content_hash
        FROM commit_change cc
        JOIN knowledge_node n ON n.id = cc.node_id AND n.project_id = ${text(commit.project_id)}
        LEFT JOIN knowledge_node_state ns ON ns.branch_id = (SELECT branch_id FROM knowledge_commit WHERE id = ${commitKey})
          AND ns.node_id = cc.node_id
        LEFT JOIN document_revision before_rev ON before_rev.id = cc.before_revision_id
        LEFT JOIN document_revision after_rev ON after_rev.id = cc.after_revision_id
        WHERE cc.commit_id = ${commitKey}
        ORDER BY cc.position ASC, cc.id ASC
        LIMIT 200`;

      const changes = rows.map((row) => {
        const before = side(row, "before");
        const after = side(row, "after");
        const beforeText = before?.contentText ?? "";
        const afterText = after?.contentText ?? "";
        const metadata = object(row.metadata);
        return {
          id: text(row.id),
          nodeId: text(row.node_id),
          operation: text(row.operation),
          currentName: nullable(row.current_name),
          before,
          after,
          hunks: diffText(diffInput(beforeText), diffInput(afterText)),
          mergeRequestId: nullable(metadata.mergeRequestId) ?? nullable(metadata.merge_request_id),
        } satisfies PublicHistoryChange;
      });
      return {
        projectId: text(commit.project_id),
        commit: {
          id: text(commit.id),
          parentCommitId: nullable(commit.parent_commit_id),
          message: text(commit.message),
          aiAssisted: bool(commit.ai_assisted),
          author: { id: text(commit.author_id), username: text(commit.username), displayName: text(commit.display_name) },
          createdAt: new Date(text(commit.created_at)).toISOString(),
        },
        changes,
        source: "postgres",
      };
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
