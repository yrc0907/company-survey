-- 公开活动事件账本：从真实项目写入自动追加，供时间线/通知读取。
-- 事件不可更新或删除；删除评论、取消 Star/关注也不会抹掉历史事实。
CREATE TABLE IF NOT EXISTS activity_event (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  project_id TEXT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'project_created', 'commit_created', 'merge_request_opened',
    'merge_request_merged', 'review_submitted', 'comment_created',
    'project_starred', 'project_unstarred', 'author_followed', 'author_unfollowed'
  )),
  target_type TEXT NOT NULL CHECK (target_type IN ('project', 'commit', 'merge_request', 'review', 'comment', 'star', 'author_follow')),
  target_id TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS activity_event_project_time_idx
  ON activity_event (project_id, occurred_at DESC, id DESC)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activity_event_actor_time_idx
  ON activity_event (actor_user_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION activity_event_id() RETURNS TEXT
LANGUAGE SQL VOLATILE AS $$
  SELECT md5(random()::text || clock_timestamp()::text || txid_current()::text);
$$;

CREATE OR REPLACE FUNCTION record_project_created_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), NEW.owner_user_id, NEW.id, 'project_created', 'project', NEW.id,
    jsonb_build_object('title', NEW.title, 'slug', NEW.slug), NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_commit_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), NEW.author_user_id, NEW.project_id, 'commit_created', 'commit', NEW.id,
    jsonb_build_object('message', NEW.message, 'branchId', NEW.branch_id, 'aiAssisted', NEW.ai_assisted), NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_merge_request_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  activity_type TEXT;
  activity_actor TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    activity_type := 'merge_request_opened';
    activity_actor := NEW.author_user_id;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'merged' THEN
    activity_type := 'merge_request_merged';
    activity_actor := COALESCE(NEW.merged_by_user_id, NEW.author_user_id);
  ELSE
    RETURN NEW;
  END IF;
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), activity_actor, NEW.project_id, activity_type, 'merge_request', NEW.id,
    jsonb_build_object('title', NEW.title, 'status', NEW.status), COALESCE(NEW.merged_at, NEW.created_at));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_merge_review_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE project_key TEXT;
BEGIN
  SELECT project_id INTO project_key FROM merge_request WHERE id = NEW.merge_request_id;
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), NEW.reviewer_user_id, project_key, 'review_submitted', 'review', NEW.id,
    jsonb_build_object('mergeRequestId', NEW.merge_request_id, 'verdict', NEW.verdict), NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_project_comment_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), NEW.author_user_id, NEW.project_id, 'comment_created', 'comment', NEW.id,
    jsonb_build_object('parentId', NEW.parent_id, 'nodeId', NEW.node_id, 'blockId', NEW.block_id), NEW.created_at);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_project_star_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.active THEN event_name := 'project_starred';
  ELSIF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
    event_name := CASE WHEN NEW.active THEN 'project_starred' ELSE 'project_unstarred' END;
  ELSE RETURN NEW;
  END IF;
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), NEW.user_id, NEW.project_id, event_name, 'star', NEW.project_id || ':' || NEW.user_id,
    '{}'::jsonb, NEW.updated_at);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION record_author_follow_activity() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE event_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.active THEN event_name := 'author_followed';
  ELSIF TG_OP = 'UPDATE' AND NEW.active IS DISTINCT FROM OLD.active THEN
    event_name := CASE WHEN NEW.active THEN 'author_followed' ELSE 'author_unfollowed' END;
  ELSE RETURN NEW;
  END IF;
  INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
  VALUES (activity_event_id(), NEW.follower_user_id, NULL, event_name, 'author_follow', NEW.follower_user_id || ':' || NEW.followed_user_id,
    jsonb_build_object('followedUserId', NEW.followed_user_id), NEW.updated_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_activity_event ON knowledge_project;
CREATE TRIGGER project_activity_event AFTER INSERT ON knowledge_project FOR EACH ROW EXECUTE FUNCTION record_project_created_activity();
DROP TRIGGER IF EXISTS commit_activity_event ON knowledge_commit;
CREATE TRIGGER commit_activity_event AFTER INSERT ON knowledge_commit FOR EACH ROW EXECUTE FUNCTION record_commit_activity();
DROP TRIGGER IF EXISTS merge_request_activity_event ON merge_request;
CREATE TRIGGER merge_request_activity_event AFTER INSERT OR UPDATE OF status ON merge_request FOR EACH ROW EXECUTE FUNCTION record_merge_request_activity();
DROP TRIGGER IF EXISTS merge_review_activity_event ON merge_review;
CREATE TRIGGER merge_review_activity_event AFTER INSERT ON merge_review FOR EACH ROW EXECUTE FUNCTION record_merge_review_activity();
DROP TRIGGER IF EXISTS project_comment_activity_event ON project_comment;
CREATE TRIGGER project_comment_activity_event AFTER INSERT ON project_comment FOR EACH ROW EXECUTE FUNCTION record_project_comment_activity();
DROP TRIGGER IF EXISTS project_star_activity_event ON project_star;
CREATE TRIGGER project_star_activity_event AFTER INSERT OR UPDATE OF active ON project_star FOR EACH ROW EXECUTE FUNCTION record_project_star_activity();
DROP TRIGGER IF EXISTS author_follow_activity_event ON author_follow;
CREATE TRIGGER author_follow_activity_event AFTER INSERT OR UPDATE OF active ON author_follow FOR EACH ROW EXECUTE FUNCTION record_author_follow_activity();

-- 首次启用时为已有真实记录建立一次历史投影；确定性 ID 使迁移可重复执行。
INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
SELECT md5('project:' || p.id), p.owner_user_id, p.id, 'project_created', 'project', p.id,
  jsonb_build_object('title', p.title, 'slug', p.slug), p.created_at FROM knowledge_project p
ON CONFLICT (id) DO NOTHING;
INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
SELECT md5('commit:' || c.id), c.author_user_id, c.project_id, 'commit_created', 'commit', c.id,
  jsonb_build_object('message', c.message, 'branchId', c.branch_id, 'aiAssisted', c.ai_assisted), c.created_at FROM knowledge_commit c
ON CONFLICT (id) DO NOTHING;
INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
SELECT md5('comment:' || c.id), c.author_user_id, c.project_id, 'comment_created', 'comment', c.id,
  jsonb_build_object('parentId', c.parent_id, 'nodeId', c.node_id, 'blockId', c.block_id), c.created_at FROM project_comment c
ON CONFLICT (id) DO NOTHING;
INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
SELECT md5('star:' || ps.project_id || ':' || ps.user_id), ps.user_id, ps.project_id,
  CASE WHEN ps.active THEN 'project_starred' ELSE 'project_unstarred' END, 'star', ps.project_id || ':' || ps.user_id,
  '{}'::jsonb, ps.updated_at FROM project_star ps ON CONFLICT (id) DO NOTHING;
INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
SELECT md5('mr:' || mr.id), mr.author_user_id, mr.project_id,
  CASE WHEN mr.status = 'merged' THEN 'merge_request_merged' ELSE 'merge_request_opened' END, 'merge_request', mr.id,
  jsonb_build_object('title', mr.title, 'status', mr.status), COALESCE(mr.merged_at, mr.created_at) FROM merge_request mr
ON CONFLICT (id) DO NOTHING;
INSERT INTO activity_event (id, actor_user_id, project_id, event_type, target_type, target_id, metadata, occurred_at)
SELECT md5('review:' || rv.id), rv.reviewer_user_id, mr.project_id, 'review_submitted', 'review', rv.id,
  jsonb_build_object('mergeRequestId', rv.merge_request_id, 'verdict', rv.verdict), rv.created_at
  FROM merge_review rv JOIN merge_request mr ON mr.id = rv.merge_request_id ON CONFLICT (id) DO NOTHING;

-- 活动账本只允许追加，避免时间线历史被静默改写。
CREATE OR REPLACE FUNCTION prevent_activity_event_mutation() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_event is append-only';
END;
$$;
DROP TRIGGER IF EXISTS activity_event_append_only ON activity_event;
CREATE TRIGGER activity_event_append_only BEFORE UPDATE OR DELETE ON activity_event FOR EACH ROW EXECUTE FUNCTION prevent_activity_event_mutation();
