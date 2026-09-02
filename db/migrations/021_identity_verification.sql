-- 真实邮箱/短信身份验证基础表。
-- 验证码只保存哈希；destination_hash 让服务端可查找账户而不把原始目标写进挑战记录。

ALTER TABLE platform_user ADD COLUMN IF NOT EXISTS phone_e164 TEXT NULL;
ALTER TABLE platform_user ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ NULL;
CREATE UNIQUE INDEX IF NOT EXISTS platform_user_phone_unique_idx
  ON platform_user (phone_e164)
  WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS verification_challenge (
  id TEXT PRIMARY KEY,
  user_id TEXT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'email_login', 'password_reset', 'phone_login', 'phone_bind', 'phone_change')),
  destination_hash TEXT NOT NULL,
  masked_destination TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  resend_after TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  request_ip_hash TEXT NULL,
  device_hash TEXT NULL,
  provider_message_id TEXT NULL,
  provider_status TEXT NOT NULL DEFAULT 'pending' CHECK (provider_status IN ('pending', 'sent', 'failed')),
  failure_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS verification_challenge_lookup_idx
  ON verification_challenge (destination_hash, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_challenge_user_idx
  ON verification_challenge (user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS verification_challenge_expiry_idx
  ON verification_challenge (expires_at)
  WHERE consumed_at IS NULL;
