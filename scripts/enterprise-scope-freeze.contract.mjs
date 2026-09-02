import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/** 静态契约：范围冻结必须是已知 ID、默认只读、可回滚且不能物理删除数据。 */
const scriptPath = resolve(process.cwd(), "scripts", "freeze-enterprise-scope.mjs");
const migrationPath = resolve(process.cwd(), "db", "migrations", "030_enterprise_scope_freeze.sql");
const script = await readFile(scriptPath, "utf8");
const migration = await readFile(migrationPath, "utf8");

for (const id of ["project-huice", "project-weaver", "project-sangfor", "project-sundray", "project-muyuan"]) {
  assert.match(script, new RegExp(`['\"]${id}['\"]`), `冻结清单必须保留 ${id}`);
}
for (const id of ["project-youzan", "project-fxiaoke", "project-kingdee", "project-qianxin", "project-dbapp", "project-venustech", "project-dingtalk", "project-lark"]) {
  assert.match(script, new RegExp(`['\"]${id}['\"]`), `已知待归档项目必须包含 ${id}`);
}

assert.match(script, /const\s+applyMode\s*=\s*args\.includes\("--apply"\)/, "默认模式必须不是 apply");
assert.match(script, /if\s*\(!applyMode\)\s*\{[\s\S]*preview\(scope\)/, "默认执行必须只读预览");
assert.match(script, /rollbackScope\(sql, rollbackBatch\)/, "必须提供批次回滚入口");
assert.match(script, /enterprise_scope_retirement/, "必须写入回滚账本");
assert.match(script, /visibility\s*=\s*'private'[\s\S]*status\s*=\s*'archived'/, "归档必须移出公开查询");
assert.doesNotMatch(script, /DELETE\s+FROM\s+(knowledge_project|company|report|source|source_chunk|knowledge_node)/i, "范围冻结不得物理删除企业或来源数据");
assert.match(migration, /CREATE TABLE IF NOT EXISTS enterprise_scope_freeze_batch/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS enterprise_scope_retirement/);
assert.match(migration, /project_snapshot\s+JSONB\s+NOT NULL/);
assert.match(migration, /ON DELETE RESTRICT/);

console.log("enterprise scope freeze contract passed");
