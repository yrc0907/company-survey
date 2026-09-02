-- 公开首发企业资料包：慧策、泛微网络、深信服、信锐科技。
-- 只写入公开官网 URL 与保守摘要；不创建虚构用户，不插入阅读、Star、评论或 MR 统计。
-- 每条摘要均保留来源类型、抓取时间、内容 SHA-256、证据状态与许可边界。

ALTER TABLE knowledge_project
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '行业',
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verification TEXT NOT NULL DEFAULT 'needs_verification',
  ADD COLUMN IF NOT EXISTS verification_note TEXT NOT NULL DEFAULT '公开项目的核验状态由维护者在版本中维护。';

ALTER TABLE source
  ADD COLUMN IF NOT EXISTS evidence_state TEXT NOT NULL DEFAULT 'needs_verification',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_project_category_check') THEN
    ALTER TABLE knowledge_project ADD CONSTRAINT knowledge_project_category_check
      CHECK (category IN ('企业', '政策', '行业', '技术'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_project_verification_check') THEN
    ALTER TABLE knowledge_project ADD CONSTRAINT knowledge_project_verification_check
      CHECK (verification IN ('verified', 'needs_verification'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_evidence_state_check') THEN
    ALTER TABLE source ADD CONSTRAINT source_evidence_state_check
      CHECK (evidence_state IN ('fact', 'inference', 'needs_verification', 'conflict'));
  END IF;
END $$;

-- 临时清单是迁移内部的唯一事实来源，事务结束即销毁，不成为可编辑的伪造数据表。
CREATE TEMP TABLE _public_company_seed (
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  project_title TEXT NOT NULL,
  project_summary TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] NOT NULL,
  company_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  company_summary TEXT NOT NULL,
  report_id TEXT NOT NULL,
  report_title TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  parent_commit_id TEXT NULL,
  commit_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  topic_entity_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  source_url TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (project_id)
) ON COMMIT DROP;

INSERT INTO _public_company_seed (
  project_id, slug, project_title, project_summary, category, tags,
  company_id, company_name, company_summary, report_id, report_title,
  branch_id, parent_commit_id, commit_id, folder_id, doc_id, source_node_id,
  section_id, source_id, chunk_id, entity_id, topic_entity_id, source_title,
  publisher, source_url, snapshot, content_hash, captured_at
)
VALUES
(
  'project-huice', 'huice-commerce-erp', '慧策掌上先机：产品、行业与竞争压力调研',
  '基于慧策公开官网入口的产品范围摘要；客户数量、价格、收入和续费等商业事实未从官网推断。',
  '企业', ARRAY['电商 ERP', '订单与履约', '公开资料']::TEXT[],
  'company-huice', '慧策', '电商与零售履约软件研究对象。',
  'report-huice', '慧策掌上先机：行业与政策契合度调研',
  'branch-huice-main', 'commit-huice-seed-v1', 'commit-huice-public-v2',
  'folder-huice-public', 'doc-huice-public-overview', 'source-node-huice-public',
  'section-huice-public', 'source-huice-public-official-v2', 'chunk-huice-public-official-v2',
  'entity-huice-public', 'entity-huice-public-topic', '慧策官网公开产品摘要',
  '慧策（旺店通）', 'https://www.wangdian.cn/',
  '公开官网入口及产品信息摘要：旺店通网站介绍其面向电商经营的订单、库存与履约管理产品。此摘要仅记录官网公开表述，不推断客户数量、收入或价格。',
  '428ab5e900c56dfd2ee1ce3e1783354b826b9e067b4a7b65e4373e8490fbdff7', '2026-09-02T00:00:00Z'
),
(
  'project-weaver', 'weaver-enterprise-collaboration', '泛微网络：企业协同与数字化管理公开研究',
  '基于泛微官网公开入口的产品范围摘要；客户数量、市场份额、价格和交付效果仍需独立来源核验。',
  '企业', ARRAY['协同办公', '企业数字化', '公开资料']::TEXT[],
  'company-weaver', '泛微网络', '企业协同与数字化管理研究对象。',
  'report-weaver', '泛微网络：企业协同与数字化管理公开研究',
  'branch-weaver-main', NULL, 'commit-weaver-public-v1',
  'folder-weaver-public', 'doc-weaver-public-overview', 'source-node-weaver-public',
  'section-weaver-public', 'source-weaver-public-official', 'chunk-weaver-public-official',
  'entity-weaver-public', 'entity-weaver-public-topic', '泛微官网公开产品摘要',
  '泛微网络', 'https://www.weaver.com.cn/',
  '公开官网入口及产品信息摘要：泛微官网介绍协同办公与企业数字化管理产品。此摘要仅记录官网公开表述，不推断市场份额、客户评价或价格。',
  'f7e8882f1e400803da1405a98542adcdb0f4015b0ff011a3c64ef335c85344d4', '2026-09-02T00:00:00Z'
),
(
  'project-sangfor', 'sangfor-cloud-security', '深信服：云计算与网络安全产品公开研究',
  '基于深信服官网公开入口的产品范围摘要；安全效果、客户规模、收入和价格不由该摘要推断。',
  '企业', ARRAY['云计算', '网络安全', '公开资料']::TEXT[],
  'company-sangfor', '深信服', '云计算与网络安全研究对象。',
  'report-sangfor', '深信服：云计算与网络安全产品公开研究',
  'branch-sangfor-main', NULL, 'commit-sangfor-public-v1',
  'folder-sangfor-public', 'doc-sangfor-public-overview', 'source-node-sangfor-public',
  'section-sangfor-public', 'source-sangfor-public-official', 'chunk-sangfor-public-official',
  'entity-sangfor-public', 'entity-sangfor-public-topic', '深信服官网公开产品摘要',
  '深信服', 'https://www.sangfor.com.cn/',
  '公开官网入口及产品信息摘要：深信服官网公开展示云计算、网络安全及基础设施相关产品与服务。此摘要仅记录官网公开表述，不推断安全效果、收入或价格。',
  '4c7e72dbc247c0e7e35d7b13e48d4bdd1ce2a5d3163a9842186925e3f881289f', '2026-09-02T00:00:00Z'
),
(
  'project-sundray', 'sundray-enterprise-network', '信锐科技：企业网络与物联网产品公开研究',
  '基于信锐科技官网公开入口的产品范围摘要；覆盖规模、性能、客户评价和价格仍需独立来源核验。',
  '企业', ARRAY['企业无线', '交换网络', '物联网', '公开资料']::TEXT[],
  'company-sundray', '信锐科技', '企业网络与物联网研究对象。',
  'report-sundray', '信锐科技：企业网络与物联网产品公开研究',
  'branch-sundray-main', NULL, 'commit-sundray-public-v1',
  'folder-sundray-public', 'doc-sundray-public-overview', 'source-node-sundray-public',
  'section-sundray-public', 'source-sundray-public-official', 'chunk-sundray-public-official',
  'entity-sundray-public', 'entity-sundray-public-topic', '信锐科技官网公开产品摘要',
  '信锐科技', 'https://www.sundray.com/',
  '公开官网入口及产品信息摘要：信锐科技官网公开展示企业无线、交换与物联网相关网络产品。此摘要仅记录官网公开表述，不推断覆盖规模、性能或价格。',
  '863cbdb9059ede64165109101849d0f4cc2fb7148522fed4536fa6d4c0650d68', '2026-09-02T00:00:00Z'
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_user WHERE id = 'u-yu' AND status = 'active') THEN
    RAISE EXCEPTION '公开首发数据需要现有 active 维护者 u-yu；拒绝创建虚构用户';
  END IF;
END $$;

-- 项目元数据可修订，但不覆盖正文、来源和统计事实；首发资料均明确为待核验。
INSERT INTO knowledge_project
  (id, owner_user_id, slug, title, summary, visibility, status, license, default_branch_name, published_at, created_at, updated_at, category, tags, verification, verification_note)
SELECT project_id, 'u-yu', slug, project_title, project_summary, 'public', 'published', 'cc-by-4.0', 'main', captured_at, captured_at, captured_at, category, tags, 'needs_verification',
  '只包含官网公开入口与摘要；价格、客户、收入、市场份额和效果等结论必须获得独立证据后再升级核验状态。'
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

UPDATE knowledge_project p
SET category = s.category, tags = s.tags, verification = 'needs_verification',
    verification_note = '只包含官网公开入口与摘要；商业数据和效果结论仍待独立证据核验。', updated_at = GREATEST(p.updated_at, s.captured_at)
FROM _public_company_seed s
WHERE p.id = s.project_id;

INSERT INTO project_member (project_id, user_id, role, created_at)
SELECT project_id, 'u-yu', 'owner', captured_at FROM _public_company_seed
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO knowledge_branch
  (id, project_id, name, owner_user_id, is_protected, status, version, created_at, updated_at)
SELECT branch_id, project_id, 'main', NULL, TRUE, 'active', 0, captured_at, captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_commit
  (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, change_summary, created_at)
SELECT commit_id, project_id, branch_id, parent_commit_id, 'u-yu', '导入公开官网摘要（待核验）', FALSE,
  'seed:public-company:' || slug || ':v1', jsonb_build_object('seed', true, 'sourceType', 'official_website', 'evidenceState', 'needs_verification'), captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

UPDATE knowledge_branch b
SET head_commit_id = s.commit_id,
    base_commit_id = COALESCE(b.base_commit_id, s.parent_commit_id),
    version = GREATEST(b.version, 1), updated_at = s.captured_at
FROM _public_company_seed s
WHERE b.id = s.branch_id;

INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
SELECT folder_id, project_id, 'folder', 'u-yu', captured_at FROM _public_company_seed
UNION ALL
SELECT doc_id, project_id, 'document', 'u-yu', captured_at FROM _public_company_seed
UNION ALL
SELECT source_node_id, project_id, 'source', 'u-yu', captured_at FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_node_state
  (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
SELECT project_id, branch_id, folder_id, NULL, '公开资料', 1, NULL, captured_at FROM _public_company_seed
UNION ALL
SELECT project_id, branch_id, doc_id, folder_id, '产品范围与证据边界', 1, NULL, captured_at FROM _public_company_seed
UNION ALL
SELECT project_id, branch_id, source_node_id, NULL, source_title, 2, NULL, captured_at FROM _public_company_seed
ON CONFLICT (branch_id, node_id) DO NOTHING;

INSERT INTO document_revision
  (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
SELECT 'revision-' || project_id || '-public-v1', project_id, doc_id, branch_id, commit_id, NULL,
  '{"type":"doc","content":[]}'::jsonb,
  project_summary || E'\n\n证据状态：needs_verification。来源是企业公开官网入口和人工记录摘要；未从该摘要推断价格、客户规模、收入或效果。',
  content_hash, 'u-yu', captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_attribution
  (id, project_id, node_id, block_id, origin_commit_id, last_touch_commit_id, contributor_user_id, reviewer_user_id, merge_request_id, active, created_at, updated_at)
SELECT 'attr-' || project_id || '-public', project_id, doc_id, doc_id || ':block:1', commit_id, commit_id, 'u-yu', NULL, NULL, TRUE, captured_at, captured_at
FROM _public_company_seed
ON CONFLICT DO NOTHING;

-- 旧版 Research Workbench 的公司/报告模型同步保存同一份公开摘要，供受保护的个人 API 使用。
INSERT INTO company (id, name, kind, summary, tags, created_at, updated_at)
SELECT company_id, company_name, 'company', company_summary, tags, captured_at, captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO report (id, company_id, title, status, current_version, created_at, updated_at)
SELECT report_id, company_id, report_title, 'draft', 1, captured_at, captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_section
  (id, report_id, parent_section_id, heading, anchor, level, position, content, evidence_state, updated_at)
SELECT section_id, report_id, NULL, '公开摘要与证据边界', 'public-summary-evidence', 1, 1,
  snapshot || E'\n\n该段仅记录官网公开表述；商业数据、客户规模和效果结论需要独立来源。', 'needs_verification', captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO source
  (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot, evidence_state, metadata)
SELECT source_id, report_id, source_title, 'web', source_url, 'zh', 'active', captured_at, content_hash, snapshot, 'needs_verification',
  jsonb_build_object('sourceType', 'official_website', 'publisher', publisher, 'capturedAt', captured_at,
    'licenseNote', '公开官网页面；仅引用与研究相关的短摘要，遵守原站条款。', 'retrievalMode', 'curated_url_summary')
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO source_chunk
  (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
SELECT chunk_id, source_id, section_id, ARRAY['公开官网', '产品范围']::TEXT[], 1, NULL, 0, char_length(snapshot), snapshot,
  '企业公开官网摘要；证据状态：needs_verification；不能据此推断商业指标。', content_hash
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO citation
  (id, report_id, section_id, source_id, chunk_id, quote, evidence_state, created_at)
SELECT 'citation-' || project_id || '-public', report_id, section_id, source_id, chunk_id, snapshot, 'needs_verification', captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_revision (id, report_id, version, title, sections, author, created_at)
SELECT 'revision-' || report_id || '-public-v1', report_id, 1, report_title,
  jsonb_build_array(jsonb_build_object('id', section_id, 'reportId', report_id, 'heading', '公开摘要与证据边界',
    'anchor', 'public-summary-evidence', 'level', 1, 'position', 1, 'content', snapshot,
    'evidenceState', 'needs_verification', 'updatedAt', captured_at)), 'system', captured_at
FROM _public_company_seed
ON CONFLICT (report_id, version) DO NOTHING;

INSERT INTO entity
  (id, report_id, kind, name, normalized_name, source_id, evidence_state, attributes, created_at)
SELECT entity_id, report_id, 'company', company_name, lower(company_name), source_id, 'fact',
  jsonb_build_object('officialUrl', source_url, 'sourceType', 'official_website'), captured_at
FROM _public_company_seed
ON CONFLICT (report_id, kind, normalized_name) DO NOTHING;

INSERT INTO entity
  (id, report_id, kind, name, normalized_name, source_id, evidence_state, attributes, created_at)
SELECT topic_entity_id, report_id, 'industry', project_summary, lower(slug), source_id, 'needs_verification',
  jsonb_build_object('officialUrl', source_url), captured_at
FROM _public_company_seed
ON CONFLICT (report_id, kind, normalized_name) DO NOTHING;

INSERT INTO relation_edge
  (id, report_id, from_entity_id, to_entity_id, relation, source_id, evidence_state, created_at)
SELECT 'edge-' || project_id || '-public-scope', report_id, entity_id, topic_entity_id, '官网自述产品范围', source_id, 'fact', captured_at
FROM _public_company_seed
ON CONFLICT (id) DO NOTHING;

-- 首发项目统计从零开始，后续只由真实阅读上报/Star/评论事实聚合，不写入静态数字。
INSERT INTO project_stats (project_id, unique_readers, updated_at)
SELECT project_id, 0, captured_at FROM _public_company_seed
ON CONFLICT (project_id) DO NOTHING;

COMMENT ON COLUMN knowledge_project.verification IS '公开项目核验状态；首发官网摘要默认 needs_verification，不能用模型推断升级。';
COMMENT ON COLUMN source.metadata IS '来源元数据：来源类型、发布者、抓取时间、许可边界和抓取方式。';
