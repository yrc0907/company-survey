-- Git 式协作闭环的并发、幂等与合并基线扩展。
-- 005 只追加列/索引，不改写已存在的 Commit、Revision 和主分支数据。

ALTER TABLE knowledge_branch
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_branch_status_check') THEN
    ALTER TABLE knowledge_branch ADD CONSTRAINT knowledge_branch_status_check
      CHECK (status IN ('active', 'submitted', 'merged', 'closed'));
  END IF;
END $$;

ALTER TABLE knowledge_commit
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS change_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_commit_branch_idempotency_idx
  ON knowledge_commit (branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE merge_request
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS target_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_base_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS target_base_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS conflict_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (conflict_status IN ('unknown', 'clean', 'conflict')),
  ADD COLUMN IF NOT EXISTS conflict_details JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS merge_request_source_target_idempotency_idx
  ON merge_request (source_branch_id, target_branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS merge_request_target_version_idx
  ON merge_request (target_branch_id, target_version, status);

ALTER TABLE merge_review
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS merge_review_request_reviewer_idempotency_idx
  ON merge_review (merge_request_id, reviewer_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 任何旧数据的 branch version 以已存在的提交数量作为保守起点，避免首次部署时把并发检查退化为 0。
UPDATE knowledge_branch b
SET version = COALESCE((SELECT COUNT(*) FROM knowledge_commit c WHERE c.branch_id = b.id), 0)
WHERE b.version = 0;
