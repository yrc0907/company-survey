import type { WorkbenchSnapshot } from "@/lib/domain/research";

/**
 * 工作台的可运行演示数据。
 * 数据均为合成研究样例，来源状态和结论状态明确表达，避免被误解为外部已核验事实。
 */
export function createDemoSnapshot(): WorkbenchSnapshot {
  const now = "2026-09-01T08:00:00.000Z";
  const reportId = "report-huice";
  const policySourceId = "source-plan";
  const companySourceId = "source-huice-site";
  const policyChunkId = "chunk-plan-cross-border";
  const companyChunkId = "chunk-huice-product";

  return {
    companies: [
      { id: "company-huice", name: "慧策", kind: "company", summary: "电商与零售履约软件研究对象。", tags: ["电商 ERP", "仓储履约"], createdAt: now, updatedAt: now },
      { id: "company-dianshaomi", name: "店小秘", kind: "competitor", summary: "跨境卖家工具研究对象。", tags: ["跨境 ERP", "竞品"], createdAt: now, updatedAt: now },
      { id: "policy-fifteenth", name: "十五五规划纲要", kind: "policy", summary: "政策原文研究对象。", tags: ["政策", "数字贸易"], createdAt: now, updatedAt: now },
    ],
    reports: [{ id: reportId, companyId: "company-huice", title: "慧策掌上先机：行业与政策契合度调研", status: "draft", currentVersion: 1, createdAt: now, updatedAt: now }],
    sections: [
      { id: "section-overview", reportId, parentSectionId: null, heading: "研究结论", anchor: "research-conclusion", level: 1, position: 1, content: "慧策的产品定位与电商履约数字化存在政策方向关联，但政策契合不等于监管合规或商业结果。", evidenceState: "inference", updatedAt: now },
      { id: "section-evidence", reportId, parentSectionId: null, heading: "证据范围", anchor: "evidence-scope", level: 1, position: 2, content: "本报告仅引用用户导入的公开网页和政策原文片段；价格、续费率等未公开信息必须保留待核验状态。", evidenceState: "needs_verification", updatedAt: now },
    ],
    sources: [
      { id: policySourceId, reportId, title: "十五五规划纲要（研究摘录）", kind: "text", url: "https://www.gov.cn/", language: "zh", state: "active", capturedAt: now, contentHash: "demo-plan-sha256", snapshot: "推进人工智能赋能实体经济，发展数字贸易和跨境电商相关服务。" },
      { id: companySourceId, reportId, title: "慧策产品介绍（演示快照）", kind: "web", url: "https://www.wangdian.cn/", language: "zh", state: "active", capturedAt: now, contentHash: "demo-huice-sha256", snapshot: "产品介绍涉及订单管理、仓储履约和跨境业务协同。" },
    ],
    chunks: [
      { id: policyChunkId, sourceId: policySourceId, parentSectionId: "section-evidence", headingPath: ["第七篇", "数字贸易"], position: 1, page: 22, startOffset: 0, endOffset: 29, text: "推进人工智能赋能实体经济，发展数字贸易和跨境电商相关服务。", contextualPrefix: "政策研究摘录；主题：人工智能、数字贸易、跨境电商。", contentHash: "demo-plan-chunk" },
      { id: companyChunkId, sourceId: companySourceId, parentSectionId: "section-evidence", headingPath: ["产品能力"], position: 1, page: null, startOffset: 0, endOffset: 23, text: "产品介绍涉及订单管理、仓储履约和跨境业务协同。", contextualPrefix: "企业官网演示快照；信息属于企业自述。", contentHash: "demo-huice-chunk" },
    ],
    citations: [{ id: "citation-policy", reportId, sectionId: "section-overview", sourceId: policySourceId, chunkId: policyChunkId, quote: "发展数字贸易和跨境电商相关服务。", evidenceState: "fact", createdAt: now }],
    entities: [
      { id: "entity-huice", reportId, kind: "company", name: "慧策", normalizedName: "慧策", sourceId: companySourceId, evidenceState: "fact", attributes: { category: "电商履约软件" }, createdAt: now },
      { id: "entity-product", reportId, kind: "product", name: "旺店通跨境 ERP", normalizedName: "旺店通跨境erp", sourceId: companySourceId, evidenceState: "fact", attributes: { category: "跨境 ERP" }, createdAt: now },
      { id: "entity-policy", reportId, kind: "policy", name: "数字贸易", normalizedName: "数字贸易", sourceId: policySourceId, evidenceState: "fact", attributes: { document: "十五五规划纲要" }, createdAt: now },
      { id: "entity-competitor", reportId, kind: "competitor", name: "店小秘", normalizedName: "店小秘", sourceId: null, evidenceState: "needs_verification", attributes: { category: "跨境 ERP" }, createdAt: now },
    ],
    edges: [
      { id: "edge-huice-product", reportId, fromEntityId: "entity-huice", toEntityId: "entity-product", relation: "提供", sourceId: companySourceId, evidenceState: "fact", createdAt: now },
      { id: "edge-product-policy", reportId, fromEntityId: "entity-product", toEntityId: "entity-policy", relation: "方向关联", sourceId: policySourceId, evidenceState: "inference", createdAt: now },
      { id: "edge-product-competitor", reportId, fromEntityId: "entity-product", toEntityId: "entity-competitor", relation: "潜在竞品", sourceId: null, evidenceState: "needs_verification", createdAt: now },
    ],
    revisions: [{ id: "revision-huice-v1", reportId, version: 1, title: "慧策掌上先机：行业与政策契合度调研", sections: [
      { id: "section-overview", reportId, parentSectionId: null, heading: "研究结论", anchor: "research-conclusion", level: 1, position: 1, content: "慧策的产品定位与电商履约数字化存在政策方向关联，但政策契合不等于监管合规或商业结果。", evidenceState: "inference", updatedAt: now },
      { id: "section-evidence", reportId, parentSectionId: null, heading: "证据范围", anchor: "evidence-scope", level: 1, position: 2, content: "本报告仅引用用户导入的公开网页和政策原文片段；价格、续费率等未公开信息必须保留待核验状态。", evidenceState: "needs_verification", updatedAt: now },
    ], author: "user", createdAt: now }],
  };
}
