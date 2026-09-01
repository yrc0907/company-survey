-- Research Workbench PostgreSQL schema.
-- 所有文字、结论与图关系均保留来源和版本；本文件不包含任何访问密钥或生产数据。

CREATE TABLE IF NOT EXISTS company (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'industry', 'competitor', 'policy')),
  summary TEXT NOT NULL DEFAULT '',
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS report (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES company(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'review', 'published')),
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS report_section (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  parent_section_id TEXT NULL,
  heading TEXT NOT NULL,
  anchor TEXT NOT NULL,
  level SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 6),
  position INTEGER NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('fact', 'inference', 'needs_verification', 'conflict')),
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (report_id, position),
  UNIQUE (report_id, anchor)
);

CREATE TABLE IF NOT EXISTS source (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('web', 'pdf', 'image', 'text', 'note')),
  url TEXT NULL,
  language TEXT NOT NULL CHECK (language IN ('zh', 'en', 'other')),
  state TEXT NOT NULL CHECK (state IN ('active', 'stale', 'conflict', 'archived')),
  captured_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  UNIQUE (report_id, content_hash)
);

CREATE TABLE IF NOT EXISTS source_chunk (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  parent_section_id TEXT NULL,
  heading_path TEXT[] NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL,
  page INTEGER NULL CHECK (page IS NULL OR page > 0),
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  text TEXT NOT NULL,
  contextual_prefix TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  UNIQUE (source_id, position),
  UNIQUE (source_id, content_hash)
);

CREATE INDEX IF NOT EXISTS source_chunk_text_fts_idx ON source_chunk USING GIN (to_tsvector('simple', text));
-- 查询正文、上下文前缀和标题路径；旧索引保留以兼容已有部署，迁移 007 为存量库补齐该索引。
CREATE INDEX IF NOT EXISTS source_chunk_contextual_fts_idx ON source_chunk USING GIN (
  to_tsvector('simple', coalesce(text, '') || ' ' || coalesce(contextual_prefix, '') || ' ' || coalesce(array_to_string(heading_path, ' '), ''))
);
CREATE INDEX IF NOT EXISTS source_report_state_idx ON source (report_id, state, captured_at DESC);

CREATE TABLE IF NOT EXISTS citation (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  section_id TEXT NULL REFERENCES report_section(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE RESTRICT,
  chunk_id TEXT NOT NULL REFERENCES source_chunk(id) ON DELETE RESTRICT,
  quote TEXT NOT NULL,
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('fact', 'inference', 'needs_verification', 'conflict')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS report_revision (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  title TEXT NOT NULL,
  sections JSONB NOT NULL,
  author TEXT NOT NULL CHECK (author IN ('user', 'system')),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (report_id, version)
);

CREATE TABLE IF NOT EXISTS entity (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('company', 'product', 'industry', 'competitor', 'policy', 'source', 'claim')),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  source_id TEXT NULL REFERENCES source(id) ON DELETE SET NULL,
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('fact', 'inference', 'needs_verification', 'conflict')),
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (report_id, kind, normalized_name)
);

CREATE TABLE IF NOT EXISTS relation_edge (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report(id) ON DELETE CASCADE,
  from_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  to_entity_id TEXT NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  source_id TEXT NULL REFERENCES source(id) ON DELETE SET NULL,
  evidence_state TEXT NOT NULL CHECK (evidence_state IN ('fact', 'inference', 'needs_verification', 'conflict')),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (from_entity_id <> to_entity_id)
);

CREATE INDEX IF NOT EXISTS relation_edge_report_from_idx ON relation_edge (report_id, from_entity_id);
CREATE INDEX IF NOT EXISTS relation_edge_report_to_idx ON relation_edge (report_id, to_entity_id);

-- 空数据库需要一个不承载外部事实的个人研究入口，否则用户无法创建第一份报告。
-- 使用固定 ID 与 ON CONFLICT 保证容器重建或重复执行 schema 时幂等，不覆盖用户后续修改。
INSERT INTO company (id, name, kind, summary, tags, created_at, updated_at)
VALUES (
  'workspace-personal',
  '个人研究库',
  'industry',
  '用于组织个人企业、行业、竞品和政策研究的默认对象。',
  ARRAY['个人研究']::TEXT[],
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report (id, company_id, title, status, current_version, created_at, updated_at)
VALUES (
  'report-getting-started',
  'workspace-personal',
  '快速研究笔记',
  'draft',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_section
  (id, report_id, parent_section_id, heading, anchor, level, position, content, evidence_state, updated_at)
VALUES (
  'section-getting-started',
  'report-getting-started',
  NULL,
  '研究问题',
  'research-question',
  1,
  1,
  '在这里记录需要研究的问题，再添加你有权分析的文本资料。',
  'needs_verification',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO report_revision (id, report_id, version, title, sections, author, created_at)
SELECT
  'revision-getting-started-v1',
  'report-getting-started',
  1,
  '快速研究笔记',
  jsonb_build_array(jsonb_build_object(
    'id', 'section-getting-started',
    'reportId', 'report-getting-started',
    'parentSectionId', NULL,
    'heading', '研究问题',
    'anchor', 'research-question',
    'level', 1,
    'position', 1,
    'content', '在这里记录需要研究的问题，再添加你有权分析的文本资料。',
    'evidenceState', 'needs_verification',
    'updatedAt', CURRENT_TIMESTAMP
  )),
  'system',
  CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM report WHERE id = 'report-getting-started')
ON CONFLICT (report_id, version) DO NOTHING;
