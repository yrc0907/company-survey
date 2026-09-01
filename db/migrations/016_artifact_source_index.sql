-- 将已完成的文本解析产物接入既有 source/source_chunk 检索表。
-- 这只是可重建索引：uploaded_asset 与 ingestion_artifact 原件/产物永远追加保存，不在本迁移中覆盖。

ALTER TABLE source
  ADD COLUMN IF NOT EXISTS ingestion_artifact_id TEXT NULL REFERENCES ingestion_artifact(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS owner_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS branch_id TEXT NULL REFERENCES knowledge_branch(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'source_scope_pair_check') THEN
    ALTER TABLE source ADD CONSTRAINT source_scope_pair_check
      CHECK ((project_id IS NULL AND branch_id IS NULL) OR (project_id IS NOT NULL AND branch_id IS NOT NULL));
  END IF;
END $$;

-- 一个解析产物最多对应一个 source；重复消费、重试或并发索引都只能命中同一来源。
CREATE UNIQUE INDEX IF NOT EXISTS source_ingestion_artifact_unique_idx
  ON source (ingestion_artifact_id)
  WHERE ingestion_artifact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_project_branch_idx
  ON source (project_id, branch_id, captured_at DESC)
  WHERE project_id IS NOT NULL AND branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS source_owner_idx
  ON source (owner_user_id, captured_at DESC)
  WHERE owner_user_id IS NOT NULL;
