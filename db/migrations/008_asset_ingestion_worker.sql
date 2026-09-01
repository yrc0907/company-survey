-- 解析 Worker 的租约、明确待校对状态和不可变解析产物。
-- 任务以 PostgreSQL 为协调器；不依赖 RabbitMQ，支持 2C2G 实例上的单进程 Worker。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ingestion_job_status_v2') THEN
    ALTER TABLE ingestion_job DROP CONSTRAINT IF EXISTS ingestion_job_status_check;
    ALTER TABLE ingestion_job
      ADD CONSTRAINT ingestion_job_status_v2
      CHECK (status IN ('queued', 'uploading', 'processing', 'ready', 'needs_review', 'failed'));
  END IF;
END $$;

ALTER TABLE ingestion_job ADD COLUMN IF NOT EXISTS lease_owner TEXT NULL;
ALTER TABLE ingestion_job ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS ingestion_job_claim_idx
  ON ingestion_job (status, updated_at ASC)
  WHERE status IN ('queued', 'uploading', 'processing');

-- 文本是独立、可重建的派生结果；原始 OSS 对象和其哈希永远不被覆盖。
CREATE TABLE IF NOT EXISTS ingestion_artifact (
  id TEXT PRIMARY KEY,
  ingestion_job_id TEXT NOT NULL REFERENCES ingestion_job(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES uploaded_asset(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'needs_review')),
  mime_type TEXT NOT NULL,
  content TEXT NULL,
  content_hash TEXT NULL CHECK (content_hash IS NULL OR content_hash ~ '^[a-f0-9]{64}$'),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind = 'text' AND content IS NOT NULL AND content_hash IS NOT NULL) OR (kind = 'needs_review' AND content IS NULL))
);

CREATE INDEX IF NOT EXISTS ingestion_artifact_asset_idx ON ingestion_artifact (asset_id, created_at DESC);

-- 若迁移曾以早期草案执行，移除单 Job/Asset 唯一约束后才能保留每次重试的不可变产物。
ALTER TABLE ingestion_artifact DROP CONSTRAINT IF EXISTS ingestion_artifact_ingestion_job_id_key;
ALTER TABLE ingestion_artifact DROP CONSTRAINT IF EXISTS ingestion_artifact_asset_id_key;
ALTER TABLE ingestion_artifact ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ingestion_artifact_job_attempt_idx ON ingestion_artifact (ingestion_job_id, attempt DESC, created_at DESC);
