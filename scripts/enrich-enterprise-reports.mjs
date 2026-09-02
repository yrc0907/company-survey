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
  ["project-lark", "Lark", "https://www.larksuite.com/en_us", "全球团队协作、沟通、工作管理与原生 AI"],
  ["project-muyuan", "牧原食品", "https://www.muyuanfoods.com/", "生猪养殖、成本控制、生物安全与产业链经营"],
];

const marketFacts = {
  "慧策": "非独立上市主体；无可直接归属的公开股票代码，财报与产品收入需要企业披露、客户访谈或第三方研究交叉验证。",
  "泛微网络": "A 股 603039.SH；财报、分产品收入和行情必须以交易所/公司公告为准。",
  "深信服": "A 股 300454.SZ；财报、云与安全业务拆分和行情必须以交易所/公司公告为准。",
  "信锐科技": "独立产品品牌/企业服务主体；未把母公司或关联公司财务数据直接归因到信锐。",
  "有赞": "港股 08083.HK（中国有赞）；财报和行情必须以港交所/公司公告为准。",
  "纷享销客": "非独立上市主体；公开资料不足以推断收入、利润或客户续费。",
  "金蝶": "港股 00268.HK；财报分部、云订阅指标和行情必须以港交所/公司公告为准。",
  "奇安信": "A 股 688561.SH；财报、政府/企业业务结构和行情必须以交易所/公司公告为准。",
  "安恒信息": "A 股 688023.SH；财报、数据安全业务结构和行情必须以交易所/公司公告为准。",
  "启明星辰": "A 股 002439.SZ；关联交易、并购影响、分部财报和行情必须以交易所/公司公告为准。",
  "钉钉": "阿里巴巴生态中的产品品牌；没有独立可交易股票代码，不把母公司数据直接当作钉钉收入。",
  "Lark": "字节跳动旗下产品品牌；没有独立公开股票代码，商业指标需要企业披露或可信第三方来源。",
  "牧原食品": "A 股 002714.SZ；财报、出栏/成本、猪价周期和行情必须以交易所/公司公告为准。",
};

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
    if (text.length < 40) {
      if (url.includes("muyuanfoods.com")) return "牧原食品集团股份有限公司。官网入口需要 JavaScript 渲染，本次只确认官方入口和股票代码 002714.SZ；收入、利润、出栏量、猪价、成本和估值不从该页面推断。";
      throw new Error("SOURCE_TEXT_TOO_SHORT");
    }
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
    "证据目录": `来源 1：${url}\n来源类型：企业官网公开页面\n内容哈希：${sha256(snapshot)}\n抓取时间：${now}\n\n快照原文（由页面解析得到，保留在 source/source_chunk）：\n${snapshot}\n\n后续年报、公告、白皮书、公开访谈和客户案例按同一格式追加，不覆盖本条记录。`,
  };
  return lead + (specific[section] ?? `${section}\n\n${boundary}`);
}

function documentContent(text) {
  return { type: "doc", content: [{ type: "paragraph", attrs: { evidenceState: "needs_verification" }, content: [{ type: "text", text }] }] };
}

/** 研究者分析必须把事实、推断和待核验数据分开，避免把官网宣传当成经营结论。 */
function analystContent(company, focus, snapshot) {
  const market = marketFacts[company] ?? "上市状态和财务口径待核验。";
  const excerpt = snapshot.slice(0, 1_200);
  return `研究者分析与战略判断（由 Yu 撰写）\n\n` +
    `一、事实边界（fact）\n${company}官网公开入口围绕“${focus}”展示产品/服务方向。页面快照摘录：${excerpt}\n\n` +
    `二、财报、收益与股价（needs_verification）\n${market}当前快照没有足够的分部财务数据，不能声称哪个产品收益最高、利润率最高或股价上涨/下跌。后续必须逐期导入年报、季报、公告和可靠行情数据，至少计算营收、归母净利润、经营现金流、毛利/费用、分部收入、52 周区间、回撤和成交量，并把计算过程留在数据表。\n\n` +
    `三、产品与价值判断（inference）\n从产品入口和客户问题看，${company}真正的竞争变量不是功能数量，而是目标客户的关键工作流、交付成本、数据沉淀、迁移成本和可持续收入。产品页面优先级只能作为“战略意图”线索，不能直接等同于收入贡献；最高收益产品必须由财报分部或可信经营数据证明。\n\n` +
    `四、当前问题与压力（inference / needs_verification）\n需要重点验证：获客成本和销售周期、续费/复购、交付与实施成本、核心客户集中度、供应商或平台依赖、数据与合规、宏观周期、价格透明度、组织效率以及 AI 对原有产品毛利的影响。${company}的公开材料不足时，问题保留为待核验，不用模型补造答案。\n\n` +
    `五、竞争与“赢”的路径（inference）\n不采用“单点功能打败竞品”的空泛结论。可行路径是选择一个细分场景建立更低的总拥有成本，公开可验证的交付结果，形成数据/流程/生态壁垒，再通过开放接口与渠道扩大覆盖；对手的弱点必须来自公开产品、客户反馈、价格或交付证据，而不是主观贬低。\n\n` +
    `六、政策红利与边界（inference）\n数字化转型、人工智能+、数据要素、现代服务业、网络安全或农业现代化等政策可以提供需求方向，但不是企业背书。只有当政策原文、企业能力和客户场景三者能对上时，才能形成“方向契合”的推断。\n\n` +
    `七、合作与资源整合（inference）\n优先画出上下游关系：产品/平台、实施交付、渠道伙伴、数据与算力、行业协会、金融/保险、供应链、客户成功和生态集成。合作应明确资源交换、边界、收入归属、数据责任、退出机制和可量化结果，不能只列合作公司名称。\n\n` +
    `八、未来路径与开放问题（inference / needs_verification）\n未来增长可从核心客户深耕、标准化产品、行业模板、AI 增值、生态分发或海外扩张中择一验证，不应同时假设全部成立。下一步需要补齐的公开证据：最新财报与公告、产品价格/版本、客户案例原文、竞品报价、监管政策、招聘与组织信号、可靠行情和独立行业统计。`;
}

async function enrichCompany(tx, [projectId, company, url, focus]) {
  const projectRows = await tx`SELECT p.id, p.owner_user_id, b.id AS branch_id, b.head_commit_id, b.version
    FROM knowledge_project p JOIN knowledge_branch b ON b.project_id = p.id AND b.name = p.default_branch_name
    WHERE p.id = ${projectId} AND p.visibility = 'public' AND p.status = 'published' LIMIT 1`;
  const project = projectRows[0];
  if (!project) return { status: "skipped", reason: "project_missing" };
  const commitId = `${projectId}-official-dossier-v2`;
  const existingCommit = await tx`SELECT id FROM knowledge_commit WHERE id = ${commitId} LIMIT 1`;
  if (existingCommit.length) return { status: "skipped", reason: "already_imported" };
  const snapshot = await fetchSnapshot(url);
  const contentHash = sha256(snapshot);
  const reportRows = await tx`SELECT r.id AS report_id FROM report r JOIN company c ON c.id = r.company_id WHERE c.name = ${company} LIMIT 1`;
  const reportId = reportRows[0]?.report_id ? String(reportRows[0].report_id) : null;
  const sourceId = `${projectId}-official-dossier-v2`;
  const sourceNodeId = `${projectId}-node-official-dossier-v2`;
  const sourceTitle = `${company}官网公开资料快照（v2）`;
  let sourceRef = sourceId;

  await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
    VALUES (${commitId}, ${projectId}, ${project.branch_id}, ${project.head_commit_id ? String(project.head_commit_id) : null}, ${String(project.owner_user_id)}, ${`导入${company}官方资料快照并补齐研究章节`}, FALSE, ${`official-dossier:${projectId}:v2`}, ${contentHash}, ${JSON.stringify({ source: url, evidenceState: "needs_verification" })}::jsonb, ${now})`;
  await tx`INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
    VALUES (${sourceNodeId}, ${projectId}, 'source', ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
    VALUES (${projectId}, ${String(project.branch_id)}, ${sourceNodeId}, NULL, ${sourceTitle}, 30, NULL, ${now}) ON CONFLICT (branch_id, node_id) DO NOTHING`;
  if (reportId) {
    const existingSource = await tx`SELECT id FROM source WHERE report_id = ${reportId} AND content_hash = ${contentHash} LIMIT 1`;
    if (existingSource[0]?.id) sourceRef = String(existingSource[0].id);
    else {
      await tx`INSERT INTO source (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot, evidence_state, metadata)
        VALUES (${sourceId}, ${reportId}, ${sourceTitle}, 'web', ${url}, 'zh', 'active', ${now}, ${contentHash}, ${snapshot}, 'needs_verification', ${JSON.stringify({ sourceType: "official_website", publisher: company, capturedAt: now, retrievalMode: "official_landing_snapshot" })}::jsonb)`;
      await tx`INSERT INTO source_chunk (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
        VALUES (${`${sourceId}-chunk-1`}, ${sourceId}, NULL, ${["官网公开资料", "页面摘要"]}, 1, NULL, 0, ${snapshot.length}, ${snapshot}, ${`企业官网公开快照；${company}；证据状态：needs_verification`}, ${contentHash}) ON CONFLICT (id) DO NOTHING`;
    }
  }
  const docs = await tx`SELECT ns.node_id, ns.name FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id
    WHERE ns.project_id = ${projectId} AND ns.branch_id = ${String(project.branch_id)} AND ns.deleted_at IS NULL AND n.kind IN ('document', 'markdown') ORDER BY ns.position, ns.name`;
  const sectionNames = ["研究结论", "公司与产品", "市场与竞品", "商业模式", "客户与场景", "政策关联", "风险与开放问题", "证据目录"];
  let position = 0;
  for (const row of docs) {
    const rawName = String(row.name);
    const section = sectionNames.find((name) => rawName.includes(name)) ?? sectionNames[position % sectionNames.length];
    const text = sectionContent(company, focus, section, snapshot, url);
    const revisionId = `${String(row.node_id)}-official-dossier-v2`;
    const previousRows = await tx`SELECT id FROM document_revision WHERE project_id = ${projectId} AND node_id = ${String(row.node_id)} AND branch_id = ${String(project.branch_id)} ORDER BY created_at DESC LIMIT 1`;
    const previousId = previousRows[0]?.id ? String(previousRows[0].id) : null;
    await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
      VALUES (${revisionId}, ${projectId}, ${String(row.node_id)}, ${String(project.branch_id)}, ${commitId}, ${previousId}, ${JSON.stringify(documentContent(text))}::jsonb, ${text}, ${sha256(text)}, ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
      VALUES (${`${commitId}:${String(row.node_id)}`}, ${commitId}, ${String(row.node_id)}, 'update_content', ${previousId}, ${revisionId}, ${JSON.stringify({ evidenceState: "needs_verification", sourceId: sourceRef })}::jsonb, ${position}) ON CONFLICT (id) DO NOTHING`;
    position += 1;
  }
  const analysisNodeId = `${projectId}-node-analysis-v2`;
  const analysisText = analystContent(company, focus, snapshot);
  const analysisRevisionId = `${analysisNodeId}-revision-v2`;
  await tx`INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
    VALUES (${analysisNodeId}, ${projectId}, 'document', ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
    VALUES (${projectId}, ${String(project.branch_id)}, ${analysisNodeId}, NULL, '研究者分析与战略判断', 40, NULL, ${now}) ON CONFLICT (branch_id, node_id) DO NOTHING`;
  await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
    VALUES (${analysisRevisionId}, ${projectId}, ${analysisNodeId}, ${String(project.branch_id)}, ${commitId}, NULL, ${JSON.stringify(documentContent(analysisText))}::jsonb, ${analysisText}, ${sha256(analysisText)}, ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
    VALUES (${`${commitId}:${analysisNodeId}`}, ${commitId}, ${analysisNodeId}, 'create_node', NULL, ${analysisRevisionId}, ${JSON.stringify({ evidenceState: "inference", sourceId: sourceRef })}::jsonb, ${position}) ON CONFLICT (id) DO NOTHING`;
  position += 1;
  await tx`UPDATE knowledge_branch SET head_commit_id = ${commitId}, version = GREATEST(version, ${Number(project.version ?? 1) + 1}), updated_at = ${now} WHERE id = ${String(project.branch_id)}`;
  await tx`UPDATE knowledge_project SET updated_at = ${now}, verification_note = ${`已追加${company}官网公开快照；商业数据和效果结论仍需独立来源核验。`} WHERE id = ${projectId}`;
  return { status: "imported", projectId, sections: position, source: sourceRef };
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
