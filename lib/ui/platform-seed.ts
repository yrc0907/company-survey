export type VerificationState = "verified" | "needs_verification";
export type ProjectCategory = "企业" | "政策" | "行业" | "技术";
export type FileNodeKind = "folder" | "document" | "source" | "data";

export interface SeedUser {
  id: string;
  username: string;
  displayName: string;
}

/**
 * 文件公开预览投影。
 * `text`、`rows` 和 `url` 只能来自已公开的来源快照或解析产物，前端不得自行补造。
 * 原件仍由 OSS/来源权限控制；这里仅携带详情页所需的最小公开投影。
 */
export interface SeedFilePreview {
  kind: "markdown" | "text" | "pdf" | "image" | "spreadsheet" | "unknown";
  mimeType?: string;
  sourceUrl?: string;
  capturedAt?: string;
  contentHash?: string;
  text?: string;
  columns?: string[];
  rows?: string[][];
  note?: string;
}

export interface SeedFileNode {
  id: string;
  name: string;
  kind: FileNodeKind;
  children?: SeedFileNode[];
  /** 公开主版本可见的来源/解析预览；没有内容时不设置。 */
  preview?: SeedFilePreview;
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

/** 本地无数据库时的企业首发投影；统计保持 0，来源和结论明确标记为待核验。 */
const publicCompanySeeds: SeedProject[] = [
  {
    id: "project-weaver",
    slug: "weaver-enterprise-collaboration",
    title: "泛微网络：企业协同与数字化管理公开研究",
    summary: "基于泛微官网公开入口的产品范围摘要；客户数量、市场份额、价格和交付效果仍需独立来源核验。",
    category: "企业",
    tags: ["协同办公", "企业数字化", "公开资料"],
    verification: "needs_verification",
    verificationNote: "仅含官网公开入口与人工摘要，尚未完成正文快照和商业数据交叉核验。",
    owner: yu,
    publishedAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 1,
    openMergeRequests: 0,
    version: 1,
    files: sharedFiles,
    sections: [{ id: "section-weaver-public", heading: "公开摘要与证据边界", paragraphs: ["泛微官网公开介绍协同办公与企业数字化管理产品。该句只记录企业自述，不推断市场份额、客户评价或价格。"], state: "needs_verification", contributor: yu, mergeRequest: 0, reviewer: "待核验", citations: 1 }],
  },
  {
    id: "project-sangfor",
    slug: "sangfor-cloud-security",
    title: "深信服：云计算与网络安全产品公开研究",
    summary: "基于深信服官网公开入口的产品范围摘要；安全效果、客户规模、收入和价格不由该摘要推断。",
    category: "企业",
    tags: ["云计算", "网络安全", "公开资料"],
    verification: "needs_verification",
    verificationNote: "仅含官网公开入口与人工摘要，尚未完成正文快照和商业数据交叉核验。",
    owner: yu,
    publishedAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 1,
    openMergeRequests: 0,
    version: 1,
    files: sharedFiles,
    sections: [{ id: "section-sangfor-public", heading: "公开摘要与证据边界", paragraphs: ["深信服官网公开展示云计算、网络安全及基础设施相关产品与服务。该句只记录企业自述，不推断安全效果、收入或价格。"], state: "needs_verification", contributor: yu, mergeRequest: 0, reviewer: "待核验", citations: 1 }],
  },
  {
    id: "project-sundray",
    slug: "sundray-enterprise-network",
    title: "信锐科技：企业网络与物联网产品公开研究",
    summary: "基于信锐科技官网公开入口的产品范围摘要；覆盖规模、性能、客户评价和价格仍需独立来源核验。",
    category: "企业",
    tags: ["企业无线", "交换网络", "物联网", "公开资料"],
    verification: "needs_verification",
    verificationNote: "仅含官网公开入口与人工摘要，尚未完成正文快照和商业数据交叉核验。",
    owner: yu,
    publishedAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 1,
    openMergeRequests: 0,
    version: 1,
    files: sharedFiles,
    sections: [{ id: "section-sundray-public", heading: "公开摘要与证据边界", paragraphs: ["信锐科技官网公开展示企业无线、交换与物联网相关网络产品。该句只记录企业自述，不推断覆盖规模、性能或价格。"], state: "needs_verification", contributor: yu, mergeRequest: 0, reviewer: "待核验", citations: 1 }],
  },
  {
    id: "project-muyuan",
    slug: "muyuan-foods-livestock",
    title: "牧原食品：生猪养殖、成本曲线与产业链研究",
    summary: "围绕出栏、猪价、完全成本、生物安全、现金流和产业链协同建立独立研究档案；农牧指标不套用 SaaS 模板。",
    category: "企业",
    tags: ["生猪养殖", "农牧食品", "周期研究", "上市公司"],
    verification: "needs_verification",
    verificationNote: "收入、利润、出栏、成本、猪价与股价结论必须逐期引用公告或权威统计。",
    owner: yu,
    publishedAt: "2026-09-02T16:00:00.000Z",
    updatedAt: "2026-09-02T16:00:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 1,
    openMergeRequests: 0,
    version: 1,
    files: sharedFiles,
    sections: [
      { id: "section-muyuan-conclusion", heading: "研究结论", paragraphs: ["牧原的经营质量不能只看出栏规模，首先要看单位成本、生物安全和现金流韧性。猪价周期会放大经营杠杆，扩张是否创造价值取决于成本曲线和负债安全边界。"], state: "inference", contributor: yu, mergeRequest: 0, reviewer: "待核验", citations: 1 },
      { id: "section-muyuan-business", heading: "产品与产业链", paragraphs: ["研究对象按育种、饲料、养殖、生物安全、屠宰和食品渠道拆分；这些环节的协同关系需要用年报、销售简报和行业数据逐项验证。"], state: "needs_verification", contributor: yu, mergeRequest: 0, reviewer: "待核验", citations: 1 },
      { id: "section-muyuan-risk", heading: "风险与待核验", paragraphs: ["猪价下行、疫病、饲料价格、资本开支、负债期限、环保和食品安全是核心风险。完全成本、现金安全边界和屠宰业务盈利仍需逐期核验。"], state: "needs_verification", contributor: yu, mergeRequest: 0, reviewer: "待核验", citations: 2 },
    ],
  },
];

/** 已归档企业不再进入无数据库时的公开回退列表，避免旧首发对象重新出现在首页。 */
const additionalCompanySeeds: SeedProject[] = [];

/** 首发内容仅用于前端信息架构展示；核验标签明确区分已检查材料与待核验结论。 */
export const seedProjects: SeedProject[] = [
  {
    id: "project-huice",
    slug: "huice-commerce-erp",
    title: "慧策掌上先机：产品、行业与竞争压力调研",
    summary: "从公开产品资料、政策文本与竞品线索梳理电商履约软件的产品边界与转型压力。",
    category: "企业",
    tags: ["企业研究", "电商 ERP", "SaaS"],
    verification: "needs_verification",
    verificationNote: "仅含公开官网入口与人工摘要；商业判断和政策关联仍需独立来源核验。",
    owner: yu,
    publishedAt: "2026-08-12T08:00:00.000Z",
    updatedAt: "2026-09-01T09:20:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 1,
    openMergeRequests: 0,
    version: 1,
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
        state: "needs_verification",
        contributor: yu,
        mergeRequest: 0,
        reviewer: "待核验",
        citations: 1,
      },
      {
        id: "section-evidence",
        nodeId: "doc-huice-evidence",
        heading: "证据范围与边界",
        paragraphs: [
          "本节使用企业官网、公开政策文本与可公开引用的行业资料。价格、实施成本和续费情况仍需要来自合同、客户访谈或权威统计的独立证据。",
        ],
        state: "needs_verification",
        contributor: yu,
        mergeRequest: 0,
        reviewer: "待核验",
        citations: 1,
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
        mergeRequest: 0,
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
    owner: yu,
    publishedAt: "2026-08-18T08:00:00.000Z",
    updatedAt: "2026-08-31T15:14:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 0,
    openMergeRequests: 0,
    version: 1,
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
    owner: yu,
    publishedAt: "2026-08-24T08:00:00.000Z",
    updatedAt: "2026-09-01T02:40:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 0,
    openMergeRequests: 0,
    version: 1,
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
    owner: yu,
    publishedAt: "2026-08-29T08:00:00.000Z",
    updatedAt: "2026-09-01T10:06:00.000Z",
    uniqueReaders: 0,
    contributors: [yu],
    sourceCount: 0,
    openMergeRequests: 0,
    version: 1,
    files: sharedFiles,
    sections: [],
  },
  ...publicCompanySeeds,
  ...additionalCompanySeeds,
];

export function getSeedProject(projectId: string): SeedProject | undefined {
  return seedProjects.find((project) => project.id === projectId);
}
