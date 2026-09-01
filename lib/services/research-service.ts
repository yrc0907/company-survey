import { randomUUID } from "node:crypto";

import { NotFoundError, ValidationError, VersionConflictError } from "@/lib/domain/errors";
import { evidenceStates, type CreateReportInput, type Report, type ReportRevision, type ReportSection, type SaveReportInput, type WorkbenchSnapshot } from "@/lib/domain/research";
import type { ResearchRepository } from "@/lib/providers/research-repository";

/** 将输入标题标准化，避免空白标题、超长标题和不可读锚点进入报告。 */
function normalizeTitle(value: string, fieldName: string): string {
  const title = value.replace(/\s+/g, " ").trim();
  if (!title) throw new ValidationError(`${fieldName}不能为空`);
  if (title.length > 160) throw new ValidationError(`${fieldName}不能超过 160 个字符`);
  return title;
}

/** 验证用户显式选择的证据状态，AI 输出不能绕过该白名单。 */
function assertEvidenceState(value: string): asserts value is ReportSection["evidenceState"] {
  if (!(evidenceStates as readonly string[]).includes(value)) {
    throw new ValidationError("结论状态无效");
  }
}

/** 为新章节生成稳定、可读且不依赖 Markdown 渲染器规则的锚点。 */
function createAnchor(heading: string, position: number): string {
  const normalized = heading
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `${normalized}-${position}` : `section-${position}`;
}

/**
 * 报告聚合服务。
 * 负责版本检查和不可变 revision 写入，绝不接受模型直接提交的任意写入动作。
 */
export class ReportService {
  public constructor(private readonly repository: ResearchRepository) {}

  /** 新建一份用户发起的报告，并同时建立 v1 版本快照。 */
  public async createReport(input: CreateReportInput): Promise<{ report: Report; sections: ReportSection[]; revision: ReportRevision }> {
    const snapshot = await this.repository.getSnapshot();
    const company = snapshot.companies.find((item) => item.id === input.companyId);
    if (!company) throw new NotFoundError("研究对象不存在");

    const now = new Date().toISOString();
    const report: Report = {
      id: randomUUID(),
      companyId: company.id,
      title: normalizeTitle(input.title, "报告标题"),
      status: "draft",
      currentVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const firstHeading = input.firstSection?.heading ? normalizeTitle(input.firstSection.heading, "章节标题") : "研究摘要";
    const firstEvidenceState = input.firstSection?.evidenceState ?? "needs_verification";
    assertEvidenceState(firstEvidenceState);
    const sections: ReportSection[] = [{
      id: randomUUID(), reportId: report.id, parentSectionId: null, heading: firstHeading, anchor: createAnchor(firstHeading, 1),
      level: 1, position: 1, content: input.firstSection?.content?.trim() ?? "", evidenceState: firstEvidenceState, updatedAt: now,
    }];
    const revision: ReportRevision = {
      id: randomUUID(), reportId: report.id, version: 1, title: report.title, sections, author: "user", createdAt: now,
    };

    await this.repository.createReport(report, sections, revision);
    return { report, sections, revision };
  }

  /**
   * 由用户确认后的报告编辑写入新版本。
   * 若页面仍基于旧版本，抛出 VersionConflictError 而不是静默覆盖新内容。
   */
  public async saveReport(reportId: string, input: SaveReportInput): Promise<{ report: Report; sections: ReportSection[]; revision: ReportRevision }> {
    const current = await this.repository.getReport(reportId);
    if (!current) throw new NotFoundError("报告不存在");
    if (current.currentVersion !== input.expectedVersion) {
      throw new VersionConflictError(input.expectedVersion, current.currentVersion);
    }
    if (!Array.isArray(input.sections) || input.sections.length === 0) {
      throw new ValidationError("报告至少需要一个章节");
    }
    if (input.sections.length > 80) {
      throw new ValidationError("单份报告最多保存 80 个章节");
    }

    const now = new Date().toISOString();
    const nextVersion = current.currentVersion + 1;
    const headingIds = new Set<string>();
    const sections = input.sections
      .slice()
      .sort((left, right) => left.position - right.position)
      .map((section, index): ReportSection => {
        const heading = normalizeTitle(section.heading, "章节标题");
        assertEvidenceState(section.evidenceState);
        if (section.content.length > 40_000) throw new ValidationError("单个章节不能超过 40000 个字符");
        const id = section.id || randomUUID();
        if (headingIds.has(id)) throw new ValidationError("章节 ID 重复");
        headingIds.add(id);
        return {
          id, reportId, parentSectionId: section.parentSectionId, heading,
          anchor: section.anchor?.trim() || createAnchor(heading, index + 1), level: Math.min(6, Math.max(1, section.level)),
          position: index + 1, content: section.content.trim(), evidenceState: section.evidenceState, updatedAt: now,
        };
      });
    const report: Report = { ...current, title: normalizeTitle(input.title, "报告标题"), currentVersion: nextVersion, updatedAt: now };
    const revision: ReportRevision = { id: randomUUID(), reportId, version: nextVersion, title: report.title, sections, author: "user", createdAt: now };

    await this.repository.saveReport(report, sections, revision, input.expectedVersion);
    return { report, sections, revision };
  }
}

/** 工作台聚合服务，集中读取只读快照，防止页面散落读取逻辑。 */
export class WorkbenchService {
  public constructor(private readonly repository: ResearchRepository) {}

  /** 返回服务内部使用的完整快照；不得直接作为 HTTP 响应，否则会暴露全部来源原文。 */
  public async getSnapshot(): Promise<WorkbenchSnapshot> {
    return this.repository.getSnapshot();
  }

  /**
   * 返回 UI 初始化所需的受限快照。
   * 仅保留来源预览，Chunk 原文只能通过受限搜索或上下文投影按需返回，避免 workbench API 一次泄漏全部资料。
   */
  public async getClientSnapshot(): Promise<WorkbenchSnapshot> {
    const snapshot = await this.repository.getSnapshot();
    return {
      ...snapshot,
      // source 的项目/分支/owner/产物血缘仅供服务端索引与授权；公开工作台只返回阅读所需字段。
      sources: snapshot.sources.map((source) => ({
        id: source.id,
        reportId: source.reportId,
        title: source.title,
        kind: source.kind,
        url: source.url,
        language: source.language,
        state: source.state,
        capturedAt: source.capturedAt,
        contentHash: source.contentHash,
        snapshot: source.snapshot.length > 320 ? `${source.snapshot.slice(0, 320)}…` : source.snapshot,
      })),
      chunks: [],
    };
  }
}
