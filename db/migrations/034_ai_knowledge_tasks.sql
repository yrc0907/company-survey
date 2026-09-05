CREATE TABLE IF NOT EXISTS ai_knowledge_task (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  objective TEXT NOT NULL CHECK (char_length(objective) BETWEEN 1 AND 1000),
  selected_agents TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  current_node TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS ai_knowledge_task_owner_idx ON ai_knowledge_task (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_knowledge_task_report_idx ON ai_knowledge_task (owner_user_id, report_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_knowledge_task_event (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_knowledge_task(id) ON DELETE CASCADE,
  node TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_knowledge_task_event_task_idx ON ai_knowledge_task_event (task_id, created_at ASC);
