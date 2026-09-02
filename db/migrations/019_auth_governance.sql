-- 身份治理令牌只保存哈希；邮件发送仍需明确配置 Provider 后另行接入。
CREATE TABLE IF NOT EXISTS platform_email_action_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('verify_email', 'password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS platform_email_action_token_active_idx
  ON platform_email_action_token (user_id, action, expires_at)
  WHERE consumed_at IS NULL;
