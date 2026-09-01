-- 项目 Star（收藏）关系：仅真实登录用户可写，公开计数只聚合 active 关系。
-- 采用软删除保留用户行为时间线；(project_id, user_id) 主键确保并发重复点击不会增加计数。

CREATE TABLE IF NOT EXISTS project_star (
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  CHECK (active IN (TRUE, FALSE))
);

CREATE INDEX IF NOT EXISTS project_star_public_count_idx
  ON project_star (project_id, active, updated_at DESC);

