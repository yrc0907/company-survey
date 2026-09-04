import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";

/**
 * 将仓库中的独立 Markdown 报告导入公开知识项目。
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
  ["project-icourt", "北京新橙科技（iCourt）", "北京新橙科技（iCourt）-2026独立研究.md"],
  ["project-yuhe", "语核（上海）科技有限公司", "语核（上海）科技-2026独立研究.md"],
  ["project-digitalchina", "神州数码", "神州数码-2026独立研究.md"],
  ["project-bytedance-food-sales", "字节跳动抖音生活服务餐饮大客户销售", "字节跳动抖音生活服务餐饮大客户销售-2026独立研究.md"],
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

/** 为新增企业建立最小真实项目、报告和官网来源；已有项目不被此函数改写。 */
async function ensureIcourtProject(tx) {
  const projectId = "project-icourt";
  const exists = await tx`SELECT id FROM knowledge_project WHERE id=${projectId} LIMIT 1`;
  if (exists.length) return;
  const createdAt = "2026-09-03T00:00:00Z";
  await tx`INSERT INTO company (id, name, kind, summary, tags, created_at, updated_at)
    VALUES ('company-icourt', '北京新橙科技（iCourt）', 'company', '法律科技、法律大数据和法律 AI 工作平台研究对象。', ARRAY['法律科技','法律 AI','律所数字化']::TEXT[], ${createdAt}, ${createdAt})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO report (id, company_id, title, status, current_version, created_at, updated_at)
    VALUES ('report-icourt', 'company-icourt', '北京新橙科技（iCourt）：法律 AI 与律所数字化研究', 'draft', 1, ${createdAt}, ${createdAt})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_project
    (id, owner_user_id, slug, title, summary, visibility, status, license, default_branch_name, published_at, created_at, updated_at, category, tags, verification, verification_note)
    VALUES ('project-icourt', 'u-yu', 'icourt-legal-ai', '北京新橙科技（iCourt）：法律 AI 与律所数字化研究', '研究法律数据库、案件办理、律所管理和受控法律 Agent 如何形成可验证的专业工作平台；收入、价格、续费和模型效果按公开证据核验。', 'public', 'published', 'cc-by-4.0', 'main', ${createdAt}, ${createdAt}, ${createdAt}, '企业', ARRAY['法律科技','法律 AI','Alpha','AlphaGPT','AlphaClaw']::TEXT[], 'needs_verification', '主体和产品来自 iCourt 官网；财务、价格、续费、客户合同和模型效果仍需独立来源。')
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_member (project_id, user_id, role, created_at)
    VALUES ('project-icourt', 'u-yu', 'owner', ${createdAt}) ON CONFLICT (project_id, user_id) DO NOTHING`;
  await tx`INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, is_protected, status, version, created_at, updated_at)
    VALUES ('branch-icourt-main', 'project-icourt', 'main', NULL, TRUE, 'active', 1, ${createdAt}, ${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, created_at)
    VALUES ('commit-icourt-public-v1', 'project-icourt', 'branch-icourt-main', NULL, 'u-yu', '建立 iCourt 公开研究项目与证据边界', FALSE, ${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`UPDATE knowledge_branch SET head_commit_id='commit-icourt-public-v1', version=GREATEST(version, 1), updated_at=${createdAt} WHERE id='branch-icourt-main'`;
  const snapshot = 'iCourt 官网公开资料入口：北京新橙科技有限公司（iCourt）提供法律大数据、案件办理、律所管理和法律 AI 产品。官网宣传数字与功能描述均需按企业自述处理。';
  const sourceHash = hash(snapshot);
  await tx`INSERT INTO source (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot, evidence_state, metadata)
    VALUES ('source-icourt-official-v1', 'report-icourt', 'iCourt 官网公开资料', 'web', 'https://www.icourt.cc/about/intro', 'zh', 'active', ${createdAt}, ${sourceHash}, ${snapshot}, 'needs_verification', ${JSON.stringify({ sourceType: "official_website", publisher: "北京新橙科技（iCourt）", capturedAt: createdAt })}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO source_chunk (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
    VALUES ('chunk-icourt-official-v1', 'source-icourt-official-v1', NULL, ARRAY['iCourt 官网','公开资料']::TEXT[], 1, NULL, 0, ${snapshot.length}, ${snapshot}, '企业官网快照；事实状态 needs_verification。', ${sourceHash}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO citation (id, report_id, section_id, source_id, chunk_id, quote, evidence_state, created_at)
    VALUES ('citation-icourt-official-v1', 'report-icourt', NULL, 'source-icourt-official-v1', 'chunk-icourt-official-v1', 'iCourt 官网公开资料入口与主体说明。', 'needs_verification', ${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_stats (project_id, unique_readers, updated_at)
    VALUES ('project-icourt', 0, ${createdAt}) ON CONFLICT (project_id) DO NOTHING`;
}

/** 为用户提供的招聘截图主体建立最小公开项目；未把岗位文案升级为经营事实。 */
async function ensureYuheProject(tx) {
  const projectId = "project-yuhe";
  if ((await tx`SELECT id FROM knowledge_project WHERE id=${projectId} LIMIT 1`).length) return;
  const createdAt = "2026-09-03T00:00:00Z";
  await tx`INSERT INTO company (id,name,kind,summary,tags,created_at,updated_at)
    VALUES ('company-yuhe','语核（上海）科技有限公司','company','企业 Agent 与人工智能应用招聘线索研究对象。',ARRAY['人工智能','Agent','ToB']::TEXT[],${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO report (id,company_id,title,status,current_version,created_at,updated_at)
    VALUES ('report-yuhe','company-yuhe','语核（上海）科技有限公司：企业 Agent 与 ToB 应用研究','draft',1,${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_project (id,owner_user_id,slug,title,summary,visibility,status,license,default_branch_name,published_at,created_at,updated_at,category,tags,verification,verification_note)
    VALUES ('project-yuhe','u-yu','yuhe-ai','语核（上海）科技有限公司：企业 Agent 与 ToB 应用研究','基于招聘材料研究语核的主体、Agent 产品假设、ToB 商业化和销售工程师/FDE 组织；产品、客户、财务和收入保持待核验。','public','published','cc-by-4.0','main',${createdAt},${createdAt},${createdAt},'企业',ARRAY['人工智能','Agent','ToB 商业化','销售工程师']::TEXT[],'needs_verification','主体与岗位信息来自用户提供招聘截图；官网、产品、客户、财务和合同证据待核验。') ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_member(project_id,user_id,role,created_at) VALUES ('project-yuhe','u-yu','owner',${createdAt}) ON CONFLICT (project_id,user_id) DO NOTHING`;
  await tx`INSERT INTO knowledge_branch(id,project_id,name,owner_user_id,is_protected,status,version,created_at,updated_at) VALUES ('branch-yuhe-main','project-yuhe','main',NULL,TRUE,'active',1,${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_commit(id,project_id,branch_id,parent_commit_id,author_user_id,message,ai_assisted,created_at) VALUES ('commit-yuhe-public-v1','project-yuhe','branch-yuhe-main',NULL,'u-yu','建立语核公开研究项目与证据边界',FALSE,${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`UPDATE knowledge_branch SET head_commit_id='commit-yuhe-public-v1',version=GREATEST(version,1),updated_at=${createdAt} WHERE id='branch-yuhe-main'`;
  const snapshot='用户提供的语核（上海）科技有限公司招聘截图：人工智能方向，强调 Agent 团队、ToB 商业体系、业务导师与技术导师、销售工程师到区域销售负责人的培养路径；办公地点为上海市徐汇区古美路1528号。原始招聘链接尚未取得，主体、产品和客户数据需继续核验。';
  const sourceHash=hash(snapshot);
  await tx`INSERT INTO source(id,report_id,title,kind,url,language,state,captured_at,content_hash,snapshot,evidence_state,metadata) VALUES ('source-yuhe-recruitment-v1','report-yuhe','语核招聘截图（用户提供）','image',NULL,'zh','active',${createdAt},${sourceHash},${snapshot},'needs_verification',${JSON.stringify({sourceType:'user_provided_screenshot',capturedAt:createdAt})}::jsonb) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO source_chunk(id,source_id,parent_section_id,heading_path,position,page,start_offset,end_offset,text,contextual_prefix,content_hash) VALUES ('chunk-yuhe-recruitment-v1','source-yuhe-recruitment-v1',NULL,ARRAY['招聘截图','岗位与培养']::TEXT[],1,NULL,0,${snapshot.length},${snapshot},'用户提供截图；证据状态 needs_verification。',${sourceHash}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO citation(id,report_id,section_id,source_id,chunk_id,quote,evidence_state,created_at) VALUES ('citation-yuhe-recruitment-v1','report-yuhe',NULL,'source-yuhe-recruitment-v1','chunk-yuhe-recruitment-v1','用户提供的语核招聘截图。','needs_verification',${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_stats(project_id,unique_readers,updated_at) VALUES ('project-yuhe',0,${createdAt}) ON CONFLICT (project_id) DO NOTHING`;
}

/** 为神州数码建立公开研究项目；金额和经营事实以报告来源为准，不在此处伪造统计。 */
async function ensureDigitalChinaProject(tx) {
  const projectId = "project-digitalchina";
  if ((await tx`SELECT id FROM knowledge_project WHERE id=${projectId} LIMIT 1`).length) return;
  const createdAt = "2026-09-04T00:00:00Z";
  await tx`INSERT INTO company (id,name,kind,summary,tags,created_at,updated_at)
    VALUES ('company-digitalchina','神州数码集团股份有限公司','company','基于 2025 年更正年报与 2026 年半年度报告研究其 IT 分销、国产算力、数云服务、企业 Agent 和 FDE 交付模式。',ARRAY['神州数码','IT分销','国产算力','企业AI','FDE']::TEXT[],${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO report (id,company_id,title,status,current_version,created_at,updated_at)
    VALUES ('report-digitalchina','company-digitalchina','神州数码：AI 基础设施、数云服务与 FDE 交付研究','draft',1,${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_project (id,owner_user_id,slug,title,summary,visibility,status,license,default_branch_name,published_at,created_at,updated_at,category,tags,verification,verification_note)
    VALUES ('project-digitalchina','u-yu','digital-china-group','神州数码：AI 基础设施、数云服务与 FDE 交付研究','基于神州数码 2025 年更正年报、2026 年半年度报告和公开公告，研究其分销底座、鲲泰算力、神州问学、AI Factory 2.0 与 FDE 模式；宣传效果、合同验收和续费仍按证据等级标注。','public','published','cc-by-4.0','main',${createdAt},${createdAt},${createdAt},'企业',ARRAY['神州数码','IT分销','国产算力','AI Agent','FDE']::TEXT[],'needs_verification','财务和分部数据来自上市公司报告；产品效果、客户验收、续费、底层 RAG 组件和岗位细节仍需第三方或原始合同核验。') ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_member(project_id,user_id,role,created_at) VALUES ('project-digitalchina','u-yu','owner',${createdAt}) ON CONFLICT (project_id,user_id) DO NOTHING`;
  await tx`INSERT INTO knowledge_branch(id,project_id,name,owner_user_id,is_protected,status,version,created_at,updated_at) VALUES ('branch-digitalchina-main','project-digitalchina','main',NULL,TRUE,'active',1,${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_commit(id,project_id,branch_id,parent_commit_id,author_user_id,message,ai_assisted,created_at) VALUES ('commit-digitalchina-public-v1','project-digitalchina','branch-digitalchina-main',NULL,'u-yu','建立神州数码公开研究项目与证据边界',FALSE,${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`UPDATE knowledge_branch SET head_commit_id='commit-digitalchina-public-v1',version=GREATEST(version,1),updated_at=${createdAt} WHERE id='branch-digitalchina-main'`;
  const snapshot = '神州数码 2025 年更正年报与 2026 年半年度报告：上市公司 000034.SZ；披露 IT 分销及增值服务、数云服务及软件、自有品牌算力基础设施产品三类业务，并在 2026 年半年报中明确 AI Factory 2.0 与 FDE（Forward Deployed Engineer）交付模式。金额、日期和业务描述以原始报告为准，产品效果和客户验收按 company_claim 或 needs_verification 处理。';
  const sourceHash = hash(snapshot);
  await tx`INSERT INTO source (id,report_id,title,kind,url,language,state,captured_at,content_hash,snapshot,evidence_state,metadata)
    VALUES ('source-digitalchina-reports-v1','report-digitalchina','神州数码 2025 年更正年报与 2026 年半年度报告','pdf','https://pdf.dfcfw.com/pdf/H2_AN202608280006758525_1.pdf','zh','active',${createdAt},${sourceHash},${snapshot},'fact',${JSON.stringify({ sourceType: 'listed_company_annual_and_interim_reports', annualUrl: 'https://pdf.dfcfw.com/pdf/H2_AN202606121823514897_1.pdf', interimUrl: 'https://pdf.dfcfw.com/pdf/H2_AN202608280006758525_1.pdf', capturedAt: createdAt })}::jsonb)
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO source_chunk (id,source_id,parent_section_id,heading_path,position,page,start_offset,end_offset,text,contextual_prefix,content_hash)
    VALUES ('chunk-digitalchina-reports-v1','source-digitalchina-reports-v1',NULL,ARRAY['神州数码报告','财务与 FDE']::TEXT[],1,NULL,0,${snapshot.length},${snapshot},'上市公司年报/半年报快照；财务字段为 fact，宣传效果和未披露合同字段保持分层。',${sourceHash}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO citation (id,report_id,section_id,source_id,chunk_id,quote,evidence_state,created_at)
    VALUES ('citation-digitalchina-reports-v1','report-digitalchina',NULL,'source-digitalchina-reports-v1','chunk-digitalchina-reports-v1','2025 年更正年报与 2026 年半年度报告中的分部财务、AI 基础设施和 FDE 公开披露。','fact',${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_stats(project_id,unique_readers,updated_at) VALUES ('project-digitalchina',0,${createdAt}) ON CONFLICT (project_id) DO NOTHING`;
}

/** 为字节跳动餐饮大客户销售研究建立公开项目；岗位和平台能力按证据等级保留，未披露经营数据不作编造。 */
async function ensureByteDanceFoodSalesProject(tx) {
  const projectId = "project-bytedance-food-sales";
  if ((await tx`SELECT id FROM knowledge_project WHERE id=${projectId} LIMIT 1`).length) return;
  const createdAt = "2026-09-04T00:00:00Z";
  await tx`INSERT INTO company (id,name,kind,summary,tags,created_at,updated_at)
    VALUES ('company-bytedance-food-sales','字节跳动抖音生活服务餐饮大客户销售','company','基于字节跳动官方招聘页、抖音来客官方商家平台和公开企业资料，研究餐饮到店服务大客户销售、全国连锁品牌经营、平台广告与交易协同及行业解决方案能力。',ARRAY['字节跳动','抖音生活服务','餐饮','大客户销售','本地生活']::TEXT[],${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO report (id,company_id,title,status,current_version,created_at,updated_at)
    VALUES ('report-bytedance-food-sales','company-bytedance-food-sales','字节跳动抖音生活服务餐饮大客户销售：2026 独立研究','draft',1,${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_project (id,owner_user_id,slug,title,summary,visibility,status,license,default_branch_name,published_at,created_at,updated_at,category,tags,verification,verification_note)
    VALUES ('project-bytedance-food-sales','u-yu','bytedance-food-sales','字节跳动抖音生活服务餐饮大客户销售：2026 独立研究','基于字节跳动官方招聘页、抖音来客官方商家平台和公开企业资料，研究餐饮到店服务大客户销售、全国连锁品牌经营、平台广告与交易协同及行业解决方案能力。','public','published','cc-by-4.0','main',${createdAt},${createdAt},${createdAt},'企业',ARRAY['字节跳动','抖音生活服务','餐饮','大客户销售','本地生活']::TEXT[],'needs_verification','岗位职责和平台工具来自官方公开资料；薪酬、提成、KPI、客户合同、实际 GMV、续投率、数据权限和团队组织结构未公开，需面试或原始业务材料核验。') ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO project_member(project_id,user_id,role,created_at) VALUES ('project-bytedance-food-sales','u-yu','owner',${createdAt}) ON CONFLICT (project_id,user_id) DO NOTHING`;
  await tx`INSERT INTO knowledge_branch(id,project_id,name,owner_user_id,is_protected,status,version,created_at,updated_at) VALUES ('branch-bytedance-food-sales-main','project-bytedance-food-sales','main',NULL,TRUE,'active',1,${createdAt},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO knowledge_commit(id,project_id,branch_id,parent_commit_id,author_user_id,message,ai_assisted,created_at) VALUES ('commit-bytedance-food-sales-public-v1','project-bytedance-food-sales','branch-bytedance-food-sales-main',NULL,'u-yu','建立字节跳动抖音生活服务餐饮大客户销售公开研究项目与证据边界',FALSE,${createdAt}) ON CONFLICT (id) DO NOTHING`;
  await tx`UPDATE knowledge_branch SET head_commit_id='commit-bytedance-food-sales-public-v1',version=GREATEST(version,1),updated_at=${createdAt} WHERE id='branch-bytedance-food-sales-main'`;
  const sources = [
    {
      id: 'source-bytedance-food-sales-job-v1',
      title: '字节跳动官方招聘：大客户销售-抖音生活服务（A117919）',
      kind: 'web',
      url: 'https://jobs.bytedance.com/experienced/position/7670012668195588357/detail',
      snapshot: '字节跳动官方招聘页岗位“大客户销售-抖音生活服务”，地点广州，正式岗位，职位 ID A117919。职责涉及到店服务大客户、营销策略和广告方案、商品与门店经营效果、全国综合连锁品牌规划及资源整合；任职要求包括大客户销售或相关行业经验、客户开拓服务、谈判、表达和市场洞察。岗位收入、提成、客户名单和 KPI 权重未公开。',
      evidence: 'fact',
      type: 'official_recruitment',
    },
    {
      id: 'source-bytedance-food-sales-life-v1',
      title: '抖音来客官方商家平台',
      kind: 'web',
      url: 'https://life.douyin.com/',
      snapshot: '抖音生活服务官方商家经营平台页面描述商家可免费入驻开店，并提供上品、经营、履约、促活、营销等工具，支持达人推广、商家直播、抖音本地推、商家优惠券和服务团队运营指导。平台流量、订单和收益效果属于企业自述，不等同于独立审计结果。',
      evidence: 'company_claim',
      type: 'official_product_page',
    },
    {
      id: 'source-bytedance-company-v1',
      title: '字节跳动官方企业站',
      kind: 'web',
      url: 'https://www.bytedance.com/zh/',
      snapshot: '字节跳动官方企业站介绍公司成立于 2012 年，产品与服务覆盖抖音、今日头条、西瓜视频、飞书等，并面向多个国家和地区提供产品与服务。该描述为企业官网内容。',
      evidence: 'company_claim',
      type: 'official_company_site',
    },
  ];
  for (const source of sources) {
    const sourceHash = hash(source.snapshot);
    // 数据库只接受 fact/inference/needs_verification/conflict；企业自述保留在元数据，状态落为待核验。
    const evidenceState = source.evidence === 'fact' ? 'fact' : 'needs_verification';
    await tx`INSERT INTO source (id,report_id,title,kind,url,language,state,captured_at,content_hash,snapshot,evidence_state,metadata)
      VALUES (${source.id},'report-bytedance-food-sales',${source.title},${source.kind},${source.url},'zh','active',${createdAt},${sourceHash},${source.snapshot},${evidenceState},${JSON.stringify({ sourceType: source.type, publisher: '字节跳动', capturedAt: createdAt, evidenceLabel: source.evidence })}::jsonb) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO source_chunk (id,source_id,parent_section_id,heading_path,position,page,start_offset,end_offset,text,contextual_prefix,content_hash)
      VALUES (${`${source.id}-chunk`},${source.id},NULL,ARRAY['字节跳动餐饮销售研究','官方来源']::TEXT[],1,NULL,0,${source.snapshot.length},${source.snapshot},${`官方来源快照；证据状态 ${evidenceState}（来源标签 ${source.evidence}）。`},${sourceHash}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO citation (id,report_id,section_id,source_id,chunk_id,quote,evidence_state,created_at)
      VALUES (${`${source.id}-citation`},'report-bytedance-food-sales',NULL,${source.id},${`${source.id}-chunk`},${source.title},${evidenceState},${createdAt}) ON CONFLICT (id) DO NOTHING`;
  }
  await tx`INSERT INTO project_stats(project_id,unique_readers,updated_at) VALUES ('project-bytedance-food-sales',0,${createdAt}) ON CONFLICT (project_id) DO NOTHING`;
}

/** 将字节跳动报告的官方来源投影到公开文件树，保证来源可点击且与单文件正文并列。 */
async function ensureByteDanceFoodSalesSourceNodes(tx) {
  const projectId = "project-bytedance-food-sales";
  const rows = await tx`SELECT id, owner_user_id FROM knowledge_project WHERE id=${projectId} LIMIT 1`;
  const project = rows[0];
  if (!project) return;
  const branchRows = await tx`SELECT id FROM knowledge_branch WHERE project_id=${projectId} AND name='main' LIMIT 1`;
  const branch = branchRows[0];
  if (!branch) return;
  const sourceNodes = [
    ["source-bytedance-food-sales-job-v1-node", "字节跳动官方招聘：大客户销售-抖音生活服务（A117919）"],
    ["source-bytedance-food-sales-life-v1-node", "抖音来客官方商家平台"],
    ["source-bytedance-company-v1-node", "字节跳动官方企业站"],
  ];
  for (const [index, [nodeId, name]] of sourceNodes.entries()) {
    await tx`INSERT INTO knowledge_node (id,project_id,kind,created_by_user_id,created_at)
      VALUES (${nodeId},${projectId},'source',${String(project.owner_user_id)},${now}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO knowledge_node_state (project_id,branch_id,node_id,parent_node_id,name,position,deleted_at,updated_at)
      VALUES (${projectId},${String(branch.id)},${nodeId},NULL,${name},${index + 10},NULL,${now})
      ON CONFLICT (branch_id,node_id) DO UPDATE SET name=EXCLUDED.name, parent_node_id=NULL, position=EXCLUDED.position, deleted_at=NULL, updated_at=EXCLUDED.updated_at`;
  }
}

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
  let commitId = `${projectId}-dossier-markdown-v1`;
  let revisionId = `${nodeId}-revision-v1`;
  let previousRevisionId = null;
  let parentCommitId = branch.head_commit_id ? String(branch.head_commit_id) : null;
  const existingCommit = await tx`SELECT id FROM knowledge_commit WHERE id=${commitId} LIMIT 1`;
  const existingNode = await tx`SELECT id FROM knowledge_node WHERE id=${nodeId} LIMIT 1`;
  if (existingCommit.length && existingNode.length) {
    const latest = await tx`SELECT id, content_hash FROM document_revision WHERE project_id=${projectId} AND node_id=${nodeId} AND branch_id=${String(branch.id)} ORDER BY created_at DESC LIMIT 1`;
    if (String(latest[0]?.content_hash ?? "") === contentHash) return { projectId, status: "skipped", reason: "already_imported", contentHash };
    // 报告正文变化时追加不可变版本，不覆盖原始 Revision；哈希后缀保证幂等。
    commitId = `${projectId}-dossier-markdown-${contentHash.slice(0, 12)}`;
    revisionId = `${nodeId}-revision-${contentHash.slice(0, 12)}`;
    previousRevisionId = latest[0]?.id ? String(latest[0].id) : null;
  }

  // 恢复公开状态是用户刚刚明确确认的动作；不改写 owner、许可证或统计事实。
  await tx`UPDATE knowledge_project
    SET visibility='public', status='published', published_at=COALESCE(published_at, ${now}), updated_at=${now}
    WHERE id=${projectId}`;

  // 来源节点保留在数据库以便首页统计和后续检索，但不出现在“单文件”公开文件树中。
  if (projectId === "project-icourt" || projectId === "project-yuhe") {
    const sourceNodeId = projectId === "project-icourt" ? "source-node-icourt-official" : "source-node-yuhe-recruitment";
    const sourceName = projectId === "project-icourt" ? "iCourt 官网公开资料" : "语核招聘截图（用户提供）";
    await tx`INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
      VALUES (${sourceNodeId}, ${projectId}, 'source', ${String(project.owner_user_id)}, ${now}) ON CONFLICT (id) DO NOTHING`;
    await tx`INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
      VALUES (${projectId}, ${String(branch.id)}, ${sourceNodeId}, NULL, ${sourceName}, 20, ${now}, ${now})
      ON CONFLICT (branch_id, node_id) DO UPDATE SET deleted_at=EXCLUDED.deleted_at, updated_at=EXCLUDED.updated_at`;
  }

  if (existingCommit.length && existingNode.length && commitId === `${projectId}-dossier-markdown-v1`) return { projectId, status: "skipped", reason: "already_imported", contentHash };

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
    VALUES (${commitId}, ${projectId}, ${String(branch.id)}, ${parentCommitId}, ${String(project.owner_user_id)}, ${`导入${company}完整 Markdown 研究报告`}, FALSE, ${now})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO document_revision
    (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
    VALUES (${revisionId}, ${projectId}, ${nodeId}, ${String(branch.id)}, ${commitId}, ${previousRevisionId}, ${JSON.stringify(tiptapDocument(markdown, nodeId))}::jsonb, ${markdown}, ${contentHash}, ${String(project.owner_user_id)}, ${now})
    ON CONFLICT (id) DO NOTHING`;
  await tx`INSERT INTO commit_change
    (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
    VALUES (${`${commitId}:create:${nodeId}`}, ${commitId}, ${nodeId}, ${previousRevisionId ? 'update_content' : 'create_node'}, ${previousRevisionId}, ${revisionId}, ${JSON.stringify({ kind: "markdown", name: fileName, contentHash, source: "repository_dossier" })}::jsonb, 0)
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
      await ensureIcourtProject(tx);
      await ensureYuheProject(tx);
      await ensureDigitalChinaProject(tx);
      await ensureByteDanceFoodSalesProject(tx);
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
      await ensureByteDanceFoodSalesSourceNodes(tx);
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
