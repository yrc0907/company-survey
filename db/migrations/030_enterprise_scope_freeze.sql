-- 企业研究范围冻结的回滚账本。
--
-- 本迁移只建立账本，不触碰现有项目数据。范围清理由
-- scripts/freeze-enterprise-scope.mjs 执行，并且默认只读预览；只有显式
-- --apply 才会把已知的非冻结企业项目标记为 archived/private。
--
-- 采用归档而不是 DELETE 的原因：项目下的 Commit/Review/activity_event 是
-- append-only 审计历史，且社区互动可能引用这些项目。归档后公开查询自然
-- 不再返回项目及其来源/文件树，而完整旧状态仍可在此账本中恢复。

CREATE TABLE IF NOT EXISTS enterprise_scope_freeze_batch (
  batch_id TEXT PRIMARY KEY,
  keep_project_ids TEXT[] NOT NULL,
  candidate_project_ids TEXT[] NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'applied', 'rolled_back')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMPTZ NULL,
  rolled_back_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS enterprise_scope_retirement (
  batch_id TEXT NOT NULL REFERENCES enterprise_scope_freeze_batch(batch_id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE RESTRICT,
  previous_visibility TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  previous_updated_at TIMESTAMPTZ NOT NULL,
  previous_verification TEXT NULL,
  previous_verification_note TEXT NULL,
  project_snapshot JSONB NOT NULL,
  retired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  restored_at TIMESTAMPTZ NULL,
  PRIMARY KEY (batch_id, project_id)
);

CREATE INDEX IF NOT EXISTS enterprise_scope_retirement_project_idx
  ON enterprise_scope_retirement (project_id, retired_at DESC);

COMMENT ON TABLE enterprise_scope_freeze_batch IS
  '企业研究范围冻结批次；只保存清理意图和状态，不保存用户凭据。';
COMMENT ON TABLE enterprise_scope_retirement IS
  '企业项目归档前的最小可回滚快照；归档不删除来源、文件树或 append-only 互动历史。';
