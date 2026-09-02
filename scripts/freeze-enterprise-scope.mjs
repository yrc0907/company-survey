import postgres from "postgres";

/**
 * 将公开企业研究范围冻结为五个首发项目。
 *
 * 安全边界：脚本只认识迁移/seed 明确列出的企业项目 ID，不按 owner、标题
 * 或通配符猜测用户项目；社区用户、作者关系、全局关注和无项目活动不会被
 * 修改。默认模式是 dry-run，必须显式传入 --apply 才会归档。
 * 归档把项目改为 private/archived，使公开 API 不再返回其来源、文件树和统计；
 * 不物理删除 append-only 历史，并在 enterprise_scope_retirement 中保存快照。
 */

const KEEP_PROJECT_IDS = Object.freeze([
  "project-huice",
  "project-weaver",
  "project-sangfor",
  "project-sundray",
  "project-muyuan",
]);

// 现有公开企业 seed 中除五家冻结对象外的项目。这里只列已知 ID，避免误伤用户新建项目。
const RETIRE_PROJECT_IDS = Object.freeze([
  "project-youzan",
  "project-fxiaoke",
  "project-kingdee",
  "project-qianxin",
  "project-dbapp",
  "project-venustech",
  "project-dingtalk",
  "project-lark",
]);

const ALL_MANAGED_PROJECT_IDS = Object.freeze([...KEEP_PROJECT_IDS, ...RETIRE_PROJECT_IDS]);
const SEEDED_OWNER_ID = "u-yu";
const DEFAULT_BATCH = "enterprise-scope-freeze-2026-09-03";
const ADVISORY_LOCK_ID = 7916240312;

const args = process.argv.slice(2);
const applyMode = args.includes("--apply");
const checkMode = args.includes("--check");
const rollbackIndex = args.indexOf("--rollback");
const rollbackBatch = rollbackIndex >= 0 ? args[rollbackIndex + 1] : null;
const batchIndex = args.indexOf("--batch");
const batch = batchIndex >= 0 ? args[batchIndex + 1] : DEFAULT_BATCH;

if (applyMode && checkMode) throw new Error("--apply 与 --check 不能同时使用。");
if (rollbackIndex >= 0 && (applyMode || checkMode)) throw new Error("--rollback 不能与 --apply/--check 同时使用。");
if (rollbackIndex >= 0 && (!rollbackBatch || !/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(rollbackBatch))) {
  throw new Error("--rollback 必须提供合法批次 ID。");
}
if (!batch || !/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(batch)) throw new Error("--batch 只允许 3-81 位字母、数字、点、下划线或短横线。");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置；范围冻结拒绝使用内存或假持久化。");

function toPlainRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
}

async function assertLedgerExists(sql) {
  const rows = await sql`SELECT to_regclass('public.enterprise_scope_freeze_batch') AS batch_table,
    to_regclass('public.enterprise_scope_retirement') AS retirement_table`;
  if (!rows[0]?.batch_table || !rows[0]?.retirement_table) {
    throw new Error("缺少 030_enterprise_scope_freeze.sql 账本，请先运行 db:migrate；本脚本不会自行建表。");
  }
}

async function readScope(sql) {
  // 保存完整项目行而不是只保存状态列，便于审计确认和未来扩展回滚；实际恢复仍只改安全的状态字段。
  const rows = await sql`SELECT p.*
    FROM knowledge_project p
    WHERE p.id = ANY(${sql.array(ALL_MANAGED_PROJECT_IDS)}::text[])
    ORDER BY p.id`;
  const known = new Map(rows.map((row) => [String(row.id), row]));
  const missingKeep = KEEP_PROJECT_IDS.filter((id) => !known.has(id));
  const missingRetire = RETIRE_PROJECT_IDS.filter((id) => !known.has(id));
  // 只报告而不自动接管未在 seed 清单中出现的项目；apply 会拒绝，以免把用户项目误当旧 seed。
  const unmanagedRows = await sql`SELECT p.id, p.title, p.owner_user_id, p.visibility, p.status, p.category
    FROM knowledge_project p
    WHERE p.category = '企业' AND p.visibility = 'public' AND p.status = 'published'
      AND p.id <> ALL(${sql.array(ALL_MANAGED_PROJECT_IDS)}::text[])
    ORDER BY p.id`;
  const unsafeRetireRows = rows.filter((row) => RETIRE_PROJECT_IDS.includes(String(row.id))
    && (String(row.owner_user_id) !== SEEDED_OWNER_ID || String(row.category) !== "企业"));
  return { rows, known, missingKeep, missingRetire, unmanagedRows, unsafeRetireRows };
}

function preview(scope) {
  const candidates = scope.rows.filter((row) => RETIRE_PROJECT_IDS.includes(String(row.id)));
  const alreadyArchived = candidates.filter((row) => String(row.visibility) === "private" && String(row.status) === "archived");
  const activeCandidates = candidates.filter((row) => !alreadyArchived.includes(row));
  return {
    mode: "dry-run",
    keepProjectIds: KEEP_PROJECT_IDS,
    retireProjectIds: RETIRE_PROJECT_IDS,
    keepFound: KEEP_PROJECT_IDS.filter((id) => scope.known.has(id)),
    retireFound: RETIRE_PROJECT_IDS.filter((id) => scope.known.has(id)),
    missingKeep: scope.missingKeep,
    missingRetire: scope.missingRetire,
    unsafeRetire: scope.unsafeRetireRows.map((row) => ({ id: String(row.id), ownerUserId: String(row.owner_user_id), category: String(row.category) })),
    unmanagedPublicEnterpriseProjects: scope.unmanagedRows.map((row) => ({ id: String(row.id), title: String(row.title), ownerUserId: String(row.owner_user_id) })),
    wouldArchive: activeCandidates.map((row) => ({ id: String(row.id), title: String(row.title), visibility: String(row.visibility), status: String(row.status) })),
    alreadyArchived: alreadyArchived.map((row) => String(row.id)),
    note: "未执行写入。使用 --apply 才会归档；使用 --rollback <batch> 可恢复对应批次。",
  };
}

async function applyScope(sql, scope) {
  if (scope.missingKeep.length > 0 || scope.missingRetire.length > 0) {
    throw new Error(`企业 seed 清单不完整，拒绝 apply。缺失保留=${scope.missingKeep.join(",") || "无"}；缺失待归档=${scope.missingRetire.join(",") || "无"}`);
  }
  if (scope.unsafeRetireRows.length > 0) {
    throw new Error(`待归档项目已被转移或改作其他分类，拒绝覆盖：${scope.unsafeRetireRows.map((row) => row.id).join(",")}`);
  }
  if (scope.unmanagedRows.length > 0) {
    throw new Error(`发现未纳入清单的公开企业项目（${scope.unmanagedRows.map((row) => row.id).join(",")}），拒绝自动接管；请先确认其范围。`);
  }

  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_ID})`;
    const existingBatch = await tx`SELECT status FROM enterprise_scope_freeze_batch WHERE batch_id = ${batch} FOR UPDATE`;
    if (existingBatch[0]?.status === "rolled_back") throw new Error(`批次 ${batch} 已回滚，请使用新的批次 ID，避免覆盖审计记录。`);

    await tx`INSERT INTO enterprise_scope_freeze_batch
      (batch_id, keep_project_ids, candidate_project_ids, status, metadata)
      VALUES (${batch}, ${tx.array(KEEP_PROJECT_IDS)}::text[], ${tx.array(RETIRE_PROJECT_IDS)}::text[], 'planned',
        ${JSON.stringify({ policy: "known-seed-only", reason: "首发范围冻结", keepCount: KEEP_PROJECT_IDS.length })}::jsonb)
      ON CONFLICT (batch_id) DO NOTHING`;

    for (const id of RETIRE_PROJECT_IDS) {
      const row = scope.known.get(id);
      if (!row) throw new Error(`项目 ${id} 在 apply 前消失，事务终止。`);
      await tx`INSERT INTO enterprise_scope_retirement
        (batch_id, project_id, previous_visibility, previous_status, previous_updated_at,
         previous_verification, previous_verification_note, project_snapshot)
        VALUES (${batch}, ${id}, ${String(row.visibility)}, ${String(row.status)}, ${row.updated_at},
          ${row.verification ? String(row.verification) : null},
          ${row.verification_note ? String(row.verification_note) : null},
          ${JSON.stringify(toPlainRow(row))}::jsonb)
        ON CONFLICT (batch_id, project_id) DO NOTHING`;
    }

    const updateRows = await tx`UPDATE knowledge_project
      SET visibility = 'private', status = 'archived',
          verification_note = CASE
            WHEN verification_note LIKE ${`%范围冻结批次 ${batch}%`} THEN verification_note
            ELSE verification_note || ${`\n范围冻结批次 ${batch}：该历史企业项目已从公开首发范围归档，原始资料保留用于回滚与审计。`}
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ANY(${tx.array(RETIRE_PROJECT_IDS)}::text[])
      RETURNING id`;

    const publicRows = await tx`SELECT id FROM knowledge_project
      WHERE category = '企业' AND visibility = 'public' AND status = 'published'
      ORDER BY id`;
    const unexpectedAfterApply = publicRows.filter((row) => !KEEP_PROJECT_IDS.includes(String(row.id)));
    if (unexpectedAfterApply.length > 0) {
      throw new Error(`归档后仍有未冻结的公开企业项目：${unexpectedAfterApply.map((row) => row.id).join(",")}；事务回滚。`);
    }

    await tx`UPDATE enterprise_scope_freeze_batch
      SET status = 'applied', applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP),
          metadata = metadata || ${JSON.stringify({ archivedCount: updateRows.length })}::jsonb
      WHERE batch_id = ${batch}`;

    return { mode: "apply", batch, archivedProjectIds: updateRows.map((row) => String(row.id)), archivedCount: updateRows.length, keptProjectIds: KEEP_PROJECT_IDS };
  });
}

async function rollbackScope(sql, rollbackBatchId) {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_ID})`;
    const batchRows = await tx`SELECT status FROM enterprise_scope_freeze_batch WHERE batch_id = ${rollbackBatchId} FOR UPDATE`;
    if (!batchRows[0]) throw new Error(`找不到范围冻结批次 ${rollbackBatchId}。`);
    const pending = await tx`SELECT project_id, previous_visibility, previous_status,
        previous_verification, previous_verification_note, restored_at
      FROM enterprise_scope_retirement
      WHERE batch_id = ${rollbackBatchId} AND restored_at IS NULL
      ORDER BY project_id
      FOR UPDATE`;
    for (const row of pending) {
      const currentRows = await tx`SELECT visibility, status FROM knowledge_project WHERE id = ${row.project_id} FOR UPDATE`;
      const current = currentRows[0];
      // 用户若在归档后主动改变可见性/状态，回滚不覆盖其新决定，整个事务安全失败。
      if (!current || String(current.visibility) !== "private" || String(current.status) !== "archived") {
        throw new Error(`项目 ${row.project_id} 已不是本批次归档状态，拒绝覆盖当前变更。`);
      }
      await tx`UPDATE knowledge_project
        SET visibility = ${row.previous_visibility}, status = ${row.previous_status},
            verification = COALESCE(${row.previous_verification}, verification),
            verification_note = COALESCE(${row.previous_verification_note}, verification_note),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${row.project_id}`;
      await tx`UPDATE enterprise_scope_retirement SET restored_at = CURRENT_TIMESTAMP
        WHERE batch_id = ${rollbackBatchId} AND project_id = ${row.project_id}`;
    }
    await tx`UPDATE enterprise_scope_freeze_batch SET status = 'rolled_back', rolled_back_at = COALESCE(rolled_back_at, CURRENT_TIMESTAMP)
      WHERE batch_id = ${rollbackBatchId}`;
    return { mode: "rollback", batch: rollbackBatchId, restoredProjectIds: pending.map((row) => String(row.project_id)), restoredCount: pending.length };
  });
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  try {
    await assertLedgerExists(sql);
    if (rollbackBatch) {
      console.log(JSON.stringify(await rollbackScope(sql, rollbackBatch), null, 2));
      return;
    }
    const scope = await readScope(sql);
    if (!applyMode) {
      const result = preview(scope);
      result.mode = checkMode ? "check" : "dry-run";
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(JSON.stringify(await applyScope(sql, scope), null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "企业范围冻结失败");
  process.exitCode = 1;
});
