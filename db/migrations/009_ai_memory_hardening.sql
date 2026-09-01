-- AI 记忆/压缩硬化：并发压缩唯一租约、已完成检查点闭合约束和工具事件同会话校验。
-- 迁移可重复执行；已有历史摘要/检查点不被删除或覆盖。

CREATE UNIQUE INDEX IF NOT EXISTS ai_checkpoint_single_started_idx
  ON ai_conversation_checkpoint (conversation_id)
  WHERE status = 'started';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_checkpoint_completed_closed_ck') THEN
    ALTER TABLE ai_conversation_checkpoint
      ADD CONSTRAINT ai_checkpoint_completed_closed_ck
      CHECK (
        status <> 'completed'
        OR (summary_id IS NOT NULL AND token_after IS NOT NULL AND completed_at IS NOT NULL AND failure_code IS NULL)
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION enforce_ai_tool_execution_pair()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  call_conversation TEXT;
  call_role TEXT;
  result_conversation TEXT;
  result_role TEXT;
BEGIN
  SELECT conversation_id, role INTO call_conversation, call_role
    FROM ai_conversation_message WHERE id = NEW.call_message_id;
  IF call_conversation IS NULL OR call_conversation <> NEW.conversation_id OR call_role NOT IN ('assistant', 'system') THEN
    RAISE EXCEPTION 'tool call message must belong to the same conversation and be assistant/system';
  END IF;

  IF NEW.result_message_id IS NULL THEN
    IF NEW.status <> 'requested' THEN
      RAISE EXCEPTION 'finished tool execution must have a result message';
    END IF;
  ELSE
    SELECT conversation_id, role INTO result_conversation, result_role
      FROM ai_conversation_message WHERE id = NEW.result_message_id;
    IF result_conversation IS NULL OR result_conversation <> NEW.conversation_id OR result_role <> 'tool' THEN
      RAISE EXCEPTION 'tool result message must belong to the same conversation and have role tool';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_tool_execution_pair_trg ON ai_tool_execution;
CREATE TRIGGER ai_tool_execution_pair_trg
  BEFORE INSERT OR UPDATE OF conversation_id, call_message_id, result_message_id, status
  ON ai_tool_execution
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_tool_execution_pair();
