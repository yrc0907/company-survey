-- 公开企业资料结构化文件树（V1）。
--
-- 022/024 只导入了每个项目的一条官方摘要；本迁移补齐研究工作台所需的
-- 稳定目录和章节节点，但不把模板文字当作企业事实。所有新章节均明确标记
-- needs_verification，后续只能通过真实用户提交的来源、Commit 和 MR 填充。
-- 迁移幂等：每个项目只在结构 Commit 不存在时创建一次，不覆盖用户已有修改。

DO $$
DECLARE
  project_row RECORD;
  branch_row RECORD;
  parent_commit TEXT;
  structure_commit TEXT;
  research_folder TEXT;
  chapter RECORD;
  node_id TEXT;
  revision_id TEXT;
  previous_revision TEXT;
  chapter_position INTEGER;
  chapter_text TEXT;
BEGIN
  FOR project_row IN
    SELECT id
    FROM knowledge_project
    WHERE id IN (
      'project-huice', 'project-weaver', 'project-sangfor', 'project-sundray',
      'project-youzan', 'project-fxiaoke', 'project-kingdee', 'project-qianxin',
      'project-dbapp', 'project-venustech', 'project-dingtalk', 'project-lark'
    )
    ORDER BY id
  LOOP
    SELECT id, head_commit_id
      INTO branch_row
      FROM knowledge_branch
     WHERE project_id = project_row.id AND name = 'main'
     LIMIT 1;

    IF branch_row.id IS NULL THEN
      CONTINUE;
    END IF;

    structure_commit := project_row.id || '-research-structure-v1';
    -- 已经建立过结构时直接跳过，避免把后续人工编辑重新挂到旧 Commit 上。
    IF EXISTS (SELECT 1 FROM knowledge_commit WHERE id = structure_commit) THEN
      CONTINUE;
    END IF;

    parent_commit := branch_row.head_commit_id;
    research_folder := project_row.id || '-folder-research';
    previous_revision := NULL;

    INSERT INTO knowledge_commit
      (id, project_id, branch_id, parent_commit_id, author_user_id, message,
       ai_assisted, idempotency_key, change_summary, created_at)
    VALUES
      (structure_commit, project_row.id, branch_row.id, parent_commit, 'u-yu',
       '建立公开研究章节目录（待核验）', FALSE,
       'seed:public-research-structure:' || project_row.id || ':v1',
       jsonb_build_object(
         'seed', TRUE,
         'structureOnly', TRUE,
         'evidenceState', 'needs_verification',
         'note', '只创建章节模板，不新增企业事实或社区统计'
       ), CURRENT_TIMESTAMP);

    INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
    VALUES (research_folder, project_row.id, 'folder', 'u-yu', CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO knowledge_node_state
      (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
    VALUES (project_row.id, branch_row.id, research_folder, NULL, '研究报告', 10, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT (branch_id, node_id) DO NOTHING;

    INSERT INTO commit_change
      (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
    VALUES (structure_commit || ':create:' || research_folder, structure_commit, research_folder,
            'create_node', NULL, NULL, jsonb_build_object('kind', 'folder', 'name', '研究报告'), 0)
    ON CONFLICT (id) DO NOTHING;

    chapter_position := 0;
    FOR chapter IN
      SELECT * FROM (VALUES
        ('研究结论', 'research-conclusion', '用于记录由多条来源支持的结论；当前为空，不能据此推断企业事实。', 'e128dce6be46b93f6e3d6c4e27fbdb2bc2148a5e58192ae1130b54f1736aaaed'),
        ('公司与产品', 'company-product', '用于记录企业主体、产品边界和官方自述；请为每条事实附来源与抓取时间。', 'cd7515ec52def52004455f2cc1ea36b39b0a7f4e9e49636e8ba045bfe901d808'),
        ('市场与竞品', 'market-competitors', '用于记录市场定义、竞品范围和可比指标；价格、份额和排名必须有独立证据。', '6f13a76f37eecd8b1542127112549259c404d3cb221f69b5dfd9335d09f3dffa'),
        ('商业模式', 'business-model', '用于记录收费方式、交付与成本线索；没有公开证据时保持待核验。', '3918fa6aebe6812db51c25ec0a6751a1bc687b56fa23deee9f5f51c3b87aae3d'),
        ('客户与场景', 'customers-scenarios', '用于记录公开案例和适用场景；不得把宣传语当成客户效果或规模。', 'ce938dcf9c969bfc6288b044307056c8676baf852ba8402cc989aac7718e63a0'),
        ('政策关联', 'policy-links', '用于记录政策原文与企业之间的可追溯关联；政策背景不等于企业绩效背书。', 'cf3ecc2a7e72253854b5a51eeb6a37ee0a16bdacb91481bdb5ff737cc0c22f02'),
        ('风险与开放问题', 'risks-open-questions', '用于记录资料缺口、风险假设和下一步核验问题，不填充猜测性答案。', '444981367af92577b211f2acf2c27c6fd453475a619a2c3204c000bc696b39d1'),
        ('证据目录', 'evidence-catalog', '用于列出来源 URL、版本、哈希、许可边界和证据状态。', '1ba4eaa26be448ba7ed1fbf9155f350aada8094a4efdb2f7fc6418981417d9df')
      ) AS chapters(name, anchor, template_text, content_hash)
    LOOP
      chapter_position := chapter_position + 1;
      -- 每个新文档没有同节点的历史版本；不要把前一个章节误当作 previous_revision。
      previous_revision := NULL;
      node_id := project_row.id || '-doc-' || chapter.anchor;
      revision_id := node_id || '-revision-v1';
      chapter_text := '状态：needs_verification。' || E'\n' || chapter.template_text || E'\n\n'
        || '本页由平台结构迁移创建；在真实来源导入并通过审核前，不构成事实或结论。';

      INSERT INTO knowledge_node (id, project_id, kind, created_by_user_id, created_at)
      VALUES (node_id, project_row.id, 'document', 'u-yu', CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO knowledge_node_state
        (project_id, branch_id, node_id, parent_node_id, name, position, deleted_at, updated_at)
      VALUES (project_row.id, branch_row.id, node_id, research_folder, chapter.name,
              chapter_position, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT (branch_id, node_id) DO NOTHING;

      INSERT INTO document_revision
        (id, project_id, node_id, branch_id, commit_id, previous_revision_id,
         content, content_text, content_hash, created_by_user_id, created_at)
      VALUES (revision_id, project_row.id, node_id, branch_row.id, structure_commit, previous_revision,
              jsonb_build_object(
                'type', 'doc',
                'content', jsonb_build_array(jsonb_build_object(
                  'type', 'paragraph',
                  'attrs', jsonb_build_object('evidenceState', 'needs_verification'),
                  'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', chapter_text))
                ))
              ),
              chapter_text,
              chapter.content_hash, 'u-yu', CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO commit_change
        (id, commit_id, node_id, operation, before_revision_id, after_revision_id, metadata, position)
      VALUES (structure_commit || ':create:' || node_id, structure_commit, node_id,
              'create_node', NULL, revision_id,
              jsonb_build_object('kind', 'document', 'name', chapter.name,
                'evidenceState', 'needs_verification'), chapter_position)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO content_attribution
        (id, project_id, node_id, block_id, origin_commit_id, last_touch_commit_id,
         contributor_user_id, reviewer_user_id, merge_request_id, active, created_at, updated_at)
      VALUES (structure_commit || ':attribution:' || node_id, project_row.id, node_id,
              node_id || ':block:1', structure_commit, structure_commit, 'u-yu', NULL, NULL,
              TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT DO NOTHING;
    END LOOP;

    UPDATE knowledge_branch
       SET head_commit_id = structure_commit,
           version = GREATEST(version, 2),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = branch_row.id
       AND head_commit_id = parent_commit;
  END LOOP;
END $$;

COMMENT ON TABLE document_revision IS '公开研究章节可为空模板；needs_verification 模板不是企业事实，事实必须关联来源和审核版本。';
