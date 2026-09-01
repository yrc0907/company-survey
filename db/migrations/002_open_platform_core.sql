-- 开放知识平台核心身份与版本协作模型。
-- 本迁移只新增带 platform_/knowledge_ 前缀的对象，不改写既有 Research Workbench 表和数据。

CREATE TABLE IF NOT EXISTS platform_user (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  global_role TEXT NOT NULL DEFAULT 'user' CHECK (global_role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  email_verified_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_user_email_unique_idx ON platform_user (LOWER(email));

CREATE TABLE IF NOT EXISTS platform_profile (
  user_id TEXT PRIMARY KEY REFERENCES platform_user(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_asset_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_profile_username_unique_idx ON platform_profile (LOWER(username));

-- 密码凭据与 OAuth 身份独立保存；OAuth token 不进入本表。
CREATE TABLE IF NOT EXISTS platform_password_credential (
  user_id TEXT PRIMARY KEY REFERENCES platform_user(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS platform_auth_identity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS knowledge_project (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public', 'unlisted')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'suspended')),
  license TEXT NOT NULL DEFAULT 'all-rights-reserved',
  default_branch_name TEXT NOT NULL DEFAULT 'main',
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (owner_user_id, slug)
);
CREATE INDEX IF NOT EXISTS knowledge_project_public_idx
  ON knowledge_project (status, visibility, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_member (
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'maintainer', 'contributor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS knowledge_branch (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE SET NULL,
  base_branch_id TEXT NULL REFERENCES knowledge_branch(id) ON DELETE SET NULL,
  base_commit_id TEXT NULL,
  head_commit_id TEXT NULL,
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, name),
  UNIQUE (project_id, id)
);

-- Node 仅保存跨分支稳定身份；名称、父级、排序和删除状态都属于分支快照。
CREATE TABLE IF NOT EXISTS knowledge_node (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('folder', 'document', 'markdown', 'source', 'data')),
  created_by_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, id)
);

CREATE TABLE IF NOT EXISTS knowledge_node_state (
  project_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  parent_node_id TEXT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  deleted_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id, node_id),
  UNIQUE (project_id, branch_id, node_id),
  FOREIGN KEY (project_id, branch_id) REFERENCES knowledge_branch(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, node_id) REFERENCES knowledge_node(project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id, parent_node_id) REFERENCES knowledge_node_state(branch_id, node_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (parent_node_id IS NULL OR parent_node_id <> node_id)
);
CREATE INDEX IF NOT EXISTS knowledge_node_state_tree_idx
  ON knowledge_node_state (branch_id, parent_node_id, position, name);
-- 活跃节点在同一分支、同一父目录下名称唯一；回收站历史不阻止后续重新使用名称。
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_node_state_active_name_unique_idx
  ON knowledge_node_state (branch_id, COALESCE(parent_node_id, ''), LOWER(name))
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_commit (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL REFERENCES knowledge_branch(id) ON DELETE CASCADE,
  parent_commit_id TEXT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  author_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  message TEXT NOT NULL,
  ai_assisted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS knowledge_commit_branch_idx
  ON knowledge_commit (branch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS document_revision (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES knowledge_node(id) ON DELETE RESTRICT,
  branch_id TEXT NOT NULL REFERENCES knowledge_branch(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  previous_revision_id TEXT NULL REFERENCES document_revision(id) ON DELETE RESTRICT,
  content JSONB NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (branch_id, node_id, commit_id)
);
CREATE INDEX IF NOT EXISTS document_revision_lookup_idx
  ON document_revision (branch_id, node_id, created_at DESC);
CREATE INDEX IF NOT EXISTS document_revision_fts_idx
  ON document_revision USING GIN (to_tsvector('simple', content_text));

CREATE TABLE IF NOT EXISTS commit_change (
  id TEXT PRIMARY KEY,
  commit_id TEXT NOT NULL REFERENCES knowledge_commit(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES knowledge_node(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('create_node', 'update_content', 'rename_node', 'move_node', 'delete_node', 'restore_node', 'duplicate_node')),
  before_revision_id TEXT NULL REFERENCES document_revision(id) ON DELETE RESTRICT,
  after_revision_id TEXT NULL REFERENCES document_revision(id) ON DELETE RESTRICT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  position INTEGER NOT NULL CHECK (position >= 0),
  UNIQUE (commit_id, position)
);

CREATE TABLE IF NOT EXISTS merge_request (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  source_branch_id TEXT NOT NULL REFERENCES knowledge_branch(id) ON DELETE RESTRICT,
  target_branch_id TEXT NOT NULL REFERENCES knowledge_branch(id) ON DELETE RESTRICT,
  author_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'changes_requested', 'approved', 'merged', 'closed')),
  base_commit_id TEXT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  head_commit_id TEXT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  merged_commit_id TEXT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  merged_by_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  merged_at TIMESTAMPTZ NULL,
  CHECK (source_branch_id <> target_branch_id)
);
CREATE INDEX IF NOT EXISTS merge_request_inbox_idx
  ON merge_request (project_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS merge_review (
  id TEXT PRIMARY KEY,
  merge_request_id TEXT NOT NULL REFERENCES merge_request(id) ON DELETE CASCADE,
  reviewer_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  verdict TEXT NOT NULL CHECK (verdict IN ('comment', 'approve', 'request_changes', 'reject')),
  body TEXT NOT NULL DEFAULT '',
  node_id TEXT NULL REFERENCES knowledge_node(id) ON DELETE RESTRICT,
  block_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS merge_review_request_idx
  ON merge_review (merge_request_id, created_at);

CREATE TABLE IF NOT EXISTS content_attribution (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES knowledge_project(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES knowledge_node(id) ON DELETE RESTRICT,
  block_id TEXT NOT NULL,
  origin_commit_id TEXT NOT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  last_touch_commit_id TEXT NOT NULL REFERENCES knowledge_commit(id) ON DELETE RESTRICT,
  contributor_user_id TEXT NOT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  reviewer_user_id TEXT NULL REFERENCES platform_user(id) ON DELETE RESTRICT,
  merge_request_id TEXT NULL REFERENCES merge_request(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, node_id, block_id, contributor_user_id, origin_commit_id)
);
CREATE INDEX IF NOT EXISTS content_attribution_block_idx
  ON content_attribution (project_id, node_id, block_id, active);

-- 循环依赖必须在两张表创建后追加；pg_constraint 检查使迁移可重复执行。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_branch_base_commit_fk') THEN
    ALTER TABLE knowledge_branch
      ADD CONSTRAINT knowledge_branch_base_commit_fk FOREIGN KEY (base_commit_id) REFERENCES knowledge_commit(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_branch_head_commit_fk') THEN
    ALTER TABLE knowledge_branch
      ADD CONSTRAINT knowledge_branch_head_commit_fk FOREIGN KEY (head_commit_id) REFERENCES knowledge_commit(id) ON DELETE SET NULL;
  END IF;
END $$;
