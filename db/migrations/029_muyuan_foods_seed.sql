-- 牧原食品公开研究项目：先建立来源和研究框架，不以官网入口推断财务/猪价/估值结论。
-- 后续年报、公告和行情资料必须以新 source/revision 追加，不能改写本次历史快照。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_user WHERE id = 'u-yu' AND status = 'active') THEN
    RAISE EXCEPTION '牧原食品首发项目需要 active 维护者 u-yu';
  END IF;
END $$;

INSERT INTO company (id, name, kind, summary, tags, created_at, updated_at)
VALUES ('company-muyuan', '牧原食品', 'company', '生猪养殖与产业链经营研究对象。', ARRAY['生猪养殖','农牧食品','产业链','上市公司']::TEXT[], '2026-09-02T16:00:00Z', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO report (id, company_id, title, status, current_version, created_at, updated_at)
VALUES ('report-muyuan', 'company-muyuan', '牧原食品：生猪养殖、周期与产业链研究', 'draft', 1, '2026-09-02T16:00:00Z', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_project (id, owner_user_id, slug, title, summary, visibility, status, license, default_branch_name, published_at, created_at, updated_at, category, tags, verification, verification_note)
VALUES ('project-muyuan', 'u-yu', 'muyuan-foods-livestock', '牧原食品：生猪养殖、周期与产业链研究', '从公开官网和后续公告入口研究生猪养殖产业链、周期风险、成本结构与战略边界；财务和行情数据需逐条引用。', 'public', 'published', 'cc-by-4.0', 'main', '2026-09-02T16:00:00Z', '2026-09-02T16:00:00Z', '2026-09-02T16:00:00Z', '企业', ARRAY['生猪养殖','农牧食品','上市公司','周期研究']::TEXT[], 'needs_verification', '已建立官网与公告研究入口；收入、利润、出栏、猪价和股价结论等待可核验来源。')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_member (project_id, user_id, role, created_at)
VALUES ('project-muyuan', 'u-yu', 'owner', '2026-09-02T16:00:00Z')
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, is_protected, status, version, created_at, updated_at)
VALUES ('branch-muyuan-main', 'project-muyuan', 'main', NULL, TRUE, 'active', 1, '2026-09-02T16:00:00Z', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, idempotency_fingerprint, change_summary, created_at)
VALUES ('commit-muyuan-public-v1', 'project-muyuan', 'branch-muyuan-main', NULL, 'u-yu', '建立牧原食品公开研究框架与来源边界', FALSE, 'seed:muyuan:v1', '37ca5460919de15e6052d3b6efc5822655aebbbe22fe39bc8338f49f5303c576', '{"sourceType":"official_website","evidenceState":"needs_verification"}'::jsonb, '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

UPDATE knowledge_branch SET head_commit_id = 'commit-muyuan-public-v1', version = GREATEST(version, 1), updated_at = '2026-09-02T16:00:00Z'
WHERE id = 'branch-muyuan-main';

INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
VALUES
  ('folder-muyuan-research', 'project-muyuan', 'folder', 'u-yu', '2026-09-02T16:00:00Z'),
  ('doc-muyuan-overview', 'project-muyuan', 'document', 'u-yu', '2026-09-02T16:00:00Z'),
  ('doc-muyuan-analysis', 'project-muyuan', 'document', 'u-yu', '2026-09-02T16:00:00Z'),
  ('source-node-muyuan-official', 'project-muyuan', 'source', 'u-yu', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
VALUES
  ('project-muyuan', 'branch-muyuan-main', 'folder-muyuan-research', NULL, '研究报告', 1, NULL, '2026-09-02T16:00:00Z'),
  ('project-muyuan', 'branch-muyuan-main', 'doc-muyuan-overview', 'folder-muyuan-research', '研究结论与证据边界', 1, NULL, '2026-09-02T16:00:00Z'),
  ('project-muyuan', 'branch-muyuan-main', 'doc-muyuan-analysis', 'folder-muyuan-research', '研究者分析与战略问题', 2, NULL, '2026-09-02T16:00:00Z'),
  ('project-muyuan', 'branch-muyuan-main', 'source-node-muyuan-official', NULL, '牧原食品官网公开入口', 20, NULL, '2026-09-02T16:00:00Z')
ON CONFLICT (branch_id, node_id) DO NOTHING;

INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
VALUES
  ('revision-muyuan-overview-v1', 'project-muyuan', 'doc-muyuan-overview', 'branch-muyuan-main', 'commit-muyuan-public-v1', NULL, '{"type":"doc","content":[]}'::jsonb,
   '研究对象：牧原食品集团股份有限公司（股票代码 002714.SZ）。本项目研究生猪养殖与产业链经营，不把官网入口、股票代码或行业常识直接等同于收入、利润、猪价、出栏量、成本或估值事实。\n\n当前可确认：公司官网是公开入口；生猪养殖行业具有强周期、疫病、生物安全、饲料成本、环保和价格波动等研究维度。\n\n待核验：年报和季报口径下的营收、归母净利润、现金流、负债、出栏量、成本、产品结构、区域布局、股价区间和市场预期。',
   '37ca5460919de15e6052d3b6efc5822655aebbbe22fe39bc8338f49f5303c576', 'u-yu', '2026-09-02T16:00:00Z'),
  ('revision-muyuan-analysis-v1', 'project-muyuan', 'doc-muyuan-analysis', 'branch-muyuan-main', 'commit-muyuan-public-v1', NULL, '{"type":"doc","content":[]}'::jsonb,
   '研究者判断（inference）：牧原食品的核心不是单一产品功能，而是围绕生猪养殖形成的规模化生产、成本控制、生物安全、供应链和周期管理能力组合。竞争不能只看同行产能，也要看成本曲线、疾病防控、现金流韧性、食品安全信任和区域资源约束。\n\n竞争策略问题：当行业景气向下时，重点不是盲目扩张，而是验证单位成本、现金流、负债期限、种猪/饲料/防疫体系和销售渠道是否能承受波动；景气向上时，重点验证产能兑现、价格弹性与资本开支纪律。\n\n合作与资源整合：需要把饲料、育种、兽医防疫、智能设备、冷链屠宰、食品渠道、金融与保险、地方环保和数字化数据治理分别建成可验证关系图。任何“领先”“收益最高”“利润改善”结论必须引用年报、公告、行业统计或可复核行情数据。',
   'd1e7b08ee82d0078d887c23d49e2cc03d9bbd1cf3264fa0d7afc97b8c266f1d6', 'u-yu', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO commit_change (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
VALUES
  ('change-muyuan-overview-v1', 'commit-muyuan-public-v1', 'doc-muyuan-overview', 'update_content', NULL, 'revision-muyuan-overview-v1', '{"evidenceState":"needs_verification"}'::jsonb, 1),
  ('change-muyuan-analysis-v1', 'commit-muyuan-public-v1', 'doc-muyuan-analysis', 'update_content', NULL, 'revision-muyuan-analysis-v1', '{"evidenceState":"inference"}'::jsonb, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_section (id, report_id, parent_section_id, heading, anchor, level, position, content, evidence_state, updated_at)
VALUES
  ('section-muyuan-overview', 'report-muyuan', NULL, '研究结论与证据边界', 'overview-boundary', 1, 1, '牧原食品研究项目已建立；财务、经营和行情结论等待逐条来源导入。', 'needs_verification', '2026-09-02T16:00:00Z'),
  ('section-muyuan-analysis', 'report-muyuan', NULL, '研究者分析与战略问题', 'analyst-view', 1, 2, '行业周期、成本控制、资源整合和合作策略属于研究推断，必须与年报和行业数据交叉验证。', 'inference', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO source (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot, evidence_state, metadata)
VALUES ('source-muyuan-official-v1', 'report-muyuan', '牧原食品官网公开入口', 'web', 'https://www.muyuanfoods.com/', 'zh', 'active', '2026-09-02T16:00:00Z', '37ca5460919de15e6052d3b6efc5822655aebbbe22fe39bc8338f49f5303c576',
  '牧原食品集团股份有限公司官网公开入口。页面需要 JavaScript 渲染；本项目仅据此建立研究对象、股票代码和公开资料入口，不从该入口推断收入、利润、猪价、出栏量或估值结论。', 'needs_verification',
  '{"sourceType":"official_website","ticker":"002714.SZ","retrievalMode":"curated_url_summary"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO source_chunk (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
VALUES ('chunk-muyuan-official-v1', 'source-muyuan-official-v1', 'section-muyuan-overview', ARRAY['牧原食品官网','公开入口']::TEXT[], 1, NULL, 0, 95,
  '牧原食品集团股份有限公司官网公开入口。页面需要 JavaScript 渲染；本项目仅据此建立研究对象、股票代码和公开资料入口，不从该入口推断收入、利润、猪价、出栏量或估值结论。',
  '上市公司基础入口；财务与行情结论需要年报、公告和行情来源。', '37ca5460919de15e6052d3b6efc5822655aebbbe22fe39bc8338f49f5303c576')
ON CONFLICT (id) DO NOTHING;

INSERT INTO citation (id, report_id, section_id, source_id, chunk_id, quote, evidence_state, created_at)
VALUES ('citation-muyuan-official-v1', 'report-muyuan', 'section-muyuan-overview', 'source-muyuan-official-v1', 'chunk-muyuan-official-v1', '牧原食品集团官网公开入口。', 'needs_verification', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO entity (id, report_id, kind, name, normalized_name, source_id, evidence_state, attributes, created_at)
VALUES
  ('entity-muyuan-company', 'report-muyuan', 'company', '牧原食品', '牧原食品', 'source-muyuan-official-v1', 'fact', '{"ticker":"002714.SZ","officialUrl":"https://www.muyuanfoods.com/"}'::jsonb, '2026-09-02T16:00:00Z'),
  ('entity-muyuan-livestock', 'report-muyuan', 'industry', '生猪养殖', '生猪养殖', 'source-muyuan-official-v1', 'needs_verification', '{}'::jsonb, '2026-09-02T16:00:00Z')
ON CONFLICT (report_id, kind, normalized_name) DO NOTHING;

INSERT INTO relation_edge (id, report_id, from_entity_id, to_entity_id, relation, source_id, evidence_state, created_at)
VALUES ('edge-muyuan-livestock-v1', 'report-muyuan', 'entity-muyuan-company', 'entity-muyuan-livestock', '公开研究对象关联生猪养殖产业链', 'source-muyuan-official-v1', 'needs_verification', '2026-09-02T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_stats (project_id, unique_readers, updated_at)
VALUES ('project-muyuan', 0, '2026-09-02T16:00:00Z')
ON CONFLICT (project_id) DO NOTHING;
