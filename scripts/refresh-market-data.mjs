import { createHash } from "node:crypto";

import postgres from "postgres";

/** 公开行情/财报快照配置；A 股 secid 0/1，港股 secid 116，来源为东方财富公开接口。 */
const listed = [
  ["project-weaver", "泛微网络", "603039.SH", "1.603039"],
  ["project-sangfor", "深信服", "300454.SZ", "0.300454"],
  ["project-muyuan", "牧原食品", "002714.SZ", "0.002714"],
];
const MARKET_VERSION = "v2";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL 未配置");
const capturedAt = new Date().toISOString();
const sha256 = (value) => createHash("sha256").update(String(value), "utf8").digest("hex");

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "research-workbench-market-refresh/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally { clearTimeout(timer); }
}

function parseKline(line) {
  const fields = String(line).split(",");
  return { date: fields[0], open: Number(fields[1]), close: Number(fields[2]), high: Number(fields[3]), low: Number(fields[4]), volume: Number(fields[5]), amount: Number(fields[6]) };
}

function calculateTrend(klines) {
  const rows = klines.map(parseKline).filter((row) => Number.isFinite(row.close) && row.close > 0);
  if (!rows.length) return null;
  let peak = rows[0].close;
  let maxDrawdown = 0;
  for (const row of rows) { peak = Math.max(peak, row.close); maxDrawdown = Math.min(maxDrawdown, (row.close / peak - 1) * 100); }
  const first = rows[0].close;
  const last = rows.at(-1).close;
  return { startDate: rows[0].date, endDate: rows.at(-1).date, startClose: first, latestClose: last, periodReturnPct: (last / first - 1) * 100, periodHigh: Math.max(...rows.map((row) => row.high)), periodLow: Math.min(...rows.map((row) => row.low)), maxDrawdownPct: maxDrawdown, sampleCount: rows.length };
}

function formatNumber(value, digits = 2) { return Number.isFinite(value) ? value.toFixed(digits) : "待核验"; }

function reportText(company, code, quote, financial, trend) {
  const report = financial?.[0] ?? null;
  const quotePrice = quote?.data?.f43 ? Number(quote.data.f43) / 100 : null;
  const quoteChange = quote?.data?.f169 ? Number(quote.data.f169) / 100 : null;
  const lines = [
    `财报与股价公开快照（${capturedAt}）`,
    `标的：${company}（${code}）`,
    "",
    "一、可计算事实（fact）",
    `最新行情接口返回价：${formatNumber(quotePrice)}；当日涨跌：${formatNumber(quoteChange)}。行情区间：${trend ? `${trend.startDate} 至 ${trend.endDate}，收盘区间收益 ${formatNumber(trend.periodReturnPct)}%，最高 ${formatNumber(trend.periodHigh)}，最低 ${formatNumber(trend.periodLow)}，最大回撤 ${formatNumber(trend.maxDrawdownPct)}%，样本 ${trend.sampleCount} 个交易日` : "无有效 K 线"}。`,
    report ? `最新财报期：${report.REPORTDATE ?? "待核验"}；营业收入：${formatNumber(Number(report.TOTAL_OPERATE_INCOME))}；归母净利润：${formatNumber(Number(report.PARENT_NETPROFIT))}；加权 ROE：${formatNumber(Number(report.WEIGHTAVG_ROE))}%；收入同比：${formatNumber(Number(report.YSTZ))}%；净利润同比：${formatNumber(Number(report.SJLTZ))}%。` : "当前公开接口未返回可用财报行，不能填写收入、利润或 ROE。",
    "",
    "二、研究者判断（inference）",
    `股价走势只能说明市场在该时间段的定价变化，不能单独证明经营改善。应把回撤、成交量和财报同比放在同一时间轴：若价格上升但利润/现金流没有同步改善，需要把上涨解释为预期或估值变化，而不是收益事实；若利润改善但股价走弱，需要检查市场预期、行业周期和风险折价。`,
    `${company}的“最高收益产品”不能从行情接口推断。必须继续读取年报分部注释、产品收入或管理层口径，再比较收入、毛利、现金回款和增量成本；没有分部披露时只能标记 needs_verification。`,
    "",
    "三、待补证据（needs_verification）",
    "需要补齐：审计年报/季报原文、分部收入与毛利、经营现金流、资本开支、客户/产品结构、重大公告、完整复权口径、行情数据源说明和行业基准。当前快照用于研究分析，不构成投资建议。",
  ];
  return lines.join("\n");
}

async function refreshOne(tx, [projectId, company, code, secid]) {
  const projectRows = await tx`SELECT p.id, p.owner_user_id, b.id AS branch_id, b.head_commit_id, b.version FROM knowledge_project p JOIN knowledge_branch b ON b.project_id=p.id AND b.name=p.default_branch_name WHERE p.id=${projectId} AND p.visibility='public' AND p.status='published' LIMIT 1`;
  const project = projectRows[0];
  if (!project) return { projectId, status: "skipped", reason: "project_missing" };
  const quoteUrl = `https://push2.eastmoney.com/api/qt/stock/get?secid=${encodeURIComponent(secid)}&fields=f43,f57,f58,f169,f170,f171`;
  const klineUrl = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60&klt=101&fqt=1&beg=20250901&end=${capturedAt.slice(0, 10).replaceAll("-", "")}`;
  const financeUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=SECUCODE%2CSECURITY_CODE%2CSECURITY_NAME_ABBR%2CREPORTDATE%2CTOTAL_OPERATE_INCOME%2CPARENT_NETPROFIT%2CWEIGHTAVG_ROE%2CYSTZ%2CSJLTZ&filter=(SECUCODE%3D%22${encodeURIComponent(code)}%22)&pageNumber=1&pageSize=5&sortColumns=REPORTDATE&sortTypes=-1`;
  const [quote, kline, finance] = await Promise.all([fetchJson(quoteUrl), fetchJson(klineUrl), code.endsWith(".HK") ? Promise.resolve({ result: { data: [] } }) : fetchJson(financeUrl)]);
  const trend = calculateTrend(kline?.data?.klines ?? []);
  const financial = finance?.result?.data ?? [];
  const snapshot = JSON.stringify({ capturedAt, code, quote, trend, financial, source: { quoteUrl, klineUrl, financeUrl } });
  const hash = sha256(snapshot);
  const commitId = `${projectId}-market-data-${MARKET_VERSION}`;
  if ((await tx`SELECT id FROM knowledge_commit WHERE id=${commitId} LIMIT 1`).length) return { projectId, status: "skipped", reason: "already_imported" };
  const reportRows = await tx`SELECT r.id AS report_id FROM report r JOIN company c ON c.id=r.company_id WHERE c.name IN (${company}, ${company === "金蝶国际" ? "金蝶" : company}) LIMIT 1`;
  const reportId = reportRows[0]?.report_id ? String(reportRows[0].report_id) : null;
  const sourceId = `${projectId}-market-data-${MARKET_VERSION}`;
  const existingSourceNodes = await tx`SELECT ns.node_id FROM knowledge_node_state ns JOIN knowledge_node n ON n.id=ns.node_id
    WHERE ns.project_id=${projectId} AND ns.branch_id=${String(project.branch_id)} AND n.kind='source' AND ns.name LIKE ${`${company}财报与行情快照%`} AND ns.deleted_at IS NULL ORDER BY ns.position DESC LIMIT 1`;
  const sourceNodeId = existingSourceNodes[0]?.node_id ? String(existingSourceNodes[0].node_id) : `${projectId}-node-market-data-${MARKET_VERSION}`;
  const existingDocNodes = await tx`SELECT ns.node_id FROM knowledge_node_state ns JOIN knowledge_node n ON n.id=ns.node_id
    WHERE ns.project_id=${projectId} AND ns.branch_id=${String(project.branch_id)} AND n.kind='document' AND ns.name='财报与股价趋势' AND ns.deleted_at IS NULL LIMIT 1`;
  const nodeId = existingDocNodes[0]?.node_id ? String(existingDocNodes[0].node_id) : `${projectId}-node-market-data-doc-${MARKET_VERSION}`;
  await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
    VALUES (${commitId},${projectId},${String(project.branch_id)},${project.head_commit_id ? String(project.head_commit_id) : null},${String(project.owner_user_id)},${`更新${company}公开财报与行情${MARKET_VERSION}`},FALSE,${`market-data:${projectId}:${MARKET_VERSION}`},${hash},${JSON.stringify({ code, source: "eastmoney", evidenceState: "needs_verification", marketVersion: MARKET_VERSION })}::jsonb,${capturedAt})`;
  await tx`INSERT INTO knowledge_node (id,project_id,kind,created_by_user_id,created_at) VALUES (${sourceNodeId},${projectId},'source',${String(project.owner_user_id)},${capturedAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node_state (project_id,branch_id,node_id,parent_node_id,name,position,deleted_at,updated_at) VALUES (${projectId},${String(project.branch_id)},${sourceNodeId},NULL,${`${company}财报与行情快照（${MARKET_VERSION}）`},50,NULL,${capturedAt}) ON CONFLICT (branch_id,node_id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node (id,project_id,kind,created_by_user_id,created_at) VALUES (${nodeId},${projectId},'document',${String(project.owner_user_id)},${capturedAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_node_state (project_id,branch_id,node_id,parent_node_id,name,position,deleted_at,updated_at) VALUES (${projectId},${String(project.branch_id)},${nodeId},NULL,'财报与股价趋势',51,NULL,${capturedAt}) ON CONFLICT (branch_id,node_id) DO NOTHING`;
  if (reportId) {
    await tx`INSERT INTO source (id,report_id,title,kind,url,language,state,captured_at,content_hash,snapshot,evidence_state,metadata) VALUES (${sourceId},${reportId},${`${company}公开财报与行情快照`},'web',${quoteUrl},'zh','active',${capturedAt},${hash},${snapshot},'needs_verification',${JSON.stringify({ provider: "eastmoney_public_api", code, capturedAt, klineUrl, financeUrl })}::jsonb) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO source_chunk (id,source_id,parent_section_id,heading_path,position,page,start_offset,end_offset,text,contextual_prefix,content_hash) VALUES (${`${sourceId}-chunk-1`},${sourceId},NULL,${["公开行情与财报",company]},1,NULL,0,${snapshot.length},${snapshot},${`公开接口快照；${company}；需与交易所/公司公告交叉核验`},${hash}) ON CONFLICT (id) DO NOTHING`;
  }
  const text = reportText(company, code, quote, financial, trend);
  const previousRevisionRows = await tx`SELECT id FROM document_revision WHERE project_id=${projectId} AND node_id=${nodeId} AND branch_id=${String(project.branch_id)} ORDER BY created_at DESC LIMIT 1`;
  const previousRevisionId = previousRevisionRows[0]?.id ? String(previousRevisionRows[0].id) : null;
  const revisionId = `${nodeId}-revision-${MARKET_VERSION}`;
  await tx`INSERT INTO document_revision (id,project_id,node_id,branch_id,commit_id,previous_revision_id,content,content_text,content_hash,created_by_user_id,created_at) VALUES (${revisionId},${projectId},${nodeId},${String(project.branch_id)},${commitId},${previousRevisionId},${JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: { evidenceState: "inference" }, content: [{ type: "text", text }] }] })}::jsonb,${text},${sha256(text)},${String(project.owner_user_id)},${capturedAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO commit_change (id,commit_id,node_id,operation,before_revision_id,after_revision_id,metadata,position) VALUES (${`${commitId}:${nodeId}`},${commitId},${nodeId},'update_content',${previousRevisionId},${revisionId},${JSON.stringify({ evidenceState: "inference", sourceId, marketVersion: MARKET_VERSION })}::jsonb,0) ON CONFLICT (id) DO NOTHING`;
  if (reportId) {
    await tx`INSERT INTO report_section (id,report_id,parent_section_id,heading,anchor,level,position,content,evidence_state,updated_at) VALUES (${`${projectId}-market-section-${MARKET_VERSION}`},${reportId},NULL,'财报与股价趋势',${`market-trend-${MARKET_VERSION}`},1,90,${text},'inference',${capturedAt}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO citation (id,report_id,section_id,source_id,chunk_id,quote,evidence_state,created_at) VALUES (${`${projectId}-market-citation-${MARKET_VERSION}`},${reportId},${`${projectId}-market-section-${MARKET_VERSION}`},${sourceId},${`${sourceId}-chunk-1`},${`公开行情/财报快照（${capturedAt}）`},'needs_verification',${capturedAt}) ON CONFLICT (id) DO NOTHING`;
  }
  await tx`UPDATE knowledge_branch SET head_commit_id=${commitId},version=GREATEST(version,${Number(project.version ?? 1)+1}),updated_at=${capturedAt} WHERE id=${String(project.branch_id)}`;
  return { projectId, status: "imported", trend, financialRows: financial.length };
}

async function main() {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 20, connect_timeout: 20 });
  const result = { imported: 0, skipped: 0, failed: 0, details: [] };
  try { await sql.begin(async (tx) => { for (const item of listed) { try { const outcome = await refreshOne(tx, item); result.details.push(outcome); if (outcome.status === "imported") result.imported += 1; else result.skipped += 1; } catch (error) { result.failed += 1; result.details.push({ projectId: item[0], status: "failed", reason: error instanceof Error ? error.message : "unknown" }); } } }); }
  finally { await sql.end({ timeout: 5 }); }
  console.log(JSON.stringify(result, null, 2));
  if (result.failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "market refresh failed"); process.exitCode = 1; });
