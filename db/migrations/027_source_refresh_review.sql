-- 来源刷新只生成待人工复核快照，不覆盖现有 active 正文。
ALTER TABLE source DROP CONSTRAINT IF EXISTS source_state_check;
ALTER TABLE source ADD CONSTRAINT source_state_check CHECK (state IN ('active', 'stale', 'conflict', 'archived', 'needs_review'));
CREATE INDEX IF NOT EXISTS source_review_state_idx ON source (report_id, state, captured_at DESC)
  WHERE state = 'needs_review';
