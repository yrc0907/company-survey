import type { GraphPath, SearchHit } from "@/lib/domain/research";
import type { ResearchRepository } from "@/lib/providers/research-repository";
import { NotFoundError, ValidationError } from "@/lib/domain/errors";
import { GraphService } from "@/lib/services/graph-service";
import { findReportSnapshot, SearchService } from "@/lib/services/search-service";

/** 允许投影给模型的输入；选区路径永远不做全库检索。 */
export interface ContextProjectionInput {
  reportId: string;
  question: string;
  selectedText?: string;
  selectedSectionId?: string;
}

/** 为前端和后续模型 Provider 输出的最小、可引用任务上下文包。 */
export interface ContextProjection {
  mode: "selection" | "retrieval";
  task: string;
  report: { id: string; title: string };
  rules: string[];
  selectedContext?: { text: string; sectionHeading: string | null };
  evidence: Array<{ chunkId: string; sourceId: string; title: string; url: string | null; page: number | null; quote: string; state: string }>;
  graphPaths: GraphPath[];
  refusalReason: string | null;
}

/**
 * 任务级微上下文投影。
 * 检索决定“找什么”，此服务决定“这次允许给模型什么”，并让每份证据保留回源位置。
 */
export class ContextProjectionService {
  private readonly searchService: SearchService;
  private readonly graphService: GraphService;

  public constructor(private readonly repository: ResearchRepository) {
    this.searchService = new SearchService(repository);
    this.graphService = new GraphService(repository);
  }

  /** 生成受限上下文；无证据时要求模型拒答，不得补造研究结论。 */
  public async project(input: ContextProjectionInput): Promise<ContextProjection> {
    const question = input.question.trim();
    if (!question) throw new ValidationError("AI 问题不能为空");
    if (question.length > 1_000) throw new ValidationError("AI 问题不能超过 1000 个字符");
    const snapshot = await this.repository.getSnapshot();
    const { report, sections } = findReportSnapshot(snapshot, input.reportId);
    if (!report) throw new NotFoundError("报告不存在");

    const rules = [
      "只能依据 evidence 中的原始片段回答，不得补造价格、客户、政策或业务事实。",
      "企业官网内容必须表述为企业自述；政策方向契合不等于法律、监管或商业结果。",
      "每个事实结论必须包含来源引用；证据不足时明确标记为待核验。",
      "不得直接写入报告；只能生成建议或 Diff，等待用户确认后再保存新版本。",
    ];
    const selectedText = input.selectedText?.trim();
    if (selectedText) {
      if (selectedText.length > 8_000) throw new ValidationError("选中文本不能超过 8000 个字符");
      const selectedSection = input.selectedSectionId ? sections.find((section) => section.id === input.selectedSectionId) ?? null : null;
      return {
        mode: "selection", task: question, report: { id: report.id, title: report.title }, rules,
        selectedContext: { text: selectedText, sectionHeading: selectedSection?.heading ?? null }, evidence: [], graphPaths: [], refusalReason: null,
      };
    }

    const hits = await this.searchService.search(question, { reportId: report.id, limit: 8 });
    const graphPaths = this.graphService.querySnapshot(snapshot, report.id, question.toLocaleLowerCase("zh-CN"));
    return {
      mode: "retrieval", task: question, report: { id: report.id, title: report.title }, rules,
      evidence: hits.map(toEvidence), graphPaths,
      refusalReason: hits.length === 0 ? "未在当前报告的 active 来源中找到足够证据；请导入来源或改写问题。" : null,
    };
  }
}

/** 将内部检索结果投影成模型只能引用的必要字段。 */
function toEvidence(hit: SearchHit) {
  return {
    chunkId: hit.chunk.id, sourceId: hit.source.id, title: hit.source.title, url: hit.source.url,
    page: hit.chunk.page, quote: hit.chunk.text, state: hit.source.state,
  };
}
