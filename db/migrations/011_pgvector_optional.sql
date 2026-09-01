-- pgvector 可选持久化：先加可在标准 postgres 镜像上工作的元数据，再尽力创建扩展/向量列。
-- 迁移不要求服务器安装 pgvector；缺少扩展时 FTS 与确定性降级仍完全可用。

ALTER TABLE source_chunk
  ADD COLUMN IF NOT EXISTS embedding_model TEXT NULL,
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER NULL
    CHECK (embedding_dimensions IS NULL OR (embedding_dimensions > 0 AND embedding_dimensions <= 32768)),
  ADD COLUMN IF NOT EXISTS embedding_version TEXT NULL
    CHECK (embedding_version IS NULL OR embedding_version ~ '^[a-zA-Z0-9._-]{1,64}$'),
  ADD COLUMN IF NOT EXISTS embedding_text_hash TEXT NULL
    CHECK (embedding_text_hash IS NULL OR embedding_text_hash ~ '^[a-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'missing'
    CHECK (embedding_status IN ('missing', 'queued', 'ready', 'stale', 'failed')),
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS source_chunk_embedding_state_idx
  ON source_chunk (embedding_status, embedding_model, embedding_version, embedding_updated_at DESC);

CREATE TABLE IF NOT EXISTS retrieval_vector_capability (
  capability_key TEXT PRIMARY KEY CHECK (capability_key = 'source_chunk'),
  extension_available BOOLEAN NOT NULL DEFAULT FALSE,
  extension_version TEXT NULL,
  vector_column_available BOOLEAN NOT NULL DEFAULT FALSE,
  index_kind TEXT NOT NULL DEFAULT 'none' CHECK (index_kind IN ('hnsw', 'ivfflat', 'none')),
  reason TEXT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO retrieval_vector_capability (capability_key, reason)
VALUES ('source_chunk', '尚未探测 pgvector 扩展；运行时会再次检查。')
ON CONFLICT (capability_key) DO NOTHING;

-- CREATE EXTENSION 在缺少 control 文件或权限时被安全吞掉；其它 SQL 错误仍会让迁移失败。
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION
    WHEN undefined_file OR feature_not_supported OR insufficient_privilege THEN
      NULL;
  END;
END $$;

-- 扩展存在时动态添加 vector 类型，避免无扩展环境在解析阶段失败。
DO $$
DECLARE
  extension_exists BOOLEAN;
  vector_column_exists BOOLEAN;
  detected_index TEXT := 'none';
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') INTO extension_exists;
  IF extension_exists THEN
    BEGIN
      EXECUTE 'ALTER TABLE source_chunk ADD COLUMN IF NOT EXISTS embedding vector';
    EXCEPTION
      WHEN undefined_object OR undefined_file OR feature_not_supported OR invalid_object_definition OR insufficient_privilege THEN
        NULL;
    END;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'source_chunk' AND column_name = 'embedding'
  ) INTO vector_column_exists;

  IF vector_column_exists THEN
    -- HNSW 对小规模资料无需训练；旧版扩展不支持时再尝试 IVFFlat。
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS source_chunk_embedding_idx ON source_chunk USING hnsw (embedding vector_cosine_ops)';
      detected_index := 'hnsw';
    EXCEPTION
      WHEN undefined_object OR undefined_file OR feature_not_supported OR insufficient_privilege THEN
        BEGIN
          EXECUTE 'CREATE INDEX IF NOT EXISTS source_chunk_embedding_idx ON source_chunk USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)';
          detected_index := 'ivfflat';
        EXCEPTION
          WHEN undefined_object OR undefined_file OR feature_not_supported OR invalid_object_definition OR insufficient_privilege THEN
            detected_index := 'none';
        END;
    END;
  END IF;

  UPDATE retrieval_vector_capability
  SET extension_available = extension_exists,
      extension_version = CASE WHEN extension_exists THEN (SELECT extversion FROM pg_extension WHERE extname = 'vector') ELSE NULL END,
      vector_column_available = vector_column_exists,
      index_kind = detected_index,
      reason = CASE
        WHEN NOT extension_exists THEN '数据库未安装 pgvector 扩展，使用 FTS/确定性降级。'
        WHEN NOT vector_column_exists THEN 'pgvector 扩展存在但 source_chunk.embedding 列创建失败。'
        WHEN detected_index = 'none' THEN '向量列可用但 ANN 索引创建失败，将使用受限精确扫描。'
        ELSE NULL
      END,
      checked_at = CURRENT_TIMESTAMP
  WHERE capability_key = 'source_chunk';
END $$;

CREATE INDEX IF NOT EXISTS source_chunk_embedding_ready_idx
  ON source_chunk (source_id, embedding_model, embedding_dimensions, embedding_version)
  WHERE embedding_status = 'ready';

-- 资料正文或 Contextual Retrieval 前缀被改写时，旧向量保留作审计但立即失效；
-- 触发器只观察原文列，不会因向量 Worker 自身更新 embedding 元数据而递归触发。
CREATE OR REPLACE FUNCTION mark_source_chunk_embedding_stale()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.text IS DISTINCT FROM OLD.text
     OR NEW.contextual_prefix IS DISTINCT FROM OLD.contextual_prefix
     OR NEW.heading_path IS DISTINCT FROM OLD.heading_path THEN
    NEW.embedding_status := 'stale';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_chunk_embedding_stale_trg ON source_chunk;
CREATE TRIGGER source_chunk_embedding_stale_trg
  BEFORE UPDATE OF text, contextual_prefix, heading_path
  ON source_chunk
  FOR EACH ROW EXECUTE FUNCTION mark_source_chunk_embedding_stale();
