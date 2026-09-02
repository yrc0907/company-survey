import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 公开首发数据契约：只检查可审计的迁移文本，不连接生产数据库，也不写入任何数据。
 * 这样可以在提交前阻止 URL、摘要哈希、证据状态或“静态社区计数”边界悄悄漂移。
 */
function runPublicSeedContract(): void {
  const migrationPath = resolve(process.cwd(), "db", "migrations", "022_public_company_seed.sql");
  const documentationPath = resolve(process.cwd(), "docs", "public-company-seed.md");
  const migration = readFileSync(migrationPath, "utf8");
  const documentation = readFileSync(documentationPath, "utf8");
  const seeds = [
    {
      id: "project-huice", slug: "huice-commerce-erp", url: "https://www.wangdian.cn/",
      summary: "公开官网入口及产品信息摘要：旺店通网站介绍其面向电商经营的订单、库存与履约管理产品。此摘要仅记录官网公开表述，不推断客户数量、收入或价格。",
      hash: "428ab5e900c56dfd2ee1ce3e1783354b826b9e067b4a7b65e4373e8490fbdff7",
    },
    {
      id: "project-weaver", slug: "weaver-enterprise-collaboration", url: "https://www.weaver.com.cn/",
      summary: "公开官网入口及产品信息摘要：泛微官网介绍协同办公与企业数字化管理产品。此摘要仅记录官网公开表述，不推断市场份额、客户评价或价格。",
      hash: "f7e8882f1e400803da1405a98542adcdb0f4015b0ff011a3c64ef335c85344d4",
    },
    {
      id: "project-sangfor", slug: "sangfor-cloud-security", url: "https://www.sangfor.com.cn/",
      summary: "公开官网入口及产品信息摘要：深信服官网公开展示云计算、网络安全及基础设施相关产品与服务。此摘要仅记录官网公开表述，不推断安全效果、收入或价格。",
      hash: "4c7e72dbc247c0e7e35d7b13e48d4bdd1ce2a5d3163a9842186925e3f881289f",
    },
    {
      id: "project-sundray", slug: "sundray-enterprise-network", url: "https://www.sundray.com/",
      summary: "公开官网入口及产品信息摘要：信锐科技官网公开展示企业无线、交换与物联网相关网络产品。此摘要仅记录官网公开表述，不推断覆盖规模、性能或价格。",
      hash: "863cbdb9059ede64165109101849d0f4cc2fb7148522fed4536fa6d4c0650d68",
    },
  ] as const;

  assert.equal(seeds.length, 4, "首发企业项目必须恰好包含四家公司");
  assert.equal((migration.match(/project_id TEXT/g) ?? []).length, 1, "临时清单项目 ID 只应声明一次");
  assert.match(migration, /ALTER TABLE knowledge_project[\s\S]*ADD COLUMN IF NOT EXISTS category/);
  assert.match(migration, /ALTER TABLE source[\s\S]*ADD COLUMN IF NOT EXISTS evidence_state/);
  assert.match(migration, /sourceType.*official_website/);
  assert.match(migration, /'needs_verification'/);
  assert.match(migration, /project_stats[\s\S]*SELECT project_id, 0/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+platform_user/i, "迁移不能创建虚构用户");
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+(project_reader|project_view_daily|project_star|project_comment|merge_request)\b/i, "迁移不能伪造社区统计");

  for (const seed of seeds) {
    const calculated = createHash("sha256").update(seed.summary, "utf8").digest("hex");
    assert.equal(calculated, seed.hash, `${seed.id} 摘要哈希不匹配`);
    assert.match(migration, new RegExp(seed.id));
    assert.match(migration, new RegExp(seed.slug));
    assert.match(migration, new RegExp(seed.url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(migration, new RegExp(seed.hash));
    assert.match(documentation, new RegExp(seed.id));
    assert.match(documentation, new RegExp(seed.hash));
  }
}

runPublicSeedContract();
console.log("public seed contract passed");
