-- 公开项目阅读统计：按真实用户或签名访客按日去重。
-- viewer_key_hash 由应用端使用服务端盐哈希后写入，数据库不保存浏览器标识原文。
-- project_reader 是跨天去重的事实表；project_view_daily 保留按日审计粒度。

CREATE TABLE IF NOT EXISTS project_reader (
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  viewer_key_hash TEXT NOT NULL CHECK (viewer_key_hash ~ '^[0-9a-f]{64}$'),
  viewer_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, viewer_key_hash)
);

CREATE INDEX IF NOT EXISTS project_reader_project_idx
  ON project_reader (project_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS project_view_daily (
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  view_date DATE NOT NULL,
  viewer_key_hash TEXT NOT NULL CHECK (viewer_key_hash ~ '^[0-9a-f]{64}$'),
  viewer_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE SET NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, view_date, viewer_key_hash)
);

CREATE INDEX IF NOT EXISTS project_view_daily_project_date_idx
  ON project_view_daily (project_id, view_date DESC);

-- 首页读取只访问聚合投影；项目详情上报阅读时原子增加 unique_readers。
CREATE TABLE IF NOT EXISTS project_stats (
  project_id TEXT PRIMARY KEY REFERENCES knowledge_project(id) ON DELETE CASCADE,
  unique_readers BIGINT NOT NULL DEFAULT 0 CHECK (unique_readers >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO project_stats (project_id, unique_readers, updated_at)
SELECT id, 0, CURRENT_TIMESTAMP FROM knowledge_project
ON CONFLICT (project_id) DO NOTHING;

