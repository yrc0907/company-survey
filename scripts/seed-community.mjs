import { createHash } from "node:crypto";

import postgres from "postgres";

/**
 * 可重复运行的社区场景 seed。
 *
 * 该脚本只读取数据库中已经存在、由真实注册流程产生的 active 账号，再为
 * 五家冻结企业建立可回溯的协作场景。脚本绝不创建 platform_user/profile、
 * 密码或邮箱，也不冒充企业客户、市场指标或外部用户。所有写入都在一个
 * 事务中完成，实体 ID 和事件目标稳定，重跑不会重复计数。
 */

const DEFAULT_BATCH = "community-2026-09-five-v1";
const batch = process.argv.includes("--batch")
  ? process.argv[process.argv.indexOf("--batch") + 1]
  : process.env.COMMUNITY_SEED_BATCH || DEFAULT_BATCH;
const mode = process.argv.includes("--clean") ? "clean" : process.argv.includes("--check") ? "check" : "upsert";
const retireLegacyUsers = process.argv.includes("--retire-legacy-users");
if (!batch || !/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(batch)) {
  throw new Error("COMMUNITY_SEED_BATCH 只允许 3-81 位字母、数字、点、下划线或短横线。");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置，社区 seed 拒绝使用内存或假持久化。");

const now = "2026-09-03T12:00:00.000Z";

/** 首发范围唯一清单；其他企业项目由范围冻结脚本另行归档。 */
const projects = [
  ["project-huice", "huice"],
  ["project-weaver", "weaver"],
  ["project-sangfor", "sangfor"],
  ["project-sundray", "sundray"],
  ["project-muyuan", "muyuan"],
];

let participants = [];
const viewDays = ["2026-08-31", "2026-08-24", "2026-08-17", "2026-08-03", "2026-07-04", "2026-05-10", "2026-02-14", "2025-12-20"];

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const userId = (index) => participants[index % participants.length]?.id;
const isoFor = (projectIndex, offset = 0) => `2026-08-${String(31 - ((projectIndex * 3 + offset) % 20)).padStart(2, "0")}T${String(8 + ((projectIndex + offset) % 10)).padStart(2, "0")}:00:00.000Z`;

/** 写内部追踪索引；冲突时只复活同一实体的 seed 记录，不触碰业务正文。 */
async function markSeed(tx, entityType, entityId, sourceKind = "community_scenario", payload = {}) {
  const existing = await tx`SELECT seed_batch, retired_at FROM community_seed_record
    WHERE entity_type = ${entityType} AND entity_id = ${entityId} LIMIT 1`;
  if (existing[0] && existing[0].retired_at == null && String(existing[0].seed_batch) !== batch) {
    throw new Error(`实体 ${entityType}/${entityId} 已属于活动批次 ${existing[0].seed_batch}；请先执行 --clean --batch ${existing[0].seed_batch}，避免跨批次覆盖。`);
  }
  await tx`INSERT INTO community_seed_record (entity_type, entity_id, seed_batch, source_kind, payload, created_at, retired_at)
    VALUES (${entityType}, ${entityId}, ${batch}, ${sourceKind}, ${JSON.stringify(payload)}::jsonb, ${now}, NULL)
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET seed_batch = EXCLUDED.seed_batch,
      source_kind = EXCLUDED.source_kind, payload = EXCLUDED.payload, retired_at = NULL`;
}

/** activity_event 由既有数据库触发器追加；这里将其 ID 记录到 seed 索引，便于审计回溯。 */
async function markActivity(tx, targetId, actorId, eventType) {
  const rows = await tx`SELECT id FROM activity_event
    WHERE target_id = ${targetId} AND actor_user_id = ${actorId} AND event_type = ${eventType}
    ORDER BY occurred_at DESC, id DESC LIMIT 8`;
  for (const row of rows) await markSeed(tx, "activity_event", String(row.id), "community_activity", { targetId, actorId, eventType });
}

function documentContent(text) {
  return {
    type: "doc",
    content: [{ type: "paragraph", attrs: { evidenceState: "needs_verification" }, content: [{ type: "text", text }] }],
  };
}

/** 在既有文档结构末尾追加一个段落，避免 seed 的贡献 Commit 覆盖公开正文。 */
function appendDocumentContent(baseContent, text) {
  if (baseContent && typeof baseContent === "object" && Array.isArray(baseContent.content)) {
    return {
      ...baseContent,
      content: [...baseContent.content, { type: "paragraph", attrs: { evidenceState: "needs_verification" }, content: [{ type: "text", text }] }],
    };
  }
  return documentContent(text);
}

/**
 * 读取真实账号作为参与者；显式 ID 可用 COMMUNITY_SEED_USER_IDS 指定，
 * 未指定时选择所有 active 账号（排除历史 synthetic community-user-*）。
 * 不足三个账号时 fail-closed，避免用一个账号伪造多人协作。
 */
async function loadRealUsers(tx) {
  const requested = (process.env.COMMUNITY_SEED_USER_IDS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const rows = requested.length
    ? await tx`SELECT u.id, u.email, u.status, p.username, p.display_name, p.avatar_asset_id
        FROM platform_user u JOIN platform_profile p ON p.user_id = u.id
        WHERE u.status = 'active' AND u.id = ANY(${tx.array(requested)}::text[])
        ORDER BY u.created_at, u.id`
    : await tx`SELECT u.id, u.email, u.status, p.username, p.display_name, p.avatar_asset_id
        FROM platform_user u JOIN platform_profile p ON p.user_id = u.id
        WHERE u.status = 'active'
          AND u.id NOT LIKE 'community-user-%'
          AND u.email NOT LIKE '%@community.research.invalid'
        ORDER BY u.created_at, u.id`;
  const found = new Set(rows.map((row) => String(row.id)));
  const missing = requested.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`COMMUNITY_SEED_USER_IDS 包含不存在或非 active 账号：${missing.join(",")}`);
  participants = rows.map((row) => ({
    id: String(row.id), username: String(row.username), displayName: String(row.display_name),
    avatarAssetId: row.avatar_asset_id ? String(row.avatar_asset_id) : null,
  }));
  if (participants.length < 3) {
    throw new Error(`社区 seed 需要至少 3 个真实 active 账号，当前仅 ${participants.length} 个；不会创建虚构用户。`);
  }
  for (const participant of participants) {
    await markSeed(tx, "community_participant", participant.id, "real_account", { username: participant.username });
  }
  return participants;
}

/** 为公开项目分配场景 owner/maintainer/contributor；仅接管首发 u-yu，避免覆盖真实转移。 */
async function seedProjectMembersAndOwners(tx) {
  const assignments = [];
  for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
    const [projectId] = projects[projectIndex];
    const rows = await tx`SELECT owner_user_id FROM knowledge_project p
      JOIN platform_user u ON u.id = p.owner_user_id AND u.status = 'active'
      WHERE p.id = ${projectId} AND p.visibility = 'public' AND p.status = 'published' LIMIT 1`;
    if (!rows[0]) continue;
    // 保留项目当前真实 owner，不把研究对象归属转移给 seed 账号。
    const owner = String(rows[0].owner_user_id);
    if (owner.startsWith("community-user-")) throw new Error(`项目 ${projectId} 的 owner 是历史 synthetic 账号，请先清理后再 seed。`);
    const previousOwner = String(rows[0].owner_user_id);
    const priorAssignment = await tx`SELECT payload FROM community_seed_record
      WHERE entity_type = 'project_owner_assignment' AND entity_id = ${projectId} LIMIT 1`;
    const originalOwner = priorAssignment[0]?.payload && typeof priorAssignment[0].payload === "object"
      ? String(priorAssignment[0].payload.previousOwner ?? previousOwner)
      : previousOwner;
    await tx`INSERT INTO project_member (project_id, user_id, role, created_at)
      VALUES (${projectId}, ${owner}, 'owner', ${isoFor(projectIndex, 0)})
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'`;
    await markSeed(tx, "project_owner_assignment", projectId, "community_project_owner", { previousOwner: originalOwner, assignedOwner: owner });
    await markSeed(tx, "project_member", `${projectId}:${owner}`, "community_project_member", { projectId, userId: owner, role: "owner" });

    const collaborators = participants.filter((participant) => participant.id !== owner);
    if (collaborators.length < 2) {
      throw new Error(`项目 ${projectId} 需要三个不同的真实账号承担 owner/maintainer/contributor。`);
    }
    const maintainer = collaborators[projectIndex % collaborators.length]?.id;
    const contributor = collaborators[(projectIndex + 1) % collaborators.length]?.id;
    if (!maintainer || !contributor || maintainer === contributor) throw new Error(`项目 ${projectId} 无法分配两个不同的真实协作者。`);
    for (const [member, role] of [[maintainer, "maintainer"], [contributor, "contributor"]]) {
      if (member === owner) continue;
      await tx`INSERT INTO project_member (project_id, user_id, role, created_at)
        VALUES (${projectId}, ${member}, ${role}, ${isoFor(projectIndex, role === "maintainer" ? 1 : 2)})
        ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`;
      await markSeed(tx, "project_member", `${projectId}:${member}`, "community_project_member", { projectId, userId: member, role });
    }
    assignments.push({ projectId, projectIndex, owner, maintainer, contributor });
  }
  return assignments;
}

/** 为每个场景身份建立三条作者关注关系；主键保证重跑不重复。 */
async function seedFollows(tx) {
  for (let index = 0; index < participants.length; index += 1) {
    const follower = userId(index);
    for (const delta of [1, 7, 13]) {
      const followedIndex = (index + delta) % participants.length;
      const followed = userId(followedIndex);
      const createdAt = isoFor(index % projects.length, delta);
      await tx`INSERT INTO author_follow (follower_user_id, followed_user_id, active, created_at, updated_at)
        VALUES (${follower}, ${followed}, TRUE, ${createdAt}, ${createdAt})
        ON CONFLICT (follower_user_id, followed_user_id) DO NOTHING`;
      await markSeed(tx, "author_follow", `${follower}:${followed}`, "community_follow", { follower, followed });
      await markActivity(tx, `${follower}:${followed}`, follower, "author_followed");
    }
  }
}

/** 写入每个公开项目的收藏关系；触发器会追加 project_starred 活动。 */
async function seedStars(tx, assignments) {
  for (const { projectId, projectIndex, owner } of assignments) {
    let added = 0;
    let cursor = projectIndex * 4;
    while (added < 6) {
      const candidate = userId(cursor % participants.length);
      cursor += 1;
      if (candidate === owner) continue;
      const createdAt = isoFor(projectIndex, added + 3);
      await tx`INSERT INTO project_star (project_id, user_id, active, created_at, updated_at)
        VALUES (${projectId}, ${candidate}, TRUE, ${createdAt}, ${createdAt})
        ON CONFLICT (project_id, user_id) DO NOTHING`;
      await markSeed(tx, "project_star", `${projectId}:${candidate}`, "community_star", { projectId, userId: candidate });
      await markActivity(tx, `${projectId}:${candidate}`, candidate, "project_starred");
      added += 1;
    }
  }
}

/** 写入登录场景用户的按日阅读事实，并按 project_reader 重算去重统计。 */
async function seedViews(tx, assignments) {
  for (const { projectId, projectIndex } of assignments) {
    await tx`INSERT INTO project_stats (project_id, unique_readers, updated_at)
      VALUES (${projectId}, 0, ${now}) ON CONFLICT (project_id) DO NOTHING`;
    for (let readerOffset = 0; readerOffset < 8; readerOffset += 1) {
      const viewer = userId((projectIndex * 3 + readerOffset) % participants.length);
      const viewerKeyHash = sha256(`${batch}:viewer:${projectId}:${viewer}`);
      const readerRows = await tx`INSERT INTO project_reader (project_id, viewer_key_hash, viewer_user_id, first_seen_at, last_seen_at)
        VALUES (${projectId}, ${viewerKeyHash}, ${viewer}, ${isoFor(projectIndex, readerOffset + 3)}, ${now})
        ON CONFLICT (project_id, viewer_key_hash) DO NOTHING RETURNING project_id`;
      if (readerRows.length > 0) {
        await tx`UPDATE project_stats SET unique_readers = unique_readers + 1, updated_at = ${now} WHERE project_id = ${projectId}`;
      }
      await markSeed(tx, "project_reader", `${projectId}:${viewerKeyHash}`, "community_view", { projectId, viewer });
      for (const day of viewDays) {
        await tx`INSERT INTO project_view_daily (project_id, view_date, viewer_key_hash, viewer_user_id, first_seen_at, last_seen_at)
          VALUES (${projectId}, ${day}::date, ${viewerKeyHash}, ${viewer}, ${day}::timestamptz, ${now})
          ON CONFLICT (project_id, view_date, viewer_key_hash) DO NOTHING`;
        await markSeed(tx, "project_view_daily", `${projectId}:${day}:${viewerKeyHash}`, "community_view_daily", { projectId, viewer, day });
      }
    }
    // 用 project_reader 事实重算，避免脚本中断后 project_stats 只增加了一部分。
    await tx`UPDATE project_stats ps SET unique_readers = (
      SELECT COUNT(*) FROM project_reader pr WHERE pr.project_id = ps.project_id
    ), updated_at = ${now} WHERE ps.project_id = ${projectId}`;
  }
}

/** 写入项目级/锚点评论与两级回复，父子关系均指向同一项目。 */
async function seedComments(tx, assignments) {
  for (const { projectId, projectIndex, owner } of assignments) {
    const nodeRows = await tx`SELECT id FROM knowledge_node WHERE project_id = ${projectId} AND kind IN ('document', 'markdown') ORDER BY id LIMIT 1`;
    const nodeId = nodeRows[0] ? String(nodeRows[0].id) : null;
    const rootAuthor = userId((projectIndex * 5 + 14) % participants.length);
    const secondAuthor = userId((projectIndex * 5 + 19) % participants.length);
    const rootIds = [`community-comment-${projectId}-root-1`, `community-comment-${projectId}-root-2`];
    const rootBodies = [
      "建议把本章节的公开来源、抓取时间和证据状态并列展示，后续复核会更顺畅。",
      "这里的结论边界写得很清楚，可以再补一个与相邻行业方案的比较入口。",
    ];
    const rootAuthors = [rootAuthor, secondAuthor];
    for (let rootIndex = 0; rootIndex < rootIds.length; rootIndex += 1) {
      const rootId = rootIds[rootIndex];
      const author = rootAuthors[rootIndex];
      const createdAt = isoFor(projectIndex, 30 + rootIndex);
      await tx`INSERT INTO project_comment (id, project_id, parent_id, node_id, block_id, quote, author_user_id, body, idempotency_key, idempotency_fingerprint, created_at, updated_at)
        VALUES (${rootId}, ${projectId}, NULL, ${nodeId}, ${nodeId ? `${nodeId}:block:${rootIndex + 1}` : null}, ${nodeId ? "研究章节锚点" : null}, ${author}, ${rootBodies[rootIndex]}, ${`${batch}:${rootId}`}, ${sha256(`${batch}:${rootId}`)}, ${createdAt}, ${createdAt})
        ON CONFLICT (id) DO NOTHING`;
      await markSeed(tx, "project_comment", rootId, "community_comment", { projectId, author, parentId: null });
      await markActivity(tx, rootId, author, "comment_created");
      await createNotification(tx, `${rootId}:owner`, owner, author, "comment_mention", projectId, "comment", rootId, { reason: "项目维护者收到新讨论" }, createdAt);

      for (let replyIndex = 0; replyIndex < 2; replyIndex += 1) {
        const replyId = `${rootId}-reply-${replyIndex + 1}`;
        const replyAuthor = userId((projectIndex * 7 + 27 + replyIndex) % participants.length);
        const replyAt = isoFor(projectIndex, 32 + rootIndex * 2 + replyIndex);
        await tx`INSERT INTO project_comment (id, project_id, parent_id, node_id, block_id, quote, author_user_id, body, idempotency_key, idempotency_fingerprint, created_at, updated_at)
          VALUES (${replyId}, ${projectId}, ${rootId}, ${nodeId}, ${nodeId ? `${nodeId}:block:${rootIndex + 1}` : null}, ${nodeId ? "研究章节锚点" : null}, ${replyAuthor}, ${replyIndex === 0 ? "同意，引用入口应当和正文版本一起固定。" : "我补充一个待核验问题，先不把它当作事实结论。"}, ${`${batch}:${replyId}`}, ${sha256(`${batch}:${replyId}`)}, ${replyAt}, ${replyAt})
          ON CONFLICT (id) DO NOTHING`;
        await markSeed(tx, "project_comment", replyId, "community_comment_reply", { projectId, author: replyAuthor, parentId: rootId });
        await markActivity(tx, replyId, replyAuthor, "comment_created");
        await createNotification(tx, `${replyId}:parent`, author, replyAuthor, "comment_reply", projectId, "comment", rootId, { replyId }, replyAt);
      }
    }
  }
}

/** 创建可深链的站内通知；recipient 永远来自服务端场景关系。 */
async function createNotification(tx, id, recipient, actor, kind, projectId, targetType, targetId, payload, createdAt) {
  await tx`INSERT INTO platform_notification (id, recipient_user_id, actor_user_id, kind, project_id, target_type, target_id, payload, read_at, created_at)
    VALUES (${id}, ${recipient}, ${actor}, ${kind}, ${projectId}, ${targetType}, ${targetId}, ${JSON.stringify(payload)}::jsonb,
      ${kind === "comment_mention" ? createdAt : null}, ${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await markSeed(tx, "platform_notification", id, "community_notification", { recipient, actor, kind, targetType, targetId });
}

/** 模拟一次贡献分支 -> MR -> Review -> Merge，并写入不可变归因。 */
async function seedMergeFlows(tx, assignments) {
  for (const { projectId, projectIndex, owner, maintainer, contributor } of assignments) {
    const branchRows = await tx`SELECT id, head_commit_id, version FROM knowledge_branch
      WHERE project_id = ${projectId} AND name = (SELECT default_branch_name FROM knowledge_project WHERE id = ${projectId}) LIMIT 1`;
    const branch = branchRows[0];
    if (!branch) continue;
    const mainBranchId = String(branch.id);
    const parentCommit = branch.head_commit_id ? String(branch.head_commit_id) : null;
    const mainVersion = Number(branch.version ?? 1);
    const nodeRows = await tx`SELECT id FROM knowledge_node WHERE project_id = ${projectId} AND kind IN ('document', 'markdown') ORDER BY id LIMIT 1`;
    const nodeId = nodeRows[0] ? String(nodeRows[0].id) : null;
    if (!nodeId) continue;
    const revisionRows = await tx`SELECT id, content_text, content FROM document_revision
      WHERE project_id = ${projectId} AND branch_id = ${mainBranchId} AND node_id = ${nodeId}
      ORDER BY created_at DESC LIMIT 1`;
    const previousRevision = revisionRows[0] ? String(revisionRows[0].id) : null;
    const contributionNote = "补充章节证据边界与引用定位（社区协作记录，待维护者继续核验）。";
    const baseText = revisionRows[0]?.content_text ? String(revisionRows[0].content_text) : "";
    const contributionText = baseText ? `${baseText}\n\n${contributionNote}` : contributionNote;
    const content = appendDocumentContent(revisionRows[0]?.content, contributionNote);
    const contentHash = sha256(contributionText);
    const sourceBranchId = `${projectId}-community-branch-v1`;
    const sourceCommitId = `${projectId}-community-contribution-v1`;
    const sourceRevisionId = `${projectId}-community-contribution-revision-v1`;
    const sourceChangeId = `${projectId}-community-contribution-change-v1`;
    const mergeRequestId = `${projectId}-community-mr-v1`;
    const reviewId = `${projectId}-community-review-v1`;
    const mergedCommitId = `${projectId}-community-merge-v1`;
    const mergedRevisionId = `${projectId}-community-merge-revision-v1`;
    const mergedChangeId = `${projectId}-community-merge-change-v1`;
    const createdAt = isoFor(projectIndex, 40);

    await tx`INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, base_branch_id, base_commit_id, is_protected, status, version, created_at, updated_at)
      VALUES (${sourceBranchId}, ${projectId}, ${`community-${contributor}`}, ${contributor}, ${mainBranchId}, ${parentCommit}, FALSE, 'submitted', 0, ${createdAt}, ${createdAt})
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "knowledge_branch", sourceBranchId, "community_branch", { projectId, owner: contributor });
    await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
      VALUES (${sourceCommitId}, ${projectId}, ${sourceBranchId}, ${parentCommit}, ${contributor}, '补充研究章节的证据边界', FALSE,
        ${`${batch}:${sourceCommitId}`}, ${sha256(`${batch}:${sourceCommitId}`)}, ${JSON.stringify({ seed: true, sourceKind: "community_scenario", evidenceState: "needs_verification" })}::jsonb, ${createdAt})
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "knowledge_commit", sourceCommitId, "community_commit", { projectId, author: contributor });
    await markActivity(tx, sourceCommitId, contributor, "commit_created");
    await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
      VALUES (${sourceRevisionId}, ${projectId}, ${nodeId}, ${sourceBranchId}, ${sourceCommitId}, ${previousRevision}, ${JSON.stringify(content)}::jsonb, ${contributionText}, ${contentHash}, ${contributor}, ${createdAt})
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "document_revision", sourceRevisionId, "community_revision", { projectId, branchId: sourceBranchId, nodeId });
    await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
      VALUES (${sourceChangeId}, ${sourceCommitId}, ${nodeId}, 'update_content', ${previousRevision}, ${sourceRevisionId}, ${JSON.stringify({ seed: true, evidenceState: "needs_verification" })}::jsonb, 0)
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "commit_change", sourceChangeId, "community_commit_change", { projectId, commitId: sourceCommitId, nodeId });

    await tx`INSERT INTO merge_request (id, project_id, source_branch_id, target_branch_id, author_user_id, title, description, status, base_commit_id, head_commit_id, target_version, source_base_snapshot, target_base_snapshot, conflict_status, conflict_details, idempotency_key, idempotency_fingerprint, created_at, updated_at)
      VALUES (${mergeRequestId}, ${projectId}, ${sourceBranchId}, ${mainBranchId}, ${contributor}, '补充研究章节证据边界', '提交可回溯的章节修订，等待维护者审核并合并。', 'open', ${parentCommit}, ${sourceCommitId}, ${mainVersion}, '{}'::jsonb, '{}'::jsonb, 'clean', '[]'::jsonb, ${`${batch}:${mergeRequestId}`}, ${sha256(`${batch}:${mergeRequestId}`)}, ${createdAt}, ${createdAt})
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "merge_request", mergeRequestId, "community_merge_request", { projectId, author: contributor, status: "merged" });
    await markActivity(tx, mergeRequestId, contributor, "merge_request_opened");
    await createNotification(tx, `${mergeRequestId}:opened`, owner, contributor, "merge_request_opened", projectId, "merge_request", mergeRequestId, { status: "open" }, createdAt);

    await tx`INSERT INTO merge_review (id, merge_request_id, reviewer_user_id, verdict, body, node_id, block_id, idempotency_key, idempotency_fingerprint, created_at)
      VALUES (${reviewId}, ${mergeRequestId}, ${maintainer}, 'approve', '结构和证据边界清晰，合并后仍保留待核验状态。', ${nodeId}, ${`${nodeId}:block:1`}, ${`${batch}:${reviewId}`}, ${sha256(`${batch}:${reviewId}`)}, ${isoFor(projectIndex, 42)})
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "merge_review", reviewId, "community_review", { projectId, reviewer: maintainer, verdict: "approve" });
    await markActivity(tx, reviewId, maintainer, "review_submitted");
    await createNotification(tx, `${reviewId}:reviewed`, contributor, maintainer, "merge_request_reviewed", projectId, "review", reviewId, { verdict: "approve" }, isoFor(projectIndex, 42));

    const mergedCommitRows = await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
      VALUES (${mergedCommitId}, ${projectId}, ${mainBranchId}, ${parentCommit}, ${maintainer}, '合并社区贡献：补充证据边界', FALSE,
        ${`${batch}:${mergedCommitId}`}, ${sha256(`${batch}:${mergedCommitId}`)}, ${JSON.stringify({ seed: true, merged: true, mergeRequestId })}::jsonb, ${isoFor(projectIndex, 43)})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    const mergedCommitInserted = mergedCommitRows.length > 0;
    await markSeed(tx, "knowledge_commit", mergedCommitId, "community_merge_commit", { projectId, author: maintainer, mergeRequestId });
    await markActivity(tx, mergedCommitId, maintainer, "commit_created");
    await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
      VALUES (${mergedRevisionId}, ${projectId}, ${nodeId}, ${mainBranchId}, ${mergedCommitId}, ${previousRevision}, ${JSON.stringify(content)}::jsonb, ${contributionText}, ${contentHash}, ${maintainer}, ${isoFor(projectIndex, 43)})
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "document_revision", mergedRevisionId, "community_merge_revision", { projectId, branchId: mainBranchId, nodeId });
    await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
      VALUES (${mergedChangeId}, ${mergedCommitId}, ${nodeId}, 'update_content', ${previousRevision}, ${mergedRevisionId}, ${JSON.stringify({ seed: true, mergeRequestId })}::jsonb, 0)
      ON CONFLICT (id) DO NOTHING`;
    await markSeed(tx, "commit_change", mergedChangeId, "community_merge_change", { projectId, commitId: mergedCommitId, nodeId });
    await tx`INSERT INTO content_attribution (id, project_id, node_id, block_id, origin_commit_id, last_touch_commit_id, contributor_user_id, reviewer_user_id, merge_request_id, active, created_at, updated_at)
      VALUES (${`${projectId}:community-attribution-v1`}, ${projectId}, ${nodeId}, ${`${nodeId}:community-block:1`}, ${sourceCommitId}, ${mergedCommitId}, ${contributor}, ${maintainer}, ${mergeRequestId}, TRUE, ${isoFor(projectIndex, 43)}, ${isoFor(projectIndex, 43)})
      ON CONFLICT DO NOTHING`;
    await markSeed(tx, "content_attribution", `${projectId}:community-attribution-v1`, "community_attribution", { projectId, contributor, reviewer: maintainer, mergeRequestId });

    await tx`UPDATE merge_request SET status = 'merged', merged_commit_id = ${mergedCommitId}, merged_by_user_id = ${maintainer}, merged_at = ${isoFor(projectIndex, 43)}, conflict_status = 'clean', conflict_details = '[]'::jsonb, updated_at = ${isoFor(projectIndex, 43)}
      WHERE id = ${mergeRequestId} AND status <> 'merged'`;
    await markActivity(tx, mergeRequestId, maintainer, "merge_request_merged");
    await tx`UPDATE knowledge_branch SET status = 'merged', head_commit_id = ${sourceCommitId}, version = GREATEST(version, 1), updated_at = ${isoFor(projectIndex, 43)} WHERE id = ${sourceBranchId}`;
    // 重跑时 merged Commit 已存在，不能再次递增乐观锁版本；COUNT(*) 同时覆盖
    // “Commit 已写入但脚本在更新 branch 前中断”的恢复场景。
    await tx`UPDATE knowledge_branch SET head_commit_id = ${mergedCommitId},
      version = GREATEST(version, ${mainVersion + (mergedCommitInserted ? 1 : 0)},
        (SELECT COUNT(*) FROM knowledge_commit WHERE branch_id = ${mainBranchId})),
      updated_at = CASE WHEN ${mergedCommitInserted} THEN ${isoFor(projectIndex, 43)} ELSE updated_at END
      WHERE id = ${mainBranchId}`;
    await createNotification(tx, `${mergeRequestId}:merged`, contributor, maintainer, "merge_request_merged", projectId, "merge_request", mergeRequestId, { mergedCommitId }, isoFor(projectIndex, 43));
  }
}

/** 从 append-only 活动和阅读事实重建作者/项目热力图日聚合。 */
async function rebuildActivityDaily(tx) {
  await tx.unsafe(`
    WITH event_daily AS (
      SELECT actor_user_id, project_id, occurred_at::date AS day,
        COUNT(*) FILTER (WHERE event_type IN ('project_created', 'commit_created'))::int AS publish_count,
        COUNT(*) FILTER (WHERE event_type = 'merge_request_merged')::int AS merge_count,
        COUNT(*) FILTER (WHERE event_type = 'comment_created')::int AS comment_count,
        COUNT(*) FILTER (WHERE event_type = 'review_submitted')::int AS review_count,
        COUNT(*) FILTER (WHERE event_type IN ('project_starred', 'project_unstarred'))::int AS star_count,
        COUNT(*) FILTER (WHERE event_type IN ('author_followed', 'author_unfollowed'))::int AS follow_count,
        0::int AS view_count
      FROM activity_event ae
      JOIN platform_user u ON u.id = ae.actor_user_id AND u.status = 'active'
      WHERE ae.actor_user_id IN (SELECT entity_id FROM community_seed_record
        WHERE seed_batch = $1 AND entity_type = 'community_participant' AND retired_at IS NULL)
      GROUP BY actor_user_id, project_id, occurred_at::date
    ), view_daily AS (
      SELECT viewer_user_id AS actor_user_id, project_id, view_date AS day,
        0::int AS publish_count, 0::int AS merge_count, 0::int AS comment_count,
        0::int AS review_count, 0::int AS star_count, 0::int AS follow_count,
        COUNT(*)::int AS view_count
      FROM project_view_daily
      WHERE viewer_user_id IS NOT NULL
      GROUP BY viewer_user_id, project_id, view_date
    ), combined AS (
      SELECT * FROM event_daily UNION ALL SELECT * FROM view_daily
    ), aggregate_rows AS (
      SELECT actor_user_id, project_id, day,
        SUM(publish_count)::int AS publish_count, SUM(merge_count)::int AS merge_count,
        SUM(comment_count)::int AS comment_count, SUM(review_count)::int AS review_count,
        SUM(star_count)::int AS star_count, SUM(follow_count)::int AS follow_count,
        SUM(view_count)::int AS view_count,
        SUM(publish_count + merge_count + comment_count + review_count + star_count + follow_count + view_count)::int AS total_count
      FROM combined GROUP BY actor_user_id, project_id, day
    )
    INSERT INTO activity_daily (id, actor_user_id, project_id, day, publish_count, merge_count, comment_count, review_count, star_count, follow_count, view_count, total_count, public_event_version, updated_at)
      SELECT md5('activity-daily:' || actor_user_id || ':' || COALESCE(project_id, '') || ':' || day::text), actor_user_id, project_id, day,
        publish_count, merge_count, comment_count, review_count, star_count, follow_count, view_count, total_count, 1, CURRENT_TIMESTAMP
      FROM aggregate_rows
    ON CONFLICT (id) DO UPDATE SET publish_count = EXCLUDED.publish_count, merge_count = EXCLUDED.merge_count,
      comment_count = EXCLUDED.comment_count, review_count = EXCLUDED.review_count, star_count = EXCLUDED.star_count,
      follow_count = EXCLUDED.follow_count, view_count = EXCLUDED.view_count, total_count = EXCLUDED.total_count,
      public_event_version = EXCLUDED.public_event_version, updated_at = CURRENT_TIMESTAMP
  `, [batch]);
  const rows = await tx`SELECT id, actor_user_id, project_id, day, total_count FROM activity_daily
    WHERE actor_user_id IN (SELECT entity_id FROM community_seed_record
      WHERE seed_batch = ${batch} AND entity_type = 'community_participant' AND retired_at IS NULL)`;
  for (const row of rows) await markSeed(tx, "activity_daily", String(row.id), "community_activity_daily", { actorUserId: row.actor_user_id, projectId: row.project_id, day: row.day, totalCount: row.total_count });
}

/**
 * 可选退役上一版生成的 synthetic 账号。只匹配本脚本历史的固定前缀与
 * 保留域名，状态改为 deleted 而不物理删除，以保留外键和 append-only 审计。
 * 该操作必须与 --clean 一起显式传入，发布前先完成 PostgreSQL/OSS 备份。
 */
async function retireLegacySyntheticUsers(tx) {
  const rows = await tx`SELECT u.id FROM platform_user u
    WHERE u.id LIKE 'community-user-%' AND u.email LIKE '%@community.research.invalid'
      AND u.status <> 'deleted' FOR UPDATE`;
  if (!rows.length) return 0;
  const ids = rows.map((row) => String(row.id));
  await tx`UPDATE platform_user SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE id = ANY(${tx.array(ids)}::text[])`;
  await tx`UPDATE platform_profile SET display_name = '已停用账号', bio = '', updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ANY(${tx.array(ids)}::text[])`;
  return ids.length;
}

/** 退役可变场景关系；Commit/Review/activity_event 按 append-only 规则保留。 */
async function cleanBatch(tx) {
  const records = await tx`SELECT entity_type, entity_id, payload FROM community_seed_record WHERE seed_batch = ${batch} AND retired_at IS NULL ORDER BY entity_type, entity_id`;
  const comments = records.filter((row) => String(row.entity_type) === "project_comment").map((row) => String(row.entity_id));
  const stars = records.filter((row) => String(row.entity_type) === "project_star").map((row) => String(row.entity_id));
  const follows = records.filter((row) => String(row.entity_type) === "author_follow").map((row) => String(row.entity_id));
  const readers = records.filter((row) => String(row.entity_type) === "project_reader").map((row) => String(row.entity_id));
  const dailyViews = records.filter((row) => String(row.entity_type) === "project_view_daily").map((row) => String(row.entity_id));
  const notifications = records.filter((row) => String(row.entity_type) === "platform_notification").map((row) => String(row.entity_id));
  for (const id of notifications) await tx`DELETE FROM platform_notification WHERE id = ${id}`;
  // 评论是公开历史节点，清理采用软删除；回复父子关系和 activity_event 保持可审计。
  for (const id of comments) await tx`UPDATE project_comment SET body = '', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ${id}`;
  for (const key of stars) { const [projectId, userId] = key.split(":"); await tx`UPDATE project_star SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE project_id = ${projectId} AND user_id = ${userId}`; }
  for (const key of follows) { const [follower, followed] = key.split(":"); await tx`UPDATE author_follow SET active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE follower_user_id = ${follower} AND followed_user_id = ${followed}`; }
  for (const key of dailyViews) { const [, , ...hashParts] = key.split(":"); const day = key.split(":")[1]; const viewerKeyHash = hashParts.join(":"); const projectId = key.split(":")[0]; await tx`DELETE FROM project_view_daily WHERE project_id = ${projectId} AND view_date = ${day}::date AND viewer_key_hash = ${viewerKeyHash}`; }
  for (const key of readers) { const separator = key.indexOf(":"); const projectId = key.slice(0, separator); const viewerKeyHash = key.slice(separator + 1); await tx`DELETE FROM project_reader WHERE project_id = ${projectId} AND viewer_key_hash = ${viewerKeyHash}`; }
  await tx`UPDATE project_stats ps SET unique_readers = (SELECT COUNT(*) FROM project_reader pr WHERE pr.project_id = ps.project_id), updated_at = CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM community_seed_record csr WHERE csr.entity_type = 'project_reader' AND csr.entity_id LIKE ps.project_id || ':%' AND csr.seed_batch = ${batch})`;
  // Commit/Review/activity_event 是 append-only，不能物理删除；仅关闭可变协作状态并标记 seed 记录退役。
  await tx`UPDATE merge_request SET status = CASE WHEN status = 'merged' THEN status ELSE 'closed' END, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT entity_id FROM community_seed_record WHERE seed_batch = ${batch} AND entity_type = 'merge_request')`;
  await tx`UPDATE knowledge_branch SET status = CASE WHEN status = 'merged' THEN status ELSE 'closed' END, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT entity_id FROM community_seed_record WHERE seed_batch = ${batch} AND entity_type = 'knowledge_branch')`;
  await tx`UPDATE community_seed_record SET retired_at = CURRENT_TIMESTAMP WHERE seed_batch = ${batch} AND retired_at IS NULL`;
  const retiredLegacyUsers = retireLegacyUsers ? await retireLegacySyntheticUsers(tx) : 0;
  await rebuildActivityDaily(tx);
  return { retiredLegacyUsers };
}

/** 检查用户规模、项目数、关系唯一性和最低互动覆盖，失败即回滚事务。 */
async function verifyBatch(tx) {
  const result = {};
  const rows = await tx`SELECT entity_type, COUNT(*)::int AS count FROM community_seed_record WHERE seed_batch = ${batch} AND retired_at IS NULL GROUP BY entity_type ORDER BY entity_type`;
  for (const row of rows) result[String(row.entity_type)] = Number(row.count);
  const [userCount] = await tx`SELECT COUNT(*)::int AS count FROM community_seed_record
    WHERE seed_batch = ${batch} AND entity_type = 'community_participant' AND retired_at IS NULL`;
  const [syntheticActive] = await tx`SELECT COUNT(*)::int AS count FROM platform_user
    WHERE id LIKE 'community-user-%' AND status = 'active'`;
  const [projectCount] = await tx`SELECT COUNT(*)::int AS count FROM knowledge_project
    WHERE id = ANY(${tx.array(projects.map(([id]) => id))}::text[])
      AND visibility = 'public' AND status = 'published'`;
  const [duplicateStars] = await tx`SELECT COUNT(*)::int AS count FROM (SELECT project_id, user_id, COUNT(*) FROM project_star WHERE active = TRUE GROUP BY project_id, user_id HAVING COUNT(*) > 1) d`;
  const [duplicateFollows] = await tx`SELECT COUNT(*)::int AS count FROM (SELECT follower_user_id, followed_user_id, COUNT(*) FROM author_follow WHERE active = TRUE GROUP BY follower_user_id, followed_user_id HAVING COUNT(*) > 1) d`;
  const [statsMismatch] = await tx`SELECT COUNT(*)::int AS count FROM (
    SELECT ps.project_id FROM project_stats ps
    LEFT JOIN project_reader pr ON pr.project_id = ps.project_id
    WHERE ps.project_id = ANY(${tx.array(projects.map(([id]) => id))}::text[])
    GROUP BY ps.project_id, ps.unique_readers
    HAVING ps.unique_readers <> COUNT(pr.viewer_key_hash)
  ) mismatch`;
  const [mergedCount] = await tx`SELECT COUNT(*)::int AS count FROM merge_request
    WHERE id IN (SELECT entity_id FROM community_seed_record WHERE seed_batch = ${batch} AND entity_type = 'merge_request')
      AND status = 'merged'`;
  result.activeUsers = Number(userCount.count); result.syntheticActiveUsers = Number(syntheticActive.count); result.publicProjects = Number(projectCount.count);
  result.duplicateStars = Number(duplicateStars.count); result.duplicateFollows = Number(duplicateFollows.count);
  result.statsMismatch = Number(statsMismatch.count); result.mergedMergeRequests = Number(mergedCount.count);
  if (result.syntheticActiveUsers !== 0) throw new Error(`发现 ${result.syntheticActiveUsers} 个历史 synthetic active 账号；请先执行 --clean --batch community-2026-09-v1 --retire-legacy-users。`);
  if (result.activeUsers < 3) throw new Error(`社区 seed 需要至少 3 个真实参与者：${result.activeUsers}`);
  if (result.publicProjects !== projects.length) throw new Error(`五家冻结项目公开数应为 ${projects.length}：${result.publicProjects}`);
  if (result.duplicateStars !== 0 || result.duplicateFollows !== 0) throw new Error("关系唯一性校验失败");
  if (result.statsMismatch !== 0) throw new Error(`project_stats 与 project_reader 不一致：${result.statsMismatch}`);
  if ((result.project_comment ?? 0) < projects.length * 6) throw new Error(`项目评论/回复不足：${result.project_comment ?? 0}`);
  if ((result.project_star ?? 0) < projects.length * 2) throw new Error(`项目 Star 不足：${result.project_star ?? 0}`);
  if ((result.author_follow ?? 0) < 3) throw new Error(`作者关注关系不足：${result.author_follow ?? 0}`);
  if ((result.merge_request ?? 0) < projects.length || (result.merge_review ?? 0) < projects.length) throw new Error(`协作审核记录不足 ${projects.length} 项`);
  if (result.mergedMergeRequests < projects.length) throw new Error(`已合并 MR 不足 ${projects.length} 项：${result.mergedMergeRequests}`);
  return result;
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  try {
    const output = await sql.begin(async (tx) => {
      if (mode === "check") return verifyBatch(tx);
      if (mode === "clean") return { mode, batch, ...(await cleanBatch(tx)) };
      await loadRealUsers(tx);
      const assignments = await seedProjectMembersAndOwners(tx);
      await seedFollows(tx);
      await seedStars(tx, assignments);
      await seedViews(tx, assignments);
      await seedComments(tx, assignments);
      await seedMergeFlows(tx, assignments);
      await rebuildActivityDaily(tx);
      const counts = await verifyBatch(tx);
      return { mode, batch, counts };
    });
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "社区 seed 失败");
  process.exitCode = 1;
});
