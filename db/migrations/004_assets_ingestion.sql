-- 私有 OSS 上传与解析任务。
-- 仅保存对象元数据和不可变原件关系；对象本身始终由私有 OSS 控制，公开页面不能直接访问 Key。

CREATE TABLE IF NOT EXISTS uploaded_asset (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  branch_id TEXT NULL REFERENCES knowledge_branch(id) ON DELETE CASCADE,
  original_asset_id TEXT NULL REFERENCES uploaded_asset(id) ON DELETE RESTRICT,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('original', 'derived', 'avatar')),
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  expected_size BIGINT NOT NULL CHECK (expected_size > 0 AND expected_size <= 26214400),
  expected_sha256 TEXT NOT NULL CHECK (expected_sha256 ~ '^[a-f0-9]{64}$'),
  etag TEXT NULL,
  actual_size BIGINT NULL CHECK (actual_size IS NULL OR actual_size > 0),
  actual_sha256 TEXT NULL CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[a-f0-9]{64}$'),
  status TEXT NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload', 'uploaded', 'verified', 'failed', 'quarantined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  uploaded_at TIMESTAMPTZ NULL,
  verified_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((project_id IS NULL AND branch_id IS NULL) OR (project_id IS NOT NULL AND branch_id IS NOT NULL)),
  CHECK ((asset_kind = 'derived' AND original_asset_id IS NOT NULL) OR (asset_kind <> 'derived'))
);

CREATE INDEX IF NOT EXISTS uploaded_asset_owner_idx ON uploaded_asset (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS uploaded_asset_project_idx ON uploaded_asset (project_id, branch_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uploaded_asset_owner_hash_idx
  ON uploaded_asset (owner_user_id, COALESCE(project_id, ''), expected_sha256)
  WHERE status <> 'failed';

CREATE TABLE IF NOT EXISTS ingestion_job (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES uploaded_asset(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'uploading', 'processing', 'ready', 'failed')),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  error_code TEXT NULL,
  error_message TEXT NULL,
  derived_asset_id TEXT NULL REFERENCES uploaded_asset(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS ingestion_job_queue_idx
  ON ingestion_job (status, updated_at ASC)
  WHERE status IN ('queued', 'uploading', 'processing', 'failed');
