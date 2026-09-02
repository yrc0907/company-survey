import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 社区 seed 的静态契约：不连接生产数据库、不读取凭据，只检查脚本和迁移
 * 是否保留 40-60 用户、幂等关系、通知/热力图投影、清理入口与安全边界。
 */
const script = await readFile(resolve(process.cwd(), "scripts", "seed-community.mjs"), "utf8");
const migration = await readFile(resolve(process.cwd(), "db", "migrations", "028_community_seed_support.sql"), "utf8");

const failures = [];
const userRows = (script.match(/^  \["[^\n]+", "[^\n]+", "[^\n]+", "[^\n]+", "[^\n]+"\],$/gm) ?? []).length;
if (userRows < 40 || userRows > 60) failures.push(`场景用户应为 40-60 个，脚本解析到 ${userRows}`);
for (const token of [
  "community_seed_record", "platform_notification", "activity_daily", "project_reader", "project_view_daily",
  "project_star", "author_follow", "project_comment", "merge_request", "merge_review", "content_attribution",
]) if (!script.includes(token)) failures.push(`脚本缺少 ${token} 写入路径`);
for (const token of ["ON CONFLICT (id) DO NOTHING", "ON CONFLICT (project_id, viewer_key_hash) DO NOTHING", "rebuildActivityDaily", "--clean", "--check"]) {
  if (!script.includes(token)) failures.push(`脚本缺少幂等/维护能力：${token}`);
}
if (!script.includes("community.research.invalid")) failures.push("场景邮箱必须使用保留域名，禁止触发外部投递");
if (/sk-[A-Za-z0-9]/.test(script)) failures.push("seed 脚本不得包含 API Key");
if (!migration.includes("CREATE TABLE IF NOT EXISTS community_seed_record")) failures.push("迁移缺少 seed 内部追踪表");
if (!migration.includes("CREATE TABLE IF NOT EXISTS platform_notification")) failures.push("迁移缺少通知表");
if (!migration.includes("CREATE TABLE IF NOT EXISTS activity_daily")) failures.push("迁移缺少热力图日投影表");
if (!migration.includes("COALESCE(project_id, '')")) failures.push("热力图缺少 project_id=NULL 的唯一性保护");

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "passed", scenarioUserCount: userRows, migration: "028_community_seed_support.sql" }, null, 2));
}
