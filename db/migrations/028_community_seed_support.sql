-- 社区场景 seed 的持久化支撑表。
--
-- 这些表只保存可回溯的社区行为投影，不改变企业资料、来源或正文事实。
-- community_seed_record 是内部维护索引：它不参与公开查询，页面也不会展示
-- seed_batch/source_kind。append-only 的 Commit、Review 与 activity_event 仍遵循
-- 原有不可变历史边界，清理脚本只能退役可变关系并保留审计历史。

CREATE TABLE IF NOT EXISTS community_seed_record (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  seed_batch TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'community_scenario',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retired_at TIMESTAMPTZ NULL,
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS community_seed_record_batch_idx
  ON community_seed_record (seed_batch, entity_type, retired_at, created_at DESC);

-- 站内通知只保存深链所需的目标 ID；正文/附件仍由原领域表按权限读取。
CREATE TABLE IF NOT EXISTS platform_notification (
  id TEXT PRIMARY KEY,
  recipient_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  actor_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'comment_reply', 'comment_mention', 'project_starred', 'author_followed',
    'merge_request_opened', 'merge_request_reviewed', 'merge_request_merged', 'system'
  )),
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('project', 'comment', 'merge_request', 'review', 'author')),
  target_id TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS platform_notification_recipient_idx
  ON platform_notification (recipient_user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS platform_notification_target_idx
  ON platform_notification (target_type, target_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS platform_notification_idempotency_idx
  ON platform_notification (recipient_user_id, kind, target_type, target_id, actor_user_id)
  WHERE actor_user_id IS NOT NULL;

COMMENT ON TABLE platform_notification IS '站内通知事实；API 读取时按 recipient_user_id 过滤，seed 只写入可回溯深链。';

-- 作者/项目贡献热力图的日投影。view_count 来自 project_view_daily，其他计数来自
-- activity_event；total_count 由脚本按同一批事实聚合，前端不得提交任意统计数字。
CREATE TABLE IF NOT EXISTS activity_daily (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  publish_count INTEGER NOT NULL DEFAULT 0 CHECK (publish_count >= 0),
  merge_count INTEGER NOT NULL DEFAULT 0 CHECK (merge_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  star_count INTEGER NOT NULL DEFAULT 0 CHECK (star_count >= 0),
  follow_count INTEGER NOT NULL DEFAULT 0 CHECK (follow_count >= 0),
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  public_event_version BIGINT NOT NULL DEFAULT 1 CHECK (public_event_version >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_user_id, day, project_id)
);

-- PostgreSQL 的 UNIQUE 对 NULL 允许重复；这个索引保证跨项目（project_id NULL）
-- 的作者日投影仍然只有一行。
CREATE UNIQUE INDEX IF NOT EXISTS activity_daily_actor_project_day_idx
  ON activity_daily (actor_user_id, COALESCE(project_id, ''), day);
CREATE INDEX IF NOT EXISTS activity_daily_project_day_idx
  ON activity_daily (project_id, day DESC, total_count DESC);
CREATE INDEX IF NOT EXISTS activity_daily_actor_day_idx
  ON activity_daily (actor_user_id, day DESC, total_count DESC);

COMMENT ON TABLE activity_daily IS '由 activity_event 与 project_view_daily 聚合的公开热力图投影；可重复重建。';
