-- 为邮箱换绑增加新的验证码用途；021 已在生产执行，不能改写其历史校验和。
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'verification_challenge'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%purpose%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE verification_challenge DROP CONSTRAINT %I', constraint_name);
  END IF;
  ALTER TABLE verification_challenge
    ADD CONSTRAINT verification_challenge_purpose_check
    CHECK (purpose IN ('email_verification', 'email_login', 'password_reset', 'email_change', 'phone_login', 'phone_bind', 'phone_change'));
END $$;
