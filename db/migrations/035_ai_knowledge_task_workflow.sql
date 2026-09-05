ALTER TABLE ai_knowledge_task ADD COLUMN IF NOT EXISTS workflow_type TEXT NOT NULL DEFAULT 'research';
ALTER TABLE ai_knowledge_task ADD COLUMN IF NOT EXISTS checkpoint JSONB NULL;
ALTER TABLE ai_knowledge_task ADD COLUMN IF NOT EXISTS lease_owner TEXT NULL;
ALTER TABLE ai_knowledge_task ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS ai_knowledge_task_queue_idx ON ai_knowledge_task (status, lease_expires_at, created_at);
