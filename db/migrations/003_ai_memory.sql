-- AI 会话、压缩检查点与长期记忆。
-- 原始消息和工具事件只追加；摘要、记忆版本和上下文快照均保留可追溯来源。

CREATE TABLE IF NOT EXISTS ai_conversation (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE SET NULL,
  branch_id TEXT NULL REFERENCES knowledge_branch(id) ON DELETE SET NULL,
  parent_conversation_id TEXT NULL REFERENCES ai_conversation(id) ON DELETE SET NULL,
  parent_message_id TEXT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  summary_version INTEGER NOT NULL DEFAULT 0 CHECK (summary_version >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ai_conversation_owner_state_idx
  ON ai_conversation (owner_user_id, status, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_conversation_project_idx
  ON ai_conversation (owner_user_id, project_id, branch_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_conversation_title_fts_idx
  ON ai_conversation USING GIN (to_tsvector('simple', title));

CREATE TABLE IF NOT EXISTS ai_conversation_message (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  token_estimate INTEGER NOT NULL DEFAULT 0 CHECK (token_estimate >= 0),
  parent_message_id TEXT NULL REFERENCES ai_conversation_message(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (conversation_id, sequence)
);

CREATE INDEX IF NOT EXISTS ai_conversation_message_fts_idx
  ON ai_conversation_message USING GIN (to_tsvector('simple', content));
CREATE INDEX IF NOT EXISTS ai_conversation_message_order_idx
  ON ai_conversation_message (conversation_id, sequence);

CREATE TABLE IF NOT EXISTS ai_tool_execution (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  call_message_id TEXT NOT NULL REFERENCES ai_conversation_message(id) ON DELETE RESTRICT,
  result_message_id TEXT NULL REFERENCES ai_conversation_message(id) ON DELETE RESTRICT,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested', 'completed', 'failed', 'cancelled')),
  result_reference TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ NULL,
  UNIQUE (call_message_id),
  UNIQUE (result_message_id)
);

CREATE TABLE IF NOT EXISTS ai_conversation_summary (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  structured_summary JSONB NOT NULL,
  source_start_sequence INTEGER NOT NULL CHECK (source_start_sequence > 0),
  source_end_sequence INTEGER NOT NULL CHECK (source_end_sequence >= source_start_sequence),
  source_message_ids TEXT[] NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (conversation_id, version)
);

CREATE TABLE IF NOT EXISTS ai_conversation_checkpoint (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  summary_id TEXT NULL REFERENCES ai_conversation_summary(id) ON DELETE RESTRICT,
  source_start_sequence INTEGER NOT NULL CHECK (source_start_sequence > 0),
  source_end_sequence INTEGER NOT NULL CHECK (source_end_sequence >= source_start_sequence),
  token_before INTEGER NOT NULL CHECK (token_before >= 0),
  token_after INTEGER NULL CHECK (token_after IS NULL OR token_after >= 0),
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  failure_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ai_checkpoint_latest_idx
  ON ai_conversation_checkpoint (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_memory_item (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project', 'conversation')),
  conversation_id TEXT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('preference', 'identity', 'decision', 'todo')),
  state TEXT NOT NULL DEFAULT 'candidate' CHECK (state IN ('candidate', 'active', 'disabled', 'expired', 'deleted')),
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until TIMESTAMPTZ NULL,
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope <> 'project') OR project_id IS NOT NULL),
  CHECK ((scope <> 'conversation') OR conversation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ai_memory_scope_idx
  ON ai_memory_item (owner_user_id, project_id, conversation_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_memory_version (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL REFERENCES ai_memory_item(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  content TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  reason TEXT NOT NULL,
  supersedes_version_id TEXT NULL REFERENCES ai_memory_version(id) ON DELETE RESTRICT,
  created_by_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (memory_item_id, version)
);

CREATE INDEX IF NOT EXISTS ai_memory_version_fts_idx
  ON ai_memory_version USING GIN (to_tsvector('simple', normalized_content));

CREATE TABLE IF NOT EXISTS ai_memory_source (
  id TEXT PRIMARY KEY,
  memory_version_id TEXT NOT NULL REFERENCES ai_memory_version(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('message', 'commit', 'citation', 'explicit_user')),
  source_id TEXT NOT NULL,
  extraction_mode TEXT NOT NULL CHECK (extraction_mode IN ('explicit', 'automatic_candidate', 'manual_review')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (memory_version_id, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS ai_context_snapshot (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  request_message_id TEXT NOT NULL REFERENCES ai_conversation_message(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL CHECK (scope IN ('selection', 'file', 'folder', 'project', 'public')),
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE SET NULL,
  branch_id TEXT NULL REFERENCES knowledge_branch(id) ON DELETE SET NULL,
  file_id TEXT NULL REFERENCES knowledge_node(id) ON DELETE SET NULL,
  folder_id TEXT NULL REFERENCES knowledge_node(id) ON DELETE SET NULL,
  selected_message_ids TEXT[] NOT NULL DEFAULT '{}',
  selected_chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  selected_memory_ids TEXT[] NOT NULL DEFAULT '{}',
  summary_id TEXT NULL REFERENCES ai_conversation_summary(id) ON DELETE SET NULL,
  token_budget JSONB NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_patch (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES ai_conversation_message(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL REFERENCES knowledge_branch(id) ON DELETE CASCADE,
  base_revision_id TEXT NOT NULL REFERENCES document_revision(id) ON DELETE RESTRICT,
  patch JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'accepted_to_draft', 'rejected', 'submitted')),
  confirmed_by_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  merge_request_id TEXT NULL REFERENCES merge_request(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMPTZ NULL
);

-- 会话先于消息创建，因此 parent_message 外键在两张表都存在后幂等追加。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_parent_message_fk') THEN
    ALTER TABLE ai_conversation
      ADD CONSTRAINT ai_conversation_parent_message_fk
      FOREIGN KEY (parent_message_id) REFERENCES ai_conversation_message(id) ON DELETE SET NULL;
  END IF;
END $$;
