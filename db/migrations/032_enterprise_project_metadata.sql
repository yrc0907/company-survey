-- 五家冻结企业的首页元数据升级。
--
-- 这些字段只负责公开列表的研究定位，不替代正文事实或财报数据。
-- 结论性措辞明确标为研究者判断；没有可靠来源的数字不写入摘要。

UPDATE knowledge_project
SET title = '慧策掌上先机：电商 ERP、履约与 FDE 定制压力研究',
    summary = '研究订单、库存、仓配、跨境经营与业财分析如何形成可复用工作流；核心判断是 FDE 定制能否沉淀为行业模板，而不是把产品公司拖成项目公司。价格、续费、客户规模与收入保持待核验。',
    tags = ARRAY['电商 ERP','订单履约','WMS','跨境经营','SaaS','FDE 定制']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'project-huice' AND visibility = 'public' AND status = 'published';

UPDATE knowledge_project
SET title = '泛微网络：协同办公、低代码与政企数字化研究',
    summary = '研究复杂组织流程、低代码扩展、集团治理与本地化交付；核心判断是迁移成本和可审计工作流能否抵抗入口型协同产品的价格压力。分部收入、续费与现金流按公告核验。',
    tags = ARRAY['协同办公','低代码','政企数字化','集团治理','AI 应用','A 股']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'project-weaver' AND visibility = 'public' AND status = 'published';

UPDATE knowledge_project
SET title = '深信服：网络安全、云计算与持续服务研究',
    summary = '研究安全检测响应、云平台、基础设施和托管服务如何形成客户生命周期价值；核心判断是统一数据与可量化 SLA 比单点设备目录更能支撑续费。分部利润、服务续费和效果证据按公告核验。',
    tags = ARRAY['网络安全','云计算','安全运营','信创','托管服务','A 股']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'project-sangfor' AND visibility = 'public' AND status = 'published';

UPDATE knowledge_project
SET title = '信锐科技：企业无线、交换与园区物联网研究',
    summary = '研究无线接入、交换、物联网和云管运维如何从硬件项目走向场景化服务；核心判断是体验可观测、渠道交付和软件授权决定长期空间。主体关系、价格、性能与收入保持待核验。',
    tags = ARRAY['企业无线','交换网络','物联网','园区数字化','渠道交付','待核验']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'project-sundray' AND visibility = 'public' AND status = 'published';

UPDATE knowledge_project
SET title = '牧原食品：生猪养殖、成本曲线与产业链研究',
    summary = '研究育种、饲料、养殖、生物安全、屠宰与食品渠道的协同；核心判断是完全成本、现金流和负债安全边界比单纯出栏规模更能解释周期韧性。猪价、成本和利润按报告期核验。',
    tags = ARRAY['生猪养殖','完全成本','猪周期','生物安全','产业链','A 股']::TEXT[],
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'project-muyuan' AND visibility = 'public' AND status = 'published';
