-- 账户邮箱/手机号绑定与换绑的追加审计；只保存哈希和脱敏值。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_challenge_purpose_check') THEN
    ALTER TABLE verification_challenge DROP CONSTRAINT verification_challenge_purpose_check;
  END IF;
  ALTER TABLE verification_challenge ADD CONSTRAINT verification_challenge_purpose_check
    CHECK (purpose IN ('email_verification', 'email_login', 'password_reset', 'email_change', 'phone_login', 'phone_bind', 'phone_change'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS platform_identity_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  actor_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  action TEXT NOT NULL CHECK (action IN ('verify', 'bind', 'change')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'conflict', 'rejected')),
  previous_destination_hash TEXT NULL,
  destination_hash TEXT NOT NULL,
  previous_masked_destination TEXT NULL,
  masked_destination TEXT NOT NULL,
  challenge_id TEXT NULL REFERENCES verification_challenge(id) ON DELETE SET NULL,
  reason_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_identity_audit_user_idx
  ON platform_identity_audit (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_identity_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_identity_audit is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS platform_identity_audit_immutable ON platform_identity_audit;
CREATE TRIGGER platform_identity_audit_immutable
  BEFORE UPDATE OR DELETE ON platform_identity_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_identity_audit_mutation();
