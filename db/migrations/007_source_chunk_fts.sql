-- 为存量数据库补齐包含上下文前缀和标题路径的 PostgreSQL FTS 表达式索引。
-- 使用 IF NOT EXISTS 保证迁移可重复执行；不删除旧索引，避免升级期间影响既有查询。
CREATE INDEX IF NOT EXISTS source_chunk_contextual_fts_idx ON source_chunk USING GIN (
  to_tsvector('simple', coalesce(text, '') || ' ' || coalesce(contextual_prefix, '') || ' ' || coalesce(array_to_string(heading_path, ' '), ''))
);
