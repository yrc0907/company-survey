import { createHash } from "node:crypto";

import postgres from "postgres";

/**
 * 可重复运行的社区场景 seed。
 *
 * 该脚本只创建平台内的结构化场景身份和互动事实，不冒充企业客户、市场
 * 指标或外部用户。邮箱使用 RFC 2606 保留的 `.invalid` 域名，因此不会触发
 * 外部投递；头像留空，由现有 UI 的首字母头像策略负责展示。所有写入都在
 * 一个事务中完成，实体 ID 和事件目标稳定，重跑不会重复计数。
 */

const DEFAULT_BATCH = "community-2026-09-v1";
const batch = process.argv.includes("--batch")
  ? process.argv[process.argv.indexOf("--batch") + 1]
  : process.env.COMMUNITY_SEED_BATCH || DEFAULT_BATCH;
const mode = process.argv.includes("--clean") ? "clean" : process.argv.includes("--check") ? "check" : "upsert";

if (!batch || !/^[a-z0-9][a-z0-9._-]{2,80}$/i.test(batch)) {
  throw new Error("COMMUNITY_SEED_BATCH 只允许 3-81 位字母、数字、点、下划线或短横线。");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置，社区 seed 拒绝使用内存或假持久化。");

const now = "2026-09-02T12:00:00.000Z";

const users = [
  ["林知行", "lin-zhixing", "上海", "零售 SaaS", "研究员"],
  ["陈雪宁", "chen-xuening", "北京", "企业协同", "产品经理"],
  ["周予安", "zhou-yuan", "深圳", "网络安全", "安全分析师"],
  ["许嘉禾", "xu-jiahe", "广州", "跨境电商", "运营负责人"],
  ["赵思远", "zhao-siyuan", "杭州", "数据基础设施", "数据工程师"],
  ["何沐阳", "he-muyang", "成都", "企业服务", "行业顾问"],
  ["唐婉清", "tang-wanqing", "武汉", "数字政府", "政策研究员"],
  ["魏子谦", "wei-ziqian", "西安", "云计算", "解决方案架构师"],
  ["沈念慈", "shen-nianci", "南京", "知识管理", "内容编辑"],
  ["韩立峰", "han-lifeng", "苏州", "制造业数字化", "交付经理"],
  ["蒋若琳", "jiang-ruolin", "青岛", "供应链", "产业分析师"],
  ["吴承泽", "wu-chengze", "厦门", "开发者工具", "软件工程师"],
  ["罗思齐", "luo-siqi", "宁波", "金融科技", "风险研究员"],
  ["郑书瑶", "zheng-shuyao", "天津", "人力资源", "组织顾问"],
  ["高文博", "gao-wenbo", "重庆", "零售 SaaS", "实施顾问"],
  ["孟欣然", "meng-xinran", "长沙", "营销技术", "增长分析师"],
  ["梁晨曦", "liang-chenxi", "合肥", "工业互联网", "产品研究员"],
  ["杜若溪", "du-ruoxi", "福州", "网络安全", "威胁研究员"],
  ["邱明远", "qiu-mingyuan", "济南", "企业协同", "技术写作者"],
  ["宋雨桐", "song-yutong", "郑州", "教育信息化", "项目经理"],
  ["顾言川", "gu-yanchuan", "大连", "云计算", "云架构师"],
  ["何星河", "he-xinghe", "昆明", "数据治理", "数据产品经理"],
  ["谢安琪", "xie-anqi", "南昌", "数字政府", "政策分析师"],
  ["汪泽宇", "wang-zeyu", "杭州", "开发者工具", "开源维护者"],
  ["苏婉仪", "su-wanyi", "上海", "跨境电商", "商业研究员"],
  ["叶嘉诚", "ye-jiacheng", "北京", "金融科技", "投研分析师"],
  ["潘诗涵", "pan-shihan", "深圳", "客户成功", "客户成功经理"],
  ["蒋昊然", "jiang-haoran", "广州", "供应链", "供应链顾问"],
  ["侯静怡", "hou-jingyi", "成都", "知识管理", "知识架构师"],
  ["温景行", "wen-jingxing", "武汉", "制造业数字化", "企业架构师"],
  ["白芷若", "bai-zhiruo", "西安", "网络安全", "合规研究员"],
  ["严子墨", "yan-zimo", "南京", "零售 SaaS", "解决方案顾问"],
  ["程思齐", "cheng-siqi", "苏州", "企业服务", "售前顾问"],
  ["梁书宁", "liang-shuning", "青岛", "物流科技", "物流分析师"],
  ["韩东旭", "han-dongxu", "厦门", "云计算", "平台工程师"],
  ["朱清越", "zhu-qingyue", "宁波", "数据基础设施", "研究助理"],
  ["许墨涵", "xu-mohan", "天津", "人力资源", "HR 产品经理"],
  ["方知远", "fang-zhiyuan", "重庆", "数字政府", "公共事务研究员"],
  ["柳依依", "liu-yiyi", "长沙", "营销技术", "内容策略师"],
  ["陆景明", "lu-jingming", "合肥", "工业互联网", "行业解决方案架构师"],
  ["马嘉诚", "ma-jiacheng", "福州", "供应链", "采购研究员"],
  ["夏语冰", "xia-yubing", "济南", "知识管理", "知识运营"],
  ["罗景铄", "luo-jingshuo", "郑州", "开发者工具", "开发者关系"],
  ["顾清和", "gu-qinghe", "大连", "金融科技", "数据分析师"],
  ["唐子衿", "tang-zijin", "昆明", "教育信息化", "用户研究员"],
  ["贺明哲", "he-mingzhe", "南昌", "企业协同", "系统管理员"],
  ["钟灵秀", "zhong-lingxiu", "宁波", "跨境电商", "市场研究员"],
  ["邵文杰", "shao-wenjie", "上海", "网络安全", "安全产品经理"],
  ["余清扬", "yu-qingyang", "北京", "云计算", "技术研究员"],
];

const projects = [
  ["project-huice", "huice"],
  ["project-weaver", "weaver"],
  ["project-sangfor", "sangfor"],
  ["project-sundray", "sundray"],
  ["project-youzan", "youzan"],
  ["project-fxiaoke", "fxiaoke"],
  ["project-kingdee", "kingdee"],
  ["project-qianxin", "qianxin"],
  ["project-dbapp", "dbapp"],
  ["project-venustech", "venustech"],
  ["project-dingtalk", "dingtalk"],
  ["project-lark", "lark"],
];

const projectOwnerIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const viewDays = ["2026-08-31", "2026-08-24", "2026-08-17", "2026-08-03", "2026-07-04", "2026-05-10", "2026-02-14", "2025-12-20"];

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const userId = (index) => `community-user-${String(index + 1).padStart(2, "0")}`;
const userAt = (index) => users[index % users.length];
const userEmail = (username) => `${username}@community.research.invalid`;
const isoFor = (projectIndex, offset = 0) => `2026-08-${String(31 - ((projectIndex * 3 + offset) % 20)).padStart(2, "0")}T${String(8 + ((projectIndex + offset) % 10)).padStart(2, "0")}:00:00.000Z`;

/** 写内部追踪索引；冲突时只复活同一实体的 seed 记录，不触碰业务正文。 */
async function markSeed(tx, entityType, entityId, sourceKind = "community_scenario", payload = {}) {
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

/** 建立跨城市/行业/角色的场景身份；不创建密码凭据，也不触发外部邮件。 */
async function seedUsers(tx) {
  const createdAt = "2026-08-01T08:00:00.000Z";
  for (let index = 0; index < users.length; index += 1) {
    const [displayName, username, city, industry, role] = users[index];
    const id = userId(index);
    await tx`INSERT INTO platform_user (id, email, global_role, status, email_verified_at, created_at, updated_at)
      VALUES (${id}, ${userEmail(username)}, 'user', 'active', NULL, ${createdAt}, ${now})
      ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO platform_profile (user_id, username, display_name, bio, avatar_asset_id, created_at, updated_at)
      VALUES (${id}, ${username}, ${displayName}, ${`${city} · ${industry} · ${role}`}, NULL, ${createdAt}, ${now})
      ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username, display_name = EXCLUDED.display_name,
        bio = EXCLUDED.bio, updated_at = EXCLUDED.updated_at`;
    await markSeed(tx, "platform_user", id, "community_user", { city, industry, role });
    await markSeed(tx, "platform_profile", id, "community_profile", { username, city, industry, role });
  }
}

/** 为公开项目分配场景 owner/maintainer/contributor；仅接管首发 u-yu，避免覆盖真实转移。 */
async function seedProjectMembersAndOwners(tx) {
  const assignments = [];
  for (let projectIndex = 0; projectIndex < projects.length; projectIndex += 1) {
    const [projectId] = projects[projectIndex];
    const owner = userId(projectOwnerIndexes[projectIndex]);
    const rows = await tx`SELECT owner_user_id FROM knowledge_project WHERE id = ${projectId} LIMIT 1`;
    if (!rows[0]) continue;
    const previousOwner = String(rows[0].owner_user_id);
    const priorAssignment = await tx`SELECT payload FROM community_seed_record
      WHERE entity_type = 'project_owner_assignment' AND entity_id = ${projectId} LIMIT 1`;
    const originalOwner = priorAssignment[0]?.payload && typeof priorAssignment[0].payload === "object"
      ? String(priorAssignment[0].payload.previousOwner ?? previousOwner)
      : previousOwner;
    // 仅接管首发迁移的 u-yu（或本批次此前分配的 owner），不覆盖真实用户后来做的转移。
    if (previousOwner === "u-yu" || previousOwner.startsWith("community-user-")) {
      if (previousOwner !== owner) {
        await tx`UPDATE knowledge_project SET owner_user_id = ${owner}, updated_at = ${now}
          WHERE id = ${projectId} AND owner_user_id = ${previousOwner}`;
        await tx`UPDATE project_member SET role = 'maintainer'
          WHERE project_id = ${projectId} AND user_id = ${previousOwner} AND role = 'owner'`;
      }
    }
    await tx`INSERT INTO project_member (project_id, user_id, role, created_at)
      VALUES (${projectId}, ${owner}, 'owner', ${isoFor(projectIndex, 0)})
      ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'`;
    await markSeed(tx, "project_owner_assignment", projectId, "community_project_owner", { previousOwner: originalOwner, assignedOwner: owner });
    await markSeed(tx, "project_member", `${projectId}:${owner}`, "community_project_member", { projectId, userId: owner, role: "owner" });

    const maintainer = userId((projectIndex + 12) % users.length);
    const contributor = userId((projectIndex + 24) % users.length);
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
  for (let index = 0; index < users.length; index += 1) {
    const follower = userId(index);
    for (const delta of [1, 7, 13]) {
      const followedIndex = (index + delta) % users.length;
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
      const candidate = userId(cursor % users.length);
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
      const viewer = userId((projectIndex * 3 + readerOffset) % users.length);
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
    const rootAuthor = userId((projectIndex * 5 + 14) % users.length);
    const secondAuthor = userId((projectIndex * 5 + 19) % users.length);
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
        const replyAuthor = userId((projectIndex * 7 + 27 + replyIndex) % users.length);
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
  `);
  const rows = await tx`SELECT id, actor_user_id, project_id, day, total_count FROM activity_daily WHERE actor_user_id LIKE 'community-user-%'`;
  for (const row of rows) await markSeed(tx, "activity_daily", String(row.id), "community_activity_daily", { actorUserId: row.actor_user_id, projectId: row.project_id, day: row.day, totalCount: row.total_count });
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
  await rebuildActivityDaily(tx);
}

/** 检查用户规模、项目数、关系唯一性和最低互动覆盖，失败即回滚事务。 */
async function verifyBatch(tx) {
  const result = {};
  const rows = await tx`SELECT entity_type, COUNT(*)::int AS count FROM community_seed_record WHERE seed_batch = ${batch} AND retired_at IS NULL GROUP BY entity_type ORDER BY entity_type`;
  for (const row of rows) result[String(row.entity_type)] = Number(row.count);
  const [userCount] = await tx`SELECT COUNT(*)::int AS count FROM platform_user WHERE id LIKE 'community-user-%' AND status = 'active'`;
  const [projectCount] = await tx`SELECT COUNT(*)::int AS count FROM knowledge_project
    WHERE id LIKE 'project-%' AND visibility = 'public' AND status = 'published'`;
  const [duplicateStars] = await tx`SELECT COUNT(*)::int AS count FROM (SELECT project_id, user_id, COUNT(*) FROM project_star WHERE active = TRUE GROUP BY project_id, user_id HAVING COUNT(*) > 1) d`;
  const [duplicateFollows] = await tx`SELECT COUNT(*)::int AS count FROM (SELECT follower_user_id, followed_user_id, COUNT(*) FROM author_follow WHERE active = TRUE GROUP BY follower_user_id, followed_user_id HAVING COUNT(*) > 1) d`;
  const [statsMismatch] = await tx`SELECT COUNT(*)::int AS count FROM (
    SELECT ps.project_id FROM project_stats ps
    LEFT JOIN project_reader pr ON pr.project_id = ps.project_id
    WHERE ps.project_id LIKE 'project-%'
    GROUP BY ps.project_id, ps.unique_readers
    HAVING ps.unique_readers <> COUNT(pr.viewer_key_hash)
  ) mismatch`;
  const [mergedCount] = await tx`SELECT COUNT(*)::int AS count FROM merge_request
    WHERE id IN (SELECT entity_id FROM community_seed_record WHERE seed_batch = ${batch} AND entity_type = 'merge_request')
      AND status = 'merged'`;
  result.activeUsers = Number(userCount.count); result.publicProjects = Number(projectCount.count);
  result.duplicateStars = Number(duplicateStars.count); result.duplicateFollows = Number(duplicateFollows.count);
  result.statsMismatch = Number(statsMismatch.count); result.mergedMergeRequests = Number(mergedCount.count);
  if (result.activeUsers < 40 || result.activeUsers > 60) throw new Error(`社区用户数不在 40-60 范围：${result.activeUsers}`);
  if (result.publicProjects < 12) throw new Error(`首发公开项目不足 12 个：${result.publicProjects}`);
  if (result.duplicateStars !== 0 || result.duplicateFollows !== 0) throw new Error("关系唯一性校验失败");
  if (result.statsMismatch !== 0) throw new Error(`project_stats 与 project_reader 不一致：${result.statsMismatch}`);
  if ((result.project_comment ?? 0) < 48) throw new Error(`项目评论/回复不足：${result.project_comment ?? 0}`);
  if ((result.project_star ?? 0) < 72) throw new Error(`项目 Star 不足：${result.project_star ?? 0}`);
  if ((result.author_follow ?? 0) < 100) throw new Error(`作者关注关系不足：${result.author_follow ?? 0}`);
  if ((result.merge_request ?? 0) < 12 || (result.merge_review ?? 0) < 12) throw new Error("协作审核记录不足 12 项");
  if (result.mergedMergeRequests < 12) throw new Error(`已合并 MR 不足 12 项：${result.mergedMergeRequests}`);
  return result;
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 10 });
  try {
    const output = await sql.begin(async (tx) => {
      if (mode === "check") return verifyBatch(tx);
      if (mode === "clean") { await cleanBatch(tx); return { mode, batch }; }
      await seedUsers(tx);
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
