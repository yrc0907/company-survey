export type VerificationState = "verified" | "needs_verification";
export type ProjectCategory = "企业" | "政策" | "行业" | "技术";
export type FileNodeKind = "folder" | "document" | "source" | "data";

export interface SeedUser {
  id: string;
  username: string;
  displayName: string;
}

export interface SeedFileNode {
  id: string;
  name: string;
  kind: FileNodeKind;
  children?: SeedFileNode[];
}

export interface SeedSection {
  id: string;
  /** 真实知识节点 ID；没有持久化节点的首发 seed 不提供段落锚点写入。 */
  nodeId?: string;
  heading: string;
  paragraphs: string[];
  state: "fact" | "inference" | "needs_verification" | "conflict";
  contributor: SeedUser;
  mergeRequest: number;
  reviewer: string;
  citations: number;
}

export interface SeedProject {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: ProjectCategory;
  tags: string[];
  verification: VerificationState;
  verificationNote: string;
  owner: SeedUser;
  publishedAt: string;
  updatedAt: string;
  uniqueReaders: number;
  /** 首发 Seed 不伪造社区行为；数据库项目会返回真实 Star 聚合。 */
  starCount?: number;
  /** 数据库项目返回真实未删除评论数；Seed 不填充虚构评论统计。 */
  commentCount?: number;
  contributors: SeedUser[];
  /** 数据库摘要可能只有聚合计数，展示时优先使用该服务端计数。 */
  contributorCount?: number;
  sourceCount: number;
  openMergeRequests: number;
  version: number;
  assistantReportId?: string;
  files: SeedFileNode[];
  sections: SeedSection[];
}

const platform = { id: "u-platform", username: "open-research", displayName: "开放研究计划" } satisfies SeedUser;
const lin = { id: "u-lin", username: "lin-data", displayName: "林知远" } satisfies SeedUser;
const chen = { id: "u-chen", username: "chen-policy", displayName: "陈栩" } satisfies SeedUser;
const yu = { id: "u-yu", username: "yu-research", displayName: "Yu" } satisfies SeedUser;

const sharedFiles: SeedFileNode[] = [
  {
    id: "folder-report",
    name: "报告",
    kind: "folder",
    children: [
      { id: "doc-overview", name: "研究结论", kind: "document" },
      { id: "doc-market", name: "市场与竞争", kind: "document" },
      { id: "doc-risks", name: "风险与待核验", kind: "document" },
    ],
  },
  {
    id: "folder-sources",
    name: "来源",
    kind: "folder",
    children: [
      { id: "source-official", name: "官方资料.pdf", kind: "source" },
      { id: "source-interview", name: "公开访谈摘录.md", kind: "source" },
    ],
  },
  { id: "folder-data", name: "数据", kind: "folder", children: [{ id: "data-comparison", name: "指标对比.csv", kind: "data" }] },
  { id: "folder-open", name: "待核验问题", kind: "folder", children: [] },
];

/** 首发内容仅用于前端信息架构展示；核验标签明确区分已检查材料与待核验结论。 */
export const seedProjects: SeedProject[] = [
  {
    id: "project-huice",
    slug: "huice-commerce-erp",
    title: "慧策掌上先机：产品、行业与竞争压力调研",
    summary: "从公开产品资料、政策文本与竞品线索梳理电商履约软件的产品边界与转型压力。",
    category: "企业",
    tags: ["企业研究", "电商 ERP", "SaaS"],
    verification: "verified",
    verificationNote: "Seed 中的引用范围已人工检查；商业判断仍按章节标注推断。",
    owner: yu,
    publishedAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-09-01T09:20:00.000Z",
    uniqueReaders: 2384,
    contributors: [yu, lin, chen, platform],
    sourceCount: 32,
    openMergeRequests: 3,
    version: 42,
    assistantReportId: "report-huice",
    files: sharedFiles,
    sections: [
      {
        id: "section-overview",
        nodeId: "doc-huice-overview",
        heading: "研究结论",
        paragraphs: [
          "慧策的公开产品信息覆盖订单、仓储与履约协同。当前材料能够证明其产品覆盖范围，但不能单凭官网描述推出续费率或客户满意度。",
          "政策对数字贸易与实体经济数字化的支持构成行业背景，不等同于对单一企业商业结果的背书。",
        ],
        state: "inference",
        contributor: lin,
        mergeRequest: 28,
        reviewer: "Yu",
        citations: 4,
      },
      {
        id: "section-evidence",
        nodeId: "doc-huice-evidence",
        heading: "证据范围与边界",
        paragraphs: [
          "本节使用企业官网、公开政策文本与可公开引用的行业资料。价格、实施成本和续费情况仍需要来自合同、客户访谈或权威统计的独立证据。",
        ],
        state: "fact",
        contributor: chen,
        mergeRequest: 31,
        reviewer: "Yu",
        citations: 7,
      },
      {
        id: "section-risk",
        nodeId: "doc-huice-risk",
        heading: "仍待核验的问题",
        paragraphs: [
          "FDE 式定制交付是否压缩标准化 SaaS 的生存空间，取决于交付成本、客户复杂度与标准产品覆盖率，目前公开数据不足。",
        ],
        state: "needs_verification",
        contributor: yu,
        mergeRequest: 34,
        reviewer: "待审核",
        citations: 2,
      },
    ],
  },
  {
    id: "project-fifteenth",
    slug: "fifteenth-five-year-plan",
    title: "十五五规划：章节化原文与产业关联索引",
    summary: "按章节整理政策原文、产业关键词和可追溯引用，区分政策原句与研究者解读。",
    category: "政策",
    tags: ["十五五", "政策原文", "产业体系"],
    verification: "verified",
    verificationNote: "目录和引用锚点已核对政府公开原文。",
    owner: chen,
    publishedAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-31T15:14:00.000Z",
    uniqueReaders: 5182,
    contributors: [chen, platform, yu],
    sourceCount: 18,
    openMergeRequests: 1,
    version: 17,
    files: sharedFiles,
    sections: [],
  },
  {
    id: "project-erp",
    slug: "cross-border-erp-landscape",
    title: "跨境 ERP 与电商 SaaS 竞品版图",
    summary: "归纳产品定位、目标客户和公开定价线索；市场份额与续费数据仍等待独立来源核验。",
    category: "行业",
    tags: ["跨境电商", "ERP", "竞品研究"],
    verification: "needs_verification",
    verificationNote: "产品信息已整理，市场份额与商业数据尚未完成交叉核验。",
    owner: lin,
    publishedAt: "2026-08-24T08:00:00.000Z",
    updatedAt: "2026-09-01T02:40:00.000Z",
    uniqueReaders: 1297,
    contributors: [lin, yu],
    sourceCount: 24,
    openMergeRequests: 5,
    version: 9,
    files: sharedFiles,
    sections: [],
  },
  {
    id: "project-platform",
    slug: "open-knowledge-platform",
    title: "开放知识平台：产品与架构设计记录",
    summary: "公开记录文件协作、贡献署名、合并审核、检索和 AI 上下文边界的设计决策。",
    category: "技术",
    tags: ["开放知识", "AI 助手", "版本协作"],
    verification: "verified",
    verificationNote: "设计决策与当前规格文档一致，尚未实现的能力均明确标注。",
    owner: platform,
    publishedAt: "2026-08-29T08:00:00.000Z",
    updatedAt: "2026-09-01T10:06:00.000Z",
    uniqueReaders: 864,
    contributors: [platform, yu, chen],
    sourceCount: 12,
    openMergeRequests: 2,
    version: 12,
    files: sharedFiles,
    sections: [],
  },
];

export function getSeedProject(projectId: string): SeedProject | undefined {
  return seedProjects.find((project) => project.id === projectId);
}
