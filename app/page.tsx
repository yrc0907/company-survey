"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AddTextSourceDialog } from "@/components/add-text-source-dialog";
import { CommandPalette } from "@/components/command-palette";
import { CreateResearchDialog } from "@/components/create-research-dialog";
import { ReportEditor } from "@/components/report-editor";
import { ResearchAssistant } from "@/components/research-assistant";
import type { AiConfigurationStatus, Report, ReportRevision, ReportSection, SelectionContext, Source, WorkbenchSnapshot } from "@/components/research-types";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";

interface WorkbenchResponse {
  snapshot: WorkbenchSnapshot;
  ai: AiConfigurationStatus;
}

interface HealthResponse {
  ok: boolean;
  persistence: "postgres" | "memory_demo";
}

interface ReportMutationResponse {
  report: Report;
  sections: ReportSection[];
  revision: ReportRevision;
}

interface TextSourceImportResponse {
  source: Source;
}

/** 空数组保持引用稳定，避免加载前的 Hook 依赖在每次渲染中失效。 */
const EMPTY_REPORTS: Report[] = [];

/** 将 API 失败转为可展示错误，不向页面泄漏 Provider、数据库或请求堆栈细节。 */
async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "请求失败，请稍后重试。");
  return payload;
}

/** 个人调研工作台的 API 状态编排层；初始数据只能来自 workbench 快照，而非浏览器种子。 */
export default function HomePage() {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [ai, setAi] = useState<AiConfigurationStatus | null>(null);
  const [persistence, setPersistence] = useState<"postgres" | "memory_demo" | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(null);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [textSourceDialogOpen, setTextSourceDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const loadWorkbench = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [payload, health] = await Promise.all([
        requestJson<WorkbenchResponse>("/api/research/workbench", { cache: "no-store" }),
        requestJson<HealthResponse>("/api/healthz", { cache: "no-store" }),
      ]);
      setSnapshot(payload.snapshot);
      setAi(payload.ai);
      setPersistence(health.persistence);
      const firstCompany = payload.snapshot.companies[0] ?? null;
      const firstReport = payload.snapshot.reports.find((report) => report.companyId === firstCompany?.id) ?? payload.snapshot.reports[0] ?? null;
      setActiveCompanyId((current) => payload.snapshot.companies.some((company) => company.id === current) ? current : firstReport?.companyId ?? firstCompany?.id ?? null);
      setActiveReportId((current) => payload.snapshot.reports.some((report) => report.id === current) ? current : firstReport?.id ?? null);
      setActiveSectionId((current) => payload.snapshot.sections.some((section) => section.id === current) ? current : payload.snapshot.sections.find((section) => section.reportId === firstReport?.id)?.id ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法加载研究工作区。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorkbench(); }, [loadWorkbench]);
  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const reports = snapshot?.reports ?? EMPTY_REPORTS;
  const companies = snapshot?.companies ?? [];
  const activeReport = useMemo(() => reports.find((report) => report.id === activeReportId), [reports, activeReportId]);
  const activeSections = useMemo(() => activeReport ? (snapshot?.sections.filter((section) => section.reportId === activeReport.id).sort((left, right) => left.position - right.position) ?? []) : [], [snapshot?.sections, activeReport]);
  const activeSources = useMemo(() => activeReport ? (snapshot?.sources.filter((source) => source.reportId === activeReport.id) ?? []) : [], [snapshot?.sources, activeReport]);
  const activeCitations = useMemo(() => activeReport ? (snapshot?.citations.filter((citation) => citation.reportId === activeReport.id) ?? []) : [], [snapshot?.citations, activeReport]);
  const canPersist = persistence === "postgres";

  function selectCompany(companyId: string) {
    const report = reports.find((item) => item.companyId === companyId) ?? null;
    setActiveCompanyId(companyId);
    setActiveReportId(report?.id ?? null);
    setActiveSectionId(report ? snapshot?.sections.find((section) => section.reportId === report.id)?.id ?? null : null);
    setSelection(null);
  }

  function selectReport(reportId: string) {
    const report = reports.find((item) => item.id === reportId);
    if (!report) return;
    setActiveReportId(reportId);
    setActiveCompanyId(report.companyId);
    setActiveSectionId(snapshot?.sections.find((section) => section.reportId === reportId)?.id ?? null);
    setSelection(null);
  }

  function selectSearchHit(reportId: string, sectionId: string | null) {
    selectReport(reportId);
    if (!sectionId) return;
    setActiveSectionId(sectionId);
    window.setTimeout(() => document.getElementById(`section-${sectionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function createReport(input: { title: string; companyId: string }) {
    if (!canPersist) throw new Error("当前为内存演示模式；连接 PostgreSQL 后可新建报告。");
    const result = await requestJson<ReportMutationResponse>("/api/research/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: input.companyId, title: input.title }),
    });
    setSnapshot((current) => current ? {
      ...current,
      reports: [...current.reports, result.report],
      sections: [...current.sections, ...result.sections],
      revisions: [...current.revisions, result.revision],
    } : current);
    setActiveCompanyId(result.report.companyId);
    setActiveReportId(result.report.id);
    setActiveSectionId(result.sections[0]?.id ?? null);
    setSelection(null);
  }

  async function saveReport(input: { title: string; expectedVersion: number; sections: Array<Pick<ReportSection, "id" | "parentSectionId" | "heading" | "anchor" | "level" | "position" | "content" | "evidenceState">> }) {
    if (!canPersist) throw new Error("当前为内存演示模式；连接 PostgreSQL 后可保存报告版本。");
    if (!activeReport) throw new Error("请先选择一份报告。");
    const result = await requestJson<ReportMutationResponse>(`/api/research/reports/${encodeURIComponent(activeReport.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    setSnapshot((current) => current ? {
      ...current,
      reports: current.reports.map((report) => report.id === result.report.id ? result.report : report),
      sections: [...current.sections.filter((section) => section.reportId !== result.report.id), ...result.sections],
      revisions: [...current.revisions, result.revision],
    } : current);
  }

  /** 资料写入成功后重新读取服务器快照，确保来源列表和命令搜索使用同一份持久化数据。 */
  async function importTextSource(input: { title: string; text: string }) {
    if (!canPersist) throw new Error("当前为内存演示模式；连接 PostgreSQL 后可添加资料。");
    if (!activeReport) throw new Error("请先选择一份报告。");
    await requestJson<TextSourceImportResponse>(`/api/research/reports/${encodeURIComponent(activeReport.id)}/sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    await loadWorkbench();
  }

  return (
    <div className="workbench-shell">
      <WorkspaceSidebar companies={companies} reports={reports} activeCompanyId={activeCompanyId} activeReportId={activeReportId} loading={loading} persistence={persistence} onCompanySelect={selectCompany} onReportSelect={selectReport} onCreateReport={() => { if (canPersist) setCreateDialogOpen(true); }} onOpenSearch={() => setSearchOpen(true)} />
      <ReportEditor report={activeReport} sections={activeSections} citations={activeCitations} sources={activeSources} activeSectionId={activeSectionId} loading={loading} persistence={persistence} onSectionChange={setActiveSectionId} onSelectionAction={setSelection} onCreateReport={() => { if (canPersist) setCreateDialogOpen(true); }} onAddTextSource={() => { if (canPersist && activeReport) setTextSourceDialogOpen(true); }} onSave={saveReport} />
      <ResearchAssistant report={activeReport} selection={selection} sources={activeSources} ai={ai} onClearSelection={() => setSelection(null)} />
      <CommandPalette open={searchOpen} companies={companies} reports={reports} onClose={() => setSearchOpen(false)} onChooseCompany={selectCompany} onChooseReport={selectReport} onChooseSearchHit={selectSearchHit} />
      <CreateResearchDialog open={createDialogOpen && canPersist} companies={companies} activeCompanyId={activeCompanyId} onClose={() => setCreateDialogOpen(false)} onCreateReport={createReport} />
      <AddTextSourceDialog open={textSourceDialogOpen && canPersist && Boolean(activeReport)} reportTitle={activeReport?.title ?? null} onClose={() => setTextSourceDialogOpen(false)} onImport={importTextSource} />
      {loadError ? <div className="workbench-error-banner" role="alert"><span>{loadError}</span><button type="button" onClick={() => void loadWorkbench()}>重新加载</button></div> : null}
    </div>
  );
}
