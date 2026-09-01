-- 首发公开知识样例：将已明确标记的慧策研究 Seed 写入真实数据库。
-- 内容是信息架构与边界演示，不把未核验商业数据伪装成事实；所有对象均使用固定 ID 且幂等插入。

INSERT INTO platform_user (id, email, global_role, status, email_verified_at, created_at, updated_at)
VALUES ('u-yu', 'yu-research@open-knowledge.invalid', 'user', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

INSERT INTO platform_profile (user_id, username, display_name, bio, created_at, updated_at)
VALUES ('u-yu', 'yu-research', 'Yu', '首发研究样例维护者。', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO knowledge_project (id, owner_user_id, slug, title, summary, visibility, status, license, default_branch_name, published_at, created_at, updated_at)
VALUES (
  'project-huice', 'u-yu', 'huice-commerce-erp',
  '慧策掌上先机：产品、行业与竞争压力调研',
  '从公开产品资料、政策文本与竞品线索梳理电商履约软件的产品边界与转型压力。',
  'public', 'published', 'cc-by-4.0', 'main',
  '2026-08-12T08:00:00Z', '2026-08-12T08:00:00Z', '2026-09-01T09:20:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO project_member (project_id, user_id, role, created_at)
VALUES ('project-huice', 'u-yu', 'owner', CURRENT_TIMESTAMP)
ON CONFLICT (project_id, user_id) DO NOTHING;

INSERT INTO knowledge_branch (id, project_id, name, owner_user_id, is_protected, status, version, created_at, updated_at)
VALUES ('branch-huice-main', 'project-huice', 'main', NULL, TRUE, 'active', 1, '2026-08-12T08:00:00Z', '2026-09-01T09:20:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_commit (id, project_id, branch_id, parent_commit_id, author_user_id, message, ai_assisted, idempotency_key, change_summary, created_at)
VALUES (
  'commit-huice-seed-v1', 'project-huice', 'branch-huice-main', NULL, 'u-yu',
  '发布首发研究样例', FALSE, 'seed:project-huice:v1', '{"seed":true}'::jsonb, '2026-08-12T08:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

UPDATE knowledge_branch
SET head_commit_id = 'commit-huice-seed-v1', version = 1, updated_at = '2026-09-01T09:20:00Z'
WHERE id = 'branch-huice-main';

INSERT INTO knowledge_node (id, project_id, kind, name, created_by_user_id, created_at)
VALUES
  ('folder-huice-report', 'project-huice', 'folder', '报告', 'u-yu', '2026-08-12T08:00:00Z'),
  ('doc-huice-overview', 'project-huice', 'document', '研究结论', 'u-yu', '2026-08-12T08:00:00Z'),
  ('doc-huice-evidence', 'project-huice', 'document', '证据范围与边界', 'u-yu', '2026-08-12T08:00:00Z'),
  ('doc-huice-risk', 'project-huice', 'document', '仍待核验的问题', 'u-yu', '2026-08-12T08:00:00Z'),
  ('source-huice-official', 'project-huice', 'source', '官方资料.pdf', 'u-yu', '2026-08-12T08:00:00Z'),
  ('source-huice-interview', 'project-huice', 'source', '公开访谈摘录.md', 'u-yu', '2026-08-12T08:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO knowledge_node_state (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
VALUES
  ('project-huice', 'branch-huice-main', 'folder-huice-report', NULL, '报告', 1, NULL, '2026-09-01T09:20:00Z'),
  ('project-huice', 'branch-huice-main', 'doc-huice-overview', 'folder-huice-report', '研究结论', 1, NULL, '2026-09-01T09:20:00Z'),
  ('project-huice', 'branch-huice-main', 'doc-huice-evidence', 'folder-huice-report', '证据范围与边界', 2, NULL, '2026-09-01T09:20:00Z'),
  ('project-huice', 'branch-huice-main', 'doc-huice-risk', 'folder-huice-report', '仍待核验的问题', 3, NULL, '2026-09-01T09:20:00Z'),
  ('project-huice', 'branch-huice-main', 'source-huice-official', NULL, '官方资料.pdf', 2, NULL, '2026-09-01T09:20:00Z'),
  ('project-huice', 'branch-huice-main', 'source-huice-interview', NULL, '公开访谈摘录.md', 3, NULL, '2026-09-01T09:20:00Z')
ON CONFLICT (branch_id, node_id) DO NOTHING;

INSERT INTO document_revision (id, project_id, node_id, branch_id, commit_id, previous_revision_id, content, content_text, content_hash, created_by_user_id, created_at)
VALUES
  ('revision-huice-overview-v1', 'project-huice', 'doc-huice-overview', 'branch-huice-main', 'commit-huice-seed-v1', NULL, '{"type":"doc","content":[]}'::jsonb,
   '慧策的公开产品信息覆盖订单、仓储与履约协同。当前材料能够证明其产品覆盖范围，但不能单凭官网描述推出续费率或客户满意度。\n\n政策对数字贸易与实体经济数字化的支持构成行业背景，不等同于对单一企业商业结果的背书。',
   'seed-huice-overview-v1', 'u-yu', '2026-09-01T09:20:00Z'),
  ('revision-huice-evidence-v1', 'project-huice', 'doc-huice-evidence', 'branch-huice-main', 'commit-huice-seed-v1', NULL, '{"type":"doc","content":[]}'::jsonb,
   '本节使用企业官网、公开政策文本与可公开引用的行业资料。价格、实施成本和续费情况仍需要来自合同、客户访谈或权威统计的独立证据。',
   'seed-huice-evidence-v1', 'u-yu', '2026-09-01T09:20:00Z'),
  ('revision-huice-risk-v1', 'project-huice', 'doc-huice-risk', 'branch-huice-main', 'commit-huice-seed-v1', NULL, '{"type":"doc","content":[]}'::jsonb,
   'FDE 式定制交付是否压缩标准化 SaaS 的生存空间，取决于交付成本、客户复杂度与标准产品覆盖率，目前公开数据不足。',
   'seed-huice-risk-v1', 'u-yu', '2026-09-01T09:20:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO content_attribution (id, project_id, node_id, block_id, origin_commit_id, last_touch_commit_id, contributor_user_id, reviewer_user_id, merge_request_id, active, created_at, updated_at)
VALUES
  ('attr-huice-overview', 'project-huice', 'doc-huice-overview', 'doc-huice-overview:block:1', 'commit-huice-seed-v1', 'commit-huice-seed-v1', 'u-yu', NULL, NULL, TRUE, '2026-08-12T08:00:00Z', '2026-08-12T08:00:00Z'),
  ('attr-huice-evidence', 'project-huice', 'doc-huice-evidence', 'doc-huice-evidence:block:1', 'commit-huice-seed-v1', 'commit-huice-seed-v1', 'u-yu', NULL, NULL, TRUE, '2026-08-12T08:00:00Z', '2026-08-12T08:00:00Z'),
  ('attr-huice-risk', 'project-huice', 'doc-huice-risk', 'doc-huice-risk:block:1', 'commit-huice-seed-v1', 'commit-huice-seed-v1', 'u-yu', NULL, NULL, TRUE, '2026-08-12T08:00:00Z', '2026-08-12T08:00:00Z')
ON CONFLICT DO NOTHING;

INSERT INTO company (id, name, kind, summary, tags, created_at, updated_at)
VALUES ('company-huice', '慧策', 'company', '电商与零售履约软件研究对象。', ARRAY['电商 ERP', '仓储履约']::TEXT[], '2026-08-12T08:00:00Z', '2026-09-01T09:20:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO report (id, company_id, title, status, current_version, created_at, updated_at)
VALUES ('report-huice', 'company-huice', '慧策掌上先机：行业与政策契合度调研', 'draft', 1, '2026-08-12T08:00:00Z', '2026-09-01T09:20:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_section (id, report_id, parent_section_id, heading, anchor, level, position, content, evidence_state, updated_at)
VALUES
  ('section-overview', 'report-huice', NULL, '研究结论', 'research-conclusion', 1, 1, '慧策的产品定位与电商履约数字化存在政策方向关联，但政策契合不等于监管合规或商业结果。', 'inference', '2026-09-01T09:20:00Z'),
  ('section-evidence', 'report-huice', NULL, '证据范围', 'evidence-scope', 1, 2, '本报告仅引用用户导入的公开网页和政策原文片段；价格、续费率等未公开信息必须保留待核验状态。', 'needs_verification', '2026-09-01T09:20:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO source (id, report_id, title, kind, url, language, state, captured_at, content_hash, snapshot)
VALUES
  ('source-plan', 'report-huice', '十五五规划纲要（研究摘录）', 'text', 'https://www.gov.cn/', 'zh', 'active', '2026-09-01T08:00:00Z', 'demo-plan-sha256', '推进人工智能赋能实体经济，发展数字贸易和跨境电商相关服务。'),
  ('source-huice-site', 'report-huice', '慧策产品介绍（演示快照）', 'web', 'https://www.wangdian.cn/', 'zh', 'active', '2026-09-01T08:00:00Z', 'demo-huice-sha256', '产品介绍涉及订单管理、仓储履约和跨境业务协同。')
ON CONFLICT (id) DO NOTHING;

INSERT INTO source_chunk (id, source_id, parent_section_id, heading_path, position, page, start_offset, end_offset, text, contextual_prefix, content_hash)
VALUES
  ('chunk-plan-cross-border', 'source-plan', 'section-evidence', ARRAY['第七篇', '数字贸易']::TEXT[], 1, 22, 0, 29, '推进人工智能赋能实体经济，发展数字贸易和跨境电商相关服务。', '政策研究摘录；主题：人工智能、数字贸易、跨境电商。', 'demo-plan-chunk'),
  ('chunk-huice-product', 'source-huice-site', 'section-evidence', ARRAY['产品能力']::TEXT[], 1, NULL, 0, 23, '产品介绍涉及订单管理、仓储履约和跨境业务协同。', '企业官网演示快照；信息属于企业自述。', 'demo-huice-chunk')
ON CONFLICT (id) DO NOTHING;

INSERT INTO citation (id, report_id, section_id, source_id, chunk_id, quote, evidence_state, created_at)
VALUES ('citation-policy', 'report-huice', 'section-overview', 'source-plan', 'chunk-plan-cross-border', '发展数字贸易和跨境电商相关服务。', 'fact', '2026-09-01T08:00:00Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_revision (id, report_id, version, title, sections, author, created_at)
VALUES ('revision-huice-v1', 'report-huice', 1, '慧策掌上先机：行业与政策契合度调研', '[{"id":"section-overview","reportId":"report-huice","parentSectionId":null,"heading":"研究结论","anchor":"research-conclusion","level":1,"position":1,"content":"慧策的产品定位与电商履约数字化存在政策方向关联，但政策契合不等于监管合规或商业结果。","evidenceState":"inference","updatedAt":"2026-09-01T09:20:00.000Z"},{"id":"section-evidence","reportId":"report-huice","parentSectionId":null,"heading":"证据范围","anchor":"evidence-scope","level":1,"position":2,"content":"本报告仅引用用户导入的公开网页和政策原文片段；价格、续费率等未公开信息必须保留待核验状态。","evidenceState":"needs_verification","updatedAt":"2026-09-01T09:20:00.000Z"}]'::jsonb, 'system', '2026-09-01T09:20:00Z')
ON CONFLICT (id) DO NOTHING;
