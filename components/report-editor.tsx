"use client";

import { Check, ChevronRight, CircleAlert, Clock3, Copy, FileDown, FilePlus2, History, Link2, Pencil, Plus, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Citation, Report, ReportSection, SelectionContext, Source } from "./research-types";

interface ReportEditorProps {
  report: Report | undefined;
  sections: ReportSection[];
  citations: Citation[];
  sources: Source[];
  activeSectionId: string | null;
  loading: boolean;
  persistence: "postgres" | "memory_demo" | null;
  onSectionChange: (sectionId: string) => void;
  onSelectionAction: (context: SelectionContext) => void;
  onCreateReport: () => void;
  onAddTextSource: () => void;
  onSave: (input: { title: string; expectedVersion: number; sections: Array<Pick<ReportSection, "id" | "parentSectionId" | "heading" | "anchor" | "level" | "position" | "content" | "evidenceState">> }) => Promise<void>;
}

const statusCopy: Record<ReportSection["evidenceState"], string> = {
  fact: "事实",
  inference: "推断",
  needs_verification: "待核验",
  conflict: "存在冲突",
};

/** 把段落文本分开显示，仍保留原始内容供编辑器保存，不在浏览器中重新解释研究事实。 */
function contentParagraphs(content: string): string[] {
  return content.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
}

/** 报告区只将用户的显式编辑提交为版本写入；AI 提示不会自动覆盖正文。 */
export function ReportEditor({ report, sections, citations, sources, activeSectionId, loading, persistence, onSectionChange, onSelectionAction, onCreateReport, onAddTextSource, onSave }: ReportEditorProps) {
  const [selection, setSelection] = useState<{ text: string; sectionId: string; top: number; left: number } | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSections, setDraftSections] = useState<ReportSection[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const articleRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setDraftTitle(report?.title ?? "");
    setDraftSections(sections);
    setEditing(false);
    setSaving(false);
    setSaveError("");
    setSelection(null);
  }, [report?.id, report?.currentVersion, report?.title, sections]);

  const dirty = report ? draftTitle !== report.title || JSON.stringify(draftSections) !== JSON.stringify(sections) : false;
  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const canPersist = persistence === "postgres";
  const citationsBySection = useMemo(() => {
    const grouped = new Map<string, Citation[]>();
    for (const citation of citations) {
      if (!citation.sectionId) continue;
      const current = grouped.get(citation.sectionId) ?? [];
      current.push(citation);
      grouped.set(citation.sectionId, current);
    }
    return grouped;
  }, [citations]);

  function captureSelection() {
    if (editing) return;
    const browserSelection = window.getSelection();
    const text = browserSelection?.toString().trim() ?? "";
    const anchor = browserSelection?.anchorNode;
    if (!text || !anchor || !articleRef.current?.contains(anchor)) {
      setSelection(null);
      return;
    }
    const element = anchor.parentElement?.closest<HTMLElement>("[data-section-id]");
    const range = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : null;
    if (!element || !range) return;
    const rect = range.getBoundingClientRect();
    setSelection({ text, sectionId: element.dataset.sectionId ?? "", top: rect.top + window.scrollY - 46, left: rect.left + window.scrollX });
  }

  function runSelectionAction(action: SelectionContext["action"]) {
    if (!selection) return;
    onSelectionAction({ text: selection.text, sectionId: selection.sectionId, action });
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }

  function updateSection(id: string, patch: Partial<Pick<ReportSection, "heading" | "content" | "evidenceState">>) {
    setDraftSections((current) => current.map((section) => section.id === id ? { ...section, ...patch } : section));
  }

  async function save() {
    if (!report || !dirty || saving || !canPersist) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave({
        title: draftTitle,
        expectedVersion: report.currentVersion,
        sections: draftSections.map((section, index) => ({
          id: section.id,
          parentSectionId: section.parentSectionId,
          heading: section.heading,
          anchor: section.anchor,
          level: section.level,
          position: index + 1,
          content: section.content,
          evidenceState: section.evidenceState,
        })),
      });
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="report-empty-state" aria-busy="true"><div className="empty-icon"><Clock3 size={22} aria-hidden="true" /></div><h1>正在加载研究工作区</h1><p>正在读取报告、来源和版本信息。</p></main>;
  }

  if (!report) {
    return (
      <main className="report-empty-state">
        <div className="empty-icon"><FileDown size={22} aria-hidden="true" /></div>
        <h1>从一份可追溯的报告开始</h1>
        <p>选择左侧研究对象后新建报告；正文的任何保存都会建立新版本。</p>
        <button type="button" className="button button--primary" onClick={onCreateReport} disabled={!canPersist} title={canPersist ? "新建报告" : "连接 PostgreSQL 后可新建报告"}><Plus size={16} aria-hidden="true" />新建报告</button>
        {!canPersist ? <p className="memory-mode-note">当前为只读内存演示模式；连接 PostgreSQL 后可新建、编辑和保存报告版本。</p> : null}
      </main>
    );
  }

  return (
    <main className="report-pane" aria-label="报告阅读与编辑">
      <header className="report-topbar">
        <div className="breadcrumbs" aria-label="当前位置"><span>研究库</span><ChevronRight size={14} aria-hidden="true" /><span>企业调研</span><ChevronRight size={14} aria-hidden="true" /><strong>报告</strong></div>
        <div className="report-top-actions">
          <button type="button" className="button button--quiet" onClick={onAddTextSource} disabled={!canPersist} title={canPersist ? "添加手动文本资料" : "连接 PostgreSQL 后可添加资料"}><FilePlus2 size={15} aria-hidden="true" />添加资料</button>
          <button type="button" className="button button--quiet" disabled title="导出将在后续版本提供"><FileDown size={15} aria-hidden="true" />导出</button>
          {!editing ? <button type="button" className="button button--quiet" onClick={() => setEditing(true)} disabled={!canPersist} title={canPersist ? "编辑报告" : "连接 PostgreSQL 后可编辑报告"}><Pencil size={15} aria-hidden="true" />编辑</button> : null}
          <button type="button" className="button button--primary" onClick={save} disabled={!dirty || saving || !canPersist} title={canPersist ? "保存人工确认的版本" : "连接 PostgreSQL 后可保存版本"}><Save size={15} aria-hidden="true" />{saving ? "保存中…" : "保存版本"}</button>
        </div>
      </header>

      <div className="report-scroll" onMouseUp={captureSelection} onKeyUp={captureSelection}>
        <article ref={articleRef} className="report-article">
          <div className="report-heading">
            <div className="report-kicker"><span className="status-dot status-dot--success" />企业调研 <span className="mono">{report.id.slice(0, 12)}</span></div>
            {editing ? <input className="report-title-input" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} aria-label="报告标题" /> : <h1>{report.title}</h1>}
            <p>所有 AI 输出仅作为建议；保存由当前用户明确确认，并受版本锁保护。</p>
            <div className="report-meta">
              <span className={dirty ? "save-state is-pending" : "save-state"}>{dirty ? <Clock3 size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{dirty ? "未保存的人工修改" : persistence === "memory_demo" ? "内存演示结果，无法保证保留" : "已保存"}</span>
              <span>版本 {report.currentVersion}</span><span>更新于 {new Date(report.updatedAt).toLocaleString("zh-CN")}</span>
            </div>
            {persistence === "memory_demo" ? <p className="memory-mode-note">当前为只读内存演示模式；连接 PostgreSQL 后可新建、编辑和保存报告版本。</p> : null}
            {saveError ? <p className="form-error report-save-error" role="alert">{saveError}</p> : null}
          </div>

          <nav className="inline-toc" aria-label="报告目录"><span>目录</span>{draftSections.map((section) => <a key={section.id} href={`#section-${section.id}`} className={activeSectionId === section.id ? "is-active" : undefined} onClick={() => onSectionChange(section.id)}>{section.heading}</a>)}</nav>

          <div className="report-body">
            {draftSections.map((section, index) => {
              const sectionCitations = citationsBySection.get(section.id) ?? [];
              return <section id={`section-${section.id}`} data-section-id={section.id} key={section.id} className="report-section" onFocus={() => onSectionChange(section.id)} tabIndex={-1}>
                <div className="section-heading-row"><div><span className="section-number">{String(index + 1).padStart(2, "0")}</span>{editing ? <input className="section-heading-input" value={section.heading} onChange={(event) => updateSection(section.id, { heading: event.target.value })} aria-label={`章节 ${index + 1} 标题`} /> : <h2>{section.heading}</h2>}</div><span className={`claim-status claim-status--${section.evidenceState}`}>{section.evidenceState === "conflict" ? <CircleAlert size={13} aria-hidden="true" /> : null}{statusCopy[section.evidenceState]}</span></div>
                {editing ? <textarea className="section-content-input" value={section.content} onChange={(event) => updateSection(section.id, { content: event.target.value })} aria-label={`${section.heading}正文`} rows={Math.max(5, Math.min(16, section.content.split("\n").length + 3))} /> : contentParagraphs(section.content).map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}
                {sectionCitations.length ? <div className="citation-line" aria-label={`${section.heading}的引用`}><span><Link2 size={14} aria-hidden="true" />证据</span>{sectionCitations.map((citation) => {
                  const source = sourceById.get(citation.sourceId);
                  return source?.url ? <a key={citation.id} href={source.url} target="_blank" rel="noreferrer" title={source.title}>{citation.id}</a> : <span className="citation-missing-url" key={citation.id} title={source?.title ?? "来源已缺失"}>{citation.id}</span>;
                })}</div> : <div className="citation-line citation-line--missing"><CircleAlert size={14} aria-hidden="true" />本节尚缺外部证据</div>}
              </section>;
            })}
          </div>
        </article>

        <aside className="report-outline" aria-label="本页目录"><p>本页目录</p>{draftSections.map((section) => <a key={section.id} className={activeSectionId === section.id ? "is-active" : undefined} href={`#section-${section.id}`} onClick={() => onSectionChange(section.id)}>{section.heading}</a>)}<div className="revision-card"><span><History size={14} aria-hidden="true" />版本 {report.currentVersion}</span><p>保存时会创建不可变版本；若其他页面先保存，当前提交会被拒绝。</p></div></aside>
      </div>

      {selection ? <div className="selection-toolbar" role="toolbar" aria-label="选中文本操作" style={{ top: selection.top, left: Math.max(12, selection.left) }}><button type="button" onClick={() => runSelectionAction("ask")}><Sparkles size={14} aria-hidden="true" />问 AI</button><button type="button" onClick={() => runSelectionAction("explain")}>解释</button><button type="button" onClick={() => runSelectionAction("sources")}>补来源</button><button type="button" onClick={() => runSelectionAction("rewrite")}>改写</button><button type="button" aria-label="复制选中文本" title="复制选中文本" onClick={() => navigator.clipboard?.writeText(selection.text)}><Copy size={14} aria-hidden="true" /></button></div> : null}
    </main>
  );
}
