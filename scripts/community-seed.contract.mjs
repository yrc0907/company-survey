import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * 社区 seed 静态契约：不连接生产数据库、不读取凭据，只检查冻结范围、
 * 真实账号边界、幂等写入和可回滚维护入口。社区脚本不能创建用户资料。
 */
const script = await readFile(resolve(process.cwd(), "scripts", "seed-community.mjs"), "utf8");
const migration = await readFile(resolve(process.cwd(), "db", "migrations", "028_community_seed_support.sql"), "utf8");

const failures = [];
const frozenProjects = ["project-huice", "project-weaver", "project-sangfor", "project-sundray", "project-muyuan"];
for (const projectId of frozenProjects) {
  if (!script.includes(`"${projectId}"`)) failures.push(`seed 缺少冻结项目 ${projectId}`);
}
for (const retiredProject of ["project-youzan", "project-fxiaoke", "project-kingdee", "project-qianxin", "project-dbapp", "project-venustech", "project-dingtalk", "project-lark"]) {
  if (script.includes(`"${retiredProject}"`)) failures.push(`seed 不得继续写入已归档项目 ${retiredProject}`);
}
for (const token of [
  "community_seed_record", "community_participant", "platform_notification", "activity_daily",
  "project_reader", "project_view_daily", "project_star", "author_follow", "project_comment",
  "merge_request", "merge_review", "content_attribution",
]) if (!script.includes(token)) failures.push(`脚本缺少 ${token} 路径`);
for (const token of [
  "ON CONFLICT (id) DO NOTHING", "ON CONFLICT (project_id, viewer_key_hash) DO NOTHING",
  "loadRealUsers", "COMMUNITY_SEED_USER_IDS", "--clean", "--check", "--retire-legacy-users", "rebuildActivityDaily",
]) if (!script.includes(token)) failures.push(`脚本缺少幂等/维护能力：${token}`);
if (/INSERT\s+INTO\s+platform_(user|profile)/i.test(script)) failures.push("seed 不得创建 platform_user/platform_profile");
if (script.includes("userEmail") || script.includes("community_user")) failures.push("seed 不得包含 synthetic 用户创建逻辑");
if (/sk-[A-Za-z0-9]/.test(script)) failures.push("seed 脚本不得包含 API Key");
if (!migration.includes("CREATE TABLE IF NOT EXISTS community_seed_record")) failures.push("迁移缺少 seed 追踪表");
if (!migration.includes("CREATE TABLE IF NOT EXISTS platform_notification")) failures.push("迁移缺少通知表");
if (!migration.includes("CREATE TABLE IF NOT EXISTS activity_daily")) failures.push("迁移缺少热力图表");

if (failures.length) {
  console.error(JSON.stringify({ status: "failed", failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "passed", frozenProjectCount: frozenProjects.length, syntheticUsersCreated: false, migration: "028_community_seed_support.sql" }, null, 2));
}
