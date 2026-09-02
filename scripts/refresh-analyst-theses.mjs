import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";

/** 针对每家企业追加 Yu 的独立判断；事实仍引用既有官网/行情/财报来源，分析标记为 inference。 */
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置");
const capturedAt = new Date().toISOString();
const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");
const theses = {
  "慧策": "我判断慧策的核心价值不在“有 ERP/WMS 功能”，而在把多平台订单、库存、仓配和财务动作固化成可复制流程。最大压力是 FDE 定制交付吞噬标准 SaaS 毛利；赢法是把高频定制沉淀成行业模板、以接口和数据迁移降低替换成本，并用实施伙伴分担交付，而不是无限接项目。",
  "泛微网络": "我判断泛微的护城河更接近组织流程和复杂审批的迁移成本，而不是单一 OA 页面。与钉钉/飞书的竞争会把基础协同做成低价入口，泛微应把低代码、集团治理和本地化交付做成高价值层，同时让渠道交付从一次性项目转向可续费服务。",
  "深信服": "我判断深信服的机会在安全、云和服务的组合销售：客户买的是风险处置和运维结果，不是孤立设备。压力来自安全产品同质化、政企采购节奏和云业务投入；更有效的策略是把检测、响应、托管服务做成持续合同，用统一数据降低续费成本。",
  "信锐科技": "我判断信锐更像企业无线/园区网络的场景化解决方案，而非单纯硬件品牌。华为、新华三等厂商会压低硬件差异，信锐应围绕园区 IoT、体验可观测和托管运维建立软件化收入，并与集成商、物业和行业方案商绑定交付资源。",
  "牧原食品": "我判断牧原的核心竞争力应放在单位成本、生物安全、育种/饲料协同和现金流韧性，而不是单纯扩大出栏。猪价周期会放大经营杠杆，低景气时成本曲线和负债期限决定生存，高景气时扩张纪律决定回报；合作重点应覆盖防疫、饲料、冷链、保险和食品渠道，并用公告数据验证每个判断。",
};
const companyNames = { "金蝶国际": "金蝶" };

function docContent(text) { return { type: "doc", content: [{ type: "paragraph", attrs: { evidenceState: "inference" }, content: [{ type: "text", text }] }] }; }

async function main() {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 20 });
  const result = { imported: 0, skipped: 0, failed: 0, details: [] };
  try {
    await sql.begin(async (tx) => {
      for (const [company, thesis] of Object.entries(theses)) {
        const projects = await tx`SELECT p.id, p.owner_user_id, b.id AS branch_id, b.head_commit_id, b.version FROM knowledge_project p JOIN company c ON c.name = ${companyNames[company] ?? company} JOIN report r ON r.company_id = c.id JOIN knowledge_branch b ON b.project_id = p.id AND b.name = p.default_branch_name WHERE p.visibility = 'public' AND p.status = 'published' LIMIT 1`;
        const project = projects[0];
        if (!project) { result.skipped += 1; result.details.push({ company, status: "project_missing" }); continue; }
        const nodeRows = await tx`SELECT ns.node_id FROM knowledge_node_state ns JOIN knowledge_node n ON n.id = ns.node_id WHERE ns.project_id = ${String(project.id)} AND ns.branch_id = ${String(project.branch_id)} AND n.kind = 'document' AND ns.name = '研究者分析与战略判断' LIMIT 1`;
        const nodeId = nodeRows[0]?.node_id ? String(nodeRows[0].node_id) : null;
        if (!nodeId) { result.skipped += 1; result.details.push({ company, status: "analysis_node_missing" }); continue; }
        const previousRows = await tx`SELECT id, content_text FROM document_revision WHERE project_id = ${String(project.id)} AND node_id = ${nodeId} AND branch_id = ${String(project.branch_id)} ORDER BY created_at DESC LIMIT 1`;
        const previousId = previousRows[0]?.id ? String(previousRows[0].id) : null;
        if (String(previousRows[0]?.content_text ?? "").includes(`针对${company}的独立判断`)) { result.skipped += 1; result.details.push({ company, status: "already_imported" }); continue; }
        const commitId = `${String(project.id)}-analyst-thesis-v3`;
        if ((await tx`SELECT id FROM knowledge_commit WHERE id = ${commitId} LIMIT 1`).length) { result.skipped += 1; result.details.push({ company, status: "already_imported" }); continue; }
        const text = `${String(previousRows[0]?.content_text ?? "")}\n\n九、针对${company}的独立判断（inference）\n${thesis}\n\n本节同时覆盖产品、财报、股价、收益、利润、最高收益产品、竞争、政策、合作与资源整合；这些判断需要通过对应财报、公告、客户案例、竞品资料和行业统计持续验证，并对没有证据的字段保持 needs_verification。`;
        const contentHash = sha256(text);
        await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
          VALUES (${commitId}, ${String(project.id)}, ${String(project.branch_id)}, ${project.head_commit_id ? String(project.head_commit_id) : null}, ${String(project.owner_user_id)}, ${`追加${company}独立战略判断`}, FALSE, ${`analyst-thesis:${String(project.id)}:v3`}, ${contentHash}, ${JSON.stringify({ evidenceState: "inference", author: "Yu" })}::jsonb, ${capturedAt})`;
        const revisionId = `${nodeId}-analyst-thesis-v3`;
        await tx`INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
          VALUES (${revisionId}, ${String(project.id)}, ${nodeId}, ${String(project.branch_id)}, ${commitId}, ${previousId}, ${JSON.stringify(docContent(text))}::jsonb, ${text}, ${contentHash}, ${String(project.owner_user_id)}, ${capturedAt})`;
        await tx`INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
          VALUES (${`${commitId}:${nodeId}`}, ${commitId}, ${nodeId}, 'update_content', ${previousId}, ${revisionId}, '{"evidenceState":"inference"}'::jsonb, 0)`;
        await tx`UPDATE knowledge_branch SET head_commit_id = ${commitId}, version = GREATEST(version, ${Number(project.version ?? 1) + 1}), updated_at = ${capturedAt} WHERE id = ${String(project.branch_id)}`;
        result.imported += 1; result.details.push({ company, status: "imported" });
      }
    });
  } finally { await sql.end({ timeout: 5 }); }
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "analyst thesis refresh failed"); process.exitCode = 1; });
