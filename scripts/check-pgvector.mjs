import postgres from "postgres";

/**
 * 只读检查目标数据库的 pgvector 迁移与能力，不安装扩展、不修改表、不输出连接串。
 * 默认即使无扩展也以 0 退出（这是受支持的 FTS 降级）；`--require` 才会在能力缺失时失败。
 */
async function run() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，无法检查 pgvector。");
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    const rows = await sql`SELECT
      (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS extension_version,
      (SELECT udt_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'source_chunk' AND column_name = 'embedding'
        LIMIT 1) AS embedding_type,
      (SELECT CASE
        WHEN indexdef ILIKE '%USING hnsw%' THEN 'hnsw'
        WHEN indexdef ILIKE '%USING ivfflat%' THEN 'ivfflat'
        ELSE 'none'
      END
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'source_chunk' AND indexname = 'source_chunk_embedding_idx'
        LIMIT 1) AS index_kind`;
    let migrationApplied = false;
    try {
      const migrationRows = await sql`SELECT 1 FROM schema_migration WHERE name = '011_pgvector_optional.sql' LIMIT 1`;
      migrationApplied = migrationRows.length > 0;
    } catch {
      // 迁移表尚未创建时仍输出扩展探测结果；不把无表误判为向量可用。
    }
    const row = rows[0] ?? {};
    const extensionVersion = row.extension_version ? String(row.extension_version) : null;
    const embeddingType = row.embedding_type ? String(row.embedding_type) : null;
    const indexKind = row.index_kind === "hnsw" || row.index_kind === "ivfflat" ? row.index_kind : "none";
    const available = Boolean(extensionVersion && embeddingType === "vector");
    const result = {
      migration: migrationApplied ? "applied" : "missing",
      available,
      extensionVersion,
      embeddingType,
      indexKind,
      mode: process.env.PGVECTOR_ENABLED?.trim() || "auto",
      fallback: available ? null : "fts_and_deterministic_dense",
    };
    console.log(JSON.stringify(result));
    if (process.argv.includes("--require") && !available) process.exitCode = 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "pgvector 检查失败。");
  process.exitCode = 1;
});
