"use client";

import { Building2, ChevronDown, FileText, FolderSearch, Plus, Settings2, Sparkles } from "lucide-react";
import type { Company, Report } from "./research-types";

interface WorkspaceSidebarProps {
  companies: Company[];
  reports: Report[];
  activeCompanyId: string | null;
  activeReportId: string | null;
  loading: boolean;
  persistence: "postgres" | "memory_demo" | null;
  onCompanySelect: (companyId: string) => void;
  onReportSelect: (reportId: string) => void;
  onCreateReport: () => void;
  onOpenSearch: () => void;
}

/** 左栏只展示工作台快照中的对象与报告；创建对象接口尚未实现，因此不伪造本地持久化。 */
export function WorkspaceSidebar({
  companies,
  reports,
  activeCompanyId,
  activeReportId,
  loading,
  persistence,
  onCompanySelect,
  onReportSelect,
  onCreateReport,
  onOpenSearch,
}: WorkspaceSidebarProps) {
  const activeCompany = companies.find((company) => company.id === activeCompanyId);
  const companyReports = reports.filter((report) => report.companyId === activeCompanyId);

  return (
    <aside className="workspace-sidebar" aria-label="研究对象与报告">
      <div className="brand-row">
        <span className="brand-mark" aria-hidden="true"><FolderSearch size={18} strokeWidth={2.2} /></span>
        <span>Research Workbench</span>
      </div>

      <button type="button" className="workspace-switcher" aria-label="当前个人工作区">
        <span><span className="workspace-dot" aria-hidden="true" />个人研究库</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      <button type="button" className="sidebar-search" onClick={onOpenSearch}>
        <span><FolderSearch size={16} aria-hidden="true" />搜索全部资料</span>
        <kbd>⌘K</kbd>
      </button>

      <div className="sidebar-section-heading"><span>研究对象</span></div>
      <nav className="entity-list" aria-label="研究对象" aria-busy={loading}>
        {loading ? <div className="empty-inline">正在加载工作区…</div> : null}
        {!loading && companies.length === 0 ? <div className="empty-inline">尚未创建研究对象</div> : null}
        {companies.map((company) => {
          const reportCount = reports.filter((report) => report.companyId === company.id).length;
          return (
            <button
              type="button"
              key={company.id}
              onClick={() => onCompanySelect(company.id)}
              className={company.id === activeCompanyId ? "entity-row is-active" : "entity-row"}
              aria-current={company.id === activeCompanyId ? "page" : undefined}
            >
              <Building2 size={16} aria-hidden="true" />
              <span className="entity-copy"><strong>{company.name}</strong><small>{company.summary}</small></span>
              <span className="count">{reportCount}</span>
            </button>
          );
        })}
      </nav>

      <div className="sidebar-section-heading reports-heading">
        <span>{activeCompany?.name ?? "研究对象"}的报告</span>
        <button type="button" className="icon-button" title={persistence === "postgres" ? "新建报告" : "连接 PostgreSQL 后可新建报告"} aria-label="新建报告" onClick={onCreateReport} disabled={!activeCompanyId || persistence !== "postgres"}>
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="report-list">
        {companyReports.map((report) => (
          <button
            type="button"
            key={report.id}
            className={report.id === activeReportId ? "report-row is-active" : "report-row"}
            onClick={() => onReportSelect(report.id)}
            aria-current={report.id === activeReportId ? "page" : undefined}
          >
            <FileText size={15} aria-hidden="true" />
            <span>{report.title}</span>
          </button>
        ))}
        {!loading && activeCompanyId && companyReports.length === 0 ? <div className="empty-inline"><Sparkles size={15} aria-hidden="true" />还没有报告</div> : null}
      </div>

      <div className="sidebar-bottom">
        <button type="button" className="plain-nav-button"><Settings2 size={16} aria-hidden="true" />个人设置</button>
        <p><span className={persistence === "memory_demo" ? "status-dot status-dot--neutral" : "status-dot status-dot--success"} />{persistence === "memory_demo" ? "内存演示模式，重启后会清空" : "持久化工作区可用"}</p>
      </div>
    </aside>
  );
}
