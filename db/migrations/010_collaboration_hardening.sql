-- 协作闭环加固：幂等请求指纹、跨项目外键和不可变历史边界。
-- 迁移可重复执行；不回写正文、Commit、Review 或 Attribution 的既有事实。

ALTER TABLE knowledge_commit
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT NULL;
ALTER TABLE merge_request
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT NULL;
ALTER TABLE merge_review
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_commit_idempotency_fingerprint_check') THEN
    ALTER TABLE knowledge_commit ADD CONSTRAINT knowledge_commit_idempotency_fingerprint_check
      CHECK (idempotency_fingerprint IS NULL OR idempotency_fingerprint ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_request_idempotency_fingerprint_check') THEN
    ALTER TABLE merge_request ADD CONSTRAINT merge_request_idempotency_fingerprint_check
      CHECK (idempotency_fingerprint IS NULL OR idempotency_fingerprint ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_review_idempotency_fingerprint_check') THEN
    ALTER TABLE merge_review ADD CONSTRAINT merge_review_idempotency_fingerprint_check
      CHECK (idempotency_fingerprint IS NULL OR idempotency_fingerprint ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

-- 仅允许同一项目的分支作为 MR 源/目标；单列 branch_id 外键不足以阻止跨项目 ID 穿透。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_request_source_project_branch_fk') THEN
    ALTER TABLE merge_request
      ADD CONSTRAINT merge_request_source_project_branch_fk
      FOREIGN KEY (project_id, source_branch_id)
      REFERENCES knowledge_branch(project_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'merge_request_target_project_branch_fk') THEN
    ALTER TABLE merge_request
      ADD CONSTRAINT merge_request_target_project_branch_fk
      FOREIGN KEY (project_id, target_branch_id)
      REFERENCES knowledge_branch(project_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

-- 幂等查询与审核收件箱的热点索引；唯一约束仍由 005 提供，避免并发重复写入。
CREATE INDEX IF NOT EXISTS knowledge_commit_branch_idempotency_fingerprint_idx
  ON knowledge_commit (branch_id, idempotency_key, idempotency_fingerprint)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS merge_review_idempotency_fingerprint_idx
  ON merge_review (merge_request_id, reviewer_user_id, idempotency_key, idempotency_fingerprint)
  WHERE idempotency_key IS NOT NULL;

-- Commit、Revision 是审计事实；禁止任何应用路径原地覆盖或删除，修订必须追加新版本。
CREATE OR REPLACE FUNCTION prevent_collaboration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'collaboration history is append-only: %.%', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '55006';
END;
$$;

DROP TRIGGER IF EXISTS knowledge_commit_append_only ON knowledge_commit;
CREATE TRIGGER knowledge_commit_append_only
  BEFORE UPDATE OR DELETE ON knowledge_commit
  FOR EACH ROW EXECUTE FUNCTION prevent_collaboration_history_mutation();

DROP TRIGGER IF EXISTS document_revision_append_only ON document_revision;
CREATE TRIGGER document_revision_append_only
  BEFORE UPDATE OR DELETE ON document_revision
  FOR EACH ROW EXECUTE FUNCTION prevent_collaboration_history_mutation();

DROP TRIGGER IF EXISTS merge_review_append_only ON merge_review;
CREATE TRIGGER merge_review_append_only
  BEFORE UPDATE OR DELETE ON merge_review
  FOR EACH ROW EXECUTE FUNCTION prevent_collaboration_history_mutation();

