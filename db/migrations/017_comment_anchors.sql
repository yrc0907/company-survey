-- 段落锚点评论：在项目级楼中楼之外保存稳定 Node/Block 定位与引用片段。
-- 锚点是可选的；Node 必须属于同一项目，正文仍以评论权限和公开项目状态为准。

ALTER TABLE project_comment
  ADD COLUMN IF NOT EXISTS node_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS block_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS quote TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_comment_anchor_pair_check') THEN
    ALTER TABLE project_comment ADD CONSTRAINT project_comment_anchor_pair_check
      CHECK ((node_id IS NULL AND block_id IS NULL AND quote IS NULL)
        OR (node_id IS NOT NULL AND block_id IS NOT NULL AND quote IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_comment_anchor_node_fk') THEN
    ALTER TABLE project_comment ADD CONSTRAINT project_comment_anchor_node_fk
      FOREIGN KEY (project_id, node_id) REFERENCES knowledge_node(project_id, id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_comment_anchor_quote_length') THEN
    ALTER TABLE project_comment ADD CONSTRAINT project_comment_anchor_quote_length
      CHECK (quote IS NULL OR char_length(quote) BETWEEN 1 AND 2000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_comment_anchor_idx
  ON project_comment (project_id, node_id, block_id, created_at ASC)
  WHERE node_id IS NOT NULL;

