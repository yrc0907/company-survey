import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 公开首发数据契约：只检查可审计的迁移文本，不连接生产数据库，也不写入任何数据。
 * 这样可以在提交前阻止 URL、摘要哈希、证据状态或“静态社区计数”边界悄悄漂移。
 */
function runPublicSeedContract(): void {
  const migrationPaths = [
    resolve(process.cwd(), "db", "migrations", "022_public_company_seed.sql"),
    resolve(process.cwd(), "db", "migrations", "024_public_company_seed_additional.sql"),
  ];
  const documentationPath = resolve(process.cwd(), "docs", "public-company-seed.md");
  const migration = migrationPaths.map((path) => readFileSync(path, "utf8")).join("\n");
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
    {
      id: "project-youzan", slug: "youzan-retail-commerce", url: "https://www.youzan.com/",
      summary: "公开官网入口及产品信息摘要：有赞官网公开展示面向商家的零售、电商经营与私域运营相关产品。此摘要仅记录官网公开表述，不推断客户数量、收入、市场份额或价格。",
      hash: "55dd22a02093c51a148f822fa6eba166577e8c4f82d12ea11a491c11a4b3c77a",
    },
    {
      id: "project-fxiaoke", slug: "fxiaoke-crm", url: "https://www.fxiaoke.com/",
      summary: "公开官网入口及产品信息摘要：纷享销客官网公开展示企业级 CRM、销售管理与客户关系相关产品。此摘要仅记录官网公开表述，不推断客户数量、续费率、收入或价格。",
      hash: "8cd8c488573a62b6ac420f26e7178f1b71e01bbcb8820bc5dae9529d92ec5e2d",
    },
    {
      id: "project-kingdee", slug: "kingdee-enterprise-cloud", url: "https://www.kingdee.com/",
      summary: "公开官网入口及产品信息摘要：金蝶官网公开展示企业管理云、财务管理与 ERP 相关产品。此摘要仅记录官网公开表述，不推断客户规模、实施效果、收入或价格。",
      hash: "2972864d8aa31e5b179ec31eb8cf9c7485df4c78736998bde4c2f1792ae14999",
    },
    {
      id: "project-qianxin", slug: "qianxin-cybersecurity", url: "https://www.qianxin.com/",
      summary: "公开官网入口及产品信息摘要：奇安信官网公开展示网络安全产品与服务，以及安全运营等相关能力。此摘要仅记录官网公开表述，不推断安全效果、客户规模、收入或价格。",
      hash: "92d062c024995a0ccd4e6669111057e2a7b650cd300bc1cf8464bd30247a2ac8",
    },
    {
      id: "project-dbapp", slug: "dbappsecurity-data-security", url: "https://www.dbappsecurity.com.cn/",
      summary: "公开官网入口及产品信息摘要：安恒信息官网公开展示网络安全、数据安全与安全服务相关产品。此摘要仅记录官网公开表述，不推断安全效果、客户规模、收入或价格。",
      hash: "5fa5c475ad4f5e0983c063ba61b7c063f48ca2354b39b05d4148592fd43087ee",
    },
    {
      id: "project-venustech", slug: "venustech-cybersecurity", url: "https://www.venustech.com.cn/",
      summary: "公开官网入口及产品信息摘要：启明星辰官网公开展示网络安全产品、安全运营与相关服务。此摘要仅记录官网公开表述，不推断安全效果、客户规模、收入或价格。",
      hash: "e34ef53a3e37320d5788315c08126ecdb003832d3dc29d69fa27f8bcefd38152",
    },
    {
      id: "project-dingtalk", slug: "dingtalk-collaboration", url: "https://www.dingtalk.com/",
      summary: "公开官网入口及产品信息摘要：钉钉官网公开展示企业协同办公、组织管理与数字化工作相关产品。此摘要仅记录官网公开表述，不推断客户规模、使用效果、收入或价格。",
      hash: "46226b2a09a7bf8c63d5fd50afe1fe72e3096d4d404ec1ebf10820b1814682f0",
    },
    {
      id: "project-lark", slug: "lark-team-collaboration", url: "https://www.larksuite.com/",
      summary: "公开官网入口及产品信息摘要：Lark 官网公开展示团队协作、沟通与工作管理相关产品。此摘要仅记录官网公开表述，不推断客户规模、使用效果、收入或价格。",
      hash: "c3709bcedc69ee8d12c516c78ea41822e641b39e9f1a569282151a5127221e46",
    },
  ] as const;

  assert.equal(seeds.length, 12, "首发企业项目必须包含十二家公司");
  assert.equal((migration.match(/project_id TEXT/g) ?? []).length, 2, "两份临时清单各自只应声明一次项目 ID");
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
