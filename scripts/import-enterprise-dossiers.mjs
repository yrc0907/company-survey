import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";

/**
 * 将仓库中的五份独立 Markdown 报告导入公开知识项目。
 * 输入：项目根目录下 docs/enterprise-research/*.md 与 DATABASE_URL。
 * 输出：每个项目一个根级 markdown 节点、一个可追溯 Commit/Revision 和公开项目状态。
 * 副作用：隐藏旧的文件夹/章节投影，不删除来源、版本或审计记录；重复执行幂等。
 */
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置");

const rootDir = process.cwd();
const dossierDir = join(rootDir, "docs", "enterprise-research");
const dossiers = [
  ["project-huice", "慧策掌上先机", "慧策掌上先机-2026独立研究.md"],
  ["project-weaver", "泛微网络", "泛微网络-2026独立研究.md"],
  ["project-sangfor", "深信服", "深信服-2026独立研究.md"],
  ["project-sundray", "信锐科技", "信锐科技-2026独立研究.md"],
  ["project-muyuan", "牧原食品", "牧原食品-2026独立研究.md"],
];

const now = new Date().toISOString();
const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const tiptapDocument = (text, nodeId) => ({
  type: "doc",
  content: [{
    type: "paragraph",
    attrs: { evidenceState: "needs_verification", blockId: `${nodeId}:block:1` },
    content: [{ type: "text", text }],
  }],
});

async function importDossier(tx, [projectId, company, fileName]) {
  const markdown = await readFile(join(dossierDir, fileName), "utf8");
  const contentHash = hash(markdown);
  const projectRows = await tx`SELECT id, owner_user_id, default_branch_name, title
    FROM knowledge_project WHERE id=${projectId} LIMIT 1`;
  const project = projectRows[0];
  if (!project) return { projectId, status: "skipped", reason: "project_missing" };

  const branchRows = await tx`SELECT id, head_commit_id, version
    FROM knowledge_branch WHERE project_id=${projectId} AND name=${String(project.default_branch_name)} LIMIT 1`;
  const branch = branchRows[0];
  if (!branch) return { projectId, status: "skipped", reason: "main_branch_missing" };

  const nodeId = `${projectId}-dossier-markdown-v1`;
  const commitId = `${projectId}-dossier-markdown-v1`;
  const revisionId = `${nodeId}-revision-v1`;
  const existingCommit = await tx`SELECT id FROM knowledge_commit WHERE id=${commitId} LIMIT 1`;

  // 恢复公开状态是用户刚刚明确确认的动作；不改写 owner、许可证或统计事实。
  await tx`UPDATE knowledge_project
    SET visibility='public', status='published', published_at=COALESCE(published_at, ${now}), updated_at=${now}
    WHERE id=${projectId}`;

  if (existingCommit.length) {
    const existingNode = await tx`SELECT id FROM knowledge_node WHERE id=${nodeId} LIMIT 1`;
    if (existingNode.length) return { projectId, status: "skipped", reason: "already_imported", contentHash };
  }

  // 旧版文件夹、章节、来源节点仍保留在审计账本中，但从公开文件树隐藏，避免出现重复目录。
  await tx`UPDATE knowledge_node_state
    SET deleted_at=COALESCE(deleted_at, ${now}), updated_at=${now}
    WHERE project_id=${projectId} AND branch_id=${String(branch.id)} AND deleted_at IS NULL`;

  await tx`INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
    VALUES (${nodeId}, ${projectId}, 'markdown', ${String(project.owner_user_id)}, ${now})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node_state
    (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
    VALUES (${projectId}, ${String(branch.id)}, ${nodeId}, NULL, ${fileName}, 1, NULL, ${now})
    ON CONFLICT (branch_id, node_id) DO UPDATE SET name=EXCLUDED.name, parent_node_id=NULL, position=1, deleted_at=NULL, updated_at=EXCLUDED.updated_at`;

  await tx`INSERT INTO knowledge_commit
    (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, created_at)
    VALUES (${commitId}, ${projectId}, ${String(branch.id)}, ${branch.head_commit_id ? String(branch.head_commit_id) : null}, ${String(project.owner_user_id)}, ${`导入${company}完整 Markdown 研究报告`}, FALSE, ${now})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO document_revision
    (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
    VALUES (${revisionId}, ${projectId}, ${nodeId}, ${String(branch.id)}, ${commitId}, NULL, ${JSON.stringify(tiptapDocument(markdown, nodeId))}::jsonb, ${markdown}, ${contentHash}, ${String(project.owner_user_id)}, ${now})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO commit_change
    (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
    VALUES (${`${commitId}:create:${nodeId}`}, ${commitId}, ${nodeId}, 'create_node', NULL, ${revisionId}, ${JSON.stringify({ kind: "markdown", name: fileName, contentHash, source: "repository_dossier" })}::jsonb, 0)
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO content_attribution
    (id, project_id, node_id, block_id, origin_commit_id, last_touch_commit_id, contributor_user_id, reviewer_user_id, merge_request_id, active, created_at, updated_at)
    VALUES (${`${commitId}:attribution:${nodeId}`}, ${projectId}, ${nodeId}, ${`${nodeId}:block:1`}, ${commitId}, ${commitId}, ${String(project.owner_user_id)}, NULL, NULL, TRUE, ${now}, ${now})
    ON CONFLICT DO NOTHING`;
  await tx`UPDATE knowledge_branch SET head_commit_id=${commitId}, version=GREATEST(version, ${Number(branch.version ?? 1) + 1}), updated_at=${now} WHERE id=${String(branch.id)}`;
  return { projectId, status: "imported", fileName, contentHash, bytes: Buffer.byteLength(markdown, "utf8") };
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 20, idle_timeout: 20 });
  const result = { imported: 0, skipped: 0, failed: 0, details: [] };
  try {
    await sql.begin(async (tx) => {
      for (const dossier of dossiers) {
        try {
          const outcome = await importDossier(tx, dossier);
          result.details.push(outcome);
          if (outcome.status === "imported") result.imported += 1;
          else result.skipped += 1;
        } catch (error) {
          result.failed += 1;
          result.details.push({ projectId: dossier[0], status: "failed", reason: error instanceof Error ? error.message : "unknown" });
        }
      }
      if (result.failed) throw new Error(`企业报告导入失败 ${result.failed} 个项目`);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "enterprise dossier import failed");
  process.exitCode = 1;
});
