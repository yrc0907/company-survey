-- 评论图片/GIF 附件关系；原始对象仍由 uploaded_asset 和私有 OSS 管理。
-- 只有已验证、由评论作者拥有的图片资产可以绑定，项目级公开读取仍由服务层签发短期 URL。
CREATE TABLE IF NOT EXISTS project_comment_attachment (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  comment_id TEXT NOT NULL REFERENCES project_comment(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES uploaded_asset(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0 AND position < 8),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (comment_id, asset_id),
  UNIQUE (comment_id, position),
  FOREIGN KEY (project_id, comment_id) REFERENCES project_comment(project_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_comment_attachment_comment_idx
  ON project_comment_attachment (comment_id, position ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS project_comment_attachment_asset_idx
  ON project_comment_attachment (asset_id);

COMMENT ON TABLE project_comment_attachment IS '项目评论的图片/GIF附件关系；URL不落库，读取时按权限签发';
