import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import postgres from "postgres";

const MIGRATION_LOCK_ID = 7_916_240_311;

/** 迁移只读取仓库内排序后的 SQL；用户输入永远不能成为文件名或 SQL。 */
async function loadMigrations(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9_-]+\.sql$/i.test(entry.name)).map((entry) => entry.name).sort();
  return Promise.all(files.map(async (name) => {
    const sql = await readFile(resolve(directory, name), "utf8");
    const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
    return { name, sql, checksum };
  }));
}

/**
 * 在全局 advisory lock 下顺序应用迁移。
 * 已执行文件的校验和变化会拒绝启动，强制开发者新增迁移而不是改写生产历史。
 */
async function run() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，无法运行数据库迁移。" );
  const migrationDirectory = resolve(process.cwd(), "db", "migrations");
  const migrations = await loadMigrations(migrationDirectory);
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 5, connect_timeout: 10 });
  try {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migration (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`;

    for (const migration of migrations) {
      const rows = await sql`SELECT checksum FROM schema_migration WHERE name = ${migration.name}`;
      if (rows[0]) {
        if (rows[0].checksum !== migration.checksum) throw new Error(`已执行迁移 ${migration.name} 的校验和发生变化。`);
        continue;
      }
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.sql);
        await transaction`INSERT INTO schema_migration (name, checksum) VALUES (${migration.name}, ${migration.checksum})`;
      });
      console.log(`migration applied: ${migration.name}`);
    }
  } finally {
    try {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : "数据库迁移失败。" );
  process.exitCode = 1;
});
