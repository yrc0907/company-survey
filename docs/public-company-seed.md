# 公开企业首发数据包

迁移 `022_public_company_seed.sql` 与 `024_public_company_seed_additional.sql` 为公开首页和个人 Research API 提供十二个企业研究项目：
慧策、泛微网络、深信服、信锐科技、有赞、纷享销客、金蝶、奇安信、安恒信息、启明星辰、钉钉、Lark。资料包只包含企业官网公开入口和一段保守的人工摘要，
不把模型生成内容、搜索结果或未公开商业信息当成事实。

迁移 `025_public_research_file_tree.sql` 在上述项目中建立统一的研究目录和章节节点。它只创建可追溯的空白结构模板（每个项目 1 个“研究报告”文件夹和 8 个章节文档），
章节正文明确标记 `needs_verification`，不会冒充企业事实，也不会写入阅读、点赞、评论、关注或贡献行为。后续真实用户必须通过来源导入、Commit 和审核合并填充章节。

## 数据清单

| 项目 | 项目 ID / slug | 公开来源 | 来源类型 | 抓取时间（UTC） | 证据状态 | 摘要 SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 慧策 | `project-huice` / `huice-commerce-erp` | https://www.wangdian.cn/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `428ab5e900c56dfd2ee1ce3e1783354b826b9e067b4a7b65e4373e8490fbdff7` |
| 泛微网络 | `project-weaver` / `weaver-enterprise-collaboration` | https://www.weaver.com.cn/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `f7e8882f1e400803da1405a98542adcdb0f4015b0ff011a3c64ef335c85344d4` |
| 深信服 | `project-sangfor` / `sangfor-cloud-security` | https://www.sangfor.com.cn/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `4c7e72dbc247c0e7e35d7b13e48d4bdd1ce2a5d3163a9842186925e3f881289f` |
| 信锐科技 | `project-sundray` / `sundray-enterprise-network` | https://www.sundray.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `863cbdb9059ede64165109101849d0f4cc2fb7148522fed4536fa6d4c0650d68` |
| 有赞 | `project-youzan` / `youzan-retail-commerce` | https://www.youzan.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `55dd22a02093c51a148f822fa6eba166577e8c4f82d12ea11a491c11a4b3c77a` |
| 纷享销客 | `project-fxiaoke` / `fxiaoke-crm` | https://www.fxiaoke.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `8cd8c488573a62b6ac420f26e7178f1b71e01bbcb8820bc5dae9529d92ec5e2d` |
| 金蝶 | `project-kingdee` / `kingdee-enterprise-cloud` | https://www.kingdee.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `2972864d8aa31e5b179ec31eb8cf9c7485df4c78736998bde4c2f1792ae14999` |
| 奇安信 | `project-qianxin` / `qianxin-cybersecurity` | https://www.qianxin.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `92d062c024995a0ccd4e6669111057e2a7b650cd300bc1cf8464bd30247a2ac8` |
| 安恒信息 | `project-dbapp` / `dbappsecurity-data-security` | https://www.dbappsecurity.com.cn/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `5fa5c475ad4f5e0983c063ba61b7c063f48ca2354b39b05d4148592fd43087ee` |
| 启明星辰 | `project-venustech` / `venustech-cybersecurity` | https://www.venustech.com.cn/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `e34ef53a3e37320d5788315c08126ecdb003832d3dc29d69fa27f8bcefd38152` |
| 钉钉 | `project-dingtalk` / `dingtalk-collaboration` | https://www.dingtalk.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `46226b2a09a7bf8c63d5fd50afe1fe72e3096d4d404ec1ebf10820b1814682f0` |
| Lark | `project-lark` / `lark-team-collaboration` | https://www.larksuite.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | `c3709bcedc69ee8d12c516c78ea41822e641b39e9f1a569282151a5127221e46` |

摘要正文（用于复算上表哈希）如下：

- 慧策：`公开官网入口及产品信息摘要：旺店通网站介绍其面向电商经营的订单、库存与履约管理产品。此摘要仅记录官网公开表述，不推断客户数量、收入或价格。`
- 泛微网络：`公开官网入口及产品信息摘要：泛微官网介绍协同办公与企业数字化管理产品。此摘要仅记录官网公开表述，不推断市场份额、客户评价或价格。`
- 深信服：`公开官网入口及产品信息摘要：深信服官网公开展示云计算、网络安全及基础设施相关产品与服务。此摘要仅记录官网公开表述，不推断安全效果、收入或价格。`
- 信锐科技：`公开官网入口及产品信息摘要：信锐科技官网公开展示企业无线、交换与物联网相关网络产品。此摘要仅记录官网公开表述，不推断覆盖规模、性能或价格。`
- 有赞：`公开官网入口及产品信息摘要：有赞官网公开展示面向商家的零售、电商经营与私域运营相关产品。此摘要仅记录企业自述，不推断客户数量、收入、市场份额或价格。`
- 纷享销客：`公开官网入口及产品信息摘要：纷享销客官网公开展示企业级 CRM、销售管理与客户关系相关产品。此摘要仅记录企业自述，不推断客户数量、续费率、收入或价格。`
- 金蝶：`公开官网入口及产品信息摘要：金蝶官网公开展示企业管理云、财务管理与 ERP 相关产品。此摘要仅记录企业自述，不推断客户规模、实施效果、收入或价格。`
- 奇安信：`公开官网入口及产品信息摘要：奇安信官网公开展示网络安全产品与服务，以及安全运营等相关能力。此摘要仅记录企业自述，不推断安全效果、客户规模、收入或价格。`
- 安恒信息：`公开官网入口及产品信息摘要：安恒信息官网公开展示网络安全、数据安全与安全服务相关产品。此摘要仅记录企业自述，不推断安全效果、客户规模、收入和价格。`
- 启明星辰：`公开官网入口及产品信息摘要：启明星辰官网公开展示网络安全产品、安全运营与相关服务。此摘要仅记录企业自述，不推断安全效果、客户规模、收入和价格。`
- 钉钉：`公开官网入口及产品信息摘要：钉钉官网公开展示企业协同办公、组织管理与数字化工作相关产品。此摘要仅记录企业自述，不推断客户规模、使用效果、收入或价格。`
- Lark：`公开官网入口及产品信息摘要：Lark 官网公开展示团队协作、沟通与工作管理相关产品。此摘要仅记录企业自述，不推断客户规模、使用效果、收入或价格。`

## 结构与边界

- `knowledge_project` 保存公开项目标题、摘要、分类、标签、许可证和 `needs_verification` 状态；十二个项目均为 `public/published`，方便首页读取。
- `knowledge_branch`、`knowledge_commit`、`knowledge_node`、`document_revision` 和 `content_attribution` 保存可追溯的首发版本，正文仍可通过后续 Commit/MR 修订。
- `025_public_research_file_tree.sql` 增加 12 个研究文件夹和 96 个章节文档节点（每项目 8 个），并为每个文档保存结构 Commit、稳定节点 ID、内容哈希和初始署名；模板不含企业指标。
- 旧版 `company/report/source/source_chunk/citation/entity/relation_edge` 同步保存相同摘要，供受保护的个人 Research API 和 GraphRAG-lite 使用。
- `source.metadata` 保存 `sourceType`、发布者、抓取时间、许可边界和抓取方式；`source.content_hash` 与 `source_chunk.content_hash` 使用摘要 UTF-8 字节的 SHA-256。
- `evidence_state=needs_verification` 是刻意的安全边界。只有维护者核对网页快照、发布时间和引用许可后，才能在新的修订中升级状态；迁移不会自动升级。
- 迁移只使用已有的 `u-yu` active 维护者身份。若该身份不存在则 fail closed，拒绝创建“系统用户”或其他虚构账号。
- 不写入 `project_reader`、`project_view_daily`、`project_star`、`project_comment`、`merge_request` 或关注关系。所有新项目的 `project_stats.unique_readers` 从 `0` 开始，后续只能由真实请求聚合。

## 验证与后续

契约 `lib/services/platform/public-seed.contract.ts` 读取两份资料迁移和本文档，检查十二个项目、URL、
SHA-256 格式、待核验状态、幂等插入和“无静态阅读/社区计数”边界。部署时运行：

```bash
pnpm exec tsx lib/services/platform/public-seed.contract.ts
docker compose run --rm migrate
```

本地 manifest 只读校验可运行：

```bash
pnpm public-seed:validate
# 需要检查官网当前可达性时再运行（重定向或非 2xx 会标记 needs_review）
pnpm public-seed:validate -- --check-network
```

部署 `025` 后可用以下只读查询复核结构数量（不会改写内容）：

```sql
SELECT COUNT(*) AS research_folders
  FROM knowledge_node
 WHERE id LIKE 'project-%-folder-research';

SELECT COUNT(*) AS research_documents
  FROM knowledge_node
 WHERE id LIKE 'project-%-doc-%';
```

预期分别为 12 和 96；若某项目已存在同名结构 Commit，迁移会跳过该项目，避免覆盖人工修改。

迁移完成后应查询四个 `knowledge_project` 的 `unique_readers=0`、`source.metadata` 非空，
并用公网官网重新抓取快照后再提交下一份带新哈希的修订。官网发生跳转、反爬或内容变更时，
保留旧来源并新增版本，不能覆盖原始摘要。

无 PostgreSQL 的本地首页仍会显示 typed seed，但其阅读数、贡献者数、Star、评论和 MR 均为
零，只用于验证信息架构，页面会标记未连接持久化数据库；不能把它当成线上社区统计。
