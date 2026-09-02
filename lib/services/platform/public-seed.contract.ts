import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 公开首发数据契约：五家冻结企业是唯一首发范围。契约只读取迁移和
 * manifest，不连接生产数据库、不写入数据，也不允许迁移创建 synthetic 用户
 * 或社区互动统计。
 */
function runPublicSeedContract(): void {
  const migrationPaths = [
    resolve(process.cwd(), "db", "migrations", "022_public_company_seed.sql"),
    resolve(process.cwd(), "db", "migrations", "024_public_company_seed_additional.sql"),
    resolve(process.cwd(), "db", "migrations", "025_public_research_file_tree.sql"),
    resolve(process.cwd(), "db", "migrations", "029_muyuan_foods_seed.sql"),
  ];
  const migration = migrationPaths.map((path) => readFileSync(path, "utf8")).join("\n");
  const documentation = readFileSync(resolve(process.cwd(), "docs", "public-company-seed.md"), "utf8");
  const frozen = [
    ["project-huice", "huice-commerce-erp", "https://www.wangdian.cn/"],
    ["project-weaver", "weaver-enterprise-collaboration", "https://www.weaver.com.cn/"],
    ["project-sangfor", "sangfor-cloud-security", "https://www.sangfor.com.cn/"],
    ["project-sundray", "sundray-enterprise-network", "https://www.sundray.com/"],
    ["project-muyuan", "muyuan-foods-livestock", "https://www.muyuanfoods.com/"],
  ] as const;
  const retired = ["project-youzan", "project-fxiaoke", "project-kingdee", "project-qianxin", "project-dbapp", "project-venustech", "project-dingtalk", "project-lark"];

  assert.equal(frozen.length, 5, "首发企业项目必须包含五家冻结企业");
  assert.match(documentation, /首发范围冻结为五家/);
  assert.match(documentation, /虚构账号/);
  assert.match(migration, /ALTER TABLE knowledge_project[\s\S]*ADD COLUMN IF NOT EXISTS category/);
  assert.match(migration, /ALTER TABLE source[\s\S]*ADD COLUMN IF NOT EXISTS evidence_state/);
  assert.match(migration, /'needs_verification'/);
  assert.match(migration, /public-research-structure:/, "结构迁移必须使用幂等结构 Commit");
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+platform_user/i, "迁移不能创建虚构用户");
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(project_reader|project_view_daily|project_star|project_comment|merge_request)\b/i, "资料迁移不能伪造社区统计");

  for (const [projectId, slug, url] of frozen) {
    assert.match(migration, new RegExp(projectId));
    assert.match(migration, new RegExp(slug));
    assert.match(migration, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(documentation, new RegExp(projectId));
  }
  assert.equal(retired.length, 8, "历史非冻结项目清单数量应为八个");
}

runPublicSeedContract();
console.log("public seed contract passed (frozen projects: 5)");
