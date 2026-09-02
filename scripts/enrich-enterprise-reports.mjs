import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";

/**
 * 从企业公开官网导入可追溯资料快照，并给已有项目文件树补齐研究章节。
 * 输入：服务器 DATABASE_URL 与固定的公开官网 URL；输出：source/source_chunk、Commit、Revision、引用入口。
 * 副作用：只追加新来源和新版本，不覆盖旧正文；网络失败时整家公司跳过并记录失败计数。
 */
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置，企业资料富化拒绝使用内存模式");

const now = new Date().toISOString();
const companies = [
  ["project-huice", "慧策", "https://www.wangdian.cn/", "电商 ERP、订单履约、WMS、跨境经营与业财分析"],
  ["project-weaver", "泛微网络", "https://www.weaver.com.cn/", "协同办公、流程审批、门户与企业数智化运营"],
  ["project-sangfor", "深信服", "https://www.sangfor.com.cn/", "云计算、网络安全、信创适配与技术服务"],
  ["project-sundray", "信锐科技", "https://www.sundray.com/", "企业无线、交换网络、物联网与园区数字化"],
  ["project-youzan", "有赞", "https://www.youzan.com/", "零售电商、全渠道销售、私域复购与 AI 经营"],
  ["project-fxiaoke", "纷享销客", "https://www.fxiaoke.com/", "AI 原生 CRM、营销销售服务与行业应用"],
  ["project-kingdee", "金蝶", "https://www.kingdee.com/", "企业管理云、财务管理、ERP 与 AI 能力"],
  ["project-qianxin", "奇安信", "https://www.qianxin.com/", "网络安全产品、安全运营、咨询规划与应急响应"],
  ["project-dbapp", "安恒信息", "https://www.dbappsecurity.com.cn/", "网络安全、数据安全、AI+安全产品与安全服务"],
  ["project-venustech", "启明星辰", "https://www.venustech.com.cn/", "网络安全防护、检测、安全运营与服务"],
  ["project-dingtalk", "钉钉", "https://www.dingtalk.com/", "企业协同、组织管理、AI 办公与数字化工作"],
  ["project-lark", "Lark", "https://www.larksuite.com/", "全球团队协作、沟通、工作管理与原生 AI"],
];

const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

async function fetchSnapshot(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { accept: "text/html,application/xhtml+xml", "user-agent": "research-workbench-source-refresh/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const html = await response.text();
    const text = stripHtml(html);
    if (text.length < 80) throw new Error("SOURCE_TEXT_TOO_SHORT");
    return text.slice(0, 24_000);
  } finally { clearTimeout(timer); }
}

function sectionContent(company, focus, section, snapshot, url) {
  const excerpt = snapshot.slice(0, 900);
  const boundary = "官网公开文字只证明企业自述的产品或服务范围；客户规模、价格、收入、市场份额、交付效果和竞争优劣需要独立来源，不从本页推断。";
  const lead = `研究对象：${company}\n官方入口：${url}\n抓取时间：${now}\n\n`;
  const specific = {
    "研究结论": `本次快照显示，${company}的公开入口围绕${focus}展开。当前可确认的是产品/服务方向，不能据此确认商业结果。\n\n${boundary}`,
    "公司与产品": `公开页面关键词摘要：${excerpt}\n\n产品范围暂按“${focus}”建立索引，后续需要按产品手册、版本说明和公告拆分为可验证条目。`,
    "市场与竞品": `本节先固定研究问题：${company}服务哪些客户、替代什么旧流程、与哪些同类产品竞争、采购和交付周期如何。当前官网快照未提供可独立核验的竞品份额或价格。\n\n${boundary}`,
    "商业模式": `需要继续核验标准版/定制版、订阅或项目制收费、实施与续费、渠道分成和客户成功成本。当前来源没有足够公开信息支持金额结论。\n\n${boundary}`,
    "客户与场景": `围绕“${focus}”建立客户场景清单：目标组织、核心痛点、使用角色、上线前置条件、可量化结果和失败边界。官网摘要只能作为场景候选，客户案例需保留原文和发布日期。`,
    "政策关联": `可从数字化转型、人工智能+、数据治理、网络安全、降低物流成本或现代服务业等方向建立政策索引。政策契合度属于研究推断，必须分别引用政策原文和企业能力证据，不能写成政策背书。`,
    "风险与开放问题": `开放问题包括数据安全与跨境边界、合同与 SLA、供应商锁定、实施复杂度、价格透明度、客户迁移成本和 AI 输出责任。所有未取得独立证据的结论标记为 needs_verification。`,
    "证据目录": `来源 1：${url}\n来源类型：企业官网公开页面\n内容哈希：${sha256(snapshot)}\n抓取时间：${now}\n\n快照原文保存在来源对象和 Chunk 中；后续年报、公告、白皮书、公开访谈和客户案例按同一格式追加，不覆盖本条记录。`,
  };
  return lead + (specific[section] ?? `${section}\n\n${boundary}`);
}

function documentContent(text) {
  return { type: "doc", content: [{ type: "paragraph", attrs: { evidenceState: "needs_verification" }, content: [{ type: "text", text }] }] };
}

async function enrichCompany(tx, [projectId, company, url, focus]) {
  const projectRows = await tx`SELECT p.id, p.owner_user_id, b.id AS branch_id, b.head_commit_id, b.version
    FROM knowledge_project p JOIN knowledge_branch b ON b.project_id = p.id AND b.name = p.default_branch_name
    WHERE p.id = ${projectId} AND p.visibility = 'public' AND p.status = 'published' LIMIT 1`;
  const project = projectRows[0];
  if (!project) return { status: "skipped", reason: "project_missing" };
  const commitId = `${projectId}-official-dossier-v1`;
  const existingCommit = await tx`SELECT id FROM knowledge_commit WHERE id = ${commitId} LIMIT 1`;
  if (existingCommit.length) return { status: "skipped", reason: "already_imported" };
  const snapshot = await fetchSnapshot(url);
  const contentHash = sha256(snapshot);
  const reportRows = await tx`SELECT r.id AS report_id FROM report r JOIN company c ON c.id = r.company_id WHERE c.name = ${company} LIMIT 1`;
  const reportId = reportRows[0]?.report_id ? String(reportRows[0].report_id) : null;
  const sourceId = `${projectId}-official-dossier-v1`;
  const sourceNodeId = `${projectId}-node-official-dossier-v1`;
  const sourceTitle = `${company}官网公开资料快照`;

  await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
    VALUES (${commitId}, ${projectId}, ${project.branch_id}, ${project.head_commit_id ? String(project.head_commit_id) : null}, ${String(project.owner_user_id)}, ${`导入${company}官方资料快照并补齐研究章节`}, FALSE, ${`official-dossier:${projectId}:v1`}, ${contentHash}, ${JSON.stringify({ source: url, evidenceState: "needs_verification" })}::jsonb, ${now})`;
  await tx`INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
    VALUES (${sourceNodeId}, ${projectId}, 'source', ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
    VALUES (${projectId}, ${String(project.branch_id)}, ${sourceNodeId}, NULL, ${sourceTitle}, 30, NULL, ${now}) ON CONFLICT (branch_id, node_id) DO NOTHING`;
  if (reportId) {
    await tx`INSERT INTO source (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot, evidence_state, metadata)
      VALUES (${sourceId}, ${reportId}, ${sourceTitle}, 'web', ${url}, 'zh', 'active', ${now}, ${contentHash}, ${snapshot}, 'needs_verification', ${JSON.stringify({ sourceType: "official_website", publisher: company, capturedAt: now, retrievalMode: "official_landing_snapshot" })}::jsonb)
      ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO source_chunk (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
      VALUES (${`${sourceId}-chunk-1`}, ${sourceId}, NULL, ${["官网公开资料", "页面摘要"]}, 1, NULL, 0, ${snapshot.length}, ${snapshot}, ${`企业官网公开快照；${company}；证据状态：needs_verification`}, ${contentHash}) ON CONFLICT (id) DO NOTHING`;
  }
  const docs = await tx`SELECT ns.node_id, ns.name FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id
    WHERE ns.project_id = ${projectId} AND ns.branch_id = ${String(project.branch_id)} AND ns.deleted_at IS NULL AND n.kind IN ('document', 'markdown') ORDER BY ns.position, ns.name`;
  const sectionNames = ["研究结论", "公司与产品", "市场与竞品", "商业模式", "客户与场景", "政策关联", "风险与开放问题", "证据目录"];
  let position = 0;
  for (const row of docs) {
    const rawName = String(row.name);
    const section = sectionNames.find((name) => rawName.includes(name)) ?? sectionNames[position % sectionNames.length];
    const text = sectionContent(company, focus, section, snapshot, url);
    const revisionId = `${String(row.node_id)}-official-dossier-v1`;
    const previousRows = await tx`SELECT id FROM document_revision WHERE project_id = ${projectId} AND node_id = ${String(row.node_id)} AND branch_id = ${String(project.branch_id)} ORDER BY created_at DESC LIMIT 1`;
    const previousId = previousRows[0]?.id ? String(previousRows[0].id) : null;
    await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
      VALUES (${revisionId}, ${projectId}, ${String(row.node_id)}, ${String(project.branch_id)}, ${commitId}, ${previousId}, ${JSON.stringify(documentContent(text))}::jsonb, ${text}, ${sha256(text)}, ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
      VALUES (${`${commitId}:${String(row.node_id)}`}, ${commitId}, ${String(row.node_id)}, 'update_content', ${previousId}, ${revisionId}, ${JSON.stringify({ evidenceState: "needs_verification", sourceId })}::jsonb, ${position}) ON CONFLICT (id) DO NOTHING`;
    position += 1;
  }
  await tx`UPDATE knowledge_branch SET head_commit_id = ${commitId}, version = GREATEST(version, ${Number(project.version ?? 1) + 1}), updated_at = ${now} WHERE id = ${String(project.branch_id)}`;
  await tx`UPDATE knowledge_project SET updated_at = ${now}, verification_note = ${`已追加${company}官网公开快照；商业数据和效果结论仍需独立来源核验。`} WHERE id = ${projectId}`;
  return { status: "imported", projectId, sections: position, source: sourceId };
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 20 });
  const result = { imported: 0, skipped: 0, failed: 0, details: [] };
  try {
    await sql.begin(async (tx) => {
      for (const company of companies) {
        try {
          const outcome = await enrichCompany(tx, company);
          result.details.push(outcome);
          if (outcome.status === "imported") result.imported += 1; else result.skipped += 1;
        } catch (error) {
          result.failed += 1;
          result.details.push({ projectId: company[0], status: "failed", reason: error instanceof Error ? error.message : "unknown" });
        }
      }
    });
  } finally { await sql.end({ timeout: 5 }); }
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "enterprise enrichment failed"); process.exitCode = 1; });
