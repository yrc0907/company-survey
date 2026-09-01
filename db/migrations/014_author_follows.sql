-- 作者关注关系：真实登录用户才能写入；软删除保留关注行为时间线。
-- 主键保证同一用户对同一作者只有一条关系，CHECK 禁止关注自己。
CREATE TABLE IF NOT EXISTS author_follow (
  follower_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  followed_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX IF NOT EXISTS author_follow_followed_active_idx
  ON author_follow (followed_user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS author_follow_follower_active_idx
  ON author_follow (follower_user_id, active, updated_at DESC);
