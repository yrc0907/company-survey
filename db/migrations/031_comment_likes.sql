-- 评论点赞关系：真实登录用户的幂等点赞/取消点赞。
-- 采用 active 软状态保留历史关系，统计只计算 active=true，避免重复写入和丢失审计边界。
CREATE TABLE IF NOT EXISTS project_comment_like (
  comment_id TEXT NOT NULL REFERENCES project_comment(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_comment_like_count_idx
  ON project_comment_like (comment_id) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS project_comment_like_user_idx
  ON project_comment_like (user_id, updated_at DESC);

COMMENT ON TABLE project_comment_like IS '评论点赞事实；同一用户同一评论最多一行，取消点赞仅切换 active，不物理删除。';

-- 点赞通知使用独立 kind，保留现有通知读取与深链协议。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_notification_kind_check') THEN
    ALTER TABLE platform_notification DROP CONSTRAINT platform_notification_kind_check;
  END IF;
  ALTER TABLE platform_notification ADD CONSTRAINT platform_notification_kind_check CHECK (kind IN (
    'comment_reply', 'comment_mention', 'comment_liked', 'project_starred', 'author_followed',
    'merge_request_opened', 'merge_request_reviewed', 'merge_request_merged', 'system'
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
