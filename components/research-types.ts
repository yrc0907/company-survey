import type { AiConfigurationStatus, Citation, Company, Report, ReportRevision, ReportSection, Source, SourceChunk, WorkbenchSnapshot } from "@/lib/domain/research";

/** 复用领域层的只读类型，避免客户端再维护一份会漂移的 API 数据模型。 */
export type { AiConfigurationStatus, Citation, Company, Report, ReportRevision, ReportSection, Source, SourceChunk, WorkbenchSnapshot };

/** 报告正文选区只传递用户明确选中的内容，不能隐式扩大读取范围。 */
export interface SelectionContext {
  text: string;
  sectionId: string;
  action: "ask" | "explain" | "sources" | "rewrite";
}

/** 命令搜索的最小可展示结果，保留报告和父章节定位。 */
export interface CommandSearchHit {
  id: string;
  reportId: string;
  sectionId: string | null;
  title: string;
  description: string;
}
