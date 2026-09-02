# 公开企业首发数据包

迁移 `022_public_company_seed.sql` 与 `024_public_company_seed_additional.sql` 曾为公开首页和个人 Research API 提供多个企业研究项目。
2026-09-03 起首发范围冻结为五家：慧策掌上先机、泛微网络、深信服、信锐科技、牧原食品；
其他企业项目进入清理迁移，不再出现在公开首页或首发资料包中。资料包只包含企业官网公开入口和一段保守的人工摘要，
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
| 牧原食品 | `project-muyuan` / `muyuan-foods-livestock` | https://www.muyuanfoods.com/ | `official_website` | `2026-09-02T00:00:00Z` | `needs_verification` | 待重新生成 |

摘要正文（用于复算上表哈希）如下：

- 慧策：`公开官网入口及产品信息摘要：旺店通网站介绍其面向电商经营的订单、库存与履约管理产品。此摘要仅记录官网公开表述，不推断客户数量、收入或价格。`
- 泛微网络：`公开官网入口及产品信息摘要：泛微官网介绍协同办公与企业数字化管理产品。此摘要仅记录官网公开表述，不推断市场份额、客户评价或价格。`
- 深信服：`公开官网入口及产品信息摘要：深信服官网公开展示云计算、网络安全及基础设施相关产品与服务。此摘要仅记录官网公开表述，不推断安全效果、收入或价格。`
- 信锐科技：`公开官网入口及产品信息摘要：信锐科技官网公开展示企业无线、交换与物联网相关网络产品。此摘要仅记录官网公开表述，不推断覆盖规模、性能或价格。`
- 牧原食品：`公开官网入口及企业信息摘要：牧原食品官网公开展示生猪养殖及相关产业链业务。此摘要仅记录企业自述，不推断出栏量、完全成本、猪价或盈利。`

## 结构与边界

- `knowledge_project` 保存公开项目标题、摘要、分类、标签、许可证和 `needs_verification` 状态；首发只允许五个冻结项目为 `public/published`，方便首页读取。
- `knowledge_branch`、`knowledge_commit`、`knowledge_node`、`document_revision` 和 `content_attribution` 保存可追溯的首发版本，正文仍可通过后续 Commit/MR 修订。
- `025_public_research_file_tree.sql` 的首发结构应收敛为 5 个研究文件夹和 40 个章节文档节点（每项目 8 个），并为每个文档保存结构 Commit、稳定节点 ID、内容哈希和初始署名；模板不含企业指标。
- 旧版 `company/report/source/source_chunk/citation/entity/relation_edge` 同步保存相同摘要，供受保护的个人 Research API 和 GraphRAG-lite 使用。
- `source.metadata` 保存 `sourceType`、发布者、抓取时间、许可边界和抓取方式；`source.content_hash` 与 `source_chunk.content_hash` 使用摘要 UTF-8 字节的 SHA-256。
- `evidence_state=needs_verification` 是刻意的安全边界。只有维护者核对网页快照、发布时间和引用许可后，才能在新的修订中升级状态；迁移不会自动升级。
- 迁移只使用已有的 `u-yu` active 维护者身份。若该身份不存在则 fail closed，拒绝创建“系统用户”或其他虚构账号。
- 不写入 `project_reader`、`project_view_daily`、`project_star`、`project_comment`、`merge_request` 或关注关系。所有新项目的 `project_stats.unique_readers` 从 `0` 开始，后续只能由真实请求聚合。

## 验证与后续

契约 `lib/services/platform/public-seed.contract.ts` 读取资料迁移和本文档，检查五个冻结项目、URL、
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

预期数量应以五个冻结项目为准（每项目 1 个研究文件夹和 8 个章节文档，共 5 和 40）；若某项目已存在同名结构 Commit，迁移会跳过该项目，避免覆盖人工修改。

迁移完成后应查询五个冻结 `knowledge_project` 的 `unique_readers=0`、`source.metadata` 非空，
并用公网官网重新抓取快照后再提交下一份带新哈希的修订。官网发生跳转、反爬或内容变更时，
保留旧来源并新增版本，不能覆盖原始摘要。

无 PostgreSQL 的本地首页仍会显示 typed seed，但其阅读数、贡献者数、Star、评论和 MR 均为
零，只用于验证信息架构，页面会标记未连接持久化数据库；不能把它当成线上社区统计。
