import postgres from "postgres";

export interface PublicHistoryCommit {
  id: string;
  message: string;
  author: { id: string; username: string; displayName: string };
  createdAt: string;
  changedFiles: number;
}

/** 公开主分支历史只读服务；只返回 Commit 元数据和变更文件数，不返回草稿或私有正文。 */
export class PublicHistoryService {
  public async list(projectIdOrSlug: string, limit = 50): Promise<{ projectId: string; commits: PublicHistoryCommit[]; source: "postgres" }> {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) return { projectId: projectIdOrSlug, commits: [], source: "postgres" };
    const sql = postgres(databaseUrl, { max: 1, idle_timeout: 10, connect_timeout: 5 });
    try {
      const projects = await sql<{ id: string }[]>`SELECT id FROM knowledge_project WHERE (id=${projectIdOrSlug} OR slug=${projectIdOrSlug}) AND visibility='public' AND status='published' LIMIT 1`;
      if (!projects[0]) return { projectId: projectIdOrSlug, commits: [], source: "postgres" };
      const bounded = Math.min(100, Math.max(1, Math.trunc(limit)));
      const rows = await sql<{ id: string; message: string; author_id: string; username: string; display_name: string; created_at: string; changed_files: string }[]>`
        SELECT c.id, c.message, u.id AS author_id, p.username, p.display_name, c.created_at::text,
          COUNT(cc.id)::text AS changed_files
        FROM knowledge_commit c
        JOIN knowledge_branch b ON b.id=c.branch_id AND b.project_id=c.project_id AND b.is_protected=TRUE
        JOIN knowledge_project k ON k.id=c.project_id AND k.visibility='public' AND k.status='published'
        JOIN platform_user u ON u.id=c.author_user_id AND u.status='active'
        JOIN platform_profile p ON p.user_id=u.id
        LEFT JOIN commit_change cc ON cc.commit_id=c.id
        WHERE c.project_id=${projects[0].id}
        GROUP BY c.id, c.message, u.id, p.username, p.display_name, c.created_at
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${bounded}`;
      return { projectId: projects[0].id, commits: rows.map((row) => ({ id: String(row.id), message: String(row.message), author: { id: String(row.author_id), username: String(row.username), displayName: String(row.display_name) }, createdAt: new Date(row.created_at).toISOString(), changedFiles: Math.max(0, Number(row.changed_files) || 0) })), source: "postgres" };
    } finally { await sql.end({ timeout: 5 }); }
  }
}
