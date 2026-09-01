-- 项目级公开评论：真实用户写入、匿名只读、parent_id 楼中楼与软删除。
-- 评论正文可被清空但记录不能物理删除，避免回复失去父级和贡献时间线。
CREATE TABLE IF NOT EXISTS project_comment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  parent_id TEXT NULL,
  author_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 0 AND 10000),
  deleted_at TIMESTAMPTZ NULL,
  idempotency_key TEXT NULL,
  idempotency_fingerprint TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, id),
  UNIQUE (project_id, parent_id, id),
  FOREIGN KEY (project_id, parent_id) REFERENCES project_comment(project_id, id) ON DELETE RESTRICT,
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS project_comment_thread_idx
  ON project_comment (project_id, parent_id, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS project_comment_author_idx
  ON project_comment (author_user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS project_comment_idempotency_idx
  ON project_comment (project_id, author_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE project_comment IS '公开项目评论；deleted_at 非空时正文不可见但节点保留';
