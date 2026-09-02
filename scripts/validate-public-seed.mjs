import { readFile } from "node:fs/promises";

/**
 * 校验公开首发数据包的 manifest 边界；默认只读本地文档，不写数据库也不伪造统计。
 * `--check-network` 才会对每个官网发起 HEAD/GET，失败只报告待核验，不会阻断本地结构迁移。
 */
const manifestPath = new URL("../docs/public-company-seed.md", import.meta.url);
const text = await readFile(manifestPath, "utf8");
const rows = [];
for (const line of text.split(/\r?\n/)) {
  if (!/^\|\s*[^|]+\s*\|\s*`project-/i.test(line)) continue;
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  if (cells.length !== 7) continue;
  const identity = cells[1].match(/^`([^`]+)`\s*\/\s*`([^`]+)`$/);
  const sourceType = cells[3].replaceAll("`", "");
  const capturedAt = cells[4].replaceAll("`", "");
  const evidenceState = cells[5].replaceAll("`", "");
  const hash = cells[6].replaceAll("`", "");
  if (!identity) continue;
  rows.push({ name: cells[0], projectId: identity[1], slug: identity[2], url: cells[2], sourceType, capturedAt, evidenceState, hash });
}

const errors = [];
const ids = new Set();
const slugs = new Set();
for (const row of rows) {
  if (ids.has(row.projectId)) errors.push(`重复项目 ID：${row.projectId}`);
  if (slugs.has(row.slug)) errors.push(`重复 slug：${row.slug}`);
  ids.add(row.projectId); slugs.add(row.slug);
  if (!row.url.startsWith("https://")) errors.push(`来源必须使用 HTTPS：${row.projectId}`);
  if (row.sourceType !== "official_website") errors.push(`来源类型不在白名单：${row.projectId}`);
  if (!row.capturedAt.includes("T")) errors.push(`抓取时间缺少 ISO 标记：${row.projectId}`);
  if (row.evidenceState !== "needs_verification") errors.push(`证据状态必须先是 needs_verification：${row.projectId}`);
}
const frozenProjectIds = new Set(["project-huice", "project-weaver", "project-sangfor", "project-sundray", "project-muyuan"]);
if (rows.length !== frozenProjectIds.size) errors.push(`预期 ${frozenProjectIds.size} 个冻结项目，实际解析到 ${rows.length} 个`);
for (const projectId of frozenProjectIds) if (!ids.has(projectId)) errors.push(`缺少冻结项目：${projectId}`);
if (!text.includes("evidence_state=needs_verification")) errors.push("缺少待核验边界声明");
if (rows.some((row) => /project_(reader|view_daily|star|comment)|merge_request/i.test(`${row.name} ${row.projectId} ${row.slug} ${row.url}`))) errors.push("manifest 项目表不得写入社区行为或 MR 统计");

if (process.argv.includes("--check-network")) {
  for (const row of rows) {
    try {
      const response = await fetch(row.url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(8_000) });
      if (response.status >= 300 && response.status < 400) errors.push(`${row.projectId} 来源发生重定向（${response.status}），需人工核验`);
      else if (!response.ok) errors.push(`${row.projectId} 来源返回 ${response.status}，需人工核验`);
    } catch (error) {
      errors.push(`${row.projectId} 来源不可达：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ status: "needs_review", projectCount: rows.length, errors }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "valid", projectCount: rows.length, networkChecked: process.argv.includes("--check-network"), projects: rows.map(({ projectId, slug, url, hash }) => ({ projectId, slug, url, hash })) }, null, 2));
}
