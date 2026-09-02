-- 验证码请求风控桶；只保存 HMAC/哈希 key，不保存邮箱、手机号、IP 或设备原文。
-- 低流量部署用 PostgreSQL 原子事务兜底，后续可将相同接口替换为 Redis。
CREATE TABLE IF NOT EXISTS verification_rate_limit (
  key_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS verification_rate_limit_updated_idx
  ON verification_rate_limit (updated_at);

COMMENT ON TABLE verification_rate_limit IS
  '验证码发送多维限流桶；key_hash 由服务端 HMAC/SHA-256 生成，过期桶可安全清理。';

